import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { ReportSettingsPanel } from './report-settings-panel';
import { SemanticProperties } from './semantic-properties';

beforeEach(() => localStorage.clear());

describe('report structure settings', () => {
  it('applies cover fields, numbering and contents settings together', () => {
    const onApply = vi.fn();
    render(
      <AppPreferencesProvider>
        <ReportSettingsPanel
          metadata={{ title: '既存の題名' }}
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '表紙を付ける' }));
    fireEvent.change(screen.getByLabelText('報告書の題名'), {
      target: { value: '技術報告書' },
    });
    fireEvent.change(screen.getByLabelText('所属'), {
      target: { value: '設計部' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: '章・節番号を表示' }));
    fireEvent.change(
      screen.getByRole('combobox', { name: '章・節の番号書式' }),
      { target: { value: 'chapter' } },
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: '図・表・式の番号' }),
      { target: { value: 'chapter' } },
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: '見出しの目次を付ける' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '図目次を付ける' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: '目次・図表目次を独立ページにする',
      }),
    );
    const pageNumbers = screen.getByRole('checkbox', {
      name: '目次に実際のページ番号を表示',
    });
    expect(pageNumbers).not.toBeChecked();
    fireEvent.click(pageNumbers);
    expect(
      screen.getByText(/自動改ページを反映した実際のページ番号を表示/),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole('combobox', { name: '目次に含める見出し' }),
      { target: { value: '2' } },
    );
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '報告書の構成を適用' }));
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '技術報告書',
        toc: true,
        number_sections: true,
        report_settings: expect.objectContaining({
          cover: true,
          affiliation: '設計部',
          heading_numbering: 'chapter',
          caption_numbering: 'chapter',
          toc_depth: 2,
          toc_page: true,
          toc_page_numbers: true,
          list_figures: true,
        }),
      }),
    );
  });
  it.each([
    [
      'ja',
      '目次に実際のページ番号を表示',
      '報告書の構成を適用',
      /ページ番号は表示しません/,
    ],
    [
      'en',
      'Show actual page numbers in contents',
      'Apply report structure',
      /without page numbers/,
    ],
  ] as const)(
    'restores and disables actual page numbers in %s',
    async (locale, checkbox, apply, disabledDescription) => {
      localStorage.setItem('kumi.locale', locale);
      const onApply = vi.fn();
      render(
        <AppPreferencesProvider>
          <ReportSettingsPanel
            metadata={{ report_settings: { toc_page_numbers: true } }}
            disabled={false}
            onApply={onApply}
          />
        </AppPreferencesProvider>,
      );
      const pageNumbers = await screen.findByRole('checkbox', {
        name: checkbox,
      });
      expect(pageNumbers).toBeChecked();
      fireEvent.click(pageNumbers);
      expect(screen.getByText(disabledDescription)).toBeInTheDocument();
      expect(onApply).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: apply }));
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({
          report_settings: expect.objectContaining({ toc_page_numbers: false }),
        }),
      );
    },
  );
  it('locks structure controls while Markdown is being edited', () => {
    render(
      <AppPreferencesProvider>
        <ReportSettingsPanel metadata={{}} disabled onApply={vi.fn()} />
      </AppPreferencesProvider>,
    );
    expect(
      screen.getByRole('checkbox', { name: '表紙を付ける' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: '目次に実際のページ番号を表示' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: '章・節の番号書式' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: '報告書の構成を適用' }),
    ).toBeDisabled();
  });
  it('keeps TOC membership independent from an appendix heading number', () => {
    const onApply = vi.fn();
    render(
      <AppPreferencesProvider>
        <SemanticProperties
          node={{
            type: 'heading',
            attrs: { nodeId: 'h1', level: 1 },
            content: [],
          }}
          report
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'この見出しを目次に含める' }),
    );
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'この章から付録として採番' }),
    );
    fireEvent.click(screen.getByRole('button', { name: '属性を適用' }));
    expect(onApply).toHaveBeenCalledWith(
      'h1',
      expect.objectContaining({ toc: false, appendix: true, numbered: null }),
    );
  });
});
