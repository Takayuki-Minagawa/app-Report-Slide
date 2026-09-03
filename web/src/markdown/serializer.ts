import { stringify } from 'yaml';
import { serializeBlockAttributes } from './attributes';

import type {
  DocumentData,
  DocumentNode,
  InlineNode,
  ListItemNode,
  Mark,
  TableCellNode,
  TableHeaderNode,
  TableNode,
} from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';
import { isSafeResourceUrl } from '@/src/security/resource-url';

import {
  canonicalHardBreakMarker,
  inlineImageMarker,
  emptyParagraphMarker,
  isEscaped,
} from './syntax';

export class MarkdownSerializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MarkdownSerializationError';
    this.code = code;
  }
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]$~{}():])/g, '\\$1');
}

function serializeInlineMath(latex: string): string {
  for (let index = 0; index < latex.length; index += 1) {
    if (latex[index] === '$' && !isEscaped(latex, index)) {
      throw new MarkdownSerializationError(
        'markdown.inline-math-delimiter',
        'インライン数式内の$は\\$としてエスケープしてください',
      );
    }
  }
  return `$${latex}$`;
}

function codeFence(code: string): string {
  const longestClosingRun = code.split('\n').reduce((longest, line) => {
    const run = /^ {0,3}(~+)\s*$/.exec(line)?.[1].length ?? 0;
    return Math.max(longest, run);
  }, 0);
  return '~'.repeat(Math.max(3, longestClosingRun + 1));
}

function escapeLinkTarget(value: string): string {
  return value
    .replace(/\s/g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function serializeCodeSpan(value: string): string {
  const backtickRuns = value.match(/`+/g) ?? [];
  const fence = '`'.repeat(
    Math.max(1, ...backtickRuns.map((run) => run.length + 1)),
  );
  const needsPadding =
    value.startsWith('`') ||
    value.endsWith('`') ||
    /^\s/.test(value) ||
    /\s$/.test(value);
  return `${fence}${needsPadding ? ` ${value} ` : value}${fence}`;
}

function wrapMark(value: string, mark: Mark): string {
  switch (mark.type) {
    case 'bold':
      return `**${value}**`;
    case 'italic':
      return `*${value}*`;
    case 'strike':
      return `~~${value}~~`;
    case 'code':
      return serializeCodeSpan(value);
    case 'link':
      return mark.attrs?.href && isSafeResourceUrl(mark.attrs.href, 'link')
        ? `[${value}](${escapeLinkTarget(mark.attrs.href)})`
        : value;
  }
}

function serializeText(value: string, marks: Mark[] | undefined): string {
  if (!marks || marks.length === 0) return escapeText(value);

  const codeMark = marks.some((mark) => mark.type === 'code');
  let serialized = codeMark ? serializeCodeSpan(value) : escapeText(value);
  for (const mark of marks) {
    if (mark.type !== 'code') serialized = wrapMark(serialized, mark);
  }
  return serialized;
}

function serializeImage(
  src: string,
  alt: string,
  title: string | null,
): string {
  if (!isSafeResourceUrl(src, 'image')) {
    throw new MarkdownSerializationError(
      'markdown.image-url-unsafe',
      `安全でない画像URLは保存できません: ${src || '(empty)'}`,
    );
  }
  const escapedAlt = alt.replace(/([\]\\])/g, '\\$1');
  const serializedTitle = title
    ? ` "${title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : '';
  return `![${escapedAlt}](${escapeLinkTarget(src)}${serializedTitle})`;
}

function serializeInline(nodes: InlineNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case 'reference':
          return `[@${node.attrs.target}]`;
        case 'text':
          return serializeText(node.text, node.marks);
        case 'inlineMath':
          return serializeInlineMath(node.attrs.latex);
        case 'inlineImage':
          return serializeImage(
            node.attrs.src,
            node.attrs.alt,
            node.attrs.title,
          );
        case 'hardBreak':
          return canonicalHardBreakMarker;
      }
    })
    .join('');
}

function protectParagraphLine(line: string): string {
  if (/^(?: {4,}|\t)/.test(line)) {
    return line.startsWith('\t')
      ? `&#9;${line.slice(1)}`
      : `&#32;${line.slice(1)}`;
  }

  if (/^\s*:::\s+(?:pagebreak|slidebreak)\s*$/.test(line))
    return line.replace(':', '\\:');

  const match = /^( {0,3})(.*)$/.exec(line);
  if (!match) return line;
  const [, indentation, body] = match;

  if (/^#{1,6}(?:\s|$)/.test(body)) {
    return `${indentation}\\${body}`;
  }
  if (body.startsWith('>') || /^(?:[-+*])(?:\s|$)/.test(body)) {
    return `${indentation}\\${body}`;
  }
  if (/^\d+[.)](?:\s|$)/.test(body)) {
    return `${indentation}${body.replace(/^(\d+)([.)])/, '$1\\$2')}`;
  }
  if (/^~{3,}/.test(body)) {
    return `${indentation}\\${body}`;
  }
  if (/^(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,}|=+\s*)$/.test(body)) {
    return `${indentation}\\${body}`;
  }
  if (body.startsWith('|')) {
    return `${indentation}\\${body}`;
  }
  if (/^(?::?-{1,}:?)(?:\s*\|\s*:?-{1,}:?)+\s*\|?\s*$/.test(body)) {
    return `${indentation}\\${body}`;
  }
  return line;
}

