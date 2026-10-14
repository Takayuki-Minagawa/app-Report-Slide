import { describe, expect, it } from 'vitest';
import { createDefaultDocument, type DocumentData } from './model';
import {
  applySlideDesign,
  groupSlideDesignNodes,
  getSlidePageId,
  resolveSlideDesign,
  slideDesignSchema,
  slideDesignSettingsSchema,
  slideDesignStyle,
} from './slide-design';
import { validateDocumentData } from './validation';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';

function deck(): DocumentData {
  let id = 0;
  const document = createDefaultDocument('slide', () => `stable-${++id}`);
  document.children.push(
    { type: 'slideBreak', attrs: { nodeId: 'break-1' } },
    {
      type: 'heading',
      attrs: { nodeId: 'second', level: 1 },
      content: [{ type: 'text', text: 'Second page' }],
    },
    {
      type: 'paragraph',
      attrs: { nodeId: 'value' },
      content: [{ type: 'text', text: '42.75' }],
    },
  );
  return document;
}

describe('slide design metadata', () => {
  it('groups comparison headings and their paragraphs without modifying nodes', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n# Comparison\n\n## A\n\n42.75 kg\n\n## B\n\n38.10 kg',
    ).document;
    const before = JSON.stringify(document);
    const groups = groupSlideDesignNodes(document.children, 'comparison')!;
    expect(groups.title).toBe(document.children[0]);
    expect(groups.columns[0]).toEqual(document.children.slice(1, 3));
    expect(groups.columns[1]).toEqual(document.children.slice(3));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('groups the first flow figure with its explanation and leaves manual positions unchanged', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n# Figure\n\nExplanation\n\n![Result](image.svg)\n\nMore detail',
    ).document;
    const groups = groupSlideDesignNodes(document.children, 'figure-top')!;
    expect(groups.columns[0][0]).toBe(document.children[2]);
    expect(groups.columns[1]).toEqual([
      document.children[1],
      document.children[3],
    ]);
    const figure = document.children[2];
    if (figure.type !== 'figure') throw new Error('Expected figure');
    figure.attrs.slidePlacement = { x: 20, y: 20, width: 30, height: 40 };
    expect(groupSlideDesignNodes(document.children, 'figure-right')).toBeNull();
    expect(figure.attrs.slidePlacement).toEqual({
      x: 20,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('applies only the selected page and preserves all content, numeric values and IDs', () => {
    const document = deck();
    const original = JSON.stringify(document);
    const design = {
      ...resolveSlideDesign(document, 0),
      theme: 'technical' as const,
      layout: 'comparison' as const,
    };
    const result = {
      ...document,
      metadata: applySlideDesign(document, ['second'], design),
    };
    expect(result.children).toBe(document.children);
    expect(resolveSlideDesign(result, 0).theme).toBe('beamer-simple');
    expect(resolveSlideDesign(result, 1)).toEqual(design);
    expect(JSON.stringify(document)).toBe(original);
    expect(validateDocumentData(result)).toBe(result);
  });

  it('keeps a page design with its anchor when a page or content before the anchor is inserted', () => {
    const document = deck();
    const design = {
      ...resolveSlideDesign(document, 1),
      layout: 'key-number' as const,
    };
    const styled = {
      ...document,
      metadata: applySlideDesign(document, ['second'], design),
    };
    const shifted = {
      ...styled,
      children: [
        { type: 'paragraph' as const, attrs: { nodeId: 'new-page' } },
        { type: 'slideBreak' as const, attrs: { nodeId: 'new-break' } },
        ...styled.children.slice(0, 3),
        { type: 'paragraph' as const, attrs: { nodeId: 'intro' } },
        ...styled.children.slice(3),
      ],
    };
    expect(getSlidePageId(shifted, 2)).toBe('second');
    expect(resolveSlideDesign(shifted, 1).layout).toBe('standard');
    expect(resolveSlideDesign(shifted, 2).layout).toBe('key-number');
  });

  it('preserves per-page design through Markdown even though IDs are regenerated', () => {
    const document = deck();
    const design = {
      ...resolveSlideDesign(document, 0),
      theme: 'paper-light' as const,
      layout: 'table-focus' as const,
    };
    const styled = {
      ...document,
      metadata: applySlideDesign(document, ['second'], design),
    };
    const roundtrip = parseMarkdown(serializeDocument(styled)).document;
    expect(getSlidePageId(roundtrip, 1)).not.toBe('second');
    expect(resolveSlideDesign(roundtrip, 1)).toEqual(design);
    expect(resolveSlideDesign(roundtrip, 0).theme).toBe('beamer-simple');
    expect(validateDocumentData(roundtrip)).toBe(roundtrip);
  });

  it('refreshes Markdown page hints after page insertion so old indexes never move designs', () => {
    const document = deck();
    const design = {
      ...resolveSlideDesign(document, 1),
      layout: 'formula-focus' as const,
    };
    const styled = {
      ...document,
      metadata: applySlideDesign(document, ['second'], design),
    };
    styled.children = [
      { type: 'paragraph', attrs: { nodeId: 'inserted' } },
      { type: 'slideBreak', attrs: { nodeId: 'inserted-break' } },
      ...styled.children,
    ];
    const result = parseMarkdown(serializeDocument(styled)).document;
    expect(resolveSlideDesign(result, 1).layout).toBe('standard');
    expect(resolveSlideDesign(result, 2).layout).toBe('formula-focus');
  });

  it('supports leading, trailing and consecutive empty pages without duplicate IDs', () => {
    const document: DocumentData = {
      schemaVersion: 2,
      type: 'slide',
      metadata: {},
      children: [
        { type: 'slideBreak', attrs: { nodeId: 'a' } },
        { type: 'slideBreak', attrs: { nodeId: 'b' } },
      ],
    };
    const ids = [0, 1, 2].map((index) => getSlidePageId(document, index));
    expect(new Set(ids).size).toBe(3);
    const design = {
      ...resolveSlideDesign(document, 0),
      layout: 'cover' as const,
    };
    const styled = {
      ...document,
      metadata: applySlideDesign(document, ids, design),
    };
    const result = parseMarkdown(serializeDocument(styled)).document;
    expect(
      [0, 1, 2].map((index) => resolveSlideDesign(result, index).layout),
    ).toEqual(['cover', 'cover', 'cover']);
  });

  it('rejects unknown versions, injected CSS, duplicate page IDs and out-of-range type sizes', () => {
    const document = deck();
    const design = resolveSlideDesign(document, 0);
    expect(
      slideDesignSchema.safeParse({ ...design, theme: 'url(evil)' }).success,
    ).toBe(false);
    expect(
      slideDesignSchema.safeParse({
        ...design,
        typography: { ...design.typography, body: 3 },
      }).success,
    ).toBe(false);
    const entry = { pageId: 'a', pageIndex: 0, design };
    expect(
      slideDesignSettingsSchema.safeParse({ version: 1, pages: [entry, entry] })
        .success,
    ).toBe(false);
    expect(() =>
      validateDocumentData({
        ...document,
        metadata: { slide_design: { version: 2, pages: [] } },
      }),
    ).toThrow();
    expect(() =>
      parseMarkdown(
        '---\ntype: slide\nslide_design:\n  version: 9\n  pages: []\n---\n# Title',
      ),
    ).toThrow();
  });

  it('does not apply Slide designs to reports and emits scalable role sizes', () => {
    const report = createDefaultDocument();
    const design = resolveSlideDesign(deck(), 0);
    expect(applySlideDesign(report, [getSlidePageId(report, 0)], design)).toBe(
      report.metadata,
    );
    expect(slideDesignStyle(design)).toHaveProperty(
      '--slide-body-size',
      `${(18 / 920) * 100}cqw`,
    );
  });
});
