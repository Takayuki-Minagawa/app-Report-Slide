/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG needs an accessible name. */
import type { ChartNode } from '@/src/document/model';

function unitPosition(value: number, minimum: number, maximum: number): number {
  if (minimum === maximum) return 0.5;
  // Scaling before subtraction avoids Infinity for valid ±1e308 data.
  const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1);
  return (
    (value / scale - minimum / scale) / (maximum / scale - minimum / scale)
  );
}

/** Pure SVG keeps preview, standalone HTML and printed output identical offline. */
export function ChartGraphic({ node }: { node: ChartNode }) {
  const { chartType, data, xLabel, yLabel, series, alt, width } = node.attrs;
  const left = 74,
    right = 605,
    top = 35,
    bottom = 285;
  const xs = data.map((point) => point.x);
  const ys = data.map((point) => point.y);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys),
    yMax = Math.max(0, ...ys);
  const xPosition = (x: number, index: number) =>
    chartType === 'bar'
      ? left + ((index + 0.5) / data.length) * (right - left)
      : left + unitPosition(x, xMin, xMax) * (right - left);
  const yPosition = (y: number) =>
    bottom - unitPosition(y, yMin, yMax) * (bottom - top);
  const sorted = [...data].sort((a, b) => a.x - b.x);
  const line = sorted
    .map(
      (point, index) =>
        `${index ? 'L' : 'M'} ${xPosition(point.x, index)} ${yPosition(point.y)}`,
    )
    .join(' ');
  return (
    <figure
      className="preview-chart"
      style={{ width: `${width}%`, marginInline: 'auto' }}
    >
      <svg
        viewBox="0 0 640 360"
        width="100%"
        role="img"
        aria-label={alt || series}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{alt || series}</title>
        <rect width="640" height="360" fill="white" />
        {[0, 1, 2, 3, 4].map((index) => {
          const y = top + (index * (bottom - top)) / 4;
          const fraction = index / 4;
          const value = (1 - fraction) * yMax + fraction * yMin;
          return (
            <g key={index}>
              <line x1={left} x2={right} y1={y} y2={y} stroke="#d9e1e8" />
              <text
                x={left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="12"
                fill="#394b5b"
              >
                {Number(value.toPrecision(3))}
              </text>
            </g>
          );
        })}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#394b5b" />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#394b5b" />
        {chartType === 'line' && (
          <path d={line} fill="none" stroke="#176b9a" strokeWidth="3" />
        )}
        {data.map((point, index) => {
          const x = xPosition(point.x, index),
            y = yPosition(point.y);
          return (
            <g key={index}>
              {chartType === 'bar' ? (
                <rect
                  x={x - Math.min(30, 210 / data.length)}
                  y={Math.min(y, yPosition(0))}
                  width={Math.min(60, 420 / data.length)}
                  height={Math.max(1, Math.abs(yPosition(0) - y))}
                  fill="#176b9a"
                />
              ) : (
                <circle cx={x} cy={y} r="4" fill="#176b9a" />
              )}
              {(data.length <= 15 ||
                index % Math.ceil(data.length / 12) === 0 ||
                index === data.length - 1) && (
                <text
                  x={x}
                  y={bottom + 20}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#394b5b"
                >
                  {point.label.length > 12
                    ? point.label.slice(0, 11) + '…'
                    : point.label}
                </text>
              )}
            </g>
          );
        })}
        <text x="340" y="344" textAnchor="middle" fontSize="14" fill="#25394b">
          {xLabel}
        </text>
        <text
          x="20"
          y="160"
          transform="rotate(-90 20 160)"
          textAnchor="middle"
          fontSize="14"
          fill="#25394b"
        >
          {yLabel}
        </text>
        <rect x="473" y="11" width="14" height="10" fill="#176b9a" />
        <text x="493" y="21" fontSize="12" fill="#25394b">
          {series}
        </text>
      </svg>
      {node.attrs.caption && <figcaption>{node.attrs.caption}</figcaption>}
    </figure>
  );
}
