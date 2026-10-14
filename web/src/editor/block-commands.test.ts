import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { createEditorExtensions } from './extensions';
import { parseMarkdown } from '@/src/markdown/parser';
import { validateDocumentData } from '@/src/document/validation';
import { toEditorDocument } from '@/src/document/model';
import {
  blockInsertionPosition,
  duplicateDocumentBlock,
  insertionPage,
  insertDocumentBlock,
  moveDocumentBlock,
} from './block-commands';

let editor: Editor;
afterEach(() => editor?.destroy());
function setup(source: string) {
  const document = parseMarkdown(source).document;
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: toEditorDocument(document),
  });
  return document;
}

it('inserts after the containing table by default, while cursor placement remains explicit', () => {
  setup('| A | B |\n|---|---|\n| 1 | 2 |\n\nEnd');
  editor.commands.setTextSelection(4);
  const table = editor.state.doc.firstChild!;
  expect(blockInsertionPosition(editor, 'after-block')).toBe(table.nodeSize);
  expect(blockInsertionPosition(editor, 'cursor')).toBe(4);
  expect(
    insertDocumentBlock(
      editor,
      { type: 'paragraph', content: [{ type: 'text', text: 'After table' }] },
      'after-block',
    ),
  ).toBe(true);
  expect(editor.state.doc.child(0).type.name).toBe('table');
  expect(editor.state.doc.child(1).textContent).toBe('After table');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.childCount).toBe(2);
});

it('places at page end without entering the next slide', () => {
  setup(
    '---\ntype: slide\n---\n\n# First\n\nText\n\n::: slidebreak\n:::\n\n# Second',
  );
  editor.commands.setTextSelection(2);
  const boundary =
    editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
  expect(blockInsertionPosition(editor, 'page-end')).toBe(boundary);
  expect(insertionPage(editor, 'page-end')).toBe(1);
  insertDocumentBlock(
    editor,
    { type: 'paragraph', content: [{ type: 'text', text: 'Last on first' }] },
    'page-end',
  );
  expect(editor.state.doc.child(2).textContent).toBe('Last on first');
  expect(editor.state.doc.child(3).type.name).toBe('slideBreak');
});

it('duplicates a table with fresh recursive IDs and no duplicated reference labels, undoable', () => {
  const document = setup('| A |\n|---|\n| 1 |\n{#tbl:a caption="Values"}');
  const original = editor.state.doc.firstChild!;
  const cellId = original.firstChild!.firstChild!.attrs.nodeId;
  const copyId = duplicateDocumentBlock(editor, cellId);
  expect(copyId).toBeTruthy();
  expect(
    editor.getJSON().content?.filter((node) => node.type === 'table'),
  ).toHaveLength(2);
  expect(editor.state.doc.child(1).attrs.label).toBeNull();
  expect(editor.state.doc.child(1).attrs.caption).toBe('Values');
  expect(() =>
    validateDocumentData({ ...document, children: editor.getJSON().content }),
  ).not.toThrow();
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.firstChild?.attrs.label).toBe('tbl:a');
  expect(
    editor.getJSON().content?.filter((node) => node.type === 'table'),
  ).toHaveLength(1);
});

it('moves selected blocks without crossing a page boundary and preserves nested content on Undo', () => {
  setup('A\n\nB\n\n::: pagebreak\n:::\n\nC');
  const id = editor.state.doc.child(1).attrs.nodeId;
  expect(moveDocumentBlock(editor, id, 1)).toBe(false);
  expect(moveDocumentBlock(editor, id, -1)).toBe(true);
  expect(editor.state.doc.child(0).textContent).toBe('B');
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.child(0).textContent).toBe('A');
});
