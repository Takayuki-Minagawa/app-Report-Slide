import { roleStylesSchema, paletteSchema, spacingSchema } from './role-style';
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
  'composite',
] as const;
export const slideRegions = [
  'full',
  'left',
  'right-top',
  'right-bottom',
  'bottom',
] as const;
export const slideCompositeSchema = z
  .strictObject({
    leftWidth: z.number().min(20).max(80),
    gap: z.number().min(0).max(48),
    reverseColumns: z.boolean(),
    assignments: z
      .array(
        z.strictObject({
          nodeId: z.string().min(1).max(512),
          nodeIndex: z.number().int().min(0).max(100000),
          region: z.enum(slideRegions),
          order: z.number().int().min(0).max(100000),
          name: z.string().max(120).optional(),
        }),
      )
      .max(100000),
  })
  .superRefine((value, context) => {
    const ids = new Set<string>();
    value.assignments.forEach((assignment, index) => {
      if (ids.has(assignment.nodeId))
        context.addIssue({
          code: 'custom',
          path: ['assignments', index, 'nodeId'],
          message: 'ブロックIDが重複しています',
        });
      ids.add(assignment.nodeId);
    });
  });
export type SlideComposite = z.infer<typeof slideCompositeSchema>;
export type SlideRegion = (typeof slideRegions)[number];
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
  composite: slideCompositeSchema.optional(),
  roleStyles: roleStylesSchema.optional(),
  palette: paletteSchema.optional(),
  spacing: spacingSchema.optional(),
  tableStyle: z
    .strictObject({
      striped: z.boolean(),
      header: z.enum(['accent', 'light']),
      cellPadding: z.number().min(2).max(14),
    })
    .optional(),
});
export type SlideDesign = z.infer<typeof slideDesignSchema>;
export type SlideTypography = z.infer<typeof slideTypographySchema>;
export const slidePresetsSchema = z.strictObject({
  version: z.literal(1),
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(120),
        design: slideDesignSchema,
      }),
    )
    .max(100),
});
export function readSlidePresets(metadata: DocumentMetadata) {
  const value = slidePresetsSchema.safeParse(metadata.slide_presets);
  return value.success ? value.data : { version: 1 as const, items: [] };
}

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
  const checked = slideDesignSchema.parse(JSON.parse(JSON.stringify(design)));
  const previous = readSlideDesignSettings(document.metadata);
  const targets = new Set(pageIds);
  const pages = splitDocumentPages(document).flatMap((nodes, pageIndex) => {
    const pageId = getSlidePageId(document, pageIndex);
    const saved = previous.pages.find((entry) => entry.pageId === pageId);
    if (targets.has(pageId)) {
      const composite = checked.composite;
      const belongsToAnotherPage =
        composite?.assignments.some(
          (assignment) =>
            document.children.some(
              (node) => node.attrs.nodeId === assignment.nodeId,
            ) && !nodes.some((node) => node.attrs.nodeId === assignment.nodeId),
        ) ?? false;
      return [
        {
          pageId,
          pageIndex,
          design: composite
            ? {
                ...checked,
                composite: rebindSlideComposite(
                  composite,
                  nodes,
                  belongsToAnotherPage,
                ),
              }
            : checked,
        },
      ];
    }
    return saved ? [{ ...saved, pageIndex }] : [];
  });
  return { ...document.metadata, slide_design: { version: 1, pages } };
}

/** Refresh transport positions just before Markdown serialization; do not use positions in the live renderer. */
export function slideDesignMetadataForMarkdown(
  document: DocumentData,
): DocumentMetadata {
  if (document.metadata.slide_design === undefined) return document.metadata;
  const metadata = applySlideDesign(
    document,
    [],
    resolveSlideDesign(document, 0),
  );
  const nodes = splitDocumentPages(document);
  const settings = readSlideDesignSettings(metadata);
  return {
    ...metadata,
    slide_design: {
      ...settings,
      pages: settings.pages.map((entry) => ({
        ...entry,
        design: entry.design.composite
          ? {
              ...entry.design,
              composite: rebindSlideComposite(
                entry.design.composite,
                nodes[entry.pageIndex] ?? [],
                false,
              ),
            }
          : entry.design,
      })),
    },
  };
}

