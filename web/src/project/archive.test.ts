import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Zip,
  ZipDeflate,
  ZipPassThrough,
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from 'fflate';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  createBlankChapter,
  createReportProject,
  manifestFromProject,
} from './model';
import { prepareChapter } from './assets';
import {
  projectLimits,
  readReportProject,
  writeReportProject,
} from './archive';

function archiveFile(bytes: Uint8Array): File {
  const file = new File([new Uint8Array(bytes)], 'report.kumi.zip', {
    type: 'application/zip',
  });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new Uint8Array(bytes).buffer,
  });
  return file;
}

function fixtureEntries() {
  const project = createReportProject(
    parseMarkdown('# First\n{#sec:first}').document,
  );
  return {
    project,
    entries: {
      'project.json': strToU8(JSON.stringify(manifestFromProject(project))),
      [project.chapters[0].file]: strToU8('# First\n{#sec:first}'),
    },
  };
}

function editZipHeaders(
  bytes: Uint8Array,
  name: string,
  edit: (view: DataView, localOffset: number, centralOffset: number) => void,
): Uint8Array {
  const result = new Uint8Array(bytes);
  const view = new DataView(result.buffer);
  let offset = view.getUint32(result.length - 6, true);
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLength = view.getUint16(offset + 28, true);
    if (
      strFromU8(result.subarray(offset + 46, offset + 46 + nameLength)) === name
    ) {
      edit(view, view.getUint32(offset + 42, true), offset);
      return result;
    }
    offset +=
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  throw new Error(`Missing ZIP fixture entry: ${name}`);
}

