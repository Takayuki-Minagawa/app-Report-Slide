import { expect, test } from '@playwright/test';
import type { OcrResult } from '../src/ocr/ocr-engine';

test('OCRは日本語・英語・数値を同一サイトのworkerで読み取り、切り抜き座標と原画像を保つ', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const requests: string[] = [];
  const workers: string[] = [];
  const closed: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('worker', (worker) => {
    if (!worker.url().includes('/ocr/')) return;
    workers.push(worker.url());
    worker.on('close', () => closed.push(worker.url()));
  });
  await page.goto('/');
  // Exercise the actual worker and bundled models without mocking the recognizer.
  // The UI round trip has separate tests; this checks language quality and privacy.
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/ocr/ocr-engine.ts';
    const { recognizeImage } = await import(moduleUrl);
    const font = new FontFace(
      'OcrFixture',
      'url(/src/export/fonts/KumiPrintSansJP.woff2)',
    );
    document.fonts.add(await font.load());
    const canvas = document.createElement('canvas');
    canvas.width = 1500;
    canvas.height = 650;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '64px OcrFixture';
    context.fillText('EXCLUDED', 80, 100);
    context.fillText('温度 25.0', 100, 270);
    context.fillText('Sample A 12.5', 100, 380);
    context.fillText('Sample B 18.0', 100, 490);
    const original = canvas.toDataURL();
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    const progress: number[] = [];
    const recognized = (await recognizeImage(blob, {
      language: 'jpn+eng',
      rectangle: { left: 70, top: 160, width: 1330, height: 410 },
      onProgress: ({ progress: value }: { progress: number }) =>
        progress.push(value),
    })) as OcrResult;
    return {
      recognized,
      progress,
      sourceUnchanged: canvas.toDataURL() === original,
    };
  });
  expect(result.recognized.text).toContain('温度');
  expect(result.recognized.text).toContain('25.0');
  expect(result.recognized.text).toMatch(/Sample\s*A\s*12\.5/);
  expect(result.recognized.text).toMatch(/Sample\s*B\s*18\.0/);
  expect(result.recognized.text).not.toContain('EXCLUDED');
  expect(result.recognized.words.length).toBeGreaterThan(5);
  expect(
    result.recognized.words.every(
      ({ bbox }) =>
        bbox.x0 >= 70 && bbox.y0 >= 160 && bbox.x1 <= 1400 && bbox.y1 <= 570,
    ),
  ).toBe(true);
  expect(result.recognized.confidence).toBeGreaterThan(70);
  expect(result.sourceUnchanged).toBe(true);
  expect(result.progress.at(-1)).toBe(1);
  expect(
    result.progress.every(
      (value, index, all) => !index || value >= all[index - 1],
    ),
  ).toBe(true);
  await expect.poll(() => closed.length).toBe(workers.length);
  expect(workers).toHaveLength(1);
  const origin = new URL(page.url()).origin;
  expect(
    requests.every(
      (url) => !/^https?:/.test(url) || new URL(url).origin === origin,
    ),
  ).toBe(true);
  expect(
    requests.some((url) => url.includes('/languages/jpn.traineddata.gz')),
  ).toBe(true);
  expect(
    requests.some((url) => url.includes('/languages/eng.traineddata.gz')),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('OCRエンジンの初期化中でも中止するとworkerが終了する', async ({
  page,
}) => {
  const closed: string[] = [];
  page.on('worker', (worker) => {
    if (worker.url().includes('/ocr/'))
      worker.on('close', () => closed.push(worker.url()));
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const moduleUrl = '/src/ocr/ocr-engine.ts';
    const { recognizeImage } = await import(moduleUrl);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 20;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), 'image/png'),
    );
    const controller = new AbortController();
    try {
      await recognizeImage(blob, {
        language: 'eng',
        signal: controller.signal,
        onProgress: ({ progress }: { progress: number }) => {
          if (progress > 0) controller.abort();
        },
      });
      return 'unexpected success';
    } catch (error) {
      return (error as Error).name;
    }
  });
  expect(result).toBe('AbortError');
  await expect.poll(() => closed.length).toBe(1);
});
