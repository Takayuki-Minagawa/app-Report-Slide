import type { DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { bytesToBase64 } from './embedded-images';

export const editableHtmlId = 'kumi-editable-document';
export const editableHtmlFormat = 'kumi-editable-html';
export const editableHtmlVersion = 1;

export interface EditableHtmlEnvelope {
  format: typeof editableHtmlFormat;
  version: typeof editableHtmlVersion;
  document: DocumentData;
  assets: Array<{ source: string; data: string }>;
}

/** Base64 in an inert template cannot close a tag or execute document content. */
export function editableHtmlPayload(
  document: DocumentData,
  resolveImageUrl: (source: string) => string,
): string {
  const sources = new Set<string>();
  for (const node of walkDocumentTree(document.children)) {
    if (node.type === 'figure' || node.type === 'inlineImage')
      sources.add(node.attrs.src.trim());
  }
  const assets = [...sources].flatMap((source) => {
    const data = resolveImageUrl(source);
    return data !== source ? [{ source, data }] : [];
  });
  const envelope: EditableHtmlEnvelope = {
    format: editableHtmlFormat,
    version: editableHtmlVersion,
    document,
    assets,
  };
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(envelope)));
}
