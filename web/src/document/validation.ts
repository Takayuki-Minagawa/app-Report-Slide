import { z } from 'zod';

import { isSafeResourceUrl } from '@/src/security/resource-url';

import type { DocumentData } from './model';

const documentEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    type: z.enum(['report', 'slide']),
    metadata: z.record(z.string(), z.unknown()),
    children: z.array(z.unknown()),
  })
  .strict();

const stringMetadataKeys = new Set([
  'title',
  'subtitle',
  'author',
  'date',
  'paper',
  'orientation',
  'theme',
  'aspect_ratio',
]);
const booleanMetadataKeys = new Set(['toc', 'number_sections', 'slide_number']);
const blockTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'figure',
  'blockMath',
  'horizontalRule',
  'table',
]);
const markTypes = new Set(['bold', 'italic', 'strike', 'code', 'link']);

type RecordValue = Record<string, unknown>;
type NodeParent =
  | 'root'
  | 'list'
  | 'listItem'
  | 'blockquote'
  | 'table'
  | 'tableRow'
  | 'tableCell';

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertJsonValue(
  value: unknown,
  path: string,
  issues: string[],
  ancestors: Set<object>,
): void {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== 'object' || value === null) {
    issues.push(`${path}: JSON互換の値が必要です`);
    return;
  }
  if (ancestors.has(value)) {
    issues.push(`${path}: 循環参照は使用できません`);
    return;
  }

  const nextAncestors = new Set(ancestors).add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertJsonValue(entry, `${path}.${index}`, issues, nextAncestors),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      issues.push(`${path}.${key}: 使用できないキーです`);
      continue;
    }
    assertJsonValue(entry, `${path}.${key}`, issues, nextAncestors);
  }
}

function expectRecord(
  value: unknown,
  path: string,
  issues: string[],
): RecordValue | undefined {
  if (!isRecord(value)) {
    issues.push(`${path}: オブジェクトが必要です`);
    return undefined;
  }
  return value;
}

function expectString(
  value: unknown,
  path: string,
  issues: string[],
  options: { nullable?: boolean; nonEmpty?: boolean } = {},
): void {
  if (options.nullable && value === null) return;
  if (
    typeof value !== 'string' ||
    (options.nonEmpty === true && value.trim().length === 0)
  ) {
    issues.push(
      `${path}: ${options.nullable ? '文字列またはnull' : '文字列'}が必要です`,
    );
  }
}

function validateAttrs(
  node: RecordValue,
  path: string,
  issues: string[],
): RecordValue | undefined {
  return expectRecord(node.attrs, `${path}.attrs`, issues);
}

function validateNodeId(
  attrs: RecordValue | undefined,
  path: string,
  issues: string[],
  nodeIds: Set<string>,
): void {
  if (!attrs) return;
  const nodeId = attrs.nodeId;
  expectString(nodeId, `${path}.attrs.nodeId`, issues, { nonEmpty: true });
  if (typeof nodeId !== 'string' || nodeId.trim().length === 0) return;
  if (nodeIds.has(nodeId)) {
    issues.push(`${path}.attrs.nodeId: nodeId「${nodeId}」が重複しています`);
  } else {
    nodeIds.add(nodeId);
  }
}

function validateMarks(value: unknown, path: string, issues: string[]): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(`${path}: 配列が必要です`);
    return;
  }
  value.forEach((entry, index) => {
    const markPath = `${path}.${index}`;
    const mark = expectRecord(entry, markPath, issues);
    if (!mark) return;
    if (typeof mark.type !== 'string' || !markTypes.has(mark.type)) {
      issues.push(`${markPath}.type: 対応していないmarkです`);
      return;
    }
    if (mark.attrs !== undefined) {
      const attrs = expectRecord(mark.attrs, `${markPath}.attrs`, issues);
      if (!attrs) return;
      for (const key of ['href', 'target', 'rel']) {
        if (attrs[key] !== undefined) {
          expectString(attrs[key], `${markPath}.attrs.${key}`, issues);
        }
      }
    }
    if (mark.type === 'link') {
      const attrs = isRecord(mark.attrs) ? mark.attrs : undefined;
      expectString(attrs?.href, `${markPath}.attrs.href`, issues, {
        nonEmpty: true,
      });
      if (
        typeof attrs?.href === 'string' &&
        !isSafeResourceUrl(attrs.href, 'link')
      ) {
        issues.push(`${markPath}.attrs.href: 安全でないリンクURLです`);
      }
    }
  });
}

