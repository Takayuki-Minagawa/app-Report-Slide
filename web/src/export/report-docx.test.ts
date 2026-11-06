import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentData, TableNode } from '@/src/document/model';
import { defaultPageSettings } from '@/src/document/page-settings';
import { parseMarkdown } from '@/src/markdown/parser';
import * as officeImages from './office-images';
import { exportReportDocx } from './report-docx';
import { resolveChartPlot } from '@/src/document/chart';
import type { ChartNode } from '@/src/document/model';
import type { FirstLineIndent } from '@/src/document/paragraph-format';

afterEach(() => vi.restoreAllMocks());

it('retains log scale settings and asymmetric error data as editable Word text', async () => {
  const document = source('# Chart');
  const chart: ChartNode = {
    type: 'chart',
    attrs: {
      nodeId: 'errors',
      chartType: 'line',
      data: [{ label: 'A', x: 10, y: 100 }],
      xLabel: 'Time',
      yLabel: 'Value',
      series: 'Observed',
      alt: 'Errors',
      width: 100,
    },
  };
  chart.attrs.plot = {
    ...resolveChartPlot(chart.attrs),
    xScale: 'log',
    yScale: 'log',
    errorDescription: '95 percent interval',
  };
  chart.attrs.plot.series[0].data[0] = {
    label: 'A',
    x: 10,
    y: 100,
    xMinus: 1.25,
    xPlus: 2.75,
    yMinus: 20.5,
    yPlus: 30.5,
  };
  document.children.push(chart);
  const zip = await unpack(
    (await exportReportDocx(document, new Map(), 'en')).blob,
  );
  for (const text of [
    'xMinus',
    'xPlus',
    'yMinus',
    'yPlus',
    '1.25',
    '2.75',
    '20.5',
    '30.5',
    'Scale: X=log, Y=log',
    '95 percent interval',
  ])
    expect(zip.xml().documentElement.textContent).toContain(text);
});

function source(markdown: string): DocumentData {
  return parseMarkdown(`---\ntype: report\n---\n\n${markdown}`).document;
}

async function unpack(blob: Blob) {
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const entries = unzipSync(bytes);
  return {
    entries,
    text: (name: string) => strFromU8(entries[name]),
    xml: (name = 'word/document.xml') =>
      new DOMParser().parseFromString(
        strFromU8(entries[name]),
        'application/xml',
      ),
  };
}

const elements = (xml: globalThis.Document, tag: string) => [
  ...xml.getElementsByTagName(tag),
];

function paragraphIndent(xml: globalThis.Document, text: string) {
  const paragraph = elements(xml, 'w:p').find(
    (entry) => entry.textContent === text,
  );
  expect(paragraph, `Word paragraph: ${text}`).toBeDefined();
  const indent = paragraph!.getElementsByTagName('w:ind')[0];
  expect(indent, `Word paragraph indentation: ${text}`).toBeDefined();
  return indent;
}

