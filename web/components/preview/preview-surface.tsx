import type { DocumentData } from '@/src/document/model';

import { DocumentRenderer } from './document-renderer';

const reportThemes = new Set(['latex', 'calculation']);
const slideThemes = new Set(['beamer-simple', 'technical']);

function resolvedTheme(document: DocumentData): string {
  const requested =
    typeof document.metadata.theme === 'string' ? document.metadata.theme : '';
  if (document.type === 'report') {
    return reportThemes.has(requested) ? requested : 'latex';
  }
  return slideThemes.has(requested) ? requested : 'beamer-simple';
}

export function PreviewSurface({
  document,
  resolveImageUrl,
}: {
  document: DocumentData;
  resolveImageUrl?: (source: string) => string;
}) {
  const theme = resolvedTheme(document);

  if (document.type === 'slide') {
    return (
      <div
        className="slide-preview"
        data-theme={theme}
        aria-label="スライドプレビュー"
      >
        <DocumentRenderer
          document={document}
          resolveImageUrl={resolveImageUrl}
        />
        <footer>
          <span>{document.metadata.author ?? ''}</span>
          <span>1</span>
        </footer>
      </div>
    );
  }

  return (
    <article
      className="report-preview"
      data-theme={theme}
      aria-label="A4レポートプレビュー"
    >
      <DocumentRenderer document={document} resolveImageUrl={resolveImageUrl} />
      <footer>1</footer>
    </article>
  );
}
