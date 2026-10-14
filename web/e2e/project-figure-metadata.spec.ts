import { expect, test, type Download, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import type { DocumentData } from '../src/document/model';

test.setTimeout(90_000);

async function bytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function openReaderFields(page: Page) {
  const input = page.getByRole('textbox', {
    name: '詳しい説明・研究条件',
    exact: true,
  });
  if (!(await input.isVisible()))
    await page.locator('summary').filter({ hasText: '読者向けの補足' }).click();
  return input;
}

async function editSupplement(
  page: Page,
  title: string,
  text: string,
  url: string,
) {
  await openReaderFields(page);
  await page.getByLabel('補足の見出し', { exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: '詳しい説明・研究条件', exact: true })
    .fill(text);
  await page.getByLabel('文献・PDFのURL', { exact: true }).fill(url);
  await page.getByRole('button', { name: '補足を適用', exact: true }).click();
}

async function citationFields(page: Page) {
  await page.locator('.kumi-editor-content img.kumi-figure').click();
  const panel = page.getByRole('group', {
    name: '図解・原図・出典',
    exact: true,
  });
  const title = panel.getByLabel('文献の題名', { exact: true });
  if (!(await title.isVisible()))
    await panel.getByText('図の由来・共有文献', { exact: true }).click();
  return panel;
}

async function selectChapter(page: Page, title: string) {
  await page
    .getByRole('navigation', { name: '章', exact: true })
    .getByRole('button', { name: new RegExp(title) })
    .click();
  await expect(page.locator('.kumi-editor-content h1')).toHaveText(title);
}

test('章別Reportの共有文献と補足をUIから更新し、ZIP再開と結合HTMLでも両章を保持する', async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1650, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'Alpha.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: report\ntitle: Alpha\n---\n# Alpha\n\n![原図](original.svg)',
      ),
    },
    {
      name: 'original.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#e0f2fe"/><text x="25" y="90" font-size="30">Original evidence</text></svg>',
      ),
    },
  ]);
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('Alpha');
  let citation = await citationFields(page);
  await citation.getByLabel('文献ID', { exact: true }).fill('shared-study');
  await citation
    .getByLabel('文献の題名', { exact: true })
    .fill('共有する元文献');
  await citation.getByLabel('文献の著者', { exact: true }).fill('試験者');
  await citation.getByLabel('文献の年', { exact: true }).fill('2026');
  await citation
    .getByLabel('文献のリンク', { exact: true })
    .fill('https://example.com/shared-study');
  await citation
    .getByRole('button', { name: '共有文献を保存', exact: true })
    .click();
  await citation
    .getByRole('button', { name: '図の編集を適用', exact: true })
    .click();
  await editSupplement(
    page,
    'Alphaの条件',
    '第1章の研究条件：観測値を使用する。',
    'https://example.com/alpha',
  );

  // Reusing a saved chapter intentionally shares its publication ID, while source blocks may reuse local IDs.
  const sourceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const source = JSON.parse(
    new TextDecoder().decode(await bytes(await sourceDownload)),
  ) as DocumentData;
  source.metadata.title = 'Beta';
  const heading = source.children.find((node) => node.type === 'heading')!;
  if (heading.type === 'heading')
    heading.content = [{ type: 'text', text: 'Beta' }];
  await page.locator('summary').filter({ hasText: '章別プロジェクト' }).click();
  await page
    .getByRole('button', { name: '現在のReportをプロジェクト化' })
    .click();
  await expect(page.getByText('PROJECT', { exact: true })).toBeVisible();
  await page.getByLabel('原稿を章として追加').setInputFiles([
    {
      name: 'Beta.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(source)),
    },
    {
      name: 'original.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#e0f2fe"/><text x="25" y="90" font-size="30">Original evidence</text></svg>',
      ),
    },
  ]);
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('Beta');
  await page.getByLabel('章の前で改ページ', { exact: true }).uncheck();
  citation = await citationFields(page);
  await expect(citation.getByLabel('文献の題名', { exact: true })).toHaveValue(
    '共有する元文献',
  );
  await citation
    .getByLabel('文献の題名', { exact: true })
    .fill('両章へ反映する改訂文献');
  await citation
    .getByRole('button', { name: '共有文献を保存', exact: true })
    .click();
  await editSupplement(
    page,
    'Betaの条件',
    '第2章の研究条件：解析値を比較する。',
    'https://example.com/beta',
  );
  await selectChapter(page, 'Alpha');
  citation = await citationFields(page);
  await expect(citation.getByLabel('文献の題名', { exact: true })).toHaveValue(
    '両章へ反映する改訂文献',
  );
  await expect(await openReaderFields(page)).toHaveValue(
    '第1章の研究条件：観測値を使用する。',
  );
  await selectChapter(page, 'Beta');
  await expect(await openReaderFields(page)).toHaveValue(
    '第2章の研究条件：解析値を比較する。',
  );
  const zipDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'プロジェクトZIPを保存', exact: true })
    .click();
  const zip = await bytes(await zipDownload);

  const freshContext = await browser.newContext({
    viewport: { width: 1650, height: 1100 },
  });
  try {
    const fresh = await freshContext.newPage();
    fresh.on('pageerror', (error) => errors.push(error.message));
    fresh.on('dialog', (dialog) => void dialog.accept());
    await fresh.goto('/');
    await expect(
      fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await fresh
      .locator('summary')
      .filter({ hasText: '章別プロジェクト' })
      .click();
    await fresh.getByLabel('プロジェクトZIPを開く').setInputFiles({
      name: 'reopen.kumi.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
    await expect(fresh.locator('.kumi-editor-content h1')).toHaveText('Alpha');
    await expect(await openReaderFields(fresh)).toHaveValue(
      '第1章の研究条件：観測値を使用する。',
    );
    citation = await citationFields(fresh);
    await expect(
      citation.getByLabel('文献の題名', { exact: true }),
    ).toHaveValue('両章へ反映する改訂文献');
    await selectChapter(fresh, 'Beta');
    await expect(await openReaderFields(fresh)).toHaveValue(
      '第2章の研究条件：解析値を比較する。',
    );
    citation = await citationFields(fresh);
    await expect(
      citation.getByLabel('文献の題名', { exact: true }),
    ).toHaveValue('両章へ反映する改訂文献');
    const htmlDownload = fresh.waitForEvent('download');
    await fresh
      .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
      .click();
    const htmlPath = testInfo.outputPath('combined-report.html');
    await (await htmlDownload).saveAs(htmlPath);
    const reader = await freshContext.newPage();
    reader.on('pageerror', (error) => errors.push(error.message));
    await reader.goto(pathToFileURL(htmlPath).href);
    await expect(reader.locator('.report-sheet')).toHaveCount(1);
    await expect(
      reader.getByRole('link', { name: /両章へ反映する改訂文献/ }),
    ).toHaveCount(2);
    await reader
      .getByRole('button', { name: '詳しい説明', exact: true })
      .click();
    const modal = reader.getByRole('dialog');
    await expect(modal).toContainText('第1章の研究条件：観測値を使用する。');
    await expect(modal).toContainText('第2章の研究条件：解析値を比較する。');
    await expect(
      modal.locator('a[href="https://example.com/alpha"]'),
    ).toHaveCount(1);
    await expect(
      modal.locator('a[href="https://example.com/beta"]'),
    ).toHaveCount(1);
  } finally {
    await freshContext.close();
  }
  expect(errors).toEqual([]);
});
