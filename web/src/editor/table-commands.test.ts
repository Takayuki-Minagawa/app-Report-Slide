import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';

import { validateDocumentData } from '@/src/document/validation';

import { createEditorExtensions } from './extensions';
import { applyTableBorders } from './table-commands';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { nodeId: 'initial' } }],
    },
  });
  editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
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

  it('keeps native merge and split operations valid in the document model', () => {
    const current = createEditor();
    selectCells(current, 0, 1);

    expect(current.commands.mergeCells()).toBe(true);
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

    expect(current.commands.splitCell()).toBe(true);
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
