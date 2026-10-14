import { documentTitle, type DocumentData } from '@/src/document/model';
import { localDocumentAssets, type DocumentAsset } from '@/src/document/assets';
import { validatePdfBytes, maximumPdfBytes } from '@/src/document/pdf-source';
import { migrateDocumentData } from '@/src/document/validation';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import type { MarkdownDiagnostic } from '@/src/markdown/diagnostics';
import { WorkspaceStatusError, statusMessage } from './status';
import {
  importHtml,
  maximumHtmlBytes,
  type HtmlImportSummary,
} from './html-import';

/** Runtime-only object URLs must never be serialized into the document. */
export type AssetUrls = ReadonlyMap<string, string>;

const assetSizeByUrl = new Map<string, number>();
const maximumAssetBytes = 20 * 1024 * 1024;
const maximumTotalAssetBytes = 50 * 1024 * 1024;

/** Records a blob URL so local-asset limits stay accurate after document edits. */
export function registerAssetUrl(url: string, bytes: number): string {
  assetSizeByUrl.set(url, bytes);
  return url;
}

/** Returns the byte size of distinct, currently retained local image URLs. */
export function assetByteTotal(urls: AssetUrls): number {
  let total = 0;
  const seen = new Set<string>();
  for (const url of urls.values()) {
    if (seen.has(url)) continue;
    seen.add(url);
    total += assetSizeByUrl.get(url) ?? 0;
  }
  return total;
}

function hasOversizedAsset(urls: AssetUrls): boolean {
  return [...new Set(urls.values())].some(
    (url) => (assetSizeByUrl.get(url) ?? 0) > maximumAssetBytes,
  );
}

export const imageFileAccept =
  'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg';

let insertedAssetSerial = 0;
const validatedPdfFiles = new WeakSet<File>();

function isPdfAsset(file: File): boolean {
  return (
    /^application\/pdf(?:;|$)/i.test(file.type) ||
    (!file.type && /\.pdf$/i.test(file.name))
  );
}

async function validatePdfFile(file: File): Promise<void> {
  if (!isPdfAsset(file)) throw new Error('PDFファイルを選択してください。');
  if (file.size > maximumPdfBytes)
    throw new Error('PDF原本が20 MiBを超えています。');
  validatePdfBytes(
    new Uint8Array(await file.arrayBuffer()),
    file.type || 'application/pdf',
  );
  validatedPdfFiles.add(file);
}

