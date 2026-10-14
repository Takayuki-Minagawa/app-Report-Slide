import {
  createDefaultDocument,
  createNodeId,
  documentTitle,
  type DocumentData,
  type DocumentMetadata,
  type DocumentNode,
  type InlineNode,
  type DocumentType,
  type JsonValue,
} from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import {
  figureReferences,
  type FigureReference,
} from '@/src/document/figure-edit';
import {
  readReaderSupplements,
  syncReaderSupplementPositions,
} from '@/src/document/reader-supplement';
import { documentThemes } from '@/src/document/metadata';
import { splitDocumentPages } from '@/src/document/semantics';
import {
  getSlidePageId,
  readSlidePresets,
  resolveSlideDesign,
  type SlideDesignSettings,
} from '@/src/document/slide-design';
import { slideNavigationPages } from '@/src/document/slide-navigation';
import { walkDocumentTree } from '@/src/document/traversal';
import { readBlockLibrary } from '@/src/document/block-library';
import { preservedContent } from '@/src/document/preserved-content';
import { readBlockLayout } from '@/src/document/block-layout';

export const projectFileName = 'project.json';
export const maximumProjectChapters = 100;

export interface ReportChapter {
  id: string;
  title: string;
  file: string;
  enabled: boolean;
  pageBreakBefore: boolean;
  themeOverride?: string;
  document: DocumentData;
}

export interface ReportProject {
  schemaVersion: 1;
  type: 'kumi-report-project' | 'kumi-slide-project';
  metadata: DocumentMetadata;
  chapters: ReportChapter[];
}

export interface ProjectManifestChapter {
  id: string;
  title: string;
  file: string;
  enabled: boolean;
  pageBreakBefore: boolean;
  themeOverride?: string;
}

export interface ProjectManifest {
  schemaVersion: 1;
  type: ReportProject['type'];
  metadata: DocumentMetadata;
  chapters: ProjectManifestChapter[];
}

export type ProjectAssets = ReadonlyMap<string, string>;
export type DocumentProject = ReportProject;
export type DocumentChapter = ReportChapter;

export function projectDocumentType(
  project: Pick<ReportProject, 'type'>,
): DocumentType {
  return project.type === 'kumi-slide-project' ? 'slide' : 'report';
}

/** A chapter keeps local IDs and metadata; inheritance is resolved only for display/export. */
export function projectChapterDocument(
  project: ReportProject,
  chapter: ReportChapter,
): DocumentData {
  const sharedSettings: DocumentMetadata = {};
  for (const key of [
    'page_settings',
    'paper',
    'orientation',
    'toc',
    'number_sections',
    'aspect_ratio',
    'slide_number',
  ]) {
    if (project.metadata[key] !== undefined) {
      sharedSettings[key] = project.metadata[key];
    }
  }
  const theme =
    chapter.themeOverride ??
    project.metadata.theme ??
    chapter.document.metadata.theme;
  return {
    ...chapter.document,
    metadata: {
      ...chapter.document.metadata,
      ...sharedSettings,
      ...(theme ? { theme } : {}),
      ...(project.metadata.figure_references !== undefined
        ? { figure_references: project.metadata.figure_references }
        : {}),
    },
  };
}

export class ReportProjectError extends Error {
  constructor(
    readonly code:
      | 'invalidArchive'
      | 'unsafePath'
      | 'archiveTooLarge'
      | 'tooManyFiles'
      | 'missingFile'
      | 'missingImage'
      | 'unsupportedFile'
      | 'reportOnly'
      | 'lastChapter',
    readonly detail = '',
  ) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}

export function createChapterId(): string {
  return `chapter-${createNodeId()}`;
}

export function safeProjectPath(value: string): string {
  const path = value;
  const segments = path.split('/');
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path) ||
    /[\\:*?"<>|#]/.test(path) ||
    path
      .split('')
      .some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[. ]$/.test(segment) ||
        /^(?:__proto__|constructor|prototype|con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
          segment,
        ),
    )
  )
    throw new ReportProjectError('unsafePath', value);
  return path;
}

