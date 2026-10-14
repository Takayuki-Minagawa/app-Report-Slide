import { renderToStaticMarkup } from 'react-dom/server.browser';
import { describe, expect, it } from 'vitest';
import type { ChartNode } from '@/src/document/model';
import { ChartGraphic } from './chart-graphic';
import { resolveChartPlot } from '@/src/document/chart';

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
  it('renders independently styled series, units, and grouped horizontal values', () => {
    const node = chart([
      { label: 'A', x: 1, y: 2 },
      { label: 'B', x: 2, y: 3 },
    ]);
    const plot = resolveChartPlot(node.attrs);
    plot.series.push({
      ...plot.series[0],
      name: 'Analysis',
      color: '#bb4d34',
      dash: 'dashed',
      marker: 'triangle',
      data: [
        { label: 'A', x: 1, y: 4 },
        { label: 'B', x: 2, y: 5 },
      ],
    });
    plot.yUnit = 's';
    node.attrs.plot = plot;
    const html = renderToStaticMarkup(<ChartGraphic node={node} />);
    expect(html).toContain('stroke-dasharray="9 5"');
    expect(html).toContain('data-chart-series="Analysis"');
    expect(html).toContain('Y (s)');
    node.attrs.chartType = 'bar';
    plot.orientation = 'horizontal';
    plot.showValues = true;
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<ChartGraphic node={node} />),
      'text/html',
    );
    const bars = [...doc.querySelectorAll('[data-chart-series] rect')];
    expect(bars).toHaveLength(4);
    expect(Number(bars[2].getAttribute('width'))).toBeGreaterThan(
      Number(bars[0].getAttribute('width')),
    );
    expect(bars[2].getAttribute('y')).not.toBe(bars[0].getAttribute('y'));
  });
  it('clips out-of-range data without drawing misleading labels on the edge', () => {
    const node = chart([
      { label: 'Outside', x: 9, y: 9 },
      { label: 'Inside', x: 1, y: 1 },
    ]);
    node.attrs.plot = {
      ...resolveChartPlot(node.attrs),
      xMin: 0,
      xMax: 2,
      yMin: 0,
      yMax: 2,
      showValues: true,
    };
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<ChartGraphic node={node} />),
      'text/html',
    );
    expect(
      [...doc.querySelectorAll('text')].map((text) => text.textContent),
    ).not.toContain('Outside');
    expect(
      [...doc.querySelectorAll('[data-chart-series] text')].map(
        (text) => text.textContent,
      ),
    ).toEqual(['1']);
  });
  it('keeps repeated categories visible as separate legacy bar observations', () => {
    const node = chart([
      { label: 'A', x: 1, y: 2 },
      { label: 'A', x: 1, y: 3 },
    ]);
    node.attrs.chartType = 'bar';
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<ChartGraphic node={node} />),
      'text/html',
    );
    const bars = [...doc.querySelectorAll('[data-chart-series] rect')];
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute('x')).not.toBe(bars[1].getAttribute('x'));
    expect(bars[0].getAttribute('height')).not.toBe(
      bars[1].getAttribute('height'),
    );
  });
});
