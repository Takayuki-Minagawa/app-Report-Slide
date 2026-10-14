import type { Editor } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { figureEditSchema, type FigureEdit } from '@/src/document/figure-edit';
import { extractionBlocks } from '@/src/document/extraction';

/** Store evidence and insert editable text in a single undoable transaction. */
export function applyFigureExtraction(
  editor: Editor,
  nodeId: string,
  edit: FigureEdit,
  insert: boolean,
): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const checked = figureEditSchema.parse(edit);
  if (!checked.extraction) return false;
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'figure' && node.attrs.nodeId === nodeId)
      position = pos;
  });
  if (position === undefined) return false;
  const node = editor.state.doc.nodeAt(position)!;
  const transaction = editor.state.tr.setNodeMarkup(position, undefined, {
    ...node.attrs,
    figureEdit: checked,
  });
  if (insert) {
    const blocks = extractionBlocks(
      checked.extraction,
      checked.source?.referenceId,
    );
    transaction.insert(
      position + node.nodeSize,
      Fragment.fromArray(
        blocks.map((block) => editor.schema.nodeFromJSON(block)),
      ),
    );
  }
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
