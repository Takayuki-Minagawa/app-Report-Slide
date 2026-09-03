import type {
  BlockMathNode,
  BlockquoteNode,
  BulletListNode,
  CodeBlockNode,
  DocumentData,
  DocumentNode,
  FigureNode,
  HeadingNode,
  HorizontalRuleNode,
  IdFactory,
  InlineNode,
  ListItemNode,
  Mark,
  OrderedListNode,
  ParagraphNode,
  TableCellNode,
  TableHeaderNode,
  TableNode,
  TableRowNode,
} from '@/src/document/model';
import { createNodeId } from '@/src/document/model';
import {
  DocumentValidationError,
  validateDocumentData,
} from '@/src/document/validation';
import { isSafeResourceUrl } from '@/src/security/resource-url';

import { createMarkdownIt } from './dialect';
import { MarkdownImportError, type MarkdownDiagnostic } from './diagnostics';
import { parseFrontMatter } from './frontmatter';
import { parseBlockAttributes } from './attributes';
import { inlineImageMarker, emptyParagraphMarker } from './syntax';

type MarkdownToken = ReturnType<
  ReturnType<typeof createMarkdownIt>['parse']
>[number];

interface ParseCursor {
  tokens: MarkdownToken[];
  index: number;
  idFactory: IdFactory;
  diagnostics: MarkdownDiagnostic[];
  lineOffset: number;
}

export interface ParseMarkdownOptions {
  fallbackType?: 'report' | 'slide';
  idFactory?: IdFactory;
}

export interface ParseMarkdownResult {
  document: DocumentData;
  diagnostics: MarkdownDiagnostic[];
}

function cloneMarks(marks: Mark[]): Mark[] | undefined {
  if (marks.length === 0) return undefined;
  return marks.map((mark) => ({
    ...mark,
    attrs: mark.attrs ? { ...mark.attrs } : undefined,
  }));
}

function markSignature(marks: Mark[] | undefined): string {
  return JSON.stringify(marks ?? []);
}

function pushText(nodes: InlineNode[], text: string, marks: Mark[] = []): void {
  if (!text) return;
  const normalizedMarks = cloneMarks(marks);
  const previous = nodes.at(-1);
  if (
    previous?.type === 'text' &&
    markSignature(previous.marks) === markSignature(normalizedMarks)
  ) {
    previous.text += text;
    return;
  }
  nodes.push({ type: 'text', text, marks: normalizedMarks });
}

function inlineTokens(token: MarkdownToken): MarkdownToken[] {
  return token.children ?? [];
}

function standaloneFigure(
  token: MarkdownToken,
  cursor: ParseCursor,
): FigureNode | undefined {
  const rawChildren = inlineTokens(token);
  if (
    rawChildren.length === 2 &&
    rawChildren[0].type === 'image' &&
    rawChildren[1].type === 'text' &&
    rawChildren[1].content === inlineImageMarker
  ) {
    return undefined;
  }
  const children = inlineTokens(token).filter(
    (child) => child.type !== 'text' || child.content.trim().length > 0,
  );
  if (children.length !== 1 || children[0].type !== 'image') return undefined;

  const image = children[0];
  const src = image.attrGet('src') ?? '';
  if (!isSafeResourceUrl(src, 'image')) {
    cursor.diagnostics.push({
      severity: 'error',
      code: 'markdown.image-url-unsafe',
      message: `安全でない画像URLを拒否しました: ${src || '(empty)'}`,
      line: image.map?.[0] !== undefined ? image.map[0] + 1 : undefined,
    });
  }

  return {
    type: 'figure',
    attrs: {
      nodeId: cursor.idFactory(),
      src: isSafeResourceUrl(src, 'image') ? src : '',
      alt: image.content || image.attrGet('alt') || '',
      title: image.attrGet('title'),
      width: 100,
      align: 'center',
    },
  };
}

