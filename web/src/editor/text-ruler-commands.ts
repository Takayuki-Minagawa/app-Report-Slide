import type { Editor } from '@tiptap/core';

import { isTextRuler, type TextRuler } from '@/src/document/text-ruler';

export interface SelectedTextBlock {
  position: number;
  nodeId: string;
  ruler: TextRuler | null;
  type: 'paragraph' | 'heading';
}

function isTextBlock(type: string): type is SelectedTextBlock['type'] {
  return type === 'paragraph' || type === 'heading';
}

/** The ruler affects document-level text blocks, never paragraphs inside tables or lists. */
export function selectedTextBlocks(editor: Editor): SelectedTextBlock[] {
  const { doc, selection } = editor.state;
  const { from, to, empty } = selection;
  const caretBlockPosition =
    empty && selection.$from.depth === 1 ? selection.$from.before(1) : null;
  const blocks: SelectedTextBlock[] = [];

  doc.forEach((node, position) => {
    if (!isTextBlock(node.type.name)) return;
    const selected = empty
      ? position === caretBlockPosition
      : from < position + node.nodeSize && to > position + 1;
    if (!selected) return;
    const nodeId = node.attrs.nodeId;
    if (typeof nodeId !== 'string' || nodeId.trim().length === 0) return;
    blocks.push({
      position,
      nodeId,
      ruler: isTextRuler(node.attrs.textRuler)
        ? { ...node.attrs.textRuler }
        : null,
      type: node.type.name,
    });
  });
  return blocks;
}

function sameRuler(current: unknown, next: TextRuler | null): boolean {
  if (next === null) return current == null;
  return (
    isTextRuler(current) &&
    current.left === next.left &&
    current.right === next.right &&
    current.firstLine === next.firstLine
  );
}

/** Applies one undoable change to the selected blocks or a stable node ID snapshot. */
export function applyTextRuler(
  editor: Editor,
  ruler: TextRuler | null,
  nodeIds?: string[],
): boolean {
  if (editor.isDestroyed || (ruler !== null && !isTextRuler(ruler))) {
    return false;
  }
  const ids = new Set(
    (nodeIds ?? selectedTextBlocks(editor).map((block) => block.nodeId)).filter(
      (id) => typeof id === 'string' && id.trim().length > 0,
    ),
  );
  if (ids.size === 0) return false;

  const transaction = editor.state.tr;
  transaction.doc.forEach((node, position) => {
    if (!isTextBlock(node.type.name) || !ids.has(node.attrs.nodeId)) return;
    if (sameRuler(node.attrs.textRuler, ruler)) return;
    transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      textRuler: ruler === null ? null : { ...ruler },
    });
  });
  if (!transaction.docChanged) return false;
  editor.view.dispatch(transaction);
  return true;
}