export function resolveProjectPath(file: string, source: string): string {
  let cleanSource: string;
  try {
    cleanSource = decodeURIComponent(source.trim().split(/[?#]/, 1)[0]).replace(
      /\\/g,
      '/',
    );
  } catch {
    throw new ReportProjectError('unsafePath', source);
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(cleanSource) || cleanSource.startsWith('/'))
    throw new ReportProjectError('unsafePath', source);
  const stack = safeProjectPath(file).split('/');
  stack.pop();
  for (const part of cleanSource.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0)
        throw new ReportProjectError('unsafePath', source);
      stack.pop();
    } else stack.push(part);
  }
  return safeProjectPath(stack.join('/'));
}

export function isLocalProjectImage(source: string): boolean {
  const value = source.trim();
  return !/^[a-z][a-z\d+.-]*:/i.test(value) && !value.startsWith('/');
}

function sameFigureReference(a: FigureReference, b: FigureReference): boolean {
  return (
    a.title === b.title &&
    a.authors === b.authors &&
    a.year === b.year &&
    a.url === b.url &&
    (a.summary ?? '') === (b.summary ?? '') &&
    (a.pdfUrl ?? '') === (b.pdfUrl ?? '')
  );
}

function remapFigureReferenceIds(
  node: DocumentNode | InlineNode,
  ids: ReadonlyMap<string, string>,
): DocumentNode | InlineNode {
  let result = node;
  if (
    node.type === 'table' &&
    node.attrs.sourceReferenceId &&
    ids.has(node.attrs.sourceReferenceId)
  )
    result = {
      ...node,
      attrs: {
        ...node.attrs,
        sourceReferenceId: ids.get(node.attrs.sourceReferenceId)!,
      },
    };
  if (
    node.type === 'chart' &&
    node.attrs.plot?.referenceId &&
    ids.has(node.attrs.plot.referenceId)
  )
    result = {
      ...node,
      attrs: {
        ...node.attrs,
        plot: {
          ...node.attrs.plot,
          referenceId: ids.get(node.attrs.plot.referenceId)!,
        },
      },
    };
  if (node.type === 'figure' && node.attrs.figureEdit?.source) {
    const source = node.attrs.figureEdit.source;
    const referenceId = ids.get(source.referenceId);
    if (referenceId && referenceId !== source.referenceId)
      result = {
        ...node,
        attrs: {
          ...node.attrs,
          figureEdit: {
            ...node.attrs.figureEdit,
            source: { ...source, referenceId },
          },
        },
      };
  }
  if ('content' in result && result.content)
    result = {
      ...result,
      content: result.content.map((child) =>
        remapFigureReferenceIds(child, ids),
      ),
    } as typeof result;
  return result;
}

function libraryReferences(
  metadata: DocumentMetadata,
  references: FigureReference[],
  ids: ReadonlyMap<string, string> = new Map(),
): DocumentMetadata {
  if (metadata.block_library === undefined) return metadata;
  return {
    ...metadata,
    block_library: {
      version: 1,
      items: readBlockLibrary(metadata).items.map((item) => ({
        ...item,
        nodes: item.nodes.map((node) =>
          remapFigureReferenceIds(node, ids),
        ) as DocumentNode[],
        ...(item.references
          ? {
              references: item.references.map(
                (reference) =>
                  references.find(
                    (entry) =>
                      entry.id === (ids.get(reference.id) ?? reference.id),
                  ) ?? reference,
              ),
            }
          : {}),
      })),
    } as unknown as JsonValue,
  };
}

/** Imported chapters may reuse a reference ID for another publication. Preserve both explicitly. */
function normalizeProjectFigureReferences(
  project: ReportProject,
): ReportProject {
  const catalog = new Map(
    figureReferences(project.metadata).map((reference) => [
      reference.id,
      reference,
    ]),
  );
  const chapters = project.chapters.map((chapter) => {
    const ids = new Map<string, string>();
    for (const reference of figureReferences(chapter.document.metadata)) {
      let id = reference.id;
      const existing = catalog.get(id);
      if (existing && !sameFigureReference(existing, reference)) {
        const base = `${chapter.id.slice(0, 60)}:${reference.id.slice(0, 60)}`;
        id = base;
        let suffix = 2;
        while (
          catalog.has(id) &&
          !sameFigureReference(catalog.get(id)!, reference)
        )
          id = `${base}:${suffix++}`;
      }
      ids.set(reference.id, id);
      if (!catalog.has(id)) catalog.set(id, { ...reference, id });
    }
    return ids.size
      ? {
          ...chapter,
          document: {
            ...chapter.document,
            metadata: libraryReferences(
              chapter.document.metadata,
              [...catalog.values()],
              ids,
            ),
            children: chapter.document.children.map((node) =>
              remapFigureReferenceIds(node, ids),
            ) as DocumentNode[],
          },
        }
      : chapter;
  });
  if (!catalog.size && project.metadata.figure_references === undefined)
    return project;
  const references = [...catalog.values()];
  return {
    ...project,
    metadata: { ...project.metadata, figure_references: references },
    chapters: chapters.map((chapter) => ({
      ...chapter,
      document: {
        ...chapter.document,
        metadata: {
          ...libraryReferences(chapter.document.metadata, references),
          figure_references: references,
        },
      },
    })),
  };
}

