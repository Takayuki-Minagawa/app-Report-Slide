import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import {
  normalizeFootnoteText,
  type CalloutType,
  type DocumentType,
} from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';

/** Resolve by stable ID at commit time; a stale position must never edit another node. */
export function updateDocumentNode(
  editor: Editor,
  nodeId: string,
  attrs: Record<string, unknown>,
  documentType: DocumentType = 'report',
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
    type: documentType,
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

const isDocumentBreak = (name: string) =>
  name === 'pageBreak' || name === 'slideBreak';

/** One notes block per slide: focus the existing block, or add one at the slide's end. */
export function insertSpeakerNotes(editor: Editor): boolean {
  const { doc, selection } = editor.state;
  const current = selection.$from.index(0);
  let first = Math.min(current, doc.childCount - 1);
  while (first > 0 && !isDocumentBreak(doc.child(first - 1).type.name))
    first -= 1;
  let position = 0;
  for (let index = 0; index < first; index += 1)
    position += doc.child(index).nodeSize;
  for (let index = first; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    if (isDocumentBreak(child.type.name)) break;
    if (child.type.name === 'speakerNotes')
      return editor
        .chain()
        .focus()
        .setTextSelection(position + child.nodeSize - 2)
        .run();
    position += child.nodeSize;
  }
  return editor
    .chain()
    .focus()
    .insertContentAt(position, {
      type: 'speakerNotes',
      content: [{ type: 'paragraph' }],
    })
    .setTextSelection(position + 2)
    .run();
}

/** Insert after the selection and select the marker, so Properties can edit its text. */
export function insertFootnote(editor: Editor, text: string): boolean {
  const footnote = editor.schema.nodes.footnote;
  const normalized = normalizeFootnoteText(text);
  if (!footnote || !normalized) return false;
  const { state } = editor;
  const position = state.selection.to;
  const $position = state.doc.resolve(position);
  if (
    !$position.parent.canReplaceWith(
      $position.index(),
      $position.index(),
      footnote,
    )
  )
    return false;
  const transaction = state.tr.insert(
    position,
    footnote.create({ text: normalized }),
  );
  transaction.setSelection(NodeSelection.create(transaction.doc, position));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Footnotes have no node ID, so verify the position still holds a footnote. */
export function updateFootnote(
  editor: Editor,
  position: number,
  text: string,
): boolean {
  const normalized = normalizeFootnoteText(text);
  const { state } = editor;
  const node =
    position >= 0 && position < state.doc.content.size
      ? state.doc.nodeAt(position)
      : null;
  if (node?.type.name !== 'footnote' || !normalized) return false;
  const transaction = state.tr.setNodeMarkup(position, undefined, {
    text: normalized,
  });
  transaction.setSelection(NodeSelection.create(transaction.doc, position));
  editor.view.dispatch(transaction);
  return true;
}

/** `null` keeps the quote and removes its alert type; a type also creates the quote. */
export function setCallout(
  editor: Editor,
  callout: CalloutType | null,
): boolean {
  if (editor.isActive('blockquote'))
    return editor
      .chain()
      .focus()
      .updateAttributes('blockquote', { callout })
      .run();
  if (!callout) return false;
  return editor.chain().focus().wrapIn('blockquote', { callout }).run();
}
