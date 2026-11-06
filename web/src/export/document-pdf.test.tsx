import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportDocumentPdf } from './document-pdf';
import { exportReportHtml } from './report-html';
import type { ReportPaginationResult } from './pagination-ready';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));
vi.mock('./report-html', () => ({ exportReportHtml: vi.fn() }));

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
let captures: {
  markup: string;
  transform: string;
  policy: string | null;
  width: number;
  height: number;
  ratio: number;
}[];
let canvases: HTMLCanvasElement[];

beforeEach(() => {
  captures = [];
  canvases = [];
  vi.mocked(toCanvas)
    .mockReset()
    .mockImplementation(async (node, options = {}) => {
      captures.push({
        markup: node.innerHTML,
        transform:
          node.querySelector<HTMLElement>('#pdf-content')?.style.transform ??
          '',
        policy: node.ownerDocument
          .querySelector('meta[http-equiv="Content-Security-Policy"]')!
          .getAttribute('content'),
        width: options.width!,
        height: options.height!,
        ratio: options.pixelRatio!,
      });
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      canvas.toDataURL = () => png;
      canvases.push(canvas);
      return canvas;
    });
});
afterEach(() => vi.unstubAllGlobals());

async function pdfText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

function mockContentHeight(
  height: number,
  slideOverflow = false,
  clippedCode = false,
) {
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(function <
    T extends Node,
  >(node: T): T {
    append(node);
    if (node instanceof HTMLIFrameElement) {
      if (clippedCode) {
        const codePrototype = Object.getPrototypeOf(
          node.contentDocument!.createElement('pre'),
        );
        Object.defineProperty(codePrototype, 'scrollWidth', {
          configurable: true,
          get: () => 500,
        });
        Object.defineProperty(codePrototype, 'clientWidth', {
          configurable: true,
          get: () => 100,
        });
      }
      const prototype = Object.getPrototypeOf(
        node.contentDocument!.createElement('article'),
      );
      Object.defineProperty(prototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.tagName === 'ARTICLE' && slideOverflow ? height : 0;
        },
      });
      const divPrototype = Object.getPrototypeOf(
        node.contentDocument!.createElement('div'),
      );
      Object.defineProperty(divPrototype, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.id === 'pdf-content' ? height : 0;
        },
      });
    }
    return node;
  });
}

function mockPaginatedFrame(
  ready: Promise<ReportPaginationResult>,
  pageCount = 3,
  prepare?: (frame: Document) => void,
  initialBlankLoad = false,
) {
  vi.mocked(exportReportHtml).mockResolvedValue({
    html: '<!doctype html><html><body>Shared report HTML</body></html>',
    externalImages: [],
  });
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(function <
    T extends Node,
  >(node: T): T {
    append(node);
    if (node instanceof HTMLIFrameElement) {
      expect(node.getAttribute('sandbox')).toContain('allow-scripts');
      expect(node.srcdoc).toContain('Shared report HTML');
      if (initialBlankLoad) node.dispatchEvent(new Event('load'));
      const frame = node.contentDocument!;
      frame.head.innerHTML =
        '<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; script-src &apos;sha256-test&apos;">';
      frame.body.innerHTML = Array.from(
        { length: pageCount },
        (_, index) =>
          `<div class="pagedjs_page"><p>Physical page ${index + 1}</p><footer>${index + 1}</footer></div>`,
      ).join('');
      prepare?.(frame);
      frame.documentElement.dataset.kumiPagination = 'pending';
      Object.assign(node.contentWindow!, {
        kumiPaginationReady: ready.then((result) => {
          frame.documentElement.dataset.kumiPagination = 'ready';
          return result;
        }),
      });
      queueMicrotask(() => node.dispatchEvent(new Event('load')));
    }
    return node;
  });
}

