import { z } from 'zod';
import { createNodeId, type FigureNode } from './model';

const coordinate = z.number().min(0).max(100);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const identifier = z.string().min(1).max(128);
export const diagramShapeSchema = z
  .object({
    id: identifier,
    name: z.string().max(200),
    kind: z.enum(['rectangle', 'ellipse', 'text']),
    x: coordinate,
    y: coordinate,
    width: z.number().min(2).max(100),
    height: z.number().min(2).max(100),
    text: z.string().max(2000),
    fill: z.union([color, z.literal('none')]),
    stroke: color,
    strokeWidth: z.number().min(0).max(12),
    fontSize: z.number().min(8).max(72),
    textColor: color.optional(),
    textLineHeight: z.number().min(1).max(2.5).optional(),
    locked: z.boolean(),
    groupId: identifier.optional(),
  })
  .strict()
  .refine(
    (shape) =>
      shape.x + shape.width <= 100.00001 && shape.y + shape.height <= 100.00001,
    '図形をキャンバス内に指定してください',
  );
export const diagramEndpointSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('point'), x: coordinate, y: coordinate }).strict(),
  z
    .object({
      type: z.literal('shape'),
      shapeId: identifier,
      side: z.enum(['auto', 'top', 'right', 'bottom', 'left']),
    })
    .strict(),
]);
export const diagramConnectionSchema = z
  .object({
    id: identifier,
    name: z.string().max(200),
    start: diagramEndpointSchema,
    end: diagramEndpointSchema,
    arrow: z.enum(['none', 'end', 'start', 'both']),
    color,
    strokeWidth: z.number().min(0.5).max(12),
    dash: z.enum(['solid', 'dashed']),
    label: z.string().max(300),
    labelColor: color.optional(),
    labelFontSize: z.number().min(8).max(72).optional(),
    locked: z.boolean(),
  })
  .strict();
export const diagramSchema = z
  .object({
    version: z.literal(1),
    width: z.number().min(320).max(2400),
    height: z.number().min(180).max(1800),
    shapes: z.array(diagramShapeSchema).max(200),
    connections: z.array(diagramConnectionSchema).max(300),
  })
  .strict()
  .superRefine((diagram, context) => {
    const all = [...diagram.shapes, ...diagram.connections];
    if (new Set(all.map((item) => item.id)).size !== all.length)
      context.addIssue({
        code: 'custom',
        message: '図形・接続線IDが重複しています',
      });
    const ids = new Set(diagram.shapes.map((shape) => shape.id));
    for (const edge of diagram.connections)
      for (const point of [edge.start, edge.end]) {
        if (point.type === 'shape' && !ids.has(point.shapeId))
          context.addIssue({
            code: 'custom',
            message: `接続先の図形がありません: ${point.shapeId}`,
          });
      }
  });
export type Diagram = z.infer<typeof diagramSchema>;
export type DiagramShape = z.infer<typeof diagramShapeSchema>;
export type DiagramConnection = z.infer<typeof diagramConnectionSchema>;
export type DiagramEndpoint = z.infer<typeof diagramEndpointSchema>;

export function createDiagramShape(
  kind: DiagramShape['kind'],
  index = 1,
): DiagramShape {
  const names = { rectangle: '矩形', ellipse: '楕円', text: 'テキスト' };
  return {
    id: createNodeId(),
    name: `${names[kind]} ${index}`,
    kind,
    x: 10,
    y: 15,
    width: 22,
    height: 22,
    text: kind === 'text' ? '説明' : '状態',
    fill: kind === 'text' ? 'none' : '#dbeafe',
    stroke: '#2563eb',
    strokeWidth: kind === 'text' ? 0 : 2,
    fontSize: 24,
    locked: false,
  };
}
export function createDiagramConnection(
  arrow: DiagramConnection['arrow'] = 'end',
  index = 1,
): DiagramConnection {
  return {
    id: createNodeId(),
    name: `${arrow === 'none' ? '線' : '矢印'} ${index}`,
    start: { type: 'point', x: 20, y: 60 },
    end: { type: 'point', x: 80, y: 60 },
    arrow,
    color: '#2563eb',
    strokeWidth: 3,
    dash: 'solid',
    label: '',
    locked: false,
  };
}
export function createStructuredDiagram(): Diagram {
  const shapes = [0, 1, 2].map((index) => ({
    ...createDiagramShape('rectangle', index + 1),
    x: 5 + index * 34,
    y: 30,
    width: 22,
    height: 28,
    text: `状態${index + 1}`,
    name: `状態${index + 1}`,
  }));
  const connections = [0, 1].map(
    (index): DiagramConnection => ({
      ...createDiagramConnection('end', index + 1),
      start: { type: 'shape', shapeId: shapes[index].id, side: 'auto' },
      end: { type: 'shape', shapeId: shapes[index + 1].id, side: 'auto' },
    }),
  );
  return { version: 1, width: 900, height: 500, shapes, connections };
}
export function createStructuredDiagramFigure(): FigureNode {
  return {
    type: 'figure',
    attrs: {
      nodeId: createNodeId(),
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
      alt: '部品を編集できる3状態の図解',
      title: null,
      width: 100,
      align: 'center',
      figureEdit: {
        version: 1,
        name: '構造化図解',
        diagram: createStructuredDiagram(),
        imageSize: { width: 900, height: 500 },
        source: {
          referenceId: '',
          origin: 'concept',
          pdfPage: '',
          printedPage: '',
          figureNumber: '',
          note: '実測値ではない',
        },
      },
    },
  };
}
