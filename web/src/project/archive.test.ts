import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
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
