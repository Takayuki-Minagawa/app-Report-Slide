import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentData } from '@/src/document/model';
import { parseMarkdown } from '@/src/markdown/parser';
import * as officeImages from './office-images';
import { exportReportDocx } from './report-docx';

// jsdom has no image decoder; the figure is a one-pixel PNG prepared up front.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(officeImages, 'prepareOfficeImages').mockResolvedValue({
    images: new Map([
      [
        'image.png',
        {
          data: Uint8Array.from(atob(pixel), (c) => c.charCodeAt(0)),
          dataUrl: `data:image/png;base64,${pixel}`,
          width: 1,
          height: 1,
          type: 'png',
        },
      ],
    ]),
  });
});
const pixel =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

function report(frontMatter: string, body: string): DocumentData {
  return parseMarkdown(`---\ntype: report\n${frontMatter}\n---\n\n${body}`)
    .document;
}

async function exported(document: DocumentData, locale: 'ja' | 'en' = 'ja') {
  const { blob, warnings } = await exportReportDocx(
    document,
    new Map(),
    locale,
  );
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
  const entries = unzipSync(bytes);
  const xml = (name: string) =>
    new DOMParser().parseFromString(
      strFromU8(entries[name]),
      'application/xml',
    );
  return {
    warnings,
    names: Object.keys(entries),
    text: (name: string) => strFromU8(entries[name]),
    document: xml('word/document.xml'),
    styles: xml('word/styles.xml'),
    xml,
  };
}

const all = (root: Document | Element, name: string) => [
  ...root.getElementsByTagName(name),
];
const style = (styles: Document, id: string) =>
  all(styles, 'w:style').find(
    (entry) => entry.getAttribute('w:styleId') === id,
  )!;
const attribute = (root: Element, name: string, key: string) =>
  root.getElementsByTagName(name)[0]?.getAttribute(key) ?? null;
const paragraphWith = (document: Document, text: string) =>
  all(document, 'w:p').find((entry) => entry.textContent === text)!;
const instructions = (document: Document) => [
  ...all(document, 'w:fldSimple').map((entry) =>
    entry.getAttribute('w:instr')!,
  ),
  ...all(document, 'w:instrText').map((entry) => entry.textContent!.trim()),
];

const body = [
  '# はじめに',
  '',
  '## 目的',
  '',
  '結果は[@tab:a]と[@fig:a]、式[@eq:a]、[@sec:data]に示す。',
  '',
  '$$',
  'R = \\frac{a}{b}',
  '$$',
  '{#eq:a}',
  '',
  '| 階 | 備考欄の長い見出し |',
  '| --- | --- |',
  '| 1 | とても長い備考の文章がここに入る |',
  '{#tab:a caption="条件"}',
  '',
  '![図](image.png)',
  '{#fig:a caption="モデル"}',
  '',
  '> [!NOTE]',
  '> 注記の本文',
  '',
  '# 数値表',
  '{#sec:data appendix=true}',
  '',
  '## 一覧',
].join('\n');

