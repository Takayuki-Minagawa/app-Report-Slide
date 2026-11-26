import {
  AlignmentType,
  type IParagraphStyleOptions,
  type IRunStylePropertiesOptions,
  type IStylesOptions,
} from 'docx';
import type { PageSettings } from '@/src/document/page-settings';
import type {
  ResolvedReportStyle,
  ResolvedTextStyle,
} from '@/src/document/report-style';
import type { ResolvedReportSettings } from '@/src/document/report-settings';
import type { AppLocale } from '@/src/i18n/messages';

/**
 * Every recurring appearance is a named style, so a reader can restyle the
 * whole document in Word and added paragraphs keep the house style.
 *
 * Headings, captions and contents entries deliberately replace Word's built-in
 * styles of the same purpose: the navigation pane, "Insert caption" and a
 * refreshed table of contents then keep using the report's formatting. The
 * remaining styles carry a "KUMI" prefix and cannot collide with a built-in
 * name in any language version of Word.
 */
export const styleIds = {
  caption: 'Caption',
  tableText: 'KumiTableText',
  tableHeader: 'KumiTableHeader',
  callout: 'KumiCallout',
  calloutTitle: 'KumiCalloutTitle',
  coverTitle: 'KumiCoverTitle',
  coverSubtitle: 'KumiCoverSubtitle',
  coverText: 'KumiCoverText',
  contentsTitle: 'KumiContentsTitle',
  code: 'KumiCode',
  equation: 'KumiEquation',
  appendixHeading: 'KumiAppendixHeading1',
  contents: (level: number) => `TOC${Math.min(Math.max(level, 1), 9)}`,
} as const;

