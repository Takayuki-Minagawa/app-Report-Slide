import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentData, InlineNode } from '@/src/document/model';
import { collectFootnotes } from '@/src/document/semantics';
import { documentStatistics } from '@/src/document/statistics';
import {
  DocumentValidationError,
  validateDocumentData,
} from '@/src/document/validation';
import { localizeMarkdownDiagnostic } from '@/src/i18n/diagnostics';
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

function body(document: DocumentData): string {
  return serializeDocument(document).split('---\n').slice(2).join('---\n');
}

/** Canonical Markdown must reproduce the same document and the same text. */
function expectStable(source: string): DocumentData {
  const first = parseMarkdown(source).document;
  const canonical = serializeDocument(first);
  const second = parseMarkdown(canonical).document;
  expect(normalized(second)).toEqual(normalized(first));
  expect(serializeDocument(second)).toBe(canonical);
  return first;
}

/** Sources here have no Front Matter; its notice is not under test. */
const isMarkdownCode = (code: string) => code.startsWith('markdown.');

function diagnosticCodes(source: string): string[] {
  try {
    return parseMarkdown(source)
      .diagnostics.map((diagnostic) => diagnostic.code)
      .filter(isMarkdownCode);
  } catch (error) {
    if (error instanceof MarkdownImportError)
      return error.diagnostics
        .map((diagnostic) => diagnostic.code)
        .filter(isMarkdownCode);
    throw error;
  }
}

function paragraph(content: InlineNode[]): DocumentData {
  return {
    schemaVersion: 2,
    type: 'report',
    metadata: { theme: 'latex' },
    children: [{ type: 'paragraph', attrs: { nodeId: 'p' }, content }],
  };
}

const link = (text: string): InlineNode => ({
  type: 'text',
  text,
  marks: [
    {
      type: 'link',
      attrs: {
        href: 'https://example.com',
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
      },
    },
  ],
});

