import { pathToFileURL } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { DocumentData } from '../src/document/model';

test.setTimeout(90_000);

async function savedDocument(page: Page): Promise<DocumentData> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of (await (await pending).createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString()) as DocumentData;
}
test('対数軸と非対称誤差・表出典を編集し、HTML文献詳細から同じページへ戻る', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const chart = {
    type: 'chart',
    attrs: {
      nodeId: 'chart',
      chartType: 'line',
      data: [{ label: 'A', x: 10, y: 100 }],
      series: 'Measured',
      xLabel: 'Time',
      yLabel: 'Value',
      alt: 'Log comparison',
      width: 90,
    },
  };
  const source = `---\ntype: slide\ntitle: Advanced charts\n---\n\n# Comparison\n\n::: kumi-chart\n${JSON.stringify(chart)}\n:::\n\n::: slidebreak\n:::\n\n# Data table\n\n| Method | Value |\n| --- | --- |\n| A | 42 |`;
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'advanced.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await page.locator('.kumi-chart').click();
  await page
    .getByRole('textbox', { name: 'グラフデータ', exact: true })
    .fill(
      'label,x,y,xMinus,xPlus,yMinus,yPlus\nA,10,100,1,2,20,30\nB,100,1000,2,3,40,50',
    );
  await page
    .getByRole('combobox', { name: 'X 目盛', exact: true })
    .selectOption('log');
  await page
    .getByRole('combobox', { name: 'Y 目盛', exact: true })
    .selectOption('log');
  await page
    .getByRole('textbox', { name: '誤差棒の意味・条件', exact: true })
    .fill('95% confidence interval');
  await page
    .locator('summary')
    .filter({ hasText: '共有文献を登録・編集' })
    .click();
  await page
    .getByRole('textbox', { name: '文献ID', exact: true })
    .fill('study');
  await page
    .getByRole('textbox', { name: '文献の題名', exact: true })
    .fill('Comparison study');
  await page
    .getByRole('textbox', { name: 'PDFのリンク', exact: true })
    .fill('https://example.com/study.pdf');
  await page
    .getByRole('textbox', { name: '文献の要点・研究条件', exact: true })
    .fill('Twenty independent trials.');
  await page
    .getByRole('button', { name: '共有文献を保存', exact: true })
    .click();
  await page.getByRole('button', { name: 'グラフを更新', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Y 目盛', exact: true }),
  ).toHaveValue('log');
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await editor.locator('td').first().click();
  await page
    .getByRole('combobox', { name: '共有文献の出典', exact: true })
    .selectOption('study');
  await page.getByRole('button', { name: '属性を適用', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const path = testInfo.outputPath('advanced.html');
  await (await pending).saveAs(path);
  const context = await browser.newContext({ offline: true });
  try {
    const reader = await context.newPage();
    await reader.goto(pathToFileURL(path).href);
    await expect(
      reader.locator('#slide-1 [data-chart-error-axis]'),
    ).toHaveCount(4);
    await expect(reader.locator('#slide-1')).toContainText('log10');
    await reader.locator('#slide-1 [data-reader-reference]').click();
    const dialog = reader.getByRole('dialog', { name: '図の拡大・詳しい説明' });
    await expect(dialog).toContainText('Twenty independent trials.');
    await expect(
      dialog.getByRole('link', { name: 'PDFを開く', exact: true }),
    ).toHaveAttribute('href', 'https://example.com/study.pdf');
    const before = reader.url();
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(reader.url()).toBe(before);
    await expect(
      reader.locator('#slide-1 [data-reader-reference]'),
    ).toBeFocused();
    await expect(
      reader.locator('#slide-2 .preview-table-wrap [data-reader-reference]'),
    ).toHaveCount(1);
  } finally {
    await context.close();
  }
});

test('長表を見出し付きで分割し、Undoで元の表と参照を戻す', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const source =
    '---\ntype: slide\n---\n\n# Results\n\n| Method | Value |\n| --- | --- |\n' +
    Array.from({ length: 10 }, (_, i) => `| Method ${i + 1} | ${i + 1} |`).join(
      '\n',
    ) +
    '\n\n{#tab:results caption="Results"}';
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'long-table.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await editor.locator('td').first().click();
  await expect(
    page.getByRole('textbox', { name: '参照ラベル', exact: true }),
  ).toHaveValue('tab:results');
  const originalTable = (await savedDocument(page)).children.find(
    (node) => node.type === 'table',
  );
  expect(originalTable?.attrs).toMatchObject({
    label: 'tab:results',
    caption: 'Results',
  });
  await page
    .getByRole('button', { name: '表を次のページへ分割', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: '表を次のページへ分割',
    exact: true,
  });
  await dialog
    .getByRole('combobox', { name: '分割位置', exact: true })
    .selectOption('6');
  await dialog
    .getByRole('button', { name: '表を分割して改ページ', exact: true })
    .click();
  await expect(editor.locator('table')).toHaveCount(2);
  await expect(editor.locator('table').first().locator('tr')).toHaveCount(6);
  await expect(editor.locator('table').nth(1).locator('tr')).toHaveCount(6);
  await expect(editor.locator('table').nth(1).locator('th')).toHaveCount(2);
  await expect(editor.locator('td')).toHaveCount(20);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor.locator('table tr')).toHaveCount(11);
  await editor.locator('td').first().click();
  await expect(
    page.getByRole('textbox', { name: '参照ラベル', exact: true }),
  ).toHaveValue('tab:results');
  expect(
    (await savedDocument(page)).children.find((node) => node.type === 'table'),
  ).toEqual(originalTable);
});
