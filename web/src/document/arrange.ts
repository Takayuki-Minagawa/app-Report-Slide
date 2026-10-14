export const arrangementCommands = [
  'left',
  'center',
  'right',
  'top',
  'middle',
  'bottom',
  'horizontal',
  'vertical',
] as const;
export type Arrangement = (typeof arrangementCommands)[number];
export const arrangementNames: Record<Arrangement, string> = {
  left: '左揃え',
  center: '左右中央揃え',
  right: '右揃え',
  top: '上揃え',
  middle: '上下中央揃え',
  bottom: '下揃え',
  horizontal: '横の間隔を均等',
  vertical: '縦の間隔を均等',
};
export interface ArrangementRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  groupId?: string;
  locked?: boolean;
}
const round = (value: number) => Math.round(value * 10000) / 10000;
/** Groups move rigidly; a locked member protects the entire group. Extents stay inside the original selection. */
export function arrangeRectangles(
  rectangles: ArrangementRect[],
  command: Arrangement,
): Map<string, { x: number; y: number }> {
  const groups = new Map<string, ArrangementRect[]>();
  for (const rect of rectangles) {
    const key = rect.groupId ?? rect.id;
    groups.set(key, [...(groups.get(key) ?? []), rect]);
  }
  const units = [...groups.values()]
    .filter((items) => !items.some((item) => item.locked))
    .map((items) => {
      const x = Math.min(...items.map((item) => item.x)),
        y = Math.min(...items.map((item) => item.y));
      return {
        items,
        x,
        y,
        width: Math.max(...items.map((item) => item.x + item.width)) - x,
        height: Math.max(...items.map((item) => item.y + item.height)) - y,
      };
    });
  const output = new Map<string, { x: number; y: number }>();
  const horizontal = command === 'horizontal',
    vertical = command === 'vertical';
  if (units.length < (horizontal || vertical ? 3 : 2)) return output;
  const left = Math.min(...units.map((unit) => unit.x)),
    right = Math.max(...units.map((unit) => unit.x + unit.width));
  const top = Math.min(...units.map((unit) => unit.y)),
    bottom = Math.max(...units.map((unit) => unit.y + unit.height));
  const ordered = [...units].sort((a, b) =>
    horizontal ? a.x - b.x : a.y - b.y,
  );
  const gap = horizontal
    ? (right - left - units.reduce((sum, unit) => sum + unit.width, 0)) /
      (units.length - 1)
    : (bottom - top - units.reduce((sum, unit) => sum + unit.height, 0)) /
      (units.length - 1);
  let cursor = horizontal ? left : top;
  for (const unit of horizontal || vertical ? ordered : units) {
    const x =
      command === 'left'
        ? left
        : command === 'right'
          ? right - unit.width
          : command === 'center'
            ? (left + right - unit.width) / 2
            : horizontal
              ? cursor
              : unit.x;
    const y =
      command === 'top'
        ? top
        : command === 'bottom'
          ? bottom - unit.height
          : command === 'middle'
            ? (top + bottom - unit.height) / 2
            : vertical
              ? cursor
              : unit.y;
    for (const item of unit.items)
      output.set(item.id, {
        x: round(item.x + x - unit.x),
        y: round(item.y + y - unit.y),
      });
    cursor += (horizontal ? unit.width : unit.height) + gap;
  }
  return output;
}
