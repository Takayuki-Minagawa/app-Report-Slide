import {
  Extension,
  Node,
  mergeAttributes,
  type Extensions,
} from '@tiptap/core';
import { Image } from '@tiptap/extension-image';
import { Mathematics } from '@tiptap/extension-mathematics';
import { TableKit } from '@tiptap/extension-table';
import { Plugin } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';

import {
  createNodeId,
  isCalloutType,
  normalizeFootnoteText,
} from '@/src/document/model';
import { isTextRuler, textRulerStyle } from '@/src/document/text-ruler';
import { validateDocumentData } from '@/src/document/validation';
import {
  isSlideImagePlacement,
  parseSlideImagePlacement,
  serializeSlideImagePlacement,
} from '@/src/document/slide-layout';
import {
  isTableCellBorders,
  maximumTableColumnWidth,
  parseTableCellBorders,
  tableCellBordersToCss,
} from '@/src/document/table';
import {
  safeResourceUrl,
  resolveSafeImageUrl,
} from '@/src/security/resource-url';
import { UndoSafeTableView } from './table-view';

export interface MathSelection {
  nodeId?: string;
  type: 'inlineMath' | 'blockMath';
  position: number;
  latex: string;
}

interface EditorExtensionsOptions {
  onMathSelect: (selection: MathSelection) => void;
  resolveImageUrl?: (source: string) => string;
}

const identifiedTypes = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'pageBreak',
  'slideBreak',
  'speakerNotes',
  'inlineImage',
  'figure',
  'blockMath',
  'chart',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
];

