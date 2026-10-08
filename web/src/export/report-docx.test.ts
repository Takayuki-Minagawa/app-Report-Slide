import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentData, TableNode } from '@/src/document/model';
import { defaultPageSettings } from '@/src/document/page-settings';
import { parseMarkdown } from '@/src/markdown/parser';
import * as officeImages from './office-images';
import { exportReportDocx } from './report-docx';

afterEach(() => vi.restoreAllMocks());

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
