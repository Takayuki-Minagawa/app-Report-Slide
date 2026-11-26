import { z } from 'zod';
import { reportCssIssues, safeReportCss } from '@/src/security/report-css';
import type { DocumentMetadata } from './model';
import { resolveDocumentTheme } from './metadata';
import { resolvePageSettings } from './page-settings';

/**
 * The page style as data. One definition produces both the CSS used by the
 * preview, HTML and PDF, and the named styles of the Word document, so the two
 * cannot drift apart. `css` remains for details only CSS can express; it does
 * not reach Word.
 */
const family = z.enum(['mincho', 'gothic']);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const points = z.number().min(6).max(48);
const spacing = z.number().min(0).max(72);

const textStyleSchema = z.strictObject({
  font: family.optional(),
  /** Points. */
  size: points.optional(),
  bold: z.boolean().optional(),
  color: color.optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  /** Points before and after the paragraph. */
  space_before: spacing.optional(),
  space_after: spacing.optional(),
});
type TextStyleInput = z.infer<typeof textStyleSchema>;

const fontName = z
  .string()
  .min(1)
  .max(60)
  // Font names are written into XML attributes and CSS; keep them plain.
  .regex(/^[\p{L}\p{N} ._-]+$/u);

export const reportStyleSchema = z.strictObject({
  body: z.strictObject({ font: family, color }).partial().optional(),
  headings: z
    .strictObject({
      h1: textStyleSchema,
      h2: textStyleSchema,
      h3: textStyleSchema,
      /** Space between the number and the title, in em. */
      number_gap: z.number().min(0).max(3),
      /** Rules, bars and backgrounds drawn by the theme. */
      decoration: z.boolean(),
    })
    .partial()
    .optional(),
  caption: textStyleSchema.optional(),
  table: z
    .strictObject({
      /** Points; applies to cells without their own border. */
      border_width: z.number().min(0).max(3),
      border_color: color,
      header_fill: z.union([color, z.literal('none')]),
      header_font: family,
      header_bold: z.boolean(),
      header_align: z.enum(['left', 'center', 'right']),
      font: family,
      size: points,
      zebra: z.boolean(),
    })
    .partial()
    .optional(),
  callout: z
    .strictObject({
      frame: z.enum(['bar', 'box']),
      title_font: family,
    })
    .partial()
    .optional(),
  equation: z.strictObject({ background: z.boolean() }).partial().optional(),
  /** Word cannot embed the web fonts, so each family maps to an installed font. */
  docx_fonts: z
    .strictObject({ mincho: fontName, gothic: fontName, latin: fontName })
    .partial()
    .optional(),
  css: z.string().optional(),
});

export type ReportStyleInput = z.infer<typeof reportStyleSchema>;
type FontFamily = z.infer<typeof family>;

export interface ResolvedTextStyle {
  font: FontFamily | null;
  size: number | null;
  bold: boolean | null;
  color: string | null;
  align: 'left' | 'center' | 'right' | null;
  space_before: number | null;
  space_after: number | null;
}

/** `null` means "as the earlier themes did": no CSS rule and Word's own default. */
export interface ResolvedReportStyle {
  body: { font: FontFamily; color: string | null };
  headings: {
    h1: ResolvedTextStyle;
    h2: ResolvedTextStyle;
    h3: ResolvedTextStyle;
    number_gap: number | null;
    decoration: boolean;
  };
  caption: ResolvedTextStyle;
  table: {
    border_width: number | null;
    border_color: string;
    header_fill: string | null;
    header_font: FontFamily | null;
    header_bold: boolean;
    header_align: 'left' | 'center' | 'right' | null;
    font: FontFamily | null;
    size: number | null;
    zebra: boolean;
  };
  callout: { frame: 'bar' | 'box'; title_font: FontFamily | null };
  equation: { background: boolean };
  docx_fonts: { mincho: string; gothic: string; latin: string | null };
}

const noText: ResolvedTextStyle = {
  font: null,
  size: null,
  bold: null,
  color: null,
  align: null,
  space_before: null,
  space_after: null,
};

/** Reproduces the constants Word export used before styles became data. */
const baseStyle: ResolvedReportStyle = {
  body: { font: 'mincho', color: null },
  headings: {
    h1: noText,
    h2: noText,
    h3: noText,
    number_gap: null,
    decoration: true,
  },
  caption: { ...noText, align: 'center', space_before: 4, space_after: 6 },
  table: {
    border_width: null,
    border_color: '#000000',
    header_fill: '#F1F5F9',
    header_font: null,
    header_bold: true,
    header_align: null,
    font: null,
    size: null,
    zebra: true,
  },
  callout: { frame: 'bar', title_font: null },
  equation: { background: true },
  docx_fonts: { mincho: 'Yu Mincho', gothic: 'Yu Gothic', latin: null },
};

