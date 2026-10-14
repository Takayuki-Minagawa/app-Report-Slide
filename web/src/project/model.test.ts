import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import { DocumentValidationError } from '@/src/document/validation';
import { figureReferences } from '@/src/document/figure-edit';
import {
  readerSupplementForPage,
  readReaderSupplements,
  setReaderSupplement,
  unassignedReaderSupplements,
} from '@/src/document/reader-supplement';
import { exportReportHtml } from '@/src/export/report-html';
import { importHtml } from '@/src/workspace/html-import';
import { prepareChapter } from './assets';
import {
  assembleReportProject,
  createBlankChapter,
  createReportProject,
  isLocalProjectImage,
  resolveProjectPath,
  safeProjectPath,
  validateReportProject,
  appendReportProjectChapter,
  updateReportProjectDocument,
} from './model';

function referencedReport(title: string, referenceTitle: string) {
  const document = parseMarkdown(
    `# ${title}\n\n![Original](https://example.com/original.png)`,
  ).document;
  document.metadata.figure_references = [
    {
      id: 'paper',
      title: referenceTitle,
      authors: 'Author',
      year: '2026',
      url: `https://example.com/${referenceTitle}`,
    },
  ];
  const figure = document.children[1];
  if (figure.type !== 'figure') throw new Error('Expected figure');
  figure.attrs.figureEdit = {
    version: 1,
    source: {
      referenceId: 'paper',
      origin: 'original',
      pdfPage: '4',
      printedPage: '12',
      figureNumber: '2',
      note: 'Evidence',
    },
  };
  document.metadata = setReaderSupplement(document, 0, {
    title: `${title} details`,
    text: `${title} conditions`,
    link: `https://example.com/${title}`,
  });
  return document;
}

function project() {
  const result = createReportProject(
    parseMarkdown('# First\n{#sec:first}\n\n[@sec:second]').document,
  );
  result.metadata.number_sections = true;
  result.metadata.toc = true;
  const next = createBlankChapter(2);
  next.document = parseMarkdown('# Second\n{#sec:second}').document;
  result.chapters.push(next);
  return result;
}

