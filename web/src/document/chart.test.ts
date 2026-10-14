import { describe, expect, it } from 'vitest';
import {
  chartDataCsv,
  chartPlotSchema,
  parseChartCsv,
  resolveChartPlot,
} from './chart';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData } from './validation';
import { createEditorExtensions } from '@/src/editor/extensions';
import { getSchema } from '@tiptap/core';
import type { ChartNode } from './model';
const chart: ChartNode = {
  type: 'chart',
  attrs: {
    nodeId: 'chart',
    chartType: 'line',
    data: [{ label: 'A', x: 1, y: 2 }],
    series: 'Observed',
    xLabel: 'Time',
    yLabel: 'Displacement',
    alt: 'Comparison',
    width: 100,
  },
};
describe('comparison charts', () => {
  it('preserves asymmetric error widths and positive log scales through CSV and Markdown', () => {
    const data = parseChartCsv(
      'label,x,y,xMinus,xPlus,yMinus,yPlus\nA,10,100,1,2,20,30\nB,20,200,,,0,4',
    );
    expect(data[0]).toMatchObject({
      xMinus: 1,
      xPlus: 2,
      yMinus: 20,
      yPlus: 30,
    });
    expect(data[1].xMinus).toBeUndefined();
    expect(parseChartCsv(chartDataCsv(data))).toEqual(data);
    const plot = {
      ...resolveChartPlot(chart.attrs),
      xScale: 'log' as const,
      yScale: 'log' as const,
      errorDescription: '95% CI',
      referenceId: 'study',
    };
    plot.series[0].data = data;
    const document = validateDocumentData({
      schemaVersion: 2,
      type: 'slide',
      metadata: {},
      children: [{ ...chart, attrs: { ...chart.attrs, plot } }],
    });
    const imported = parseMarkdown(serializeDocument(document));
    expect(
      imported.diagnostics.filter((entry) => entry.severity === 'error'),
    ).toEqual([]);
    expect(imported.document.children[0].attrs.plot).toEqual(plot);
    for (const invalid of [
      { ...plot, xMin: 0 },
      { ...plot, yMin: -1 },
      {
        ...plot,
        series: [
          { ...plot.series[0], data: [{ label: 'A', x: 1, y: 1, yMinus: 1 }] },
        ],
      },
      {
        ...plot,
        series: [
          { ...plot.series[0], data: [{ label: 'A', x: 1, y: 1, yPlus: -1 }] },
        ],
      },
    ])
      expect(chartPlotSchema.safeParse(invalid).success).toBe(false);
    expect(() =>
      parseChartCsv('label,x,y,xMinus,xPlus,yMinus,yPlus\nA,1,2,0,0,-1,1'),
    ).toThrow();
    expect(
      chartPlotSchema.safeParse({
        ...plot,
        xScale: 'linear',
        yScale: 'linear',
        series: [
          {
            ...plot.series[0],
            data: [{ label: 'huge', x: 1, y: 1e308, yPlus: 1e308 }],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('reads quoted CSV and tabular paste without turning blank cells into zero', () => {
    const data = parseChartCsv('\uFEFFlabel,x,y\r\n"A, B",1,2\r\n"C""D",3,4');
    expect(data[0].label).toBe('A, B');
    expect(data[1].label).toBe('C"D');
    expect(parseChartCsv(chartDataCsv(data))).toEqual(data);
    expect(parseChartCsv('A\t1\t2')).toEqual([{ label: 'A', x: 1, y: 2 }]);
    for (const invalid of [
      'A,,2',
      'A,1,',
      '"unclosed,1,2',
      'A,NaN,2',
      'A,1,Infinity',
      'A,1,2,3',
    ])
      expect(() => parseChartCsv(invalid)).toThrow();
  });
  it('keeps all series and styles through schema and Markdown round trips', () => {
    const plot = resolveChartPlot(chart.attrs);
    plot.series.push({
      ...plot.series[0],
      name: 'Simulated',
      color: '#bb4d34',
      dash: 'dashed',
      marker: 'triangle',
      data: [{ label: 'A', x: 1, y: 3 }],
    });
    plot.orientation = 'horizontal';
    plot.showValues = true;
    plot.yUnit = 's';
    plot.source = 'Study 2026';
    plot.nature = 'mixed';
    const source = validateDocumentData({
      schemaVersion: 2,
      type: 'slide',
      metadata: {},
      children: [{ ...chart, attrs: { ...chart.attrs, plot } }],
    });
    expect(
      getSchema(createEditorExtensions({ onMathSelect: () => {} }))
        .nodeFromJSON({ type: 'doc', content: source.children })
        .toJSON().content[0].attrs.plot,
    ).toEqual(plot);
    const read = parseMarkdown(serializeDocument(source));
    expect(read.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(read.document.children[0].attrs.plot).toEqual(plot);
  });
  it('rejects invalid axis bounds or unsafe style values', () => {
    const plot = resolveChartPlot(chart.attrs);
    expect(
      chartPlotSchema.safeParse({ ...plot, yMin: 2, yMax: 1 }).success,
    ).toBe(false);
    expect(() =>
      validateDocumentData({
        schemaVersion: 2,
        type: 'slide',
        metadata: {},
        children: [
          {
            ...chart,
            attrs: {
              ...chart.attrs,
              plot: {
                ...plot,
                series: [
                  { ...plot.series[0], color: 'url(https://example.com)' },
                ],
              },
            },
          },
        ],
      }),
    ).toThrow();
  });
});
