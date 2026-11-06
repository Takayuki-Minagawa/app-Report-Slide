import { expect, test, type Download, type Page } from '@playwright/test';

test.setTimeout(120_000);

async function downloadText(download: Download) {
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function exportedReport(
  page: Page,
  body: string,
  settings = '',
  pageSettings = '',
) {
  await page.goto('/');
  await expect(page.locator('.tiptap')).toBeVisible();
  const source = `---
type: report
title: Pagination boundary checks
toc: true
report_settings:
  toc_page_numbers: true
  toc_page: true
  toc_depth: 2
${settings}
${pageSettings}
---

${body}`;
  await page.getByLabel('HTML・Markdown・JSONファイル').setInputFiles({
    name: 'pagination-boundaries.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(source),
  });
  await expect(page.locator('.tiptap')).toContainText('本文');
  await expect(
    page.getByRole('checkbox', { name: '目次に実際のページ番号を表示' }),
  ).toBeChecked();
  const pending = page.waitForEvent('download');
  await page
    .getByRole('button', { name: '編集できるReport HTMLを保存', exact: true })
    .click();
  const html = await downloadText(await pending);
  const exported = await page.context().newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  exported.on('pageerror', (error) => errors.push(error.message));
  await exported.route('**/*', async (route) => {
    if (new URL(route.request().url()).pathname === '/pagination-export.html') {
      await route.fulfill({ body: html, contentType: 'text/html' });
    } else {
      requests.push(route.request().url());
      await route.abort();
    }
  });
  await exported.goto('/pagination-export.html');
  await expect(exported.locator('html')).toHaveAttribute(
    'data-kumi-pagination',
    /ready|error/,
    { timeout: 100_000 },
  );
  const status = await exported.locator('#pagination-status').textContent();
  const diagnostics = status?.includes('ページ番号を計算できません')
    ? await exported.evaluate(() => {
        const output = document.getElementById('kumi-pagination-output');
        if (output) output.hidden = false;
        return [...document.querySelectorAll('.pagedjs_page')].map((page) => {
          const area = page
            .querySelector('.pagedjs_area')!
            .getBoundingClientRect();
          const overflowing = [
            ...page.querySelectorAll('.pagedjs_area *'),
          ].flatMap((element) => {
            if (
              !(element instanceof HTMLElement) ||
              element.closest('.katex-mathml')
            )
              return [];
            const box = element.getBoundingClientRect();
            if (
              !box.width ||
              !box.height ||
              getComputedStyle(element).display === 'none'
            )
              return [];
            return box.bottom > area.bottom + 2 ||
              box.left < area.left - 2 ||
              box.right > area.right + 2
              ? [
                  {
                    tag: element.tagName,
                    class: element.className,
                    bottom: box.bottom,
                    limit: area.bottom,
                    left: box.left,
                    right: box.right,
                    limitLeft: area.left,
                    limitRight: area.right,
                    markup: element.outerHTML.slice(0, 250),
                  },
                ]
              : [];
          });
          return {
            kind: (page as HTMLElement).dataset.reportPageKind,
            overflowing: overflowing.slice(0, 5),
          };
        });
      })
    : [];
  expect(status, JSON.stringify(diagnostics)).not.toContain(
    'ページ番号を計算できません',
  );
  await expect(exported.locator('html')).toHaveAttribute(
    'data-kumi-pagination',
    'ready',
  );
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
  return exported;
}

async function expectContentsMatchPages(page: Page) {
  const entries = await page
    .locator('[data-toc-target]')
    .evaluateAll((numbers) =>
      numbers.map((number) => {
        const target = document.getElementById(
          (number as HTMLElement).dataset.tocTarget!,
        );
        return {
          actual: number.textContent,
          expected: (target?.closest('.pagedjs_page') as HTMLElement | null)
            ?.dataset.bodyPage,
        };
      }),
    );
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.expected).toBeTruthy();
    expect(entry.actual).toBe(entry.expected);
  }
}

test('a contents list spanning physical pages resolves every forward target and obeys the selected depth', async ({
  page,
}) => {
  const chapters = Array.from(
    { length: 50 },
    (_, index) =>
      `## Section ${index + 1} 調査結果の見出し\n\n本文${index + 1}。`,
  ).join('\n\n');
  const exported = await exportedReport(
    page,
    `# 本文の開始\n\n${chapters}\n\n### Depth excluded\n\n本文。\n\n## Individually excluded\n{toc=false}\n\n本文。`,
  );
  try {
    expect(
      await exported
        .locator('.pagedjs_page[data-report-page-kind="contents"]')
        .count(),
    ).toBeGreaterThan(1);
    await expect(exported.locator('[data-toc-target]')).toHaveCount(51);
    const contentsText = (
      await exported.locator('.document-toc').allTextContents()
    ).join('');
    expect(contentsText).not.toContain('Depth excluded');
    expect(contentsText).not.toContain('Individually excluded');
    await expectContentsMatchPages(exported);
  } finally {
    await exported.close();
  }
});

