import { expect, test, type Page } from '@playwright/test';

async function indentRatio(page: Page, text: string, preview = false) {
  return page
    .locator(preview ? '.document-renderer > p' : '.tiptap > p')
    .filter({ hasText: text })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return parseFloat(style.textIndent) / parseFloat(style.fontSize);
    });
}

test('本文書式と段落の例外を編集・保存・再読込して保持する', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .fill(
      '# 報告書\n\n見出し直後の本文です。\n\n通常の本文です。\n\n$$\nx=1\n$$\n\nここで、変数を説明します。\n\n左右位置を保つ段落です。\n{text_ruler=10,5,15}',
    );
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await page
    .getByRole('combobox', { name: '本文書式プリセット' })
    .selectOption('heading');
  await page.getByRole('button', { name: 'ページ設定を適用' }).click();
  await expect.poll(() => indentRatio(page, '見出し直後')).toBeCloseTo(0, 3);
  await expect.poll(() => indentRatio(page, '通常の本文')).toBeCloseTo(1, 3);

  const controls = page.getByRole('group', { name: '段落の字下げ' }).first();
  await page.locator('.tiptap > p').filter({ hasText: 'ここで' }).click();
  await controls.getByRole('button', { name: '下げない', exact: true }).click();
  await expect.poll(() => indentRatio(page, 'ここで')).toBeCloseTo(0, 3);
  await page.locator('.tiptap > p').filter({ hasText: '左右位置' }).click();
  await controls
    .getByRole('button', { name: '1字下げる', exact: true })
    .click();
  await expect.poll(() => indentRatio(page, '左右位置')).toBeCloseTo(1, 3);
  const margins = await page
    .locator('.tiptap > p')
    .filter({ hasText: '左右位置' })
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        left: parseFloat(style.marginLeft),
        right: parseFloat(style.marginRight),
      };
    });
  expect(margins.left).toBeGreaterThan(0);
  expect(margins.left / margins.right).toBeCloseTo(2, 2);

  await page.getByRole('spinbutton', { name: '本文サイズ（pt）' }).fill('12');
  await page.getByRole('combobox', { name: '用紙サイズ' }).selectOption('A3');
  await page.getByRole('button', { name: 'ページ設定を適用' }).click();
  await expect.poll(() => indentRatio(page, '左右位置')).toBeCloseTo(1, 3);
  await expect.poll(() => indentRatio(page, 'ここで')).toBeCloseTo(0, 3);

  await page.screenshot({
    path: testInfo.outputPath('paragraph-format-editor.png'),
  });

  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  const saved = await source.inputValue();
  expect(saved).toContain('after_heading_indent: none');
  expect(saved).toContain('first_line_indent=0');
  expect(saved).toContain('first_line_indent=1');
  await source.fill(saved);
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  for (const [text, indent] of [
    ['見出し直後', 0],
    ['通常の本文', 1],
    ['ここで', 0],
    ['左右位置', 1],
  ] as const) {
    await expect
      .poll(() => indentRatio(page, text, true))
      .toBeCloseTo(indent, 3);
  }
  expect(errors).toEqual([]);
});

test('見出し後の例外を上書きでき、新しい段落は文書設定に戻る', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .fill('# 見出し\n\n段落の本文');
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await page
    .getByRole('combobox', { name: '本文書式プリセット' })
    .selectOption('heading');
  await page.getByRole('button', { name: 'ページ設定を適用' }).click();
  const paragraph = page.locator('.tiptap > p').first();
  await paragraph.click();
  const controls = page.getByRole('group', { name: '段落の字下げ' }).first();
  await controls
    .getByRole('button', { name: '1字下げる', exact: true })
    .click();
  await expect.poll(() => indentRatio(page, '段落の本文')).toBeCloseTo(1, 3);
  await controls
    .getByRole('button', { name: '文書に従う', exact: true })
    .click();
  await expect.poll(() => indentRatio(page, '段落の本文')).toBeCloseTo(0, 3);
  await controls.getByRole('button', { name: '下げない', exact: true }).click();
  await paragraph.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('追加した段落');
  await expect.poll(() => indentRatio(page, '追加した段落')).toBeCloseTo(1, 3);
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  expect(
    await page.getByRole('textbox', { name: 'Markdown原稿' }).inputValue(),
  ).toContain('first_line_indent=inherit');
});
