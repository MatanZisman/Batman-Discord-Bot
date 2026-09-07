import { describe, expect, it } from 'vitest';
import { CREDITS, DAY_MS, SCORING, TIERS, tierIndexByKey } from '../config.js';
import {
  computeStanding,
  recencyFactor,
  reportsToReach,
  tenureFactor,
  type CreditInput,
  type VoteInput,
} from './scoring.js';

const NOW = Date.UTC(2026, 0, 15);
const GREEN = tierIndexByKey('green');
const YELLOW = tierIndexByKey('yellow');
const ORANGE = tierIndexByKey('orange');
const RED = tierIndexByKey('red');

/** A well-established Green voter, which is the baseline case. */
function vote(value: number, overrides: Partial<VoteInput> = {}): VoteInput {
  return {
    raterId: overrides.raterId ?? `rater-${Math.random().toString(36).slice(2, 9)}`,
    value,
    castAt: NOW,
    tierIndex: GREEN,
    participating: true,
    tenureMs: 365 * DAY_MS,
    ...overrides,
  };
}

function votes(count: number, value: number, overrides: Partial<VoteInput> = {}): VoteInput[] {
  return Array.from({ length: count }, (_, i) => vote(value, { raterId: `r${i}`, ...overrides }));
}

describe('baseline', () => {
  it('places a player with no ratings in the first tier', () => {
    const standing = computeStanding([], NOW, null);

    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.score).toBe(SCORING.PRIOR_VALUE);
    expect(standing.raterCount).toBe(0);
  });
});

