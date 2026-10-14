import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';
import type { PageText, PositionedText } from './text-table';

declare const __KUMI_PDF_ASSET_BASE__: string;

export const maximumPdfBytes = 20 * 1024 * 1024;
export const maximumPdfPixels = 8_000_000;
export const maximumPdfSide = 4096;
export const maximumPdfPages = 5000;

export class PdfPasswordError extends Error {
  readonly reason: 'required' | 'incorrect';

  constructor(reason: 'required' | 'incorrect') {
    super(
      reason === 'required'
        ? 'PDFのパスワードを入力してください。'
        : 'PDFのパスワードが正しくありません。',
    );
    this.name = 'PdfPasswordError';
    this.reason = reason;
  }
}

export interface PdfPageImage {
  blob: Blob;
  width: number;
  height: number;
  actualDpi: number;
}

export interface OpenPdf {
  pageCount: number;
  renderPage(page: number, dpi: number): Promise<PdfPageImage>;
  extractPageText(page: number): Promise<PageText>;
  destroy(): Promise<void>;
}

/** PDF viewport dimensions at scale 1 are points (72 per inch), including page rotation. */
export function pdfRasterSize(width: number, height: number, dpi: number) {
  if (
    ![width, height, dpi, width * height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('PDFページの大きさと解像度を確認してください。');
  const scale = Math.min(
    dpi / 72,
    maximumPdfSide / Math.max(width, height),
    Math.sqrt(maximumPdfPixels / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
    actualDpi: scale * 72,
  };
}

function abortError() {
  return new DOMException('PDFの読み込みを終了しました。', 'AbortError');
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('PDFページを画像に変換できませんでした。')),
      'image/png',
    ),
  );
}

