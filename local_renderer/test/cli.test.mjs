import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  readdir,
  link,
} from 'node:fs/promises';
import { join } from 'node:path';
import { document, fixture, run, svg } from './helpers.mjs';
import { checkDestinations, writeOutputs } from '../io.mjs';

async function withFixture(t, data) {
  const item = await fixture(data);
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await mkdir(join(item.root, 'images'));
  await writeFile(join(item.root, 'images/figure.svg'), svg);
  return item;
}

test('batch uses native formats, copies sidecar assets and roundtrips its ZIP', async (t) => {
  const { root, input, output } = await withFixture(t);
  const result = await run(['--input', input, '--output-dir', output]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.pages, 2);
  assert.equal(result.result.editable_payload_validated, true);
  assert.equal(result.result.archive_roundtrip_validated, true);
  assert.deepEqual(
    await readFile(join(output, 'images/figure.svg')),
    await readFile(join(root, 'images/figure.svg')),
  );
  assert.equal(result.result.embedded_assets, 1);
  assert.match(
    await readFile(result.result.outputs.markdown, 'utf8'),
    /images\/figure.svg/,
  );
  const reexport = await run([
    '--input',
    result.result.outputs.json,
    '--output-dir',
    join(root, 'reexport'),
  ]);
  assert.equal(reexport.code, 0, reexport.stderr);
  assert.deepEqual(
    JSON.parse(await readFile(result.result.outputs.json)),
    JSON.parse(await readFile(reexport.result.outputs.json)),
  );
  const markdown = await run([
    '--input',
    result.result.outputs.markdown,
    '--output-dir',
    join(root, 'from-markdown'),
  ]);
  assert.equal(markdown.code, 0, markdown.stderr);
});

test('legacy paths preserve explicit JSON input normalization', async (t) => {
  const { root, input } = await withFixture(t);
  const html = join(root, 'legacy.html'),
    md = join(root, 'legacy.md');
  const result = await run([
    '--input',
    input,
    '--output',
    html,
    '--json-out',
    input,
    '--markdown-out',
    md,
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.archive_roundtrip_validated, false);
  assert.equal(JSON.parse(await readFile(input)).children.length, 3);
});

test('slide and edited SVG retain the native edited graphic in HTML and metadata', async (t) => {
  const data = document('slide');
  data.children[2].attrs.figureEdit = {
    version: 1,
    svgSource: svg.replace('Original', 'Edited graphic'),
  };
  const { input, output } = await withFixture(t, data);
  const result = await run([
    '--input',
    input,
    '--output-dir',
    output,
    '--locale',
    'en',
  ]);
  assert.equal(result.code, 0, result.stderr);
  const html = await readFile(result.result.outputs.html, 'utf8');
  assert.match(html, /lang="en"/);
  const image = html.match(
    /src="(data:image\/svg\+xml;charset=utf-8,[^"]+)"/,
  )[1];
  assert.match(decodeURIComponent(image.split(',')[1]), /Edited graphic/);
  assert.equal(
    JSON.parse(await readFile(result.result.outputs.json)).children[2].attrs
      .figureEdit.svgSource,
    data.children[2].attrs.figureEdit.svgSource,
  );
});

test('rejects malformed/ambiguous arguments without producing files', async (t) => {
  const { input, output } = await withFixture(t);
  for (const more of [
    ['--locale', 'xx'],
    ['--bogus'],
    ['--input', input],
    ['--output', 'other.html'],
    ['--name', '../escape'],
    ['--name', ''],
    ['--json-out', 'other.json'],
  ]) {
    const result = await run([
      '--input',
      input,
      '--output-dir',
      output,
      ...more,
    ]);
    assert.equal(result.code, 1, JSON.stringify(result));
    assert.equal(JSON.parse(result.stderr).ok, false);
  }
  await assert.rejects(readdir(output), { code: 'ENOENT' });
});

test('protects inputs, assets and output aliases before mutation', async (t) => {
  const { root, input } = await withFixture(t);
  const original = await readFile(input);
  const target = join(root, 'same.html');
  const asset = join(root, 'images/figure.svg');
  for (const args of [
    ['--output', input],
    ['--output-dir', root],
    ['--output', target, '--markdown-out', target],
    ['--output', asset],
  ]) {
    assert.equal((await run(['--input', input, ...args])).code, 1);
  }
  await symlink(input, target);
  assert.equal((await run(['--input', input, '--output', target])).code, 1);
  await rm(target);
  await link(input, target);
  assert.equal((await run(['--input', input, '--output', target])).code, 1);
  assert.deepEqual(await readFile(input), original);
  assert.equal(await readFile(asset, 'utf8'), svg);
});

test('rejects symlink escapes and missing assets, leaving existing files intact', async (t) => {
  const { root, input, output } = await withFixture(t);
  await mkdir(output);
  const html = join(output, 'source.html');
  await writeFile(html, 'old output');
  await rm(join(root, 'images/figure.svg'));
  const missing = await run(['--input', input, '--output-dir', output]);
  assert.equal(missing.code, 1);
  const outside = await fixture();
  t.after(() => rm(outside.root, { recursive: true, force: true }));
  await writeFile(join(outside.root, 'outside.svg'), svg);
  await symlink(
    join(outside.root, 'outside.svg'),
    join(root, 'images/figure.svg'),
  );
  const result = await run(['--input', input, '--output-dir', output]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /symlink escapes/);
  assert.equal(await readFile(html, 'utf8'), 'old output');
  assert.deepEqual(await readdir(output), ['source.html']);
});

test('external image URLs are rejected without network access', async (t) => {
  const data = document();
  data.children[2].attrs.src = 'https://example.invalid/a.svg';
  const { input, output } = await withFixture(t, data);
  const result = await run(['--input', input, '--output-dir', output]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /local asset/);
});

test('output transaction leaves earlier destinations intact when staging fails', async (t) => {
  const { root } = await withFixture(t);
  const target = join(root, 'target');
  await writeFile(target, 'previous');
  await assert.rejects(
    writeOutputs([
      { path: target, content: 'replacement' },
      { path: join(target, 'child'), content: 'impossible' },
    ]),
  );
  assert.equal(await readFile(target, 'utf8'), 'previous');
  assert.equal(
    (await readdir(root)).some((name) => name.startsWith('.kumi-stage-')),
    false,
  );
});

test('ancestor paths and case aliases are rejected', async (t) => {
  const { root, input } = await withFixture(t);
  for (const pair of [
    ['new', 'new/child'],
    ['SAME', 'same'],
  ]) {
    await assert.rejects(
      checkDestinations(
        pair.map((path) => ({ path: join(root, path), kind: 'html' })),
        [input],
      ),
      /overlap/,
    );
  }
});

test('copies one physical asset for fragment, query and normalized path aliases', async (t) => {
  const data = document();
  for (const [index, source] of [
    'images/figure.svg#detail',
    'images/./figure.svg?version=1',
  ].entries()) {
    data.children.push({
      type: 'figure',
      attrs: {
        ...data.children[2].attrs,
        nodeId: `alias-${index}`,
        src: source,
      },
    });
  }
  const { root, input, output } = await withFixture(t, data);
  const result = await run(['--input', input, '--output-dir', output]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.result.embedded_assets, 3);
  assert.equal(result.result.copied_assets.length, 1);
  assert.equal(result.result.archive_roundtrip_validated, true);
  const repeated = await run([
    '--input',
    result.result.outputs.json,
    '--output-dir',
    join(root, 'repeated'),
  ]);
  assert.equal(repeated.code, 0, repeated.stderr);
  assert.equal(repeated.result.copied_assets.length, 1);
});
