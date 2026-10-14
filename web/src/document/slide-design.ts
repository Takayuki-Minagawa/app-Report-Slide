import type { CSSProperties } from 'react';
import { z } from 'zod';
import type { DocumentData, DocumentMetadata } from './model';
import { resolveDocumentTheme } from './metadata';
import { splitDocumentPages } from './semantics';

export const slideLayouts = [
  'standard',
  'cover',
  'comparison',
  'figure-right',
  'figure-top',
  'table-focus',
  'formula-focus',
  'key-number',
] as const;
export const slideDensities = ['spacious', 'standard', 'compact'] as const;
export const slideTypeRoles = [
  'title',
  'heading',
  'body',
  'table',
  'caption',
] as const;

export const slideTypographySchema = z.strictObject({
  title: z.number().min(20).max(64),
  heading: z.number().min(16).max(48),
  body: z.number().min(12).max(36),
  table: z.number().min(10).max(30),
  caption: z.number().min(10).max(24),
});
export const slideDesignSchema = z.strictObject({
  theme: z.enum(['beamer-simple', 'technical', 'paper-light']),
  layout: z.enum(slideLayouts),
  density: z.enum(slideDensities),
  typography: slideTypographySchema,
});
export type SlideDesign = z.infer<typeof slideDesignSchema>;
export type SlideTypography = z.infer<typeof slideTypographySchema>;

export const slideDesignSettingsSchema = z
  .strictObject({
    version: z.literal(1),
    pages: z
      .array(
        z.strictObject({
          pageId: z.string().min(1).max(512),
          // A transport hint for Markdown, whose parser creates fresh node IDs.
          pageIndex: z.number().int().min(0).max(100000),
          design: slideDesignSchema,
        }),
      )
      .max(100000),
  })
  .superRefine((settings, context) => {
    const seen = new Set<string>();
    const positions = new Set<number>();
    settings.pages.forEach((entry, index) => {
      if (seen.has(entry.pageId))
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'pageId'],
          message: 'ページIDが重複しています',
        });
      if (positions.has(entry.pageIndex))
        context.addIssue({
          code: 'custom',
          path: ['pages', index, 'pageIndex'],
          message: 'ページ位置が重複しています',
        });
      seen.add(entry.pageId);
      positions.add(entry.pageIndex);
    });
  });
export type SlideDesignSettings = z.infer<typeof slideDesignSettingsSchema>;

export const slideTypographyPresets: Record<
  SlideDesign['density'],
  SlideTypography
> = {
  spacious: { title: 40, heading: 28, body: 22, table: 19, caption: 14 },
  standard: { title: 34, heading: 24, body: 18, table: 16, caption: 12 },
  compact: { title: 30, heading: 22, body: 16, table: 14, caption: 11 },
};

