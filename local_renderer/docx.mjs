import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildBrowserBundle } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Word export uses the editor's own exporter. It needs a real browser for
 * image decoding, so it runs in a blank Chromium page with the network blocked.
 * `assets` maps each source to { type, bytes }.
 */
export async function exportDocx(document, assets, locale) {
  const temporary = await mkdtemp(join(here, '.cache/docx-'));
  const browser = await chromium.launch({ headless: true });
  try {
    const bundle = await readFile(
      await buildBrowserBundle(join(temporary, 'docx.js')),
      'utf8',
    );
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ content: bundle });
    if (errors.length)
      throw new Error(`Word exporter failed to load: ${errors.join('; ')}`);
    const result = await page.evaluate(
      ([data, files, language]) =>
        globalThis.kumiExportDocx(data, files, language),
      [
        document,
        [...assets].map(([source, { type, bytes }]) => [
          source,
          type,
          Buffer.from(bytes).toString('base64'),
        ]),
        locale,
      ],
    );
    return {
      bytes: Buffer.from(result.base64, 'base64'),
      warnings: result.warnings,
    };
  } finally {
    await browser.close();
    await rm(temporary, { recursive: true, force: true });
  }
}
