import type { DocumentData, DocumentNode } from './model';
import { resolveReportSettings } from './report-settings';
import { splitDocumentPages } from './semantics';

export type ReportPageKind = 'cover' | 'contents' | 'body';

export function hasReportContentsPage(document: DocumentData): boolean {
  if (document.type !== 'report') return false;
  const settings = resolveReportSettings(document.metadata);
  return (
    settings.toc_page &&
    (document.metadata.toc === true ||
      settings.list_figures ||
      settings.list_tables)
  );
}

export function frontMatterPageCount(document: DocumentData): number {
  if (document.type !== 'report') return 0;
  return (
    Number(resolveReportSettings(document.metadata).cover) +
    Number(hasReportContentsPage(document))
  );
}

export function reportPageKind(
  document: DocumentData,
  index: number,
): ReportPageKind {
  if (document.type !== 'report') return 'body';
  const cover = resolveReportSettings(document.metadata).cover;
  if (cover && index === 0) return 'cover';
  if (hasReportContentsPage(document) && index === Number(cover))
    return 'contents';
  return 'body';
}

/** Notes and empty editing placeholders do not require a body page after generated front matter. */
export function hasReportBodyContent(document: DocumentData): boolean {
  return document.children.some((node) => {
    if (node.type === 'speakerNotes') return false;
    if (node.type !== 'paragraph') return true; // Explicit breaks preserve their empty pages.
    return (node.content ?? []).some(
      (entry) =>
        entry.type !== 'hardBreak' &&
        (entry.type !== 'text' || entry.text.trim().length > 0),
    );
  });
}

/** Generated front matter never modifies the editable document's nodes or page breaks. */
export function splitRenderedPages(document: DocumentData): DocumentNode[][] {
  const count = frontMatterPageCount(document);
  return [
    ...Array.from({ length: count }, () => [] as DocumentNode[]),
    ...(count > 0 && !hasReportBodyContent(document)
      ? []
      : splitDocumentPages(document)),
  ];
}
