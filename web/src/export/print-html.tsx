/* oxlint-disable nextjs/no-head-element -- Standalone print document. */
import { renderToStaticMarkup } from 'react-dom/server.browser';
import { DocumentPage } from '@/components/preview/document-page';
import documentStyles from '@/components/preview/document.css?raw';
import { documentTitle, type DocumentData } from '@/src/document/model';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import { walkDocumentTree } from '@/src/document/traversal';
import { migrateDocumentData } from '@/src/document/validation';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { embedSlideImages } from './embedded-images';
import { offlineMathStyles } from './math-styles';
import { offlinePrintFonts } from './print-fonts';

export interface PrintSnapshot {
  html: string;
  pageCount: number;
  rasterElements: string[];
  externalImages: string[];
}

/** Native text, KaTeX and SVG reach the browser print engine without canvas rasterization. */
export async function exportPrintHtml(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<PrintSnapshot> {
  const document = migrateDocumentData(source);
  const pages = splitDocumentPages(document);
  const slide = document.type === 'slide';
  const [width, height] = slide
    ? [320, 180]
    : pageDimensions(resolvePageSettings(document.metadata));
  const analysis = analyzeDocument(document);
  const { resolveImageUrl, external } = await embedSlideImages(
    document,
    assets,
  );
  const rasterElements = [...walkDocumentTree(document.children)].flatMap(
    (node) => {
      if (node.type !== 'figure' && node.type !== 'inlineImage') return [];
      if (
        node.type === 'figure' &&
        (node.attrs.figureEdit?.diagram || node.attrs.figureEdit?.svgSource)
      )
        return [];
      if (
        /^(?:data:image\/svg\+xml)|\.svg(?:[?#]|$)/i.test(
          resolveImageUrl(node.attrs.src),
        )
      )
        return [];
      return [node.attrs.alt || node.attrs.nodeId];
    },
  );
  const style = `:root{color-scheme:light;--font-ui:Arial,'Noto Sans JP','Yu Gothic',Meiryo,sans-serif;--font-code:monospace;--border:#bdc8d1;--muted-foreground:#596b7b}*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:var(--font-ui);background:#e8edf2}h1,h2,h3,h4,h5,h6,p,figure,blockquote,pre,ol,ul{margin:0}ol,ul{padding:0}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit}img{max-width:100%}table{border-collapse:collapse}
${documentStyles}\n${offlineMathStyles}\n${offlinePrintFonts}
.print-page{width:${width}mm;min-height:${height}mm;margin:20px auto;background:white}.print-page>.slide-preview{width:${width}mm;height:${height}mm;overflow:hidden;box-shadow:none}.print-page>.report-sheet{width:${width}mm;max-width:none}.print-page .report-preview{box-shadow:none}.print-page .report-layout{min-height:${height}mm}.report-layout .preview-table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}.document-renderer figure{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:${width}mm ${height}mm;margin:0}
@media print{body{background:white}.print-page{margin:0;break-after:page;page-break-after:always}.print-page:last-child{break-after:auto;page-break-after:auto}.print-page>.slide-preview{overflow:hidden}.print-page .report-layout{--report-height:${height}mm}}
`;
  const html =
    '<!doctype html>\n' +
    renderToStaticMarkup(
      <html lang={locale}>
        <head>
          <meta charSet="utf-8" />
          <meta name="referrer" content="no-referrer" />
          <meta
            httpEquiv="Content-Security-Policy"
            content="default-src 'none'; img-src data: https: http:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"
          />
          <title>{documentTitle(document)}</title>
          <style dangerouslySetInnerHTML={{ __html: style }} />
        </head>
        <body>
          <main>
            {pages.map((nodes, index) => (
              <section
                className="print-page"
                key={index}
                data-print-page={index + 1}
              >
                <DocumentPage
                  document={document}
                  nodes={nodes}
                  analysis={analysis}
                  locale={locale}
                  index={index}
                  count={pages.length}
                  resolveImageUrl={resolveImageUrl}
                />
              </section>
            ))}
          </main>
        </body>
      </html>,
    );
  // Promote only complete leading header groups; never cut a rowspan at the boundary.
  const printable = new DOMParser().parseFromString(html, 'text/html');
  for (const body of printable.querySelectorAll<HTMLTableSectionElement>(
    slide ? ':not(*)' : 'table > tbody',
  )) {
    const headers: HTMLTableRowElement[] = [];
    for (const row of body.rows) {
      if (
        !row.cells.length ||
        [...row.cells].some((cell) => cell.tagName !== 'TH')
      )
        break;
      headers.push(row);
    }
    if (
      !headers.length ||
      headers.some((row, index) =>
        [...row.cells].some((cell) => index + cell.rowSpan > headers.length),
      )
    )
      continue;
    const head = printable.createElement('thead');
    body.parentNode!.insertBefore(head, body);
    headers.forEach((row) => head.appendChild(row));
  }
  return {
    html: '<!doctype html>\n' + printable.documentElement.outerHTML,
    pageCount: pages.length,
    rasterElements,
    externalImages: external,
  };
}
