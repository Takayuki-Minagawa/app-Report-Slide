import { walkDocumentTree, type DocumentTreeNode } from './traversal';
import { pdfSourceSchema } from './pdf-source';

export interface DocumentAsset {
  source: string;
  kind: 'image' | 'pdf';
  fileName?: string;
}
export const isLocalDocumentAsset = (source: string) =>
  !/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(source);

/** One enumeration for rendering originals, archive persistence and asset cleanup. */
export function referencedAssets(
  nodes: readonly DocumentTreeNode[],
): DocumentAsset[] {
  const sources = new Map<string, DocumentAsset>();
  const add = (entry: DocumentAsset) => {
    const previous = sources.get(entry.source);
    if (previous && previous.kind !== entry.kind)
      throw new Error('同じ素材を画像とPDF原本の両方には指定できません。');
    sources.set(entry.source, entry);
  };
  for (const node of walkDocumentTree(nodes)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    add({ source: node.attrs.src.trim(), kind: 'image' });
    if (node.type !== 'figure' || !node.attrs.figureEdit?.pdfSource) continue;
    const original = pdfSourceSchema.parse(node.attrs.figureEdit.pdfSource);
    add({ source: original.asset, kind: 'pdf', fileName: original.fileName });
  }
  return [...sources.values()];
}

export function localDocumentAssets(
  nodes: readonly DocumentTreeNode[],
): DocumentAsset[] {
  return referencedAssets(nodes).filter(({ source }) =>
    isLocalDocumentAsset(source),
  );
}

export function documentAssetMime(source: string): string | undefined {
  const ext = source.split(/[?#]/, 1)[0].split('.').at(-1)?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
    } as Record<string, string>
  )[ext ?? ''];
}
