import { expect, test, type Locator, type Page } from '@playwright/test';
import type { DocumentData, FigureNode } from '../src/document/model';

const reviewed = '保存済みの確認済み本文';
const rawText = '読み取り時の原文';

test.use({ viewport: { width: 1366, height: 768 }, actionTimeout: 15_000 });
test.setTimeout(120_000);

async function createImage(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 450;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'black';
    context.font = '72px sans-serif';
    context.fillText('KUMI 25.0', 100, 240);
    return canvas.toDataURL('image/png');
  });
}

async function importImage(page: Page, source: string) {
  // Wait for the hydrated editor before uploading into the SSR file control.
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const fixture: DocumentData = {
    schemaVersion: 2,
    type: 'report',
    metadata: { title: 'OCR操作性検証' },
    children: [
      {
        type: 'figure',
        attrs: {
          nodeId: 'ocr-ui',
          src: source,
          alt: 'OCR操作確認画像',
          title: null,
          width: 100,
          align: 'center',
          figureEdit: {
            version: 1,
            imageSize: { width: 1200, height: 450 },
            extraction: {
              mode: 'text',
              method: 'ocr',
              language: 'eng',
              confidence: 92,
              text: reviewed,
              rawText,
              rows: [],
              rawRows: [],
              numericValues: [],
              header: false,
              warnings: [],
            },
          },
        },
      },
      {
        type: 'paragraph',
        attrs: { nodeId: 'original-text' },
        content: [{ type: 'text', text: '既存本文' }],
      },
    ],
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'ocr-usability.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await page
    .getByRole('button', { name: 'OCR操作確認画像 figure', exact: true })
    .click();
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  return page.getByRole('dialog', {
    name: '画像の文字を読み取る',
    exact: true,
  });
}

async function savedFigure(page: Page) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await downloading).createReadStream())!)
    chunks.push(Buffer.from(chunk));
  const document = JSON.parse(Buffer.concat(chunks).toString()) as DocumentData;
  return document.children.find((node) => node.type === 'figure') as FigureNode;
}

async function fullyInViewport(locator: Locator) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.top >= 0 &&
        bounds.left >= 0 &&
        bounds.bottom <= window.innerHeight &&
        bounds.right <= window.innerWidth
      );
    }),
  ).toBe(true);
}

async function fixedDialogActions(dialog: Locator) {
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBe(0);
  await fullyInViewport(
    dialog.getByRole('heading', { name: '画像の文字を読み取る', exact: true }),
  );
  await fullyInViewport(
    dialog.getByRole('button', { name: '読み取り結果だけ保存', exact: true }),
  );
  await fullyInViewport(
    dialog.getByRole('button', {
      name: '確認した本文を図の後に挿入',
      exact: true,
    }),
  );
}

