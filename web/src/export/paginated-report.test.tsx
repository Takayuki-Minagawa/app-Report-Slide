import { createHash, webcrypto } from 'node:crypto';
import { Script } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { importHtml } from '@/src/workspace/html-import';
import { exportReportHtml } from './report-html';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('offline physical Report output', () => {
  it('embeds a syntactically valid runtime under its exact hash, with print initially disabled', async () => {
    const source = parseMarkdown('# Report\n\nBody').document;
    source.metadata.toc = true;
    source.metadata.report_settings = {
      toc_page_numbers: true,
      toc_page: true,
    };
    source.metadata.title = '</title><script>untrusted()</script>';
    const before = JSON.stringify(source);
    const { html } = await exportReportHtml(source, new Map(), 'ja');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelectorAll('script')).toHaveLength(1);
    const script = parsed.querySelector('script')!.textContent!;
    expect(() => new Script(script)).not.toThrow();
    expect(script).toContain('Paged.js v0.4.3');
    expect(script).toContain('window.kumiPaginationReady');
    const digest = createHash('sha256').update(script).digest('base64');
    expect(
      parsed
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content'),
    ).toContain(`'sha256-${digest}'`);
    expect(parsed.querySelector('script[src],link[href]')).toBeNull();
    expect(
      parsed.querySelector('#print-report')?.hasAttribute('disabled'),
    ).toBe(true);
    expect(parsed.documentElement.dataset.kumiPagination).toBe('pending');
    expect(parsed.querySelector('#kumi-pagination-css')?.textContent).toContain(
      "font-family:'Noto Serif JP'",
    );
    expect(
      parsed.querySelector<HTMLTemplateElement>('#pagedjs-license')?.content
        .textContent,
    ).toContain('MIT');
    expect(JSON.stringify(source)).toBe(before);
    // Reopening the editable HTML restores source settings, not generated pages/numbers.
    const restored = importHtml(html);
    expect(restored.document).toEqual(source);
  });
});
