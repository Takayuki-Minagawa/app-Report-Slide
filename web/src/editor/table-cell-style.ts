import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import type { DocumentType } from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';

export function applyTableCellFill(
  editor: Editor,
  color: string | null,
  documentType: DocumentType,
): boolean {
  if (
    !editor.isEditable ||
    !editor.isActive('table') ||
    (color !== null && !/^#[0-9a-f]{6}$/i.test(color))
  )
    return false;
  const tr = editor.state.tr;
  const selection = editor.state.selection;
  if (selection instanceof CellSelection)
    selection.forEachCell((node, position) =>
      tr.setNodeMarkup(position, undefined, { ...node.attrs, fill: color }),
    );
  else {
    for (let depth = selection.$from.depth; depth > 0; depth--) {
      const node = selection.$from.node(depth);
      if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
        tr.setNodeMarkup(selection.$from.before(depth), undefined, {
          ...node.attrs,
          fill: color,
        });
        break;
      }
    }
  }
  if (!tr.docChanged) return false;
  try {
    validateDocumentData({
      schemaVersion: 2,
      type: documentType,
      metadata: {},
      children: tr.doc.toJSON().content,
    });
  } catch {
    return false;
  }
  editor.view.dispatch(tr);
  return true;
}
