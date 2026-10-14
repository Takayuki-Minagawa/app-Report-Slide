import type { Editor, JSONContent } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { TableMap } from '@tiptap/pm/tables';
import { createNodeId, type DocumentType } from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';

function rootTable(editor: Editor, nodeId?: string) {
  let found: { node: ProseMirrorNode; position: number } | undefined;
  editor.state.doc.forEach((node, position) => {
    if (node.type.name !== 'table') return;
    const matches = nodeId
      ? node.attrs.nodeId === nodeId
      : editor.state.selection.from >= position &&
        editor.state.selection.from < position + node.nodeSize;
    if (matches) found = { node, position };
  });
  return found;
}

/** A legal boundary never cuts a vertically merged cell into incomplete fragments. */
export function tableSplitOptions(editor: Editor, nodeId?: string) {
  const table = rootTable(editor, nodeId);
  if (!table) return undefined;
  const map = TableMap.get(table.node);
  if (map.problems?.length) return undefined;
  const boundaries = Array.from(
    { length: map.height - 1 },
    (_, index) => index + 1,
  ).filter((row) =>
    Array.from({ length: map.width }, (_, col) => col).every(
      (col) =>
        map.map[(row - 1) * map.width + col] !== map.map[row * map.width + col],
    ),
  );
  let headerRows = 0;
  while (
    headerRows < map.height &&
    Array.from({ length: map.width }, (_, col) => col).every(
      (col) =>
        table.node.nodeAt(map.map[headerRows * map.width + col])?.type.name ===
        'tableHeader',
    )
  )
    headerRows++;
  if (!boundaries.includes(headerRows)) headerRows = 0;
  return {
    nodeId: String(table.node.attrs.nodeId),
    rows: map.height,
    boundaries,
    headerRows,
  };
}

function copiedHeader(value: JSONContent): JSONContent {
  return {
    ...value,
    ...(value.attrs
      ? {
          attrs: {
            ...value.attrs,
            ...('nodeId' in value.attrs ? { nodeId: createNodeId() } : {}),
            ...('label' in value.attrs ? { label: null } : {}),
          },
        }
      : {}),
    ...(value.content ? { content: value.content.map(copiedHeader) } : {}),
  };
}

/** All body rows retain their IDs/content. Only the repeated header receives fresh IDs. */
export function splitTableAcrossPages(
  editor: Editor,
  nodeId: string,
  afterRow: number,
  repeatHeader: boolean,
  documentType: DocumentType,
): boolean {
  if (!editor.isEditable) return false;
  const table = rootTable(editor, nodeId),
    options = tableSplitOptions(editor, nodeId);
  if (
    !table ||
    !options?.boundaries.includes(afterRow) ||
    (repeatHeader && (!options.headerRows || afterRow <= options.headerRows))
  )
    return false;
  const rows: ProseMirrorNode[] = [];
  table.node.forEach((row) => rows.push(row));
  const headers = repeatHeader
    ? rows
        .slice(0, options.headerRows)
        .map((row) => editor.schema.nodeFromJSON(copiedHeader(row.toJSON())))
    : [];
  const first = table.node.copy(Fragment.fromArray(rows.slice(0, afterRow)));
  const second = table.node.type.create(
    {
      ...table.node.attrs,
      nodeId: createNodeId(),
      label: null,
      numbered: false,
      caption: table.node.attrs.caption
        ? `${table.node.attrs.caption} (continued)`
        : null,
    },
    [...headers, ...rows.slice(afterRow)],
  );
  const boundary = editor.schema.nodes[
    documentType === 'slide' ? 'slideBreak' : 'pageBreak'
  ].create({ nodeId: createNodeId() });
  const transaction = closeHistory(editor.state.tr).replaceWith(
    table.position,
    table.position + table.node.nodeSize,
    [first, boundary, second],
  );
  validateDocumentData({
    schemaVersion: 2,
    type: documentType,
    metadata: {},
    children: transaction.doc.toJSON().content,
  });
  transaction.setSelection(
    NodeSelection.create(
      transaction.doc,
      table.position + first.nodeSize + boundary.nodeSize,
    ),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
