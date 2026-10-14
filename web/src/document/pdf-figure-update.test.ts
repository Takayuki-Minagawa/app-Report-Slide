import { describe, expect, it } from 'vitest';
import type { ExtractionResult } from './extraction';
import type { FigureEdit } from './figure-edit';
import { pdfExtractionForUpdate } from './pdf-figure-update';

const evidence: ExtractionResult = {
  mode: 'text',
  method: 'ocr',
  text: '確認・修正した本文 123',
  rawText: '原文 l23',
  rows: [],
  rawRows: [],
  numericValues: [],
  header: false,
  language: 'jpn+eng',
  confidence: 85,
  warnings: [],
};
const source = {
  asset: 'assets/original.pdf',
  fileName: 'original.pdf',
  page: 2,
  pageCount: 3,
  dpi: 144,
};
const crop = { x: 10, y: 20, width: 70, height: 50 };
const original: FigureEdit = {
  version: 1,
  pdfSource: source,
  crop,
  imageSize: { width: 800, height: 1000 },
  extraction: evidence,
};

describe('PDF recognition evidence on recropping', () => {
  it('preserves reviewed text, original text and language when only render resolution changes', () => {
    const rerendered = { ...source, dpi: 288, crop: { ...crop } };
    expect(pdfExtractionForUpdate(original, rerendered)).toBe(evidence);
  });

  it('treats an omitted crop and an explicit full page as the same region', () => {
    const full = { x: 0, y: 0, width: 100, height: 100 };
    expect(
      pdfExtractionForUpdate(
        { ...original, crop: undefined },
        { ...source, crop: full },
      ),
    ).toBe(evidence);
    expect(pdfExtractionForUpdate({ ...original, crop: full }, source)).toBe(
      evidence,
    );
  });

  it.each(['x', 'y', 'width', 'height'] as const)(
    'drops stale recognition when the crop %s changes',
    (key) => {
      expect(
        pdfExtractionForUpdate(original, {
          ...source,
          crop: { ...crop, [key]: crop[key] + 1 },
        }),
      ).toBeUndefined();
    },
  );

  it('drops recognition when the PDF asset or page changes', () => {
    expect(
      pdfExtractionForUpdate(original, {
        ...source,
        crop,
        asset: 'assets/other.pdf',
      }),
    ).toBeUndefined();
    expect(
      pdfExtractionForUpdate(original, { ...source, crop, page: 1 }),
    ).toBeUndefined();
  });

  it('uses a newly reviewed result even for a different region', () => {
    const nextEvidence = { ...evidence, text: '新しい範囲を確認した本文' };
    expect(
      pdfExtractionForUpdate(original, {
        ...source,
        page: 1,
        extraction: nextEvidence,
      }),
    ).toBe(nextEvidence);
  });

  it('does not attach recognition without a matching original PDF', () => {
    expect(
      pdfExtractionForUpdate(undefined, { ...source, crop }),
    ).toBeUndefined();
    expect(
      pdfExtractionForUpdate(
        { version: 1, extraction: evidence },
        { ...source, crop },
      ),
    ).toBeUndefined();
    expect(
      pdfExtractionForUpdate(
        { ...original, extraction: undefined },
        { ...source, crop },
      ),
    ).toBeUndefined();
  });

  it('does not reuse OCR of a replacement SVG when returning to the PDF page', () => {
    expect(
      pdfExtractionForUpdate(
        {
          ...original,
          svgSource:
            '<svg xmlns="http://www.w3.org/2000/svg"><text>別の図</text></svg>',
        },
        { ...source, crop },
      ),
    ).toBeUndefined();
    expect(
      pdfExtractionForUpdate(
        {
          ...original,
          diagram: {
            version: 1,
            width: 800,
            height: 400,
            shapes: [],
            connections: [],
          },
        },
        { ...source, crop },
      ),
    ).toBeUndefined();
  });
});
