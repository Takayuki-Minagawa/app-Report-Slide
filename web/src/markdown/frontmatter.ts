import { parseDocument } from 'yaml';

import type {
  DocumentMetadata,
  DocumentType,
  JsonValue,
} from '@/src/document/model';

import { MarkdownImportError, type MarkdownDiagnostic } from './diagnostics';

export interface FrontMatterResult {
  type: DocumentType;
  metadata: DocumentMetadata;
  body: string;
  diagnostics: MarkdownDiagnostic[];
  hasFrontMatter: boolean;
}

function lineAndColumn(
  error: unknown,
): Pick<MarkdownDiagnostic, 'line' | 'column'> {
  if (
    typeof error === 'object' &&
    error !== null &&
    'linePos' in error &&
    Array.isArray(error.linePos) &&
    error.linePos.length > 0
  ) {
    const first = error.linePos[0] as { line?: number; col?: number };
    return { line: first.line, column: first.col };
  }
  return {};
}

function normalizeYamlValue(value: unknown, path: string): JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path}には有限の数値を指定してください`);
    }
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      normalizeYamlValue(entry, `${path}[${index}]`),
    );
  }

  if (typeof value === 'object' && value !== null) {
    const normalized: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        throw new Error(`${path}に使用できないキーがあります`);
      }
      normalized[key] = normalizeYamlValue(entry, `${path}.${key}`);
    }
    return normalized;
  }

  throw new Error(`${path}に対応していないYAML値があります`);
}

export function parseFrontMatter(
  source: string,
  fallbackType: DocumentType = 'report',
): FrontMatterResult {
  const normalizedSource = source
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
  const lines = normalizedSource.split('\n');
  const diagnostics: MarkdownDiagnostic[] = [];

  if (lines[0] !== '---') {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter.missing',
      message: `Front Matterがないため${fallbackType}として読み込みました`,
      line: 1,
      column: 1,
    });
    return {
      type: fallbackType,
      metadata: {},
      body: normalizedSource,
      diagnostics,
      hasFrontMatter: false,
    };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line === '---' || line === '...'),
  );

  if (closingIndex < 0) {
    throw new MarkdownImportError('Front Matterが閉じられていません', [
      {
        severity: 'error',
        code: 'frontmatter.unclosed',
        message: '対応する終了区切り（---）が必要です',
        line: 1,
        column: 1,
      },
    ]);
  }

  const yamlSource = lines.slice(1, closingIndex).join('\n');
  const yamlDocument = parseDocument(yamlSource, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });

  if (yamlDocument.errors.length > 0) {
    const yamlDiagnostics = yamlDocument.errors.map((error) => ({
      severity: 'error' as const,
      code: 'frontmatter.invalid-yaml',
      message: error.message,
      ...lineAndColumn(error),
    }));
    throw new MarkdownImportError(
      'Front MatterのYAMLが正しくありません',
      yamlDiagnostics,
    );
  }

  let parsed: unknown;
  try {
    parsed = yamlDocument.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new MarkdownImportError('Front Matterを安全に読み込めませんでした', [
      {
        severity: 'error',
        code: 'frontmatter.unsafe',
        message:
          error instanceof Error ? error.message : 'YAML aliasを使用できません',
      },
    ]);
  }

  if (parsed === null) parsed = {};
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MarkdownImportError('Front Matterはキーと値で記述してください', [
      {
        severity: 'error',
        code: 'frontmatter.not-object',
        message: 'Front Matterのルートにはオブジェクトが必要です',
        line: 2,
        column: 1,
      },
    ]);
  }

  let normalized: JsonValue;
  try {
    normalized = normalizeYamlValue(parsed, 'frontmatter');
  } catch (error) {
    throw new MarkdownImportError('Front Matterに対応していない値があります', [
      {
        severity: 'error',
        code: 'frontmatter.unsupported-value',
        message:
          error instanceof Error ? error.message : 'YAML値を変換できません',
      },
    ]);
  }

  const metadataRecord = normalized as Record<string, JsonValue>;
  const declaredType = metadataRecord.type;
  let type = fallbackType;

  if (declaredType === 'report' || declaredType === 'slide') {
    type = declaredType;
  } else if (declaredType === undefined) {
    diagnostics.push({
      severity: 'warning',
      code: 'frontmatter.type-missing',
      message: `typeがないため${fallbackType}として読み込みました`,
      line: 2,
      column: 1,
    });
  } else {
    throw new MarkdownImportError('文書種類が正しくありません', [
      {
        severity: 'error',
        code: 'frontmatter.type-invalid',
        message: 'typeにはreportまたはslideを指定してください',
        line: 2,
        column: 1,
      },
    ]);
  }

  const { type: _discardedType, ...metadata } = metadataRecord;
  const stringKeys = [
    'title',
    'subtitle',
    'author',
    'date',
    'paper',
    'orientation',
    'theme',
    'aspect_ratio',
  ];
  const booleanKeys = ['toc', 'number_sections', 'slide_number'];
  const invalidEntry = [
    ...stringKeys
      .filter(
        (key) =>
          metadata[key] !== undefined && typeof metadata[key] !== 'string',
      )
      .map((key) => `${key}には文字列が必要です`),
    ...booleanKeys
      .filter(
        (key) =>
          metadata[key] !== undefined && typeof metadata[key] !== 'boolean',
      )
      .map((key) => `${key}にはbooleanが必要です`),
  ];
  if (invalidEntry.length > 0) {
    throw new MarkdownImportError('Front Matterの値の型が正しくありません', [
      {
        severity: 'error',
        code: 'frontmatter.metadata-type-invalid',
        message: invalidEntry.join(' / '),
        line: 2,
        column: 1,
      },
    ]);
  }

  return {
    type,
    metadata,
    body: lines.slice(closingIndex + 1).join('\n'),
    diagnostics,
    hasFrontMatter: true,
  };
}