describe('resistance to small numbers of ratings', () => {
  it('barely moves a player when one person rates them worst possible', () => {
    const standing = computeStanding([vote(5)], NOW, GREEN);

    expect(standing.score).toBeCloseTo(1.8, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('still holds at two harsh ratings, because the headcount gate is not met', () => {
    const standing = computeStanding(votes(2, 5), NOW, GREEN);

    expect(standing.score).toBeCloseTo(2.33, 2);
    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.gates[YELLOW]?.failedGates.join()).toContain('raters 2');
  });

  it('leaves three people reporting mild friction in the default tier', () => {
    const standing = computeStanding(votes(3, 3), NOW, GREEN);

    expect(standing.score).toBeCloseTo(1.86, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('moves once a real group agrees', () => {
    const standing = computeStanding(votes(3, 5), NOW, GREEN);

    expect(standing.tierIndex).toBe(YELLOW);
  });
});

/**
 * The server this is being built for starts small, so a single lobby's worth
 * of feedback has to be enough to matter. These are the cases that define it.
 */
describe('small-lobby sensitivity', () => {
  it('reaches Yellow on five ratings that merely average "mixed"', () => {
    const standing = computeStanding(votes(5, 3), NOW, GREEN);

    expect(standing.score).toBeCloseTo(2.11, 2);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('reaches Yellow on six ratings that average "mixed"', () => {
    const standing = computeStanding(votes(6, 3), NOW, GREEN);

    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('reaches Yellow on an overall-negative five, not just a unanimous one', () => {
    // 4, 4, 3, 3, 3 — nobody said "very difficult", but the lobby agrees.
    const mixed = [vote(4, { raterId: 'a' }), vote(4, { raterId: 'b' }), vote(3, { raterId: 'c' }),
      vote(3, { raterId: 'd' }), vote(3, { raterId: 'e' })];
    const standing = computeStanding(mixed, NOW, GREEN);

    expect(standing.score).toBeGreaterThan(TIERS[YELLOW]?.enterAtScore ?? 0);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('earns Orange on five people who all say "very difficult"', () => {
    const standing = computeStanding(votes(5, 5), NOW, YELLOW);

    expect(standing.score).toBeCloseTo(3.22, 2);
    expect(standing.tierIndex).toBe(ORANGE);
  });

  it('keeps Red reachable without needing a large server', () => {
    const standing = computeStanding(votes(8, 5), NOW, ORANGE);

    expect(standing.score).toBeCloseTo(3.67, 2);
    expect(standing.tierIndex).toBe(RED);
  });

  it('still refuses Red when eight people agree on "difficult" rather than "very"', () => {
    const standing = computeStanding(votes(8, 4), NOW, YELLOW);

    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.gates[RED]?.passed).toBe(false);
  });
});

describe('vote weighting by the rater own standing', () => {
  it('lets a Red group barely dent a Green player', () => {
    const standing = computeStanding(votes(8, 5, { tierIndex: RED }), NOW, GREEN);

    // Eight Red voters carry 8 x 0.2 = 1.6 of trust between them.
    expect(standing.effectiveWeight).toBeCloseTo(1.6, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('gives the same eight ratings real force when they come from Greens', () => {
    const standing = computeStanding(votes(8, 5), NOW, GREEN);

    expect(standing.effectiveWeight).toBeCloseTo(8, 2);
    expect(standing.uncappedTierIndex).toBe(RED);
  });
});

describe('the consensus gate', () => {
  it('refuses a worse placement when the crowd does not actually agree', () => {
    const split = [...votes(24, 5, { raterId: 'high' }), ...votes(26, 3, { raterId: 'low' })].map(
      (v, i) => ({ ...v, raterId: `r${i}` }),
    );

    const standing = computeStanding(split, NOW, YELLOW);

    expect(standing.score).toBeGreaterThan(TIERS[ORANGE]?.enterAtScore ?? 0);
    expect(standing.strongVoteShare).toBeLessThan(0.5);
    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.gates[ORANGE]?.failedGates.join()).toContain('consensus');
  });
});

describe('the jump limiter', () => {
  it('caps how far a player can fall in one step', () => {
    const standing = computeStanding(votes(12, 5), NOW, GREEN);

    expect(standing.uncappedTierIndex).toBe(RED);
    expect(standing.tierIndex).toBe(GREEN + SCORING.MAX_TIER_JUMP_PER_UPDATE);
    expect(standing.deferredTierIndex).toBe(RED);
  });

  it('holds the next step down until the demotion cooldown lapses', () => {
    const justDemoted = NOW - 60 * 60 * 1000; // one hour ago
    const standing = computeStanding(votes(12, 5), NOW, YELLOW, { lastDemotionAt: justDemoted });

    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.deferredTierIndex).toBe(RED);
  });

  it('lets the deferred step land once the cooldown has passed', () => {
    const old = NOW - (SCORING.MIN_HOURS_BETWEEN_DEMOTIONS + 1) * 60 * 60 * 1000;
    const standing = computeStanding(votes(12, 5), NOW, YELLOW, { lastDemotionAt: old });

    expect(standing.tierIndex).toBe(ORANGE);
    expect(standing.deferredTierIndex).toBe(RED);
  });

  it('does not throttle improvement, even inside the cooldown', () => {
    const standing = computeStanding([], NOW, RED, { lastDemotionAt: NOW });

    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.deferredTierIndex).toBeNull();
  });
});

describe('hysteresis', () => {
  it('keeps a player in their current tier just below the entry threshold', () => {
    // Tuned to land between (yellow entry - exit margin) and yellow entry.
    const near = [...votes(2, 5), ...votes(3, 1)].map((v, i) => ({ ...v, raterId: `r${i}` }));
    const standing = computeStanding(near, NOW, YELLOW);

    const yellowEntry = TIERS[YELLOW]?.enterAtScore ?? 0;
    expect(standing.score).toBeLessThan(yellowEntry);
    expect(standing.score).toBeGreaterThan(yellowEntry - SCORING.TIER_EXIT_MARGIN);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('drops the player once they clear the exit margin', () => {
    const standing = computeStanding([...votes(1, 5), ...votes(4, 1)], NOW, YELLOW);

    expect(standing.tierIndex).toBe(GREEN);
  });
});

describe('time', () => {
  it('ignores ratings past their lifetime and reports them as expired', () => {
    const stale = votes(6, 5, { castAt: NOW - (SCORING.VOTE_LIFETIME_DAYS + 1) * DAY_MS });
    const standing = computeStanding(stale, NOW, ORANGE);

    expect(standing.raterCount).toBe(0);
    expect(standing.ignoredVotes.every((v) => v.reason === 'expired')).toBe(true);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('fades a rating linearly across its lifetime', () => {
    expect(recencyFactor(0)).toBe(1);
    expect(recencyFactor(SCORING.VOTE_LIFETIME_DAYS / 2)).toBeCloseTo(
      (1 + SCORING.RECENCY_FLOOR_WEIGHT) / 2,
      5,
    );
  });
});

describe('anti alt-account measures', () => {
  it('dampens a brand new member vote and ramps it up with tenure', () => {
    expect(tenureFactor(0)).toBeCloseTo(SCORING.NEW_MEMBER_WEIGHT_MULTIPLIER, 5);
    expect(tenureFactor(SCORING.FULL_WEIGHT_TENURE_DAYS * DAY_MS)).toBe(1);
  });

  it('treats founding members of a young server as fully established', () => {
    const youngServer = 3 * DAY_MS;

    // Three days of membership in a three-day-old server is full tenure.
    expect(tenureFactor(youngServer, youngServer)).toBe(1);
    // The measure still bites where it is meant to: a day-old member of an
    // old server is still damped.
    expect(tenureFactor(DAY_MS, 700 * DAY_MS)).toBeLessThan(0.5);
  });

  it('does not paralyse a freshly launched server', () => {
    // The launch case: a brand new server where everyone joined at once. If
    // the ramp were absolute, all five votes would be worth 0.35 and could not
    // even clear Yellow's trust gate.
    const serverAge = 2 * DAY_MS;
    const standing = computeStanding(votes(5, 3, { tenureMs: serverAge }), NOW, GREEN, {
      communityAgeMs: serverAge,
    });

    expect(standing.effectiveWeight).toBeCloseTo(5, 2);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('cannot be moved by a swarm of day-old accounts alone', () => {
    const standing = computeStanding(votes(6, 5, { tenureMs: 0 }), NOW, GREEN);

    expect(standing.effectiveWeight).toBeLessThan(6);
    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.gates[ORANGE]?.passed).toBe(false);
  });

  it('ignores ratings from people who opted out of the system', () => {
    const standing = computeStanding(votes(5, 5, { participating: false }), NOW, GREEN);

    expect(standing.raterCount).toBe(0);
    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.ignoredVotes[0]?.reason).toBe('rater opted out');
  });
});

describe('one rating per rater', () => {
  it('is enforced by the store, but a duplicate rater id still only counts once here', () => {
    // The UNIQUE index in the schema is the real guarantee; this documents that
    // the engine treats the vote list as already deduplicated.
    const standing = computeStanding([vote(5, { raterId: 'same' })], NOW, GREEN);
    expect(standing.countedVotes).toHaveLength(1);
  });
});

describe('moderator adjustments', () => {
  /** Relief, by default undecayed so the arithmetic in each test is legible. */
  function credit(reports: number, value: number = SCORING.MIN_RATING): CreditInput {
    return {
      value,
      reports,
      grantedAt: NOW,
      expiresAt: NOW + CREDITS.LIFETIME_DAYS * DAY_MS,
    };
  }

  it('moves the score and leaves every gate statistic alone', () => {
    const cast = votes(6, 5);
    const plain = computeStanding(cast, NOW, ORANGE);
    const eased = computeStanding(cast, NOW, ORANGE, { credits: [credit(5)] });

    expect(eased.score).toBeLessThan(plain.score);

    // The part that must never drift. A pardon that inflated these would make
    // it *easier* to reach a worse tier, which is the opposite of the intent.
    expect(eased.raterCount).toBe(plain.raterCount);
    expect(eased.effectiveWeight).toBeCloseTo(plain.effectiveWeight, 6);
    expect(eased.strongVoteShare).toBeCloseTo(plain.strongVoteShare, 6);
  });

  it('costs the community five fresh reports to undo five reports of relief', () => {
    // The scenario the mechanism was designed around. Six people rate a player
    // 5, which lands them in Orange at 3.40. A moderator eases them by five
    // reports' worth. Getting back to Orange should now take five more people.
    const cast = votes(6, 5);

    const before = computeStanding(cast, NOW, ORANGE);
    expect(before.score).toBeCloseTo(3.4, 2);
    expect(before.tierIndex).toBe(ORANGE);

    const credits = [credit(5)];
    const after = computeStanding(cast, NOW, ORANGE, { credits });
    expect(after.score).toBeCloseTo(2.6, 2);
    expect(after.uncappedTierIndex).toBe(YELLOW);

    expect(reportsToReach(ORANGE, cast, NOW, YELLOW, { credits })).toBe(5);
  });

  it('is outvoted rather than waited out: enough new reports overrule it', () => {
    const cast = [...votes(6, 5), ...votes(5, 5, { raterId: 'later' })].map((v, i) => ({
      ...v,
      raterId: `rater${i}`,
    }));

    const standing = computeStanding(cast, NOW, YELLOW, { credits: [credit(5)] });
    expect(standing.uncappedTierIndex).toBe(ORANGE);
  });

  it('pushes the other way too, without inventing raters to satisfy the gates', () => {
    // Nobody has rated this player at all. Pressure alone can worsen the
    // score, but Red also demands eight real people, so pressure alone cannot
    // manufacture a Red.
    const pushed = computeStanding([], NOW, GREEN, {
      credits: [credit(CREDITS.MAX_REPORTS_PER_GRANT, SCORING.MAX_RATING)],
    });

    expect(pushed.score).toBeGreaterThan(3.6);
    expect(pushed.raterCount).toBe(0);
    expect(pushed.gates[RED]?.passed).toBe(false);
    expect(pushed.gates[RED]?.failedGates.join(' ')).toContain('raters 0');
  });

  it('fades over its lifetime, so a fresh report beats a month-old pardon', () => {
    const cast = votes(6, 5);
    const old = {
      value: SCORING.MIN_RATING,
      reports: 5,
      grantedAt: NOW - 27 * DAY_MS,
      expiresAt: NOW + 3 * DAY_MS,
    };

    const fresh = computeStanding(cast, NOW, ORANGE, { credits: [credit(5)] });
    const stale = computeStanding(cast, NOW, ORANGE, { credits: [old] });

    expect(stale.score).toBeGreaterThan(fresh.score);
  });

  it('stops counting the moment it expires', () => {
    const cast = votes(6, 5);
    const spent = {
      value: SCORING.MIN_RATING,
      reports: 5,
      grantedAt: NOW - 40 * DAY_MS,
      expiresAt: NOW - DAY_MS,
    };

    const standing = computeStanding(cast, NOW, ORANGE, { credits: [spent] });
    expect(standing.score).toBeCloseTo(computeStanding(cast, NOW, ORANGE).score, 6);
  });

  it('reports the direction of the thumb on the scale', () => {
    expect(computeStanding([], NOW, GREEN, { credits: [credit(5)] }).creditWeight).toBeLessThan(0);
    expect(
      computeStanding([], NOW, GREEN, { credits: [credit(5, SCORING.MAX_RATING)] }).creditWeight,
    ).toBeGreaterThan(0);
    expect(computeStanding([], NOW, GREEN).creditWeight).toBe(0);
  });
});

describe('pricing an adjustment', () => {
  it('answers zero when the player is already there', () => {
    expect(reportsToReach(GREEN, [], NOW, GREEN)).toBe(0);
  });

  it('gives up rather than lying when a gate other than the score is binding', () => {
    // Red wants eight raters and 60% of the weight at the top of the scale.
    // Probing with maximum-severity reports satisfies both eventually, so the
    // honest failure case is a tight probe budget, not an impossible tier.
    expect(reportsToReach(RED, [], NOW, GREEN, {}, 3)).toBeNull();
    expect(reportsToReach(RED, [], NOW, GREEN, {}, 20)).not.toBeNull();
  });
});
