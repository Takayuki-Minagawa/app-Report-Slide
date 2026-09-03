export const tableBorderSides = ['top', 'right', 'bottom', 'left'] as const;

export type TableBorderSide = (typeof tableBorderSides)[number];

export const tableBorderStyles = [
  'solid',
  'dashed',
  'dotted',
  'double',
] as const;

export type TableBorderStyle = (typeof tableBorderStyles)[number];

export const tableBorderWidths = [1, 2, 3] as const;

export type TableBorderWidth = (typeof tableBorderWidths)[number];

export interface TableBorder {
  color: string;
  style: TableBorderStyle;
  width: TableBorderWidth;
}

/** `null` explicitly removes a side; an omitted side uses the table default. */
export type TableCellBorders = Partial<
  Record<TableBorderSide, TableBorder | null>
>;

export const defaultTableBorder: TableBorder = {
  color: '#334155',
  style: 'solid',
  width: 1,
};

const colorPattern = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTableBorder(value: unknown): value is TableBorder {
  return (
    isRecord(value) &&
    typeof value.color === 'string' &&
    colorPattern.test(value.color) &&
    typeof value.style === 'string' &&
    (tableBorderStyles as readonly string[]).includes(value.style) &&
    typeof value.width === 'number' &&
    (tableBorderWidths as readonly number[]).includes(value.width)
  );
}

export function isTableCellBorders(value: unknown): value is TableCellBorders {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([side, border]) =>
      (tableBorderSides as readonly string[]).includes(side) &&
      (border === null || isTableBorder(border)),
  );
}

/** Converts untrusted DOM attributes into the strict internal border shape. */
export function parseTableCellBorders(
  value: string | null,
): TableCellBorders | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isTableCellBorders(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function tableCellBordersToCss(
  borders: TableCellBorders | null | undefined,
): string {
  if (!borders || !isTableCellBorders(borders)) return '';
  return tableBorderSides
    .flatMap((side) => {
      const border = borders[side];
      if (border === undefined) return [];
      const value =
        border === null
          ? '0 none transparent'
          : `${border.width}px ${border.style} ${border.color}`;
      return [`border-${side}: ${value}`];
    })
    .join('; ');
}

export function tableCellBorderStyle(
  borders: TableCellBorders | null | undefined,
): Record<string, string> {
  if (!borders || !isTableCellBorders(borders)) return {};
  const property: Record<TableBorderSide, string> = {
    top: 'borderTop',
    right: 'borderRight',
    bottom: 'borderBottom',
    left: 'borderLeft',
  };
  return Object.fromEntries(
    tableBorderSides.flatMap((side) => {
      const border = borders[side];
      if (border === undefined) return [];
      return [
        [
          property[side],
          border === null
            ? '0 none transparent'
            : `${border.width}px ${border.style} ${border.color}`,
        ],
      ];
    }),
  );
}
