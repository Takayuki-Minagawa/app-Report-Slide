import { Editor } from '@tiptap/core';
import { afterEach, expect, it } from 'vitest';
import { createEditorExtensions } from './extensions';
import { splitTableAcrossPages, tableSplitOptions } from './table-split';
import { validateDocumentData } from '@/src/document/validation';
import { walkDocumentTree } from '@/src/document/traversal';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';

let editor: Editor;
afterEach(() => editor?.destroy());
function sample() {
  const cell = (id: string, type = 'tableCell', attrs = {}) => ({
    type,
    attrs: {
      nodeId: id,
      align: null,
      colspan: 1,
      rowspan: 1,
      colwidth: [100],
      ...attrs,
    },
    content: [
      {
        type: 'paragraph',
        attrs: { nodeId: `${id}-p` },
        content: [{ type: 'text', text: id }],
      },
    ],
  });
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => {} }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'table',
          attrs: {
            nodeId: 'table',
            label: 'tab:results',
            caption: 'Results',
            sourceReferenceId: 'paper',
          },
          content: [
            {
              type: 'tableRow',
              attrs: { nodeId: 'row0' },
              content: [
                cell('head', 'tableHeader', {
                  colspan: 2,
                  colwidth: [90, 110],
                  fill: '#aabbcc',
                }),
              ],
            },
            {
              type: 'tableRow',
              attrs: { nodeId: 'row1' },
              content: [
                cell('merged', 'tableCell', { rowspan: 2, colwidth: [90] }),
                cell('a', 'tableCell', { colwidth: [110] }),
              ],
            },
            {
              type: 'tableRow',
              attrs: { nodeId: 'row2' },
              content: [cell('b', 'tableCell', { colwidth: [110] })],
            },
            {
              type: 'tableRow',
              attrs: { nodeId: 'row3' },
              content: [
                cell('c', 'tableCell', { colwidth: [90] }),
                cell('d', 'tableCell', { colwidth: [110] }),
              ],
            },
            {
              type: 'tableRow',
              attrs: { nodeId: 'row4' },
              content: [
                cell('e', 'tableCell', { colwidth: [90] }),
                cell('f', 'tableCell', { colwidth: [110] }),
              ],
            },
          ],
        },
        {
          type: 'paragraph',
          attrs: { nodeId: 'after' },
          content: [{ type: 'text', text: 'After table' }],
        },
      ],
    },
  });
  return editor.state.doc;
}
it('splits at a safe merged-cell boundary, repeats styled headers and undoes in one step', () => {
  const original = sample();
  expect(tableSplitOptions(editor, 'table')).toEqual({
    nodeId: 'table',
    rows: 5,
    boundaries: [1, 3, 4],
    headerRows: 1,
  });
  expect(splitTableAcrossPages(editor, 'table', 2, true, 'slide')).toBe(false);
  expect(editor.state.doc).toBe(original);
  expect(splitTableAcrossPages(editor, 'table', 3, true, 'slide')).toBe(true);
  const metadata = {
    title: 'Kept',
    figure_references: [
      {
        id: 'paper',
        title: 'Study',
        authors: '',
        year: '',
        url: '',
        summary: 'Summary',
      },
    ],
    reader_supplements: {
      version: 1,
      pages: [
        {
          pageId: 'table',
          pageIndex: 0,
          anchorIds: ['table', 'after'],
          title: 'Reader',
          text: 'Keep',
          link: '',
        },
      ],
    },
  };
  const document = validateDocumentData({
    schemaVersion: 2,
    type: 'slide',
    metadata,
    children: editor.getJSON().content,
  });
  const [first, boundary, second, after] = document.children;
  expect(boundary.type).toBe('slideBreak');
  expect(first.attrs.nodeId).toBe('table');
  expect(first.attrs.label).toBe('tab:results');
  expect(second.attrs.sourceReferenceId).toBe('paper');
  expect(second.attrs.label).toBeNull();
  expect(second.attrs.numbered).toBe(false);
  expect(after.attrs.nodeId).toBe('after');
  expect(document.metadata.title).toBe('Kept');
  expect(document.metadata.reader_supplements).toMatchObject({
    pages: [{ title: 'Reader', text: 'Keep', pageId: 'table', pageIndex: 0 }],
  });
  if (first.type !== 'table' || second.type !== 'table')
    throw new Error('table');
  expect(first.content[1].content?.[0].attrs.rowspan).toBe(2);
  expect(second.content[0].content?.[0].attrs).toMatchObject({
    colspan: 2,
    colwidth: [90, 110],
    fill: '#aabbcc',
  });
  expect(second.content[1].attrs.nodeId).toBe('row3');
  const ids = Array.from(walkDocumentTree(document.children)).flatMap((node) =>
    'attrs' in node && 'nodeId' in node.attrs && node.attrs.nodeId
      ? [node.attrs.nodeId]
      : [],
  );
  expect(new Set(ids).size).toBe(ids.length);
  const restored = parseMarkdown(serializeDocument(document));
  expect(
    restored.diagnostics.filter((entry) => entry.severity === 'error'),
  ).toEqual([]);
  expect(
    restored.document.children
      .filter((node) => node.type === 'table')
      .map((node) => node.attrs.sourceReferenceId),
  ).toEqual(['paper', 'paper']);
  expect(editor.commands.undo()).toBe(true);
  expect(editor.state.doc.toJSON()).toEqual(original.toJSON());
});
it('rejects stale IDs and read-only edits; supports a report page break without repeating headers', () => {
  sample();
  expect(splitTableAcrossPages(editor, 'missing', 3, false, 'report')).toBe(
    false,
  );
  editor.setEditable(false);
  expect(splitTableAcrossPages(editor, 'table', 3, false, 'report')).toBe(
    false,
  );
  editor.setEditable(true);
  expect(splitTableAcrossPages(editor, 'table', 3, false, 'report')).toBe(true);
  expect(editor.state.doc.child(1).type.name).toBe('pageBreak');
  expect(editor.state.doc.child(2).childCount).toBe(2);
});