describe('footnotes', () => {
  it('reads Pandoc inline footnotes as plain text and saves them the same way', () => {
    const document = expectStable(
      '本文^[注 *強調* と `code` と \\[括弧\\] & <tag>]の続き。',
    );
    expect(document.children[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: '本文' },
        {
          type: 'footnote',
          attrs: { text: '注 強調 と code と [括弧] & <tag>' },
        },
        { type: 'text', text: 'の続き。' },
      ],
    });
    expect(body(document)).toBe(
      '\n本文^[注 強調 と code と \\[括弧\\] &amp; &lt;tag&gt;]の続き。\n',
    );
  });

  it('converts reference-style footnotes and drops their definitions from the body', () => {
    const document = expectStable(
      [
        '一つ目[^a]と二つ目[^long-id]、再利用[^a]。',
        '',
        '[^a]: 最初の注',
        '  の続き',
        '[^long-id]: 二番目',
        '',
        '後続の段落。',
      ].join('\n'),
    );
    expect(document.children).toHaveLength(2);
    expect(
      collectFootnotes(document.children).map((note) => note.attrs.text),
    ).toEqual(['最初の注 の続き', '二番目', '最初の注 の続き']);
    expect(body(document)).toContain('一つ目^[最初の注 の続き]と二つ目');
  });

  it('keeps undefined references, empty notes and escaped markers as text', () => {
    const document = parseMarkdown(
      '未定義[^zzz]、空^[]、エスケープ^\\[x\\]。',
    ).document;
    expect(collectFootnotes(document.children)).toEqual([]);
    expect(document.children[0]).toMatchObject({
      content: [
        { type: 'text', text: '未定義[^zzz]、空^[]、エスケープ^[x]。' },
      ],
    });
    expectStable('未定義[^zzz]、空^[]、エスケープ^\\[x\\]。');
  });

  it('does not nest or recurse through footnote text', () => {
    const selfReference = parseMarkdown(
      '本文[^a]と[^b]\n\n[^a]: 自分[^a]と相手[^b]\n[^b]: 戻る[^a]',
    ).document;
    expect(
      collectFootnotes(selfReference.children).map((note) => note.attrs.text),
    ).toEqual(['自分[^a]と相手[^b]', '戻る[^a]']);
    const nested = expectStable('外^[内側 ^[入れ子] の注]。');
    expect(
      collectFootnotes(nested.children).map((note) => note.attrs.text),
    ).toEqual(['内側 ^[入れ子] の注']);
    const deep = `${'^['.repeat(5000)}x${']'.repeat(5000)}`;
    expect(() => parseMarkdown(deep)).not.toThrow(RangeError);
  });

  it('keeps a caret before a link or reference as text, in old and new files', () => {
    // Saved by versions without footnotes: the caret was never escaped.
    const legacy = parseMarkdown(
      'a^[b](https://example.com) c と x^[@sec:a]\n\n| A |\n| --- |\n| p^[q](https://example.com) |',
    ).document;
    expect(collectFootnotes(legacy.children)).toEqual([]);
    expect(legacy.children[0]).toMatchObject({
      content: [
        { type: 'text', text: 'a^' },
        { type: 'text', text: 'b', marks: [{ type: 'link' }] },
        { type: 'text', text: ' c と x^' },
        { type: 'reference', attrs: { target: 'sec:a' } },
      ],
    });

    const documents = [
      paragraph([{ type: 'text', text: 'a^' }, link('b')]),
      paragraph([
        { type: 'text', text: 'x\\^' },
        { type: 'reference', attrs: { target: 'sec:a' } },
      ]),
      paragraph([
        { type: 'text', text: 'm^2 と ^' },
        { type: 'footnote', attrs: { text: '@smith' } },
        { type: 'footnote', attrs: { text: '注' } },
        link('直後のリンク'),
        { type: 'text', text: '(括弧)' },
      ]),
    ];
    for (const document of documents) {
      const canonical = serializeDocument(document);
      const reparsed = parseMarkdown(canonical).document;
      expect(normalized(reparsed.children)).toEqual(
        normalized(document.children),
      );
      expect(serializeDocument(reparsed)).toBe(canonical);
    }
    expect(body(documents[0])).toContain('a\\^[b](https://example.com)');
    expect(body(documents[2])).toContain('m^2 と ^^[\\@smith]^[注][直後');
  });

  it('ends a definition where a paragraph would end and reports unused ones', () => {
    const { document, diagnostics } = parseMarkdown(
      [
        '- 項目[^a]',
        '',
        '  [^a]: 注',
        '  の続き',
        '- 二つ目',
        '',
        '[^b]: 未使用',
        '# 見出し',
        '',
        '[^a]: 重複',
        '~~~',
        'code',
        '~~~',
        '[^c]: 未使用2',
        '::: notes',
        'ノート',
        ':::',
      ].join('\n'),
    );
    expect(document.children.map((node) => node.type)).toEqual([
      'bulletList',
      'heading',
      'codeBlock',
      'speakerNotes',
    ]);
    const list = document.children[0];
    if (list.type !== 'bulletList') throw new Error('list expected');
    expect(list.content).toHaveLength(2);
    expect(
      collectFootnotes(document.children).map((note) => note.attrs.text),
    ).toEqual(['注 の続き']);
    const ignored = diagnostics.filter(({ code }) => isMarkdownCode(code));
    expect(
      ignored.map(({ severity, code, line }) => [severity, code, line]),
    ).toEqual([
      ['warning', 'markdown.footnote-definition-ignored', 7],
      ['warning', 'markdown.footnote-definition-ignored', 10],
      ['warning', 'markdown.footnote-definition-ignored', 14],
    ]);
    expect(localizeMarkdownDiagnostic(ignored[0], 'en')).toMatch(
      /footnote definition/,
    );
  });

  it('reports an over-long footnote and stays fast on repeated or nested notes', () => {
    expect(diagnosticCodes(`本文^[${'x'.repeat(2001)}]`)).toEqual([
      'markdown.footnote-too-long',
    ]);
    const started = performance.now();
    // One definition referenced many times is resolved once.
    expect(
      diagnosticCodes(
        `${'[^a]'.repeat(100_000)}\n\n[^a]: ${'y '.repeat(500_000)}`,
      ),
    ).toContain('markdown.footnote-too-long');
    // Nested markers are scanned once instead of once per level.
    parseMarkdown(`${'^[a'.repeat(90)}${']'.repeat(90)} `.repeat(800));
    // Many footnotes must not overflow the stack when collected for rendering.
    const many = parseMarkdown('^[a]'.repeat(120_000)).document;
    expect(collectFootnotes(many.children)).toHaveLength(120_000);
    // These took 30 s to 2 min before; the bound only guards the complexity.
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('does not treat math, code or link text as footnotes', () => {
    const document = parseMarkdown('$x^[2]$ と `a^[b]` を使う。').document;
    expect(collectFootnotes(document.children)).toEqual([]);
  });

  it('round-trips footnotes in headings, lists and table cells', () => {
    const document = expectStable(
      [
        '# 見出し^[見出しの注]',
        '',
        '- 項目^[項目の注]',
        '',
        '| A |',
        '| --- |',
        '| セル^[縦棒 \\| を含む注] |',
      ].join('\n'),
    );
    expect(
      collectFootnotes(document.children).map((note) => note.attrs.text),
    ).toEqual(['見出しの注', '項目の注', '縦棒 | を含む注']);
  });

  it('rejects empty, multi-line and oversized footnote text in document data', () => {
    const withText = (text: unknown) => ({
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'p' },
          content: [{ type: 'footnote', attrs: { text } }],
        },
      ],
    });
    expect(() => validateDocumentData(withText('注'))).not.toThrow();
    for (const text of [
      '',
      '  ',
      ' 注',
      '注\u00a0',
      'a\nb',
      'x'.repeat(2001),
      1,
    ])
      expect(() => validateDocumentData(withText(text))).toThrow(
        DocumentValidationError,
      );
  });
});

