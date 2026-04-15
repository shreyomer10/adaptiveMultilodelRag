import { StateGraph, START, END } from '@langchain/langgraph';
import { AgentStateAnnotation } from './state.js';
import { makeRetriever } from '../shared/retrieval.js';
import { formatDocs } from './utils.js';
import { HumanMessage } from '@langchain/core/messages';
import { RESPONSE_SYSTEM_PROMPT, ROUTER_SYSTEM_PROMPT } from './prompts.js';
import { RunnableConfig } from '@langchain/core/runnables';
import {
  AgentConfigurationAnnotation,
  ensureAgentConfiguration,
} from './configuration.js';
import { loadChatModel } from '../shared/utils.js';

/**
 * Classify query complexity and determine adaptive K value + hop depth.
 * Simple → k=2, 1 hop | Medium → k=5, 1 hop | Complex → k=5, 2 hops
 */
async function classifyAndRoute(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const query = state.query.toLowerCase();
  const wordCount = query.split(/\s+/).length;

  let complexity: 'simple' | 'medium' | 'complex' = 'medium';

  // Simple: short factual questions
  if (wordCount <= 6 && !query.includes('compare') && !query.includes('explain') && !query.includes('how') && !query.includes('why') && !query.includes('difference')) {
    complexity = 'simple';
  }
  // Complex: comparison, reasoning, multi-part questions
  else if (
    query.includes('compare') ||
    query.includes('difference between') ||
    query.includes('explain in detail') ||
    query.includes('analyze') ||
    query.includes('relationship between') ||
    query.includes('summarize') ||
    query.includes(' and ') && wordCount > 10 ||
    query.includes('how does') && query.includes('affect')
  ) {
    complexity = 'complex';
  }

  // Hop depth: simple=1, medium=1, complex=2
  const hopMap = { simple: 1, medium: 1, complex: 2 };

  return {
    route: 'retrieve',
    queryComplexity: complexity,
    maxHops: hopMap[complexity],
    hopCount: 0,
  };
}

async function answerQueryDirectly(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const configuration = ensureAgentConfiguration(config);
  const model = await loadChatModel(configuration.queryModel);
  const userHumanMessage = new HumanMessage(state.query);

  const response = await model.invoke([userHumanMessage]);
  return { messages: [userHumanMessage, response] };
}

async function routeQuery(
  state: typeof AgentStateAnnotation.State,
): Promise<'retrieveDocuments' | 'directAnswer'> {
  const route = state.route;
  if (!route) {
    throw new Error('Route is not set');
  }

  if (route === 'retrieve') {
    return 'retrieveDocuments';
  } else if (route === 'direct') {
    return 'directAnswer';
  } else {
    throw new Error('Invalid route');
  }
}

/**
 * Retrieve documents with adaptive K based on query complexity.
 * On hop 2+, uses the refined query and merges with existing docs.
 */
async function retrieveDocuments(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const currentHop = (state.hopCount || 0) + 1;

  // Dynamic K: hop 1 gets base k, hop 2 gets more to find new content
  const kMap = { simple: 2, medium: 5, complex: 6 };
  const dynamicK = currentHop > 1 ? 8 : kMap[state.queryComplexity || 'medium'];

  const adaptiveConfig: RunnableConfig = {
    ...config,
    configurable: {
      ...(config?.configurable || {}),
      k: dynamicK,
    },
  };

  // Use refined query on hop 2+, original query on hop 1
  const searchQuery = currentHop > 1 && state.refinedQuery
    ? state.refinedQuery
    : state.query;

  const retriever = await makeRetriever(adaptiveConfig);
  const response = await retriever.invoke(searchQuery);

  // On hop 2+, merge new docs with existing (deduplicate by content)
  let allDocs = response;
  if (currentHop > 1 && state.documents.length > 0) {
    const existingContent = new Set(state.documents.map(d => d.pageContent));
    const newDocs = response.filter(d => !existingContent.has(d.pageContent));
    allDocs = [...state.documents, ...newDocs];
  }

  return {
    documents: allDocs,
    retrievedChunkCount: allDocs.length,
    hopCount: currentHop,
  };
}

/**
 * After first hop, refine the query based on what was retrieved.
 * Generates a follow-up query to fill gaps in the first retrieval.
 */
