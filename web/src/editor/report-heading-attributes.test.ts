import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createEditorExtensions } from './extensions';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData } from '@/src/document/validation';
import { analyzeDocument } from '@/src/document/semantics';

describe('report heading attributes', () => {
  it('retains TOC and appendix data through HTML, heading level changes, and Undo', () => {
    const document = parseMarkdown(
      '# Appendix\n{toc=false appendix=true}',
    ).document;
    document.metadata.number_sections = true;
    document.metadata.report_settings = { heading_numbering: 'chapter' };
    const editor = new Editor({
      extensions: createEditorExtensions({ onMathSelect: () => undefined }),
      content: { type: 'doc', content: document.children },
    });
    const snapshot = () =>
      validateDocumentData({ ...document, children: editor.getJSON().content });
    try {
      const html = editor.getHTML();
      expect(html).toContain('data-kumi-toc="false"');
      expect(html).toContain('data-kumi-appendix="true"');
      editor.commands.setContent(html);
      expect(snapshot().children[0].attrs).toMatchObject({
        appendix: true,
        toc: false,
      });
      editor.commands.setTextSelection(1);
      editor.commands.setHeading({ level: 2 });
      const h2 = snapshot();
      expect(analyzeDocument(h2).outline[0].number).toBe('0.1');
      expect(serializeDocument(h2)).toContain('appendix=true');
      expect(editor.commands.undo()).toBe(true);
      expect(analyzeDocument(snapshot()).outline[0].number).toBe('A');
    } finally {
      editor.destroy();
    }
  });
});
