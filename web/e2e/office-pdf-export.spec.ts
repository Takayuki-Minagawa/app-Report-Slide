import { expect, test, type Download } from '@playwright/test';
import { unzipSync } from 'fflate';

test.setTimeout(120_000);

async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

for (const type of ['report', 'slide'] as const) {
  test(`${type}: editable Office and PDF downloads include all pages and embedded images`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(
      page.locator('[contenteditable="true"][aria-label="文書本文"]'),
    ).toBeVisible();
    const imageSource =
      '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="100"><rect width="240" height="100" fill="#2563eb"/><circle cx="120" cy="50" r="30" fill="#f59e0b"/></svg>';
    const source = `---\ntype: ${type}\ntitle: 出力検証\nnumber_sections: true\n---\n\n# 日本語の報告書\n\n**太字の本文**と数式 $E=mc^2$。\n\n| 項目 | 値 |\n| --- | --- |\n| 結果 | 42 |\n\n![検証用の図](chart.svg)\n{width=40%}\n\n::: ${type === 'report' ? 'pagebreak' : 'slidebreak'}\n:::\n\n# 2ページ目\n\n末尾の本文も出力します。${type === 'slide' ? '\n\n::: notes\n秘密の発表者ノート\n:::' : ''}`;
    await page.getByLabel('Markdownファイル').setInputFiles([
      {
        name: 'document.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(source),
      },
      {
        name: 'chart.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(imageSource),
      },
    ]);
    const office = page.getByRole('button', {
      name:
        type === 'report' ? 'Word（.docx）を出力' : 'PowerPoint（.pptx）を出力',
      exact: true,
    });
    await expect(office).toBeVisible();
    const officePromise = page.waitForEvent('download');
    await office.click();
    const officeDownload = await officePromise;
    expect(officeDownload.suggestedFilename()).toBe(
      `出力検証.${type === 'report' ? 'docx' : 'pptx'}`,
    );
    await officeDownload.saveAs(
      testInfo.outputPath(type === 'report' ? 'report.docx' : 'slides.pptx'),
    );
    const zip = unzipSync(await bytes(officeDownload));
    expect(
      Object.keys(zip).some((key) => /(?:word|ppt)\/media\/.+\.png$/.test(key)),
    ).toBe(true);
    const xml = new TextDecoder().decode(
      zip[type === 'report' ? 'word/document.xml' : 'ppt/slides/slide1.xml'],
    );
    expect(xml).toContain('日本語の報告書');
    expect(xml).toContain('太字の本文');
    expect(xml).toContain('42');
    if (type === 'slide') {
      expect(zip['ppt/slides/slide2.xml']).toBeDefined();
      expect(
        new TextDecoder().decode(zip['ppt/notesSlides/notesSlide2.xml']),
      ).toContain('秘密の発表者ノート');
    }
    const pdfPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'PDFを出力', exact: true }).click();
    await expect(
      page.getByText('PDFファイルを出力しました', { exact: true }).first(),
    ).toBeVisible();
    const pdfDownload = await pdfPromise;
    expect(pdfDownload.suggestedFilename()).toBe('出力検証.pdf');
    await pdfDownload.saveAs(testInfo.outputPath(`${type}.pdf`));
    const pdf = (await bytes(pdfDownload)).toString('latin1');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(2);
    expect(pdf).toContain('/Subtype /Image');
    await expect(
      page.getByText('PDFファイルを出力しました', { exact: true }).first(),
    ).toBeVisible();
    await expect(page.locator('iframe[data-kumi-pdf]')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath('workspace.png'),
      fullPage: true,
    });
  });
}

test('combined chapter project exports Word and PDF while excluding disabled chapters', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('Markdownファイル').setInputFiles({
    name: 'first.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('---\ntitle: 全体報告書\n---\n\n# First chapter'),
  });
  await page
    .getByRole('button', { name: '現在のReportをプロジェクト化', exact: true })
    .click();
  const chapterInput = page.locator(
    'input[type="file"][aria-label="原稿を章として追加"]',
  );
  await chapterInput.setInputFiles({
    name: 'excluded.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Excluded chapter'),
  });
  await page.getByLabel('全体出力に含める', { exact: true }).uncheck();
  await chapterInput.setInputFiles({
    name: 'last.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Last chapter'),
  });
  for (const name of ['Word（.docx）を出力', 'PDFを出力']) {
    const promise = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    const download = await promise;
    const content = await bytes(download);
    if (name.startsWith('Word')) {
      const zip = unzipSync(content);
      const xml = new TextDecoder().decode(zip['word/document.xml']);
      expect(xml).toContain('First chapter');
      expect(xml).toContain('Last chapter');
      expect(xml).not.toContain('Excluded chapter');
    } else
      expect(content.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(
        2,
      );
  }
});

test('long reports paginate and oversized slides fail without a partial PDF', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.locator('[contenteditable="true"][aria-label="文書本文"]'),
  ).toBeVisible();
  await page.getByLabel('Markdownファイル').setInputFiles({
    name: 'long-report.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\ntype: report\n---\n\n# Long report\n\n' +
        Array.from(
          { length: 80 },
          (_, i) =>
            `Paragraph ${i + 1}: 長い報告書の本文をページ分割して保存します。`,
        ).join('\n\n'),
    ),
  });
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDFを出力', exact: true }).click();
  await expect(
    page.getByText('PDFファイルを出力しました', { exact: true }).first(),
  ).toBeVisible();
  const pdf = (await bytes(await promise)).toString('latin1');
  expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  await page.getByLabel('Markdownファイル').setInputFiles({
    name: 'long-slide.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      '---\ntype: slide\n---\n\n# Oversized slide\n\n' +
        Array.from({ length: 50 }, () => 'Long paragraph').join('\n\n'),
    ),
  });
  const downloads: Download[] = [];
  page.on('download', (download) => downloads.push(download));
  await page.getByRole('button', { name: 'PDFを出力', exact: true }).click();
  await expect(
    page
      .getByText('PDFファイルを出力できませんでした', { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'PDFを出力', exact: true }),
  ).toBeEnabled();
  expect(downloads).toEqual([]);
  await expect(page.locator('iframe[data-kumi-pdf]')).toHaveCount(0);
});
