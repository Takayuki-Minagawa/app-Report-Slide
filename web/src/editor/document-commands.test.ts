import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { toEditorDocument, type DocumentNode } from '@/src/document/model';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import { validateDocumentData } from '@/src/document/validation';
import { createEditorExtensions } from './extensions';
import { insertDocumentBreak, updateDocumentNode } from './document-commands';

let editor: Editor;
afterEach(() => editor?.destroy());
function setup(source: string) {
  const document = parseMarkdown(source).document;
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: toEditorDocument(document),
  });
  return document;
}

describe('document feature editing', () => {
  it('keeps attributes and references through the Tiptap schema and Markdown', () => {
    const document = setup(
      '# H\n{#sec:h numbered=false}\n\n[@fig:a]\n\n![a](a.svg)\n{#fig:a caption="caption" width=65% align=right}\n\n$$\nx\n$$\n{#eq:x numbered=true}\n\n| a |\n|---|\n| b |\n{#table:a caption="table"}\n\n::: slidebreak\n:::',
    );
    document.children = editor.getJSON().content as DocumentNode[];
    expect(() => validateDocumentData(document)).not.toThrow();
    const saved = parseMarkdown(serializeDocument(document)).document;
    expect(saved.children[2].attrs).toMatchObject({
      label: 'fig:a',
      caption: 'caption',
      width: 65,
      align: 'right',
    });
    expect(saved.children[3].attrs).toMatchObject({
      label: 'eq:x',
      numbered: true,
    });
    expect(saved.children[4].attrs).toMatchObject({
      label: 'table:a',
      caption: 'table',
    });
    expect(saved.children.some((node) => node.type === 'slideBreak')).toBe(
      true,
    );
  });

  it('updates by ID after shifting positions, rejects deleted IDs, and supports undo', () => {
    const document = setup('![a](a.svg)\n\n![b](b.svg)');
    const target = document.children[1].attrs.nodeId;
    editor.commands.insertContentAt(0, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'prefix' }],
    });
    expect(
      updateDocumentNode(editor, target, { width: 65, label: 'fig:b' }),
    ).toBe(true);
    expect(
      editor.getJSON().content?.find((node) => node.attrs?.nodeId === target)
        ?.attrs?.width,
    ).toBe(65);
    expect(editor.commands.undo()).toBe(true);
    expect(
      editor.getJSON().content?.find((node) => node.attrs?.nodeId === target)
        ?.attrs?.width,
    ).toBe(100);
    editor.commands.setContent('<p>replacement</p>');
    const before = editor.getJSON();
    expect(updateDocumentNode(editor, target, { width: 20 })).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it('inserts breaks at root and cannot wrap them inside a blockquote', () => {
    const document = setup('> inside quote');
    editor.commands.setTextSelection(3);
    expect(insertDocumentBreak(editor, 'pageBreak')).toBe(true);
    editor.commands.selectAll();
    editor.commands.toggleBlockquote();
    document.children = editor.getJSON().content as DocumentNode[];
    expect(() => validateDocumentData(document)).not.toThrow();
    expect(document.children.some((node) => node.type === 'pageBreak')).toBe(
      true,
    );
  });
});
