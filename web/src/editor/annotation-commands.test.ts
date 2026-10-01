import { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import {
  toEditorDocument,
  type DocumentData,
  type DocumentNode,
} from '@/src/document/model';
import { validateDocumentData } from '@/src/document/validation';
import { parseMarkdown } from '@/src/markdown/parser';
import { serializeDocument } from '@/src/markdown/serializer';
import {
  insertFootnote,
  insertSpeakerNotes,
  setCallout,
  updateFootnote,
} from './document-commands';
import { createEditorExtensions } from './extensions';

let editor: Editor;
afterEach(() => editor?.destroy());

function setup(source: string): DocumentData {
  const document = parseMarkdown(source).document;
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: toEditorDocument(document),
  });
  return document;
}

/** The edited document must stay valid and survive a Markdown save. */
function saved(document: DocumentData): string {
  const edited = validateDocumentData({
    ...document,
    children: editor.getJSON().content as DocumentNode[],
  });
  return serializeDocument(edited).split('---\n').slice(2).join('---\n');
}

function positionOfText(text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, position) => {
    if (found < 0 && node.isText && node.text?.includes(text))
      found = position + node.text.indexOf(text);
  });
  if (found < 0) throw new Error(`text not found: ${text}`);
  return found;
}

describe('annotation schema', () => {
  it('keeps footnotes, callouts and notes through the editor schema', () => {
    const source =
      '---\ntype: slide\n---\n\n本文^[注]\n\n> [!TIP]\n> ヒント\n\n::: notes\nノート\n:::\n';
    const document = setup(source);
    expect(saved(document)).toBe(
      '\n本文^[注]\n\n> [!TIP]\n> ヒント\n\n::: notes\nノート\n:::\n',
    );
    const html = editor.getHTML();
    expect(html).toContain('data-footnote="注"');
    expect(html).toContain('data-callout="tip"');
    expect(html).toContain('data-speaker-notes');
    editor.commands.setContent(html);
    expect(saved(document)).toContain('^[注]');
    expect(saved(document)).toContain('> [!TIP]');
    expect(saved(document)).toContain('::: notes\nノート\n:::');
  });

  it('sanitizes pasted footnotes and ignores unknown callout types', () => {
    const document = setup('本文');
    editor.commands.setContent(
      `<p>a<sup data-footnote=" "></sup>b<sup data-footnote=" two\nlines ${'x'.repeat(2100)}"></sup></p><blockquote data-callout="danger"><p>q</p></blockquote><p>z</p>`,
    );
    expect(saved(document)).toBe(
      `\nab^[two lines ${'x'.repeat(1990)}]\n\n> q\n\nz\n`,
    );
  });
});

describe('inline atoms under formatting', () => {
  it('does not keep marks on footnotes, references or math, so saving still works', () => {
    const document = setup(
      '前文^[注]と[@sec:a]と$x$の後文\n\n# 見出し\n{#sec:a}',
    );
    editor.commands.selectAll();
    editor.commands.toggleBold();
    editor.commands.setLink({ href: 'https://example.com' });
    const atoms: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.isInline && !node.isText)
        atoms.push(`${node.type.name}:${node.marks.length}`);
    });
    expect(atoms).toEqual(['footnote:0', 'reference:0', 'inlineMath:0']);
    expect(saved(document)).toContain('^[注]');
    editor.commands.toggleBold();
    expect(saved(document)).not.toContain('**');
  });
});

describe('footnote commands', () => {
  it('inserts a selected footnote after the cursor and updates it in place', () => {
    const document = setup('前後');
    editor.commands.setTextSelection(positionOfText('後'));
    expect(insertFootnote(editor, '  最初の\n注  ')).toBe(true);
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.attrs.text).toBe('最初の 注');
    expect(saved(document)).toBe('\n前^[最初の 注]後\n');

    // Unchanged text is not an edit and adds no undo step.
    const before = editor.state.doc;
    expect(updateFootnote(editor, selection.from, ' 最初の  注 ')).toBe(true);
    expect(editor.state.doc).toBe(before);
    expect(updateFootnote(editor, selection.from, '更新')).toBe(true);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(saved(document)).toBe('\n前^[更新]後\n');
    editor.commands.undo();
    expect(saved(document)).not.toContain('更新');
  });

  it('refuses blank text, stale positions and places without inline content', () => {
    const document = setup('本文\n\n~~~\ncode\n~~~\n\n![図](a.png)');
    expect(insertFootnote(editor, '   ')).toBe(false);
    expect(updateFootnote(editor, 1, '注')).toBe(false);
    expect(updateFootnote(editor, 9999, '注')).toBe(false);
    editor.commands.setTextSelection(positionOfText('code'));
    expect(insertFootnote(editor, '注')).toBe(false);
    let figure = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'figure') figure = position;
    });
    editor.commands.setNodeSelection(figure);
    expect(insertFootnote(editor, '注')).toBe(false);
    expect(saved(document)).not.toContain('^[');
  });
});

