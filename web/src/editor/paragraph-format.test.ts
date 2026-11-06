import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { parseMarkdown } from '@/src/markdown/parser';
import { defaultPageSettings } from '@/src/document/page-settings';
import type { DocumentData, DocumentNode } from '@/src/document/model';
import { createEditorExtensions } from './extensions';
import { applyTextRuler } from './text-ruler-commands';
import {
  applyParagraphIndent,
  editorAfterHeadingIds,
  setParagraphFormatContext,
} from './paragraph-format';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});
function setup(source = '# 見出し\n\n最初の段落\n\n次の段落'): {
  editor: Editor;
  document: DocumentData;
} {
  const document = parseMarkdown(source).document;
  document.metadata.page_settings = {
    ...defaultPageSettings,
    first_line_indent: 1,
    after_heading_indent: 'none',
  };
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: { type: 'doc', content: document.children },
  });
  setParagraphFormatContext(editor, document);
  return { editor, document };
}
function selectParagraph(current: Editor, index: number, last = index) {
  const positions: number[] = [];
  current.state.doc.forEach((node, position) => {
    if (node.type.name === 'paragraph') positions.push(position + 1);
  });
  current.view.dispatch(
    current.state.tr.setSelection(
      TextSelection.create(
        current.state.doc,
        positions[index],
        positions[last] + (last !== index ? 1 : 0),
      ),
    ),
  );
}
function paragraphs(current: Editor) {
  return (current.getJSON().content ?? []).filter(
    (node) => node.type === 'paragraph',
  );
}

