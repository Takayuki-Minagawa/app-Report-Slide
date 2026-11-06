import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { parseMarkdown } from '@/src/markdown/parser';
import { defaultPageSettings } from '@/src/document/page-settings';
import { createEditorExtensions } from '@/src/editor/extensions';
import { ParagraphFormatControls } from './paragraph-format-controls';

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});
beforeEach(() => window.localStorage.clear());
function setup(source = 'First\n\nSecond', disabled = false) {
  const document = parseMarkdown(source).document;
  document.metadata.page_settings = {
    ...defaultPageSettings,
    first_line_indent: 1,
  };
  editor = new Editor({
    extensions: createEditorExtensions({ onMathSelect: () => undefined }),
    content: { type: 'doc', content: document.children },
  });
  const current = editor;
  render(
    <AppPreferencesProvider>
      <ParagraphFormatControls
        editor={current}
        document={document}
        disabled={disabled}
      />
    </AppPreferencesProvider>,
  );
  return current;
}

describe('ParagraphFormatControls', () => {
  it('sets an explicit exception and returns to document settings without editing the text', () => {
    const current = setup();
    const before = current.getText();
    const group = screen.getByRole('group', { name: '段落の字下げ' });
    expect(
      within(group).getByText('現在：1字下げる（文書の設定）'),
    ).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '下げない' }));
    expect(current.getJSON().content?.[0].attrs?.firstLineIndent).toEqual({
      mode: 'em',
      value: 0,
    });
    expect(
      within(group).getByRole('button', { name: '下げない' }),
    ).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '文書に従う' }));
    expect(current.getJSON().content?.[0].attrs?.firstLineIndent).toEqual({
      mode: 'inherit',
    });
    expect(current.getText()).toBe(before);
  });

  it('shows mixed values and applies one choice to the selection', () => {
    const current = setup();
    fireEvent.click(screen.getByRole('button', { name: '下げない' }));
    act(() =>
      current.view.dispatch(
        current.state.tr.setSelection(
          TextSelection.create(current.state.doc, 1, 9),
        ),
      ),
    );
    expect(
      screen.getByText('2段落：設定が混在しています。'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1字下げる' }));
    expect(
      current.getJSON().content?.map((node) => node.attrs?.firstLineIndent),
    ).toEqual([
      { mode: 'em', value: 1 },
      { mode: 'em', value: 1 },
    ]);
    act(() => {
      current.commands.undo();
    });
    expect(
      screen.getByText('2段落：設定が混在しています。'),
    ).toBeInTheDocument();
  });

  it('shows different legacy ruler positions as mixed settings', () => {
    const current = setup(
      'First\n{text_ruler=0,0,1}\n\nSecond\n{text_ruler=10,5,11}',
    );
    act(() =>
      current.view.dispatch(
        current.state.tr.setSelection(
          TextSelection.create(current.state.doc, 1, 9),
        ),
      ),
    );
    expect(
      screen.getByText('2段落：設定が混在しています。'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('詳細設定あり（文字位置ルーラー）'),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '文書に従う' }));
    expect(
      screen.queryByText('2段落：設定が混在しています。'),
    ).not.toBeInTheDocument();
    expect(
      current.getJSON().content?.map((node) => node.attrs?.textRuler),
    ).toEqual([
      { left: 0, right: 0, firstLine: 1 },
      { left: 10, right: 5, firstLine: 11 },
    ]);
  });

  it('explains unavailable nested selections and locks pending Markdown', () => {
    const current = setup('> Quote');
    act(() => {
      current.commands.setTextSelection(2);
    });
    expect(screen.getByRole('button', { name: '下げない' })).toBeDisabled();
    expect(
      screen.getByText(/見出し・表・箇条書き内は対象外/),
    ).toBeInTheDocument();
  });

  it('disables all editing controls for pending Markdown', () => {
    setup('Body', true);
    expect(screen.getByRole('button', { name: '1字下げる' })).toBeDisabled();
    expect(
      screen.getByText(/Markdown原稿を適用または破棄/),
    ).toBeInTheDocument();
  });
});