const black = '#000000';
const jpHeading = (
  size: number | undefined,
  before: number,
  after: number,
): TextStyleInput => ({
  font: 'gothic',
  ...(size ? { size } : {}),
  bold: true,
  color: black,
  space_before: before,
  space_after: after,
});

/** Japanese technical report in the manner of a Word house style. */
const reportJp: ReportStyleInput = {
  body: { font: 'mincho', color: black },
  headings: {
    h1: jpHeading(14, 16, 8),
    h2: jpHeading(12, 14, 6),
    // The third level takes the body size, resolved from the page settings.
    h3: jpHeading(undefined, 10, 4),
    number_gap: 1,
    decoration: false,
  },
  caption: {
    font: 'mincho',
    size: 10,
    bold: false,
    color: black,
    align: 'center',
    space_before: 4,
    space_after: 4,
  },
  table: {
    border_width: 0.75,
    border_color: black,
    header_fill: 'none',
    header_font: 'gothic',
    header_bold: true,
    header_align: 'center',
    font: 'mincho',
    size: 9,
    zebra: false,
  },
  callout: { frame: 'box', title_font: 'gothic' },
  equation: { background: false },
  docx_fonts: {
    mincho: 'Yu Mincho',
    gothic: 'Yu Gothic',
    latin: 'Times New Roman',
  },
};

/** Details of the theme that only CSS can express (cover, contents, links). */
const reportJpCss = `
%P .document-renderer a,%P .document-renderer .preview-reference{color:inherit;text-decoration:none}
%P .document-renderer :is(ul,ol){padding-left:1.6em}
%P .document-renderer .preview-figure{margin-block:1em}
%P .document-renderer .preview-table-wrap{margin-block:1em}
%P .document-renderer .preview-table-wrap table{margin-inline:auto;line-height:1.5}
%P .preview-table-wrap :is(th,td){padding:.28em .55em;vertical-align:top}
%P .preview-table-wrap th{vertical-align:middle}
%P .report-cover{color:#000}
%P .report-cover-heading h1{font-family:'Noto Serif JP',serif;font-size:1.52em;font-weight:400;line-height:1.6;color:#000;border:0}
%P .report-cover-subtitle{font-size:1.14em;margin-top:1.2em;color:#000}
%P .report-cover-fields{font-size:1.14em}
%P .report-contents-page .document-toc{border:0;padding:0}
%P .report-contents-page .document-toc h2{font-family:'Noto Sans JP',sans-serif;font-size:1.33em;font-weight:700;letter-spacing:.5em;color:#000;border:0;padding:0;margin:0 0 1em;background:none}
%P .report-contents-page .document-toc ol{padding:0;margin:0;list-style:none}
%P .report-contents-page .document-toc li{line-height:1.45;margin:0 0 .2em}
%P .report-contents-page .document-toc li[data-toc-level='1']{font-family:'Noto Sans JP',sans-serif;font-weight:700;margin-top:.55em}
%P .report-contents-page .document-toc li:not([data-toc-level='1']){padding-left:2.2em!important}
%P .report-contents-page .document-toc a{color:#000;text-decoration:none}
%P .report-contents-page .document-toc li[data-toc-level='1'] .kumi-toc-leader{border-bottom-color:transparent}
%P .report-contents-page .kumi-toc-leader{border-bottom:1px dotted #000;margin:0 .4em .35em}
.kumi-physical-footer{color:#000}
`;

const themeStyles: Record<string, { style: ReportStyleInput; css: string }> = {
  'report-jp': { style: reportJp, css: reportJpCss },
};

function mergeInput(
  first: ReportStyleInput,
  second: ReportStyleInput,
): ReportStyleInput {
  const text = (a?: TextStyleInput, b?: TextStyleInput) =>
    a || b ? { ...a, ...b } : undefined;
  const defined = <T extends object>(value: T): T =>
    Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined),
    ) as T;
  return defined({
    body:
      first.body || second.body ? { ...first.body, ...second.body } : undefined,
    headings:
      first.headings || second.headings
        ? defined({
            ...first.headings,
            ...second.headings,
            h1: text(first.headings?.h1, second.headings?.h1),
            h2: text(first.headings?.h2, second.headings?.h2),
            h3: text(first.headings?.h3, second.headings?.h3),
          })
        : undefined,
    caption: text(first.caption, second.caption),
    table:
      first.table || second.table
        ? { ...first.table, ...second.table }
        : undefined,
    callout:
      first.callout || second.callout
        ? { ...first.callout, ...second.callout }
        : undefined,
    equation:
      first.equation || second.equation
        ? { ...first.equation, ...second.equation }
        : undefined,
    docx_fonts:
      first.docx_fonts || second.docx_fonts
        ? { ...first.docx_fonts, ...second.docx_fonts }
        : undefined,
  });
}