test('one long paragraph and a long table keep all text and repeat the table header across pages', async ({
  page,
}) => {
  const paragraph = Array.from(
    { length: 100 },
    (_, index) =>
      `長い段落の確認${String(index).padStart(4, '0')}。改ページをまたいでも本文の文字を失わずに保持します。`,
  ).join('');
  const rows = Array.from(
    { length: 70 },
    (_, index) =>
      `| ROW-${String(index + 1).padStart(2, '0')} | 本文の表データ ${index + 1} |`,
  );
  const exported = await exportedReport(
    page,
    `# 長い本文\n\n${paragraph}\n\n# 長い表\n\n| 行番号 | 内容 |\n| --- | --- |\n${rows.join('\n')}\n\n{#table:long caption="長い表の確認"}`,
    '  list_tables: true',
  );
  try {
    const fragments = exported.locator('.pagedjs_page .document-renderer > p');
    expect(await fragments.count()).toBeGreaterThan(1);
    expect((await fragments.allTextContents()).join('')).toBe(paragraph);
    const tables = await exported
      .locator('.pagedjs_page')
      .evaluateAll((pages) =>
        pages.map((page) => ({
          bodyPage: (page as HTMLElement).dataset.bodyPage,
          headers: page.querySelectorAll('thead').length,
          rows: page.querySelectorAll('tbody tr').length,
        })),
      );
    expect(
      await exported.locator('.pagedjs_page thead').count(),
      JSON.stringify(tables),
    ).toBeGreaterThan(1);
    expect(
      await exported
        .locator('.pagedjs_page tbody tr')
        .evaluateAll((elements) =>
          elements.map((row) => row.querySelector('td')?.textContent),
        ),
    ).toEqual(
      Array.from(
        { length: 70 },
        (_, index) => `ROW-${String(index + 1).padStart(2, '0')}`,
      ),
    );
    await expectContentsMatchPages(exported);
  } finally {
    await exported.close();
  }
});

test('leading, consecutive and trailing explicit breaks retain empty body pages', async ({
  page,
}) => {
  const pagebreak = '::: pagebreak\n:::';
  const exported = await exportedReport(
    page,
    `${pagebreak}\n\n# First 本文\n\n本文。\n\n${pagebreak}\n\n${pagebreak}\n\n# Last 本文\n\n本文。\n\n${pagebreak}`,
    '  cover: true',
  );
  try {
    const body = exported.locator(
      '.pagedjs_page[data-report-page-kind="body"]',
    );
    await expect(body).toHaveCount(5);
    expect(
      await body.evaluateAll((pages) =>
        pages.map((element) => (element as HTMLElement).dataset.bodyPage),
      ),
    ).toEqual(['1', '2', '3', '4', '5']);
    for (const index of [0, 2, 4])
      expect(
        (await body.nth(index).locator('.document-renderer').allTextContents())
          .join('')
          .trim(),
      ).toBe('');
    await expect(exported.locator('[data-toc-target]')).toHaveCount(2);
    expect(
      await exported.locator('[data-toc-target]').allTextContents(),
    ).toEqual(['2', '4']);
    await expectContentsMatchPages(exported);
  } finally {
    await exported.close();
  }
});

for (const marginBottom of [0, 3]) {
  for (const lineHeight of [1.89, 1.9]) {
    test(`A5 body text stays above the footer with ${marginBottom} mm bottom margin and ${lineHeight} line height`, async ({
      page,
    }) => {
      const paragraph = '本文の配置を確認する長い文章です。'.repeat(700);
      const exported = await exportedReport(
        page,
        `# 本文の開始\n\n${paragraph}\n\n# 本文の終了`,
        '',
        `page_settings:
  paper: A5
  orientation: portrait
  margin_top: 20
  margin_bottom: ${marginBottom}
  margin_left: 20
  margin_right: 20
  font_size: 10.5
  first_line_indent: 0
  line_height: ${lineHeight}
  paragraph_spacing: 12`,
      );
      try {
        const bodyPages = exported.locator(
          '.pagedjs_page[data-report-page-kind="body"]',
        );
        expect(await bodyPages.count()).toBeGreaterThan(2);
        expect(
          (
            await bodyPages.locator('.document-renderer > p').allTextContents()
          ).join(''),
        ).toBe(paragraph);
        const placements = await bodyPages.evaluateAll((pages) =>
          pages.map((page) => {
            const area = page
              .querySelector('.pagedjs_area')!
              .getBoundingClientRect();
            const footer = page
              .querySelector('.kumi-physical-footer')!
              .getBoundingClientRect();
            const textBottom = Math.max(
              ...[...page.querySelectorAll('.document-renderer p')].flatMap(
                (paragraph) => {
                  if (!paragraph.textContent?.trim()) return [];
                  const range = document.createRange();
                  range.selectNodeContents(paragraph);
                  return [...range.getClientRects()].map((rect) => rect.bottom);
                },
              ),
            );
            return {
              page: (page as HTMLElement).dataset.bodyPage,
              areaBottom: area.bottom,
              textBottom,
              footerTop: footer.top,
            };
          }),
        );
        for (const placement of placements) {
          const detail = JSON.stringify(placement);
          expect(placement.footerTop, detail).toBeGreaterThanOrEqual(
            placement.areaBottom,
          );
          expect(placement.footerTop, detail).toBeGreaterThan(
            placement.textBottom,
          );
        }
        await expect(exported.locator('[data-toc-target]')).toHaveCount(2);
        await expectContentsMatchPages(exported);
      } finally {
        await exported.close();
      }
    });
  }
}
