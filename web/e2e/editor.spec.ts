import { expect, test, type Download, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function waitForEditor(page: Page): Promise<void> {
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test('Markdownの不正入力を拒否して現在文書を維持する', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/KUMI/);
  await expect(page.getByText('REPORT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(page.locator('.kumi-editor-content')).toContainText('解析概要');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  await expect(source).toHaveValue(/type: report/);
  await source.fill('---\ntype: book\n---\n\n# 壊れた文書');
  await page.getByRole('button', { name: 'Markdownを適用' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'Markdownを適用できませんでした',
  );
  await expect(page.getByText('REPORT', { exact: true })).toBeVisible();
});

test('新規Slideを作成して完成プレビューへ切り替える', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await expect(page.getByText('SLIDE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();

  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.slide-preview')).toBeVisible();
  await expect(page.locator('.slide-preview')).toContainText('タイトル');
});

test('数式と表を挿入してDocumentを編集できる', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'インライン数式' }).click();
  await expect(page.locator('[data-type="inline-math"]')).toHaveCount(2);

  await page.getByRole('button', { name: '表を挿入' }).click();
  await expect(page.locator('.kumi-editor-content table')).toHaveCount(2);
  await expect(page.getByLabel('未保存')).toBeVisible();
});

test('Markdown下書きをタブ間で保持し保存時に現在文書へ適用する', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  const draft =
    '---\ntype: report\ntitle: 下書き保存テスト\ntheme: calculation\n---\n\n# 保存後の本文\n\n下書きの内容';
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'やり直す' })).toBeDisabled();
  await expect(page.getByRole('combobox')).toBeDisabled();
  await source.fill(draft);
  await expect(page.getByLabel('未保存')).toBeVisible();

  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(source).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Markdownの変更を先に処理してください',
  );
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await expect(source).toHaveValue(draft);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const downloaded = await downloadText(await downloadPromise);
  expect(downloaded).toContain('# 保存後の本文');
  expect(downloaded).toContain('下書きの内容');

  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(page.locator('.kumi-editor-content')).toContainText(
    '下書きの内容',
  );
  await expect(page.getByLabel('未保存')).toHaveCount(0);
});

test('Markdownと同時選択した相対画像をEditorとPreviewで表示する', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByLabel('Markdownファイル').setInputFiles([
    {
      name: 'local-report.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: report\ntitle: 画像テスト\ntheme: latex\n---\n\n![応答図](images/response.svg)',
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

  const editorImage = page.locator('.kumi-editor-content img.kumi-figure');
  await expect(editorImage).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const previewImage = page.locator('.preview-figure img');
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveAttribute('src', /^blob:/);
});
