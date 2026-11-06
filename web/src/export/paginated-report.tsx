/* oxlint-disable nextjs/no-head-element -- Standalone report with an offline pagination runtime. */
import { renderToStaticMarkup } from 'react-dom/server.browser';
import pagedSource from 'pagedjs/dist/paged.js?raw';
import pagedLicense from 'pagedjs/LICENSE.md?raw';
import katexLicense from 'katex/LICENSE?raw';
import documentStyles from '@/components/preview/document.css?raw';
import { DocumentPage } from '@/components/preview/document-page';
import { documentTitle, type DocumentData } from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import { analyzeDocument } from '@/src/document/semantics';
import {
  splitRenderedPages,
  frontMatterPageCount,
} from '@/src/document/report-pages';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { embedSlideImages } from './embedded-images';
import { editableHtmlId, editableHtmlPayload } from './editable-html';
import { hashedInlineScript } from './standalone-html';
import { offlineMathStyles } from './math-styles';
import { offlinePrintFonts } from './print-fonts';
import { ReaderDetails, ReaderDialog } from './reader-content';
import readerStyles from './reader.css?raw';
import readerSource from './reader.js?raw';
import paginationRuntime from './report-pagination-runtime.js?raw';

/** One browser layout is shared by the preview, standalone HTML, print and raster PDF. */
export async function exportPaginatedReportHtml(
  document: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ html: string; externalImages: string[] }> {
  if (typeof pagedSource !== 'string')
    throw new Error('The report pagination runtime could not be loaded.');
  const settings = resolvePageSettings(document.metadata);
  const [width, height] = pageDimensions(settings);
  const { resolveImageUrl, external } = await embedSlideImages(
    document,
    assets,
  );
  const pages = splitRenderedPages(document);
  const analysis = analyzeDocument(document);
  const ja = locale === 'ja';
  const css = `
:root{color-scheme:light;--border:#bdc8d1;--muted-foreground:#596b7b;--font-ui:'Noto Sans JP',sans-serif;--font-code:monospace}
*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#e8edf2;color:#1f2f3e;font-family:var(--font-ui)}
h1,h2,h3,h4,h5,h6,p,figure,blockquote,pre,ol,ul{margin:0}ol,ul{padding:0}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit}img{max-width:100%}table{border-collapse:collapse}
${offlinePrintFonts}
${offlineMathStyles}
${documentStyles}
@page{size:${width}mm ${height}mm;margin:${settings.margin_top}mm ${settings.margin_right}mm ${settings.margin_bottom}mm ${settings.margin_left}mm}
.report-sheet{width:100%;min-width:0;min-height:1px;container-type:normal;
--report-width:${width}mm!important;--report-height:${height}mm!important;
--report-top:${settings.margin_top}mm!important;--report-bottom:${settings.margin_bottom}mm!important;
--report-left:${settings.margin_left}mm!important;--report-right:${settings.margin_right}mm!important;
--report-font-size:${settings.font_size}pt!important;--report-paragraph-spacing:${settings.paragraph_spacing}pt!important}
.report-sheet+.report-sheet{break-before:page}
.report-sheet .report-layout{width:100%;min-height:1px;padding:0;box-shadow:none;background:white}
.report-layout>footer{display:none}
.report-cover{min-height:${height - settings.margin_top - settings.margin_bottom - 1}mm;break-inside:avoid}
.document-renderer h1,.document-renderer h2,.document-renderer h3,.document-renderer h4,.document-renderer h5,.document-renderer h6{break-after:avoid}
.document-renderer p{orphans:2;widows:2}
.document-renderer figure,.equation-body,.document-toc li{break-inside:avoid}
.report-layout .preview-table-wrap{overflow:visible}thead{display:table-header-group;break-inside:avoid}tr{break-inside:avoid}
.document-toc a{display:flex;align-items:baseline;gap:.5em;text-decoration:none}
.kumi-toc-title{min-width:0}.kumi-toc-leader{flex:1;min-width:1em;border-bottom:1px dotted #a8b4be}
.kumi-toc-page{flex:0 0 4em;width:4em;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.kumi-physical-footer{position:absolute;bottom:${Math.max(1, settings.margin_bottom / 2 - 1.5)}mm;right:${settings.margin_right}mm;font:9pt 'Noto Serif JP',serif;line-height:1}
`;
  const screenCss = `
${readerStyles}
.report-tools{position:sticky;top:0;z-index:100;padding:12px 20px;background:#21354b;color:white;font:14px 'Noto Sans JP',sans-serif;display:flex;align-items:center;gap:16px}
.report-tools h1{font-size:16px}.report-tools button{padding:6px 12px;cursor:pointer}
.pagination-status{padding:16px;font-family:'Noto Sans JP',sans-serif}
.pagedjs_pages{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px;min-width:${width}mm}
.pagedjs_page{background:white;flex-shrink:0;box-shadow:0 2px 12px #24374833}
.reader-details{padding:16px}
@media print{body{background:white}.report-tools,.reader-details,.reader-zoom-button{display:none!important}.pagedjs_pages{display:block;padding:0;min-width:0}.pagedjs_page{margin:0;box-shadow:none;break-after:page}.pagedjs_page:last-child{break-after:auto}html:not([data-kumi-pagination=ready]) .report-pages{display:none}.pagination-status{color:black}}
`;
  const source = `${pagedSource}\n${paginationRuntime}\nwindow.kumiPaginationReady.then(() => {\n${readerSource}\n}).catch(() => {});`;
  const { script, policy } = await hashedInlineScript(
    source.replace(/<\/script/gi, '<\\/script'),
  );
  const html =
    '<!doctype html>\n' +
    renderToStaticMarkup(
      <html lang={locale} data-kumi-pagination="pending">
        <head>
          <meta charSet="utf-8" />
          <meta httpEquiv="Content-Security-Policy" content={policy} />
          <meta name="referrer" content="no-referrer" />
          <title>{documentTitle(document)}</title>
          <style
            id="kumi-pagination-css"
            dangerouslySetInnerHTML={{ __html: css }}
          />
          <style
            data-pagedjs-ignore
            dangerouslySetInnerHTML={{ __html: screenCss }}
          />
        </head>
        <body>
          <header className="report-tools">
            <h1>{documentTitle(document)}</h1>
            <button id="print-report" type="button" disabled>
              {ja ? '印刷／PDF保存' : 'Print / Save PDF'}
            </button>
            <span id="physical-page-count" />
          </header>
          <output id="pagination-status" className="pagination-status">
            {ja
              ? '用紙に合わせて改ページと目次を計算しています…'
              : 'Laying out pages and contents…'}
          </output>
          <template id="kumi-pagination-source">
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
          </template>
          <main id="kumi-pagination-output" className="report-pages" />
          <aside className="reader-details">
            {pages.slice(frontMatterPageCount(document)).map((_, index) => (
              <ReaderDetails
                key={index}
                document={document}
                index={index}
                locale={locale}
              />
            ))}
          </aside>
          <ReaderDialog locale={locale} />
          <template id={editableHtmlId} data-encoding="base64">
            {editableHtmlPayload(document, resolveImageUrl)}
          </template>
          <template id="pagedjs-license">
            <pre>{pagedLicense}</pre>
          </template>
          <template id="katex-license">
            <pre>{katexLicense}</pre>
          </template>
          <script dangerouslySetInnerHTML={{ __html: script }} />
        </body>
      </html>,
    );
  return { html, externalImages: external };
}
