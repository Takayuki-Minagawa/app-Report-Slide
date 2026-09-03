import {
  defaultLocale,
  defaultTheme,
  localeStorageKey,
  themeStorageKey,
} from './settings';

/**
 * Runs in the document head before React hydrates, preventing a saved-theme
 * flash while falling back safely when browser storage is unavailable.
 */
export const preferenceBootstrapScript = `
(() => {
  try {
    const root = document.documentElement;
    const locale = localStorage.getItem(${JSON.stringify(localeStorageKey)}) === 'en' ? 'en' : ${JSON.stringify(defaultLocale)};
    const theme = localStorage.getItem(${JSON.stringify(themeStorageKey)}) === 'dark' ? 'dark' : ${JSON.stringify(defaultTheme)};
    root.lang = locale;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  } catch {
    // The application falls back to Japanese and light mode when storage is unavailable.
  }
})();
`;
