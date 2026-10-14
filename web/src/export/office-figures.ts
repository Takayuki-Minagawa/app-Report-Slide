import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server.browser';
import {
  FigureGraphic,
  resolveFigureGraphicSource,
} from '@/components/preview/figure-graphic';
import type { DocumentData, FigureNode } from '@/src/document/model';
import { readFigureEdit } from '@/src/document/figure-edit';
import { walkDocumentTree } from '@/src/document/traversal';
import { prepareRenderedFigureSvg, type OfficeImage } from './office-images';

export function officeFigureKey(node: FigureNode): string {
  const edit = readFigureEdit(node.attrs.figureEdit);
  return edit && (edit.svgSource || edit.crop || edit.annotations?.length)
    ? `kumi-figure:${node.attrs.nodeId}`
    : node.attrs.src;
}

/** Each figure gets its own rendition: two crops of the same source must not overwrite each other. */
export async function addOfficeFigureImages(
  document: DocumentData,
  images: Map<string, OfficeImage>,
): Promise<void> {
  for (const node of walkDocumentTree(document.children)) {
    if (node.type !== 'figure' || officeFigureKey(node) === node.attrs.src)
      continue;
    const original = images.get(node.attrs.src);
    const source = resolveFigureGraphicSource(node, original?.dataUrl);
    if (!source.src)
      throw new Error(
        `Figure source missing: ${node.attrs.alt || node.attrs.nodeId}`,
      );
    const markup = renderToStaticMarkup(
      createElement(FigureGraphic, {
        node,
        src: source.src,
        resolvedSource: source,
      }),
    );
    const parsed = new DOMParser().parseFromString(
      `<div>${markup}</div>`,
      'text/html',
    );
    let svg = parsed.querySelector('svg');
    const edit = readFigureEdit(node.attrs.figureEdit)!;
    const size = source.svg ??
      edit.imageSize ?? { width: original!.width, height: original!.height };
    let width = (size.width * (edit.crop?.width ?? 100)) / 100;
    let height = (size.height * (edit.crop?.height ?? 100)) / 100;
    if (!svg) {
      const image = parsed.querySelector('img');
      if (!image) throw new Error('Figure could not be rendered');
      svg = globalThis.document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg',
      );
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      const layer = globalThis.document.createElementNS(
        'http://www.w3.org/2000/svg',
        'image',
      );
      layer.setAttribute('href', image.getAttribute('src') ?? '');
      layer.setAttribute('width', String(width));
      layer.setAttribute('height', String(height));
      svg.appendChild(layer);
    }
    const box = svg.getAttribute('viewBox')?.split(/\s+/).map(Number);
    if (box?.length === 4 && box[2] > 0 && box[3] > 0) {
      width = box[2];
      height = box[3];
    }
    const scale = Math.min(2, 2400 / width, 2400 / height);
    svg.removeAttribute('style');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(Math.max(1, Math.round(width * scale))));
    svg.setAttribute('height', String(Math.max(1, Math.round(height * scale))));
    images.set(
      officeFigureKey(node),
      await prepareRenderedFigureSvg(
        new XMLSerializer().serializeToString(svg),
      ),
    );
  }
}
