import { z } from 'zod';
import type { FigureNode } from './model';
export const designRoles = [
  'title',
  'heading',
  'body',
  'table',
  'caption',
  'lead',
  'figureLabel',
  'source',
  'conclusion',
  'note',
] as const;
export const roleStyleSchema = z.strictObject({
  size: z.number().min(8).max(72),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  lineHeight: z.number().min(1).max(2.5),
  spaceBefore: z.number().min(0).max(64),
  spaceAfter: z.number().min(0).max(64),
});
export const roleStylesSchema = z.partialRecord(
  z.enum(designRoles),
  roleStyleSchema,
);
export type RoleStyle = z.infer<typeof roleStyleSchema>;
export const paletteSchema = z.strictObject({
  background: z.string().regex(/^#[0-9a-f]{6}$/i),
  ink: z.string().regex(/^#[0-9a-f]{6}$/i),
  accent: z.string().regex(/^#[0-9a-f]{6}$/i),
  tint: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const spacingSchema = z.strictObject({
  horizontal: z.number().min(0).max(120),
  vertical: z.number().min(0).max(100),
  gap: z.number().min(0).max(64),
  lineHeight: z.number().min(1).max(2.5),
});
/** Raster and external SVG labels stay intact; structured labels and overlays can be restyled safely. */
export function figureWithLabelStyle(
  node: FigureNode,
  style: RoleStyle | undefined,
): FigureNode {
  const edit = node.attrs.figureEdit;
  if (!style || !edit) return node;
  return {
    ...node,
    attrs: {
      ...node.attrs,
      figureEdit: {
        ...edit,
        ...(edit.diagram
          ? {
              diagram: {
                ...edit.diagram,
                shapes: edit.diagram.shapes.map((shape) => ({
                  ...shape,
                  fontSize: style.size,
                  textColor: style.color,
                  textLineHeight: style.lineHeight,
                })),
                connections: edit.diagram.connections.map((edge) => ({
                  ...edge,
                  labelColor: style.color,
                  labelFontSize: style.size,
                })),
              },
            }
          : {}),
        ...(edit.annotations
          ? {
              annotations: edit.annotations.map((annotation) => ({
                ...annotation,
                color: style.color,
                fontSize: Math.max(
                  1,
                  Math.min(
                    12,
                    style.size /
                      (Math.min(
                        edit.imageSize?.width ?? 900,
                        edit.imageSize?.height ?? 500,
                      ) /
                        100),
                  ),
                ),
              })),
            }
          : {}),
      },
    },
  };
}
