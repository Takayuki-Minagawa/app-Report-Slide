import { expect, test, type Download, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { twoPagePdfFixture } from './fixtures/pdf';

test.setTimeout(90_000);
async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function json(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse((await bytes(await pending)).toString());
}
async function start(page: Page, type = 'report') {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'start.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `---\ntype: ${type}\ntitle: PDF test\n---\n\n# Evidence\n\nEditable content`,
    ),
  });
}
async function insertPdf(page: Page, original: Buffer) {
  await page
    .getByRole('button', { name: 'PDFから図を追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'PDFから図を取り込む',
    exact: true,
  });
  await dialog.getByLabel('取り込むPDFファイル').setInputFiles({
    name: 'research.pdf',
    mimeType: 'application/pdf',
    buffer: original,
  });
  await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
  await dialog.getByLabel('PDFページ', { exact: true }).selectOption('2');
  await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
  const box = (await dialog.getByLabel('PDF切り抜き範囲').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.8, {
    steps: 5,
  });
  await page.mouse.up();
  expect(
    Number(await dialog.getByLabel('PDF範囲 x', { exact: true }).inputValue()),
  ).toBeCloseTo(10, 0);
  await dialog
    .getByLabel('PDF出典 title', { exact: true })
    .fill('Observed comparison');
  await dialog.getByLabel('PDFの図表番号', { exact: true }).fill('Fig. 2');
  await dialog
    .getByRole('button', { name: '選択範囲を図として挿入', exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

for (const type of ['report', 'slide'])
  test(`${type}: PDF crop, original bytes, Undo and fresh HTML/ZIP recropping`, async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1650, height: 1100 });
    await start(page, type);
    const original = twoPagePdfFixture();
    await insertPdf(page, original);
    const before = await json(page);
    const figure = before.children.find(
      (node: { type: string }) => node.type === 'figure',
    );
    expect(figure.attrs.figureEdit.pdfSource).toMatchObject({
      page: 2,
      pageCount: 2,
      dpi: 144,
      fileName: 'research.pdf',
    });
    expect(figure.attrs.figureEdit.source).toMatchObject({
      pdfPage: '2',
      figureNumber: 'Fig. 2',
      origin: 'cropped',
    });
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    expect(
      (await json(page)).children.some(
        (node: { type: string }) => node.type === 'figure',
      ),
    ).toBe(false);
    await page.getByRole('button', { name: 'やり直す', exact: true }).click();
    const saved: { name: string; mimeType: string; buffer: Buffer }[] = [];
    for (const format of ['HTML', 'ZIP']) {
      const pending = page.waitForEvent('download');
      await page
        .getByRole('button', {
          name:
            format === 'ZIP'
              ? 'ZIP'
              : type === 'slide'
                ? '編集できるHTMLを保存'
                : '編集できるReport HTMLを保存',
          exact: true,
        })
        .click();
      const buffer = await bytes(await pending);
      if (format === 'ZIP') {
        const archive = unzipSync(buffer);
        const pdf = Object.entries(archive).find(([name]) =>
          name.endsWith('.pdf'),
        )!;
        expect(Buffer.from(pdf[1])).toEqual(original);
      }
      saved.push({
        name: `saved.${format.toLowerCase()}`,
        mimeType: format === 'ZIP' ? 'application/zip' : 'text/html',
        buffer,
      });
    }
    for (const savedFile of saved) {
      const context = await browser.newContext({
        viewport: { width: 1650, height: 1100 },
      });
      try {
        const fresh = await context.newPage();
        fresh.on('pageerror', (error) => errors.push(error.message));
        await fresh.goto('/');
        await expect(
          fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
        ).toBeVisible();
        await fresh
          .getByLabel('HTML・Markdown・JSONファイル')
          .setInputFiles(savedFile);
        if (savedFile.name.endsWith('.html'))
          await fresh
            .getByRole('dialog', { name: 'HTML取込の確認' })
            .getByRole('button', { name: '確認して取り込む' })
            .click();
        await fresh.locator('.kumi-editor-content .kumi-figure').click();
        if (type === 'slide') {
          await fresh.keyboard.press('Backspace');
          await expect(
            fresh.locator('.kumi-editor-content .kumi-figure'),
          ).toHaveCount(0);
          await fresh
            .getByRole('button', { name: '元に戻す', exact: true })
            .click();
          await expect
            .poll(() =>
              fresh
                .locator('.kumi-editor-content img.kumi-figure')
                .evaluate((image: HTMLImageElement) => image.naturalWidth),
            )
            .toBeGreaterThan(0);
          await fresh.locator('.kumi-editor-content .kumi-figure').click();
        }
        await fresh
          .getByRole('button', { name: '元PDFから範囲を取り直す', exact: true })
          .click();
        const dialog = fresh.getByRole('dialog', {
          name: '元PDFから取り込み直す',
          exact: true,
        });
        await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
        await expect(
          dialog.getByLabel('PDFページ', { exact: true }),
        ).toHaveValue('2');
        await dialog
          .getByRole('button', { name: 'ページ全体に戻す', exact: true })
          .click();
        await dialog
          .getByLabel('PDF解像度', { exact: true })
          .selectOption('216');
        await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
        await dialog
          .getByRole('button', { name: 'この図を更新', exact: true })
          .click();
        await expect(dialog).toBeHidden();
        const updated = (await json(fresh)).children.find(
          (node: { type: string }) => node.type === 'figure',
        );
        expect(updated.attrs.figureEdit.crop).toBeUndefined();
        expect(updated.attrs.figureEdit.pdfSource).toMatchObject({
          page: 2,
          dpi: 216,
        });
        expect(updated.attrs.figureEdit.imageSize.width).toBeGreaterThan(
          figure.attrs.figureEdit.imageSize.width,
        );
      } finally {
        await context.close();
      }
    }
    expect(errors).toEqual([]);
  });