describe('callouts', () => {
  it('reads GitHub alerts as a quote attribute and keeps the marker out of the text', () => {
    const document = expectStable('> [!warning]\n> 本文 *強調*\n>\n> 二段落目');
    expect(document.children[0]).toMatchObject({
      type: 'blockquote',
      attrs: { callout: 'warning' },
      content: [
        { type: 'paragraph', content: [{ text: '本文 ' }, { text: '強調' }] },
        { type: 'paragraph', content: [{ text: '二段落目' }] },
      ],
    });
    expect(body(document)).toBe(
      '\n> [!WARNING]\n> 本文 *強調*\n> \n> 二段落目\n',
    );
  });

  it.each([
    ['list', '> [!TIP]\n>\n> - a\n> - b', 'bulletList'],
    ['figure', '> [!NOTE]\n>\n> ![図](a.png)', 'figure'],
    ['inline image', '> [!NOTE]\n>\n> ![図](a.png){.kumi-inline}', 'paragraph'],
    ['bold start', '> [!IMPORTANT]\n> **強調**から始まる', 'paragraph'],
    ['hard break', '> [!CAUTION]  \n> 改行後', 'paragraph'],
    ['marker only', '> [!NOTE]', 'paragraph'],
  ])('keeps a callout whose content starts with a %s', (_, source, first) => {
    const document = expectStable(source);
    const quote = document.children[0];
    expect(quote.type).toBe('blockquote');
    expect(quote.attrs.callout).toBeTruthy();
    if (quote.type !== 'blockquote') throw new Error('blockquote expected');
    expect(quote.content[0].type).toBe(first);
    expect(JSON.stringify(quote.content)).not.toContain('[!');
  });

  it('keeps a hard break that belongs to the text rather than to the marker', () => {
    const document = expectStable('> [!TIP]\n> {.kumi-br}本文');
    expect(document.children[0]).toMatchObject({
      attrs: { callout: 'tip' },
      content: [
        { content: [{ type: 'hardBreak' }, { type: 'text', text: '本文' }] },
      ],
    });
  });

  it('leaves escaped, inline and unknown markers as ordinary quotes', () => {
    for (const source of [
      '> \\[!NOTE\\]\n> 本文',
      '> [!NOTE] 同じ行の本文',
      '> [!UNKNOWN]\n> 本文',
      '> 本文\n> [!NOTE]',
    ]) {
      const document = expectStable(source);
      expect(document.children[0].attrs.callout).toBeUndefined();
    }
  });

  it('validates the callout type and its node', () => {
    const document = parseMarkdown('> [!NOTE]\n> 本文\n\n段落').document;
    document.children[0].attrs.callout = 'danger';
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
    document.children[0].attrs.callout = null;
    document.children[1].attrs.callout = 'note';
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });
});

