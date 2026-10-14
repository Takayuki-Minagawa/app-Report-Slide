import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { splitDocumentPages, analyzeDocument } from '@/src/document/semantics';
import {
  applySlideDesign,
  createSlideComposite,
  getSlidePageId,
  resolveSlideDesign,
  readSlidePresets,
} from '@/src/document/slide-design';
import {
  readerSupplementForPage,
  setReaderSupplement,
} from '@/src/document/reader-supplement';
import { figureReferences } from '@/src/document/figure-edit';
import { validateDocumentData } from '@/src/document/validation';
import {
  createDocumentProject,
  createBlankChapter,
  appendReportProjectChapter,
  assembleDocumentProject,
  projectChapterDocument,
  validateDocumentProject,
  projectSlidePages,
} from './model';
import {
  chapterLocalAssets,
  prepareChapter,
  pruneProjectAssets,
} from './assets';
import {
  duplicateSlidePage,
  moveSlidePage,
  transferSlidePage,
} from './slide-pages';
import { readReportProject, writeReportProject } from './archive';
import { readBlockLibrary } from '@/src/document/block-library';
import { preservedContent } from '@/src/document/preserved-content';
import {
  defaultPageSettings,
  resolvePageSettings,
} from '@/src/document/page-settings';
import type { JsonValue } from '@/src/document/model';

