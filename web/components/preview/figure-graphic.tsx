'use client';

/* oxlint-disable jsx-a11y/prefer-tag-over-role */
// Inline SVG is the semantic image and preserves vector annotations in exports.

import type { FigureNode } from '@/src/document/model';
import { readFigureEdit, svgDataUrl } from '@/src/document/figure-edit';
import { sanitizeSvgSource } from '@/src/security/svg-source';

export interface FigureGraphicSource {
  src: string | undefined;
  svg?: ReturnType<typeof sanitizeSvgSource>;
}

/** Resolve the actual image before caching load failures, including editable SVG replacements. */
export function resolveFigureGraphicSource(
  node: FigureNode,
  originalSource: string | undefined,
): FigureGraphicSource {
  const sourceSvg = readFigureEdit(node.attrs.figureEdit)?.svgSource;
  if (sourceSvg && typeof DOMParser !== 'undefined') {
    try {
      const svg = sanitizeSvgSource(sourceSvg);
      return { src: svgDataUrl(svg.source), svg };
    } catch {
      /* Keep the original if source is invalid. */
    }
  }
  return { src: originalSource };
}

/** The original image stays untouched; crop and vector annotations are separate layers. */
export function FigureGraphic({
  node,
  src,
  resolvedSource,
  onError,
  placed = false,
}: {
  node: FigureNode;
  src: string;
  resolvedSource?: FigureGraphicSource;
  onError?: () => void;
  placed?: boolean;
}) {
  const edit = readFigureEdit(node.attrs.figureEdit);
  const effectiveSource =
    resolvedSource ?? resolveFigureGraphicSource(node, src);
  const svg = effectiveSource.svg;
  const source = effectiveSource.src;
  const image = {
    src: source,
    alt: node.attrs.alt,
    title: node.attrs.title ?? undefined,
    referrerPolicy: 'no-referrer' as const,
    draggable: false,
    onError,
  };
  if (!edit?.crop && !edit?.annotations?.length)
    return <img {...image} alt={node.attrs.alt} loading="lazy" />;
  const size = svg ?? edit?.imageSize ?? { width: 100, height: 100 };
  const crop = edit?.crop ?? { x: 0, y: 0, width: 100, height: 100 };
  const width = (size.width * crop.width) / 100;
  const height = (size.height * crop.height) / 100;
  const point = (x: number, y: number) => ({
    x: (size.width * x) / 100,
    y: (size.height * y) / 100,
  });
  const markerId = `figure-arrow-${node.attrs.nodeId.replace(/[^\w-]/g, '_')}`;
  return (
    <svg
      className="figure-edit-graphic"
      role="img"
      aria-label={node.attrs.alt || '図と注釈'}
      viewBox={`${(size.width * crop.x) / 100} ${(size.height * crop.y) / 100} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: 'block',
        overflow: 'hidden',
        aspectRatio: `${width} / ${height}`,
        width: '100%',
        height: placed ? '100%' : 'auto',
      }}
    >
      <image
        href={source}
        x="0"
        y="0"
        width={size.width}
        height={size.height}
        onError={onError}
      />
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
        >
          <path d="M0 0 L8 4 L0 8 Z" fill="context-stroke" />
        </marker>
      </defs>
      {edit.annotations?.map((annotation) => {
        const start = point(annotation.x, annotation.y);
        const end = point(annotation.x2, annotation.y2);
        const fontSize =
          (Math.min(size.width, size.height) * annotation.fontSize) / 100;
        const strokeWidth = Math.min(size.width, size.height) / 200;
        return (
          <g
            key={annotation.id}
            data-annotation-id={annotation.id}
            fill={annotation.color}
          >
            {annotation.kind === 'arrow' && (
              <line
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={annotation.color}
                strokeWidth={strokeWidth}
                markerEnd={`url(#${markerId})`}
              />
            )}
            {annotation.kind === 'rectangle' && (
              <rect
                x={Math.min(start.x, end.x)}
                y={Math.min(start.y, end.y)}
                width={Math.abs(end.x - start.x)}
                height={Math.abs(end.y - start.y)}
                fill="none"
                stroke={annotation.color}
                strokeWidth={strokeWidth}
              />
            )}
            {annotation.kind === 'number' && (
              <circle
                cx={start.x}
                cy={start.y}
                r={fontSize * 0.85}
                fill="white"
                stroke={annotation.color}
                strokeWidth={strokeWidth}
              />
            )}
            {annotation.text && (
              <text
                x={start.x}
                y={start.y}
                fontSize={fontSize}
                textAnchor={annotation.kind === 'number' ? 'middle' : 'start'}
                dominantBaseline={
                  annotation.kind === 'number' ? 'central' : 'auto'
                }
                stroke="white"
                strokeWidth={strokeWidth / 2}
                paintOrder="stroke"
              >
                {annotation.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