function validateInlineNode(
  value: unknown,
  path: string,
  issues: string[],
  nodeIds: Set<string>,
): void {
  const node = expectRecord(value, path, issues);
  if (!node) return;

  switch (node.type) {
    case 'text':
      expectString(node.text, `${path}.text`, issues);
      validateMarks(node.marks, `${path}.marks`, issues);
      if (node.attrs !== undefined || node.content !== undefined) {
        issues.push(`${path}: text nodeにattrs/contentは指定できません`);
      }
      break;
    case 'inlineMath': {
      const attrs = validateAttrs(node, path, issues);
      expectString(attrs?.latex, `${path}.attrs.latex`, issues);
      if (
        node.content !== undefined ||
        node.text !== undefined ||
        node.marks !== undefined
      ) {
        issues.push(`${path}: inlineMathにcontent/text/marksは指定できません`);
      }
      break;
    }
    case 'inlineImage': {
      const attrs = validateAttrs(node, path, issues);
      validateNodeId(attrs, path, issues, nodeIds);
      expectString(attrs?.src, `${path}.attrs.src`, issues, { nonEmpty: true });
      expectString(attrs?.alt, `${path}.attrs.alt`, issues);
      expectString(attrs?.title, `${path}.attrs.title`, issues, {
        nullable: true,
      });
      if (
        typeof attrs?.src === 'string' &&
        !isSafeResourceUrl(attrs.src, 'image')
      ) {
        issues.push(`${path}.attrs.src: 安全でない画像URLです`);
      }
      if (
        node.content !== undefined ||
        node.text !== undefined ||
        node.marks !== undefined
      ) {
        issues.push(`${path}: inlineImageにcontent/text/marksは指定できません`);
      }
      break;
    }
    case 'hardBreak':
      if (
        node.attrs !== undefined ||
        node.content !== undefined ||
        node.text !== undefined
      ) {
        issues.push(`${path}: hardBreakにattrs/content/textは指定できません`);
      }
      break;
    default:
      issues.push(`${path}.type: 対応していないinline nodeです`);
  }
}

function validateInlineContent(
  value: unknown,
  path: string,
  issues: string[],
  nodeIds: Set<string>,
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issues.push(`${path}: 配列が必要です`);
    return;
  }
  value.forEach((entry, index) =>
    validateInlineNode(entry, `${path}.${index}`, issues, nodeIds),
  );
}

function validateChildNodes(
  value: unknown,
  path: string,
  parent: NodeParent,
  issues: string[],
  nodeIds: Set<string>,
): void {
  if (!Array.isArray(value)) {
    issues.push(`${path}: 配列が必要です`);
    return;
  }
  value.forEach((entry, index) =>
    validateBlockNode(entry, `${path}.${index}`, parent, issues, nodeIds),
  );
}

function requireNonEmptyContent(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (Array.isArray(value) && value.length === 0) {
    issues.push(`${path}: 1つ以上の子nodeが必要です`);
  }
}