describe('callout command', () => {
  it('wraps a paragraph, changes the type, and returns to a plain quote', () => {
    const document = setup('本文\n\n末尾');
    editor.commands.setTextSelection(positionOfText('本文'));
    expect(setCallout(editor, null)).toBe(false);
    expect(setCallout(editor, 'warning')).toBe(true);
    expect(saved(document)).toBe('\n> [!WARNING]\n> 本文\n\n末尾\n');
    expect(setCallout(editor, 'note')).toBe(true);
    expect(saved(document)).toBe('\n> [!NOTE]\n> 本文\n\n末尾\n');
    expect(setCallout(editor, null)).toBe(true);
    expect(saved(document)).toBe('\n> 本文\n\n末尾\n');
  });
});

describe('speaker notes command', () => {
  const deck =
    '---\ntype: slide\n---\n\n# A\n\n本文A\n\n::: slidebreak\n:::\n\n# B\n\n本文B';

  it('adds one notes block at the end of the current slide', () => {
    const document = setup(deck);
    editor.commands.setTextSelection(positionOfText('本文A'));
    expect(insertSpeakerNotes(editor)).toBe(true);
    editor.commands.insertContent('Aのノート');
    expect(saved(document)).toBe(
      '\n# A\n\n本文A\n\n::: notes\nAのノート\n:::\n\n::: slidebreak\n:::\n\n# B\n\n本文B\n',
    );

    // A second request on the same slide moves into the existing block.
    editor.commands.setTextSelection(positionOfText('A'));
    expect(insertSpeakerNotes(editor)).toBe(true);
    editor.commands.insertContent('（追記）');
    expect(saved(document)).toContain('::: notes\nAのノート（追記）\n:::');
    expect(saved(document).match(/::: notes/g)).toHaveLength(1);
  });

  it('adds notes to the last slide at the end of the document', () => {
    const document = setup(deck);
    editor.commands.setTextSelection(positionOfText('本文B'));
    expect(insertSpeakerNotes(editor)).toBe(true);
    editor.commands.insertContent('Bのノート');
    expect(saved(document)).toBe(
      '\n# A\n\n本文A\n\n::: slidebreak\n:::\n\n# B\n\n本文B\n\n::: notes\nBのノート\n:::\n',
    );
  });

  it('ignores block-type shortcuts inside notes instead of lifting the text out', () => {
    const document = setup(
      '---\ntype: slide\n---\n\n# A\n\n::: notes\nノート\n:::',
    );
    editor.commands.setTextSelection(positionOfText('ノート'));
    for (const key of ['Mod-Alt-1', 'Mod-Shift-8', 'Mod-Shift-7', 'Mod-Alt-c'])
      expect(editor.commands.keyboardShortcut(key)).toBe(true);
    expect(saved(document)).toBe('\n# A\n\n::: notes\nノート\n:::\n');
    // Outside notes the same shortcut still changes the block.
    editor.commands.setTextSelection(positionOfText('A'));
    editor.commands.keyboardShortcut('Mod-Alt-2');
    expect(saved(document)).toContain('## A');
  });

  it('cannot nest notes inside quotes, lists or other notes', () => {
    setup('::: notes\nノート\n:::\n\n> 引用');
    const schema = editor.schema;
    const notes = schema.nodes.speakerNotes;
    expect(schema.nodes.blockquote.contentMatch.matchType(notes)).toBeNull();
    expect(schema.nodes.listItem.contentMatch.matchType(notes)).toBeNull();
    expect(notes.contentMatch.matchType(notes)).toBeNull();
    expect(notes.contentMatch.matchType(schema.nodes.heading)).toBeNull();
  });
});
