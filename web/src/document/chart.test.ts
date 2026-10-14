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
