import { expect, test, type Locator, type Page } from '@playwright/test';
import { jsPDF } from 'jspdf';

test.setTimeout(90_000);
test.use({ actionTimeout: 15_000 });

function tablePdf() {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
  pdf.setFontSize(12);
  [
    ['Sample', 'Value', 'Unit'],
    ['Alpha', '1,234.5', 'MPa'],
    ['Beta', '2500', 'MPa'],
  ].forEach((row, ri) =>
    row.forEach((cell, ci) => pdf.text(cell, [48, 220, 390][ci], 90 + ri * 30)),
  );
  pdf.addPage();
  pdf.text('Second page', 48, 90);
  return Buffer.from(pdf.output('arraybuffer'));
}

async function openPdf(page: Page) {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'PDFから図を追加', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'PDFから図を取り込む',
    exact: true,
  });
  await dialog.getByLabel('取り込むPDFファイル').setInputFiles({
    name: 'review-table.pdf',
    mimeType: 'application/pdf',
    buffer: tablePdf(),
  });
  await expect(dialog.getByLabel('PDF切り抜き範囲')).toBeVisible();
  return dialog;
}

async function expectFixedControls(dialog: Locator) {
  await expect(dialog).toHaveJSProperty('scrollTop', 0);
  await expect(
    dialog.getByRole('heading', { name: 'PDFから図を取り込む', exact: true }),
  ).toBeInViewport({ ratio: 1 });
  for (const name of [
    '1. 範囲・出典を確認',
    '2. 文字・表を読み取る',
    'PDF取り込みを閉じる',
    'キャンセル',
    '選択範囲を図として挿入',
  ]) {
    await expect(
      dialog.getByRole('button', { name, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
}

for (const viewport of [
  { width: 1366, height: 768 },
  { width: 900, height: 700 },
]) {
  test(`PDF review remains reachable at ${viewport.width}px and TSV drafts cannot overwrite reviewed cells`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const dialog = await openPdf(page);
    await expectFixedControls(dialog);
    const jump = dialog.getByRole('button', {
      name: '2. 文字・表を読み取る',
      exact: true,
    });
    const insertImage = dialog.getByRole('button', {
      name: '選択範囲を図として挿入',
      exact: true,
    });
    await expect(jump).toBeInViewport();
    await expect(insertImage).toBeInViewport();
    await expect(
      dialog.getByLabel('PDF出典 title', { exact: true }),
    ).toBeHidden();
    await jump.click();
    const read = dialog.getByRole('button', {
      name: '選択範囲を読み取る',
      exact: true,
    });
    await expect(read).toBeInViewport();
    await read.click();
    const heading = dialog.getByRole('heading', {
      name: '読み取り結果を確認',
      exact: true,
    });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expectFixedControls(dialog);
    const insert = dialog.getByRole('button', {
      name: '原本と確認済みの内容を挿入',
      exact: true,
    });
    await expect(insert).toBeInViewport();
    const original = dialog.getByLabel('PDF読み取りの原本', { exact: true });
    const viewBox = await original.getAttribute('viewBox');
    const originalImage = await original.locator('image').getAttribute('href');
    const originalWidth = await original.evaluate(
      (svg) => svg.getBoundingClientRect().width,
    );
    const cropHeight = await dialog
      .getByLabel('PDF範囲 height', { exact: true })
      .inputValue();
    const zoom = dialog.getByLabel('PDF原本の表示倍率', { exact: true });
    await zoom.selectOption('300');
    await expect
      .poll(() => original.evaluate((svg) => svg.getBoundingClientRect().width))
      .toBeCloseTo(originalWidth * 3, 0);
    const originalFrame = dialog.getByRole('region', {
      name: 'PDF原本の拡大確認',
      exact: true,
    });
    await originalFrame.focus();
    await originalFrame.press('ArrowRight');
    await expect
      .poll(() => originalFrame.evaluate((frame) => frame.scrollLeft))
      .toBeGreaterThan(0);
    await originalFrame.press('ArrowDown');
    await expect
      .poll(() => originalFrame.evaluate((frame) => frame.scrollTop))
      .toBeGreaterThan(0);
    await expectFixedControls(dialog);
    await expect(original).toHaveAttribute('viewBox', viewBox!);
    await expect(original.locator('image')).toHaveAttribute(
      'href',
      originalImage!,
    );
    await expect(
      dialog.getByLabel('PDF範囲 height', { exact: true }),
    ).toHaveValue(cropHeight);
    await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
      '1,234.5',
    );
    await zoom.selectOption('100');
    await expect
      .poll(() => original.evaluate((svg) => svg.getBoundingClientRect().width))
      .toBeCloseTo(originalWidth, 0);
    const firstValue = dialog.getByLabel('PDF表 2-2', { exact: true });
    const secondValue = dialog.getByLabel('PDF表 3-2', { exact: true });
    await expect(firstValue).toHaveAccessibleDescription(/見出し Value/);
    await firstValue.fill('1300');
    await firstValue.press('Enter');
    await expect(secondValue).toBeFocused();
    await secondValue.press('Shift+Enter');
    await expect(firstValue).toBeFocused();
    await firstValue.press('Tab');
    await expect(dialog.getByLabel('PDF表 2-3', { exact: true })).toBeFocused();
    await dialog.getByText('TSVで行・列を修正', { exact: true }).click();
    const tsv = dialog.getByLabel('PDF表TSV', { exact: true });
    await tsv.fill('X'.repeat(2001));
    await expect(dialog.getByRole('alert')).toContainText('2,000文字');
    await expect(insert).toBeDisabled();
    await expect(insertImage).toBeDisabled();
    await expect(firstValue).toBeDisabled();
    await expect(firstValue).toHaveValue('1300');
    await expect(
      dialog.getByRole('button', { name: '確認中の表をCSV保存', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: '数値候補を表に反映', exact: true }),
    ).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'TSVを表に反映', exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'TSVの編集を取り消す', exact: true })
      .click();
    await expect(tsv).toHaveValue(
      'Sample\tValue\tUnit\nAlpha\t1300\tMPa\nBeta\t2500\tMPa',
    );
    await expect(firstValue).toHaveValue('1300');
    await expect(insert).toBeEnabled();
    await tsv.fill('Sample\tValue\tUnit\nReviewed\t900\tMPa');
    await expect(firstValue).toHaveValue('1300');
    await expect(insert).toBeDisabled();
    await dialog
      .getByRole('button', { name: 'PDF取り込みを閉じる', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toContainText(
      'PDF取り込みを閉じる',
    );
    await expectFixedControls(dialog);
    await dialog
      .getByRole('button', { name: 'TSV編集に戻る', exact: true })
      .click();
    await expect(tsv).toBeFocused();
    await expect(tsv).toBeInViewport();
    await expectFixedControls(dialog);
    await dialog
      .getByRole('button', { name: 'TSVを表に反映', exact: true })
      .click();
    await expect(firstValue).toHaveValue('900');
    await expectFixedControls(dialog);
    await expect(
      dialog.getByRole('button', { name: 'TSVを表に反映', exact: true }),
    ).toBeInViewport();
    await expect(dialog.getByLabel('PDF表 2-1', { exact: true })).toHaveValue(
      'Reviewed',
    );
    await expect(insert).toBeEnabled();
    await expect(insert).toBeInViewport();
    await dialog
      .getByRole('button', { name: '1. 範囲・出典を確認', exact: true })
      .click();
    await expect(dialog.getByLabel('取り込むPDFファイル')).toBeInViewport();
    await expectFixedControls(dialog);
    await expect(insert).toBeInViewport();
    await insert.click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.kumi-editor-content table')).toContainText(
      'Reviewed',
    );
    await expect(page.locator('.kumi-editor-content table')).toContainText(
      '900',
    );
  });
}

test('PDF TSV drafts survive close, page, resolution and crop actions until explicitly discarded', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const dialog = await openPdf(page);
  const goToReview = dialog.getByRole('button', {
    name: '2. 文字・表を読み取る',
    exact: true,
  });
  const goToSource = dialog.getByRole('button', {
    name: '1. 範囲・出典を確認',
    exact: true,
  });
  await goToReview.click();
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
    '1,234.5',
  );
  await dialog.getByText('TSVで行・列を修正', { exact: true }).click();
  const tsv = dialog.getByLabel('PDF表TSV', { exact: true });
  const draft = 'Draft\tValue\nKeep my edits\t345';
  await tsv.fill(draft);
  await dialog
    .getByRole('button', { name: 'PDF取り込みを閉じる', exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('PDF取り込みを閉じる');
  await expect(tsv).toHaveValue(draft);
  await dialog
    .getByRole('button', { name: 'TSV編集に戻る', exact: true })
    .click();
  await expect(tsv).toBeFocused();
  await expectFixedControls(dialog);
  await goToSource.click();
  await dialog.getByLabel('PDFページ', { exact: true }).selectOption('2');
  await expect(dialog.getByLabel('PDFページ', { exact: true })).toHaveValue(
    '1',
  );
  await expect(dialog.getByRole('alert')).toContainText('PDFページを変更');
  await expect(tsv).toHaveValue(draft);
  await dialog
    .getByRole('button', { name: 'TSV編集に戻る', exact: true })
    .click();
  await goToSource.click();
  await dialog.getByLabel('PDF解像度', { exact: true }).selectOption('72');
  await expect(dialog.getByLabel('PDF解像度', { exact: true })).toHaveValue(
    '144',
  );
  await expect(dialog.getByRole('alert')).toContainText('PDF解像度を変更');
  await expect(tsv).toHaveValue(draft);
  await dialog
    .getByRole('button', { name: 'TSV編集に戻る', exact: true })
    .click();
  await goToSource.click();
  await dialog.getByLabel('PDF範囲 height', { exact: true }).fill('50');
  await expect(
    dialog.getByLabel('PDF範囲 height', { exact: true }),
  ).toHaveValue('100');
  await expect(dialog.getByRole('alert')).toContainText('読み取り範囲を変更');
  await expect(tsv).toHaveValue(draft);
  await dialog
    .getByRole('button', { name: 'TSV編集を破棄して続行', exact: true })
    .click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(
    dialog.getByLabel('PDF範囲 height', { exact: true }),
  ).toHaveValue('50');
  await expect(dialog.getByLabel('PDF表TSV', { exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole('button', {
      name: '原本と確認済みの内容を挿入',
      exact: true,
    }),
  ).toHaveCount(0);
  await goToReview.click();
  await dialog
    .getByRole('button', { name: '選択範囲を読み取る', exact: true })
    .click();
  await expect(dialog.getByLabel('PDF表 2-2', { exact: true })).toHaveValue(
    '1,234.5',
  );
  await dialog.getByText('TSVで行・列を修正', { exact: true }).click();
  await dialog.getByLabel('PDF表TSV', { exact: true }).fill(draft);
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: 'TSV編集を破棄して続行', exact: true })
    .click();
  await expect(dialog).toBeHidden();
});
