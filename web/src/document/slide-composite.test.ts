import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DocumentPage } from '@/components/preview/document-page';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { analyzeDocument } from './semantics';
import {
  applySlideDesign,
  createSlideComposite,
  getSlidePageId,
  groupSlideCompositeNodes,
  resolveSlideDesign,
  slideCompositeSchema,
} from './slide-design';
import { slideNavigationPages } from './slide-navigation';
import { validateDocumentData } from './validation';

function example() {
  const document = parseMarkdown(
    '---\ntype: slide\n---\n# Evidence\n\n![Original](https://example.com/figure.png)\n\n| Method | Value |\n| --- | --- |\n| A | 42 |\n\nConditions: same soil\n\nConclusion: values differ',
  ).document;
  const composite = createSlideComposite(document.children);
  composite.assignments[0].name = '左側の原図';
  const design = {
    ...resolveSlideDesign(document, 0),
    layout: 'composite' as const,
    composite,
  };
  document.metadata = applySlideDesign(
    document,
    [getSlidePageId(document, 0)],
    design,
  );
  return document;
}

describe('composite slide regions', () => {
  it('keeps original figure/table/condition/conclusion intact while changing column width and order', () => {
    const document = example();
    const before = JSON.stringify(document.children);
    const design = resolveSlideDesign(document, 0);
    const composite = {
      ...design.composite!,
      leftWidth: 70,
      gap: 12,
      reverseColumns: true,
    };
    const groups = groupSlideCompositeNodes(document.children, composite);
    expect(groups.regions.left[0].type).toBe('figure');
    expect(groups.regions['right-top'][0].type).toBe('table');
    expect(groups.regions['right-bottom'][0].type).toBe('paragraph');
    expect(groups.regions.bottom[0].type).toBe('paragraph');
    expect(JSON.stringify(document.children)).toBe(before);
    document.metadata = applySlideDesign(
      document,
      [getSlidePageId(document, 0)],
      { ...design, composite },
    );
    expect(
      validateDocumentData(JSON.parse(JSON.stringify(document))).metadata,
    ).toEqual(document.metadata);
  });

  it('rebinds names and assignments on Markdown import, even after an inserted block shifts indexes', () => {
    const document = example();
    document.children.splice(1, 0, {
      type: 'paragraph',
      attrs: { nodeId: 'new' },
      content: [{ type: 'text', text: 'New context' }],
    });
    const roundtrip = parseMarkdown(serializeDocument(document)).document;
    const design = resolveSlideDesign(roundtrip, 0);
    const groups = groupSlideCompositeNodes(
      roundtrip.children,
      design.composite!,
    );
    expect(groups.regions.left[0].type).toBe('figure');
    expect(groups.regions['right-top'][0].type).toBe('table');
    expect(groups.regions.bottom).toHaveLength(2);
    expect(
      slideNavigationPages(roundtrip, 'ja')[0].elements.find(
        (entry) => entry.name === '左側の原図',
      )?.nodeId,
    ).toBe(groups.regions.left[0].attrs.nodeId);
    expect(design.composite!.assignments[0].nodeId).not.toBe(
      resolveSlideDesign(document, 0).composite!.assignments[0].nodeId,
    );
  });

  it('renders manual figures once at their canvas coordinates and new nodes visibly at the bottom', () => {
    const document = example();
    const figure = document.children.find((node) => node.type === 'figure')!;
    if (figure.type !== 'figure') throw new Error('Expected figure');
    figure.attrs.slidePlacement = { x: 5, y: 15, width: 40, height: 50 };
    document.children.push({
      type: 'paragraph',
      attrs: { nodeId: 'later' },
      content: [{ type: 'text', text: 'New visible block' }],
    });
    const groups = groupSlideCompositeNodes(
      document.children,
      resolveSlideDesign(document, 0).composite!,
    );
    expect(groups.regions.left).toHaveLength(0);
    expect(groups.manual).toEqual([figure]);
    expect(groups.regions.bottom.at(-1)?.attrs.nodeId).toBe('later');
    const html = renderToStaticMarkup(
      createElement(DocumentPage, {
        document,
        nodes: document.children,
        index: 0,
        count: 1,
        locale: 'ja',
        analysis: analyzeDocument(document),
      }),
    );
    expect(
      html.match(/class="preview-figure slide-positioned-figure"/g),
    ).toHaveLength(1);
    expect(html).toContain('New visible block');
    expect(html).toContain('left:5%;top:15%;width:40%;height:50%');
  });

  it('puts the visible left column before the right in the exported DOM after a swap', () => {
    const document = example();
    const design = resolveSlideDesign(document, 0);
    document.metadata = applySlideDesign(
      document,
      [getSlidePageId(document, 0)],
      { ...design, composite: { ...design.composite!, reverseColumns: true } },
    );
    const html = renderToStaticMarkup(
      createElement(DocumentPage, {
        document,
        nodes: document.children,
        index: 0,
        count: 1,
        locale: 'ja',
        analysis: analyzeDocument(document),
      }),
    );
    expect(html.indexOf('data-composite-region="right-top"')).toBeLessThan(
      html.indexOf('data-composite-region="left"'),
    );
    expect(html).toContain('aria-label="左上"');
  });

  it('rejects duplicate assignments and impossible proportions before saving', () => {
    const composite = resolveSlideDesign(example(), 0).composite!;
    expect(
      slideCompositeSchema.safeParse({ ...composite, leftWidth: 100 }).success,
    ).toBe(false);
    expect(
      slideCompositeSchema.safeParse({ ...composite, gap: -1 }).success,
    ).toBe(false);
    expect(
      slideCompositeSchema.safeParse({
        ...composite,
        assignments: [composite.assignments[0], composite.assignments[0]],
      }).success,
    ).toBe(false);
  });
});
