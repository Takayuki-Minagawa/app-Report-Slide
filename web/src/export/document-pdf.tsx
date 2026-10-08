import { renderToStaticMarkup } from 'react-dom/server.browser';
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';
import documentStyles from '@/components/preview/document.css?raw';
import { DocumentPage } from '@/components/preview/document-page';
import {
  documentTitle,
  type DocumentData,
  type DocumentNode,
} from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { migrateDocumentData } from '@/src/document/validation';
import type { AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { offlineMathStyles } from './math-styles';
import { prepareOfficeImages } from './office-images';

const pixelsPerMillimetre = 96 / 25.4;
const maximumCanvasPixels = 8 * 1024 * 1024;

const copy = {
  ja: {
    raster: 'PDFは表示を画像として保存します。文字の選択・検索はできません。',
    split:
      '用紙の高さを超えたReportを複数ページに分割しました。段落・表の分割位置をPDFで確認してください。',
    overflow:
      'スライドの表示範囲を超えた内容があるためPDFを出力できません。スライドを分割するか文字・画像を小さくして再実行してください。',
    clipped:
      '表・数式・コードなどに表示範囲を超えた内容があるためPDFを出力できません。幅や文字サイズを小さくするか内容を分割して再実行してください。',
    failure:
      'PDFを生成できませんでした。画像や文書の長さを確認し、ブラウザで再実行してください。',
  },
  en: {
    raster:
      'The PDF stores the rendered pages as images. Text cannot be selected or searched.',
    split:
      'Report content exceeded the paper height and was split across pages. Check paragraph and table splits in the PDF.',
    overflow:
      'Some slide content extends beyond the visible slide. Split the slide or reduce its text and images before exporting the PDF.',
    clipped:
      'A table, equation, code block or other content exceeds its visible area. Reduce its width or font size, or split the content before exporting the PDF.',
    failure:
      'Could not generate the PDF. Check the images and document length, then try again in the browser.',
  },
};

class PdfExportError extends Error {}

function withoutNotes(nodes: DocumentNode[]): DocumentNode[] {
  return nodes
    .filter((node) => node.type !== 'speakerNotes')
    .map((node) => {
      if ('content' in node && node.content)
        return {
          ...node,
          content: node.content
            .filter((child) => child.type !== 'speakerNotes')
            .map((child) =>
              'content' in child
                ? withoutNotes([child as DocumentNode])[0]
                : child,
            ),
        } as DocumentNode;
      return node;
    });
}

function frameStyles(width: number, height: number, slide: boolean): string {
  return `:root{--border:#bdc8d1;--muted-foreground:#596b7b;--font-ui:Arial,'Noto Sans JP','Yu Gothic',Meiryo,sans-serif;--font-code:Consolas,monospace;color-scheme:light;font-size:16px}
*,*::before,*::after{box-sizing:border-box}body{margin:0;background:white;color:#1f2f3e;font-family:var(--font-ui)}
h1,h2,h3,h4,h5,h6,p,figure,blockquote,pre,ol,ul{margin:0}ol,ul{padding:0}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}pre,code{font-size:1em}a{color:inherit;text-decoration:inherit}img{max-width:100%}table{border-collapse:collapse}
${documentStyles}
${offlineMathStyles}
#pdf-viewport{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:white}
#pdf-content{position:relative;width:${width}px;transform-origin:top left}
.report-sheet{width:${width}px!important;min-height:${height}px}
.report-sheet .report-layout{min-height:${height}px;box-shadow:none}
.slide-preview{width:${width}px!important;height:${height}px;aspect-ratio:16 / 9;box-shadow:none;overflow:hidden}
${slide ? '' : '.report-preview{overflow:visible}'}
`;
}

async function waitForImages(document: Document): Promise<void> {
  for (const image of document.images) {
    if (image.complete) {
      if (image.naturalWidth === 0) throw new Error('Image failed to render');
    } else {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => finish(new Error('Image load timed out')),
          15000,
        );
        const finish = (error?: Error) => {
          clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          if (error) reject(error);
          else resolve();
        };
        image.onload = () => finish();
        image.onerror = () => finish(new Error('Image failed to render'));
      });
    }
  }
  await document.fonts?.ready;
}

function hasClippedContent(article: HTMLElement): boolean {
  const view = article.ownerDocument.defaultView;
  if (!view) return false;
  return [...article.querySelectorAll<HTMLElement>('*')].some((element) => {
    // KaTeX intentionally hides its parallel accessibility representation.
    // The visible .katex-html branch is still checked for actual clipping.
    if (element.closest('.katex-mathml')) return false;
    if (element.clientWidth === 0 && element.clientHeight === 0) return false;
    const style = view.getComputedStyle(element);
    const clips = (value: string) =>
      /^(?:auto|scroll|hidden|clip)$/.test(value);
    return (
      (element.clientWidth > 0 &&
        clips(style.overflowX || style.overflow) &&
        element.scrollWidth > element.clientWidth + 2) ||
      (element.clientHeight > 0 &&
        clips(style.overflowY || style.overflow) &&
        element.scrollHeight > element.clientHeight + 2)
    );
  });
}