test('PDF import inside a Report chapter preserves the original in project ZIP', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1650, height: 1100 });
  await start(page);
  await page.locator('summary').filter({ hasText: '章別プロジェクト' }).click();
  await page
    .getByRole('button', { name: '現在のReportをプロジェクト化', exact: true })
    .click();
  const original = twoPagePdfFixture();
  await insertPdf(page, original);
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'プロジェクトZIPを保存', exact: true })
    .click();
  const buffer = await bytes(await pending);
  expect(
    Buffer.from(
      Object.entries(unzipSync(buffer)).find(([name]) =>
        name.endsWith('.pdf'),
      )![1],
    ),
  ).toEqual(original);
  const context = await browser.newContext({
    viewport: { width: 1650, height: 1100 },
  });
  try {
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(
      fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await fresh
      .locator('summary')
      .filter({ hasText: '章別プロジェクト' })
      .click();
    await fresh.getByLabel('プロジェクトZIPを開く').setInputFiles({
      name: 'report.kumi.zip',
      mimeType: 'application/zip',
      buffer,
    });
    // Generated filenames restart in a fresh browser. Undo must keep old PDF bytes.
    await fresh.locator('.kumi-editor-content .kumi-figure').click();
    await fresh.keyboard.press('Backspace');
    await expect(
      fresh.locator('.kumi-editor-content .kumi-figure'),
    ).toHaveCount(0);
    const replacement = twoPagePdfFixture();
    expect(replacement).not.toEqual(original);
    await insertPdf(fresh, replacement);
    await fresh.getByRole('button', { name: '元に戻す', exact: true }).click();
    await fresh.getByRole('button', { name: '元に戻す', exact: true }).click();
    const restoredDownload = fresh.waitForEvent('download');
    await fresh
      .getByRole('button', { name: 'プロジェクトZIPを保存', exact: true })
      .click();
    const restoredArchive = unzipSync(await bytes(await restoredDownload));
    expect(
      Buffer.from(
        Object.entries(restoredArchive).find(([name]) =>
          name.endsWith('.pdf'),
        )![1],
      ),
    ).toEqual(original);
    await fresh.locator('.kumi-editor-content .kumi-figure').click();
    await fresh
      .getByRole('button', { name: '元PDFから範囲を取り直す', exact: true })
      .click();
    await expect(
      fresh.getByRole('dialog').getByLabel('PDF切り抜き範囲'),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test('invalid and password protected PDFs do not alter the document before confirmation', async ({
  page,
}) => {
  await start(page);
  const before = await json(page);
  await page
    .getByRole('button', { name: 'PDFから図を追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'PDFから図を取り込む',
    exact: true,
  });
  await dialog.getByLabel('取り込むPDFファイル').setInputFiles({
    name: 'invalid.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('not a pdf'),
  });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('取り込むPDFファイル').setInputFiles({
    name: 'locked.pdf',
    mimeType: 'application/pdf',
    buffer: twoPagePdfFixture({ password: 'test-secret' }),
  });
  await expect(
    dialog.getByLabel('PDFパスワード', { exact: true }),
  ).toBeVisible();
  await dialog.getByLabel('PDFパスワード', { exact: true }).fill('test-secret');
  await dialog.getByRole('button', { name: 'PDFを開く', exact: true }).click();
  await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(await json(page)).toEqual(before);
});
