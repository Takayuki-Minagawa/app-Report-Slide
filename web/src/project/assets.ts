import type { DocumentData, DocumentNode } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { localDocumentAssets, type DocumentAsset } from '@/src/document/assets';
import type { AssetUrls } from '@/src/workspace/files';
import {
  isLocalProjectImage,
  resolveProjectPath,
  type ProjectAssets,
  type ReportChapter,
  type ReportProject,
} from './model';

/** A newly added chapter gets its own image directory, even when filenames repeat. */
export function prepareChapter(
  chapter: ReportChapter,
  sourceAssets: AssetUrls,
): { chapter: ReportChapter; assets: ProjectAssets } {
  const document: DocumentData = structuredClone(chapter.document);
  const assets = new Map<string, string>();
  const remappedSources = new Map<string, string>();
  const remap = (value: string, kind: 'image' | 'pdf') => {
    if (!isLocalProjectImage(value)) return value;
    const source = value.trim();
    let next = remappedSources.get(source);
    if (!next) {
      const extension =
        kind === 'pdf'
          ? 'pdf'
          : (/\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.exec(source)?.[1] ??
            'png');
      next = `assets/${kind}-${remappedSources.size + 1}.${extension.toLowerCase()}`;
      remappedSources.set(source, next);
      const url = sourceAssets.get(source);
      if (url) assets.set(resolveProjectPath(chapter.file, next), url);
    }
    return next;
  };
  const library = document.metadata.block_library;
  const libraryNodes =
    library &&
    typeof library === 'object' &&
    !Array.isArray(library) &&
    Array.isArray(library.items)
      ? library.items.flatMap((item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          Array.isArray(item.nodes)
            ? (item.nodes as unknown as DocumentNode[])
            : [],
        )
      : [];
  for (const node of walkDocumentTree([
    ...document.children,
    ...libraryNodes,
  ])) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    node.attrs.src = remap(node.attrs.src, 'image');
    if (node.type === 'figure' && node.attrs.figureEdit?.pdfSource) {
      node.attrs.figureEdit.pdfSource.asset = remap(
        node.attrs.figureEdit.pdfSource.asset,
        'pdf',
      );
    }
  }
  if (Array.isArray(document.metadata.preserved_content))
    for (const entry of document.metadata.preserved_content)
      if (
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        Array.isArray(entry.assets)
      )
        for (const asset of entry.assets)
          if (
            asset &&
            typeof asset === 'object' &&
            !Array.isArray(asset) &&
            typeof asset.source === 'string'
          )
            asset.source = remap(
              asset.source,
              asset.kind === 'pdf' ? 'pdf' : 'image',
            );
  return { chapter: { ...chapter, document }, assets };
}

export function chapterImagePaths(chapter: ReportChapter): string[] {
  return chapterAssetReferences(chapter).map(({ source }) => source);
}

export function chapterAssetReferences(
  chapter: ReportChapter,
): DocumentAsset[] {
  return localDocumentAssets(
    chapter.document.children,
    chapter.document.metadata,
  ).map((entry) => ({
    ...entry,
    source: resolveProjectPath(chapter.file, entry.source),
  }));
}

/** Single-chapter exports use source-local keys, while the workspace owns canonical project keys. */
export function chapterLocalAssets(
  chapter: ReportChapter,
  assets: ProjectAssets,
): ProjectAssets {
  return new Map(
    localDocumentAssets(
      chapter.document.children,
      chapter.document.metadata,
    ).flatMap(({ source }) => {
      const url = assets.get(resolveProjectPath(chapter.file, source));
      return url ? [[source, url] as const] : [];
    }),
  );
}

export function pruneProjectAssets(
  project: ReportProject,
  assets: ProjectAssets,
): ProjectAssets {
  const used = new Set(project.chapters.flatMap(chapterImagePaths));
  return new Map([...assets].filter(([path]) => used.has(path)));
}
