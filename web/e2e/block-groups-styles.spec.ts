import { expect, test, type Download, type Page } from '@playwright/test';

test.setTimeout(90_000);
async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function snapshot(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse((await bytes(await waiting)).toString());
}
async function openGroupPanel(page: Page) {
  const summary = page
    .locator('summary')
    .filter({ hasText: /^ブロックのまとまり・再利用$/ });
  if (
    !(await summary.evaluate((element) =>
      element.parentElement?.hasAttribute('open'),
    ))
  )
    await summary.click();
  return page.getByRole('group', {
    name: 'ブロックグループの操作',
    exact: true,
  });
}
test('groups, preserves duplicate regions, reuses saved parts and reloads named styles from editable HTML', async ({
  page,
  browser,
}) => {
  await page.setViewportSize({ width: 1700, height: 1200 });
  await page.goto('/');
  page.on('dialog', (dialog) => void dialog.accept());
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
    {
      name: 'grouped.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: slide\ntitle: Reusable evidence\n---\n\n# Evidence\n\n![Original diagram](sample.svg)\n{#fig:evidence caption="Observed process"}\n\nGrouped explanation\n\n| Condition | Value |\n|---|---|\n| A | 12 |',
      ),
    },
    {
      name: 'sample.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240"><rect x="5" y="5" width="590" height="230" fill="#dbeafe" stroke="#2563eb"/><text x="50" y="120" font-size="32">Evidence</text></svg>',
      ),
    },
  ]);
  const panel = await openGroupPanel(page);
  await panel.getByRole('checkbox', { name: /^まとめて選択 2:/ }).check();
  await panel.getByRole('checkbox', { name: /^まとめて選択 3:/ }).check();
  await panel
    .getByLabel('ブロック・部品の名前', { exact: true })
    .fill('Evidence set');
  await panel
    .getByRole('button', { name: 'ブロックをグループ化', exact: true })
    .click();
  await panel
    .getByLabel('まとまりの配置先領域', { exact: true })
    .selectOption('left');
  await panel
    .getByRole('button', { name: '選択した領域へ移動', exact: true })
    .click();
  await panel
    .getByRole('button', { name: 'まとまりを複製', exact: true })
    .click();
  await expect(page.locator('.kumi-editor-content .kumi-figure')).toHaveCount(
    2,
  );
  await page
    .getByRole('button', {
      name: 'まとまり・配置の変更を取り消す',
      exact: true,
    })
    .click();
  await expect(page.locator('.kumi-editor-content .kumi-figure')).toHaveCount(
    1,
  );
  await panel
    .getByRole('button', { name: 'まとまりを複製', exact: true })
    .click();
  await panel
    .getByRole('button', { name: '選択したまとまりを部品登録', exact: true })
    .click();
  await panel
    .getByRole('button', {
      name: 'Evidence set: 配置を保持して追加',
      exact: true,
    })
    .click();
  await expect(page.locator('.kumi-editor-content .kumi-figure')).toHaveCount(
    3,
  );
  const savedGroups = await snapshot(page);
  expect(savedGroups.metadata.block_library.items).toHaveLength(1);
  const figures = savedGroups.children.filter(
    (node: { type: string }) => node.type === 'figure',
  );
  expect(
    new Set(
      figures.map(
        (node: { attrs: { blockLayout: { groupId: string } } }) =>
          node.attrs.blockLayout.groupId,
      ),
    ).size,
  ).toBe(3);
  const assignments =
    savedGroups.metadata.slide_design.pages[0].design.composite.assignments;
  expect(
    figures.every((node: { attrs: { nodeId: string } }) =>
      assignments.some(
        (entry: { nodeId: string; region: string }) =>
          entry.nodeId === node.attrs.nodeId && entry.region === 'left',
      ),
    ),
  ).toBe(true);

  await page
    .locator('summary')
    .filter({ hasText: /^役割・配色・余白のスタイル$/ })
    .click();
  await page
    .locator('summary')
    .filter({ hasText: /^リード文の見た目/ })
    .click();
  await page.getByLabel('リード文の個別設定を使う', { exact: true }).check();
  await page.getByLabel('リード文のsize', { exact: true }).fill('20');
  await page.getByLabel('ページ余白 horizontal', { exact: true }).fill('45');
  await page
    .locator('summary')
    .filter({ hasText: /^保存したスタイル$/ })
    .click();
  await page
    .getByLabel('スタイルプリセット名', { exact: true })
    .fill('Reading style');
  await page
    .getByRole('button', { name: '現在の設定をプリセット保存', exact: true })
    .click();
  await page
    .getByRole('button', { name: '変更をプレビュー', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'このデザインを適用', exact: true })
    .click();
  const waiting = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const html = await bytes(await waiting);
  const context = await browser.newContext({
    viewport: { width: 1700, height: 1200 },
  });
  try {
    const fresh = await context.newPage();
    await fresh.goto('/');
    await expect(
      fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await fresh.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'saved.html',
      mimeType: 'text/html',
      buffer: html,
    });
    await fresh
      .getByRole('dialog', { name: 'HTML取込の確認', exact: true })
      .getByRole('button', { name: '確認して取り込む', exact: true })
      .click();
    const reopenedPanel = await openGroupPanel(fresh);
    await reopenedPanel
      .getByRole('button', {
        name: 'Evidence set: 配置を保持して追加',
        exact: true,
      })
      .click();
    await expect(
      fresh.locator('.kumi-editor-content .kumi-figure'),
    ).toHaveCount(4);
    const restored = await snapshot(fresh);
    expect(restored.metadata.slide_presets.items[0]).toMatchObject({
      name: 'Reading style',
      design: {
        roleStyles: { lead: { size: 20 } },
        spacing: { horizontal: 45 },
      },
    });
    expect(
      restored.metadata.slide_design.pages[0].design.roleStyles.lead.size,
    ).toBe(20);
    await fresh
      .locator('summary')
      .filter({ hasText: /^保存したスタイル$/ })
      .click();
    await fresh
      .getByRole('button', {
        name: 'Reading style: スタイルを読み込む',
        exact: true,
      })
      .click();
    await expect
      .poll(() =>
        fresh
          .locator('.kumi-editor-content .kumi-figure')
          .first()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
