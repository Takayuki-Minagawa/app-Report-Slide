import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportSlideHtml } from './slide-html';

function slides(body: string, metadata = '') {
  return parseMarkdown(
    '---\ntype: slide\ntitle: HTML export\n' + metadata + '---\n\n' + body,
  ).document;
}
function readHtml(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('standalone slide HTML', () => {
  it('embeds math fonts, pages, numbering and cross-slide references without app dependencies', async () => {
    const source = slides(
      '# Intro\n{#sec:intro}\n\n$E=mc^2$\n\n[@sec:result]\n\n::: slidebreak\n:::\n\n# Result\n{#sec:result}',
      'toc: true\nnumber_sections: true\ntheme: technical\nauthor: KUMI\n',
    );
    const before = JSON.stringify(source);
    const { html, externalImages } = await exportSlideHtml(
      source,
      new Map(),
      'en',
    );
    const result = readHtml(html);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(result.documentElement.lang).toBe('en');
    expect(result.title).toBe('HTML export');
    expect(result.querySelectorAll('.deck-slide')).toHaveLength(2);
    expect(result.querySelectorAll('.katex')).toHaveLength(1);
    expect(result.querySelector('#slide-1')?.getAttribute('data-theme')).toBe(
      'technical',
    );
    expect(result.querySelector('#slide-1 footer')?.textContent).toBe(
      'KUMI1 / 2',
    );
    expect(result.querySelectorAll('.document-toc')).toHaveLength(1);
    const reference = result.querySelector('.preview-reference')!;
    const target = result.getElementById(
      decodeURIComponent(reference.getAttribute('href')!.slice(1)),
    );
    expect(target?.closest('article')?.id).toBe('slide-2');
    expect(result.querySelector('#deck-next')?.textContent).toBe('Next');
    expect(result.querySelector('#deck-print')?.textContent).toBe(
      'Print / Save PDF',
    );
    expect(
      result.querySelector('progress#deck-progress')?.getAttribute('max'),
    ).toBe('2');
    const css = result.querySelector('style')!.textContent!;
    const fontUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map(
      (match) => match[1],
    );
    expect(fontUrls).toHaveLength(20);
    expect([...css.matchAll(/@font-face\s*\{/g)]).toHaveLength(20);
    expect(
      fontUrls.every((url) => url.startsWith('data:font/woff2;base64,')),
    ).toBe(true);
    expect(result.querySelector('link, script[src]')).toBeNull();
    expect(
      result.querySelector<HTMLTemplateElement>('#katex-license')!.content
        .textContent,
    ).toContain('MIT License');
    const script = result.querySelector('script')!.textContent!;
    const hash = createHash('sha256').update(script).digest('base64');
    expect(
      result
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content'),
    ).toContain("'sha256-" + hash + "'");
    expect(externalImages).toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('embeds imported SVG images once per blob and leaves external URLs untouched', async () => {
    const fetchImage = vi.fn().mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', {
        headers: { 'content-type': 'image/svg+xml' },
      }),
    );
    vi.stubGlobal('fetch', fetchImage);
    const source = slides(
      '![A](chart.svg)\n\n![B](alias.svg)\n\n![Remote](https://example.com/chart.png)',
    );
    const result = await exportSlideHtml(
      source,
      new Map([
        ['chart.svg', 'blob:chart'],
        ['alias.svg', 'blob:chart'],
      ]),
      'ja',
    );
    const html = readHtml(result.html);
    const urls = [...html.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(urls[0]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(urls[1]).toBe(urls[0]);
    expect(urls[2]).toBe('https://example.com/chart.png');
    expect(result.externalImages).toEqual(['https://example.com/chart.png']);
    expect(fetchImage).toHaveBeenCalledExactlyOnceWith('blob:chart');
    expect(result.html).not.toContain('blob:chart');
    expect(html.querySelector('#deck-next')?.textContent).toBe('次へ');
    expect(html.querySelector('#deck-print')?.textContent).toBe(
      '印刷／PDF保存',
    );
  });

  it('rejects missing local images before fetching any assets', async () => {
    const fetchImage = vi.fn();
    vi.stubGlobal('fetch', fetchImage);
    await expect(
      exportSlideHtml(slides('![Missing](missing.png)'), new Map(), 'ja'),
    ).rejects.toMatchObject({
      status: { key: 'htmlMissingImages', args: ['missing.png'] },
    });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it.each(['unreadable', 'wrong-mime'] as const)(
    'reports an %s attachment without producing partial output',
    async (reason) => {
      vi.stubGlobal(
        'fetch',
        reason === 'unreadable'
          ? vi.fn().mockRejectedValue(new Error('Revoked URL'))
          : vi.fn().mockResolvedValue(
              new Response('<html/>', {
                headers: { 'content-type': 'text/html' },
              }),
            ),
      );
      await expect(
        exportSlideHtml(
          slides('![A](a.png)'),
          new Map([['a.png', 'blob:a']]),
          'ja',
        ),
      ).rejects.toMatchObject({
        status: { key: 'htmlImageReadFailed', args: ['a.png'] },
      });
    },
  );

  it('retains inline data images and rejects non-slide documents', async () => {
    const fetchImage = vi.fn();
    vi.stubGlobal('fetch', fetchImage);
    const source = slides('![Inline](data:image/png;base64,AA==)');
    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    expect(result.querySelector('img')?.getAttribute('src')).toBe(
      'data:image/png;base64,AA==',
    );
    await expect(
      exportSlideHtml({ ...source, type: 'report' }, new Map(), 'ja'),
    ).rejects.toMatchObject({ status: { key: 'htmlSlidesOnly' } });
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('escapes document text and metadata instead of creating executable HTML', async () => {
    const source = slides('# Safe');
    source.metadata.title = '</title><script>alert(1)</script>';
    source.metadata.author = '<img src=x onerror=alert(1)>';
    source.children.push({
      type: 'paragraph',
      attrs: { nodeId: 'unsafe-text' },
      content: [{ type: 'text', text: '</style><script>alert(2)</script>' }],
    });
    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    expect(result.title).toBe(source.metadata.title);
    expect(result.querySelectorAll('script')).toHaveLength(1);
    expect(result.querySelector('img, [onerror]')).toBeNull();
    expect(result.querySelector('.document-renderer')?.textContent).toContain(
      '</style><script>alert(2)</script>',
    );
  });

  it('keeps empty slides, hidden slide numbers and multiple paragraphs in a table cell', async () => {
    const source = slides(
      '::: slidebreak\n:::\n\n| First |\n| --- |\n| Cell |\n\n::: slidebreak\n:::',
      'slide_number: false\n',
    );
    const table = source.children.find((node) => node.type === 'table')!;
    table.content[1].content![0].content.push({
      type: 'paragraph',
      attrs: { nodeId: 'second-cell-paragraph' },
      content: [{ type: 'text', text: 'Second paragraph' }],
    });
    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    expect(result.querySelectorAll('.deck-slide')).toHaveLength(3);
    expect(result.querySelector('#slide-1 footer')?.textContent).not.toContain(
      '1',
    );
    expect(result.querySelectorAll('td p')).toHaveLength(2);
    expect(result.querySelector('td p + p')?.textContent).toBe(
      'Second paragraph',
    );
  });

  it('keeps merged cells and custom borders in standalone HTML', async () => {
    const source = slides('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    const table = source.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');

    const merged = table.content[0].content![0];
    table.content[0].content!.splice(1, 1);
    merged.attrs.colspan = 2;
    merged.attrs.rowspan = 2;
    merged.attrs.borders = {
      top: { color: '#0f766e', style: 'double', width: 2 },
      right: null,
    };
    table.content[1].content!.splice(0, 2);

    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    const cell = result.querySelector('th') as HTMLTableCellElement;

    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(2);
    expect(cell.style.borderTop).toContain('double');
    expect(cell.style.borderTop).toContain('rgb(15, 118, 110)');
    expect(cell.style.borderRightColor).toBe('transparent');
    expect(result.querySelectorAll('td')).toHaveLength(1);
  });

  it('renders stored column widths across merged and row-spanning cells', async () => {
    const source = slides(
      '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |',
    );
    const table = source.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');

    const merged = table.content[0].content![0];
    table.content[0].content!.splice(1, 1);
    merged.attrs.colspan = 2;
    merged.attrs.rowspan = 2;
    merged.attrs.colwidth = [120, 0];
    table.content[0].content![1].attrs.colwidth = [180];
    table.content[1].content!.splice(0, 2);
    table.content[2].content![1].attrs.colwidth = [240];

    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    const columns = [...result.querySelectorAll<HTMLTableColElement>('col')];
    const renderedTable = result.querySelector<HTMLTableElement>(
      '.preview-table-sized',
    );

    expect(columns.map((column) => column.style.width)).toEqual([
      '120px',
      '240px',
      '180px',
    ]);
    expect(renderedTable?.style.width).toBe('540px');
    expect(renderedTable?.querySelector('th')?.colSpan).toBe(2);
    expect(renderedTable?.querySelector('th')?.rowSpan).toBe(2);
    expect(result.querySelector('style')?.textContent).toContain(
      '.preview-table-wrap table.preview-table-sized',
    );
  });

  it('leaves unsized tables fluid and keeps unspecified columns fluid', async () => {
    const source = slides('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    const defaultResult = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    expect(defaultResult.querySelector('colgroup')).toBeNull();
    expect(defaultResult.querySelector('.preview-table-sized')).toBeNull();

    const table = source.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    table.content[0].content![0].attrs.colwidth = [150];
    table.content[0].content![1].attrs.colwidth = [0];
    table.content[0].content![2].attrs.colwidth = [90];
    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    const columns = [...result.querySelectorAll<HTMLTableColElement>('col')];
    const renderedTable = result.querySelector<HTMLTableElement>(
      '.preview-table-sized',
    );
    expect(columns.map((column) => column.style.width)).toEqual([
      '150px',
      '',
      '90px',
    ]);
    expect(renderedTable?.style.width).toBe('');
    expect(renderedTable?.style.minWidth).toBe('320px');
  });

  it('renders a table row that is completely covered by a row-spanning cell', async () => {
    const source = slides('| A | B |\n| --- | --- |\n| 1 | 2 |');
    const table = source.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');

    const merged = table.content[0].content![0];
    table.content[0].content!.splice(1, 1);
    merged.attrs.colspan = 2;
    merged.attrs.rowspan = 2;
    table.content[1].content!.splice(0, 2);
    delete (table.content[1] as unknown as Record<string, unknown>).content;

    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    const cell = result.querySelector('th') as HTMLTableCellElement;
    expect(cell.colSpan).toBe(2);
    expect(cell.rowSpan).toBe(2);
    expect(result.querySelectorAll('tr')).toHaveLength(2);
  });
  it('preserves PowerPoint-style image placement in standalone HTML', async () => {
    const source = slides(
      '![Placed](data:image/png;base64,AA==)\n{slide_layout="12,18,40,30"}',
    );
    const result = readHtml(
      (await exportSlideHtml(source, new Map(), 'ja')).html,
    );
    const figure = result.querySelector<HTMLElement>(
      '.slide-positioned-figure',
    );

    expect(figure).not.toBeNull();
    expect(figure?.style.left).toBe('12%');
    expect(figure?.style.top).toBe('18%');
    expect(figure?.style.width).toBe('40%');
    expect(figure?.style.height).toBe('30%');
    expect(result.querySelector('style')?.textContent).toContain(
      '.slide-positioned-figure',
    );
  });
});
