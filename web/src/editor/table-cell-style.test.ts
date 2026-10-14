import { tableFillTextColor } from '@/src/document/table-fill';
import { Editor } from '@tiptap/core';
import { expect, it } from 'vitest';
import { CellSelection } from '@tiptap/pm/tables';
import { createEditorExtensions } from './extensions';
import { applyTableCellFill } from './table-cell-style';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import type { DocumentNode } from '@/src/document/model';
it('highlights selected cells in one undoable transaction and preserves fills in Markdown', () => {
  const document = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |').document;
  const editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: { type: 'doc', content: document.children },
  });
  try {
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, 2, 7),
      ),
    );
    expect(applyTableCellFill(editor, '#fef08a', 'report')).toBe(true);
    const data = {
      ...document,
      children: editor.getJSON().content as DocumentNode[],
    };
    const restored = parseMarkdown(serializeDocument(data)).document;
    const table = restored.children[0];
    expect(
      table.type === 'table' &&
        table.content[0].content?.map((cell) => cell.attrs.fill),
    ).toEqual(['#fef08a', '#fef08a']);
    expect(editor.commands.undo()).toBe(true);
    expect(
      (
        editor.getJSON() as {
          content: {
            content: { content: { attrs: { fill: string | null } }[] }[];
          }[];
        }
      ).content[0].content[0].content[0].attrs.fill,
    ).toBeNull();
  } finally {
    editor.destroy();
  }
});

it('keeps highlighted header cells legible on light and dark fills', () => {
  expect(tableFillTextColor('#fef08a')).toBe('#111827');
  expect(tableFillTextColor('#172f48')).toBe('#ffffff');
  expect(tableFillTextColor(null)).toBeUndefined();
});
