import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

test('所属ページが消えた補足は未割当で保持し、明示復帰後もHTML再編集できる', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const source = {
    schemaVersion: 2,
    type: 'slide',
    metadata: {
      title: 'Original supplement retained',
      reader_supplements: {
        version: 1,
        pages: [
          {
            pageId: 'removed-heading',
            pageIndex: 0,
            anchorIds: ['removed-heading', 'removed-body'],
            title: 'Original conditions',
            text: 'The removed page used 20 trials.',
            link: 'https://example.com/original.pdf',
          },
        ],
      },
    },
    children: [
      {
        type: 'paragraph',
        attrs: { nodeId: 'surviving-page' },
        content: [{ type: 'text', text: 'Surviving page' }],
      },
    ],
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'removed-page.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(source)),
  });
  const orphan = page.locator('details').filter({
    has: page
      .locator('summary')
      .filter({ hasText: '未割当の補足（1件・原文を保持）' }),
  });
  await orphan.locator('summary').click();
  await expect(orphan).toContainText('The removed page used 20 trials.');
  await expect(
    orphan.getByRole('link', { name: '文献を開く' }),
  ).toHaveAttribute('href', 'https://example.com/original.pdf');
  await page.locator('summary').filter({ hasText: '読者向けの補足' }).click();
  await expect(page.getByLabel('補足の見出し', { exact: true })).toHaveValue(
    '',
  );
  await orphan
    .getByRole('button', { name: '1ページへ補足を戻す', exact: true })
    .click();
  await expect(orphan).toHaveCount(0);
  await page.locator('summary').filter({ hasText: '読者向けの補足' }).click();
  await expect(
    page.getByLabel('詳しい説明・研究条件', { exact: true }),
  ).toHaveValue('The removed page used 20 trials.');
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるHTMLを保存', exact: true })
    .click();
  const file = testInfo.outputPath('restored.html');
  await (await pending).saveAs(file);
  const fresh = await browser.newContext();
  try {
    const editor = await fresh.newPage();
    await editor.goto('/');
    await expect(
      editor.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await editor.getByLabel('HTML・Markdown・JSONファイル').setInputFiles(file);
    await editor
      .getByRole('dialog', { name: 'HTML取込の確認' })
      .getByRole('button', { name: '確認して取り込む' })
      .click();
    await editor
      .locator('summary')
      .filter({ hasText: '読者向けの補足' })
      .click();
    await expect(
      editor.getByLabel('補足の見出し', { exact: true }),
    ).toHaveValue('Original conditions');
    await expect(
      editor.getByLabel('詳しい説明・研究条件', { exact: true }),
    ).toHaveValue('The removed page used 20 trials.');
    await expect(
      editor.locator('summary').filter({ hasText: '未割当の補足' }),
    ).toHaveCount(0);
  } finally {
    await fresh.close();
  }
});

