import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import type { ChartNode, DocumentData, TableNode } from '@/src/document/model';
import * as officeImages from './office-images';
import { exportSlidePptx } from './slide-pptx';

function slides(body: string, metadata = '') {
  return parseMarkdown(
    `---\ntype: slide\ntitle: PowerPoint export\n${metadata}---\n\n${body}`,
  ).document;
}
async function unpack(blob: Blob) {
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  return unzipSync(new Uint8Array(buffer));
}
function xml(files: Record<string, Uint8Array>, path: string) {
  return new DOMParser().parseFromString(
    strFromU8(files[path]),
    'application/xml',
  ).documentElement;
}
function slideCount(files: Record<string, Uint8Array>) {
  return Object.keys(files).filter((path) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(path),
  ).length;
}
afterEach(() => vi.restoreAllMocks());

describe('editable PowerPoint export', () => {
  it('preserves empty slides and explicit page boundaries without mutating the source', async () => {
    const source = slides(
      '::: slidebreak\n:::\n\n# First\n\n::: pagebreak\n:::\n\n::: slidebreak\n:::',
    );
    const before = JSON.stringify(source);
    const { blob } = await exportSlidePptx(source, new Map(), 'en');
    const files = await unpack(blob);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(slideCount(files)).toBe(4);
    expect(xml(files, 'ppt/slides/slide1.xml').textContent).not.toContain(
      'First',
    );
    expect(xml(files, 'ppt/slides/slide2.xml').textContent).toContain('First');
    expect(JSON.stringify(source)).toBe(before);
    for (const path of Object.keys(files).filter((path) =>
      path.endsWith('.xml'),
    )) {
      expect(xml(files, path).querySelector('parsererror'), path).toBeNull();
    }
  });

  it('exports native text styles, lists, table cells, references, footnotes and private presenter notes', async () => {
    const source = slides(
      '# Intro\n{#sec:intro}\n\n**Bold** *italic* ~~strike~~ `code` [link](https://example.com) and $E=mc^2$ [^note].\n\n- Bullet\n\n3. Numbered\n\n| Name | Value |\n| --- | --- |\n| **Alpha** | 42 |\n\n::: notes\nPrivate presenter content\n:::\n\n[^note]: A useful footnote\n\n::: slidebreak\n:::\n\n# Result\n\nSee [@sec:intro].',
      'number_sections: true\ntoc: true\nauthor: Editor\n',
    );
    const { blob, warnings } = await exportSlidePptx(source, new Map(), 'en');
    const files = await unpack(blob);
    const first = xml(files, 'ppt/slides/slide1.xml');
    const raw = strFromU8(files['ppt/slides/slide1.xml']);
    expect(first.textContent).toContain('Table of contents');
    expect(first.textContent).toContain('A useful footnote');
    expect(first.textContent).not.toContain('Private presenter content');
    expect(first.getElementsByTagName('a:tbl')).toHaveLength(1);
    expect(first.getElementsByTagName('a:buChar').length).toBeGreaterThan(0);
    expect(
      first.getElementsByTagName('a:buAutoNum')[0].getAttribute('startAt'),
    ).toBe('3');
    expect(raw).toMatch(/<a:rPr[^>]* b="1"/);
    expect(raw).toMatch(/<a:rPr[^>]* i="1"/);
    expect(raw).toContain('strike="sngStrike"');
    expect(raw).toContain('typeface="Consolas"');
    expect(xml(files, 'ppt/notesSlides/notesSlide1.xml').textContent).toContain(
      'Private presenter content',
    );
    expect(xml(files, 'ppt/slides/slide2.xml').textContent).toContain(
      'Section 1',
    );
    expect(strFromU8(files['ppt/slides/_rels/slide1.xml.rels'])).toContain(
      'https://example.com',
    );
    expect(strFromU8(files['ppt/slides/_rels/slide2.xml.rels'])).toContain(
      'slide1.xml',
    );
    expect(warnings).toContain(
      'Equations were exported as editable LaTeX text.',
    );
  });

  it.each(['bar', 'scatter', 'line'] as const)(
    'exports an editable %s chart with an embedded numeric workbook',
    async (chartType) => {
      const source = slides('# Chart');
      const chart: ChartNode = {
        type: 'chart',
        attrs: {
          nodeId: 'chart',
          chartType,
          data: [
            { label: 'A', x: 2, y: 4 },
            { label: 'B', x: 10, y: -3 },
          ],
          xLabel: 'Distance',
          yLabel: 'Force',
          series: 'Loads',
          alt: 'Measured loads',
          width: 80,
          caption: 'Chart caption',
        },
      };
      source.children.push(chart);
      const { blob } = await exportSlidePptx(source, new Map(), 'en');
      const files = await unpack(blob);
      const chartFile = Object.keys(files).find((path) =>
        /^ppt\/charts\/chart\d+\.xml$/.test(path),
      )!;
      const chartXml = xml(files, chartFile);
      expect(
        chartXml.getElementsByTagName(
          chartType === 'bar' ? 'c:barChart' : 'c:scatterChart',
        ),
      ).toHaveLength(1);
      expect(chartXml.textContent).toContain('Loads');
      expect(chartXml.textContent).toContain('Distance');
      expect(chartXml.textContent).toContain('Force');
      if (chartType !== 'bar') {
        const values = Array.from(
          chartXml
            .getElementsByTagName('c:xVal')[0]
            .getElementsByTagName('c:v'),
        ).map((element) => element.textContent);
        expect(values).toEqual(['2', '10']);
      }
      const workbookPath = Object.keys(files).find(
        (path) => path.startsWith('ppt/embeddings/') && path.endsWith('.xlsx'),
      )!;
      const workbook = unzipSync(files[workbookPath]);
      expect(xml(workbook, 'xl/worksheets/sheet1.xml').textContent).toContain(
        '-3',
      );
      expect(
        xml(files, 'ppt/notesSlides/notesSlide1.xml').textContent,
      ).toContain('B / 10 / -3');
      expect(xml(files, 'ppt/slides/slide1.xml').textContent).toContain(
        'Chart caption',
      );
    },
  );

  it('preserves merged cells and explicit table column proportions', async () => {
    const source = slides('| A | B |\n| --- | --- |\n| C | D |');
    const table = source.children[0] as TableNode;
    table.content[0].content![0].attrs.colwidth = [200];
    table.content[0].content![1].attrs.colwidth = [100];
    table.content[1].content![0].attrs.colspan = 2;
    table.content[1].content!.pop();
    const files = await unpack(
      (await exportSlidePptx(source, new Map(), 'ja')).blob,
    );
    const dom = xml(files, 'ppt/slides/slide1.xml');
    const columns = Array.from(dom.getElementsByTagName('a:gridCol')).map(
      (entry) => Number(entry.getAttribute('w')),
    );
    expect(columns[0] / columns[1]).toBeCloseTo(2);
    expect(
      Array.from(dom.getElementsByTagName('a:tc')).some(
        (cell) => cell.getAttribute('gridSpan') === '2',
      ),
    ).toBe(true);
  });

  it('preserves row spans including rows entirely covered by a merged cell', async () => {
    const source = slides('| A | B |\n| --- | --- |\n| C | D |');
    const table = source.children[0] as TableNode;
    table.content[0].content![0].attrs.colspan = 2;
    table.content[0].content![0].attrs.rowspan = 2;
    table.content[0].content!.pop();
    table.content[1].content = [];
    const files = await unpack(
      (await exportSlidePptx(source, new Map(), 'en')).blob,
    );
    const dom = xml(files, 'ppt/slides/slide1.xml');
    expect(dom.getElementsByTagName('a:tr')).toHaveLength(2);
    expect(
      Array.from(dom.getElementsByTagName('a:tc')).some(
        (cell) => cell.getAttribute('rowSpan') === '2',
      ),
    ).toBe(true);
    expect(
      Array.from(dom.getElementsByTagName('a:tc')).some(
        (cell) => cell.getAttribute('vMerge') === '1',
      ),
    ).toBe(true);
    expect(dom.textContent).toContain('A');
  });

  it('embeds images and retains slide placement independently of text flow', async () => {
    const imageData =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==';
    vi.spyOn(officeImages, 'prepareOfficeImages').mockResolvedValueOnce({
      images: new Map([
        [
          'picture.png',
          {
            data: Uint8Array.from(atob(imageData), (c) => c.charCodeAt(0)),
            dataUrl: `data:image/png;base64,${imageData}`,
            width: 400,
            height: 225,
            type: 'png',
          },
        ],
      ]),
    });
    const source = slides('![Picture](picture.png)');
    const figure = source.children[0];
    if (figure.type !== 'figure') throw new Error('Expected a figure');
    figure.attrs.slidePlacement = { x: 20, y: 30, width: 40, height: 40 };
    const files = await unpack(
      (await exportSlidePptx(source, new Map(), 'en')).blob,
    );
    const dom = xml(files, 'ppt/slides/slide1.xml');
    const picture = dom.getElementsByTagName('p:pic')[0];
    const position = picture.getElementsByTagName('a:off')[0];
    const size = picture.getElementsByTagName('a:ext')[0];
    expect(Number(position.getAttribute('x')) / 914400).toBeCloseTo(
      13.333333 * 0.2,
    );
    expect(Number(position.getAttribute('y')) / 914400).toBeCloseTo(7.5 * 0.3);
    expect(Number(size.getAttribute('cx')) / 914400).toBeCloseTo(
      13.333333 * 0.4,
    );
    expect(
      Object.keys(files).some(
        (path) => path.startsWith('ppt/media/') && path.endsWith('.png'),
      ),
    ).toBe(true);
    expect(strFromU8(files['ppt/slides/_rels/slide1.xml.rels'])).not.toContain(
      'blob:',
    );
  });

  it('warns on dense slides while retaining every paragraph and enabling text auto-fit', async () => {
    const source = slides(
      Array.from(
        { length: 20 },
        (_, index) => `Paragraph ${index}: ${'長い文章。'.repeat(30)}`,
      ).join('\n\n'),
    );
    const { blob, warnings } = await exportSlidePptx(source, new Map(), 'ja');
    const files = await unpack(blob);
    const dom = xml(files, 'ppt/slides/slide1.xml');
    expect(slideCount(files)).toBe(1);
    expect(dom.textContent).toContain('Paragraph 19:');
    expect(dom.getElementsByTagName('a:normAutofit').length).toBeGreaterThan(0);
    expect(
      warnings.some((message) => message.includes('スライド1の内容を縮小')),
    ).toBe(true);
  });

  it('rejects report and invalid document data', async () => {
    const report = { ...slides('# Report'), type: 'report' as const };
    await expect(exportSlidePptx(report, new Map(), 'en')).rejects.toThrow(
      'slide documents',
    );
    const invalid = {
      ...slides('# Invalid'),
      schemaVersion: 999,
    } as unknown as DocumentData;
    await expect(exportSlidePptx(invalid, new Map(), 'en')).rejects.toThrow();
  });
});
