import { renderToStaticMarkup } from 'react-dom/server.browser';
import { describe, expect, it } from 'vitest';
import type { ChartNode } from '@/src/document/model';
import { ChartGraphic } from './chart-graphic';

function chart(data: ChartNode['attrs']['data']): ChartNode {
  return {
    type: 'chart',
    attrs: {
      nodeId: 'chart',
      chartType: 'line',
      data,
      xLabel: 'X',
      yLabel: 'Y',
      series: 'Extreme',
      alt: 'Extreme chart',
      width: 100,
    },
  };
}

describe('chart SVG', () => {
  it('renders valid extreme numbers without invalid SVG coordinates', () => {
    const html = renderToStaticMarkup(
      <ChartGraphic
        node={chart([
          { label: 'low', x: -1e308, y: -1e308 },
          { label: 'high', x: 1e308, y: 1e308 },
        ])}
      />,
    );
    expect(html).not.toMatch(/NaN|Infinity/);
    expect(html).toContain('Extreme chart');
    expect(html).toContain('<path');
  });
});
