import {
  inlineText,
  type DocumentData,
  type DocumentNode,
  type FootnoteNode,
} from './model';
import { walkDocumentTree, type DocumentTreeNode } from './traversal';
import { resolveReportSettings } from './report-settings';

export const labelPattern = /^[A-Za-z][A-Za-z0-9:._-]{0,127}$/;
export const semanticTypes = new Set([
  'heading',
  'figure',
  'table',
  'blockMath',
]);

export type SemanticNode = Extract<
  DocumentNode,
  { type: 'heading' | 'figure' | 'table' | 'blockMath' }
>;

export function isSemanticNode(node: DocumentTreeNode): node is SemanticNode {
  return semanticTypes.has(node.type);
}

export interface SemanticTarget {
  type: 'heading' | 'figure' | 'table' | 'blockMath';
  nodeId: string;
  label?: string;
  number?: string;
  title: string;
  referenceText: string;
  level?: number;
  headingKind?: 'section' | 'chapter' | 'appendix';
}

export interface DocumentAnalysis {
  targets: Map<string, SemanticTarget>;
  labels: Map<string, SemanticTarget>;
  outline: SemanticTarget[];
  diagnostics: string[];
}

/** A, ..., Z, AA, ... without a fixed limit on appendix chapters. */
function appendixNumber(value: number): string {
  let letters = '';
  for (
    let remaining = value;
    remaining > 0;
    remaining = Math.floor((remaining - 1) / 26)
  )
    letters = String.fromCharCode(65 + ((remaining - 1) % 26)) + letters;
  return letters;
}

/** Numbers are derived, never persisted. Duplicate labels are deliberately unresolved. */
export function analyzeDocument(document: DocumentData): DocumentAnalysis {
  const result: DocumentAnalysis = {
    targets: new Map(),
    labels: new Map(),
    outline: [],
    diagnostics: [],
  };
  const duplicates = new Set<string>();
  const references = new Set<string>();
  const sections = [0, 0, 0, 0, 0, 0];
  const counters = { figure: 0, table: 0, blockMath: 0 };
  const settings = resolveReportSettings(document.metadata);
  const chapterHeadings =
    document.type === 'report' && settings.heading_numbering === 'chapter';
  const chapterCaptions =
    document.type === 'report' && settings.caption_numbering === 'chapter';
  const chapterSections = [0, 0, 0, 0, 0];
  let chapter = 0;
  let appendix = 0;
  let appendixMode = false;
  let currentChapter = '0';
  for (const node of walkDocumentTree(document.children)) {
    if (node.type === 'reference') references.add(node.attrs.target);
    if (isSemanticNode(node)) {
      const { label, caption, numbered, nodeId } = node.attrs;
      let number: string | undefined;
      let title = caption || label || '';
      let prefix = '';
      let level: number | undefined;
      let headingKind: SemanticTarget['headingKind'];
      if (node.type === 'heading') {
        level = node.attrs.level;
        title = inlineText(node.content);
        if (chapterHeadings && level === 1 && node.attrs.appendix === true)
          appendixMode = true;
        // Chapter boundaries are structural: turning off displayed section
        // numbers does not merge caption counters across otherwise eligible H1s.
        // Explicit numbered=false headings do not consume a chapter or reset it.
        if (
          (chapterHeadings || chapterCaptions) &&
          level === 1 &&
          numbered !== false
        ) {
          currentChapter =
            chapterHeadings && appendixMode
              ? appendixNumber(++appendix)
              : String(++chapter);
          chapterSections.fill(0);
          if (chapterCaptions) {
            counters.figure = 0;
            counters.table = 0;
            counters.blockMath = 0;
          }
        }
        headingKind =
          chapterHeadings && level === 1
            ? appendixMode
              ? 'appendix'
              : 'chapter'
            : 'section';
        if (
          numbered === true ||
          (numbered !== false && document.metadata.number_sections === true)
        ) {
          if (chapterHeadings) {
            if (level === 1) number = currentChapter;
            else {
              for (let index = 0; index < level - 2; index++) {
                if (chapterSections[index] === 0) chapterSections[index] = 1;
              }
              chapterSections[level - 2]++;
              chapterSections.fill(0, level - 1);
              number = `${currentChapter}.${chapterSections.slice(0, level - 1).join('.')}`;
            }
          } else {
            // Preserve legacy section numbering, including skipped ancestors.
            for (let index = 0; index < level - 1; index++) {
              if (sections[index] === 0) sections[index] = 1;
            }
            sections[level - 1]++;
            sections.fill(0, level);
            number = sections.slice(0, level).join('.');
          }
        }
        prefix =
          headingKind === 'chapter'
            ? '章'
            : headingKind === 'appendix'
              ? '付録'
              : '節';
      } else if (
        node.type === 'figure' ||
        node.type === 'table' ||
        node.type === 'blockMath'
      ) {
        prefix = { figure: '図', table: '表', blockMath: '式' }[node.type];
        // Legacy documents keep their appearance; a caption/label opts into numbering.
        if (
          numbered === true ||
          (numbered !== false && Boolean(label || caption))
        ) {
          const sequence = ++counters[node.type];
          number = chapterCaptions
            ? `${currentChapter}.${sequence}`
            : String(sequence);
        }
      }
      const target: SemanticTarget = {
        type: node.type,
        nodeId,
        label: label || undefined,
        number,
        title,
        level,
        ...(headingKind ? { headingKind } : {}),
        referenceText: number
          ? headingKind === 'chapter'
            ? `第${number}章`
            : `${prefix} ${number}`
          : title || `${prefix}（番号なし）`,
      };
      result.targets.set(nodeId, target);
      if (level) result.outline.push(target);
      if (label) {
        if (result.labels.has(label) || duplicates.has(label)) {
          duplicates.add(label);
          result.labels.delete(label);
        } else result.labels.set(label, target);
      }
    }
  }
  for (const label of duplicates)
    result.diagnostics.push(`ラベル「${label}」が重複しています。`);
  for (const label of references) {
    if (!result.labels.has(label))
      result.diagnostics.push(
        `参照「${label}」の対象が見つからないか、ラベルが重複しています。`,
      );
  }
  return result;
}

