import { z } from 'zod';
import type { DocumentData, DocumentMetadata } from './model';
import { splitDocumentPages } from './semantics';

const readerSupplementSectionSchema = z.strictObject({
  title: z.string().max(200),
  text: z.string().max(20000),
  link: z
    .string()
    .max(2000)
    .refine((value) => !value || /^https?:\/\/[^\s]+$/i.test(value)),
});

export const readerSupplementsSchema = z
  .strictObject({
    version: z.literal(1),
    pages: z
      .array(
        z.strictObject({
          pageId: z.string().min(1).max(512),
          pageIndex: z.number().int().min(0).max(100000),
          anchorIds: z.array(z.string().min(1).max(512)).max(100000).optional(),
          orphaned: z.boolean().optional(),
          ...readerSupplementSectionSchema.shape,
          /** Multiple chapter supplements may share one assembled Report page. */
          sections: z.array(readerSupplementSectionSchema).max(1000).optional(),
        }),
      )
      .max(100000),
  })
  .superRefine((settings, context) => {
    const ids = new Set<string>(),
      positions = new Set<number>();
    settings.pages.forEach((entry, index) => {
      if (
        ids.has(entry.pageId) ||
        (!entry.orphaned && positions.has(entry.pageIndex))
      )
        context.addIssue({
          code: 'custom',
          path: ['pages', index],
          message: 'Supplement pages must be unique',
        });
      ids.add(entry.pageId);
      if (!entry.orphaned) positions.add(entry.pageIndex);
    });
  });
export type ReaderSupplements = z.infer<typeof readerSupplementsSchema>;
export function readReaderSupplements(
  metadata: DocumentMetadata,
): ReaderSupplements {
  const result = readerSupplementsSchema.safeParse(metadata.reader_supplements);
  return result.success ? result.data : { version: 1, pages: [] };
}
type ReaderEntry = ReaderSupplements['pages'][number];
const sectionOf = (entry: ReaderEntry) => ({
  title: entry.title,
  text: entry.text,
  link: entry.link,
});

/** Use surviving content IDs, never an old page number, to recover a deleted title anchor. */
function resolvedSettings(document: DocumentData): ReaderSupplements {
  const settings = readReaderSupplements(document.metadata);
  const pages = splitDocumentPages(document);
  const indexes = new Map(
    pages.flatMap((nodes, index) =>
      nodes.map((node) => [node.attrs.nodeId, index] as const),
    ),
  );
  const result: ReaderEntry[] = [];
  for (const entry of settings.pages) {
    const exact = indexes.get(entry.pageId);
    const candidates = new Set(
      (entry.anchorIds ?? []).flatMap((id) =>
        indexes.has(id) ? [indexes.get(id)!] : [],
      ),
    );
    const index =
      exact ?? (candidates.size === 1 ? [...candidates][0] : undefined);
    if (index === undefined) {
      result.push({ ...entry, orphaned: true });
      continue;
    }
    const anchorIds = pages[index].map((node) => node.attrs.nodeId);
    const { orphaned: _oldOrphaned, ...retained } = entry;
    const attached = {
      ...retained,
      pageId: exact !== undefined ? entry.pageId : anchorIds[0],
      pageIndex: index,
      anchorIds,
    };
    // Removing a page break can merge pages. Keep every supplement as a section.
    const existing = result.find(
      (value) => !value.orphaned && value.pageIndex === index,
    );
    if (existing) {
      const sections = [
        ...(existing.sections ?? []),
        sectionOf(attached),
        ...(attached.sections ?? []),
      ];
      if (sections.length <= 1000) existing.sections = sections;
      else result.push({ ...entry, orphaned: true });
    } else result.push(attached);
  }
  return { version: 1, pages: result };
}
export function readerSupplementForPage(document: DocumentData, index: number) {
  return resolvedSettings(document).pages.find(
    (entry) => !entry.orphaned && entry.pageIndex === index,
  );
}
export function unassignedReaderSupplements(document: DocumentData) {
  return resolvedSettings(document).pages.filter((entry) => entry.orphaned);
}
export function setReaderSupplement(
  document: DocumentData,
  index: number,
  entry: { title: string; text: string; link: string },
): DocumentMetadata {
  const nodes = splitDocumentPages(document)[index] ?? [];
  if (!nodes.length) return document.metadata;
  const settings = resolvedSettings(document);
  const old = settings.pages.find(
    (value) => !value.orphaned && value.pageIndex === index,
  );
  const pages = settings.pages.filter((value) => value !== old);
  if (entry.title || entry.text || entry.link || old?.sections?.length)
    pages.push({
      ...entry,
      ...(old?.sections ? { sections: old.sections } : {}),
      pageId: old?.pageId ?? nodes[0].attrs.nodeId,
      pageIndex: index,
      anchorIds: nodes.map((node) => node.attrs.nodeId),
    });
  return { ...document.metadata, reader_supplements: { version: 1, pages } };
}
/** Reassignment is explicit so deleting a whole page never moves its notes onto a neighbour. */
export function reattachReaderSupplement(
  document: DocumentData,
  pageId: string,
  index: number,
): DocumentMetadata {
  const nodes = splitDocumentPages(document)[index] ?? [];
  const settings = resolvedSettings(document);
  const orphan = settings.pages.find(
    (entry) => entry.pageId === pageId && entry.orphaned,
  );
  if (!nodes.length || !orphan) return document.metadata;
  const existing = settings.pages.find(
    (entry) => !entry.orphaned && entry.pageIndex === index,
  );
  const { orphaned: _orphaned, ...saved } = orphan;
  const replacement: ReaderEntry = existing
    ? {
        ...existing,
        sections: [
          ...(existing.sections ?? []),
          sectionOf(orphan),
          ...(orphan.sections ?? []),
        ],
      }
    : {
        ...saved,
        pageId: nodes[0].attrs.nodeId,
        pageIndex: index,
        anchorIds: nodes.map((node) => node.attrs.nodeId),
      };
  if ((replacement.sections?.length ?? 0) > 1000)
    throw new Error(
      'このページの補足が1000件を超えます。別のページを選んでください。',
    );
  return {
    ...document.metadata,
    reader_supplements: {
      version: 1,
      pages: [
        ...settings.pages.filter(
          (entry) => entry !== orphan && entry !== existing,
        ),
        replacement,
      ],
    },
  };
}
/** Markdown creates new IDs. Only attached entries may use the saved transport position. */
export function rebindReaderSupplements(document: DocumentData): DocumentData {
  const settings = readReaderSupplements(document.metadata);
  if (!settings.pages.length) return document;
  const pages = splitDocumentPages(document);
  return {
    ...document,
    metadata: {
      ...document.metadata,
      reader_supplements: {
        version: 1,
        pages: settings.pages.map((entry) => {
          if (entry.orphaned || !pages[entry.pageIndex]?.length)
            return { ...entry, orphaned: true };
          const nodes = pages[entry.pageIndex];
          return {
            ...entry,
            pageId: nodes[0].attrs.nodeId,
            anchorIds: nodes.map((node) => node.attrs.nodeId),
          };
        }),
      },
    },
  };
}
/** Keep detached originals in every save; never silently filter out a missing anchor. */
export function syncReaderSupplementPositions(
  document: DocumentData,
): DocumentMetadata {
  if (document.metadata.reader_supplements === undefined)
    return document.metadata;
  return {
    ...document.metadata,
    reader_supplements: resolvedSettings(document),
  };
}
