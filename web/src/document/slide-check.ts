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
  | 'image-unavailable';

export interface SlideCheckIssue {
  id: string;
  page: number;
  title: string;
  kind: SlideCheckIssueKind;
  nodeId?: string;
  name: string;
  otherName?: string;
  fontSize?: number;
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
