import type { DocumentNode, InlineNode } from './model';

export type DocumentTreeNode = DocumentNode | InlineNode;

/** Walk blocks and inline content in document order without interpreting presentation. */
export function* walkDocumentTree(
  nodes: readonly DocumentTreeNode[],
): Generator<DocumentTreeNode> {
  for (const node of nodes) {
    yield node;
    if ('content' in node && node.content) {
      yield* walkDocumentTree(node.content);
    }
  }
}
