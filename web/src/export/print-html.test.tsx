import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportPrintHtml } from './print-html';

describe('searchable browser print output', () => {
  it.each(['report', 'slide'] as const)(
    'keeps %s text, math, tables and SVG native; omits private source and speaker notes',
    async (type) => {
      const source = parseMarkdown(
        `---\ntype: ${type}\ntitle: 検索可能な資料\n---\n\n# 日本語の本文\n\n$x^2$ と本文\n\n|項目|値|\n|---|---|\n|結果|42|\n\n::: ${type === 'slide' ? 'slidebreak' : 'pagebreak'}\n:::\n\n# 第二ページ\n\n::: notes\n秘密のノート\n:::`,
      ).document;
      source.metadata.preserved_content = [
        {
          id: 'raw',
          name: '原文',
          format: 'html',
          source: 'SECRET_ORIGINAL_SOURCE',
        },
      ];
      const result = await exportPrintHtml(source, new Map(), 'ja');
      const dom = new DOMParser().parseFromString(result.html, 'text/html');
      expect(result.pageCount).toBe(2);
      expect(dom.querySelectorAll('.print-page')).toHaveLength(2);
      expect(dom.querySelector('h1')?.textContent).toContain('日本語の本文');
      expect(dom.querySelector('table')?.textContent).toContain('42');
      expect(dom.querySelector('.katex')).not.toBeNull();
      expect(dom.querySelector('canvas')).toBeNull();
      expect(dom.querySelector('script')).toBeNull();
      expect(result.html).not.toContain('秘密のノート');
      expect(result.html).not.toContain('SECRET_ORIGINAL_SOURCE');
      expect(result.html).toContain(
        type === 'slide' ? 'size:320mm 180mm' : 'size:210mm 297mm',
      );
    },
  );

  it('lists raster elements without confusing SVG images with raster images', async () => {
    const source = parseMarkdown(
      '![写真](https://example.com/photo.png)\n\n![ベクター](https://example.com/chart.svg)',
    ).document;
    const result = await exportPrintHtml(source, new Map(), 'ja');
    expect(result.rasterElements).toEqual(['写真']);
    expect(result.externalImages).toHaveLength(2);
    expect(result.html).toContain('https://example.com/chart.svg');
  });
});
