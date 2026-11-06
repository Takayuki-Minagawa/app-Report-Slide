import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  analyzeDocument,
  reportOutline,
  splitDocumentPages,
} from './semantics';
import { migrateDocumentData, validateDocumentData } from './validation';

describe('semantic document analysis', () => {
  it('numbers chapters, skipped sections and appendix chapters without resetting on repeated appendix markers', () => {
    const document = parseMarkdown(
      '# Main\n{#main}\n\n### Detail\n{#detail}\n\n# Unnumbered\n{numbered=false}\n\n# Data\n{#appendix appendix=true}\n\n## Conditions\n{#conditions}\n\n# More\n{#more appendix=true}',
    ).document;
    document.metadata.number_sections = true;
    document.metadata.report_settings = { heading_numbering: 'chapter' };
    const analysis = analyzeDocument(document);
    expect(
      analysis.outline.map((entry) => [entry.number, entry.headingKind]),
    ).toEqual([
      ['1', 'chapter'],
      ['1.1.1', 'section'],
      [undefined, 'chapter'],
      ['A', 'appendix'],
      ['A.1', 'section'],
      ['B', 'appendix'],
    ]);
    expect(analysis.labels.get('main')?.referenceText).toBe('第1章');
    expect(analysis.labels.get('appendix')?.referenceText).toBe('付録 A');
  });

  it('derives chapter-caption boundaries independently of hidden heading numbers and skips explicit unnumbered headings', () => {
    const document = parseMarkdown(
      '![Before](before.svg)\n{#fig:before}\n\n# First\n\n![One](one.svg)\n{#fig:one}\n\n# Note\n{numbered=false}\n\n![Two](two.svg)\n{#fig:two}\n\n# Next\n\n![Three](three.svg)\n{#fig:three}\n\n$$\nx\n$$\n{#eq:x}',
    ).document;
    document.metadata.number_sections = false;
    document.metadata.report_settings = {
      heading_numbering: 'chapter',
      caption_numbering: 'chapter',
    };
    const analysis = analyzeDocument(document);
    expect(analysis.outline.every((entry) => entry.number === undefined)).toBe(
      true,
    );
    expect(
      ['fig:before', 'fig:one', 'fig:two', 'fig:three', 'eq:x'].map(
        (label) => analysis.labels.get(label)?.number,
      ),
    ).toEqual(['0.1', '1.1', '1.2', '2.1', '2.1']);
  });

  it('keeps continuous captions across chapters and only applies appendix mode to H1', () => {
    const document = parseMarkdown(
      '## Before\n{#before appendix=true}\n\n# First\n\n![One](one.svg)\n{#fig:one}\n\n# Appendix divider\n{appendix=true numbered=false}\n\n# Appendix\n{#app}\n\n![Two](two.svg)\n{#fig:two}',
    ).document;
    document.metadata.number_sections = true;
    document.metadata.report_settings = { heading_numbering: 'chapter' };
    const analysis = analyzeDocument(document);
    expect(analysis.labels.get('before')?.number).toBe('0.1');
    expect(analysis.labels.get('app')?.number).toBe('A');
    expect(analysis.labels.get('fig:two')?.number).toBe('2');
  });

  it('filters the report TOC without changing semantic targets or the legacy section scheme', () => {
    const document = parseMarkdown(
      '## Start\n{#start appendix=true}\n\n# Hidden\n{#hidden toc=false}\n\n## Shown\n\n### Deep',
    ).document;
    document.metadata.number_sections = true;
    document.metadata.report_settings = { toc_depth: 2 };
    const analysis = analyzeDocument(document);
    expect(analysis.labels.get('start')?.number).toBe('1.1');
    expect(analysis.labels.get('hidden')?.number).toBe('2');
    expect(
      reportOutline(document, analysis).map((entry) => entry.title),
    ).toEqual(['Start', 'Shown']);
    document.type = 'slide';
    document.metadata.report_settings = {
      heading_numbering: 'chapter',
      caption_numbering: 'chapter',
      toc_depth: 1,
    };
    const slideAnalysis = analyzeDocument(document);
    expect(slideAnalysis.labels.get('start')?.number).toBe('1.1');
    expect(reportOutline(document, slideAnalysis)).toHaveLength(4);
  });

  it('continues appendix lettering beyond Z', () => {
    const document = parseMarkdown(
      Array.from(
        { length: 27 },
        (_, index) =>
          `# Appendix ${index}\n${index === 0 ? '{appendix=true}' : ''}`,
      ).join('\n\n'),
    ).document;
    document.metadata.number_sections = true;
    document.metadata.report_settings = { heading_numbering: 'chapter' };
    expect(analyzeDocument(document).outline.at(-1)?.number).toBe('AA');
  });

  it('lets explicit heading numbering override the document default', () => {
    const document = parseMarkdown(
      '# One\n{numbered=true}\n\n# Two\n{numbered=false}\n\n# Three\n{numbered=true}',
    ).document;
    expect(
      analyzeDocument(document).outline.map((entry) => entry.number),
    ).toEqual(['1', undefined, '2']);
  });
  it('derives independent numbering and updates forward references after reordering', () => {
    const document = parseMarkdown(
      '---\ntype: report\nnumber_sections: true\n---\n\n## Start\n{#sec:start}\n\n[@fig:b]\n\n![a](a.svg)\n{#fig:a}\n\n![b](b.svg)\n{#fig:b}\n\n$$\nx\n$$\n{#eq:x}',
    ).document;
    let analysis = analyzeDocument(document);
    expect(analysis.labels.get('sec:start')?.number).toBe('1.1');
    expect(analysis.labels.get('fig:b')?.referenceText).toBe('図 2');
    expect(analysis.labels.get('eq:x')?.referenceText).toBe('式 1');
    const [figure] = document.children.splice(3, 1);
    document.children.splice(2, 0, figure);
    analysis = analyzeDocument(document);
    expect(analysis.labels.get('fig:b')?.referenceText).toBe('図 1');
    expect(analysis.diagnostics).toEqual([]);
    document.children[2].attrs.numbered = false;
    analysis = analyzeDocument(document);
    expect(analysis.labels.get('fig:b')?.number).toBeUndefined();
    expect(analysis.labels.get('fig:a')?.number).toBe('1');
  });

  it('diagnoses duplicate and missing labels without blocking saves', () => {
    const document = parseMarkdown(
      '[@fig:dup] [@fig:missing]\n\n![a](a.svg)\n{#fig:dup}\n\n![b](b.svg)\n{#fig:dup}',
    ).document;
    const analysis = analyzeDocument(document);
    expect(analysis.labels.has('fig:dup')).toBe(false);
    expect(analysis.diagnostics).toHaveLength(3);
    expect(() => validateDocumentData(document)).not.toThrow();
  });

  it('keeps legacy appearance and explicitly empty pages', () => {
    const document = parseMarkdown('![a](a.svg)\n\n$$\nx\n$$').document;
    expect(
      [...analyzeDocument(document).targets.values()].every(
        (target) => !target.number,
      ),
    ).toBe(true);
    const pages = splitDocumentPages(
      parseMarkdown(
        '::: pagebreak\n:::\n\n::: slidebreak\n:::\n\n---\n\n::: pagebreak\n:::',
      ).document,
    );
    expect(pages.map((page) => page.length)).toEqual([0, 0, 1, 0]);
    expect(pages[2][0].type).toBe('horizontalRule');
  });

  it('migrates v1 JSON without modifying original data and rejects future versions', () => {
    const legacy = {
      ...parseMarkdown('![a](a.svg)\n{width=65% align=right}').document,
      schemaVersion: 1,
    };
    const snapshot = JSON.stringify(legacy);
    const migrated = migrateDocumentData(legacy);
    expect(migrated).toEqual({ ...legacy, schemaVersion: 2 });
    expect(JSON.stringify(legacy)).toBe(snapshot);
    expect(() =>
      migrateDocumentData({ ...legacy, schemaVersion: 3 }),
    ).toThrow();
  });

  it('rejects invalid semantic attrs and nested breaks in JSON', () => {
    const document = parseMarkdown('# Heading').document;
    document.children[0].attrs.label = 'bad label';
    expect(() => validateDocumentData(document)).toThrow();
    document.children = [
      {
        type: 'blockquote',
        attrs: { nodeId: 'quote' },
        content: [{ type: 'pageBreak', attrs: { nodeId: 'break' } }],
      },
    ];
    expect(() => validateDocumentData(document)).toThrow();
  });
});
