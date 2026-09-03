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

import { createNodeId } from '@/src/document/model';
import {
  safeResourceUrl,
  resolveSafeImageUrl,
} from '@/src/security/resource-url';

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
  'inlineImage',
  'figure',
  'blockMath',
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
            const current = node.attrs.nodeId;
            if (
              typeof current === 'string' &&
              current.trim().length > 0 &&
              !seen.has(current)
            ) {
              seen.add(current);
              return;
            }

            let next = createNodeId();
            while (seen.has(next)) next = createNodeId();
            seen.add(next);
            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
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
      };
    },

    renderHTML({ HTMLAttributes }) {
      const {
        align,
        nodeId,
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

      return [
        'img',
        mergeAttributes(this.options.HTMLAttributes, imageAttributes, {
          src: resolvedSource,
          'data-node-id': typeof nodeId === 'string' ? nodeId : undefined,
          'data-width': safeWidth,
          'data-align': safeAlign,
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
      content: '(block | documentBreak)+',
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
    TableKit.configure({
      table: {
        resizable: false,
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
