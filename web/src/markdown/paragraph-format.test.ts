import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parser';
import { serializeDocument } from './serializer';
import { MarkdownImportError } from './diagnostics';
import {
  validateDocumentData,
  DocumentValidationError,
} from '@/src/document/validation';

describe('paragraph indent persistence', () => {
  it('round-trips inherit, zero and one-em overrides alongside old rulers and leading spaces', () => {
    const source =
      '　本文\n{text_ruler=10,5,15 first_line_indent=inherit}\n\nここで、\n{first_line_indent=0}\n\n次の本文\n{first_line_indent=1}';
    const document = parseMarkdown(source).document;
    expect(document.children.map((node) => node.attrs.firstLineIndent)).toEqual(
      [{ mode: 'inherit' }, { mode: 'em', value: 0 }, { mode: 'em', value: 1 }],
    );
    const saved = serializeDocument(document);
    expect(saved).toContain('　本文');
    expect(saved).toContain('text_ruler=10,5,15 first_line_indent=inherit');
    expect(serializeDocument(parseMarkdown(saved).document)).toBe(saved);
    expect(validateDocumentData(JSON.parse(JSON.stringify(document)))).toEqual(
      document,
    );
  });

  it('leaves old paragraphs unspecified instead of migrating them to explicit inheritance', () => {
    const document = parseMarkdown(
      '本文\n{text_ruler=10,0,5}\n\n続き',
    ).document;
    expect(
      document.children.every(
        (node) => !Object.hasOwn(node.attrs, 'firstLineIndent'),
      ),
    ).toBe(true);
    expect(serializeDocument(document)).not.toContain('first_line_indent');
  });

  it('round-trips finite small fractions even when JSON numbers serialize with an exponent', () => {
    const document = parseMarkdown(
      '本文\n{first_line_indent=0.0000001}',
    ).document;
    const saved = serializeDocument(document);
    expect(
      parseMarkdown(saved).document.children[0].attrs.firstLineIndent,
    ).toEqual({ mode: 'em', value: 0.0000001 });
  });

  it('preserves nested paragraph data and uses a lossless table when an indent is present', () => {
    const document = parseMarkdown(
      '- 項目\n  {first_line_indent=1}\n\n> 引用\n> {first_line_indent=0}\n\n| Head |\n| --- |\n| Body |',
    ).document;
    const table = document.children.at(-1)!;
    if (table.type !== 'table') throw new Error('Expected table');
    const cell = table.content[1].content![0];
    cell.content[0].attrs.firstLineIndent = { mode: 'inherit' };
    const saved = serializeDocument(document);
    expect(saved).toContain('::: kumi-table');
    expect(saved).toContain('first_line_indent=1');
    expect(saved).toContain('first_line_indent=0');
    expect(serializeDocument(parseMarkdown(saved).document)).toBe(saved);
  });

  it.each([
    '本文\n{first_line_indent=-1}',
    '本文\n{first_line_indent=8.1}',
    '本文\n{first_line_indent=NaN}',
    '本文\n{first_line_indent=Infinity}',
    '本文\n{first_line_indent=none}',
    '本文\n{first_line_indent=""}',
    '本文\n{first_line_indent=1 first_line_indent=0}',
    '# 見出し\n{first_line_indent=1}',
    '![図](image.png)\n{first_line_indent=inherit}',
  ])('rejects invalid Markdown attributes: %s', (source) => {
    expect(() => parseMarkdown(source)).toThrow(MarkdownImportError);
  });

  it.each([
    { mode: 'inherit', value: 1 },
    { mode: 'em', value: -1 },
    { mode: 'em', value: '1' },
    { mode: 'em', value: Infinity },
  ])('rejects invalid JSON indent values: %j', (value) => {
    const document = parseMarkdown('本文').document;
    (document.children[0].attrs as Record<string, unknown>).firstLineIndent =
      value;
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });

  it('rejects paragraph-only attributes on headings in JSON', () => {
    const document = parseMarkdown('# 見出し').document;
    document.children[0].attrs.firstLineIndent = { mode: 'inherit' };
    expect(() => validateDocumentData(document)).toThrow(
      DocumentValidationError,
    );
  });
});
