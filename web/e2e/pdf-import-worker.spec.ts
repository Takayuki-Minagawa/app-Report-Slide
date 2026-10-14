import { expect, test } from '@playwright/test';
import { twoPagePdfFixture } from './fixtures/pdf';

test('PDFをローカルworkerで描画し埋込スクリプトを実行せずキャンセルでworkerを解放する', async ({
  page,
}) => {
  const errors: string[] = [];
  const workers: string[] = [];
  const closed: string[] = [];
  const requests: string[] = [];
  let unexpectedDialogs = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => {
    unexpectedDialogs++;
    void dialog.dismiss();
  });
  page.on('worker', (worker) => {
    if (!worker.url().includes('pdf.worker')) return;
    workers.push(worker.url());
    worker.on('close', () => closed.push(worker.url()));
  });
  page.on('request', (request) => {
    if (request.url().includes('/pdfjs/')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'PDFから図を追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('取り込むPDFファイル', { exact: true })
    .setInputFiles({
      name: 'evidence.pdf',
      mimeType: 'application/pdf',
      buffer: twoPagePdfFixture({
        script:
          'window.__pdfScriptExecuted = true; app.alert("must not execute");',
      }),
    });
  await expect(
    dialog.getByLabel('PDFページ', { exact: true }).locator('option'),
  ).toHaveCount(2);
  await dialog.getByLabel('PDFページ', { exact: true }).selectOption('2');
  await dialog.getByLabel('PDF解像度', { exact: true }).selectOption('288');
  const insert = dialog.getByRole('button', {
    name: '選択範囲を図として挿入',
    exact: true,
  });
  await expect(insert).toBeEnabled();
  const preview = dialog.getByRole('img', {
    name: 'PDF切り抜き範囲',
    exact: true,
  });
  const bounds = (await preview.getAttribute('viewBox'))!
    .split(' ')
    .map(Number);
  expect(bounds[2]).toBeGreaterThan(bounds[3]);
  expect(bounds[2] * bounds[3]).toBeLessThanOrEqual(8_000_000);
  expect(Math.max(bounds[2], bounds[3])).toBeLessThanOrEqual(4096);
  // The red circle exists only on page 2; inspect the rendered pixels rather than just selection metadata.
  const color = await preview.locator('image').evaluate(async (element) => {
    const bitmap = await createImageBitmap(
      await (await fetch(element.getAttribute('href')!)).blob(),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const pixel = Array.from(
      context.getImageData(
        Math.floor((bitmap.width * 180) / 841.89),
        Math.floor((bitmap.height * 200) / 595.28),
        1,
        1,
      ).data,
    );
    bitmap.close();
    return pixel;
  });
  // PDF colour operands are rounded; tolerate a two-level channel conversion difference.
  [220, 38, 38].forEach((expected, channel) =>
    expect(Math.abs(color[channel] - expected)).toBeLessThanOrEqual(2),
  );
  expect(
    await page.evaluate(() =>
      Object.prototype.hasOwnProperty.call(window, '__pdfScriptExecuted'),
    ),
  ).toBe(false);
  expect(unexpectedDialogs).toBe(0);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => closed.length).toBe(workers.length);
  expect(workers.length).toBe(1);
  const origin = new URL(page.url()).origin;
  expect(requests.every((url) => new URL(url).origin === origin)).toBe(true);
  expect(errors).toEqual([]);
});
