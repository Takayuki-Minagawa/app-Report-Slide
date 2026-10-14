import { describe, expect, it } from 'vitest';
import {
  inferTextTable,
  normalizeExtractedNumber,
  numericTableValues,
  parseReviewTsv,
  positionedText,
  reviewedTableCsv,
  textInRegion,
  type PositionedText,
} from './text-table';

function word(
  text: string,
  x: number,
  y: number,
  width = 30,
  confidence?: number,
): PositionedText {
  return {
    text,
    bbox: { x0: x, y0: y, x1: x + width, y1: y + 10 },
    confidence,
  };
}

describe('PDF/OCR text and table review', () => {
  it('groups visual rows independently of PDF text stream order and retains empty cells', () => {
    const words = [
      word('B', 10, 60),
      word('1,200', 120, 30),
      word('Value', 120, 0),
      word('Name', 10, 0),
      word('A', 10, 30),
      word('2.5', 220, 30),
      word('Error', 220, 0),
      word('0.4', 220, 60),
    ];
    const inferred = inferTextTable(words);
    expect(inferred.rows).toEqual([
      ['Name', 'Value', 'Error'],
      ['A', '1,200', '2.5'],
      ['B', '', '0.4'],
    ]);
    expect(inferred.warnings).toHaveLength(1);
    expect(positionedText(words)).toBe('Name Value Error\nA 1,200 2.5\nB 0.4');
    expect(words[0].text).toBe('B');
  });

  it('combines OCR glyphs and nearby words while marking low-confidence values', () => {
    const words = [
      word('試', 0, 0, 10),
      word('料', 10, 0, 10),
      word('A', 25, 0, 8),
      word('12', 120, 0, 20, 45),
      word('Sample', 0, 30, 35),
      word('B', 39, 30, 10),
      word('14', 120, 30, 20, 95),
    ];
    const inferred = inferTextTable(words);
    expect(inferred.rows).toEqual([
      ['試料 A', '12'],
      ['Sample B', '14'],
    ]);
    expect(inferred.warnings.join()).toContain('75%');
  });

  it('filters by crop in displayed-page coordinates without taking the neighbouring cell', () => {
    const inside = word('inside', 100, 200, 50);
    const touching = word('outside', 150, 200, 50);
    expect(
      textInRegion(
        { width: 1000, height: 1000, words: [inside, touching], warnings: [] },
        { x: 9, y: 19, width: 6, height: 3 },
      ),
    ).toEqual([inside]);
  });

  it.each([
    ['１，２３４．５', 1234.5],
    ['−0.25', -0.25],
    ['1.2e-3', 0.0012],
    ['2.5 × 10−3', 0.0025],
    ['.25', 0.25],
    ['+12', 12],
    ['0', 0],
    ['12%', null],
    ['5 MPa', null],
    ['0012', null],
    ['1,23', null],
    ['1.234,56', null],
    ['O.5', null],
    ['1e999', null],
    ['1e-999', null],
    ['9007199254740993', null],
    ['1.23456789012345678', null],
    ['<0.1', null],
    ['−', null],
  ])('conservatively interprets %s as %s', (raw, value) => {
    expect(normalizeExtractedNumber(raw)).toBe(value);
  });

  it('excludes the header from numeric values and blocks spreadsheet formula injection', () => {
    const rows = [
      ['2026', '=header'],
      ['1,200', '=HYPERLINK("bad")'],
      ['-0.5', '  +SUM(A1:A2)'],
    ];
    expect(numericTableValues(rows, true)).toEqual([
      [null, null],
      [1200, null],
      [-0.5, null],
    ]);
    const csv = reviewedTableCsv(rows, true);
    expect(csv).toBe(
      '\uFEFF"2026","\'=header"\r\n"1200","\'=HYPERLINK(""bad"")"\r\n"-0.5","\'  +SUM(A1:A2)"',
    );
    expect(rows[1][0]).toBe('1,200');
  });

  it('normalizes review TSV dimensions and rejects large tables instead of truncating evidence', () => {
    expect(parseReviewTsv('Name\tValue\r\nA\r\nB\t3\r\n')).toEqual([
      ['Name', 'Value'],
      ['A', ''],
      ['B', '3'],
    ]);
    expect(() => parseReviewTsv(Array(201).fill('x').join('\n'))).toThrow(
      '200行',
    );
    expect(() => parseReviewTsv(Array(41).fill('x').join('\t'))).toThrow(
      '40列',
    );
    expect(() => parseReviewTsv('x'.repeat(2001))).toThrow('2,000文字');
    expect(() =>
      inferTextTable(
        Array.from({ length: 201 }, (_, i) => word('x', 10, i * 20)),
      ),
    ).toThrow('200行');
  });
});