function validateBlockNode(
  value: unknown,
  path: string,
  parent: NodeParent,
  issues: string[],
  nodeIds: Set<string>,
): void {
  const node = expectRecord(value, path, issues);
  if (!node) return;
  if (typeof node.type !== 'string') {
    issues.push(`${path}.type: node typeが必要です`);
    return;
  }
  if (node.text !== undefined || node.marks !== undefined) {
    issues.push(`${path}: block nodeにtext/marksは直接指定できません`);
  }

  const validForParent =
    (parent === 'root' || parent === 'listItem' || parent === 'blockquote') &&
    blockTypes.has(node.type);
  const validListItem = parent === 'list' && node.type === 'listItem';
  const validRow = parent === 'table' && node.type === 'tableRow';
  const validCell =
    parent === 'tableRow' &&
    (node.type === 'tableHeader' || node.type === 'tableCell');
  const validCellParagraph =
    parent === 'tableCell' && node.type === 'paragraph';
  if (
    !validForParent &&
    !validListItem &&
    !validRow &&
    !validCell &&
    !validCellParagraph
  ) {
    issues.push(
      `${path}.type: ${parent}の子として${node.type}は使用できません`,
    );
  }

  const attrs = validateAttrs(node, path, issues);
  validateNodeId(attrs, path, issues, nodeIds);

  switch (node.type) {
    case 'paragraph':
      validateInlineContent(node.content, `${path}.content`, issues, nodeIds);
      break;
    case 'heading': {
      const level = attrs?.level;
      if (
        typeof level !== 'number' ||
        !Number.isInteger(level) ||
        level < 1 ||
        level > 6
      ) {
        issues.push(`${path}.attrs.level: 1から6の整数が必要です`);
      }
      validateInlineContent(node.content, `${path}.content`, issues, nodeIds);
      break;
    }
    case 'bulletList':
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'list',
        issues,
        nodeIds,
      );
      break;
    case 'orderedList':
      if (
        typeof attrs?.start !== 'number' ||
        !Number.isInteger(attrs.start) ||
        attrs.start < 1
      ) {
        issues.push(`${path}.attrs.start: 1以上の整数が必要です`);
      }
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'list',
        issues,
        nodeIds,
      );
      break;
    case 'listItem':
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'listItem',
        issues,
        nodeIds,
      );
      break;
    case 'blockquote':
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'blockquote',
        issues,
        nodeIds,
      );
      break;
    case 'codeBlock':
      expectString(attrs?.language, `${path}.attrs.language`, issues, {
        nullable: true,
      });
      if (node.content !== undefined) {
        if (!Array.isArray(node.content)) {
          issues.push(`${path}.content: 配列が必要です`);
        } else {
          node.content.forEach((entry, index) => {
            const textPath = `${path}.content.${index}`;
            const text = expectRecord(entry, textPath, issues);
            if (!text || text.type !== 'text') {
              issues.push(
                `${textPath}.type: codeBlockにはtextだけを指定できます`,
              );
              return;
            }
            expectString(text.text, `${textPath}.text`, issues);
            if (text.marks !== undefined) {
              issues.push(
                `${textPath}.marks: codeBlock内のtextにmarkは指定できません`,
              );
            }
          });
        }
      }
      break;
    case 'figure':
      expectString(attrs?.src, `${path}.attrs.src`, issues, { nonEmpty: true });
      expectString(attrs?.alt, `${path}.attrs.alt`, issues);
      expectString(attrs?.title, `${path}.attrs.title`, issues, {
        nullable: true,
      });
      if (
        typeof attrs?.width !== 'number' ||
        !Number.isFinite(attrs.width) ||
        attrs.width < 10 ||
        attrs.width > 100
      ) {
        issues.push(`${path}.attrs.width: 10から100の数値が必要です`);
      }
      if (!['left', 'center', 'right'].includes(String(attrs?.align))) {
        issues.push(
          `${path}.attrs.align: left、center、rightのいずれかが必要です`,
        );
      }
      if (
        typeof attrs?.src === 'string' &&
        !isSafeResourceUrl(attrs.src, 'image')
      ) {
        issues.push(`${path}.attrs.src: 安全でない画像URLです`);
      }
      if (node.content !== undefined) {
        issues.push(`${path}.content: figureにcontentは指定できません`);
      }
      break;
    case 'blockMath':
      expectString(attrs?.latex, `${path}.attrs.latex`, issues);
      if (node.content !== undefined) {
        issues.push(`${path}.content: blockMathにcontentは指定できません`);
      }
      break;
    case 'horizontalRule':
      if (node.content !== undefined) {
        issues.push(`${path}.content: horizontalRuleにcontentは指定できません`);
      }
      break;
    case 'table':
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'table',
        issues,
        nodeIds,
      );
      break;
    case 'tableRow':
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'tableRow',
        issues,
        nodeIds,
      );
      break;
    case 'tableHeader':
    case 'tableCell':
      if (
        attrs?.align !== null &&
        attrs?.align !== 'left' &&
        attrs?.align !== 'center' &&
        attrs?.align !== 'right'
      ) {
        issues.push(`${path}.attrs.align: null、left、center、rightが必要です`);
      }
      requireNonEmptyContent(node.content, `${path}.content`, issues);
      validateChildNodes(
        node.content,
        `${path}.content`,
        'tableCell',
        issues,
        nodeIds,
      );
      break;
    default:
      issues.push(`${path}.type: 対応していないblock nodeです`);
  }
}

export class DocumentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super('文書データの形式が正しくありません');
    this.name = 'DocumentValidationError';
    this.issues = issues;
  }
}

export function validateDocumentData(value: unknown): DocumentData {
  const result = documentEnvelopeSchema.safeParse(value);
  if (!result.success) {
    throw new DocumentValidationError(
      result.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'document';
        return `${path}: ${issue.message}`;
      }),
    );
  }

  const issues: string[] = [];
  const metadata = result.data.metadata;
  if ('type' in metadata) {
    issues.push('metadata.type: typeは文書ルートの予約キーです');
  }
  for (const [key, entry] of Object.entries(metadata)) {
    if (stringMetadataKeys.has(key) && typeof entry !== 'string') {
      issues.push(`metadata.${key}: 文字列が必要です`);
    } else if (booleanMetadataKeys.has(key) && typeof entry !== 'boolean') {
      issues.push(`metadata.${key}: booleanが必要です`);
    }
    assertJsonValue(entry, `metadata.${key}`, issues, new Set());
  }

  const nodeIds = new Set<string>();
  if (result.data.children.length === 0) {
    issues.push('children: 1つ以上のblock nodeが必要です');
  }
  result.data.children.forEach((node, index) =>
    validateBlockNode(node, `children.${index}`, 'root', issues, nodeIds),
  );

  if (issues.length > 0) {
    throw new DocumentValidationError(issues);
  }
  return value as DocumentData;
}
