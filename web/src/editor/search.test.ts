import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { createEditorExtensions } from './extensions';
import { findTextMatches, replaceTextMatches } from './search';

describe('document search and replace', () => {
  it('finds Japanese prose across marks, skips code, and replaces all in one undo step', () => {
    const editor = new Editor({
      extensions: createEditorExtensions({ onMathSelect: () => {} }),
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { nodeId: 'p1' },
            content: [
              { type: 'text', text: '構造', marks: [{ type: 'bold' }] },
              { type: 'text', text: '解析と構造解析' },
            ],
          },
          {
            type: 'codeBlock',
            attrs: { nodeId: 'code', language: null },
            content: [{ type: 'text', text: '構造解析' }],
          },
        ],
      },
    });
    try {
      const matches = findTextMatches(editor, '構造解析');
      expect(matches).toHaveLength(2);
      replaceTextMatches(editor, matches, '材料解析');
      expect(editor.state.doc.textContent).toContain('材料解析と材料解析');
      expect(editor.state.doc.textContent).toContain('構造解析');
      editor.commands.undo();
      expect(editor.state.doc.textContent).toContain('構造解析と構造解析');
    } finally {
      editor.destroy();
    }
  });
});
