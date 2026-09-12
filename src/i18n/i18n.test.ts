/**
 * Localization test suite.
 *
 * Covers:
 *  1. Catalog parity — every key in `en` must exist in `he` with matching type
 *  2. Locale persistence — getGuildLocale / setGuildLocale round-trip
 *  3. stringsFor / stringsIn routing
 *  4. bidi helpers — ltr / rtlLine / truncateBidi
 *  5. Language switch — applyLanguage stores new locale (unit-level, no Discord calls)
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from '../db/index.js';
import * as repo from '../db/repo.js';
import { ltr, rtlLine, truncateBidi } from './bidi.js';
import { en } from './en.js';
import { he } from './he.js';
import { stringsFor, stringsIn } from './index.js';
import { isLocale, LOCALES } from './locale.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dbPath = join(tmpdir(), `i18n-test-${process.pid}.db`);

beforeAll(() => {
  rmSync(dbPath, { force: true });
  openDatabase(dbPath);
});

afterAll(() => {
  closeDatabase();
  rmSync(dbPath, { force: true });
});

// ---------------------------------------------------------------------------
// 1. Catalog parity
// ---------------------------------------------------------------------------

type CatalogNode = string | ((...a: never[]) => string) | CatalogNode[] | readonly CatalogNode[] | { [k: string]: CatalogNode };

function collectPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj === 'string' || typeof obj === 'function') return [prefix];
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => collectPaths(item, `${prefix}[${i}]`));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj as Record<string, unknown>).flatMap((k) =>
      collectPaths((obj as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

function kindOf(v: unknown): string {
  if (typeof v === 'function') return 'function';
  if (Array.isArray(v)) return `array[${(v as unknown[]).length}]`;
  return typeof v;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.replace(/\[(\d+)\]/g, '.$1').split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

describe('catalog parity', () => {
  const enPaths = collectPaths(en);

  it('en catalog is not empty', () => {
    expect(enPaths.length).toBeGreaterThan(50);
  });

  it('he catalog has every key that en has', () => {
    const missing: string[] = [];
    for (const path of enPaths) {
      const heVal = getPath(he, path);
      if (heVal === undefined) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  it('he entries match the type (string vs function) of en entries', () => {
    const mismatched: string[] = [];
    for (const path of enPaths) {
      const enKind = kindOf(getPath(en, path));
      const heKind = kindOf(getPath(he, path));
      if (enKind !== heKind) mismatched.push(`${path}: en=${enKind}, he=${heKind}`);
    }
    expect(mismatched).toEqual([]);
  });

  it('all scale entries have the same numeric value', () => {
    for (let i = 0; i < en.scale.length; i++) {
      expect(he.scale[i]?.value).toBe(en.scale[i]?.value);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. isLocale guard
// ---------------------------------------------------------------------------

describe('isLocale', () => {
  it('returns true for every supported locale', () => {
    for (const l of LOCALES) {
      expect(isLocale(l)).toBe(true);
    }
  });

  it('returns false for unknown strings', () => {
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('')).toBe(false);
    expect(isLocale('EN')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Locale persistence (DB round-trip)
// ---------------------------------------------------------------------------

/** Helper: create a guild row with minimal required fields. */
function createGuild(guildId: string): void {
  repo.saveGuildSettings({
    guild_id: guildId,
    rating_channel_id: 'ch-1',
    king_role_id: 'role-1',
    king_channel_id: 'ch-2',
    king_menu_channel_id: null,
  });
}

describe('locale persistence', () => {
  const GUILD = 'i18n-guild-1';

  it('returns the default "en" for a freshly created guild (column DEFAULT)', () => {
    createGuild(GUILD);
    // The guilds.locale column has NOT NULL DEFAULT 'en', so the DB always
    // returns 'en' even before any explicit setGuildLocale call.
    expect(repo.getGuildLocale(GUILD)).toBe('en');
  });

  it('stores and retrieves en', () => {
    repo.setGuildLocale(GUILD, 'en');
    expect(repo.getGuildLocale(GUILD)).toBe('en');
  });

  it('stores and retrieves he', () => {
    repo.setGuildLocale(GUILD, 'he');
    expect(repo.getGuildLocale(GUILD)).toBe('he');
  });

  it('overwrites an existing locale', () => {
    repo.setGuildLocale(GUILD, 'en');
    expect(repo.getGuildLocale(GUILD)).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// 4. stringsFor / stringsIn routing
// ---------------------------------------------------------------------------

describe('stringsFor', () => {
  it('returns the English catalog for "en"', () => {
    expect(stringsFor('en').locale).toBe('en');
  });

  it('returns the Hebrew catalog for "he"', () => {
    expect(stringsFor('he').locale).toBe('he');
  });

  it('falls back to English for null', () => {
    expect(stringsFor(null).locale).toBe('en');
  });

  it('falls back to English for unknown locales', () => {
    expect(stringsFor('fr').locale).toBe('en');
  });
});

describe('stringsIn', () => {
  const GUILD = 'i18n-guild-2';

  it('returns English when no locale stored', () => {
    createGuild(GUILD);
    expect(stringsIn(GUILD).locale).toBe('en');
  });

  it('returns Hebrew after setting locale to he', () => {
    repo.setGuildLocale(GUILD, 'he');
    expect(stringsIn(GUILD).locale).toBe('he');
  });

  it('returns English after switching back to en', () => {
    repo.setGuildLocale(GUILD, 'en');
    expect(stringsIn(GUILD).locale).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// 5. bidi helpers
// ---------------------------------------------------------------------------

describe('bidi helpers', () => {
  const LRM = '\u200E';
  const RLM = '\u200F';

  describe('ltr()', () => {
    it('wraps text with LRM marks', () => {
      expect(ltr('hello')).toBe(`${LRM}hello${LRM}`);
    });

    it('returns an empty string for empty input', () => {
      expect(ltr('')).toBe(`${LRM}${LRM}`);
    });
  });

  describe('rtlLine()', () => {
    it('prepends an RLM mark', () => {
      expect(rtlLine('שלום')).toBe(`${RLM}שלום`);
    });
  });

  describe('truncateBidi()', () => {
    it('returns short strings unchanged', () => {
      expect(truncateBidi('hi', 10)).toBe('hi');
    });

    it('truncates at the byte limit and appends ellipsis', () => {
      const long = 'a'.repeat(200);
      const result = truncateBidi(long, 100);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result.endsWith('…')).toBe(true);
    });

    it('does not exceed the limit with bidi-marked text', () => {
      const marked = ltr('x'.repeat(50)) + 'y'.repeat(60);
      const result = truncateBidi(marked, 100);
      expect(result.length).toBeLessThanOrEqual(100);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Dynamic strings (functions inside catalogs)
// ---------------------------------------------------------------------------

describe('dynamic catalog strings', () => {
  it('en tierImproved DM formats correctly', () => {
    const tierFn = en.dm.tierImproved;
    expect(typeof tierFn).toBe('function');
    const result = tierFn({ area: 'Green' });
    expect(result).toContain('Green');
  });

  it('he tierImproved DM is a function and returns a string', () => {
    const tierFn = he.dm.tierImproved;
    expect(typeof tierFn).toBe('function');
    const result = tierFn({ area: 'Green' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('en effect points mention that ratings do not expire', () => {
    expect(en.hub.effectPoints[3]).toContain('do not expire');
  });

  it('he effect points mention that ratings do not expire', () => {
    expect(he.hub.effectPoints[3]).toContain('לא פגים');
  });
});
