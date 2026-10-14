import { expect, test, type Download, type Page } from '@playwright/test';

test.setTimeout(60_000);

async function downloadBytes(download: Download): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportJson(page: Page): Promise<unknown> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON', exact: true }).click();
  return JSON.parse(
    new TextDecoder().decode(await downloadBytes(await pending)),
  );
}

for (const type of ['report', 'slide'] as const) {
  test(`${type}: 編集用HTMLを画像込みで再読込し、本文・数式・表・ノートを保持する`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', (dialog) => void dialog.accept());
    await page.goto('/');
    await expect(
      page.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    const input = page.getByLabel('HTML・Markdown・JSONファイル');
    await input.setInputFiles([
      {
        name: `${type}.md`,
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          `---\ntype: ${type}\ntitle: ${type} HTML往復\ntheme: technical\n---\n\n# 編集用HTML\n\n本文と **強調** と $x^2$。\n\n| 項目 | 値 |\n| --- | --- |\n| 試験 | 42 |\n\n![埋込SVG](chart.svg)\n\n::: ${type === 'slide' ? 'slidebreak' : 'pagebreak'}\n:::\n\n# 2ページ目\n\n::: notes\n発表者への手掛かり\n:::`,
        ),
      },
      {
        name: 'chart.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#2563eb"/></svg>',
        ),
      },
    ]);
    await expect(page.locator('.kumi-editor-content')).toContainText(
      '編集用HTML',
    );
    const before = await exportJson(page);
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
    const html = await downloadBytes(await pending);
    expect(new TextDecoder().decode(html)).toContain('kumi-editable-document');
    await input.setInputFiles({
      name: 'reimport.html',
      mimeType: 'text/html',
      buffer: html,
    });
    const review = page.getByRole('dialog', { name: 'HTML取込の確認' });
    await expect(review).toBeVisible();
    await expect(review).toContainText('編集用データを復元');
    await expect(review.getByRole('img', { name: '埋込SVG' })).toHaveJSProperty(
      'naturalWidth',
      80,
    );
    await review.getByRole('button', { name: '確認して取り込む' }).click();
    await expect(review).toBeHidden();
    expect(await exportJson(page)).toEqual(before);
    await page
      .getByRole('button', { name: '完成プレビューへ切り替え' })
      .click();
    await expect(
      page.locator(
        type === 'slide' ? '.slide-preview .katex' : '.report-preview .katex',
      ),
    ).toHaveCount(1);
    await expect(
      page.locator(
        type === 'slide' ? '.slide-preview table' : '.report-preview table',
      ),
    ).toContainText('42');
    await expect(
      page.locator(
        type === 'slide' ? '.slide-preview img' : '.report-preview img',
      ),
    ).toHaveJSProperty('naturalWidth', 80);
    expect(errors).toEqual([]);
  });
}

test('外部HTMLは適用前に変換結果を確認でき、キャンセルと不正データで元の文書を維持する', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('attack.invalid'))
      externalRequests.push(request.url());
  });
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/');
  const editor = page.locator(
    '[contenteditable="true"][aria-label="文書本文"]',
  );
  await expect(editor).toBeVisible();
  await editor.fill('保持する本文');
  const before = await exportJson(page);
  const input = page.getByLabel('HTML・Markdown・JSONファイル');
  const html = Buffer.from(
    '<title>External</title><script src="https://attack.invalid/payload.js"></script><div class="slide"><h1 onclick="window.importExecuted=true">取り込む見出し</h1><script>window.importExecuted=true</script><p><a href="javascript:window.importExecuted=true">保持するリンク文字</a></p></div><div class="slide"><h2>2枚目</h2><canvas>未対応グラフの代替文字</canvas><svg xmlns="http://www.w3.org/2000/svg" onload="window.importExecuted=true"><rect width="10" height="10"/></svg></div>',
  );
  await input.setInputFiles({
    name: 'external.html',
    mimeType: 'text/html',
    buffer: html,
  });
  const review = page.getByRole('dialog', { name: 'HTML取込の確認' });
  await expect(review).toContainText('外部HTMLを編集できる文書に変換');
  await expect(review).toContainText('canvas');
  await expect(review).toContainText('2 ページ');
  await review.getByRole('button', { name: 'キャンセル' }).click();
  await expect(review).toBeHidden();
  expect(await exportJson(page)).toEqual(before);

  await input.setInputFiles({
    name: 'external.html',
    mimeType: 'text/html',
    buffer: html,
  });
  await review.getByRole('button', { name: '確認して取り込む' }).click();
  await expect(editor).toContainText('取り込む見出し');
  const converted = (await exportJson(page)) as {
    metadata: { html_import: unknown };
  };
  expect(converted.metadata.html_import).toMatchObject({
    kind: 'converted',
    page_count: 2,
  });
  expect(
    await page.evaluate(
      () => (window as unknown as { importExecuted?: boolean }).importExecuted,
    ),
  ).toBeUndefined();
  expect(externalRequests).toEqual([]);
  await input.setInputFiles({
    name: 'invalid.html',
    mimeType: 'text/html',
    buffer: Buffer.from(
      '<template id="kumi-editable-document" data-encoding="base64">broken!</template><h1>Do not import</h1>',
    ),
  });
  await expect(
    page
      .getByText('編集用HTMLのBase64データが不正です。', { exact: false })
      .first(),
  ).toBeVisible();
  expect(await exportJson(page)).toEqual(converted);
});
