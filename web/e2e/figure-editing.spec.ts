import { expect, test, type Download, type Page } from '@playwright/test';
import type { DocumentData, FigureNode } from '../src/document/model';

test.setTimeout(120_000);
async function bytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function json(page: Page): Promise<DocumentData> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse((await bytes(await pending)).toString());
}
function figure(document: DocumentData) {
  return document.children.find((node) => node.type === 'figure') as FigureNode;
}

test('SVGラベル・矢印・切り抜き・注釈・共有文献をHTMLとZIPから別の状態で再編集できる', async ({
  page,
  browser,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1650, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'SVG図解を挿入', exact: true })
    .click();
  const panel = page.getByRole('group', {
    name: '図解・原図・出典',
    exact: true,
  });
  await expect(panel).toBeVisible();
  await panel.getByText('SVGソース・ラベルを編集', { exact: true }).click();
  await panel.getByLabel('SVGラベル 2', { exact: true }).fill('応答を比較');
  await panel
    .getByRole('button', { name: '矢印 1 の向きを反転', exact: true })
    .click();
  await panel.getByLabel('図の名前', { exact: true }).fill('比較の模式図');
  await panel.getByText('原画像の切り抜き・注釈', { exact: true }).click();
  await panel.getByLabel('切り抜きX (%)', { exact: true }).fill('5');
  await panel.getByLabel('切り抜き幅 (%)', { exact: true }).fill('90');
  await panel
    .getByRole('button', { name: '図の注釈を追加', exact: true })
    .click();
  await panel
    .getByLabel('注釈 1 の文字', { exact: true })
    .fill('原図の注目箇所');
  await panel.getByText('図の由来・共有文献', { exact: true }).click();
  await panel.getByLabel('文献ID', { exact: true }).fill('study-2026');
  await panel.getByLabel('文献の題名', { exact: true }).fill('図版保存の試験');
  await panel.getByLabel('文献の著者', { exact: true }).fill('試験者');
  await panel.getByLabel('文献の年', { exact: true }).fill('2026');
  await panel
    .getByLabel('文献のリンク', { exact: true })
    .fill('https://example.org/study');
  await panel
    .getByRole('button', { name: '共有文献を保存', exact: true })
    .click();
  await panel.getByLabel('PDFページ', { exact: true }).fill('12');
  await panel
    .getByRole('button', { name: '図の編集を適用', exact: true })
    .click();
  const original = await json(page);
  expect(figure(original).attrs.figureEdit).toMatchObject({
    name: '比較の模式図',
    crop: { x: 5, width: 90 },
    source: { referenceId: 'study-2026', pdfPage: '12' },
    annotations: [{ text: '原図の注目箇所' }],
  });
  expect(figure(original).attrs.figureEdit!.svgSource).toContain('応答を比較');
  expect(figure(original).attrs.figureEdit!.svgSource).toContain(
    'marker-start="url(#arrow)"',
  );
  for (const format of ['html', 'zip'] as const) {
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'html' ? '編集できるReport HTMLを保存' : 'ZIP',
        exact: true,
      })
      .click();
    const saved = await bytes(await pending);
    const context = await browser.newContext({
      viewport: { width: 1650, height: 1100 },
    });
    const imported = await context.newPage();
    imported.on('dialog', (dialog) => void dialog.accept());
    try {
      await imported.goto('/');
      await expect(
        imported.locator('[contenteditable="true"][aria-label="文書本文"]'),
      ).toBeVisible();
      await imported.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
        name: `roundtrip.${format}`,
        mimeType: format === 'html' ? 'text/html' : 'application/zip',
        buffer: saved,
      });
      if (format === 'html')
        await imported
          .getByRole('dialog', { name: 'HTML取込の確認' })
          .getByRole('button', { name: '確認して取り込む', exact: true })
          .click();
      await expect(imported.locator('.kumi-editor-content img')).toBeVisible();
      expect(figure(await json(imported)).attrs.figureEdit).toEqual(
        figure(original).attrs.figureEdit,
      );
      await imported.locator('.kumi-editor-content img').click();
      const properties = imported.getByRole('group', {
        name: '図解・原図・出典',
        exact: true,
      });
      await properties
        .getByText('SVGソース・ラベルを編集', { exact: true })
        .click();
      await properties
        .getByLabel('SVGラベル 2', { exact: true })
        .fill('再読込後に再修正');
      await properties
        .getByText('原画像の切り抜き・注釈', { exact: true })
        .click();
      await properties
        .getByRole('button', { name: '切り抜きを解除', exact: true })
        .click();
      await properties.getByText('図の由来・共有文献', { exact: true }).click();
      await properties
        .getByLabel('文献の題名', { exact: true })
        .fill('修正した文献');
      await properties
        .getByRole('button', { name: '共有文献を保存', exact: true })
        .click();
      await properties
        .getByRole('button', { name: '図の編集を適用', exact: true })
        .click();
      const revised = await json(imported);
      expect(figure(revised).attrs.figureEdit!.crop).toBeUndefined();
      expect(figure(revised).attrs.figureEdit!.svgSource).toContain(
        '再読込後に再修正',
      );
      expect(revised.metadata.figure_references).toMatchObject([
        { title: '修正した文献' },
      ]);
      await imported
        .getByRole('button', { name: '完成プレビューへ切り替え' })
        .click();
      await expect(
        imported.locator('.report-preview .figure-edit-graphic'),
      ).toBeVisible();
      await expect(
        imported.locator('.report-preview .figure-source'),
      ).toContainText('修正した文献');
      expect(
        await imported
          .locator('.report-preview .figure-edit-graphic image')
          .getAttribute('href'),
      ).toContain('data:image/svg+xml');
    } finally {
      await context.close();
    }
  }
});

