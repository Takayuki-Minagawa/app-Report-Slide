import { expect, test, type Page, type Download } from '@playwright/test';
import type { DocumentData, FigureNode } from '../src/document/model';
import { createConceptFigure } from '../src/document/figure-edit';

test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });
async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function savedFigure(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  const data = JSON.parse(
    (await bytes(await download)).toString(),
  ) as DocumentData;
  return data.children.find((node) => node.type === 'figure') as FigureNode;
}
const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="blue"/></marker></defs><g id="state-group"><rect id="state-box" x="40" y="80" width="200" height="120" rx="5" fill="#dbeafe" stroke="blue" stroke-width="3"/><text id="state-label" x="140" y="145" text-anchor="middle" font-size="24" fill="black">初期状態</text></g><ellipse id="final-state" cx="600" cy="140" rx="80" ry="60" fill="#dcfce7" stroke="green" stroke-width="3"/><line id="transition" x1="240" y1="140" x2="520" y2="140" stroke="blue" stroke-width="3" marker-end="url(#arrow)"/><path id="retained-curve" d="M40 300 Q300 220 700 300" fill="none" stroke="red" stroke-width="4"/></svg>`;

async function openFixture(page: Page, svg = source) {
  await page.setViewportSize({ width: 1650, height: 1050 });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const figure = createConceptFigure();
  figure.attrs.figureEdit = {
    version: 1,
    svgSource: svg,
    imageSize: { width: 800, height: 400 },
  };
  const document: DocumentData = {
    schemaVersion: 2,
    type: 'report',
    metadata: { title: 'SVG分解確認' },
    children: [figure],
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'svg-review.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(document)),
  });
  // A leading figure already has a ProseMirror NodeSelection after import.
  // The image itself must still reveal its controls on the first click.
  await page
    .locator('.kumi-editor-content')
    .getByRole('img', { name: '3状態の模式図', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '画像の文字をOCRで読み取る' }),
  ).toBeVisible();
}

test('単独図をクリックし、SVGファイル入力からキーボードで分解の取消・適用・原本復帰まで操作できる', async ({
  page,
}, testInfo) => {
  const original = source.replace('初期状態', '元の状態');
  await openFixture(page, original);
  await page.setViewportSize({ width: 1366, height: 768 });
  const fileInput = page.getByLabel('SVG原本を読み込む', { exact: true });
  await expect(fileInput).toBeVisible();
  await fileInput.setInputFiles({
    name: 'external-diagram.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(source),
  });
  await expect(
    page.getByRole('status').filter({ hasText: 'SVG原本を読み込みました。' }),
  ).toBeVisible();
  const split = page.getByRole('button', {
    name: 'SVGを部品に分解',
    exact: true,
  });
  await split.focus();
  await split.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'SVGを部品に分解する確認' });
  const cancel = dialog.getByRole('button', {
    name: '分解をキャンセル',
    exact: true,
  });
  const apply = dialog.getByRole('button', {
    name: '部品への分解を適用',
    exact: true,
  });
  await expect(cancel).toBeFocused();
  await expect(dialog.getByRole('status')).toContainText(
    '編集できる部品: 4 / SVGのまま保持する部品: 1',
  );
  for (const action of [cancel, apply]) {
    const bounds = await action.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  }
  await page.screenshot({
    path: testInfo.outputPath('svg-keyboard-review-1366.png'),
  });
  await cancel.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(split).toBeFocused();
  expect((await savedFigure(page)).attrs.figureEdit?.svgSource).toBe(original);
  await split.focus();
  await split.press('Enter');
  await expect(cancel).toBeFocused();
  await cancel.press('Tab');
  await expect(apply).toBeFocused();
  await apply.press('Enter');
  const edit = page.getByRole('button', {
    name: '図形をドラッグして編集',
    exact: true,
  });
  await expect(edit).toBeFocused();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'SVG原本と保持した部品を残して分解しました。' }),
  ).toBeVisible();
  expect((await savedFigure(page)).attrs.figureEdit?.svgSource).toBe(source);
  await edit.focus();
  await edit.press('Enter');
  const diagram = page.getByRole('dialog', { name: '図形で図解を編集' });
  await expect(diagram).toBeVisible();
  await diagram.press('Escape');
  await expect(edit).toBeFocused();
  await page
    .getByRole('button', { name: 'SVG原本に戻す', exact: true })
    .click();
  await expect(split).toBeFocused();
  await expect(
    page.getByRole('status').filter({ hasText: 'SVG原本の表示に戻しました。' }),
  ).toBeVisible();
  expect((await savedFigure(page)).attrs.figureEdit?.diagram).toBeUndefined();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(edit).toBeVisible();
  expect(
    (await savedFigure(page)).attrs.figureEdit?.diagram?.shapes,
  ).toHaveLength(3);
});

test('外部SVGの分解を比較して適用し、曲線と原本を保持したまま部品編集・HTML再読込・原本復帰できる', async ({
  page,
  browser,
}, testInfo) => {
  await openFixture(page);
  await page
    .getByRole('button', { name: 'SVGを部品に分解', exact: true })
    .click();
  const conversion = page.getByRole('dialog', {
    name: 'SVGを部品に分解する確認',
  });
  await expect(conversion).toContainText(
    '編集できる部品: 4 / SVGのまま保持する部品: 1',
  );
  for (const name of ['SVG原本のプレビュー', 'SVG分解後のプレビュー'])
    await expect
      .poll(() =>
        conversion
          .getByAltText(name)
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('svg-conversion-review.png'),
    fullPage: true,
  });
  await conversion
    .getByRole('button', { name: '部品への分解を適用', exact: true })
    .click();
  let figure = await savedFigure(page);
  expect(figure.attrs.figureEdit?.svgSource).toBe(source);
  expect(figure.attrs.figureEdit?.diagram?.svgFragments?.[0].source).toContain(
    'retained-curve',
  );
  await page
    .getByRole('button', { name: '図形をドラッグして編集', exact: true })
    .click();
  const editor = page.getByRole('dialog', { name: '図形で図解を編集' });
  await editor.getByLabel('図形X (%)').fill('10');
  await editor.getByLabel('図形X (%)').press('Tab');
  await editor
    .getByRole('button', { name: 'state-label', exact: true })
    .click();
  await editor.getByLabel('図形のラベル').fill('編集した状態');
  await editor.getByRole('button', { name: 'transition', exact: true }).click();
  await editor.getByLabel('矢印の向き').selectOption('start');
  await editor.getByRole('button', { name: '図へ適用', exact: true }).click();
  figure = await savedFigure(page);
  expect(figure.attrs.figureEdit?.diagram?.shapes[0].x).toBe(10);
  expect(figure.attrs.figureEdit?.diagram?.shapes[1].text).toBe('編集した状態');
  expect(figure.attrs.figureEdit?.diagram?.connections[0].arrow).toBe('start');
  const edited = figure.attrs.figureEdit;
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const html = await bytes(await download);
  const context = await browser.newContext({
    viewport: { width: 1650, height: 1050 },
  });
  const restored = await context.newPage();
  try {
    await restored.goto('/');
    await expect(
      restored.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await restored.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'svg-roundtrip.html',
      mimeType: 'text/html',
      buffer: html,
    });
    await restored
      .getByRole('dialog', { name: 'HTML取込の確認' })
      .getByRole('button', { name: '確認して取り込む' })
      .click();
    expect((await savedFigure(restored)).attrs.figureEdit).toEqual(edited);
    await restored
      .getByRole('navigation', { name: '文書構成' })
      .getByRole('button', { name: '3状態の模式図 figure', exact: true })
      .click();
    await restored
      .getByRole('button', { name: 'SVG原本に戻す', exact: true })
      .click();
    expect(
      (await savedFigure(restored)).attrs.figureEdit?.diagram,
    ).toBeUndefined();
    expect((await savedFigure(restored)).attrs.figureEdit?.svgSource).toBe(
      source,
    );
    await restored
      .getByRole('button', { name: '元に戻す', exact: true })
      .click();
    expect((await savedFigure(restored)).attrs.figureEdit).toEqual(edited);
  } finally {
    await context.close();
  }
});

test('対応できないSVGは原本のまま残し、ゼロ部品の分解を適用させない', async ({
  page,
}) => {
  const complex =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><path d="M40 100 C100 300 500 0 700 200" stroke="blue" fill="none"/></svg>';
  await openFixture(page, complex);
  await page
    .getByRole('button', { name: 'SVGを部品に分解', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'SVGを部品に分解する確認' });
  await expect(
    dialog.getByRole('button', { name: '部品への分解を適用' }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    '編集できる基本部品が見つかりませんでした',
  );
  await dialog.getByRole('button', { name: '分解をキャンセル' }).click();
  const figure = await savedFigure(page);
  expect(figure.attrs.figureEdit?.svgSource).toBe(complex);
  expect(figure.attrs.figureEdit?.diagram).toBeUndefined();
});
