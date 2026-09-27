import { expect, test, type Download, type Page } from '@playwright/test';

const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => {
    errors.push(error.message);
  });
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

async function waitForEditor(page: Page): Promise<void> {
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
}

async function downloadText(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

test('ページ設定を反映しMarkdown保存後に読み直せる', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .fill('# 設定検証\n\n本文段落。\n\n次の段落。');
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await page.getByRole('combobox', { name: '用紙サイズ' }).selectOption('A5');
  await page
    .getByRole('combobox', { name: '用紙の向き' })
    .selectOption('landscape');
  await page.getByRole('spinbutton', { name: '左余白（mm）' }).fill('15');
  await page
    .getByRole('spinbutton', { name: '段落先頭の字下げ（字）' })
    .fill('1');
  await page.getByRole('spinbutton', { name: '行間（倍率）' }).fill('1.5');
  await page.getByRole('button', { name: 'ページ設定を適用' }).click();
  await expect(page.getByLabel('未保存')).toBeVisible();
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const layout = await page.locator('.report-preview').evaluate((element) => {
    const sheet = getComputedStyle(element);
    const paragraph = getComputedStyle(
      element.querySelector('.document-renderer > p')!,
    );
    const width = element.getBoundingClientRect().width;
    return {
      marginRatio: parseFloat(sheet.paddingLeft) / width,
      pageRatio: parseFloat(sheet.minHeight) / width,
      indentRatio:
        parseFloat(paragraph.textIndent) / parseFloat(paragraph.fontSize),
      lineRatio:
        parseFloat(paragraph.lineHeight) / parseFloat(paragraph.fontSize),
    };
  });
  expect(layout.marginRatio).toBeCloseTo(15 / 210, 3);
  expect(layout.pageRatio).toBeCloseTo(148 / 210, 3);
  expect(layout.indentRatio).toBeCloseTo(1, 3);
  expect(layout.lineRatio).toBeCloseTo(1.5, 3);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const saved = await downloadText(await downloadPromise);
  expect(saved).toContain('page_settings:');
  expect(saved).toContain('margin_left: 15');
  await page.getByRole('button', { name: '標準設定に戻す' }).click();
  await expect(page.getByRole('combobox', { name: '用紙サイズ' })).toHaveValue(
    'A4',
  );
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page.getByRole('textbox', { name: 'Markdown原稿' }).fill(saved);
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await expect(page.getByRole('combobox', { name: '用紙サイズ' })).toHaveValue(
    'A5',
  );
  await expect(
    page.getByRole('spinbutton', { name: '行間（倍率）' }),
  ).toHaveValue('1.5');
});

