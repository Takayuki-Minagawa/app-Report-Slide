import type { DocumentTreeNode } from './traversal';

export interface DocumentStatistics {
  /** Unicode characters without whitespace. */
  characters: number;
  words: number;
}

/** Audience text in reading order, one entry per text block. */
function collectText(nodes: readonly DocumentTreeNode[], blocks: string[]) {
  let inline = '';
  for (const node of nodes) {
    if (node.type === 'text') inline += node.text;
    else if (node.type === 'footnote') blocks.push(node.attrs.text);
    else if (node.type === 'hardBreak') inline += ' ';
    else if (node.type !== 'speakerNotes' && 'content' in node && node.content)
      collectText(node.content, blocks);
  }
  if (inline) blocks.push(inline);
}

function countWords(text: string): number {
  if (typeof Intl.Segmenter !== 'function')
    return text.split(/\s+/).filter(Boolean).length;
  let words = 0;
  for (const segment of new Intl.Segmenter(undefined, {
    granularity: 'word',
  }).segment(text)) {
    if (segment.isWordLike) words += 1;
  }
  return words;
}

/** Body text only: math, captions, chart data and speaker notes are not counted. */
export function documentStatistics(
  nodes: readonly DocumentTreeNode[],
): DocumentStatistics {
  const blocks: string[] = [];
  collectText(nodes, blocks);
  return blocks.reduce<DocumentStatistics>(
    (total, text) => ({
      characters: total.characters + Array.from(text.replace(/\s/g, '')).length,
      words: total.words + countWords(text),
    }),
    { characters: 0, words: 0 },
  );
}