/** An edit to a shared project reference updates every chapter without changing its identity. */
export function updateReportProjectDocument(
  project: ReportProject,
  chapterId: string,
  document: DocumentData,
): ReportProject {
  const catalog = new Map(
    figureReferences(project.metadata).map((reference) => [
      reference.id,
      reference,
    ]),
  );
  for (const reference of figureReferences(document.metadata))
    catalog.set(reference.id, reference);
  const references = [...catalog.values()];
  const hasReferences =
    references.length > 0 ||
    project.metadata.figure_references !== undefined ||
    document.metadata.figure_references !== undefined;
  return {
    ...project,
    metadata: hasReferences
      ? { ...project.metadata, figure_references: references }
      : project.metadata,
    chapters: project.chapters.map((chapter) => {
      const edited = chapter.id === chapterId ? document : chapter.document;
      return {
        ...chapter,
        document: hasReferences
          ? {
              ...edited,
              metadata: {
                ...libraryReferences(edited.metadata, references),
                figure_references: references,
              },
            }
          : edited,
      };
    }),
  };
}

export function appendReportProjectChapter(
  project: ReportProject,
  chapter: ReportChapter,
): ReportProject {
  if (project.type === 'kumi-slide-project') {
    chapter = structuredClone(chapter);
    const reserved = new Set(
      project.chapters.flatMap((entry) =>
        [...walkDocumentTree(entry.document.children)].flatMap((node) =>
          'attrs' in node &&
          'label' in node.attrs &&
          typeof node.attrs.label === 'string'
            ? [node.attrs.label]
            : [],
        ),
      ),
    );
    const labels = new Map<string, string>();
    for (const node of walkDocumentTree(chapter.document.children)) {
      if (
        !('attrs' in node) ||
        !('label' in node.attrs) ||
        typeof node.attrs.label !== 'string' ||
        !node.attrs.label
      )
        continue;
      if (reserved.has(node.attrs.label)) {
        const old = node.attrs.label;
        const next = `chapter:${createNodeId()}`;
        labels.set(old, next);
        node.attrs.label = next;
      }
    }
    for (const node of walkDocumentTree(chapter.document.children))
      if (node.type === 'reference' && labels.has(node.attrs.target))
        node.attrs.target = labels.get(node.attrs.target)!;
  }
  return normalizeProjectFigureReferences({
    ...project,
    chapters: [...project.chapters, chapter],
  });
}

