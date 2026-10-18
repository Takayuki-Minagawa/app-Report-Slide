import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export const cliPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../render.mjs',
);
export const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><text x="10" y="30">Original</text></svg>';
export const document = (type = 'report') => ({
  schemaVersion: 2,
  type,
  metadata: { title: 'CLI example' },
  children: [
    {
      type: 'paragraph',
      attrs: { nodeId: 'p-1' },
      content: [{ type: 'text', text: 'First page' }],
    },
    { type: 'pageBreak', attrs: { nodeId: 'page-2' } },
    {
      type: 'figure',
      attrs: {
        nodeId: 'figure-1',
        src: 'images/figure.svg',
        alt: 'Example',
        title: null,
        width: 100,
        align: 'center',
      },
    },
  ],
});
export async function fixture(data = document()) {
  const root = await mkdtemp(join(tmpdir(), 'kumi-test-'));
  const input = join(root, 'source.kumi.json');
  await writeFile(input, JSON.stringify(data));
  return { root, input, output: join(root, 'out') };
}
export async function run(args) {
  try {
    const { stdout, stderr } = await execute(
      process.execPath,
      [cliPath, ...args],
      { maxBuffer: 5 * 1024 * 1024, timeout: 60_000 },
    );
    return { code: 0, stdout, stderr, result: JSON.parse(stdout) };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
      result: error.stdout?.trim() ? JSON.parse(error.stdout) : undefined,
    };
  }
}
