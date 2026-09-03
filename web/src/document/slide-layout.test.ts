import { describe, expect, it } from 'vitest';

import {
  defaultSlideImagePlacement,
  isSlideImagePlacement,
  moveOrResizeSlideImage,
  normalizeSlideImagePlacement,
  parseSlideImagePlacement,
  serializeSlideImagePlacement,
} from './slide-layout';

describe('slide image placement', () => {
  it('normalizes rectangles after rounding without allowing an edge to spill outside the canvas', () => {
    expect(
      normalizeSlideImagePlacement({
        x: 95,
        y: 96,
        width: 33.35,
        height: 7.45,
      }),
    ).toEqual({
      x: 66.6,
      y: 92.5,
      width: 33.4,
      height: 7.5,
    });
  });

  it('keeps moving and resizing within the 16:9 slide bounds and minimum size', () => {
    expect(
      moveOrResizeSlideImage(
        { x: 80, y: 80, width: 15, height: 15 },
        20,
        20,
        'move',
      ),
    ).toEqual({ x: 85, y: 85, width: 15, height: 15 });
    expect(
      moveOrResizeSlideImage(
        { x: 80, y: 80, width: 15, height: 15 },
        40,
        40,
        'north-west',
      ),
    ).toEqual({ x: 90, y: 90, width: 5, height: 5 });
  });

  it('round-trips the persisted Markdown rectangle syntax', () => {
    const placement = parseSlideImagePlacement('12.5,3.5,40,50');
    expect(placement).toEqual({ x: 12.5, y: 3.5, width: 40, height: 50 });
    expect(serializeSlideImagePlacement(placement!)).toBe('12.5,3.5,40,50');
    expect(defaultSlideImagePlacement).toSatisfy(isSlideImagePlacement);
  });

  it.each([undefined, '12,3,40', '12,3,NaN,40', '96,3,5,40', '12,96,40,5'])(
    'rejects invalid stored placement %o',
    (value) => {
      expect(parseSlideImagePlacement(value)).toBeUndefined();
    },
  );
});
