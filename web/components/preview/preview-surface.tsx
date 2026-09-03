'use client';

import { useMemo } from 'react';
import { useAppPreferences } from '@/components/app-preferences';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { DocumentData } from '@/src/document/model';
import {
  analyzeDocument,
  splitDocumentPages,
  type DocumentAnalysis,
} from '@/src/document/semantics';
import { DocumentPage } from './document-page';

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
        <DocumentPage
          key={index}
          document={document}
          nodes={nodes}
          analysis={analysis}
          locale={locale}
          index={index}
          count={pages.length}
          resolveImageUrl={resolveImageUrl}
        />
      ))}
    </div>
  );
}
