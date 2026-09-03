export type ResourceKind = 'image' | 'link';
export type ImageUrlResolver = (source: string) => string;

/** Only the local-asset resolver may introduce blob URLs or embedded imported images. */
export function resolveSafeImageUrl(
  source: unknown,
  resolveImageUrl: ImageUrlResolver = (value) => value,
): string | undefined {
  if (typeof source !== 'string') return undefined;
  const safeSource = safeResourceUrl(source, 'image');
  if (!safeSource) return undefined;
  const resolved = resolveImageUrl(safeSource);
  if (typeof resolved !== 'string') return undefined;
  // Export embeds trusted local attachments, including SVGs and images over the
  // inline-document limit. The original document URL is still validated above.
  if (
    resolved !== safeSource &&
    /^data:image\/(?:png|jpe?g|webp|gif|svg\+xml);base64,[a-z\d+/]*={0,2}$/i.test(
      resolved,
    )
  )
    return resolved;
  return resolved.startsWith('blob:')
    ? resolved
    : safeResourceUrl(resolved, 'image');
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

export function isSafeResourceUrl(value: string, kind: ResourceKind): boolean {
  const trimmed = value.trim();
  if (!trimmed || hasControlCharacter(trimmed) || trimmed.startsWith('//')) {
    return false;
  }

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!scheme) return true;

  if (scheme === 'http' || scheme === 'https') return true;
  if (kind === 'link' && scheme === 'mailto') return true;
  if (kind === 'image' && scheme === 'data') {
    return (
      trimmed.length <= 2 * 1024 * 1024 &&
      /^data:image\/(?:png|jpe?g|webp|gif);/i.test(trimmed)
    );
  }
  return false;
}

export function safeResourceUrl(
  value: string,
  kind: ResourceKind,
): string | undefined {
  return isSafeResourceUrl(value, kind) ? value.trim() : undefined;
}
