import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { AppPreferencesProvider, useAppPreferences } from './app-preferences';

function PreferenceControls() {
  const { locale, theme, toggleLocale, toggleTheme } = useAppPreferences();
  return (
    <>
      <output data-testid="locale">{locale}</output>
      <output data-testid="theme">{theme}</output>
      <button type="button" onClick={toggleLocale}>
        locale
      </button>
      <button type="button" onClick={toggleTheme}>
        theme
      </button>
    </>
  );
}

describe('AppPreferencesProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
    document.documentElement.lang = 'ja';
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to Japanese and light mode, then persists user choices', async () => {
    render(
      <AppPreferencesProvider>
        <PreferenceControls />
      </AppPreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('ja');
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(document.documentElement.lang).toBe('ja');
      expect(document.documentElement).not.toHaveClass('dark');
    });

    fireEvent.click(screen.getByRole('button', { name: 'locale' }));
    fireEvent.click(screen.getByRole('button', { name: 'theme' }));

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement).toHaveClass('dark');
      expect(window.localStorage.getItem('kumi.locale')).toBe('en');
      expect(window.localStorage.getItem('kumi.theme')).toBe('dark');
    });
  });

  it('restores a previously selected locale and theme', async () => {
    window.localStorage.setItem('kumi.locale', 'en');
    window.localStorage.setItem('kumi.theme', 'dark');

    render(
      <AppPreferencesProvider>
        <PreferenceControls />
      </AppPreferencesProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('locale')).toHaveTextContent('en');
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement).toHaveClass('dark');
    });
  });
});
