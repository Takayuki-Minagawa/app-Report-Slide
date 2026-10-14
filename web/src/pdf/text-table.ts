/** Coordinates are in the page's displayed coordinate space (top-left origin). */
export interface PositionedText {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence?: number;
}

export interface PageText {
  width: number;
  height: number;
  words: PositionedText[];
  warnings: string[];
}

export interface PercentRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const maximumExtractedRows = 200;
export const maximumExtractedColumns = 40;
export const maximumExtractedCells = 2000;
export const maximumExtractedCharacters = 100_000;

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 1;
};

/** Use centres to avoid capturing a neighbouring cell just touching the crop. */
export function textInRegion(page: PageText, region: PercentRegion) {
  const left = (region.x * page.width) / 100;
  const top = (region.y * page.height) / 100;
  const right = left + (region.width * page.width) / 100;
  const bottom = top + (region.height * page.height) / 100;
  return page.words.filter(({ text, bbox }) => {
    const x = (bbox.x0 + bbox.x1) / 2;
    const y = (bbox.y0 + bbox.y1) / 2;
    return text.trim() && x >= left && x <= right && y >= top && y <= bottom;
  });
}

function joinText(left: string, right: string) {
  // PDF glyph runs and Japanese OCR may separate every character. Do not put
  // spaces between Japanese characters, but keep Latin words readable.
  return `${left}${/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(left) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(right) ? '' : ' '}${right}`;
}

export function positionedRows(words: PositionedText[]): PositionedText[][] {
  const valid = words.filter(
    ({ text, bbox }) =>
      text.trim() &&
      Object.values(bbox).every(Number.isFinite) &&
      bbox.x1 >= bbox.x0 &&
      bbox.y1 > bbox.y0,
  );
  if (valid.length > 20_000)
    throw new Error('読み取り項目が多すぎます。範囲を小さくしてください。');
  const height = median(valid.map(({ bbox }) => bbox.y1 - bbox.y0));
  const rows: { center: number; items: PositionedText[] }[] = [];
  for (const word of [...valid].sort(
    (a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0,
  )) {
    const center = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find(
      (candidate) => Math.abs(candidate.center - center) <= height * 0.5,
    );
    if (row) {
      row.center =
        (row.center * row.items.length + center) / (row.items.length + 1);
      row.items.push(word);
    } else rows.push({ center, items: [word] });
  }
  return rows
    .sort((a, b) => a.center - b.center)
    .map((row) => row.items.sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

export function positionedText(words: PositionedText[]) {
  const value = positionedRows(words)
    .map((row) =>
      row
        .map((word) => word.text.trim())
        .reduce(joinText, '')
        .trim(),
    )
    .join('\n');
  if (value.length > maximumExtractedCharacters)
    throw new Error(
      '読み取った文字が10万文字を超えました。範囲を小さくしてください。',
    );
  return value;
}

function rowSegments(row: PositionedText[], height: number) {
  const segments: PositionedText[] = [];
  for (const word of row) {
    const previous = segments.at(-1);
    if (previous && word.bbox.x0 - previous.bbox.x1 < height * 0.85) {
      const gap = word.bbox.x0 - previous.bbox.x1;
      previous.text =
        gap < height * 0.15
          ? previous.text + word.text
          : joinText(previous.text, word.text);
      previous.bbox.x1 = Math.max(previous.bbox.x1, word.bbox.x1);
      previous.bbox.y0 = Math.min(previous.bbox.y0, word.bbox.y0);
      previous.bbox.y1 = Math.max(previous.bbox.y1, word.bbox.y1);
      if (word.confidence !== undefined)
        previous.confidence = Math.min(
          previous.confidence ?? 100,
          word.confidence,
        );
    } else segments.push({ ...word, bbox: { ...word.bbox } });
  }
  return segments;
}

/**
 * A conservative geometric proposal, not a semantic table detector. The user
 * reviews and corrects this proposal alongside the original before insertion.
 */
export function inferTextTable(words: PositionedText[]) {
  const lines = positionedRows(words);
  if (!lines.length)
    return { rows: [] as string[][], warnings: [] as string[] };
  const height = median(words.map(({ bbox }) => bbox.y1 - bbox.y0));
  const segments = lines.map((line) => rowSegments(line, height));
  const seed = [...segments].sort((a, b) => b.length - a.length)[0];
  const boundaries = seed
    .slice(1)
    .map((cell, index) => (seed[index].bbox.x1 + cell.bbox.x0) / 2);
  if (
    lines.length > maximumExtractedRows ||
    seed.length > maximumExtractedColumns ||
    lines.length * seed.length > maximumExtractedCells
  )
    throw new Error(
      '表は200行・40列・2,000セル以内で読み取ってください。範囲を小さくしてください。',
    );
  const warnings: string[] = [];
  let crossing = false;
  const rows = segments.map((line) => {
    const cells = Array<string>(seed.length).fill('');
    for (const word of line) {
      const center = (word.bbox.x0 + word.bbox.x1) / 2;
      let column = boundaries.findIndex((boundary) => center < boundary);
      if (column === -1) column = seed.length - 1;
      if (
        boundaries.some(
          (boundary) => word.bbox.x0 < boundary && word.bbox.x1 > boundary,
        )
      )
        crossing = true;
      cells[column] = cells[column]
        ? joinText(cells[column], word.text)
        : word.text;
    }
    return cells;
  });
  if (rows.some((row) => row.some((cell) => cell.length > 2000)))
    throw new Error(
      '1セルが2,000文字を超えます。本文として取り込むか、範囲を小さくしてください。',
    );
  if (seed.length < 2)
    warnings.push(
      '複数列を検出できませんでした。表の範囲を絞るか、TSVで列を修正してください。',
    );
  if (crossing || segments.some((line) => line.length !== seed.length))
    warnings.push(
      '空欄・結合セル・複数行の見出しを含む可能性があります。行と列の対応を原本で確認してください。',
    );
  if (
    words.some((word) => word.confidence !== undefined && word.confidence < 75)
  )
    warnings.push(
      '確信度75%未満のOCR文字があります。特に小数点・符号・桁数を原本で確認してください。',
    );
  return { rows, warnings };
}

/** No unit guessing, decimal-comma guessing, O/0 replacement, or identifier conversion. */
export function normalizeExtractedNumber(raw: string): number | null {
  let value = raw
    .trim()
    .normalize('NFKC')
    .replace(/[−–﹣]/g, '-');
  const scientific = value.match(
    /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*[×x]\s*10\s*\^?\s*([+-]?\d+)$/,
  );
  if (scientific) value = `${scientific[1]}e${scientific[2]}`;
  if (value.includes(',')) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))
      return null;
    value = value.replace(/,/g, '');
  }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))
    return null;
  if (/^[+-]?0\d/.test(value)) return null;
  const significant = value
    .split(/[eE]/)[0]
    .replace(/^[+-]?0*\.?0*/, '')
    .replace('.', '')
    .replace(/0+$/, '');
  if (significant.length > 15) return null;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (Number.isInteger(number) && !Number.isSafeInteger(number))
  )
    return null;
  // Do not silently turn underflow into a measured zero.
  if (number === 0 && /[1-9]/.test(value.split(/[eE]/)[0])) return null;
  return number;
}