describe('Word export from the report style data', () => {
  it('keeps the earlier appearance for documents without a style', async () => {
    const file = await exported(report('', body));
    const fonts = file.styles
      .getElementsByTagName('w:docDefaults')[0]
      .getElementsByTagName('w:rFonts')[0];
    for (const key of ['w:ascii', 'w:hAnsi', 'w:eastAsia'])
      expect(fonts.getAttribute(key)).toBe('Yu Mincho');
    // Headings keep the library defaults; nothing from the style data applies.
    expect(attribute(style(file.styles, 'Heading1'), 'w:sz', 'w:val')).toBe(
      '32',
    );
    expect(
      style(file.styles, 'Heading1').getElementsByTagName('w:keepNext'),
    ).toHaveLength(1);
    const header = paragraphWith(file.document, '階');
    expect(attribute(header, 'w:pStyle', 'w:val')).toBe('KumiTableHeader');
    expect(
      header
        .parentElement!.getElementsByTagName('w:shd')[0]
        .getAttribute('w:fill'),
    ).toBe('F1F5F9');
    expect(
      style(file.styles, 'KumiTableHeader').getElementsByTagName('w:b'),
    ).toHaveLength(1);
    // Table rules stay the library default: thin lines in the automatic colour.
    const rule = all(file.document, 'w:tblBorders')[0].firstElementChild!;
    expect(rule.getAttribute('w:sz')).toBe('4');
    expect(rule.getAttribute('w:color')).toBe('auto');
    expect(paragraphWith(file.document, '注記').textContent).toBe('注記');
    expect(file.document.documentElement.textContent).toContain('表 1 — 条件');
    expect(file.warnings.join()).not.toContain('CSS');
  });

  it('writes the Word-style theme as named styles with separate Latin and East Asian fonts', async () => {
    const file = await exported(
      report(
        'theme: report-jp\ntitle: 検討書\nsubtitle: 副題\nauthor: 担当\nreport_settings:\n  cover: true\n  affiliation: 設計部',
        body,
      ),
    );
    const fonts = file.styles
      .getElementsByTagName('w:docDefaults')[0]
      .getElementsByTagName('w:rFonts')[0];
    expect(fonts.getAttribute('w:ascii')).toBe('Times New Roman');
    expect(fonts.getAttribute('w:eastAsia')).toBe('Yu Mincho');
    const heading = style(file.styles, 'Heading1');
    expect(attribute(heading, 'w:rFonts', 'w:eastAsia')).toBe('Yu Gothic');
    expect(attribute(heading, 'w:sz', 'w:val')).toBe('28');
    expect(attribute(heading, 'w:color', 'w:val')).toBe('000000');
    expect(attribute(heading, 'w:spacing', 'w:before')).toBe('320');
    expect(attribute(style(file.styles, 'Heading2'), 'w:sz', 'w:val')).toBe(
      '24',
    );
    // The third level takes the body size.
    expect(attribute(style(file.styles, 'Heading3'), 'w:sz', 'w:val')).toBe(
      '21',
    );
    expect(attribute(style(file.styles, 'Caption'), 'w:sz', 'w:val')).toBe(
      '20',
    );
    expect(
      attribute(style(file.styles, 'KumiTableText'), 'w:sz', 'w:val'),
    ).toBe('18');
    expect(
      attribute(
        style(file.styles, 'KumiTableHeader'),
        'w:rFonts',
        'w:eastAsia',
      ),
    ).toBe('Yu Gothic');
    // The heading itself carries no direct formatting.
    const first = paragraphWith(file.document, 'はじめに');
    expect(attribute(first, 'w:pStyle', 'w:val')).toBe('Heading1');
    expect(first.getElementsByTagName('w:sz')).toHaveLength(0);
    expect(first.getElementsByTagName('w:rFonts')).toHaveLength(0);

    const table = all(file.document, 'w:tbl').find((entry) =>
      entry.textContent!.includes('階'),
    )!;
    const top =
      table.getElementsByTagName('w:tblBorders')[0].firstElementChild!;
    expect(top.getAttribute('w:val')).toBe('single');
    expect(top.getAttribute('w:sz')).toBe('6');
    expect(top.getAttribute('w:color')).toBe('000000');
    expect(table.getElementsByTagName('w:shd')).toHaveLength(0);
    expect(table.getElementsByTagName('w:cantSplit').length).toBeGreaterThan(0);

    // A boxed note: one bordered cell holding the configured title and the text.
    const note = all(file.document, 'w:tbl').find((entry) =>
      entry.textContent!.startsWith('（注）'),
    )!;
    expect(note.textContent).toBe('（注）注記の本文');
    expect(note.getElementsByTagName('w:tc')).toHaveLength(1);
    expect(
      attribute(paragraphWith(file.document, '（注）'), 'w:pStyle', 'w:val'),
    ).toBe('KumiCalloutTitle');

    // Centred cover without field names; page numbers "- n -" in the centre.
    const text = file.document.documentElement.textContent!;
    expect(text).toContain('設計部');
    expect(text).not.toContain('所属');
    expect(
      attribute(paragraphWith(file.document, '設計部'), 'w:pStyle', 'w:val'),
    ).toBe('KumiCoverText');
    const footerName = file.names.find((name) =>
      /^word\/footer\d+\.xml$/.test(name),
    )!;
    const footer = file.xml(footerName);
    expect(attribute(footer.documentElement, 'w:jc', 'w:val')).toBe('center');
    expect(
      all(footer, 'w:t')
        .map((entry) => entry.textContent)
        .join('|'),
    ).toBe('- | -');
    expect(file.text(footerName)).toContain('PAGE');
  });

  it('uses the configured separator, depth and appendix letters in every text', async () => {
    const file = await exported(
      report(
        'number_sections: true\ntoc: true\nreport_settings:\n  caption_separator: ": "\n  appendix_numbering: letter\n  number_depth: 1\n  list_tables: true',
        body,
      ),
    );
    const text = file.document.documentElement.textContent!;
    expect(text).toContain('表 1: 条件');
    expect(text).toContain('図 1: モデル');
    expect(text).not.toContain(' — ');
    expect(paragraphWith(file.document, '1 はじめに')).toBeDefined();
    expect(paragraphWith(file.document, '目的')).toBeDefined();
    expect(paragraphWith(file.document, '付録 A 数値表')).toBeDefined();
    // The reference to the appendix uses the same wording.
    expect(text).toContain('式 1、付録 Aに示す');
  });

  it('formats footers for Roman front matter and page totals', async () => {
    const file = await exported(
      report(
        'toc: true\nreport_settings:\n  cover: true\n  toc_page: true\n  front_matter_page_numbers: roman\n  page_number_format: "{n} / {total}"\n  page_number_position: bottom-center',
        body,
      ),
    );
    const sections = all(file.document, 'w:sectPr');
    expect(sections).toHaveLength(3);
    expect(sections[0].getElementsByTagName('w:footerReference')).toHaveLength(
      0,
    );
    expect(attribute(sections[1], 'w:pgNumType', 'w:fmt')).toBe('lowerRoman');
    expect(attribute(sections[1], 'w:pgNumType', 'w:start')).toBe('1');
    expect(sections[1].getElementsByTagName('w:footerReference')).toHaveLength(
      1,
    );
    expect(attribute(sections[2], 'w:pgNumType', 'w:fmt')).toBe('decimal');
    expect(attribute(sections[2], 'w:pgNumType', 'w:start')).toBe('1');
    const footers = file.names.filter((name) =>
      /^word\/footer\d+\.xml$/.test(name),
    );
    expect(footers).toHaveLength(2);
    for (const name of footers) {
      expect(file.text(name)).toContain('PAGE');
      expect(file.text(name)).toContain('SECTIONPAGES');
      expect(file.xml(name).documentElement.textContent).toContain(' / ');
    }
  });

  it('sizes columns by their content unless the document stores widths', async () => {
    const file = await exported(report('', body));
    const widths = all(
      all(file.document, 'w:tbl')[0].getElementsByTagName('w:tblGrid')[0],
      'w:gridCol',
    ).map((entry) => Number(entry.getAttribute('w:w')));
    expect(widths).toHaveLength(2);
    expect(widths[1]).toBeGreaterThan(widths[0] * 3);
    // The whole text width (A4 with 20 mm margins) is used, never more.
    const total = widths[0] + widths[1];
    expect(total).toBeLessThanOrEqual(Math.round((170 * 1440) / 25.4));
    expect(total).toBeGreaterThan(Math.round((170 * 1440) / 25.4) - 4);
  });

  it('keeps short tables on one page when asked', async () => {
    const keepNext = async (setting: string) =>
      all(
        (
          await exported(
            report(`report_settings:\n  keep_tables: ${setting}`, body),
          )
        ).document.getElementsByTagName('w:tbl')[0],
        'w:tr',
      ).map((row) => row.getElementsByTagName('w:keepNext').length);
    expect(await keepNext('never')).toEqual([0, 0]);
    // Every row but the last is tied to the next one.
    expect(await keepNext('always')).toEqual([2, 0]);
    expect(await keepNext('auto')).toEqual([2, 0]);
    const long = report(
      'report_settings:\n  keep_tables: auto',
      `| A |\n| - |\n${Array.from({ length: 80 }, (_, index) => `| ${index} |`).join('\n')}`,
    );
    const rows = all((await exported(long)).document, 'w:tr');
    expect(rows).toHaveLength(81);
    expect(
      rows.every((row) => row.getElementsByTagName('w:keepNext').length === 0),
    ).toBe(true);
  });

  it('warns that document CSS does not reach Word', async () => {
    const file = await exported(
      report('report_style:\n  css: "h1 { color: red }"', '# A'),
      'en',
    );
    expect(file.warnings).toEqual([expect.stringContaining('custom CSS')]);
  });
});

