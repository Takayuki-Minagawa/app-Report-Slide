import { expect, it } from 'vitest';
import { arrangeRectangles } from './arrange';
import { createStructuredDiagram } from './diagram';
import {
  arrangeDiagramSelection,
  diagramConnectionPoints,
} from './diagram-geometry';
it('distributes unequal widths by equal gaps while preserving outer extents', () => {
  const source = [
    { id: 'a', x: 5, y: 5, width: 10, height: 10 },
    { id: 'b', x: 22, y: 20, width: 20, height: 15 },
    { id: 'c', x: 70, y: 50, width: 25, height: 10 },
  ];
  const result = arrangeRectangles(source, 'horizontal');
  expect(result.get('a')?.x).toBe(5);
  expect(result.get('b')?.x).toBe(32.5);
  expect(result.get('c')?.x).toBe(70);
});
it('treats groups as rigid units and leaves locked units unchanged', () => {
  const source = [
    { id: 'a', groupId: 'g', x: 5, y: 5, width: 10, height: 10 },
    { id: 'b', groupId: 'g', x: 22, y: 20, width: 20, height: 15 },
    { id: 'c', x: 70, y: 50, width: 25, height: 10 },
    { id: 'locked', x: 0, y: 0, width: 10, height: 10, locked: true },
  ];
  const result = arrangeRectangles(source, 'top');
  expect(result.get('a')).toEqual({ x: 5, y: 5 });
  expect(result.get('b')).toEqual({ x: 22, y: 20 });
  expect(result.get('c')).toEqual({ x: 70, y: 5 });
  expect(result.has('locked')).toBe(false);
});
it('keeps diagram connections attached after alignment', () => {
  const diagram = createStructuredDiagram();
  diagram.shapes[1].y = 10;
  const next = arrangeDiagramSelection(
    diagram,
    diagram.shapes.map((shape) => shape.id),
    'top',
  );
  expect(next.shapes.map((shape) => shape.y)).toEqual([10, 10, 10]);
  expect(diagramConnectionPoints(next, next.connections[0]).start).toEqual({
    x: 27,
    y: 24,
  });
  expect(diagram.shapes[0].y).toBe(30);
});