/** Local bytes only. The display API never instantiates PDF.js's scripting sandbox or viewer. */
export async function openPdf(file: Blob, password?: string): Promise<OpenPdf> {
  if (file.size > maximumPdfBytes)
    throw new Error('PDFは20 MB以内のファイルを選択してください。');
  if (!file.size) throw new Error('PDFファイルが空です。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (
    !new TextDecoder('latin1').decode(bytes.subarray(0, 5)).startsWith('%PDF-')
  )
    throw new Error('PDF形式のファイルを選択してください。');
  // Import only when the picker is used: DOM/Worker APIs must never run during SSR.
  const pdfjs = await import('pdfjs-dist');
  const base = new URL(__KUMI_PDF_ASSET_BASE__, window.location.href).href;
  pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
  const loading = pdfjs.getDocument({
    data: bytes,
    password,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
    enableXfa: false,
    stopAtErrors: true,
    canvasMaxAreaInBytes: maximumPdfPixels * 4,
  });
  let document;
  try {
    document = await loading.promise;
  } catch (error) {
    await loading.destroy().catch(() => undefined);
    if (error instanceof Error && error.name === 'PasswordException') {
      const code = (error as Error & { code?: number }).code;
      throw new PdfPasswordError(
        code === pdfjs.PasswordResponses.INCORRECT_PASSWORD
          ? 'incorrect'
          : 'required',
      );
    }
    throw new Error(
      'PDFを開けませんでした。ファイルが破損していないか確認してください。',
      { cause: error },
    );
  }
  if (
    !Number.isInteger(document.numPages) ||
    document.numPages < 1 ||
    document.numPages > maximumPdfPages
  ) {
    await loading.destroy();
    throw new Error('PDFは5,000ページ以内のファイルを選択してください。');
  }
  let destroyed = false;
  let activeRender: RenderTask | undefined;
  let queue = Promise.resolve();
  let destruction: Promise<void> | undefined;

  const render = async (
    pageNumber: number,
    dpi: number,
  ): Promise<PdfPageImage> => {
    if (destroyed) throw abortError();
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    )
      throw new Error(`PDFページは1〜${document.numPages}で指定してください。`);
    let page: PDFPageProxy | undefined;
    let canvas: HTMLCanvasElement | undefined;
    try {
      page = await document.getPage(pageNumber);
      if (destroyed) throw abortError();
      const original = page.getViewport({ scale: 1 });
      const dimensions = pdfRasterSize(original.width, original.height, dpi);
      canvas = window.document.createElement('canvas');
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      activeRender = page.render({
        canvas,
        viewport: page.getViewport({ scale: dimensions.scale }),
        background: '#ffffff',
      });
      await activeRender.promise;
      if (destroyed) throw abortError();
      const blob = await canvasPng(canvas);
      if (destroyed) throw abortError();
      return {
        blob,
        width: dimensions.width,
        height: dimensions.height,
        actualDpi: dimensions.actualDpi,
      };
    } finally {
      activeRender = undefined;
      page?.cleanup();
      if (canvas) canvas.width = canvas.height = 0;
    }
  };
  const extract = async (pageNumber: number): Promise<PageText> => {
    if (destroyed) throw abortError();
    if (
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    )
      throw new Error(`PDFページは1〜${document.numPages}で指定してください。`);
    let page: PDFPageProxy | undefined;
    try {
      page = await document.getPage(pageNumber);
      if (destroyed) throw abortError();
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      if (destroyed) throw abortError();
      if (content.items.length > 20_000)
        throw new Error(
          'このページには文字が多すぎます。別のページを選択してください。',
        );
      const words: PositionedText[] = [];
      const warnings: string[] = [];
      let rotated = false;
      let characters = 0;
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        characters += item.str.length;
        if (characters > 200_000)
          throw new Error('このPDFページの文字数が上限を超えています。');
        const [a, b, c, d, e, f] = viewport.transform;
        const [g, h, i, j, k, l] = item.transform as number[];
        const tx = [
          a * g + c * h,
          b * g + d * h,
          a * i + c * j,
          b * i + d * j,
          a * k + c * l + e,
          b * k + d * l + f,
        ];
        const horizontal = Math.hypot(tx[0], tx[1]);
        const fontHeight = Math.hypot(tx[2], tx[3]);
        if (!horizontal || !fontHeight || !tx.every(Number.isFinite)) continue;
        const style = content.styles[item.fontName];
        const ascent = Number.isFinite(style?.ascent) ? style.ascent : 0.8;
        const descent = Number.isFinite(style?.descent) ? style.descent : -0.2;
        // getTextContent uses PDF user-space units; viewport.transform also
        // incorporates a page's UserUnit. Scale advances just like positions.
        const width = item.width * Math.hypot(a, b);
        if (!(width > 0) || !Number.isFinite(width)) continue;
        const right = { x: tx[0] / horizontal, y: tx[1] / horizontal };
        const up = { x: tx[2] / fontHeight, y: tx[3] / fontHeight };
        if (Math.abs(right.y) > 0.15 || style?.vertical || item.dir === 'ttb')
          rotated = true;
        const points = [0, width].flatMap((offset) =>
          [descent, ascent].map((vertical) => ({
            x: tx[4] + right.x * offset + up.x * fontHeight * vertical,
            y: tx[5] + right.y * offset + up.y * fontHeight * vertical,
          })),
        );
        const bbox = {
          x0: Math.min(...points.map((point) => point.x)),
          y0: Math.min(...points.map((point) => point.y)),
          x1: Math.max(...points.map((point) => point.x)),
          y1: Math.max(...points.map((point) => point.y)),
        };
        // Some PDFs store several columns in one run separated by repeated
        // spaces. Retain the string, using proportional positions only here.
        const matches = [...item.str.matchAll(/\S(?:.*?\S)?(?=\s{2,}|$)/g)];
        if (matches.length > 1 && !rotated) {
          for (const match of matches) {
            const start = match.index ?? 0;
            words.push({
              text: match[0],
              bbox: {
                ...bbox,
                x0: bbox.x0 + (start / item.str.length) * (bbox.x1 - bbox.x0),
                x1:
                  bbox.x0 +
                  ((start + match[0].length) / item.str.length) *
                    (bbox.x1 - bbox.x0),
              },
            });
          }
        } else words.push({ text: item.str, bbox });
      }
      if (rotated)
        warnings.push(
          '縦書き・回転した文字があります。読み順と表の列を確認してください。',
        );
      return {
        width: viewport.width,
        height: viewport.height,
        words,
        warnings,
      };
    } finally {
      page?.cleanup();
    }
  };
  return {
    pageCount: document.numPages,
    renderPage(page, dpi) {
      const result = queue.then(() => render(page, dpi));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    extractPageText(page) {
      const result = queue.then(() => extract(page));
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    destroy() {
      if (!destruction) {
        destroyed = true;
        activeRender?.cancel();
        destruction = loading.destroy().finally(() => queue);
      }
      return destruction;
    },
  };
}