for (const type of ['slide', 'report'] as const) {
  test(`${type}: 複数系列の編集・HTML再読込と読者の図拡大・補足`, async ({
    page,
    browser,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto('/');
    await expect(
      page.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    const chart = {
      type: 'chart',
      attrs: {
        nodeId: 'comparison',
        chartType: 'line',
        data: [
          { label: 'Method A', x: 1, y: 2 },
          { label: 'Method B', x: 2, y: 3 },
          { label: 'Method C', x: 3, y: 4 },
        ],
        series: 'Observed',
        xLabel: 'Method',
        yLabel: 'Time',
        alt: 'Timing comparison',
        width: 90,
      },
    };
    const source = `---\ntype: ${type}\ntitle: Reader ${type}\n---\n\n# Comparison\n\n::: kumi-chart\n${JSON.stringify(chart)}\n:::\n\n::: ${type}break\n:::\n\n# Second\n\nOther page`;
    await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'reader.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(source.replace('reportbreak', 'pagebreak')),
    });
    await page.locator('.kumi-chart').click();
    await page.getByRole('button', { name: '系列を追加', exact: true }).click();
    await page
      .getByRole('textbox', { name: '系列 2 名前', exact: true })
      .fill('Simulated');
    await page
      .getByLabel('系列 2 線種', { exact: true })
      .selectOption('dashed');
    await page
      .getByLabel('系列 2 マーカー', { exact: true })
      .selectOption('triangle');
    await page
      .getByRole('textbox', { name: 'グラフデータ 2', exact: true })
      .fill('Method A,1,2.5\nMethod B,2,3.5\nMethod C,3,4.5');
    await page
      .getByRole('combobox', { name: 'グラフ種類', exact: true })
      .selectOption('bar');
    await page
      .getByRole('combobox', { name: '棒の向き', exact: true })
      .selectOption('horizontal');
    await page.getByLabel('Y 単位', { exact: true }).fill('s');
    await page.getByLabel('値ラベルを表示', { exact: true }).check();
    await page
      .getByLabel('グラフの出典', { exact: true })
      .fill('Experiment 2026');
    await page
      .getByRole('button', { name: 'グラフを更新', exact: true })
      .click();
    await expect(
      page.getByRole('textbox', { name: '系列 2 名前', exact: true }),
    ).toHaveValue('Simulated');
    await page
      .getByRole('textbox', { name: 'グラフデータ 2', exact: true })
      .fill('Method A,1,2.5\nMethod B,2,3.5\nMethod C,3,5.5');
    await page
      .getByRole('button', { name: 'グラフを更新', exact: true })
      .click();
    await page.locator('summary').filter({ hasText: '読者向けの補足' }).click();
    await page
      .getByLabel('補足の見出し', { exact: true })
      .fill('Research conditions');
    await page
      .getByLabel('詳しい説明・研究条件', { exact: true })
      .fill('Three methods; 20 repeated trials.');
    await page
      .getByLabel('文献・PDFのURL', { exact: true })
      .fill('https://example.com/study.pdf');
    await page.getByRole('button', { name: '補足を適用', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name:
          type === 'slide'
            ? '編集できるHTMLを保存'
            : '編集できるReport HTMLを保存',
        exact: true,
      })
      .click();
    const file = testInfo.outputPath(`${type}.html`);
    await (await pending).saveAs(file);
    const html = await readFile(file, 'utf8');
    const offline = await browser.newContext({ offline: true });
    try {
      const reader = await offline.newPage();
      reader.on('pageerror', (error) => errors.push(error.message));
      await reader.goto(pathToFileURL(file).href);
      const graphic = reader.locator(
        type === 'slide'
          ? '#slide-1 .preview-chart'
          : '.report-sheet .preview-chart',
      );
      await expect(graphic.locator('[data-chart-series]')).toHaveCount(2);
      await expect(graphic).toContainText('Time (s)');
      await expect(graphic).toContainText('5.5');
      const bars = await graphic
        .locator('[data-chart-series] rect')
        .evaluateAll((rects) =>
          rects.map((rect) => ({
            w: Number(rect.getAttribute('width')),
            h: Number(rect.getAttribute('height')),
          })),
        );
      expect(bars).toHaveLength(6);
      expect(bars.every((rect) => rect.w > rect.h)).toBe(true);
      const zoom = graphic.getByRole('button', {
        name: '図を拡大: Timing comparison',
        exact: true,
      });
      await zoom.click();
      const modal = reader.getByRole('dialog');
      await expect(modal).toBeVisible();
      await expect(modal.locator('[data-chart-series]')).toHaveCount(2);
      const clipReference = await modal
        .locator('g[clip-path]')
        .getAttribute('clip-path');
      expect(clipReference).toContain('reader-copy-');
      expect(await modal.locator('clipPath').getAttribute('id')).toBe(
        clipReference?.slice(5, -1),
      );
      await reader.keyboard.press('ArrowRight');
      if (type === 'slide')
        await expect(reader.locator('#deck-counter')).toHaveText('1 / 2');
      await reader.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await expect(zoom).toBeFocused();
      const details = reader.getByRole('button', {
        name: '詳しい説明',
        exact: true,
      });
      await details.click();
      await expect(modal).toContainText('Three methods; 20 repeated trials.');
      await expect(modal.getByRole('link')).toHaveAttribute(
        'href',
        'https://example.com/study.pdf',
      );
      await modal.getByRole('button', { name: '閉じる', exact: true }).click();
      await expect(details).toBeFocused();
      if (type === 'slide') {
        await expect(reader.locator('#deck-counter')).toHaveText('1 / 2');
        await reader.getByRole('button', { name: '次へ', exact: true }).click();
        await expect(details).toBeHidden();
      }
    } finally {
      await offline.close();
    }
    // Reopen the saved HTML in a clean browser state; all data remains editable.
    const fresh = await browser.newContext();
    try {
      const editor = await fresh.newPage();
      await editor.goto('/');
      await expect(
        editor.locator('[contenteditable="true"][aria-label="文書本文"]'),
      ).toBeVisible();
      await editor.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
        name: `${type}.html`,
        mimeType: 'text/html',
        buffer: Buffer.from(html),
      });
      await editor
        .getByRole('dialog', { name: 'HTML取込の確認' })
        .getByRole('button', { name: '確認して取り込む' })
        .click();
      await editor.locator('.kumi-chart').click();
      await expect(
        editor.getByRole('textbox', { name: '系列 2 名前', exact: true }),
      ).toHaveValue('Simulated');
      await expect(
        editor.getByRole('textbox', { name: 'グラフデータ 2', exact: true }),
      ).toHaveValue(/Method C,3,5.5/);
      await expect(editor.getByLabel('Y 単位', { exact: true })).toHaveValue(
        's',
      );
      await editor
        .locator('summary')
        .filter({ hasText: '読者向けの補足' })
        .click();
      await expect(
        editor.getByLabel('補足の見出し', { exact: true }),
      ).toHaveValue('Research conditions');
    } finally {
      await fresh.close();
    }
    expect(errors).toEqual([]);
  });
}
