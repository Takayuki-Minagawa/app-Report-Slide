import { describe, expect, it } from 'vitest';

import { isTextRuler, textRulerStyle } from './text-ruler';

describe('text ruler positions', () => {
  it('allows a first-line indent and a hanging indent inside the text area', () => {
    expect(isTextRuler({ left: 15, right: 10, firstLine: 25 })).toBe(true);
    expect(isTextRuler({ left: 15, right: 10, firstLine: 5 })).toBe(true);
  });

  it.each([
    { left: -1, right: 0, firstLine: 0 },
    { left: 40, right: 46, firstLine: 40 },
    { left: 10, right: 20, firstLine: 81 },
    { left: 10, right: Number.NaN, firstLine: 20 },
    { left: 10, right: 0, firstLine: 20, extra: 1 },
  ])('rejects invalid ruler position: %j', (ruler) => {
    expect(isTextRuler(ruler)).toBe(false);
    expect(textRulerStyle(ruler)).toBeUndefined();
  });

  it('keeps the first line at the requested parent-relative position', () => {
    const style = textRulerStyle({ left: 20, right: 10, firstLine: 25 });
    expect(style?.marginLeft).toBe('20%');
    expect(style?.marginRight).toBe('10%');
    expect(
      (Number.parseFloat(String(style?.textIndent)) / 100) * 70 + 20,
    ).toBeCloseTo(25);
    expect(textRulerStyle(null)).toBeUndefined();
  });
});