/** Rasterize one physical page at a time, so a long report never creates a tall canvas. */
export async function exportDocumentPdf(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ blob: Blob; warnings: string[] }> {
  const migrated = migrateDocumentData(source);
  const document = { ...migrated, children: withoutNotes(migrated.children) };
  const { images } = await prepareOfficeImages(document, assets, locale);
  const resolveImageUrl = (src: string) => images.get(src)?.dataUrl ?? src;
  const slide = document.type === 'slide';
  const [pageWidth, pageHeight] = slide
    ? [254, 142.875]
    : pageDimensions(resolvePageSettings(document.metadata));
  const width = slide ? 960 : pageWidth * pixelsPerMillimetre;
  const height = slide ? 540 : pageHeight * pixelsPerMillimetre;
  const pages = splitDocumentPages(document);
  const analysis = analyzeDocument(document);
  const warnings = [copy[locale].raster];
  const iframe = globalThis.document.createElement('iframe');
  iframe.dataset.kumiPdf = '';
  iframe.title =
    locale === 'ja' ? 'PDF出力用のプレビュー' : 'PDF export preview';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none;`;
  globalThis.document.body.appendChild(iframe);
  try {
    const frame = iframe.contentDocument;
    if (!frame) throw new Error('Could not create export document');
    frame.documentElement.lang = locale;
    const policy = frame.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content =
      "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
    frame.head.appendChild(policy);
    const styles = frame.createElement('style');
    styles.textContent = frameStyles(width, height, slide);
    frame.head.appendChild(styles);
    frame.body.innerHTML =
      '<div id="pdf-viewport"><div id="pdf-content"></div></div>';
    const viewport = frame.getElementById('pdf-viewport')!;
    const content = frame.getElementById('pdf-content')!;
    const pdf = new jsPDF({
      orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [pageWidth, pageHeight],
      compress: true,
    });
    pdf.setProperties({
      title: documentTitle(document),
      author: String(document.metadata.author ?? ''),
      creator: 'Kumi Markdown Studio',
    });
    let outputPages = 0;
    for (const [index, nodes] of pages.entries()) {
      content.style.transform = '';
      content.innerHTML = renderToStaticMarkup(
        <DocumentPage
          document={document}
          nodes={nodes}
          analysis={analysis}
          locale={locale}
          index={index}
          count={pages.length}
          resolveImageUrl={resolveImageUrl}
        />,
      );
      await waitForImages(frame);
      const article = content.querySelector<HTMLElement>('article')!;
      const naturalHeight = Math.max(
        content.scrollHeight,
        content.getBoundingClientRect().height,
        height,
      );
      // Fractional CSS pixels can otherwise create a nearly empty extra page.
      const slices = slide
        ? 1
        : Math.max(1, Math.ceil((naturalHeight - 1) / height));
      if (slices > 1 && !warnings.includes(copy[locale].split))
        warnings.push(copy[locale].split);
      if (
        slide &&
        (article.scrollHeight > height + 2 || article.scrollWidth > width + 2)
      )
        throw new PdfExportError(copy[locale].overflow);
      if (
        (!slide && article.scrollWidth > width + 2) ||
        hasClippedContent(article)
      )
        throw new PdfExportError(copy[locale].clipped);
      for (let slice = 0; slice < slices; slice++) {
        content.style.transform = `translateY(${-slice * height}px)`;
        const canvas = await toCanvas(viewport, {
          width,
          height,
          pixelRatio: Math.min(
            2,
            Math.sqrt(maximumCanvasPixels / (width * height)),
          ),
          backgroundColor: '#ffffff',
          // All fonts and images are already inline. Avoid external font discovery.
          fontEmbedCSS: offlineMathStyles,
          cacheBust: false,
        });
        try {
          if (outputPages > 0)
            pdf.addPage(
              [pageWidth, pageHeight],
              pageWidth > pageHeight ? 'landscape' : 'portrait',
            );
          pdf.addImage(
            canvas,
            'PNG',
            0,
            0,
            pageWidth,
            pageHeight,
            undefined,
            'FAST',
          );
          outputPages++;
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    }
    return { blob: pdf.output('blob'), warnings };
  } catch (error) {
    if (error instanceof PdfExportError) throw error;
    throw new Error(copy[locale].failure, { cause: error });
  } finally {
    iframe.remove();
  }
}
