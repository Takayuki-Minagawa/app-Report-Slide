import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocumentPage } from '@/components/preview/document-page';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import {
  applySlideDesign,
  getSlidePageId,
  resolveSlideDesign,
  slideDesignStyle,
} from './slide-design';
import { figureWithLabelStyle, type RoleStyle } from './role-style';
import { createStructuredDiagramFigure } from './diagram';
import { diagramSvg } from './diagram-svg';
import { analyzeDocument } from './semantics';
import { validateDocumentData } from './validation';
const style: RoleStyle = {
  size: 21,
  color: '#123456',
  lineHeight: 1.7,
  spaceBefore: 3,
  spaceAfter: 7,
};
it('persists role, palette, spacing and named presets while keeping a page exception', () => {
  let document = parseMarkdown(
    '---\ntype: slide\n---\n# One\n\nLead text\n\n::: slidebreak\n:::\n\n# Two',
  ).document;
  document.children[1].attrs.blockLayout = { role: 'lead', name: 'Summary' };
  const design = {
    ...resolveSlideDesign(document, 0),
    roleStyles: { lead: style, figureLabel: style, source: style },
    palette: {
      background: '#ffffff',
      ink: '#222222',
      accent: '#336699',
      tint: '#eeeeee',
    },
    spacing: { horizontal: 50, vertical: 35, gap: 12, lineHeight: 1.4 },
  };
  document = {
    ...document,
    metadata: applySlideDesign(document, [getSlidePageId(document, 0)], design),
  };
  document.metadata.slide_presets = {
    version: 1,
    items: [{ id: 'style', name: 'Reading', design }],
  };
  const restored = parseMarkdown(serializeDocument(document)).document;
  expect(resolveSlideDesign(restored, 0)).toEqual(design);
  expect(resolveSlideDesign(restored, 1).roleStyles).toBeUndefined();
  expect(restored.children[1].attrs.blockLayout?.role).toBe('lead');
  expect(slideDesignStyle(design)).toMatchObject({
    '--role-lead-color': '#123456',
    '--slide-accent': '#336699',
  });
  const html = renderToStaticMarkup(
    <DocumentPage
      document={restored}
      nodes={restored.children.slice(0, 2)}
      analysis={analyzeDocument(restored)}
      locale="ja"
      index={0}
      count={2}
    />,
  );
  expect(html).toContain('data-role-styles="lead figureLabel source"');
  expect(html).toContain('data-block-role="lead"');
});
it('styles structured labels independently of their original colors without modifying canonical parts', () => {
  const figure = createStructuredDiagramFigure();
  const styled = figureWithLabelStyle(figure, style);
  expect(styled.attrs.figureEdit?.diagram?.shapes[0]).toMatchObject({
    textColor: '#123456',
    fontSize: 21,
    stroke: '#2563eb',
  });
  expect(styled.attrs.figureEdit?.diagram?.connections[0].color).toBe(
    '#2563eb',
  );
  expect(diagramSvg(styled.attrs.figureEdit!.diagram!)).toContain(
    'fill="#123456">状態1',
  );
  expect(figure.attrs.figureEdit?.diagram?.shapes[0].fontSize).toBe(24);
  validateDocumentData({
    schemaVersion: 2,
    type: 'slide',
    metadata: {},
    children: [styled],
  });
});
it('removing optional style overrides leaves valid serializable metadata', () => {
  const document = parseMarkdown('---\ntype: slide\n---\n# Page').document;
  const metadata = applySlideDesign(document, [getSlidePageId(document, 0)], {
    ...resolveSlideDesign(document, 0),
    roleStyles: undefined,
    palette: undefined,
    spacing: undefined,
  });
  expect(() => serializeDocument({ ...document, metadata })).not.toThrow();
});
