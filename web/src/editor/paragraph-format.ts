import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type {
  DocumentData,
  DocumentNode,
  ParagraphNode,
} from '@/src/document/model';
import { resolvePageSettings } from '@/src/document/page-settings';
import {
  isFirstLineIndent,
  paragraphAfterHeadingIds,
  resolveParagraphIndent,
  type FirstLineIndent,
} from '@/src/document/paragraph-format';
import { selectedTextBlocks } from './text-ruler-commands';

interface FormatContext {
  document: DocumentData;
  chapterPrefix?: string;
}
const formatKey = new PluginKey<FormatContext | null>('paragraphFormat');

/** Replace the active chapter snapshot before computing its surrounding context. */
export function editorAfterHeadingIds(
  nodes: DocumentNode[],
  document: DocumentData,
  chapterPrefix?: string,
): Set<string> {
  if (!chapterPrefix) return paragraphAfterHeadingIds(nodes);
  const first = document.children.findIndex((node) =>
    node.attrs.nodeId.startsWith(chapterPrefix),
  );
  if (first < 0) return paragraphAfterHeadingIds(nodes); // An excluded chapter is edited on its own.
  const merged = document.children.flatMap((node, index) => {
    const replacement =
      index === first
        ? nodes.map(
            (entry) =>
              ({
                ...entry,
                attrs: {
                  ...entry.attrs,
                  nodeId: chapterPrefix + entry.attrs.nodeId,
                },
              }) as DocumentNode,
          )
        : [];
    return node.attrs.nodeId.startsWith(chapterPrefix) ? replacement : [node];
  });
  return new Set(
    [...paragraphAfterHeadingIds(merged)]
      .filter((id) => id.startsWith(chapterPrefix))
      .map((id) => id.slice(chapterPrefix.length)),
  );
}

export function editorDocumentNodes(doc: ProseMirrorNode): DocumentNode[] {
  return (doc.toJSON().content ?? []) as DocumentNode[];
}

export function setParagraphFormatContext(
  editor: Editor,
  document: DocumentData,
  chapterPrefix?: string,
): void {
  if (editor.isDestroyed) return;
  editor.view.dispatch(
    editor.state.tr
      .setMeta(formatKey, { document, chapterPrefix })
      .setMeta('addToHistory', false),
  );
}

export function applyParagraphIndent(
  editor: Editor,
  indent: FirstLineIndent,
): boolean {
  if (editor.isDestroyed || !isFirstLineIndent(indent)) return false;
  const selected = selectedTextBlocks(editor).filter(
    (block) => block.type === 'paragraph',
  );
  const transaction = editor.state.tr;
  for (const block of selected) {
    const node = transaction.doc.nodeAt(block.position);
    if (
      !node ||
      JSON.stringify(node.attrs.firstLineIndent) === JSON.stringify(indent)
    )
      continue;
    transaction.setNodeMarkup(block.position, undefined, {
      ...node.attrs,
      firstLineIndent: { ...indent },
    });
  }
  if (!transaction.docChanged) return false;
  editor.view.dispatch(closeHistory(transaction));
  editor.view.dispatch(
    closeHistory(editor.state.tr).setMeta('addToHistory', false),
  );
  return true;
}

export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  priority: 1100,
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          firstLineIndent: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => {
              try {
                const value: unknown = JSON.parse(
                  element.getAttribute('data-kumi-first-line-indent') ?? 'null',
                );
                return isFirstLineIndent(value) ? value : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs) =>
              isFirstLineIndent(attrs.firstLineIndent)
                ? {
                    'data-kumi-first-line-indent': JSON.stringify(
                      attrs.firstLineIndent,
                    ),
                  }
                : {},
          },
        },
      },
    ];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { selection } = this.editor.state;
        if (
          formatKey.getState(this.editor.state)?.document.type !== 'report' ||
          selection.$from.depth !== 1 ||
          selection.$from.parent.type.name !== 'paragraph'
        )
          return false;
        return this.editor
          .chain()
          .splitBlock()
          .updateAttributes('paragraph', {
            firstLineIndent: { mode: 'inherit' },
          })
          .run();
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin<FormatContext | null>({
        key: formatKey,
        state: {
          init: () => null,
          apply: (transaction, context) =>
            transaction.getMeta(formatKey) ?? context,
        },
        props: {
          decorations: (state) => {
            const context = formatKey.getState(state);
            if (!context || context.document.type !== 'report')
              return DecorationSet.empty;
            const settings = resolvePageSettings(context.document.metadata);
            const nodes = editorDocumentNodes(state.doc);
            const afterHeading = editorAfterHeadingIds(
              nodes,
              context.document,
              context.chapterPrefix,
            );
            const decorations: Decoration[] = [];
            state.doc.forEach((node, position) => {
              if (node.type.name !== 'paragraph') return;
              const paragraph = node.toJSON() as ParagraphNode;
              const resolved = resolveParagraphIndent(paragraph, settings, {
                topLevel: true,
                afterHeading: afterHeading.has(node.attrs.nodeId),
              });
              const style = Object.entries(resolved.style)
                .map(
                  ([key, value]) =>
                    `${key.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase())}:${value}`,
                )
                .join(';');
              decorations.push(
                Decoration.node(position, position + node.nodeSize, {
                  style,
                  'data-kumi-indent-source': resolved.source,
                }),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
