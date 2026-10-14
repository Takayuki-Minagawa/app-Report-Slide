import {
  createNodeId,
  type DocumentData,
  type DocumentMetadata,
} from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import {
  preservedContent,
  preservedContentSchema,
  type PreservedContent,
} from '@/src/document/preserved-content';

const nodeTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'figure',
  'blockMath',
  'chart',
  'horizontalRule',
  'pageBreak',
  'slideBreak',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'speakerNotes',
  'text',
  'inlineMath',
  'inlineImage',
  'hardBreak',
  'reference',
  'footnote',
]);
const marks = new Set(['bold', 'italic', 'strike', 'code', 'link']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Inspect data without interpreting raw source as markup, code or model attributes. */
function inspect(value: unknown) {
  const stack = [{ value, depth: 0 }];
  let count = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (++count > 500000 || entry.depth > 64)
      throw new Error('文書の構造が上限を超えています（深さ64）。');
    if (entry.value && typeof entry.value === 'object') {
      for (const [key, child] of Object.entries(entry.value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('文書に使用できないキーがあります。');
        stack.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
}

function unsupportedTypes(value: unknown): string[] {
  if (!record(value)) return [];
  const found = new Set<string>();
  if (typeof value.type === 'string' && !nodeTypes.has(value.type))
    found.add(value.type);
  if (Array.isArray(value.marks))
    for (const mark of value.marks) {
      if (
        record(mark) &&
        typeof mark.type === 'string' &&
        !marks.has(mark.type)
      )
        found.add(`mark:${mark.type}`);
    }
  if (Array.isArray(value.content))
    for (const child of value.content) {
      for (const name of unsupportedTypes(child)) found.add(name);
    }
  return [...found];
}

function retainedAssets(
  value: unknown,
): NonNullable<PreservedContent['assets']> {
  const assets = new Map<string, 'image' | 'pdf'>();
  const visit = (node: unknown) => {
    if (!record(node)) return;
    if (record(node.attrs)) {
      const src = node.attrs.src;
      if (
        typeof src === 'string' &&
        /\.(?:png|jpe?g|gif|webp|svg|pdf)$/i.test(
          src.trim().split(/[?#]/, 1)[0],
        ) &&
        !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(src)
      )
        assets.set(
          src.trim(),
          /\.pdf$/i.test(src.trim().split(/[?#]/, 1)[0]) ? 'pdf' : 'image',
        );
      const edit = node.attrs.figureEdit;
      if (
        record(edit) &&
        record(edit.pdfSource) &&
        typeof edit.pdfSource.asset === 'string'
      )
        assets.set(edit.pdfSource.asset, 'pdf');
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(value);
  return [...assets].map(([source, kind]) => ({ source, kind }));
}

/** Import-only compatibility boundary. Known malformed nodes and unknown versions still fail validation. */
export function importDocumentData(value: unknown): DocumentData {
  inspect(value);
  if (
    !record(value) ||
    ![1, 2].includes(value.schemaVersion as number) ||
    !record(value.metadata) ||
    !Array.isArray(value.children)
  )
    return migrateDocumentData(value);
  if (value.metadata.preserved_content !== undefined)
    preservedContentSchema.parse(value.metadata.preserved_content);
  const entries = preservedContent(value.metadata as DocumentMetadata);
  let changed = false;
  const children = value.children.map((node, index) => {
    const unsupported = unsupportedTypes(node);
    if (!unsupported.length) return node;
    changed = true;
    const nodeId = createNodeId();
    const name = `要素 ${index + 1}: ${unsupported.join(', ')}`.slice(0, 1000);
    entries.push({
      id: createNodeId(),
      nodeId,
      name,
      format: 'json',
      source: JSON.stringify(node, null, 2),
      assets: retainedAssets(node),
    });
    return {
      type: 'paragraph',
      attrs: { nodeId },
      content: [
        { type: 'text', text: `[未対応要素の原データを保持: ${name}]` },
      ],
    };
  });
  if (!changed) return migrateDocumentData(value);
  preservedContentSchema.parse(entries);
  return migrateDocumentData({
    ...value,
    children,
    metadata: { ...value.metadata, preserved_content: entries },
  });
}
