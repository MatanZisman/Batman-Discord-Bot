/**
 * Entry point for all per-guild localization.
 *
 * Usage inside a handler:
 *   const t = stringsIn(guildId);
 *   await reply({ content: t.maintenance.notice });
 *
 * Usage with a bare locale (e.g. after reading from DB):
 *   const t = stringsFor(locale);
 */
import type { Strings } from './en.js';
import { en } from './en.js';
import { he } from './he.js';
import { DEFAULT_LOCALE, isLocale, type Locale } from './locale.js';
import * as repo from '../db/repo.js';

export type { Strings } from './en.js';
export { DEFAULT_LOCALE } from './locale.js';
export type { Locale } from './locale.js';

const CATALOGS: Record<Locale, Strings> = { en, he };

/** Returns the catalog for the given locale (falls back to English). */
export function stringsFor(locale: string | null | undefined): Strings {
  if (locale && isLocale(locale)) return CATALOGS[locale];
  return CATALOGS[DEFAULT_LOCALE];
}

/** Returns the catalog for the guild stored in the database. */
export function stringsIn(guildId: string): Strings {
  return stringsFor(repo.getGuildLocale(guildId));
}
