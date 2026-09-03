import { documentTitle, type DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { migrateDocumentData } from '@/src/document/validation';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import type { MarkdownDiagnostic } from '@/src/markdown/diagnostics';
import { WorkspaceStatusError, statusMessage } from './status';

/** Runtime-only object URLs must never be serialized into the document. */
export type AssetUrls = ReadonlyMap<string, string>;

const maximumAssetBytes = 20 * 1024 * 1024;
const maximumTotalAssetBytes = 50 * 1024 * 1024;

export type DocumentFileFormat = 'markdown' | 'json';

function sourceFormat(file: File): DocumentFileFormat | undefined {
  if (/\.json$/i.test(file.name)) return 'json';
  if (/\.(?:md|markdown)$/i.test(file.name)) return 'markdown';
  const mime = file.type.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/json') return 'json';
  if (mime === 'text/markdown') return 'markdown';
  return undefined;
}

function isImageAsset(file: File): boolean {
  return (
    /^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/i.test(file.type) ||
    /\.(?:png|jpe?g|webp|gif|svg)$/i.test(file.name)
  );
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

function localImageSources(document: DocumentData): string[] {
  const sources = new Set<string>();
  for (const node of walkDocumentTree(document.children)) {
    if (node.type !== 'figure' && node.type !== 'inlineImage') continue;
    const source = node.attrs.src.trim();
    if (!/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('/'))
      sources.add(source);
  }
  return [...sources];
}

export function createLocalAssetUrls(
  document: DocumentData,
  files: readonly File[],
): { urls: AssetUrls; unresolved: string[] } {
  const urls = new Map<string, string>();
  const unresolved: string[] = [];
  const urlByFile = new Map<File, string>();

  try {
    for (const source of localImageSources(document)) {
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
      const basename = normalizedSource.split('/').at(-1);
      const matches =
        exactMatches.length > 0
          ? exactMatches
          : files.filter(
              (file) =>
                normalizedAssetPath(file.name).split('/').at(-1) === basename,
            );

      if (matches.length !== 1) {
        unresolved.push(source);
        continue;
      }
      const file = matches[0];
      const url = urlByFile.get(file) ?? URL.createObjectURL(file);
      urlByFile.set(file, url);
      urls.set(source, url);
    }
  } catch (error) {
    revokeAssetUrls(urls);
    throw error;
  }
  return { urls, unresolved };
}

export function revokeAssetUrls(urls: AssetUrls): void {
  for (const url of new Set(urls.values())) URL.revokeObjectURL(url);
}

export interface ImportedDocument {
  document: DocumentData;
  sourceName: string;
  diagnostics: MarkdownDiagnostic[];
  assets: AssetUrls;
  unresolved: string[];
}

/** The caller owns the returned assets and must release them if it discards the result. */
export async function readWorkspaceFiles(
  files: readonly File[],
): Promise<ImportedDocument> {
  const sources = files.filter((file) => sourceFormat(file) !== undefined);
  if (sources.length !== 1)
    throw new WorkspaceStatusError(statusMessage('selectOneSource'));
  const file = sources[0];
  const imageFiles = files.filter(
    (candidate) => candidate !== file && isImageAsset(candidate),
  );
  const unsupported = files.filter(
    (candidate) => candidate !== file && !isImageAsset(candidate),
  );
  if (unsupported.length > 0)
    throw new WorkspaceStatusError(
      statusMessage(
        'unsupportedAttachments',
        unsupported.map((candidate) => candidate.name).join(', '),
      ),
    );
  if (file.size > 5 * 1024 * 1024)
    throw new WorkspaceStatusError(statusMessage('markdownTooLarge'));
  if (imageFiles.some((asset) => asset.size > maximumAssetBytes))
    throw new WorkspaceStatusError(statusMessage('imageTooLarge'));
  if (
    imageFiles.reduce((total, asset) => total + asset.size, 0) >
    maximumTotalAssetBytes
  )
    throw new WorkspaceStatusError(statusMessage('imagesTooLarge'));

  const source = await file.text();
  const result =
    sourceFormat(file) === 'json'
      ? { document: migrateDocumentData(JSON.parse(source)), diagnostics: [] }
      : parseMarkdown(source);
  const { urls: assets, unresolved } = createLocalAssetUrls(
    result.document,
    imageFiles,
  );
  return { ...result, sourceName: file.name, assets, unresolved };
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
  content: string,
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
