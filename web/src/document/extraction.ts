import { z } from 'zod';
import {
  createNodeId,
  type DocumentNode,
  type ParagraphNode,
  type TableNode,
} from './model';

const rows = z.array(z.array(z.string().max(2000)).min(1).max(40)).max(200);
/** A reviewed snapshot stays with the original figure; later table edits do not rewrite evidence. */
export const extractionResultSchema = z
  .object({
    mode: z.enum(['text', 'table']),
    method: z.enum(['pdf-text', 'ocr']),
    text: z.string().max(100000),
    rawText: z.string().max(100000),
    rows,
    rawRows: rows,
    numericValues: z.array(z.array(z.number().nullable()).max(40)).max(200),
    header: z.boolean(),
    language: z.enum(['jpn+eng', 'jpn', 'eng']).optional(),
    confidence: z.number().min(0).max(100).optional(),
    warnings: z.array(z.string().max(2000)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    for (const matrix of [value.rows, value.rawRows]) {
      if (
        matrix.reduce((n, row) => n + row.length, 0) > 2000 ||
        matrix.some((row) => row.length !== matrix[0]?.length)
      )
        context.addIssue({
          code: 'custom',
          message: '表は同じ列数で2000セル以内にしてください。',
        });
    }
    if (
      value.numericValues.length !== value.rows.length ||
      value.numericValues.some((row, i) => row.length !== value.rows[i]?.length)
    )
      context.addIssue({
        code: 'custom',
        message: '数値候補と表の寸法が一致しません。',
      });
    if (value.mode === 'table' && value.rows.length === 0)
      context.addIssue({ code: 'custom', message: '表に1行以上必要です。' });
  });
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

function paragraph(text: string): ParagraphNode {
  return {
    type: 'paragraph',
    attrs: { nodeId: createNodeId() },
    content: text ? [{ type: 'text', text }] : [],
  };
}

/** Use literal text nodes: OCR results must never be interpreted as HTML or commands. */
export function extractionBlocks(
  input: ExtractionResult,
  referenceId?: string,
): DocumentNode[] {
  const value = extractionResultSchema.parse(input);
  if (value.mode === 'text') return value.text.split(/\r?\n/).map(paragraph);
  const table: TableNode = {
    type: 'table',
    attrs: { nodeId: createNodeId(), sourceReferenceId: referenceId ?? null },
    content: value.rows.map((row, r) => ({
      type: 'tableRow',
      attrs: { nodeId: createNodeId() },
      content: row.map((cell, c) => ({
        type: value.header && r === 0 ? 'tableHeader' : 'tableCell',
        attrs: {
          nodeId: createNodeId(),
          align: value.numericValues[r][c] === null ? 'left' : 'right',
          colspan: 1,
          rowspan: 1,
          colwidth: null,
        },
        content: [paragraph(cell)],
      })),
    })),
  };
  return [table];
}
