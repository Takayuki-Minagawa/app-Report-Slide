import type { CSSProperties } from 'react';

/** Positions are percentages of the containing text area, measured from its left edge. */
export interface TextRuler {
  left: number;
  right: number;
  firstLine: number;
}

export function isTextRuler(value: unknown): value is TextRuler {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const ruler = value as Record<string, unknown>;
  if (
    Object.keys(ruler).length !== 3 ||
    !Object.hasOwn(ruler, 'left') ||
    !Object.hasOwn(ruler, 'right') ||
    !Object.hasOwn(ruler, 'firstLine')
  ) {
    return false;
  }
  const { left, right, firstLine } = ruler;
  return (
    typeof left === 'number' &&
    Number.isFinite(left) &&
    left >= 0 &&
    left <= 85 &&
    typeof right === 'number' &&
    Number.isFinite(right) &&
    right >= 0 &&
    right <= 85 &&
    left + right <= 85 &&
    typeof firstLine === 'number' &&
    Number.isFinite(firstLine) &&
    firstLine >= 0 &&
    firstLine <= 100 - right
  );
}

/** CSS text-indent percentages use the paragraph's width after its margins. */
export function textRulerStyle(value: unknown): CSSProperties | undefined {
  if (!isTextRuler(value)) return undefined;
  const { left, right, firstLine } = value;
  return {
    marginLeft: `${left}%`,
    marginRight: `${right}%`,
    textIndent: `${((firstLine - left) / (100 - left - right)) * 100}%`,
  };
}
