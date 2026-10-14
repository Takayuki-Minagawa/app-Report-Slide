import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentRenderer } from './document-renderer';
import { conceptDiagramSvg } from '@/src/document/figure-edit';
import type { DocumentData, FigureNode } from '@/src/document/model';

afterEach(cleanup);

function documentWithFigure(placed: boolean): DocumentData {
  return {
    schemaVersion: 2,
    type: placed ? 'slide' : 'report',
    metadata: {},
    children: [
      {
        type: 'figure',
        attrs: {
          nodeId: 'original-figure',
          src: 'missing-original.png',
          alt: '復元する図',
          title: null,
          width: 100,
          align: 'center',
          ...(placed
            ? { slidePlacement: { x: 10, y: 10, width: 80, height: 60 } }
            : {}),
        },
      },
    ],
  };
}

describe('figure display source recovery', () => {
  for (const placed of [false, true]) {
    it(`${placed ? 'positioned' : 'flow'}: retries a valid SVG replacement after its unchanged original image failed`, () => {
      const document = documentWithFigure(placed);
      const figure = document.children[0] as FigureNode;
      const view = render(<DocumentRenderer document={document} />);
      fireEvent.error(view.getByRole('img', { name: '復元する図' }));
      expect(view.queryByRole('img', { name: '復元する図' })).toBeNull();

      const replacement: DocumentData = {
        ...document,
        children: [
          {
            ...figure,
            attrs: {
              ...figure.attrs,
              figureEdit: { version: 1, svgSource: conceptDiagramSvg },
            },
          },
        ],
      };
      view.rerender(<DocumentRenderer document={replacement} />);
      const replaced = view.getByRole('img', { name: '復元する図' });
      expect(replaced.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
      expect((replacement.children[0] as FigureNode).attrs.src).toBe(
        'missing-original.png',
      );

      // A second failed SVG can also be corrected without replacing the original file.
      fireEvent.error(replaced);
      expect(view.queryByRole('img', { name: '復元する図' })).toBeNull();
      const corrected = structuredClone(replacement);
      (corrected.children[0] as FigureNode).attrs.figureEdit!.svgSource =
        conceptDiagramSvg.replace('状態1', '修正した図');
      view.rerender(<DocumentRenderer document={corrected} />);
      expect(
        decodeURIComponent(
          view.getByRole('img', { name: '復元する図' }).getAttribute('src')!,
        ),
      ).toContain('修正した図');
    });
  }

  it('renders a safe SVG replacement even when the original URL cannot be resolved', () => {
    const document = documentWithFigure(false);
    const figure = document.children[0] as FigureNode;
    figure.attrs.figureEdit = { version: 1, svgSource: conceptDiagramSvg };
    const view = render(
      <DocumentRenderer
        document={document}
        resolveImageUrl={() => 'javascript:invalid'}
      />,
    );
    expect(
      view.getByRole('img', { name: '復元する図' }).getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
  });
});
