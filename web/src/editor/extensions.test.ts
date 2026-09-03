import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from './extensions';

const identifiedTypes = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'inlineImage',
  'figure',
  'blockMath',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'initial' },
          content: [{ type: 'text', text: '本文' }],
        },
      ],
    },
  });
  return editor;
}

function documentIds(current: Editor): string[] {
  const ids: string[] = [];
  current.state.doc.descendants((node) => {
    if (!identifiedTypes.has(node.type.name)) return;
    if (typeof node.attrs.nodeId === 'string') ids.push(node.attrs.nodeId);
  });
  return ids;
}

describe('DocumentAttributes extension', () => {
  it('空白・重複nodeIdを編集transaction後に一意な値へ修復する', () => {
    const current = createEditor();
    current.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { nodeId: ' ' } },
        { type: 'paragraph', attrs: { nodeId: 'duplicate' } },
        { type: 'paragraph', attrs: { nodeId: 'duplicate' } },
      ],
    });

    const ids = documentIds(current);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('表を挿入したとき全構造nodeへ一意なnodeIdを与える', () => {
    const current = createEditor();
    expect(
      current
        .chain()
        .focus()
        .insertTable({ rows: 2, cols: 2, withHeaderRow: true })
        .run(),
    ).toBe(true);

    const ids = documentIds(current);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids.every((id) => id.trim().length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('表セルの個別罫線をDOMとDocument JSONに保持する', () => {
    const current = createEditor();
    current.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
    current.commands.setCellAttribute('align', 'center');
    current.commands.setCellAttribute('borders', {
      top: { color: '#0f766e', style: 'double', width: 2 },
      left: null,
    });

    const table = current
      .getJSON()
      .content?.find((node) => node.type === 'table') as unknown as
      | {
          content: Array<{
            content: Array<{ attrs: Record<string, unknown> }>;
          }>;
        }
      | undefined;
    if (!table) throw new Error('table expected');
    const cell = table.content[0]?.content?.[0];
    expect(cell?.attrs).toMatchObject({
      align: 'center',
      borders: {
        top: { color: '#0f766e', style: 'double', width: 2 },
        left: null,
      },
    });
    expect(current.getHTML()).toContain('data-kumi-borders');
    expect(current.getHTML()).toContain(
      'border-top: 2px double rgb(15, 118, 110)',
    );
    expect(current.getHTML()).toContain('text-align: center');
  });

  it('貼り付け画像のaltを空文字へ正規化し危険なsrcを取り込まない', () => {
    const current = createEditor();
    current.commands.setContent(
      '<p data-node-id="safe">before <img data-inline-image src="assets/image.png"> after</p>',
    );
    const safeJson = current.getJSON();
    const safeImage = safeJson.content?.[0]?.content?.find(
      (node) => node.type === 'inlineImage',
    ) as { attrs?: Record<string, unknown> } | undefined;
    expect(safeImage?.attrs).toMatchObject({
      src: 'assets/image.png',
      alt: '',
    });

    current.commands.setContent(
      '<p data-node-id="unsafe"><img data-inline-image src="javascript:alert(1)"></p>',
    );
    expect(JSON.stringify(current.getJSON())).not.toContain('javascript:');
    expect(JSON.stringify(current.getJSON())).not.toContain('inlineImage');
  });
});
