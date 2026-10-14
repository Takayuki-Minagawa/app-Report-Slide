import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Editor } from '@tiptap/core';
import { createEditorExtensions } from '@/src/editor/extensions';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { sanitizeSvgSource } from '@/src/security/svg-source';
import { FigureGraphic } from '@/components/preview/figure-graphic';
import { DocumentRenderer } from '@/components/preview/document-renderer';
import { validateDocumentData } from './validation';
import {
  createConceptFigure,
  figureEditSchema,
  figureReferencesSchema,
} from './figure-edit';
import type { DocumentData } from './model';

function sample(): DocumentData {
  const figure = createConceptFigure();
  figure.attrs.figureEdit = {
    ...figure.attrs.figureEdit!,
    crop: { x: 10, y: 20, width: 80, height: 60 },
    annotations: [
      {
        id: 'a',
        kind: 'arrow',
        x: 20,
        y: 30,
        x2: 70,
        y2: 50,
        text: '比較',
        color: '#dc2626',
        fontSize: 5,
      },
    ],
    source: {
      referenceId: 'paper1',
      origin: 'concept',
      pdfPage: '2',
      printedPage: '101',
      figureNumber: 'Fig. 1',
      note: '実測値ではない',
    },
  };
  return {
    schemaVersion: 2,
    type: 'slide',
    metadata: {
      figure_references: [
        {
          id: 'paper1',
          title: '調査結果',
          authors: '著者',
          year: '2026',
          url: 'https://example.org/paper',
        },
      ],
    },
    children: [figure],
  };
}

describe('editable figures', () => {
  it('preserves source, original image, crop, annotations and shared citations across Markdown and Tiptap editing', () => {
    const original = sample();
    expect(() => validateDocumentData(original)).not.toThrow();
    const markdown = serializeDocument(original);
    expect(markdown).toContain('figure_edit=');
    const imported = parseMarkdown(markdown).document;
    expect(imported.children[0].attrs.figureEdit).toEqual(
      original.children[0].attrs.figureEdit,
    );
    expect(imported.metadata.figure_references).toEqual(
      original.metadata.figure_references,
    );
    const editor = new Editor({
      extensions: createEditorExtensions({ onMathSelect: () => undefined }),
      content: { type: 'doc', content: imported.children },
    });
    try {
      expect(editor.getJSON().content?.[0].attrs?.figureEdit).toEqual(
        original.children[0].attrs.figureEdit,
      );
      editor.state.doc.check();
      const rendered = editor.getHTML();
      editor.commands.setContent(rendered);
      expect(editor.getJSON().content?.[0].attrs?.figureEdit).toEqual(
        original.children[0].attrs.figureEdit,
      );
      expect(editor.getJSON().content?.[0].attrs?.src).toBe(
        original.children[0].attrs.src,
      );
    } finally {
      editor.destroy();
    }
  });
  it('rejects invalid bounds, nonfinite coordinates, duplicate IDs and unsafe citation schemes', () => {
    expect(
      figureEditSchema.safeParse({
        version: 1,
        crop: { x: 50, y: 0, width: 60, height: 100 },
      }).success,
    ).toBe(false);
    expect(
      figureEditSchema.safeParse({
        version: 1,
        crop: { x: NaN, y: 0, width: 60, height: 100 },
      }).success,
    ).toBe(false);
    expect(
      figureReferencesSchema.safeParse([
        {
          id: 'x',
          title: '',
          authors: '',
          year: '',
          url: 'javascript:alert(1)',
        },
      ]).success,
    ).toBe(false);
    const figure = sample().children[0];
    if (figure.type !== 'figure') throw new Error('figure');
    expect(
      figureEditSchema.safeParse({
        ...figure.attrs.figureEdit,
        annotations: [
          ...figure.attrs.figureEdit!.annotations!,
          ...figure.attrs.figureEdit!.annotations!,
        ],
      }).success,
    ).toBe(false);
  });
  it('keeps edited SVG labels and arrows but removes executable and external elements from the display copy', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 240" onload="alert(1)"><defs><marker id="a"><path d="M0 0 L2 1"/></marker></defs><text>変更したラベル</text><path marker-start="url(\'#a\')" d="M0 0 L20 10"/><image href="https://example.org/track.png"/><script>alert(1)</script><rect fill="url(https://example.org/a.svg#a)" width="30" height="20"/></svg>';
    const cleaned = sanitizeSvgSource(svg);
    expect(cleaned.source).toContain('変更したラベル');
    expect(cleaned.source).toContain('marker-start=');
    expect(cleaned.source).not.toMatch(/onload|script|https:\/\/example/);
    expect(cleaned.changed).toBe(true);
    expect(cleaned.width).toBe(900);
  });
  it('renders crop as a viewBox and separate annotations without altering the stored source', () => {
    const figure = sample().children[0];
    if (figure.type !== 'figure') throw new Error('figure');
    const original = figure.attrs.src;
    const html = renderToStaticMarkup(
      <FigureGraphic node={figure} src={original} />,
    );
    expect(html).toContain('viewBox="90 48 720 144"');
    expect(html).toContain('data-annotation-id="a"');
    expect(html).toContain('比較');
    expect(figure.attrs.src).toBe(original);
    expect(original).toMatch(/^data:image\/png;base64,/);
  });
  it('updates all source captions from one shared reference record', () => {
    const document = sample();
    document.children.push({
      ...document.children[0],
      attrs: { ...document.children[0].attrs, nodeId: 'second' },
    } as (typeof document.children)[0]);
    let html = renderToStaticMarkup(<DocumentRenderer document={document} />);
    expect(html.match(/調査結果/g)).toHaveLength(2);
    (document.metadata.figure_references as { title: string }[])[0].title =
      '改訂した出典';
    html = renderToStaticMarkup(<DocumentRenderer document={document} />);
    expect(html.match(/改訂した出典/g)).toHaveLength(2);
  });
});
