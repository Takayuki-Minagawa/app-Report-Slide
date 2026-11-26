import { expect, test, type Download } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

test.setTimeout(150_000);

async function bytes(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Valid CSS that would restyle the whole application if it were not confined.
const hostile = `
    * { outline-color: rgb(1, 2, 3); }
    :is(html, body, header, main, nav, button) { outline-color: rgb(1, 2, 3); }
    .report-sheet ~ *, .report-sheet + * { outline-color: rgb(1, 2, 3); }`;

const source = (settings: string, extraCss = '') => `---
type: report
title: 書式の検証
theme: report-jp
toc: true
number_sections: true
report_settings:
  cover: true
  toc_page: true
  caption_separator: ": "
  appendix_numbering: letter
${settings}
report_style:
  headings:
    h2:
      size: 13
  css: |
    .document-renderer h2 { text-decoration: underline; }${extraCss}
---

# はじめに

## 目的

本文です。式 $M = \\sqrt{a^2 + b^2}$ を用いる。

> [!NOTE]
> 注記の本文

| 階 | 値 |
| --- | --- |
| 1 | 10 |
{#tab:a caption="条件"}

# 数値表
{appendix=true}

本文です。
`;

test('報告書（Word風）テーマと文書のCSSがプレビューだけに反映され、編集画面には漏れない', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  const before = await page
    .locator('body')
    .evaluate(
      (body) =>
        getComputedStyle(body.querySelector('header, main, button')!)
          .outlineColor,
    );
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'style.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source('', hostile)),
  });
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const preview = page.locator('.kumi-report-style-scope');
  await expect(preview.locator('.report-preview').first()).toBeVisible();
  const styles = await preview.evaluate((scope) => {
    const style = (selector: string) =>
      getComputedStyle(scope.querySelector(selector)!);
    const body = parseFloat(style('.document-renderer > p').fontSize);
    return {
      h1Font: style('h1[id]').fontFamily,
      h1Size: parseFloat(style('h1[id]').fontSize) / body,
      h1Color: style('h1[id]').color,
      h1Border: style('h1[id]').borderBottomWidth,
      // Document values replace the theme (13pt on a 10.5pt body), and the
      // document CSS is applied last.
      h2Size: parseFloat(style('h2[id]').fontSize) / body,
      h2Decoration: style('h2[id]').textDecorationLine,
      header: style('th').backgroundColor,
      rule: style('td').borderTopWidth,
      note: scope.querySelector('.callout-title')!.textContent,
      caption: scope.querySelector('caption')!.textContent,
      appendix: scope.querySelectorAll('h1[id]')[1].textContent,
      contentsTitle: scope.querySelector('.document-toc h2')!.textContent,
      coverLabels: [...scope.querySelectorAll('.report-cover dt')].filter(
        (label) => getComputedStyle(label).display !== 'none',
      ).length,
      footer: scope.querySelector('[data-report-page-kind="body"] footer')!
        .textContent,
      scopedOutline: style('.document-renderer > p').outlineColor,
    };
  });
  expect(styles.h1Font).toContain('Noto Sans JP');
  expect(styles.h1Size).toBeCloseTo(14 / 10.5, 2);
  expect(styles.h1Color).toBe('rgb(0, 0, 0)');
  expect(styles.h1Border).toBe('0px');
  expect(styles.h2Size).toBeCloseTo(13 / 10.5, 2);
  expect(styles.h2Decoration).toBe('underline');
  expect(styles.header).toBe('rgba(0, 0, 0, 0)');
  expect(parseFloat(styles.rule)).toBeGreaterThan(0);
  expect(styles.note).toBe('（注）');
  expect(styles.caption).toBe('表 1: 条件');
  expect(styles.appendix).toBe('付録 A 数値表');
  expect(styles.contentsTitle).toBe('目 次');
  expect(styles.coverLabels).toBe(0);
  expect(styles.footer).toBe('- 1 -');
  expect(styles.scopedOutline).toBe('rgb(1, 2, 3)');

  // The same style sheet must not reach anything outside the previewed report.
  const after = await page.locator('body').evaluate((body) => {
    const scope = body.querySelector('.kumi-report-style-scope')!;
    const outside = [...body.querySelectorAll('*')].filter(
      (element) => !scope.contains(element) && !element.contains(scope),
    );
    return {
      outline: getComputedStyle(body.querySelector('header, main, button')!)
        .outlineColor,
      leaked: outside.filter(
        (element) => getComputedStyle(element).outlineColor === 'rgb(1, 2, 3)',
      ).length,
    };
  });
  expect(after.outline).toBe(before);
  expect(after.leaked).toBe(0);
  expect(errors).toEqual([]);
});

test('組版後のプレビューとWord出力に同じ書式設定が反映される', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'style.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(
      source(
        '  toc_page_numbers: true\n  front_matter_page_numbers: roman\n  word_fields: true',
        hostile,
      ),
    ),
  });
  await expect(page.getByLabel('目次に実際のページ番号を表示')).toBeChecked();
  await expect(page.getByLabel('ページ番号の書式')).toHaveValue('- {n} -');
  await expect(page.getByRole('note')).toContainText('Wordには反映されません');
  await page.getByRole('button', { name: '完成プレビューへ切り替え' }).click();
  const preview = page.frameLocator(
    'iframe[title="組版後のレポートプレビュー"]',
  );
  await expect(preview.locator('html')).toHaveAttribute(
    'data-kumi-pagination',
    'ready',
    { timeout: 60_000 },
  );
  expect(
    await preview.locator('.kumi-physical-footer').allTextContents(),
  ).toEqual(['- i -', '- 1 -']);
  expect(await preview.locator('[data-toc-target]').allTextContents()).toEqual([
    '- 1 -',
    '- 1 -',
    '- 1 -',
  ]);
  await expect(preview.locator('h2[id]')).toHaveCSS(
    'text-decoration-line',
    'underline',
  );
  await expect(preview.locator('.kumi-physical-footer').first()).toHaveCSS(
    'text-align',
    'center',
  );

  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Word（.docx）を出力', exact: true })
    .click();
  const archive = unzipSync(await bytes(await pending));
  const xml = strFromU8(archive['word/document.xml']);
  const styles = strFromU8(archive['word/styles.xml']);
  // Named styles from the same style data: gothic 14pt and 13pt headings.
  const wordStyle = (id: string) => {
    const start = styles.indexOf(`w:styleId="${id}"`);
    return styles.slice(start, styles.indexOf('</w:style>', start));
  };
  expect(wordStyle('Heading1')).toContain('w:eastAsia="Yu Gothic"');
  expect(wordStyle('Heading1')).toContain('<w:sz w:val="28"/>');
  expect(wordStyle('Heading2')).toContain('<w:sz w:val="26"/>');
  // An editable Word equation, and numbers Word can refresh.
  expect(xml).toContain('<m:rad>');
  expect(xml).toContain('SEQ 表 \\* ARABIC');
  expect(xml).toContain('TOC \\h');
  expect(xml).toContain('w:fmt="lowerRoman"');
  expect(xml).toContain('（注）');
  expect(xml).not.toContain('text-decoration');
  await expect(
    page.getByText(/CSS.*Wordには反映されません/).first(),
  ).toBeVisible();
});
