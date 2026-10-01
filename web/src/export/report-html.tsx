/* oxlint-disable nextjs/no-head-element -- Standalone HTML output. */
import { renderToStaticMarkup } from 'react-dom/server.browser';
import katexLicense from 'katex/LICENSE?raw';
import documentStyles from '@/components/preview/document.css?raw';
import { DocumentPage } from '@/components/preview/document-page';
import { documentTitle, type DocumentData } from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { migrateDocumentData } from '@/src/document/validation';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { embedSlideImages } from './embedded-images';
import { offlineMathStyles } from './math-styles';
import { hashedInlineScript } from './standalone-html';

const reportScript = `const pages = [...document.querySelectorAll('.report-sheet')];
const warning = document.getElementById('overflow-warning');
const updateWarning = () => {
  const overflowing = pages.some(page => page.getBoundingClientRect().height > parseFloat(getComputedStyle(page).minHeight) + 2);
  if (warning) warning.hidden = !overflowing;
};
window.addEventListener('load', updateWarning);
document.fonts?.ready.then(updateWarning);
if ('ResizeObserver' in window) {
  const observer = new ResizeObserver(updateWarning);
  pages.forEach(page => observer.observe(page));
}
updateWarning();
document.getElementById('print-report')?.addEventListener('click', () => window.print());`;

const reportMessages = {
  ja: {
    print: '印刷／PDF保存',
    overflow:
      '内容が用紙の高さを超えています。印刷プレビューで自動改ページを確認してください。',
  },
  en: {
    print: 'Print / Save PDF',
    overflow:
      'Content exceeds a sheet. Check automatic pagination in print preview.',
  },
};

export async function exportReportHtml(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ html: string; externalImages: string[] }> {
  const document = migrateDocumentData(source);
  if (document.type !== 'report') throw new Error('Report document required');
  const { resolveImageUrl, external } = await embedSlideImages(
    document,
    assets,
  );
  const analysis = analyzeDocument(document);
  const pages = splitDocumentPages(document);
  const settings = resolvePageSettings(document.metadata);
  const [width, height] = pageDimensions(settings);
  const { script, policy } = await hashedInlineScript(reportScript);
  const copy = reportMessages[locale];
  const style =
    `:root{--border:#bdc8d1;--muted-foreground:#596b7b;--font-ui:Arial,sans-serif;--font-code:monospace;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:#e8edf2;color:#1f2f3e;font-family:Arial,sans-serif}
button{font:inherit;cursor:pointer}.report-tools{position:sticky;top:0;z-index:2;padding:12px 20px;background:#21354b;color:white;display:flex;align-items:center;gap:20px}
.report-tools button{padding:6px 12px}.report-tools h1{font-size:16px;margin:0}.report-tools p{font-size:12px;margin:0}
.report-pages{display:grid;justify-items:center;gap:24px;padding:24px}.report-sheet{width:${width}mm;min-height:${height}mm;background:white}
.report-sheet .report-layout{min-height:${height}mm}.report-sheet .report-preview{box-shadow:none}
@page{size:${width}mm ${height}mm;margin:0}
@media print{body{background:white}.report-tools{display:none}.report-pages{display:block;padding:0}.report-sheet{width:${width}mm;min-height:${height}mm;break-after:page;page-break-after:always}.report-sheet:last-child{break-after:auto;page-break-after:auto}.report-sheet .report-layout{min-height:${height}mm}.document-renderer figure,.document-renderer table{break-inside:avoid}}
` +
    documentStyles +
    '\n' +
    offlineMathStyles;
  const markup = renderToStaticMarkup(
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="Content-Security-Policy" content={policy} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <title>{documentTitle(document)}</title>
        <style dangerouslySetInnerHTML={{ __html: style }} />
      </head>
      <body>
        <header className="report-tools">
          <h1>{documentTitle(document)}</h1>
          <button type="button" id="print-report">
            {copy.print}
          </button>
          <p id="overflow-warning" hidden>
            {copy.overflow}
          </p>
        </header>
        <main className="report-pages">
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
        </main>
        <template id="katex-license">
          <pre>{katexLicense}</pre>
        </template>
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>,
  );
  return { html: '<!doctype html>\n' + markup, externalImages: external };
}