test('原図の素材ファイルを保持して切り抜き、ZIP再読込後に全体へ戻せる', async ({
  page,
  browser,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1650, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'original.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# 原図の切り抜き\n\n![原資料の図](original.svg)'),
    },
    {
      name: 'original.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#eef2ff"/><path d="M40 30 V160 H360" fill="none" stroke="#1e3a8a" stroke-width="3"/><text x="160" y="190">原図の軸ラベル</text><text x="240" y="40">凡例</text></svg>',
      ),
    },
  ]);
  await expect(page.locator('.kumi-editor-content img')).toBeVisible();
  await page.locator('.kumi-editor-content img').click();
  const properties = page.getByRole('group', {
    name: '図解・原図・出典',
    exact: true,
  });
  await expect(properties).toContainText('画像として配置しています');
  await properties.getByText('原画像の切り抜き・注釈', { exact: true }).click();
  await properties.getByLabel('切り抜きX (%)', { exact: true }).fill('10');
  await properties.getByLabel('切り抜きY (%)', { exact: true }).fill('10');
  await properties.getByLabel('切り抜き幅 (%)', { exact: true }).fill('80');
  await properties.getByLabel('切り抜き高さ (%)', { exact: true }).fill('70');
  await properties
    .getByRole('button', { name: '図の編集を適用', exact: true })
    .click();
  const original = await json(page);
  expect(figure(original).attrs.src).toBe('original.svg');
  expect(figure(original).attrs.figureEdit!.imageSize).toEqual({
    width: 400,
    height: 200,
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP', exact: true }).click();
  const saved = await bytes(await pending);
  const context = await browser.newContext({
    viewport: { width: 1650, height: 1100 },
  });
  const imported = await context.newPage();
  try {
    await imported.goto('/');
    await expect(
      imported.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await imported.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'image.zip',
      mimeType: 'application/zip',
      buffer: saved,
    });
    await expect(imported.locator('.kumi-editor-content img')).toBeVisible();
    const restored = figure(await json(imported));
    expect(restored.attrs.figureEdit).toEqual(
      figure(original).attrs.figureEdit,
    );
    await imported.locator('.kumi-editor-content img').click();
    const panel = imported.getByRole('group', {
      name: '図解・原図・出典',
      exact: true,
    });
    await panel.getByText('原画像の切り抜き・注釈', { exact: true }).click();
    await panel
      .getByRole('button', { name: '切り抜きを解除', exact: true })
      .click();
    await panel
      .getByRole('button', { name: '図の編集を適用', exact: true })
      .click();
    expect(figure(await json(imported)).attrs.figureEdit!.crop).toBeUndefined();
    await imported
      .getByRole('button', { name: '完成プレビューへ切り替え' })
      .click();
    await expect(imported.locator('.report-preview img')).toHaveJSProperty(
      'naturalWidth',
      400,
    );
  } finally {
    await context.close();
  }
});
