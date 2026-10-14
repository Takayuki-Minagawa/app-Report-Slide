import {
  createNodeId,
  type DocumentData,
  type DocumentNode,
  type JsonValue,
} from '@/src/document/model';
import { splitDocumentPages } from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import {
  getSlidePageId,
  readSlideDesignSettings,
  resolveSlideDesign,
  type SlideDesign,
} from '@/src/document/slide-design';
import {
  readerSupplementForPage,
  unassignedReaderSupplements,
  type ReaderSupplements,
} from '@/src/document/reader-supplement';
import {
  isLocalProjectImage,
  projectChapterDocument,
  resolveProjectPath,
  type ReportProject,
} from './model';
import { readBlockLayout } from '@/src/document/block-layout';

interface SlidePage {
  nodes: DocumentNode[];
  design?: SlideDesign;
  supplement?: ReaderSupplements['pages'][number];
}

function pagesOf(document: DocumentData): SlidePage[] {
  const designs = readSlideDesignSettings(document.metadata);
  return splitDocumentPages(document).map((nodes, index) => ({
    nodes,
    design: designs.pages.find(
      (entry) => entry.pageId === getSlidePageId(document, index),
    )?.design,
    supplement: readerSupplementForPage(document, index),
  }));
}

function withPages(document: DocumentData, pages: SlidePage[]): DocumentData {
  if (!pages.length)
    pages = [
      { nodes: [{ type: 'paragraph', attrs: { nodeId: createNodeId() } }] },
    ];
  const result: DocumentData = {
    ...document,
    metadata: { ...document.metadata },
    children: pages.flatMap((page, index) => [
      ...(index
        ? [{ type: 'slideBreak' as const, attrs: { nodeId: createNodeId() } }]
        : []),
      ...page.nodes,
    ]),
  };
  delete result.metadata.slide_design;
  result.metadata.slide_design = {
    version: 1,
    pages: pages.flatMap((page, pageIndex) =>
      page.design
        ? [
            {
              pageId: getSlidePageId(result, pageIndex),
              pageIndex,
              design: page.design,
            },
          ]
        : [],
    ),
  };
  result.metadata.reader_supplements = {
    version: 1,
    pages: [
      ...unassignedReaderSupplements(document),
      ...pages.flatMap((page, pageIndex) =>
        page.supplement
          ? [
              {
                ...page.supplement,
                pageId:
                  page.nodes[0]?.attrs.nodeId ??
                  getSlidePageId(result, pageIndex),
                pageIndex,
                anchorIds: page.nodes.map((node) => node.attrs.nodeId),
                orphaned: !page.nodes.length,
              },
            ]
          : [],
      ),
    ],
  };
  return result;
}

function clonePage(
  page: SlidePage,
  relabel = true,
): { page: SlidePage; ids: Map<string, string> } {
  const result = structuredClone(page);
  const ids = new Map<string, string>();
  const labels = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const node of walkDocumentTree(result.nodes)) {
    if (!('attrs' in node)) continue;
    if ('blockLayout' in node.attrs) {
      const layout = readBlockLayout(node.attrs.blockLayout);
      if (layout.groupId) {
        if (!groups.has(layout.groupId))
          groups.set(layout.groupId, createNodeId());
        node.attrs.blockLayout = {
          ...layout,
          groupId: groups.get(layout.groupId)!,
        };
      }
    }
    if ('nodeId' in node.attrs) {
      const old = node.attrs.nodeId as string;
      const id = createNodeId();
      ids.set(old, id);
      node.attrs.nodeId = id;
    }
    if (
      relabel &&
      'label' in node.attrs &&
      typeof node.attrs.label === 'string' &&
      node.attrs.label
    ) {
      const old = node.attrs.label;
      const next = `copy:${createNodeId()}`;
      labels.set(old, next);
      node.attrs.label = next;
    }
  }
  for (const node of walkDocumentTree(result.nodes))
    if (node.type === 'reference' && labels.has(node.attrs.target))
      node.attrs.target = labels.get(node.attrs.target)!;
  if (result.design?.composite)
    result.design.composite.assignments =
      result.design.composite.assignments.map((entry) => ({
        ...entry,
        nodeId: ids.get(entry.nodeId) ?? entry.nodeId,
      }));
  return { page: result, ids };
}

