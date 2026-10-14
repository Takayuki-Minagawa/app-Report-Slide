import DOMPurify from 'dompurify';

/** Keep source as inert text, and display only an independent sanitized copy. */
export function sanitizeSvgSource(source: string): {
  source: string;
  width: number;
  height: number;
  changed: boolean;
} {
  if (source.length > 1_000_000)
    throw new Error('SVGソースは1 MB以内にしてください。');
  const original = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (
    original.querySelector('parsererror') ||
    original.documentElement.localName !== 'svg'
  )
    throw new Error('SVGの構文を確認してください。');
  const clean = DOMPurify.sanitize(source, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'style',
      'foreignObject',
      'animate',
      'animateMotion',
      'animateTransform',
      'set',
      'image',
    ],
  });
  let changed = DOMPurify.removed.length > 0;
  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
  const root = parsed.documentElement;
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of Array.from(element.attributes)) {
      if (
        (/^(?:href|xlink:href)$/i.test(attribute.name) &&
          !/^#[\w:.-]+$/.test(attribute.value)) ||
        [...attribute.value.matchAll(/url\s*\(([^)]*)\)/gi)].some(
          (match) =>
            !/^#[\w:.-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, '')),
        ) ||
        attribute.name === 'style'
      ) {
        element.removeAttribute(attribute.name);
        changed = true;
      }
    }
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const box = root
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const width =
    box?.length === 4
      ? box[2]
      : Number.parseFloat(root.getAttribute('width') ?? '');
  const height =
    box?.length === 4
      ? box[3]
      : Number.parseFloat(root.getAttribute('height') ?? '');
  if (
    !(
      width > 0 &&
      height > 0 &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    )
  )
    throw new Error(
      'SVGに正の幅・高さのviewBoxまたはwidth/heightを指定してください。',
    );
  return {
    source: new XMLSerializer().serializeToString(root),
    width,
    height,
    changed,
  };
}
