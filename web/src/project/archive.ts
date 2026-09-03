import { unzip, zip, strFromU8, strToU8 } from 'fflate';
import { z } from 'zod';
import type { DocumentMetadata } from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  serializeDocument,
  MarkdownSerializationError,
} from '@/src/markdown/serializer';
import type { MarkdownDiagnostic } from '@/src/markdown/diagnostics';
import { revokeAssetUrls } from '@/src/workspace/files';
import { chapterImagePaths } from './assets';
import {
  projectFileName,
  maximumProjectChapters,
  manifestFromProject,
  validateReportProject,
  safeProjectPath,
  ReportProjectError,
  type ReportProject,
  type ProjectAssets,
} from './model';

export const projectLimits = {
  archiveBytes: 60 * 1024 * 1024,
  expandedBytes: 50 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  sourceBytes: 5 * 1024 * 1024,
  files: 300,
} as const;

const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.literal('kumi-report-project'),
    metadata: z.record(z.string(), z.unknown()),
    chapters: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string(),
            file: z.string(),
            enabled: z.boolean(),
            pageBreakBefore: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(maximumProjectChapters),
  })
  .strict();

function imageMime(path: string): string | undefined {
  const extension = path.split('.').at(-1)?.toLowerCase();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    } as Record<string, string>
  )[extension ?? ''];
}

async function readZip(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  if (data.byteLength > projectLimits.archiveBytes)
    throw new ReportProjectError('archiveTooLarge');
  let failure: ReportProjectError | undefined;
  let total = 0;
  const paths = new Set<string>();
  const files = await new Promise<Record<string, Uint8Array>>(
    (resolve, reject) => {
      unzip(
        data,
        {
          filter(file) {
            try {
              const directory = file.name.endsWith('/');
              const path = safeProjectPath(
                directory ? file.name.slice(0, -1) : file.name,
              )
                .normalize('NFC')
                .toLowerCase();
              if (paths.has(path))
                throw new ReportProjectError('invalidArchive');
              paths.add(path);
              if (paths.size > projectLimits.files)
                throw new ReportProjectError('tooManyFiles');
              total += file.originalSize;
              if (
                file.originalSize > projectLimits.fileBytes ||
                total > projectLimits.expandedBytes
              )
                throw new ReportProjectError('archiveTooLarge');
              if (directory) return false;
              return !failure;
            } catch (error) {
              failure =
                error instanceof ReportProjectError
                  ? error
                  : new ReportProjectError('invalidArchive');
              return false;
            }
          },
        },
        (error, result) => {
          if (failure) reject(failure);
          else if (error) reject(new ReportProjectError('invalidArchive'));
          else resolve(result);
        },
      );
    },
  );
  const size = Object.values(files).reduce(
    (sum, entry) => sum + entry.byteLength,
    0,
  );
  if (
    size > projectLimits.expandedBytes ||
    Object.values(files).some(
      (entry) => entry.byteLength > projectLimits.fileBytes,
    )
  )
    throw new ReportProjectError('archiveTooLarge');
  return files;
}

export interface ImportedProject {
  project: ReportProject;
  assets: ProjectAssets;
  diagnostics: MarkdownDiagnostic[];
}

