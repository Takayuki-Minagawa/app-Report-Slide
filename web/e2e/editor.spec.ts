import { expect, test, type Page } from '@playwright/test';

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

test('Markdownの不正入力を拒否して現在文書を維持する', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/KUMI/);
  await expect(page.getByText('REPORT', { exact: true })).toBeVisible();
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
