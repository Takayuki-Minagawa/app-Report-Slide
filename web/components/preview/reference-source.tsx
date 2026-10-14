import type { FigureReference } from '@/src/document/figure-edit';
import type { AppLocale } from '@/src/i18n/messages';
import { safeResourceUrl } from '@/src/security/resource-url';

export function ReferenceSource({
  reference,
  locale = 'ja',
  sourceText,
}: {
  reference?: FigureReference;
  locale?: AppLocale;
  sourceText?: string;
}) {
  const text =
    sourceText ||
    (reference
      ? [reference.authors, reference.year, reference.title || reference.id]
          .filter(Boolean)
          .join(' · ')
      : '');
  if (!text) return null;
  const url = safeResourceUrl(reference?.url ?? '', 'link');
  const pdfUrl = safeResourceUrl(reference?.pdfUrl ?? '', 'link');
  const ja = locale === 'ja';
  return (
    <div className="figure-source" style={{ display: 'block' }}>
      <small>
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {text}
          </a>
        ) : (
          text
        )}
      </small>
      {reference && (reference.summary || pdfUrl) && (
        <details className="figure-reference-details">
          <summary data-reader-reference="">
            {ja ? '文献の要点・PDF' : 'Reference summary / PDF'}
          </summary>
          <article className="figure-reference-content">
            <h3>{reference.title || reference.id}</h3>
            <p>
              {[reference.authors, reference.year].filter(Boolean).join(' · ')}
            </p>
            {reference.summary && (
              <p style={{ whiteSpace: 'pre-wrap' }}>{reference.summary}</p>
            )}
            {url && (
              <p>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {ja ? '文献のページを開く' : 'Open reference page'}
                </a>
              </p>
            )}
            {pdfUrl && (
              <p>
                <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                  {ja ? 'PDFを開く' : 'Open PDF'}
                </a>
              </p>
            )}
          </article>
        </details>
      )}
    </div>
  );
}
