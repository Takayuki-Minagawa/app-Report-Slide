'use client';

import { useMemo } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import type { DocumentData } from '@/src/document/model';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { DocumentRenderer } from './document-renderer';

const reportThemes = new Set(['latex', 'calculation']);
const slideThemes = new Set(['beamer-simple', 'technical']);

export function PreviewSurface({
  document,
  resolveImageUrl,
}: {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
}) {
  const { copy } = useAppPreferences();
  const slide = document.type === 'slide';
  const requested =
    typeof document.metadata.theme === 'string' ? document.metadata.theme : '';
  const theme = slide
    ? slideThemes.has(requested)
      ? requested
      : 'beamer-simple'
    : reportThemes.has(requested)
      ? requested
      : 'latex';
  const analysis = useMemo(() => analyzeDocument(document), [document]);
  const pages = useMemo(() => splitDocumentPages(document), [document]);

  return (
    <div className="preview-pages">
      <div className="preview-page-summary">
        {slide
          ? copy.preview.slides(pages.length)
          : copy.preview.pages(pages.length)}
      </div>
      {analysis.diagnostics.length > 0 && (
        <output
          className="semantic-warnings"
          aria-label={copy.preview.referenceWarnings}
        >
          <strong>{copy.preview.checkReferences}</strong>
          <ul>
            {analysis.diagnostics.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </output>
      )}
      {pages.map((nodes, index) => (
        <article
          key={index}
          className={slide ? 'slide-preview' : 'report-preview'}
          data-theme={theme}
          aria-label={
            slide ? copy.preview.slidePreview : copy.preview.reportPreview
          }
          data-page={index + 1}
        >
          <DocumentRenderer
            document={document}
            nodes={nodes}
            analysis={analysis}
            showToc={index === 0}
            resolveImageUrl={resolveImageUrl}
          />
          <footer>
            {slide && <span>{document.metadata.author ?? ''}</span>}
            {(!slide || document.metadata.slide_number !== false) && (
              <span>
                {index + 1}
                {slide ? ` / ${pages.length}` : ''}
              </span>
            )}
          </footer>
        </article>
      ))}
    </div>
  );
}
