import type { PDFPageProxy, RenderTask } from 'pdfjs-dist';

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