test('ルーラーで選択した複数段落の開始・終了・字下げを設定し保存できる', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page
    .getByRole('textbox', { name: 'Markdown原稿' })
    .fill('第一段落の本文です。\n\n第二段落の本文です。');
  await page.getByRole('button', { name: 'Markdownを適用' }).click();

  const paragraphs = page.locator('.kumi-editor-content > p');
  await expect(paragraphs).toHaveCount(2);
  await page.locator('.kumi-editor-content').evaluate((editor) => {
    const [first, second] = editor.querySelectorAll(':scope > p');
    if (!first?.firstChild || !second?.firstChild) {
      throw new Error('Expected two paragraphs');
    }
    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, 2);
    editor.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const ruler = page.getByRole('group', { name: '文字位置ルーラー' });
  const left = ruler.getByRole('slider', { name: '左位置' });
  const firstLine = ruler.getByRole('slider', { name: '1行目の字下げ' });
  const right = ruler.getByRole('slider', { name: '右位置' });
  await expect(left).toHaveAttribute('aria-disabled', 'false');
  await left.focus();
  await left.press('Shift+ArrowRight');
  await firstLine.focus();
  await firstLine.press('Shift+ArrowRight');
  await right.focus();
  await right.press('Shift+ArrowLeft');

  for (const paragraph of await paragraphs.all()) {
    await expect(paragraph).toHaveAttribute(
      'data-kumi-text-ruler',
      '{"left":5,"right":5,"firstLine":10}',
    );
    const style = await paragraph.evaluate((element) => {
      const computed = getComputedStyle(element);
      return {
        left: parseFloat(computed.marginLeft),
        right: parseFloat(computed.marginRight),
        firstLine: parseFloat(computed.textIndent),
      };
    });
    expect(style.left).toBeGreaterThan(1);
    expect(style.right).toBeGreaterThan(1);
    expect(style.firstLine).toBeGreaterThan(1);
  }

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const saved = await downloadText(await downloadPromise);
  expect(saved.match(/text_ruler=5,5,10/g)).toHaveLength(2);

  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const previewParagraphs = page.locator(
    '.report-preview .document-renderer > p',
  );
  await expect(previewParagraphs).toHaveCount(2);
  for (const paragraph of await previewParagraphs.all()) {
    const leftMargin = await paragraph.evaluate((element) =>
      parseFloat(getComputedStyle(element).marginLeft),
    );
    expect(leftMargin).toBeGreaterThan(1);
  }

  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await page.getByRole('textbox', { name: 'Markdown原稿' }).fill(saved);
  await page.getByRole('button', { name: 'Markdownを適用' }).click();
  await expect(page.locator('.kumi-editor-content > p')).toHaveCount(2);
  for (const paragraph of await page
    .locator('.kumi-editor-content > p')
    .all()) {
    await expect(paragraph).toHaveAttribute(
      'data-kumi-text-ruler',
      '{"left":5,"right":5,"firstLine":10}',
    );
  }

  const restoredFirst = page.locator('.kumi-editor-content > p').first();
  await restoredFirst.click();
  await ruler.getByRole('button', { name: 'リセット' }).click();
  await expect(restoredFirst).not.toHaveAttribute('data-kumi-text-ruler');
  await expect(page.locator('.kumi-editor-content > p').nth(1)).toHaveAttribute(
    'data-kumi-text-ruler',
    '{"left":5,"right":5,"firstLine":10}',
  );
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(restoredFirst).toHaveAttribute(
    'data-kumi-text-ruler',
    '{"left":5,"right":5,"firstLine":10}',
  );
});

test('Markdownの不正入力を拒否して現在文書を維持する', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/KUMI/);
  await expect(page.getByText('REPORT', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(page.locator('.kumi-editor-content')).toContainText('解析概要');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  await expect(source).toHaveValue(/type: report/);
  await source.fill('---\ntype: book\n---\n\n# 壊れた文書');
  await page.getByRole('button', { name: 'Markdownを適用' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'Markdownを適用できませんでした',
  );
  await expect(page.getByText('REPORT', { exact: true })).toBeVisible();
});

test('新規Slideを作成して完成プレビューへ切り替える', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'Slide', exact: true }).click();
  await expect(page.getByText('SLIDE', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();

  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await expect(page.locator('.slide-preview')).toBeVisible();
  await expect(page.locator('.slide-preview')).toContainText('タイトル');
});

test('数式と表を挿入してDocumentを編集できる', async ({ page }) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: 'インライン数式' }).click();
  await expect(page.locator('[data-type="inline-math"]')).toHaveCount(2);

  await page.getByRole('button', { name: '表を挿入' }).click();
  await expect(page.locator('.kumi-editor-content table')).toHaveCount(2);
  await expect(page.getByLabel('未保存')).toBeVisible();
});

test('表セルから高度表ツールを開き、行・罫線・文字揃えを編集できる', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByRole('button', { name: '表を挿入' }).click();
  const table = page.locator('.kumi-editor-content table').last();
  await table.locator('th').first().click();

  const toolbar = page.getByRole('toolbar', { name: '表の編集' });
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole('button', { name: '下に行を追加' }).click();
  await expect(table.locator('tr')).toHaveCount(4);

  await toolbar.getByRole('button', { name: 'すべての罫線' }).click();
  await expect(table.locator('th').first()).toHaveAttribute(
    'data-kumi-borders',
    /"top"/,
  );

  await toolbar.getByRole('button', { name: 'セルを右揃え' }).click();
  await expect(table.locator('th').first()).toHaveCSS('text-align', 'right');
});