/** Validate every chapter and attachment before allocating browser-owned image URLs. */
export async function readReportProject(file: File): Promise<ImportedProject> {
  if (file.size > projectLimits.archiveBytes)
    throw new ReportProjectError('archiveTooLarge');
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  const getSource = (path: string) => {
    const entry = entries[safeProjectPath(path)];
    if (!entry) throw new ReportProjectError('missingFile', path);
    if (entry.byteLength > projectLimits.sourceBytes)
      throw new ReportProjectError('archiveTooLarge');
    return strFromU8(entry);
  };
  let manifest;
  try {
    manifest = manifestSchema.parse(JSON.parse(getSource(projectFileName)));
  } catch (error) {
    if (error instanceof ReportProjectError) throw error;
    throw new ReportProjectError('invalidArchive');
  }
  const diagnostics: MarkdownDiagnostic[] = [];
  const project = validateReportProject({
    ...manifest,
    metadata: manifest.metadata as DocumentMetadata,
    chapters: manifest.chapters.map((chapter) => {
      const source = getSource(chapter.file);
      const parsed = /\.json$/i.test(chapter.file)
        ? { document: migrateDocumentData(JSON.parse(source)), diagnostics: [] }
        : parseMarkdown(source, { fallbackType: 'report' });
      diagnostics.push(...parsed.diagnostics);
      return { ...chapter, document: parsed.document };
    }),
  });
  const sources = new Set([
    projectFileName,
    ...project.chapters.map((chapter) => chapter.file),
  ]);
  const images = new Set(project.chapters.flatMap(chapterImagePaths));
  for (const path of images) {
    if (!entries[path]) throw new ReportProjectError('missingImage', path);
    if (!imageMime(path) || sources.has(path))
      throw new ReportProjectError('unsupportedFile', path);
  }
  for (const path of Object.keys(entries)) {
    if (!sources.has(path) && !images.has(path))
      throw new ReportProjectError('unsupportedFile', path);
  }
  const assets = new Map<string, string>();
  try {
    for (const path of images) {
      const bytes = new Uint8Array(entries[path]);
      assets.set(
        path,
        URL.createObjectURL(new Blob([bytes], { type: imageMime(path) })),
      );
    }
    return { project, assets, diagnostics };
  } catch (error) {
    revokeAssetUrls(assets);
    throw error;
  }
}

/** Included and excluded chapters are both saved; only the combined export filters chapters. */
export async function writeReportProject(
  project: ReportProject,
  assets: ProjectAssets,
): Promise<Uint8Array> {
  validateReportProject(structuredClone(project));
  const entries: Record<string, Uint8Array> = Object.create(null);
  const manifest = manifestFromProject(project);
  let total = 0;
  const addEntry = (path: string, value: Uint8Array, source = false) => {
    safeProjectPath(path);
    if (Object.hasOwn(entries, path))
      throw new ReportProjectError('invalidArchive');
    if (
      value.byteLength >
      (source ? projectLimits.sourceBytes : projectLimits.fileBytes)
    )
      throw new ReportProjectError('archiveTooLarge');
    total += value.byteLength;
    if (total > projectLimits.expandedBytes)
      throw new ReportProjectError('archiveTooLarge');
    entries[path] = value;
  };
  for (let index = 0; index < project.chapters.length; index++) {
    const chapter = project.chapters[index];
    let file = chapter.file;
    let source: string;
    if (/\.json$/i.test(file))
      source = JSON.stringify(chapter.document, null, 2) + '\n';
    else {
      try {
        source = serializeDocument(chapter.document);
      } catch (error) {
        if (!(error instanceof MarkdownSerializationError)) throw error;
        file = file.replace(/\.(?:md|markdown)$/i, '.json');
        source = JSON.stringify(chapter.document, null, 2) + '\n';
      }
    }
    manifest.chapters[index].file = file;
    addEntry(file, strToU8(source), true);
  }
  for (const path of new Set(project.chapters.flatMap(chapterImagePaths))) {
    const url = assets.get(path);
    if (!url?.startsWith('blob:'))
      throw new ReportProjectError('missingImage', path);
    const response = await fetch(url);
    if (!response.ok) throw new ReportProjectError('missingImage', path);
    addEntry(path, new Uint8Array(await response.arrayBuffer()));
  }
  addEntry(
    projectFileName,
    strToU8(JSON.stringify(manifest, null, 2) + '\n'),
    true,
  );
  if (Object.keys(entries).length > projectLimits.files)
    throw new ReportProjectError('tooManyFiles');
  return new Promise((resolve, reject) => {
    zip(entries, { level: 1 }, (error, result) => {
      if (error) reject(new ReportProjectError('invalidArchive'));
      else resolve(result);
    });
  });
}