function assembleChapterNode(
  node: DocumentNode | InlineNode,
  chapter: ReportChapter,
  groupIds?: ReadonlyMap<string, string>,
): DocumentNode | InlineNode {
  if (!groupIds) {
    const ids = new Map<string, string>();
    const nodes = [
      ...chapter.document.children,
      ...readBlockLibrary(chapter.document.metadata).items.flatMap(
        (item) => item.nodes,
      ),
    ];
    for (const entry of walkDocumentTree(nodes)) {
      const id =
        'attrs' in entry && 'blockLayout' in entry.attrs
          ? readBlockLayout(entry.attrs.blockLayout).groupId
          : undefined;
      if (id && !ids.has(id)) ids.set(id, `${chapter.id}:group-${ids.size}`);
    }
    groupIds = ids;
  }
  let result = node;
  // IDs are chapter-local in source files, including pasted and reused JSON.
  // Only the assembled document needs a project-wide namespace.
  if ('attrs' in node && 'nodeId' in node.attrs) {
    result = {
      ...node,
      attrs: { ...node.attrs, nodeId: `${chapter.id}:${node.attrs.nodeId}` },
    } as typeof node;
  }
  if ('attrs' in result && 'blockLayout' in result.attrs) {
    const layout = readBlockLayout(result.attrs.blockLayout);
    if (layout.groupId)
      result = {
        ...result,
        attrs: {
          ...result.attrs,
          blockLayout: {
            ...layout,
            groupId: groupIds.get(layout.groupId) ?? layout.groupId,
          },
        },
      } as typeof result;
  }
  if (node.type === 'figure' || node.type === 'inlineImage') {
    let source = node.attrs.src;
    if (isLocalProjectImage(source)) {
      try {
        source = resolveProjectPath(chapter.file, source);
      } catch {
        // Preserve invalid draft input for the renderer's safe URL handling.
      }
    }
    result = {
      ...result,
      attrs: { ...('attrs' in result ? result.attrs : {}), src: source },
    } as typeof node;
    if (result.type === 'figure' && result.attrs.figureEdit?.pdfSource) {
      result = {
        ...result,
        attrs: {
          ...result.attrs,
          figureEdit: {
            ...result.attrs.figureEdit,
            pdfSource: {
              ...result.attrs.figureEdit.pdfSource,
              asset: resolveProjectPath(
                chapter.file,
                result.attrs.figureEdit.pdfSource.asset,
              ),
            },
          },
        },
      };
    }
  }
  if ('content' in result && result.content) {
    result = {
      ...result,
      content: result.content.map((child) =>
        assembleChapterNode(child, chapter, groupIds),
      ),
    } as DocumentNode | InlineNode;
  }
  return result;
}

function assembleChapterDocument(chapter: ReportChapter): DocumentData {
  return {
    ...chapter.document,
    children: chapter.document.children.map((node) =>
      assembleChapterNode(node, chapter),
    ) as DocumentNode[],
  };
}

export function validateReportProject(project: ReportProject): ReportProject {
  if (
    project.schemaVersion !== 1 ||
    !['kumi-report-project', 'kumi-slide-project'].includes(project.type) ||
    !Array.isArray(project.chapters) ||
    project.chapters.length === 0 ||
    project.chapters.length > maximumProjectChapters
  )
    throw new ReportProjectError('invalidArchive');
  const ids = new Set<string>();
  const files = new Set<string>();
  const chapters = project.chapters.map((original) => {
    const chapter = { ...original };
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(chapter.id) ||
      typeof chapter.title !== 'string' ||
      !chapter.title.trim() ||
      chapter.title.length > 120 ||
      typeof chapter.enabled !== 'boolean' ||
      typeof chapter.pageBreakBefore !== 'boolean'
    )
      throw new ReportProjectError('invalidArchive');
    if (
      chapter.themeOverride !== undefined &&
      !documentThemes[projectDocumentType(project)].some(
        ([theme]) => theme === chapter.themeOverride,
      )
    )
      throw new ReportProjectError('invalidArchive');
    chapter.file = safeProjectPath(chapter.file);
    if (!/\.(?:md|markdown|json)$/i.test(chapter.file))
      throw new ReportProjectError('unsupportedFile', chapter.file);
    const fileKey = chapter.file.normalize('NFC').toLowerCase();
    if (
      ids.has(chapter.id) ||
      files.has(fileKey) ||
      fileKey === projectFileName
    )
      throw new ReportProjectError('invalidArchive');
    ids.add(chapter.id);
    files.add(fileKey);
    chapter.document = migrateDocumentData(chapter.document);
    if (chapter.document.type !== projectDocumentType(project))
      throw new ReportProjectError('reportOnly');
    return chapter;
  });
  const result = { ...project, chapters };
  // Reuse document validation for project-level metadata as well.
  migrateDocumentData({
    schemaVersion: 2,
    type: projectDocumentType(project),
    metadata: project.metadata,
    children: project.chapters[0].document.children,
  });
  return normalizeProjectFigureReferences(result);
}

export function manifestFromProject(project: ReportProject): ProjectManifest {
  return {
    schemaVersion: 1,
    type: project.type,
    metadata: project.metadata,
    chapters: project.chapters.map(
      ({ document: _document, ...chapter }) => chapter,
    ),
  };
}

export function createReportProject(document: DocumentData): ReportProject {
  if (document.type !== 'report') throw new ReportProjectError('reportOnly');
  return createDocumentProject(document);
}

