import { expect, test, type Download, type Page } from '@playwright/test';

test.use({ viewport: { width: 1366, height: 900 }, actionTimeout: 15_000 });
test.setTimeout(150_000);

async function imageFile(page: Page, mime = 'image/png') {
  const source = await page.evaluate((type) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1000;
    canvas.height = 360;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1000, 360);
    context.fillStyle = '#172a41';
    context.font = '72px sans-serif';
    context.fillText('Sample 25.0', 75, 200);
    return canvas.toDataURL(type);
  }, mime);
  return {
    name: `OCR-sample.${mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : 'webp'}`,
    mimeType: mime,
    buffer: Buffer.from(source.split(',')[1], 'base64'),
  };
}
async function downloadBytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function ready(page: Page) {
  await page.goto('/');
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await expect(editor).toBeVisible();
  return editor;
}

async function expectOcrSnapshot(page: Page, raw: string) {
  await page
    .locator('[contenteditable="true"][aria-label="文書本文"] img')
    .click();
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: '画像の文字を読み取る',
    exact: true,
  });
  await expect(
    dialog.getByLabel('画像OCRの認識結果', { exact: true }),
  ).toHaveValue('確認した値は25.0です。');
  await dialog.getByText('読み取り時の原文', { exact: true }).click();
  await expect(dialog.locator('pre')).toHaveText(raw);
  await dialog
    .getByRole('button', { name: '画像OCRを閉じる', exact: true })
    .click();
  await expect(dialog).toBeHidden();
}

