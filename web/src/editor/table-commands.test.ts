import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';

import { validateDocumentData } from '@/src/document/validation';

import { createEditorExtensions } from './extensions';
import {
  applyTableCellAlignment,
  applyTableBorders,
  canDistributeSelectedColumns,
  distributeSelectedTableColumns,
  hasIncompatibleMergeBorders,
  mergeTableCellsPreservingBorders,
  selectedTableCellAlignment,
  splitTableCellPreservingBorders,
} from './table-commands';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(withHeaderRow = true, columns = 2): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { nodeId: 'initial' } }],
    },
  });
  editor.commands.insertTable({ rows: 2, cols: columns, withHeaderRow });
  return editor;
}

function tableContext(current: Editor) {
  let position = -1;
  current.state.doc.descendants((node, nodePosition) => {
    if (node.type.name === 'table') position = nodePosition;
  });
  const table = current.state.doc.nodeAt(position);
  if (!table) throw new Error('table expected');
  return {
    map: TableMap.get(table),
    tableStart: position + 1,
  };
}

function selectCells(current: Editor, anchor: number, head = anchor): void {
  const { map, tableStart } = tableContext(current);
  current.view.dispatch(
    current.state.tr.setSelection(
      CellSelection.create(
        current.state.doc,
        tableStart + map.map[anchor],
        tableStart + map.map[head],
      ),
    ),
  );
}

function tableJson(current: Editor) {
  const table = current
    .getJSON()
    .content?.find((node) => node.type === 'table');
  if (!table) throw new Error('table JSON expected');
  return table as {
    content: Array<{
      content: Array<{ attrs: Record<string, unknown> }>;
    }>;
  };
}

function setColumnWidths(current: Editor, widths: number[]): void {
  const { map, tableStart } = tableContext(current);
  const transaction = current.state.tr;
  for (const position of new Set(map.map)) {
    const cell = transaction.doc.nodeAt(tableStart + position);
    if (!cell) throw new Error('cell expected');
    const firstColumn = map.colCount(position);
    transaction.setNodeMarkup(tableStart + position, undefined, {
      ...cell.attrs,
      colwidth: widths.slice(firstColumn, firstColumn + cell.attrs.colspan),
    });
  }
  current.view.dispatch(transaction);
}