describe('speaker notes', () => {
  it('round-trips notes with several paragraphs and inline content', () => {
    const document = expectStable(
      [
        '---',
        'type: slide',
        '---',
        '',
        '# タイトル',
        '',
        '::: notes',
        '最初に **結論** を述べる。',
        '',
        '式 $E=mc^2$ に触れる。',
        ':::',
        '',
        '::: slidebreak',
        ':::',
        '',
        '::: notes',
        ':::',
      ].join('\n'),
    );
    expect(document.children.map((node) => node.type)).toEqual([
      'heading',
      'speakerNotes',
      'slideBreak',
      'speakerNotes',
    ]);
    expect(document.children[1]).toMatchObject({
      content: [{ type: 'paragraph' }, { type: 'paragraph' }],
    });
    expect(body(document)).toContain(
      '::: notes\n最初に **結論** を述べる。\n\n式 $E=mc^2$ に触れる。\n:::',
    );
  });

  it('keeps a literal marker line as paragraph text', () => {
    const document = expectStable('\\::: notes\n\\:::');
    expect(document.children).toMatchObject([
      { type: 'paragraph', content: [{ text: '::: notes :::' }] },
    ]);
  });

  it.each([
    ['unclosed', '::: notes\n閉じていない'],
    ['heading inside', '::: notes\n# 見出し\n:::'],
    ['figure inside', '::: notes\n![図](a.png)\n:::'],
    ['inside a quote', '> ::: notes\n> 本文\n> :::'],
    ['inside a list', '- 項目\n\n  ::: notes\n  本文\n  :::'],
  ])('rejects %s notes with a localized diagnostic', (_, source) => {
    const codes = diagnosticCodes(source);
    expect(codes).toContain('markdown.notes-invalid');
    expect(
      localizeMarkdownDiagnostic(
        { code: 'markdown.notes-invalid', message: '' },
        'en',
      ),
    ).toMatch(/Speaker notes/);
  });

  it('allows notes only at the top level with paragraph children', () => {
    const document = parseMarkdown('::: notes\n本文\n:::\n\n> 引用').document;
    const [notes, quote] = document.children;
    if (notes.type !== 'speakerNotes' || quote.type !== 'blockquote')
      throw new Error('unexpected document');
    expect(() =>
      validateDocumentData({ ...document, children: [quote, notes] }),
    ).not.toThrow();
    expect(() =>
      validateDocumentData({
        ...document,
        children: [{ ...quote, content: [notes] }],
      }),
    ).toThrow(DocumentValidationError);
    expect(() =>
      validateDocumentData({
        ...document,
        children: [{ ...notes, content: [quote] }],
      }),
    ).toThrow(DocumentValidationError);
    expect(() =>
      validateDocumentData({
        ...document,
        children: [{ ...notes, content: [] }],
      }),
    ).toThrow(DocumentValidationError);
  });
});

describe('bundled samples', () => {
  it('ship valid notes, footnotes and callouts that save unchanged', () => {
    const slide = expectStable(
      readFileSync('examples/example-slide.md', 'utf8'),
    );
    expect(slide.children.at(-1)?.type).toBe('speakerNotes');
    expect(collectFootnotes(slide.children)).toHaveLength(1);
    const report = expectStable(
      readFileSync('examples/example-document-features.md', 'utf8'),
    );
    expect(
      report.children.some(
        (node) => node.type === 'blockquote' && node.attrs.callout === 'note',
      ),
    ).toBe(true);
    expect(collectFootnotes(report.children)).toHaveLength(1);
  });
});

describe('document statistics', () => {
  it('counts audience text and footnotes but not notes, math or whitespace', () => {
    const document = parseMarkdown(
      [
        '# Two words',
        '',
        'Alpha beta^[gamma] $x+y$',
        '',
        '::: notes',
        'not counted at all',
        ':::',
      ].join('\n'),
    ).document;
    expect(documentStatistics(document.children)).toEqual({
      characters: 'TwowordsAlphabetagamma'.length,
      words: 5,
    });
  });

  it('counts Japanese text by character and surrogate pairs once', () => {
    const { characters, words } = documentStatistics(
      parseMarkdown('解析 概要😀').document.children,
    );
    expect(characters).toBe(5);
    expect(words).toBeGreaterThan(0);
  });
});