function readInput(metadata: DocumentMetadata): ReportStyleInput {
  const parsed = reportStyleSchema.safeParse(metadata.report_style);
  return parsed.success ? parsed.data : {};
}

/** Theme and document values that are written as CSS; earlier themes add none. */
function styleInput(metadata: DocumentMetadata): {
  input: ReportStyleInput;
  themeCss: string;
} {
  const theme = themeStyles[resolveDocumentTheme('report', metadata.theme)];
  const { css: _css, ...own } = readInput(metadata);
  const input = mergeInput(theme?.style ?? {}, own);
  // "Same size as the body" follows the page settings instead of a constant.
  if (theme && input.headings?.h3 && input.headings.h3.size === undefined)
    input.headings.h3.size = resolvePageSettings(metadata).font_size;
  return { input, themeCss: theme?.css ?? '' };
}

export function resolveReportStyle(
  metadata: DocumentMetadata,
): ResolvedReportStyle {
  const { input } = styleInput(metadata);
  const text = (
    base: ResolvedTextStyle,
    value?: TextStyleInput,
  ): ResolvedTextStyle => ({ ...base, ...value });
  return {
    body: { ...baseStyle.body, ...input.body },
    headings: {
      h1: text(baseStyle.headings.h1, input.headings?.h1),
      h2: text(baseStyle.headings.h2, input.headings?.h2),
      h3: text(baseStyle.headings.h3, input.headings?.h3),
      number_gap: input.headings?.number_gap ?? baseStyle.headings.number_gap,
      decoration: input.headings?.decoration ?? baseStyle.headings.decoration,
    },
    caption: text(baseStyle.caption, input.caption),
    table: {
      ...baseStyle.table,
      ...input.table,
      header_fill:
        input.table?.header_fill === undefined
          ? baseStyle.table.header_fill
          : input.table.header_fill === 'none'
            ? null
            : input.table.header_fill,
    },
    callout: { ...baseStyle.callout, ...input.callout },
    equation: { ...baseStyle.equation, ...input.equation },
    docx_fonts: { ...baseStyle.docx_fonts, ...input.docx_fonts },
  };
}

const cssFonts: Record<FontFamily, string> = {
  mincho: "'Noto Serif JP','Yu Mincho','Hiragino Mincho ProN',serif",
  gothic: "'Noto Sans JP','Yu Gothic','Hiragino Sans',sans-serif",
};

/**
 * CSS for everything the style data specifies. Sizes are relative to the body
 * size, so the scaled preview keeps the proportions of the printed page.
 */