export const pointsToTwips = (points: number) => Math.round(points * 20);
const halfPoints = (points: number) => Math.round(points * 2);
export const hex = (color: string) => color.replace(/^#/, '').toUpperCase();
const mmToTwips = (millimetres: number) =>
  Math.round((millimetres * 1440) / 25.4);

type Fonts = NonNullable<IRunStylePropertiesOptions['font']>;

/** East Asian and Latin fonts are separate attributes in Word. */
export function wordFont(
  style: ResolvedReportStyle,
  family: 'mincho' | 'gothic',
  locale: AppLocale,
): Fonts {
  const { mincho, gothic, latin } = style.docx_fonts;
  if (family === 'gothic')
    return { ascii: gothic, hAnsi: gothic, eastAsia: gothic, cs: gothic };
  // Without a Latin font the earlier single-font output is kept unchanged.
  if (!latin) return locale === 'ja' ? mincho : 'Times New Roman';
  return { ascii: latin, hAnsi: latin, eastAsia: mincho, cs: latin };
}

function textRun(
  style: ResolvedReportStyle,
  text: ResolvedTextStyle,
  locale: AppLocale,
): IRunStylePropertiesOptions {
  return {
    ...(text.font ? { font: wordFont(style, text.font, locale) } : {}),
    ...(text.size !== null ? { size: halfPoints(text.size) } : {}),
    ...(text.bold !== null ? { bold: text.bold } : {}),
    ...(text.color ? { color: hex(text.color) } : {}),
  };
}

const alignments = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const;

function textSpacing(text: ResolvedTextStyle) {
  return text.space_before !== null || text.space_after !== null
    ? {
        spacing: {
          ...(text.space_before !== null
            ? { before: pointsToTwips(text.space_before) }
            : {}),
          ...(text.space_after !== null
            ? { after: pointsToTwips(text.space_after) }
            : {}),
        },
      }
    : {};
}

export function buildStyles(
  style: ResolvedReportStyle,
  page: PageSettings,
  report: ResolvedReportSettings,
  locale: AppLocale,
  bodyWidth: number,
): IStylesOptions {
  const body = wordFont(style, style.body.font, locale);
  const heading = (text: ResolvedTextStyle) => ({
    // An empty run would discard the library's own heading sizes and colours.
    ...(Object.keys(textRun(style, text, locale)).length
      ? { run: textRun(style, text, locale) }
      : {}),
    paragraph: {
      keepNext: true,
      ...textSpacing(text),
      ...(text.align ? { alignment: alignments[text.align] } : {}),
    },
  });
  // Deeper headings follow the third level when the style defines one.
  const deep = {
    ...style.headings.h3,
    size: style.headings.h3.size === null ? null : page.font_size,
  };
  const boxed = style.callout.frame === 'box';
  const centred = report.cover_layout === 'centered';
  const contentsIndent =
    style.contents.indent === null ? 240 : mmToTwips(style.contents.indent);
  const paragraphStyles: IParagraphStyleOptions[] = [
    {
      id: styleIds.caption,
      name: 'caption',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      run: {
        ...textRun(style, style.caption, locale),
        // Half a point below the body, as the earlier export wrote directly.
        size:
          style.caption.size !== null
            ? halfPoints(style.caption.size)
            : halfPoints(page.font_size) - 1,
      },
      paragraph: {
        alignment: alignments[style.caption.align ?? 'center'],
        ...textSpacing(style.caption),
      },
    },
    {
      id: styleIds.tableText,
      name: 'KUMI Table Text',
      basedOn: 'Normal',
      quickFormat: true,
      run: {
        ...(style.table.font
          ? { font: wordFont(style, style.table.font, locale) }
          : {}),
        ...(style.table.size !== null
          ? { size: halfPoints(style.table.size) }
          : {}),
      },
      paragraph: style.table.compact
        ? { spacing: { before: 0, after: 0, line: 300 } }
        : {},
    },
    {
      id: styleIds.tableHeader,
      name: 'KUMI Table Header',
      basedOn: styleIds.tableText,
      next: styleIds.tableText,
      quickFormat: true,
      run: {
        bold: style.table.header_bold,
        ...(style.table.header_font
          ? { font: wordFont(style, style.table.header_font, locale) }
          : {}),
      },
      paragraph: style.table.header_align
        ? { alignment: alignments[style.table.header_align] }
        : {},
    },
    {
      id: styleIds.callout,
      name: 'KUMI Callout',
      basedOn: 'Normal',
      quickFormat: true,
      // A boxed note is a one-cell table; its text sits close together.
      paragraph: boxed ? { spacing: { before: 0, after: 0 } } : {},
    },
    {
      id: styleIds.calloutTitle,
      name: 'KUMI Callout Title',
      basedOn: styleIds.callout,
      next: styleIds.callout,
      quickFormat: true,
      run: {
        bold: true,
        ...(style.callout.title_font
          ? { font: wordFont(style, style.callout.title_font, locale) }
          : {}),
      },
      paragraph: { keepNext: true },
    },
    {
      id: styleIds.coverTitle,
      name: 'KUMI Cover Title',
      basedOn: 'Normal',
      next: styleIds.coverText,
      quickFormat: true,
      run: centred
        ? { size: halfPoints(page.font_size * 1.52), bold: false }
        : { size: halfPoints(page.font_size) * 2, bold: true },
      paragraph: {
        alignment: AlignmentType.CENTER,
        spacing: centred
          ? { before: mmToTwips(45), after: 240 }
          : { before: 1440, after: 360 },
      },
    },
    {
      id: styleIds.coverSubtitle,
      name: 'KUMI Cover Subtitle',
      basedOn: 'Normal',
      next: styleIds.coverText,
      quickFormat: true,
      run: centred ? { size: halfPoints(page.font_size * 1.14) } : {},
      paragraph: {
        alignment: AlignmentType.CENTER,
        spacing: { after: centred ? mmToTwips(22) : 240 },
      },
    },
    {
      id: styleIds.coverText,
      name: 'KUMI Cover Text',
      basedOn: 'Normal',
      quickFormat: true,
      run: centred ? { size: halfPoints(page.font_size * 1.14) } : {},
      paragraph: {
        alignment: AlignmentType.CENTER,
        spacing: { after: centred ? mmToTwips(12) : 240 },
      },
    },
    {
      id: styleIds.contentsTitle,
      name: 'KUMI Contents Title',
      // Looks like a second-level heading, but stays out of the contents itself.
      basedOn: 'Heading2',
      next: 'Normal',
      quickFormat: true,
      run: style.contents.level1_font
        ? {
            font: wordFont(style, style.contents.level1_font, locale),
            size: halfPoints(style.headings.h1.size ?? page.font_size * 1.33),
            bold: true,
            color: hex(style.body.color ?? '#000000'),
            characterSpacing: 60,
          }
        : {},
      paragraph: { keepNext: true, outlineLevel: 9, spacing: { after: 240 } },
    },
    {
      id: styleIds.code,
      name: 'KUMI Code',
      basedOn: 'Normal',
      quickFormat: true,
      run: { font: 'Courier New' },
      paragraph: {
        shading: { fill: 'F1F5F9' },
        spacing: { before: 0, after: 0, line: 240 },
      },
    },
    {
      id: styleIds.equation,
      name: 'KUMI Equation',
      basedOn: 'Normal',
      next: 'Normal',
      quickFormat: true,
      paragraph: { alignment: AlignmentType.CENTER },
    },
    {
      id: styleIds.appendixHeading,
      name: 'KUMI Appendix Heading 1',
      basedOn: 'Heading1',
      next: 'Normal',
      quickFormat: true,
      paragraph: { outlineLevel: 0 },
    },
    ...Array.from({ length: 6 }, (_, index): IParagraphStyleOptions => {
      const level = index + 1;
      const first = level === 1;
      return {
        id: styleIds.contents(level),
        name: `toc ${level}`,
        basedOn: 'Normal',
        next: 'Normal',
        quickFormat: true,
        run: first
          ? {
              ...(style.contents.level1_bold ? { bold: true } : {}),
              ...(style.contents.level1_font
                ? { font: wordFont(style, style.contents.level1_font, locale) }
                : {}),
            }
          : {},
        paragraph: {
          indent: {
            left:
              style.contents.indent === null
                ? (level - 1) * contentsIndent
                : first
                  ? 0
                  : contentsIndent,
          },
          ...(report.toc_page_numbers
            ? {
                tabStops: [
                  {
                    type: 'right' as const,
                    position: bodyWidth,
                    ...(first && !style.contents.level1_leader
                      ? {}
                      : { leader: 'dot' as const }),
                  },
                ],
              }
            : {}),
        },
      };
    }),
  ];
  return {
    default: {
      document: {
        run: {
          font: body,
          size: halfPoints(page.font_size),
          ...(style.body.color ? { color: hex(style.body.color) } : {}),
        },
        paragraph: {
          spacing: {
            line: Math.round(page.line_height * 240),
            after: page.paragraph_spacing * 20,
          },
        },
      },
      heading1: heading(style.headings.h1),
      heading2: heading(style.headings.h2),
      heading3: heading(style.headings.h3),
      heading4: heading(deep),
      heading5: heading(deep),
      heading6: heading(deep),
    },
    paragraphStyles,
  };
}