export function slideDesignIssues(value: unknown): string[] {
  if (value === undefined) return [];
  const parsed = slideDesignSettingsSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) =>
          `slide_design${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      );
}

export function readSlideDesignSettings(
  metadata: DocumentMetadata,
): SlideDesignSettings {
  const parsed = slideDesignSettingsSchema.safeParse(metadata.slide_design);
  return parsed.success ? parsed.data : { version: 1, pages: [] };
}

/** Existing block IDs anchor designs to pages when pages are inserted or reordered. */
export function getSlidePageId(
  document: DocumentData,
  pageIndex: number,
): string {
  const pages = splitDocumentPages(document);
  const nodes = pages[pageIndex] ?? [];
  const saved = readSlideDesignSettings(document.metadata);
  const nodeIds = new Set(nodes.map((node) => node.attrs.nodeId));
  const existing = saved.pages.find((entry) => nodeIds.has(entry.pageId));
  if (existing) return existing.pageId;
  if (nodes[0]) return nodes[0].attrs.nodeId;
  const breaks = document.children.filter(
    (node) => node.type === 'pageBreak' || node.type === 'slideBreak',
  );
  return pageIndex === 0
    ? `empty-before:${breaks[0]?.attrs.nodeId ?? 'document'}`
    : `empty-after:${breaks[pageIndex - 1]?.attrs.nodeId ?? pageIndex}`;
}

export function resolveSlideDesign(
  document: DocumentData,
  pageIndex: number,
): SlideDesign {
  const settings = readSlideDesignSettings(document.metadata);
  const pageId = getSlidePageId(document, pageIndex);
  return (
    settings.pages.find((entry) => entry.pageId === pageId)?.design ?? {
      theme: resolveDocumentTheme(
        'slide',
        document.metadata.theme,
      ) as SlideDesign['theme'],
      layout: 'standard',
      density: 'standard',
      typography: { ...slideTypographyPresets.standard },
    }
  );
}

/** Only metadata changes. Text, formulas, values, node IDs and manual figure positions stay intact. */
export function applySlideDesign(
  document: DocumentData,
  pageIds: readonly string[],
  design: SlideDesign,
): DocumentMetadata {
  if (document.type !== 'slide') return document.metadata;
  const checked = slideDesignSchema.parse(design);
  const previous = readSlideDesignSettings(document.metadata);
  const targets = new Set(pageIds);
  const pages = splitDocumentPages(document).flatMap((_, pageIndex) => {
    const pageId = getSlidePageId(document, pageIndex);
    const saved = previous.pages.find((entry) => entry.pageId === pageId);
    if (targets.has(pageId)) return [{ pageId, pageIndex, design: checked }];
    return saved ? [{ ...saved, pageIndex }] : [];
  });
  return { ...document.metadata, slide_design: { version: 1, pages } };
}

/** Refresh transport positions just before Markdown serialization; do not use positions in the live renderer. */
export function slideDesignMetadataForMarkdown(
  document: DocumentData,
): DocumentMetadata {
  if (document.metadata.slide_design === undefined) return document.metadata;
  return applySlideDesign(document, [], resolveSlideDesign(document, 0));
}

/** Markdown intentionally regenerates node IDs. Rebind the serialized page hints once, on import. */
export function restoreSlideDesignFromMarkdown(
  document: DocumentData,
): DocumentData {
  if (document.type !== 'slide' || document.metadata.slide_design === undefined)
    return document;
  const settings = readSlideDesignSettings(document.metadata);
  const count = splitDocumentPages(document).length;
  const pages = settings.pages
    .filter((entry) => entry.pageIndex < count)
    .map((entry) => ({
      ...entry,
      pageId: getSlidePageId(
        {
          ...document,
          metadata: { ...document.metadata, slide_design: undefined },
        },
        entry.pageIndex,
      ),
    }));
  return {
    ...document,
    metadata: { ...document.metadata, slide_design: { version: 1, pages } },
  };
}

/** Fonts use the 920 px reference canvas and scale with the actual slide width. */
export function slideDesignStyle(design: SlideDesign): CSSProperties {
  return Object.fromEntries(
    Object.entries(design.typography).map(([role, size]) => [
      `--slide-${role}-size`,
      `${(size / 920) * 100}cqw`,
    ]),
  ) as CSSProperties;
}

/** Group existing nodes for presentation without editing their contents or stored order. */
export function groupSlideDesignNodes(
  nodes: DocumentData['children'],
  layout: SlideDesign['layout'],
): {
  title?: DocumentData['children'][number];
  columns: DocumentData['children'][];
} | null {
  const title = nodes[0]?.type === 'heading' ? nodes[0] : undefined;
  const content = title ? nodes.slice(1) : nodes;
  if (layout === 'comparison') {
    const headings = content.flatMap((node, index) =>
      node.type === 'heading' ? [index] : [],
    );
    const split =
      headings.length >= 2 ? headings[1] : Math.ceil(content.length / 2);
    return { title, columns: [content.slice(0, split), content.slice(split)] };
  }
  if (layout !== 'figure-right' && layout !== 'figure-top') return null;
  const figure = content.find(
    (node) =>
      node.type === 'chart' ||
      (node.type === 'figure' && !node.attrs.slidePlacement),
  );
  if (!figure) return null;
  const text = content.filter((node) => node !== figure);
  return {
    title,
    columns: layout === 'figure-top' ? [[figure], text] : [text, [figure]],
  };
}
