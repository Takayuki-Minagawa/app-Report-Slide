export const canonicalHardBreakMarker = '{.kumi-br}';
export const inlineImageMarker = '{.kumi-inline}';
export const emptyParagraphMarker = '{.kumi-empty}';

/** A delimiter is escaped only when preceded by an odd run of backslashes. */
export function isEscaped(source: string, position: number): boolean {
  let slashes = 0;
  for (
    let index = position - 1;
    index >= 0 && source[index] === '\\';
    index--
  ) {
    slashes++;
  }
  return slashes % 2 === 1;
}
