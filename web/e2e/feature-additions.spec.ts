import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test.setTimeout(60_000);

test('画像込みZIP、検索置換、グラフ、Report HTMLを再開して印刷できる', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const chart = JSON.stringify({
    type: 'chart',
    attrs: {
      nodeId: 'chart-source',
      chartType: 'line',
      data: [
        { label: '一', x: 1, y: 2 },
        { label: '二', x: 2, y: 4 },
      ],
      xLabel: '時間',
      yLabel: '変位',
      series: '実測',
      alt: '変位のグラフ',
      width: 90,
      caption: '試験結果',
    },
  });
  await page.getByLabel('Markdownファイル').setInputFiles([
    {
      name: 'report.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        `---\ntype: report\ntitle: 機能検証\n---\n\n# 地震レポート\n\n地震の応答。\n\n![図](images/chart.svg)\n\n::: kumi-chart\n${chart}\n:::`,
      ),
    },
    {
      name: 'chart.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>',
      ),
    },
  ]);
  await page.getByRole('button', { name: '検索と置換' }).click();
  await page.getByRole('textbox', { name: '検索語' }).fill('地震');
  await expect(page.getByText('1 / 2')).toBeVisible();
  await page.getByRole('textbox', { name: '置換後の文字列' }).fill('風');
  await page.getByRole('button', { name: 'すべて置換' }).click();
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.report-preview svg[role="img"]')).toHaveCount(1);
  await expect(page.locator('.report-preview')).toContainText('風レポート');

  const zipPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ZIP', exact: true }).click();
  const zip = await zipPromise;
  const chunks: Buffer[] = [];
  for await (const chunk of (await zip.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  await page.getByLabel('Markdownファイル').setInputFiles({
    name: 'reopen.zip',
    mimeType: 'application/zip',
    buffer: Buffer.concat(chunks),
  });
  await expect(page.locator('.report-preview svg[role="img"]')).toHaveCount(1);
  await expect(page.locator('.report-preview img')).toHaveCount(1);
  await expect(page.locator('.report-preview img')).toHaveJSProperty(
    'complete',
    true,
  );

  const htmlPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Report HTMLを出力' }).click();
  const htmlDownload = await htmlPromise;
  const path = testInfo.outputPath('report.html');
  await htmlDownload.saveAs(path);
  const html = await readFile(path, 'utf8');
  expect(html).toContain('data:image/svg+xml;base64,');
  expect(html).toContain('変位のグラフ');
  const offline = await browser.newContext({ offline: true });
  try {
    const printed = await offline.newPage();
    printed.on('pageerror', (error) => errors.push(error.message));
    await printed.goto(pathToFileURL(path).href);
    await expect(printed.locator('.report-sheet svg[role="img"]')).toHaveCount(
      1,
    );
    await expect(printed.locator('#overflow-warning')).toBeVisible();
    const pdf = await printed.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  } finally {
    await offline.close();
  }
  expect(errors).toEqual([]);
});
