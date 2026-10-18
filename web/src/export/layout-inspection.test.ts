import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { layoutInspectionSource } from './layout-inspection';

interface Metrics {
  width: number;
  height: number;
  left?: number;
  top?: number;
  scrollWidth?: number;
  scrollHeight?: number;
}

function measure(element: Element, metrics: Metrics) {
  const { width, height, left = 0, top = 0 } = metrics;
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  });
  for (const [name, value] of Object.entries({
    clientWidth: width,
    clientHeight: height,
    offsetWidth: width,
    offsetHeight: height,
    scrollWidth: metrics.scrollWidth ?? width,
    scrollHeight: metrics.scrollHeight ?? height,
  })) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
}

function report(height = 1000, child = '') {
  const page = document.createElement('div');
  page.className = 'report-sheet';
  page.style.minHeight = '1000px';
  page.innerHTML = `<article class="report-layout">${child}</article>`;
  document.body.appendChild(page);
  measure(page, { width: 700, height });
  return page;
}

beforeEach(() => {
  document.body.innerHTML = '';
  window.eval(layoutInspectionSource);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('standalone page layout inspection', () => {
  it('keeps explicit page numbers and the same two-pixel tolerance as the warning', () => {
    report();
    report(1002);
    report(1003);
    const result = window.kumiInspectDocumentLayout();
    expect(result.schemaVersion).toBe(1);
    expect(result.status).toBe('overflow');
    expect(result.tolerancePx).toBe(2);
    expect(result.pages.map(({ page, status }) => [page, status])).toEqual([
      [1, 'pass'],
      [2, 'pass'],
      [3, 'overflow'],
    ]);
    expect(result.pages[2].issues[0]).toMatchObject({
      code: 'page-height',
      measuredPx: 1003,
      limitPx: 1000,
    });
  });

  it('reports clipped horizontal and vertical content with its source node ID', () => {
    const page = report(
      1000,
      '<div data-node-id="table-2" style="overflow:auto"></div>',
    );
    const table = page.querySelector('[data-node-id]')!;
    measure(table, {
      width: 500,
      height: 100,
      scrollWidth: 750,
      scrollHeight: 150,
    });
    const result = window.kumiInspectDocumentLayout();
    expect(result.pages[0].issues).toEqual([
      {
        code: 'clipped-x',
        element: 'div',
        nodeId: 'table-2',
        measuredPx: 750,
        limitPx: 500,
      },
      {
        code: 'clipped-y',
        element: 'div',
        nodeId: 'table-2',
        measuredPx: 150,
        limitPx: 100,
      },
    ]);
  });

  it('detects content beyond the left/top edge that scroll extents do not include', () => {
    const page = report(1000, '<p data-node-id="outside">Content</p>');
    measure(page.querySelector('p')!, {
      left: -20,
      top: -10,
      width: 100,
      height: 20,
    });
    const { issues } = window.kumiInspectDocumentLayout().pages[0];
    expect(issues).toEqual([
      {
        code: 'page-width',
        element: 'p',
        nodeId: 'outside',
        measuredPx: 720,
        limitPx: 700,
      },
      {
        code: 'page-height',
        element: 'p',
        nodeId: 'outside',
        measuredPx: 1010,
        limitPx: 1000,
      },
    ]);
  });

  it('ignores KaTeX accessibility clipping while still checking visible math', () => {
    const page = report(
      1000,
      '<span class="katex-mathml" style="overflow:hidden"></span><span class="katex-html" style="overflow:auto"></span>',
    );
    for (const element of page.querySelectorAll('span')) {
      measure(element, { width: 100, height: 20, scrollWidth: 300 });
    }
    const issues = window.kumiInspectDocumentLayout().pages[0].issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('clipped-x');
  });

  it('does not pass missing pages, unstyled pages, or hidden pages', () => {
    expect(window.kumiInspectDocumentLayout()).toMatchObject({
      status: 'unmeasured',
      pages: [],
    });
    const page = report();
    page.style.minHeight = '';
    expect(window.kumiInspectDocumentLayout().status).toBe('unmeasured');
    page.style.minHeight = '1000px';
    measure(page, { width: 0, height: 0 });
    expect(window.kumiInspectDocumentLayout().pages[0].status).toBe(
      'unmeasured',
    );
  });

  it('does not compare transformed page bounds with untransformed scroll dimensions', () => {
    const page = report();
    Object.defineProperty(page, 'offsetWidth', { value: 1400 });
    const result = window.kumiInspectDocumentLayout();
    expect(result.status).toBe('unmeasured');
    expect(result.pages[0].issues[0].reason).toContain('transformed');
  });

  it('does not pass an undecoded or failed image', () => {
    report(1000, '<img src="data:image/png;base64,invalid" alt="Example">');
    const result = window.kumiInspectDocumentLayout();
    expect(result.status).toBe('unmeasured');
    expect(result.pages[0].issues[0]).toMatchObject({
      code: 'unmeasured',
      element: 'img',
    });
  });

  it('does not pass while web fonts are still loading', () => {
    report();
    const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { status: 'loading' },
    });
    try {
      const result = window.kumiInspectDocumentLayout();
      expect(result.status).toBe('unmeasured');
      expect(result.pages[0].issues[0].reason).toContain('Fonts');
    } finally {
      if (previous) Object.defineProperty(document, 'fonts', previous);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('does not pass if font loading settled with an error', () => {
    report();
    const previous = Object.getOwnPropertyDescriptor(document, 'fonts');
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loaded',
        *[Symbol.iterator]() {
          yield { status: 'error' };
        },
      },
    });
    try {
      const result = window.kumiInspectDocumentLayout();
      expect(result.status).toBe('unmeasured');
      expect(result.pages[0].issues[0].reason).toContain('could not be loaded');
    } finally {
      if (previous) Object.defineProperty(document, 'fonts', previous);
      else Reflect.deleteProperty(document, 'fonts');
    }
  });

  it('inspects unscaled visible slides and reports hidden slides as unmeasured', () => {
    document.body.innerHTML =
      '<article class="slide-preview" data-page="1" style="height:517.5px;overflow:hidden"><p>Large content</p></article><article class="slide-preview" data-page="2" hidden></article>';
    const slide = document.querySelector('article')!;
    measure(slide, { width: 920, height: 517.5, scrollHeight: 600 });
    const result = window.kumiInspectDocumentLayout();
    expect(result.status).toBe('unmeasured');
    expect(result.pages[0]).toMatchObject({
      type: 'slide',
      status: 'overflow',
      limitHeightPx: 517.5,
      issues: [
        {
          code: 'clipped-y',
          measuredPx: 600,
          limitPx: 517.5,
        },
      ],
    });
    expect(result.pages[1].status).toBe('unmeasured');
  });
});