/** Markdown intentionally regenerates node IDs. Rebind the serialized page hints once, on import. */
export function restoreSlideDesignFromMarkdown(
  document: DocumentData,
): DocumentData {
  if (document.type !== 'slide' || document.metadata.slide_design === undefined)
    return document;
  const settings = readSlideDesignSettings(document.metadata);
  const nodes = splitDocumentPages(document);
  const count = nodes.length;
  const pages = settings.pages
    .filter((entry) => entry.pageIndex < count)
    .map((entry) => ({
      ...entry,
      design: entry.design.composite
        ? {
            ...entry.design,
            composite: rebindSlideComposite(
              entry.design.composite,
              nodes[entry.pageIndex],
              true,
            ),
          }
        : entry.design,
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
  const roleTokens = Object.fromEntries(
    Object.entries(design.roleStyles ?? {}).flatMap(([role, style]) =>
      style
        ? [
            [`--role-${role}-size`, `${(style.size / 920) * 100}cqw`],
            [`--role-${role}-color`, style.color],
            [`--role-${role}-leading`, style.lineHeight],
            [`--role-${role}-before`, `${(style.spaceBefore / 920) * 100}cqw`],
            [`--role-${role}-after`, `${(style.spaceAfter / 920) * 100}cqw`],
          ]
        : [],
    ),
  );
  return {
    ...roleTokens,
    ...(design.palette
      ? {
          background: design.palette.background,
          '--slide-ink': design.palette.ink,
          '--slide-accent': design.palette.accent,
          '--slide-tint': design.palette.tint,
        }
      : {}),
    ...(design.spacing
      ? {
          '--slide-inset-x': `${(design.spacing.horizontal / 920) * 100}cqw`,
          '--slide-inset-y': `${(design.spacing.vertical / 920) * 100}cqw`,
          '--slide-gap': `${(design.spacing.gap / 920) * 100}cqw`,
          '--slide-leading': design.spacing.lineHeight,
        }
      : {}),
    ...Object.fromEntries(
      Object.entries(design.typography).map(([role, size]) => [
        `--slide-${role}-size`,
        `${(size / 920) * 100}cqw`,
      ]),
    ),
    ...(design.composite
      ? {
          '--slide-composite-left': `${design.composite.leftWidth}fr`,
          '--slide-composite-right': `${100 - design.composite.leftWidth}fr`,
          '--slide-composite-gap': `${(design.composite.gap / 920) * 100}cqw`,
        }
      : {}),
    ...(design.tableStyle
      ? {
          '--slide-cell-padding': `${(design.tableStyle.cellPadding / 920) * 100}cqw`,
          '--slide-table-header':
            design.tableStyle.header === 'light'
              ? 'var(--slide-tint)'
              : 'var(--slide-accent)',
          '--slide-table-header-ink':
            design.tableStyle.header === 'light' ? 'var(--slide-ink)' : '#fff',
        }
      : {}),
  } as CSSProperties;
}

/** Manual image coordinates remain in the original canvas and are never put inside a region. */
export function isManualSlideNode(
  node: DocumentData['children'][number],
): boolean {
  return node.type === 'figure' && !!node.attrs.slidePlacement;
}

export function createSlideComposite(
  nodes: DocumentData['children'],
): SlideComposite {
  const candidates = nodes.filter(
    (node, index) =>
      !(index === 0 && node.type === 'heading') &&
      node.type !== 'speakerNotes' &&
      !isManualSlideNode(node),
  );
  return {
    leftWidth: 55,
    gap: 24,
    reverseColumns: false,
    assignments: candidates.map((node, index) => ({
      nodeId: node.attrs.nodeId,
      nodeIndex: nodes.indexOf(node),
      region:
        index === 0
          ? 'left'
          : index === 1
            ? 'right-top'
            : index === candidates.length - 1 && candidates.length > 3
              ? 'bottom'
              : 'right-bottom',
      order: index,
    })),
  };
}

/** Index fallback is reserved for explicit template application or Markdown's fresh IDs. */
export function rebindSlideComposite(
  composite: SlideComposite,
  nodes: DocumentData['children'],
  allowIndexFallback: boolean,
): SlideComposite {
  return {
    ...composite,
    assignments: composite.assignments
      .flatMap((assignment) => {
        const node =
          nodes.find(
            (candidate) => candidate.attrs.nodeId === assignment.nodeId,
          ) ?? (allowIndexFallback ? nodes[assignment.nodeIndex] : undefined);
        if (!node) return [];
        return [
          {
            ...assignment,
            nodeId: node.attrs.nodeId,
            nodeIndex: nodes.indexOf(node),
          },
        ];
      })
      .filter(
        (assignment, index, assignments) =>
          assignments.findIndex(
            (entry) => entry.nodeId === assignment.nodeId,
          ) === index,
      ),
  };
}

/** Actual DOM groups follow the visible reading order; no CSS order trick or content mutation. */
export function groupSlideCompositeNodes(
  nodes: DocumentData['children'],
  composite: SlideComposite,
) {
  const title =
    nodes[0]?.type === 'heading' &&
    !composite.assignments.some(
      (entry) => entry.nodeId === nodes[0].attrs.nodeId,
    )
      ? nodes[0]
      : undefined;
  const regions = Object.fromEntries(
    slideRegions.map((region) => [region, []]),
  ) as unknown as Record<SlideRegion, DocumentData['children']>;
  const manual: DocumentData['children'] = [];
  for (const node of nodes) {
    if (node === title || node.type === 'speakerNotes') continue;
    if (isManualSlideNode(node)) {
      manual.push(node);
      continue;
    }
    const assignment = composite.assignments.find(
      (entry) => entry.nodeId === node.attrs.nodeId,
    );
    regions[assignment?.region ?? 'bottom'].push(node);
  }
  for (const region of slideRegions)
    regions[region].sort((a, b) => {
      const rank = (id: string) =>
        composite.assignments.find((entry) => entry.nodeId === id)?.order ??
        100001;
      return rank(a.attrs.nodeId) - rank(b.attrs.nodeId);
    });
  return { title, regions, manual };
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
