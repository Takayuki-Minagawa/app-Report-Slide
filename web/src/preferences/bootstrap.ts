/**
 * Runs in the document head before React hydrates, preventing a saved-theme
 * flash while falling back safely when browser storage is unavailable.
 */
export const preferenceBootstrapScript = `
(() => {
  try {
    const root = document.documentElement;
    const locale = localStorage.getItem('kumi.locale') === 'en' ? 'en' : 'ja';
    const theme = localStorage.getItem('kumi.theme') === 'dark' ? 'dark' : 'light';
    root.lang = locale;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  } catch {
    // The application falls back to Japanese and light mode when storage is unavailable.
  }
})();
`;
