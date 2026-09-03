import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

// Includes a cold app load, file download, and a second offline browser context.
test.setTimeout(60_000);

test('HTMLスライドを保存し、オフラインで数式・画像・スライド送り・参照を使用できる', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'HTMLスライドを出力', exact: true }),
  ).toHaveCount(0);

  await page.getByLabel('Markdownファイル').setInputFiles([
    {
      name: 'presentation.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: slide\ntitle: HTMLスライド\ntheme: technical\nnumber_sections: true\n---\n\n# はじめに\n\n$E=mc^2$\n\n[@sec:result]\n\n::: slidebreak\n:::\n\n# 結果\n{#sec:result}\n\n![応答図](images/response.svg)',
      ),
    },
    {
      name: 'response.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2563eb"/></svg>',
      ),
    },
  ]);
  const exportButton = page.getByRole('button', {
    name: 'HTMLスライドを出力',
    exact: true,
  });
  await expect(exportButton).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('HTMLスライド.html');
  const exportedPath = testInfo.outputPath('presentation.html');
  await download.saveAs(exportedPath);
  const html = await readFile(exportedPath, 'utf8');
  expect(html).toContain('data:image/svg+xml;base64,');
  expect(html).toContain('data:font/woff2;base64,');
  expect(html).not.toContain('blob:');
  await expect(
    page.getByText('HTMLスライドを出力しました', { exact: true }).first(),
  ).toBeVisible();

  const offline = await browser.newContext({ offline: true });
  try {
    const deck = await offline.newPage();
    deck.on('pageerror', (error) => errors.push(error.message));
    const networkRequests: string[] = [];
    deck.on('request', (request) => {
      if (/^https?:/.test(request.url())) networkRequests.push(request.url());
    });
    await deck.goto(pathToFileURL(exportedPath).href);
    await expect(deck).toHaveTitle('HTMLスライド');
    await expect(deck.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(
      deck.getByRole('navigation', { name: 'スライド操作' }),
    ).toBeVisible();
    await expect(deck.locator('#slide-1')).toBeVisible();
    await expect(deck.locator('#slide-2')).toBeHidden();
    await expect(
      deck.getByRole('button', { name: '前へ', exact: true }),
    ).toBeDisabled();
    await expect(deck.locator('.katex')).toBeVisible();
    expect(
      await deck.evaluate(
        async () => (await document.fonts.load('16px KaTeX_Main')).length,
      ),
    ).toBeGreaterThan(0);

    await deck.locator('.preview-reference').click();
    await expect(deck.locator('#slide-2')).toBeVisible();
    await expect(deck.locator('#deck-counter')).toHaveText('2 / 2');
    const image = deck.getByRole('img', { name: '応答図' });
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('naturalWidth', 80);
    await expect(
      deck.getByRole('button', { name: '次へ', exact: true }),
    ).toBeDisabled();

    await deck.keyboard.press('Home');
    await expect(deck.locator('#slide-1')).toBeVisible();
    await deck.keyboard.press('Space');
    await expect(deck.locator('#slide-2')).toBeVisible();
    await deck.keyboard.press('ArrowLeft');
    await expect(deck.locator('#slide-1')).toBeVisible();
    await deck.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(deck.locator('#slide-2')).toBeVisible();

    await deck.reload();
    await expect(deck.locator('#slide-2')).toBeVisible();
    await deck.setViewportSize({ width: 390, height: 844 });
    const bounds = await deck.locator('#slide-2').boundingBox();
    expect(bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.height).toBeLessThanOrEqual(844);
    await deck.emulateMedia({ media: 'print' });
    await expect(deck.locator('#slide-1')).toBeVisible();
    await expect(deck.locator('#slide-2')).toBeVisible();
    expect(networkRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await offline.close();
  }
});

test('英語のHTML出力にMarkdown下書きを含め、編集用原稿の未保存状態を維持する', async ({
  page,
  browser,
}, testInfo) => {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await page.getByRole('button', { name: '英語表示', exact: true }).click();
  await page
    .getByRole('button', { name: 'Switch to Markdown', exact: true })
    .click();
  const draft =
    '---\ntype: slide\ntitle: Draft export\n---\n\n# Unapplied slide';
  await page.getByRole('textbox', { name: 'Markdown draft' }).fill(draft);
  const downloadPromise = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export HTML slides', exact: true })
    .click();
  const download = await downloadPromise;
  const exportedPath = testInfo.outputPath('draft.html');
  await download.saveAs(exportedPath);
  await expect(page.getByLabel('Unsaved')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Markdown draft' }),
  ).toHaveValue(draft);
  const deck = await browser.newPage();
  try {
    await deck.goto(pathToFileURL(exportedPath).href);
    await expect(deck.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      deck.getByRole('button', { name: 'Previous', exact: true }),
    ).toBeDisabled();
    await expect(
      deck.getByRole('button', { name: 'Next', exact: true }),
    ).toBeDisabled();
    await expect(deck.locator('#slide-1')).toContainText('Unapplied slide');
  } finally {
    await deck.close();
  }
});
