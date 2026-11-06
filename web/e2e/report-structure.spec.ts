import { expect, test, type Download } from '@playwright/test';

async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

const figure = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#326787"/></svg>',
);
const source = `# はじめに
{#sec:intro}

本文です。[@sec:appendix]と[@eq:second]を参照します。

## 概要

### 詳細

## 内部メモ
{toc=false}

![構成](figure.svg)
{#fig:overview caption="構成図" width=30%}

::: pagebreak
:::

# 結果

| 項目 | 値 |
| --- | --- |
| 結果 | 1 |

{#table:result caption="結果表"}

$$
x = 1
$$
{#eq:second caption="評価式"}

::: pagebreak
:::

# 追加資料
{#sec:appendix appendix=true}

$$
y = 2
$$
{#eq:appendix caption="補足式"}
`;

test('表紙・目次・章別番号を設定しHTMLとMarkdownで保持する', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'report.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(source),
    },
    { name: 'figure.svg', mimeType: 'image/svg+xml', buffer: figure },
  ]);
  await expect(page.locator('.tiptap h1').first()).toHaveText('はじめに');
  await page.getByRole('checkbox', { name: '表紙を付ける' }).check();
  await page.getByLabel('報告書の題名', { exact: true }).fill('構造検討報告書');
  await page.getByLabel('著者', { exact: true }).fill('作成担当');
  await page.getByLabel('所属', { exact: true }).fill('技術部');
  await page.getByLabel('報告書番号', { exact: true }).fill('R-001');
  await page.getByRole('checkbox', { name: '章・節番号を表示' }).check();
  await page
    .getByRole('combobox', { name: '章・節の番号書式' })
    .selectOption('chapter');
  await page
    .getByRole('combobox', { name: '図・表・式の番号' })
    .selectOption('chapter');
  await page.getByRole('checkbox', { name: '見出しの目次を付ける' }).check();
  await page
    .getByRole('combobox', { name: '目次に含める見出し' })
    .selectOption('2');
  await page.getByRole('checkbox', { name: '図目次を付ける' }).check();
  await page.getByRole('checkbox', { name: '表目次を付ける' }).check();
  await page
    .getByRole('checkbox', { name: '目次・図表目次を独立ページにする' })
    .check();
  await page.getByRole('button', { name: '報告書の構成を適用' }).click();
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const cover = page.locator('[data-report-page-kind="cover"]');
  await expect(cover).toContainText('構造検討報告書');
  await expect(cover).toContainText('技術部');
  await expect(cover.locator('footer')).toHaveCount(0);
  await expect(page.locator('.report-preview')).toHaveCount(5);
  const contents = page.locator('[data-report-page-kind="contents"]');
  const toc = contents.getByRole('navigation', { name: '目次', exact: true });
  await expect(toc).toContainText('第1章');
  await expect(toc).toContainText('1.1');
  await expect(toc).not.toContainText('内部メモ');
  await expect(toc).not.toContainText('詳細');
  await expect(
    contents.getByRole('navigation', { name: '図目次' }),
  ).toContainText('1.1');
  await expect(
    contents.getByRole('navigation', { name: '表目次' }),
  ).toContainText('2.1');
  const body = page.locator('[data-report-page-kind="body"]');
  await expect(body.first().locator('footer')).toHaveText('1');
  await expect(body.first()).toContainText('式 2.1');
  await expect(body.nth(1)).toContainText('(2.1)');
  await expect(body.last()).toContainText('付録 A');
  await expect(body.last()).toContainText('(A.1)');
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const html = await downloadText(await downloading);
  expect(html).toContain('data-report-page-kind="cover"');
  expect(html).toContain('data-report-page-kind="contents"');
  expect(html).toContain('R-001');
  expect(html).toContain('(A.1)');
  const exported = await page.context().newPage();
  await exported.setViewportSize({ width: 1100, height: 1500 });
  await exported.route('**/report-export.html', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await exported.goto('/report-export.html');
  await expect(exported.locator('.document-toc ol').first()).toHaveCSS(
    'list-style-type',
    'none',
  );
  await exported.locator('[data-report-page-kind="cover"]').screenshot({
    path: testInfo.outputPath('report-cover.png'),
  });
  await exported.locator('[data-report-page-kind="contents"]').screenshot({
    path: testInfo.outputPath('report-contents.png'),
  });
  await exported.close();

  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const text = page.getByRole('textbox', { name: 'Markdown原稿' });
  const saved = await text.inputValue();
  expect(saved).toContain('report_settings:');
  expect(saved).toContain('appendix=true');
  expect(saved).toContain('toc=false');
  expect(saved).not.toContain('# 構造検討報告書');
  await text.fill(saved);
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.report-preview')).toHaveCount(5);
  await expect(page.locator('[data-report-page-kind="cover"]')).toContainText(
    'R-001',
  );
  expect(errors).toEqual([]);
});
