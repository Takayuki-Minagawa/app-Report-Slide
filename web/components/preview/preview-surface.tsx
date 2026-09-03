'use client';

import { useMemo } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { DocumentData } from '@/src/document/model';
import { resolveDocumentTheme } from '@/src/document/metadata';
import {
  analyzeDocument,
  splitDocumentPages,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import { DocumentRenderer } from './document-renderer';

export function PreviewSurface({
  document,
  resolveImageUrl,
  analysis: providedAnalysis,
}: {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
  analysis?: DocumentAnalysis;
}) {
  const { copy, locale } = useAppPreferences();
  const slide = document.type === 'slide';
  const theme = resolveDocumentTheme(document.type, document.metadata.theme);
  const analysis = useMemo(
    () => providedAnalysis ?? analyzeDocument(document),
    [document, providedAnalysis],
  );
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
              <li key={message}>
                {localizeDiagnosticMessage(message, locale)}
              </li>
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
