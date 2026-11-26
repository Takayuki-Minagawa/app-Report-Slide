import type { CSSProperties } from 'react';
import type { DocumentNode, ParagraphNode } from './model';
import type { NoIndentAfterKind, PageSettings } from './page-settings';
import { textRulerStyle } from './text-ruler';

export type FirstLineIndent =
  | { mode: 'inherit' }
  | { mode: 'em'; value: number };

export function isFirstLineIndent(value: unknown): value is FirstLineIndent {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const indent = value as Record<string, unknown>;
  if (indent.mode === 'inherit')
    return Object.keys(indent).length === 1 && Object.hasOwn(indent, 'mode');
  return (
    indent.mode === 'em' &&
    Object.keys(indent).length === 2 &&
    Object.hasOwn(indent, 'mode') &&
    Object.hasOwn(indent, 'value') &&
    typeof indent.value === 'number' &&
    Number.isFinite(indent.value) &&
    indent.value >= 0 &&
    indent.value <= 8
  );
}

export type IndentLead = 'heading' | NoIndentAfterKind;

const blockLeadKinds: Partial<Record<DocumentNode['type'], NoIndentAfterKind>> =
  {
    blockMath: 'math',
    figure: 'figure',
    chart: 'figure',
    table: 'table',
    bulletList: 'list',
    orderedList: 'list',
    blockquote: 'quote',
    codeBlock: 'code',
  };

/**
 * Analyze the entire assembled document, before splitting it into pages.
 * Maps each paragraph that directly follows a heading or a body block to that
 * lead. Empty paragraphs and explicit page/slide breaks are transparent.
 */
export function paragraphIndentLeads(
  nodes: readonly DocumentNode[],
): Map<string, IndentLead> {
  const leads = new Map<string, IndentLead>();
  let lead: IndentLead | null = null;
  for (const node of nodes) {
    if (node.type === 'pageBreak' || node.type === 'slideBreak') continue;
    if (node.type === 'paragraph') {
      const empty = (node.content ?? []).every(
        (entry) =>
          entry.type === 'hardBreak' ||
          (entry.type === 'text' && entry.text.trim().length === 0),
      );
      if (empty) continue;
      if (lead) leads.set(node.attrs.nodeId, lead);
      lead = null;
      continue;
    }
    lead =
      node.type === 'heading' ? 'heading' : (blockLeadKinds[node.type] ?? null);
  }
  return leads;
}

export function paragraphAfterHeadingIds(
  nodes: readonly DocumentNode[],
): Set<string> {
  return new Set(
    [...paragraphIndentLeads(nodes)]
      .filter(([, lead]) => lead === 'heading')
      .map(([id]) => id),
  );
}

/** Build the context argument of resolveParagraphIndent from analyzed leads. */
export function indentContext(
  leads: ReadonlyMap<string, IndentLead>,
  nodeId: string,
  topLevel: boolean,
): { topLevel: boolean; afterHeading: boolean; lead: IndentLead | null } {
  const lead = leads.get(nodeId) ?? null;
  return { topLevel, afterHeading: lead === 'heading', lead };
}

export interface ResolvedParagraphIndent {
  /** null preserves a legacy ruler percentage, rather than an em measurement. */
  em: number | null;
  source: 'document' | 'heading' | 'block' | 'explicit' | 'ruler' | 'excluded';
  style: CSSProperties;
}

/** Preserve legacy ruler margins while resolving the first line independently. */
export function resolveParagraphIndent(
  node: ParagraphNode,
  settings: PageSettings,
  context: {
    topLevel: boolean;
    afterHeading: boolean;
    lead?: IndentLead | null;
  },
): ResolvedParagraphIndent {
  const rulerStyle = textRulerStyle(node.attrs.textRuler);
  const indent = node.attrs.firstLineIndent;
  if (!context.topLevel) {
    return rulerStyle
      ? { em: null, source: 'ruler', style: rulerStyle }
      : { em: 0, source: 'excluded', style: { textIndent: '0em' } };
  }
  if (isFirstLineIndent(indent) && indent.mode === 'em') {
    return {
      em: indent.value,
      source: 'explicit',
      style: { ...rulerStyle, textIndent: `${indent.value}em` },
    };
  }
  if (!isFirstLineIndent(indent) && rulerStyle)
    return { em: null, source: 'ruler', style: rulerStyle };

  const headingRule =
    context.afterHeading && settings.after_heading_indent === 'none';
  const lead = context.lead;
  const blockRule =
    !headingRule &&
    !!lead &&
    lead !== 'heading' &&
    (settings.no_indent_after ?? []).includes(lead);
  const em = headingRule || blockRule ? 0 : settings.first_line_indent;
  return {
    em,
    source: headingRule ? 'heading' : blockRule ? 'block' : 'document',
    style: { ...rulerStyle, textIndent: `${em}em` },
  };
}
