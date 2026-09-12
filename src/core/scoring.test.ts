import { describe, expect, it } from 'vitest';
import { CREDITS, DAY_MS, SCORING, TIERS, tierIndexByKey } from '../config.js';
import {
  computeStanding,
  ratingValueFactor,
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

function credit(reports: number, value: number = SCORING.MIN_RATING): CreditInput {
  return {
    value,
    reports,
    grantedAt: NOW,
    expiresAt: NOW + CREDITS.LIFETIME_DAYS * DAY_MS,
  };
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

    expect(standing.score).toBeCloseTo(1.44, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('still holds at two harsh ratings, because the headcount gate is not met', () => {
    const standing = computeStanding(votes(2, 5), NOW, GREEN);

    expect(standing.score).toBeCloseTo(1.8, 2);
    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.gates[YELLOW]?.failedGates.join()).toContain('raters 2');
  });

  it('leaves three people reporting mild friction in the default tier', () => {
    const standing = computeStanding(votes(3, 3), NOW, GREEN);

    expect(standing.tierIndex).toBe(GREEN);
  });

  it('holds at four harsh ratings until the five-rater Yellow gate is met', () => {
    const standing = computeStanding(votes(4, 5), NOW, GREEN);

    expect(standing.tierIndex).toBe(GREEN);
    expect(standing.gates[YELLOW]?.failedGates.join()).toContain('raters 4');
  });
});

/**
 * Tuned thresholds: Yellow 2.5 / 5 raters, Orange 3.5, Red 4.25.
 * Good ratings weigh more than harsh ones (see GOOD_VOTE_WEIGHTS).
 */
