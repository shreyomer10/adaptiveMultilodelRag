'use client';

import { useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X, Search, FileText } from 'lucide-react';

interface PDFViewerModalProps {
  fileUrl: string;
  fileName: string;
  pageNumber: number;
  highlightText?: string;
  onClose: () => void;
}

export function PDFViewerModal({
  fileUrl,
  fileName,
  pageNumber,
  highlightText,
  onClose,
}: PDFViewerModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Append #page=N for browser PDF viewer navigation
  const pdfSrc = `${fileUrl}#page=${pageNumber}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[92vw] max-w-5xl h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-red-100 text-red-700 px-3 py-1.5 rounded-md text-xs font-bold flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              PDF
            </div>
            <div>
              <p className="text-sm font-semibold truncate max-w-[400px]">
                {fileName}
              </p>
              <p className="text-xs text-muted-foreground">
                Navigated to Page {pageNumber}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {highlightText && (
              <div className="flex items-center gap-1.5 bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-md text-xs max-w-[350px] border border-yellow-200">
                <Search className="h-3 w-3 flex-shrink-0" />
                <span className="truncate font-medium">
                  Source text highlighted below
                </span>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={onClose} className="gap-1">
              <X className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
        </div>

        {/* PDF Content */}
        <div className="flex-1 overflow-hidden bg-gray-200">
          <object
            data={pdfSrc}
            type="application/pdf"
            className="w-full h-full"
          >
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
              <FileText className="h-16 w-16 text-gray-400" />
              <p className="text-sm text-gray-500 text-center">
                PDF preview not available in this browser.
              </p>
              <a
                href={fileUrl}
                download={fileName}
                className="text-sm text-blue-500 underline"
              >
                Download PDF instead
              </a>
            </div>
          </object>
        </div>

        {/* Footer with source text preview */}
        {highlightText && (
          <div className="px-4 py-3 border-t bg-yellow-50 flex-shrink-0">
            <p className="text-xs text-yellow-800 font-semibold mb-1.5 flex items-center gap-1">
              <Search className="h-3 w-3" />
              Retrieved Source Content (Page {pageNumber}):
            </p>
            <p className="text-xs text-yellow-700 leading-relaxed bg-yellow-100/50 rounded p-2 border border-yellow-200">
              {highlightText}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
