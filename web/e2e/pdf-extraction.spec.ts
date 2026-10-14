import { expect, test, type Download, type Page } from '@playwright/test';
import { jsPDF } from 'jspdf';

test.setTimeout(180_000);
test.use({ actionTimeout: 15_000 });

async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
async function json(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse((await bytes(await pending)).toString());
}
async function start(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'start.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\ntype: report\ntitle: Extraction\n---\n\n# Evidence\n\nExisting content',
    ),
  });
}
async function importDialog(page: Page, buffer: Buffer) {
  await page
    .getByRole('button', { name: 'PDFから図を追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'PDFから図を取り込む',
    exact: true,
  });
  await dialog.getByLabel('取り込むPDFファイル').setInputFiles({
    name: 'evidence.pdf',
    mimeType: 'application/pdf',
    buffer,
  });
  await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
  await dialog
    .getByText('文字・表を読み取る（OCR対応）', { exact: true })
    .click();
  return dialog;
}
function numericPdf() {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  pdf.setFontSize(12);
  pdf.text('This title is outside the selected region', 40, 32);
  const values = [
    ['Sample', 'Value', 'Error'],
    ['A', '1,234.50', '0.25'],
    ['B', '-12.5', '3.5e-2'],
    ['C', '0012', '5 MPa'],
  ];
  values.forEach((row, ri) =>
    row.forEach((value, ci) =>
      pdf.text(value, [48, 220, 390][ci], 100 + ri * 30),
    ),
  );
  return Buffer.from(pdf.output('arraybuffer'));
}

test('PDF text table: crop, numeric review, correction, CSV, source evidence and HTML round trip', async ({
  page,
  browser,
}) => {
  await start(page);
  const dialog = await importDialog(page, numericPdf());
  await dialog.getByLabel('PDF範囲 height', { exact: true }).fill('20');
  await dialog.getByLabel('PDF範囲 y', { exact: true }).fill('9');
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
    '1,234.50',
  );
  await expect(
    dialog.getByLabel('PDF読み取りの原本', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel('PDF表の確認グリッド')).toBeVisible();
  await dialog.getByLabel('PDF表 2-3', { exact: true }).fill('0.5');
  await dialog
    .getByRole('button', { name: '数値候補を表に反映', exact: true })
    .click();
  await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
    '1234.5',
  );
  await expect(dialog.getByLabel('PDF表 4-2', { exact: true })).toHaveValue(
    '0012',
  );
  const csvPending = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: '確認中の表をCSV保存', exact: true })
    .click();
  expect((await bytes(await csvPending)).toString()).toContain(
    '"A","1234.5","0.5"',
  );
  await dialog
    .getByRole('button', { name: '原本と確認済みの内容を挿入', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const document = await json(page);
  const figure = document.children.find(
    (node: { type: string }) => node.type === 'figure',
  );
  const extracted = figure.attrs.figureEdit.extraction;
  expect(extracted).toMatchObject({
    method: 'pdf-text',
    mode: 'table',
    header: true,
  });
  expect(extracted.rawRows[1]).toEqual(['A', '1,234.50', '0.25']);
  expect(extracted.rows[1]).toEqual(['A', '1234.5', '0.5']);
  expect(extracted.numericValues[1]).toEqual([null, 1234.5, 0.5]);
  expect(extracted.rawText).not.toContain('outside');
  expect(
    document.children.some((node: { type: string }) => node.type === 'table'),
  ).toBe(true);
  expect(figure.attrs.figureEdit.pdfSource.page).toBe(1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  const undone = await json(page);
  expect(
    undone.children.some((node: { type: string }) =>
      ['figure', 'table'].includes(node.type),
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const html = await bytes(await pending);
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
  });
  try {
    const fresh = await context.newPage();
    fresh.on('dialog', (dialog) => void dialog.accept());
    await fresh.goto('/');
    await expect(
      fresh.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    await fresh.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
      name: 'restored.html',
      mimeType: 'text/html',
      buffer: html,
    });
    await fresh
      .getByRole('dialog', { name: 'HTML取込の確認' })
      .getByRole('button', { name: '確認して取り込む' })
      .click();
    const restored = await json(fresh);
    expect(
      restored.children.find((node: { type: string }) => node.type === 'figure')
        .attrs.figureEdit.extraction,
    ).toEqual(extracted);
    expect(
      restored.children.some((node: { type: string }) => node.type === 'table'),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test('PDF recognition proposals are cleared after changing the region; corrected text is literal', async ({
  page,
}) => {
  await start(page);
  const dialog = await importDialog(page, numericPdf());
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', {
      name: '原本と確認済みの内容を挿入',
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByLabel('PDF範囲 height', { exact: true }).fill('50');
  await expect(
    dialog.getByRole('button', {
      name: '原本と確認済みの内容を挿入',
      exact: true,
    }),
  ).toHaveCount(0);
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await dialog.getByLabel('PDF抽出の挿入形式').selectOption('text');
  await dialog
    .getByLabel('PDF抽出本文')
    .fill('Reviewed text <script>window.bad=1</script>');
  await dialog
    .getByRole('button', { name: '原本と確認済みの内容を挿入', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.kumi-editor-content')).toContainText(
    'Reviewed text <script>window.bad=1</script>',
  );
  expect(
    await page.evaluate(() => (window as Window & { bad?: number }).bad),
  ).toBeUndefined();
  const doc = await json(page);
  expect(
    doc.children.find((node: { type: string }) => node.type === 'figure').attrs
      .figureEdit.extraction.text,
  ).toContain('<script>');
});

test('scanned PDF falls back to local OCR and creates an editable numeric table', async ({
  page,
}) => {
  await start(page);
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 420;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#000000';
    context.font = '36px Arial';
    [
      ['Sample', 'Value', 'Error'],
      ['Alpha', '1200', '0.5'],
      ['Beta', '2500', '0.8'],
    ].forEach((row, ri) =>
      row.forEach((value, ci) =>
        context.fillText(value, [60, 480, 900][ci], 90 + ri * 100),
      ),
    );
    return canvas.toDataURL('image/png');
  });
  const pdf = new jsPDF({
    unit: 'pt',
    format: [600, 210],
    orientation: 'landscape',
  });
  pdf.addImage(image, 'PNG', 0, 0, 600, 210);
  const dialog = await importDialog(
    page,
    Buffer.from(pdf.output('arraybuffer')),
  );
  await dialog.getByLabel('PDFのOCR言語').selectOption('eng');
  const externalPosts: string[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      !request.url().startsWith('http://localhost:3000/')
    )
      externalPosts.push(request.url());
  });
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await expect(dialog.getByText(/OCR認識スコア/)).toBeVisible({
    timeout: 150_000,
  });
  await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
    '1200',
  );
  await dialog
    .getByRole('button', { name: '原本と確認済みの内容を挿入', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const doc = await json(page);
  const extraction = doc.children.find(
    (node: { type: string }) => node.type === 'figure',
  ).attrs.figureEdit.extraction;
  expect(extraction).toMatchObject({
    method: 'ocr',
    mode: 'table',
    language: 'eng',
  });
  expect(extraction.numericValues[1][1]).toBe(1200);
  expect(externalPosts).toEqual([]);
});
