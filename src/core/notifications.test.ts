import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER_INDEX, TIER_COUNT, tierIndexByKey } from '../config.js';
import { isInitialisation } from './standing-service.js';

/**
 * The rule these pin: a member is DMed when something they already knew has
 * changed, and never merely because the bot looked at them for the first time.
 *
 * Worth its own file because the bug it prevents is invisible in review. A
 * stored tier of null compares unequal to tier 0, so the obvious "did the tier
 * change?" test reports true for every member nobody had evaluated yet — and
 * the resulting DM says "your standing is now Green" to somebody who has been
 * Green since the day they joined.
 */
describe('when a placement is news and when it is not', () => {
  const GREEN = tierIndexByKey('green');
  const YELLOW = tierIndexByKey('yellow');
  const RED = tierIndexByKey('red');

  it('treats the first evaluation landing in the default area as no news', () => {
    expect(isInitialisation(null, DEFAULT_TIER_INDEX)).toBe(true);
    expect(isInitialisation(null, GREEN)).toBe(true);
  });

  it('still speaks up when a first evaluation restricts somebody', () => {
    // Deliberately narrow. Losing sight of channels with no explanation is
    // worse than an unexpected message, so only the do-nothing case is quiet.
    expect(isInitialisation(null, YELLOW)).toBe(false);
    expect(isInitialisation(null, RED)).toBe(false);
  });

  it('treats every move between known areas as news', () => {
    for (let from = 0; from < TIER_COUNT; from++) {
      for (let to = 0; to < TIER_COUNT; to++) {
        expect(isInitialisation(from, to)).toBe(false);
      }
    }
  });

  it('does not mistake a return to the default area for an initialisation', () => {
    // Somebody climbing back to Green from Yellow is the single most welcome
    // message the bot sends. It must not be swallowed by the null check.
    expect(isInitialisation(YELLOW, GREEN)).toBe(false);
    expect(isInitialisation(RED, GREEN)).toBe(false);
  });
});