describe('PDF export', () => {
  it('waits for pagination and captures each completed physical page exactly once', async () => {
    let complete!: (result: ReportPaginationResult) => void;
    mockPaginatedFrame(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const source = parseMarkdown('One source page').document;
    source.metadata.report_settings = { toc_page_numbers: true };
    const pending = exportDocumentPdf(source, new Map(), 'en');
    await vi.waitFor(() =>
      expect(document.querySelector('iframe[data-kumi-pdf]')).not.toBeNull(),
    );
    expect(toCanvas).not.toHaveBeenCalled();
    complete({ pageCount: 3, bodyPageCount: 2 });
    const { blob, warnings } = await pending;
    expect(await pdfText(blob)).toContain('/Count 3');
    expect(
      captures.map(
        (capture) =>
          new DOMParser().parseFromString(capture.markup, 'text/html').body
            .textContent,
      ),
    ).toEqual(['Physical page 11', 'Physical page 22', 'Physical page 33']);
    expect(captures.every((capture) => capture.transform === '')).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(toCanvas).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        fontEmbedCSS: expect.stringContaining('Noto Serif JP'),
      }),
    );
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
    expect(
      canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true);
  });

  it('rejects incomplete pagination before capturing any page', async () => {
    mockPaginatedFrame(Promise.resolve({ pageCount: 4, bodyPageCount: 3 }));
    const source = parseMarkdown('Report').document;
    source.metadata.report_settings = { toc_page_numbers: true };
    await expect(exportDocumentPdf(source, new Map(), 'en')).rejects.toThrow(
      'Could not generate the PDF',
    );
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });

  it('ignores the initial blank frame load before the paginated HTML starts', async () => {
    mockPaginatedFrame(
      Promise.resolve({ pageCount: 1, bodyPageCount: 1 }),
      1,
      undefined,
      true,
    );
    const source = parseMarkdown('Report').document;
    source.metadata.report_settings = { toc_page_numbers: true };
    const { blob } = await exportDocumentPdf(source, new Map(), 'en');
    expect(await pdfText(blob)).toContain('/Count 1');
    expect(toCanvas).toHaveBeenCalledTimes(1);
  });

  it('preserves exact font sizes and captioned table row heights in the capture clone', async () => {
    let originalPage!: HTMLElement;
    mockPaginatedFrame(
      Promise.resolve({ pageCount: 1, bodyPageCount: 1 }),
      1,
      (frame) => {
        originalPage = frame.querySelector('.pagedjs_page')!;
        originalPage.innerHTML =
          '<p style="font-size:14.25px" data-kumi-pdf-layout="original">Fractional text</p>' +
          '<table style="height:111.469px"><caption>Caption</caption><tbody><tr><td style="font-size:12.04px">Cell</td></tr></tbody></table>' +
          '<table><tbody><tr><td>Uncaptioned</td></tr></tbody></table>';
      },
    );
    const capture = vi.mocked(toCanvas).getMockImplementation()!;
    vi.mocked(toCanvas).mockImplementation(async (node, options) => {
      const paragraph = node.querySelector('p')!;
      const cell = node.querySelector('td')!;
      const [captioned, uncaptioned] = node.querySelectorAll('table');
      const rule = (element: Element) =>
        `[data-kumi-pdf-layout="${element.getAttribute('data-kumi-pdf-layout')}"]`;
      const css = options!.fontEmbedCSS!;
      expect(css).toContain(`${rule(paragraph)}{font-size:14.25px!important;}`);
      expect(css).toContain(`${rule(cell)}{font-size:12.04px!important;}`);
      const tableRule = css
        .slice(css.indexOf(rule(captioned)))
        .split('}', 1)[0];
      expect(tableRule).toContain(
        'height:auto!important;block-size:auto!important;',
      );
      const plainRule = css
        .slice(css.indexOf(rule(uncaptioned)))
        .split('}', 1)[0];
      expect(plainRule).not.toContain('height:');
      // Corrections belong to the clone stylesheet, never the live page's CSS.
      expect(paragraph.style.fontSize).toBe('14.25px');
      expect(captioned.style.height).toBe('111.469px');
      return capture(node, options);
    });
    const source = parseMarkdown('Report').document;
    source.metadata.report_settings = { toc_page_numbers: true };
    await exportDocumentPdf(source, new Map(), 'en');
    expect(originalPage.hasAttribute('data-kumi-pdf-layout')).toBe(false);
    expect(originalPage.querySelector('p')).toHaveAttribute(
      'data-kumi-pdf-layout',
      'original',
    );
    expect(
      originalPage.querySelectorAll('table[data-kumi-pdf-layout]'),
    ).toHaveLength(0);
  });

  it('restores capture markers even when rasterization fails', async () => {
    let originalPage!: HTMLElement;
    mockPaginatedFrame(
      Promise.resolve({ pageCount: 1, bodyPageCount: 1 }),
      1,
      (frame) => {
        originalPage = frame.querySelector('.pagedjs_page')!;
      },
    );
    vi.mocked(toCanvas).mockRejectedValue(new Error('Capture failed'));
    const source = parseMarkdown('Report').document;
    source.metadata.report_settings = { toc_page_numbers: true };
    await expect(exportDocumentPdf(source, new Map(), 'en')).rejects.toThrow(
      'Could not generate the PDF',
    );
    expect(originalPage.hasAttribute('data-kumi-pdf-layout')).toBe(false);
    expect(originalPage.querySelector('[data-kumi-pdf-layout]')).toBeNull();
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });

  it('writes a real PDF with all explicit report pages including empty pages and excludes notes', async () => {
    const source = parseMarkdown(
      '---\ntype: report\n---\n\n::: pagebreak\n:::\n\n# Report\n\n数式 $x^2$\n\n::: notes\nPRIVATE NOTE ![private](https://example.com/private.png)\n:::\n\n::: pagebreak\n:::\n\n::: pagebreak\n:::',
    ).document;
    const { blob, warnings } = await exportDocumentPdf(source, new Map(), 'en');
    const pdf = await pdfText(blob);
    expect(blob.type).toBe('application/pdf');
    expect(pdf).toMatch(/^%PDF-/);
    expect(pdf).toContain('/Count 4');
    expect(captures).toHaveLength(4);
    expect(captures[1].markup).toContain('katex');
    expect(captures.map((capture) => capture.markup).join('')).not.toContain(
      'PRIVATE NOTE',
    );
    expect(captures[0].policy).toContain("default-src 'none'");
    expect(warnings[0]).toContain('cannot be selected');
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
    expect(
      canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
    ).toBe(true);
  });

  it('captures generated cover and contents pages before the numbered report body', async () => {
    const source = parseMarkdown('# Body\n\nReport text').document;
    Object.assign(source.metadata, {
      title: 'Cover title',
      toc: true,
      report_settings: { cover: true, toc_page: true },
    });
    const { blob } = await exportDocumentPdf(source, new Map(), 'ja');
    expect(await pdfText(blob)).toContain('/Count 3');
    expect(captures).toHaveLength(3);
    expect(captures[0].markup).toContain('data-report-page-kind="cover"');
    expect(captures[0].markup).toContain('Cover title');
    expect(captures[0].markup).not.toContain('<footer>');
    expect(captures[1].markup).toContain('data-report-page-kind="contents"');
    expect(captures[1].markup).toContain('document-toc');
    expect(captures[2].markup).toContain('<footer><span>1</span></footer>');
  });

  it('uses slide proportions and preserves the slide theme', async () => {
    const source = parseMarkdown(
      '---\ntype: slide\ntheme: technical\n---\n\n# Slide\n\n::: slidebreak\n:::\n\n# Second',
    ).document;
    const { blob } = await exportDocumentPdf(source, new Map(), 'ja');
    expect(await pdfText(blob)).toContain('/Count 2');
    expect(captures[0]).toMatchObject({ width: 960, height: 540, ratio: 2 });
    expect(captures[0].markup).toContain('data-theme="technical"');
  });

  it('slices a tall report without allocating one tall canvas', async () => {
    mockContentHeight(2600);
    const source = parseMarkdown(
      '---\ntype: report\n---\n\nLong report',
    ).document;
    const { blob, warnings } = await exportDocumentPdf(source, new Map(), 'en');
    expect(await pdfText(blob)).toContain('/Count 3');
    expect(captures).toHaveLength(3);
    expect(captures[0].transform).toBe('translateY(0px)');
    expect(captures[1].transform).toBe(`translateY(${-captures[0].height}px)`);
    expect(
      captures.every(
        (capture) =>
          capture.width * capture.height * capture.ratio ** 2 <=
          8 * 1024 * 1024,
      ),
    ).toBe(true);
    expect(warnings.join(' ')).toContain('split across pages');
  });

  it('rejects an overflowing slide instead of clipping its content', async () => {
    mockContentHeight(1000, true);
    const source = parseMarkdown(
      '---\ntype: slide\n---\n\nLong slide',
    ).document;
    await expect(exportDocumentPdf(source, new Map(), 'en')).rejects.toThrow(
      'Split the slide',
    );
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });

  it('cleans up the isolated document after a rendering error', async () => {
    vi.mocked(toCanvas).mockRejectedValue(new Error('Capture failed'));
    const source = parseMarkdown('---\ntype: report\n---\n\nReport').document;
    await expect(exportDocumentPdf(source, new Map(), 'ja')).rejects.toThrow(
      'PDFを生成できませんでした',
    );
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });

  it('rejects horizontally clipped code instead of silently losing text', async () => {
    mockContentHeight(1000, false, true);
    const source = parseMarkdown(
      '---\ntype: report\n---\n\n```\nA very long code line\n```',
    ).document;
    await expect(exportDocumentPdf(source, new Map(), 'en')).rejects.toThrow(
      'Reduce its width or font size',
    );
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });

  it('rejects a missing image before creating an export iframe', async () => {
    const source = parseMarkdown(
      '---\ntype: report\n---\n\n![chart](missing.png)',
    ).document;
    await expect(exportDocumentPdf(source, new Map(), 'en')).rejects.toThrow(
      'is missing',
    );
    expect(toCanvas).not.toHaveBeenCalled();
    expect(document.querySelector('iframe[data-kumi-pdf]')).toBeNull();
  });
});