describe('paragraph editing', () => {
  it('renders heading rules and explicit em values while preserving ruler margins', () => {
    const { editor: current } = setup();
    let elements = current.view.dom.querySelectorAll('p');
    expect(elements[0].style.textIndent).toBe('0em');
    expect(elements[1].style.textIndent).toBe('1em');
    selectParagraph(current, 0);
    applyTextRuler(current, { left: 10, right: 5, firstLine: 20 });
    expect(applyParagraphIndent(current, { mode: 'em', value: 1 })).toBe(true);
    elements = current.view.dom.querySelectorAll('p');
    expect(elements[0].style.textIndent).toBe('1em');
    expect(elements[0].style.marginLeft).toBe('10%');
    expect(applyParagraphIndent(current, { mode: 'inherit' })).toBe(true);
    expect(current.view.dom.querySelector('p')?.style.textIndent).toBe('0em');
  });

  it('formats mixed selections in one undo step and restores their distinct values', () => {
    const { editor: current } = setup('A\n\nB');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    selectParagraph(current, 0, 1);
    const before = paragraphs(current).map(
      (node) => node.attrs?.firstLineIndent,
    );
    const selection = current.state.selection;
    expect(applyParagraphIndent(current, { mode: 'em', value: 1 })).toBe(true);
    expect(
      paragraphs(current).map((node) => node.attrs?.firstLineIndent),
    ).toEqual([
      { mode: 'em', value: 1 },
      { mode: 'em', value: 1 },
    ]);
    expect(current.state.selection.from).toBe(selection.from);
    expect(current.commands.undo()).toBe(true);
    expect(
      paragraphs(current).map((node) => node.attrs?.firstLineIndent),
    ).toEqual(before);
  });

  it('preserves an em override on side-margin changes, clears it on first-line movement, and resets it', () => {
    const { editor: current } = setup('Body');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 1 });
    applyTextRuler(
      current,
      { left: 10, right: 5, firstLine: 15 },
      undefined,
      true,
    );
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 1,
    });
    applyTextRuler(current, { left: 10, right: 5, firstLine: 15 });
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toBeNull();
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    applyTextRuler(current, null);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toBeNull();
    expect(paragraphs(current)[0].attrs?.textRuler).toBeNull();
  });

  it('keeps document em inheritance when a report paragraph first receives side margins', () => {
    const { editor: current, document } = setup('Body');
    selectParagraph(current, 0);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toBeNull();
    expect(paragraphs(current)[0].attrs?.textRuler).toBeNull();
    applyTextRuler(
      current,
      { left: 10, right: 5, firstLine: 12 },
      undefined,
      true,
      'report',
    );
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'inherit',
    });
    expect(current.view.dom.querySelector('p')?.style.textIndent).toBe('1em');
    document.metadata.page_settings = {
      ...defaultPageSettings,
      first_line_indent: 2,
      font_size: 12,
      margin_left: 30,
    };
    setParagraphFormatContext(current, document);
    expect(current.view.dom.querySelector('p')?.style.textIndent).toBe('2em');
    expect(current.view.dom.querySelector('p')?.style.marginLeft).toBe('10%');
  });

  it('preserves an existing percentage ruler and does not add report inheritance to slides', () => {
    const { editor: current } = setup('Body');
    selectParagraph(current, 0);
    applyTextRuler(current, { left: 10, right: 5, firstLine: 12 });
    applyTextRuler(
      current,
      { left: 15, right: 5, firstLine: 17 },
      undefined,
      true,
      'report',
    );
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toBeNull();
    expect(paragraphs(current)[0].attrs?.textRuler).toEqual({
      left: 15,
      right: 5,
      firstLine: 17,
    });
    applyTextRuler(current, null);
    applyTextRuler(
      current,
      { left: 10, right: 5, firstLine: 12 },
      undefined,
      true,
      'slide',
    );
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toBeNull();
  });

  it('creates a following paragraph that inherits rather than propagating the exception', () => {
    const { editor: current } = setup('First paragraph');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    current.commands.setTextSelection(6);
    current.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(paragraphs(current)).toHaveLength(2);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
    expect(paragraphs(current)[1].attrs?.firstLineIndent).toEqual({
      mode: 'inherit',
    });
    expect(current.commands.undo()).toBe(true);
    expect(paragraphs(current)).toHaveLength(1);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
  });

  it('keeps soft breaks within the same paragraph and retains clipboard HTML attributes', () => {
    const { editor: current } = setup('First paragraph');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    current.commands.setTextSelection(6);
    current.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
      }),
    );
    expect(paragraphs(current)).toHaveLength(1);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
    expect(current.getHTML()).toContain('data-kumi-first-line-indent');
    const html = current.getHTML();
    current.commands.setContent(html);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
  });

  it('preserves the receiving paragraph but uses document indent for new plain-text paragraphs', () => {
    const { editor: current } = setup('Before');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    current.commands.setTextSelection(7);
    expect(
      current.view.pasteText(
        ' one\ntwo\nthree',
        new Event('paste') as ClipboardEvent,
      ),
    ).toBe(true);
    expect(paragraphs(current)).toHaveLength(3);
    const elements = current.view.dom.querySelectorAll('p');
    expect(elements[0].style.textIndent).toBe('0em');
    expect(elements[1].style.textIndent).toBe('1em');
    expect(elements[2].style.textIndent).toBe('1em');
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
  });

  it('retains structured clipboard paragraph settings', () => {
    const { editor: current } = setup('First\n\nSecond');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    selectParagraph(current, 1);
    applyParagraphIndent(current, { mode: 'em', value: 2 });
    current.commands.selectAll();
    const copied = current.view.serializeForClipboard(
      current.state.selection.content(),
    );
    const clipboardHtml = copied.dom.innerHTML;
    expect(
      current.view.pasteHTML(
        clipboardHtml,
        new Event('paste') as ClipboardEvent,
      ),
    ).toBe(true);
    expect(
      paragraphs(current).map((node) => node.attrs?.firstLineIndent),
    ).toEqual([
      { mode: 'em', value: 0 },
      { mode: 'em', value: 2 },
    ]);
  });

  it('keeps the first paragraph setting when joining and restores both paragraphs on Undo', () => {
    const { editor: current } = setup('First\n\nSecond');
    selectParagraph(current, 0);
    applyParagraphIndent(current, { mode: 'em', value: 0 });
    selectParagraph(current, 1);
    applyParagraphIndent(current, { mode: 'em', value: 2 });
    current.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }),
    );
    expect(paragraphs(current)).toHaveLength(1);
    expect(paragraphs(current)[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
    expect(current.getText()).toBe('FirstSecond');
    expect(current.commands.undo()).toBe(true);
    expect(
      paragraphs(current).map((node) => node.attrs?.firstLineIndent),
    ).toEqual([
      { mode: 'em', value: 0 },
      { mode: 'em', value: 2 },
    ]);
  });

  it('excludes nested paragraphs from the command and document indentation', () => {
    const { editor: current } = setup('> Quote');
    current.commands.setTextSelection(2);
    expect(applyParagraphIndent(current, { mode: 'em', value: 1 })).toBe(false);
    expect(
      current.view.dom
        .querySelector('blockquote p')
        ?.getAttribute('data-kumi-indent-source'),
    ).toBeNull();
  });

  it('uses the preceding chapter heading, but recomputes when an active chapter inserts a figure', () => {
    const { document } = setup('# Heading\n\nBody');
    const heading = {
      ...document.children[0],
      attrs: { ...document.children[0].attrs, nodeId: 'one:h' },
    } as DocumentNode;
    const paragraph = {
      ...document.children[1],
      attrs: { ...document.children[1].attrs, nodeId: 'p' },
    } as DocumentNode;
    const combined = {
      ...document,
      children: [
        heading,
        {
          ...paragraph,
          attrs: { ...paragraph.attrs, nodeId: 'two:p' },
        } as DocumentNode,
      ],
    };
    expect(editorAfterHeadingIds([paragraph], combined, 'two:').has('p')).toBe(
      true,
    );
    const figure = {
      type: 'figure',
      attrs: {
        nodeId: 'f',
        src: 'x',
        alt: '',
        title: null,
        width: 100,
        align: 'left',
      },
    } as DocumentNode;
    expect(
      editorAfterHeadingIds([figure, paragraph], combined, 'two:').has('p'),
    ).toBe(false);
  });
});
