import { describe, expect, it } from 'vitest';

import type { DocumentData } from '@/src/document/model';
import { inlineText } from '@/src/document/model';
import { DocumentValidationError } from '@/src/document/validation';

import { MarkdownImportError } from './diagnostics';
import { parseMarkdown } from './parser';
import { MarkdownSerializationError, serializeDocument } from './serializer';

function idFactory(): () => string {
  let id = 0;
  return () => `test-${++id}`;
}

function withoutNodeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutNodeIds);
  if (typeof value !== 'object' || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'nodeId')
      .map(([key, entry]) => [key, withoutNodeIds(entry)]),
  );
}

const reportFixture = `---
type: report
title: 2層鉄骨造 時刻歴応答解析
author: TMD
date: 2026-09-02
theme: calculation
custom_flag: true
---

# 解析概要

本文中の固有円振動数は $\\omega = 2\\pi f$ で表す。

$$
M\\ddot{x}+C\\dot{x}+Kx=F(t)
$$

| 階 | 最大変位 | 層間変形角 |
|:---|---:|:---:|
| 2F | 24.5 | 1/135 |

![応答解析結果](assets/response.svg)
`;

describe('parseMarkdown', () => {
  it('Report Front MatterとMVP 1 nodeを解析する', () => {
    const result = parseMarkdown(reportFixture, { idFactory: idFactory() });

    expect(result.document.type).toBe('report');
    expect(result.document.metadata).toMatchObject({
      title: '2層鉄骨造 時刻歴応答解析',
      author: 'TMD',
      date: '2026-09-02',
      theme: 'calculation',
      custom_flag: true,
    });
    expect(result.document.children.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'blockMath',
      'table',
      'figure',
    ]);

    const paragraph = result.document.children[1];
    expect(paragraph.type).toBe('paragraph');
    if (paragraph.type !== 'paragraph') {
      throw new Error('2番目のnodeはparagraphである必要があります');
    }
    expect(paragraph.content?.some((node) => node.type === 'inlineMath')).toBe(
      true,
    );

    const figure = result.document.children.at(-1);
    expect(figure).toMatchObject({
      type: 'figure',
      attrs: {
        src: 'assets/response.svg',
        alt: '応答解析結果',
      },
    });
  });

  it('BOMとCRLFを含むSlide Front Matterを解析する', () => {
    const source =
      '\uFEFF---\r\ntype: slide\r\ntitle: Test\r\n---\r\n\r\n# Title\r\n';
    const result = parseMarkdown(source, { idFactory: idFactory() });

    expect(result.document.type).toBe('slide');
    expect(result.document.metadata.title).toBe('Test');
    expect(result.document.children[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
    });
  });

  it('Front Matterがない場合は明示fallbackと警告を返す', () => {
    const result = parseMarkdown('# Title', {
      fallbackType: 'slide',
      idFactory: idFactory(),
    });

    expect(result.document.type).toBe('slide');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'frontmatter.missing' }),
    );
  });

  it('未知のtypeではtyped errorを返す', () => {
    expect(() =>
      parseMarkdown('---\ntype: book\n---\n\nText', {
        idFactory: idFactory(),
      }),
    ).toThrow(MarkdownImportError);
  });

  it('本文中の---をFront Matterとして再解釈しない', () => {
    const result = parseMarkdown(
      '---\ntype: report\n---\n\nBefore\n\n---\n\nAfter',
      { idFactory: idFactory() },
    );

    expect(result.document.children.map((node) => node.type)).toEqual([
      'paragraph',
      'horizontalRule',
      'paragraph',
    ]);
  });

  it('code fence内の数式区切りを数式として扱わない', () => {
    const result = parseMarkdown(
      '---\ntype: report\n---\n\n~~~text\n$$\nnot math\n$$\n~~~',
      { idFactory: idFactory() },
    );

    expect(result.document.children).toHaveLength(1);
    expect(result.document.children[0]).toMatchObject({ type: 'codeBlock' });
  });

  it('危険な画像URLを実行可能なfigureへ変換しない', () => {
    const result = parseMarkdown(
      '---\ntype: report\n---\n\n![x](javascript:alert%281%29)',
      { idFactory: idFactory() },
    );

    expect(
      result.document.children.some((node) => node.type === 'figure'),
    ).toBe(false);
  });

  it('空文書でも編集可能なparagraphを生成する', () => {
    const result = parseMarkdown('---\ntype: report\n---\n', {
      idFactory: idFactory(),
    });
    expect(result.document.children).toHaveLength(1);
    expect(result.document.children[0].type).toBe('paragraph');
  });

  it.each([
    ['title', '[]'],
    ['theme', '42'],
    ['toc', '"yes"'],
    ['slide_number', '1'],
  ])('既知Front Matterキー%sの型違反を拒否する', (key, value) => {
    expect(() =>
      parseMarkdown(`---\ntype: report\n${key}: ${value}\n---\n\nText`, {
        idFactory: idFactory(),
      }),
    ).toThrow(MarkdownImportError);
  });
});