export function reportStyleCss(metadata: DocumentMetadata): string {
  const { input, themeCss } = styleInput(metadata);
  const body = resolvePageSettings(metadata).font_size;
  const P = '.report-preview[data-theme]';
  const D = `${P} .document-renderer`;
  const rules: string[] = [];
  const rule = (selector: string, declarations: Array<string | false>) => {
    const list = declarations.filter(Boolean);
    if (list.length) rules.push(`${selector}{${list.join(';')}}`);
  };
  const em = (value: number, base: number) =>
    `${Math.round((value / base) * 1000) / 1000}em`;
  const text = (value: TextStyleInput | undefined, inherited = body) => {
    if (!value) return [];
    const size = value.size ?? inherited;
    return [
      value.font !== undefined && `font-family:${cssFonts[value.font]}`,
      value.size !== undefined && `font-size:${em(value.size, body)}`,
      value.bold !== undefined && `font-weight:${value.bold ? 700 : 400}`,
      value.color !== undefined && `color:${value.color}`,
      value.align !== undefined && `text-align:${value.align}`,
      value.space_before !== undefined &&
        `margin-top:${em(value.space_before, size)}`,
      value.space_after !== undefined &&
        `margin-bottom:${em(value.space_after, size)}`,
    ];
  };
  if (input.body) {
    rule(P, [
      input.body.font !== undefined &&
        `font-family:${cssFonts[input.body.font]}`,
      input.body.color !== undefined && `color:${input.body.color}`,
    ]);
    rule(`${D} :is(p,li)`, [
      input.body.color !== undefined && `color:${input.body.color}`,
    ]);
  }
  const headings = input.headings;
  if (headings) {
    if (headings.decoration === false) {
      rule(`${D} :is(h1,h2,h3)`, [
        'border:0',
        'padding:0',
        'background:none',
        'line-height:1.5',
        'letter-spacing:0',
      ]);
      rule(`${D} :is(h1,h2,h3)::before,${D} :is(h1,h2,h3)::after`, [
        'content:none',
        'display:none',
      ]);
    }
    for (const level of ['h1', 'h2', 'h3'] as const)
      rule(`${D} ${level}`, text(headings[level]));
    if (headings.number_gap !== undefined)
      rule(`${D} :is(h1,h2,h3,h4,h5,h6) .section-separator`, [
        'display:inline-block',
        `width:${headings.number_gap}em`,
        'overflow:hidden',
        'white-space:pre',
      ]);
  }
  rule(`${D} :is(figcaption,caption)`, text(input.caption));
  const table = input.table;
  if (table) {
    rule(`${D} .preview-table-wrap table`, [
      table.border_width !== undefined && 'border-collapse:collapse',
      table.size !== undefined && `font-size:${em(table.size, body)}`,
    ]);
    rule(`${P} .preview-table-wrap :is(th,td)`, [
      table.border_width !== undefined &&
        `border:${table.border_width}pt solid ${table.border_color ?? black}`,
      table.border_width === undefined &&
        table.border_color !== undefined &&
        `border-color:${table.border_color}`,
    ]);
    rule(`${P} .preview-table-wrap th`, [
      table.header_fill !== undefined &&
        `background:${table.header_fill === 'none' ? 'none' : table.header_fill}`,
      table.header_font !== undefined &&
        `font-family:${cssFonts[table.header_font]}`,
      table.header_bold !== undefined &&
        `font-weight:${table.header_bold ? 700 : 400}`,
      table.header_align !== undefined && `text-align:${table.header_align}`,
      input.body?.color !== undefined && `color:${input.body.color}`,
    ]);
    rule(
      `${P} .preview-table-wrap td,${P} .preview-table-wrap td :is(p,span)`,
      [table.font !== undefined && `font-family:${cssFonts[table.font]}`],
    );
    if (table.zebra === false)
      rule(`${P} .preview-table-wrap tbody tr:nth-child(even) td`, [
        'background:none',
      ]);
  }
  if (input.callout?.frame === 'box') {
    rule(`${D} blockquote,${D} blockquote[data-callout]`, [
      'background:none',
      'border:.75pt solid currentColor',
      'border-radius:0',
      'padding:.5em .8em',
      'margin:.8em 0',
      'color:inherit',
    ]);
    rule(`${D} blockquote .callout-title`, [
      'color:inherit',
      'margin:0 0 .2em',
    ]);
  }
  if (input.callout?.title_font !== undefined)
    rule(`${D} blockquote .callout-title`, [
      `font-family:${cssFonts[input.callout.title_font]}`,
      'font-weight:700',
    ]);
  if (input.equation?.background === false) {
    rule(`${D} :is(.equation-body,.preview-equation,.numbered-equation)`, [
      'background:none',
      'border:0',
      'box-shadow:none',
    ]);
    rule(`${D} .numbered-equation`, ['margin:.6em 0']);
    rule(`${D} :is(.equation-body,.preview-equation)`, [
      'min-height:0',
      'height:auto',
      'padding:0',
      'margin:0',
    ]);
    rule(`${D} .katex-display`, ['margin:.4em 0']);
  }
  return [...rules, themeCss.replaceAll('%P ', `${P} `).trim()]
    .filter(Boolean)
    .join('\n');
}

/** Theme and data CSS followed by the document's own CSS, which wins. */
export function reportDocumentCss(metadata: DocumentMetadata): string {
  return [reportStyleCss(metadata), reportCustomCss(metadata)]
    .filter(Boolean)
    .join('\n');
}

export function reportCustomCss(metadata: DocumentMetadata): string {
  const style = metadata.report_style;
  return style && typeof style === 'object' && !Array.isArray(style)
    ? safeReportCss(style.css)
    : '';
}

/** True when part of the appearance cannot be carried into Word. */
export function hasCssOnlyStyle(metadata: DocumentMetadata): boolean {
  return reportCustomCss(metadata).trim().length > 0;
}

export function reportStyleIssues(value: unknown): string[] {
  if (value === undefined) return [];
  const parsed = reportStyleSchema.safeParse(value);
  if (!parsed.success)
    return parsed.error.issues.map(
      (issue) =>
        `report_style${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
    );
  return parsed.data.css === undefined
    ? []
    : reportCssIssues(parsed.data.css).map(
        (issue) => `report_style.css: ${issue}`,
      );
}
