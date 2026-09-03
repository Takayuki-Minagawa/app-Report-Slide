import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';

import { validateDocumentData } from '@/src/document/validation';

import { createEditorExtensions } from './extensions';
import {
  applyTableBorders,
  hasIncompatibleMergeBorders,
  mergeTableCellsPreservingBorders,
  splitTableCellPreservingBorders,
} from './table-commands';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(withHeaderRow = true): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { nodeId: 'initial' } }],
    },
  });
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow });
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

describe('advanced table commands', () => {
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
