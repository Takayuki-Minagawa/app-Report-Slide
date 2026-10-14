import { readBlockLayout } from '@/src/document/block-layout';
import type { Editor, JSONContent } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { createNodeId } from '@/src/document/model';

export type BlockInsertionTarget = 'after-block' | 'page-end' | 'cursor';
const isBreak = (type: string) => type === 'slideBreak' || type === 'pageBreak';

/** Explicit insertion keeps a selected table cell from accidentally swallowing a figure. */
export function blockInsertionPosition(
  editor: Editor,
  target: BlockInsertionTarget,
): number {
  const { doc, selection } = editor.state;
  if (target === 'cursor') return selection.to;
  const start =
    selection.$from.depth > 0 ? selection.$from.before(1) : selection.from;
  const block = doc.nodeAt(start);
  if (target === 'after-block')
    return Math.min(doc.content.size, start + (block?.nodeSize ?? 0));
  let end = doc.content.size;
  doc.forEach((node, position) => {
    if (position >= start && isBreak(node.type.name))
      end = Math.min(end, position);
  });
  return end;
}

export function insertionPage(
  editor: Editor,
  target: BlockInsertionTarget,
): number {
  const position = blockInsertionPosition(editor, target);
  let page = 1;
  editor.state.doc.forEach((node, offset) => {
    if (offset < position && isBreak(node.type.name)) page += 1;
  });
  return page;
}

export function insertDocumentBlock(
  editor: Editor,
  value: JSONContent,
  target: BlockInsertionTarget,
): boolean {
  if (!editor.isEditable) return false;
  return editor
    .chain()
    .focus()
    .insertContentAt(blockInsertionPosition(editor, target), value)
    .run();
}

function selectedBlock(editor: Editor, nodeId: string) {
  let result: { index: number; position: number } | undefined;
  editor.state.doc.forEach((node, position, index) => {
    let contains = node.attrs.nodeId === nodeId;
    node.descendants((child) => {
      if (child.attrs.nodeId === nodeId) contains = true;
    });
    if (contains) result = { index, position };
  });
  return result;
}

export function canMoveBlock(
  editor: Editor,
  nodeId: string,
  direction: -1 | 1,
): boolean {
  const found = selectedBlock(editor, nodeId);
  if (!found || !editor.isEditable) return false;
  const layout = readBlockLayout(
    editor.state.doc.child(found.index).attrs.blockLayout,
  );
  if (layout.locked || layout.groupId) return false;
  const siblingIndex = found.index + direction;
  return (
    siblingIndex >= 0 &&
    siblingIndex < editor.state.doc.childCount &&
    !isBreak(editor.state.doc.child(found.index).type.name) &&
    !isBreak(editor.state.doc.child(siblingIndex).type.name)
  );
}

/** Reorder within the current page in one undoable transaction. */
export function moveDocumentBlock(
  editor: Editor,
  nodeId: string,
  direction: -1 | 1,
): boolean {
  if (!canMoveBlock(editor, nodeId, direction)) return false;
  const { index, position } = selectedBlock(editor, nodeId)!;
  const node = editor.state.doc.child(index);
  const sibling = editor.state.doc.child(index + direction);
  const start = direction < 0 ? position - sibling.nodeSize : position;
  const end = start + node.nodeSize + sibling.nodeSize;
  const transaction = editor.state.tr.replaceWith(
    start,
    end,
    direction < 0 ? [node, sibling] : [sibling, node],
  );
  transaction.setSelection(
    NodeSelection.create(
      transaction.doc,
      direction < 0 ? start : start + sibling.nodeSize,
    ),
  );
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

/** A copied group has fresh IDs and labels, so the original remains a valid reference target. */
export function duplicateDocumentBlock(
  editor: Editor,
  nodeId: string,
): string | undefined {
  const found = selectedBlock(editor, nodeId);
  if (!found || !editor.isEditable) return undefined;
  const node = editor.state.doc.child(found.index);
  const layout = readBlockLayout(node.attrs.blockLayout);
  if (layout.locked || layout.groupId) return undefined;
  if (isBreak(node.type.name) || node.type.name === 'speakerNotes')
    return undefined;
  const clone = (value: JSONContent): JSONContent => ({
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
    ...(value.content ? { content: value.content.map(clone) } : {}),
  });
  const copy = editor.schema.nodeFromJSON(clone(node.toJSON()));
  const position = found.position + node.nodeSize;
  const transaction = editor.state.tr.insert(position, copy);
  transaction.setSelection(NodeSelection.create(transaction.doc, position));
  editor.view.dispatch(transaction.scrollIntoView());
  return copy.attrs.nodeId as string;
}
