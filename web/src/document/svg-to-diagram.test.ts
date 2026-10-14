import { describe, expect, it } from 'vitest';
import { convertSvgToDiagram } from './svg-to-diagram';
import { diagramSvg } from './diagram-svg';
import {
  moveDiagramSelection,
  stackDiagramShapes,
  duplicateDiagramSelection,
} from './diagram-geometry';
import { figureEditSchema, createConceptFigure } from './figure-edit';
import { parseMarkdown } from '../markdown/parser';
import { serializeDocument } from '../markdown/serializer';
import type { FigureNode } from './model';
const svg = (body: string, attrs = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400" ${attrs}>${body}</svg>`;

describe('external SVG decomposition', () => {
  it('flattens transforms and inherited paint while preserving groups, text anchors and exact connections', () => {
    const converted = convertSvgToDiagram(
      svg(
        `<g transform="translate(40 20) scale(2)" style="fill:#def;stroke:navy;stroke-width:1"><rect id="box" x="10" y="10" width="60" height="40" rx="3"/><ellipse id="ball" cx="140" cy="30" rx="30" ry="20"/><text x="40" y="35" fill="black" stroke="none" font-size="12" text-anchor="middle">状態 A</text><line x1="70" y1="30" x2="110" y2="30"/></g>`,
      ),
    );
    expect(converted.editableParts).toBe(4);
    expect(converted.retainedParts).toBe(0);
    const [rectangle, ellipse, label] = converted.diagram.shapes;
    expect(rectangle).toMatchObject({
      x: 7.5,
      y: 10,
      width: 15,
      height: 20,
      fill: '#ddeeff',
      stroke: '#000080',
      strokeWidth: 2,
      cornerRadius: 6,
    });
    expect(ellipse.groupId).toBe(rectangle.groupId);
    expect(label).toMatchObject({
      text: '状態 A',
      fontSize: 24,
      textAnchor: 'middle',
      textBaseline: 'alphabetic',
    });
    const edge = converted.diagram.connections[0];
    expect(edge.start).toEqual({
      type: 'shape',
      shapeId: rectangle.id,
      side: 'right',
    });
    expect(edge.end).toEqual({
      type: 'shape',
      shapeId: ellipse.id,
      side: 'left',
    });
    expect(diagramSvg(converted.diagram)).toContain('x="120" y="90"');
    expect(
      moveDiagramSelection(converted.diagram, [rectangle.id], 5, 5).shapes[1].x,
    ).toBe(ellipse.x + 5);
  });
  it('keeps curves, rotated groups, gradients and overlap order as SVG fragments', () => {
    const converted = convertSvgToDiagram(
      svg(
        `<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><path id="curve" d="M20 20 C50 90 100 0 200 40" stroke="red"/><rect id="middle" x="100" y="50" width="200" height="100" fill="blue"/><g transform="rotate(25 100 100)"><circle cx="100" cy="100" r="30"/></g><rect x="300" y="50" width="150" height="100" fill="url(#g)"/>`,
      ),
    );
    expect(converted.editableParts).toBe(1);
    expect(converted.retainedParts).toBe(3);
    const rendered = diagramSvg(converted.diagram);
    expect(rendered).toContain('linearGradient');
    expect(rendered).toContain('rotate(25 100 100)');
    expect(rendered.indexOf('id="curve"')).toBeLessThan(
      rendered.indexOf('x="100" y="50"'),
    );
    expect(rendered.indexOf('rotate(25')).toBeGreaterThan(
      rendered.indexOf('x="100" y="50"'),
    );
    expect(rendered).toContain('fill="url(#g)"');
  });
  it('preserves viewBox offsets, referenced parts, and arbitrary line paths', () => {
    const result = convertSvgToDiagram(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 800 400"><rect id="reused" x="40" y="40" width="80" height="80"/><use href="#reused" x="200"/><path d="M150 100 L220 100" stroke="black"/><path d="M150 200 L200 250 L300 200" stroke="black"/></svg>',
    );
    expect(result.retainedParts).toBe(3);
    expect(result.diagram.connections[0].start).toEqual({
      type: 'point',
      x: 17.5,
      y: 20,
    });
    const output = diagramSvg(result.diagram);
    expect(output).toContain('id="reused"');
    expect(output).toContain('href="#reused"');
    expect(output).toContain('matrix(1 0 0 1 -10 -20)');
  });
  it('makes marker direction editable and reports standardized arrowheads', () => {
    const result = convertSvgToDiagram(
      svg(
        '<defs><marker id="a"><path d="M0 0L8 4L0 8Z"/></marker></defs><path d="M20 200 L700 200" stroke="blue" marker-start="url(#a)" marker-end="url(#a)"/>',
      ),
    );
    expect(result.diagram.connections[0].arrow).toBe('both');
    expect(result.warnings.join('')).toContain('標準三角形');
  });
  it('keeps advanced text positioning and scaled dash patterns intact', () => {
    const result = convertSvgToDiagram(
      svg(
        '<text x="100" y="100" textLength="200" lengthAdjust="spacingAndGlyphs">ABC</text><text x="100" y="150" rotate="30">ABC</text><text x="100" y="200" baseline-shift="super">ABC</text><text x="100" y="250" xml:space="preserve">A  B</text><text x="100" y="300" dominant-baseline="middle">ABC</text><line x1="20" y1="20" x2="100" y2="20" stroke="black" stroke-dasharray="8 5" stroke-dashoffset="3"/><line transform="scale(2)" x1="20" y1="20" x2="100" y2="20" stroke="black" stroke-dasharray="8 5"/>',
      ),
    );
    expect(result.editableParts).toBe(0);
    expect(result.retainedParts).toBe(7);
    const rendered = diagramSvg(result.diagram);
    expect(rendered).toContain('textLength="200"');
    expect(rendered).toContain('rotate="30"');
    expect(rendered).toContain('stroke-dashoffset="3"');
    expect(rendered).toContain('transform="scale(2)"');
  });
  it('does not silently approximate unsupported paint, units, tiny parts, opacity groups or tspan layout', () => {
    const result = convertSvgToDiagram(
      svg(
        '<g opacity="0.5"><rect x="20" y="20" width="100" height="100"/><rect x="40" y="40" width="100" height="100"/></g><rect x="20" y="20" width="50%" height="100"/><rect width="1" height="1"/><text x="20" y="30"><tspan dx="2">A</tspan></text>',
      ),
    );
    expect(result.editableParts).toBe(0);
    expect(result.retainedParts).toBe(4);
    expect(diagramSvg(result.diagram)).toContain('opacity="0.5"');
    const rootOpacity = convertSvgToDiagram(
      svg(
        '<rect x="20" y="20" width="100" height="100"/><rect x="40" y="40" width="100" height="100"/>',
        'opacity="0.5"',
      ),
    );
    expect(rootOpacity.retainedParts).toBe(1);
    expect(rootOpacity.editableParts).toBe(0);
    expect(
      rootOpacity.diagram.svgFragments![0].source.match(/opacity=/g),
    ).toHaveLength(1);
  });
  it('sanitizes conversion and subsequently imported fragment data', () => {
    const result = convertSvgToDiagram(
      svg(
        '<script>alert(1)</script><rect onload="alert(2)" x="20" y="20" width="100" height="100"/><image href="https://example.com/a.png"/>',
      ),
    );
    expect(result.editableParts).toBe(1);
    expect(result.previewSource).not.toMatch(/<script|onload/);
    result.diagram.svgFragments = [
      {
        source:
          '<g onclick="alert(3)"><script>alert(4)</script><path d="M0 0L20 20"/></g>',
        paintOrder: 2,
        name: 'untrusted',
      },
    ];
    expect(diagramSvg(result.diagram)).not.toMatch(/onclick|<script/);
  });
  it('keeps imported layer order editable and puts duplicates above retained parts', () => {
    const result = convertSvgToDiagram(
      svg(
        '<rect x="40" y="80" width="200" height="120" fill="blue"/><path id="foreground" d="M0 0Q200 300 500 0"/>',
      ),
    );
    const id = result.diagram.shapes[0].id;
    const front = diagramSvg(stackDiagramShapes(result.diagram, [id], 'front'));
    expect(front.indexOf('id="foreground"')).toBeLessThan(
      front.indexOf('x="40" y="80"'),
    );
    const back = diagramSvg(stackDiagramShapes(result.diagram, [id], 'back'));
    expect(back.indexOf('id="foreground"')).toBeGreaterThan(
      back.indexOf('x="40" y="80"'),
    );
    const duplicate = duplicateDiagramSelection(result.diagram, [id]);
    expect(duplicate.diagram.shapes[1].paintOrder).toBeGreaterThan(
      result.diagram.svgFragments![0].paintOrder,
    );
    const crossed = convertSvgToDiagram(
      svg(
        '<line x1="20" y1="100" x2="300" y2="100" stroke="black"/><rect x="40" y="80" width="200" height="120" fill="blue"/>',
      ),
    );
    const copied = duplicateDiagramSelection(crossed.diagram, [
      crossed.diagram.shapes[0].id,
      crossed.diagram.connections[0].id,
    ]);
    expect(copied.diagram.connections[1].paintOrder).toBeLessThan(
      copied.diagram.shapes[1].paintOrder!,
    );
  });
  it('avoids collisions between retained marker IDs and newly generated arrows', () => {
    const result = convertSvgToDiagram(
      svg(
        '<defs><marker id="diagram-arrow-0"><path d="M0 0L8 4L0 8Z"/></marker></defs><line x1="20" y1="100" x2="300" y2="100" stroke="black" marker-end="url(#diagram-arrow-0)"/>',
      ),
    );
    const rendered = new DOMParser().parseFromString(
      diagramSvg(result.diagram),
      'image/svg+xml',
    );
    const markers = Array.from(rendered.querySelectorAll('marker')).map(
      (marker) => marker.id,
    );
    expect(new Set(markers).size).toBe(markers.length);
    expect(rendered.querySelector('line')?.getAttribute('marker-end')).not.toBe(
      'url(#diagram-arrow-0)',
    );
  });
  it('does not crash rendering when imported fragment JSON contains malformed XML', () => {
    const result = convertSvgToDiagram(
      svg('<rect x="40" y="80" width="200" height="120" fill="blue"/>'),
    );
    result.diagram.svgFragments = [
      { source: '<g', paintOrder: 2, name: 'broken' },
    ];
    const rendered = diagramSvg(result.diagram);
    expect(rendered).toContain('保持SVG');
    expect(rendered).toContain('x="40" y="80"');
    expect(result.diagram.svgFragments[0].source).toBe('<g');
  });
  it('allows internal use but removes external use and hostile fragment resources', () => {
    const result = convertSvgToDiagram(
      svg(
        '<defs><rect id="symbol" width="50" height="50"/></defs><use href="#symbol"/><use href="https://example.com/remote.svg#symbol"/><path d="M0 0Q200 300 500 0"/>',
      ),
    );
    expect(result.previewSource).toContain('href="#symbol"');
    expect(result.previewSource).not.toContain('https://');
    const rendered = diagramSvg({
      ...result.diagram,
      svgDefinitions:
        '<defs><image href="https://example.com/tracker.png"/></defs>',
    });
    expect(rendered).not.toContain('tracker');
  });
  it('round-trips original source, SVG fragments and editable parts', () => {
    const figure = createConceptFigure();
    const source = svg(
      '<rect x="30" y="30" width="200" height="100"/><path d="M0 0 Q100 100 200 0"/>',
    );
    figure.attrs.figureEdit = {
      version: 1,
      svgSource: source,
      diagram: convertSvgToDiagram(source).diagram,
    };
    expect(figureEditSchema.safeParse(figure.attrs.figureEdit).success).toBe(
      true,
    );
    const saved = parseMarkdown(
      serializeDocument({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: [figure],
      }),
    ).document;
    expect((saved.children[0] as FigureNode).attrs.figureEdit).toEqual(
      figure.attrs.figureEdit,
    );
  });
});