const bytes = new Map<string, Uint8Array>();
beforeEach(() => {
  bytes.clear();
  let id = 0;
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => `blob:restored-${++id}`),
      revokeObjectURL: vi.fn(),
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(new Uint8Array(bytes.get(url) ?? []), {
          headers: {
            'content-type': url.includes('pdf')
              ? 'application/pdf'
              : 'image/png',
          },
        }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

function deck(title: string) {
  const document = parseMarkdown(
    `---\ntype: slide\ntitle: ${title}\n---\n# ${title}\n\n![Evidence](same.png)\n{#fig:evidence}\n\nConditions\n\n::: slidebreak\n:::\n\n# ${title} results\n\n[@fig:evidence]`,
  ).document;
  const figure = document.children.find((node) => node.type === 'figure')!;
  figure.attrs.figureEdit = {
    version: 1,
    pdfSource: {
      asset: 'original.pdf',
      fileName: 'same.pdf',
      page: 1,
      pageCount: 2,
      dpi: 144,
    },
    source: {
      referenceId: 'paper',
      origin: 'original',
      pdfPage: '1',
      printedPage: '',
      figureNumber: '1',
      note: '',
    },
  };
  document.metadata.figure_references = [
    { id: 'paper', title: `${title} paper`, authors: '', year: '', url: '' },
  ];
  document.metadata = setReaderSupplement(document, 0, {
    title: `${title} supplement`,
    text: `${title} detailed conditions`,
    link: '',
  });
  document.metadata = applySlideDesign(
    document,
    [getSlidePageId(document, 0)],
    {
      ...resolveSlideDesign(document, 0),
      layout: 'composite',
      composite: createSlideComposite(splitDocumentPages(document)[0]),
    },
  );
  return document;
}

function fourChapters() {
  let project = createDocumentProject(deck('A'));
  let assets = new Map<string, string>();
  for (let index = 0; index < 4; index++) {
    const title = String.fromCharCode(65 + index);
    const chapter =
      index === 0
        ? project.chapters[0]
        : {
            ...createBlankChapter(index + 1, title, 'slide'),
            document: deck(title),
            title,
          };
    chapter.title = title;
    bytes.set(`blob:image-${title}`, new Uint8Array([index + 1, 2, 3]));
    bytes.set(
      `blob:pdf-${title}`,
      new TextEncoder().encode(`%PDF-1.7\n${title} original\n%%EOF`),
    );
    const prepared = prepareChapter(
      chapter,
      new Map([
        ['same.png', `blob:image-${title}`],
        ['original.pdf', `blob:pdf-${title}`],
      ]),
    );
    assets = new Map([...assets, ...prepared.assets]);
    project =
      index === 0
        ? { ...project, chapters: [prepared.chapter] }
        : appendReportProjectChapter(project, prepared.chapter);
  }
  return { project: validateDocumentProject(project), assets };
}

describe('slide chapter project', () => {
  it('inherits common Report and Slide settings without replacing chapter-local metadata', () => {
    for (const type of ['report', 'slide'] as const) {
      const document =
        type === 'report'
          ? parseMarkdown('---\ntitle: Local chapter\n---\n# Chapter').document
          : deck('Local chapter');
      const project = createDocumentProject(document);
      project.metadata.title = 'Whole project';
      project.metadata.page_settings = {
        ...defaultPageSettings,
        paper: 'B5',
        orientation: 'landscape',
        line_height: 1.5,
      };
      project.metadata.paper = 'B5';
      project.metadata.orientation = 'landscape';
      project.metadata.number_sections = true;
      project.metadata.toc = true;
      project.metadata.aspect_ratio = '4:3';
      project.metadata.slide_number = false;
      const chapter = project.chapters[0];
      chapter.document.metadata.page_settings = { ...defaultPageSettings };
      chapter.document.metadata.toc = false;
      chapter.document.metadata.slide_number = true;
      const before = structuredClone(chapter.document);
      const local = projectChapterDocument(project, chapter);
      expect(resolvePageSettings(local.metadata)).toMatchObject({
        paper: 'B5',
        orientation: 'landscape',
        line_height: 1.5,
      });
      expect(local.metadata).toMatchObject({
        title: 'Local chapter',
        paper: 'B5',
        orientation: 'landscape',
        number_sections: true,
        toc: true,
        aspect_ratio: '4:3',
        slide_number: false,
      });
      expect(local.metadata.slide_design).toEqual(before.metadata.slide_design);
      expect(local.metadata.reader_supplements).toEqual(
        before.metadata.reader_supplements,
      );
      expect(chapter.document).toEqual(before);
    }
  });

  it('namespaces grouped library parts and preserved originals without dropping their chapter assets', () => {
    const make = (title: string) => {
      const document = deck(title);
      const figure = document.children.find((node) => node.type === 'figure')!;
      figure.attrs.blockLayout = { groupId: 'shared-group', name: title };
      document.metadata.slide_presets = {
        version: 1,
        items: [
          {
            id: 'preset',
            name: title,
            design: resolveSlideDesign(document, 0),
          },
        ],
      };
      document.metadata.block_library = {
        version: 1,
        items: [
          {
            id: 'part',
            name: title,
            nodes: [structuredClone(figure)],
            references: figureReferences(document.metadata),
          },
        ],
      } as unknown as JsonValue;
      document.metadata.preserved_content = [
        {
          id: 'original',
          nodeId: figure.attrs.nodeId,
          name: 'Original unsupported record',
          format: 'json',
          source: '{"retained":true}',
          assets: [{ source: 'original.pdf', kind: 'pdf' }],
        },
      ];
      return document;
    };
    let project = createDocumentProject(make('A'));
    const first = prepareChapter(
      project.chapters[0],
      new Map([
        ['same.png', 'blob:a'],
        ['original.pdf', 'blob:a-pdf'],
      ]),
    );
    project.chapters[0] = first.chapter;
    const second = prepareChapter(
      { ...createBlankChapter(2, 'B', 'slide'), document: make('B') },
      new Map([
        ['same.png', 'blob:b'],
        ['original.pdf', 'blob:b-pdf'],
      ]),
    );
    project = appendReportProjectChapter(project, second.chapter);
    const combined = validateDocumentData(assembleDocumentProject(project));
    const parts = readBlockLibrary(combined.metadata).items;
    expect(
      readSlidePresets(combined.metadata).items.map((preset) => preset.name),
    ).toEqual(['A', 'B']);
    expect(
      readSlidePresets(
        projectChapterDocument(project, project.chapters[1]).metadata,
      ).items,
    ).toHaveLength(1);
    expect(parts).toHaveLength(2);
    expect(parts[0].id).not.toBe(parts[1].id);
    expect(parts[0].nodes[0].attrs.blockLayout).not.toEqual(
      parts[1].nodes[0].attrs.blockLayout,
    );
    expect(parts[1].references?.[0].id).not.toBe(parts[0].references?.[0].id);
    expect(
      preservedContent(combined.metadata).map((entry) => entry.source),
    ).toEqual(['{"retained":true}', '{"retained":true}']);
    expect(
      preservedContent(combined.metadata).every((entry) =>
        entry.assets?.[0].source.startsWith('chapters/'),
      ),
    ).toBe(true);
  });
  it('combines four decks with chapter order, inclusion, themes, layouts, citations and supplements intact', () => {
    const { project, assets } = fourChapters();
    project.metadata.theme = 'technical';
    project.metadata.project_toc = true;
    project.chapters[1].themeOverride = 'paper-light';
    project.chapters.reverse();
    project.chapters[1].enabled = false;
    const combined = validateDocumentData(assembleDocumentProject(project));
    expect(combined.type).toBe('slide');
    expect(splitDocumentPages(combined)).toHaveLength(7);
    expect(
      projectSlidePages(project)
        .filter((page) => page.enabled)
        .map((page) => page.globalPageIndex),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(readerSupplementForPage(combined, 1)?.text).toBe(
      'D detailed conditions',
    );
    expect(readerSupplementForPage(combined, 3)?.text).toBe(
      'B detailed conditions',
    );
    expect(resolveSlideDesign(combined, 4).theme).toBe('paper-light');
    expect(resolveSlideDesign(combined, 6).theme).toBe('technical');
    const firstNodes = splitDocumentPages(combined)[1];
    expect(
      resolveSlideDesign(combined, 1).composite?.assignments.every((entry) =>
        firstNodes.some((node) => node.attrs.nodeId === entry.nodeId),
      ),
    ).toBe(true);
    expect(figureReferences(combined.metadata)).toHaveLength(4);
    expect(analyzeDocument(combined).diagnostics).toEqual([]);
    expect(chapterLocalAssets(project.chapters[0], assets).size).toBe(2);
    expect(pruneProjectAssets(project, assets).size).toBe(8);
  });

  it('roundtrips four slide chapters through ZIP including excluded chapters, original assets and page metadata', async () => {
    const { project, assets } = fourChapters();
    project.chapters[2].enabled = false;
    project.chapters[1].themeOverride = 'technical';
    const archive = await writeReportProject(project, assets);
    const file = new File([new Uint8Array(archive)], 'slides.kumi.zip', {
      type: 'application/zip',
    });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array(archive).buffer,
    });
    const loaded = await readReportProject(file);
    expect(loaded.project.type).toBe('kumi-slide-project');
    expect(loaded.project.chapters.map((chapter) => chapter.enabled)).toEqual([
      true,
      true,
      false,
      true,
    ]);
    expect(loaded.project.chapters[1].themeOverride).toBe('technical');
    expect(loaded.assets.size).toBe(8);
    for (const chapter of loaded.project.chapters) {
      expect(readerSupplementForPage(chapter.document, 0)?.text).toBe(
        `${chapter.title} detailed conditions`,
      );
      expect(resolveSlideDesign(chapter.document, 0).layout).toBe('composite');
    }
    expect(
      splitDocumentPages(assembleDocumentProject(loaded.project)),
    ).toHaveLength(6);
  });

  it('duplicates and reorders a whole slide without losing its independent IDs, labels, layout or supplements', () => {
    const original = deck('A');
    const duplicated = validateDocumentData(duplicateSlidePage(original, 0));
    expect(splitDocumentPages(duplicated)).toHaveLength(3);
    expect(analyzeDocument(duplicated).diagnostics).toEqual([]);
    expect(readerSupplementForPage(duplicated, 1)?.text).toBe(
      'A detailed conditions',
    );
    expect(
      resolveSlideDesign(duplicated, 1).composite?.assignments[0].nodeId,
    ).not.toBe(
      resolveSlideDesign(original, 0).composite?.assignments[0].nodeId,
    );
    const moved = validateDocumentData(moveSlidePage(duplicated, 1, 2));
    expect(readerSupplementForPage(moved, 2)?.text).toBe(
      'A detailed conditions',
    );
    expect(resolveSlideDesign(moved, 2).layout).toBe('composite');
    expect(splitDocumentPages(original)).toHaveLength(2);
  });

  it('moves a page into another chapter with original assets and global references still usable after deleting its old chapter', () => {
    const { project, assets } = fourChapters();
    const source = project.chapters[0],
      destination = project.chapters[1];
    const copies = new Map<string, string>();
    const transferred = validateDocumentProject(
      transferSlidePage(project, source.id, 0, destination.id, copies),
    );
    for (const [target, original] of copies)
      assets.set(target, assets.get(original)!);
    expect(splitDocumentPages(transferred.chapters[0].document)).toHaveLength(
      1,
    );
    const target = transferred.chapters[1];
    expect(splitDocumentPages(target.document)).toHaveLength(3);
    expect(readerSupplementForPage(target.document, 2)?.text).toBe(
      'A detailed conditions',
    );
    expect(
      resolveSlideDesign(projectChapterDocument(transferred, target), 2).layout,
    ).toBe('composite');
    expect(
      analyzeDocument(assembleDocumentProject(transferred)).diagnostics,
    ).toEqual([]);
    transferred.chapters = transferred.chapters.filter(
      (chapter) => chapter.id !== source.id,
    );
    const retained = pruneProjectAssets(transferred, assets);
    expect(chapterLocalAssets(target, retained).size).toBe(4);
    expect([...chapterLocalAssets(target, retained).values()]).toContain(
      'blob:pdf-A',
    );
  });

  it('keeps explicit empty slides at chapter boundaries and rejects a mixed Report chapter', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n::: slidebreak\n:::\n\n# Empty edges\n\n::: slidebreak\n:::',
    ).document;
    let project = createDocumentProject(document);
    project = appendReportProjectChapter(project, {
      ...createBlankChapter(2, 'Second', 'slide'),
      document,
    });
    expect(splitDocumentPages(assembleDocumentProject(project))).toHaveLength(
      6,
    );
    project.chapters[1].document.type = 'report';
    expect(() => validateDocumentProject(project)).toThrow('reportOnly');
  });
});
