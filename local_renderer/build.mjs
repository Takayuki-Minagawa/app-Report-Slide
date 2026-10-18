import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, '../web');
const require = createRequire(resolve(here, 'package.json'));

/** The CLI builds a fresh, isolated bundle each run, including raw CSS and fonts. */
export async function buildApi(outfile = resolve(here, '.cache/kumi-api.mjs')) {
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [resolve(here, 'api.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    alias: { '@': web },
    nodePaths: [resolve(here, 'node_modules')],
    external: [
      '@zip.js/zip.js',
      'react',
      'react-dom',
      'katex',
      'dompurify',
      'markdown-it',
      'yaml',
      'zod',
    ],
    plugins: [
      {
        name: 'vite-raw-and-inline-assets',
        setup(build) {
          build.onResolve({ filter: /\?(raw|inline)$/ }, (args) => {
            const [bare, mode] = args.path.split('?');
            const path = bare.startsWith('@/')
              ? resolve(web, bare.slice(2))
              : bare.startsWith('.')
                ? resolve(args.resolveDir, bare)
                : require.resolve(bare);
            return { path, namespace: `kumi-${mode}` };
          });
          build.onLoad(
            { filter: /.*/, namespace: 'kumi-raw' },
            async (args) => ({
              contents: await readFile(args.path, 'utf8'),
              loader: 'text',
            }),
          );
          build.onLoad(
            { filter: /.*/, namespace: 'kumi-inline' },
            async (args) => ({
              contents: `data:font/woff2;base64,${(await readFile(args.path)).toString('base64')}`,
              loader: 'text',
            }),
          );
        },
      },
    ],
    logLevel: 'silent',
  });
  return outfile;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await buildApi();
  console.error('Built native KUMI API: local_renderer/.cache/kumi-api.mjs');
}
