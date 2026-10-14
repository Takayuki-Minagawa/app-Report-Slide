import { inlineText, type DocumentData } from './model';
import { splitDocumentPages } from './semantics';
import { walkDocumentTree } from './traversal';
import type { AppLocale } from '@/src/i18n/messages';

const names: Record<AppLocale, Record<string, string>> = {
  ja: {
    heading: '見出し',
    paragraph: '本文',
    figure: '図',
    inlineImage: '行内の図',
    table: '表',
    chart: 'グラフ',
    blockMath: '数式',
    codeBlock: 'コード',
    bulletList: '箇条書き',
    orderedList: '番号付きリスト',
    blockquote: '補足',
    speakerNotes: '発表者ノート',
    horizontalRule: '区切り線',
  },
  en: {
    heading: 'Heading',
    paragraph: 'Body',
    figure: 'Figure',
    inlineImage: 'Inline image',
    table: 'Table',
    chart: 'Chart',
    blockMath: 'Equation',
    codeBlock: 'Code',
    bulletList: 'List',
    orderedList: 'Numbered list',
    blockquote: 'Callout',
    speakerNotes: 'Speaker notes',
    horizontalRule: 'Rule',
  },
};

export interface SlideNavigationElement {
  nodeId: string;
  name: string;
  text: string;
}

export interface SlideNavigationPage {
  index: number;
  title: string;
  anchorNodeId?: string;
  elements: SlideNavigationElement[];
}

/** Includes body paragraphs and nested figures, not just semantic outline targets. */
export function slideNavigationPages(
  document: DocumentData,
  locale: AppLocale,
): SlideNavigationPage[] {
  const breaks = document.children.filter(
    (node) => node.type === 'slideBreak' || node.type === 'pageBreak',
  );
  return splitDocumentPages(document).map((nodes, index) => {
    const heading = nodes.find((node) => node.type === 'heading');
    const title =
      (heading?.type === 'heading' ? inlineText(heading.content) : '') ||
      (locale === 'ja' ? `ページ ${index + 1}` : `Page ${index + 1}`);
    const counters = new Map<string, number>();
    const elements: SlideNavigationElement[] = [];
    for (const node of walkDocumentTree(nodes)) {
      if (
        !names[locale][node.type] ||
        !('attrs' in node) ||
        !('nodeId' in node.attrs) ||
        typeof node.attrs.nodeId !== 'string'
      )
        continue;
      const number = (counters.get(node.type) ?? 0) + 1;
      counters.set(node.type, number);
      const text =
        node.type === 'heading' || node.type === 'paragraph'
          ? inlineText(node.content)
          : node.type === 'figure' || node.type === 'inlineImage'
            ? node.attrs.alt || node.attrs.src
            : node.type === 'blockMath'
              ? node.attrs.latex
              : 'caption' in node.attrs &&
                  typeof node.attrs.caption === 'string'
                ? node.attrs.caption
                : '';
      elements.push({
        nodeId: node.attrs.nodeId,
        name: `${names[locale][node.type]} ${number}`,
        text,
      });
    }
    return {
      index,
      title,
      anchorNodeId:
        nodes[0]?.attrs.nodeId ??
        breaks[index - 1]?.attrs.nodeId ??
        breaks[index]?.attrs.nodeId,
      elements,
    };
  });
}