export async function createInsertedPdfAsset(
  file: File,
  assets: AssetUrls,
  occupiedSources: ReadonlySet<string> = new Set(),
  existingAssetBytes = 0,
  resolveSource: (source: string) => string = (source) => source,
): Promise<{ source: string; url: string }> {
  if (existingAssetBytes + file.size > maximumTotalAssetBytes)
    throw new WorkspaceStatusError(statusMessage('imagesTooLarge'));
  await validatePdfFile(file);
  let source: string;
  const stem = Array.from(
    file.name
      .replace(/\.pdf$/i, '')
      .trim()
      .replace(/[\\/:*?"<>|#]/g, '-')
      .replace(/^\.+/, ''),
  ).map((character) =>
    character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ? '-'
      : character,
  );
  let filename = '';
  for (const character of stem) {
    const encoded = encodeURIComponent(character).replace(
      /[!'()*]/g,
      (value) => '%' + value.charCodeAt(0).toString(16).toUpperCase(),
    );
    if (filename.length + encoded.length > 150) break;
    filename += encoded;
  }
  filename = 'source-' + (filename || 'original') + '.pdf';
  do {
    insertedAssetSerial += 1;
    source = `assets/pdf-${insertedAssetSerial}/${filename}`;
  } while (assets.has(resolveSource(source)) || occupiedSources.has(source));
  return {
    source,
    url: registerAssetUrl(
      URL.createObjectURL(new Blob([file], { type: 'application/pdf' })),
      file.size,
    ),
  };
}

export type DocumentFileFormat = 'markdown' | 'json';

function sourceFormat(file: File): DocumentFileFormat | 'html' | undefined {
  if (/\.html?$/i.test(file.name)) return 'html';
  if (/\.json$/i.test(file.name)) return 'json';
  if (/\.(?:md|markdown)$/i.test(file.name)) return 'markdown';
  const mime = file.type.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/json') return 'json';
  if (mime === 'text/markdown') return 'markdown';
  if (mime === 'text/html') return 'html';
  return undefined;
}

function isImageAsset(file: File): boolean {
  return (
    /^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type) ||
    /\.(?:png|jpe?g|webp|gif|svg)$/i.test(file.name)
  );
}

function extensionForImage(file: File): string {
  const extension = /\.(png|jpe?g|webp|gif|svg)$/i.exec(file.name)?.[1];
  if (extension) return extension.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'svg';
}

function encodedAssetFilename(file: File): string | undefined {
  const filename = file.name.trim().replace(/[\\/]/g, '-').replace(/^\.+/, '');
  if (!filename) return undefined;
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Creates an independent local image source for the slide placement picker.
 * The original filename stays in the final path so a Markdown/JSON export can
 * resolve it on a later import, while a generated directory prevents a second
 * selection with the same basename from replacing an earlier figure.
 */
export function createInsertedImageAsset(
  file: File,
  assets: AssetUrls,
  occupiedSources: ReadonlySet<string> = new Set(),
  existingAssetBytes = 0,
  resolveSource: (source: string) => string = (source) => source,
): { source: string; url: string } {
  if (!isImageAsset(file))
    throw new WorkspaceStatusError(
      statusMessage('unsupportedAttachments', file.name),
    );
  if (file.size > maximumAssetBytes)
    throw new WorkspaceStatusError(statusMessage('imageTooLarge'));
  if (existingAssetBytes + file.size > maximumTotalAssetBytes)
    throw new WorkspaceStatusError(statusMessage('imagesTooLarge'));

  const filename =
    encodedAssetFilename(file) ?? 'image.' + extensionForImage(file);
  let source: string;
  do {
    insertedAssetSerial += 1;
    source = 'assets/placed-image-' + insertedAssetSerial + '/' + filename;
  } while (assets.has(resolveSource(source)) || occupiedSources.has(source));
  return {
    source,
    url: registerAssetUrl(URL.createObjectURL(file), file.size),
  };
}
function normalizedAssetPath(value: string): string {
  const path = value.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Invalid percent escapes are kept verbatim for a deterministic mismatch.
  }
  return decoded.replace(/^(?:\.\/)+/, '').replace(/^\/+/, '');
}

function matchesAssetBasename(asset: DocumentAsset, file: File): boolean {
  return (
    normalizedAssetPath(file.name).split('/').at(-1) ===
      normalizedAssetPath(asset.source).split('/').at(-1) ||
    (asset.kind === 'pdf' && file.name === asset.fileName)
  );
}

export function createLocalAssetUrls(
  document: DocumentData,
  files: readonly File[],
  resolvedSources: ReadonlySet<string> = new Set(),
): { urls: AssetUrls; unresolved: string[] } {
  const urls = new Map<string, string>();
  const unresolved: string[] = [];
  const urlByFile = new Map<File, string>();
  const references = localDocumentAssets(document.children);

  try {
    for (const reference of references) {
      const { source, kind } = reference;
      if (resolvedSources.has(source)) continue;
      const normalizedSource = normalizedAssetPath(source);
      const exactMatches = files.filter((file) => {
        const candidate = normalizedAssetPath(
          file.webkitRelativePath || file.name,
        );
        return (
          candidate === normalizedSource ||
          candidate.endsWith(`/${normalizedSource}`)
        );
      });
      const matches =
        exactMatches.length > 0
          ? exactMatches
          : files.filter((file) => matchesAssetBasename(reference, file));

      if (matches.length !== 1) {
        unresolved.push(source);
        continue;
      }
      const file = matches[0];
      // Different original PDFs may share a filename. Only their full relative paths identify them safely.
      if (
        kind === 'pdf' &&
        exactMatches.length === 0 &&
        references.filter(
          (entry) => entry.kind === 'pdf' && matchesAssetBasename(entry, file),
        ).length > 1
      ) {
        unresolved.push(source);
        continue;
      }
      if (kind === 'pdf' && !validatedPdfFiles.has(file))
        throw new Error('PDF原本を検証してから取り込んでください。');
      let url = urlByFile.get(file);
      if (!url) {
        const blob =
          kind === 'pdf' ? new Blob([file], { type: 'application/pdf' }) : file;
        url = registerAssetUrl(URL.createObjectURL(blob), file.size);
        urlByFile.set(file, url);
      }
      urls.set(source, url);
    }
  } catch (error) {
    revokeAssetUrls(urls);
    throw error;
  }
  return { urls, unresolved };
}

export function revokeAssetUrls(urls: AssetUrls): void {
  for (const url of new Set(urls.values())) {
    URL.revokeObjectURL(url);
    assetSizeByUrl.delete(url);
  }
}

export interface ImportedDocument {
  document: DocumentData;
  sourceName: string;
  diagnostics: MarkdownDiagnostic[];
  assets: AssetUrls;
  assetBytes: number;
  unresolved: string[];
  htmlImport?: HtmlImportSummary;
}

/** The caller owns the returned assets and must release them if it discards the result. */
export async function readWorkspaceFiles(
  files: readonly File[],
): Promise<ImportedDocument> {
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const { readDocumentArchive } = await import('./document-archive');
    const result = await readDocumentArchive(files[0]);
    return {
      ...result,
      sourceName: files[0].name,
      diagnostics: [],
      assetBytes: assetByteTotal(result.assets),
      unresolved: [],
    };
  }
  const sources = files.filter((file) => sourceFormat(file) !== undefined);
  if (sources.length !== 1)
    throw new WorkspaceStatusError(statusMessage('selectOneSource'));
  const file = sources[0];
  const imageFiles = files.filter(
    (candidate) =>
      candidate !== file && (isImageAsset(candidate) || isPdfAsset(candidate)),
  );
  const unsupported = files.filter(
    (candidate) =>
      candidate !== file && !isImageAsset(candidate) && !isPdfAsset(candidate),
  );
  if (unsupported.length > 0)
    throw new WorkspaceStatusError(
      statusMessage(
        'unsupportedAttachments',
        unsupported.map((candidate) => candidate.name).join(', '),
      ),
    );
  const format = sourceFormat(file);
  if (format === 'html' && file.size > maximumHtmlBytes)
    throw new Error('HTMLが150 MiBを超えています。');
  if (format !== 'html' && file.size > 5 * 1024 * 1024)
    throw new WorkspaceStatusError(statusMessage('markdownTooLarge'));

  for (const attachment of imageFiles) {
    if (isPdfAsset(attachment)) await validatePdfFile(attachment);
  }

  const source = await file.text();
  if (format === 'html') {
    const result = importHtml(source, file.name);
    try {
      const local = createLocalAssetUrls(
        result.document,
        imageFiles,
        new Set(result.assets.keys()),
      );
      const assets = new Map([...result.assets, ...local.urls]);
      const assetBytes = assetByteTotal(assets);
      if (hasOversizedAsset(assets) || assetBytes > maximumTotalAssetBytes) {
        revokeAssetUrls(local.urls);
        throw new WorkspaceStatusError(
          statusMessage(
            hasOversizedAsset(assets) ? 'imageTooLarge' : 'imagesTooLarge',
          ),
        );
      }
      if (local.unresolved.length)
        result.htmlImport.warnings.push(
          `画像 ${local.unresolved.length} 件を解決できませんでした: ${local.unresolved.join(', ')}`,
        );
      return {
        ...result,
        assets,
        assetBytes,
        unresolved: local.unresolved,
        diagnostics: [],
        sourceName: file.name,
      };
    } catch (error) {
      revokeAssetUrls(result.assets);
      throw error;
    }
  }
  const result =
    format === 'json'
      ? { document: migrateDocumentData(JSON.parse(source)), diagnostics: [] }
      : parseMarkdown(source);
  const { urls: assets, unresolved } = createLocalAssetUrls(
    result.document,
    imageFiles,
  );
  const assetBytes = assetByteTotal(assets);
  if (hasOversizedAsset(assets)) {
    revokeAssetUrls(assets);
    throw new WorkspaceStatusError(statusMessage('imageTooLarge'));
  }
  if (assetBytes > maximumTotalAssetBytes) {
    revokeAssetUrls(assets);
    throw new WorkspaceStatusError(statusMessage('imagesTooLarge'));
  }
  return { ...result, sourceName: file.name, assets, assetBytes, unresolved };
}

function filenameFor(document: DocumentData, extension: string): string {
  const base = documentTitle(document)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return `${base || 'document'}.${extension}`;
}

export function downloadDocument(
  document: DocumentData,
  format: DocumentFileFormat,
): void {
  const json = format === 'json';
  const content = json
    ? JSON.stringify(migrateDocumentData(document), null, 2) + '\n'
    : serializeDocument(document);
  const type = json
    ? 'application/json;charset=utf-8'
    : 'text/markdown;charset=utf-8';
  downloadFile(document, json ? 'json' : 'md', content, type);
}

export function downloadFile(
  document: DocumentData,
  extension: string,
  content: string | Uint8Array<ArrayBuffer> | Blob,
  type: string,
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = filenameFor(document, extension);
  try {
    window.document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Keep the URL valid until the browser has handled the download click.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