const DocumentAttributes = Extension.create({
  name: 'documentAttributes',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          textRuler: {
            default: null,
            parseHTML: (element) => {
              const source = element.getAttribute('data-kumi-text-ruler');
              if (!source) return null;
              try {
                const value: unknown = JSON.parse(source);
                return isTextRuler(value) ? value : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attributes) => {
              if (!isTextRuler(attributes.textRuler)) return {};
              const style = textRulerStyle(attributes.textRuler)!;
              return {
                'data-kumi-text-ruler': JSON.stringify(attributes.textRuler),
                style: `margin-left:${style.marginLeft};margin-right:${style.marginRight};text-indent:${style.textIndent}`,
              };
            },
          },
        },
      },
      {
        types: ['heading', 'figure', 'table', 'blockMath'],
        attributes: {
          label: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-label'),
            renderHTML: (attrs) =>
              attrs.label ? { 'data-label': attrs.label } : {},
          },
          numbered: {
            default: null,
            parseHTML: (element) =>
              element.hasAttribute('data-numbered')
                ? element.getAttribute('data-numbered') === 'true'
                : null,
            renderHTML: (attrs) =>
              attrs.numbered != null
                ? { 'data-numbered': String(attrs.numbered) }
                : {},
          },
        },
      },
      {
        types: ['figure', 'table', 'blockMath'],
        attributes: {
          caption: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-caption'),
            renderHTML: (attrs) =>
              attrs.caption != null ? { 'data-caption': attrs.caption } : {},
          },
        },
      },
      {
        types: ['blockquote'],
        attributes: {
          callout: {
            default: null,
            parseHTML: (element) => {
              const callout = element.getAttribute('data-callout');
              return isCalloutType(callout) ? callout : null;
            },
            renderHTML: (attrs) =>
              isCalloutType(attrs.callout)
                ? { 'data-callout': attrs.callout }
                : {},
          },
        },
      },
      {
        types: identifiedTypes,
        attributes: {
          nodeId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-node-id'),
            renderHTML: (attributes) =>
              typeof attributes.nodeId === 'string'
                ? { 'data-node-id': attributes.nodeId }
                : {},
          },
        },
      },
      {
        types: ['tableHeader', 'tableCell'],
        attributes: {
          align: {
            default: null,
            parseHTML: (element) => {
              const alignment = element.style.textAlign;
              return alignment === 'left' ||
                alignment === 'center' ||
                alignment === 'right'
                ? alignment
                : null;
            },
            renderHTML: (attributes) =>
              attributes.align === 'left' ||
              attributes.align === 'center' ||
              attributes.align === 'right'
                ? { style: `text-align: ${attributes.align}` }
                : {},
          },
        },
      },
      {
        types: ['tableHeader', 'tableCell'],
        attributes: {
          borders: {
            default: null,
            parseHTML: (element) =>
              parseTableCellBorders(element.getAttribute('data-kumi-borders')),
            renderHTML: (attributes) => {
              if (!isTableCellBorders(attributes.borders)) return {};
              const style = tableCellBordersToCss(attributes.borders);
              return style
                ? {
                    'data-kumi-borders': JSON.stringify(attributes.borders),
                    style,
                  }
                : {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          const seen = new Set<string>();
          const transaction = newState.tr;
          newState.doc.descendants((node, position) => {
            if (!identifiedTypes.includes(node.type.name)) return;
            let attributes = node.attrs;
            if (
              (node.type.name === 'tableHeader' ||
                node.type.name === 'tableCell') &&
              Array.isArray(node.attrs.colwidth)
            ) {
              const originalWidths = node.attrs.colwidth as unknown[];
              const colspan = node.attrs.colspan as number;
              const count =
                Number.isInteger(colspan) && colspan >= 1 && colspan <= 100
                  ? colspan
                  : 1;
              const widths = Array.from({ length: count }, (_, index) => {
                const width = originalWidths[index];
                return typeof width === 'number' &&
                  Number.isFinite(width) &&
                  (width === 0 || width >= 20)
                  ? Math.min(width, maximumTableColumnWidth)
                  : 0;
              });
              if (
                originalWidths.length !== widths.length ||
                widths.some(
                  (width, index) => !Object.is(width, originalWidths[index]),
                )
              ) {
                attributes = { ...node.attrs, colwidth: widths };
              }
            }
            const current = node.attrs.nodeId;
            if (
              typeof current === 'string' &&
              current.trim().length > 0 &&
              !seen.has(current)
            ) {
              seen.add(current);
              if (attributes !== node.attrs) {
                transaction.setNodeMarkup(position, undefined, attributes);
              }
              return;
            }

            let next = createNodeId();
            while (seen.has(next)) next = createNodeId();
            seen.add(next);
            transaction.setNodeMarkup(position, undefined, {
              ...attributes,
              nodeId: next,
            });
          });
          return transaction.docChanged ? transaction : null;
        },
      }),
    ];
  },
});

function createFigureExtension(resolveImageUrl: (source: string) => string) {
  return Image.extend({
    name: 'figure',

    parseHTML() {
      return [
        {
          tag: 'img[src]:not([data-inline-image])',
          getAttrs: (element) => {
            const src =
              element instanceof HTMLElement
                ? element.getAttribute('src')
                : null;
            return src && safeResourceUrl(src, 'image') ? null : false;
          },
        },
      ];
    },

    addAttributes() {
      return {
        ...this.parent?.(),
        alt: {
          default: '',
          parseHTML: (element) => element.getAttribute('alt') ?? '',
        },
        nodeId: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-node-id'),
        },
        width: {
          default: 100,
          parseHTML: (element) => {
            const parsed = Number.parseFloat(
              element.getAttribute('data-width') ?? '100',
            );
            return Number.isFinite(parsed) ? parsed : 100;
          },
        },
        align: {
          default: 'center',
          parseHTML: (element) =>
            element.getAttribute('data-align') ?? 'center',
        },
        slidePlacement: {
          default: null,
          parseHTML: (element) =>
            parseSlideImagePlacement(
              element.getAttribute('data-slide-placement'),
            ) ?? null,
        },
      };
    },

    renderHTML({ HTMLAttributes }) {
      const {
        align,
        nodeId,
        slidePlacement,
        src,
        style: _discardedStyle,
        width,
        ...imageAttributes
      } = HTMLAttributes;
      const numericWidth =
        typeof width === 'number' ? width : Number.parseFloat(String(width));
      const safeWidth = Number.isFinite(numericWidth)
        ? Math.min(100, Math.max(10, numericWidth))
        : 100;
      const safeAlign =
        align === 'left' || align === 'right' || align === 'center'
          ? align
          : 'center';
      const resolvedSource = resolveSafeImageUrl(src, resolveImageUrl);
      const safePlacement = isSlideImagePlacement(slidePlacement)
        ? serializeSlideImagePlacement(slidePlacement)
        : undefined;

      return [
        'img',
        mergeAttributes(this.options.HTMLAttributes, imageAttributes, {
          src: resolvedSource,
          'data-node-id': typeof nodeId === 'string' ? nodeId : undefined,
          'data-width': safeWidth,
          'data-align': safeAlign,
          'data-slide-placement': safePlacement,
          class: 'kumi-figure',
          style: `display:block;width:${safeWidth}%;height:auto;margin-left:${
            safeAlign === 'right' || safeAlign === 'center' ? 'auto' : '0'
          };margin-right:${safeAlign === 'left' || safeAlign === 'center' ? 'auto' : '0'}`,
        }),
      ];
    },
  });
}

