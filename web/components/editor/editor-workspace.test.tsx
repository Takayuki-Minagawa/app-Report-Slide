import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppPreferencesProvider } from '@/components/app-preferences';
import { EditorWorkspace } from './editor-workspace';

function renderWorkspace() {
  return render(
    <AppPreferencesProvider>
      <EditorWorkspace />
    </AppPreferencesProvider>,
  );
}

describe('EditorWorkspace', () => {
  it('previews a relative image named constructor without treating it as an object property', async () => {
    renderWorkspace();
    await screen.findByText('REPORT');
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    fireEvent.change(
      await screen.findByRole('textbox', { name: 'Markdown原稿' }),
      {
        target: { value: '![Prototype filename](constructor)' },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'Markdown原稿' }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    expect(
      await screen.findByRole('img', { name: 'Prototype filename' }),
    ).toHaveAttribute('src', 'constructor');
  });

  it('shows the actual parse error when saving an invalid Markdown draft', async () => {
    window.localStorage.setItem('kumi.locale', 'en');
    renderWorkspace();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Switch to Markdown' }),
    );
    const draft = await screen.findByRole('textbox', {
      name: 'Markdown draft',
    });
    fireEvent.change(draft, {
      target: { value: '---\ntype: book\n---\n\n# Invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The document type must be report or slide.',
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('JSON');
    expect(draft).toHaveValue('---\ntype: book\n---\n\n# Invalid');
    expect(screen.getByText('REPORT')).toBeInTheDocument();
  });
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.lang = 'ja';
  });

  it('switches workspace controls, theme, and the in-app guide to English', async () => {
    renderWorkspace();
    expect(await screen.findByText('REPORT')).toBeInTheDocument();

    const themeButton = screen.getByRole('button', {
      name: 'ダークモード',
    });
    await waitFor(() => expect(themeButton).toBeEnabled());
    expect(themeButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(themeButton);
    await waitFor(() => {
      expect(document.documentElement).toHaveClass('dark');
      expect(
        screen.getByRole('button', { name: 'ダークモード' }),
      ).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(screen.getByRole('button', { name: '英語表示' }));
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('en');
      expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        screen.getByRole('button', { name: 'English interface' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen.getByRole('button', { name: 'Switch to Markdown' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch to Markdown' }));
    const source = await screen.findByRole('textbox', {
      name: 'Markdown draft',
    });
    fireEvent.change(source, {
      target: { value: '---\ntype: book\n---\n\n# Broken document' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not apply Markdown');
    expect(alert).toHaveTextContent(
      'The document type must be report or slide.',
    );
    expect(alert).not.toHaveTextContent('typeには');

    fireEvent.click(screen.getByRole('button', { name: 'Guide' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'KUMI quick guide',
    );
  });

  it('ReportをSlideへ全文置換した後に旧本文をUndoで混在させない', async () => {
    const { container } = renderWorkspace();

    expect(await screen.findByText('REPORT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    fireEvent.change(source, {
      target: {
        value:
          '---\ntype: slide\ntitle: 新しいスライド\ntheme: beamer-simple\n---\n\n# 新しいスライド\n\n新本文',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));

    expect(await screen.findByText('SLIDE')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '元に戻す' })).toBeDisabled();
    });
    expect(container).not.toHaveTextContent('解析概要');
    expect(container).toHaveTextContent('新本文');
    expect(screen.getAllByText('新しいスライド').length).toBeGreaterThan(0);
  });

  it('壊れたFront Matterを適用しても現在文書を維持する', async () => {
    renderWorkspace();
    expect(await screen.findByText('REPORT')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    fireEvent.change(source, {
      target: { value: '---\ntype: book\n---\n\n# 壊れた文書' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Markdownを適用できませんでした',
    );
    expect(screen.getByText('REPORT')).toBeInTheDocument();
  });

  it('未適用Markdown下書きをタブ移動で保持し明示破棄できる', async () => {
    renderWorkspace();
    expect(await screen.findByText('REPORT')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    const draft = `${(source as HTMLTextAreaElement).value}\n\n下書きの追記`;
    fireEvent.change(source, { target: { value: draft } });

    expect(screen.getByLabelText('未保存')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    expect(
      await screen.findByRole('textbox', { name: 'Markdown原稿' }),
    ).toHaveValue(draft);

    fireEvent.click(screen.getByRole('button', { name: '破棄' }));
    expect(
      await screen.findByRole('button', { name: 'Markdownへ切り替え' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    expect(
      await screen.findByRole('textbox', { name: 'Markdown原稿' }),
    ).not.toHaveValue(draft);
  });

  it('未適用Markdown下書きがある間はビジュアル編集との競合を防ぐ', async () => {
    renderWorkspace();
    expect(await screen.findByText('REPORT')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    expect(screen.getByRole('button', { name: '元に戻す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やり直す' })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    fireEvent.change(source, {
      target: { value: `${(source as HTMLTextAreaElement).value}\n\n競合防止` },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'ビジュアル編集へ切り替え' }),
    );

    expect(screen.getByRole('textbox', { name: 'Markdown原稿' })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Markdownの変更を先に処理してください',
    );
    for (const button of screen.getAllByRole('button', {
      name: 'Markdownを開く',
    })) {
      expect(button).toBeDisabled();
    }

    fireEvent.click(screen.getByRole('button', { name: '破棄' }));
    await waitFor(() => {
      expect(
        screen.queryByRole('textbox', { name: 'Markdown原稿' }),
      ).not.toBeInTheDocument();
    });
  });
});
