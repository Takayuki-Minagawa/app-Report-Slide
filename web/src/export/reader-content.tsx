import type { DocumentData } from '@/src/document/model';
import { readerSupplementForPage } from '@/src/document/reader-supplement';
import type { AppLocale } from '@/src/i18n/messages';
export function ReaderDetails({
  document,
  index,
  locale,
}: {
  document: DocumentData;
  index: number;
  locale: AppLocale;
}) {
  const entry = readerSupplementForPage(document, index);
  if (!entry) return null;
  const id = `reader-details-${index + 1}`;
  return (
    <>
      <button
        type="button"
        className="reader-detail-launcher"
        data-reader-page={index}
        data-reader-template={id}
      >
        {locale === 'ja' ? '詳しい説明' : 'Details'}
      </button>
      <template id={id}>
        <article className="reader-supplement">
          {[entry, ...(entry.sections ?? [])]
            .filter((section) => section.title || section.text || section.link)
            .map((section, sectionIndex) => (
              <section key={sectionIndex}>
                <h2>
                  {section.title ||
                    (locale === 'ja' ? '詳しい説明' : 'Details')}
                </h2>
                <p style={{ whiteSpace: 'pre-wrap' }}>{section.text}</p>
                {section.link && (
                  <a
                    href={section.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {locale === 'ja'
                      ? '文献・PDFを開く'
                      : 'Open reference / PDF'}
                  </a>
                )}
              </section>
            ))}
        </article>
      </template>
    </>
  );
}
export function ReaderDialog({ locale }: { locale: AppLocale }) {
  return (
    <dialog
      id="reader-dialog"
      aria-label={
        locale === 'ja' ? '図の拡大・詳しい説明' : 'Figure zoom and details'
      }
      data-zoom-label={locale === 'ja' ? '図を拡大' : 'Enlarge figure'}
    >
      <button type="button" id="reader-close">
        {locale === 'ja' ? '閉じる' : 'Close'}
      </button>
      <div id="reader-content" />
    </dialog>
  );
}
