import {
  ZipReader,
  ZipWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  configure,
  type FileEntry,
} from '@zip.js/zip.js';
import { z } from 'zod';
import type { DocumentMetadata } from '@/src/document/model';
import { migrateDocumentData } from '@/src/document/validation';
import { parseMarkdown } from '@/src/markdown/parser';
import {
  serializeDocument,
  MarkdownSerializationError,
} from '@/src/markdown/serializer';
import type { MarkdownDiagnostic } from '@/src/markdown/diagnostics';
import { registerAssetUrl, revokeAssetUrls } from '@/src/workspace/files';
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

// ZIP work is lazy-loaded. Workers and the fallback codec are bundled locally.
configure({ chunkSize: 16 * 1024, maxWorkers: 2 });
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

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
  const entryLimit = (name: string) =>
    /\.(?:md|markdown|json)$/i.test(name)
      ? projectLimits.sourceBytes
      : projectLimits.fileBytes;
  const reader = new ZipReader(new Uint8ArrayReader(data), {
    strictness: 'strict',
    // Apply our portable-path policy to raw names, without silently repairing them.
    filenameValidation: 'tolerant',
    checkCrc32: true,
    checkOverlappingEntry: true,
  });
  try {
    const entries: FileEntry[] = [];
    const paths = new Set<string>();
    let declaredBytes = 0;
    // Finish validating the complete directory before decompressing any entry.
    for await (const file of reader.getEntriesGenerator()) {
      const name = file.filename;
      const key = safeProjectPath(name.endsWith('/') ? name.slice(0, -1) : name)
        .normalize('NFC')
        .toLowerCase();
      if (paths.has(key)) throw new ReportProjectError('invalidArchive');
      paths.add(key);
      if (paths.size > projectLimits.files)
        throw new ReportProjectError('tooManyFiles');
      if (
        file.encrypted ||
        file.symlink ||
        !Number.isSafeInteger(file.compressedSize) ||
        file.compressedSize < 0 ||
        file.compressedSize > data.byteLength ||
        !Number.isSafeInteger(file.uncompressedSize) ||
        file.uncompressedSize < 0 ||
        (file.compressionMethod !== 0 && file.compressionMethod !== 8) ||
        (file.directory && file.uncompressedSize !== 0)
      )
        throw new ReportProjectError('invalidArchive');
      declaredBytes += file.uncompressedSize;
      if (
        file.uncompressedSize > entryLimit(name) ||
        declaredBytes > projectLimits.expandedBytes
      )
        throw new ReportProjectError('archiveTooLarge');
      if (!file.directory) entries.push(file);
    }

    const files: Record<string, Uint8Array> = Object.create(null);
    let expandedBytes = 0;
    for (const file of entries) {
      const chunks: Uint8Array[] = [];
      let size = 0;
      await file.getData(
        new WritableStream<Uint8Array>({
          write(chunk) {
            size += chunk.byteLength;
            expandedBytes += chunk.byteLength;
            if (
              size > entryLimit(file.filename) ||
              expandedBytes > projectLimits.expandedBytes
            )
              throw new ReportProjectError('archiveTooLarge');
            if (size > file.uncompressedSize)
              throw new ReportProjectError('invalidArchive');
            chunks.push(chunk);
          },
        }),
      );
      if (size !== file.uncompressedSize)
        throw new ReportProjectError('invalidArchive');
      const result = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      files[file.filename] = result;
    }
    return files;
  } catch (error) {
    if (error instanceof ReportProjectError) throw error;
    throw new ReportProjectError('invalidArchive');
  } finally {
    await reader.close();
  }
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
    return decoder.decode(entry);
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
      const blob = new Blob([bytes], { type: imageMime(path) });
      assets.set(path, registerAssetUrl(URL.createObjectURL(blob), blob.size));
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
  const images = new Set(project.chapters.flatMap(chapterImagePaths));
  const pathKey = (path: string) =>
    safeProjectPath(path).normalize('NFC').toLowerCase();
  const reserved = new Set(
    [
      projectFileName,
      ...project.chapters.map((chapter) => chapter.file),
      ...images,
    ].map(pathKey),
  );
  const written = new Set<string>();
  let total = 0;
  const addEntry = (path: string, value: Uint8Array, source = false) => {
    const key = pathKey(path);
    if (written.has(key)) throw new ReportProjectError('invalidArchive');
    if (
      value.byteLength >
      (source ? projectLimits.sourceBytes : projectLimits.fileBytes)
    )
      throw new ReportProjectError('archiveTooLarge');
    total += value.byteLength;
    if (total > projectLimits.expandedBytes)
      throw new ReportProjectError('archiveTooLarge');
    written.add(key);
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
        const stem = file.replace(/\.(?:md|markdown)$/i, '');
        let suffix = 1;
        do {
          file = `${stem}${suffix === 1 ? '' : `-${suffix}`}.json`;
          suffix++;
        } while (reserved.has(pathKey(file)));
        reserved.add(pathKey(file));
        source = JSON.stringify(chapter.document, null, 2) + '\n';
      }
    }
    manifest.chapters[index].file = file;
    addEntry(file, encoder.encode(source), true);
  }
  for (const path of images) {
    const url = assets.get(path);
    if (!url?.startsWith('blob:'))
      throw new ReportProjectError('missingImage', path);
    const response = await fetch(url);
    if (!response.ok) throw new ReportProjectError('missingImage', path);
    addEntry(path, new Uint8Array(await response.arrayBuffer()));
  }
  addEntry(
    projectFileName,
    encoder.encode(JSON.stringify(manifest, null, 2) + '\n'),
    true,
  );
  if (Object.keys(entries).length > projectLimits.files)
    throw new ReportProjectError('tooManyFiles');
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 6,
    zip64: false,
    dataDescriptor: false,
  });
  try {
    let result: Uint8Array;
    try {
      for (const [name, bytes] of Object.entries(entries)) {
        await writer.add(name, new Uint8ArrayReader(bytes));
      }
    } finally {
      result = await writer.close();
    }
    if (result.byteLength > projectLimits.archiveBytes)
      throw new ReportProjectError('archiveTooLarge');
    return result;
  } catch (error) {
    if (error instanceof ReportProjectError) throw error;
    throw new ReportProjectError('invalidArchive');
  }
}
