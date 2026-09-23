import { describe, expect, it } from 'vitest';
import type { ChartNode } from '@/src/document/model';
import { parseMarkdown } from './parser';
import { serializeDocument } from './serializer';

describe('editable chart Markdown', () => {
  it.each(['report', 'slide'] as const)(
    'preserves %s chart data and attributes through Markdown',
    (type) => {
      const chart: ChartNode = {
        type: 'chart',
        attrs: {
          nodeId: 'chart-1',
          chartType: 'scatter',
          data: [
            { label: '東京', x: 1.5, y: -2 },
            { label: '大阪', x: 3, y: 4 },
          ],
          xLabel: '時間',
          yLabel: '変位',
          series: '実測',
          alt: '変位の散布図',
          width: 75,
          caption: '計測結果',
        },
      };
      const source = {
        schemaVersion: 2 as const,
        type,
        metadata: { title: 'Chart' },
        children: [chart],
      };
      const markdown = serializeDocument(source);
      expect(markdown).toContain('::: kumi-chart');
      const result = parseMarkdown(markdown);
      expect(
        result.diagnostics.filter(
          (diagnostic) => diagnostic.severity === 'error',
        ),
      ).toEqual([]);
      expect(result.document.children[0]).toMatchObject({
        type: 'chart',
        attrs: { ...chart.attrs, nodeId: expect.any(String) },
      });
    },
  );
});
