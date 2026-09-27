import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorExtensions } from './extensions';
import { applyTextRuler, selectedTextBlocks } from './text-ruler-commands';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(withTable = false): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { nodeId: 'first' },
          content: [{ type: 'text', text: 'First paragraph' }],
        },
        ...(withTable
          ? [
              {
                type: 'table',
                attrs: { nodeId: 'table' },
                content: [
                  {
                    type: 'tableRow',
                    attrs: { nodeId: 'row' },
                    content: [
                      {
                        type: 'tableCell',
                        attrs: { nodeId: 'cell', align: null },
                        content: [
                          {
                            type: 'paragraph',
                            attrs: { nodeId: 'inner' },
                            content: [{ type: 'text', text: 'Cell' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ]
          : []),
        {
          type: 'paragraph',
          attrs: { nodeId: 'second' },
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
        {
          type: 'heading',
          attrs: { nodeId: 'heading', level: 2 },
          content: [{ type: 'text', text: 'Heading' }],
        },
      ],
    },
  });
  return editor;
}

function positionOf(current: Editor, id: string): number {
  let found = -1;
  current.state.doc.descendants((node, position) => {
    if (node.attrs.nodeId === id) found = position;
  });
  if (found < 0) throw new Error(`Missing node ${id}`);
  return found;
}

function select(current: Editor, from: number, to = from): void {
  current.view.dispatch(
    current.state.tr.setSelection(
      TextSelection.create(current.state.doc, from, to),
    ),
  );
}

function rulerOf(current: Editor, id: string): unknown {
  return current.state.doc.nodeAt(positionOf(current, id))?.attrs.textRuler;
}

describe('text ruler commands', () => {
  it('uses the caret block and excludes a block at the range end boundary', () => {
    const current = createEditor();
    const first = positionOf(current, 'first');
    const second = positionOf(current, 'second');
    const heading = positionOf(current, 'heading');

    select(current, second + 2);
    expect(selectedTextBlocks(current).map((block) => block.nodeId)).toEqual([
      'second',
    ]);

    select(current, first + 2, second + 1);
    expect(selectedTextBlocks(current).map((block) => block.nodeId)).toEqual([
      'first',
    ]);

    select(current, first + 2, heading + 2);
    expect(selectedTextBlocks(current).map((block) => block.nodeId)).toEqual([
      'first',
      'second',
      'heading',
    ]);
  });

  it('applies to multiple blocks in one undoable transaction and preserves selection', () => {
    const current = createEditor();
    select(
      current,
      positionOf(current, 'first') + 2,
      positionOf(current, 'second') + 2,
    );
    const { from, to } = current.state.selection;
    const ruler = { left: 12, right: 18, firstLine: 20 };

    expect(applyTextRuler(current, ruler)).toBe(true);
    expect(rulerOf(current, 'first')).toEqual(ruler);
    expect(rulerOf(current, 'second')).toEqual(ruler);
    expect(rulerOf(current, 'heading')).toBeNull();
    expect(current.state.selection.from).toBe(from);
    expect(current.state.selection.to).toBe(to);
    expect(
      current.state.doc.nodeAt(positionOf(current, 'first'))?.attrs.nodeId,
    ).toBe('first');
    expect(applyTextRuler(current, ruler)).toBe(false);

    expect(current.commands.undo()).toBe(true);
    expect(rulerOf(current, 'first')).toBeNull();
    expect(rulerOf(current, 'second')).toBeNull();
    expect(current.commands.redo()).toBe(true);
    expect(rulerOf(current, 'first')).toEqual(ruler);
    expect(rulerOf(current, 'second')).toEqual(ruler);
  });

  it('uses a stable ID snapshot after selection moves and supports reset', () => {
    const current = createEditor();
    select(current, positionOf(current, 'first') + 2);
    const nodeIds = selectedTextBlocks(current).map((block) => block.nodeId);
    select(current, positionOf(current, 'heading') + 2);

    const ruler = { left: 10, right: 15, firstLine: 0 };
    expect(applyTextRuler(current, ruler, nodeIds)).toBe(true);
    expect(rulerOf(current, 'first')).toEqual(ruler);
    expect(rulerOf(current, 'heading')).toBeNull();
    expect(applyTextRuler(current, null, nodeIds)).toBe(true);
    expect(rulerOf(current, 'first')).toBeNull();
    expect(applyTextRuler(current, null, nodeIds)).toBe(false);
    expect(
      applyTextRuler(current, { left: 90, right: 20, firstLine: 100 }, nodeIds),
    ).toBe(false);
  });

  it('never targets paragraphs nested in a table', () => {
    const current = createEditor(true);
    select(current, positionOf(current, 'inner') + 2);

    expect(selectedTextBlocks(current)).toEqual([]);
    expect(applyTextRuler(current, { left: 5, right: 5, firstLine: 5 })).toBe(
      false,
    );
    expect(
      applyTextRuler(current, { left: 5, right: 5, firstLine: 5 }, ['inner']),
    ).toBe(false);
    expect(rulerOf(current, 'inner')).toBeNull();
  });
});
