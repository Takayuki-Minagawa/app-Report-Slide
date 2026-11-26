import {
  formatHeadingNumber,
  formatSemanticReference,
} from '@/src/i18n/diagnostics';
import { messages, type AppLocale } from '@/src/i18n/messages';
import type { CalloutType, DocumentMetadata } from './model';
import {
  resolveReportSettings,
  type ResolvedReportSettings,
} from './report-settings';
import type { SemanticTarget } from './semantics';

/**
 * The single place that turns numbers into the strings shown to readers.
 * Preview, HTML, PDF, Word and PowerPoint all call these functions, so a
 * separator or number format cannot differ between outputs.
 */
export { formatHeadingNumber, formatSemanticReference };

export const defaultCaptionSeparator = ' — ';

export interface CaptionParts {
  /** "図 1"; empty when the block has no number. */
  label: string;
  /** Present only between two non-empty parts. */
  separator: string;
  text: string;
}

export function captionParts(
  target: SemanticTarget | undefined,
  caption: string | null | undefined,
  locale: AppLocale,
  separator: string = defaultCaptionSeparator,
): CaptionParts {
  const label = target?.number ? formatSemanticReference(target, locale) : '';
  const text = caption ?? '';
  return { label, separator: label && text ? separator : '', text };
}

/** Joins the non-empty parts of a caption or a list-of-figures entry. */
export function joinCaption(
  parts: ReadonlyArray<string | null | undefined | false>,
  separator: string = defaultCaptionSeparator,
): string {
  return parts.filter(Boolean).join(separator);
}

/** The heading number followed by its separator, as one string for plain-text outputs. */
export const headingNumberSeparator = ' ';

export function headingPrefix(
  target: SemanticTarget | undefined,
  locale: AppLocale,
): string {
  return target?.number
    ? formatHeadingNumber(target, locale) + headingNumberSeparator
    : '';
}

export type PageNumberPart =
  | { type: 'text'; value: string }
  | { type: 'n' }
  | { type: 'total' };

/** Word needs the literal text and the two fields separately. */
export function pageNumberParts(format: string): PageNumberPart[] {
  return format
    .split(/(\{n\}|\{total\})/)
    .filter(Boolean)
    .map((value) =>
      value === '{n}'
        ? { type: 'n' }
        : value === '{total}'
          ? { type: 'total' }
          : { type: 'text', value },
    );
}

export function formatPageNumber(
  format: string,
  page: number | string,
  total: number | string = '',
): string {
  return pageNumberParts(format)
    .map((part) =>
      part.type === 'n'
        ? String(page)
        : part.type === 'total'
          ? String(total)
          : part.value,
    )
    .join('');
}

/** Lower-case Roman numerals for front matter (i, ii, iii, iv, ...). */
export function romanNumeral(value: number): string {
  if (!Number.isInteger(value) || value < 1 || value > 3999)
    return String(value);
  let remaining = value;
  let result = '';
  for (const [amount, symbol] of [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ] as const) {
    while (remaining >= amount) {
      result += symbol;
      remaining -= amount;
    }
  }
  return result;
}

const themeCalloutLabels: Record<
  string,
  Partial<Record<AppLocale, Record<CalloutType, string>>>
> = {
  'report-jp': {
    ja: {
      note: '（注）',
      tip: '（参考）',
      important: '【要点】',
      warning: '【留意】',
      caution: '【注意】',
    },
  },
};

/** An empty string means the callout is shown without a title. */
export function calloutLabel(
  type: CalloutType,
  locale: AppLocale,
  metadata: DocumentMetadata,
  settings: ResolvedReportSettings = resolveReportSettings(metadata),
): string {
  return (
    settings.callout_labels[type] ??
    themeCalloutLabels[String(metadata.theme)]?.[locale]?.[type] ??
    messages[locale].callout[type]
  );
}

const themeContentsTitles: Record<
  string,
  Partial<Record<AppLocale, string>>
> = { 'report-jp': { ja: '目 次' } };

export function contentsTitle(
  locale: AppLocale,
  metadata: DocumentMetadata,
  settings: ResolvedReportSettings = resolveReportSettings(metadata),
): string {
  return (
    settings.toc_title ||
    themeContentsTitles[String(metadata.theme)]?.[locale] ||
    messages[locale].preview.toc
  );
}
