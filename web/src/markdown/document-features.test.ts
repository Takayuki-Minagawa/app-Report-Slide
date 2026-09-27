import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyzeDocument } from '@/src/document/semantics';
import { inlineText } from '@/src/document/model';
import { MarkdownImportError } from './diagnostics';
import { parseMarkdown } from './parser';
import { serializeDocument } from './serializer';

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'nodeId')
      .map(([key, entry]) => [key, normalized(entry)]),
  );
}

describe('document feature dialect', () => {
  it('round-trips ruler positions on paragraphs and headings', () => {
    const source = [
      '# 見出し',
      '{#sec:ruler text_ruler=12.5,10,8}',
      '',
      '本文',
      '{text_ruler=10,5,15}',
    ].join('\n');
    const first = parseMarkdown(source).document;
    expect(first.children[0].attrs.textRuler).toEqual({
      left: 12.5,
      right: 10,
      firstLine: 8,
    });
    expect(first.children[1].attrs.textRuler).toEqual({
      left: 10,
      right: 5,
      firstLine: 15,
    });
    const canonical = serializeDocument(first);
    expect(canonical).toContain('{text_ruler=10,5,15}');
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(first),
    );
  });

  it('round-trips ruler positions in list items and quotes', () => {
    const source = [
      '- 項目',
      '  {text_ruler=10,0,5}',
      '',
      '> 引用',
      '> {text_ruler=5,10,15}',
    ].join('\n');
    const first = parseMarkdown(source).document;
    const canonical = serializeDocument(first);
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(first),
    );
    expect(canonical).toContain('{text_ruler=10,0,5}');
    expect(canonical).toContain('{text_ruler=5,10,15}');
  });

  it('uses the advanced table format when a cell paragraph has ruler positions', () => {
    const document = parseMarkdown('| Head |\n| --- |\n| Body |').document;
    const table = document.children[0];
    if (table.type !== 'table') throw new Error('Expected table');
    const cell = table.content[1].content?.[0];
    if (!cell) throw new Error('Expected table cell');
    cell.content[0].attrs.textRuler = {
      left: 10,
      right: 0,
      firstLine: 15,
    };
    const canonical = serializeDocument(document);
    expect(canonical).toContain('::: kumi-table');
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(document),
    );
  });

  it.each([
    'Body\n{text_ruler=86,0,0}',
    'Body\n{text_ruler=45,41,45}',
    'Body\n{text_ruler=10,5,96}',
    'Body\n{text_ruler=NaN,5,10}',
    'Body\n{text_ruler=10,5}',
    '![Figure](image.png)\n{text_ruler=10,5,10}',
  ])('rejects invalid ruler attributes: %s', (source) => {
    expect(() => parseMarkdown(source)).toThrow(MarkdownImportError);
  });

  it('preserves references next to punctuation, including link-definition colons', () => {
    const symbols = Array.from('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
    for (const text of [
      ...symbols.map((symbol) => `${symbol} details`),
      ':https://example.com',
      ': 説明',
    ]) {
      const document = parseMarkdown('[@fig:a]').document;
      const paragraph = document.children[0];
      if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
      paragraph.content!.push({ type: 'text', text });
      expect(
        normalized(parseMarkdown(serializeDocument(document)).document),
        text,
      ).toEqual(normalized(document));
    }
  });
  it('ships a sample with resolved references after formatting', () => {
    const source = readFileSync(
      'examples/example-document-features.md',
      'utf8',
    );
    const analysis = analyzeDocument(parseMarkdown(source).document);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.labels.get('table:response')?.number).toBe('1');
  });

  it.each(['(詳細)', '(https://example.com)', '()'])(
    'preserves references followed by parentheses: %s',
    (text) => {
      const document = parseMarkdown('[@fig:a]').document;
      const paragraph = document.children[0];
      if (paragraph.type !== 'paragraph') throw new Error('Expected paragraph');
      paragraph.content!.push({ type: 'text', text });
      expect(
        normalized(parseMarkdown(serializeDocument(document)).document),
      ).toEqual(normalized(document));
    },
  );

  it.each(['    ::: pagebreak', '\t::: slidebreak'])(
    'preserves indented directive text: %s',
    (text) => {
      const document = parseMarkdown('text').document;
      document.children = [
        {
          type: 'paragraph',
          attrs: { nodeId: 'literal' },
          content: [{ type: 'text', text }],
        },
      ];
      expect(
        normalized(parseMarkdown(serializeDocument(document)).document),
      ).toEqual(normalized(document));
    },
  );
  it('preserves all attributes, references and breaks through canonical round trips', () => {
    const source = `---\ntype: report\ntoc: true\nnumber_sections: true\n---\n
# 見出し
{#sec:intro numbered=false}

前方参照 [@fig:response] と [@eq:motion]、[@table:result]。

![結果](assets/result.svg)
{#fig:response width=65.5% align=right caption="最大応答" numbered=true}

$$
x=1
$$
{#eq:motion caption="式の説明"}

| 名前 | 値 |
| :--- | ---: |
| x | 1 |
{#table:result caption="結果一覧"}

::: pagebreak
:::

---

::: slidebreak
:::
`;
    const first = parseMarkdown(source).document;
    const canonical = serializeDocument(first);
    const second = parseMarkdown(canonical).document;
    expect(normalized(second)).toEqual(normalized(first));
    expect(serializeDocument(second)).toBe(canonical);
    expect(first.children.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'figure',
      'blockMath',
      'table',
      'pageBreak',
      'horizontalRule',
      'slideBreak',
    ]);
    expect(first.children[4].attrs).toMatchObject({
      label: 'table:result',
      caption: '結果一覧',
    });
  });

  it('preserves JSON-escaped caption strings', () => {
    const caption = '日本語 "引用" \\ {braces}\n次の行 | & <tag>';
    const document = parseMarkdown(
      `![x](image.svg)\n{caption=${JSON.stringify(caption)}}`,
    ).document;
    expect(document.children[0].attrs.caption).toBe(caption);
    expect(
      parseMarkdown(serializeDocument(document)).document.children[0].attrs
        .caption,
    ).toBe(caption);
  });

  it.each([
    'width=9%',
    'width=101%',
    'width=NaN',
    'align=evil',
    'numbered=yes',
    '#1bad',
    '#fig:x width=50% width=70%',
    '#fig:x unknown=true',
    '#fig:x caption="bad\\q"',
  ])('rejects invalid attributes without silently dropping %s', (attrs) => {
    expect(() => parseMarkdown(`![x](image.svg)\n{${attrs}}`)).toThrow(
      MarkdownImportError,
    );
  });

  it.each([
    '{#sec:orphan}',
    'text\n{caption="orphan"}',
    '# heading\n{width=50%}',
    '# heading\n{caption="invalid"}',
    '::: pagebreak',
    '> ::: pagebreak\n> :::',
    '- text\n\n  ::: slidebreak\n  :::',
  ])('rejects orphan or nested structure: %s', (source) => {
    expect(() => parseMarkdown(source)).toThrow(MarkdownImportError);
  });

  it('keeps escaped syntax, code, links and math literal', () => {
    const source =
      '\\{#fig:x}\n\n\\[@fig:x]\n\n`[@fig:x]`\n\n[@sec:a](https://example.com)\n\n[text [@sec:a]](https://example.com)\n\n~~~\n::: pagebreak\n:::\n{#fig:x}\n~~~\n\n$$\n[@eq:x]\n$$';
    const document = parseMarkdown(source).document;
    const canonical = serializeDocument(document);
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(document),
    );
    expect(JSON.stringify(document)).not.toContain('"type":"reference"');
    const linked = document.children[3];
    expect(linked.type === 'paragraph' && linked.content?.[0]).toMatchObject({
      type: 'text',
      marks: [{ type: 'link' }],
    });
  });

  it('escapes plain text that resembles a break on save', () => {
    for (const text of [
      '::: pagebreak',
      '::: slidebreak',
      '::: pagebreak\n:::',
    ]) {
      const document = parseMarkdown('text').document;
      document.children = [
        {
          type: 'paragraph',
          attrs: { nodeId: 'literal' },
          content: [{ type: 'text', text }],
        },
      ];
      const result = parseMarkdown(serializeDocument(document)).document;
      expect(result.children[0].type).toBe('paragraph');
      expect(
        inlineText(
          result.children[0].type === 'paragraph'
            ? result.children[0].content
            : [],
        ),
      ).toBe(text.replace(/\n/g, ' '));
    }
  });

  it.each([
    '> $$\n> x\n> $$\n> {#eq:a}',
    '- item\n\n  $$\n  x\n  $$\n  {#eq:a}',
  ])('preserves math inside containers: %s', (source) => {
    const document = parseMarkdown(source).document;
    const canonical = serializeDocument(document);
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(document),
    );
    expect(canonical).not.toContain('> >');
  });

  it('reports the source line including front matter', () => {
    try {
      parseMarkdown('---\ntype: report\n---\n\ntext\n{#orphan}');
    } catch (error) {
      expect(error).toBeInstanceOf(MarkdownImportError);
      expect((error as MarkdownImportError).diagnostics.at(-1)?.line).toBe(6);
      return;
    }
    throw new Error('Expected diagnostic');
  });
  it('preserves a Slide figure placement through canonical Markdown', () => {
    const source = [
      '---',
      'type: slide',
      'title: Layout',
      '---',
      '',
      '![Diagram](assets/diagram.png)',
      '{slide_layout="12.5,18,40,30"}',
    ].join('\n');
    const first = parseMarkdown(source).document;
    const figure = first.children.find((node) => node.type === 'figure');
    if (!figure || figure.type !== 'figure') throw new Error('figure expected');

    expect(figure.attrs.slidePlacement).toEqual({
      x: 12.5,
      y: 18,
      width: 40,
      height: 30,
    });
    const canonical = serializeDocument(first);
    expect(canonical).toContain('slide_layout="12.5,18,40,30"');
    expect(normalized(parseMarkdown(canonical).document)).toEqual(
      normalized(first),
    );
  });

  it.each([
    'slide_layout="95,0,10,20"',
    'slide_layout="10,10,4,20"',
    'slide_layout="10,10,40"',
  ])('rejects invalid slide placement attributes: %s', (attribute) => {
    expect(() =>
      parseMarkdown('![Diagram](assets/diagram.png)\n{' + attribute + '}'),
    ).toThrow(MarkdownImportError);
  });
});
