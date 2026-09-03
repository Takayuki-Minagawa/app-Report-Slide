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
    table.content[1].content[0].content.push({
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
});
