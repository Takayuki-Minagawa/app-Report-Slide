import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportReportHtml } from './report-html';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('standalone Report HTML', () => {
  it('keeps paragraph ruler positions in exported reports', async () => {
    const source = parseMarkdown(
      '---\ntype: report\n---\n\nIndented report text\n{text_ruler=10,5,15}',
    ).document;
    const { html } = await exportReportHtml(source, new Map(), 'ja');
    const paragraph = new DOMParser()
      .parseFromString(html, 'text/html')
      .querySelector<HTMLElement>('.report-sheet .document-renderer > p');
    expect(paragraph?.style.marginLeft).toBe('10%');
    expect(paragraph?.style.marginRight).toBe('5%');
    expect(Number.parseFloat(paragraph?.style.textIndent ?? '')).toBeCloseTo(
      (5 / 85) * 100,
    );
  });

  it('includes paper settings, explicit page breaks, print control and cross-page references', async () => {
    const source = parseMarkdown(
      '---\ntype: report\ntitle: Print test\ntoc: true\npage_settings:\n  paper: A5\n  orientation: landscape\n  margin_top: 20\n  margin_bottom: 20\n  margin_left: 20\n  margin_right: 20\n  font_size: 10.5\n  first_line_indent: 0\n  line_height: 1.85\n  paragraph_spacing: 12\n---\n\n# First\n{#sec:first}\n\n[@sec:second]\n\n::: pagebreak\n:::\n\n# Second\n{#sec:second}',
    ).document;
    const { html } = await exportReportHtml(source, new Map(), 'ja');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelectorAll('.report-sheet')).toHaveLength(2);
    expect(parsed.querySelector('style')?.textContent).toContain(
      '@page{size:210mm 148mm;margin:0}',
    );
    expect(parsed.querySelector('#print-report')?.textContent).toBe(
      '印刷／PDF保存',
    );
    expect(
      parsed.querySelector('.preview-reference')?.getAttribute('href'),
    ).toMatch(/^#kumi-/);
    expect(parsed.querySelector('link, script[src]')).toBeNull();
  });

  it('keeps resized table columns in a standalone report', async () => {
    const source = parseMarkdown(
      '---\ntype: report\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |',
    ).document;
    const table = source.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    table.content[0].content![0].attrs.colwidth = [140];
    table.content[0].content![1].attrs.colwidth = [220];

    const { html } = await exportReportHtml(source, new Map(), 'ja');
    const result = new DOMParser().parseFromString(html, 'text/html');
    const columns = [...result.querySelectorAll<HTMLTableColElement>('col')];
    expect(columns.map((column) => column.style.width)).toEqual([
      '140px',
      '220px',
    ]);
    expect(result.querySelector<HTMLTableElement>('table')?.style.width).toBe(
      '360px',
    );
  });
});
