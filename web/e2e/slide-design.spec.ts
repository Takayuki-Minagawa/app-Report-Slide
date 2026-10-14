import {
  expect,
  test,
  type Download,
  type Locator,
  type Page,
} from '@playwright/test';
import type { DocumentData } from '../src/document/model';

test.setTimeout(90_000);

async function downloadText(download: Download): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function exportJson(page: Page): Promise<DocumentData> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse(await downloadText(await pending)) as DocumentData;
}

async function expectSourceSize(source: Locator, size: number) {
  await expect(source).toBeVisible();
  // Slide typography uses a 920 px reference canvas, including scaled exports.
  await expect
    .poll(() =>
      source.evaluate((element) => {
        const slide = element.closest('.slide-preview')!;
        return (
          (Number.parseFloat(getComputedStyle(element).fontSize) * 920) /
          Number.parseFloat(getComputedStyle(slide).width)
        );
      }),
    )
    .toBeCloseTo(size, 2);
}

test('出典の文字サイズをスライドのプレビューと保存HTMLで維持し、Reportは変更しない', async ({
  page,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const document: DocumentData = {
    schemaVersion: 2,
    type: 'slide',
    metadata: { title: '出典の文字サイズ', theme: 'paper-light' },
    children: [
      {
        type: 'figure',
        attrs: {
          nodeId: 'source-size-figure',
          src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6t9sAAAAASUVORK5CYII=',
          alt: '出典付きの図',
          title: null,
          width: 10,
          align: 'center',
          figureEdit: {
            version: 1,
            source: {
              referenceId: '',
              origin: 'original',
              pdfPage: '',
              printedPage: '',
              figureNumber: '',
              note: '出典サイズの検証',
            },
          },
        },
      },
    ],
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'source-size.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const source = page.locator('.preview-pages .figure-source > small');
  const panel = page.getByRole('region', {
    name: 'スライドデザイン',
    exact: true,
  });
  for (const size of [12, 16]) {
    if (size === 16) {
      await panel
        .getByText('役割・配色・余白のスタイル', { exact: true })
        .click();
      await panel.getByText('出典の見た目', { exact: true }).click();
      await panel.getByLabel('出典の個別設定を使う', { exact: true }).check();
      await panel.getByLabel('出典のsize', { exact: true }).fill(String(size));
      await panel.getByRole('button', { name: '変更をプレビュー' }).click();
      await page
        .getByRole('dialog', { name: 'デザインの変更を確認' })
        .getByRole('button', { name: 'このデザインを適用' })
        .click();
    }
    await expectSourceSize(source, size);
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
      .click();
    const exported = await page.context().newPage();
    try {
      await exported.setContent(await downloadText(await pending));
      await expectSourceSize(exported.locator('.figure-source > small'), size);
    } finally {
      await exported.close();
    }
  }

  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'source-size-report.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        ...document,
        type: 'report',
        metadata: { title: 'Report' },
      }),
    ),
  });
  const reportSource = page.locator(
    '.preview-pages .report-preview .figure-source > small',
  );
  await expect(reportSource).toBeVisible();
  const reportSizes = await reportSource.evaluate((element) => ({
    source: Number.parseFloat(getComputedStyle(element).fontSize),
    caption: Number.parseFloat(
      getComputedStyle(element.parentElement!).fontSize,
    ),
  }));
  // Report page sizing can scale both values; preserve its existing 80% ratio.
  expect(reportSizes.source).toBeCloseTo(reportSizes.caption * 0.8, 2);
});

test('デザインを対象ページで確認して適用・取消し、HTMLから再編集できる', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => void dialog.accept());
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'design.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\ntype: slide\ntitle: デザイン検証\n---\n\n# 比較結果\n\n## 条件A\n\n42.75 kg\n\n## 条件B\n\n38.10 kg\n\n::: slidebreak\n:::\n\n# 測定値\n\n| 条件 | 値 |\n| --- | --- |\n| A | 42.75 |\n| B | 38.10 |',
    ),
  });
  const original = await exportJson(page);
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const panel = page.getByRole('region', {
    name: 'スライドデザイン',
    exact: true,
  });
  const articles = page.locator('.preview-pages .slide-preview');
  await expect(articles).toHaveCount(2);
  await panel
    .getByRole('combobox', { name: 'テーマ', exact: true })
    .selectOption('paper-light');
  await panel
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('comparison');
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  const review = page.getByRole('dialog', { name: 'デザインの変更を確認' });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole('region', { name: '変更前' }).locator('article'),
  ).toHaveAttribute('data-theme', 'beamer-simple');
  await expect(
    review.getByRole('region', { name: '変更後' }).locator('article'),
  ).toHaveAttribute('data-layout', 'comparison');
  await expect(
    review
      .getByRole('region', { name: '変更後' })
      .locator('.slide-design-column'),
  ).toHaveCount(2);
  await review.getByRole('button', { name: 'キャンセル' }).click();
  await expect(articles.first()).toHaveAttribute('data-theme', 'beamer-simple');
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  await expect(articles.first()).toHaveAttribute('data-theme', 'paper-light');
  await expect(articles.last()).toHaveAttribute('data-theme', 'beamer-simple');
  await panel
    .getByRole('button', { name: '直前のデザイン変更を取り消す' })
    .click();
  await expect(articles.first()).toHaveAttribute('data-theme', 'beamer-simple');

  await panel
    .getByRole('combobox', { name: 'テーマ', exact: true })
    .selectOption('technical');
  await panel
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('table-focus');
  await panel
    .getByRole('combobox', { name: '適用範囲' })
    .selectOption('selected');
  await panel.getByRole('checkbox', { name: 'ページ 1 — 比較結果' }).uncheck();
  await panel.getByRole('checkbox', { name: 'ページ 2 — 測定値' }).check();
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  await expect(
    review.getByRole('combobox', { name: '確認するページ' }),
  ).toHaveValue('1');
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  await expect(articles.first()).toHaveAttribute('data-theme', 'beamer-simple');
  await expect(articles.last()).toHaveAttribute('data-theme', 'technical');
  await expect(articles.last()).toHaveAttribute('data-layout', 'table-focus');

  await panel
    .getByRole('combobox', { name: 'テーマ', exact: true })
    .selectOption('paper-light');
  await panel.getByRole('combobox', { name: '適用範囲' }).selectOption('all');
  await panel
    .getByRole('checkbox', { name: '個別設定済みのページは変更しない' })
    .check();
  await panel.getByRole('button', { name: '変更をプレビュー' }).click();
  await expect(review).toContainText('1ページに適用');
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  await expect(articles.first()).toHaveAttribute('data-theme', 'paper-light');
  await expect(articles.last()).toHaveAttribute('data-theme', 'technical');
  const styled = await exportJson(page);
  expect(styled.children).toEqual(original.children);
  expect(styled.metadata.slide_design).toMatchObject({
    version: 1,
    pages: expect.any(Array),
  });
  await page.screenshot({
    path: testInfo.outputPath('slide-design.png'),
    fullPage: true,
  });

  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const html = await downloadText(await pending);
  expect(html).toContain('data-layout="table-focus"');
  expect(html).toContain('data-theme="paper-light"');
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'design.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  const importReview = page.getByRole('dialog', { name: 'HTML取込の確認' });
  await expect(importReview).toBeVisible();
  await importReview.getByRole('button', { name: '確認して取り込む' }).click();
  await expect(importReview).toBeHidden();
  expect(await exportJson(page)).toEqual(styled);
  expect(errors).toEqual([]);
});