describe('report projects', () => {
  it('preserves distinct same-ID references from imported chapters and shares later edits by the resolved ID', async () => {
    const first = referencedReport('First', 'first-paper');
    let source = createReportProject(first);
    source = appendReportProjectChapter(source, {
      ...createBlankChapter(2),
      document: referencedReport('Second', 'other-paper'),
    });
    const references = figureReferences(source.metadata);
    expect(references).toHaveLength(2);
    expect(references[0].id).toBe('paper');
    expect(references[1].id).not.toBe('paper');
    const secondFigure = source.chapters[1].document.children[1];
    if (secondFigure.type !== 'figure') throw new Error('Expected figure');
    expect(secondFigure.attrs.figureEdit?.source?.referenceId).toBe(
      references[1].id,
    );
    const edited = structuredClone(source.chapters[1].document);
    edited.metadata.figure_references = references.map((reference) =>
      reference.id === 'paper'
        ? { ...reference, title: 'Corrected title' }
        : reference,
    );
    source = updateReportProjectDocument(source, source.chapters[1].id, edited);
    expect(
      figureReferences(source.chapters[0].document.metadata)[0].title,
    ).toBe('Corrected title');
    expect(figureReferences(source.metadata)[1].title).toBe('other-paper');
    const before = JSON.stringify(source);
    const assembled = assembleReportProject(source);
    expect(readerSupplementForPage(assembled, 0)?.text).toBe(
      'First conditions',
    );
    expect(readerSupplementForPage(assembled, 1)?.text).toBe(
      'Second conditions',
    );
    expect(readReaderSupplements(assembled.metadata).pages[1].pageId).toBe(
      `${source.chapters[1].id}:${source.chapters[1].document.children[0].attrs.nodeId}`,
    );
    const exported = await exportReportHtml(assembled, new Map(), 'ja');
    expect(exported.html).toContain('Corrected title');
    expect(exported.html).toContain('other-paper');
    expect(exported.html).toContain('First conditions');
    expect(exported.html).toContain('Second conditions');
    expect(JSON.stringify(source)).toBe(before);
  });

  it('reuses identical references and preserves every supplement when chapters share a page', async () => {
    let source = createReportProject(referencedReport('First', 'shared-paper'));
    source = appendReportProjectChapter(source, {
      ...createBlankChapter(2),
      pageBreakBefore: false,
      document: referencedReport('Second', 'shared-paper'),
    });
    expect(figureReferences(source.metadata)).toHaveLength(1);
    const assembled = assembleReportProject(source);
    expect(splitDocumentPages(assembled)).toHaveLength(1);
    const exported = await exportReportHtml(assembled, new Map(), 'ja');
    expect(exported.html).toContain('First conditions');
    expect(exported.html).toContain('Second conditions');
    expect(exported.html).toContain('https://example.com/First');
    expect(exported.html).toContain('https://example.com/Second');
    source.chapters[0].enabled = false;
    const remaining = assembleReportProject(source);
    expect(readerSupplementForPage(remaining, 0)?.text).toBe(
      'Second conditions',
    );
    expect(readReaderSupplements(remaining.metadata).pages).toHaveLength(1);
  });

  it('keeps chapter supplements on surviving content and retains notes whose complete page was removed', async () => {
    let source = createReportProject(referencedReport('First', 'shared-paper'));
    source = appendReportProjectChapter(source, {
      ...createBlankChapter(2),
      document: referencedReport('Second', 'shared-paper'),
    });
    const firstChapter = source.chapters[0];
    const secondChapter = source.chapters[1];
    // Delete just the first chapter title, retaining the figure that belongs to its notes.
    firstChapter.document.children.shift();
    let assembled = assembleReportProject(source);
    const firstNotes = readerSupplementForPage(assembled, 0);
    expect(firstNotes?.text).toBe('First conditions');
    expect(firstNotes?.anchorIds).toEqual([
      `${firstChapter.id}:${firstChapter.document.children[0].attrs.nodeId}`,
    ]);
    expect(firstNotes?.pageId).toBe(firstNotes?.anchorIds?.[0]);
    expect(unassignedReaderSupplements(assembled)).toEqual([]);

    // Removing all original content must not attach its conditions to the neighbouring chapter.
    firstChapter.document.children = [];
    assembled = assembleReportProject(source);
    const orphan = unassignedReaderSupplements(assembled)[0];
    expect(orphan).toMatchObject({
      text: 'First conditions',
      link: 'https://example.com/First',
      orphaned: true,
    });
    expect(
      orphan.anchorIds?.every((id) => id.startsWith(`${firstChapter.id}:`)),
    ).toBe(true);
    const secondPageIndex = splitDocumentPages(assembled).findIndex((nodes) =>
      nodes.some((node) =>
        node.attrs.nodeId.startsWith(`${secondChapter.id}:`),
      ),
    );
    expect(readerSupplementForPage(assembled, secondPageIndex)?.text).toBe(
      'Second conditions',
    );
    expect(readReaderSupplements(assembled.metadata).pages).toHaveLength(2);
    const exported = await exportReportHtml(assembled, new Map(), 'ja');
    expect(exported.html).toContain('Second conditions');
    // The editable HTML payload also retains the detached original for explicit reassignment.
    expect(
      unassignedReaderSupplements(importHtml(exported.html).document),
    ).toEqual([orphan]);
  });
  it('numbers references and the TOC across chapters in configured order', () => {
    const source = project();
    const assembled = assembleReportProject(source);
    expect(splitDocumentPages(assembled)).toHaveLength(2);
    let analysis = analyzeDocument(assembled);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.labels.get('sec:second')?.number).toBe('2');
    source.chapters.reverse();
    analysis = analyzeDocument(assembleReportProject(source));
    expect(analysis.labels.get('sec:second')?.number).toBe('1');
    expect(analysis.outline.map((entry) => entry.title)).toEqual([
      'Second',
      'First',
    ]);
  });

  it('excludes chapters without removing their source and diagnoses missing references', () => {
    const source = project();
    source.chapters[1].enabled = false;
    const analysis = analyzeDocument(assembleReportProject(source));
    expect(source.chapters).toHaveLength(2);
    expect(analysis.outline).toHaveLength(1);
    expect(analysis.diagnostics).toHaveLength(1);
    source.chapters[0].enabled = false;
    expect(assembleReportProject(source).children).toHaveLength(1);
  });

  it('retains explicit empty pages and permits chapters to continue on the same page', () => {
    const source = project();
    source.chapters[1].pageBreakBefore = false;
    expect(splitDocumentPages(assembleReportProject(source))).toHaveLength(1);
    source.chapters[0].document = parseMarkdown(
      '::: pagebreak\n:::\n\n# First\n\n::: pagebreak\n:::',
    ).document;
    expect(splitDocumentPages(assembleReportProject(source))).toHaveLength(3);
  });

  it('keeps input metadata and JSON IDs intact during validation and assembly', () => {
    const source = project();
    source.chapters[0].document.metadata.custom = { nested: ['preserve'] };
    const before = JSON.stringify(source);
    validateReportProject(source);
    assembleReportProject(source);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('keeps repeated image filenames separate without rewriting chapter-local editor IDs', () => {
    const doc = parseMarkdown('# Image\n\n![A](same.png)').document;
    const source = createReportProject(doc);
    const first = prepareChapter(
      source.chapters[0],
      new Map([['same.png', 'blob:first']]),
    );
    source.chapters[0] = first.chapter;
    const chapter = { ...createBlankChapter(2), document: doc };
    const second = prepareChapter(
      chapter,
      new Map([['same.png', 'blob:second']]),
    );
    source.chapters.push(second.chapter);
    expect(() => validateReportProject(source)).not.toThrow();
    expect([...first.assets.keys()][0]).not.toBe([...second.assets.keys()][0]);
    const images = assembleReportProject(source).children.filter(
      (node) => node.type === 'figure',
    );
    expect(images.map((node) => node.attrs.src)).toEqual([
      [...first.assets.keys()][0],
      [...second.assets.keys()][0],
    ]);
    expect(doc.children[1].attrs.src).toBe('same.png');
    expect(second.chapter.document.children[0].attrs.nodeId).toBe(
      first.chapter.document.children[0].attrs.nodeId,
    );
  });

  it('namespaces all nested IDs only in assembled output and permits IDs shared by chapters', () => {
    const document = parseMarkdown(
      '# Same\n\n- item with ![inline](image.png)\n\n> quoted\n\n| A | B |\n| --- | --- |\n| C | D |',
    ).document;
    const source = createReportProject(document);
    source.chapters.push({
      ...createBlankChapter(2),
      document: structuredClone(document),
    });
    const before = structuredClone(source);
    const nodeIds = (nodes: typeof document.children) =>
      [...walkDocumentTree(nodes)].flatMap((node) =>
        'attrs' in node && 'nodeId' in node.attrs
          ? [String(node.attrs.nodeId)]
          : [],
      );
    expect(() => validateReportProject(source)).not.toThrow();
    const assembled = assembleReportProject(source);
    const ids = nodeIds(assembled.children);
    expect(new Set(ids).size).toBe(ids.length);
    for (const chapter of source.chapters) {
      for (const id of nodeIds(chapter.document.children)) {
        expect(ids).toContain(`${chapter.id}:${id}`);
      }
    }
    expect(assembleReportProject(source)).toEqual(assembled);
    expect(source).toEqual(before);
    expect(
      analyzeDocument(assembled).outline.map((entry) => entry.nodeId),
    ).toEqual(
      source.chapters.map(
        (chapter) => `${chapter.id}:${document.children[0].attrs.nodeId}`,
      ),
    );
  });

  it('normalizes image lookup and classification without rewriting external URLs', () => {
    const source = createReportProject(
      parseMarkdown(
        '![Local](image.png)\n\n![Remote](https://example.com/image.png)',
      ).document,
    );
    source.chapters[0].document.children[0].attrs.src = ' image.png ';
    source.chapters[0].document.children[1].attrs.src =
      ' https://example.com/image.png ';
    const prepared = prepareChapter(
      source.chapters[0],
      new Map([['image.png', 'blob:local']]),
    );
    expect([...prepared.assets.values()]).toEqual(['blob:local']);
    expect(prepared.chapter.document.children[1].attrs.src).toBe(
      ' https://example.com/image.png ',
    );
    expect(isLocalProjectImage(' https://example.com/image.png ')).toBe(false);
    expect(isLocalProjectImage(' /image.png ')).toBe(false);
    expect(resolveProjectPath('chapters/one.md', ' ../images/image.png ')).toBe(
      'images/image.png',
    );
  });

  it('rejects slides, duplicate manifest paths and duplicate IDs within one chapter', () => {
    expect(() =>
      createReportProject(
        parseMarkdown('---\ntype: slide\n---\n# Slide').document,
      ),
    ).toThrow('reportOnly');
    const source = project();
    const duplicate = structuredClone(source);
    duplicate.chapters[0].document.children.push(
      duplicate.chapters[0].document.children[0],
    );
    expect(() => validateReportProject(duplicate)).toThrow(
      DocumentValidationError,
    );
    source.chapters[1].file = source.chapters[0].file.toUpperCase();
    expect(() => validateReportProject(source)).toThrow('invalidArchive');
  });

  it.each([
    '../outside.md',
    '/root.md',
    'C:/root.md',
    'a/../b.md',
    '__proto__/x.md',
    'CON.md',
    'a\\b.md',
    'a/b.md ',
    'a/b:md',
  ])('rejects unsafe archive paths: %s', (path) => {
    expect(() => safeProjectPath(path)).toThrow('unsafePath');
  });

  it('resolves chapter-relative and encoded image paths without escaping the project', () => {
    expect(resolveProjectPath('chapters/one.md', '../images/日本 語.png')).toBe(
      'images/日本 語.png',
    );
    expect(resolveProjectPath('chapters/one.md', '../images/a%20b.png')).toBe(
      'images/a b.png',
    );
    expect(() =>
      resolveProjectPath('chapters/one.md', '../../outside.png'),
    ).toThrow('unsafePath');
    expect(() =>
      resolveProjectPath('chapters/one.md', '%2Foutside.png'),
    ).toThrow('unsafePath');
  });
});
