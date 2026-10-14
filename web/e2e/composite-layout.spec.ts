import { expect, test, type Download, type Page } from '@playwright/test';
import type { DocumentData } from '../src/document/model';

test.setTimeout(90_000);

async function downloadBytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportJson(page: Page): Promise<DocumentData> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse(
    new TextDecoder().decode(await downloadBytes(await pending)),
  );
}

test('原図・比較表・条件・結論を名前付き領域へ配置し別ブラウザでHTMLから再編集できる', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'composite.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: slide\ntitle: 原図・比較表・条件\n---\n# 原図と比較条件\n\n![応答の原図](response.svg)\n{caption="原図：入力と応答の関係"}\n\n| 手法 | 応答 |\n| --- | --- |\n| 観測 | 42.75 |\n| 解析 | 38.10 |\n\n条件：同一地盤、入力 29 kg。\n\n結論：解析と観測の差を検討する。\n\n::: slidebreak\n:::\n\n# 手動配置を保護\n\n![保護する図](response.svg)\n{slide_layout="10,25,40,30"}',
      ),
    },
    {
      name: 'response.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#eff6ff"/><path d="M70 40V295H595" fill="none" stroke="#334155" stroke-width="4"/><path d="M70 250L145 220L220 250L295 145L370 190L445 95L520 125L595 55" fill="none" stroke="#176b9a" stroke-width="6"/><text x="265" y="335" font-size="24">Time (s)</text><text x="85" y="65" font-size="24">Response</text></svg>',
      ),
    },
  ]);
  const original = await exportJson(page);
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const panel = page.getByRole('region', {
    name: 'スライドデザイン',
    exact: true,
  });
  const article = page.locator('.preview-pages .slide-preview').first();
  await panel
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('composite');
  await panel
    .getByRole('textbox', { name: '要素名 1', exact: true })
    .fill('左側の原図');
  await panel
    .getByRole('textbox', { name: '要素名 2', exact: true })
    .fill('結果の比較表');
  await panel
    .getByRole('combobox', { name: '配置先 1', exact: true })
    .selectOption('left');
  await panel
    .getByRole('combobox', { name: '配置先 2', exact: true })
    .selectOption('right-top');
  await panel
    .getByRole('combobox', { name: '配置先 3', exact: true })
    .selectOption('right-bottom');
  await panel
    .getByRole('combobox', { name: '配置先 4', exact: true })
    .selectOption('bottom');
  await panel.getByRole('spinbutton', { name: '主領域の幅 (%)' }).fill('60');
  await panel.getByRole('spinbutton', { name: '領域間の余白 (px)' }).fill('20');
  await panel.getByText('表のスタイル', { exact: true }).click();
  await panel.getByRole('checkbox', { name: '表の交互行に色を付ける' }).check();
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  const review = page.getByRole('dialog', { name: 'デザインの変更を確認' });
  const after = review.getByRole('region', { name: '変更後' });
  await expect(after.locator('[data-composite-region="left"] img')).toHaveCount(
    1,
  );
  await expect(
    after.locator('[data-composite-region="right-top"] table'),
  ).toContainText('42.75');
  await expect(
    after.locator('[data-composite-region="right-bottom"]'),
  ).toContainText('29 kg');
  await expect(after.locator('[data-composite-region="bottom"]')).toContainText(
    '結論',
  );
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  await expect(article).toHaveAttribute('data-layout', 'composite');
  await expect(page.getByRole('group', { name: '編集対象一覧' })).toContainText(
    '左側の原図',
  );
  await article.screenshot({
    path: testInfo.outputPath('composite-layout.png'),
  });
  await article.screenshot({ path: '/private/tmp/kumi-composite-layout.png' });
  const beforeSwap = await exportJson(page);
  expect(beforeSwap.children).toEqual(original.children);

  await panel
    .getByRole('button', { name: '図と説明の左右を入れ替える' })
    .click();
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  await expect(after.locator('.slide-composite-grid')).toHaveAttribute(
    'data-reverse',
    'true',
  );
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  const afterSwap = await exportJson(page);
  expect(afterSwap.children).toEqual(original.children);
  await panel
    .getByRole('button', { name: '直前のデザイン変更を取り消す' })
    .click();
  expect(await exportJson(page)).toEqual(beforeSwap);

  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const html = await downloadBytes(await pending);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
  });
  try {
    const fresh = await context.newPage();
    fresh.on('pageerror', (error) => errors.push(error.message));
    fresh.on('dialog', (dialog) => void dialog.accept());
    await fresh.goto('/');
    await expect(
      fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await fresh.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'reopen.html',
      mimeType: 'text/html',
      buffer: html,
    });
    const importReview = fresh.getByRole('dialog', { name: 'HTML取込の確認' });
    await importReview
      .getByRole('button', { name: '確認して取り込む' })
      .click();
    expect(await exportJson(fresh)).toEqual(beforeSwap);
    await fresh
      .getByRole('button', { name: '完成プレビューへ切り替え' })
      .click();
    await expect(
      fresh
        .locator('.preview-pages .slide-preview')
        .first()
        .getByRole('img', { name: '応答の原図' }),
    ).toHaveJSProperty('naturalWidth', 640);
    const freshPanel = fresh.getByRole('region', {
      name: 'スライドデザイン',
      exact: true,
    });
    await freshPanel
      .getByRole('textbox', { name: '要素名 2', exact: true })
      .fill('再編集した比較表');
    await freshPanel.getByRole('button', { name: '変更をプレビュー' }).click();
    await fresh
      .getByRole('dialog', { name: 'デザインの変更を確認' })
      .getByRole('button', { name: 'このデザインを適用' })
      .click();
    await expect(
      fresh.getByRole('group', { name: '編集対象一覧' }),
    ).toContainText('再編集した比較表');
    expect((await exportJson(fresh)).children).toEqual(original.children);
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
