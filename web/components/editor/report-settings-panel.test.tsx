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

  it('stores only formatting that differs from the theme and validates the page number format', () => {
    const onApply = vi.fn();
    const { unmount } = render(
      <AppPreferencesProvider>
        <ReportSettingsPanel
          metadata={{ theme: 'report-jp' }}
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    // The theme supplies "- {n} -" in the centre and a centred cover.
    expect(screen.getByLabelText('ページ番号の書式')).toHaveValue('- {n} -');
    expect(
      screen.getByRole('combobox', { name: 'ページ番号の位置' }),
    ).toHaveValue('bottom-center');
    expect(screen.getByLabelText('（注）')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '報告書の構成を適用' }));
    const stored = onApply.mock.calls[0][0].report_settings;
    for (const key of [
      'page_number_format',
      'toc_page_number_format',
      'page_number_position',
      'cover_layout',
      'caption_separator',
      'callout_labels',
      'keep_tables',
      'word_fields',
      'number_depth',
      'appendix_numbering',
      'toc_title',
      'front_matter_page_numbers',
    ])
      expect(stored, key).not.toHaveProperty(key);

    fireEvent.change(screen.getByLabelText('ページ番号の書式'), {
      target: { value: '{n} / {total}' },
    });
    fireEvent.change(
      screen.getByRole('combobox', { name: '図表番号と表題の区切り' }),
      { target: { value: ': ' } },
    );
    fireEvent.change(screen.getByRole('combobox', { name: '表のページ分割' }), {
      target: { value: 'auto' },
    });
    fireEvent.change(screen.getByLabelText('（注）'), {
      target: { value: '注' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Word出力の番号・参照・目次をフィールドにする',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '報告書の構成を適用' }));
    expect(onApply.mock.calls[1][0].report_settings).toMatchObject({
      page_number_format: '{n} / {total}',
      caption_separator: ': ',
      keep_tables: 'auto',
      callout_labels: { note: '注' },
      word_fields: true,
    });
    expect(onApply.mock.calls[1][0].report_settings).not.toHaveProperty(
      'toc_page_number_format',
    );

    fireEvent.change(screen.getByLabelText('ページ番号の書式'), {
      target: { value: 'page' },
    });
    fireEvent.click(screen.getByRole('button', { name: '報告書の構成を適用' }));
    expect(onApply).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    unmount();

    render(
      <AppPreferencesProvider>
        <ReportSettingsPanel
          metadata={{ report_style: { css: 'h1 { color: red }' } }}
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'Wordには反映されません',
    );
  });
});
