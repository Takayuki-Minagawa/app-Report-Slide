import { z } from 'zod';
import type { ChartNode } from './model';

export const chartColors = [
  '#176b9a',
  '#bb4d34',
  '#27815c',
  '#8656a4',
  '#ad7c17',
  '#327e83',
  '#bd4e89',
  '#566575',
];
export const chartPointSchema = z.strictObject({
  label: z.string().max(80),
  x: z.number(),
  y: z.number(),
});
export const chartSeriesSchema = z.strictObject({
  name: z.string().max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  dash: z.enum(['solid', 'dashed', 'dotted']),
  marker: z.enum(['circle', 'square', 'triangle', 'none']),
  data: z.array(chartPointSchema).min(1).max(200),
});
export const chartPlotSchema = z
  .strictObject({
    version: z.literal(1),
    series: z.array(chartSeriesSchema).min(1).max(8),
    orientation: z.enum(['vertical', 'horizontal']),
    showValues: z.boolean(),
    xUnit: z.string().max(80),
    yUnit: z.string().max(80),
    xMin: z.number().nullable(),
    xMax: z.number().nullable(),
    yMin: z.number().nullable(),
    yMax: z.number().nullable(),
    source: z.string().max(2000),
    nature: z.enum([
      'unspecified',
      'observed',
      'simulated',
      'schematic',
      'mixed',
    ]),
  })
  .superRefine((value, ctx) => {
    for (const axis of ['x', 'y'] as const) {
      const low = value[`${axis}Min`],
        high = value[`${axis}Max`];
      if (low !== null && high !== null && low >= high)
        ctx.addIssue({
          code: 'custom',
          path: [`${axis}Max`],
          message: 'Maximum must be greater than minimum',
        });
    }
  });
export type ChartSeries = z.infer<typeof chartSeriesSchema>;
export type ChartPlot = z.infer<typeof chartPlotSchema>;
export function resolveChartPlot(attrs: ChartNode['attrs']): ChartPlot {
  const parsed = chartPlotSchema.safeParse(attrs.plot);
  return parsed.success
    ? parsed.data
    : {
        version: 1,
        series: [
          {
            name: attrs.series,
            color: chartColors[0],
            dash: 'solid',
            marker: 'circle',
            data: attrs.data,
          },
        ],
        orientation: 'vertical',
        showValues: false,
        xUnit: '',
        yUnit: '',
        xMin: null,
        xMax: null,
        yMin: null,
        yMax: null,
        source: '',
        nature: 'unspecified',
      };
}

/** RFC 4180 quoted fields; also accepts tab-separated spreadsheet cells. */
export function parseChartCsv(source: string): ChartSeries['data'] {
  if (source.length > 100_000)
    throw new Error('データは100 KB以下にしてください');
  const text = source.replace(/^\uFEFF/, '');
  const delimiter = text.split(/\r?\n/, 1)[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    ended = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          ended = true;
        }
      } else field += char;
    } else if (char === '"' && field === '' && !ended) quoted = true;
    else if (char === delimiter || char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      ended = false;
      if (char !== delimiter) {
        if (row.some((cell) => cell.trim())) rows.push(row);
        row = [];
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (ended || char === '"')
        throw new Error('CSVの引用符を確認してください');
      field += char;
    }
  }
  if (quoted) throw new Error('CSVの引用符が閉じていません');
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  if (
    rows[0]?.map((cell) => cell.trim().toLowerCase()).join(',') === 'label,x,y'
  )
    rows.shift();
  const parsed = rows.map((cells) => {
    if (cells.length !== 3 || cells[1].trim() === '' || cells[2].trim() === '')
      throw new Error('各行は label,x,y の3列で、xとyに数値が必要です');
    return { label: cells[0].trim(), x: Number(cells[1]), y: Number(cells[2]) };
  });
  return z.array(chartPointSchema).min(1).max(200).parse(parsed);
}
export function chartDataCsv(data: ChartSeries['data']): string {
  return data
    .map(
      (point) =>
        `${/[",\n\r]/.test(point.label) ? '"' + point.label.replaceAll('"', '""') + '"' : point.label},${point.x},${point.y}`,
    )
    .join('\n');
}
