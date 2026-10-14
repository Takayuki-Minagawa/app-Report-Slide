import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, zipSync, strToU8 } from 'fflate';
import { pdfSourceSchema, validatePdfBytes } from '@/src/document/pdf-source';
import { referencedAssets } from '@/src/document/assets';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { exportReportHtml } from '@/src/export/report-html';
import { exportSlideHtml } from '@/src/export/slide-html';
import {
  editableHtmlId,
  editableHtmlPayload,
} from '@/src/export/editable-html';
import { bytesToBase64 } from '@/src/export/embedded-images';
import {
  officeFeatureWarnings,
  referencedLocalImages,
} from '@/src/export/format-capabilities';
import {
  createReportProject,
  assembleReportProject,
  createBlankChapter,
  appendReportProjectChapter,
  resolveProjectPath,
} from '@/src/project/model';
import { prepareChapter, pruneProjectAssets } from '@/src/project/assets';
import { readReportProject, writeReportProject } from '@/src/project/archive';
import { createInsertedPdfAsset, readWorkspaceFiles } from './files';
import { importHtml } from './html-import';
import { readDocumentArchive, writeDocumentArchive } from './document-archive';
import { captureRecoveryAssets, restoreRecoveryAssets } from './recovery';

const bytes = new TextEncoder().encode(
  '%PDF-1.7\nOriginal PDF bytes, never cropped\n%%EOF',
);
const pdfSource = {
  asset: 'assets/original.pdf',
  fileName: 'original.pdf',
  page: 2,
  pageCount: 3,
  dpi: 144,
};
const blobs = new Map<string, Blob>();
const fetchMock = vi.fn();
function readBlob(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(blob);
  });
}
function file(data: Uint8Array, name: string, type: string): File {
  const value = new File([new Uint8Array(data)], name, { type });
  Object.defineProperty(value, 'arrayBuffer', {
    value: async () => new Uint8Array(data).buffer,
  });
  Object.defineProperty(value, 'text', {
    value: async () => new TextDecoder().decode(data),
  });
  return value;
}
function source(type: 'report' | 'slide' = 'report') {
  const document = parseMarkdown(
    `---\ntype: ${type}\n---\n\n![PDF page](assets/page.png)`,
  ).document;
  const figure = document.children.find((node) => node.type === 'figure')!;
  figure.attrs.figureEdit = {
    version: 1,
    pdfSource: { ...pdfSource },
    imageSize: { width: 1200, height: 1600 },
    crop: { x: 10, y: 20, width: 70, height: 40 },
    source: {
      referenceId: '',
      origin: 'cropped',
      pdfPage: '2',
      printedPage: 'S1',
      figureNumber: 'Figure 1',
      note: '',
    },
  };
  return document;
}
const initialAssets = () =>
  new Map([
    ['assets/page.png', 'blob:image'],
    [pdfSource.asset, 'blob:pdf'],
  ]);

