import type { SlideImagePlacement } from './model';

export const minimumSlideImageSize = 5;

export const defaultSlideImagePlacement: SlideImagePlacement = {
  x: 32,
  y: 22,
  width: 36,
  height: 42,
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Strict validation keeps persisted rectangles inside the visible slide canvas. */
export function isSlideImagePlacement(
  value: unknown,
): value is SlideImagePlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const placement = value as Record<string, unknown>;
  const { x, y, width, height } = placement;
  return (
    isFiniteNumber(x) &&
    isFiniteNumber(y) &&
    isFiniteNumber(width) &&
    isFiniteNumber(height) &&
    x >= 0 &&
    y >= 0 &&
    width >= minimumSlideImageSize &&
    height >= minimumSlideImageSize &&
    x + width <= 100 &&
    y + height <= 100
  );
}

/** Normalizes pointer-driven edits so they remain usable at every canvas size. */
export function normalizeSlideImagePlacement(
  placement: SlideImagePlacement,
): SlideImagePlacement {
  const width = round(clamp(placement.width, minimumSlideImageSize, 100));
  const height = round(clamp(placement.height, minimumSlideImageSize, 100));
  const maximumX = round(100 - width);
  const maximumY = round(100 - height);
  return {
    x: Math.min(round(clamp(placement.x, 0, maximumX)), maximumX),
    y: Math.min(round(clamp(placement.y, 0, maximumY)), maximumY),
    width,
    height,
  };
}

export type SlideImagePlacementAction =
  | 'move'
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'north-east'
  | 'north-west'
  | 'south-east'
  | 'south-west';

/** Applies a pointer delta expressed in canvas percentages. */
export function moveOrResizeSlideImage(
  initial: SlideImagePlacement,
  deltaX: number,
  deltaY: number,
  action: SlideImagePlacementAction,
): SlideImagePlacement {
  const start = normalizeSlideImagePlacement(initial);
  if (action === 'move')
    return normalizeSlideImagePlacement({
      ...start,
      x: start.x + deltaX,
      y: start.y + deltaY,
    });

  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (action.includes('west'))
    left = clamp(left + deltaX, 0, right - minimumSlideImageSize);
  if (action.includes('east'))
    right = clamp(right + deltaX, left + minimumSlideImageSize, 100);
  if (action.includes('north'))
    top = clamp(top + deltaY, 0, bottom - minimumSlideImageSize);
  if (action.includes('south'))
    bottom = clamp(bottom + deltaY, top + minimumSlideImageSize, 100);
  return normalizeSlideImagePlacement({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  });
}

export function parseSlideImagePlacement(
  value: unknown,
): SlideImagePlacement | undefined {
  if (typeof value !== 'string') return undefined;
  const rawParts = value.split(',');
  if (rawParts.length !== 4 || rawParts.some((part) => !part.trim()))
    return undefined;
  const parts = rawParts.map((part) => Number(part.trim()));
  if (parts.some((part) => !Number.isFinite(part))) return undefined;
  const placement = {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3],
  };
  return isSlideImagePlacement(placement) ? placement : undefined;
}

export function serializeSlideImagePlacement(
  placement: SlideImagePlacement,
): string {
  const normalized = normalizeSlideImagePlacement(placement);
  return [normalized.x, normalized.y, normalized.width, normalized.height].join(
    ',',
  );
}
