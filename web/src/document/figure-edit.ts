import { z } from 'zod';
import { pdfSourceSchema } from './pdf-source';
import { createNodeId, type DocumentMetadata, type FigureNode } from './model';
import { diagramSchema } from './diagram';
import { diagramSvg } from './diagram-svg';

const percentage = z.number().min(0).max(100);
export const figureCropSchema = z
  .object({
    x: percentage,
    y: percentage,
    width: z.number().min(1).max(100),
    height: z.number().min(1).max(100),
  })
  .strict()
  .refine(
    (value) => value.x + value.width <= 100 && value.y + value.height <= 100,
    '切り抜き範囲を原画像の中に指定してください',
  );
export const figureOrigins = [
  'original',
  'cropped',
  'redrawn',
  'concept',
] as const;
export const figureOriginLabels = {
  original: '原図',
  cropped: '一部切り抜き',
  redrawn: '再作図',
  concept: '概念図',
};
export const figureAnnotationSchema = z
  .object({
    id: z.string().min(1).max(128),
    kind: z.enum(['arrow', 'rectangle', 'text', 'number']),
    x: percentage,
    y: percentage,
    x2: percentage,
    y2: percentage,
    text: z.string().max(500),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    fontSize: z.number().min(1).max(12),
  })
  .strict();
export const figureEditSchema = z
  .object({
    version: z.literal(1),
    pdfSource: pdfSourceSchema.optional(),
    name: z.string().max(200).optional(),
    svgSource: z.string().min(1).max(1_000_000).optional(),
    diagram: diagramSchema.optional(),
    crop: figureCropSchema.optional(),
    imageSize: z
      .object({
        width: z.number().positive().max(100000),
        height: z.number().positive().max(100000),
      })
      .strict()
      .optional(),
    annotations: z.array(figureAnnotationSchema).max(100).optional(),
    source: z
      .object({
        referenceId: z.string().max(128),
        origin: z.enum(figureOrigins),
        pdfPage: z.string().max(40),
        printedPage: z.string().max(40),
        figureNumber: z.string().max(100),
        note: z.string().max(2000),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.annotations?.map((a) => a.id)).size ===
      (value.annotations?.length ?? 0),
    '注釈IDが重複しています',
  );
export const figureReferenceSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().max(1000),
    authors: z.string().max(1000),
    year: z.string().max(40),
    summary: z.string().max(10000).optional(),
    pdfUrl: z
      .string()
      .max(2000)
      .refine(
        (value) => !value || /^https?:\/\//i.test(value),
        'http/httpsのPDFリンクを指定してください',
      )
      .optional(),
    url: z
      .string()
      .max(2000)
      .refine(
        (value) => !value || /^https?:\/\//i.test(value),
        'http/httpsのリンクを指定してください',
      ),
  })
  .strict();
export const figureReferencesSchema = z
  .array(figureReferenceSchema)
  .max(1000)
  .refine(
    (value) =>
      new Set(value.map((reference) => reference.id)).size === value.length,
    '文献IDが重複しています',
  );
export type FigureEdit = z.infer<typeof figureEditSchema>;
export type FigureAnnotation = z.infer<typeof figureAnnotationSchema>;
export type FigureReference = z.infer<typeof figureReferenceSchema>;
export function readFigureEdit(value: unknown): FigureEdit | undefined {
  const result = figureEditSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
/** A structured diagram owns its content; an unrelated SVG source is kept as the external-source mode. */
export function editableFigureSvgSource(
  edit: FigureEdit | undefined,
): string | undefined {
  return edit?.diagram ? diagramSvg(edit.diagram) : edit?.svgSource;
}
export function figureReferences(
  metadata: DocumentMetadata,
): FigureReference[] {
  const parsed = figureReferencesSchema.safeParse(metadata.figure_references);
  return parsed.success ? parsed.data : [];
}
export function figureSourceText(
  edit: FigureEdit | undefined,
  references: FigureReference[],
): string {
  const source = edit?.source;
  if (!source) return '';
  const reference = references.find((entry) => entry.id === source.referenceId);
  return [
    figureOriginLabels[source.origin],
    reference
      ? [reference.authors, reference.year, reference.title]
          .filter(Boolean)
          .join('・')
      : source.referenceId,
    source.pdfPage && `PDF p.${source.pdfPage}`,
    source.printedPage && `掲載 p.${source.printedPage}`,
    source.figureNumber,
    source.note,
  ]
    .filter(Boolean)
    .join(' / ');
}
export const conceptDiagramSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 240"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="#2563eb"/></marker></defs><rect x="20" y="50" width="220" height="130" rx="14" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/><rect x="340" y="50" width="220" height="130" rx="14" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/><rect x="660" y="50" width="220" height="130" rx="14" fill="#dbeafe" stroke="#2563eb" stroke-width="3"/><g font-size="28" font-family="sans-serif" text-anchor="middle" fill="#172554"><text x="130" y="124">状態1</text><text x="450" y="124">状態2</text><text x="770" y="124">状態3</text></g><path d="M250 115 L325 115" stroke="#2563eb" stroke-width="4" marker-end="url(#arrow)"/><path d="M570 115 L645 115" stroke="#2563eb" stroke-width="4" marker-end="url(#arrow)"/></svg>`;
export function svgDataUrl(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}
export function createConceptFigure(): FigureNode {
  return {
    type: 'figure',
    attrs: {
      nodeId: createNodeId(),
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6t9sAAAAASUVORK5CYII=',
      alt: '3状態の模式図',
      title: null,
      width: 100,
      align: 'center',
      figureEdit: {
        version: 1,
        name: '3状態の模式図',
        svgSource: conceptDiagramSvg,
        imageSize: { width: 900, height: 240 },
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
