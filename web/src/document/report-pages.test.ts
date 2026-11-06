import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { splitDocumentPages } from './semantics';
import {
  frontMatterPageCount,
  reportPageKind,
  splitRenderedPages,
} from './report-pages';

describe('rendered Report pages', () => {
  it('prepends generated pages while keeping editable pages unchanged', () => {
    const document = parseMarkdown(
      '# One\n\n::: pagebreak\n:::\n\n# Two',
    ).document;
    document.metadata.toc = true;
    document.metadata.report_settings = { cover: true, toc_page: true };
    const before = JSON.stringify(document.children);
    const pages = splitRenderedPages(document);
    expect(pages).toHaveLength(4);
    expect(pages.map((_, index) => reportPageKind(document, index))).toEqual([
      'cover',
      'contents',
      'body',
      'body',
    ]);
    expect(pages.slice(2)).toEqual(splitDocumentPages(document));
    expect(JSON.stringify(document.children)).toBe(before);
    expect(frontMatterPageCount(document)).toBe(2);
  });

  it('suppresses only implicit empty body pages when generated front matter exists', () => {
    const document = parseMarkdown('::: notes\nPrivate\n:::').document;
    document.metadata.report_settings = { cover: true };
    expect(splitRenderedPages(document)).toEqual([[]]);
    document.metadata.toc = true;
    document.metadata.report_settings.toc_page = true;
    expect(splitRenderedPages(document)).toEqual([[], []]);
    document.metadata.report_settings = {};
    expect(splitRenderedPages(document)).toHaveLength(1);
    const blankPages = parseMarkdown('::: pagebreak\n:::').document;
    blankPages.metadata.report_settings = { cover: true };
    expect(splitRenderedPages(blankPages)).toHaveLength(3);
  });

  it('creates a contents page for an enabled figure list even without a heading TOC', () => {
    const document = parseMarkdown('Body').document;
    document.metadata.report_settings = { toc_page: true };
    expect(splitRenderedPages(document)).toHaveLength(1);
    document.metadata.report_settings.list_figures = true;
    expect(splitRenderedPages(document)).toHaveLength(2);
  });

  it('ignores report settings for slides', () => {
    const document = parseMarkdown(
      '---\ntype: slide\n---\n\n# One\n\n::: slidebreak\n:::\n\n# Two',
    ).document;
    document.metadata.toc = true;
    document.metadata.report_settings = {
      cover: true,
      toc_page: true,
      list_figures: true,
    };
    expect(frontMatterPageCount(document)).toBe(0);
    expect(splitRenderedPages(document)).toEqual(splitDocumentPages(document));
  });
});