export function createDocumentProject(document: DocumentData): ReportProject {
  const report = migrateDocumentData(document);
  const id = createChapterId();
  return normalizeProjectFigureReferences({
    schemaVersion: 1,
    type:
      report.type === 'slide' ? 'kumi-slide-project' : 'kumi-report-project',
    metadata: { ...report.metadata },
    chapters: [
      {
        id,
        title: documentTitle(report).slice(0, 120),
        file: `chapters/${id}/document.md`,
        enabled: true,
        pageBreakBefore: false,
        document: report,
      },
    ],
  });
}

export function createBlankChapter(
  index: number,
  title = `Chapter ${index}`,
  type: DocumentType = 'report',
): ReportChapter {
  const id = createChapterId();
  const document = createDefaultDocument(type);
  document.metadata.title = title;
  document.children = [
    {
      type: 'heading',
      attrs: { nodeId: createNodeId(), level: 1 },
      content: [{ type: 'text', text: title }],
    },
    { type: 'paragraph', attrs: { nodeId: createNodeId() } },
  ];
  return {
    id,
    title,
    file: `chapters/${id}/document.md`,
    enabled: true,
    pageBreakBefore: index > 1,
    document,
  };
}

export function assembleReportProject(project: ReportProject): DocumentData {
  const normalized = normalizeProjectFigureReferences(project);
  const chapters = normalized.chapters.filter((chapter) => chapter.enabled);
  const children: DocumentNode[] = [];
  const slide = projectDocumentType(project) === 'slide';
  const tocPages =
    slide && project.metadata.project_toc === true
      ? Math.ceil(chapters.length / 12)
      : 0;
  const pageEntries: SlideDesignSettings['pages'] = [];
  const chapterStarts = new Map<string, number>();
  let offset = tocPages;
  if (tocPages) {
    for (let page = 0; page < tocPages; page++) {
      if (page)
        children.push({
          type: 'slideBreak',
          attrs: { nodeId: `project-toc-break-${page}` },
        });
      children.push({
        type: 'heading',
        attrs: { nodeId: `project-toc-${page}`, level: 1 },
        content: [{ type: 'text', text: 'Contents / 目次' }],
      });
      for (const chapter of chapters.slice(page * 12, (page + 1) * 12)) {
        const first = chapter.document.children.find(
          (node) => node.type !== 'slideBreak' && node.type !== 'pageBreak',
        );
        children.push({
          type: 'paragraph',
          attrs: { nodeId: `project-toc-entry-${chapter.id}` },
          content: [
            {
              type: 'text',
              text: chapter.title,
              ...(first
                ? {
                    marks: [
                      {
                        type: 'link' as const,
                        attrs: {
                          href: `#kumi-${chapter.id}:${first.attrs.nodeId}`,
                        },
                      },
                    ],
                  }
                : {}),
            },
          ],
        });
      }
    }
  }
  chapters.forEach((chapter, index) => {
    if (
      (index > 0 && (slide || chapter.pageBreakBefore)) ||
      (slide && index === 0 && tocPages > 0)
    ) {
      children.push({
        type: slide ? 'slideBreak' : 'pageBreak',
        attrs: { nodeId: `project-break-${chapter.id}` },
      });
    }
    chapterStarts.set(chapter.id, offset);
    children.push(...assembleChapterDocument(chapter).children);
    if (slide) {
      const local = projectChapterDocument(normalized, chapter);
      splitDocumentPages(local).forEach((_, pageIndex) => {
        const design = resolveSlideDesign(local, pageIndex);
        pageEntries.push({
          pageId: `${chapter.id}:${getSlidePageId(local, pageIndex)}`,
          pageIndex: offset + pageIndex,
          design: {
            ...design,
            ...(design.composite
              ? {
                  composite: {
                    ...design.composite,
                    assignments: design.composite.assignments.map((entry) => ({
                      ...entry,
                      nodeId: `${chapter.id}:${entry.nodeId}`,
                    })),
                  },
                }
              : {}),
          },
        });
      });
      offset += splitDocumentPages(local).length;
    }
  });
  if (children.length === 0)
    children.push({ type: 'paragraph', attrs: { nodeId: 'project-empty' } });
  const document: DocumentData = {
    schemaVersion: 2,
    type: projectDocumentType(project),
    metadata: { ...normalized.metadata },
    children,
  };
  if (slide) {
    delete document.metadata.toc;
    delete document.metadata.slide_design;
    document.metadata.slide_design = {
      version: 1,
      pages: pageEntries.map((entry) => ({
        ...entry,
        pageId: splitDocumentPages(document)[entry.pageIndex]?.some(
          (node) => node.attrs.nodeId === entry.pageId,
        )
          ? entry.pageId
          : getSlidePageId(document, entry.pageIndex),
      })),
    };
    const presets = chapters.flatMap((chapter) =>
      readSlidePresets(chapter.document.metadata).items.map((item, index) => ({
        ...item,
        id: `${chapter.id}:preset-${index}`,
        design: {
          ...item.design,
          ...(item.design.composite
            ? {
                composite: {
                  ...item.design.composite,
                  assignments: item.design.composite.assignments.map(
                    (entry) => ({
                      ...entry,
                      nodeId: `${chapter.id}:${entry.nodeId}`,
                    }),
                  ),
                },
              }
            : {}),
        },
      })),
    );
    delete document.metadata.slide_presets;
    if (presets.length)
      document.metadata.slide_presets = { version: 1, items: presets };
  }
  const libraries = chapters.flatMap((chapter) =>
    readBlockLibrary(chapter.document.metadata).items.map((item, index) => ({
      ...item,
      id: `${chapter.id}:library-${index}`,
      nodes: item.nodes.map((node) =>
        assembleChapterNode(node, chapter),
      ) as DocumentNode[],
      ...(item.composite
        ? {
            composite: {
              ...item.composite,
              assignments: item.composite.assignments.map((entry) => ({
                ...entry,
                nodeId: `${chapter.id}:${entry.nodeId}`,
              })),
            },
          }
        : {}),
    })),
  );
  delete document.metadata.block_library;
  if (libraries.length)
    document.metadata.block_library = {
      version: 1,
      items: libraries,
    } as unknown as JsonValue;
  const preserved = chapters.flatMap((chapter) =>
    preservedContent(chapter.document.metadata).map((entry, index) => ({
      ...entry,
      id: `${chapter.id}:preserved-${index}`,
      ...(entry.nodeId ? { nodeId: `${chapter.id}:${entry.nodeId}` } : {}),
      ...(entry.assets
        ? {
            assets: entry.assets.map((asset) => ({
              ...asset,
              source: isLocalProjectImage(asset.source)
                ? resolveProjectPath(chapter.file, asset.source)
                : asset.source,
            })),
          }
        : {}),
    })),
  );
  delete document.metadata.preserved_content;
  if (preserved.length) document.metadata.preserved_content = preserved;
  const supplements = chapters.flatMap((chapter) =>
    readReaderSupplements(chapter.document.metadata).pages.map((entry) => ({
      ...entry,
      pageId: `${chapter.id}:${entry.pageId}`,
      ...(slide
        ? { pageIndex: (chapterStarts.get(chapter.id) ?? 0) + entry.pageIndex }
        : {}),
      ...(entry.anchorIds
        ? { anchorIds: entry.anchorIds.map((id) => `${chapter.id}:${id}`) }
        : {}),
      // Chapter-local positions may collide. Resolve every entry against the assembled content below.
      orphaned: true,
    })),
  );
  // Chapter-local supplements are the source of truth; the project metadata may contain a stale creation-time copy.
  delete document.metadata.reader_supplements;
  if (supplements.length)
    document.metadata.reader_supplements = {
      version: 1,
      pages: supplements,
    };
  document.metadata = syncReaderSupplementPositions(document);
  return document;
}

export const validateDocumentProject = validateReportProject;
export const assembleDocumentProject = assembleReportProject;

export function projectSlidePages(project: ReportProject) {
  let globalPageIndex =
    project.metadata.project_toc === true
      ? Math.ceil(
          project.chapters.filter((chapter) => chapter.enabled).length / 12,
        )
      : 0;
  return project.chapters.flatMap((chapter) =>
    slideNavigationPages(chapter.document, 'ja').map((page) => ({
      ...page,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      enabled: chapter.enabled,
      globalPageIndex: chapter.enabled ? globalPageIndex++ : null,
    })),
  );
}

export function projectTitle(project: ReportProject): string {
  const title = project.metadata.title;
  return typeof title === 'string' && title.trim() ? title : 'report-project';
}
