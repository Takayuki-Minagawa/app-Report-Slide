import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { EditorWorkspace } from './editor-workspace';

function renderWorkspace() {
  return render(
    <AppPreferencesProvider>
      <EditorWorkspace />
    </AppPreferencesProvider>,
  );
}

async function applySource(source: string) {
  await screen.findByText('REPORT');
  fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
  fireEvent.change(
    await screen.findByRole('textbox', { name: 'Markdown原稿' }),
    { target: { value: source } },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('textbox', { name: 'Markdown原稿' }),
    ).not.toBeInTheDocument(),
  );
}

async function markdown(): Promise<string> {
  fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
  const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
  return (source as HTMLTextAreaElement).value;
}

describe('annotation workspace', () => {
  it('inserts a footnote, edits its text in Properties and previews it', async () => {
    renderWorkspace();
    await applySource('本文');
    fireEvent.click(screen.getByRole('button', { name: '脚注を挿入' }));
    const text = await screen.findByRole('textbox', { name: '脚注の本文' });
    expect(text).toHaveValue('脚注の本文');
    const update = screen.getByRole('button', { name: '脚注を更新' });
    fireEvent.change(text, { target: { value: '   ' } });
    expect(update).toBeDisabled();
    fireEvent.change(text, { target: { value: '出典: 設計\n基準' } });
    fireEvent.click(update);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: '脚注の本文' })).toHaveValue(
        '出典: 設計 基準',
      ),
    );

    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    const preview = screen.getByLabelText('レポートプレビュー');
    expect(preview.querySelector('.footnote-ref')).toHaveTextContent('1');
    expect(screen.getByRole('list', { name: '脚注' })).toHaveTextContent(
      '出典: 設計 基準',
    );
    expect(await markdown()).toContain('^[出典\\: 設計 基準]');
    expect(
      screen.queryByRole('textbox', { name: '脚注の本文' }),
    ).toBeDisabled();
  });

  it('turns a paragraph into a callout and shows its localized title', async () => {
    renderWorkspace();
    await applySource('確認事項\n\n末尾');
    const select = screen.getByRole('combobox', { name: '注記の種類' });
    expect(select).toHaveValue('');
    fireEvent.change(select, { target: { value: 'warning' } });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: '注記の種類' })).toHaveValue(
        'warning',
      ),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    const callout = screen
      .getByLabelText('レポートプレビュー')
      .querySelector('blockquote[data-callout="warning"]');
    expect(callout).toHaveTextContent('警告');
    expect(await markdown()).toContain('> [!WARNING]\n> 確認事項');
  });

  it('offers speaker notes only for slides and hides them in the preview', async () => {
    renderWorkspace();
    await applySource('本文');
    expect(
      screen.queryByRole('button', { name: '発表者ノートを追加' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Markdown原稿' }),
      {
        target: {
          value:
            '---\ntype: slide\n---\n\n# 表題\n\n::: notes\n非公開メモ\n:::\n',
        },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
    expect(
      await screen.findByRole('button', { name: '発表者ノートを追加' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('文書本文')).toHaveTextContent('非公開メモ');
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    expect(screen.getByLabelText('スライドプレビュー')).not.toHaveTextContent(
      '非公開メモ',
    );
    expect(await markdown()).toContain('::: notes\n非公開メモ\n:::');
  });

  it('disables block controls while the cursor is inside speaker notes', async () => {
    renderWorkspace();
    await screen.findByText('REPORT');
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Markdown原稿' }),
      { target: { value: '---\ntype: slide\n---\n\n# 表題\n' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
    fireEvent.click(
      await screen.findByRole('button', { name: '発表者ノートを追加' }),
    );
    const blockControls = [
      '見出し1',
      '見出し2',
      '箇条書き',
      '番号付きリスト',
      '引用',
      'ブロック数式',
      '表を挿入',
      'グラフを挿入',
    ];
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '見出し1' })).toBeDisabled(),
    );
    for (const name of blockControls)
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: '注記の種類' })).toBeDisabled();
    for (const name of ['太字', 'インライン数式', '脚注を挿入'])
      expect(screen.getByRole('button', { name })).toBeEnabled();
  });

  it('opens search with Cmd+F on macOS', async () => {
    vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel');
    renderWorkspace();
    await applySource('本文');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(
      await screen.findByRole('textbox', { name: '検索語' }),
    ).toBeInTheDocument();
  });

  it('counts characters and opens search with the keyboard in the visual editor', async () => {
    renderWorkspace();
    await applySource('# 見出し\n\n本文です');
    await waitFor(() =>
      expect(document.querySelector('.document-statistics')).toHaveTextContent(
        '7 文字',
      ),
    );
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const query = await screen.findByRole('textbox', { name: '検索語' });
    await waitFor(() => expect(query).toHaveFocus());
    // Escape that cancels an IME conversion keeps the bar open.
    fireEvent.keyDown(query, { key: 'Escape', isComposing: true });
    expect(screen.getByRole('textbox', { name: '検索語' })).toBeInTheDocument();
    fireEvent.keyDown(query, { key: 'Escape' });
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();

    // Cmd+F belongs to macOS; elsewhere it is left to the browser.
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();
    // Not behind a modal dialog either.
    fireEvent.click(screen.getByRole('button', { name: 'ガイド' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    fireEvent.click(
      await screen.findByRole('button', { name: '検索を閉じる' }),
    );
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();

    // The preview keeps the browser's own find.
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(
      screen.queryByRole('textbox', { name: '検索語' }),
    ).not.toBeInTheDocument();
  });
});
