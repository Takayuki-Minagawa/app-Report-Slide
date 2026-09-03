import { Editor } from '@tiptap/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppPreferencesProvider } from '@/components/app-preferences';

import { createEditorExtensions } from '@/src/editor/extensions';

import { TableToolbar } from './table-toolbar';

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function createEditor(withTable: boolean): Editor {
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { nodeId: 'initial' } }],
    },
  });
  if (withTable)
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true });
  return editor;
}

function tableJson(current: Editor) {
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
  return table;
}

function renderToolbar(current: Editor) {
  return render(
    <AppPreferencesProvider>
      <TableToolbar editor={current} />
    </AppPreferencesProvider>,
  );
}

describe('TableToolbar', () => {
  it('appears only while the editor selection is inside a table', async () => {
    renderToolbar(createEditor(false));
    expect(screen.queryByRole('toolbar', { name: '表の編集' })).toBeNull();
  });

  it('adds rows and applies the selected border settings', async () => {
    const current = createEditor(true);
    renderToolbar(current);

    await screen.findByRole('toolbar', { name: '表の編集' });
    fireEvent.click(screen.getByRole('button', { name: '下に行を追加' }));
    expect(tableJson(current).content).toHaveLength(3);

    fireEvent.change(screen.getByLabelText('罫線の色'), {
      target: { value: '#0f766e' },
    });
    fireEvent.change(screen.getByLabelText('罫線の種類'), {
      target: { value: 'double' },
    });
    fireEvent.change(screen.getByLabelText('罫線の太さ'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'すべての罫線' }));

    await waitFor(() =>
      expect(
        tableJson(current).content[0].content[0].attrs.borders,
      ).toMatchObject({
        top: { color: '#0f766e', style: 'double', width: 2 },
        right: { color: '#0f766e', style: 'double', width: 2 },
        bottom: { color: '#0f766e', style: 'double', width: 2 },
        left: { color: '#0f766e', style: 'double', width: 2 },
      }),
    );
  });
});
