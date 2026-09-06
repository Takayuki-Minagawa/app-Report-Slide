import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { parseMarkdown } from '@/src/markdown/parser';
import { EditorWorkspace } from './editor-workspace';

beforeEach(() => window.localStorage.clear());

async function applySettings() {
  fireEvent.change(
    await screen.findByRole('combobox', { name: '用紙サイズ' }),
    { target: { value: 'B5' } },
  );
  fireEvent.change(screen.getByRole('combobox', { name: '用紙の向き' }), {
    target: { value: 'landscape' },
  });
  fireEvent.change(
    screen.getByRole('spinbutton', { name: '段落先頭の字下げ（字）' }),
    { target: { value: '1' } },
  );
  fireEvent.change(screen.getByRole('spinbutton', { name: '行間（倍率）' }), {
    target: { value: '1.5' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ページ設定を適用' }));
}

function renderWorkspace() {
  return render(
    <AppPreferencesProvider>
      <EditorWorkspace />
    </AppPreferencesProvider>,
  );
}

describe('page settings workspace', () => {
  it('updates editing/preview sheets and writes settings into the Markdown source', async () => {
    const { container } = renderWorkspace();
    await applySettings();
    let sheet = container.querySelector<HTMLElement>('.report-sheet')!;
    expect(sheet.style.getPropertyValue('--report-width')).toBe('257mm');
    expect(sheet.style.getPropertyValue('--report-line-height')).toBe('1.5');
    expect(sheet.style.getPropertyValue('--report-indent')).toBe('1em');
    fireEvent.click(
      screen.getByRole('button', { name: '完成プレビューへ切り替え' }),
    );
    sheet = container.querySelector<HTMLElement>('.report-sheet')!;
    expect(sheet.style.getPropertyValue('--report-width')).toBe('257mm');
    expect(screen.getByLabelText('レポートプレビュー')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    const source = await screen.findByRole('textbox', { name: 'Markdown原稿' });
    expect(
      parseMarkdown((source as HTMLTextAreaElement).value).document.metadata
        .page_settings,
    ).toMatchObject({
      paper: 'B5',
      orientation: 'landscape',
      first_line_indent: 1,
      line_height: 1.5,
    });
    expect(
      screen.getByRole('button', { name: 'ページ設定を適用' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Markdownを適用' }));
    await waitFor(() =>
      expect(
        screen.getByRole('spinbutton', { name: '行間（倍率）' }),
      ).toHaveValue(1.5),
    );
    fireEvent.click(screen.getByRole('button', { name: '標準設定に戻す' }));
    expect(screen.getByRole('combobox', { name: '用紙サイズ' })).toHaveValue(
      'A4',
    );
  });

  it('applies settings to the project and keeps them when switching chapters', async () => {
    const { container } = renderWorkspace();
    fireEvent.click(
      await screen.findByRole('button', {
        name: '現在のReportをプロジェクト化',
      }),
    );
    await applySettings();
    fireEvent.click(screen.getByRole('button', { name: '空の章を追加' }));
    await waitFor(() =>
      expect(
        screen.getByRole('spinbutton', { name: '行間（倍率）' }),
      ).toHaveValue(1.5),
    );
    expect(
      container
        .querySelector<HTMLElement>('.report-sheet')!
        .style.getPropertyValue('--report-width'),
    ).toBe('257mm');
  });

  it('rejects margins that leave too little body space without changing the document', async () => {
    renderWorkspace();
    fireEvent.change(
      await screen.findByRole('combobox', { name: '用紙サイズ' }),
      { target: { value: 'A5' } },
    );
    for (const name of ['左余白（mm）', '右余白（mm）']) {
      fireEvent.change(screen.getByRole('spinbutton', { name }), {
        target: { value: '60' },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: 'ページ設定を適用' }));
    expect(screen.getByRole('alert')).toHaveTextContent('40 mm');
    fireEvent.click(screen.getByRole('button', { name: 'Markdownへ切り替え' }));
    expect(
      parseMarkdown(
        (
          screen.getByRole('textbox', {
            name: 'Markdown原稿',
          }) as HTMLTextAreaElement
        ).value,
      ).document.metadata,
    ).not.toHaveProperty('page_settings');
  });
});