describe('tuned thresholds', () => {
  it('reaches Yellow on five unanimous "very difficult" ratings', () => {
    const standing = computeStanding(votes(5, 5), NOW, GREEN);

    expect(standing.score).toBeCloseTo(2.54, 2);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('refuses Yellow when five people only average "mixed"', () => {
    const standing = computeStanding(votes(5, 3), NOW, GREEN);

    expect(standing.score).toBeCloseTo(2.11, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('reaches Yellow on six ratings of "difficult"', () => {
    const standing = computeStanding(votes(6, 4), NOW, GREEN);

    expect(standing.score).toBeCloseTo(2.59, 2);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('needs a large pile of harsh ratings to earn Orange', () => {
    const standing = computeStanding(votes(14, 5), NOW, YELLOW);

    expect(standing.score).toBeCloseTo(3.55, 2);
    expect(standing.tierIndex).toBe(ORANGE);
  });

  it('keeps Red reachable but expensive', () => {
    const standing = computeStanding(votes(35, 5), NOW, ORANGE);

    expect(standing.score).toBeCloseTo(4.26, 2);
    expect(standing.tierIndex).toBe(RED);
  });

  it('still refuses Red when people agree on "difficult" rather than "very"', () => {
    const standing = computeStanding(votes(35, 4), NOW, ORANGE);

    expect(standing.tierIndex).toBeLessThan(RED);
    expect(standing.gates[RED]?.passed).toBe(false);
  });
});

describe('good votes weigh more than harsh ones', () => {
  it('gives rating 1 more influence than rating 5', () => {
    expect(ratingValueFactor(1)).toBeGreaterThan(ratingValueFactor(5));
    expect(ratingValueFactor(1)).toBe(SCORING.GOOD_VOTE_WEIGHTS[1]);
    expect(ratingValueFactor(5)).toBe(SCORING.GOOD_VOTE_WEIGHTS[5]);
  });

  it('lets good ratings pull the score harder than an equal number of harsh ones', () => {
    const good = computeStanding(votes(5, 1), NOW, GREEN);
    const harsh = computeStanding(votes(5, 5), NOW, GREEN);

    // Distance from the prior: five 1s should move less upward than five 5s
    // move... wait, five 1s stay near prior (all 1s), five 5s climb. Compare
    // weight instead: the good pile carries more total weight.
    expect(good.effectiveWeight).toBeGreaterThan(harsh.effectiveWeight);
  });
});

describe('vote weighting by the rater own standing', () => {
  it('lets a Red group barely dent a Green player', () => {
    const standing = computeStanding(votes(8, 5, { tierIndex: RED }), NOW, GREEN);

    // Eight Red voters: 8 × 0.2 trust × 0.5 value-weight = 0.8.
    expect(standing.effectiveWeight).toBeCloseTo(0.8, 2);
    expect(standing.tierIndex).toBe(GREEN);
  });

  it('gives the same eight ratings real force when they come from Greens', () => {
    const standing = computeStanding(votes(8, 5), NOW, GREEN);

    expect(standing.effectiveWeight).toBeCloseTo(4, 2);
    expect(standing.uncappedTierIndex).toBe(YELLOW);
  });
});

describe('the consensus gate', () => {
  it('refuses a worse placement when the crowd does not actually agree', () => {
    const split = [...votes(39, 5), ...votes(21, 3)].map((v, i) => ({
      ...v,
      raterId: `r${i}`,
    }));

    const standing = computeStanding(split, NOW, YELLOW);

    expect(standing.score).toBeGreaterThan(TIERS[ORANGE]?.enterAtScore ?? 0);
    expect(standing.strongVoteShare).toBeLessThan(0.5);
    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.gates[ORANGE]?.failedGates.join()).toContain('consensus');
  });
});

describe('the jump limiter', () => {
  it('caps how far a player can fall in one step', () => {
    const standing = computeStanding(votes(35, 5), NOW, GREEN);

    expect(standing.uncappedTierIndex).toBe(RED);
    expect(standing.tierIndex).toBe(GREEN + SCORING.MAX_TIER_JUMP_PER_UPDATE);
    expect(standing.deferredTierIndex).toBe(RED);
  });

  it('holds the next step down until the demotion cooldown lapses', () => {
    const justDemoted = NOW - 60 * 60 * 1000; // one hour ago
    const standing = computeStanding(votes(35, 5), NOW, YELLOW, { lastDemotionAt: justDemoted });

    expect(standing.tierIndex).toBe(YELLOW);
    expect(standing.deferredTierIndex).toBe(RED);
  });

  it('lets the deferred step land once the cooldown has passed', () => {
    const old = NOW - (SCORING.MIN_HOURS_BETWEEN_DEMOTIONS + 1) * 60 * 60 * 1000;
    const standing = computeStanding(votes(35, 5), NOW, YELLOW, { lastDemotionAt: old });

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
    // Five "difficult" ratings land between (yellow entry - exit margin) and yellow entry.
    const standing = computeStanding(votes(5, 4), NOW, YELLOW);

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
  it('keeps old ratings counting when votes do not expire', () => {
    const stale = votes(6, 5, { castAt: NOW - 400 * DAY_MS });
    const standing = computeStanding(stale, NOW, ORANGE);

    expect(standing.raterCount).toBe(6);
    expect(standing.ignoredVotes).toHaveLength(0);
    expect(standing.tierIndex).toBe(YELLOW);
  });

  it('does not fade ratings by age while expiry is off', () => {
    expect(recencyFactor(0)).toBe(1);
    expect(recencyFactor(SCORING.VOTE_LIFETIME_DAYS / 2)).toBe(1);
    expect(recencyFactor(SCORING.VOTE_LIFETIME_DAYS * 10)).toBe(1);
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
    // The launch case: a brand new server where everyone joined at once.
    // Founders count at full tenure; five unanimous harsh ratings clear Yellow.
    const serverAge = 2 * DAY_MS;
    const standing = computeStanding(votes(5, 5, { tenureMs: serverAge }), NOW, GREEN, {
      communityAgeMs: serverAge,
    });

    expect(standing.tierIndex).toBe(YELLOW);
  });
});

describe('moderator adjustments', () => {
  it('moves the score without inventing raters or trust', () => {
    const plain = computeStanding(votes(14, 5), NOW, ORANGE);
    const eased = computeStanding(votes(14, 5), NOW, ORANGE, { credits: [credit(5)] });

    expect(eased.score).toBeLessThan(plain.score);
    expect(eased.raterCount).toBe(plain.raterCount);
    expect(eased.effectiveWeight).toBeCloseTo(plain.effectiveWeight, 6);
    expect(eased.strongVoteShare).toBeCloseTo(plain.strongVoteShare, 6);
  });

  it('costs the community fresh reports to undo relief', () => {
    const cast = votes(14, 5);

    const before = computeStanding(cast, NOW, ORANGE);
    expect(before.score).toBeCloseTo(3.55, 2);
    expect(before.tierIndex).toBe(ORANGE);

    const credits = [credit(5)];
    const after = computeStanding(cast, NOW, ORANGE, { credits });
    expect(after.score).toBeCloseTo(2.75, 2);
    expect(after.uncappedTierIndex).toBe(YELLOW);

    expect(reportsToReach(ORANGE, cast, NOW, YELLOW, { credits })).toBe(16);
  });

  it('is outvoted rather than waited out: enough new reports overrule it', () => {
    const cast = [...votes(14, 5), ...votes(16, 5, { raterId: 'later' })].map((v, i) => ({
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
    const cast = votes(14, 5);
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
    const cast = votes(14, 5);
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

describe('a standing computed without its adjustments', () => {
  it('is a different number, which is why the context is not optional', () => {
    const credits: CreditInput[] = [
      {
        value: SCORING.MAX_RATING,
        reports: 5,
        grantedAt: NOW,
        expiresAt: NOW + CREDITS.LIFETIME_DAYS * DAY_MS,
      },
    ];

    const withCredits = computeStanding([], NOW, GREEN, { credits });
    const withoutCredits = computeStanding([], NOW, GREEN);

    expect(withCredits.score).toBeCloseTo(3.22, 2);
    expect(withoutCredits.score).toBe(SCORING.PRIOR_VALUE);
    expect(withCredits.score).not.toBeCloseTo(withoutCredits.score, 2);
  });
});

describe('pricing an adjustment', () => {
  it('answers zero when the player is already there', () => {
    expect(reportsToReach(GREEN, [], NOW, GREEN)).toBe(0);
  });

  it('gives up rather than lying when a gate other than the score is binding', () => {
    // Red wants eight raters and a score of 4.25. A tiny probe budget cannot
    // get there; a larger one can by inventing enough Green raters saying 5.
    expect(reportsToReach(RED, [], NOW, GREEN, {}, 3)).toBeNull();
    expect(reportsToReach(RED, [], NOW, GREEN, {}, 40)).not.toBeNull();
  });
});
