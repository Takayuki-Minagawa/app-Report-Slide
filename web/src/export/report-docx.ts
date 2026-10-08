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
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IPropertiesOptions,
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
import { analyzeDocument, collectFootnotes } from '@/src/document/semantics';
import { isTextRuler } from '@/src/document/text-ruler';
import { migrateDocumentData } from '@/src/document/validation';
import {
  formatSemanticReference,
  localizeDiagnosticMessage,
} from '@/src/i18n/diagnostics';
import { messages, type AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { prepareOfficeImages } from './office-images';

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
    math: '数式は編集可能なLaTeXテキストとして出力しました。',
    chart: 'グラフは全データを含む編集可能な表として出力しました。',
    numbering:
      '目次・見出し番号・図表番号・参照は出力時点の値です。Wordで編集した後は必要に応じて修正してください。',
    label: 'ラベル',
    indentation: '深い入れ子のインデントを本文幅に収まるように調整しました。',
  },
  en: {
    required: 'Word export requires a report document.',
    math: 'Equations were exported as editable LaTeX text.',
    chart: 'Charts were exported as editable tables containing all their data.',
    numbering:
      'The table of contents, section and caption numbers, and references retain their exported values. Revise them as needed after editing in Word.',
    label: 'Label',
    indentation: 'Deeply nested indentation was adjusted to fit the text area.',
  },
};

