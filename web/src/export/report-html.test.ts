import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { exportReportHtml } from './report-html';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('standalone Report HTML', () => {
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
});
