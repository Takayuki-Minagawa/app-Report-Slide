import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportDocumentPdf } from './document-pdf';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

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
          node.querySelector<HTMLElement>('#pdf-content')!.style.transform,
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

describe('PDF export', () => {
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
