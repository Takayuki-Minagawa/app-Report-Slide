import { expect, test, type Download, type Page } from '@playwright/test';
import type { DocumentData, FigureNode } from '../src/document/model';
test.setTimeout(120_000);
async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function json(page: Page): Promise<DocumentData> {
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse((await bytes(await promise)).toString());
}
function figure(document: DocumentData) {
  return document.children.find((node) => node.type === 'figure') as FigureNode;
}

test('図形のドラッグ・接続線追従・グループ・Undoを保存し、HTMLとZIPから部品を再編集できる', async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1650, height: 1050 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '図形で図解を作る', exact: true })
    .click();
  const before = figure(await json(page)).attrs.figureEdit!.diagram!;
  await page
    .getByRole('button', { name: '図形をドラッグして編集', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '図形で図解を編集' });
  const first = dialog.getByRole('button', { name: '図形 状態1', exact: true });
  const line = dialog.getByRole('button', { name: '線 矢印 1', exact: true });
  const lineX = Number(await line.getAttribute('x1'));
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => Number(await dialog.getByLabel('図形X (%)').inputValue()))
    .toBeGreaterThan(5);
  expect(Number(await line.getAttribute('x1'))).toBeGreaterThan(lineX);
  await dialog
    .getByRole('button', { name: '図形の変更を元に戻す', exact: true })
    .click();
  await expect(dialog.getByLabel('図形X (%)')).toHaveValue('5');
  await dialog
    .getByRole('button', { name: '図形の変更をやり直す', exact: true })
    .click();
  const resize = dialog.getByRole('button', {
    name: '選択図形の右下をリサイズ',
    exact: true,
  });
  const handle = (await resize.boundingBox())!;
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handle.x + handle.width / 2 + 30,
    handle.y + handle.height / 2 + 15,
    { steps: 3 },
  );
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await dialog.getByLabel('図形幅 (%)').inputValue()),
    )
    .toBeGreaterThan(22);
  await dialog
    .getByRole('button', { name: '図形の変更を元に戻す', exact: true })
    .click();
  await expect(dialog.getByLabel('図形幅 (%)')).toHaveValue('22');
  await dialog.getByLabel('図形X (%)').fill('12');
  await dialog.getByLabel('図形X (%)').press('Tab');
  await dialog.getByLabel('図形のラベル').fill('荷重を加えた状態');
  await dialog.getByRole('button', { name: '矢印 1', exact: true }).click();
  await dialog.getByLabel('矢印の向き').selectOption('start');
  await dialog.getByRole('button', { name: '状態1', exact: true }).click();
  await dialog.getByLabel('状態2を複数選択').check();
  await dialog
    .getByRole('button', { name: '図形をグループ化', exact: true })
    .click();
  await dialog.getByRole('button', { name: '状態1', exact: true }).click();
  await expect(dialog.getByLabel('状態2を複数選択')).toBeChecked();
  await dialog
    .getByRole('button', { name: '状態1', exact: true })
    .press('ArrowRight');
  await expect(dialog.getByLabel('図形X (%)')).toHaveValue('13');
  await dialog
    .getByRole('button', { name: '図形をロック', exact: true })
    .click();
  await expect(dialog.getByLabel('図形X (%)')).toBeDisabled();
  await dialog
    .getByRole('button', { name: '図形のロックを解除', exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath('diagram-editor.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: '図へ適用', exact: true }).click();
  await expect(dialog).toBeHidden();
  const changed = await json(page);
  const current = figure(changed).attrs.figureEdit!.diagram!;
  expect(current.shapes[0].x).toBe(13);
  expect(current.shapes[1].x).toBe(40);
  expect(current.shapes[0].groupId).toBe(current.shapes[1].groupId);
  expect(current.connections[0].arrow).toBe('start');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect(figure(await json(page)).attrs.figureEdit!.diagram).toEqual(before);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  expect(figure(await json(page)).attrs.figureEdit!.diagram).toEqual(current);
  const saved: { format: 'html' | 'zip'; data: Buffer }[] = [];
  for (const format of ['html', 'zip'] as const) {
    const pending = page.waitForEvent('download');
    await page
      .getByRole('button', {
        name: format === 'html' ? '編集できるReport HTMLを保存' : 'ZIP',
        exact: true,
      })
      .click();
    saved.push({ format, data: await bytes(await pending) });
  }
  for (const entry of saved) {
    const context = await browser.newContext({
      viewport: { width: 1650, height: 1050 },
    });
    const imported = await context.newPage();
    try {
      await imported.goto('/');
      await expect(
        imported.locator('[contenteditable="true"][aria-label="文書本文"]'),
      ).toBeVisible();
      await imported.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
        name: `diagram.${entry.format}`,
        mimeType: entry.format === 'html' ? 'text/html' : 'application/zip',
        buffer: entry.data,
      });
      if (entry.format === 'html')
        await imported
          .getByRole('dialog', { name: 'HTML取込の確認' })
          .getByRole('button', { name: '確認して取り込む' })
          .click();
      await expect(imported.locator('.kumi-editor-content img')).toBeVisible();
      expect(figure(await json(imported)).attrs.figureEdit!.diagram).toEqual(
        current,
      );
      await imported.locator('.kumi-editor-content img').click();
      await imported
        .getByRole('button', { name: '図形をドラッグして編集', exact: true })
        .click();
      const editor = imported.getByRole('dialog', { name: '図形で図解を編集' });
      await editor.getByLabel('図形のラベル').fill('保存後に再編集した状態');
      await editor.getByRole('button', { name: '矢印 1', exact: true }).click();
      await editor.getByLabel('矢印の向き').selectOption('end');
      await editor
        .getByRole('button', { name: '図へ適用', exact: true })
        .click();
      const revised = figure(await json(imported)).attrs.figureEdit!.diagram!;
      expect(revised.shapes[0].text).toBe('保存後に再編集した状態');
      expect(revised.connections[0].arrow).toBe('end');
    } finally {
      await context.close();
    }
  }
});
