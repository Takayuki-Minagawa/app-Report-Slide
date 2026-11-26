import { resolveChartPlot } from '@/src/document/chart';
import { tableFillTextColor } from '@/src/document/table-fill';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  NumberFormat,
  Packer,
  PageBreak,
  PageNumber,
  PageReference,
  PageOrientation,
  Paragraph,
  SectionType,
  SimpleField,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  Tab,
  TabStopType,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IPropertiesOptions,
  type ISectionOptions,
  type ISectionPropertiesOptions,
  type ITableCellBorders,
  type ParagraphChild,
} from 'docx';
import {
  documentTitle,
  type DocumentData,
  type DocumentNode,
  type InlineNode,
  type TableNode,
} from '@/src/document/model';
import {
  pageDimensions,
  resolvePageSettings,
} from '@/src/document/page-settings';
import {
  analyzeDocument,
  collectFootnotes,
  reportOutline,
  type SemanticTarget,
} from '@/src/document/semantics';
import { resolveReportSettings } from '@/src/document/report-settings';
import { hasReportBodyContent } from '@/src/document/report-pages';
import { isTextRuler } from '@/src/document/text-ruler';
import {
  paragraphAfterHeadingIds,
  resolveParagraphIndent,
} from '@/src/document/paragraph-format';
import { migrateDocumentData } from '@/src/document/validation';
import { localizeDiagnosticMessage } from '@/src/i18n/diagnostics';
import type { AppLocale } from '@/src/i18n/messages';
import {
  calloutLabel,
  captionParts,
  contentsTitle,
  formatSemanticReference,
  headingPrefix,
  joinCaption,
  pageNumberParts,
} from '@/src/document/format';
import {
  hasCssOnlyStyle,
  resolveReportStyle,
} from '@/src/document/report-style';
import { mathComponent } from './docx/math';
import {
  appendixList,
  planHeadingNumbering,
  sequenceName,
} from './docx/numbering';
import { buildStyles, hex, styleIds } from './docx/styles';
import { tableBorders, tableGrid } from './docx/table';
import type { AssetUrls } from '@/src/workspace/files';
import { prepareOfficeImages } from './office-images';
import { addOfficeFigureImages, officeFigureKey } from './office-figures';
import {
  figureReferences,
  figureSourceText,
  readFigureEdit,
} from '@/src/document/figure-edit';

const mmToTwips = (millimeters: number) =>
  Math.round((millimeters * 1440) / 25.4);
const twipsToPixels = (twips: number) => twips / 15;
const headings = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

const exportMessages = {
  ja: {
    required: 'Wordへの出力にはレポート文書が必要です。',
    math: '変換できない数式は、編集可能なLaTeXテキストとして出力しました。',
    cssOnly:
      '文書のカスタムCSS（report_style.css）はWordには反映されません。Wordにも反映する書式はreport_styleの項目で指定してください。',
    fields:
      '見出し番号・図表番号・参照・目次はWordのフィールドです。Wordで編集した後は、全体を選択してフィールドを更新してください。',
    fieldHeadings:
      'この文書の見出し番号はWordの段落番号では同じ値にならないため、出力時点の文字として出力しました。',
    fieldCaptions:
      '章ごとの図表番号はWordのフィールドにできないため、出力時点の文字として出力しました。',
    fieldContents:
      '目次から除外した見出しは、Wordで目次を更新すると目次に表示されます。',
    chart: 'グラフは全データを含む編集可能な表として出力しました。',
    numbering:
      '目次の項目・見出し番号・図表番号・参照は出力時点の値です。Wordで編集した後は必要に応じて修正してください。',
    contentsPageNumbers:
      '目次のページ番号はWordの組版後に更新するフィールドです。開くときに更新を許可してください。番号が空欄、または編集後に古い場合は、Wordで全体を選択してフィールドを更新してください。',
    label: 'ラベル',
    figures: '図目次',
    tables: '表目次',
    affiliation: '所属',
    recipient: '提出先',
    reportNumber: '報告書番号',
    emptyContents: '項目なし',
    indentation: '深い入れ子のインデントを本文幅に収まるように調整しました。',
  },
  en: {
    required: 'Word export requires a report document.',
    math: 'Equations that could not be converted were exported as editable LaTeX text.',
    cssOnly:
      'The custom CSS of the document (report_style.css) does not apply to Word. Use the report_style values for formatting that should also reach Word.',
    fields:
      'Heading and caption numbers, references and contents are Word fields. After editing in Word, select the document and update its fields.',
    fieldHeadings:
      'Word paragraph numbering cannot reproduce the heading numbers of this document, so they were exported as fixed text.',
    fieldCaptions:
      'Caption numbers by chapter cannot be Word fields and were exported as fixed text.',
    fieldContents:
      'Headings excluded from the contents will appear when the contents are updated in Word.',
    chart: 'Charts were exported as editable tables containing all their data.',
    numbering:
      'The table of contents entries, section and caption numbers, and references retain their exported values. Revise them as needed after editing in Word.',
    contentsPageNumbers:
      'Contents page numbers are fields updated after Word lays out the document. Allow field updates when opening it. If numbers are blank or outdated after editing, select the document in Word and update its fields.',
    label: 'Label',
    figures: 'List of figures',
    tables: 'List of tables',
    affiliation: 'Affiliation',
    recipient: 'Recipient',
    reportNumber: 'Report number',
    emptyContents: 'No entries',
    indentation: 'Deeply nested indentation was adjusted to fit the text area.',
  },
};

