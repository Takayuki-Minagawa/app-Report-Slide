import { describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData } from './validation';
import {
  hasCssOnlyStyle,
  reportDocumentCss,
  reportStyleCss,
  reportStyleIssues,
  resolveReportStyle,
} from './report-style';

describe('report style data', () => {
  it('adds no CSS and keeps the earlier Word constants for existing themes', () => {
    for (const theme of [undefined, 'latex', 'calculation', 'unknown']) {
      expect(reportStyleCss({ theme })).toBe('');
      expect(resolveReportStyle({ theme })).toMatchObject({
        body: { font: 'mincho', color: null },
        headings: { h1: { size: null, font: null }, decoration: true },
        table: { header_fill: '#F1F5F9', border_width: null, size: null },
        callout: { frame: 'bar' },
        docx_fonts: { mincho: 'Yu Mincho', latin: null },
      });
    }
  });

  it('defines the Word-style theme once for both CSS and Word', () => {
    const metadata = { theme: 'report-jp' };
    const style = resolveReportStyle(metadata);
    expect(style.headings.h1).toMatchObject({
      font: 'gothic',
      size: 14,
      bold: true,
      color: '#000000',
    });
    expect(style.headings.h3.size).toBe(10.5);
    expect(style.table).toMatchObject({
      border_width: 0.75,
      header_fill: null,
      header_font: 'gothic',
      size: 9,
    });
    const css = reportStyleCss(metadata);
    // 14pt on a 10.5pt body, expressed so the scaled preview keeps proportions.
    expect(css).toContain(
      ".report-preview[data-theme] .document-renderer h1{font-family:'Noto Sans JP'",
    );
    expect(css).toContain('font-size:1.333em');
    expect(css).toContain('border:0.75pt solid #000000');
    expect(css).toContain("li[data-toc-level='1']");
    expect(css).not.toContain('%P');
  });

  it('follows the page font size and lets document values override the theme', () => {
    const metadata = {
      theme: 'report-jp',
      page_settings: {
        paper: 'A4',
        orientation: 'portrait',
        margin_top: 20,
        margin_bottom: 20,
        margin_left: 20,
        margin_right: 20,
        font_size: 12,
        first_line_indent: 0,
        line_height: 1.8,
        paragraph_spacing: 0,
      },
      report_style: {
        headings: { h1: { size: 18 } },
        table: { header_fill: '#EEEEEE' },
        docx_fonts: { mincho: 'MS Mincho' },
      },
    } as const;
    const style = resolveReportStyle(metadata);
    expect(style.headings.h1).toMatchObject({ size: 18, font: 'gothic' });
    expect(style.headings.h3.size).toBe(12);
    expect(style.table.header_fill).toBe('#EEEEEE');
    expect(style.docx_fonts).toEqual({
      mincho: 'MS Mincho',
      gothic: 'Yu Gothic',
      latin: 'Times New Roman',
    });
    expect(reportStyleCss(metadata)).toContain('font-size:1.5em');
  });

  it('writes only the specified values for a theme without style data', () => {
    const css = reportStyleCss({
      theme: 'latex',
      report_style: { caption: { align: 'left' } },
    });
    expect(css).toBe(
      '.report-preview[data-theme] .document-renderer :is(figcaption,caption){text-align:left}',
    );
  });

  it('appends valid document CSS last and drops unsafe CSS entirely', () => {
    const css = reportDocumentCss({
      theme: 'report-jp',
      report_style: { css: 'h1 { color: red }' },
    });
    expect(css.endsWith('h1 { color: red }')).toBe(true);
    expect(hasCssOnlyStyle({ report_style: { css: 'h1{}' } })).toBe(true);
    expect(hasCssOnlyStyle({ theme: 'report-jp' })).toBe(false);
    expect(reportDocumentCss({ report_style: { css: '@import "x";' } })).toBe(
      '',
    );
  });

  it('rejects unknown keys, bad values and unsafe CSS when a document is read', () => {
    expect(reportStyleIssues(undefined)).toEqual([]);
    expect(reportStyleIssues({ caption: { size: 10 } })).toEqual([]);
    expect(reportStyleIssues({ caption: { size: 100 } })).not.toEqual([]);
    expect(reportStyleIssues({ unknown: 1 })).not.toEqual([]);
    expect(reportStyleIssues({ body: { color: 'red' } })).not.toEqual([]);
    expect(reportStyleIssues({ docx_fonts: { mincho: 'a";b' } })).not.toEqual(
      [],
    );
    expect(reportStyleIssues({ css: 'p{background:url(x)}' })[0]).toContain(
      'report_style.css',
    );
    expect(() =>
      parseMarkdown(
        '---\ntype: report\nreport_style:\n  css: "@import \'x\';"\n---\n\nBody',
      ),
    ).toThrow();
  });

  it('round-trips multi-line CSS through Markdown and validation', () => {
    const source =
      "---\ntype: report\ntheme: report-jp\nreport_style:\n  caption:\n    size: 9\n  css: |\n    .document-renderer h1 { font-size: 14pt; }\n    .kumi-physical-footer::before { content: '- '; }\n---\n\nBody";
    const document = validateDocumentData(parseMarkdown(source).document);
    const again = parseMarkdown(serializeDocument(document)).document;
    expect(again.metadata.report_style).toEqual(document.metadata.report_style);
    expect(reportDocumentCss(again.metadata)).toContain(
      ".kumi-physical-footer::before { content: '- '; }",
    );
  });
});
