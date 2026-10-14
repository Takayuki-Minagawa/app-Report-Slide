import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Download, type Page } from '@playwright/test';
import type { DocumentData, FigureNode } from '../src/document/model';

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
const fixtureFont = Buffer.from(
  readFileSync(join(process.cwd(), 'src/export/fonts/KumiPrintSansJP.woff2')),
).toString('base64');

async function bytes(download: Download) {
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
function figure(document: DocumentData): FigureNode {
  return document.children.find((node) => node.type === 'figure') as FigureNode;
}
async function openOcr(page: Page) {
  await selectFigure(page);
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  return page.getByRole('dialog', {
    name: '画像の文字を読み取る',
    exact: true,
  });
}
async function selectFigure(page: Page) {
  await page
    .getByRole('button', { name: '読み取り用の原画像 figure', exact: true })
    .click();
}

test('画像OCRの原本比較・修正・本文挿入をUndoでき、HTML再読込後も原文と切り抜きを保持する', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1650, height: 1100 });
  await page.goto('/');
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await expect(editor).toBeVisible();
  const source = await page.evaluate(async (fontData) => {
    const font = new FontFace(
      'OcrImageFixture',
      `url(data:font/woff2;base64,${fontData})`,
    );
    document.fonts.add(await font.load());
    const canvas = document.createElement('canvas');
    canvas.width = 1500;
    canvas.height = 700;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 1500, 700);
    ctx.fillStyle = 'black';
    ctx.font = '64px OcrImageFixture';
    ctx.fillText('EXCLUDED', 100, 100);
    ctx.fillText('温度 25.0', 100, 320);
    ctx.fillText('Sample 12.5', 100, 450);
    return canvas.toDataURL('image/png');
  }, fixtureFont);
  const original: DocumentData = {
    schemaVersion: 2,
    type: 'report',
    metadata: { title: '画像OCRの検証' },
    children: [
      {
        type: 'figure',
        attrs: {
          nodeId: 'ocr-evidence',
          src: source,
          alt: '読み取り用の原画像',
          title: null,
          width: 100,
          align: 'center',
          figureEdit: {
            version: 1,
            imageSize: { width: 1500, height: 700 },
            crop: { x: 0, y: 25, width: 100, height: 75 },
            annotations: [
              {
                id: 'overlay-note',
                kind: 'text',
                x: 10,
                y: 85,
                x2: 80,
                y2: 95,
                text: 'OVERLAYANNOTATION',
                color: '#000000',
                fontSize: 5,
              },
            ],
          },
        },
      },
      {
        type: 'paragraph',
        attrs: { nodeId: 'tail' },
        content: [{ type: 'text', text: '既存の本文' }],
      },
    ],
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'image-ocr.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(original)),
  });
  await expect(
    page.getByRole('dialog', { name: '画像の文字を読み取る', exact: true }),
  ).toBeHidden();
  const dialog = await openOcr(page);
  const preview = dialog.getByAltText('OCR対象の原画像');
  await expect
    .poll(() =>
      preview.evaluate(
        (image: HTMLImageElement) => image.complete && image.naturalHeight,
      ),
    )
    .toBe(525);
  await dialog
    .getByRole('button', { name: '画像OCRを実行', exact: true })
    .click();
  const result = dialog.getByLabel('画像OCRの認識結果', { exact: true });
  await expect(result).toBeEnabled({ timeout: 90_000 });
  const raw = await result.inputValue();
  expect(raw).toContain('温度');
  expect(raw).toContain('25.0');
  expect(raw).toMatch(/Sample\s*12\.5/);
  expect(raw).not.toContain('EXCLUDED');
  expect(raw).not.toContain('OVERLAYANNOTATION');
  await expect(
    dialog.getByText('読み取り時の原文', { exact: true }).locator('..'),
  ).toHaveJSProperty('open', false);
  const reviewed = '温度は25.0度です。\nSampleの値は12.5です。';
  await result.fill(reviewed);
  await page.screenshot({
    path: testInfo.outputPath('image-ocr-review.png'),
    fullPage: true,
  });
  await dialog
    .getByRole('button', { name: '確認した本文を図の後に挿入', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(editor).toContainText('温度は25.0度です。');
  const after = await json(page);
  const evidence = figure(after).attrs.figureEdit!.extraction!;
  expect(evidence).toMatchObject({
    method: 'ocr',
    mode: 'text',
    text: reviewed,
    rawText: raw,
    language: 'jpn+eng',
  });
  expect(figure(after).attrs.src).toBe(source);
  expect(figure(after).attrs.figureEdit!.crop).toEqual(
    figure(original).attrs.figureEdit!.crop,
  );
  expect(after.children.map((node) => node.type)).toEqual([
    'figure',
    'paragraph',
    'paragraph',
    'paragraph',
  ]);
  await selectFigure(page);
  await expect(
    page.getByText('保存済みの読み取り結果', { exact: true }).locator('..'),
  ).toHaveJSProperty('open', false);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(editor).not.toContainText('温度は25.0度です。');
  expect(figure(await json(page)).attrs.figureEdit?.extraction).toBeUndefined();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(editor).toContainText('温度は25.0度です。');
  expect(figure(await json(page)).attrs.figureEdit?.extraction).toEqual(
    evidence,
  );
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const saved = await bytes(await download);
  const context = await browser.newContext({
    viewport: { width: 1650, height: 1100 },
  });
  const imported = await context.newPage();
  imported.on('dialog', (value) => void value.accept());
  imported.on('pageerror', (error) => errors.push(error.message));
  try {
    await imported.goto('/');
    await expect(
      imported.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await imported.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'image-ocr.html',
      mimeType: 'text/html',
      buffer: saved,
    });
    await imported
      .getByRole('dialog', { name: 'HTML取込の確認' })
      .getByRole('button', { name: '確認して取り込む', exact: true })
      .click();
    await expect(imported.locator('.kumi-editor-content')).toContainText(
      '温度は25.0度です。',
    );
    const reopened = await json(imported);
    expect(figure(reopened).attrs.figureEdit).toEqual(
      figure(after).attrs.figureEdit,
    );
    await selectFigure(imported);
    await expect(
      imported.getByRole('dialog', {
        name: '画像の文字を読み取る',
        exact: true,
      }),
    ).toBeHidden();
    const savedEvidence = imported
      .getByText('保存済みの読み取り結果', { exact: true })
      .locator('..');
    await expect(savedEvidence).toHaveJSProperty('open', false);
    await savedEvidence.locator('summary').first().click();
    await expect(savedEvidence).toContainText(reviewed);
    await savedEvidence.getByText('読み取り原文', { exact: true }).click();
    await expect(savedEvidence).toContainText(raw);
    const reopenedDialog = await openOcr(imported);
    await expect(
      reopenedDialog.getByLabel('画像OCRの認識結果', { exact: true }),
    ).toHaveValue(reviewed);
    await reopenedDialog
      .getByLabel('画像OCRの認識結果', { exact: true })
      .fill('記録だけを再修正');
    await reopenedDialog
      .getByRole('button', { name: '読み取り結果だけ保存', exact: true })
      .click();
    await expect(imported.locator('.kumi-editor-content')).toContainText(
      '温度は25.0度です。',
    );
    await expect(imported.locator('.kumi-editor-content')).not.toContainText(
      '記録だけを再修正',
    );
    expect(
      figure(await json(imported)).attrs.figureEdit?.extraction,
    ).toMatchObject({ text: '記録だけを再修正', rawText: raw });
  } finally {
    await context.close();
  }
  expect(errors).toEqual([]);
});
