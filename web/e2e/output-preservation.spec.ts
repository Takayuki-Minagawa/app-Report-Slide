import { expect, test, type Download } from '@playwright/test';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.setTimeout(120_000);
async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of (await download.createReadStream())!)
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

for (const type of ['report', 'slide'])
  test(`${type}: print comparison produces searchable Japanese text and vector figures`, async ({
    page,
    browser,
  }, info) => {
    await page.setViewportSize({ width: 1680, height: 1100 });
    await page.goto('/');
    await expect(
      page.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    const source = `---\ntype: ${type}\ntitle: 検索できる資料\n---\n\n# 日本語の本文\n\n日本語を検索できます。数式 $x^2$ と表。\n\n|項目|値|\n|---|---|\n|比較|42|\n\n![ベクター図](vector.svg)\n{width=20%}\n\n::: ${type === 'slide' ? 'slidebreak' : 'pagebreak'}\n:::\n\n# 第二ページ\n\n保存と再編集\n\n::: notes\nPRIVATE_PRESENTER_NOTE\n:::`;
    await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles([
      {
        name: 'print.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(source),
      },
      {
        name: 'vector.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect x="2" y="2" width="196" height="56" fill="#eef" stroke="#123" stroke-width="2"/><path d="M10 45 L70 10 L130 45 L190 10" fill="none" stroke="#b24" stroke-width="3"/></svg>',
        ),
      },
    ]);
    await page
      .getByRole('button', { name: '出力比較・検索できるPDF', exact: true })
      .click();
    const dialog = page.getByRole('dialog', {
      name: '出力比較・検索できるPDF',
      exact: true,
    });
    await expect(
      dialog.getByRole('button', { name: '印刷／PDF保存', exact: true }),
    ).toBeEnabled();
    await dialog.getByRole('button', { name: '印刷用紙', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: '印刷／PDF保存', exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.frameLocator('iframe').locator('.print-page'),
    ).toHaveCount(2);
    await dialog.getByRole('button', { name: 'HTML', exact: true }).click();
    await expect(
      dialog
        .frameLocator('iframe')
        .getByRole('heading', { name: /日本語の本文/ }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '印刷用紙', exact: true }).click();
    await expect(
      dialog.getByRole('button', { name: '印刷／PDF保存', exact: true }),
    ).toBeEnabled();
    const html = await dialog
      .locator('iframe')
      .evaluate(
        (frame: HTMLIFrameElement) =>
          frame.contentDocument!.documentElement.outerHTML,
      );
    const printed = await browser.newPage();
    await printed.setContent(html);
    await printed.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((image) => image.decode()));
    });
    const pdfBytes = await printed.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      path: info.outputPath(`${type}-searchable.pdf`),
    });
    await printed.screenshot({
      path: info.outputPath(`${type}-print-preview.png`),
      fullPage: true,
    });
    await printed.close();
    const loading = getDocument({
      data: new Uint8Array(pdfBytes),
      useSystemFonts: true,
    });
    const pdf = await loading.promise;
    expect(pdf.numPages).toBe(2);
    const first = await pdf.getPage(1);
    const text = (await first.getTextContent()).items
      .flatMap((item) => ('str' in item ? [item.str] : []))
      .join('');
    expect(text).toContain('日本語の本文');
    expect(text).toContain('日本語を検索できます');
    expect(text).toContain('42');
    const secondText = (await (await pdf.getPage(2)).getTextContent()).items
      .flatMap((item) => ('str' in item ? [item.str] : []))
      .join('');
    expect(secondText).toContain('第二ページ');
    expect(secondText).not.toContain('PRIVATE_PRESENTER_NOTE');
    const operations = await first.getOperatorList();
    expect(operations.fnArray).not.toContain(OPS.paintImageXObject);
    expect(operations.fnArray).toContain(OPS.constructPath);
    await loading.destroy();
  });

test('unsupported imported content remains inspectable after a fresh HTML round trip', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  const unknown = {
    type: 'futureDiagram',
    attrs: {
      nodeId: 'future',
      value: '<script>window.unsafeSource=true</script>',
    },
  };
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'future.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        type: 'report',
        metadata: { title: '原文保持' },
        children: [unknown],
      }),
    ),
  });
  const panel = page
    .locator('details')
    .filter({
      has: page.locator('summary', { hasText: '保持した取込原データ' }),
    })
    .first();
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').first().click();
  await panel.locator('details summary').click();
  await expect(panel.locator('pre')).toContainText('futureDiagram');
  expect(await page.evaluate(() => 'unsafeSource' in window)).toBe(false);
  const download = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const html = await bytes(await download);
  const fresh = await browser.newContext({
    viewport: { width: 1680, height: 1100 },
  });
  const reopened = await fresh.newPage();
  await reopened.goto('/');
  await expect(
    reopened.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await reopened.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'retained.html',
    mimeType: 'text/html',
    buffer: html,
  });
  await reopened
    .getByRole('button', { name: '確認して取り込む', exact: true })
    .click();
  const saved = reopened.waitForEvent('download');
  await reopened.getByRole('button', { name: 'JSON', exact: true }).click();
  const json = JSON.parse((await bytes(await saved)).toString());
  expect(JSON.parse(json.metadata.preserved_content[0].source)).toEqual(
    unknown,
  );
  await fresh.close();
});
