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

function assembleChapterNode(
  node: DocumentNode | InlineNode,
  chapter: ReportChapter,
): DocumentNode | InlineNode {
  let result = node;
  // IDs are chapter-local in source files, including pasted and reused JSON.
  // Only the assembled document needs a project-wide namespace.
  if ('attrs' in node && 'nodeId' in node.attrs) {
    result = {
      ...node,
      attrs: { ...node.attrs, nodeId: `${chapter.id}:${node.attrs.nodeId}` },
    } as typeof node;
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
  }
  if ('content' in result && result.content) {
    result = {
      ...result,
      content: result.content.map((child) =>
        assembleChapterNode(child, chapter),
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
  chapters.forEach((chapter, index) => {
    if (index > 0 && chapter.pageBreakBefore) {
      children.push({
        type: 'pageBreak',
        attrs: { nodeId: `project-break-${chapter.id}` },
      });
    }
    children.push(...assembleChapterDocument(chapter).children);
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
