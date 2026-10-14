import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const engine = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(require.resolve('tesseract.js-core/package.json'));
const packageVersion = (directory: string) =>
  (
    JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

/** Lazy, same-origin OCR runtime assets, pinned by package-lock.json. */
export function ocrAssetsPlugin(basePath: string): Plugin {
  const outputDirectory = `ocr/${packageVersion(engine)}-${packageVersion(core)}-data1/`;
  const urlPrefix = `${basePath}/${outputDirectory}`;
  const files = new Map<string, string>([
    ['worker.min.js', join(engine, 'dist/worker.min.js')],
    [
      'worker.min.js.LICENSE.txt',
      join(engine, 'dist/worker.min.js.LICENSE.txt'),
    ],
    ['TESSERACT_LICENSE.txt', join(engine, 'LICENSE.md')],
    ['CORE_LICENSE.txt', join(core, 'LICENSE')],
  ]);
  // The upstream loader selects the matching SIMD/LSTM variant at runtime.
  for (const variant of ['', '-simd', '-lstm', '-simd-lstm']) {
    const name = `tesseract-core${variant}.wasm.js`;
    files.set(`core/${name}`, join(core, name));
  }
  for (const language of ['jpn', 'eng']) {
    const distribution = dirname(
      require.resolve(`@tesseract.js-data/${language}/package.json`),
    );
    files.set(
      `languages/${language}.traineddata.gz`,
      join(distribution, `4.0.0_best_int/${language}.traineddata.gz`),
    );
  }
  files.set(
    'TESSDATA_LICENSE.txt',
    join(import.meta.dirname, 'ocr-licenses/TESSDATA_LICENSE.txt'),
  );
  return {
    name: 'kumi-ocr-assets',
    config: () => ({
      define: { __KUMI_OCR_ASSET_BASE__: JSON.stringify(urlPrefix) },
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
          key.endsWith('.js') ? 'text/javascript' : 'application/octet-stream',
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