interface BlockContext {
  width: number;
  indent: number;
  depth: number;
  topLevel: boolean;
  numbering?: IParagraphOptions['numbering'];
  alignment?: IParagraphOptions['alignment'];
  color?: string;
  /** Named paragraph style for the direct paragraphs of a cell or callout. */
  style?: string;
  keepNext?: boolean;
}

/** Produce a real Word document, keeping text, lists and tables editable. */
export async function exportReportDocx(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ blob: Blob; warnings: string[] }> {
  const document = migrateDocumentData(source);
  const copy = exportMessages[locale];
  if (document.type !== 'report') throw new Error(copy.required);
  const { images } = await prepareOfficeImages(
    {
      ...document,
      children: document.children.filter(
        (node) => node.type !== 'speakerNotes',
      ),
    },
    assets,
    locale,
  );
  await addOfficeFigureImages(document, images);
  const settings = resolvePageSettings(document.metadata);
  const report = resolveReportSettings(document.metadata);
  const style = resolveReportStyle(document.metadata);
  const separator = report.caption_separator;
  const afterHeadingIds = paragraphAfterHeadingIds(document.children);
  const [pageWidth, pageHeight] = pageDimensions(settings);
  const bodyWidth = mmToTwips(
    pageWidth - settings.margin_left - settings.margin_right,
  );
  const bodyHeight = mmToTwips(
    pageHeight - settings.margin_top - settings.margin_bottom,
  );
  const analysis = analyzeDocument(document);
  const warnings = new Set(
    analysis.diagnostics.map((message) =>
      localizeDiagnosticMessage(message, locale),
    ),
  );
  if (hasCssOnlyStyle(document.metadata)) warnings.add(copy.cssOnly);
  const anchors = new Map(
    [...analysis.targets.keys()].map((id, index) => [id, `kumi_${index + 1}`]),
  );
  // Fields are opt-in: by default every number is the text shown in KUMI.
  const fields = report.word_fields;
  const headingNumbering = fields
    ? planHeadingNumbering(analysis, report, locale)
    : undefined;
  const captionFields = fields && report.caption_numbering === 'continuous';
  if (fields) {
    warnings.add(copy.fields);
    if (!headingNumbering && analysis.outline.some((target) => target.number))
      warnings.add(copy.fieldHeadings);
    if (
      !captionFields &&
      [...analysis.targets.values()].some(
        (target) => target.type !== 'heading' && target.number,
      )
    )
      warnings.add(copy.fieldCaptions);
  }
  /** True when Word itself keeps the number of this target up to date. */
  const isField = (target: SemanticTarget) =>
    target.type === 'heading'
      ? Boolean(headingNumbering?.levels.has(target.nodeId))
      : captionFields && Boolean(target.number);
  const staticNumber = (target: SemanticTarget) => {
    if (target.number && !isField(target)) warnings.add(copy.numbering);
  };
  function math(latex: string, display: boolean): ParagraphChild | undefined {
    try {
      return mathComponent(latex, display) as unknown as ParagraphChild;
    } catch {
      warnings.add(copy.math);
      return undefined;
    }
  }
  const footnotes = collectFootnotes(document.children);
  const footnoteIds = new Map(
    footnotes.map((node, index) => [node, index + 1]),
  );
  const numbering: NonNullable<
    IPropertiesOptions['numbering']
  >['config'][number][] = [];

  function nestedIndent(context: BlockContext, amount: number): number {
    const desired = context.indent + amount;
    const indent = Math.min(desired, Math.max(0, context.width - 720));
    if (indent !== desired) warnings.add(copy.indentation);
    return indent;
  }

  function image(
    source: string,
    alt: string,
    width: number,
    fullWidth = false,
  ): ImageRun {
    const prepared = images.get(source.trim());
    // Preparation rejects missing images. Never silently emit a blank image.
    if (!prepared) throw new Error(`Image not prepared: ${source}`);
    const scale = Math.min(
      twipsToPixels(width) / prepared.width,
      twipsToPixels(bodyHeight - 600) / prepared.height,
      fullWidth ? Infinity : 1,
    );
    return new ImageRun({
      data: prepared.data,
      type: prepared.type,
      transformation: {
        width: prepared.width * scale,
        height: prepared.height * scale,
      },
      altText: { title: alt, description: alt, name: alt || 'Image' },
    });
  }

  function inline(
    nodes: InlineNode[] | undefined,
    width: number,
    color?: string,
  ): ParagraphChild[] {
    return (nodes ?? []).flatMap((node): ParagraphChild[] => {
      switch (node.type) {
        case 'text': {
          const marks = node.marks ?? [];
          const run = new TextRun({
            text: node.text,
            color,
            bold: marks.some((mark) => mark.type === 'bold') || undefined,
            italics: marks.some((mark) => mark.type === 'italic'),
            strike: marks.some((mark) => mark.type === 'strike'),
            ...(marks.some((mark) => mark.type === 'code')
              ? {
                  font: 'Courier New',
                  color: '111827',
                  shading: { fill: 'F1F5F9' },
                }
              : {}),
          });
          const link = marks.find((mark) => mark.type === 'link')?.attrs?.href;
          return [
            link ? new ExternalHyperlink({ link, children: [run] }) : run,
          ];
        }
        case 'hardBreak':
          return [new TextRun({ break: 1 })];
        case 'inlineMath':
          return [
            math(node.attrs.latex, false) ??
              new TextRun({
                text: node.attrs.latex,
                font: 'Cambria Math',
                color,
              }),
          ];
        case 'inlineImage':
          return [image(node.attrs.src, node.attrs.alt, width)];
        case 'reference': {
          const target = analysis.labels.get(node.attrs.target);
          if (!target)
            return [new TextRun({ text: `[@${node.attrs.target}]`, color })];
          const text = formatSemanticReference(target, locale);
          if (isField(target) && target.number) {
            // The bookmark holds "図 1" for a caption, the number alone for an
            // equation, and the paragraph number for a heading.
            const anchor = anchors.get(target.nodeId)!;
            const numberOnly =
              target.type === 'blockMath' ||
              (target.type === 'heading' && target.headingKind === 'section');
            return [
              ...(numberOnly
                ? [
                    new TextRun({
                      text: text.slice(0, text.length - target.number.length),
                      color,
                    }),
                  ]
                : []),
              new SimpleField(
                `REF ${anchor} ${target.type === 'heading' ? '\\r ' : ''}\\h`,
                numberOnly ? target.number : text,
              ),
            ];
          }
          staticNumber(target);
          return [
            new InternalHyperlink({
              anchor: anchors.get(target.nodeId)!,
              children: [new TextRun({ text, color })],
            }),
          ];
        }
        case 'footnote':
          return [new FootnoteReferenceRun(footnoteIds.get(node)!)];
      }
    });
  }

  function paragraph(
    node: Extract<DocumentNode, { type: 'paragraph' | 'heading' }>,
    context: BlockContext,
  ): Paragraph {
    const ruler = node.attrs.textRuler;
    const rulerWidth = context.width - context.indent;
    const firstLineEm =
      node.type === 'paragraph'
        ? resolveParagraphIndent(node, settings, {
            topLevel: context.topLevel,
            afterHeading: afterHeadingIds.has(node.attrs.nodeId),
          }).em
        : isTextRuler(ruler)
          ? null
          : 0;
    const indent: NonNullable<IParagraphOptions['indent']> = {
      left:
        context.indent +
        (isTextRuler(ruler) ? Math.round((rulerWidth * ruler.left) / 100) : 0),
      ...(isTextRuler(ruler)
        ? { right: Math.round((rulerWidth * ruler.right) / 100) }
        : {}),
      ...(firstLineEm !== null
        ? { firstLine: Math.round(firstLineEm * settings.font_size * 20) }
        : isTextRuler(ruler)
          ? ruler.firstLine >= ruler.left
            ? {
                firstLine: Math.round(
                  (rulerWidth * (ruler.firstLine - ruler.left)) / 100,
                ),
              }
            : {
                hanging: Math.round(
                  (rulerWidth * (ruler.left - ruler.firstLine)) / 100,
                ),
              }
          : {}),
    };
    const target = analysis.targets.get(node.attrs.nodeId);
    // Word numbers the heading itself when the multilevel list reproduces it.
    const listLevel = target && headingNumbering?.levels.get(target.nodeId);
    const runs = [
      ...(target?.number && !listLevel
        ? [new TextRun(headingPrefix(target, locale))]
        : []),
      ...inline(node.content, rulerWidth, context.color),
    ];
    if (target) staticNumber(target);
    const appendixHeading =
      listLevel?.reference === appendixList && listLevel.level === 0;
    return new Paragraph({
      children: target
        ? [new Bookmark({ id: anchors.get(target.nodeId)!, children: runs })]
        : runs,
      heading:
        node.type === 'heading' && !appendixHeading
          ? headings[node.attrs.level - 1]
          : undefined,
      style: appendixHeading
        ? styleIds.appendixHeading
        : node.type === 'paragraph'
          ? context.style
          : undefined,
      indent: context.numbering
        ? { ...indent, hanging: 300, firstLine: undefined }
        : indent,
      numbering:
        context.numbering ??
        (listLevel ? { ...listLevel, custom: true } : undefined),
      alignment: context.alignment,
      // Headings keep with the next paragraph through their style.
      keepNext: context.keepNext || undefined,
      widowControl: true,
    });
  }

  function caption(node: DocumentNode, before = false): Paragraph[] {
    const target = analysis.targets.get(node.attrs.nodeId);
    const parts = captionParts(target, node.attrs.caption, locale, separator);
    const source =
      node.type === 'figure'
        ? figureSourceText(
            readFigureEdit(node.attrs.figureEdit),
            figureReferences(document.metadata),
          )
        : '';
    const text = joinCaption([parts.label, parts.text, source], separator);
    if (target) staticNumber(target);
    if (!text && !target) return [];
    let children: ParagraphChild[];
    if (target?.number && isField(target) && node.type !== 'blockMath') {
      // Only "図 1" is bookmarked, so a reference repeats the label and number.
      const rest = joinCaption(['', parts.text, source], separator);
      children = [
        new Bookmark({
          id: anchors.get(target.nodeId)!,
          children: [
            new TextRun(
              parts.label.slice(0, parts.label.length - target.number.length),
            ),
            new SimpleField(
              `SEQ ${sequenceName(node.type as 'figure' | 'table', locale)} \\* ARABIC`,
              target.number,
            ),
          ],
        }),
        ...(rest
          ? [new TextRun((parts.text || source ? separator : '') + rest)]
          : []),
      ];
    } else
      children = target
        ? [
            new Bookmark({
              id: anchors.get(target.nodeId)!,
              children: text ? [new TextRun(text)] : [],
            }),
          ]
        : [new TextRun(text)];
    return [
      new Paragraph({
        children,
        style: styleIds.caption,
        keepNext: before || undefined,
      }),
    ];
  }

  /** A display equation; its number sits at a right tab on the same line. */
  function equation(
    node: Extract<DocumentNode, { type: 'blockMath' }>,
    context: BlockContext,
  ): Paragraph[] {
    const target = analysis.targets.get(node.attrs.nodeId);
    const anchor = target && anchors.get(target.nodeId)!;
    const width = context.width - context.indent;
    const numbered = Boolean(target?.number);
    if (target) staticNumber(target);
    const body =
      math(node.attrs.latex, !numbered) ??
      new TextRun({ text: node.attrs.latex, font: 'Cambria Math' });
    const number =
      target?.number && isField(target)
        ? new SimpleField(
            `SEQ ${sequenceName('blockMath', locale)} \\* ARABIC`,
            target.number,
          )
        : new TextRun(target?.number ?? '');
    return [
      new Paragraph({
        style: styleIds.equation,
        indent: { left: context.indent },
        keepNext: Boolean(node.attrs.caption) || undefined,
        ...(numbered
          ? {
              alignment: AlignmentType.LEFT,
              tabStops: [
                { type: TabStopType.CENTER, position: Math.round(width / 2) },
                { type: TabStopType.RIGHT, position: width },
              ],
              children: [
                new TextRun({ children: [new Tab()] }),
                body,
                new TextRun({ children: [new Tab(), '('] }),
                new Bookmark({ id: anchor!, children: [number] }),
                new TextRun(')'),
              ],
            }
          : {
              children: anchor
                ? [new Bookmark({ id: anchor, children: [] }), body]
                : [body],
            }),
      }),
      ...(node.attrs.caption
        ? [
            new Paragraph({
              text: node.attrs.caption,
              style: styleIds.caption,
            }),
          ]
        : []),
    ];
  }

  function table(node: TableNode, context: BlockContext): Table {
    const available = context.width - context.indent;
    const { positions, widths: columnWidths } = tableGrid(node, available);
    const compact = style.table.compact;
    // keep_tables: a table that fits stays on one page; a long one still
    // breaks between rows and repeats its header rows.
    const rowHeight =
      (style.table.size ?? settings.font_size) *
        (compact ? 1.5 : settings.line_height) *
        20 +
      (compact ? 80 : 160 + settings.paragraph_spacing * 20);
    const keep =
      report.keep_tables === 'always' ||
      (report.keep_tables === 'auto' &&
        node.content.length * rowHeight <= bodyHeight / 2);
    const headerFill = style.table.header_fill
      ? hex(style.table.header_fill)
      : undefined;
    const rows = node.content.map(
      (row, rowIndex) =>
        new TableRow({
          tableHeader: Boolean(
            row.content?.length &&
            row.content.every((cell) => cell.type === 'tableHeader'),
          ),
          // A row is never divided between two pages.
          cantSplit: true,
          children: (row.content ?? []).map((cell) => {
            const position = positions.get(cell.attrs.nodeId)!;
            const span = cell.attrs.colspan ?? 1;
            const cellWidth = columnWidths
              .slice(position, position + span)
              .reduce((sum, width) => sum + width, 0);
            const borders: ITableCellBorders = Object.fromEntries(
              Object.entries(cell.attrs.borders ?? {}).map(([side, border]) => [
                side,
                border === null
                  ? { style: BorderStyle.NIL }
                  : {
                      style: {
                        solid: BorderStyle.SINGLE,
                        dashed: BorderStyle.DASHED,
                        dotted: BorderStyle.DOTTED,
                        double: BorderStyle.DOUBLE,
                      }[border.style],
                      color: border.color.slice(1),
                      size: border.width * 6,
                    },
              ]),
            );
            const header = cell.type === 'tableHeader';
            return new TableCell({
              columnSpan: span > 1 ? span : undefined,
              rowSpan: cell.attrs.rowspan,
              width: { size: cellWidth, type: WidthType.DXA },
              borders,
              shading: cell.attrs.fill
                ? { fill: cell.attrs.fill.slice(1) }
                : header && headerFill
                  ? { fill: headerFill }
                  : undefined,
              children: cell.content.map((child) =>
                paragraph(child, {
                  width: Math.max(300, cellWidth - 200),
                  indent: 0,
                  depth: 0,
                  topLevel: false,
                  alignment: cell.attrs.align ?? undefined,
                  style: header ? styleIds.tableHeader : styleIds.tableText,
                  color: tableFillTextColor(cell.attrs.fill)?.slice(1),
                  keepNext: keep && rowIndex < node.content.length - 1,
                }),
              ),
            });
          }),
        }),
    );
    return new Table({
      rows,
      columnWidths,
      layout: TableLayoutType.FIXED,
      width: {
        size: columnWidths.reduce((sum, width) => sum + width, 0),
        type: WidthType.DXA,
      },
      indent: { size: context.indent, type: WidthType.DXA },
      borders: tableBorders(style),
      margins: compact
        ? { top: 40, bottom: 40, left: 100, right: 100 }
        : { top: 80, bottom: 80, left: 100, right: 100 },
    });
  }

  function blocks(
    nodes: DocumentNode[],
    context: BlockContext,
  ): Array<Paragraph | Table> {
    return nodes.flatMap((node): Array<Paragraph | Table> => {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
          return [paragraph(node, context)];
        case 'pageBreak':
        case 'slideBreak':
          return [
            new Paragraph({
              children: [new PageBreak()],
              spacing: { before: 0, after: 0 },
            }),
          ];
        case 'speakerNotes':
          return [];
        case 'bulletList':
        case 'orderedList': {
          const reference = `list_${numbering.length + 1}`;
          const level = Math.min(context.depth, 8);
          const indent = nestedIndent(context, 540);
          if (context.depth > 8) warnings.add(copy.indentation);
          numbering.push({
            reference,
            levels: Array.from({ length: level + 1 }, (_, index) => ({
              level: index,
              format:
                node.type === 'orderedList'
                  ? LevelFormat.DECIMAL
                  : LevelFormat.BULLET,
              text: node.type === 'orderedList' ? `%${index + 1}.` : '•',
              start:
                node.type === 'orderedList' && index === level
                  ? node.attrs.start
                  : 1,
              style: {
                paragraph: { indent: { left: indent, hanging: 300 } },
              },
            })),
          });
          return node.content.flatMap((item) => {
            const first = item.content[0];
            const next = {
              ...context,
              depth: context.depth + 1,
              indent,
              numbering: undefined,
              topLevel: false,
            };
            const numbered = { ...next, numbering: { reference, level } };
            return first &&
              (first.type === 'paragraph' || first.type === 'heading')
              ? [
                  paragraph(first, numbered),
                  ...blocks(item.content.slice(1), next),
                ]
              : [
                  new Paragraph({ numbering: numbered.numbering }),
                  ...blocks(item.content, next),
                ];
          });
        }
        case 'listItem':
          return blocks(node.content, { ...context, topLevel: false });
        case 'blockquote': {
          const label = node.attrs.callout
            ? calloutLabel(
                node.attrs.callout,
                locale,
                document.metadata,
                report,
              )
            : '';
          const title = (indent: number) =>
            label
              ? [
                  new Paragraph({
                    children: [new TextRun(label)],
                    style: styleIds.calloutTitle,
                    indent: indent ? { left: indent } : undefined,
                  }),
                ]
              : [];
          if (style.callout.frame === 'box') {
            // One bordered cell: the frame also encloses lists and tables, and
            // is drawn the same by Word and other word processors.
            const available = context.width - context.indent;
            const line = {
              style: BorderStyle.SINGLE,
              size: 6,
              color: hex(style.body.color ?? '#000000'),
            };
            const content = [
              ...title(0),
              ...blocks(node.content, {
                ...context,
                width: Math.max(300, available - 240),
                indent: 0,
                topLevel: false,
                style: styleIds.callout,
              }),
            ];
            return [
              new Table({
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: available, type: WidthType.DXA },
                        children: content.length
                          ? content
                          : [new Paragraph({ style: styleIds.callout })],
                      }),
                    ],
                  }),
                ],
                columnWidths: [available],
                layout: TableLayoutType.FIXED,
                width: { size: available, type: WidthType.DXA },
                indent: { size: context.indent, type: WidthType.DXA },
                borders: {
                  top: line,
                  bottom: line,
                  left: line,
                  right: line,
                  insideHorizontal: line,
                  insideVertical: line,
                },
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
              }),
              new Paragraph({ spacing: { after: 0, before: 0 }, children: [] }),
            ];
          }
          const indent = nestedIndent(context, 360);
          return [
            ...title(indent),
            ...blocks(node.content, {
              ...context,
              indent,
              topLevel: false,
            }),
          ];
        }
        case 'codeBlock':
          return (node.content?.map((entry) => entry.text).join('') ?? '')
            .split('\n')
            .map(
              (text) =>
                new Paragraph({
                  children: [new TextRun(text)],
                  style: styleIds.code,
                  indent: { left: context.indent },
                }),
            );
        case 'figure':
          return [
            new Paragraph({
              children: [
                image(
                  officeFigureKey(node),
                  node.attrs.alt,
                  ((context.width - context.indent) * node.attrs.width) / 100,
                  true,
                ),
              ],
              alignment: node.attrs.align,
              keepNext: Boolean(node.attrs.caption),
            }),
            ...caption(node),
          ];
        case 'blockMath':
          return equation(node, context);
        case 'chart': {
          warnings.add(copy.chart);
          const plot = resolveChartPlot(node.attrs);
          const errorKeys = ['xMinus', 'xPlus', 'yMinus', 'yPlus'] as const;
          const hasErrors = plot.series.some((series) =>
            series.data.some((point) =>
              errorKeys.some((key) => point[key] !== undefined),
            ),
          );
          const rows = [
            [
              'Series',
              copy.label,
              [node.attrs.xLabel || 'x', plot.xUnit]
                .filter(Boolean)
                .join(' / '),
              [node.attrs.yLabel || 'y', plot.yUnit]
                .filter(Boolean)
                .join(' / '),
              ...(hasErrors ? errorKeys : []),
            ],
            ...plot.series.flatMap((series) =>
              series.data.map((entry) => [
                series.name,
                entry.label,
                String(entry.x),
                String(entry.y),
                ...(hasErrors
                  ? errorKeys.map((key) =>
                      entry[key] === undefined ? '' : String(entry[key]),
                    )
                  : []),
              ]),
            ),
          ];
          return [
            ...[
              node.attrs.caption,
              node.attrs.series,
              node.attrs.alt,
              plot.source,
              plot.errorDescription,
              ...(plot.xScale === 'log' || plot.yScale === 'log'
                ? [
                    `Scale: X=${plot.xScale ?? 'linear'}, Y=${plot.yScale ?? 'linear'}`,
                  ]
                : []),
              plot.nature !== 'unspecified' ? plot.nature : '',
            ]
              .filter((text): text is string => Boolean(text))
              .map((text) => new Paragraph({ text, keepNext: true })),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: rows.map(
                (row, rowIndex) =>
                  new TableRow({
                    tableHeader: rowIndex === 0,
                    children: row.map(
                      (text) =>
                        new TableCell({
                          children: [
                            new Paragraph({
                              children: [new TextRun(text)],
                              style:
                                rowIndex === 0
                                  ? styleIds.tableHeader
                                  : styleIds.tableText,
                            }),
                          ],
                        }),
                    ),
                  }),
              ),
            }),
          ];
        }
        case 'horizontalRule':
          return [
            new Paragraph({
              border: {
                bottom: { style: BorderStyle.SINGLE, color: '94A3B8', size: 6 },
              },
            }),
          ];
        case 'table':
          return [
            ...caption(node, true),
            table(node, context),
            new Paragraph({ spacing: { after: 0, before: 0 }, children: [] }),
          ];
        case 'tableRow':
        case 'tableCell':
        case 'tableHeader':
          // Validation guarantees these are handled within their owning table.
          throw new Error(`Unexpected standalone table node: ${node.type}`);
      }
    });
  }

  const contents: Array<Paragraph | TableOfContents> = [];
  let updateFieldsOnOpen = false;
  /** "- 3 -" in a contents entry: the page reference inside the configured text. */
  function pageReference(anchor: string): ParagraphChild[] {
    return [
      new TextRun({ children: [new Tab()] }),
      ...pageNumberParts(report.toc_page_number_format).flatMap(
        (part): ParagraphChild[] =>
          part.type === 'text'
            ? [new TextRun(part.value)]
            : part.type === 'n'
              ? [new PageReference(anchor, { hyperlink: true })]
              : // The total is known to Word only inside a header or footer.
                [],
      ),
    ];
  }
  function contentsList(
    title: string,
    targets: SemanticTarget[],
    kind: 'heading' | 'figure' | 'table',
  ) {
    // Match HTML: inline contents are omitted when empty; a dedicated page
    // retains its explanatory notice rather than becoming an unexplained blank.
    if (!targets.length && !report.toc_page) return;
    contents.push(
      new Paragraph({ text: title, style: styleIds.contentsTitle }),
    );
    if (!targets.length) {
      contents.push(new Paragraph(copy.emptyContents));
      return;
    }
    const entryText = (target: SemanticTarget) =>
      target.type === 'heading'
        ? `${headingPrefix(target, locale)}${target.title}`
        : joinCaption(
            [formatSemanticReference(target, locale), target.title],
            separator,
          );
    if (report.toc_page_numbers) updateFieldsOnOpen = true;
    // A Word contents field is rebuilt from the headings (or captions) when
    // Word updates it. The entries written here are shown until then.
    if (fields && (kind === 'heading' || captionFields)) {
      if (
        kind === 'heading' &&
        analysis.outline.length !== targets.length &&
        analysis.outline.some(
          (entry) =>
            (entry.level ?? 1) <= report.toc_depth && !targets.includes(entry),
        )
      )
        warnings.add(copy.fieldContents);
      contents.push(
        new TableOfContents(title, {
          hyperlink: true,
          ...(kind === 'heading'
            ? {
                headingStyleRange: `1-${report.toc_depth}`,
                // Also collects the appendix heading style by its outline level.
                useAppliedParagraphOutlineLevel: true,
              }
            : // \\c: every caption of this sequence, with its label and number.
              { captionLabelIncludingNumbers: sequenceName(kind, locale) }),
          ...(report.toc_page_numbers
            ? {}
            : { pageNumbersEntryLevelsRange: '1-9' }),
          cachedEntries: targets.map((target) => ({
            title: entryText(target),
            level: kind === 'heading' ? (target.level ?? 1) : 1,
            href: anchors.get(target.nodeId)!,
          })),
          // Written clean when nothing depends on Word's own page layout.
          beginDirty: report.toc_page_numbers,
        }),
      );
      return;
    }
    warnings.add(copy.numbering);
    if (report.toc_page_numbers) warnings.add(copy.contentsPageNumbers);
    for (const target of targets)
      contents.push(
        new Paragraph({
          style: styleIds.contents(
            kind === 'heading' ? (target.level ?? 1) : 1,
          ),
          children: [
            new InternalHyperlink({
              anchor: anchors.get(target.nodeId)!,
              children: [
                new TextRun(entryText(target)),
                ...(report.toc_page_numbers
                  ? pageReference(anchors.get(target.nodeId)!)
                  : []),
              ],
            }),
          ],
        }),
      );
  }
  if (document.metadata.toc === true)
    contentsList(
      contentsTitle(locale, document.metadata, report),
      reportOutline(document, analysis),
      'heading',
    );
  for (const [enabled, type, title] of [
    [report.list_figures, 'figure', copy.figures],
    [report.list_tables, 'table', copy.tables],
  ] as const) {
    if (enabled)
      contentsList(
        title,
        [...analysis.targets.values()].filter(
          (target) => target.type === type && Boolean(target.number),
        ),
        type,
      );
  }
  const body = blocks(document.children, {
    width: bodyWidth,
    indent: 0,
    depth: 0,
    topLevel: true,
  });
  const page: NonNullable<ISectionPropertiesOptions['page']> = {
    size: {
      width: mmToTwips(Math.min(pageWidth, pageHeight)),
      height: mmToTwips(Math.max(pageWidth, pageHeight)),
      orientation:
        settings.orientation === 'landscape'
          ? PageOrientation.LANDSCAPE
          : PageOrientation.PORTRAIT,
    },
    margin: {
      top: mmToTwips(settings.margin_top),
      bottom: mmToTwips(settings.margin_bottom),
      left: mmToTwips(settings.margin_left),
      right: mmToTwips(settings.margin_right),
    },
  };
  /** The page number in the configured text, e.g. "- 3 -" or "3 / 12". */
  const pageNumberFooter = () =>
    new Footer({
      children: [
        new Paragraph({
          alignment:
            report.page_number_position === 'bottom-center'
              ? AlignmentType.CENTER
              : AlignmentType.RIGHT,
          children: pageNumberParts(report.page_number_format).map(
            (part) =>
              new TextRun({
                children: [
                  part.type === 'text'
                    ? part.value
                    : part.type === 'n'
                      ? PageNumber.CURRENT
                      : PageNumber.TOTAL_PAGES_IN_SECTION,
                ],
              }),
          ),
        }),
      ],
    });
  const sections: ISectionOptions[] = [];
  if (report.cover) {
    const title =
      document.metadata.title?.trim() ||
      (locale === 'ja' ? '無題の報告書' : 'Untitled report');
    const centred = report.cover_layout === 'centered';
    const lines = centred
      ? // No field names; the order of the cover in the preview.
        [
          report.affiliation,
          document.metadata.author,
          report.recipient,
          document.metadata.date,
          report.report_number,
        ]
      : [
          document.metadata.author,
          document.metadata.date,
          report.affiliation.trim() &&
            `${copy.affiliation}: ${report.affiliation}`,
          report.recipient.trim() && `${copy.recipient}: ${report.recipient}`,
          report.report_number.trim() &&
            `${copy.reportNumber}: ${report.report_number}`,
        ];
    const cover = [
      new Paragraph({ text: title, style: styleIds.coverTitle }),
      ...(document.metadata.subtitle?.trim()
        ? [
            new Paragraph({
              text: document.metadata.subtitle,
              style: styleIds.coverSubtitle,
            }),
          ]
        : []),
      ...lines
        .filter((text): text is string => Boolean(text?.trim()))
        .map((text) => new Paragraph({ text, style: styleIds.coverText })),
    ];
    sections.push({ properties: { page }, children: cover });
  }
  const romanFrontMatter = report.front_matter_page_numbers === 'roman';
  if (report.toc_page && contents.length)
    sections.push({
      properties: {
        page: romanFrontMatter
          ? {
              ...page,
              pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN },
            }
          : page,
        type: SectionType.NEXT_PAGE,
      },
      ...(romanFrontMatter ? { footers: { default: pageNumberFooter() } } : {}),
      children: contents,
    });
  const children = [
    ...(report.toc_page ? [] : contents),
    ...(sections.length && !hasReportBodyContent(document) ? [] : body),
  ];
  if (children.length || !sections.length)
    sections.push({
      properties: {
        page: {
          ...page,
          ...(sections.length
            ? {
                pageNumbers: {
                  start: 1,
                  ...(romanFrontMatter
                    ? { formatType: NumberFormat.DECIMAL }
                    : {}),
                },
              }
            : {}),
        },
        ...(sections.length ? { type: SectionType.NEXT_PAGE } : {}),
      },
      footers: { default: pageNumberFooter() },
      children: children.length ? children : [new Paragraph('')],
    });
  const file = new Document({
    title: documentTitle(document),
    creator: document.metadata.author,
    description: document.metadata.subtitle,
    ...(updateFieldsOnOpen ? { features: { updateFields: true } } : {}),
    styles: buildStyles(style, settings, report, locale, bodyWidth),
    numbering: {
      config: [...numbering, ...(headingNumbering?.config ?? [])],
    },
    footnotes: Object.fromEntries(
      footnotes.map((node, index) => [
        index + 1,
        { children: [new Paragraph(node.attrs.text)] },
      ]),
    ),
    sections,
  });
  return { blob: await Packer.toBlob(file), warnings: [...warnings] };
}
