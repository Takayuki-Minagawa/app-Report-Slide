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
