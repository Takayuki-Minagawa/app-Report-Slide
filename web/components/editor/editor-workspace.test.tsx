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
});