describe('advanced table commands', () => {
  it('caps a dragged column width before it reaches document serialization', () => {
    const current = createEditor();
    const { map, tableStart } = tableContext(current);
    const position = tableStart + map.map[0];
    const cell = current.state.doc.nodeAt(position);
    if (!cell) throw new Error('cell expected');
    current.view.dispatch(
      current.state.tr.setNodeMarkup(position, undefined, {
        ...cell.attrs,
        colwidth: [4_500],
      }),
    );

    expect(tableJson(current).content[0].content[0].attrs.colwidth).toEqual([
      4_000,
    ]);
    expect(() =>
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: current.getJSON().content ?? [],
      }),
    ).not.toThrow();
  });

  it('distributes only selected columns across all rows and preserves their total', () => {
    const current = createEditor(true, 3);
    setColumnWidths(current, [120, 180, 300]);
    selectCells(current, 0, 1);

    expect(canDistributeSelectedColumns(current)).toBe(true);
    expect(distributeSelectedTableColumns(current, 'report')).toBe(true);
    for (const row of tableJson(current).content) {
      expect(row.content.map((cell) => cell.attrs.colwidth)).toEqual([
        [150],
        [150],
        [300],
      ]);
    }
    expect(distributeSelectedTableColumns(current, 'report')).toBe(false);
  });

  it('updates the correct width slot in a merged cell', () => {
    const current = createEditor(true, 3);
    selectCells(current, 0, 1);
    expect(current.commands.mergeCells()).toBe(true);
    setColumnWidths(current, [120, 180, 300]);
    selectCells(current, 4, 5);

    expect(distributeSelectedTableColumns(current, 'report')).toBe(true);
    expect(
      tableJson(current).content[0].content.map((cell) => cell.attrs.colwidth),
    ).toEqual([[120, 240], [240]]);
    expect(
      tableJson(current).content[1].content.map((cell) => cell.attrs.colwidth),
    ).toEqual([[120], [240], [240]]);
  });

  it('requires a multi-column cell selection before distributing widths', () => {
    const current = createEditor();
    selectCells(current, 0);

    expect(canDistributeSelectedColumns(current)).toBe(false);
    expect(distributeSelectedTableColumns(current, 'report')).toBe(false);
    expect(tableJson(current).content[0].content[0].attrs.colwidth).toBeNull();
  });

  it.each(['left', 'center', 'right'] as const)(
    'aligns all selected cells %s without changing other cells',
    (alignment) => {
      const current = createEditor();
      selectCells(current, 0, 1);

      expect(applyTableCellAlignment(current, alignment, 'report')).toBe(true);
      expect(selectedTableCellAlignment(current)).toBe(alignment);
      expect(
        tableJson(current).content[0].content.map((cell) => cell.attrs.align),
      ).toEqual([alignment, alignment]);
      expect(
        tableJson(current).content[1].content.map((cell) => cell.attrs.align),
      ).toEqual([null, null]);
      expect(applyTableCellAlignment(current, alignment, 'report')).toBe(false);
    },
  );

  it('updates a mixed selection even when its anchor is already aligned', () => {
    const current = createEditor();
    selectCells(current, 0);
    expect(applyTableCellAlignment(current, 'center', 'report')).toBe(true);
    selectCells(current, 0, 1);
    expect(selectedTableCellAlignment(current)).toBeNull();

    expect(applyTableCellAlignment(current, 'center', 'report')).toBe(true);
    expect(
      tableJson(current).content[0].content.map((cell) => cell.attrs.align),
    ).toEqual(['center', 'center']);
  });

  it('aligns Slide table cells when the document contains a placed image', () => {
    const current = createEditor();
    current.commands.setContent({
      type: 'doc',
      content: [
        ...(current.getJSON().content ?? []),
        {
          type: 'figure',
          attrs: {
            nodeId: 'placed-image',
            src: 'assets/diagram.png',
            alt: 'Diagram',
            title: null,
            width: 100,
            align: 'center',
            slidePlacement: { x: 12, y: 18, width: 40, height: 30 },
          },
        },
      ],
    });
    selectCells(current, 0, 1);

    expect(applyTableCellAlignment(current, 'right', 'slide')).toBe(true);
    expect(
      tableJson(current).content[0].content.map((cell) => cell.attrs.align),
    ).toEqual(['right', 'right']);
    expect(
      current.getJSON().content?.find((node) => node.type === 'figure')?.attrs
        ?.slidePlacement,
    ).toEqual({ x: 12, y: 18, width: 40, height: 30 });
  });

  it('applies outer borders to a selected range and mirrors a shared edge', () => {
    const current = createEditor();
    selectCells(current, 0, 3);

    expect(
      applyTableBorders(current, 'outer', 'draw', {
        color: '#ef4444',
        style: 'double',
        width: 2,
      }),
    ).toBe(true);

    const table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      top: { color: '#ef4444', style: 'double', width: 2 },
      left: { color: '#ef4444', style: 'double', width: 2 },
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      top: { color: '#ef4444', style: 'double', width: 2 },
      right: { color: '#ef4444', style: 'double', width: 2 },
    });
    expect(table.content[1].content[0].attrs.borders).toMatchObject({
      bottom: { color: '#ef4444', style: 'double', width: 2 },
      left: { color: '#ef4444', style: 'double', width: 2 },
    });
    expect(table.content[1].content[1].attrs.borders).toMatchObject({
      bottom: { color: '#ef4444', style: 'double', width: 2 },
      right: { color: '#ef4444', style: 'double', width: 2 },
    });
  });

  it('removes both sides of a shared border without affecting other edges', () => {
    const current = createEditor();
    selectCells(current, 0);
    const border = {
      color: '#334155',
      style: 'solid' as const,
      width: 1 as const,
    };

    expect(applyTableBorders(current, 'right', 'draw', border)).toBe(true);
    let table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      right: border,
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      left: border,
    });

    expect(applyTableBorders(current, 'right', 'erase', border)).toBe(true);
    table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      right: null,
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      left: null,
    });
  });

  it('applies a directional border only to the selected range perimeter', () => {
    const current = createEditor();
    selectCells(current, 0, 3);
    const border = {
      color: '#0f766e',
      style: 'dashed' as const,
      width: 2 as const,
    };

    expect(applyTableBorders(current, 'top', 'draw', border)).toBe(true);
    const table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      top: border,
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      top: border,
    });
    expect(table.content[1].content[0].attrs.borders).toBeNull();
    expect(table.content[1].content[1].attrs.borders).toBeNull();
  });

  it('preserves outer borders when merged cells are split again', () => {
    const current = createEditor(false);
    selectCells(current, 0, 3);
    const border = {
      color: '#ef4444',
      style: 'double' as const,
      width: 2 as const,
    };

    expect(applyTableBorders(current, 'outer', 'draw', border)).toBe(true);
    expect(mergeTableCellsPreservingBorders(current)).toBe(true);
    let table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      top: border,
      right: border,
      bottom: border,
      left: border,
    });

    expect(splitTableCellPreservingBorders(current)).toBe(true);
    table = tableJson(current);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      top: border,
      left: border,
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      top: border,
      right: border,
    });
    expect(table.content[1].content[0].attrs.borders).toMatchObject({
      bottom: border,
      left: border,
    });
    expect(table.content[1].content[1].attrs.borders).toMatchObject({
      bottom: border,
      right: border,
    });
    expect(table.content[0].content[0].attrs.borders).not.toHaveProperty(
      'right',
    );
    expect(table.content[0].content[0].attrs.borders).not.toHaveProperty(
      'bottom',
    );
  });

  it('rejects a merge that would flatten different perimeter borders', () => {
    const current = createEditor();
    const red = {
      color: '#ef4444',
      style: 'solid' as const,
      width: 1 as const,
    };
    const blue = {
      color: '#2563eb',
      style: 'dashed' as const,
      width: 2 as const,
    };

    selectCells(current, 0);
    expect(applyTableBorders(current, 'top', 'draw', red)).toBe(true);
    selectCells(current, 1);
    expect(applyTableBorders(current, 'top', 'draw', blue)).toBe(true);
    selectCells(current, 0, 1);

    expect(hasIncompatibleMergeBorders(current)).toBe(true);
    expect(mergeTableCellsPreservingBorders(current)).toBe(false);
    const table = tableJson(current);
    expect(table.content[0].content).toHaveLength(2);
    expect(table.content[0].content[0].attrs.borders).toMatchObject({
      top: red,
    });
    expect(table.content[0].content[1].attrs.borders).toMatchObject({
      top: blue,
    });
  });

  it('keeps border-preserving merge and split operations valid in the document model', () => {
    const current = createEditor();
    selectCells(current, 0, 1);

    expect(mergeTableCellsPreservingBorders(current)).toBe(true);
    let table = tableJson(current);
    expect(table.content[0].content).toHaveLength(1);
    expect(table.content[0].content[0].attrs.colspan).toBe(2);
    expect(() =>
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: current.getJSON().content ?? [],
      }),
    ).not.toThrow();

    expect(splitTableCellPreservingBorders(current)).toBe(true);
    table = tableJson(current);
    expect(table.content[0].content).toHaveLength(2);
    expect(() =>
      validateDocumentData({
        schemaVersion: 2,
        type: 'report',
        metadata: {},
        children: current.getJSON().content ?? [],
      }),
    ).not.toThrow();
  });
});
