import { expect, test, type Download, type Page } from '@playwright/test';

async function downloadBytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function chapter(title: string) {
  return {
    name: `${title}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        type: 'slide',
        metadata: {
          title,
          theme: 'beamer-simple',
          figure_references: [
            {
              id: 'paper',
              title: `${title} paper`,
              authors: '',
              year: '',
              url: '',
            },
          ],
          reader_supplements: {
            version: 1,
            pages: [
              {
                pageId: `${title}-title`,
                pageIndex: 0,
                title: `${title} supplement`,
                text: `${title} detailed research conditions`,
                link: '',
              },
            ],
          },
        },
        children: [
          {
            type: 'heading',
            attrs: { nodeId: `${title}-title`, level: 1 },
            content: [{ type: 'text', text: `${title} chapter` }],
          },
          {
            type: 'figure',
            attrs: {
              nodeId: `${title}-image`,
              src: 'same.svg',
              alt: `${title} evidence`,
              title: null,
              width: 60,
              align: 'center',
              figureEdit: {
                version: 1,
                source: {
                  referenceId: 'paper',
                  origin: 'original',
                  pdfPage: '',
                  printedPage: '',
                  figureNumber: '1',
                  note: '',
                },
              },
            },
          },
          {
            type: 'paragraph',
            attrs: { nodeId: `${title}-conditions` },
            content: [{ type: 'text', text: `${title} conditions` }],
          },
        ],
      }),
    ),
  };
}
function picture(title: string) {
  return {
    name: 'same.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="${title === 'A' ? 'blue' : title === 'B' ? 'green' : title === 'C' ? 'red' : 'orange'}"/><text x="10" y="40">${title} source</text></svg>`,
    ),
  };
}
async function ready(page: Page) {
  await page.goto('/');
  await expect(
    page.getByRole('button', {
      name: '編集できるReport HTMLを保存',
      exact: true,
    }),
  ).toBeEnabled();
  await expect(page.locator('.kumi-editor-content')).toBeVisible();
}
async function selectChapter(page: Page, title: string) {
  await page
    .getByRole('navigation', { name: '章', exact: true })
    .getByRole('button', { name: new RegExp(title) })
    .click();
}

test('4章のSlideを並替え・移動して単章HTMLを出し、別ブラウザ状態でZIPから全体版を再作成する', async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page
    .getByLabel('HTML・Markdown・JSONファイル')
    .setInputFiles([chapter('A'), picture('A')]);
  await expect(page.locator('.kumi-editor-content h1')).toHaveText('A chapter');
  await page.locator('summary').filter({ hasText: '章別プロジェクト' }).click();
  await page
    .getByRole('button', { name: '現在のSlideをプロジェクト化', exact: true })
    .click();
  for (const title of ['B', 'C', 'D']) {
    await page
      .getByLabel('原稿を章として追加', { exact: true })
      .setInputFiles([chapter(title), picture(title)]);
    await expect(page.locator('.kumi-editor-content h1')).toHaveText(
      `${title} chapter`,
    );
  }
  await page
    .getByRole('combobox', { name: 'プロジェクトの共通テーマ', exact: true })
    .selectOption('technical');
  await page
    .getByRole('combobox', { name: 'この章のテーマ', exact: true })
    .selectOption('paper-light');
  await page
    .getByLabel('全体に章目次スライドを付ける', { exact: true })
    .check();
  await page.getByRole('button', { name: '上へ移動', exact: true }).click();
  await page.getByRole('button', { name: '上へ移動', exact: true }).click();
  const chapterNav = page.getByRole('navigation', { name: '章', exact: true });
  await expect(chapterNav.getByRole('button')).toHaveText([/A/, /D/, /B/, /C/]);
  await selectChapter(page, 'C');
  await page.getByLabel('全体出力に含める', { exact: true }).uncheck();
  await selectChapter(page, 'D');
  await page
    .locator('.kumi-editor-content p')
    .last()
    .fill('D updated conditions');
  await page
    .getByRole('button', { name: 'スライドを複製', exact: true })
    .click();
  await expect(
    page
      .getByRole('combobox', { name: '操作するスライド', exact: true })
      .locator('option'),
  ).toHaveCount(2);
  await page
    .getByRole('combobox', { name: 'スライドの移動先の章', exact: true })
    .selectOption({ label: 'B' });
  await page
    .getByRole('button', { name: '選んだ章の末尾へ移動', exact: true })
    .click();
  await expect(page.locator('.kumi-editor-content h1')).toHaveText([
    'B chapter',
    'D chapter',
  ]);
  await expect(page.locator('.kumi-editor-content img')).toHaveCount(2);
  await page
    .getByRole('combobox', { name: '出力範囲', exact: true })
    .selectOption('chapter');
  const singleDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const singleHtml = (await downloadBytes(await singleDownload)).toString();
  const viewer = await browser.newPage();
  await viewer.route('https://project.test/chapter.html', (route) =>
    route.fulfill({ body: singleHtml, contentType: 'text/html' }),
  );
  await viewer.goto('https://project.test/chapter.html');
  await expect(viewer.locator('.deck-slide')).toHaveCount(2);
  await expect(viewer.locator('.deck-slide h1')).toHaveText([
    'B chapter',
    'D chapter',
  ]);
  await expect(viewer.locator('.deck-slide').nth(1)).toContainText(
    'D updated conditions',
  );
  await expect(viewer.locator('.deck-slide').nth(1)).toContainText('D paper');
  expect(singleHtml).toContain('D detailed research conditions');
  await viewer.close();

  const archiveDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'プロジェクトZIPを保存', exact: true })
    .click();
  const archive = await downloadBytes(await archiveDownload);
  const context = await browser.newContext();
  const restored = await context.newPage();
  restored.on('pageerror', (error) => errors.push(error.message));
  await ready(restored);
  await restored
    .getByLabel('プロジェクトZIPを開く', { exact: true })
    .setInputFiles({
      name: 'four-chapters.kumi.zip',
      mimeType: 'application/zip',
      buffer: archive,
    });
  await expect(restored.getByText('PROJECT', { exact: true })).toBeVisible();
  await restored
    .locator('summary')
    .filter({ hasText: '章別プロジェクト' })
    .click();
  await expect(
    restored
      .getByRole('navigation', { name: '章', exact: true })
      .getByRole('button'),
  ).toHaveText([/A/, /D/, /B/, /C/]);
  await selectChapter(restored, 'D');
  await expect(
    restored.getByRole('combobox', { name: 'この章のテーマ', exact: true }),
  ).toHaveValue('paper-light');
  await restored
    .getByRole('combobox', { name: '出力範囲', exact: true })
    .selectOption('project');
  const combinedDownload = restored.waitForEvent('download');
  await restored
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const html = (await downloadBytes(await combinedDownload)).toString();
  const combined = await context.newPage();
  await combined.route('https://project.test/combined.html', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await combined.goto('https://project.test/combined.html');
  await expect(combined.locator('.deck-slide')).toHaveCount(5);
  await expect(combined.locator('.deck-slide h1')).toHaveText([
    'Contents / 目次',
    'A chapter',
    'D chapter',
    'B chapter',
    'D chapter',
  ]);
  expect(html).toContain('D detailed research conditions');
  expect(errors).toEqual([]);
  await context.close();
});
