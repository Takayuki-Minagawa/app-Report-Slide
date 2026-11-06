import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppPreferencesProvider } from '@/components/app-preferences';
import { defaultPageSettings } from '@/src/document/page-settings';
import { PageSettingsPanel } from './page-settings-panel';

beforeEach(() => localStorage.clear());

describe('body format presets', () => {
  it('previews a preset, applies only paragraph fields, and restores the default', () => {
    const onApply = vi.fn();
    render(
      <AppPreferencesProvider>
        <PageSettingsPanel
          settings={{ ...defaultPageSettings, paper: 'A3', font_size: 12 }}
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: '本文書式プリセット' }),
      { target: { value: 'heading' } },
    );
    expect(onApply).not.toHaveBeenCalled();
    const sample = screen
      .getByLabelText('本文書式の見本（適用前）')
      .querySelectorAll('p');
    expect(sample[0].style.textIndent).toBe('0em');
    expect(sample[1].style.textIndent).toBe('1em');
    fireEvent.click(screen.getByRole('button', { name: 'ページ設定を適用' }));
    expect(onApply).toHaveBeenCalledWith({
      ...defaultPageSettings,
      paper: 'A3',
      font_size: 12,
      first_line_indent: 1,
      after_heading_indent: 'none',
      paragraph_spacing: 0,
    });
    fireEvent.click(screen.getByRole('button', { name: '標準設定に戻す' }));
    expect(onApply).toHaveBeenLastCalledWith(defaultPageSettings);
    expect(
      screen.getByRole('combobox', { name: '見出し直後の本文' }),
    ).toHaveValue('same');
  });

  it('handles a heading-only change and disables format controls for a draft', () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <AppPreferencesProvider>
        <PageSettingsPanel
          settings={defaultPageSettings}
          disabled={false}
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: '見出し直後の本文' }),
      { target: { value: 'none' } },
    );
    expect(
      screen.getByText('設定はまだ適用されていません。'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ページ設定を適用' }));
    expect(onApply).toHaveBeenCalledWith({
      ...defaultPageSettings,
      after_heading_indent: 'none',
    });
    rerender(
      <AppPreferencesProvider>
        <PageSettingsPanel
          settings={defaultPageSettings}
          disabled
          onApply={onApply}
        />
      </AppPreferencesProvider>,
    );
    expect(
      screen.getByRole('combobox', { name: '本文書式プリセット' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: '見出し直後の本文' }),
    ).toBeDisabled();
  });
});
