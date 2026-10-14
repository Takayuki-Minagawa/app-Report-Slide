import type { ExtractionResult } from './extraction';
import type { FigureEdit } from './figure-edit';

type PdfRegion = {
  asset: string;
  page: number;
  crop?: FigureEdit['crop'];
  extraction?: ExtractionResult;
};

const fullPage = { x: 0, y: 0, width: 100, height: 100 };

/** Recognition evidence belongs to a PDF region, independently of rendering DPI. */
export function pdfExtractionForUpdate(
  previous: FigureEdit | undefined,
  next: PdfRegion,
): ExtractionResult | undefined {
  if (next.extraction) return next.extraction;
  if (
    !previous?.pdfSource ||
    previous.pdfSource.asset !== next.asset ||
    previous.pdfSource.page !== next.page ||
    // Image OCR may have read this replacement SVG instead of the stored PDF.
    previous.svgSource ||
    previous.diagram
  )
    return undefined;
  const before = previous.crop ?? fullPage;
  const after = next.crop ?? fullPage;
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => before[key] === after[key],
  )
    ? previous.extraction
    : undefined;
}
