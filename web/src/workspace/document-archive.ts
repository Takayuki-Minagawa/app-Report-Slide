import { z } from 'zod';
import type { DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { migrateDocumentData } from '@/src/document/validation';
import { projectLimits, readZip, writeZip } from '@/src/project/archive';
import { ReportProjectError, safeProjectPath } from '@/src/project/model';
import { registerAssetUrl, revokeAssetUrls, type AssetUrls } from './files';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const manifestName = 'manifest.json';
const documentName = 'document.json';
const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  type: z.literal('kumi-document'),
  document: z.literal(documentName),
  images: z.array(
    z.strictObject({ source: z.string().min(1), file: z.string().min(1) }),
  ),
});

function imageMime(source: string): string | undefined {
  const ext = source.split(/[?#]/, 1)[0].split('.').at(-1)?.toLowerCase();
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }[ext ?? ''];
}

function localSources(document: DocumentData): string[] {
  const sources = new Set<string>();
  for (const node of walkDocumentTree(document.children)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    const source = node.attrs.src;
    if (!/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('/'))
      sources.add(source);
  }
  return [...sources];
}

/** The image entries use generated names, so original nested paths and duplicate basenames remain distinct. */
export async function writeDocumentArchive(
  source: DocumentData,
  assets: AssetUrls,
): Promise<Uint8Array> {
  const document = migrateDocumentData(source);
  const entries: Record<string, Uint8Array> = Object.create(null);
  const images: { source: string; file: string }[] = [];
  let total = 0;
  for (const [index, image] of localSources(document).entries()) {
    const mime = imageMime(image);
    const url = assets.get(image);
    if (!mime) throw new ReportProjectError('unsupportedFile', image);
    if (!url?.startsWith('blob:'))
      throw new ReportProjectError('missingImage', image);
    const response = await fetch(url);
    if (!response.ok) throw new ReportProjectError('missingImage', image);
    const bytes = new Uint8Array(await response.arrayBuffer());
    total += bytes.byteLength;
    if (
      bytes.byteLength > projectLimits.fileBytes ||
      total > projectLimits.expandedBytes
    )
      throw new ReportProjectError('archiveTooLarge');
    const extension =
      mime === 'image/jpeg'
        ? 'jpg'
        : mime === 'image/svg+xml'
          ? 'svg'
          : mime.slice(6);
    const file = `assets/${String(index + 1).padStart(4, '0')}.${extension}`;
    entries[file] = bytes;
    images.push({ source: image, file });
  }
  entries[documentName] = encoder.encode(
    JSON.stringify(document, null, 2) + '\n',
  );
  entries[manifestName] = encoder.encode(
    JSON.stringify(
      {
        schemaVersion: 1,
        type: 'kumi-document',
        document: documentName,
        images,
      },
      null,
      2,
    ) + '\n',
  );
  for (const name of [documentName, manifestName]) {
    if (entries[name].byteLength > projectLimits.sourceBytes)
      throw new ReportProjectError('archiveTooLarge');
    total += entries[name].byteLength;
  }
  if (total > projectLimits.expandedBytes)
    throw new ReportProjectError('archiveTooLarge');
  if (Object.keys(entries).length > projectLimits.files)
    throw new ReportProjectError('tooManyFiles');
  return writeZip(entries);
}

/** Validate the full archive before allocating any browser object URLs. */
export async function readDocumentArchive(
  file: File,
): Promise<{ document: DocumentData; assets: AssetUrls }> {
  if (file.size > projectLimits.archiveBytes)
    throw new ReportProjectError('archiveTooLarge');
  const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
  let manifest: z.infer<typeof manifestSchema>;
  let document: DocumentData;
  try {
    manifest = manifestSchema.parse(
      JSON.parse(decoder.decode(entries[manifestName])),
    );
    document = migrateDocumentData(
      JSON.parse(decoder.decode(entries[documentName])),
    );
  } catch {
    throw new ReportProjectError('invalidArchive');
  }
  const expected = new Set([manifestName, documentName]);
  const mapped = new Map<string, string>();
  for (const image of manifest.images) {
    const path = safeProjectPath(image.file);
    if (
      !path.startsWith('assets/') ||
      !imageMime(image.source) ||
      imageMime(image.source) !== imageMime(path)
    )
      throw new ReportProjectError('unsupportedFile', path);
    if (expected.has(path) || mapped.has(image.source) || !entries[path])
      throw new ReportProjectError('invalidArchive');
    expected.add(path);
    mapped.set(image.source, path);
  }
  if (
    localSources(document).some((source) => !mapped.has(source)) ||
    mapped.size !== localSources(document).length ||
    Object.keys(entries).some((path) => !expected.has(path))
  )
    throw new ReportProjectError('invalidArchive');
  const assets = new Map<string, string>();
  try {
    for (const [source, path] of mapped) {
      const bytes = entries[path];
      const blob = new Blob([new Uint8Array(bytes)], { type: imageMime(path) });
      assets.set(
        source,
        registerAssetUrl(URL.createObjectURL(blob), blob.size),
      );
    }
    return { document, assets };
  } catch (error) {
    revokeAssetUrls(assets);
    throw error;
  }
}