function parseInline(token: MarkdownToken, cursor: ParseCursor): InlineNode[] {
  const nodes: InlineNode[] = [];
  const marks: Mark[] = [];
  const children = inlineTokens(token);
  const hasInlineImageMarker =
    token.content.endsWith(inlineImageMarker) &&
    children.length === 2 &&
    children[0].type === 'image' &&
    children[1].type === 'text' &&
    children[1].content === inlineImageMarker;
  const hasEmptyParagraphMarker =
    token.content === emptyParagraphMarker &&
    children.length === 1 &&
    children[0].type === 'text' &&
    children[0].content === emptyParagraphMarker;

  for (const [index, child] of children.entries()) {
    switch (child.type) {
      case 'kumi_reference':
        nodes.push({ type: 'reference', attrs: { target: child.content } });
        break;
      case 'text':
        if (hasEmptyParagraphMarker) break;
        if (hasInlineImageMarker && index === 1) break;
        pushText(nodes, child.content, marks);
        break;
      case 'code_inline':
        pushText(nodes, child.content, [...marks, { type: 'code' }]);
        break;
      case 'softbreak':
        pushText(nodes, ' ', marks);
        break;
      case 'hardbreak':
        nodes.push({ type: 'hardBreak' });
        break;
      case 'math_inline':
        nodes.push({
          type: 'inlineMath',
          attrs: { latex: child.content },
        });
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 'link_open': {
        const href = child.attrGet('href') ?? '';
        if (isSafeResourceUrl(href, 'link')) {
          marks.push({
            type: 'link',
            attrs: {
              href,
              target: '_blank',
              rel: 'noopener noreferrer nofollow',
            },
          });
        } else {
          cursor.diagnostics.push({
            severity: 'error',
            code: 'markdown.link-url-unsafe',
            message: `安全でないリンクURLを拒否しました: ${href || '(empty)'}`,
          });
        }
        break;
      }
      case 'strong_close':
        removeLastMark(marks, 'bold');
        break;
      case 'em_close':
        removeLastMark(marks, 'italic');
        break;
      case 's_close':
        removeLastMark(marks, 'strike');
        break;
      case 'link_close':
        removeLastMark(marks, 'link');
        break;
      case 'image':
        {
          const src = child.attrGet('src') ?? '';
          if (!isSafeResourceUrl(src, 'image')) {
            cursor.diagnostics.push({
              severity: 'error',
              code: 'markdown.image-url-unsafe',
              message: `安全でない画像URLを拒否しました: ${src || '(empty)'}`,
            });
            break;
          }
          nodes.push({
            type: 'inlineImage',
            attrs: {
              nodeId: cursor.idFactory(),
              src,
              alt: child.content || child.attrGet('alt') || '',
              title: child.attrGet('title'),
            },
          });
        }
        break;
      default:
        if (child.content) pushText(nodes, child.content, marks);
    }
  }

  return nodes;
}

function removeLastMark(marks: Mark[], type: Mark['type']): void {
  const index = marks.findLastIndex((mark) => mark.type === type);
  if (index >= 0) marks.splice(index, 1);
}