function streamingZip(
  entries: Record<string, Uint8Array>,
  compression: 'store' | 'deflate-store' | 'deflate' = 'deflate',
): Uint8Array {
  const chunks: Uint8Array[] = [];
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  for (const [name, bytes] of Object.entries(entries)) {
    const entry =
      compression === 'store'
        ? new ZipPassThrough(name)
        : new ZipDeflate(name, {
            level: compression === 'deflate-store' ? 0 : 6,
          });
    archive.add(entry);
    entry.push(bytes, true);
  }
  archive.end();
  const result = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

beforeEach(() => {
  let sequence = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => `blob:project-${++sequence}`),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('report project ZIP', () => {
  it('round-trips ordered and excluded chapters with root and chapter metadata', async () => {
    const project = createReportProject(
      parseMarkdown(
        '---\ntype: report\ntitle: 研究レポート\nauthor: Author\ncustom: retained\n---\n\n# First',
      ).document,
    );
    project.metadata.toc = true;
    const second = createBlankChapter(2);
    second.title = 'Appendix';
    second.enabled = false;
    project.chapters.push(second);
    const bytes = await writeReportProject(project, new Map());
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toHaveLength(3);
    expect(strFromU8(files['project.json'])).toContain('Appendix');
    const loaded = await readReportProject(archiveFile(bytes));
    expect(loaded.project.metadata).toEqual(project.metadata);
    expect(
      loaded.project.chapters.map(({ title, enabled, pageBreakBefore }) => ({
        title,
        enabled,
        pageBreakBefore,
      })),
    ).toEqual(
      project.chapters.map(({ title, enabled, pageBreakBefore }) => ({
        title,
        enabled,
        pageBreakBefore,
      })),
    );
    expect(loaded.project.chapters[0].document.metadata.custom).toBe(
      'retained',
    );
    expect(loaded.assets.size).toBe(0);
  });

  it('falls back to a JSON chapter without losing Markdown-unrepresentable content', async () => {
    const project = createReportProject(parseMarkdown('# JSON').document);
    project.chapters[0].document.children = [
      {
        type: 'paragraph',
        attrs: { nodeId: 'preserved-id' },
        content: [{ type: 'inlineMath', attrs: { latex: 'a$b' } }],
      },
    ];
    const bytes = await writeReportProject(project, new Map());
    const loaded = await readReportProject(archiveFile(bytes));
    expect(loaded.project.chapters[0].file).toMatch(/\.json$/);
    expect(loaded.project.chapters[0].document).toEqual(
      project.chapters[0].document,
    );
    expect(project.chapters[0].file).toMatch(/\.md$/);
  });

  it('stores advanced tables as lossless KUMI Markdown chapters', async () => {
    const document = parseMarkdown(
      '| A | B |\n| --- | --- |\n| 1 | 2 |',
    ).document;
    const table = document.children[0];
    if (table.type !== 'table') throw new Error('table expected');
    const merged = table.content[0].content![0];
    table.content[0].content!.splice(1, 1);
    merged.attrs.colspan = 2;
    merged.attrs.borders = {
      top: { color: '#0f766e', style: 'double', width: 2 },
      bottom: null,
    };
    const project = createReportProject(document);

    const bytes = await writeReportProject(project, new Map());
    const files = unzipSync(bytes);
    const source = files[project.chapters[0].file];
    if (!source) throw new Error('chapter source expected');
    expect(strFromU8(source)).toContain('::: kumi-table');

    const loaded = await readReportProject(archiveFile(bytes));
    const loadedTable = loaded.project.chapters[0].document.children[0];
    if (loadedTable.type !== 'table') throw new Error('loaded table expected');
    expect(loaded.project.chapters[0].file).toMatch(/\.md$/);
    expect(loadedTable.content[0].content![0].attrs).toMatchObject({
      colspan: 2,
      borders: {
        top: { color: '#0f766e', style: 'double', width: 2 },
        bottom: null,
      },
    });
  });

  it('packs referenced images for excluded chapters and never fetches external images', async () => {
    const project = createReportProject(
      parseMarkdown(
        '![Local](local.svg)\n\n![Remote](https://example.com/image.png)',
      ).document,
    );
    const prepared = prepareChapter(
      project.chapters[0],
      new Map([['local.svg', 'blob:local']]),
    );
    project.chapters[0] = { ...prepared.chapter, enabled: false };
    const content = strToU8('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const fetchAsset = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => content.buffer,
    }));
    vi.stubGlobal('fetch', fetchAsset);
    const bytes = await writeReportProject(project, prepared.assets);
    expect(fetchAsset).toHaveBeenCalledExactlyOnceWith('blob:local');
    const loaded = await readReportProject(archiveFile(bytes));
    expect(loaded.assets.size).toBe(1);
    expect([...loaded.assets.keys()]).toEqual([...prepared.assets.keys()]);
    expect(loaded.project.chapters[0].enabled).toBe(false);
  });

  it.each([
    ['A.md', 'a.json'],
    ['same.md', 'same.markdown'],
    ['caf\u00e9.md', 'cafe\u0301.json'],
  ])(
    'chooses distinct JSON fallback names for %s and %s',
    async (first, second) => {
      const project = createReportProject(parseMarkdown('# JSON').document);
      project.chapters[0].file = `chapters/${first}`;
      project.chapters[0].document.children = [
        {
          type: 'paragraph',
          attrs: { nodeId: 'local-id' },
          content: [{ type: 'inlineMath', attrs: { latex: 'a$b' } }],
        },
      ];
      project.chapters.push({
        ...createBlankChapter(2),
        file: `chapters/${second}`,
        document: structuredClone(project.chapters[0].document),
      });
      const before = structuredClone(project);
      const bytes = await writeReportProject(project, new Map());
      const loaded = await readReportProject(archiveFile(bytes));
      const names = loaded.project.chapters.map((chapter) =>
        chapter.file.normalize('NFC').toLowerCase(),
      );
      expect(new Set(names).size).toBe(2);
      expect(
        names.every(
          (name) => name.startsWith('chapters/') && name.endsWith('.json'),
        ),
      ).toBe(true);
      expect(
        loaded.project.chapters.map((chapter) => chapter.document),
      ).toEqual(project.chapters.map((chapter) => chapter.document));
      expect(project).toEqual(before);
    },
  );

  it('does not overwrite the manifest when project.md needs a JSON fallback', async () => {
    const project = createReportProject(parseMarkdown('# JSON').document);
    project.chapters[0].file = 'project.md';
    project.chapters[0].document.children[0] = {
      type: 'paragraph',
      attrs: { nodeId: 'math' },
      content: [{ type: 'inlineMath', attrs: { latex: 'a$b' } }],
    };
    const loaded = await readReportProject(
      archiveFile(await writeReportProject(project, new Map())),
    );
    expect(loaded.project.chapters[0].file).toBe('project-2.json');
  });

  it.each([false, true])(
    'rejects understated expanded size (local header also forged: %s)',
    async (forgeLocal) => {
      const { entries, project } = fixtureEntries();
      entries[project.chapters[0].file] = strToU8(
        '# Keep\n\n' + 'x'.repeat(4000),
      );
      const bytes = editZipHeaders(
        zipSync(entries),
        project.chapters[0].file,
        (view, local, central) => {
          view.setUint32(central + 24, 8, true);
          if (forgeLocal) view.setUint32(local + 22, 8, true);
        },
      );
      await expect(readReportProject(archiveFile(bytes))).rejects.toThrow(
        'invalidArchive',
      );
      expect(vi.mocked(URL).createObjectURL).not.toHaveBeenCalled();
    },
  );

  it('stops oversized real output even when both headers claim a tiny source', async () => {
    const { entries, project } = fixtureEntries();
    entries[project.chapters[0].file] = strToU8(
      '# Keep\n\n' + 'x'.repeat(projectLimits.fileBytes + 1),
    );
    const bytes = editZipHeaders(
      zipSync(entries),
      project.chapters[0].file,
      (view, local, central) => {
        view.setUint32(central + 24, 8, true);
        view.setUint32(local + 22, 8, true);
      },
    );
    await expect(readReportProject(archiveFile(bytes))).rejects.toThrow(
      'invalidArchive',
    );
    expect(vi.mocked(URL).createObjectURL).not.toHaveBeenCalled();
  });

  it('requires final output to match the declared size and all local entries to match the directory', async () => {
    const { entries, project } = fixtureEntries();
    const bytes = zipSync(entries);
    const mutations = [
      (view: DataView, local: number, central: number) => {
        const size = view.getUint32(central + 24, true) + 1;
        view.setUint32(central + 24, size, true);
        view.setUint32(local + 22, size, true);
      },
      (view: DataView, local: number) => {
        view.setUint8(local + 30, 'x'.charCodeAt(0));
      },
      (view: DataView, local: number) => {
        view.setUint32(local, 0, true);
      },
      (view: DataView, _local: number, central: number) => {
        view.setUint32(
          central + 20,
          view.getUint32(central + 20, true) - 1,
          true,
        );
      },
    ];
    for (const mutation of mutations) {
      const damaged = editZipHeaders(bytes, project.chapters[0].file, mutation);
      await expect(readReportProject(archiveFile(damaged))).rejects.toThrow(
        'invalidArchive',
      );
    }
  });

  it('reads streaming ZIP data descriptors and validates the actual output size', async () => {
    const { entries, project } = fixtureEntries();
    const bytes = streamingZip(entries);
    const loaded = await readReportProject(archiveFile(bytes));
    expect(loaded.project.chapters[0].document.children[0]).toMatchObject({
      content: [{ text: 'First' }],
    });
    const damaged = editZipHeaders(
      bytes,
      project.chapters[0].file,
      (view, _local, central) => {
        view.setUint32(central + 24, 1, true);
      },
    );
    await expect(readReportProject(archiveFile(damaged))).rejects.toThrow(
      'invalidArchive',
    );
  });

  it.each(['store', 'deflate-store', 'deflate'] as const)(
    'reads %s streaming entries whose image bytes contain ZIP header signatures',
    async (compression) => {
      const project = createReportProject(
        parseMarkdown('![Binary](payload.png)').document,
      );
      project.chapters[0].file = 'chapters/source.md';
      for (const signature of [
        [0x50, 0x4b, 0x07, 0x08],
        [0x50, 0x4b, 0x03, 0x04],
      ]) {
        const payload = Uint8Array.from(
          { length: 4096 },
          (_, index) => (index * 73 + 29) % 256,
        );
        payload.set(signature, 20);
        const bytes = streamingZip(
          {
            'project.json': strToU8(
              JSON.stringify(manifestFromProject(project)),
            ),
            'chapters/source.md': strToU8('![Binary](payload.png)'),
            'chapters/payload.png': payload,
          },
          compression,
        );
        expect(unzipSync(bytes)['chapters/payload.png']).toEqual(payload);
        const loaded = await readReportProject(archiveFile(bytes));
        expect([...loaded.assets.keys()]).toEqual(['chapters/payload.png']);
        const blob = vi.mocked(URL).createObjectURL.mock.calls.at(-1)![0];
        expect(blob).toBeInstanceOf(Blob);
        expect((blob as Blob).size).toBe(payload.length);
      }
    },
  );

  it('rejects CRC mismatches even when entry names and sizes are unchanged', async () => {
    const { entries, project } = fixtureEntries();
    const bytes = editZipHeaders(
      zipSync(entries, { level: 0 }),
      project.chapters[0].file,
      (view, local) => {
        const bodyOffset =
          local +
          30 +
          view.getUint16(local + 26, true) +
          view.getUint16(local + 28, true);
        view.setUint8(bodyOffset + 2, 'X'.charCodeAt(0));
      },
    );
    await expect(readReportProject(archiveFile(bytes))).rejects.toThrow(
      'invalidArchive',
    );
    expect(vi.mocked(URL).createObjectURL).not.toHaveBeenCalled();
  });

  it('accepts empty directory entries and rejects symlinks or encrypted entries', async () => {
    const { entries, project } = fixtureEntries();
    const bytes = zipSync({ ...entries, 'chapters/': new Uint8Array() });
    expect(
      (await readReportProject(archiveFile(bytes))).project.chapters,
    ).toHaveLength(1);
    const symlink = editZipHeaders(
      bytes,
      project.chapters[0].file,
      (view, _local, central) => {
        view.setUint8(central + 5, 3);
        view.setUint32(central + 38, 0o120777 << 16, true);
      },
    );
    await expect(readReportProject(archiveFile(symlink))).rejects.toThrow(
      'invalidArchive',
    );
    const encrypted = editZipHeaders(
      bytes,
      project.chapters[0].file,
      (view, local, central) => {
        view.setUint16(local + 6, view.getUint16(local + 6, true) | 1, true);
        view.setUint16(
          central + 8,
          view.getUint16(central + 8, true) | 1,
          true,
        );
      },
    );
    await expect(readReportProject(archiveFile(encrypted))).rejects.toThrow(
      'invalidArchive',
    );
  });

  it('rejects missing images on save and on import before creating object URLs', async () => {
    const project = createReportProject(
      parseMarkdown('![Lost](missing.png)').document,
    );
    await expect(writeReportProject(project, new Map())).rejects.toThrow(
      'missingImage',
    );
    const entries = {
      'project.json': strToU8(JSON.stringify(manifestFromProject(project))),
      [project.chapters[0].file]: strToU8('![Lost](missing.png)'),
    };
    await expect(
      readReportProject(archiveFile(zipSync(entries))),
    ).rejects.toThrow('missingImage');
    expect(vi.mocked(URL).createObjectURL).not.toHaveBeenCalled();
  });

  it.each(['../outside.md', '/absolute.md', '__proto__/x.md', 'a\\b.md'])(
    'rejects unsafe ZIP entry names: %s',
    async (path) => {
      const { entries } = fixtureEntries();
      await expect(
        readReportProject(
          archiveFile(zipSync({ ...entries, [path]: strToU8('x') })),
        ),
      ).rejects.toThrow('unsafePath');
    },
  );

  it('rejects missing manifest files, malformed manifests, slides and undeclared attachments', async () => {
    await expect(
      readReportProject(
        archiveFile(zipSync({ 'note.md': strToU8('# Alone') })),
      ),
    ).rejects.toThrow('missingFile');
    const { entries, project } = fixtureEntries();
    await expect(
      readReportProject(
        archiveFile(zipSync({ ...entries, 'project.json': strToU8('{}') })),
      ),
    ).rejects.toThrow('invalidArchive');
    await expect(
      readReportProject(
        archiveFile(
          zipSync({
            ...entries,
            [project.chapters[0].file]: strToU8(
              '---\ntype: slide\n---\n# Slide',
            ),
          }),
        ),
      ),
    ).rejects.toThrow('reportOnly');
    await expect(
      readReportProject(
        archiveFile(zipSync({ ...entries, 'script.js': strToU8('alert(1)') })),
      ),
    ).rejects.toThrow('unsupportedFile');
  });

  it('rejects case-insensitive filename collisions for portable archives', async () => {
    const { entries } = fixtureEntries();
    await expect(
      readReportProject(
        archiveFile(zipSync({ ...entries, 'PROJECT.JSON': strToU8('{}') })),
      ),
    ).rejects.toThrow('invalidArchive');
  });

  it('rejects over-limit compressed size, expanded sizes and file counts', async () => {
    const file = archiveFile(new Uint8Array());
    Object.defineProperty(file, 'size', {
      value: projectLimits.archiveBytes + 1,
    });
    await expect(readReportProject(file)).rejects.toThrow('archiveTooLarge');
    const bomb = zipSync({
      'oversized.txt': new Uint8Array(projectLimits.fileBytes + 1),
    });
    await expect(readReportProject(archiveFile(bomb))).rejects.toThrow(
      'archiveTooLarge',
    );
    const entries = Object.fromEntries(
      Array.from({ length: projectLimits.files + 1 }, (_, index) => [
        `${index}.txt`,
        strToU8('x'),
      ]),
    );
    await expect(
      readReportProject(archiveFile(zipSync(entries))),
    ).rejects.toThrow('tooManyFiles');
  });
});
