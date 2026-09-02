import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { analyzeDocument, splitDocumentPages } from './semantics';
import { migrateDocumentData, validateDocumentData } from './validation';

describe('semantic document analysis', () => {
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
