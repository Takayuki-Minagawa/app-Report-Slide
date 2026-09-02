import { inlineText, type DocumentData, type DocumentNode } from './model';

export const labelPattern = /^[A-Za-z][A-Za-z0-9:._-]{0,127}$/;
export const semanticTypes = new Set([
  'heading',
  'figure',
  'table',
  'blockMath',
]);

export interface SemanticTarget {
  type: 'heading' | 'figure' | 'table' | 'blockMath';
  nodeId: string;
  label?: string;
  number?: string;
  title: string;
  referenceText: string;
  level?: number;
}

export interface DocumentAnalysis {
  targets: Map<string, SemanticTarget>;
  labels: Map<string, SemanticTarget>;
  outline: SemanticTarget[];
  diagnostics: string[];
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
  function visit(node: DocumentNode) {
    if (semanticTypes.has(node.type)) {
      const { label, caption, numbered, nodeId } = node.attrs;
      let number: string | undefined;
      let title = caption || label || '';
      let prefix = '';
      let level: number | undefined;
      if (node.type === 'heading') {
        level = node.attrs.level;
        title = inlineText(node.content);
        if (
          numbered === true ||
          (numbered !== false && document.metadata.number_sections === true)
        ) {
          // Fill skipped ancestors, so an initial H2 becomes 1.1, not 0.1.
          for (let index = 0; index < level - 1; index++) {
            if (sections[index] === 0) sections[index] = 1;
          }
          sections[level - 1]++;
          sections.fill(0, level);
          number = sections.slice(0, level).join('.');
        }
        prefix = '節';
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
          number = String(++counters[node.type]);
        }
      }
      const target: SemanticTarget = {
        type: node.type as SemanticTarget['type'],
        nodeId,
        label: label || undefined,
        number,
        title,
        level,
        referenceText: number
          ? `${prefix} ${number}`
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
    if ('content' in node) {
      for (const child of node.content ?? []) {
        if (child.type === 'reference') references.add(child.attrs.target);
        else if (
          'attrs' in child &&
          'nodeId' in child.attrs &&
          child.type !== 'inlineImage'
        )
          visit(child as DocumentNode);
      }
    }
  }
  document.children.forEach(visit);
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

/** Explicit breaks retain empty pages, including leading/trailing/consecutive breaks. */
export function splitDocumentPages(document: DocumentData): DocumentNode[][] {
  const pages: DocumentNode[][] = [[]];
  for (const node of document.children) {
    if (node.type === 'pageBreak' || node.type === 'slideBreak') pages.push([]);
    else pages[pages.length - 1].push(node);
  }
  return pages;
}