describe('Word Report export', () => {
  it('writes an actual editable DOCX with headings, marks, links, code and nested lists', async () => {
    const document = source(
      '# Heading\n\n**Bold** *Italic* ~~Strike~~ `inline code` [Link](https://example.com)\n\n4. Fourth\n5. Fifth\n   - Nested\n\n```ts\nconst value = 1;\nconsole.log(value);\n```',
    );
    const result = await exportReportDocx(document, new Map(), 'en');
    expect(result.blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    const zip = await unpack(result.blob);
    expect(zip.entries['[Content_Types].xml']).toBeDefined();
    const xml = zip.xml();
    expect(xml.querySelector('parsererror')).toBeNull();
    expect(
      elements(xml, 'w:pStyle').some(
        (entry) => entry.getAttribute('w:val') === 'Heading1',
      ),
    ).toBe(true);
    expect(elements(xml, 'w:b').length).toBeGreaterThan(0);
    expect(elements(xml, 'w:i').length).toBeGreaterThan(0);
    expect(elements(xml, 'w:strike').length).toBeGreaterThan(0);
    expect(elements(xml, 'w:numPr')).toHaveLength(3);
    expect(zip.text('word/numbering.xml')).toContain('w:start w:val="4"');
    expect(zip.text('word/numbering.xml')).toContain('w:numFmt w:val="bullet"');
    expect(zip.text('word/_rels/document.xml.rels')).toContain(
      'Target="https://example.com"',
    );
    expect(xml.documentElement.textContent).toContain('const value = 1;');
    expect(xml.documentElement.textContent).toContain('console.log(value);');
    expect(
      Object.keys(zip.entries).some((name) => name.startsWith('word/media/')),
    ).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it('preserves paper, orientation, margins, ruler positions and consecutive page breaks', async () => {
    const document = source(
      'Text\n{text_ruler=10,5,15}\n\n::: pagebreak\n:::\n\n::: pagebreak\n:::\n\nLast',
    );
    document.metadata.page_settings = {
      ...defaultPageSettings,
      paper: 'A5',
      orientation: 'landscape',
      margin_left: 15,
      margin_right: 15,
      margin_top: 10,
      margin_bottom: 10,
      font_size: 12,
      line_height: 1.5,
    };
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    const size = elements(xml, 'w:pgSz')[0];
    expect(size.getAttribute('w:orient')).toBe('landscape');
    expect(Number(size.getAttribute('w:w'))).toBeCloseTo(
      (210 * 1440) / 25.4,
      0,
    );
    expect(Number(size.getAttribute('w:h'))).toBeCloseTo(
      (148 * 1440) / 25.4,
      0,
    );
    expect(Number(elements(xml, 'w:pgMar')[0].getAttribute('w:left'))).toBe(
      Math.round((15 * 1440) / 25.4),
    );
    const indent = elements(xml, 'w:ind')[0];
    expect(Number(indent.getAttribute('w:left'))).toBe(
      Math.round(Math.round((180 * 1440) / 25.4) * 0.1),
    );
    expect(Number(indent.getAttribute('w:firstLine'))).toBe(
      Math.round(Math.round((180 * 1440) / 25.4) * 0.05),
    );
    expect(
      elements(xml, 'w:br').filter(
        (entry) => entry.getAttribute('w:type') === 'page',
      ),
    ).toHaveLength(2);
    expect(zip.text('word/styles.xml')).toContain('w:sz w:val="24"');
    expect(zip.text('word/footer1.xml')).toContain('PAGE');
  });

  it('applies body indentation across page boundaries without leaking into quotes, tables or list continuations', async () => {
    const document = source(
      '# Heading\n\n::: pagebreak\n:::\n\nFirst body\n\nNormal body\n\n> Quoted body\n\n- Listed body\n\n  List continuation\n\n| Header cell |\n| --- |\n| Body cell |',
    );
    document.metadata.page_settings = {
      ...defaultPageSettings,
      first_line_indent: 1,
      after_heading_indent: 'none',
    };
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    for (const text of [
      'Heading',
      'First body',
      'Quoted body',
      'List continuation',
      'Header cell',
      'Body cell',
    ])
      expect(paragraphIndent(xml, text).getAttribute('w:firstLine')).toBe('0');
    expect(
      paragraphIndent(xml, 'Normal body').getAttribute('w:firstLine'),
    ).toBe('210');
    const listed = paragraphIndent(xml, 'Listed body');
    expect(listed.getAttribute('w:firstLine')).toBeNull();
    expect(listed.getAttribute('w:hanging')).toBe('300');
    expect(paragraphIndent(xml, 'Quoted body').getAttribute('w:left')).toBe(
      '360',
    );
    expect(
      paragraphIndent(xml, 'List continuation').getAttribute('w:left'),
    ).toBe('540');

    document.metadata.page_settings.after_heading_indent = 'same';
    const same = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    expect(
      paragraphIndent(same.xml(), 'First body').getAttribute('w:firstLine'),
    ).toBe('210');
  });

  it('converts explicit and inherited first lines to em while retaining ruler margins and legacy hanging indents', async () => {
    const document = source(
      'One em\n\nNo indent\n\nInherit body\n\nLegacy ruler\n\n# Heading\n\nInherit after heading\n\n# Override heading\n\nOne em after heading',
    );
    document.metadata.page_settings = {
      ...defaultPageSettings,
      font_size: 12,
      first_line_indent: 2,
      after_heading_indent: 'none',
    };
    const choices: Record<string, FirstLineIndent> = {
      'One em': { mode: 'em', value: 1 },
      'No indent': { mode: 'em', value: 0 },
      'Inherit body': { mode: 'inherit' },
      'Inherit after heading': { mode: 'inherit' },
      'One em after heading': { mode: 'em', value: 1 },
    };
    for (const node of document.children) {
      if (node.type !== 'paragraph') continue;
      const text = node.content?.[0];
      if (text?.type !== 'text') continue;
      node.attrs.textRuler = { left: 10, right: 5, firstLine: 5 };
      if (choices[text.text]) node.attrs.firstLineIndent = choices[text.text];
    }
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    for (const [text, value] of [
      ['One em', '240'],
      ['No indent', '0'],
      ['Inherit body', '480'],
      ['Inherit after heading', '0'],
      ['One em after heading', '240'],
    ]) {
      const indent = paragraphIndent(xml, text);
      expect(indent.getAttribute('w:firstLine')).toBe(value);
      expect(indent.getAttribute('w:hanging')).toBeNull();
    }
    const bodyWidth = Math.round((170 * 1440) / 25.4);
    for (const text of [...Object.keys(choices), 'Legacy ruler']) {
      const indent = paragraphIndent(xml, text);
      expect(indent.getAttribute('w:left')).toBe(
        String(Math.round(bodyWidth * 0.1)),
      );
      expect(indent.getAttribute('w:right')).toBe(
        String(Math.round(bodyWidth * 0.05)),
      );
    }
    const legacy = paragraphIndent(xml, 'Legacy ruler');
    expect(legacy.getAttribute('w:firstLine')).toBeNull();
    expect(legacy.getAttribute('w:hanging')).toBe(
      String(Math.round(bodyWidth * 0.05)),
    );

    document.metadata.page_settings.font_size = 20;
    const enlarged = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    expect(
      paragraphIndent(enlarged.xml(), 'One em').getAttribute('w:firstLine'),
    ).toBe('400');
    expect(
      paragraphIndent(enlarged.xml(), 'Legacy ruler').getAttribute('w:hanging'),
    ).toBe(String(Math.round(bodyWidth * 0.05)));
  });

  it('preserves a nested paragraph ruler while excluding the new body-only setting', async () => {
    const document = source('> Quoted ruler');
    const quote = document.children[0];
    if (quote.type !== 'blockquote') throw new Error('Expected quote');
    const paragraph = quote.content[0];
    if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
    paragraph.attrs.textRuler = { left: 10, right: 5, firstLine: 15 };
    paragraph.attrs.firstLineIndent = { mode: 'em', value: 8 };
    document.metadata.page_settings = {
      ...defaultPageSettings,
      first_line_indent: 2,
    };
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const indent = paragraphIndent(zip.xml(), 'Quoted ruler');
    const rulerWidth = Math.round((170 * 1440) / 25.4) - 360;
    expect(indent.getAttribute('w:left')).toBe(
      String(360 + Math.round(rulerWidth * 0.1)),
    );
    expect(indent.getAttribute('w:firstLine')).toBe(
      String(Math.round(rulerWidth * 0.05)),
    );
  });

  it('keeps semantic captions and cross-page references linked, plus real footnotes and a TOC', async () => {
    const document = source(
      '# First\n{#sec:first}\n\nSee [@sec:second]. Text^[A real footnote].\n\n::: pagebreak\n:::\n\n# Second\n{#sec:second}\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n{#tab:result caption="Results"}\n\n[@tab:result]\n\n::: notes\nPrivate note^[Do not export]\n:::',
    );
    document.metadata.toc = true;
    document.metadata.number_sections = true;
    const result = await exportReportDocx(document, new Map(), 'en');
    const zip = await unpack(result.blob);
    const xml = zip.xml();
    const text = xml.documentElement.textContent;
    expect(text).toContain('Section 2');
    expect(text).toContain('Table 1 — Results');
    expect(text).toContain('Table of contents');
    const bookmarks = new Set(
      elements(xml, 'w:bookmarkStart').map((entry) =>
        entry.getAttribute('w:name'),
      ),
    );
    for (const link of elements(xml, 'w:hyperlink'))
      expect(bookmarks.has(link.getAttribute('w:anchor'))).toBe(true);
    expect(elements(xml, 'w:footnoteReference')).toHaveLength(1);
    expect(zip.text('word/footnotes.xml')).toContain('A real footnote');
    expect(zip.text('word/footnotes.xml')).not.toContain('Do not export');
    expect(text).not.toContain('Private note');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('exported values');
  });

  it('exports an unnumbered cover and contents before a body section starting at page one', async () => {
    const document = source('# Main heading\n\nBody text');
    document.metadata = {
      ...document.metadata,
      title: 'Technical report',
      subtitle: 'Yearly review',
      author: 'Example author',
      date: '2026-11-06',
      toc: true,
      report_settings: {
        cover: true,
        toc_page: true,
        affiliation: 'Example laboratory',
        recipient: 'Review committee',
        report_number: 'R-001',
      },
    };
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    const sections = elements(xml, 'w:sectPr');
    expect(sections).toHaveLength(3);
    for (const front of sections.slice(0, 2)) {
      expect(front.getElementsByTagName('w:footerReference')).toHaveLength(0);
      expect(
        front.getElementsByTagName('w:pgNumType')[0]?.getAttribute('w:start'),
      ).toBeNull();
    }
    expect(sections[2].getElementsByTagName('w:footerReference')).toHaveLength(
      1,
    );
    expect(
      sections[2]
        .getElementsByTagName('w:pgNumType')[0]
        .getAttribute('w:start'),
    ).toBe('1');
    const paragraphs = elements(xml, 'w:p');
    const title = paragraphs.find(
      (entry) => entry.textContent === 'Technical report',
    )!;
    expect(title.getElementsByTagName('w:pStyle')).toHaveLength(0);
    expect(title.getElementsByTagName('w:bookmarkStart')).toHaveLength(0);
    const text = xml.documentElement.textContent!;
    for (const value of [
      'Yearly review',
      'Example author',
      '2026-11-06',
      'Affiliation: Example laboratory',
      'Recipient: Review committee',
      'Report number: R-001',
    ])
      expect(text).toContain(value);
    expect(text.indexOf('Technical report')).toBeLessThan(
      text.indexOf('Table of contents'),
    );
    expect(text.indexOf('Table of contents')).toBeLessThan(
      text.indexOf('Body text'),
    );
    expect(elements(xml, 'w:hyperlink')).toHaveLength(1);
    expect(
      elements(xml, 'w:br').filter(
        (entry) => entry.getAttribute('w:type') === 'page',
      ),
    ).toHaveLength(0);
    expect(zip.text('word/footer1.xml')).toContain('PAGE');
  });

  it.each(['ja', 'en'] as const)(
    'uses the same untitled cover fallback as HTML instead of taking the first body heading (%s)',
    async (locale) => {
      const document = source('# Body heading\n\nBody text');
      document.metadata.title = ' ';
      document.metadata.report_settings = { cover: true };
      const zip = await unpack(
        (await exportReportDocx(document, new Map(), locale)).blob,
      );
      const paragraphs = elements(zip.xml(), 'w:p');
      expect(paragraphs[0].textContent).toBe(
        locale === 'ja' ? '無題の報告書' : 'Untitled report',
      );
      expect(
        paragraphs.filter(
          (paragraph) => paragraph.textContent === 'Body heading',
        ),
      ).toHaveLength(1);
    },
  );

  it('filters the exported contents depth and omitted headings without removing body headings', async () => {
    const document = source(
      '# Main\n\n## Detail\n\n### Deep\n\n## Omitted\n\nBody',
    );
    document.metadata.toc = true;
    document.metadata.report_settings = { toc_depth: 2, toc_page: true };
    const omitted = document.children.find(
      (node) =>
        node.type === 'heading' &&
        node.content?.some(
          (child) => child.type === 'text' && child.text === 'Omitted',
        ),
    );
    if (!omitted) throw new Error('Expected omitted heading');
    omitted.attrs.toc = false;
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    expect(
      elements(xml, 'w:hyperlink').map((entry) => entry.textContent),
    ).toEqual(['Main', 'Detail']);
    expect(
      elements(xml, 'w:p').some((entry) => entry.textContent === 'Deep'),
    ).toBe(true);
    expect(
      elements(xml, 'w:p').some((entry) => entry.textContent === 'Omitted'),
    ).toBe(true);
    expect(elements(xml, 'w:sectPr')).toHaveLength(2);
  });

  it('exports chapter and appendix numbers consistently in headings, captions, references and table contents', async () => {
    const document = source(
      '# Methods\n{#sec:methods}\n\n| A |\n| --- |\n| 1 |\n{#tab:methods caption="Method table"}\n\n# Results\n{#sec:results}\n\n| B |\n| --- |\n| 2 |\n{#tab:results caption="Result table"}\n\n# Extras\n{#sec:extras}\n\n| C |\n| --- |\n| 3 |\n{#tab:extras caption="Extra table"}\n\nSee [@sec:results], [@sec:extras] and [@tab:extras].',
    );
    document.metadata.number_sections = true;
    document.metadata.report_settings = {
      heading_numbering: 'chapter',
      caption_numbering: 'chapter',
      list_tables: true,
      toc_page: true,
    };
    const appendix = document.children.find(
      (node) => node.attrs.label === 'sec:extras',
    );
    if (!appendix) throw new Error('Expected appendix heading');
    appendix.attrs.appendix = true;
    document.children.push(
      ...source(
        '| Note |\n| --- |\n| Value |\n{caption="Unnumbered table" numbered=false}',
      ).children,
    );
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const xml = zip.xml();
    const text = xml.documentElement.textContent!;
    for (const value of [
      'Chapter 1 Methods',
      'Chapter 2 Results',
      'Appendix A Extras',
      'Table 1.1 — Method table',
      'Table 2.1 — Result table',
      'Table A.1 — Extra table',
      'See Chapter 2, Appendix A and Table A.1.',
    ])
      expect(text).toContain(value);
    expect(text).toContain('List of tables');
    expect(text).not.toContain('Table of contents');
    const bookmarks = new Set(
      elements(xml, 'w:bookmarkStart').map((entry) =>
        entry.getAttribute('w:name'),
      ),
    );
    for (const link of elements(xml, 'w:hyperlink'))
      expect(bookmarks.has(link.getAttribute('w:anchor'))).toBe(true);
    expect(elements(xml, 'w:hyperlink')).toHaveLength(6);
    expect(
      elements(xml, 'w:hyperlink').some((entry) =>
        entry.textContent?.includes('Unnumbered table'),
      ),
    ).toBe(false);
    expect(text).toContain('Unnumbered table');
    expect(elements(xml, 'w:sectPr')).toHaveLength(2);
  });

  it('keeps empty enabled contents visible without adding an empty body after front matter', async () => {
    const document = source('');
    document.metadata.title = 'Cover only';
    document.metadata.report_settings = {
      cover: true,
      affiliation: ' ',
      recipient: ' ',
      report_number: ' ',
    };
    let zip = await unpack(
      (await exportReportDocx(document, new Map(), 'ja')).blob,
    );
    expect(elements(zip.xml(), 'w:sectPr')).toHaveLength(1);
    expect(elements(zip.xml(), 'w:footerReference')).toHaveLength(0);
    expect(zip.xml().documentElement.textContent).toBe('Cover only');

    document.metadata.report_settings = {
      cover: true,
      toc_page: true,
      list_figures: true,
      list_tables: true,
    };
    document.metadata.toc = true;
    zip = await unpack(
      (await exportReportDocx(document, new Map(), 'ja')).blob,
    );
    expect(elements(zip.xml(), 'w:sectPr')).toHaveLength(2);
    expect(elements(zip.xml(), 'w:footerReference')).toHaveLength(0);
    expect(
      elements(zip.xml(), 'w:p').filter(
        (entry) => entry.textContent === '項目なし',
      ),
    ).toHaveLength(3);

    document.children = source('::: pagebreak\n:::').children;
    zip = await unpack(
      (await exportReportDocx(document, new Map(), 'ja')).blob,
    );
    expect(elements(zip.xml(), 'w:sectPr')).toHaveLength(3);
    expect(
      elements(zip.xml(), 'w:br').filter(
        (entry) => entry.getAttribute('w:type') === 'page',
      ),
    ).toHaveLength(1);
  });

  it('retains merged rows and columns, table text, alignment, widths and cell borders', async () => {
    const cell = (id: string, text: string, attrs = {}) => ({
      type: 'tableCell' as const,
      attrs: { nodeId: id, align: 'right' as const, ...attrs },
      content: [
        {
          type: 'paragraph' as const,
          attrs: { nodeId: `${id}-p` },
          content: [{ type: 'text' as const, text }],
        },
      ],
    });
    const table: TableNode = {
      type: 'table',
      attrs: { nodeId: 'table' },
      content: [
        {
          type: 'tableRow',
          attrs: { nodeId: 'r1' },
          content: [
            cell('a', 'Merged', {
              colspan: 2,
              rowspan: 2,
              colwidth: [100, 150],
              borders: {
                top: { color: '#ff0000', style: 'dashed', width: 2 },
                bottom: null,
              },
            }),
            cell('b', 'B', { colwidth: [200] }),
          ],
        },
        {
          type: 'tableRow',
          attrs: { nodeId: 'r2' },
          content: [cell('c', 'C')],
        },
        {
          type: 'tableRow',
          attrs: { nodeId: 'r3' },
          content: [cell('d', 'D'), cell('e', 'E'), cell('f', 'F')],
        },
      ],
    };
    const document: DocumentData = {
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [table],
    };
    const snapshot = JSON.stringify(document);
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'ja')).blob,
    );
    const xml = zip.xml();
    expect(elements(xml, 'w:tr')).toHaveLength(3);
    expect(elements(xml, 'w:tc')).toHaveLength(7);
    expect(
      elements(xml, 'w:gridSpan').map((entry) => entry.getAttribute('w:val')),
    ).toEqual(['2', '2']);
    expect(
      elements(xml, 'w:vMerge').map((entry) => entry.getAttribute('w:val')),
    ).toEqual(['restart', 'continue']);
    expect(
      elements(xml, 'w:gridCol').map((entry) =>
        Number(entry.getAttribute('w:w')),
      ),
    ).toEqual([1500, 2250, 3000]);
    expect(
      elements(xml, 'w:jc').some(
        (entry) => entry.getAttribute('w:val') === 'right',
      ),
    ).toBe(true);
    expect(zip.text('word/document.xml')).toContain('w:color="ff0000"');
    expect(zip.text('word/document.xml')).toContain('w:val="dashed"');
    expect(zip.text('word/document.xml')).toContain('w:val="nil"');
    for (const text of ['Merged', 'B', 'C', 'D', 'E', 'F'])
      expect(xml.documentElement.textContent).toContain(text);
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  it('embeds image bytes, keeps alternative text, and never adds remote image links', async () => {
    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jx9sAAAAASUVORK5CYII=',
      ),
      (value) => value.charCodeAt(0),
    );
    vi.spyOn(officeImages, 'prepareOfficeImages').mockResolvedValue({
      images: new Map([
        [
          'image.png',
          {
            data: bytes,
            dataUrl: 'data:image/png;base64,',
            width: 1,
            height: 1,
            type: 'png',
          },
        ],
      ]),
    });
    const document = source(
      '![Alternative text](image.png)\n{#fig:example caption="Embedded figure"}',
    );
    const zip = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const media = Object.keys(zip.entries).filter(
      (entry) => entry.startsWith('word/media/') && entry.endsWith('.png'),
    );
    expect(media).toHaveLength(1);
    expect(zip.entries[media[0]]).toEqual(bytes);
    expect(elements(zip.xml(), 'w:drawing')).toHaveLength(1);
    expect(zip.text('word/document.xml')).toContain('descr="Alternative text"');
    expect(zip.text('word/document.xml')).toContain(
      'Figure 1 — Embedded figure',
    );
    expect(zip.text('word/_rels/document.xml.rels')).not.toContain(
      'TargetMode="External"',
    );

    document.metadata.report_settings = { list_figures: true, toc_page: true };
    const listed = await unpack(
      (await exportReportDocx(document, new Map(), 'en')).blob,
    );
    const listedXml = listed.xml();
    const link = elements(listedXml, 'w:hyperlink')[0];
    expect(link.textContent).toBe('Figure 1 — Embedded figure');
    expect(link.getAttribute('w:anchor')).toBe(
      elements(listedXml, 'w:bookmarkStart')[0].getAttribute('w:name'),
    );
    expect(listedXml.documentElement.textContent).toContain('List of figures');
    expect(elements(listedXml, 'w:sectPr')).toHaveLength(2);
  });

  it('keeps math and every chart data value editable and reports localized conversion limits', async () => {
    const document = source('Inline $x^2$\n\n$$\ny = mx + b\n$$');
    document.children.push({
      type: 'chart',
      attrs: {
        nodeId: 'chart',
        chartType: 'scatter',
        data: [
          { label: 'Sample A', x: 1.25, y: -2.5 },
          { label: 'Sample B', x: 3.75, y: 4.5 },
        ],
        xLabel: 'Displacement',
        yLabel: 'Force',
        series: 'Test series',
        alt: 'Measured samples',
        width: 100,
        caption: 'Chart caption',
      },
    });
    const result = await exportReportDocx(document, new Map(), 'ja');
    const zip = await unpack(result.blob);
    for (const text of [
      'x^2',
      'y = mx + b',
      'Sample A',
      '1.25',
      '-2.5',
      'Sample B',
      '3.75',
      '4.5',
      'Displacement',
      'Force',
      'Test series',
      'Measured samples',
      'Chart caption',
    ])
      expect(zip.xml().documentElement.textContent).toContain(text);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('LaTeX'),
        expect.stringContaining('全データ'),
      ]),
    );
    expect(result.warnings).toHaveLength(2);
  });

  it('rejects a slide, malformed input and external images without network access', async () => {
    const document = source('Text');
    await expect(
      exportReportDocx({ ...document, type: 'slide' }, new Map(), 'en'),
    ).rejects.toThrow('requires a report');
    await expect(
      exportReportDocx(
        { ...document, schemaVersion: 999 } as unknown as DocumentData,
        new Map(),
        'en',
      ),
    ).rejects.toThrow();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      exportReportDocx(
        source('![External](https://example.com/image.png)'),
        new Map(),
        'en',
      ),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
