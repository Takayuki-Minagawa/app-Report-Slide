import { expect, test, type Download } from '@playwright/test';

async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const source = `---
type: report
title: 実ページ番号の検証
toc: true
number_sections: true
report_settings:
  cover: true
  toc_page: true
  toc_page_numbers: true
  list_tables: true
  heading_numbering: chapter
---

# はじめに
{#sec:first}

${Array.from({ length: 14 }, (_, i) => `${i + 1}.ではなく本文です。` + '自動改ページの結果を目次のページ番号へ反映します。'.repeat(12)).join('\n\n')}

# 調査結果
{#sec:last}

| 項目 | 内容 |
| --- | --- |
| 実ページ | 自動改ページ後の位置 |

{#tab:result caption="結果一覧"}
`;

test('完成プレビュー・HTML・印刷PDF・直接PDFの実ページ番号と枚数が一致する', async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'pages.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(page.getByLabel('目次に実際のページ番号を表示')).toBeChecked();
  const htmlDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存' })
    .click();
  const downloaded = await htmlDownload;
  await downloaded.saveAs(testInfo.outputPath('physical-export.html'));
  const html = (await bytes(downloaded)).toString('utf8');
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const preview = page.frameLocator(
    'iframe[title="組版後のレポートプレビュー"]',
  );
  await expect(preview.locator('html')).toHaveAttribute(
    'data-kumi-pagination',
    'ready',
    { timeout: 30000 },
  );
  const pageCount = await preview.locator('.pagedjs_page').count();
  expect(pageCount).toBeGreaterThan(3);
  const tocNumbers = await preview
    .locator('[data-toc-target]')
    .allTextContents();
  expect(tocNumbers[0]).toBe('1');
  expect(Number(tocNumbers[1])).toBeGreaterThan(1);
  expect(tocNumbers[2]).toBe(tocNumbers[1]);
  expect(
    await preview.locator('.kumi-physical-footer').allTextContents(),
  ).toEqual(Array.from({ length: pageCount - 2 }, (_, i) => String(i + 1)));

  const exported = await page.context().newPage();
  await exported.setViewportSize({ width: 1100, height: 1500 });
  await exported.route('**/physical-export.html', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await exported.goto('/physical-export.html');
  await expect(exported.locator('html')).toHaveAttribute(
    'data-kumi-pagination',
    'ready',
  );
  await expect(exported.locator('.pagedjs_page')).toHaveCount(pageCount);
  expect(await exported.locator('[data-toc-target]').allTextContents()).toEqual(
    tocNumbers,
  );
  await exported
    .locator('.pagedjs_page')
    .nth(1)
    .screenshot({ path: testInfo.outputPath('physical-contents.png') });
  const printPdf = await exported.pdf({
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
    path: testInfo.outputPath('physical-print.pdf'),
  });
  expect(
    Buffer.from(printPdf)
      .toString('latin1')
      .match(/\/Type \/Page\b/g),
  ).toHaveLength(pageCount);
  await exported.close();

  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを出力', exact: true }).click();
  const pdf = await pdfDownload;
  await pdf.saveAs(testInfo.outputPath('physical-direct.pdf'));
  expect(
    (await bytes(pdf)).toString('latin1').match(/\/Type \/Page\b/g),
  ).toHaveLength(pageCount);
  await expect(page.locator('iframe[data-kumi-pdf]')).toHaveCount(0);

  await page.getByRole('button', { name: '出力比較・検索できるPDF' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '印刷用紙', exact: true }).click();
  await expect(
    dialog.getByText(`${pageCount} ページ（組版済み）`, { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '印刷／PDF保存', exact: true }),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