describe('Word fields for numbers, references and contents', () => {
  const settings = (extra = '') =>
    `number_sections: true\ntoc: true\nreport_settings:\n  word_fields: true\n  appendix_numbering: letter\n  toc_depth: 2\n  list_tables: true${extra}`;

  it('writes static text by default', async () => {
    const file = await exported(
      report('number_sections: true\ntoc: true', body),
    );
    expect(instructions(file.document)).toEqual([]);
    expect(paragraphWith(file.document, '1 はじめに')).toBeDefined();
  });

  it('numbers headings and captions with Word lists and SEQ fields that hold the KUMI values', async () => {
    const file = await exported(report(settings(), body));
    const fields = instructions(file.document);
    expect(fields).toEqual(
      expect.arrayContaining([
        'SEQ 表 \\* ARABIC',
        'SEQ 図 \\* ARABIC',
        'SEQ 式 \\* ARABIC',
        'TOC \\h \\n "1-9" \\o "1-2" \\u',
        'TOC \\c "表" \\h \\n "1-9"',
      ]),
    );
    // Headings: the number comes from the list; the text holds only the title.
    const heading = paragraphWith(file.document, 'はじめに');
    expect(attribute(heading, 'w:pStyle', 'w:val')).toBe('Heading1');
    expect(heading.getElementsByTagName('w:numPr')).toHaveLength(1);
    const appendix = paragraphWith(file.document, '数値表');
    expect(attribute(appendix, 'w:pStyle', 'w:val')).toBe(
      'KumiAppendixHeading1',
    );
    expect(attribute(appendix, 'w:numId', 'w:val')).not.toBe(
      attribute(heading, 'w:numId', 'w:val'),
    );
    const numbering = file.text('word/numbering.xml');
    expect(numbering).toContain('w:lvlText w:val="付録 %1"');
    expect(numbering).toContain('w:numFmt w:val="upperLetter"');
    expect(numbering).toContain('w:lvlText w:val="%1.%2"');

    // Caption: "表 " + SEQ(1) is bookmarked; the text follows outside it.
    const caption = all(file.document, 'w:p').find(
      (entry) => entry.textContent === '表 1 — 条件',
    )!;
    expect(attribute(caption, 'w:pStyle', 'w:val')).toBe('Caption');
    const sequence = caption.getElementsByTagName('w:fldSimple')[0];
    expect(sequence.textContent).toBe('1');
    const bookmark = caption
      .getElementsByTagName('w:bookmarkStart')[0]
      .getAttribute('w:name')!;

    // References are REF fields to those bookmarks, showing the same text.
    const references = all(file.document, 'w:fldSimple').filter((entry) =>
      entry.getAttribute('w:instr')!.startsWith('REF '),
    );
    expect(
      references.map((entry) => [
        entry.getAttribute('w:instr')!.replace(/kumi_\d+/, 'B'),
        entry.textContent,
      ]),
    ).toEqual([
      ['REF B \\h', '表 1'],
      ['REF B \\h', '図 1'],
      ['REF B \\h', '1'],
      ['REF B \\r \\h', '付録 A'],
    ]);
    expect(references[0].getAttribute('w:instr')).toBe(`REF ${bookmark} \\h`);
    expect(file.document.documentElement.textContent).toContain(
      '式 1、付録 Aに示す',
    );
    // Contents show the current entries until Word rebuilds them.
    const contents = all(file.document, 'w:sdt')[0].textContent!;
    for (const entry of ['1 はじめに', '1.1 目的', '付録 A 数値表', 'A.1 一覧'])
      expect(contents).toContain(entry);
    expect(file.warnings).toEqual([expect.stringContaining('フィールド')]);
    // Nothing depends on Word's page layout, so Word is not asked to update.
    expect(file.text('word/settings.xml')).not.toContain('updateFields');
  });

  it('asks Word to update only when contents page numbers are requested', async () => {
    const file = await exported(
      report(settings('\n  toc_page_numbers: true'), body),
    );
    expect(instructions(file.document)).toContain('TOC \\h \\o "1-2" \\u');
    expect(file.text('word/settings.xml')).toContain('updateFields');
  });

  it('keeps fixed text where Word could not reproduce the numbers', async () => {
    // A skipped level: KUMI shows 1.1.1, a Word list would not.
    const skipped = await exported(
      report(
        settings(),
        '# A\n\n### C\n\n![図](image.png)\n{#fig:a caption="モデル"}',
      ),
    );
    expect(paragraphWith(skipped.document, '1 A')).toBeDefined();
    expect(paragraphWith(skipped.document, '1.1.1 C')).toBeDefined();
    expect(instructions(skipped.document)).toContain('SEQ 図 \\* ARABIC');
    expect(skipped.warnings.join()).toContain('段落番号');

    const byChapter = await exported(
      report(settings('\n  caption_numbering: chapter'), body),
    );
    expect(
      instructions(byChapter.document).filter((entry) =>
        entry.startsWith('SEQ'),
      ),
    ).toEqual([]);
    expect(byChapter.document.documentElement.textContent).toContain(
      '表 1.1 — 条件',
    );
    expect(byChapter.warnings.join()).toContain('章ごとの図表番号');
  });
});
