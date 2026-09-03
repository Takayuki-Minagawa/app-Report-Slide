import type { Editor } from '@tiptap/core';
import {
  mergeCells,
  selectedRect,
  splitCell,
  TableMap,
} from '@tiptap/pm/tables';
import { createNodeId } from '@/src/document/model';
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

function cloneBorder(border: TableBorder | null): TableBorder | null {
  return border === null ? null : { ...border };
}

function sameBorder(
  first: TableBorder | null | undefined,
  second: TableBorder | null | undefined,
): boolean {
  if (first === second) return true;
  if (!first || !second) return false;
  return (
    first.color === second.color &&
    first.style === second.style &&
    first.width === second.width
  );
}

function bordersOrNull(borders: TableCellBorders): TableCellBorders | null {
  return Object.keys(borders).length > 0 ? borders : null;
}

function touchesBoundary(
  cell: { left: number; top: number; right: number; bottom: number },
  boundary: { left: number; top: number; right: number; bottom: number },
  side: TableBorderSide,
): boolean {
  return (
    (side === 'top' && cell.top === boundary.top) ||
    (side === 'right' && cell.right === boundary.right) ||
    (side === 'bottom' && cell.bottom === boundary.bottom) ||
    (side === 'left' && cell.left === boundary.left)
  );
}

function presetSides(
  preset: TableBorderPreset,
  selection: { left: number; top: number; right: number; bottom: number },
  cell: { left: number; top: number; right: number; bottom: number },
): TableBorderSide[] {
  if (preset === 'all') return [...tableBorderSides];
  if (preset === 'outer') {
    return tableBorderSides.filter((side) =>
      touchesBoundary(cell, selection, side),
    );
  }
  if (preset === 'inner') {
    return tableBorderSides.filter(
      (side) => !touchesBoundary(cell, selection, side),
    );
  }
  return touchesBoundary(cell, selection, preset) ? [preset] : [];
}

function perimeterBorders(
  editor: Editor,
  selection: ReturnType<typeof selectedRect>,
): TableCellBorders | null {
  const borders: TableCellBorders = {};
  for (const side of tableBorderSides) {
    let expected: TableBorder | null | undefined;
    let hasExpected = false;
    for (const position of selection.map.cellsInRect(selection)) {
      const cell = selection.map.findCell(position);
      if (!touchesBoundary(cell, selection, side)) continue;
      const node = editor.state.doc.nodeAt(selection.tableStart + position);
      if (!node) return null;
      const border = cloneBorders(node.attrs.borders)[side];
      if (!hasExpected) {
        expected = border;
        hasExpected = true;
      } else if (!sameBorder(expected, border)) {
        return null;
      }
    }
    if (expected !== undefined) borders[side] = cloneBorder(expected);
  }
  return borders;
}

/** Returns true when merging would flatten different perimeter border settings. */
export function hasIncompatibleMergeBorders(editor: Editor): boolean {
  if (!editor.isActive('table')) return false;
  try {
    return perimeterBorders(editor, selectedRect(editor.state)) === null;
  } catch {
    return false;
  }
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

/** Merges selected cells while preserving their outer border configuration. */
export function mergeTableCellsPreservingBorders(editor: Editor): boolean {
  if (!editor.isActive('table')) return false;

  try {
    const selection = selectedRect(editor.state);
    const borders = perimeterBorders(editor, selection);
    if (borders === null) return false;
    return mergeCells(editor.state, (transaction) => {
      const tableStart = transaction.mapping.map(selection.tableStart);
      const table = transaction.doc.nodeAt(tableStart - 1);
      if (!table) return;
      const map = TableMap.get(table);
      const position =
        tableStart + map.map[selection.top * map.width + selection.left];
      const node = transaction.doc.nodeAt(position);
      if (!node) return;
      transaction.setNodeMarkup(position, undefined, {
        ...node.attrs,
        borders: bordersOrNull(borders),
      });
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: transaction.doc.toJSON().content,
      });
      editor.view.dispatch(transaction);
      editor.view.focus();
    });
  } catch {
    return false;
  }
}

/** Splits a merged cell and distributes its outer borders to the new perimeter. */
export function splitTableCellPreservingBorders(editor: Editor): boolean {
  if (!editor.isActive('table')) return false;

  try {
    const selection = selectedRect(editor.state);
    const sourcePosition = selection.map.cellsInRect(selection)[0];
    if (sourcePosition === undefined) return false;
    const sourceCell = selection.map.findCell(sourcePosition);
    const sourceNode = editor.state.doc.nodeAt(
      selection.tableStart + sourcePosition,
    );
    if (!sourceNode) return false;
    const sourceBorders = cloneBorders(sourceNode.attrs.borders);

    return splitCell(editor.state, (transaction) => {
      const tableStart = transaction.mapping.map(selection.tableStart);
      const table = transaction.doc.nodeAt(tableStart - 1);
      if (!table) return;
      const map = TableMap.get(table);
      for (const position of map.cellsInRect(sourceCell)) {
        const cell = map.findCell(position);
        const borders: TableCellBorders = {};
        for (const side of tableBorderSides) {
          const border = sourceBorders[side];
          if (border === undefined || !touchesBoundary(cell, sourceCell, side))
            continue;
          borders[side] = cloneBorder(border);
        }
        const absolutePosition = tableStart + position;
        const node = transaction.doc.nodeAt(absolutePosition);
        if (!node) continue;
        transaction.setNodeMarkup(absolutePosition, undefined, {
          ...node.attrs,
          nodeId: createNodeId(),
          borders: bordersOrNull(borders),
        });
        const paragraphPositions: number[] = [];
        transaction.doc.nodesBetween(
          absolutePosition + 1,
          absolutePosition + node.nodeSize - 1,
          (child, childPosition) => {
            if (child.type.name === 'paragraph')
              paragraphPositions.push(childPosition);
          },
        );
        for (const paragraphPosition of paragraphPositions) {
          const paragraph = transaction.doc.nodeAt(paragraphPosition);
          if (!paragraph) continue;
          transaction.setNodeMarkup(paragraphPosition, undefined, {
            ...paragraph.attrs,
            nodeId: createNodeId(),
          });
        }
      }
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: transaction.doc.toJSON().content,
      });
      editor.view.dispatch(transaction);
      editor.view.focus();
    });
  } catch {
    return false;
  }
}
