import type { DocumentData } from './model';
import { splitDocumentPages } from './semantics';
import {
  applySlideDesign,
  getSlidePageId,
  resolveSlideDesign,
} from './slide-design';
import { walkDocumentTree } from './traversal';
import { selectedGroupNodes } from './block-groups';
import { readBlockLayout } from './block-layout';

/** Geometry is measured at the editor's 920 px reference canvas, not screen zoom. */
export interface SlideCheckRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SlideCheckElement {
  nodeId: string;
  /** Generated content has a synthetic ID, but focuses its real source block. */
  focusNodeId?: string;
  name: string;
  rect: SlideCheckRect;
  /** Bounds of visible descendants, including captions outside positioned figures. */
  contentRect?: SlideCheckRect;
  ancestorNodeIds?: readonly string[];
  smallestFontSize?: number;
  clipped?: boolean;
}

export type SlideCheckIssueKind =
  | 'overflow'
  | 'overlap'
  | 'footer-overlap'
  | 'small-text'
  | 'measurement-unavailable'
  | 'image-unavailable'
  | 'image-low-resolution';

export interface SlideCheckIssue {
  id: string;
  page: number;
  title: string;
  kind: SlideCheckIssueKind;
  nodeId?: string;
  name: string;
  otherName?: string;
  fontSize?: number;
  pixelRatio?: number;
}

export interface SlideCheckMeasurement {
  /** One-based page number. */
  page: number;
  title: string;
  canvas: SlideCheckRect;
  footer?: SlideCheckRect;
  elements: readonly SlideCheckElement[];
  clipped?: boolean;
}

const tolerance = 2;

function isVisibleRect(rect: SlideCheckRect): boolean {
  return (
    Object.values(rect).every(Number.isFinite) &&
    rect.right > rect.left &&
    rect.bottom > rect.top
  );
}

function overlaps(a: SlideCheckRect, b: SlideCheckRect): boolean {
  return (
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > tolerance &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > tolerance
  );
}

function outside(rect: SlideCheckRect, canvas: SlideCheckRect): boolean {
  return (
    rect.left < canvas.left - tolerance ||
    rect.top < canvas.top - tolerance ||
    rect.right > canvas.right + tolerance ||
    rect.bottom > canvas.bottom + tolerance
  );
}

/** Read-only conservative checks: overlaps are review candidates, never auto-fixed. */
export function checkSlideGeometry(
  measurement: SlideCheckMeasurement,
  minimumFontSize = 12,
): SlideCheckIssue[] {
  const { page, title, canvas, footer } = measurement;
  const issues: SlideCheckIssue[] = [];
  const add = (
    kind: SlideCheckIssueKind,
    element?: SlideCheckElement,
    other?: SlideCheckElement,
  ) => {
    issues.push({
      id: `${page}:${kind}:${element?.nodeId ?? 'page'}:${other?.nodeId ?? ''}`,
      page,
      title,
      kind,
      nodeId: element?.focusNodeId ?? element?.nodeId,
      name: element?.name ?? title,
      otherName: other?.name,
      ...(kind === 'small-text' ? { fontSize: element?.smallestFontSize } : {}),
    });
  };
  if (!isVisibleRect(canvas)) {
    add('measurement-unavailable');
    return issues;
  }
  const elements = measurement.elements.filter((element) =>
    isVisibleRect(element.rect),
  );
  for (const [index, element] of elements.entries()) {
    const contentRect = element.contentRect ?? element.rect;
    if (element.clipped || outside(contentRect, canvas))
      add('overflow', element);
    if (footer && isVisibleRect(footer) && overlaps(contentRect, footer))
      add('footer-overlap', element);
    if (
      Number.isFinite(element.smallestFontSize) &&
      element.smallestFontSize! > 0 &&
      element.smallestFontSize! + 0.1 < minimumFontSize
    )
      add('small-text', element);
    for (const other of elements.slice(index + 1)) {
      // Lists, tables and callouts contain child blocks by design.
      if (
        element.ancestorNodeIds?.includes(other.nodeId) ||
        other.ancestorNodeIds?.includes(element.nodeId)
      )
        continue;
      if (overlaps(contentRect, other.contentRect ?? other.rect))
        add('overlap', element, other);
    }
  }
  if (measurement.clipped && !issues.some((issue) => issue.kind === 'overflow'))
    add('overflow', elements[0]);
  return issues;
}

