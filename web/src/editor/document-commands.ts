import type { Editor } from '@tiptap/core';
import { validateDocumentData } from '@/src/document/validation';

/** Resolve by stable ID at commit time; a stale position must never edit another node. */
export function updateDocumentNode(
  editor: Editor,
  nodeId: string,
  attrs: Record<string, unknown>,
): boolean {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.nodeId === nodeId) position = pos;
  });
  if (position === undefined) return false;
  const node = editor.state.doc.nodeAt(position)!;
  const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    ...attrs,
  });
  validateDocumentData({
    schemaVersion: 2,
    type: 'report',
    metadata: {},
    children: transaction.doc.toJSON().content,
  });
  editor.view.dispatch(transaction);
  return true;
}

export function insertDocumentBreak(
  editor: Editor,
  type: 'pageBreak' | 'slideBreak',
): boolean {
  const { $from } = editor.state.selection;
  const position = $from.depth > 0 ? $from.after(1) : $from.pos;
  return editor
    .chain()
    .focus()
    .insertContentAt(position, [{ type }, { type: 'paragraph' }])
    .run();
}