function protectParagraph(value: string): string {
  return value.split('\n').map(protectParagraphLine).join('\n');
}

function serializeListItem(item: ListItemNode, prefix: string): string {
  const content = serializeBlocks(item.content);
  const lines = content.split('\n');
  const continuation = ' '.repeat(prefix.length + 1);
  return lines
    .map((line, index) =>
      index === 0 ? `${prefix} ${line}` : `${continuation}${line}`,
    )
    .join('\n');
}

function tableCellText(cell: TableCellNode | TableHeaderNode): string {
  if (cell.content.length !== 1) {
    throw new MarkdownSerializationError(
      'markdown.table-multiple-blocks',
      'Markdown表の各セルは1つの段落だけを含められます',
    );
  }
  const serialized = serializeInline(cell.content[0].content);
  if (serialized.includes('\n')) {
    throw new MarkdownSerializationError(
      'markdown.table-hard-break',
      'Markdown表のセル内では改行を保存できません',
    );
  }
  return serialized.replace(/\|/g, '\\|').trim();
}

function tableAlignment(cell: TableHeaderNode): string {
  switch (cell.attrs.align) {
    case 'center':
      return ':---:';
    case 'right':
      return '---:';
    case 'left':
      return ':---';
    default:
      return '---';
  }
}

function serializeTable(table: TableNode): string {
  const firstRow = table.content[0];
  if (!firstRow || firstRow.content.length === 0) {
    throw new MarkdownSerializationError(
      'markdown.table-empty',
      '空の表はMarkdownとして保存できません',
    );
  }
  if (firstRow.content.some((cell) => cell.type !== 'tableHeader')) {
    throw new MarkdownSerializationError(
      'markdown.table-header-required',
      'Markdown表の先頭行にはヘッダーセルが必要です',
    );
  }

  const columnCount = firstRow.content.length;
  for (const [rowIndex, row] of table.content.entries()) {
    if (row.content.length !== columnCount) {
      throw new MarkdownSerializationError(
        'markdown.table-column-mismatch',
        `Markdown表の${rowIndex + 1}行目の列数が一致しません`,
      );
    }
    if (rowIndex > 0 && row.content.some((cell) => cell.type !== 'tableCell')) {
      throw new MarkdownSerializationError(
        'markdown.table-body-cell-required',
        'Markdown表の2行目以降には通常セルが必要です',
      );
    }
  }

  const headers = firstRow.content.map((cell) =>
    tableCellText(cell as TableHeaderNode),
  );
  const alignments = firstRow.content.map((cell) =>
    tableAlignment(cell as TableHeaderNode),
  );
  const rows = table.content
    .slice(1)
    .map((row) =>
      row.content.map((cell) => tableCellText(cell as TableCellNode)),
    );

  return [
    `| ${headers.join(' | ')} |`,
    `| ${alignments.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function serializeNode(node: DocumentNode): string {
  switch (node.type) {
    case 'heading':
      return `${'#'.repeat(node.attrs.level)} ${serializeInline(node.content)}`;
    case 'paragraph': {
      const inline = serializeInline(node.content);
      if (inline.length === 0) return emptyParagraphMarker;
      return protectParagraph(
        `${inline}${
          node.content?.length === 1 && node.content[0].type === 'inlineImage'
            ? inlineImageMarker
            : ''
        }`,
      );
    }
    case 'bulletList':
      return node.content
        .map((item) => serializeListItem(item, '-'))
        .join('\n');
    case 'orderedList':
      return node.content
        .map((item, index) =>
          serializeListItem(item, `${node.attrs.start + index}.`),
        )
        .join('\n');
    case 'listItem':
      return serializeBlocks(node.content);
    case 'blockquote':
      return serializeBlocks(node.content)
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'codeBlock': {
      const language = node.attrs.language ?? '';
      const code = node.content?.map((text) => text.text).join('') ?? '';
      const fence = codeFence(code);
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'figure':
      return serializeImage(node.attrs.src, node.attrs.alt, node.attrs.title);
    case 'blockMath':
      if (
        node.attrs.latex.split(/\r?\n/).some((line) => line.trim() === '$$')
      ) {
        throw new MarkdownSerializationError(
          'markdown.block-math-delimiter',
          'ブロック数式内に単独行の$$は保存できません',
        );
      }
      return `$$\n${node.attrs.latex}\n$$`;
    case 'pageBreak':
      return '::: pagebreak\n:::';
    case 'slideBreak':
      return '::: slidebreak\n:::';
    case 'horizontalRule':
      return '---';
    case 'table':
      return serializeTable(node);
    case 'tableRow':
      return node.content.map((cell) => tableCellText(cell)).join(' | ');
    case 'tableHeader':
    case 'tableCell':
      return tableCellText(node);
  }
}

function serializeBlocks(nodes: DocumentNode[]): string {
  return nodes
    .map((node) => serializeNode(node) + serializeBlockAttributes(node))
    .join('\n\n');
}

export function serializeDocument(document: DocumentData): string {
  validateDocumentData(document);
  const metadata = Object.fromEntries(
    Object.entries(document.metadata).filter(
      ([key, value]) => key !== 'type' && value !== undefined,
    ),
  );
  const frontMatter = stringify(
    {
      ...metadata,
      type: document.type,
    },
    {
      lineWidth: 0,
    },
  ).trimEnd();
  const body = serializeBlocks(document.children);

  return `---\n${frontMatter}\n---\n${body ? `\n${body}\n` : ''}`;
}

export { serializeBlocks };
