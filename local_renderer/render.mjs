#!/usr/bin/env node
import { readFile, realpath, stat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve, extname, basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { buildApi } from './build.mjs';
import { readAsset, checkDestinations, writeOutputs } from './io.mjs';

const help = `KUMI native document export (Node.js >= 22.13)

Batch:  node render.mjs --input FILE --output-dir DIR [--name BASENAME]
Legacy: node render.mjs --input FILE --output FILE [--json-out FILE] [--markdown-out FILE] [--zip-out FILE]

Input: native document JSON or KUMI Markdown (one Report or Slide).
Batch writes HTML, .kumi.json, .md, .kumi.zip and referenced local assets.
Options: --assets-dir DIR, --locale ja|en, --check-layout,
         --check-out FILE, --fail-on-overflow, --help
         --style FILE.css  Report only. Appended to report_style.css of the document, so
                           every output (HTML, PDF, JSON, Markdown, ZIP) carries the same style.
         --pdf [FILE]      Report only. Prints the inspected layout with Chromium.
                           With --output-dir the file is BASENAME.pdf (no FILE).
         --docx [FILE]     Report only. Word document, built in Chromium like the editor does.
                           With --output-dir the file is BASENAME.docx (no FILE).
         --check-docx      Converts the Word document with LibreOffice (soffice) and checks
                           contents page numbers, caption numbers and widths. Implies --docx.
--pdf, --docx and --check-docx require: npm run install:browser
--check-layout requires: npm run install:browser
Report report_settings.toc_page_numbers=true automatically checks physical pagination
and also requires Chromium. Without this setting or --check-layout, no browser is needed.
--fail-on-overflow implies --check-layout; outputs and findings are saved, exit 2.
--check-out implies --check-layout. With --output-dir, checks default to BASENAME.layout.json.
Existing output files are replaced after all exports and checks succeed.
`;

function parseArgs(args) {
  const values = new Set([
    'input',
    'output',
    'output-dir',
    'name',
    'json-out',
    'markdown-out',
    'zip-out',
    'assets-dir',
    'locale',
    'check-out',
    'style',
  ]);
  const flags = new Set([
    'check-layout',
    'fail-on-overflow',
    'help',
    'check-docx',
  ]);
  // A path in single-file mode; a bare flag with --output-dir.
  const optionalValues = new Set(['pdf', 'docx']);
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : '';
    if (
      (!values.has(key) && !flags.has(key) && !optionalValues.has(key)) ||
      key in options
    )
      throw new Error(`Unknown or duplicate argument: ${args[i]}`);
    if (flags.has(key)) options[key] = true;
    else if (optionalValues.has(key))
      options[key] =
        args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value for --${key}`);
      options[key] = value;
    }
  }
  if (options.help) return options;
  if (!options.input || !options.output === !options['output-dir'])
    throw new Error(
      'Specify --input and exactly one of --output or --output-dir',
    );
  if (options.locale && !['ja', 'en'].includes(options.locale))
    throw new Error('--locale must be ja or en');
  if (
    options['output-dir'] &&
    ['json-out', 'markdown-out', 'zip-out'].some((key) => options[key])
  )
    throw new Error(
      '--output-dir cannot be combined with individual output paths',
    );
  if (options.name && !options['output-dir'])
    throw new Error('--name requires --output-dir');
  if (options['check-docx'] && !options.docx) options.docx = true;
  for (const key of ['pdf', 'docx']) {
    if (!(key in options)) continue;
    if (options['output-dir'] && options[key] !== true)
      throw new Error(`--${key} takes no file name with --output-dir`);
    if (!options['output-dir'] && options[key] === true)
      throw new Error(`--${key} requires a file name with --output`);
  }
  if (options['check-out'] || options['fail-on-overflow'])
    options['check-layout'] = true;
  return options;
}

const here = dirname(fileURLToPath(import.meta.url));

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return 0;
  }
  const inputPath = await realpath(resolve(options.input));
  const extension = extname(inputPath).toLowerCase();
  if (!['.json', '.md', '.markdown'].includes(extension))
    throw new Error(
      'Input must be native document .json or KUMI .md/.markdown',
    );
  const inputInfo = await stat(inputPath);
  if (!inputInfo.isFile() || inputInfo.size > 5 * 1024 * 1024)
    throw new Error('Input must be a file no larger than 5 MiB');
  const assetRoot = await realpath(
    resolve(options['assets-dir'] || dirname(inputPath)),
  );
  const source = await readFile(inputPath, 'utf8');
  const stem =
    options.name ??
    basename(inputPath).replace(/(?:\.kumi)?\.(?:json|markdown|md)$/i, '');
  if (
    options['output-dir'] &&
    (!stem ||
      // oxlint-disable-next-line no-control-regex -- Generated file basenames must reject control characters.
      /[\\/:*?"<>|\x00-\x1f]/.test(stem) ||
      /^\.+$/.test(stem) ||
      /[. ]$/.test(stem))
  )
    throw new Error('--name must be a plain, nonempty file basename');
  const outputDir = options['output-dir'] && resolve(options['output-dir']);
  const destinations = outputDir
    ? {
        html: join(outputDir, stem + '.html'),
        json: join(outputDir, stem + '.kumi.json'),
        markdown: join(outputDir, stem + '.md'),
        zip: join(outputDir, stem + '.kumi.zip'),
      }
    : {
        html: resolve(options.output),
        ...(options['json-out'] && { json: resolve(options['json-out']) }),
        ...(options['markdown-out'] && {
          markdown: resolve(options['markdown-out']),
        }),
        ...(options['zip-out'] && { zip: resolve(options['zip-out']) }),
      };
  for (const key of ['pdf', 'docx']) {
    if (options[key])
      destinations[key] = outputDir
        ? join(outputDir, `${stem}.${key}`)
        : resolve(options[key]);
  }
  if (options['check-docx'])
    destinations.docxCheck = outputDir
      ? join(outputDir, stem + '.docx-check.json')
      : destinations.docx.replace(/(\.docx)?$/i, '.docx-check.json');
  let styleSource;
  if (options.style) {
    const stylePath = await realpath(resolve(options.style));
    const styleInfo = await stat(stylePath);
    if (!styleInfo.isFile() || styleInfo.size > 64 * 1024)
      throw new Error('--style must be a CSS file no larger than 64 KiB');
    styleSource = await readFile(stylePath, 'utf8');
  }
  if (options['check-out']) destinations.layout = resolve(options['check-out']);
  else if (outputDir && options['check-layout'])
    destinations.layout = join(outputDir, stem + '.layout.json');
  const legacyJsonInput =
    !outputDir &&
    extension === '.json' &&
    destinations.json &&
    (await realpath(destinations.json).catch(() => undefined)) === inputPath
      ? inputPath
      : undefined;
  await checkDestinations(
    Object.entries(destinations).map(([kind, path]) => ({ kind, path })),
    [inputPath],
    legacyJsonInput,
  );

  // SVG editing and sanitizing use the same DOM APIs as the browser exporter.
  // No scripts or external resources are enabled in this authoring DOM.
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
  });
  const assets = new Map();
  let temporary;
  try {
    await mkdir(join(here, '.cache'), { recursive: true });
    temporary = await mkdtemp(join(here, '.cache/run-'));
    const apiPath = await buildApi(join(temporary, 'api.mjs'));
    const api = await import(pathToFileURL(apiPath).href);
    const parsed =
      extension === '.json'
        ? {
            document: api.migrateDocumentData(JSON.parse(source)),
            diagnostics: [],
          }
        : api.parseMarkdown(source);
    let document = api.validateDocumentData(parsed.document);
    if (
      document.type !== 'report' &&
      (styleSource !== undefined || options.pdf || options.docx)
    )
      throw new Error('--style, --pdf and --docx require a Report document');
    if (styleSource !== undefined) {
      // Stored in the document, after its own CSS, so that opening the saved
      // Markdown, JSON or ZIP in the editor reproduces exactly this output.
      const existing = document.metadata.report_style?.css;
      document = api.validateDocumentData({
        ...document,
        metadata: {
          ...document.metadata,
          report_style: {
            ...document.metadata.report_style,
            css: [existing, styleSource].filter(Boolean).join('\n'),
          },
        },
      });
    }
    const physicalPagination =
      document.type === 'report' &&
      document.metadata.report_settings?.toc_page_numbers === true;
    if (physicalPagination && outputDir && !destinations.layout)
      destinations.layout = join(outputDir, stem + '.layout.json');
    const errors = parsed.diagnostics.filter(
      (item) => item.severity === 'error',
    );
    if (errors.length)
      throw new Error(`Markdown errors: ${JSON.stringify(errors)}`);
    const protectedPaths = [inputPath];
    const copies = [];
    let total = 0;
    for (const { source, kind } of api.referencedAssets(
      document.children,
      document.metadata,
    )) {
      if (/^https?:/i.test(source))
        throw new Error(`Standalone export requires a local asset: ${source}`);
      if (/^data:/i.test(source)) continue;
      const contentType = api.documentAssetMime(source);
      if (
        !contentType ||
        (kind === 'pdf') !== (contentType === 'application/pdf')
      )
        throw new Error(`Unsupported asset: ${source}`);
      const asset = await readAsset(
        assetRoot,
        source,
        api.projectLimits.fileBytes,
      );
      total += asset.bytes.length;
      if (total > api.projectLimits.expandedBytes)
        throw new Error('Assets exceed 50 MiB');
      protectedPaths.push(asset.path);
      assets.set(
        source,
        URL.createObjectURL(new Blob([asset.bytes], { type: contentType })),
      );
      if (outputDir) {
        const target = join(outputDir, asset.relative);
        let same = false;
        try {
          same = (await realpath(target)) === asset.path;
        } catch {
          /* new destination */
        }
        if (!same) {
          const previous = copies.find((copy) => copy.path === target);
          if (previous && !previous.content.equals(asset.bytes))
            throw new Error(`Asset copies disagree: ${target}`);
          if (!previous)
            copies.push({ kind: 'asset', path: target, content: asset.bytes });
        }
      }
    }
    await checkDestinations(
      [
        ...Object.entries(destinations).map(([kind, path]) => ({ kind, path })),
        ...copies,
      ],
      protectedPaths,
      legacyJsonInput,
    );
    const exporter =
      document.type === 'slide' ? api.exportSlideHtml : api.exportReportHtml;
    const rendered = await exporter(document, assets, options.locale || 'ja');
    if (rendered.externalImages.length)
      throw new Error(
        `External image dependencies: ${rendered.externalImages.join(', ')}`,
      );
    const payload = rendered.html.match(
      /<template id="kumi-editable-document" data-encoding="base64">([^<]+)<\/template>/,
    )?.[1];
    if (!payload) throw new Error('Missing native editable HTML payload');
    const envelope = JSON.parse(
      Buffer.from(payload, 'base64').toString('utf8'),
    );
    if (
      JSON.stringify(api.validateDocumentData(envelope.document)) !==
      JSON.stringify(document)
    )
      throw new Error('Editable HTML document roundtrip changed');
    const content = {
      html: rendered.html,
      json: JSON.stringify(document, null, 2) + '\n',
    };
    if (destinations.markdown)
      content.markdown = api.serializeDocument(document);
    if (destinations.zip) {
      content.zip = await api.writeDocumentArchive(document, assets);
      const restored = await api.readDocumentArchive(
        new File([content.zip], 'document.kumi.zip'),
      );
      try {
        if (JSON.stringify(restored.document) !== JSON.stringify(document))
          throw new Error('ZIP document roundtrip changed');
        if (restored.assets.size !== assets.size)
          throw new Error('ZIP asset count changed');
        for (const [source, original] of assets) {
          const [a, b] = await Promise.all([
            fetch(original),
            fetch(restored.assets.get(source)),
          ]);
          if (
            !Buffer.from(await a.arrayBuffer()).equals(
              Buffer.from(await b.arrayBuffer()),
            )
          )
            throw new Error(`ZIP asset changed: ${source}`);
        }
      } finally {
        api.revokeAssetUrls(restored.assets);
      }
    }
    let pages = api.splitRenderedPages(document).length;
    let layout;
    if (options['check-layout'] || physicalPagination || destinations.pdf) {
      const { inspectLayout } = await import('./layout.mjs');
      // The PDF is printed from the very page that was measured.
      const inspected = await inspectLayout(rendered.html, pages, {
        physicalPagination,
        pdf: Boolean(destinations.pdf),
      });
      content.pdf = inspected.pdf;
      delete inspected.pdf;
      layout = inspected;
      if (physicalPagination) pages = layout.pagination.pageCount;
      if (destinations.layout)
        content.layout = JSON.stringify(layout, null, 2) + '\n';
    }
    let docx;
    if (destinations.docx) {
      const { exportDocx } = await import('./docx.mjs');
      docx = await exportDocx(document, assets, options.locale || 'ja');
      content.docx = docx.bytes;
      if (destinations.docxCheck) {
        const { checkDocx } = await import('./docx-check.mjs');
        docx.check = await checkDocx(docx.bytes, document, api, {
          locale: options.locale || 'ja',
        });
        content.docxCheck = JSON.stringify(docx.check, null, 2) + '\n';
      }
    }
    const outputs = [
      ...Object.entries(destinations).map(([kind, path]) => ({
        kind,
        path,
        content: content[kind],
      })),
      ...copies,
    ];
    // Recheck after rendering/checking, before starting the file transaction.
    await checkDestinations(outputs, protectedPaths, legacyJsonInput);
    await writeOutputs(outputs);
    const failedLayout =
      (options['fail-on-overflow'] && layout?.status === 'overflow') ||
      docx?.check?.status === 'fail';
    console.log(
      JSON.stringify(
        {
          ok: !failedLayout,
          renderer: 'KUMI native exportReportHtml/exportSlideHtml',
          type: document.type,
          theme: document.metadata.theme,
          pages,
          embedded_assets: envelope.assets.length,
          external_images: rendered.externalImages.length,
          editable_payload_validated: true,
          archive_roundtrip_validated: Boolean(destinations.zip),
          bytes: Buffer.byteLength(rendered.html),
          sha256: createHash('sha256').update(rendered.html).digest('hex'),
          output: destinations.html,
          outputs: destinations,
          copied_assets: copies.map((item) => item.path),
          diagnostics: [
            ...parsed.diagnostics,
            ...api.analyzeDocument(document).diagnostics,
          ],
          ...(layout && { layout }),
          ...(docx && {
            docx: {
              bytes: docx.bytes.length,
              warnings: docx.warnings,
              ...(docx.check && { check: docx.check }),
            },
          }),
        },
        null,
        2,
      ),
    );
    return failedLayout ? 2 : 0;
  } finally {
    for (const url of assets.values()) URL.revokeObjectURL(url);
    dom.window.close();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}

let exitCode;
try {
  exitCode = await run();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  exitCode = 1;
}
// React's browser server renderer can keep a MessageChannel alive in Node.
await Promise.all([
  new Promise((resolve) => process.stdout.write('', resolve)),
  new Promise((resolve) => process.stderr.write('', resolve)),
]);
process.exit(exitCode);