function createInlineImageExtension(
  resolveImageUrl: (source: string) => string,
) {
  return Image.extend({
    name: 'inlineImage',

    parseHTML() {
      return [
        {
          tag: 'img[data-inline-image][src]',
          getAttrs: (element) => {
            const src =
              element instanceof HTMLElement
                ? element.getAttribute('src')
                : null;
            return src && safeResourceUrl(src, 'image') ? null : false;
          },
        },
      ];
    },

    addAttributes() {
      return {
        ...this.parent?.(),
        alt: {
          default: '',
          parseHTML: (element) => element.getAttribute('alt') ?? '',
        },
      };
    },

    renderHTML({ HTMLAttributes }) {
      const { nodeId, src, ...imageAttributes } = HTMLAttributes;
      const resolvedSource = resolveSafeImageUrl(src, resolveImageUrl);
      return [
        'img',
        mergeAttributes(this.options.HTMLAttributes, imageAttributes, {
          src: resolvedSource,
          'data-inline-image': '',
          'data-node-id': typeof nodeId === 'string' ? nodeId : undefined,
          class: 'kumi-inline-image',
        }),
      ];
    },
  });
}

const Chart = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      chartType: { default: 'line' },
      data: {
        default: [
          { label: 'A', x: 1, y: 1 },
          { label: 'B', x: 2, y: 2 },
        ],
      },
      xLabel: { default: 'X' },
      yLabel: { default: 'Y' },
      series: { default: 'Series 1' },
      alt: { default: 'Chart' },
      width: { default: 100 },
      caption: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-kumi-chart]',
        getAttrs: (element) => {
          try {
            const raw = element.getAttribute('data-kumi-chart') ?? '';
            if (raw.length > 100_000) return false;
            const attrs: unknown = JSON.parse(raw);
            const chart = validateDocumentData({
              schemaVersion: 2,
              type: 'report',
              metadata: {},
              children: [{ type: 'chart', attrs }],
            }).children[0];
            return chart.type === 'chart' ? chart.attrs : false;
          } catch {
            return false;
          }
        },
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-kumi-chart': JSON.stringify(node.attrs),
        class: 'kumi-chart',
        contenteditable: 'false',
      }),
      `Chart: ${node.attrs.series} (${node.attrs.data.length} points)`,
    ];
  },
});

