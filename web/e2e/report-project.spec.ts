import { expect, test, type Download, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function downloadBytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

const sourceInput = (page: Page) =>
  page.locator('input[type="file"][aria-label="原稿を章として追加"]');
const projectInput = (page: Page) =>
  page.locator('input[type="file"][aria-label="プロジェクトZIPを開く"]');

function source(title: string, body: string) {
  return {
    name: `${title}.md`,
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      `---\ntype: report\ntitle: ${title}\n---\n\n# ${title}\n\n${body}`,
    ),
  };
}
function image(color: string) {
  return {
    name: 'same.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="${color}"/></svg>`,
    ),
  };
}

test('章別レポートを画像・除外設定ごとZIP保存し再開できる', async ({
  page,
}) => {
  await page
    .getByLabel('Markdownファイル')
    .setInputFiles([
      source('Alpha', '[@fig:beta]\n\n![Alpha image](same.svg)\n{#fig:alpha}'),
      image('blue'),
    ]);
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('Alpha');
  await page
    .getByRole('button', { name: '現在のReportをプロジェクト化' })
    .click();
  await expect(page.getByText('PROJECT', { exact: true })).toBeVisible();
  await sourceInput(page).setInputFiles([
    source('Beta', '![Beta image](same.svg)\n{#fig:beta}'),
    image('red'),
  ]);
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('Beta');
  await expect(page.locator('.kumi-editor-content')).not.toContainText('Alpha');
  await page
    .getByLabel('プロジェクト名', { exact: true })
    .fill('Combined report');
  await page.getByLabel('節番号', { exact: true }).check();
  await page.getByLabel('目次', { exact: true }).check();
  const chapterDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '章 JSON', exact: true }).click();
  expect(
    JSON.parse((await downloadBytes(await chapterDownload)).toString()).metadata
      .title,
  ).toBe('Beta');
  await expect(page.getByLabel('未保存')).toBeVisible();

  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.report-preview')).toHaveCount(1);
  await expect(page.locator('.report-preview')).toHaveAttribute(
    'data-page',
    '1',
  );
  await page.getByRole('link', { name: '図 2', exact: true }).click();
  await expect(page.locator('.report-preview')).toHaveAttribute(
    'data-page',
    '2',
  );
  await expect(page.getByRole('img', { name: 'Beta image' })).toHaveAttribute(
    'src',
    /^blob:/,
  );
  await page.getByLabel('全体出力に含める', { exact: true }).uncheck();
  await expect(page.locator('.report-preview')).toHaveAttribute(
    'data-page',
    '1',
  );
  await expect(page.getByLabel('参照の警告', { exact: true })).toContainText(
    'fig:beta',
  );

  const zipDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'プロジェクトZIPを保存', exact: true })
    .click();
  const downloaded = await zipDownload;
  expect(downloaded.suggestedFilename()).toBe('Combined-report.kumi.zip');
  const bytes = await downloadBytes(downloaded);
  const entries = unzipSync(bytes);
  const manifest = JSON.parse(strFromU8(entries['project.json']));
  expect(
    manifest.chapters.map((chapter: { enabled: boolean }) => chapter.enabled),
  ).toEqual([true, false]);
  expect(manifest.metadata.number_sections).toBe(true);
  const images = Object.entries(entries).filter(([path]) =>
    path.endsWith('.svg'),
  );
  expect(images).toHaveLength(2);
  expect(
    images
      .map(([, value]) => strFromU8(value))
      .sort((a, b) => a.localeCompare(b)),
  ).toEqual(
    [image('blue').buffer.toString(), image('red').buffer.toString()].sort(
      (a, b) => a.localeCompare(b),
    ),
  );
  await expect(page.getByLabel('未保存')).toHaveCount(0);

  await projectInput(page).setInputFiles({
    name: 'resume.kumi.zip',
    mimeType: 'application/zip',
    buffer: bytes,
  });
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('Alpha');
  await expect(
    page.getByRole('navigation', { name: '章', exact: true }),
  ).toContainText('Beta');
  await expect(
    page.locator('.kumi-editor-content img.kumi-figure'),
  ).toHaveAttribute('src', /^blob:/);
  await page
    .getByRole('navigation', { name: '章', exact: true })
    .getByRole('button', { name: /Beta/ })
    .click();
  await expect(
    page.getByLabel('全体出力に含める', { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.locator('.kumi-editor-content img.kumi-figure'),
  ).toHaveAttribute('src', /^blob:/);
  await page.getByLabel('全体出力に含める', { exact: true }).check();
  const combinedDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '全体をMarkdownで出力', exact: true })
    .click();
  const combined = (await downloadBytes(await combinedDownload)).toString();
  expect(combined).toContain('# Alpha');
  expect(combined).toContain('# Beta');
  expect(combined).toContain('chapters/');
  await expect(page.getByLabel('未保存')).toBeVisible();
});

test('大きな原稿でもZIPのWorker入出力と英語UIが動作する', async ({ page }) => {
  test.setTimeout(60_000);
  const manifest = {
    schemaVersion: 1,
    type: 'kumi-report-project',
    metadata: { title: 'Large report' },
    chapters: [
      {
        id: 'large',
        title: 'Large',
        file: 'chapters/large.md',
        enabled: true,
        pageBreakBefore: false,
      },
      {
        id: 'small',
        title: 'Small',
        file: 'chapters/small.md',
        enabled: true,
        pageBreakBefore: true,
      },
    ],
  };
  const largeSource = '# Large chapter\n\n' + 'Large text. '.repeat(50_000);
  const zip = zipSync({
    'project.json': strToU8(JSON.stringify(manifest)),
    'chapters/large.md': strToU8(largeSource),
    'chapters/small.md': strToU8('# Small chapter\n\nSmall body'),
  });
  await projectInput(page).setInputFiles({
    name: 'large.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zip),
  });
  await expect(page.locator('.kumi-editor-content h1')).toHaveText(
    'Large chapter',
  );
  await page
    .getByRole('navigation', { name: '章', exact: true })
    .getByRole('button', { name: /Small/ })
    .click();
  await expect(page.locator('.kumi-editor-content h1')).toHaveText(
    'Small chapter',
  );
  await expect(page.locator('.kumi-editor-content p')).toHaveCount(1);
  await page.getByRole('button', { name: '英語表示' }).click();
  await expect(
    page.getByRole('button', { name: 'Save project ZIP', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Project name', { exact: true })
    .fill('Large report revised');
  await expect(page.getByLabel('Unsaved', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Save project ZIP', exact: true })
    .click();
  const entries = unzipSync(await downloadBytes(await download));
  expect(strFromU8(entries['chapters/large.md'])).toContain(
    'Large text. '.repeat(100),
  );
  expect(entries['chapters/large.md'].byteLength).toBeGreaterThan(500_000);
  await expect(page.getByLabel('Unsaved', { exact: true })).toHaveCount(0);
});

test('下書きを守り、確認付きで章を削除できる', async ({ page }) => {
  await page
    .getByRole('button', { name: '現在のReportをプロジェクト化' })
    .click();
  await page.getByRole('button', { name: '空の章を追加', exact: true }).click();
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('第2章');
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .fill('# Draft chapter\n\nDo not lose this');
  await expect(
    page.getByRole('button', { name: 'プロジェクトZIPを保存', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '章を削除', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Markdownを適用', exact: true })
    .click();
  await expect(page.locator('.kumi-editor-content')).toContainText(
    'Do not lose this',
  );
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '章を削除', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '章', exact: true })
      .getByRole('button'),
  ).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '章を削除', exact: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: '章', exact: true })
      .getByRole('button'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '章を削除', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('解析概要');
});
