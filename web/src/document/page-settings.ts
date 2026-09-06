import { z } from 'zod';
import type { CSSProperties } from 'react';
import type { DocumentMetadata } from './model';

export const paperSizes = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  B5: [182, 257],
  Letter: [215.9, 279.4],
} as const;

export const pageNumberFields = {
  margin_top: { min: 0, max: 70, step: 1 },
  margin_bottom: { min: 0, max: 70, step: 1 },
  margin_left: { min: 0, max: 70, step: 1 },
  margin_right: { min: 0, max: 70, step: 1 },
  font_size: { min: 8, max: 24, step: 0.5 },
  first_line_indent: { min: 0, max: 8, step: 0.5 },
  line_height: { min: 1, max: 3, step: 0.05 },
  paragraph_spacing: { min: 0, max: 36, step: 0.5 },
} as const;

const range = (key: keyof typeof pageNumberFields) =>
  z.number().min(pageNumberFields[key].min).max(pageNumberFields[key].max);

export const pageSettingsSchema = z
  .strictObject({
    paper: z.enum(['A3', 'A4', 'A5', 'B5', 'Letter']),
    orientation: z.enum(['portrait', 'landscape']),
    margin_top: range('margin_top'),
    margin_bottom: range('margin_bottom'),
    margin_left: range('margin_left'),
    margin_right: range('margin_right'),
    font_size: range('font_size'),
    first_line_indent: range('first_line_indent'),
    line_height: range('line_height'),
    paragraph_spacing: range('paragraph_spacing'),
  })
  .refine(
    (settings) => {
      const [width, height] = pageDimensions(settings);
      return (
        width - settings.margin_left - settings.margin_right >= 40 &&
        height - settings.margin_top - settings.margin_bottom >= 40
      );
    },
    { message: '余白を除いた本文領域は幅・高さとも40 mm以上必要です。' },
  );

export type PageSettings = z.infer<typeof pageSettingsSchema>;

export const defaultPageSettings: PageSettings = {
  paper: 'A4',
  orientation: 'portrait',
  margin_top: 20,
  margin_bottom: 20,
  margin_left: 20,
  margin_right: 20,
  font_size: 10.5,
  first_line_indent: 0,
  line_height: 1.85,
  paragraph_spacing: 12,
};

export function pageDimensions(
  settings: Pick<PageSettings, 'paper' | 'orientation'>,
): readonly [number, number] {
  const [width, height] = paperSizes[settings.paper];
  return settings.orientation === 'landscape'
    ? [height, width]
    : [width, height];
}

/** Old documents may declare paper/orientation directly in Front Matter. */
export function resolvePageSettings(metadata: DocumentMetadata): PageSettings {
  const saved = pageSettingsSchema.safeParse(metadata.page_settings);
  if (saved.success) return saved.data;
  return {
    ...defaultPageSettings,
    paper:
      typeof metadata.paper === 'string' &&
      Object.hasOwn(paperSizes, metadata.paper)
        ? (metadata.paper as PageSettings['paper'])
        : 'A4',
    orientation:
      metadata.orientation === 'landscape' ? 'landscape' : 'portrait',
  };
}

export function pageSettingsIssues(value: unknown): string[] {
  if (value === undefined) return [];
  const result = pageSettingsSchema.safeParse(value);
  return result.success
    ? []
    : result.error.issues.map(
        (issue) =>
          `page_settings${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      );
}

/** Scale the entire sheet to the available width while retaining physical proportions. */
export function reportPageStyle(metadata: DocumentMetadata): CSSProperties {
  const settings = resolvePageSettings(metadata);
  const [width, height] = pageDimensions(settings);
  const mm = (value: number) => `${(100 * value) / width}cqw`;
  const pt = (value: number) => mm((value * 25.4) / 72);
  return {
    '--report-width': `${width}mm`,
    '--report-height': mm(height),
    '--report-top': mm(settings.margin_top),
    '--report-bottom': mm(settings.margin_bottom),
    '--report-left': mm(settings.margin_left),
    '--report-right': mm(settings.margin_right),
    '--report-font-size': pt(settings.font_size),
    '--report-indent': `${settings.first_line_indent}em`,
    '--report-line-height': settings.line_height,
    '--report-paragraph-spacing': pt(settings.paragraph_spacing),
  } as CSSProperties;
}
