import type { Diagram } from './diagram';
import { diagramConnectionPoints } from './diagram-geometry';
import { sanitizeSvgSource } from '../security/svg-source';

const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const n = (value: number) => String(Math.round(value * 10000) / 10000);
/** Generated only from the validated diagram model; free-form SVG is handled separately. */
export function diagramSvg(diagram: Diagram): string {
  const x = (value: number) => n((value * diagram.width) / 100);
  const y = (value: number) => n((value * diagram.height) / 100);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${diagram.width} ${diagram.height}" width="${diagram.width}" height="${diagram.height}">`,
  ];
  const layers: { order: number; source: string; retained?: boolean }[] = [];
  const importedIds = new Set<string>();
  if (
    typeof DOMParser !== 'undefined' &&
    (diagram.svgDefinitions || diagram.svgFragments?.length)
  ) {
    const imported = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg">${diagram.svgDefinitions ?? ''}${(diagram.svgFragments ?? []).map((part) => part.source).join('')}</svg>`,
      'image/svg+xml',
    );
    for (const element of imported.querySelectorAll('[id]'))
      importedIds.add(element.id);
  }
  if (diagram.svgDefinitions) parts.push(diagram.svgDefinitions);
  diagram.connections.forEach((edge, index) => {
    const start = parts.length;
    const points = diagramConnectionPoints(diagram, edge);
    let marker = `diagram-arrow-${index}`;
    while (importedIds.has(marker)) marker = `kumi-${marker}`;
    importedIds.add(marker);
    parts.push(
      `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="${edge.color}"/></marker></defs>`,
    );
    parts.push(
      `<line x1="${x(points.start.x)}" y1="${y(points.start.y)}" x2="${x(points.end.x)}" y2="${y(points.end.y)}" stroke="${edge.color}" stroke-width="${edge.strokeWidth}"${edge.dash === 'dashed' ? ' stroke-dasharray="8 5"' : ''}${edge.arrow === 'end' || edge.arrow === 'both' ? ` marker-end="url(#${marker})"` : ''}${edge.arrow === 'start' || edge.arrow === 'both' ? ` marker-start="url(#${marker})"` : ''}/>`,
    );
    if (edge.label)
      parts.push(
        `<text x="${x((points.start.x + points.end.x) / 2)}" y="${y((points.start.y + points.end.y) / 2 - 2)}" text-anchor="middle" font-size="${edge.labelFontSize ?? 18}" fill="${edge.labelColor ?? edge.color}" font-family="sans-serif">${escape(edge.label)}</text>`,
      );
    layers.push({
      order: edge.paintOrder ?? index,
      source: parts.splice(start).join(''),
    });
  });
  for (const [index, shape] of diagram.shapes.entries()) {
    const start = parts.length;
    if (shape.kind === 'rectangle')
      parts.push(
        `<rect x="${x(shape.x)}" y="${y(shape.y)}" width="${x(shape.width)}" height="${y(shape.height)}" rx="${shape.cornerRadius ?? 8}" ry="${shape.cornerRadiusY ?? shape.cornerRadius ?? 8}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`,
      );
    if (shape.kind === 'ellipse')
      parts.push(
        `<ellipse cx="${x(shape.x + shape.width / 2)}" cy="${y(shape.y + shape.height / 2)}" rx="${x(shape.width / 2)}" ry="${y(shape.height / 2)}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`,
      );
    const lines = shape.text.split('\n');
    const centerY = ((shape.y + shape.height / 2) * diagram.height) / 100;
    const textX =
      shape.textAnchor === 'start'
        ? shape.x
        : shape.textAnchor === 'end'
          ? shape.x + shape.width
          : shape.x + shape.width / 2;
    lines.forEach((line, index) =>
      parts.push(
        `<text x="${x(textX)}" y="${n(centerY + (index - (lines.length - 1) / 2) * shape.fontSize * (shape.textLineHeight ?? 1.2))}" dominant-baseline="${shape.textBaseline ?? 'central'}" text-anchor="${shape.textAnchor ?? 'middle'}" font-size="${shape.fontSize}" font-family="${escape(shape.fontFamily ?? 'sans-serif')}" font-weight="${shape.fontWeight ?? 'normal'}" fill="${shape.textColor ?? shape.stroke}">${escape(line)}</text>`,
      ),
    );
    layers.push({
      order: shape.paintOrder ?? diagram.connections.length + index,
      source: parts.splice(start).join(''),
    });
  }
  for (const part of diagram.svgFragments ?? [])
    layers.push({
      order: part.paintOrder,
      source: part.source,
      retained: true,
    });
  layers.sort((a, b) => a.order - b.order);
  const source =
    parts.join('') + layers.map((part) => part.source).join('') + '</svg>';
  // Imported JSON is untrusted too. Never insert stored fragments without sanitizing.
  if (diagram.svgFragments?.length || diagram.svgDefinitions) {
    if (typeof DOMParser !== 'undefined') {
      try {
        return sanitizeSvgSource(source).source;
      } catch {
        /* Malformed imported JSON must not crash the document renderer. */
      }
    }
    return (
      parts[0] +
      layers
        .filter((part) => !part.retained)
        .map((part) => part.source)
        .join('') +
      '<text x="8" y="20" fill="#b91c1c" font-size="14">保持SVGを表示できません。SVG原本を確認してください。</text></svg>'
    );
  }
  return source;
}