export function numericTableValues(rows: string[][], header: boolean) {
  return rows.map((row, rowIndex) =>
    row.map((value) =>
      header && rowIndex === 0 ? null : normalizeExtractedNumber(value),
    ),
  );
}

export function parseReviewTsv(value: string): string[][] {
  if (value.length > maximumExtractedCharacters)
    throw new Error('表は10万文字以内で入力してください。');
  const rows = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((row) => row.split('\t'));
  if (rows.length > 1 && rows.at(-1)?.every((cell) => !cell)) rows.pop();
  const width = Math.max(1, ...rows.map((row) => row.length));
  if (
    rows.length > maximumExtractedRows ||
    width > maximumExtractedColumns ||
    rows.length * width > maximumExtractedCells
  )
    throw new Error('表は200行・40列・2,000セル以内で入力してください。');
  if (rows.some((row) => row.some((cell) => cell.length > 2000)))
    throw new Error('1セルは2,000文字以内で入力してください。');
  return rows.map((row) =>
    Array.from({ length: width }, (_, index) => row[index] ?? ''),
  );
}

/** Spreadsheet formulas in extracted/user text must remain text when opened. */
export function reviewedTableCsv(rows: string[][], header: boolean) {
  const numeric = numericTableValues(rows, header);
  return (
    '\uFEFF' +
    rows
      .map((row, ri) =>
        row
          .map((cell, ci) => {
            const value =
              numeric[ri][ci] !== null
                ? String(numeric[ri][ci])
                : /^[\s]*[=+\-@\t\r]/.test(cell)
                  ? `'${cell}`
                  : cell;
            return `"${value.replace(/"/g, '""')}"`;
          })
          .join(','),
      )
      .join('\r\n')
  );
}
