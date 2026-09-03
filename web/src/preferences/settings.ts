import type { AppLocale } from '@/src/i18n/messages';

export type AppTheme = 'light' | 'dark';
export const defaultLocale: AppLocale = 'ja';
export const defaultTheme: AppTheme = 'light';
export const localeStorageKey = 'kumi.locale';
export const themeStorageKey = 'kumi.theme';

export function normalizeLocale(value: unknown): AppLocale {
  return value === 'en' ? 'en' : defaultLocale;
}

export function normalizeTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : defaultTheme;
}
