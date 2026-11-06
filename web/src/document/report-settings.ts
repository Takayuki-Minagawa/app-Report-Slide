import { z } from 'zod';
import type { DocumentMetadata } from './model';

/** Optional keys keep documents created before report formatting readable. */
export const reportSettingsSchema = z.strictObject({
  cover: z.boolean().optional(),
  heading_numbering: z.enum(['section', 'chapter']).optional(),
  caption_numbering: z.enum(['continuous', 'chapter']).optional(),
  toc_depth: z.number().int().min(1).max(6).optional(),
  toc_page: z.boolean().optional(),
  toc_page_numbers: z.boolean().optional(),
  list_figures: z.boolean().optional(),
  list_tables: z.boolean().optional(),
  affiliation: z.string().max(200).optional(),
  recipient: z.string().max(200).optional(),
  report_number: z.string().max(100).optional(),
});

export type ReportSettings = z.infer<typeof reportSettingsSchema>;
export type ResolvedReportSettings = Required<ReportSettings>;

export const defaultReportSettings: ResolvedReportSettings = {
  cover: false,
  heading_numbering: 'section',
  caption_numbering: 'continuous',
  toc_depth: 6,
  toc_page: false,
  toc_page_numbers: false,
  list_figures: false,
  list_tables: false,
  affiliation: '',
  recipient: '',
  report_number: '',
};

/** Callers apply these settings only to Report; Slide preserves but ignores them. */
export function resolveReportSettings(
  metadata: DocumentMetadata,
): ResolvedReportSettings {
  const parsed = reportSettingsSchema.safeParse(metadata.report_settings);
  return parsed.success
    ? { ...defaultReportSettings, ...parsed.data }
    : { ...defaultReportSettings };
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
