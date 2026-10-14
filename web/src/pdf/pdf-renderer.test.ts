import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  maximumPdfBytes,
  maximumPdfPixels,
  maximumPdfSide,
  openPdf,
  PdfPasswordError,
  pdfRasterSize,
} from './pdf-renderer';

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: '' },
  PasswordResponses: { NEED_PASSWORD: 1, INCORRECT_PASSWORD: 2 },
}));
vi.mock('pdfjs-dist', () => pdfjs);

function inputPdf() {
  const data = new TextEncoder().encode('%PDF-1.7\nfixture');
  const file = new Blob([data], { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => data.buffer.slice(0),
  });
  return file;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mockDocument() {
  const render = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 612 * scale,
      height: 792 * scale,
      transform: [scale, 0, 0, -scale, 0, 792 * scale],
    })),
    getTextContent: vi.fn(async () => ({
      items: [
        {
          str: 'Measured value',
          width: 80,
          height: 12,
          transform: [12, 0, 0, 12, 36, 720],
          fontName: 'f1',
          dir: 'ltr',
        },
      ],
      styles: { f1: { ascent: 0.8, descent: -0.2, vertical: false } },
    })),
    render,
    cleanup: vi.fn(),
  };
  const pdf = { numPages: 2, getPage: vi.fn(async () => page) };
  const destroy = vi.fn(async () => undefined);
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy });
  return { pdf, page, render, destroy };
}

