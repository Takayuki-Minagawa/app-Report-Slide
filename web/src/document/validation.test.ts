import { describe, expect, it } from 'vitest';

import type { DocumentData, ParagraphNode } from './model';
import { createDefaultDocument } from './model';
import { DocumentValidationError, validateDocumentData } from './validation';

function idFactory(): () => string {
  let id = 0;
  return () => `node-${++id}`;
}

function comprehensiveDocument(): DocumentData {
  const id = idFactory();
  const paragraph = (text: string): ParagraphNode => ({
    type: 'paragraph',
    attrs: { nodeId: id() },
    content: [{ type: 'text', text }],
  });

  return {
    schemaVersion: 1,
    type: 'report',
    metadata: {
      title: '検証文書',
      theme: 'calculation',
      toc: true,
      custom: { revision: 1 },
    },
    children: [
      {
        type: 'heading',
        attrs: { nodeId: id(), level: 1 },
        content: [{ type: 'text', text: '見出し', marks: [{ type: 'bold' }] }],
      },
      {
        type: 'paragraph',
        attrs: { nodeId: id() },
        content: [
          { type: 'text', text: '本文' },
          { type: 'inlineMath', attrs: { latex: 'x=1' } },
          {
            type: 'inlineImage',
            attrs: {
              nodeId: id(),
              src: 'assets/sample.png',
              alt: '標本',
              title: null,
            },
          },
          { type: 'hardBreak' },
        ],
      },
      {
        type: 'bulletList',
        attrs: { nodeId: id() },
        content: [
          {
            type: 'listItem',
            attrs: { nodeId: id() },
            content: [paragraph('箇条書き')],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { nodeId: id(), start: 2 },
        content: [
          {
            type: 'listItem',
            attrs: { nodeId: id() },
            content: [paragraph('番号付き')],
          },
        ],
      },
      {
        type: 'blockquote',
        attrs: { nodeId: id() },
        content: [paragraph('引用')],
      },
      {
        type: 'codeBlock',
        attrs: { nodeId: id(), language: 'ts' },
        content: [{ type: 'text', text: 'const x = 1;' }],
      },
      {
        type: 'figure',
        attrs: {
          nodeId: id(),
          src: 'assets/figure.webp',
          alt: '図',
          title: null,
          width: 65,
          align: 'center',
        },
      },
      {
        type: 'blockMath',
        attrs: { nodeId: id(), latex: 'F=ma' },
      },
      { type: 'horizontalRule', attrs: { nodeId: id() } },
      {
        type: 'table',
        attrs: { nodeId: id() },
        content: [
          {
            type: 'tableRow',
            attrs: { nodeId: id() },
            content: [
              {
                type: 'tableHeader',
                attrs: { nodeId: id(), align: 'left' },
                content: [paragraph('列')],
              },
            ],
          },
          {
            type: 'tableRow',
            attrs: { nodeId: id() },
            content: [
              {
                type: 'tableCell',
                attrs: { nodeId: id(), align: 'left' },
                content: [paragraph('値')],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe('validateDocumentData', () => {
  it('全MVP 1 nodeを含む正しいDocumentDataを受け入れる', () => {
    const document = comprehensiveDocument();
    expect(validateDocumentData(document)).toBe(document);
  });

  it('rowspanで完全に覆われた表行を受け入れる', () => {
    const document = {
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [
        {
          type: 'table',
          attrs: { nodeId: 'table' },
          content: [
            {
              type: 'tableRow',
              attrs: { nodeId: 'row-1' },
              content: [
                {
                  type: 'tableCell',
                  attrs: {
                    nodeId: 'cell',
                    align: 'left',
                    colspan: 1,
                    rowspan: 2,
                  },
                  content: [
                    {
                      type: 'paragraph',
                      attrs: { nodeId: 'paragraph' },
                      content: [{ type: 'text', text: '結合セル' }],
                    },
                  ],
                },
              ],
            },
            { type: 'tableRow', attrs: { nodeId: 'row-2' } },
          ],
        },
      ],
    };
    expect(() => validateDocumentData(document)).not.toThrow();
  });

  it('未知schema versionを拒否する', () => {
    const document = {
      ...createDefaultDocument('report', idFactory()),
      schemaVersion: 999,
    };
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });

  it.each([
    [
      'top-level text',
      (document: DocumentData) => {
        document.children = [{ type: 'text', text: 'invalid' } as never];
      },
    ],
    [
      'levelなしheading',
      (document: DocumentData) => {
        document.children = [
          { type: 'heading', attrs: { nodeId: 'heading' } } as never,
        ];
      },
    ],
    [
      'srcなしfigure',
      (document: DocumentData) => {
        document.children = [
          {
            type: 'figure',
            attrs: {
              nodeId: 'figure',
              alt: '図',
              title: null,
              width: 100,
              align: 'center',
            },
          } as never,
        ];
      },
    ],
    [
      'leaf nodeの余剰content',
      (document: DocumentData) => {
        const figure = document.children.find((node) => node.type === 'figure');
        if (!figure || figure.type !== 'figure')
          throw new Error('figure expected');
        (figure as unknown as Record<string, unknown>).content = [
          { type: 'text', text: 'discarded' },
        ];
      },
    ],
    [
      '安全でないリンク',
      (document: DocumentData) => {
        const heading = document.children[0];
        if (
          heading.type !== 'heading' ||
          heading.content?.[0]?.type !== 'text'
        ) {
          throw new Error('heading text expected');
        }
        heading.content[0].marks = [
          { type: 'link', attrs: { href: 'javascript:alert(1)' } },
        ];
      },
    ],
    [
      '安全でないinline image',
      (document: DocumentData) => {
        const paragraph = document.children[1];
        if (paragraph.type !== 'paragraph')
          throw new Error('paragraph expected');
        const image = paragraph.content?.find(
          (node) => node.type === 'inlineImage',
        );
        if (!image || image.type !== 'inlineImage') {
          throw new Error('inline image expected');
        }
        image.attrs.src = 'javascript:alert(1)';
      },
    ],
    [
      '不正な親子関係',
      (document: DocumentData) => {
        document.children = [
          {
            type: 'tableCell',
            attrs: { nodeId: 'cell', align: null },
            content: [],
          },
        ];
      },
    ],
    [
      '重複nodeId',
      (document: DocumentData) => {
        document.children[1].attrs.nodeId = document.children[0].attrs.nodeId;
      },
    ],
    [
      'metadata.type予約キー',
      (document: DocumentData) => {
        (document.metadata as Record<string, unknown>).type = 'slide';
      },
    ],
    [
      'themeの数値',
      (document: DocumentData) => {
        (document.metadata as Record<string, unknown>).theme = 1;
      },
    ],
    [
      'titleの配列',
      (document: DocumentData) => {
        (document.metadata as Record<string, unknown>).title = ['invalid'];
      },
    ],
  ])('%sを拒否する', (_label, mutate) => {
    const document = comprehensiveDocument();
    mutate(document);
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });

  it('text nodeの欠損を拒否する', () => {
    const document = createDefaultDocument('report', idFactory());
    document.children = [
      {
        type: 'paragraph',
        attrs: { nodeId: 'paragraph' },
        content: [{ type: 'text' } as never],
      },
    ];
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });

  it('結合セル、列幅、個別罫線を含む整合した表を受け入れる', () => {
    const document = comprehensiveDocument();
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');

    const firstHeader = table.content[0].content![0];
    firstHeader.attrs.colspan = 2;
    firstHeader.attrs.colwidth = [120, 120];
    table.content[1].content![0].attrs.colspan = 2;
    table.content[1].content![0].attrs.borders = {
      top: { color: '#0f172a', style: 'solid', width: 2 },
      right: null,
      bottom: { color: '#0f172a', style: 'dashed', width: 1 },
      left: null,
    };

    expect(validateDocumentData(document)).toBe(document);
  });

  it('rowspanを含む整合した表を受け入れる', () => {
    const document = comprehensiveDocument();
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');

    const firstHeader = table.content[0].content![0];
    firstHeader.attrs.rowspan = 2;
    table.content[0].content!.push({
      type: 'tableHeader',
      attrs: { nodeId: 'second-header', align: 'left' },
      content: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'second-header-content' },
          content: [{ type: 'text', text: '補助列' }],
        },
      ],
    });

    expect(validateDocumentData(document)).toBe(document);
  });

  it.each([
    ['colspan', 0],
    ['rowspan', 101],
    ['colwidth', [120, 120]],
    ['borders', { top: { color: 'red', style: 'solid', width: 1 } }],
  ])('不正な表属性%sを拒否する', (attribute, value) => {
    const document = comprehensiveDocument();
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    const cell = table.content[1].content![0];
    (cell.attrs as Record<string, unknown>)[attribute] = value;

    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });

  it('結合セルによって列数が揃わない表を拒否する', () => {
    const document = comprehensiveDocument();
    const table = document.children.find((node) => node.type === 'table');
    if (!table || table.type !== 'table') throw new Error('table expected');
    table.content[0].content![0].attrs.colspan = 2;

    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });
  it('accepts a valid free-positioned figure only in a Slide document', () => {
    const document = createDefaultDocument('slide', idFactory());
    document.children.push({
      type: 'figure',
      attrs: {
        nodeId: 'placed-image',
        src: 'assets/diagram.png',
        alt: '構成図',
        title: null,
        width: 100,
        align: 'center',
        slidePlacement: { x: 12.5, y: 18, width: 40, height: 30 },
      },
    });

    expect(validateDocumentData(document)).toBe(document);
  });

  it('rejects malformed placement rectangles and placement in a Report', () => {
    const invalid = comprehensiveDocument();
    const invalidFigure = invalid.children.find(
      (node) => node.type === 'figure',
    );
    if (!invalidFigure || invalidFigure.type !== 'figure')
      throw new Error('figure expected');
    invalidFigure.attrs.slidePlacement = {
      x: 98,
      y: 0,
      width: 5,
      height: 20,
    };
    expect(() => validateDocumentData(invalid)).toThrow(
      DocumentValidationError,
    );

    const report = comprehensiveDocument();
    const reportFigure = report.children.find((node) => node.type === 'figure');
    if (!reportFigure || reportFigure.type !== 'figure')
      throw new Error('figure expected');
    reportFigure.attrs.slidePlacement = {
      x: 10,
      y: 10,
      width: 30,
      height: 30,
    };
    expect(() => validateDocumentData(report)).toThrow(DocumentValidationError);
  });
});
