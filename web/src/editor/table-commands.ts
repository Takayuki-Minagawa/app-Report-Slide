import type { Editor } from '@tiptap/core';
import {
  CellSelection,
  mergeCells,
  selectedRect,
  splitCell,
  TableMap,
} from '@tiptap/pm/tables';
import { createNodeId, type DocumentType } from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';
import {
  isTableBorder,
  isTableCellBorders,
  maximumTableColumnWidth,
  tableBorderSides,
  type TableBorder,
  type TableBorderSide,
  type TableCellBorders,
} from '@/src/document/table';

export type TableBorderPreset = 'all' | 'outer' | 'inner' | TableBorderSide;

export type TableBorderMode = 'draw' | 'erase';

export type TableCellAlignment = 'left' | 'center' | 'right';

const minimumColumnWidth = 80;

function selectedColumnRange(editor: Editor) {
  if (
    !editor.isActive('table') ||
    !(editor.state.selection instanceof CellSelection)
  )
    return null;
  const selection = selectedRect(editor.state);
  return selection.right - selection.left >= 2 ? selection : null;
}

export function canDistributeSelectedColumns(editor: Editor): boolean {
  try {
    return selectedColumnRange(editor) !== null;
  } catch {
    return false;
  }
}

function currentColumnWidths(
  editor: Editor,
  selection: NonNullable<ReturnType<typeof selectedColumnRange>>,
): number[] {
  const tablePosition = selection.tableStart - 1;
  const tableDOM = editor.view.nodeDOM(tablePosition);
  const tableElement =
    tableDOM instanceof HTMLElement
      ? tableDOM.tagName === 'TABLE'
        ? tableDOM
        : tableDOM.querySelector('table')
      : null;
  const columns = tableElement?.querySelectorAll('colgroup > col');

  return Array.from({ length: selection.map.width }, (_, column) => {
    const rendered = columns?.[column]?.getBoundingClientRect().width;
    if (rendered && Number.isFinite(rendered))
      return Math.max(minimumColumnWidth, rendered);

    for (let row = 0; row < selection.map.height; row += 1) {
      const position = selection.map.map[row * selection.map.width + column];
      const cell = selection.table.nodeAt(position);
      const width = (cell?.attrs.colwidth as number[] | null)?.[
        column - selection.map.colCount(position)
      ];
      if (width && Number.isFinite(width))
        return Math.max(minimumColumnWidth, width);
    }
    return minimumColumnWidth;
  });
}

/** Equalizes the selected logical columns across every row, preserving their total width. */
export function distributeSelectedTableColumns(
  editor: Editor,
  documentType: DocumentType,
): boolean {
  try {
    const selection = selectedColumnRange(editor);
    if (!selection) return false;

    const widths = currentColumnWidths(editor, selection);
    const count = selection.right - selection.left;
    const total = Math.round(
      widths
        .slice(selection.left, selection.right)
        .reduce((sum, width) => sum + width, 0),
    );
    const base = Math.floor(total / count);
    const remainder = total % count;
    if (
      base < minimumColumnWidth ||
      base + (remainder > 0 ? 1 : 0) > maximumTableColumnWidth
    )
      return false;

    const updates = new Map<number, number[]>();
    for (let column = selection.left; column < selection.right; column += 1) {
      const width = base + (column - selection.left < remainder ? 1 : 0);
      for (let row = 0; row < selection.map.height; row += 1) {
        const position = selection.map.map[row * selection.map.width + column];
        const cell = selection.table.nodeAt(position);
        if (!cell) return false;
        const existing = cell.attrs.colwidth as number[] | null;
        const cellWidths =
          updates.get(position) ??
          (existing ? [...existing] : Array(cell.attrs.colspan).fill(0));
        cellWidths[column - selection.map.colCount(position)] = width;
        updates.set(position, cellWidths);
      }
    }

    const transaction = editor.state.tr;
    for (const [position, colwidth] of updates) {
      const absolutePosition = selection.tableStart + position;
      const cell = transaction.doc.nodeAt(absolutePosition);
      if (!cell) return false;
      const original = cell.attrs.colwidth as number[] | null;
      if (
        original &&
        original.every((width, index) => width === colwidth[index])
      )
        continue;
      transaction.setNodeMarkup(absolutePosition, undefined, {
        ...cell.attrs,
        colwidth,
      });
    }
    if (!transaction.docChanged) return false;
    validateDocumentData({
      schemaVersion: 2,
      type: documentType,
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

function selectedCellPositions(editor: Editor) {
  const selection = selectedRect(editor.state);
  return {
    tableStart: selection.tableStart,
    positions: selection.map.cellsInRect(selection),
  };
}

/** Returns the shared explicit alignment, or null for mixed/default cells. */
export function selectedTableCellAlignment(
  editor: Editor,
): TableCellAlignment | null {
  if (!editor.isActive('table')) return null;
  try {
    const { tableStart, positions } = selectedCellPositions(editor);
    if (positions.length === 0) return null;
    let shared: TableCellAlignment | null | undefined;
    for (const position of positions) {
      const cell = editor.state.doc.nodeAt(tableStart + position);
      if (!cell || !['tableCell', 'tableHeader'].includes(cell.type.name))
        return null;
      const alignment = cell.attrs.align as TableCellAlignment | null;
      if (shared !== undefined && shared !== alignment) return null;
      shared = alignment;
    }
    return shared ?? null;
  } catch {
    return null;
  }
}

/** Sets every selected cell in one undoable transaction. */
export function applyTableCellAlignment(
  editor: Editor,
  alignment: TableCellAlignment,
  documentType: DocumentType,
): boolean {
  if (!editor.isActive('table')) return false;
  try {
    const { tableStart, positions } = selectedCellPositions(editor);
    let transaction = editor.state.tr;
    for (const position of positions) {
      const absolutePosition = tableStart + position;
      const cell = transaction.doc.nodeAt(absolutePosition);
      if (
        !cell ||
        !['tableCell', 'tableHeader'].includes(cell.type.name) ||
        cell.attrs.align === alignment
      )
        continue;
      transaction = transaction.setNodeMarkup(absolutePosition, undefined, {
        ...cell.attrs,
        align: alignment,
      });
    }
    if (!transaction.docChanged) return false;
    validateDocumentData({
      schemaVersion: 2,
      type: documentType,
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
