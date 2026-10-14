import { arrangeRectangles } from './arrange';
import {
  createNodeId,
  type DocumentData,
  type DocumentNode,
  type JsonValue,
} from './model';
import { splitDocumentPages } from './semantics';
import { walkDocumentTree } from './traversal';
import { readBlockLayout, type BlockLayout } from './block-layout';
import { readBlockLibrary, type BlockLibraryItem } from './block-library';
import { figureReferences } from './figure-edit';
import {
  applySlideDesign,
  createSlideComposite,
  getSlidePageId,
  resolveSlideDesign,
  type SlideRegion,
  slideRegions,
} from './slide-design';

const editable = (node: DocumentNode) =>
  !['pageBreak', 'slideBreak', 'speakerNotes'].includes(node.type);
export function selectedGroupNodes(
  document: DocumentData,
  pageIndex: number,
  ids: readonly string[],
): DocumentNode[] {
  const nodes = splitDocumentPages(document)[pageIndex] ?? [];
  const groups = new Set(
    nodes
      .filter((node) => ids.includes(node.attrs.nodeId))
      .map((node) => readBlockLayout(node.attrs.blockLayout).groupId)
      .filter(Boolean),
  );
  return nodes.filter(
    (node) =>
      editable(node) &&
      (ids.includes(node.attrs.nodeId) ||
        groups.has(readBlockLayout(node.attrs.blockLayout).groupId)),
  );
}
export function updateBlockLayouts(
  document: DocumentData,
  page: number,
  ids: readonly string[],
  patch: Partial<BlockLayout>,
): DocumentData {
  const selected = new Set(
    selectedGroupNodes(document, page, ids).map((node) => node.attrs.nodeId),
  );
  return {
    ...document,
    children: document.children.map((node) =>
      selected.has(node.attrs.nodeId)
        ? ({
            ...node,
            attrs: {
              ...node.attrs,
              blockLayout: Object.fromEntries(
                Object.entries({
                  ...readBlockLayout(node.attrs.blockLayout),
                  ...patch,
                }).filter(([, value]) => value !== undefined),
              ),
            },
          } as DocumentNode)
        : node,
    ),
  };
}
export function groupDocumentBlocks(
  document: DocumentData,
  page: number,
  ids: readonly string[],
  name: string,
): DocumentData {
  const nodes = selectedGroupNodes(document, page, ids);
  if (
    nodes.length < 2 ||
    nodes.some((node) => readBlockLayout(node.attrs.blockLayout).locked)
  )
    return document;
  return updateBlockLayouts(document, page, ids, {
    groupId: createNodeId(),
    name: name.slice(0, 120),
  });
}
export function assignBlockRegion(
  document: DocumentData,
  page: number,
  ids: readonly string[],
  region: SlideRegion,
  allowLocked = false,
): DocumentData {
  const selected = selectedGroupNodes(document, page, ids);
  if (
    document.type !== 'slide' ||
    (!allowLocked &&
      selected.some((node) => readBlockLayout(node.attrs.blockLayout).locked))
  )
    return document;
  const design = resolveSlideDesign(document, page);
  const nodes = splitDocumentPages(document)[page] ?? [];
  const composite = design.composite ?? createSlideComposite(nodes);
  const assigned = new Set(selected.map((node) => node.attrs.nodeId));
  const remainder = slideRegions.flatMap((id) =>
    composite.assignments
      .filter((entry) => entry.region === id && !assigned.has(entry.nodeId))
      .sort((a, b) => a.order - b.order)
      .map((entry, order) => ({ ...entry, order })),
  );
  const start = remainder.filter((entry) => entry.region === region).length;
  const moved = document.children.map((node) =>
    assigned.has(node.attrs.nodeId) && node.type === 'figure'
      ? { ...node, attrs: { ...node.attrs, slidePlacement: null } }
      : node,
  ) as DocumentNode[];
  const next = { ...document, children: moved };
  return {
    ...next,
    metadata: applySlideDesign(next, [getSlidePageId(document, page)], {
      ...design,
      layout: 'composite',
      composite: {
        ...composite,
        assignments: [
          ...remainder,
          ...selected.map((node, index) => ({
            nodeId: node.attrs.nodeId,
            nodeIndex: nodes.indexOf(node),
            region,
            order: start + index,
            name: readBlockLayout(node.attrs.blockLayout).name,
          })),
        ],
      },
    }),
  };
}
/** All IDs and internal references are fresh, but source assets and shared citations remain shared. */
export function cloneDocumentBlocks(nodes: readonly DocumentNode[]): {
  nodes: DocumentNode[];
  ids: Map<string, string>;
} {
  const ids = new Map<string, string>();
  const labels = new Map<string, string>();
  const groups = new Map<string, string>();
  for (const node of walkDocumentTree(nodes)) {
    if (
      'attrs' in node &&
      'nodeId' in node.attrs &&
      typeof node.attrs.nodeId === 'string'
    )
      ids.set(node.attrs.nodeId, createNodeId());
    if (
      'attrs' in node &&
      'label' in node.attrs &&
      typeof node.attrs.label === 'string'
    )
      labels.set(node.attrs.label, `copy:${createNodeId()}`);
  }
  const clone = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => {
        if (key === 'nodeId' && typeof entry === 'string')
          return [key, ids.get(entry) ?? entry];
        if ((key === 'label' || key === 'target') && typeof entry === 'string')
          return [key, labels.get(entry) ?? entry];
        if (key === 'groupId' && typeof entry === 'string') {
          if (!groups.has(entry)) groups.set(entry, createNodeId());
          return [key, groups.get(entry)];
        }
        return [key, clone(entry)];
      }),
    );
  };
  return { nodes: clone(nodes) as DocumentNode[], ids };
}
export function duplicateBlockGroup(
  document: DocumentData,
  page: number,
  selection: readonly string[],
): DocumentData {
  const nodes = selectedGroupNodes(document, page, selection);
  if (
    !nodes.length ||
    nodes.some((node) => readBlockLayout(node.attrs.blockLayout).locked)
  )
    return document;
  const copies = cloneDocumentBlocks(nodes);
  const last = Math.max(
    ...nodes.map((node) => document.children.indexOf(node)),
  );
  const children = [
    ...document.children.slice(0, last + 1),
    ...copies.nodes,
    ...document.children.slice(last + 1),
  ];
  const next = { ...document, children };
  if (document.type !== 'slide') return next;
  const design = resolveSlideDesign(document, page);
  if (!design.composite) return next;
  const assignments = slideRegions.flatMap((region) => {
    const entries = design
      .composite!.assignments.filter((entry) => entry.region === region)
      .sort((a, b) => a.order - b.order);
    const copiesInRegion = entries
      .filter((entry) => copies.ids.has(entry.nodeId))
      .map((entry) => ({ ...entry, nodeId: copies.ids.get(entry.nodeId)! }));
    const after =
      Math.max(
        -1,
        ...entries.map((entry, index) =>
          copies.ids.has(entry.nodeId) ? index : -1,
        ),
      ) + 1;
    return [
      ...entries.slice(0, after),
      ...copiesInRegion,
      ...entries.slice(after),
    ].map((entry, order) => ({ ...entry, order }));
  });
  return {
    ...next,
    metadata: applySlideDesign(next, [getSlidePageId(document, page)], {
      ...design,
      composite: { ...design.composite, assignments },
    }),
  };
}
export function moveBlockGroup(
  document: DocumentData,
  page: number,
  selection: readonly string[],
  direction: -1 | 1,
): DocumentData {
  const nodes = selectedGroupNodes(document, page, selection);
  if (
    !nodes.length ||
    nodes.some((node) => readBlockLayout(node.attrs.blockLayout).locked)
  )
    return document;
  const pageNodes = splitDocumentPages(document)[page] ?? [];
  const ids = new Set(nodes.map((node) => node.attrs.nodeId));
  const first = pageNodes.indexOf(nodes[0]);
  const last = pageNodes.indexOf(nodes.at(-1)!);
  const adjacent =
    direction < 0 ? pageNodes.slice(0, first).at(-1) : pageNodes[last + 1];
  if (
    !adjacent ||
    !editable(adjacent) ||
    readBlockLayout(adjacent.attrs.blockLayout).locked
  )
    return document;
  const remaining = document.children.filter(
    (node) => !ids.has(node.attrs.nodeId),
  );
  const neighbors = selectedGroupNodes(document, page, [adjacent.attrs.nodeId]);
  if (neighbors.some((node) => readBlockLayout(node.attrs.blockLayout).locked))
    return document;
  const position =
    direction < 0
      ? Math.min(...neighbors.map((node) => remaining.indexOf(node)))
      : Math.max(...neighbors.map((node) => remaining.indexOf(node))) + 1;
  const next = {
    ...document,
    children: [
      ...remaining.slice(0, position),
      ...nodes,
      ...remaining.slice(position),
    ],
  };
  const design = resolveSlideDesign(document, page);
  if (document.type !== 'slide' || !design.composite) return next;
  const rank = new Map(
    (splitDocumentPages(next)[page] ?? []).map((node, index) => [
      node.attrs.nodeId,
      index,
    ]),
  );
  return {
    ...next,
    metadata: applySlideDesign(next, [getSlidePageId(document, page)], {
      ...design,
      composite: {
        ...design.composite,
        assignments: design.composite.assignments.map((entry) => ({
          ...entry,
          order: rank.get(entry.nodeId) ?? entry.order,
        })),
      },
    }),
  };
}
export function registerBlockLibraryItem(
  document: DocumentData,
  page: number,
  selection: readonly string[],
  name: string,
): DocumentData {
  const nodes = selectedGroupNodes(document, page, selection);
  if (!nodes.length || !name.trim()) return document;
  const library = readBlockLibrary(document.metadata);
  if (library.items.length >= 100)
    throw new Error('登録できる部品は100件までです');
  const ids = new Set(nodes.map((node) => node.attrs.nodeId));
  const design = resolveSlideDesign(document, page);
  const item: BlockLibraryItem = {
    id: createNodeId(),
    name: name.trim().slice(0, 120),
    nodes: JSON.parse(JSON.stringify(nodes)),
    references: figureReferences(document.metadata),
    ...(design.composite
      ? {
          composite: {
            ...design.composite,
            assignments: design.composite.assignments
              .filter((entry) => ids.has(entry.nodeId))
              .map((entry) => ({
                ...entry,
                nodeIndex: nodes.findIndex(
                  (node) => node.attrs.nodeId === entry.nodeId,
                ),
              })),
          },
        }
      : {}),
  };
  return {
    ...document,
    metadata: {
      ...document.metadata,
      block_library: {
        ...library,
        items: [...library.items, item],
      } as unknown as JsonValue,
    },
  };
}
export function insertBlockLibraryItem(
  document: DocumentData,
  page: number,
  item: BlockLibraryItem,
  region?: SlideRegion,
): DocumentData {
  const copied = cloneDocumentBlocks(item.nodes);
  const target = splitDocumentPages(document)[page] ?? [];
  let position = document.children.length;
  let currentPage = 0;
  for (let index = 0; index < document.children.length; index++) {
    const type = document.children[index].type;
    if (
      currentPage === page &&
      (type === 'speakerNotes' || type === 'slideBreak' || type === 'pageBreak')
    ) {
      position = index;
      break;
    }
    if (type === 'slideBreak' || type === 'pageBreak') currentPage++;
  }
  let next: DocumentData = {
    ...document,
    children: [
      ...document.children.slice(0, position),
      ...copied.nodes,
      ...document.children.slice(position),
    ],
  };
  const catalog = new Map((item.references ?? []).map((ref) => [ref.id, ref]));
  for (const ref of figureReferences(document.metadata))
    catalog.set(ref.id, ref);
  next = {
    ...next,
    metadata: { ...next.metadata, figure_references: [...catalog.values()] },
  };
  if (document.type === 'slide' && item.composite && !region) {
    const design = resolveSlideDesign(document, page);
    const existing = design.composite ?? {
      ...item.composite,
      assignments: createSlideComposite(target).assignments,
    };
    const incoming = item.composite.assignments.map((entry) => ({
      ...entry,
      nodeId: copied.ids.get(entry.nodeId)!,
    }));
    const assignments = slideRegions.flatMap((region) =>
      [
        ...existing.assignments
          .filter((entry) => entry.region === region)
          .sort((a, b) => a.order - b.order),
        ...incoming
          .filter((entry) => entry.region === region)
          .sort((a, b) => a.order - b.order),
      ].map((entry, order) => ({ ...entry, order })),
    );
    next.metadata = applySlideDesign(next, [getSlidePageId(next, page)], {
      ...design,
      layout: 'composite',
      composite: { ...existing, assignments },
    });
  }
  return region
    ? assignBlockRegion(
        next,
        page,
        copied.nodes.map((node) => node.attrs.nodeId),
        region,
        true,
      )
    : next;
}

export function arrangeBlockFigures(
  document: DocumentData,
  page: number,
  selection: readonly string[],
  command: import('./arrange').Arrangement,
): DocumentData {
  const nodes = selectedGroupNodes(document, page, selection);
  const rectangles = nodes.flatMap((node) =>
    node.type === 'figure' && node.attrs.slidePlacement
      ? [
          {
            id: node.attrs.nodeId,
            ...node.attrs.slidePlacement,
            ...readBlockLayout(node.attrs.blockLayout),
          },
        ]
      : [],
  );
  const positions = arrangeRectangles(rectangles, command);
  if (!positions.size) return document;
  return {
    ...document,
    children: document.children.map((node) =>
      node.type === 'figure' && positions.has(node.attrs.nodeId)
        ? {
            ...node,
            attrs: {
              ...node.attrs,
              slidePlacement: {
                ...node.attrs.slidePlacement!,
                ...positions.get(node.attrs.nodeId)!,
              },
            },
          }
        : node,
    ) as DocumentNode[],
  };
}
