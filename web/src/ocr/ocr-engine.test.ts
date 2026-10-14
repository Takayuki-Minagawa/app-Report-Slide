import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'tesseract.js';
import {
  maximumOcrBytes,
  normalizeOcrResult,
  ocrTimeoutMs,
  recognizeImage,
  validatedOcrRectangle,
} from './ocr-engine';

function imageBlob() {
  const blob = new Blob(['png'], { type: 'image/png' });
  Object.defineProperty(blob, 'arrayBuffer', {
    value: async () => new Uint8Array([1, 2, 3]).buffer,
  });
  return blob;
}

const pageResult = {
  text: '温度 12.5\n',
  confidence: 92,
  blocks: [
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                {
                  text: '温度',
                  confidence: 94,
                  bbox: { x0: 110, y0: 55, x1: 180, y1: 80 },
                },
                {
                  text: '12.5',
                  confidence: 90,
                  bbox: { x0: 220, y0: 55, x1: 280, y1: 80 },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as Page;

type Packet = { jobId: string; action: string; payload: unknown };
class MockWorker {
  static instances: MockWorker[] = [];
  static holdAction = '';
  static failAction = '';
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn((packet: Packet) => {
    if (packet.action === MockWorker.holdAction) return;
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          jobId: packet.jobId,
          action: packet.action,
          status:
            packet.action === MockWorker.failAction ? 'reject' : 'resolve',
          data: packet.action === 'recognize' ? pageResult : {},
        },
      }),
    );
  });
  constructor(readonly url: string) {
    MockWorker.instances.push(this);
  }
}

const closeBitmap = vi.fn();
beforeEach(() => {
  MockWorker.instances = [];
  MockWorker.holdAction = '';
  MockWorker.failAction = '';
  closeBitmap.mockReset();
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal(
    '__KUMI_OCR_ASSET_BASE__',
    '/app-Report-Slide/ocr/6.0.1-6.1.2-data1/',
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 800, height: 600, close: closeBitmap })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(imageBlob()),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('local OCR worker', () => {
  it('uses pinned same-origin assets, pixel crop, numeric-preserving text and terminates after success', async () => {
    const progress = vi.fn();
    const result = await recognizeImage(imageBlob(), {
      language: 'jpn+eng',
      rectangle: { left: 100, top: 50, width: 400, height: 300 },
      onProgress: progress,
    });
    const worker = MockWorker.instances[0];
    expect(worker.url).toBe(
      'http://localhost:3000/app-Report-Slide/ocr/6.0.1-6.1.2-data1/worker.min.js',
    );
    expect(
      worker.postMessage.mock.calls.map(([packet]) => packet.action),
    ).toEqual([
      'load',
      'loadLanguage',
      'initialize',
      'setParameters',
      'recognize',
    ]);
    expect(worker.postMessage.mock.calls[1][0].payload).toMatchObject({
      langs: 'jpn+eng',
      options: {
        langPath:
          'http://localhost:3000/app-Report-Slide/ocr/6.0.1-6.1.2-data1/languages',
        cacheMethod: 'write',
      },
    });
    expect(worker.postMessage.mock.calls[4][0].payload).toMatchObject({
      image: new Uint8Array([1, 2, 3]),
      options: { rectangle: { left: 100, top: 50, width: 400, height: 300 } },
      output: { text: true, blocks: true },
    });
    expect(result).toMatchObject({
      text: '温度 12.5\n',
      confidence: 92,
      width: 800,
      height: 600,
    });
    expect(result.words[0]).toMatchObject({
      bbox: { x0: 110, y0: 55, x1: 180, y1: 80 },
      lineId: '0:0:0',
    });
    expect(progress).toHaveBeenLastCalledWith({
      status: '文字の読み取りが完了しました',
      progress: 1,
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(closeBitmap).toHaveBeenCalledOnce();
  });

  for (const stage of ['load', 'loadLanguage', 'recognize']) {
    it(`aborts and terminates immediately while ${stage} is pending`, async () => {
      MockWorker.holdAction = stage;
      const controller = new AbortController();
      const result = recognizeImage(imageBlob(), { signal: controller.signal });
      const assertion = expect(result).rejects.toMatchObject({
        name: 'AbortError',
      });
      await vi.waitFor(() =>
        expect(
          MockWorker.instances[0]?.postMessage.mock.calls.some(
            ([packet]) => packet.action === stage,
          ),
        ).toBe(true),
      );
      controller.abort();
      await assertion;
      expect(MockWorker.instances[0].terminate).toHaveBeenCalled();
    });
  }

  it('times out and terminates stalled initialization', async () => {
    vi.useFakeTimers();
    MockWorker.holdAction = 'load';
    const result = recognizeImage(imageBlob());
    const assertion = expect(result).rejects.toThrow('2分以内');
    await vi.advanceTimersByTimeAsync(ocrTimeoutMs + 1);
    await assertion;
    expect(MockWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('terminates and reports asset/worker errors without leaking pending jobs', async () => {
    MockWorker.failAction = 'loadLanguage';
    await expect(recognizeImage(imageBlob())).rejects.toThrow('読み取れません');
    expect(MockWorker.instances[0].terminate).toHaveBeenCalled();
  });

  it('rejects unsupported types, oversized images and external asset bases before creating a worker', async () => {
    await expect(
      recognizeImage(new Blob(['pdf'], { type: 'application/pdf' })),
    ).rejects.toThrow('PNG');
    const tooLarge = imageBlob();
    Object.defineProperty(tooLarge, 'size', { value: maximumOcrBytes + 1 });
    await expect(recognizeImage(tooLarge)).rejects.toThrow('20 MB');
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 5000, height: 10, close: closeBitmap })),
    );
    await expect(recognizeImage(imageBlob())).rejects.toThrow('4,096');
    expect(closeBitmap).toHaveBeenCalledOnce();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 500, height: 10, close: closeBitmap })),
    );
    vi.stubGlobal('__KUMI_OCR_ASSET_BASE__', 'https://external.example/ocr/');
    await expect(recognizeImage(imageBlob())).rejects.toThrow('配布先');
    expect(MockWorker.instances).toHaveLength(0);
  });

  it('rejects invalid crops and keeps valid fractional edges inside the bitmap', () => {
    expect(
      validatedOcrRectangle(
        { left: 0.2, top: 1.7, width: 30.1, height: 15.1 },
        100,
        100,
      ),
    ).toEqual({ left: 0, top: 1, width: 31, height: 16 });
    expect(() =>
      validatedOcrRectangle(
        { left: -1, top: 0, width: 10, height: 10 },
        100,
        100,
      ),
    ).toThrow();
    expect(() =>
      validatedOcrRectangle(
        { left: 50, top: 0, width: 51, height: 10 },
        100,
        100,
      ),
    ).toThrow();
    expect(() =>
      validatedOcrRectangle(
        { left: 0, top: 0, width: NaN, height: 10 },
        100,
        100,
      ),
    ).toThrow();
  });

  it('represents blank recognition honestly instead of inventing text or confidence', () => {
    expect(
      normalizeOcrResult({ text: '', confidence: NaN, blocks: null }, 100, 200),
    ).toEqual({ text: '', confidence: 0, words: [], width: 100, height: 200 });
  });
});
