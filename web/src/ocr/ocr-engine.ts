import type { Page } from 'tesseract.js';

declare const __KUMI_OCR_ASSET_BASE__: string;

export type OcrLanguage = 'jpn+eng' | 'jpn' | 'eng';
export interface OcrRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface OcrProgress {
  status: string;
  progress: number;
}
export interface OcrWord {
  text: string;
  confidence: number;
  /** Pixel coordinates in the original image, including any rectangle offset. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  lineId: string;
}
export interface OcrResult {
  text: string;
  confidence: number;
  words: OcrWord[];
  width: number;
  height: number;
}
export interface OcrOptions {
  language?: OcrLanguage;
  rectangle?: OcrRectangle;
  signal?: AbortSignal;
  onProgress?: (value: OcrProgress) => void;
}

export const maximumOcrPixels = 8_000_000;
export const maximumOcrSide = 4096;
export const maximumOcrBytes = 20 * 1024 * 1024;
export const ocrTimeoutMs = 120_000;

function abortError() {
  return new DOMException('文字の読み取りを中止しました。', 'AbortError');
}

export function validatedOcrRectangle(
  rectangle: OcrRectangle | undefined,
  width: number,
  height: number,
): OcrRectangle {
  const area = rectangle ?? { left: 0, top: 0, width, height };
  if (
    ![area.left, area.top, area.width, area.height].every(Number.isFinite) ||
    area.left < 0 ||
    area.top < 0 ||
    area.width < 1 ||
    area.height < 1 ||
    area.left + area.width > width + 0.01 ||
    area.top + area.height > height + 0.01
  )
    throw new Error('文字を読み取る範囲を画像の内側に指定してください。');
  const left = Math.floor(area.left);
  const top = Math.floor(area.top);
  return {
    left,
    top,
    width: Math.min(width - left, Math.ceil(area.left + area.width) - left),
    height: Math.min(height - top, Math.ceil(area.top + area.height) - top),
  };
}

function confidence(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function normalizeOcrResult(
  page: Pick<Page, 'text' | 'confidence' | 'blocks'>,
  width: number,
  height: number,
): OcrResult {
  const words: OcrWord[] = [];
  for (const [blockIndex, block] of (page.blocks ?? []).entries()) {
    for (const [paragraphIndex, paragraph] of block.paragraphs.entries()) {
      for (const [lineIndex, line] of paragraph.lines.entries()) {
        for (const word of line.words) {
          if (!word.text.trim()) continue;
          const { x0, y0, x1, y1 } = word.bbox;
          if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
          const bbox = {
            x0: Math.max(0, Math.min(width, x0)),
            y0: Math.max(0, Math.min(height, y0)),
            x1: Math.max(0, Math.min(width, x1)),
            y1: Math.max(0, Math.min(height, y1)),
          };
          if (bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0) continue;
          words.push({
            text: word.text,
            confidence: confidence(word.confidence),
            bbox,
            lineId: `${blockIndex}:${paragraphIndex}:${lineIndex}`,
          });
        }
      }
    }
  }
  return {
    text: page.text ?? '',
    confidence: confidence(page.confidence),
    words,
    width,
    height,
  };
}

/**
 * Fixed Tesseract.js 6 worker protocol, matching src/createWorker.js upstream.
 * Owning the native Worker lets cancellation terminate language downloads and
 * WASM initialization too; createWorker() exposes terminate only after setup.
 * All runtime assets are on this site's origin. No document bytes are uploaded.
 */
export async function recognizeImage(
  image: Blob,
  options: OcrOptions = {},
): Promise<OcrResult> {
  if (options.signal?.aborted) throw abortError();
  if (!image.size || image.size > maximumOcrBytes)
    throw new Error('OCRには20 MB以内の画像を選択してください。');
  if (image.type && !/^image\/(?:png|jpeg|webp|gif|bmp)$/.test(image.type))
    throw new Error('OCRにはPNG・JPEG・WebPなどの画像を選択してください。');
  const language = options.language ?? 'jpn+eng';
  if (!['jpn+eng', 'jpn', 'eng'].includes(language))
    throw new Error('OCRの言語を選択してください。');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image);
  } catch (cause) {
    throw new Error('OCR用の画像を開けませんでした。', { cause });
  }
  const { width, height } = bitmap;
  if (
    !width ||
    !height ||
    width * height > maximumOcrPixels ||
    Math.max(width, height) > maximumOcrSide
  ) {
    bitmap.close();
    throw new Error('OCR用の画像は800万画素・一辺4,096 px以内にしてください。');
  }
  let rectangle: OcrRectangle;
  let png: Blob;
  const canvas = document.createElement('canvas');
  try {
    if (options.signal?.aborted) throw abortError();
    rectangle = validatedOcrRectangle(options.rectangle, width, height);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OCR用の画像を準備できませんでした。');
    // Normalize transparency, browser-supported formats and EXIF orientation.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);
    png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error('OCR用の画像を準備できませんでした。')),
        'image/png',
      ),
    );
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
  const bytes = new Uint8Array(await png.arrayBuffer());
  if (options.signal?.aborted) throw abortError();
  const base = new URL(__KUMI_OCR_ASSET_BASE__, window.location.href).href;
  if (new URL(base).origin !== window.location.origin)
    throw new Error('OCRの配布先を確認してください。');
  const worker = new Worker(`${base}worker.min.js`);
  let pending:
    | {
        jobId: string;
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
      }
    | undefined;
  let nextJob = 0;
  let failure: Error | undefined;
  let maximumProgress = 0;
  const stop = (reason: Error) => {
    failure = reason;
    worker.terminate();
    pending?.reject(reason);
    pending = undefined;
  };
  const cancel = () => stop(abortError());
  const timeout = setTimeout(
    () =>
      stop(
        new Error(
          '文字の読み取りが2分以内に完了しませんでした。範囲を小さくして再実行してください。',
        ),
      ),
    ocrTimeoutMs,
  );
  options.signal?.addEventListener('abort', cancel, { once: true });
  worker.onerror = () =>
    stop(
      new Error(
        'OCRを開始できませんでした。ページを再読み込みしてお試しください。',
      ),
    );
  worker.onmessageerror = () =>
    stop(new Error('OCRの結果を読み込めませんでした。'));
  worker.onmessage = ({ data }) => {
    if (failure || data.jobId !== pending?.jobId) return;
    if (data.status === 'progress') {
      const progress = Math.max(
        0,
        Math.min(1, Number(data.data?.progress) || 0),
      );
      const stages: Record<string, [number, number, string]> = {
        'loading tesseract core': [0, 0.15, 'OCRエンジンを準備中'],
        'initializing tesseract': [0.15, 0.1, 'OCRエンジンを起動中'],
        'loading language traineddata': [
          0.25,
          0.2,
          '読み取り用の言語データを準備中',
        ],
        'initializing api': [0.45, 0.1, '文字の読み取りを準備中'],
        'recognizing text': [0.55, 0.44, '文字を読み取り中'],
      };
      const [start, length, status] = stages[data.data?.status] ?? [
        0,
        0,
        '文字の読み取りを準備中',
      ];
      maximumProgress = Math.max(maximumProgress, start + length * progress);
      options.onProgress?.({ status, progress: maximumProgress });
    } else if (data.status === 'reject') {
      stop(
        new Error(
          'OCRで文字を読み取れませんでした。画像や読み取り範囲を確認してください。',
          { cause: data.data },
        ),
      );
    } else if (data.status === 'resolve') {
      const current = pending;
      pending = undefined;
      current?.resolve(data.data);
    }
  };
  const request = (action: string, payload: unknown) => {
    if (failure) return Promise.reject(failure);
    return new Promise<unknown>((resolve, reject) => {
      const jobId = `ocr-${++nextJob}`;
      pending = { jobId, resolve, reject };
      worker.postMessage({ workerId: 'kumi-ocr', jobId, action, payload });
    });
  };
  try {
    if (options.signal?.aborted) throw abortError();
    options.onProgress?.({ status: 'OCRエンジンを準備中', progress: 0 });
    await request('load', {
      options: { lstmOnly: true, corePath: `${base}core`, logging: false },
    });
    await request('loadLanguage', {
      langs: language,
      options: {
        langPath: `${base}languages`,
        cachePath: base,
        cacheMethod: 'write',
        gzip: true,
        lstmOnly: true,
      },
    });
    await request('initialize', { langs: language, oem: 1, config: {} });
    await request('setParameters', {
      params: {
        tessedit_pageseg_mode: '6',
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      },
    });
    const result = await request('recognize', {
      image: bytes,
      options: { rectangle, rotateAuto: false },
      output: { text: true, blocks: true },
    });
    const normalized = normalizeOcrResult(result as Page, width, height);
    options.onProgress?.({
      status: '文字の読み取りが完了しました',
      progress: 1,
    });
    return normalized;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
    worker.terminate();
  }
}