/** Includes page design, notes, manual placements and audience supplements. */
export function duplicateSlidePage(
  document: DocumentData,
  pageIndex: number,
): DocumentData {
  const pages = pagesOf(document);
  if (document.type !== 'slide' || !pages[pageIndex]) return document;
  const { page, ids } = clonePage({
    ...pages[pageIndex],
    design: resolveSlideDesign(document, pageIndex),
  });
  pages.splice(pageIndex + 1, 0, page);
  const result = withPages(document, pages);
  if (Array.isArray(document.metadata.preserved_content)) {
    const originals = document.metadata.preserved_content;
    result.metadata.preserved_content = [
      ...originals,
      ...originals.flatMap((entry) =>
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.nodeId === 'string' &&
        ids.has(entry.nodeId)
          ? [{ ...entry, id: createNodeId(), nodeId: ids.get(entry.nodeId)! }]
          : [],
      ),
    ];
  }
  return result;
}

export function moveSlidePage(
  document: DocumentData,
  index: number,
  destination: number,
): DocumentData {
  const pages = pagesOf(document);
  if (
    document.type !== 'slide' ||
    !pages[index] ||
    destination < 0 ||
    destination >= pages.length ||
    destination === index
  )
    return document;
  const [page] = pages.splice(index, 1);
  pages.splice(destination, 0, page);
  return withPages(document, pages);
}

/** Reuses immutable project assets; destination references keep them alive after source deletion. */
export function transferSlidePage(
  project: ReportProject,
  sourceId: string,
  index: number,
  destinationId: string,
  assetCopies: Map<string, string> = new Map(),
): ReportProject {
  const source = project.chapters.find((chapter) => chapter.id === sourceId);
  const destination = project.chapters.find(
    (chapter) => chapter.id === destinationId,
  );
  if (
    !source ||
    !destination ||
    source === destination ||
    source.document.type !== 'slide'
  )
    return project;
  const movedAssets = new Map<string, string>();
  const directory = `assets/moved-${createNodeId()}`;
  const moveAsset = (value: string) => {
    if (!isLocalProjectImage(value)) return value;
    const oldPath = resolveProjectPath(source.file, value);
    let relative = movedAssets.get(oldPath);
    if (!relative) {
      const extension = /\.([a-z0-9]+)$/i.exec(oldPath)?.[1] ?? 'png';
      relative = `${directory}/asset-${movedAssets.size + 1}.${extension}`;
      movedAssets.set(oldPath, relative);
      assetCopies.set(resolveProjectPath(destination.file, relative), oldPath);
    }
    return relative;
  };
  const sourcePages = pagesOf(source.document),
    destinationPages = pagesOf(destination.document);
  if (!sourcePages[index]) return project;
  // Fresh IDs also avoid collisions when two decks were made from the same source JSON.
  const { page, ids } = clonePage(
    {
      ...sourcePages[index],
      design: resolveSlideDesign(
        projectChapterDocument(project, source),
        index,
      ),
    },
    false,
  );
  sourcePages.splice(index, 1);
  for (const node of walkDocumentTree(page.nodes)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    node.attrs.src = moveAsset(node.attrs.src);
    if (node.type === 'figure' && node.attrs.figureEdit?.pdfSource)
      node.attrs.figureEdit.pdfSource.asset = moveAsset(
        node.attrs.figureEdit.pdfSource.asset,
      );
  }
  destinationPages.push(page);
  const nextSource = withPages(source.document, sourcePages),
    nextDestination = withPages(destination.document, destinationPages);
  if (Array.isArray(source.document.metadata.preserved_content)) {
    const moved: JsonValue[] = [],
      retained: JsonValue[] = [];
    for (const entry of source.document.metadata.preserved_content) {
      if (
        entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        typeof entry.nodeId === 'string' &&
        ids.has(entry.nodeId)
      )
        moved.push({
          ...entry,
          id: createNodeId(),
          nodeId: ids.get(entry.nodeId)!,
          ...(Array.isArray(entry.assets)
            ? {
                assets: entry.assets.map((asset) =>
                  asset &&
                  typeof asset === 'object' &&
                  !Array.isArray(asset) &&
                  typeof asset.source === 'string'
                    ? { ...asset, source: moveAsset(asset.source) }
                    : asset,
                ),
              }
            : {}),
        });
      else retained.push(entry);
    }
    nextSource.metadata.preserved_content = retained;
    nextDestination.metadata.preserved_content = [
      ...(Array.isArray(nextDestination.metadata.preserved_content)
        ? nextDestination.metadata.preserved_content
        : []),
      ...moved,
    ];
  }
  return {
    ...project,
    chapters: project.chapters.map((chapter) =>
      chapter === source
        ? { ...chapter, document: nextSource }
        : chapter === destination
          ? { ...chapter, document: nextDestination }
          : chapter,
    ),
  };
}