async function refineQuery(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const configuration = ensureAgentConfiguration(config);
  const model = await loadChatModel(configuration.queryModel);
  const context = formatDocs(state.documents);

  const refinePrompt = new HumanMessage(
    `You are a search query optimizer. Given the original question and the context retrieved so far, generate a SHORT follow-up search query (max 15 words) to find missing information that would help answer the original question more completely.

Original question: ${state.query}

Context retrieved so far:
${context}

Generate ONLY the follow-up search query, nothing else:`
  );

  const result = await model.invoke([refinePrompt]);
  const refinedQuery = typeof result.content === 'string' ? result.content.trim() : state.query;

  return { refinedQuery };
}

/**
 * Decide whether to do another hop or proceed to validation.
 */
function shouldContinueRetrieval(
  state: typeof AgentStateAnnotation.State,
): 'refineQuery' | 'validateEvidence' {
  const currentHop = state.hopCount || 1;
  const maxHops = state.maxHops || 1;

  if (currentHop < maxHops) {
    return 'refineQuery';
  }
  return 'validateEvidence';
}

/**
 * Check retrieved documents for consistency issues.
 */
async function validateEvidence(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const docs = state.documents;

  // Low-content check: if all chunks are very short
  const totalContent = docs.reduce((sum, doc) => sum + (doc.pageContent?.length || 0), 0);
  if (totalContent < 100) {
    return { hasConflicts: false };
  }

  // Quick consistency check via LLM if we have 2+ docs
  if (docs.length >= 2) {
    try {
      const configuration = ensureAgentConfiguration(config);
      const model = await loadChatModel(configuration.queryModel);
      const docTexts = docs.map((d, i) => `[Chunk ${i + 1}]: ${d.pageContent?.slice(0, 300)}`).join('\n\n');

      const checkPrompt = new HumanMessage(
        `You are a fact-checker. Look at these document chunks and determine if they contain ANY contradictory or conflicting information. Respond with ONLY "CONFLICT" or "NO_CONFLICT". Nothing else.\n\n${docTexts}`
      );

      const result = await model.invoke([checkPrompt]);
      const content = typeof result.content === 'string' ? result.content : '';
      const hasConflicts = content.trim().toUpperCase().includes('CONFLICT') && !content.trim().toUpperCase().startsWith('NO');

      return { hasConflicts };
    } catch (e) {
      // If consistency check fails, just proceed without it
      return { hasConflicts: false };
    }
  }

  return { hasConflicts: false };
}

async function generateResponse(
  state: typeof AgentStateAnnotation.State,
  config: RunnableConfig,
): Promise<typeof AgentStateAnnotation.Update> {
  const configuration = ensureAgentConfiguration(config);
  const context = formatDocs(state.documents);
  const model = await loadChatModel(configuration.queryModel);
  const promptTemplate = RESPONSE_SYSTEM_PROMPT;

  const formattedPrompt = await promptTemplate.invoke({
    question: state.query,
    context: context,
  });

  const userHumanMessage = new HumanMessage(state.query);

  // Create a human message with the formatted prompt that includes context
  const formattedPromptMessage = new HumanMessage(formattedPrompt.toString());

  const messageHistory = [...state.messages, formattedPromptMessage];

  // Let MessagesAnnotation handle the message history
  const response = await model.invoke(messageHistory);

  // Return both the current query and the AI response to be handled by MessagesAnnotation's reducer
  return { messages: [userHumanMessage, response] };
}

const builder = new StateGraph(
  AgentStateAnnotation,
  AgentConfigurationAnnotation,
)
  .addNode('classifyAndRoute', classifyAndRoute)
  .addNode('retrieveDocuments', retrieveDocuments)
  .addNode('refineQuery', refineQuery)
  .addNode('validateEvidence', validateEvidence)
  .addNode('generateResponse', generateResponse)
  .addNode('directAnswer', answerQueryDirectly)
  .addEdge(START, 'classifyAndRoute')
  .addConditionalEdges('classifyAndRoute', routeQuery, [
    'retrieveDocuments',
    'directAnswer',
  ])
  // After retrieval, decide: another hop or proceed to validation
  .addConditionalEdges('retrieveDocuments', shouldContinueRetrieval, [
    'refineQuery',
    'validateEvidence',
  ])
  // After refining query, retrieve again (hop 2)
  .addEdge('refineQuery', 'retrieveDocuments')
  .addEdge('validateEvidence', 'generateResponse')
  .addEdge('generateResponse', END)
  .addEdge('directAnswer', END);

export const graph = builder.compile().withConfig({
  runName: 'RetrievalGraph',
});