function parseTable(cursor: ParseCursor): TableNode {
  cursor.index += 1;
  const rows: TableRowNode[] = [];
  let inHeader = false;

  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    if (token.type === 'table_close') {
      cursor.index += 1;
      break;
    }
    if (token.type === 'thead_open') {
      inHeader = true;
      cursor.index += 1;
      continue;
    }
    if (token.type === 'thead_close') {
      inHeader = false;
      cursor.index += 1;
      continue;
    }
    if (token.type !== 'tr_open') {
      cursor.index += 1;
      continue;
    }

    cursor.index += 1;
    const cells: Array<TableHeaderNode | TableCellNode> = [];
    while (
      cursor.index < cursor.tokens.length &&
      cursor.tokens[cursor.index].type !== 'tr_close'
    ) {
      const cellOpen = cursor.tokens[cursor.index];
      if (cellOpen.type !== 'th_open' && cellOpen.type !== 'td_open') {
        cursor.index += 1;
        continue;
      }
      cursor.index += 1;
      const contentToken = cursor.tokens[cursor.index];
      const content =
        contentToken?.type === 'inline'
          ? parseInline(contentToken, cursor)
          : [];
      if (contentToken?.type === 'inline') cursor.index += 1;

      const closeType = cellOpen.type === 'th_open' ? 'th_close' : 'td_close';
      if (cursor.tokens[cursor.index]?.type === closeType) cursor.index += 1;

      const style = cellOpen.attrGet('style') ?? '';
      const alignment = /text-align:\s*(left|center|right)/i.exec(
        style,
      )?.[1] as 'left' | 'center' | 'right' | undefined;
      const paragraph: ParagraphNode = {
        type: 'paragraph',
        attrs: { nodeId: cursor.idFactory() },
        content,
      };
      const cell = {
        type:
          inHeader || cellOpen.type === 'th_open' ? 'tableHeader' : 'tableCell',
        attrs: {
          nodeId: cursor.idFactory(),
          align: alignment ?? null,
        },
        content: [paragraph],
      } satisfies TableHeaderNode | TableCellNode;
      cells.push(cell);
    }

    if (cursor.tokens[cursor.index]?.type === 'tr_close') cursor.index += 1;
    rows.push({
      type: 'tableRow',
      attrs: { nodeId: cursor.idFactory() },
      content: cells,
    });
  }

  return {
    type: 'table',
    attrs: { nodeId: cursor.idFactory() },
    content: rows,
  };
}

function parseAdvancedTable(
  token: MarkdownToken,
  cursor: ParseCursor,
): TableNode | undefined {
  try {
    const parsed: unknown = JSON.parse(token.content);
    assignAdvancedTableNodeIds(parsed, cursor.idFactory);
    const document = validateDocumentData({
      schemaVersion: 2,
      type: 'report',
      metadata: {},
      children: [parsed],
    });
    const table = document.children[0];
    if (!table || table.type !== 'table') {
      throw new Error('表nodeだけを指定してください');
    }
    return table;
  } catch (error) {
    const detail =
      error instanceof DocumentValidationError
        ? error.issues[0]
        : error instanceof Error
          ? error.message
          : 'JSONが不正です';
    cursor.diagnostics.push({
      severity: 'error',
      code: 'markdown.advanced-table-invalid',
      message: 'KUMI表ブロックを読み込めません: ' + detail,
      line: (token.map?.[0] ?? 0) + 1 + cursor.lineOffset,
    });
    return undefined;
  }
}

const advancedTableIdentifiedTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'inlineImage',
  'figure',
  'blockMath',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Node IDs are editor-local, so restore fresh IDs rather than trusting Markdown. */
function assignAdvancedTableNodeIds(
  value: unknown,
  idFactory: IdFactory,
): void {
  if (!isRecord(value)) return;
  if (
    typeof value.type === 'string' &&
    advancedTableIdentifiedTypes.has(value.type) &&
    isRecord(value.attrs)
  ) {
    value.attrs.nodeId = idFactory();
  }
  if (Array.isArray(value.content)) {
    value.content.forEach((child) =>
      assignAdvancedTableNodeIds(child, idFactory),
    );
  }
}

