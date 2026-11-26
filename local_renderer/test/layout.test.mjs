import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { document, fixture, run, svg } from './helpers.mjs';
import { inspectLayout } from '../layout.mjs';

async function withFixture(t, data) {
  const item = await fixture(data);
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await mkdir(join(item.root, 'images'));
  await writeFile(join(item.root, 'images/figure.svg'), svg);
  return item;
}

for (const type of ['report', 'slide']) {
  test(`checks every ${type} page at native size after images load`, async (t) => {
    const { input, output } = await withFixture(t, document(type));
    const result = await run([
      '--input',
      input,
      '--output-dir',
      output,
      '--check-layout',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.result.layout.status, 'pass');
    assert.deepEqual(
      result.result.layout.pages.map((item) => item.page),
      [1, 2],
    );
    assert.ok(
      result.result.layout.pages.every(
        (item) =>
          item.status === 'pass' && item.widthPx > 0 && item.heightPx > 0,
      ),
    );
    assert.deepEqual(
      JSON.parse(await readFile(result.result.outputs.layout)),
      result.result.layout,
    );
    if (type === 'slide')
      assert.equal(result.result.layout.pages[1].widthPx, 920);
  });
}

test('reports page 2 overflow and saves all outputs with exit 2 on request', async (t) => {
  const data = document();
  data.children.push(
    ...Array.from({ length: 75 }, (_, i) => ({
      type: 'paragraph',
      attrs: { nodeId: `long-${i}` },
      content: [{ type: 'text', text: `Overflow line ${i}` }],
    })),
  );
  const { input, output } = await withFixture(t, data);
  const result = await run([
    '--input',
    input,
    '--output-dir',
    output,
    '--fail-on-overflow',
  ]);
  assert.equal(result.code, 2, result.stderr);
  assert.equal(result.result.ok, false);
  assert.equal(result.result.layout.status, 'overflow');
  assert.equal(result.result.layout.pages[0].status, 'pass');
  assert.equal(result.result.layout.pages[1].status, 'overflow');
  assert.ok(
    result.result.layout.pages[1].issues.some(
      (item) => item.code === 'page-height',
    ),
  );
  for (const path of Object.values(result.result.outputs))
    assert.ok((await readFile(path)).length);
});

test('corrupt images cause inspection failure and preserve existing output', async (t) => {
  const { root, input, output } = await withFixture(t);
  await writeFile(join(root, 'images/figure.svg'), '<svg>broken');
  await mkdir(output);
  await writeFile(join(output, 'source.html'), 'previous');
  const result = await run([
    '--input',
    input,
    '--output-dir',
    output,
    '--check-layout',
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /decoded|load/);
  assert.deepEqual(await readdir(output), ['source.html']);
  assert.equal(await readFile(join(output, 'source.html'), 'utf8'), 'previous');
});

test('SVG cropped images are also awaited and decoded', async (t) => {
  const data = document();
  data.children[2].attrs.figureEdit = {
    version: 1,
    crop: { x: 0, y: 0, width: 90, height: 90 },
    imageSize: { width: 120, height: 40 },
  };
  const { input, output } = await withFixture(t, data);
  const result = await run([
    '--input',
    input,
    '--output-dir',
    output,
    '--check-layout',
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.layout.status, 'pass');
});

function paginationHtml({
  pageCount = 3,
  renderedPages = 3,
  inspectedPages = 3,
} = {}) {
  return `<!doctype html><html data-kumi-pagination="pending"><body><script>
    window.kumiInspectDocumentLayout = () => ({status: 'unmeasured', pages: []});
    window.kumiPaginationReady = new Promise((resolve) => setTimeout(() => {
      for (let i = 0; i < ${renderedPages}; i++) {
        const page = document.createElement('div');
        page.className = 'pagedjs_page';
        document.body.appendChild(page);
      }
      document.documentElement.dataset.kumiPagination = 'ready';
      window.kumiInspectDocumentLayout = () => ({
        status: 'pass',
        pages: Array.from({length: ${inspectedPages}}, (_, index) => ({page: index + 1, status: 'pass'})),
      });
      resolve({pageCount: ${pageCount}, bodyPageCount: 2});
    }, 150));
  </script></body></html>`;
}

test('waits for physical pagination and accepts more pages than the logical source', async () => {
  const result = await inspectLayout(paginationHtml(), 1, {
    physicalPagination: true,
  });
  assert.equal(result.pages.length, 3);
  assert.deepEqual(result.pagination, { pageCount: 3, bodyPageCount: 2 });
});

test('rejects incomplete physical pagination and unmeasured physical pages', async () => {
  for (const options of [{ pageCount: 2 }, { inspectedPages: 2 }]) {
    await assert.rejects(
      inspectLayout(paginationHtml(options), 1, { physicalPagination: true }),
      /reported pages|measure every page/,
    );
  }
  await assert.rejects(
    inspectLayout('<html><body></body></html>', 1, {
      physicalPagination: true,
    }),
    /pagination completion signal/,
  );
});

test('still requires the exact logical page count when physical pagination is disabled', async () => {
  const html = `<html><body><script>
    window.kumiInspectDocumentLayout = () => ({status: 'pass', pages: [{page: 1}, {page: 2}]});
  </script></body></html>`;
  await assert.rejects(inspectLayout(html, 1), /measure every page \(2\/1/);
});

test('automatically paginates a long Report and reports its actual page count without a check flag', async (t) => {
  const data = document();
  data.metadata.toc = true;
  data.metadata.report_settings = {
    cover: true,
    toc_page: true,
    toc_page_numbers: true,
  };
  data.children = [
    {
      type: 'heading',
      attrs: { nodeId: 'intro', level: 1 },
      content: [{ type: 'text', text: 'Introduction' }],
    },
    ...Array.from({ length: 50 }, (_, index) => ({
      type: 'paragraph',
      attrs: { nodeId: `body-${index}` },
      content: [
        {
          type: 'text',
          text: `Paragraph ${index}. This text continues across physical pages after automatic pagination. `.repeat(
            3,
          ),
        },
      ],
    })),
  ];
  const { input, output } = await withFixture(t, data);
  const result = await run(['--input', input, '--output-dir', output]);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(
    result.result.pages > 3,
    `Expected automatic body breaks, received ${result.result.pages} pages`,
  );
  assert.equal(result.result.pages, result.result.layout.pagination.pageCount);
  assert.equal(result.result.pages, result.result.layout.pages.length);
  assert.equal(
    result.result.layout.pagination.bodyPageCount,
    result.result.pages - 2,
  );
  assert.deepEqual(
    JSON.parse(await readFile(result.result.outputs.layout)),
    result.result.layout,
  );
  assert.deepEqual(
    JSON.parse(await readFile(result.result.outputs.json)).children,
    data.children,
  );
});

const styledReport = `---
type: report
title: Styled report
theme: report-jp
number_sections: true
toc: true
report_settings:
  cover: true
  toc_page: true
  toc_page_numbers: true
  toc_depth: 2
  appendix_numbering: letter
  front_matter_page_numbers: roman
  keep_tables: auto
  caption_separator: ": "
---

# Introduction

## Purpose

See [@tab:short] and equation [@eq:ratio].

$$
R = \\frac{a}{b}
$$
{#eq:ratio}

> [!NOTE]
> A boxed note.

| Item | Value |
| --- | --- |
| A | 1 |
| B | 2 |
{#tab:short caption="Short table"}

# Data
{appendix=true}

## Values

| Row | Value |
| --- | --- |
${Array.from({ length: 90 }, (_, index) => `| ${index + 1} | ${index * 2} |`).join('\n')}
{#tab:long caption="Long table"}
`;

async function styledFixture(t) {
  const item = await withFixture(t);
  const input = join(item.root, 'styled.md');
  await writeFile(input, styledReport);
  return { ...item, input };
}

test('prints the inspected layout as PDF with formatted page numbers and split long tables', async (t) => {
  const { input, output } = await styledFixture(t);
  const result = await run([
    '--input',
    input,
    '--output-dir',
    output,
    '--pdf',
    '--fail-on-overflow',
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.result.layout.status, 'pass');
  const pdf = await readFile(result.result.outputs.pdf);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // One PDF page per laid-out page: the PDF is the layout that was checked.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  t.after(() => task.destroy());
  assert.equal((await task.promise).numPages, result.result.pages);

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(await readFile(result.result.outputs.html, 'utf8'));
  const layout = await page.evaluate(async () => {
    await window.kumiPaginationReady;
    const pages = [...document.querySelectorAll('.pagedjs_page')];
    return {
      kinds: pages.map((item) => item.dataset.reportPageKind),
      footers: pages.map(
        (item) => item.querySelector('.kumi-physical-footer')?.textContent,
      ),
      centred: getComputedStyle(document.querySelector('.kumi-physical-footer'))
        .textAlign,
      contents: [...document.querySelectorAll('.kumi-toc-page')].map(
        (item) => item.textContent,
      ),
      levels: [...document.querySelectorAll('.document-toc li')].map(
        (item) => item.dataset.tocLevel,
      ),
      headings: [...document.querySelectorAll('h1[id]')].map(
        (item) => item.textContent,
      ),
      shortTablePages: new Set(
        [...document.querySelectorAll('.preview-table-wrap')]
          .filter((item) => item.textContent.includes('Short table'))
          .map((item) => item.closest('.pagedjs_page').dataset.physicalPage),
      ).size,
      longTablePages: new Set(
        [...document.querySelectorAll('.preview-table-wrap')]
          .filter((item) => !item.textContent.includes('Short table'))
          .map((item) => item.closest('.pagedjs_page').dataset.physicalPage),
      ).size,
      repeatedHeaders: document.querySelectorAll('[data-kumi-repeated-header]')
        .length,
      caption: document.querySelector('table caption').textContent,
      note: document.querySelector('.callout-title').textContent,
    };
  });
  assert.deepEqual(layout.kinds.slice(0, 3), ['cover', 'contents', 'body']);
  // No number on the cover, Roman on the contents, "- n -" on the body.
  assert.deepEqual(layout.footers.slice(0, 4), [
    undefined,
    '- i -',
    '- 1 -',
    '- 2 -',
  ]);
  assert.equal(layout.centred, 'center');
  assert.ok(layout.contents.every((value) => /^- \d+ -$/.test(value)));
  assert.deepEqual(layout.levels, ['1', '2', '1', '2']);
  assert.deepEqual(layout.headings, ['1 Introduction', '付録 A Data']);
  assert.equal(layout.shortTablePages, 1);
  assert.ok(layout.longTablePages > 1);
  assert.equal(layout.repeatedHeaders, layout.longTablePages - 1);
  assert.equal(layout.caption, '表 1: Short table');
  assert.equal(layout.note, '（注）');
});

test('exports and checks a Word document from the command line', async (t) => {
  const { input, output } = await styledFixture(t);
  const result = await run(
    ['--input', input, '--output-dir', output, '--check-docx'],
    { timeout: 240_000 },
  );
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const docx = await readFile(result.result.outputs.docx);
  assert.equal(docx.subarray(0, 2).toString(), 'PK');
  const check = result.result.docx.check;
  assert.deepEqual(
    JSON.parse(await readFile(result.result.outputs.docxCheck)),
    check,
  );
  assert.deepEqual(check.issues, []);
  assert.deepEqual(check.captions.tables, {
    expected: 2,
    last: '2',
    missing: [],
  });
  assert.equal(check.captions.equations.expected, 1);
  assert.deepEqual(check.references, { expected: 2, found: 2, wrong: [] });
  assert.deepEqual(check.wide, []);
  const { findOffice } = await import('../docx-check.mjs');
  if (await findOffice()) {
    // LibreOffice is installed: contents numbers were compared with headings.
    assert.equal(check.contents.status, 'pass', JSON.stringify(check.contents));
    assert.equal(check.contents.entries.length, 4);
    assert.ok(
      check.contents.entries.every((entry) => entry.contents === entry.heading),
    );
  } else {
    assert.equal(check.contents.status, 'skipped');
    t.diagnostic('LibreOffice not found: contents pages were not compared');
  }
});

test('the Word check reports a wrong reference, a wrong caption number and an oversized table', async () => {
  const { checkDocx } = await import('../docx-check.mjs');
  const { zipSync, strToU8 } = await import('fflate');
  const paragraph = (text, extra = '') =>
    `<w:p>${extra}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const body = (content, gridWidth = 9000) =>
    zipSync({
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:tbl><w:tblGrid><w:gridCol w:w="${gridWidth}"/></w:tblGrid></w:tbl><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:left="1417" w:right="1417"/></w:sectPr></w:body></w:document>`,
      ),
    });
  const target = (type, nodeId, number) => ({
    type,
    nodeId,
    number,
    title: '',
  });
  const tables = Array.from({ length: 10 }, (_, index) =>
    target('table', `t${index + 1}`, String(index + 1)),
  );
  const api = {
    resolveReportSettings: () => ({ toc_page_numbers: false }),
    analyzeDocument: () => ({
      targets: new Map(tables.map((entry) => [entry.nodeId, entry])),
      labels: new Map([['tab:1', tables[0]]]),
    }),
    formatSemanticReference: (entry) => `表 ${entry.number}`,
    reportOutline: () => [],
  };
  const document = {
    metadata: {},
    children: [
      {
        type: 'paragraph',
        content: [{ type: 'reference', attrs: { target: 'tab:1' } }],
      },
    ],
  };
  const link = (anchor, text) =>
    `<w:p><w:hyperlink w:anchor="${anchor}"><w:r><w:t>${text}</w:t></w:r></w:hyperlink></w:p>`;
  const captions = (skip) =>
    tables
      .filter((entry) => entry.number !== skip)
      .map((entry) =>
        paragraph(
          `表 ${entry.number} — Caption`,
          '<w:pPr><w:pStyle w:val="Caption"/></w:pPr>',
        ),
      )
      .join('');

  const good = await checkDocx(
    body(link('kumi_1', '表 1') + captions()),
    document,
    api,
  );
  assert.equal(good.status, 'pass', JSON.stringify(good.issues));
  assert.equal(good.contents.status, 'skipped');

  // "表 10" must not stand in for a missing "表 1".
  const missingCaption = await checkDocx(
    body(link('kumi_1', '表 1') + captions('1')),
    document,
    api,
  );
  assert.deepEqual(missingCaption.captions.tables.missing, ['表 1']);
  assert.equal(missingCaption.status, 'fail');

  // The caption text alone does not satisfy a reference.
  for (const reference of [
    '',
    link('kumi_2', '表 1'),
    link('kumi_1', '表 2'),
    link('kumi_1', '表 1') + link('kumi_1', '表 1'),
  ]) {
    const wrong = await checkDocx(body(reference + captions()), document, api);
    assert.equal(wrong.status, 'fail', reference);
    assert.equal(wrong.issues[0].code, 'reference');
  }

  const wide = await checkDocx(
    body(link('kumi_1', '表 1') + captions(), 9100),
    document,
    api,
  );
  assert.deepEqual(wide.wide, [{ kind: 'table', index: 1, twips: 9100 }]);
  assert.equal(wide.status, 'fail');
});

test('never leaves a table caption alone at the foot of a page', async (t) => {
  // Each case starts on a new page with a different amount of text above the
  // table, so the table start sweeps across the bottom edge of the page.
  const cases = Array.from({ length: 14 }, (_, index) => index + 14);
  const source = `---
type: report
toc: true
report_settings:
  toc_page_numbers: true
---

${cases
  .map(
    (lines) => `# Case ${lines}

${Array.from({ length: lines }, (_, index) => `Filler line ${index + 1}.`).join('\n\n')}

| Row | Value |
| --- | --- |
${Array.from({ length: 6 }, (_, index) => `| ${index + 1} | ${index} |`).join('\n')}
{#tab:case${lines} caption="Table of case ${lines}"}`,
  )
  .join('\n\n::: pagebreak\n:::\n\n')}
`;
  const item = await withFixture(t);
  const input = join(item.root, 'captions.md');
  await writeFile(input, source);
  const result = await run([
    '--input',
    input,
    '--output-dir',
    item.output,
    '--fail-on-overflow',
  ]);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(await readFile(result.result.outputs.html, 'utf8'));
  const tables = await page.evaluate(async () => {
    await window.kumiPaginationReady;
    const pageOf = (element) =>
      Number(element.closest('.pagedjs_page').dataset.physicalPage);
    return [...document.querySelectorAll('table caption')].map((caption) => {
      const table = caption.closest('table');
      const row = table.querySelector('tbody tr, thead tr');
      return {
        caption: pageOf(caption),
        firstRow: pageOf(row),
        // Where on its page the table starts, to prove the sweep reached the edge.
        heading: pageOf(
          document.getElementById(
            [...document.querySelectorAll('h1[id]')].find((heading) =>
              caption.textContent.endsWith(
                heading.textContent.replace('Case', 'case'),
              ),
            ).id,
          ),
        ),
      };
    });
  });
  assert.equal(tables.length, cases.length);
  for (const [index, table] of tables.entries())
    assert.equal(
      table.caption,
      table.firstRow,
      `case ${cases[index]}: caption and first row on different pages`,
    );
  // Some tables stayed with their heading and some moved to the next page.
  assert.ok(tables.some((table) => table.caption === table.heading));
  assert.ok(tables.some((table) => table.caption > table.heading));
});

test('prints a report without physical pagination as one PDF page per page', async (t) => {
  const { input, output } = await withFixture(t);
  const result = await run(['--input', input, '--output-dir', output, '--pdf']);
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(result.result.pages, 2);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: new Uint8Array(await readFile(result.result.outputs.pdf)),
    verbosity: 0,
  });
  t.after(() => task.destroy());
  const pdf = await task.promise;
  assert.equal(pdf.numPages, 2);
  const size = (await pdf.getPage(1)).getViewport({ scale: 1 });
  // A4 in PDF points.
  assert.ok(
    Math.abs(size.width - 595.3) < 1 && Math.abs(size.height - 841.9) < 1,
  );
});
