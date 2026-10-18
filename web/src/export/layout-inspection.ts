import layoutInspectionSource from './layout-inspection-runtime.js?raw';

export type LayoutStatus = 'pass' | 'overflow' | 'unmeasured';

export interface LayoutIssue {
  code: 'page-height' | 'page-width' | 'clipped-x' | 'clipped-y' | 'unmeasured';
  element: string;
  nodeId?: string;
  measuredPx?: number;
  limitPx?: number;
  reason?: string;
}

export interface PageLayoutInspection {
  page: number;
  type: 'report' | 'slide';
  status: LayoutStatus;
  widthPx: number;
  heightPx: number;
  limitWidthPx: number | null;
  limitHeightPx: number | null;
  issues: LayoutIssue[];
}

export interface LayoutInspection {
  schemaVersion: 1;
  status: LayoutStatus;
  tolerancePx: number;
  pages: PageLayoutInspection[];
}

declare global {
  interface Window {
    /** Inspect rendered pages after fonts and images have loaded. Hidden/scaled pages are unmeasured. */
    kumiInspectDocumentLayout: () => LayoutInspection;
  }
}

/** Embedded unchanged in both native HTML exporters, including their CSP hash. */
export { layoutInspectionSource };