function parseList(
  cursor: ParseCursor,
  ordered: boolean,
): BulletListNode | OrderedListNode {
  const open = cursor.tokens[cursor.index];
  cursor.index += 1;
  const items: ListItemNode[] = [];
  const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close';

  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    if (token.type === closeType) {
      cursor.index += 1;
      break;
    }
    if (token.type !== 'list_item_open') {
      cursor.index += 1;
      continue;
    }

    cursor.index += 1;
    const content = parseBlocks(cursor, new Set(['list_item_close']));
    if (cursor.tokens[cursor.index]?.type === 'list_item_close')
      cursor.index += 1;
    items.push({
      type: 'listItem',
      attrs: { nodeId: cursor.idFactory() },
      content:
        content.length > 0
          ? content
          : [{ type: 'paragraph', attrs: { nodeId: cursor.idFactory() } }],
    });
  }

  if (ordered) {
    const start = Number.parseInt(open.attrGet('start') ?? '1', 10);
    return {
      type: 'orderedList',
      attrs: {
        nodeId: cursor.idFactory(),
        start: Number.isFinite(start) ? start : 1,
      },
      content: items,
    };
  }
  return {
    type: 'bulletList',
    attrs: { nodeId: cursor.idFactory() },
    content: items,
  };
}

function parseBlocks(
  cursor: ParseCursor,
  stopTypes: ReadonlySet<string> = new Set(),
): DocumentNode[] {
  const nodes: DocumentNode[] = [];

  while (cursor.index < cursor.tokens.length) {
    const token = cursor.tokens[cursor.index];
    if (stopTypes.has(token.type)) break;

    switch (token.type) {
      case 'kumi_attributes': {
        try {
          if (cursor.tokens[cursor.index - 1]?.type === 'kumi_attributes')
            throw new Error('属性行は1つにまとめてください');
          const previous = nodes.at(-1);
          const attrs = parseBlockAttributes(token.content, previous);
          Object.assign(previous!.attrs, attrs);
        } catch (error) {
          cursor.diagnostics.push({
            severity: 'error',
            code: 'markdown.attributes-invalid',
            message:
              error instanceof Error ? error.message : '属性行が不正です',
            line: (token.map?.[0] ?? 0) + 1 + cursor.lineOffset,
          });
        }
        cursor.index++;
        break;
      }
      case 'kumi_break':
      case 'kumi_invalid_break':
        if (stopTypes.size || token.type === 'kumi_invalid_break') {
          cursor.diagnostics.push({
            severity: 'error',
            code: 'markdown.break-invalid',
            message:
              '区切りは文書直下に ::: pagebreak または ::: slidebreak と、次行の ::: で指定してください',
            line: (token.map?.[0] ?? 0) + 1 + cursor.lineOffset,
          });
        } else
          nodes.push({
            type: token.content === 'pagebreak' ? 'pageBreak' : 'slideBreak',
            attrs: { nodeId: cursor.idFactory() },
          });
        cursor.index++;
        break;
      case 'kumi_advanced_table': {
        const table = parseAdvancedTable(token, cursor);
        if (table) nodes.push(table);
        cursor.index++;
        break;
      }
      case 'kumi_invalid_advanced_table':
        cursor.diagnostics.push({
          severity: 'error',
          code: 'markdown.advanced-table-invalid',
          message:
            'KUMI表ブロックは ::: kumi-table と終了行の ::: で囲んでください',
          line: (token.map?.[0] ?? 0) + 1 + cursor.lineOffset,
        });
        cursor.index++;
        break;
      case 'heading_open': {
        const level = Number.parseInt(
          token.tag.slice(1),
          10,
        ) as HeadingNode['attrs']['level'];
        cursor.index += 1;
        const inline = cursor.tokens[cursor.index];
        const heading: HeadingNode = {
          type: 'heading',
          attrs: { nodeId: cursor.idFactory(), level },
          content: inline?.type === 'inline' ? parseInline(inline, cursor) : [],
        };
        if (inline?.type === 'inline') cursor.index += 1;
        if (cursor.tokens[cursor.index]?.type === 'heading_close')
          cursor.index += 1;
        nodes.push(heading);
        break;
      }
      case 'paragraph_open': {
        cursor.index += 1;
        const inline = cursor.tokens[cursor.index];
        if (inline?.type === 'inline') {
          const figure = standaloneFigure(inline, cursor);
          if (figure) {
            nodes.push(figure);
          } else {
            nodes.push({
              type: 'paragraph',
              attrs: { nodeId: cursor.idFactory() },
              content: parseInline(inline, cursor),
            });
          }
          cursor.index += 1;
        } else {
          nodes.push({
            type: 'paragraph',
            attrs: { nodeId: cursor.idFactory() },
          });
        }
        if (cursor.tokens[cursor.index]?.type === 'paragraph_close')
          cursor.index += 1;
        break;
      }
      case 'bullet_list_open':
        nodes.push(parseList(cursor, false));
        break;
      case 'ordered_list_open':
        nodes.push(parseList(cursor, true));
        break;
      case 'blockquote_open': {
        cursor.index += 1;
        const content = parseBlocks(cursor, new Set(['blockquote_close']));
        if (cursor.tokens[cursor.index]?.type === 'blockquote_close')
          cursor.index += 1;
        const blockquote: BlockquoteNode = {
          type: 'blockquote',
          attrs: { nodeId: cursor.idFactory() },
          content,
        };
        nodes.push(blockquote);
        break;
      }
      case 'fence':
      case 'code_block': {
        const code: CodeBlockNode = {
          type: 'codeBlock',
          attrs: {
            nodeId: cursor.idFactory(),
            language: token.info.trim().split(/\s+/, 1)[0] || null,
          },
          content: token.content
            ? [{ type: 'text', text: token.content.replace(/\n$/, '') }]
            : undefined,
        };
        nodes.push(code);
        cursor.index += 1;
        break;
      }
      case 'math_block': {
        const equation: BlockMathNode = {
          type: 'blockMath',
          attrs: {
            nodeId: cursor.idFactory(),
            latex: token.content,
          },
        };
        nodes.push(equation);
        cursor.index += 1;
        break;
      }
      case 'hr': {
        const rule: HorizontalRuleNode = {
          type: 'horizontalRule',
          attrs: { nodeId: cursor.idFactory() },
        };
        nodes.push(rule);
        cursor.index += 1;
        break;
      }
      case 'table_open':
        nodes.push(parseTable(cursor));
        break;
      case 'inline':
        nodes.push({
          type: 'paragraph',
          attrs: { nodeId: cursor.idFactory() },
          content: parseInline(token, cursor),
        });
        cursor.index += 1;
        break;
      default:
        if (token.type.endsWith('_close')) return nodes;
        cursor.diagnostics.push({
          severity: 'warning',
          code: 'markdown.token-ignored',
          message: `未対応のMarkdown要素を読み飛ばしました: ${token.type}`,
          line: token.map?.[0] !== undefined ? token.map[0] + 1 : undefined,
        });
        cursor.index += 1;
    }
  }

  return nodes;
}

