import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { importHtml } from '@/src/workspace/html-import';
import { exportReportHtml } from './report-html';
import { exportPrintHtml } from './print-html';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());

describe('front matter in Report output', () => {
  it('shares cover/contents/body ordering across HTML, print, and editable HTML reimport', async () => {
    const document = parseMarkdown('# Intro\n\nBody').document;
    Object.assign(document.metadata, {
      title: 'Report',
      author: 'Writer',
      toc: true,
      report_settings: {
        cover: true,
        toc_page: true,
        heading_numbering: 'chapter',
      },
    });
    const { html } = await exportReportHtml(document, new Map(), 'en');
    const print = await exportPrintHtml(document, new Map(), 'en');
    const expected = ['cover', 'contents', 'body'];
    for (const source of [html, print.html]) {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      expect(
        [...parsed.querySelectorAll('article')].map((page) =>
          page.getAttribute('data-report-page-kind'),
        ),
      ).toEqual(expected);
      expect(parsed.querySelector('.report-cover h1')?.textContent).toBe(
        'Report',
      );
      expect(parsed.querySelectorAll('.document-toc')).toHaveLength(1);
      expect(parsed.querySelectorAll('article > footer')).toHaveLength(1);
      expect(parsed.querySelector('article > footer')?.textContent).toBe('1');
    }
    expect(print.pageCount).toBe(3);
    const restored = importHtml(html);
    expect(restored.htmlImport.pageCount).toBe(3);
    expect(restored.document.children).toEqual(document.children);
    expect(restored.document.metadata.report_settings).toEqual(
      document.metadata.report_settings,
    );
  });

  it('exports a cover-only report without adding a blank body page', async () => {
    const document = parseMarkdown('').document;
    Object.assign(document.metadata, {
      title: 'Cover only',
      report_settings: { cover: true },
    });
    const print = await exportPrintHtml(document, new Map(), 'ja');
    expect(print.pageCount).toBe(1);
    expect(
      new DOMParser()
        .parseFromString(print.html, 'text/html')
        .querySelectorAll('article'),
    ).toHaveLength(1);
  });
});
