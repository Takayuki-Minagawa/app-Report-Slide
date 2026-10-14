import { expect, test, type Download, type Page } from '@playwright/test';

test.setTimeout(60_000);

const fixture = [
  '---',
  'type: slide',
  'title: スライド操作の検証',
  'author: 検証用',
  '---',
  '',
  '# はじめに',
  '',
  '数値と単位を保持する。29 kg、95%。',
  '',
  '::: slidebreak',
  ':::',
  '',
  '# 図と説明',
  '',
  '配置は数値で指定できる。',
  '',
  '![試験図](assets/test.svg)',
  '{caption="条件：29 kg" slide_layout="10,25,40,30"}',
  '',
  '::: slidebreak',
  ':::',
  '',
  '# 長い説明',
  '',
  ...Array.from(
    { length: 28 },
    (_, index) => `- 説明 ${index + 1}：この数値と単位は検査後も保持する。`,
  ),
].join('\n');

async function openFixture(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-slide-check-stage]')).toHaveCount(0);
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'slide-tools.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(fixture),
    },
    {
      name: 'test.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="#e1eef7"/><text x="30" y="100" font-size="30">29 kg</text></svg>',
      ),
    },
  ]);
  await expect(
    page.getByRole('navigation', { name: 'スライド一覧' }),
  ).toBeVisible();
}

