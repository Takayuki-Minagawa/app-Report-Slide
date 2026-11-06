import type { CSSProperties } from 'react';
import type { DocumentNode, ParagraphNode } from './model';
import type { PageSettings } from './page-settings';
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

/** Analyze the entire assembled document, before splitting it into pages. */
export function paragraphAfterHeadingIds(
  nodes: readonly DocumentNode[],
): Set<string> {
  const ids = new Set<string>();
  let afterHeading = false;
  for (const node of nodes) {
    if (node.type === 'heading') {
      afterHeading = true;
      continue;
    }
    if (node.type === 'pageBreak' || node.type === 'slideBreak') continue;
    if (node.type === 'paragraph') {
      const empty = (node.content ?? []).every(
        (entry) =>
          entry.type === 'hardBreak' ||
          (entry.type === 'text' && entry.text.trim().length === 0),
      );
      if (empty) continue;
      if (afterHeading) ids.add(node.attrs.nodeId);
    }
    afterHeading = false;
  }
  return ids;
}

export interface ResolvedParagraphIndent {
  /** null preserves a legacy ruler percentage, rather than an em measurement. */
  em: number | null;
  source: 'document' | 'heading' | 'explicit' | 'ruler' | 'excluded';
  style: CSSProperties;
}

/** Preserve legacy ruler margins while resolving the first line independently. */
export function resolveParagraphIndent(
  node: ParagraphNode,
  settings: PageSettings,
  context: { topLevel: boolean; afterHeading: boolean },
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
  const em = headingRule ? 0 : settings.first_line_indent;
  return {
    em,
    source: headingRule ? 'heading' : 'document',
    style: { ...rulerStyle, textIndent: `${em}em` },
  };
}
