import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { analyzeDocument, splitDocumentPages } from '@/src/document/semantics';
import { prepareChapter } from './assets';
import {
  assembleReportProject,
  createBlankChapter,
  createReportProject,
  resolveProjectPath,
  safeProjectPath,
  validateReportProject,
} from './model';

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

  it('keeps repeated image filenames separate and resolves duplicate imported editor IDs', () => {
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
      source,
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
  });

  it('rejects slides, duplicate manifest paths and duplicate IDs', () => {
    expect(() =>
      createReportProject(
        parseMarkdown('---\ntype: slide\n---\n# Slide').document,
      ),
    ).toThrow('reportOnly');
    const source = project();
    source.chapters[1].document = source.chapters[0].document;
    expect(() => validateReportProject(source)).toThrow('duplicateNodeId');
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