interface BlockContext {
  width: number;
  indent: number;
  depth: number;
  numbering?: IParagraphOptions['numbering'];
  alignment?: IParagraphOptions['alignment'];
  bold?: boolean;
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
  const settings = resolvePageSettings(document.metadata);
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
  const anchors = new Map(
    [...analysis.targets.keys()].map((id, index) => [id, `kumi_${index + 1}`]),
  );
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
    bold = false,
  ): ParagraphChild[] {
    return (nodes ?? []).flatMap((node): ParagraphChild[] => {
      switch (node.type) {
        case 'text': {
          const marks = node.marks ?? [];
          const run = new TextRun({
            text: node.text,
            bold: bold || marks.some((mark) => mark.type === 'bold'),
            italics: marks.some((mark) => mark.type === 'italic'),
            strike: marks.some((mark) => mark.type === 'strike'),
            ...(marks.some((mark) => mark.type === 'code')
              ? { font: 'Courier New', shading: { fill: 'F1F5F9' } }
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
          warnings.add(copy.math);
          return [
            new TextRun({ text: node.attrs.latex, font: 'Cambria Math' }),
          ];
        case 'inlineImage':
          return [image(node.attrs.src, node.attrs.alt, width)];
        case 'reference': {
          const target = analysis.labels.get(node.attrs.target);
          if (!target) return [new TextRun(`[@${node.attrs.target}]`)];
          warnings.add(copy.numbering);
          return [
            new InternalHyperlink({
              anchor: anchors.get(target.nodeId)!,
              children: [new TextRun(formatSemanticReference(target, locale))],
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
    const indent: NonNullable<IParagraphOptions['indent']> = isTextRuler(ruler)
      ? {
          left: context.indent + Math.round((rulerWidth * ruler.left) / 100),
          right: Math.round((rulerWidth * ruler.right) / 100),
          ...(ruler.firstLine >= ruler.left
            ? {
                firstLine: Math.round(
                  (rulerWidth * (ruler.firstLine - ruler.left)) / 100,
                ),
              }
            : {
                hanging: Math.round(
                  (rulerWidth * (ruler.left - ruler.firstLine)) / 100,
                ),
              }),
        }
      : {
          left: context.indent,
          firstLine:
            context.numbering || node.type === 'heading'
              ? 0
              : settings.first_line_indent * settings.font_size * 20,
        };
    const target = analysis.targets.get(node.attrs.nodeId);
    const runs = [
      ...(target?.number ? [new TextRun(`${target.number} `)] : []),
      ...inline(node.content, rulerWidth, context.bold),
    ];
    if (target?.number) warnings.add(copy.numbering);
    return new Paragraph({
      children: target
        ? [new Bookmark({ id: anchors.get(target.nodeId)!, children: runs })]
        : runs,
      heading:
        node.type === 'heading' ? headings[node.attrs.level - 1] : undefined,
      indent: context.numbering
        ? { ...indent, hanging: 300, firstLine: undefined }
        : indent,
      numbering: context.numbering,
      alignment: context.alignment,
      keepNext: node.type === 'heading',
      widowControl: true,
    });
  }

  function caption(node: DocumentNode, before = false): Paragraph[] {
    const target = analysis.targets.get(node.attrs.nodeId);
    const text = [
      target?.number ? formatSemanticReference(target, locale) : '',
      node.attrs.caption || '',
    ]
      .filter(Boolean)
      .join(' — ');
    if (target?.number) warnings.add(copy.numbering);
    if (!text && !target) return [];
    return [
      new Paragraph({
        children: target
          ? [
              new Bookmark({
                id: anchors.get(target.nodeId)!,
                children: text
                  ? [new TextRun({ text, size: settings.font_size * 2 - 1 })]
                  : [],
              }),
            ]
          : [new TextRun(text)],
        alignment: AlignmentType.CENTER,
        keepNext: before,
        spacing: { before: 80, after: 120 },
      }),
    ];
  }

  function table(node: TableNode, context: BlockContext): Table {
    const occupied: number[] = [];
    const sizes: Array<number | undefined> = [];
    const cellPositions = new Map<string, number>();
    node.content.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of row.content ?? []) {
        while ((occupied[column] ?? 0) > rowIndex) column++;
        const span = cell.attrs.colspan ?? 1;
        cellPositions.set(cell.attrs.nodeId, column);
        for (let offset = 0; offset < span; offset++) {
          const width = cell.attrs.colwidth?.[offset];
          if (width) sizes[column + offset] = width;
          occupied[column + offset] = rowIndex + (cell.attrs.rowspan ?? 1);
        }
        column += span;
      }
    });
    const count = occupied.length;
    const defaultWidth = twipsToPixels(context.width - context.indent) / count;
    const widths = Array.from(
      { length: count },
      (_, index) => sizes[index] ?? defaultWidth,
    );
    const total = widths.reduce((sum, width) => sum + width, 0);
    const available = context.width - context.indent;
    const scale = Math.min(15, available / total);
    const columnWidths = widths.map((width) => Math.round(width * scale));
    const rows = node.content.map(
      (row) =>
        new TableRow({
          tableHeader: Boolean(
            row.content?.length &&
            row.content.every((cell) => cell.type === 'tableHeader'),
          ),
          children: (row.content ?? []).map((cell) => {
            const position = cellPositions.get(cell.attrs.nodeId)!;
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
            return new TableCell({
              columnSpan: span > 1 ? span : undefined,
              rowSpan: cell.attrs.rowspan,
              width: { size: cellWidth, type: WidthType.DXA },
              borders,
              shading:
                cell.type === 'tableHeader' ? { fill: 'F1F5F9' } : undefined,
              children: cell.content.map((child) =>
                paragraph(child, {
                  width: Math.max(300, cellWidth - 200),
                  indent: 0,
                  depth: 0,
                  alignment: cell.attrs.align ?? undefined,
                  bold: cell.type === 'tableHeader',
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
      margins: { top: 80, bottom: 80, left: 100, right: 100 },
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
          return blocks(node.content, context);
        case 'blockquote':
          return [
            ...(node.attrs.callout
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: messages[locale].callout[node.attrs.callout],
                        bold: true,
                      }),
                    ],
                    indent: { left: nestedIndent(context, 360) },
                    keepNext: true,
                  }),
                ]
              : []),
            ...blocks(node.content, {
              ...context,
              indent: nestedIndent(context, 360),
            }),
          ];
        case 'codeBlock':
          return (node.content?.map((entry) => entry.text).join('') ?? '')
            .split('\n')
            .map(
              (text) =>
                new Paragraph({
                  children: [new TextRun({ text, font: 'Courier New' })],
                  indent: { left: context.indent },
                  shading: { fill: 'F1F5F9' },
                  spacing: { before: 0, after: 0, line: 240 },
                }),
            );
        case 'figure':
          return [
            new Paragraph({
              children: [
                image(
                  node.attrs.src,
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
          warnings.add(copy.math);
          return [
            new Paragraph({
              children: [
                new TextRun({ text: node.attrs.latex, font: 'Cambria Math' }),
              ],
              alignment: AlignmentType.CENTER,
              keepNext: Boolean(node.attrs.caption),
            }),
            ...caption(node),
          ];
        case 'chart': {
          warnings.add(copy.chart);
          const rows = [
            [copy.label, node.attrs.xLabel || 'x', node.attrs.yLabel || 'y'],
            ...node.attrs.data.map((entry) => [
              entry.label,
              String(entry.x),
              String(entry.y),
            ]),
          ];
          return [
            ...[node.attrs.caption, node.attrs.series, node.attrs.alt]
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
                              children: [
                                new TextRun({ text, bold: rowIndex === 0 }),
                              ],
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

  const children: Array<Paragraph | Table> = [];
  if (document.metadata.toc === true && analysis.outline.length) {
    warnings.add(copy.numbering);
    children.push(
      new Paragraph({
        text: messages[locale].preview.toc,
        heading: HeadingLevel.HEADING_2,
      }),
    );
    for (const target of analysis.outline)
      children.push(
        new Paragraph({
          indent: { left: ((target.level ?? 1) - 1) * 240 },
          children: [
            new InternalHyperlink({
              anchor: anchors.get(target.nodeId)!,
              children: [
                new TextRun(
                  `${target.number ? `${target.number} ` : ''}${target.title}`,
                ),
              ],
            }),
          ],
        }),
      );
  }
  children.push(
    ...blocks(document.children, { width: bodyWidth, indent: 0, depth: 0 }),
  );
  const file = new Document({
    title: documentTitle(document),
    creator: document.metadata.author,
    description: document.metadata.subtitle,
    styles: {
      default: {
        document: {
          run: {
            font: locale === 'ja' ? 'Yu Mincho' : 'Times New Roman',
            size: settings.font_size * 2,
          },
          paragraph: {
            spacing: {
              line: Math.round(settings.line_height * 240),
              after: settings.paragraph_spacing * 20,
            },
          },
        },
      },
    },
    numbering: { config: numbering },
    footnotes: Object.fromEntries(
      footnotes.map((node, index) => [
        index + 1,
        { children: [new Paragraph(node.attrs.text)] },
      ]),
    ),
    sections: [
      {
        properties: {
          page: {
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
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ children: [PageNumber.CURRENT] })],
              }),
            ],
          }),
        },
        children: children.length ? children : [new Paragraph('')],
      },
    ],
  });
  return { blob: await Packer.toBlob(file), warnings: [...warnings] };
}
