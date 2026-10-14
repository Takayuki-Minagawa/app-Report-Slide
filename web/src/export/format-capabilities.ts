import type { DocumentData } from '@/src/document/model';
import { walkDocumentTree } from '@/src/document/traversal';
import { readFigureEdit } from '@/src/document/figure-edit';
import type { AppLocale } from '@/src/i18n/messages';
import { resolveChartPlot } from '@/src/document/chart';
import { localDocumentAssets } from '@/src/document/assets';

/** State concrete affected objects rather than implying every format is an editable archive. */
export function officeFeatureWarnings(
  document: DocumentData,
  locale: AppLocale,
): string[] {
  const ja = locale === 'ja';
  const warnings: string[] = [];
  for (const node of walkDocumentTree(document.children)) {
    if (node.type === 'chart' && node.attrs.plot && document.type === 'slide') {
      const plot = resolveChartPlot(node.attrs);
      const name = node.attrs.caption || node.attrs.alt || node.attrs.series;
      warnings.push(
        ja
          ? `グラフ「${name}」: PPTXの図は先頭系列「${plot.series[0].name}」のみです。系列の線種・軸範囲・横棒・値ラベルは再現しません。全系列の元データと出典は発表者ノートへ保存します。比較図の見た目はHTMLまたはPDFを使用してください。`
          : `Chart “${name}”: PPTX displays only the first series “${plot.series[0].name}”. Series styles, axis ranges, horizontal orientation and value labels are not reproduced. All series data and sources are retained in speaker notes. Use HTML or PDF for the full comparison.`,
      );
    }
    if (node.type !== 'figure') continue;
    const edit = readFigureEdit(node.attrs.figureEdit);
    if (!edit) continue;
    const name =
      edit.name || node.attrs.caption || node.attrs.alt || node.attrs.nodeId;
    if (edit.pdfSource)
      warnings.push(
        ja
          ? `図「${name}」: OfficeにはPDFページの表示画像を配置します。PDF原本・ページの再選択・切り抜きの再編集は保持しません。PDF原本を残すにはHTMLまたはZIPを保存してください。`
          : `Figure “${name}”: Office contains the rendered PDF page image. It does not retain the original PDF, page selection or crop editing. Save HTML or ZIP to keep the PDF original.`,
      );
    if (edit.crop || edit.annotations?.length || edit.svgSource || edit.diagram)
      warnings.push(
        ja
          ? `図「${name}」: OfficeではSVG・構造化図解の部品・切り抜き・注釈を1枚の画像として配置します。内部を再編集する原本はHTMLまたはZIPで保存してください。`
          : `Figure “${name}”: Office combines SVG, structured diagram parts, crop and annotations into one image. Keep HTML or ZIP to edit the individual parts.`,
      );
    if (edit.svgSource || edit.source || edit.diagram)
      warnings.push(
        ja
          ? `図「${name}」: SVGの編集ソース・構造化図解の部品・出典の関連情報はOffice内で再編集できません。原本はHTMLまたはZIPで保存してください。`
          : `Figure “${name}”: SVG source, structured diagram parts and linked reference editing are not retained in Office. Keep HTML or ZIP as the editable original.`,
      );
  }
  if (document.metadata.reader_supplements)
    warnings.push(
      ja
        ? '読者向け補足はOfficeには含まれません。閲覧にはHTMLを使用してください。'
        : 'Reader supplements are not included in Office. Use HTML for reading.',
    );
  if (document.type === 'slide' && document.metadata.slide_design)
    warnings.push(
      ja
        ? 'スライドの領域配置・表スタイル・文字設定はOffice独自の組版になります。HTMLまたはPDFで指定どおりの配置を保存できます。'
        : 'Office uses its own layout instead of slide regions, table styles and typography. HTML and PDF preserve these settings.',
    );
  return warnings;
}

export function referencedLocalImages(document: DocumentData): string[] {
  return localDocumentAssets(document.children).map(({ source }) => source);
}
