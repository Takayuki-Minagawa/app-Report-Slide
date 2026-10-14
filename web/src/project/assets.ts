import type { DocumentData } from '@/src/document/model';
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
  for (const node of walkDocumentTree(document.children)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    node.attrs.src = remap(node.attrs.src, 'image');
    if (node.type === 'figure' && node.attrs.figureEdit?.pdfSource) {
      node.attrs.figureEdit.pdfSource.asset = remap(
        node.attrs.figureEdit.pdfSource.asset,
        'pdf',
      );
    }
  }
  return { chapter: { ...chapter, document }, assets };
}

export function chapterImagePaths(chapter: ReportChapter): string[] {
  return chapterAssetReferences(chapter).map(({ source }) => source);
}

export function chapterAssetReferences(
  chapter: ReportChapter,
): DocumentAsset[] {
  return localDocumentAssets(chapter.document.children).map((entry) => ({
    ...entry,
    source: resolveProjectPath(chapter.file, entry.source),
  }));
}

export function pruneProjectAssets(
  project: ReportProject,
  assets: ProjectAssets,
): ProjectAssets {
  const used = new Set(project.chapters.flatMap(chapterImagePaths));
  return new Map([...assets].filter(([path]) => used.has(path)));
}