/** The report TOC can hide headings without changing their numbers or links. */
export function reportOutline(
  document: DocumentData,
  analysis: DocumentAnalysis = analyzeDocument(document),
): SemanticTarget[] {
  if (document.type !== 'report') return analysis.outline;
  const depth = resolveReportSettings(document.metadata).toc_depth;
  const excluded = new Set(
    [...walkDocumentTree(document.children)].flatMap((node) =>
      node.type === 'heading' && node.attrs.toc === false
        ? [node.attrs.nodeId]
        : [],
    ),
  );
  return analysis.outline.filter(
    (entry) => (entry.level ?? 1) <= depth && !excluded.has(entry.nodeId),
  );
}

/** Explicit breaks retain empty pages, including leading/trailing/consecutive breaks. */
export function splitDocumentPages(document: DocumentData): DocumentNode[][] {
  const pages: DocumentNode[][] = [[]];
  for (const node of document.children) {
    if (node.type === 'pageBreak' || node.type === 'slideBreak') pages.push([]);
    else pages[pages.length - 1].push(node);
  }
  return pages;
}

/** Footnotes in reading order. Speaker notes are not audience output, so theirs are skipped. */
export function collectFootnotes(
  nodes: readonly DocumentTreeNode[],
  footnotes: FootnoteNode[] = [],
): FootnoteNode[] {
  for (const node of nodes) {
    if (node.type === 'footnote') footnotes.push(node);
    else if (node.type !== 'speakerNotes' && 'content' in node && node.content)
      collectFootnotes(node.content, footnotes);
  }
  return footnotes;
}