test('OCRは通常画面で拡大照合と保存操作が見え、Escと再実行で未保存の修正を失わない', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const source = await createImage(page);
  const dialog = await importImage(page, source);
  const result = dialog.getByLabel('画像OCRの認識結果', { exact: true });
  await expect(result).toHaveValue(reviewed);
  await expect(dialog.getByLabel('画像OCR言語', { exact: true })).toHaveValue(
    'eng',
  );
  await expect(
    dialog.getByRole('button', { name: '画像OCRを再実行', exact: true }),
  ).toBeEnabled();
  const save = dialog.getByRole('button', {
    name: '読み取り結果だけ保存',
    exact: true,
  });
  await fixedDialogActions(dialog);
  await dialog
    .getByLabel('OCR原画像の表示倍率', { exact: true })
    .selectOption('200');
  const original = dialog.getByRole('region', {
    name: 'OCR原画像の確認',
    exact: true,
  });
  expect(
    await original.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await original.focus();
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(() => original.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  await fixedDialogActions(dialog);
  await result.fill('消してはいけない修正内容');
  await page.keyboard.press('Escape');
  await expect(dialog.getByRole('alert')).toContainText('未保存の変更');
  await expect(
    dialog.getByRole('button', { name: '編集を続ける', exact: true }),
  ).toBeFocused();
  await fullyInViewport(
    dialog.getByRole('button', { name: '変更を破棄して閉じる', exact: true }),
  );
  await fixedDialogActions(dialog);
  await page.screenshot({
    path: testInfo.outputPath('ocr-unsaved-review-1366.png'),
  });
  await page.keyboard.press('Enter');
  await expect(result).toBeFocused();
  await fixedDialogActions(dialog);
  await expect(result).toHaveValue('消してはいけない修正内容');
  await dialog
    .getByRole('button', { name: '画像OCRを再実行', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toContainText(
    '新しい結果に置き換えます',
  );
  await dialog
    .getByRole('button', { name: '編集を続ける', exact: true })
    .click();
  await expect(result).toHaveValue('消してはいけない修正内容');
  await save.click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.kumi-editor-content')).not.toContainText(
    '消してはいけない修正内容',
  );
  expect((await savedFigure(page)).attrs.figureEdit?.extraction).toMatchObject({
    text: '消してはいけない修正内容',
    rawText,
  });
  await page
    .getByRole('button', { name: 'OCR操作確認画像 figure', exact: true })
    .click();
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  await expect(result).toHaveValue('消してはいけない修正内容');
  await dialog
    .getByRole('button', { name: '画像OCRを閉じる', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  await result.fill('破棄する修正');
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await dialog
    .getByRole('button', { name: '変更を破棄して閉じる', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect((await savedFigure(page)).attrs.figureEdit?.extraction?.text).toBe(
    '消してはいけない修正内容',
  );
});

test('OCR準備の中止・失敗後も修正と原文を保持して、同じ画面から再実行できる', async ({
  page,
}) => {
  await page.goto('/');
  const dialog = await importImage(page, await createImage(page));
  const result = dialog.getByLabel('画像OCRの認識結果', { exact: true });
  await expect(
    dialog.getByRole('button', { name: '画像OCRを再実行', exact: true }),
  ).toBeEnabled();
  await result.fill('中止や失敗でも保持する本文');
  // Stall only these attempts; the final retry uses the real worker and model.
  let stalledAttempts = 0;
  await page.route('**/ocr/**/worker.min.js', (route) => {
    stalledAttempts++;
    return route.fulfill({
      contentType: 'application/javascript',
      body: 'setInterval(() => {}, 1000);',
    });
  });
  await dialog
    .getByRole('button', { name: '画像OCRを再実行', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: '新しい認識結果に置き換える', exact: true })
    .click();
  await expect(
    dialog.getByRole('progressbar', { name: '画像OCRの進捗' }),
  ).toBeVisible();
  await expect.poll(() => stalledAttempts).toBe(1);
  await dialog.getByRole('button', { name: 'OCRを中止', exact: true }).click();
  await expect(result).toBeEnabled();
  await expect(result).toHaveValue('中止や失敗でも保持する本文');
  await expect(dialog.getByRole('status')).toContainText('中止しました');
  await dialog
    .getByRole('button', { name: '画像OCRを再実行', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: '新しい認識結果に置き換える', exact: true })
    .click();
  await expect(
    dialog.getByRole('progressbar', { name: '画像OCRの進捗' }),
  ).toBeVisible();
  await expect.poll(() => stalledAttempts).toBe(2);
  await dialog
    .getByRole('button', { name: '中止して閉じる', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText('中止しました');
  await expect(dialog.getByRole('alert')).toContainText('未保存の変更');
  await expect(
    dialog.getByRole('progressbar', { name: '画像OCRの進捗' }),
  ).toBeHidden();
  await dialog
    .getByRole('button', { name: '編集を続ける', exact: true })
    .click();
  await expect(result).toBeEnabled();
  await expect(result).toHaveValue('中止や失敗でも保持する本文');
  await page.unroute('**/ocr/**/worker.min.js');
  let failedAttempts = 0;
  await page.route('**/ocr/**/worker.min.js', (route) => {
    failedAttempts++;
    return route.abort();
  });
  await dialog
    .getByRole('button', { name: '画像OCRを再実行', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: '新しい認識結果に置き換える', exact: true })
    .click();
  await expect.poll(() => failedAttempts).toBe(1);
  await expect(dialog.getByRole('alert')).toContainText(
    'OCRを開始できませんでした',
  );
  await expect(result).toBeEnabled();
  await expect(result).toHaveValue('中止や失敗でも保持する本文');
  await page.unroute('**/ocr/**/worker.min.js');
  await dialog
    .getByRole('button', { name: '画像OCRを再実行', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: '新しい認識結果に置き換える', exact: true })
    .click();
  await expect(result).toBeEnabled({ timeout: 90_000 });
  await expect(result).toHaveValue(/KUMI\s*25\.0/);
  await expect(dialog.getByRole('status')).toContainText('読み取り完了');
  await dialog.getByText('読み取り時の原文', { exact: true }).click();
  await expect(dialog.locator('pre')).toContainText('KUMI');
  await dialog
    .getByRole('button', { name: '読み取り結果だけ保存', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(
    (await savedFigure(page)).attrs.figureEdit?.extraction?.rawText,
  ).toMatch(/KUMI\s*25\.0/);
});

test('OCR原画像の読み込み失敗を同じ画面から再試行できる', async ({ page }) => {
  await page.goto('/');
  const source = await createImage(page);
  const imageUrl = new URL('ocr-ui-fixture.png', page.url()).href;
  await page.route('**/ocr-ui-fixture.png', (route) =>
    route.fulfill({ status: 503, body: 'image unavailable' }),
  );
  const dialog = await importImage(page, imageUrl);
  await expect(
    dialog.getByRole('button', { name: '原画像を再読み込み', exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '画像OCRを再実行', exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByLabel('画像OCRの認識結果', { exact: true }),
  ).toHaveValue(reviewed);
  await page.unroute('**/ocr-ui-fixture.png');
  await page.route('**/ocr-ui-fixture.png', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(source.split(',')[1], 'base64'),
    }),
  );
  await dialog
    .getByRole('button', { name: '原画像を再読み込み', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: '画像OCRを再実行', exact: true }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      dialog
        .getByAltText('OCR対象の原画像')
        .evaluate(
          (image: HTMLImageElement) => image.complete && image.naturalWidth,
        ),
    )
    .toBe(1200);
  await expect(
    dialog.getByLabel('画像OCRの認識結果', { exact: true }),
  ).toHaveValue(reviewed);
});