describe('Markdown round-trip', () => {
  it('対応nodeとmetadataの意味を維持する', () => {
    const first = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    const markdown = serializeDocument(first);
    const second = parseMarkdown(markdown, { idFactory: idFactory() }).document;

    expect(withoutNodeIds(second)).toEqual(withoutNodeIds(first));
  });

  it('2回目以降のcanonical Markdownが安定する', () => {
    const first = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    const once = serializeDocument(first);
    const twice = serializeDocument(
      parseMarkdown(once, { idFactory: idFactory() }).document,
    );

    expect(twice).toBe(once);
  });

  it('DocumentDataがJSON互換である', () => {
    const document: DocumentData = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it.each([
    [String.raw`\# literal`, '# literal'],
    [String.raw`\- literal`, '- literal'],
    [String.raw`\> literal`, '> literal'],
    [String.raw`1\. literal`, '1. literal'],
    [String.raw`\---`, '---'],
  ])('段落先頭の「%s」を別blockへ変換しない', (sourceText, plainText) => {
    const first = parseMarkdown(`---\ntype: report\n---\n\n${sourceText}`, {
      idFactory: idFactory(),
    }).document;
    const second = parseMarkdown(serializeDocument(first), {
      idFactory: idFactory(),
    }).document;

    expect(first.children[0].type).toBe('paragraph');
    expect(second.children[0].type).toBe('paragraph');
    const paragraph = second.children[0];
    if (paragraph.type !== 'paragraph') throw new Error('paragraph expected');
    expect(inlineText(paragraph.content)).toBe(plainText);
  });

  it('backtickを含むinline codeを保持する', () => {
    const source = '---\ntype: report\n---\n\nA ``x`y`` Z';
    const first = parseMarkdown(source, { idFactory: idFactory() }).document;
    const markdown = serializeDocument(first);
    const second = parseMarkdown(markdown, { idFactory: idFactory() }).document;
    const paragraph = second.children[0];
    if (paragraph.type !== 'paragraph') throw new Error('paragraph expected');

    expect(inlineText(paragraph.content)).toBe('A x`y Z');
    expect(
      paragraph.content?.find(
        (node) =>
          node.type === 'text' &&
          node.marks?.some((mark) => mark.type === 'code'),
      ),
    ).toMatchObject({ type: 'text', text: 'x`y' });
  });

  it.each(['x``y', '```start', 'end```'])(
    '複数backtickを含むinline code「%s」を保持する',
    (code) => {
      const document: DocumentData = {
        schemaVersion: 1,
        type: 'report',
        metadata: {},
        children: [
          {
            type: 'paragraph',
            attrs: { nodeId: 'paragraph-code-runs' },
            content: [{ type: 'text', text: code, marks: [{ type: 'code' }] }],
          },
        ],
      };
      const second = parseMarkdown(serializeDocument(document), {
        idFactory: idFactory(),
      }).document;
      const paragraph = second.children[0];
      if (paragraph.type !== 'paragraph') throw new Error('paragraph expected');
      expect(inlineText(paragraph.content)).toBe(code);
    },
  );

  it('文章内の画像URL・alt・titleを往復保持する', () => {
    const source =
      '---\ntype: report\n---\n\nBefore ![応答図](assets/result.webp "結果") after';
    const first = parseMarkdown(source, { idFactory: idFactory() }).document;
    const paragraph = first.children[0];
    if (paragraph.type !== 'paragraph') throw new Error('paragraph expected');
    expect(paragraph.content).toContainEqual(
      expect.objectContaining({
        type: 'inlineImage',
        attrs: {
          nodeId: expect.any(String),
          src: 'assets/result.webp',
          alt: '応答図',
          title: '結果',
        },
      }),
    );

    const second = parseMarkdown(serializeDocument(first), {
      idFactory: idFactory(),
    }).document;
    expect(withoutNodeIds(second)).toEqual(withoutNodeIds(first));
  });

  it('画像だけのinline paragraphをfigureへ変換しない', () => {
    const document: DocumentData = {
      schemaVersion: 1,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'inline-image-paragraph' },
          content: [
            {
              type: 'inlineImage',
              attrs: {
                nodeId: 'inline-image-only',
                src: 'assets/inline.png',
                alt: 'インライン',
                title: null,
              },
            },
          ],
        },
      ],
    };
    const second = parseMarkdown(serializeDocument(document), {
      idFactory: idFactory(),
    }).document;
    expect(second.children[0].type).toBe('paragraph');
    if (second.children[0].type !== 'paragraph') {
      throw new Error('paragraph expected');
    }
    expect(second.children[0].content?.[0]).toMatchObject({
      type: 'inlineImage',
      attrs: { src: 'assets/inline.png', alt: 'インライン' },
    });
  });

  it('空段落を予約マーカーで往復保持する', () => {
    const document: DocumentData = {
      schemaVersion: 1,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'empty-1' },
        },
        {
          type: 'paragraph',
          attrs: { nodeId: 'empty-2' },
        },
      ],
    };
    const markdown = serializeDocument(document);
    expect(markdown.match(/\{\.kumi-empty\}/g)).toHaveLength(2);

    const second = parseMarkdown(markdown, {
      idFactory: idFactory(),
    }).document;
    expect(second.children).toHaveLength(2);
    expect(second.children.every((node) => node.type === 'paragraph')).toBe(
      true,
    );
    expect(
      second.children.every(
        (node) => node.type === 'paragraph' && !node.content?.length,
      ),
    ).toBe(true);
  });

  it('metadata.typeによる文書種類の上書きを拒否する', () => {
    const document = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    (document.metadata as Record<string, unknown>).type = 'slide';
    expect(() => serializeDocument(document)).toThrow(DocumentValidationError);
  });

  it('headerなしの表を黙ってheader化しない', () => {
    const document = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    table.content[0].content = table.content[0].content.map((cell) => ({
      ...cell,
      type: 'tableCell',
    }));

    expect(() => serializeDocument(document)).toThrow(
      MarkdownSerializationError,
    );
  });

  it('複数段落を持つ表セルを黙って切り捨てない', () => {
    const document = parseMarkdown(reportFixture, {
      idFactory: idFactory(),
    }).document;
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    const cell = table.content[1].content[0];
    if (cell.type !== 'tableCell') throw new Error('tableCell expected');
    cell.content.push({
      type: 'paragraph',
      attrs: { nodeId: 'additional-cell-paragraph' },
      content: [{ type: 'text', text: '消してはいけない' }],
    });

    expect(() => serializeDocument(document)).toThrow(
      MarkdownSerializationError,
    );
  });
});
