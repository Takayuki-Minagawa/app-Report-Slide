import type { DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { safeResourceUrl } from '@/src/security/resource-url';
import type { AssetUrls } from '@/src/workspace/files';
import { WorkspaceStatusError, statusMessage } from '@/src/workspace/status';

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

function imageMime(
  source: string,
  contentType: string | null,
): string | undefined {
  const mime = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (mime && /^image\/(?:png|jpe?g|webp|gif|svg\+xml)$/.test(mime))
    return mime;
  if (mime && mime !== 'application/octet-stream') return undefined;
  const extension = source.split(/[?#]/, 1)[0].split('.').at(-1)?.toLowerCase();
  return extension === 'svg'
    ? 'image/svg+xml'
    : extension && /^(?:png|jpe?g|webp|gif)$/.test(extension)
      ? 'image/' + (extension === 'jpg' ? 'jpeg' : extension)
      : undefined;
}

/** Never fetch external URLs: only read object URLs owned by the workspace. */
export async function embedSlideImages(
  document: DocumentData,
  assets: AssetUrls,
) {
  const sources = new Set<string>();
  for (const node of walkDocumentTree(document.children)) {
    if (node.type === 'figure' || node.type === 'inlineImage') {
      const source = safeResourceUrl(node.attrs.src, 'image');
      if (source) sources.add(source);
    }
  }
  const external = [...sources].filter((source) => /^https?:/i.test(source));
  const local = [...sources].filter(
    (source) => !/^(?:https?:|data:)/i.test(source),
  );
  const missing = local.filter(
    (source) => !assets.get(source)?.startsWith('blob:'),
  );
  if (missing.length > 0)
    throw new WorkspaceStatusError(
      statusMessage('htmlMissingImages', missing.join(', ')),
    );

  const embedded = new Map<string, string>();
  const byUrl = new Map<string, string>();
  // Sequential conversion bounds peak memory when several large attachments are used.
  for (const source of local) {
    const url = assets.get(source)!;
    let data = byUrl.get(url);
    if (!data) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Unreadable attachment');
        const mime = imageMime(source, response.headers.get('content-type'));
        if (!mime) throw new Error('Unsupported image format');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > 20 * 1024 * 1024)
          throw new Error('Attachment too large');
        data = 'data:' + mime + ';base64,' + bytesToBase64(bytes);
        byUrl.set(url, data);
      } catch {
        throw new WorkspaceStatusError(
          statusMessage('htmlImageReadFailed', source),
        );
      }
    }
    embedded.set(source, data);
  }
  return {
    resolveImageUrl: (source: string) => embedded.get(source) ?? source,
    external,
  };
}
