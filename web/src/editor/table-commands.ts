import type { Editor } from '@tiptap/core';
import { selectedRect } from '@tiptap/pm/tables';
import { validateDocumentData } from '@/src/document/validation';
import {
  isTableBorder,
  isTableCellBorders,
  tableBorderSides,
  type TableBorder,
  type TableBorderSide,
  type TableCellBorders,
} from '@/src/document/table';

export type TableBorderPreset = 'all' | 'outer' | 'inner' | TableBorderSide;

export type TableBorderMode = 'draw' | 'erase';

const oppositeSide: Record<TableBorderSide, TableBorderSide> = {
  top: 'bottom',
  right: 'left',
  bottom: 'top',
  left: 'right',
};

function cloneBorders(value: unknown): TableCellBorders {
  if (!isTableCellBorders(value)) return {};
  return Object.fromEntries(
    tableBorderSides.flatMap((side) => {
      const border = value[side];
      if (border === undefined) return [];
      return [[side, border === null ? null : { ...border }]];
    }),
  );
}

function presetSides(
  preset: TableBorderPreset,
  selection: { left: number; top: number; right: number; bottom: number },
  cell: { left: number; top: number; right: number; bottom: number },
): TableBorderSide[] {
  if (preset === 'all') return [...tableBorderSides];
  if (preset === 'outer') {
    return tableBorderSides.filter(
      (side) =>
        (side === 'top' && cell.top === selection.top) ||
        (side === 'right' && cell.right === selection.right) ||
        (side === 'bottom' && cell.bottom === selection.bottom) ||
        (side === 'left' && cell.left === selection.left),
    );
  }
  if (preset === 'inner') {
    return tableBorderSides.filter(
      (side) =>
        (side === 'top' && cell.top > selection.top) ||
        (side === 'right' && cell.right < selection.right) ||
        (side === 'bottom' && cell.bottom < selection.bottom) ||
        (side === 'left' && cell.left > selection.left),
    );
  }
  return [preset];
}

function neighbouringCells(
  map: ReturnType<typeof selectedRect>['map'],
  cell: { left: number; top: number; right: number; bottom: number },
  side: TableBorderSide,
): number[] {
  const positions: number[] = [];
  if (side === 'top' && cell.top > 0) {
    for (let column = cell.left; column < cell.right; column += 1)
      positions.push(map.map[(cell.top - 1) * map.width + column]);
  }
  if (side === 'right' && cell.right < map.width) {
    for (let row = cell.top; row < cell.bottom; row += 1)
      positions.push(map.map[row * map.width + cell.right]);
  }
  if (side === 'bottom' && cell.bottom < map.height) {
    for (let column = cell.left; column < cell.right; column += 1)
      positions.push(map.map[cell.bottom * map.width + column]);
  }
  if (side === 'left' && cell.left > 0) {
    for (let row = cell.top; row < cell.bottom; row += 1)
      positions.push(map.map[row * map.width + cell.left - 1]);
  }
  return [...new Set(positions)];
}

/** Applies a shared edge to both adjoining cells, including a selected range boundary. */
export function applyTableBorders(
  editor: Editor,
  preset: TableBorderPreset,
  mode: TableBorderMode,
  border: TableBorder,
): boolean {
  if (!editor.isActive('table') || (mode === 'draw' && !isTableBorder(border)))
    return false;

  try {
    const selection = selectedRect(editor.state);
    const updates = new Map<number, TableCellBorders>();
    const value = mode === 'erase' ? null : { ...border };
    const setSide = (position: number, side: TableBorderSide) => {
      const node = editor.state.doc.nodeAt(selection.tableStart + position);
      if (!node || !['tableCell', 'tableHeader'].includes(node.type.name))
        return;
      const borders = updates.get(position) ?? cloneBorders(node.attrs.borders);
      borders[side] = value;
      updates.set(position, borders);
    };

    for (const position of selection.map.cellsInRect(selection)) {
      const cell = selection.map.findCell(position);
      for (const side of presetSides(preset, selection, cell)) {
        setSide(position, side);
        for (const neighbour of neighbouringCells(selection.map, cell, side)) {
          if (neighbour !== position) setSide(neighbour, oppositeSide[side]);
        }
      }
    }
    if (updates.size === 0) return false;

    let transaction = editor.state.tr;
    for (const [position, borders] of updates) {
      const absolutePosition = selection.tableStart + position;
      const node = transaction.doc.nodeAt(absolutePosition);
      if (!node) continue;
      transaction = transaction.setNodeMarkup(absolutePosition, undefined, {
        ...node.attrs,
        borders,
      });
    }
    validateDocumentData({
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: transaction.doc.toJSON().content,
    });
    editor.view.dispatch(transaction);
    editor.view.focus();
    return true;
  } catch {
    return false;
  }
}