export function parseMarkdown(
  source: string,
  options: ParseMarkdownOptions = {},
): ParseMarkdownResult {
  const idFactory = options.idFactory ?? createNodeId;
  const frontMatter = parseFrontMatter(
    source,
    options.fallbackType ?? 'report',
  );
  const markdown = createMarkdownIt();
  const diagnostics = [...frontMatter.diagnostics];
  const cursor: ParseCursor = {
    tokens: markdown.parse(frontMatter.body, {}),
    index: 0,
    idFactory,
    diagnostics,
    lineOffset:
      source.replace(/\r\n?/g, '\n').split('\n').length -
      frontMatter.body.split('\n').length,
  };
  const children = parseBlocks(cursor);

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new MarkdownImportError(
      'Markdownを安全に読み込めませんでした',
      diagnostics,
    );
  }

  if (children.length === 0) {
    children.push({
      type: 'paragraph',
      attrs: { nodeId: idFactory() },
    });
  }

  return {
    document: validateDocumentData({
      schemaVersion: 2,
      type: frontMatter.type,
      metadata: {
        theme:
          frontMatter.metadata.theme ??
          (frontMatter.type === 'report' ? 'latex' : 'beamer-simple'),
        ...frontMatter.metadata,
      },
      children,
    }),
    diagnostics,
  };
}