test('Reportの段落後へPNGを挿入し、そのままOCRで読み取り、HTMLとZIPから再編集できる', async ({
  page,
  browser,
}, testInfo) => {
  const editor = await ready(page);
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Report', exact: true }).click();
  await editor.locator('h1').fill('OCR素材を使ったレポート');
  await editor.locator('p').first().fill('検査メモ');
  await expect(editor.locator('p').first()).toHaveText('検査メモ');
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(editor.locator('p')).toHaveCount(2);
  await page.keyboard.insertText('既存の結論');
  await expect(editor.locator('p')).toHaveText(['検査メモ', '既存の結論']);
  await editor.getByText('検査メモ', { exact: true }).click();
  const image = await imageFile(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '画像を挿入', exact: true }).click();
  await (await chooser).setFiles(image);
  await expect(editor.locator('img')).toHaveCount(1);
  await expect
    .poll(() =>
      editor
        .locator('img')
        .evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth,
        ),
    )
    .toBe(1000);
  await expect(
    page.getByRole('status', { name: '図表の挿入結果' }),
  ).toContainText('1ページ');
  await expect(
    page.getByRole('button', {
      name: '画像の文字をOCRで読み取る',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '画像の文字をOCRで読み取る', exact: true })
    .click();
  const ocr = page.getByRole('dialog', {
    name: '画像の文字を読み取る',
    exact: true,
  });
  await ocr.getByLabel('画像OCR言語', { exact: true }).selectOption('eng');
  await ocr.getByRole('button', { name: '画像OCRを実行', exact: true }).click();
  const result = ocr.getByLabel('画像OCRの認識結果', { exact: true });
  await expect(result).toBeEnabled({ timeout: 90_000 });
  await expect(result).toHaveValue(/Sample\s*25\.0/);
  const rawRecognition = await result.inputValue();
  await result.fill('確認した値は25.0です。');
  await ocr
    .getByRole('button', { name: '確認した本文を図の後に挿入', exact: true })
    .click();
  await expect(ocr).toBeHidden();
  await expect(editor.locator('p')).toHaveText([
    '検査メモ',
    '確認した値は25.0です。',
    '既存の結論',
  ]);
  await page.screenshot({ path: testInfo.outputPath('report-image-ocr.png') });
  for (const format of ['html', 'zip'] as const) {
    const downloading = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'html' ? '編集できるReport HTMLを保存' : 'ZIP',
        exact: true,
      })
      .click();
    const saved = await downloadBytes(await downloading);
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
    });
    try {
      const restored = await context.newPage();
      const restoredEditor = await ready(restored);
      await restored.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
        name: `image-report.${format}`,
        mimeType: format === 'html' ? 'text/html' : 'application/zip',
        buffer: saved,
      });
      if (format === 'html')
        await restored
          .getByRole('dialog', { name: 'HTML取込の確認' })
          .getByRole('button', { name: '確認して取り込む', exact: true })
          .click();
      await expect(restoredEditor.locator('h1')).toHaveText(
        'OCR素材を使ったレポート',
      );
      await expect(restoredEditor.locator('p')).toHaveText([
        '検査メモ',
        '確認した値は25.0です。',
        '既存の結論',
      ]);
      await expect
        .poll(() =>
          restoredEditor
            .locator('img')
            .evaluate(
              (element: HTMLImageElement) =>
                element.complete && element.naturalWidth,
            ),
        )
        .toBe(1000);
      await expectOcrSnapshot(restored, rawRecognition);
      await restoredEditor
        .getByText('確認した値は25.0です。', { exact: true })
        .fill('再確認した値は25.0です。');
      await expect(restoredEditor.locator('p')).toHaveText([
        '検査メモ',
        '再確認した値は25.0です。',
        '既存の結論',
      ]);
      const redownload = restored.waitForEvent('download');
      await restored
        .getByRole('button', {
          name: '編集できるReport HTMLを保存',
          exact: true,
        })
        .click();
      const revisedHtml = await downloadBytes(await redownload);
      const reopenedContext = await browser.newContext({
        viewport: { width: 1366, height: 900 },
      });
      try {
        const reopened = await reopenedContext.newPage();
        const reopenedEditor = await ready(reopened);
        await reopened
          .getByLabel('HTML・Markdown・JSONファイル')
          .setInputFiles({
            name: `revised-from-${format}.html`,
            mimeType: 'text/html',
            buffer: revisedHtml,
          });
        await reopened
          .getByRole('dialog', { name: 'HTML取込の確認' })
          .getByRole('button', { name: '確認して取り込む', exact: true })
          .click();
        await expect(reopenedEditor.locator('p')).toHaveText([
          '検査メモ',
          '再確認した値は25.0です。',
          '既存の結論',
        ]);
        await expect(reopenedEditor.locator('img')).toHaveCount(1);
        await expect
          .poll(() =>
            reopenedEditor
              .locator('img')
              .evaluate(
                (element: HTMLImageElement) =>
                  element.complete && element.naturalWidth,
              ),
          )
          .toBe(1000);
        // Editing document prose must not rewrite the original reviewed OCR snapshot.
        await expectOcrSnapshot(reopened, rawRecognition);
      } finally {
        await reopenedContext.close();
      }
    } finally {
      await context.close();
    }
  }
});

test('Slideでも通常ツールバーから同じ画像を再選択でき、JPEG/WebPの追加とUndo/Redoができる', async ({
  page,
}) => {
  const editor = await ready(page);
  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await editor.locator('p').first().click();
  const picker = page.getByLabel('挿入する画像ファイル', { exact: true });
  const png = await imageFile(page);
  await picker.setInputFiles(png);
  await expect(editor.locator('img')).toHaveCount(1);
  await expect(picker).toHaveValue('');
  await picker.setInputFiles(png);
  await expect(editor.locator('img')).toHaveCount(2);
  await picker.setInputFiles(await imageFile(page, 'image/jpeg'));
  await picker.setInputFiles(await imageFile(page, 'image/webp'));
  await expect(editor.locator('img')).toHaveCount(4);
  for (const image of await editor.locator('img').all())
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth,
        ),
      )
      .toBe(1000);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(editor.locator('img')).toHaveCount(4);
  await expect
    .poll(() =>
      editor
        .locator('img')
        .last()
        .evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth,
        ),
    )
    .toBe(1000);
  await picker.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Not an image'),
  });
  await expect(
    page.getByRole('toolbar', { name: '書式' }).getByRole('alert'),
  ).toContainText('notes.txt');
  await expect(editor.locator('img')).toHaveCount(4);
});