export function createEditorExtensions({
  onMathSelect,
  resolveImageUrl = (source) => source,
}: EditorExtensionsOptions): Extensions {
  const InlineImage = createInlineImageExtension(resolveImageUrl);
  const Figure = createFigureExtension(resolveImageUrl);

  return [
    Node.create({
      name: 'doc',
      topNode: true,
      content: '(block | documentBreak | speakerNotes)+',
    }),
    Node.create({
      name: 'footnote',
      group: 'inline',
      inline: true,
      atom: true,
      marks: '',
      addAttributes: () => ({
        text: {
          default: '',
          parseHTML: (element) =>
            normalizeFootnoteText(element.getAttribute('data-footnote') ?? ''),
        },
      }),
      parseHTML: () => [
        {
          tag: 'sup[data-footnote]',
          getAttrs: (element) =>
            element.getAttribute('data-footnote')?.trim() ? null : false,
        },
      ],
      // The number is a CSS counter, so it follows edits without a transaction.
      renderHTML: ({ node }) => [
        'sup',
        {
          'data-footnote': node.attrs.text,
          class: 'kumi-footnote',
          title: node.attrs.text,
          contenteditable: 'false',
        },
      ],
      renderText: ({ node }) => `^[${node.attrs.text}]`,
    }),
    Node.create({
      name: 'speakerNotes',
      group: 'speakerNotes',
      content: 'paragraph+',
      defining: true,
      parseHTML: () => [{ tag: 'aside[data-speaker-notes]' }],
      renderHTML: ({ HTMLAttributes }) => [
        'aside',
        mergeAttributes(HTMLAttributes, {
          'data-speaker-notes': '',
          class: 'kumi-speaker-notes',
        }),
        0,
      ],
    }),
    Node.create({
      name: 'reference',
      group: 'inline',
      inline: true,
      atom: true,
      marks: '',
      addAttributes: () => ({
        target: {
          default: '',
          parseHTML: (element) => element.getAttribute('data-reference') ?? '',
        },
      }),
      parseHTML: () => [{ tag: 'span[data-reference]' }],
      renderHTML: ({ node }) => [
        'span',
        {
          'data-reference': node.attrs.target,
          class: 'kumi-reference',
          contenteditable: 'false',
        },
        `[@${node.attrs.target}]`,
      ],
      renderText: ({ node }) => `[@${node.attrs.target}]`,
    }),
    ...(['pageBreak', 'slideBreak'] as const).map((type) =>
      Node.create({
        name: type,
        group: 'documentBreak',
        atom: true,
        parseHTML: () => [{ tag: `div[data-document-break="${type}"]` }],
        renderHTML: ({ HTMLAttributes }) => [
          'div',
          mergeAttributes(HTMLAttributes, {
            'data-document-break': type,
            class: 'kumi-document-break',
            contenteditable: 'false',
          }),
          type === 'pageBreak' ? '改ページ' : '次のスライド',
        ],
      }),
    ),
    StarterKit.configure({
      document: false,
      // Notes close a slide, so they need no empty paragraph after them.
      trailingNode: { notAfter: ['speakerNotes'] },
      link: {
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
        HTMLAttributes: {
          rel: 'noopener noreferrer nofollow',
          target: '_blank',
        },
      },
    }),
    DocumentAttributes,
    InlineImage.configure({
      inline: true,
      allowBase64: true,
      HTMLAttributes: {
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      },
    }),
    Figure.configure({
      allowBase64: true,
      HTMLAttributes: {
        loading: 'lazy',
        referrerpolicy: 'no-referrer',
      },
    }),
    Chart,
    TableKit.configure({
      table: {
        resizable: true,
        cellMinWidth: 80,
        View: UndoSafeTableView,
      },
      tableCell: {},
      tableHeader: {},
      tableRow: {},
    }),
    Mathematics.configure({
      inlineOptions: {
        onClick: (node, position) =>
          onMathSelect({
            type: 'inlineMath',
            position,
            latex: String(node.attrs.latex ?? ''),
          }),
      },
      blockOptions: {
        onClick: (node, position) =>
          onMathSelect({
            type: 'blockMath',
            nodeId: node.attrs.nodeId,
            position,
            latex: String(node.attrs.latex ?? ''),
          }),
      },
      katexOptions: {
        throwOnError: false,
        trust: false,
        strict: 'warn',
      },
    }),
  ];
}