async function downloadText(download: Download): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('ページ・図を名前で選び、数値配置と全ページの実寸検査を行える', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFixture(page);
  const search = page.getByRole('searchbox', {
    name: 'ページ番号・タイトルで検索',
  });
  await search.fill('図と説明');
  const pages = page.getByRole('navigation', { name: 'スライド一覧' });
  await expect(pages.getByRole('button')).toHaveCount(1);
  await pages.getByRole('button', { name: '2 図と説明' }).click();
  await page
    .getByRole('group', { name: '編集対象一覧' })
    .getByRole('button', { name: '図 1 試験図' })
    .click();
  await expect(
    page.getByRole('spinbutton', { name: 'X (%)', exact: true }),
  ).toHaveValue('10');
  await page.getByRole('spinbutton', { name: 'X (%)', exact: true }).fill('8');
  await page.getByRole('spinbutton', { name: 'Y (%)', exact: true }).fill('82');
  await page
    .getByRole('spinbutton', { name: '配置の幅 (%)', exact: true })
    .fill('40');
  await page
    .getByRole('spinbutton', { name: '配置の高さ (%)', exact: true })
    .fill('15');
  await page
    .getByRole('button', { name: '図の配置を適用', exact: true })
    .click();

  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const source = JSON.parse(await downloadText(await saved));
  const figure = source.children.find(
    (node: { type: string }) => node.type === 'figure',
  );
  expect(figure.attrs.slidePlacement).toEqual({
    x: 8,
    y: 82,
    width: 40,
    height: 15,
  });
  expect(JSON.stringify(source)).toContain('29 kg');
  expect(JSON.stringify(source)).toContain('95%');

  await expect(page.locator('[data-slide-check-stage]')).toHaveCount(0);
  await page
    .getByRole('button', { name: '全ページをチェック', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'スライドの見た目チェック' });
  await expect(page.locator('[data-slide-check-stage]')).toHaveCount(0);
  await dialog
    .getByRole('spinbutton', { name: '最小文字サイズ（幅920 px換算）' })
    .fill('20');
  await dialog.getByRole('button', { name: '検査を実行', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('3ページの検査完了');
  await expect(page.locator('[data-slide-check-stage]')).toHaveCount(0);
  const results = dialog.getByRole('list', { name: '検査結果' });
  await expect(results).toContainText('3. 長い説明');
  await expect(results).toContainText('表示領域からのはみ出し');
  await expect(results).toContainText('小さい文字');
  const footerIssue = results
    .getByRole('listitem')
    .filter({ hasText: 'フッターとの重なり' })
    .filter({ hasText: '2. 図と説明 — 図 1' });
  await expect(footerIssue).toHaveCount(1);
  await footerIssue
    .getByRole('button', { name: '意図した重なりとして除外' })
    .click();
  await expect(footerIssue).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText('除外1件');
  await dialog.getByRole('button', { name: '除外した重なりを再表示' }).click();
  await expect(footerIssue).toHaveCount(1);
  await footerIssue
    .getByRole('button', { name: '対象を開く', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('spinbutton', { name: 'Y (%)', exact: true }),
  ).toHaveValue('82');

  // An edit invalidates both previous results and per-revision overlap exclusions.
  await page.getByRole('spinbutton', { name: 'Y (%)', exact: true }).fill('25');
  await page
    .getByRole('button', { name: '図の配置を適用', exact: true })
    .click();
  await page
    .getByRole('button', { name: '全ページをチェック', exact: true })
    .click();
  await expect(dialog.getByRole('status')).toContainText(
    '文書が変更されました',
  );
  await dialog.getByRole('button', { name: '検査を実行', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('3ページの検査完了');
  await expect(footerIssue).toHaveCount(0);
  await expect(results).toContainText('3. 長い説明');
  expect(errors).toEqual([]);
});

test('30ページの比較配置を1枚ずつ検査し、検査条件の変更を通知する', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const source =
    '---\ntype: slide\ntitle: 30ページ検証\n---\n\n' +
    Array.from({ length: 30 }, (_, index) =>
      [
        `# 比較 ${index + 1}`,
        '',
        '## 条件A',
        '',
        index === 29
          ? Array.from(
              { length: 25 },
              (_, row) => `- 維持する数値 ${row + 1} kg`,
            ).join('\n')
          : '42.75 kg',
        '',
        '## 条件B',
        '',
        '38.10 kg',
      ].join('\n'),
    ).join('\n\n::: slidebreak\n:::\n\n');
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'thirty-pages.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  const design = page.getByRole('region', {
    name: 'スライドデザイン',
    exact: true,
  });
  await design
    .getByRole('combobox', { name: '配置', exact: true })
    .selectOption('comparison');
  await design.getByRole('combobox', { name: '適用範囲' }).selectOption('all');
  await design.getByRole('button', { name: '変更をプレビュー' }).click();
  const review = page.getByRole('dialog', { name: 'デザインの変更を確認' });
  await expect(
    review
      .getByRole('region', { name: '変更後' })
      .locator('.slide-design-column'),
  ).toHaveCount(2);
  await review.getByRole('button', { name: 'このデザインを適用' }).click();
  await page
    .getByRole('button', { name: '全ページをチェック', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'スライドの見た目チェック' });
  await page.evaluate(() => {
    const metric = {
      maximumCanvases: 0,
      pages: new Set<string>(),
      started: performance.now(),
      observer: null as MutationObserver | null,
    };
    const sample = () => {
      const canvases = window.document.querySelectorAll(
        '[data-slide-check-stage] .slide-preview',
      );
      metric.maximumCanvases = Math.max(
        metric.maximumCanvases,
        canvases.length,
      );
      for (const canvas of canvases)
        metric.pages.add(canvas.getAttribute('data-page')!);
    };
    metric.observer = new MutationObserver(sample);
    metric.observer.observe(window.document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-page'],
    });
    (
      window as unknown as { slideCheckMetric: typeof metric }
    ).slideCheckMetric = metric;
    sample();
  });
  await dialog.getByRole('button', { name: '検査を実行', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('30ページの検査完了');
  const metric = await page.evaluate(() => {
    const value = (
      window as unknown as {
        slideCheckMetric: {
          maximumCanvases: number;
          pages: Set<string>;
          started: number;
          observer: MutationObserver;
        };
      }
    ).slideCheckMetric;
    value.observer.disconnect();
    return {
      maximumCanvases: value.maximumCanvases,
      pages: [...value.pages],
      elapsedMs: Math.round(performance.now() - value.started),
    };
  });
  expect(metric.maximumCanvases).toBe(1);
  expect(metric.pages).toHaveLength(30);
  expect(metric.pages).toContain('30');
  await testInfo.attach('30-page-check-metrics', {
    body: JSON.stringify(metric, null, 2),
    contentType: 'application/json',
  });
  await expect(dialog.getByRole('list', { name: '検査結果' })).toContainText(
    '30. 比較 30',
  );
  await expect(dialog.getByRole('list', { name: '検査結果' })).toContainText(
    '表示領域からのはみ出し',
  );
  await dialog
    .getByRole('spinbutton', { name: '最小文字サイズ（幅920 px換算）' })
    .fill('20');
  await expect(dialog.getByRole('status')).toContainText(
    '検査条件が変更されました',
  );
  await expect(dialog.getByRole('list', { name: '検査結果' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
