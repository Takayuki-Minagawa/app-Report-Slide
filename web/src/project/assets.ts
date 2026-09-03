import type { DocumentData } from '@/src/document/model';
import { createNodeId } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
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
  existing?: ReportProject,
): { chapter: ReportChapter; assets: ProjectAssets } {
  const document: DocumentData = structuredClone(chapter.document);
  const assets = new Map<string, string>();
  const remappedSources = new Map<string, string>();
  const ids = new Set<string>();
  for (const other of existing?.chapters ?? []) {
    for (const node of walkDocumentTree(other.document.children)) {
      if ('attrs' in node && 'nodeId' in node.attrs)
        ids.add(String(node.attrs.nodeId));
    }
  }
  for (const node of walkDocumentTree(document.children)) {
    if ('attrs' in node && 'nodeId' in node.attrs) {
      if (ids.has(String(node.attrs.nodeId)))
        node.attrs.nodeId = createNodeId();
      ids.add(String(node.attrs.nodeId));
    }
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    const source = node.attrs.src;
    if (!isLocalProjectImage(source)) continue;
    let next = remappedSources.get(source);
    if (!next) {
      const extension =
        /\.(png|jpe?g|gif|webp|svg)(?:[?#].*)?$/i.exec(source)?.[1] ?? 'png';
      next = `assets/image-${remappedSources.size + 1}.${extension.toLowerCase()}`;
      remappedSources.set(source, next);
      const url = sourceAssets.get(source);
      if (url) assets.set(resolveProjectPath(chapter.file, next), url);
    }
    node.attrs.src = next;
  }
  return { chapter: { ...chapter, document }, assets };
}

export function chapterImagePaths(chapter: ReportChapter): string[] {
  const paths = new Set<string>();
  for (const node of walkDocumentTree(chapter.document.children)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    if (isLocalProjectImage(node.attrs.src))
      paths.add(resolveProjectPath(chapter.file, node.attrs.src));
  }
  return [...paths];
}

export function pruneProjectAssets(
  project: ReportProject,
  assets: ProjectAssets,
): ProjectAssets {
  const used = new Set(project.chapters.flatMap(chapterImagePaths));
  return new Map([...assets].filter(([path]) => used.has(path)));
}
