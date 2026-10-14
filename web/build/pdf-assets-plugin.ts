import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const distribution = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(
  readFileSync(join(distribution, 'package.json'), 'utf8'),
) as { version: string };

/** Serve exactly the installed PDF.js distribution, including its worker and font licenses. */
export function pdfAssetsPlugin(basePath: string): Plugin {
  const outputDirectory = `pdfjs/${version}/`;
  const urlPrefix = `${basePath}/${outputDirectory}`;
  const files = new Map<string, string>([
    ['pdf.worker.min.mjs', join(distribution, 'build/pdf.worker.min.mjs')],
    ['LICENSE', join(distribution, 'LICENSE')],
  ]);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const entry of readdirSync(join(distribution, directory), {
      withFileTypes: true,
    })) {
      if (entry.isFile())
        files.set(
          `${directory}/${entry.name}`,
          join(distribution, directory, entry.name),
        );
    }
  }
  return {
    name: 'kumi-pdf-assets',
    config: () => ({
      define: {
        __KUMI_PDF_ASSET_BASE__: JSON.stringify(urlPrefix),
      },
    }),
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?', 1)[0];
        if (!path?.startsWith(urlPrefix)) return next();
        const key = path.slice(urlPrefix.length);
        const file = files.get(key);
        if (!file) return next();
        response.setHeader(
          'Content-Type',
          /\.(?:mjs|js)$/.test(key)
            ? 'text/javascript'
            : key.endsWith('.wasm')
              ? 'application/wasm'
              : 'application/octet-stream',
        );
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      if (this.environment.name !== 'client') return;
      for (const [filename, source] of files)
        this.emitFile({
          type: 'asset',
          fileName: `${outputDirectory}${filename}`,
          source: readFileSync(source),
        });
    },
  };
}
