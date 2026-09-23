import type { Editor } from '@tiptap/react';

export interface SearchMatch {
  from: number;
  to: number;
}

/** Search editable prose only. Text in code blocks and code marks is excluded. */
export function findTextMatches(editor: Editor, query: string): SearchMatch[] {
  if (!query) return [];
  const matches: SearchMatch[] = [];
  editor.state.doc.descendants((node, position) => {
    if (!node.isTextblock || node.type.name === 'codeBlock') return true;
    let text = '';
    const positions: number[] = [];
    node.forEach((child, offset) => {
      if (
        child.isText &&
        !child.marks.some((mark) => mark.type.name === 'code')
      ) {
        for (let index = 0; index < child.text!.length; index++) {
          text += child.text![index];
          positions.push(position + 1 + offset + index);
        }
      } else {
        text += '\0';
        positions.push(position + 1 + offset);
      }
    });
    const haystack = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let start = 0;
    while ((start = haystack.indexOf(needle, start)) !== -1) {
      const from = positions[start];
      const to = positions[start + query.length - 1] + 1;
      if (from !== undefined && to !== undefined && to - from === query.length)
        matches.push({ from, to });
      start += Math.max(1, needle.length);
    }
    return false;
  });
  return matches;
}

export function replaceTextMatches(
  editor: Editor,
  matches: readonly SearchMatch[],
  replacement: string,
): void {
  let transaction = editor.state.tr;
  for (const match of [...matches].reverse())
    transaction = transaction.insertText(replacement, match.from, match.to);
  if (matches.length) editor.view.dispatch(transaction);
}
