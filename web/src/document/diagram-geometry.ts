import { arrangeRectangles, type Arrangement } from './arrange';
import { createNodeId } from './model';
import type {
  Diagram,
  DiagramConnection,
  DiagramEndpoint,
  DiagramShape,
} from './diagram';

export interface DiagramPoint {
  x: number;
  y: number;
}
export interface DiagramBounds extends DiagramPoint {
  width: number;
  height: number;
}
const round = (value: number) => Math.round(value * 10000) / 10000;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function expandedDiagramSelection(
  diagram: Diagram,
  selected: readonly string[],
): string[] {
  const groups = new Set(
    diagram.shapes
      .filter((shape) => selected.includes(shape.id) && shape.groupId)
      .map((shape) => shape.groupId),
  );
  return [
    ...new Set([
      ...selected,
      ...diagram.shapes
        .filter((shape) => shape.groupId && groups.has(shape.groupId))
        .map((shape) => shape.id),
    ]),
  ];
}
export function diagramSelectionBounds(
  diagram: Diagram,
  selected: readonly string[],
): DiagramBounds | undefined {
  const shapes = diagram.shapes.filter((shape) => selected.includes(shape.id));
  if (!shapes.length) return undefined;
  const x = Math.min(...shapes.map((shape) => shape.x));
  const y = Math.min(...shapes.map((shape) => shape.y));
  return {
    x,
    y,
    width: round(Math.max(...shapes.map((shape) => shape.x + shape.width)) - x),
    height: round(
      Math.max(...shapes.map((shape) => shape.y + shape.height)) - y,
    ),
  };
}
export function moveDiagramSelection(
  diagram: Diagram,
  selection: readonly string[],
  dx: number,
  dy: number,
): Diagram {
  const selected = expandedDiagramSelection(diagram, selection);
  const shapes = diagram.shapes.filter((shape) => selected.includes(shape.id));
  if (shapes.some((shape) => shape.locked)) return diagram;
  const bounds = diagramSelectionBounds(diagram, selected);
  let moveX = dx;
  let moveY = dy;
  if (bounds) {
    moveX = clamp(dx, -bounds.x, 100 - bounds.x - bounds.width);
    moveY = clamp(dy, -bounds.y, 100 - bounds.y - bounds.height);
  }
  // A free line moves as one object, including at the canvas edge.
  const freePoints = diagram.connections
    .filter((edge) => selected.includes(edge.id) && !edge.locked)
    .flatMap((edge) => [edge.start, edge.end])
    .filter(
      (end): end is Extract<DiagramEndpoint, { type: 'point' }> =>
        end.type === 'point',
    );
  if (freePoints.length) {
    moveX = clamp(
      moveX,
      -Math.min(...freePoints.map((point) => point.x)),
      100 - Math.max(...freePoints.map((point) => point.x)),
    );
    moveY = clamp(
      moveY,
      -Math.min(...freePoints.map((point) => point.y)),
      100 - Math.max(...freePoints.map((point) => point.y)),
    );
  }
  const point = (end: DiagramEndpoint): DiagramEndpoint =>
    end.type === 'point'
      ? {
          type: 'point',
          x: round(clamp(end.x + moveX, 0, 100)),
          y: round(clamp(end.y + moveY, 0, 100)),
        }
      : end;
  return {
    ...diagram,
    shapes: diagram.shapes.map((shape) =>
      selected.includes(shape.id)
        ? { ...shape, x: round(shape.x + moveX), y: round(shape.y + moveY) }
        : shape,
    ),
    connections: diagram.connections.map((edge) =>
      selected.includes(edge.id) && !edge.locked
        ? { ...edge, start: point(edge.start), end: point(edge.end) }
        : edge,
    ),
  };
}
export function resizeDiagramSelection(
  diagram: Diagram,
  selection: readonly string[],
  width: number,
  height: number,
): Diagram {
  const selected = expandedDiagramSelection(diagram, selection);
  const shapes = diagram.shapes.filter((shape) => selected.includes(shape.id));
  const bounds = diagramSelectionBounds(diagram, selected);
  if (!bounds || shapes.some((shape) => shape.locked)) return diagram;
  const sx = clamp(
    width / bounds.width,
    Math.max(...shapes.map((shape) => 2 / shape.width)),
    (100 - bounds.x) / bounds.width,
  );
  const sy = clamp(
    height / bounds.height,
    Math.max(...shapes.map((shape) => 2 / shape.height)),
    (100 - bounds.y) / bounds.height,
  );
  return {
    ...diagram,
    shapes: diagram.shapes.map((shape) =>
      selected.includes(shape.id)
        ? {
            ...shape,
            x: round(bounds.x + (shape.x - bounds.x) * sx),
            y: round(bounds.y + (shape.y - bounds.y) * sy),
            width: round(shape.width * sx),
            height: round(shape.height * sy),
          }
        : shape,
    ),
  };
}
function center(shape: DiagramShape): DiagramPoint {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}
function endpointCenter(diagram: Diagram, end: DiagramEndpoint): DiagramPoint {
  if (end.type === 'point') return end;
  const shape = diagram.shapes.find((item) => item.id === end.shapeId);
  return shape ? center(shape) : { x: 0, y: 0 };
}
function attach(
  diagram: Diagram,
  end: DiagramEndpoint,
  opposite: DiagramPoint,
): DiagramPoint {
  if (end.type === 'point') return { x: end.x, y: end.y };
  const shape = diagram.shapes.find((item) => item.id === end.shapeId);
  if (!shape) return { x: 0, y: 0 };
  const mid = center(shape);
  const fixed = {
    top: { x: mid.x, y: shape.y },
    right: { x: shape.x + shape.width, y: mid.y },
    bottom: { x: mid.x, y: shape.y + shape.height },
    left: { x: shape.x, y: mid.y },
  };
  if (end.side !== 'auto') return fixed[end.side];
  const dx = opposite.x - mid.x;
  const dy = opposite.y - mid.y;
  if (dx === 0 && dy === 0) return fixed.right;
  const fraction =
    shape.kind === 'ellipse'
      ? 1 /
        Math.sqrt(
          (dx / (shape.width / 2)) ** 2 + (dy / (shape.height / 2)) ** 2,
        )
      : 1 /
        Math.max(
          Math.abs(dx) / (shape.width / 2),
          Math.abs(dy) / (shape.height / 2),
        );
  return { x: mid.x + dx * fraction, y: mid.y + dy * fraction };
}
export function diagramConnectionPoints(
  diagram: Diagram,
  edge: DiagramConnection,
): { start: DiagramPoint; end: DiagramPoint } {
  return {
    start: attach(diagram, edge.start, endpointCenter(diagram, edge.end)),
    end: attach(diagram, edge.end, endpointCenter(diagram, edge.start)),
  };
}
export function removeDiagramSelection(
  diagram: Diagram,
  selection: readonly string[],
): Diagram {
  const selected = expandedDiagramSelection(diagram, selection);
  const removed = new Set(
    diagram.shapes
      .filter((shape) => selected.includes(shape.id) && !shape.locked)
      .map((shape) => shape.id),
  );
  return {
    ...diagram,
    shapes: diagram.shapes.filter((shape) => !removed.has(shape.id)),
    connections: diagram.connections.filter(
      (edge) =>
        !(selected.includes(edge.id) && !edge.locked) &&
        ![edge.start, edge.end].some(
          (end) => end.type === 'shape' && removed.has(end.shapeId),
        ),
    ),
  };
}
export function duplicateDiagramSelection(
  diagram: Diagram,
  selection: readonly string[],
): { diagram: Diagram; selected: string[] } {
  const selected = expandedDiagramSelection(diagram, selection);
  const ids = new Map(
    diagram.shapes
      .filter((shape) => selected.includes(shape.id))
      .map((shape) => [shape.id, createNodeId()]),
  );
  const groups = new Map<string, string>();
  const bounds = diagramSelectionBounds(diagram, selected);
  const dx = bounds ? Math.min(3, 100 - bounds.x - bounds.width) : 3;
  const dy = bounds ? Math.min(3, 100 - bounds.y - bounds.height) : 3;
  const shapes = diagram.shapes
    .filter((shape) => ids.has(shape.id))
    .map((shape) => {
      if (shape.groupId && !groups.has(shape.groupId))
        groups.set(shape.groupId, createNodeId());
      return {
        ...shape,
        id: ids.get(shape.id)!,
        name: `${shape.name.slice(0, 196)} コピー`,
        x: round(shape.x + dx),
        y: round(shape.y + dy),
        locked: false,
        ...(shape.groupId ? { groupId: groups.get(shape.groupId) } : {}),
      };
    });
  const connections = diagram.connections
    .filter(
      (edge) =>
        selected.includes(edge.id) ||
        [edge.start, edge.end].every(
          (end) => end.type === 'shape' && ids.has(end.shapeId),
        ),
    )
    .map((edge) => {
      const endpoint = (end: DiagramEndpoint): DiagramEndpoint =>
        end.type === 'shape'
          ? { ...end, shapeId: ids.get(end.shapeId) ?? end.shapeId }
          : {
              ...end,
              x: Math.min(100, end.x + 3),
              y: Math.min(100, end.y + 3),
            };
      return {
        ...edge,
        id: createNodeId(),
        name: `${edge.name.slice(0, 196)} コピー`,
        start: endpoint(edge.start),
        end: endpoint(edge.end),
        locked: false,
      };
    });
  return {
    diagram: {
      ...diagram,
      shapes: [...diagram.shapes, ...shapes],
      connections: [...diagram.connections, ...connections],
    },
    selected: [
      ...shapes.map((shape) => shape.id),
      ...connections.map((edge) => edge.id),
    ],
  };
}

export function arrangeDiagramSelection(
  diagram: Diagram,
  selection: readonly string[],
  command: Arrangement,
): Diagram {
  const selected = expandedDiagramSelection(diagram, selection);
  const positions = arrangeRectangles(
    diagram.shapes.filter((shape) => selected.includes(shape.id)),
    command,
  );
  if (!positions.size) return diagram;
  return {
    ...diagram,
    shapes: diagram.shapes.map((shape) =>
      positions.has(shape.id)
        ? { ...shape, ...positions.get(shape.id)! }
        : shape,
    ),
  };
}