/** One source pixel per reference-canvas pixel is a screen-quality hint, not OCR. */
export function rasterPixelRatio(
  naturalWidth: number,
  naturalHeight: number,
  width: number,
  height: number,
): number | undefined {
  if (
    ![naturalWidth, naturalHeight, width, height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return undefined;
  return Math.min(naturalWidth / width, naturalHeight / height);
}

function placementLocked(
  document: DocumentData,
  pageIndex: number,
  nodeId: string,
) {
  return selectedGroupNodes(document, pageIndex, [nodeId]).some(
    (node) => readBlockLayout(node.attrs.blockLayout).locked,
  );
}

/** Suggestions retain all content and identify the available controls; no automatic shrinking. */
export function slideCheckSuggestions(
  document: DocumentData,
  issue: SlideCheckIssue,
  locale: 'ja' | 'en',
): string[] {
  const ja = locale === 'ja';
  if (issue.kind === 'image-low-resolution')
    return [
      ja
        ? '元画像を高解像度の素材へ差し替えるか、図の表示幅を小さくしてください。出力HTMLで図を拡大し、軸と凡例を目視確認してください。'
        : 'Use a higher-resolution original or reduce the figure width. Enlarge the figure in exported HTML and inspect axes and legends.',
    ];
  if (
    !['overflow', 'overlap', 'small-text', 'footer-overlap'].includes(
      issue.kind,
    )
  )
    return [];
  const nodes = splitDocumentPages(document)[issue.page - 1] ?? [];
  const block = nodes.find((candidate) =>
    Array.from(walkDocumentTree([candidate])).some(
      (node) =>
        'attrs' in node &&
        'nodeId' in node.attrs &&
        node.attrs.nodeId === issue.nodeId,
    ),
  );
  if (block && placementLocked(document, issue.page - 1, block.attrs.nodeId))
    return [
      ja
        ? '対象または同じグループのブロックは配置がロックされています。「ブロックのまとまり・再利用」でロックを解除してから、配置変更や表の分割を行ってください。'
        : 'This block or another member of its group is placement-locked. Unlock it in Block groups and reuse before changing its layout or splitting the table.',
    ];
  const design = resolveSlideDesign(document, issue.page - 1);
  const assignment = design.composite?.assignments.find(
    (entry) => entry.nodeId === block?.attrs.nodeId,
  );
  const result: string[] = [];
  if (block?.type === 'table')
    result.push(
      ja
        ? '表を「全幅上部」または「全幅下部」へ移し、表のセル余白を調整してください。長い表は意味のまとまりで次のページへ分け、ヘッダーを残してください。'
        : 'Assign the table to a full-width region and adjust table cell padding. Split a long table by logical groups across pages and repeat its header.',
    );
  if (design.layout === 'composite' && assignment)
    result.push(
      ja
        ? '複合レイアウトで主領域の幅と領域間の余白を比較し、必要なら図と説明の左右を入れ替えてください。変更をプレビューしてから適用できます。'
        : 'Compare the main-region width and region gap in Composite layout; swap columns if needed. Preview the change before applying.',
    );
  if (block?.type === 'figure')
    result.push(
      ja
        ? '図の幅・高さを調整し、キャプションと出典の余地を確保してください。原図の細字は拡大して確認してください。'
        : 'Adjust figure width and height while leaving room for its caption and source. Enlarge the original to inspect fine text.',
    );
  if (issue.kind === 'small-text')
    result.push(
      ja
        ? '文字をさらに小さくせず、表・本文の文字サイズを戻してから全幅配置やページ分割を試してください。'
        : 'Keep text readable: restore the table/body font size and try a full-width region or another page.',
    );
  return result;
}

export type SlideCheckRepairAction = 'split-table' | 'full-width-table';
/** Only explicit, reversible repairs are offered. Guessing which overlap to move is unsafe. */
export function slideCheckRepairs(
  document: DocumentData,
  issue: SlideCheckIssue,
): Array<{ nodeId: string; action: SlideCheckRepairAction }> {
  if (
    !['overflow', 'overlap', 'small-text', 'footer-overlap'].includes(
      issue.kind,
    )
  )
    return [];
  const nodes = splitDocumentPages(document)[issue.page - 1] ?? [];
  const table = nodes.find(
    (candidate) =>
      candidate.type === 'table' &&
      Array.from(walkDocumentTree([candidate])).some(
        (node) =>
          'attrs' in node &&
          'nodeId' in node.attrs &&
          node.attrs.nodeId === issue.nodeId,
      ),
  );
  if (!table || placementLocked(document, issue.page - 1, table.attrs.nodeId))
    return [];
  const result: Array<{ nodeId: string; action: SlideCheckRepairAction }> = [
    { nodeId: table.attrs.nodeId, action: 'split-table' },
  ];
  const design = resolveSlideDesign(document, issue.page - 1);
  const assignment = design.composite?.assignments.find(
    (entry) => entry.nodeId === table.attrs.nodeId,
  );
  if (
    design.layout === 'composite' &&
    assignment &&
    !['top', 'bottom'].includes(assignment.region)
  )
    result.unshift({ nodeId: table.attrs.nodeId, action: 'full-width-table' });
  return result;
}

/** Preserve every node and all other region assignments; only widen the selected table. */
export function slideCheckRepairMetadata(
  document: DocumentData,
  nodeId: string,
  action: SlideCheckRepairAction,
) {
  if (document.type !== 'slide' || action !== 'full-width-table')
    return undefined;
  const pageIndex = splitDocumentPages(document).findIndex((nodes) =>
    nodes.some((node) => node.type === 'table' && node.attrs.nodeId === nodeId),
  );
  if (pageIndex < 0 || placementLocked(document, pageIndex, nodeId))
    return undefined;
  const design = resolveSlideDesign(document, pageIndex);
  if (
    design.layout !== 'composite' ||
    !design.composite?.assignments.some((entry) => entry.nodeId === nodeId)
  )
    return undefined;
  return applySlideDesign(document, [getSlidePageId(document, pageIndex)], {
    ...design,
    composite: {
      ...design.composite,
      assignments: design.composite.assignments.map((entry) =>
        entry.nodeId === nodeId
          ? { ...entry, region: 'bottom' as const }
          : entry,
      ),
    },
  });
}
