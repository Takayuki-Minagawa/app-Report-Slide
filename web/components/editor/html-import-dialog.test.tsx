import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { importHtml } from '@/src/workspace/html-import';
import type { ImportedDocument } from '@/src/workspace/files';
import { HtmlImportDialog } from './html-import-dialog';

function converted(): ImportedDocument {
  return {
    ...importHtml(
      '<div class="slide"><h1>First imported page</h1></div><div class="slide"><h2>Second imported page</h2><canvas>Chart fallback</canvas></div>',
    ),
    diagnostics: [],
    sourceName: 'source.html',
    assetBytes: 0,
    unresolved: [],
  };
}

describe('HTML import confirmation', () => {
  it('is hidden when there is no pending import', () => {
    render(
      <HtmlImportDialog
        importResult={null}
        locale="ja"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requires applying the converted model and offers navigable preview with warnings', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <HtmlImportDialog
        importResult={converted()}
        locale="ja"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'HTML取込の確認',
    );
    expect(
      screen.getByRole('region', { name: '変換結果・制限' }),
    ).toHaveTextContent('canvas');
    expect(
      screen.getByRole('heading', { name: 'First imported page' }),
    ).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole('spinbutton', { name: 'プレビューするページ' }),
      { target: { value: 2 } },
    );
    expect(
      screen.getByRole('heading', { name: 'Second imported page' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認して取り込む' }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
