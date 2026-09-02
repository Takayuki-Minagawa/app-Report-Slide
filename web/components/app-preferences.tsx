'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { messages, type AppLocale, type UiMessages } from '@/src/i18n/messages';

export type AppTheme = 'light' | 'dark';

const defaultLocale: AppLocale = 'ja';
const defaultTheme: AppTheme = 'light';
const localeStorageKey = 'kumi.locale';
const themeStorageKey = 'kumi.theme';

interface AppPreferences {
  locale: AppLocale;
  theme: AppTheme;
  ready: boolean;
  copy: UiMessages;
  setLocale: (locale: AppLocale) => void;
  setTheme: (theme: AppTheme) => void;
  toggleLocale: () => void;
  toggleTheme: () => void;
}

const AppPreferencesContext = createContext<AppPreferences | null>(null);

function storedValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function persistValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences remain available for the current session when storage is blocked.
  }
}

function storedLocale(): AppLocale {
  const value = storedValue(localeStorageKey);
  return value === 'en' ? 'en' : defaultLocale;
}

function storedTheme(): AppTheme {
  const value = storedValue(themeStorageKey);
  return value === 'dark' ? 'dark' : defaultTheme;
}

function applyDocumentPreferences(locale: AppLocale, theme: AppTheme): void {
  const root = document.documentElement;
  root.lang = locale;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

export function AppPreferencesProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(defaultLocale);
  const [theme, setTheme] = useState<AppTheme>(defaultTheme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const nextLocale = storedLocale();
    const nextTheme = storedTheme();
    applyDocumentPreferences(nextLocale, nextTheme);
    const restorePreferences = window.setTimeout(() => {
      setLocale(nextLocale);
      setTheme(nextTheme);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(restorePreferences);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyDocumentPreferences(locale, theme);
    persistValue(localeStorageKey, locale);
    persistValue(themeStorageKey, theme);
  }, [locale, ready, theme]);

  const value = useMemo<AppPreferences>(
    () => ({
      locale,
      theme,
      ready,
      copy: messages[locale],
      setLocale,
      setTheme,
      toggleLocale: () =>
        ready && setLocale((current) => (current === 'ja' ? 'en' : 'ja')),
      toggleTheme: () =>
        ready &&
        setTheme((current) => (current === 'light' ? 'dark' : 'light')),
    }),
    [locale, ready, theme],
  );

  return (
    <AppPreferencesContext.Provider value={value}>
      {children}
    </AppPreferencesContext.Provider>
  );
}

export function useAppPreferences(): AppPreferences {
  const value = useContext(AppPreferencesContext);
  if (!value) {
    throw new Error(
      'useAppPreferences must be used within AppPreferencesProvider',
    );
  }
  return value;
}
