'use client';

import { useMemo } from 'react';
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
          ? `${pages.length} スライド`
          : `${pages.length} ページ（明示的改ページ）`}
      </div>
      {analysis.diagnostics.length > 0 && (
        <output className="semantic-warnings" aria-label="参照の警告">
          <strong>参照を確認してください</strong>
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
          aria-label={slide ? 'スライドプレビュー' : 'A4レポートプレビュー'}
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
