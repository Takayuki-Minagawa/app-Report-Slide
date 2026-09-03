import {
  createDefaultDocument,
  createNodeId,
  documentTitle,
  type DocumentData,
  type DocumentMetadata,
  type DocumentNode,
  type InlineNode,
} from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import { walkDocumentTree } from '@/src/document/traversal';

export const projectFileName = 'project.json';
export const maximumProjectChapters = 100;

export interface ReportChapter {
  id: string;
  title: string;
  file: string;
  enabled: boolean;
  pageBreakBefore: boolean;
  document: DocumentData;
}

export interface ReportProject {
  schemaVersion: 1;
  type: 'kumi-report-project';
  metadata: DocumentMetadata;
  chapters: ReportChapter[];
}

export interface ProjectManifestChapter {
  id: string;
  title: string;
  file: string;
  enabled: boolean;
  pageBreakBefore: boolean;
}

export interface ProjectManifest {
  schemaVersion: 1;
  type: 'kumi-report-project';
  metadata: DocumentMetadata;
  chapters: ProjectManifestChapter[];
}

export type ProjectAssets = ReadonlyMap<string, string>;

export class ReportProjectError extends Error {
  constructor(
    readonly code:
      | 'invalidArchive'
      | 'unsafePath'
      | 'archiveTooLarge'
      | 'tooManyFiles'
      | 'missingFile'
      | 'missingImage'
      | 'duplicateNodeId'
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
    cleanSource = decodeURIComponent(source.split(/[?#]/, 1)[0]).replace(
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
  return !/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('/');
}

function mapNodeImages(
  node: DocumentNode | InlineNode,
  mapSource: (source: string) => string,
): DocumentNode | InlineNode {
  let result = node;
  if (node.type === 'figure' || node.type === 'inlineImage') {
    result = {
      ...node,
      attrs: { ...node.attrs, src: mapSource(node.attrs.src) },
    } as typeof node;
  }
  if ('content' in result && result.content) {
    result = {
      ...result,
      content: result.content.map((child) => mapNodeImages(child, mapSource)),
    } as DocumentNode | InlineNode;
  }
  return result;
}

export function rebaseChapterDocument(chapter: ReportChapter): DocumentData {
  return {
    ...chapter.document,
    children: chapter.document.children.map((node) =>
      mapNodeImages(node, (source) => {
        if (!isLocalProjectImage(source)) return source;
        try {
          return resolveProjectPath(chapter.file, source);
        } catch {
          return source;
        }
      }),
    ) as DocumentNode[],
  };
}

export function assertProjectNodeIds(project: ReportProject): void {
  const ids = new Set<string>();
  for (const chapter of project.chapters) {
    for (const node of walkDocumentTree(chapter.document.children)) {
      if (!('attrs' in node) || !('nodeId' in node.attrs)) continue;
      const nodeId = String(node.attrs.nodeId);
      if (ids.has(nodeId))
        throw new ReportProjectError('duplicateNodeId', nodeId);
      ids.add(nodeId);
    }
  }
}

export function validateReportProject(project: ReportProject): ReportProject {
  if (
    project.schemaVersion !== 1 ||
    project.type !== 'kumi-report-project' ||
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
    if (chapter.document.type !== 'report')
      throw new ReportProjectError('reportOnly');
    return chapter;
  });
  const result = { ...project, chapters };
  assertProjectNodeIds(result);
  // Reuse document validation for project-level metadata as well.
  migrateDocumentData({
    schemaVersion: 2,
    type: 'report',
    metadata: project.metadata,
    children: project.chapters[0].document.children,
  });
  return result;
}

export function manifestFromProject(project: ReportProject): ProjectManifest {
  return {
    schemaVersion: 1,
    type: 'kumi-report-project',
    metadata: project.metadata,
    chapters: project.chapters.map(
      ({ document: _document, ...chapter }) => chapter,
    ),
  };
}

export function createReportProject(document: DocumentData): ReportProject {
  const report = migrateDocumentData(document);
  if (report.type !== 'report') throw new ReportProjectError('reportOnly');
  const id = createChapterId();
  return {
    schemaVersion: 1,
    type: 'kumi-report-project',
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
  };
}

export function createBlankChapter(
  index: number,
  title = `Chapter ${index}`,
): ReportChapter {
  const id = createChapterId();
  const document = createDefaultDocument('report');
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
  const chapters = project.chapters.filter((chapter) => chapter.enabled);
  const children: DocumentNode[] = [];
  const ids = new Set(
    project.chapters.flatMap((chapter) =>
      [...walkDocumentTree(chapter.document.children)].flatMap((node) =>
        'attrs' in node && 'nodeId' in node.attrs
          ? [String(node.attrs.nodeId)]
          : [],
      ),
    ),
  );
  chapters.forEach((chapter, index) => {
    if (index > 0 && chapter.pageBreakBefore) {
      let nodeId = `${chapter.id}-break`;
      while (ids.has(nodeId)) nodeId += '-break';
      ids.add(nodeId);
      children.push({
        type: 'pageBreak',
        attrs: { nodeId },
      });
    }
    children.push(...rebaseChapterDocument(chapter).children);
  });
  if (children.length === 0)
    children.push({ type: 'paragraph', attrs: { nodeId: 'project-empty' } });
  return {
    schemaVersion: 2,
    type: 'report',
    metadata: { ...project.metadata },
    children,
  };
}

export function projectTitle(project: ReportProject): string {
  const title = project.metadata.title;
  return typeof title === 'string' && title.trim() ? title : 'report-project';
}
