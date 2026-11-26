import { z } from 'zod';
import { calloutTypes, type DocumentMetadata } from './model';

// oxlint-disable-next-line no-control-regex -- Settings are printed on every page; reject control characters.
const printable = (value: string) => !/[\u0000-\u001f\u007f]/.test(value);

/** `{n}` is required; `{total}` is the number of body pages. */
const pageNumberFormat = z
  .string()
  .max(40)
  .refine(
    (value) =>
      printable(value) &&
      value.includes('{n}') &&
      !/[{}]/.test(value.replaceAll('{n}', '').replaceAll('{total}', '')),
    { message: 'ページ番号の書式には {n} を含めてください（例: - {n} -）。' },
  );

const calloutLabelsSchema = z.strictObject(
  Object.fromEntries(
    calloutTypes.map((type) => [
      type,
      z.string().max(40).refine(printable).optional(),
    ]),
  ) as Record<(typeof calloutTypes)[number], z.ZodOptional<z.ZodString>>,
);

/** Optional keys keep documents created before report formatting readable. */
export const reportSettingsSchema = z.strictObject({
  cover: z.boolean().optional(),
  cover_layout: z.enum(['fields', 'centered']).optional(),
  heading_numbering: z.enum(['section', 'chapter']).optional(),
  caption_numbering: z.enum(['continuous', 'chapter']).optional(),
  /** `auto` keeps the behaviour of each heading format: letters for chapters only. */
  appendix_numbering: z.enum(['auto', 'letter', 'continue']).optional(),
  number_depth: z.number().int().min(1).max(6).optional(),
  caption_separator: z.string().min(1).max(8).refine(printable).optional(),
  toc_depth: z.number().int().min(1).max(6).optional(),
  toc_page: z.boolean().optional(),
  toc_page_numbers: z.boolean().optional(),
  toc_title: z.string().max(40).refine(printable).optional(),
  page_number_format: pageNumberFormat.optional(),
  toc_page_number_format: pageNumberFormat.optional(),
  page_number_position: z.enum(['bottom-right', 'bottom-center']).optional(),
  front_matter_page_numbers: z.enum(['none', 'roman']).optional(),
  keep_tables: z.enum(['never', 'auto', 'always']).optional(),
  callout_labels: calloutLabelsSchema.optional(),
  /** Word output: numbers, references and contents as fields Word can update. */
  word_fields: z.boolean().optional(),
  list_figures: z.boolean().optional(),
  list_tables: z.boolean().optional(),
  affiliation: z.string().max(200).optional(),
  recipient: z.string().max(200).optional(),
  report_number: z.string().max(100).optional(),
});

export type ReportSettings = z.infer<typeof reportSettingsSchema>;
export type ResolvedReportSettings = Required<
  Omit<ReportSettings, 'toc_page_number_format'>
> & {
  /** Resolved to `page_number_format` when not set separately. */
  toc_page_number_format: string;
};

export const defaultReportSettings: ResolvedReportSettings = {
  cover: false,
  cover_layout: 'fields',
  heading_numbering: 'section',
  caption_numbering: 'continuous',
  appendix_numbering: 'auto',
  number_depth: 6,
  caption_separator: ' — ',
  toc_depth: 6,
  toc_page: false,
  toc_page_numbers: false,
  toc_title: '',
  page_number_format: '{n}',
  toc_page_number_format: '{n}',
  page_number_position: 'bottom-right',
  front_matter_page_numbers: 'none',
  keep_tables: 'never',
  callout_labels: {},
  word_fields: false,
  list_figures: false,
  list_tables: false,
  affiliation: '',
  recipient: '',
  report_number: '',
};

/**
 * A theme may replace defaults. An explicit setting always takes precedence, and
 * documents using the earlier themes resolve exactly as before.
 */
export const themeReportSettings: Record<string, Partial<ReportSettings>> = {
  'report-jp': {
    cover_layout: 'centered',
    page_number_format: '- {n} -',
    page_number_position: 'bottom-center',
  },
};

export function themeDefaultReportSettings(
  theme: unknown,
): ResolvedReportSettings {
  const overrides =
    typeof theme === 'string' && Object.hasOwn(themeReportSettings, theme)
      ? themeReportSettings[theme]
      : {};
  const merged = { ...defaultReportSettings, ...overrides };
  return {
    ...merged,
    toc_page_number_format:
      overrides.toc_page_number_format ?? merged.page_number_format,
  };
}

/** Callers apply these settings only to Report; Slide preserves but ignores them. */
export function resolveReportSettings(
  metadata: DocumentMetadata,
): ResolvedReportSettings {
  const defaults = themeDefaultReportSettings(metadata.theme);
  const parsed = reportSettingsSchema.safeParse(metadata.report_settings);
  if (!parsed.success) return defaults;
  const merged = { ...defaults, ...parsed.data };
  return {
    ...merged,
    toc_page_number_format:
      parsed.data.toc_page_number_format ?? merged.page_number_format,
  };
}

const formattingKeys = [
  'cover_layout',
  'appendix_numbering',
  'number_depth',
  'caption_separator',
  'toc_title',
  'page_number_format',
  'toc_page_number_format',
  'page_number_position',
  'front_matter_page_numbers',
  'keep_tables',
  'callout_labels',
  'word_fields',
] as const;

/**
 * Settings as stored after editing: a formatting value equal to the default of
 * the theme is left out, so the document keeps following its theme and files
 * that never used these settings stay byte-for-byte as before.
 */
export function storedReportSettings(
  settings: ResolvedReportSettings,
  theme: unknown,
): ReportSettings {
  const defaults = themeDefaultReportSettings(theme);
  const stored: Record<string, unknown> = { ...settings };
  const labels = Object.fromEntries(
    Object.entries(settings.callout_labels).filter(
      ([, label]) => label !== undefined,
    ),
  );
  stored.callout_labels = labels;
  for (const key of formattingKeys) {
    const fallback =
      key === 'toc_page_number_format'
        ? settings.page_number_format
        : defaults[key];
    if (JSON.stringify(stored[key]) === JSON.stringify(fallback))
      delete stored[key];
  }
  return stored as ReportSettings;
}

/** Letters apply to chapters by default; plain section numbers continue as before. */
export function usesAppendixLetters(
  settings: Pick<
    ResolvedReportSettings,
    'appendix_numbering' | 'heading_numbering'
  >,
): boolean {
  return settings.appendix_numbering === 'auto'
    ? settings.heading_numbering === 'chapter'
    : settings.appendix_numbering === 'letter';
}

export function reportSettingsIssues(value: unknown): string[] {
  if (value === undefined) return [];
  const parsed = reportSettingsSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) =>
          `report_settings${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      );
}
