import { BorderStyle, type ITableBordersOptions } from 'docx';
import {
  inlineText,
  type DocumentNode,
  type TableNode,
} from '@/src/document/model';
import type { ResolvedReportStyle } from '@/src/document/report-style';
import { hex } from './styles';

/** Full-width characters count as two columns, as they occupy in a monospace grid. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    width +=
      code >= 0x1100 &&
      (code <= 0x115f ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe4f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x20000 && code <= 0x3fffd))
        ? 2
        : 1;
  }
  return width;
}

function cellText(nodes: DocumentNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'paragraph' || node.type === 'heading'
        ? inlineText(node.content)
        : '',
    )
    .join(' ');
}

export interface TableGrid {
  /** Column index of every cell, by node id. */
  positions: Map<string, number>;
  /** Column widths in twips; their sum never exceeds `available`. */
  widths: number[];
}

/**
 * Widths saved in the document are kept in proportion. Without any, each column
 * is sized by its longest cell, within a minimum and a maximum share, so a
 * column of short numbers does not take as much room as a column of remarks.
 */
export function tableGrid(node: TableNode, available: number): TableGrid {
  const occupied: number[] = [];
  const sizes: Array<number | undefined> = [];
  const longest: number[] = [];
  const positions = new Map<string, number>();
  node.content.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while ((occupied[column] ?? 0) > rowIndex) column++;
      const span = cell.attrs.colspan ?? 1;
      positions.set(cell.attrs.nodeId, column);
      const length = displayWidth(cellText(cell.content)) / span;
      for (let offset = 0; offset < span; offset++) {
        const width = cell.attrs.colwidth?.[offset];
        if (width) sizes[column + offset] = width;
        occupied[column + offset] = rowIndex + (cell.attrs.rowspan ?? 1);
        longest[column + offset] = Math.max(
          longest[column + offset] ?? 0,
          length,
        );
      }
      column += span;
    }
  });
  const count = occupied.length;
  const pixels = available / 15;
  let widths: number[];
  if (sizes.some((size) => size !== undefined)) {
    const fallback = pixels / count;
    widths = Array.from(
      { length: count },
      (_, index) => sizes[index] ?? fallback,
    );
  } else {
    // Two characters of padding; no column below 8% or above 60% of the weight.
    const weights = Array.from(
      { length: count },
      (_, index) => (longest[index] ?? 0) + 2,
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const bounded = weights.map((weight) =>
      Math.min(Math.max(weight, total * 0.08), total * 0.6),
    );
    const sum = bounded.reduce((value, weight) => value + weight, 0);
    widths = bounded.map((weight) => (pixels * weight) / sum);
  }
  const total = widths.reduce((sum, width) => sum + width, 0);
  const scale = Math.min(15, available / total);
  return {
    positions,
    widths: widths.map((width) => Math.round(width * scale)),
  };
}

/** Table-wide rules from the style; a cell's own border still takes precedence. */
export function tableBorders(
  style: ResolvedReportStyle,
): ITableBordersOptions | undefined {
  if (style.table.border_width === null) return undefined;
  const line =
    style.table.border_width === 0
      ? { style: BorderStyle.NONE, size: 0, color: 'auto' }
      : {
          style: BorderStyle.SINGLE,
          // Eighths of a point.
          size: Math.max(2, Math.round(style.table.border_width * 8)),
          color: hex(style.table.border_color),
        };
  return {
    top: line,
    bottom: line,
    left: line,
    right: line,
    insideHorizontal: line,
    insideVertical: line,
  };
}
