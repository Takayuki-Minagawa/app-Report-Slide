import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EditorWorkspace } from './editor-workspace';

describe('EditorWorkspace', () => {
  it('ReportをSlideへ全文置換した後に旧本文をUndoで混在させない', async () => {
    const { container } = render(<EditorWorkspace />);

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
    render(<EditorWorkspace />);
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
    render(<EditorWorkspace />);
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
    render(<EditorWorkspace />);
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
