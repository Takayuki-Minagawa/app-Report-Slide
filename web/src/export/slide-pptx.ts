import pptxgen from 'pptxgenjs';
import {
  documentTitle,
  type DocumentData,
  type DocumentNode,
  type InlineNode,
  type TableNode,
} from '@/src/document/model';
import {
  analyzeDocument,
  collectFootnotes,
  splitDocumentPages,
} from '@/src/document/semantics';
import { walkDocumentTree } from '@/src/document/traversal';
import { migrateDocumentData } from '@/src/document/validation';
import {
  formatSemanticReference,
  localizeDiagnosticMessage,
} from '@/src/i18n/diagnostics';
import { messages, type AppLocale } from '@/src/i18n/messages';
import type { AssetUrls } from '@/src/workspace/files';
import { prepareOfficeImages } from './office-images';

const width = 13.333333;
const height = 7.5;
const margin = 0.55;
const contentWidth = width - 2 * margin;
const mimeType =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const copy = {
  ja: {
    slidesOnly: 'PowerPoint出力はスライド文書で使用できます。',
    layout:
      'PowerPoint用の配置とフォントで出力しました。改行や余白はプレビューと異なる場合があります。',
    math: '数式は編集できるLaTeXテキストとして出力しました。',
    dense: (page: number) =>
      `スライド${page}の内容を縮小しました。PowerPointで文字の大きさやはみ出しを確認してください。`,
    tableImages: '表内の画像は、表の後ろに配置しました。',
    borders: '表の点線・二重線は、PowerPointで使用できる線種に置き換えました。',
    notesImages: '発表者ノート内の画像は代替テキストで記録しました。',
    chartData: 'グラフの元データ（ラベル / X / Y）',
  },
  en: {
    slidesOnly: 'PowerPoint export is available for slide documents.',
    layout:
      'Exported with PowerPoint layouts and fonts. Line breaks and spacing may differ from the preview.',
    math: 'Equations were exported as editable LaTeX text.',
    dense: (page: number) =>
      `Content on slide ${page} was reduced. Check text size and overflow in PowerPoint.`,
    tableImages: 'Images inside tables were placed after their table.',
    borders:
      'Dotted and double table borders were replaced with available PowerPoint line styles.',
    notesImages: 'Images in speaker notes were recorded as alternative text.',
    chartData: 'Original chart data (label / X / Y)',
  },
};

type Runs = pptxgen.TextProps[];
type Block = {
  naturalHeight: number;
  draw: (slide: pptxgen.Slide, y: number, h: number, scale: number) => void;
};

/** Conservative width estimate includes full-width Japanese glyphs. */
function textHeight(text: string, fontSize: number, w: number): number {
  const lines = text.split('\n').reduce((total, line) => {
    const units = Array.from(line).reduce(
      (sum, character) => sum + (character.charCodeAt(0) > 255 ? 1 : 0.6),
      0,
    );
    return total + Math.max(1, Math.ceil((units * fontSize) / (w * 72)));
  }, 0);
  return (lines * fontSize * 1.4) / 72 + 0.12;
}

function containImage(
  image: { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / image.width, h / image.height);
  const iw = image.width * scale;
  const ih = image.height * scale;
  return { x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih };
}

