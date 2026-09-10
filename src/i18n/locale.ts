/**
 * Supported locales for the bot's per-guild language setting.
 * Adding a locale here requires a corresponding catalog in en.ts / he.ts.
 */
export const LOCALES = ['en', 'he'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Human-readable names shown in the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  he: 'עברית',
};

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return locale === 'he';
}
