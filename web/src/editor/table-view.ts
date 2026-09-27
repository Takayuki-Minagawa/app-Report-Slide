import { TableView } from '@tiptap/extension-table';
import type { Node } from '@tiptap/pm/model';

/** Tiptap leaves a stale width on <col> when undoing a resize to an unset width. */
export class UndoSafeTableView extends TableView {
  update(node: Node): boolean {
    if (!super.update(node)) return false;

    let column = 0;
    node.firstChild?.forEach((cell) => {
      const widths = cell.attrs.colwidth as number[] | null;
      for (let offset = 0; offset < cell.attrs.colspan; offset += 1) {
        const col = this.colgroup.children.item(column) as HTMLTableColElement;
        if (!widths?.[offset]) {
          col.style.removeProperty('width');
          col.style.minWidth = `${this.cellMinWidth}px`;
        } else {
          col.style.removeProperty('min-width');
        }
        column += 1;
      }
    });
    return true;
  }
}
