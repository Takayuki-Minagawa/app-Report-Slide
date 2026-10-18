import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { document, fixture, run, svg } from './helpers.mjs';

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
