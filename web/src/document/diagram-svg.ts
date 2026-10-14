import type { Diagram } from './diagram';
import { diagramConnectionPoints } from './diagram-geometry';

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
  diagram.connections.forEach((edge, index) => {
    const points = diagramConnectionPoints(diagram, edge);
    const marker = `diagram-arrow-${index}`;
    parts.push(
      `<defs><marker id="${marker}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 Z" fill="${edge.color}"/></marker></defs>`,
    );
    parts.push(
      `<line x1="${x(points.start.x)}" y1="${y(points.start.y)}" x2="${x(points.end.x)}" y2="${y(points.end.y)}" stroke="${edge.color}" stroke-width="${edge.strokeWidth}"${edge.dash === 'dashed' ? ' stroke-dasharray="8 5"' : ''}${edge.arrow === 'end' || edge.arrow === 'both' ? ` marker-end="url(#${marker})"` : ''}${edge.arrow === 'start' || edge.arrow === 'both' ? ` marker-start="url(#${marker})"` : ''}/>`,
    );
    if (edge.label)
      parts.push(
        `<text x="${x((points.start.x + points.end.x) / 2)}" y="${y((points.start.y + points.end.y) / 2 - 2)}" text-anchor="middle" font-size="18" fill="${edge.color}" font-family="sans-serif">${escape(edge.label)}</text>`,
      );
  });
  for (const shape of diagram.shapes) {
    if (shape.kind === 'rectangle')
      parts.push(
        `<rect x="${x(shape.x)}" y="${y(shape.y)}" width="${x(shape.width)}" height="${y(shape.height)}" rx="8" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`,
      );
    if (shape.kind === 'ellipse')
      parts.push(
        `<ellipse cx="${x(shape.x + shape.width / 2)}" cy="${y(shape.y + shape.height / 2)}" rx="${x(shape.width / 2)}" ry="${y(shape.height / 2)}" fill="${shape.fill}" stroke="${shape.stroke}" stroke-width="${shape.strokeWidth}"/>`,
      );
    const lines = shape.text.split('\n');
    const centerY = ((shape.y + shape.height / 2) * diagram.height) / 100;
    lines.forEach((line, index) =>
      parts.push(
        `<text x="${x(shape.x + shape.width / 2)}" y="${n(centerY + (index - (lines.length - 1) / 2) * shape.fontSize * 1.2)}" dominant-baseline="central" text-anchor="middle" font-size="${shape.fontSize}" font-family="sans-serif" fill="${shape.stroke}">${escape(line)}</text>`,
      ),
    );
  }
  return parts.join('') + '</svg>';
}
