import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { reduceDocs } from '../shared/state.js';
import { Document } from '@langchain/core/documents';
/**
 * Represents the state of the retrieval graph / agent.
 */
export const AgentStateAnnotation = Annotation.Root({
  query: Annotation<string>(),
  route: Annotation<string>(),
  queryComplexity: Annotation<'simple' | 'medium' | 'complex'>({
    default: () => 'medium' as const,
    reducer: (_prev: any, next: any) => next,
  }),
  retrievedChunkCount: Annotation<number>({
    default: () => 0,
    reducer: (_prev: any, next: any) => next,
  }),
  hasConflicts: Annotation<boolean>({
    default: () => false,
    reducer: (_prev: any, next: any) => next,
  }),
  /** Current hop number (1-based) */
  hopCount: Annotation<number>({
    default: () => 0,
    reducer: (_prev: any, next: any) => next,
  }),
  /** Max hops allowed based on complexity */
  maxHops: Annotation<number>({
    default: () => 1,
    reducer: (_prev: any, next: any) => next,
  }),
  /** Refined query generated after reading first-hop context */
  refinedQuery: Annotation<string>({
    default: () => '',
    reducer: (_prev: any, next: any) => next,
  }),
  ...MessagesAnnotation.spec,

  /**
   * Populated by the retriever. This is a list of documents that the agent can reference.
   * @type {Document[]}
   */
  documents: Annotation<
    Document[],
    Document[] | { [key: string]: any }[] | string[] | string | 'delete'
  >({
    default: () => [],
    // @ts-ignore
    reducer: reduceDocs,
  }),
});