/** Native Office objects preserve editable content without changing the source. */
export async function exportSlidePptx(
  source: DocumentData,
  assets: AssetUrls,
  locale: AppLocale,
): Promise<{ blob: Blob; warnings: string[] }> {
  const document = migrateDocumentData(source);
  const text = copy[locale];
  if (document.type !== 'slide') throw new Error(text.slidesOnly);
  const { images } = await prepareOfficeImages(document, assets, locale);
  const analysis = analyzeDocument(document);
  const pages = splitDocumentPages(document);
  const warnings = new Set<string>([
    text.layout,
    ...analysis.diagnostics.map((entry) =>
      localizeDiagnosticMessage(entry, locale),
    ),
  ]);
  const slideNumbers = new Map<string, number>();
  pages.forEach((nodes, index) => {
    for (const node of walkDocumentTree(nodes)) {
      if ('attrs' in node && 'nodeId' in node.attrs)
        slideNumbers.set(String(node.attrs.nodeId), index + 1);
    }
  });

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = documentTitle(document);
  pptx.subject = document.metadata.subtitle ?? '';
  pptx.author = document.metadata.author ?? '';
  pptx.company = '';
  const fontFace = locale === 'ja' ? 'Yu Gothic' : 'Aptos';
  pptx.theme = { headFontFace: fontFace, bodyFontFace: fontFace };
  const accent = document.metadata.theme === 'technical' ? '176B9A' : '334E7A';
  const allFootnotes = collectFootnotes(document.children);
  const footnoteNumbers = new Map(
    allFootnotes.map((note, index) => [note, index + 1]),
  );

  function inlineRuns(nodes: InlineNode[] = [], inNotes = false): Runs {
    return nodes.map((node): pptxgen.TextProps => {
      if (node.type === 'text') {
        const options: pptxgen.TextPropsOptions = {};
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') options.bold = true;
          else if (mark.type === 'italic') options.italic = true;
          else if (mark.type === 'strike') options.strike = 'sngStrike';
          else if (mark.type === 'code') options.fontFace = 'Consolas';
          else if (mark.type === 'link' && mark.attrs?.href)
            options.hyperlink = { url: mark.attrs.href };
        }
        return { text: node.text, options };
      }
      if (node.type === 'hardBreak') return { text: '\n' };
      if (node.type === 'inlineMath') {
        warnings.add(text.math);
        return { text: node.attrs.latex, options: { fontFace: 'Consolas' } };
      }
      if (node.type === 'footnote')
        return {
          text: inNotes
            ? ` (${node.attrs.text})`
            : `[${footnoteNumbers.get(node)}]`,
          options: inNotes ? {} : { superscript: true },
        };
      if (node.type === 'reference') {
        const target = analysis.labels.get(node.attrs.target);
        return target
          ? {
              text: formatSemanticReference(target, locale),
              options: {
                hyperlink: { slide: slideNumbers.get(target.nodeId) },
              },
            }
          : { text: `[@${node.attrs.target}]` };
      }
      if (inNotes) warnings.add(text.notesImages);
      return { text: `[${node.attrs.alt || node.attrs.src}]` };
    });
  }

  function caption(node: DocumentNode): string {
    const target = analysis.targets.get(node.attrs.nodeId);
    return `${target?.number ? formatSemanticReference(target, locale) : ''}${target?.number && node.attrs.caption ? ' — ' : ''}${node.attrs.caption || ''}`;
  }

  pages.forEach((nodes, pageIndex) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    const blocks: Block[] = [];
    const positioned: Extract<DocumentNode, { type: 'figure' }>[] = [];
    const notes: string[] = [];

    function addText(
      runs: Runs,
      fontSize = 22,
      options: pptxgen.TextPropsOptions = {},
      indent = 0,
    ) {
      const safeIndent = Math.min(indent, contentWidth - 0.2);
      const x = margin + safeIndent;
      const w =
        typeof options.w === 'number'
          ? Math.max(0.15, options.w)
          : contentWidth - safeIndent;
      const naturalHeight = textHeight(
        runs.map((run) => run.text ?? '').join(''),
        fontSize,
        w,
      );
      blocks.push({
        naturalHeight,
        draw: (target, y, h, scale) =>
          target.addText(runs, {
            x,
            y,
            h,
            fontFace,
            fontSize: Math.max(1, fontSize * scale),
            color: '243447',
            margin: 0,
            breakLine: false,
            valign: 'top',
            fit: 'shrink',
            paraSpaceAfter: 0,
            ...options,
            w,
          }),
      });
    }

    function addImage(
      src: string,
      alt: string,
      percent = 100,
      align = 'center',
      indent = 0,
    ) {
      const image = images.get(src);
      if (!image) throw new Error(`Image was not prepared: ${src}`);
      const w = ((contentWidth - indent) * percent) / 100;
      const desiredHeight = Math.min(3.7, (w * image.height) / image.width);
      blocks.push({
        naturalHeight: desiredHeight + 0.12,
        draw: (target, y, h) => {
          const areaX =
            margin +
            indent +
            (align === 'right'
              ? contentWidth - indent - w
              : align === 'left'
                ? 0
                : (contentWidth - indent - w) / 2);
          target.addImage({
            data: image.dataUrl,
            altText: alt,
            ...containImage(image, areaX, y, w, Math.max(0.01, h - 0.08)),
          });
        },
      });
    }

    function addParagraph(
      node: Extract<DocumentNode, { type: 'paragraph' | 'heading' }>,
      indent: number,
      bullet?: pptxgen.TextPropsOptions['bullet'],
    ) {
      const size =
        node.type === 'heading'
          ? Math.max(22, 36 - (node.attrs.level - 1) * 3)
          : 22;
      const target = analysis.targets.get(node.attrs.nodeId);
      const prefix =
        node.type === 'heading' && target?.number ? `${target.number} ` : '';
      let inline: InlineNode[] = [];
      let first = true;
      const flush = () => {
        const runs = inlineRuns(inline);
        if (first && prefix) runs.unshift({ text: prefix });
        const ruler = node.attrs.textRuler;
        const rulerLeft = ruler
          ? ((contentWidth - indent) * ruler.left) / 100
          : 0;
        const rulerRight = ruler
          ? ((contentWidth - indent) * ruler.right) / 100
          : 0;
        addText(
          runs,
          size,
          {
            bold: node.type === 'heading',
            color: node.type === 'heading' ? accent : '243447',
            ...(first && bullet ? { bullet } : {}),
            ...(ruler
              ? { w: contentWidth - indent - rulerLeft - rulerRight }
              : {}),
          },
          indent + rulerLeft,
        );
        first = false;
        inline = [];
      };
      for (const entry of node.content ?? []) {
        if (entry.type === 'inlineImage') {
          if (inline.length) flush();
          addImage(entry.attrs.src, entry.attrs.alt, 45, 'left', indent);
        } else inline.push(entry);
      }
      if (inline.length || first) flush();
    }

    function addTable(node: TableNode, indent: number) {
      const w = contentWidth - indent;
      const columns = Math.max(
        ...node.content.map((row) =>
          (row.content ?? []).reduce(
            (sum, cell) => sum + (cell.attrs.colspan ?? 1),
            0,
          ),
        ),
        1,
      );
      const firstRowWidths = (node.content[0]?.content ?? []).flatMap((cell) =>
        Array.from(
          { length: cell.attrs.colspan ?? 1 },
          (_, index) => cell.attrs.colwidth?.[index] ?? 100,
        ),
      );
      const totalColumnWidth = firstRowWidths.reduce(
        (sum, value) => sum + value,
        0,
      );
      const colW =
        firstRowWidths.length === columns
          ? firstRowWidths.map((value) => (w * value) / totalColumnWidth)
          : undefined;
      const tableImages: Extract<InlineNode, { type: 'inlineImage' }>[] = [];
      const rowHeights = node.content.map((row) =>
        Math.max(
          0.38,
          ...(row.content ?? []).map((cell) => {
            const plain = cell.content
              .map((paragraph) =>
                inlineRuns(paragraph.content)
                  .map((run) => run.text ?? '')
                  .join(''),
              )
              .join('\n');
            return (
              textHeight(
                plain,
                18,
                Math.max(0.1, (w * (cell.attrs.colspan ?? 1)) / columns - 0.15),
              ) / (cell.attrs.rowspan ?? 1)
            );
          }),
        ),
      );
      blocks.push({
        naturalHeight: rowHeights.reduce((sum, entry) => sum + entry, 0) + 0.1,
        draw: (target, y, h, scale) => {
          const rows: pptxgen.TableRow[] = node.content.map((row) =>
            (row.content ?? []).map((cell) => {
              const runs = cell.content.flatMap((paragraph, index) => [
                ...(index ? [{ text: '\n' }] : []),
                ...inlineRuns(paragraph.content),
              ]);
              const border = (['top', 'right', 'bottom', 'left'] as const).map(
                (side): pptxgen.BorderProps => {
                  const value = cell.attrs.borders?.[side];
                  if (value === null) return { type: 'none', pt: 0 };
                  if (value?.style === 'double' || value?.style === 'dotted')
                    warnings.add(text.borders);
                  return {
                    color: value?.color.slice(1) ?? 'CBD5E1',
                    pt: (value?.width ?? 1) * 0.75,
                    type:
                      value?.style === 'dashed' || value?.style === 'dotted'
                        ? 'dash'
                        : 'solid',
                  };
                },
              ) as [
                pptxgen.BorderProps,
                pptxgen.BorderProps,
                pptxgen.BorderProps,
                pptxgen.BorderProps,
              ];
              return {
                text: runs,
                options: {
                  bold: cell.type === 'tableHeader',
                  fill: {
                    color: cell.type === 'tableHeader' ? 'E8EFF5' : 'FFFFFF',
                  },
                  align: cell.attrs.align ?? 'left',
                  colspan: cell.attrs.colspan ?? 1,
                  rowspan: cell.attrs.rowspan ?? 1,
                  border,
                },
              };
            }),
          );
          target.addTable(rows, {
            x: margin + indent,
            y,
            w,
            h,
            rowH: rowHeights.map((entry) => entry * scale),
            colW,
            fontFace,
            fontSize: Math.max(1, 18 * scale),
            margin: 0,
            color: '243447',
            valign: 'top',
            autoPage: false,
          });
        },
      });
      const label = caption(node);
      if (label) addText([{ text: label }], 15, {}, indent);
      for (const entry of walkDocumentTree(node.content))
        if (entry.type === 'inlineImage') tableImages.push(entry);
      if (tableImages.length) warnings.add(text.tableImages);
      tableImages.forEach((entry) =>
        addImage(entry.attrs.src, entry.attrs.alt, 45, 'left', indent),
      );
    }

    function visit(
      node: DocumentNode,
      indent = 0,
      bullet?: pptxgen.TextPropsOptions['bullet'],
    ) {
      indent = Math.min(indent, contentWidth - 1);
      switch (node.type) {
        case 'paragraph':
        case 'heading':
          addParagraph(node, indent, bullet);
          break;
        case 'bulletList':
        case 'orderedList':
          node.content.forEach((item, index) =>
            item.content.forEach((child, childIndex) =>
              visit(
                child,
                indent + 0.25,
                childIndex === 0
                  ? node.type === 'orderedList'
                    ? {
                        type: 'number',
                        numberStartAt: node.attrs.start + index,
                        indent: 18,
                      }
                    : { indent: 18 }
                  : undefined,
              ),
            ),
          );
          break;
        case 'listItem':
          node.content.forEach((child) => visit(child, indent));
          break;
        case 'blockquote':
          if (node.attrs.callout)
            addText(
              [{ text: messages[locale].callout[node.attrs.callout] }],
              19,
              { bold: true, color: accent },
              indent + 0.2,
            );
          node.content.forEach((child) => visit(child, indent + 0.2));
          break;
        case 'codeBlock':
          addText(
            inlineRuns(node.content),
            17,
            { fontFace: 'Consolas', fill: { color: 'F1F5F9' } },
            indent,
          );
          break;
        case 'blockMath':
          warnings.add(text.math);
          addText(
            [{ text: node.attrs.latex }],
            21,
            { fontFace: 'Consolas', align: 'center' },
            indent,
          );
          if (caption(node)) addText([{ text: caption(node) }], 15, {}, indent);
          break;
        case 'figure':
          if (node.attrs.slidePlacement) positioned.push(node);
          else
            addImage(
              node.attrs.src,
              node.attrs.alt,
              node.attrs.width,
              node.attrs.align,
              indent,
            );
          if (caption(node)) addText([{ text: caption(node) }], 15, {}, indent);
          break;
        case 'table':
          addTable(node, indent);
          break;
        case 'chart': {
          const data =
            node.attrs.chartType === 'line'
              ? [...node.attrs.data].sort((a, b) => a.x - b.x)
              : node.attrs.data;
          const numeric = node.attrs.chartType !== 'bar';
          const series = numeric
            ? [
                {
                  name: node.attrs.xLabel || 'X',
                  values: data.map((point) => point.x),
                },
                {
                  name: node.attrs.series,
                  labels: data.map((point) => point.label),
                  values: data.map((point) => point.y),
                },
              ]
            : [
                {
                  name: node.attrs.series,
                  labels: data.map((point) => point.label),
                  values: data.map((point) => point.y),
                },
              ];
          blocks.push({
            naturalHeight: 3.8,
            draw: (target, y, h, scale) =>
              target.addChart(
                numeric ? pptx.ChartType.scatter : pptx.ChartType.bar,
                series,
                {
                  x: margin + (contentWidth * (100 - node.attrs.width)) / 200,
                  y,
                  w: (contentWidth * node.attrs.width) / 100,
                  h,
                  catAxisTitle: node.attrs.xLabel,
                  showCatAxisTitle: Boolean(node.attrs.xLabel),
                  showValAxisTitle: Boolean(node.attrs.yLabel),
                  valAxisTitle: node.attrs.yLabel,
                  showLegend: true,
                  legendFontSize: Math.max(7, 12 * scale),
                  catAxisLabelFontSize: Math.max(7, 11 * scale),
                  valAxisLabelFontSize: Math.max(7, 11 * scale),
                  catAxisTitleFontSize: Math.max(7, 12 * scale),
                  valAxisTitleFontSize: Math.max(7, 12 * scale),
                  showValue: false,
                  showLabel: numeric,
                  dataLabelFormatScatter: 'custom',
                  dataLabelFormatCode: 'General',
                  chartColors: [accent],
                  lineSize: node.attrs.chartType === 'scatter' ? 0 : 2,
                  lineDataSymbol: 'circle',
                  lineDataSymbolSize: 4,
                  barDir: 'col',
                },
              ),
          });
          notes.push(
            `${node.attrs.alt || node.attrs.series}\n${text.chartData}\n${node.attrs.data.map((point) => `${point.label} / ${point.x} / ${point.y}`).join('\n')}`,
          );
          if (caption(node)) addText([{ text: caption(node) }], 15, {}, indent);
          break;
        }
        case 'horizontalRule':
          blocks.push({
            naturalHeight: 0.2,
            draw: (target, y, h) =>
              target.addShape(pptx.ShapeType.line, {
                x: margin + indent,
                y: y + h / 2,
                w: contentWidth - indent,
                h: 0,
                line: { color: 'CBD5E1', width: 1 },
              }),
          });
          break;
        case 'speakerNotes':
          notes.push(
            node.content
              .map((paragraph) =>
                inlineRuns(paragraph.content, true)
                  .map((run) => run.text)
                  .join(''),
              )
              .join('\n\n'),
          );
          break;
        default:
          // Container-only nodes cannot occur at the document root after validation.
          break;
      }
    }

    if (pageIndex === 0 && document.metadata.toc === true) {
      addText([{ text: messages[locale].preview.toc }], 24, {
        bold: true,
        color: accent,
      });
      for (const entry of analysis.outline)
        addText(
          [
            {
              text: `${entry.number ? `${entry.number} ` : ''}${entry.title}`,
              options: { hyperlink: { slide: slideNumbers.get(entry.nodeId) } },
            },
          ],
          18,
          {},
          Math.max(0, (entry.level ?? 1) - 1) * 0.2,
        );
    }
    nodes.forEach((node) => visit(node));
    const pageFootnotes = collectFootnotes(nodes);
    if (pageFootnotes.length) {
      addText(
        pageFootnotes.map((note, index) => ({
          text: `${index ? '\n' : ''}[${footnoteNumbers.get(note)}] ${note.attrs.text}`,
        })),
        12,
        { color: '526170' },
      );
    }
    const totalHeight = blocks.reduce(
      (sum, block) => sum + block.naturalHeight,
      0,
    );
    const scale = Math.min(
      1,
      (height - 2 * margin - 0.3) / Math.max(totalHeight, 0.01),
    );
    if (scale < 0.85) warnings.add(text.dense(pageIndex + 1));
    let y = margin;
    for (const block of blocks) {
      const h = block.naturalHeight * scale;
      block.draw(slide, y, h, scale);
      y += h;
    }
    for (const node of positioned) {
      const placement = node.attrs.slidePlacement!;
      const image = images.get(node.attrs.src)!;
      slide.addImage({
        data: image.dataUrl,
        altText: node.attrs.alt,
        objectName: node.attrs.nodeId,
        ...containImage(
          image,
          (width * placement.x) / 100,
          (height * placement.y) / 100,
          (width * placement.width) / 100,
          (height * placement.height) / 100,
        ),
      });
    }
    if (document.metadata.author)
      slide.addText(document.metadata.author, {
        x: margin,
        y: height - 0.4,
        w: contentWidth - 1.4,
        h: 0.2,
        fontFace,
        fontSize: 10,
        color: '64748B',
        margin: 0,
        fit: 'shrink',
      });
    if (document.metadata.slide_number !== false)
      slide.addText(`${pageIndex + 1} / ${pages.length}`, {
        x: width - margin - 1.2,
        y: height - 0.4,
        w: 1.2,
        h: 0.2,
        fontFace,
        fontSize: 10,
        color: '64748B',
        align: 'right',
        margin: 0,
      });
    if (notes.length) slide.addNotes(notes.join('\n\n'));
  });
  const buffer = (await pptx.write({
    outputType: 'arraybuffer',
    compression: true,
  })) as ArrayBuffer;
  return {
    blob: new Blob([buffer], { type: mimeType }),
    warnings: [...warnings],
  };
}