beforeEach(() => {
  blobs.clear();
  blobs.set(
    'blob:image',
    new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  );
  blobs.set('blob:pdf', new Blob([bytes], { type: 'application/pdf' }));
  let sequence = 0;
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => {
        const key = `blob:loaded-${++sequence}`;
        blobs.set(key, blob);
        return key;
      }),
      revokeObjectURL: vi.fn(),
    }),
  );
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const blob = blobs.get(url);
    if (!blob) throw new Error(`Unknown URL: ${url}`);
    return new Response(await readBlob(blob), {
      headers: { 'content-type': blob.type },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('PDF original asset persistence', () => {
  it.each([
    ['pdf', 'research.pdf'],
    ['pdf', '研究資料.pdf'],
    ['image', 'pdf-page-1.png'],
    ['image', '研究資料-1.png'],
  ] as const)(
    'preserves retained project %s assets after reload and deletion when adding %s again',
    async (kind, name) => {
      const chapterFile = 'chapters/first/document.md';
      const resolveSource = (source: string) =>
        resolveProjectPath(chapterFile, source);
      const oldBytes = kind === 'pdf' ? bytes : new Uint8Array([1, 2, 3]);
      const newBytes =
        kind === 'pdf'
          ? strToU8('%PDF-1.7\nDifferent original\n%%EOF')
          : new Uint8Array([4, 5, 6]);
      const type = kind === 'pdf' ? 'application/pdf' : 'image/png';

      vi.resetModules();
      const initialFiles = await import('./files');
      const initialAllocator =
        kind === 'pdf'
          ? initialFiles.createInsertedPdfAsset
          : initialFiles.createInsertedImageAsset;
      const original = await initialAllocator(
        file(oldBytes, name, type),
        new Map(),
        new Set(),
        0,
        resolveSource,
      );
      const oldPath = resolveSource(original.source);
      const assets = new Map([[oldPath, original.url]]);

      // Reload resets the insertion sequence. Deletion removes live references,
      // while the project keeps the original asset available for Undo.
      vi.resetModules();
      const reloadedFiles = await import('./files');
      const reloadedAllocator =
        kind === 'pdf'
          ? reloadedFiles.createInsertedPdfAsset
          : reloadedFiles.createInsertedImageAsset;
      const inserted = await reloadedAllocator(
        file(newBytes, name, type),
        assets,
        new Set(),
        0,
        resolveSource,
      );
      const newPath = resolveSource(inserted.source);
      expect(newPath).not.toBe(oldPath);
      assets.set(newPath, inserted.url);
      expect(assets.size).toBe(2);
      expect(assets.get(oldPath)).toBe(original.url);
      for (const [path, expected] of [
        [oldPath, oldBytes],
        [newPath, newBytes],
      ] as const)
        expect(
          new Uint8Array(await readBlob(blobs.get(assets.get(path)!)!)),
        ).toEqual(new Uint8Array(Array.from(expected)));
    },
  );

  it.each(['report', 'slide'] as const)(
    'keeps exact original bytes, page and crop through %s HTML and document ZIP',
    async (type) => {
      const document = source(type);
      const assets = initialAssets();
      const html = await (
        type === 'slide' ? exportSlideHtml : exportReportHtml
      )(document, assets, 'ja');
      const importedHtml = importHtml(html.html);
      expect(importedHtml.document).toEqual(document);
      expect(
        new Uint8Array(
          await readBlob(blobs.get(importedHtml.assets.get(pdfSource.asset)!)!),
        ),
      ).toEqual(new Uint8Array(Array.from(bytes)));
      const archive = await writeDocumentArchive(
        importedHtml.document,
        importedHtml.assets,
      );
      const loaded = await readDocumentArchive(
        file(archive, 'document.zip', 'application/zip'),
      );
      expect(loaded.document).toEqual(document);
      expect(
        new Uint8Array(
          await readBlob(blobs.get(loaded.assets.get(pdfSource.asset)!)!),
        ),
      ).toEqual(new Uint8Array(Array.from(bytes)));
      expect(
        referencedAssets(loaded.document.children).map(({ kind }) => kind),
      ).toEqual(['image', 'pdf']);
      expect(
        fetchMock.mock.calls.every(([url]) => String(url).startsWith('blob:')),
      ).toBe(true);
    },
  );

  it('reimports Markdown plus a PDF by its original filename and keeps PDF bytes in recovery', async () => {
    const document = source();
    const figure = document.children.find((node) => node.type === 'figure')!;
    figure.attrs.figureEdit!.pdfSource!.asset =
      'assets/pdf-123/source-original.pdf';
    const loaded = await readWorkspaceFiles([
      file(strToU8(serializeDocument(document)), 'report.md', 'text/markdown'),
      file(bytes, 'original.pdf', 'application/pdf'),
      file(new Uint8Array([1, 2, 3]), 'page.png', 'image/png'),
    ]);
    expect(loaded.unresolved).toEqual([]);
    const recovery = await captureRecoveryAssets(loaded.assets);
    const restored = restoreRecoveryAssets(recovery);
    expect(
      new Uint8Array(
        await readBlob(
          blobs.get(restored.get('assets/pdf-123/source-original.pdf')!)!,
        ),
      ),
    ).toEqual(new Uint8Array(Array.from(bytes)));
  });

  it('does not bind distinct same-named PDF originals to one sidecar, while exact relative paths remain usable', async () => {
    const document = source();
    const first = document.children.find((node) => node.type === 'figure')!;
    first.attrs.figureEdit!.pdfSource!.asset =
      'assets/first/source-original.pdf';
    const second = structuredClone(first);
    second.attrs.nodeId = 'second-pdf';
    second.attrs.figureEdit!.pdfSource!.asset =
      'assets/second/source-original.pdf';
    document.children.push(second);
    const manuscript = () =>
      file(
        strToU8(JSON.stringify(document)),
        'source.json',
        'application/json',
      );
    const image = () =>
      file(new Uint8Array([1, 2, 3]), 'page.png', 'image/png');
    const ambiguous = await readWorkspaceFiles([
      manuscript(),
      image(),
      file(bytes, 'original.pdf', 'application/pdf'),
    ]);
    expect(ambiguous.unresolved).toEqual([
      'assets/first/source-original.pdf',
      'assets/second/source-original.pdf',
    ]);
    expect([...ambiguous.assets.keys()]).toEqual(['assets/page.png']);

    const otherBytes = strToU8('%PDF-1.7\nA different original\n%%EOF');
    const exact = [bytes, otherBytes].map((content, index) => {
      const attachment = file(content, 'original.pdf', 'application/pdf');
      Object.defineProperty(attachment, 'webkitRelativePath', {
        value: `selected/assets/${index === 0 ? 'first' : 'second'}/source-original.pdf`,
      });
      return attachment;
    });
    const restored = await readWorkspaceFiles([
      manuscript(),
      image(),
      ...exact,
    ]);
    expect(restored.unresolved).toEqual([]);
    for (const [index, directory] of ['first', 'second'].entries())
      expect(
        new Uint8Array(
          await readBlob(
            blobs.get(
              restored.assets.get(`assets/${directory}/source-original.pdf`)!,
            )!,
          ),
        ),
      ).toEqual(new Uint8Array(Array.from(index === 0 ? bytes : otherBytes)));
    expect(restored.assets.get('assets/first/source-original.pdf')).not.toBe(
      restored.assets.get('assets/second/source-original.pdf'),
    );
  });

  it('keeps independent same-named originals in two chapters through project ZIP and combined HTML', async () => {
    let project = createReportProject(source());
    const first = prepareChapter(project.chapters[0], initialAssets());
    project = { ...project, chapters: [first.chapter] };
    const secondChapter = {
      ...createBlankChapter(project.chapters.length + 1),
      document: source(),
    };
    const different = new TextEncoder().encode(
      '%PDF-1.7\nSecond original\n%%EOF',
    );
    blobs.set(
      'blob:other-pdf',
      new Blob([different], { type: 'application/pdf' }),
    );
    const second = prepareChapter(
      secondChapter,
      new Map([
        ['assets/page.png', 'blob:image'],
        [pdfSource.asset, 'blob:other-pdf'],
      ]),
    );
    project = appendReportProjectChapter(project, second.chapter);
    const assets = new Map([
      ...first.assets,
      ...second.assets,
      ['unused.pdf', 'blob:unused'],
    ]);
    const retained = pruneProjectAssets(project, assets);
    expect(retained.size).toBe(4);
    const archive = await writeReportProject(project, retained);
    const loaded = await readReportProject(
      file(archive, 'project.zip', 'application/zip'),
    );
    const assembled = assembleReportProject(loaded.project);
    const originals = referencedAssets(assembled.children).filter(
      ({ kind }) => kind === 'pdf',
    );
    expect(originals).toHaveLength(2);
    expect(originals[0].source).not.toBe(originals[1].source);
    const html = await exportReportHtml(assembled, loaded.assets, 'ja');
    const reopened = importHtml(html.html);
    expect(
      new Uint8Array(
        await readBlob(blobs.get(reopened.assets.get(originals[0].source)!)!),
      ),
    ).toEqual(new Uint8Array(Array.from(bytes)));
    expect(
      new Uint8Array(
        await readBlob(blobs.get(reopened.assets.get(originals[1].source)!)!),
      ),
    ).toEqual(new Uint8Array(Array.from(different)));
  });

  it('checks MIME, signature, source paths, sizes and page bounds before registering an original', async () => {
    expect(() => validatePdfBytes(bytes, 'text/html')).toThrow(/MIME/);
    expect(() => validatePdfBytes(strToU8('not a PDF'))).toThrow(/識別/);
    for (const asset of [
      'https://example.com/a.pdf',
      'data:application/pdf;base64,AA==',
      '../a.pdf',
      'assets/%2e%2e/a.pdf',
      '/a.pdf',
    ])
      expect(pdfSourceSchema.safeParse({ ...pdfSource, asset }).success).toBe(
        false,
      );
    expect(pdfSourceSchema.safeParse({ ...pdfSource, page: 4 }).success).toBe(
      false,
    );
    expect(pdfSourceSchema.safeParse({ ...pdfSource, dpi: 2 }).success).toBe(
      true,
    );
    const original = file(bytes, '論文:図?.pdf', 'application/pdf');
    const inserted = await createInsertedPdfAsset(original, new Map());
    expect(
      pdfSourceSchema.safeParse({ ...pdfSource, asset: inserted.source })
        .success,
    ).toBe(true);
    const oversized = file(bytes, 'huge.pdf', 'application/pdf');
    Object.defineProperty(oversized, 'size', { value: 21 * 1024 * 1024 });
    await expect(createInsertedPdfAsset(oversized, new Map())).rejects.toThrow(
      /20 MiB/,
    );
    await expect(
      createInsertedPdfAsset(original, new Map(), new Set(), 50 * 1024 * 1024),
    ).rejects.toThrow();
    await expect(
      createInsertedPdfAsset(file(bytes, 'not.pdf', 'image/png'), new Map()),
    ).rejects.toThrow();
    await expect(
      createInsertedPdfAsset(
        file(strToU8('not a PDF'), 'fake.pdf', 'application/pdf'),
        new Map(),
      ),
    ).rejects.toThrow(/識別/);
  });

  it('reports PDF originals as required sidecar files and Office preservation limits', () => {
    expect(referencedLocalImages(source())).toEqual([
      'assets/page.png',
      pdfSource.asset,
    ]);
    expect(
      officeFeatureWarnings(source(), 'ja').some((warning) =>
        warning.includes('PDF原本・ページの再選択'),
      ),
    ).toBe(true);
  });

  it('fails recovery capture when a PDF original is unreadable and reuses shared PDF blobs on restore', async () => {
    await expect(
      captureRecoveryAssets(new Map([[pdfSource.asset, 'blob:missing']])),
    ).rejects.toThrow(/PDF原本/);
    const blob = blobs.get('blob:pdf')!;
    const restored = restoreRecoveryAssets([
      { path: 'first.pdf', blob },
      { path: 'second.pdf', blob },
    ]);
    expect(restored.get('first.pdf')).toBe(restored.get('second.pdf'));
    expect(() =>
      restoreRecoveryAssets([
        { path: 'wrong.pdf', blob: new Blob([bytes], { type: 'image/png' }) },
      ]),
    ).toThrow(/形式/);
  });

  it('rejects missing, malformed and incorrectly typed PDF data instead of silently losing originals', async () => {
    const document = source();
    await expect(
      exportReportHtml(
        document,
        new Map([['assets/page.png', 'blob:image']]),
        'ja',
      ),
    ).rejects.toThrow();
    const image = 'data:image/png;base64,AQID';
    const invalid = editableHtmlPayload(document, (source) =>
      source.endsWith('.pdf')
        ? 'data:application/pdf;base64,' +
          bytesToBase64(strToU8('not PDF bytes'))
        : image,
    );
    expect(() =>
      importHtml(
        `<template id="${editableHtmlId}" data-encoding="base64">${invalid}</template>`,
      ),
    ).toThrow(/識別/);
    const incorrectlyTyped = editableHtmlPayload(document, () => image);
    expect(() =>
      importHtml(
        `<template id="${editableHtmlId}" data-encoding="base64">${incorrectlyTyped}</template>`,
      ),
    ).toThrow(/PDF/);
    const archive = unzipSync(
      await writeDocumentArchive(document, initialAssets()),
    );
    const pdfPath = Object.keys(archive).find((key) => key.endsWith('.pdf'))!;
    archive[pdfPath] = strToU8('not a PDF');
    await expect(
      readDocumentArchive(
        file(zipSync(archive), 'invalid.zip', 'application/zip'),
      ),
    ).rejects.toThrow(/識別/);
  });
});
