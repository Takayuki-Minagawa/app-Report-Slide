import { LevelFormat, LevelSuffix, type ILevelsOptions } from 'docx';
import type { ResolvedReportSettings } from '@/src/document/report-settings';
import type { DocumentAnalysis } from '@/src/document/semantics';
import type { AppLocale } from '@/src/i18n/messages';

export const headingList = 'kumi-headings';
export const appendixList = 'kumi-appendix';

export interface HeadingNumbering {
  /** List and level of every heading Word numbers; others keep their text. */
  levels: Map<string, { reference: string; level: number }>;
  config: Array<{ reference: string; levels: ILevelsOptions[] }>;
}

/**
 * Heading numbers become a Word multilevel list only when Word would count to
 * exactly the numbers shown in KUMI. Word cannot reproduce every arrangement
 * (a skipped level, or more than 26 appendices), and a number that silently
 * changes when the file is opened is worse than a fixed one.
 */
export function planHeadingNumbering(
  analysis: DocumentAnalysis,
  settings: ResolvedReportSettings,
  locale: AppLocale,
): HeadingNumbering | undefined {
  const levels: HeadingNumbering['levels'] = new Map();
  const counters = {
    [headingList]: [0, 0, 0, 0, 0, 0],
    [appendixList]: [0, 0, 0, 0, 0, 0],
  };
  let reference: keyof typeof counters = headingList;
  for (const target of analysis.outline) {
    if (target.headingKind === 'appendix') reference = appendixList;
    if (!target.number || !target.level) continue;
    const list = counters[reference];
    const level = target.level;
    if (list.slice(0, level - 1).some((count) => count === 0)) return undefined;
    list[level - 1]++;
    list.fill(0, level);
    if (reference === appendixList && list[0] > 26) return undefined;
    const first =
      reference === appendixList
        ? String.fromCharCode(64 + list[0])
        : String(list[0]);
    if ([first, ...list.slice(1, level)].join('.') !== target.number)
      return undefined;
    levels.set(target.nodeId, { reference, level: level - 1 });
  }
  if (!levels.size) return undefined;
  const chapter = settings.heading_numbering === 'chapter';
  const pattern = (level: number) =>
    Array.from({ length: level + 1 }, (_, index) => `%${index + 1}`).join('.');
  const list = (first: string, format: ILevelsOptions['format']) =>
    Array.from(
      { length: 6 },
      (_, level): ILevelsOptions => ({
        level,
        format: level === 0 ? format : LevelFormat.DECIMAL,
        text: level === 0 ? first : pattern(level),
        suffix: LevelSuffix.SPACE,
        style: { paragraph: { indent: { left: 0, hanging: 0 } } },
      }),
    );
  return {
    levels,
    config: [
      {
        reference: headingList,
        levels: list(
          chapter ? (locale === 'ja' ? '第%1章' : 'Chapter %1') : '%1',
          LevelFormat.DECIMAL,
        ),
      },
      {
        reference: appendixList,
        levels: list(
          locale === 'ja' ? '付録 %1' : 'Appendix %1',
          LevelFormat.UPPER_LETTER,
        ),
      },
    ],
  };
}

/** Name of the SEQ field Word counts captions with ("図", "Table", ...). */
export function sequenceName(
  type: 'figure' | 'table' | 'blockMath',
  locale: AppLocale,
): string {
  return (
    locale === 'ja'
      ? { figure: '図', table: '表', blockMath: '式' }
      : { figure: 'Figure', table: 'Table', blockMath: 'Equation' }
  )[type];
}
