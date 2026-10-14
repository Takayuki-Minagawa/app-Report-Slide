/** Choose the higher-contrast text color for a validated solid cell fill. */
export function tableFillTextColor(
  fill: string | null | undefined,
): string | undefined {
  if (!fill || !/^#[0-9a-f]{6}$/i.test(fill)) return undefined;
  const luminance = (color: string) => {
    const linear = [1, 3, 5].map((index) => {
      const channel = parseInt(color.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const light = luminance(fill),
    dark = luminance('#111827');
  const darkContrast =
    (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  const whiteContrast = 1.05 / (light + 0.05);
  return darkContrast >= whiteContrast ? '#111827' : '#ffffff';
}
