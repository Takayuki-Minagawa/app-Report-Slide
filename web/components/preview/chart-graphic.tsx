/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Inline SVG needs an accessible name. */
import type { ChartNode } from '@/src/document/model';
import { resolveChartPlot } from '@/src/document/chart';

function unitPosition(value: number, minimum: number, maximum: number): number {
  if (minimum === maximum)
    return value === minimum ? 0.5 : value > maximum ? 10 : -10;
  const scale = Math.max(
    Math.abs(value),
    Math.abs(minimum),
    Math.abs(maximum),
    1,
  );
  return Math.max(
    -10,
    Math.min(
      10,
      (value / scale - minimum / scale) / (maximum / scale - minimum / scale),
    ),
  );
}
const short = (value: string, size = 12) =>
  value.length > size ? value.slice(0, size - 1) + '…' : value;
const numeric = (value: number) => Number(value.toPrecision(3));
const withUnit = (label: string, unit: string) =>
  unit ? `${label} (${unit})` : label;

/** Pure SVG keeps all series crisp and identical in preview and offline HTML. */
export function ChartGraphic({ node }: { node: ChartNode }) {
  const { chartType, xLabel, yLabel, alt, width } = node.attrs;
  const plot = resolveChartPlot(node.attrs),
    series = plot.series;
  const horizontal = chartType === 'bar' && plot.orientation === 'horizontal';
  const left = horizontal ? 118 : 74,
    right = 602,
    top = series.length > 4 ? 57 : 35,
    bottom = 285;
  const all = series.flatMap((entry) => entry.data);
  // Repeated categories within one series are distinct observations, not duplicates to discard.
  const categoryKeys = series.map((entry) => {
    const occurrences = new Map<string, number>();
    return entry.data.map((point) => {
      const key = JSON.stringify([point.x, point.label]);
      const occurrence = occurrences.get(key) ?? 0;
      occurrences.set(key, occurrence + 1);
      return `${key}:${occurrence}`;
    });
  });
  const categories = [
    ...new Map(
      series.flatMap((entry, seriesIndex) =>
        entry.data.map(
          (point, index) => [categoryKeys[seriesIndex][index], point] as const,
        ),
      ),
    ).entries(),
  ];
  const categoryIndex = new Map(categories.map(([key], index) => [key, index]));
  const xs = all.map((point) => point.x),
    ys = all.map((point) => point.y);
  const rawXMin = Math.min(...xs),
    rawXMax = Math.max(...xs),
    rawYMin = Math.min(0, ...ys),
    rawYMax = Math.max(0, ...ys);
  const xMin = plot.xMin ?? Math.min(rawXMin, plot.xMax ?? Infinity),
    xMax = plot.xMax ?? Math.max(rawXMax, plot.xMin ?? -Infinity);
  const yMin = plot.yMin ?? Math.min(rawYMin, plot.yMax ?? Infinity),
    yMax = plot.yMax ?? Math.max(rawYMax, plot.yMin ?? -Infinity);
  const xp = (value: number) =>
    left + unitPosition(value, xMin, xMax) * (right - left);
  const yp = (value: number) =>
    bottom - unitPosition(value, yMin, yMax) * (bottom - top);
  const hp = (value: number) =>
    left + unitPosition(value, yMin, yMax) * (right - left);
  const zero = horizontal
    ? hp(Math.max(yMin, Math.min(yMax, 0)))
    : yp(Math.max(yMin, Math.min(yMax, 0)));
  const clipId = `chart-clip-${node.attrs.nodeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  const dash = (value: string) =>
    value === 'dashed' ? '9 5' : value === 'dotted' ? '2 4' : undefined;
  return (
    <figure
      className="preview-chart"
      style={{ width: `${width}%`, marginInline: 'auto' }}
    >
      <svg
        viewBox="0 0 640 360"
        width="100%"
        role="img"
        aria-label={alt || series.map((s) => s.name).join(', ')}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{alt || series.map((s) => s.name).join(', ')}</title>
        <rect width="640" height="360" fill="white" />
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={top} width={right - left} height={bottom - top} />
          </clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map((index) => {
          const f = index / 4,
            value = (1 - f) * yMin + f * yMax;
          const x = left + f * (right - left),
            y = bottom - f * (bottom - top);
          return (
            <g key={index}>
              {horizontal ? (
                <>
                  <line x1={x} x2={x} y1={top} y2={bottom} stroke="#d9e1e8" />
                  <text
                    x={x}
                    y={bottom + 20}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#394b5b"
                  >
                    {numeric(value)}
                  </text>
                </>
              ) : (
                <>
                  <line x1={left} x2={right} y1={y} y2={y} stroke="#d9e1e8" />
                  <text
                    x={left - 8}
                    y={y + 4}
                    textAnchor="end"
                    fontSize="12"
                    fill="#394b5b"
                  >
                    {numeric(value)}
                  </text>
                </>
              )}
            </g>
          );
        })}
        <line x1={left} x2={left} y1={top} y2={bottom} stroke="#394b5b" />
        <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#394b5b" />
        {categories.map(([, point], index) => {
          if (chartType !== 'bar' && (point.x < xMin || point.x > xMax))
            return null;
          if (
            categories.length > 15 &&
            index % Math.ceil(categories.length / 12) !== 0 &&
            index !== categories.length - 1
          )
            return null;
          const fraction = (index + 0.5) / categories.length;
          return (
            <text
              key={index}
              x={
                horizontal
                  ? left - 8
                  : chartType === 'bar'
                    ? left + fraction * (right - left)
                    : xp(point.x)
              }
              y={horizontal ? top + fraction * (bottom - top) + 4 : bottom + 20}
              textAnchor={horizontal ? 'end' : 'middle'}
              fontSize="11"
              fill="#394b5b"
            >
              {short(point.label)}
            </text>
          );
        })}
        <g clipPath={`url(#${clipId})`}>
          {series.map((entry, seriesIndex) => (
            <g key={seriesIndex} data-chart-series={entry.name}>
              {chartType === 'line' && (
                <path
                  d={[...entry.data]
                    .sort((a, b) => a.x - b.x)
                    .map(
                      (point, index) =>
                        `${index ? 'L' : 'M'} ${xp(point.x)} ${yp(point.y)}`,
                    )
                    .join(' ')}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth="3"
                  strokeDasharray={dash(entry.dash)}
                />
              )}
              {entry.data.map((point, index) => {
                const category =
                  categoryIndex.get(categoryKeys[seriesIndex][index]) ?? index;
                const span =
                  (horizontal ? bottom - top : right - left) /
                  categories.length;
                const band = (span * 0.78) / series.length;
                const center =
                  (horizontal ? top : left) +
                  span * (category + 0.5) +
                  (seriesIndex - (series.length - 1) / 2) * band;
                const x =
                    chartType === 'bar'
                      ? horizontal
                        ? hp(point.y)
                        : center
                      : xp(point.x),
                  y =
                    chartType === 'bar'
                      ? horizontal
                        ? center
                        : yp(point.y)
                      : yp(point.y);
                return (
                  <g key={index}>
                    <title>{`${entry.name}: ${point.label}, ${point.y}${plot.yUnit ? ' ' + plot.yUnit : ''}`}</title>
                    {chartType === 'bar' ? (
                      <rect
                        x={horizontal ? Math.min(x, zero) : x - band * 0.44}
                        y={horizontal ? y - band * 0.44 : Math.min(y, zero)}
                        width={
                          horizontal
                            ? Math.max(0.5, Math.abs(x - zero))
                            : band * 0.88
                        }
                        height={
                          horizontal
                            ? band * 0.88
                            : Math.max(0.5, Math.abs(y - zero))
                        }
                        fill={entry.color}
                      />
                    ) : entry.marker === 'square' ? (
                      <rect
                        x={x - 4}
                        y={y - 4}
                        width="8"
                        height="8"
                        fill={entry.color}
                      />
                    ) : entry.marker === 'triangle' ? (
                      <path
                        d={`M ${x} ${y - 5} L ${x + 5} ${y + 4} L ${x - 5} ${y + 4} Z`}
                        fill={entry.color}
                      />
                    ) : entry.marker !== 'none' || chartType === 'scatter' ? (
                      <circle cx={x} cy={y} r="4" fill={entry.color} />
                    ) : null}
                    {plot.showValues &&
                      point.y >= yMin &&
                      point.y <= yMax &&
                      (chartType === 'bar' ||
                        (point.x >= xMin && point.x <= xMax)) && (
                        <text
                          x={
                            horizontal
                              ? Math.max(
                                  left + 12,
                                  Math.min(
                                    right - 12,
                                    x + (point.y >= 0 ? 8 : -8),
                                  ),
                                )
                              : x
                          }
                          y={horizontal ? y + 4 : Math.max(top + 12, y - 7)}
                          textAnchor={
                            horizontal
                              ? point.y >= 0
                                ? 'start'
                                : 'end'
                              : 'middle'
                          }
                          fontSize="11"
                          fill="#25394b"
                        >
                          {numeric(point.y)}
                        </text>
                      )}
                  </g>
                );
              })}
            </g>
          ))}
        </g>
        <text x="340" y="344" textAnchor="middle" fontSize="14" fill="#25394b">
          {horizontal
            ? withUnit(yLabel, plot.yUnit)
            : withUnit(xLabel, plot.xUnit)}
        </text>
        <text
          x="20"
          y="160"
          transform="rotate(-90 20 160)"
          textAnchor="middle"
          fontSize="14"
          fill="#25394b"
        >
          {horizontal
            ? withUnit(xLabel, plot.xUnit)
            : withUnit(yLabel, plot.yUnit)}
        </text>
        {series.map((entry, index) => (
          <g
            key={index}
            transform={`translate(${72 + (index % 4) * 137},${15 + Math.floor(index / 4) * 20})`}
          >
            <line
              x1="0"
              x2="16"
              y1="0"
              y2="0"
              stroke={entry.color}
              strokeWidth="3"
              strokeDasharray={dash(entry.dash)}
            />
            <text x="21" y="4" fontSize="11" fill="#25394b">
              <title>{entry.name}</title>
              {short(entry.name, 14)}
            </text>
          </g>
        ))}
      </svg>
      {node.attrs.caption && <figcaption>{node.attrs.caption}</figcaption>}
      {(plot.source || plot.nature !== 'unspecified') && (
        <figcaption className="chart-source">
          {plot.nature !== 'unspecified' && (
            <span>
              {
                {
                  observed: '実測 / Observed',
                  simulated: '解析 / Simulated',
                  schematic: '模式・実測値ではない / Schematic',
                  mixed: '実測・解析 / Observed & simulated',
                }[plot.nature]
              }{' '}
              ·{' '}
            </span>
          )}
          {plot.source}
        </figcaption>
      )}
    </figure>
  );
}