beforeEach(() => {
  pdfjs.getDocument.mockReset();
  vi.stubGlobal('__KUMI_PDF_ASSET_BASE__', '/app-Report-Slide/pdfjs/6.4.299/');
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (callback) {
      callback(new Blob(['pixels'], { type: 'image/png' }));
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF raster import', () => {
  it('keeps requested DPI for small pages and caps both image area and long side', () => {
    expect(pdfRasterSize(612, 792, 72)).toMatchObject({
      width: 612,
      height: 792,
      actualDpi: 72,
    });
    for (const dimensions of [
      [612, 792],
      [792, 612],
      [100, 10000],
    ]) {
      const raster = pdfRasterSize(dimensions[0], dimensions[1], 600);
      expect(raster.width * raster.height).toBeLessThanOrEqual(
        maximumPdfPixels,
      );
      expect(Math.max(raster.width, raster.height)).toBeLessThanOrEqual(
        maximumPdfSide,
      );
      expect(raster.actualDpi).toBeLessThan(600);
    }
    expect(() => pdfRasterSize(612, 792, Number.NaN)).toThrow();
    expect(() => pdfRasterSize(0, 792, 150)).toThrow();
    expect(() =>
      pdfRasterSize(Number.MAX_VALUE, Number.MAX_VALUE, 150),
    ).toThrow();
  });

  it('uses local bytes and matching local worker/font files, then releases page and canvas memory', async () => {
    const { pdf, page, destroy } = mockDocument();
    const create = vi.spyOn(document, 'createElement');
    const documentPdf = await openPdf(inputPdf());
    expect(documentPdf.pageCount).toBe(2);
    expect(pdfjs.getDocument.mock.calls[0][0]).toMatchObject({
      data: expect.any(Uint8Array),
      cMapUrl: 'http://localhost:3000/app-Report-Slide/pdfjs/6.4.299/cmaps/',
      standardFontDataUrl:
        'http://localhost:3000/app-Report-Slide/pdfjs/6.4.299/standard_fonts/',
      wasmUrl: 'http://localhost:3000/app-Report-Slide/pdfjs/6.4.299/wasm/',
      enableXfa: false,
    });
    expect(pdfjs.getDocument.mock.calls[0][0]).not.toHaveProperty('url');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(
      'http://localhost:3000/app-Report-Slide/pdfjs/6.4.299/pdf.worker.min.mjs',
    );
    const result = await documentPdf.renderPage(2, 72);
    expect(pdf.getPage).toHaveBeenCalledWith(2);
    expect(result).toMatchObject({ width: 612, height: 792, actualDpi: 72 });
    expect(result.blob.type).toBe('image/png');
    expect(page.cleanup).toHaveBeenCalledOnce();
    const canvas = create.mock.results.find(
      (value) => value.value instanceof HTMLCanvasElement,
    )!.value as HTMLCanvasElement;
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    await documentPdf.destroy();
    await documentPdf.destroy();
    expect(destroy).toHaveBeenCalledOnce();
    await expect(documentPdf.renderPage(1, 72)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it.each([1, 2])(
    'distinguishes password error %i and destroys the failed worker',
    async (code) => {
      const destroy = vi.fn(async () => undefined);
      pdfjs.getDocument.mockReturnValue({
        promise: Promise.reject(
          Object.assign(new Error('password'), {
            name: 'PasswordException',
            code,
          }),
        ),
        destroy,
      });
      const error = await openPdf(
        inputPdf(),
        code === 2 ? 'wrong' : undefined,
      ).catch((reason) => reason);
      expect(error).toBeInstanceOf(PdfPasswordError);
      expect(error.reason).toBe(code === 2 ? 'incorrect' : 'required');
      expect(destroy).toHaveBeenCalledOnce();
    },
  );

  it('rejects oversized input before parsing and invalid page requests before rendering', async () => {
    const large = inputPdf();
    Object.defineProperty(large, 'size', { value: maximumPdfBytes + 1 });
    await expect(openPdf(large)).rejects.toThrow('20 MB');
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    const { pdf } = mockDocument();
    const opened = await openPdf(inputPdf());
    await expect(opened.renderPage(3, 72)).rejects.toThrow('1〜2');
    expect(pdf.getPage).not.toHaveBeenCalled();
    await opened.destroy();
  });

  it('rejects a shifted PDF header and destroys documents with an excessive page count', async () => {
    const data = new TextEncoder().encode('leading bytes %PDF-1.7');
    const file = new Blob([data]);
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => data.buffer,
    });
    await expect(openPdf(file)).rejects.toThrow('PDF形式');
    expect(pdfjs.getDocument).not.toHaveBeenCalled();
    const { pdf, destroy } = mockDocument();
    pdf.numPages = 5001;
    await expect(openPdf(inputPdf())).rejects.toThrow('5,000ページ');
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('extracts text coordinates in the rotated viewport coordinate system and cleans up pages', async () => {
    const { page, pdf } = mockDocument();
    const opened = await openPdf(inputPdf());
    const text = await opened.extractPageText(1);
    expect(text).toMatchObject({ width: 612, height: 792, warnings: [] });
    expect(text.words).toEqual([
      { text: 'Measured value', bbox: { x0: 36, y0: 62.4, x1: 116, y1: 74.4 } },
    ]);
    expect(page.cleanup).toHaveBeenCalledOnce();
    await expect(opened.extractPageText(0)).rejects.toThrow('1〜2');
    expect(pdf.getPage).toHaveBeenCalledOnce();
    await opened.destroy();
    await expect(opened.extractPageText(1)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('scales text advances along with origins and font height for PDF UserUnit', async () => {
    const { page } = mockDocument();
    page.getViewport.mockImplementation(({ scale }: { scale: number }) => ({
      width: 612 * scale * 2,
      height: 792 * scale * 2,
      transform: [scale * 2, 0, 0, -scale * 2, 0, 792 * scale * 2],
    }));
    const opened = await openPdf(inputPdf());
    const text = await opened.extractPageText(1);
    expect(text).toMatchObject({ width: 1224, height: 1584 });
    expect(text.words).toEqual([
      {
        text: 'Measured value',
        bbox: { x0: 72, y0: 124.8, x1: 232, y1: 148.8 },
      },
    ]);
    await opened.destroy();
  });

  it('serializes page renders, and closing cancels the active render and rejects queued work', async () => {
    const { pdf, page, destroy } = mockDocument();
    const running = deferred<void>();
    const cancel = vi.fn(() =>
      running.reject(new DOMException('cancelled', 'AbortError')),
    );
    page.render.mockReturnValue({ promise: running.promise, cancel });
    const opened = await openPdf(inputPdf());
    const first = opened.renderPage(1, 150);
    const second = opened.renderPage(2, 150);
    const firstRejection = expect(first).rejects.toMatchObject({
      name: 'AbortError',
    });
    const secondRejection = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.waitFor(() => expect(page.render).toHaveBeenCalledOnce());
    expect(pdf.getPage).toHaveBeenCalledTimes(1);
    await opened.destroy();
    await Promise.all([firstRejection, secondRejection]);
    expect(cancel).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
  });
});
