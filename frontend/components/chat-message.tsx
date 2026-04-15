import { Copy, AlertTriangle, Brain, Database, Repeat, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { PDFDocument } from '@/types/graphTypes';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { PDFViewerModal } from './pdf-viewer-modal';

interface ChatMessageProps {
  message: {
    role: 'user' | 'assistant';
    content: string;
    sources?: PDFDocument[];
    chunkCount?: number;
    queryComplexity?: 'simple' | 'medium' | 'complex';
    hasConflicts?: boolean;
    hopCount?: number;
  };
  pdfUrls?: Map<string, string>;
}

const complexityConfig = {
  simple: { label: 'Simple Query', color: 'bg-green-100 text-green-700', k: 2, hops: 1 },
  medium: { label: 'Medium Query', color: 'bg-blue-100 text-blue-700', k: 5, hops: 1 },
  complex: { label: 'Complex Query', color: 'bg-purple-100 text-purple-700', k: 5, hops: 2 },
};

function extractFileName(sourcePath: string): string {
  // Extract just the filename from full temp path like
  // C:\Users\ASUS\AppData\Local\Temp\pdf-j5z4Yl\march_shrey.pdf
  const parts = sourcePath.split(/[/\\]/);
  return parts[parts.length - 1] || sourcePath;
}

function findPdfUrl(sourcePath: string, pdfUrls?: Map<string, string>): string | null {
  if (!pdfUrls || pdfUrls.size === 0) return null;
  const fileName = extractFileName(sourcePath);

  // Try exact match first
  for (const [name, url] of pdfUrls.entries()) {
    if (name === fileName) return url;
  }

  // Try partial match — the stored name might be inside the source path or vice versa
  for (const [name, url] of pdfUrls.entries()) {
    const storedClean = name.toLowerCase().replace(/\s+/g, '');
    const sourceClean = fileName.toLowerCase().replace(/\s+/g, '');
    if (storedClean.includes(sourceClean) || sourceClean.includes(storedClean)) {
      return url;
    }
  }

  // Last resort — check if ANY stored filename appears anywhere in the full source path
  for (const [name, url] of pdfUrls.entries()) {
    if (sourcePath.toLowerCase().includes(name.toLowerCase())) {
      return url;
    }
  }

  // If only one PDF is uploaded, just use that
  if (pdfUrls.size === 1) {
    return Array.from(pdfUrls.values())[0];
  }

  return null;
}

export function ChatMessage({ message, pdfUrls }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const [copied, setCopied] = useState(false);
  const isLoading = message.role === 'assistant' && message.content === '';
  const [viewerState, setViewerState] = useState<{
    fileUrl: string;
    fileName: string;
    pageNumber: number;
    highlightText: string;
  } | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleSourceClick = (source: PDFDocument) => {
    const sourcePath = source.metadata?.source || source.metadata?.filename || '';
    const fileName = extractFileName(sourcePath);
    const pageNumber = source.metadata?.loc?.pageNumber || 1;
    const highlightText = source.pageContent?.slice(0, 300) || '';

    const fileUrl = findPdfUrl(sourcePath, pdfUrls);

    if (fileUrl) {
      setViewerState({ fileUrl, fileName, pageNumber, highlightText });
    }
  };

  const showSources =
    message.role === 'assistant' &&
    message.sources &&
    message.sources.length > 0;

  const showMetadata =
    message.role === 'assistant' &&
    message.content !== '' &&
    (message.chunkCount || message.queryComplexity);

  const complexity = message.queryComplexity || 'medium';
  const cConfig = complexityConfig[complexity];

  return (
    <>
      <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
        <div
          className={`max-w-[85%] ${isUser ? 'bg-black text-white' : 'bg-muted'} rounded-2xl px-4 py-2`}
        >
          {isLoading ? (
            <div className="flex space-x-1 h-6 items-center">
              <div className="w-1.5 h-1.5 bg-current rounded-full animate-[loading_1s_ease-in-out_infinite]" />
              <div className="w-1.5 h-1.5 bg-current rounded-full animate-[loading_1s_ease-in-out_0.2s_infinite]" />
              <div className="w-1.5 h-1.5 bg-current rounded-full animate-[loading_1s_ease-in-out_0.4s_infinite]" />
            </div>
          ) : (
            <>
              {/* Conflict Warning Banner */}
              {message.hasConflicts && (
                <div className="flex items-center gap-2 bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 mb-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 flex-shrink-0" />
                  <p className="text-xs text-yellow-700 font-medium">
                    Conflicting information detected across document chunks
                  </p>
                </div>
              )}

              <p className="whitespace-pre-wrap">{message.content}</p>

              {/* Metadata Badges */}
              {showMetadata && (
                <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-border/50">
                  {/* Query Complexity Badge */}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cConfig.color}`}>
                    <Brain className="h-3 w-3" />
                    {cConfig.label}
                  </span>

                  {/* Chunk Count Badge */}
                  {message.chunkCount !== undefined && message.chunkCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      <Database className="h-3 w-3" />
                      Retrieved {message.chunkCount} chunks
                    </span>
                  )}

                  {/* Hop Count Badge */}
                  {message.hopCount !== undefined && message.hopCount > 1 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">
                      <Repeat className="h-3 w-3" />
                      Multi-Hop: {message.hopCount} retrieval passes
                    </span>
                  )}

                  {/* Conflict Badge */}
                  {message.hasConflicts && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                      <AlertTriangle className="h-3 w-3" />
                      Conflicts Found
                    </span>
                  )}
                </div>
              )}

              {!isUser && (
                <div className="flex gap-2 mt-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleCopy}
                    title={copied ? 'Copied!' : 'Copy to clipboard'}
                  >
                    <Copy
                      className={`h-4 w-4 ${copied ? 'text-green-500' : ''}`}
                    />
                  </Button>
                </div>
              )}
              {showSources && message.sources && (
                <Accordion type="single" collapsible className="w-full mt-2">
                  <AccordionItem value="sources" className="border-b-0">
                    <AccordionTrigger className="text-sm py-2 justify-start gap-2 hover:no-underline">
                      View Sources ({message.sources.length})
                    </AccordionTrigger>
                    <AccordionContent>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {message.sources?.map((source, index) => {
                          const sourcePath = source.metadata?.source || source.metadata?.filename || 'N/A';
                          const fileName = extractFileName(sourcePath);
                          const hasUrl = !!findPdfUrl(sourcePath, pdfUrls);

                          return (
                            <Card
                              key={index}
                              className={`bg-background/50 transition-all duration-200 hover:bg-background hover:shadow-md hover:scale-[1.02] cursor-pointer ${hasUrl ? 'border-blue-200 hover:border-blue-400' : ''}`}
                              onClick={() => handleSourceClick(source)}
                            >
                              <CardContent className="p-3">
                                <div className="flex items-center gap-2">
                                  <FileText className={`h-4 w-4 flex-shrink-0 ${hasUrl ? 'text-blue-500' : 'text-gray-400'}`} />
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium truncate">
                                      {fileName}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      Page {source.metadata?.loc?.pageNumber || 'N/A'}
                                      {hasUrl && (
                                        <span className="ml-2 text-blue-500 text-xs">Click to view</span>
                                      )}
                                    </p>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </>
          )}
        </div>
      </div>

      {/* PDF Viewer Modal */}
      {viewerState && (
        <PDFViewerModal
          fileUrl={viewerState.fileUrl}
          fileName={viewerState.fileName}
          pageNumber={viewerState.pageNumber}
          highlightText={viewerState.highlightText}
          onClose={() => setViewerState(null)}
        />
      )}
    </>
  );
}