test('表の列境界をドラッグし、選択した列を均等化して保存できる', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);
  await page.getByRole('button', { name: '表を挿入' }).click();

  const table = page.locator('.kumi-editor-content table').last();
  const firstHeader = table.locator('th').first();
  await firstHeader.scrollIntoViewIfNeeded();
  const firstCell = await firstHeader.boundingBox();
  if (!firstCell) throw new Error('table header expected');
  const borderX = firstCell.x + firstCell.width;
  const centerY = firstCell.y + firstCell.height / 2;
  const originalWidth = firstCell.width;

  await page.mouse.move(borderX - 2, centerY);
  await expect(table.locator('.column-resize-handle')).not.toHaveCount(0);
  await page.mouse.down();
  await page.mouse.move(borderX + 70, centerY, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      firstHeader.evaluate((cell) => cell.getBoundingClientRect().width),
    )
    .toBeGreaterThan(originalWidth + 25);
  await expect(firstHeader).toHaveAttribute('colwidth', /\d/);

  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(firstHeader).not.toHaveAttribute('colwidth');
  await expect
    .poll(async () =>
      firstHeader.evaluate((cell) => cell.getBoundingClientRect().width),
    )
    .toBeLessThan(originalWidth + 10);

  const bodyCells = table.locator('tr').nth(1).locator('td');
  await bodyCells.nth(0).scrollIntoViewIfNeeded();
  const firstBody = await bodyCells.nth(0).boundingBox();
  const secondBody = await bodyCells.nth(1).boundingBox();
  if (!firstBody || !secondBody) throw new Error('body cells expected');
  await page.mouse.move(
    firstBody.x + firstBody.width / 2,
    firstBody.y + firstBody.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    secondBody.x + secondBody.width / 2,
    secondBody.y + secondBody.height / 2,
    { steps: 5 },
  );
  await page.mouse.up();

  const toolbar = page.getByRole('toolbar', { name: '表の編集' });
  const distribute = toolbar.getByRole('button', { name: '選択列を均等化' });
  await expect(distribute).toBeEnabled();
  await distribute.click();
  const columns = table.locator('colgroup > col');
  await expect(columns).toHaveCount(3);
  const widths = await columns.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().width),
  );
  expect(Math.abs(widths[0] - widths[1])).toBeLessThanOrEqual(1);
  await expect(table.locator('td').first()).toHaveAttribute('colwidth', /\d/);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const saved = await downloadText(await downloadPromise);
  expect(saved).toContain('::: kumi-table');
  expect(saved).toContain('"colwidth"');
});

test('Markdown下書きをタブ間で保持し保存時に現在文書へ適用する', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  const draft =
    '---\ntype: report\ntitle: 下書き保存テスト\ntheme: calculation\n---\n\n# 保存後の本文\n\n下書きの内容';
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  const source = page.getByRole('textbox', { name: 'Markdown原稿' });
  await expect(page.getByRole('button', { name: '元に戻す' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'やり直す' })).toBeDisabled();
  for (const name of ['テーマ', '用紙サイズ', '用紙の向き']) {
    await expect(page.getByRole('combobox', { name })).toBeDisabled();
  }
  await source.fill(draft);
  await expect(page.getByLabel('未保存')).toBeVisible();

  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(source).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(
    'Markdownの変更を先に処理してください',
  );
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  await page.getByRole('button', { name: 'Markdownへ切り替え' }).click();
  await expect(source).toHaveValue(draft);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const downloaded = await downloadText(await downloadPromise);
  expect(downloaded).toContain('# 保存後の本文');
  expect(downloaded).toContain('下書きの内容');

  await page.getByRole('button', { name: 'ビジュアル編集へ切り替え' }).click();
  await expect(page.locator('.kumi-editor-content')).toContainText(
    '下書きの内容',
  );
  await expect(page.getByLabel('未保存')).toHaveCount(0);
});

test('Markdownと同時選択した相対画像をEditorとPreviewで表示する', async ({
  page,
}) => {
  await page.goto('/');
  await waitForEditor(page);

  await page.getByLabel('Markdownファイル').setInputFiles([
    {
      name: 'local-report.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\ntype: report\ntitle: 画像テスト\ntheme: latex\n---\n\n![応答図](images/response.svg)',
      ),
    },
    {
      name: 'response.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2563eb"/></svg>',
      ),
    },
  ]);

  const editorImage = page.locator('.kumi-editor-content img.kumi-figure');
  await expect(editorImage).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const previewImage = page.locator('.preview-figure img');
  await expect(previewImage).toBeVisible();
  await expect(previewImage).toHaveAttribute('src', /^blob:/);
});
