import {
  CREDITS,
  DAY_MS,
  DEFAULT_TIER_INDEX,
  SCORING,
  TIERS,
  TIER_COUNT,
  tierAt,
} from '../config.js';
import { stringsIn } from '../i18n/index.js';

/**
 * ============================================================================
 *  THE SCORING ENGINE
 * ============================================================================
 *  This module is deliberately pure: no database, no Discord, no clock of its
 *  own. Give it a list of votes and a timestamp, get a standing back. That is
 *  what makes it unit-testable (see src/core/scoring.test.ts) and what makes it
 *  safe to re-tune the numbers in src/config.ts with confidence.
 *
 *  ---------------------------------------------------------------------------
 *  HOW ONE VOTE BECOMES INFLUENCE
 *  ---------------------------------------------------------------------------
 *  Each vote carries a rating of 1..5 and a weight built from three factors,
 *  multiplied together:
 *
 *    weight = trustFactor x recencyFactor x tenureFactor
 *
 *    trustFactor    Your own standing. Green voters carry full weight; the
 *                   worse your standing the quieter your voice, so a group of
 *                   Red players cannot gang up on a Green one.
 *                   -> TIERS[].voteWeight
 *
 *    recencyFactor  A vote is loudest the day it is cast and fades linearly to
 *                   RECENCY_FLOOR_WEIGHT by the time it expires. Beyond
 *                   VOTE_LIFETIME_DAYS it is simply not counted, and the voter
 *                   is free to cast a fresh one.
 *                   -> SCORING.RECENCY_DECAY_ENABLED / RECENCY_FLOOR_WEIGHT
 *
 *    tenureFactor   Brand new members ramp up from
 *                   NEW_MEMBER_WEIGHT_MULTIPLIER to full weight over
 *                   FULL_WEIGHT_TENURE_DAYS. Throwaway alts are near-useless
 *                   for brigading. The ramp is capped at the age of the server
 *                   itself, so a young server does not dampen its own founding
 *                   members into silence.
 *                   -> SCORING.NEW_MEMBER_WEIGHT_MULTIPLIER
 *
 *  ---------------------------------------------------------------------------
 *  HOW WEIGHTS BECOME A SCORE
 *  ---------------------------------------------------------------------------
 *      score = ( SUM(weight_i * rating_i) + PRIOR_STRENGTH * PRIOR_VALUE )
 *              / ( SUM(weight_i)          + PRIOR_STRENGTH )
 *
 *  That trailing prior is the important part. It behaves like a handful of
 *  invisible "this player is fine" votes that everyone starts with, so:
 *
 *    - one person with a grudge barely moves the number,
 *    - two people barely move it either,
 *    - but a consistent crowd overwhelms the prior and the score climbs.
 *
 *  This is the same trick IMDb uses for films with few ratings, and it is much
 *  better behaved than a hard "ignore players with < N votes" cutoff, which
 *  produces a cliff you can jump off with a single extra vote.
 *
 *  ---------------------------------------------------------------------------
 *  ADJUSTMENTS: WHERE A MODERATOR FITS IN
 *  ---------------------------------------------------------------------------
 *  A KING reviewing a request grants an adjustment measured in reports. One
 *  report's worth is one synthetic vote at value 1 (relief) or value 5
 *  (pressure), and it joins the sum above like any other vote.
 *
 *  Notice what that makes a pardon: PRIOR_VALUE is 1, so relief is literally
 *  extra prior — a few more of the invisible "this player is fine" votes
 *  everyone already starts with. The mechanism is not bolted on beside the
 *  scoring; it is the scoring, handed a dial.
 *
 *  THE ONE RULE THAT MATTERS: adjustments move the score and nothing else.
 *  Every gate below — headcount, summed trust, consensus — is computed from
 *  real votes alone, and `raterCount` never counts a synthetic vote as a
 *  person. Let them leak into the gates and relief starts *helping* somebody
 *  into Red by padding their rater count, which is the exact opposite of the
 *  intent. One lever, one effect.
 *
 *  ---------------------------------------------------------------------------
 *  HOW A SCORE BECOMES A TIER  (the asymmetric part)
 *  ---------------------------------------------------------------------------
 *  Being wrongly placed in Red is far more damaging than being wrongly left in
 *  Green, so climbing the ladder has to clear FOUR independent gates while
 *  descending it clears none:
 *
 *    1. SCORE      score >= TIERS[t].enterAtScore
 *    2. HEADCOUNT  at least TIERS[t].minRaters distinct valid voters
 *    3. TRUST      their summed weight >= TIERS[t].minEffectiveWeight
 *    4. CONSENSUS  the share of weight from votes >= STRONG_VOTE_THRESHOLD is
 *                  at least TIERS[t].minStrongVoteShare
 *
 *  Gate 4 is what stops a polarised group from producing a Red: if half the
 *  lobby says 5 and half says 1, the average may look bad but there is no
 *  agreement, so the placement is refused.
 *
 *  Two more rails:
 *
 *    HYSTERESIS  Once you are in a tier you stay until the score drops
 *                TIER_EXIT_MARGIN below the entry threshold. Nobody's roles
 *                flicker on and off around a boundary.
 *
 *    JUMP LIMIT  A player moves at most MAX_TIER_JUMP_PER_UPDATE steps worse
 *                per MIN_HOURS_BETWEEN_DEMOTIONS, so they get time to read the
 *                DM and open a re-review before sliding further. A deferred
 *                step is reported back in `deferredTierIndex` and applied by
 *                the sweeper once the cooldown lapses. Improvement is never
 *                throttled: if the votes say you are fine, you are fine today.
 * ============================================================================
 */

export interface RaterContext {
  /** Rater's own tier index, or null if they have no standing yet. */
  tierIndex: number | null;
  /** False when the rater opted out of the standing system. */
  participating: boolean;
  /** How long the rater has been in this server, in milliseconds. */
  tenureMs: number;
}

export interface VoteInput extends RaterContext {
  raterId: string;
  /** 1..5 */
  value: number;
  /** When the vote was cast or last reaffirmed (epoch ms). */
  castAt: number;
}

export interface WeightedVote {
  raterId: string;
  value: number;
  weight: number;
  ageDays: number;
  factors: { trust: number; recency: number; tenure: number };
}

/**
 * A moderator's adjustment, expressed in the only unit anyone has intuition
 * for: how many reports it is worth.
 */
export interface CreditInput {
  /** What each unit says. SCORING.MIN_RATING for relief, MAX_RATING for pressure. */
  value: number;
  /** Reports' worth. One unit weighs the same as one full-strength rater. */
  reports: number;
  /** When it was granted, for the fade. */
  grantedAt: number;
  /** When it stops counting entirely. */
  expiresAt: number;
}

export interface WeightedCredit {
  value: number;
  weight: number;
}

export interface GateResult {
  tierKey: string;
  tierIndex: number;
  passed: boolean;
  failedGates: string[];
}

export interface Standing {
  /** The weighted, prior-shrunk score. Always between MIN_RATING and MAX_RATING. */
  score: number;
  tierIndex: number;
  tierKey: string;
  /** Distinct voters whose vote actually carried weight. */
  raterCount: number;
  /** Summed weight of those voters. */
  effectiveWeight: number;
  /** Share of weight coming from votes >= STRONG_VOTE_THRESHOLD. */
  strongVoteShare: number;
  /** Tier the raw numbers pointed at, before the jump limiter. */
  uncappedTierIndex: number;
  /**
   * A step down that the numbers justify but the demotion cooldown is holding
   * back, or null when the applied tier is already the earned one. The sweeper
   * uses this to finish the move later without needing a new vote.
   */
  deferredTierIndex: number | null;
  /** Per-tier gate outcomes, handy for debugging and for the KING report. */
  gates: GateResult[];
  /**
   * Signed weight contributed by live moderator adjustments: negative for
   * relief, positive for pressure, zero when there are none. Reported so the
   * admin views can say how much of a score is not the community's doing.
   */
  creditWeight: number;
  /** The votes that counted, with their computed weights. */
  countedVotes: WeightedVote[];
  /** Votes that were ignored, and why. */
  ignoredVotes: Array<{ raterId: string; reason: string }>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Trust component: how much this rater's own standing lets them influence others. */
export function trustFactor(rater: RaterContext): number {
  if (!rater.participating) return SCORING.OPTED_OUT_VOTE_WEIGHT;
  const index = rater.tierIndex ?? DEFAULT_TIER_INDEX;
  return tierAt(index).voteWeight;
}

/** Recency component: 1.0 when fresh, decaying to RECENCY_FLOOR_WEIGHT at expiry. */
export function recencyFactor(
  ageDays: number,
  lifetimeDays: number = SCORING.VOTE_LIFETIME_DAYS,
): number {
  if (!SCORING.RECENCY_DECAY_ENABLED) return 1;
  if (lifetimeDays <= 0) return 0;
  if (ageDays <= 0) return 1;
  if (ageDays >= lifetimeDays) return 0; // expired; caller filters these out anyway
  const progress = ageDays / lifetimeDays;
  return 1 - progress * (1 - SCORING.RECENCY_FLOOR_WEIGHT);
}

/**
 * Tenure component: ramps a new member's influence up over their first weeks.
 *
 * The ramp is shortened to the age of the community, because "new" only means
 * anything relative to everyone else. In a server that is three days old,
 * three days of membership is full tenure. In a two-year-old server, a member
 * who joined yesterday votes at NEW_MEMBER_WEIGHT_MULTIPLIER — which is the
 * case the measure actually exists for.
 */
export function tenureFactor(
  tenureMs: number,
  communityAgeMs: number = Number.POSITIVE_INFINITY,
): number {
  const communityAgeDays = Math.max(communityAgeMs, 0) / DAY_MS;
  const rampDays = Math.min(SCORING.FULL_WEIGHT_TENURE_DAYS, communityAgeDays);
  if (rampDays <= 0) return 1;

  const tenureDays = Math.max(tenureMs, 0) / DAY_MS;
  if (tenureDays >= rampDays) return 1;

  const start = SCORING.NEW_MEMBER_WEIGHT_MULTIPLIER;
  return start + (1 - start) * (tenureDays / rampDays);
}

/**
 * Turns raw votes into weighted votes, discarding anything that cannot count.
 */
export function weighVotes(
  votes: VoteInput[],
  now: number,
  communityAgeMs: number = Number.POSITIVE_INFINITY,
): { counted: WeightedVote[]; ignored: Array<{ raterId: string; reason: string }> } {
  const counted: WeightedVote[] = [];
  const ignored: Array<{ raterId: string; reason: string }> = [];

  for (const vote of votes) {
    const ageDays = (now - vote.castAt) / DAY_MS;

    if (ageDays >= SCORING.VOTE_LIFETIME_DAYS) {
      ignored.push({ raterId: vote.raterId, reason: 'expired' });
      continue;
    }

    const trust = trustFactor(vote);
    const recency = recencyFactor(ageDays);
    const tenure = tenureFactor(vote.tenureMs, communityAgeMs);
    const weight = trust * recency * tenure;

    if (weight <= 0) {
      ignored.push({ raterId: vote.raterId, reason: vote.participating ? 'zero weight' : 'rater opted out' });
      continue;
    }

    counted.push({
      raterId: vote.raterId,
      value: clamp(vote.value, SCORING.MIN_RATING, SCORING.MAX_RATING),
      weight,
      ageDays,
      factors: { trust, recency, tenure },
    });
  }

  return { counted, ignored };
}

/**
 * Turns adjustments into weighted entries, dropping anything spent.
 *
 * A grant fades over its own lifetime rather than the vote lifetime, so
 * changing CREDITS.LIFETIME_DAYS does what it says without dragging the vote
 * decay curve along with it.
 */
export function weighCredits(credits: CreditInput[], now: number): WeightedCredit[] {
  const weighted: WeightedCredit[] = [];

  for (const credit of credits) {
    if (now >= credit.expiresAt) continue;

    const lifetimeDays = (credit.expiresAt - credit.grantedAt) / DAY_MS;
    const ageDays = (now - credit.grantedAt) / DAY_MS;
    const fade = CREDITS.DECAY_ENABLED ? recencyFactor(ageDays, lifetimeDays) : 1;
    const weight = credit.reports * fade;

    if (weight <= 0) continue;

    weighted.push({ value: clamp(credit.value, SCORING.MIN_RATING, SCORING.MAX_RATING), weight });
  }

  return weighted;
}

/**
 * The prior-shrunk weighted mean. With no votes at all this returns exactly
 * PRIOR_VALUE, i.e. everyone starts perfectly Green.
 *
 * Adjustments enter here and only here. They are arithmetically
 * indistinguishable from votes at this point, which is the whole design: a
 * moderator gets to add signal, not to replace the calculation.
 */
export function shrunkScore(counted: WeightedVote[], credits: WeightedCredit[] = []): number {
  const entries = [...counted, ...credits];

  const weightedSum = entries.reduce((sum, v) => sum + v.weight * v.value, 0);
  const totalWeight = entries.reduce((sum, v) => sum + v.weight, 0);

  const numerator = weightedSum + SCORING.PRIOR_STRENGTH * SCORING.PRIOR_VALUE;
  const denominator = totalWeight + SCORING.PRIOR_STRENGTH;

  return numerator / denominator;
}

/**
 * Evaluates every tier's gates and returns the highest one the player has
 * genuinely earned. `currentTierIndex` only affects the score gate, via
 * hysteresis on tiers the player already occupies.
 */
export function resolveTier(
  score: number,
  stats: { raterCount: number; effectiveWeight: number; strongVoteShare: number },
  currentTierIndex: number | null,
): { tierIndex: number; gates: GateResult[] } {
  const current = currentTierIndex ?? DEFAULT_TIER_INDEX;
  const gates: GateResult[] = [];

  for (let index = 0; index < TIER_COUNT; index++) {
    const tier = tierAt(index);
    const failedGates: string[] = [];

    if (index > DEFAULT_TIER_INDEX) {
      // Hysteresis: staying in a tier you already hold is easier than entering it.
      const alreadyHeld = index <= current;
      const threshold = alreadyHeld ? tier.enterAtScore - SCORING.TIER_EXIT_MARGIN : tier.enterAtScore;

      if (score < threshold) failedGates.push(`score ${score.toFixed(2)} < ${threshold.toFixed(2)}`);
      if (stats.raterCount < tier.minRaters) {
        failedGates.push(`raters ${stats.raterCount} < ${tier.minRaters}`);
      }
      if (stats.effectiveWeight < tier.minEffectiveWeight) {
        failedGates.push(`trust ${stats.effectiveWeight.toFixed(2)} < ${tier.minEffectiveWeight}`);
      }
      if (stats.strongVoteShare < tier.minStrongVoteShare) {
        failedGates.push(
          `consensus ${(stats.strongVoteShare * 100).toFixed(0)}% < ${tier.minStrongVoteShare * 100}%`,
        );
      }
    }

    gates.push({ tierKey: tier.key, tierIndex: index, passed: failedGates.length === 0, failedGates });
  }

  // Highest tier that cleared every gate. Tier 0 always clears, so this is
  // guaranteed to find something.
  let resolved = DEFAULT_TIER_INDEX;
  for (const gate of gates) {
    if (gate.passed) resolved = gate.tierIndex;
  }

  return { tierIndex: resolved, gates };
}

/** Per-guild and per-member facts the engine needs but cannot derive itself. */
export interface StandingContext {
  /** Age of the server, used to scale the newcomer ramp. */
  communityAgeMs?: number;
  /** When this player last moved to a worse tier, for the demotion cooldown. */
  lastDemotionAt?: number | null;
  /** Live moderator adjustments. They move the score and never the gates. */
  credits?: CreditInput[];
}

/**
 * Full pipeline: votes in, standing out.
 *
 * @param votes             every stored rating for the player, expired or not
 * @param now               evaluation timestamp (injected so tests are stable)
 * @param currentTierIndex  the player's tier right now, for hysteresis and the
 *                          jump limiter. null for a player with no standing.
 * @param context           guild age and last demotion time; both optional, and
 *                          omitting them just disables the features they drive.
 */
export function computeStanding(
  votes: VoteInput[],
  now: number = Date.now(),
  currentTierIndex: number | null = null,
  context: StandingContext = {},
): Standing {
  const { counted, ignored } = weighVotes(votes, now, context.communityAgeMs);
  const credits = weighCredits(context.credits ?? [], now);

  // Note what is and is not in scope here. Every statistic below comes from
  // `counted` alone, so the gates keep measuring real people no matter what a
  // moderator has granted. Only the score, two lines down, sees the credits.
  const effectiveWeight = counted.reduce((sum, v) => sum + v.weight, 0);
  const strongWeight = counted
    .filter((v) => v.value >= SCORING.STRONG_VOTE_THRESHOLD)
    .reduce((sum, v) => sum + v.weight, 0);

  // Weighted rather than headcount share, so the consensus gate cannot be
  // satisfied by a pile of low-trust accounts all shouting "5".
  const strongVoteShare = effectiveWeight > 0 ? strongWeight / effectiveWeight : 0;

  const score = shrunkScore(counted, credits);
  const stats = { raterCount: counted.length, effectiveWeight, strongVoteShare };
  const { tierIndex: uncappedTierIndex, gates } = resolveTier(score, stats, currentTierIndex);

  // Jump limiter: only throttles movement toward the worse end of the ladder.
  const current = currentTierIndex ?? DEFAULT_TIER_INDEX;
  const tierIndex = limitDemotion(uncappedTierIndex, current, now, context.lastDemotionAt ?? null);

  return {
    score,
    tierIndex,
    tierKey: tierAt(tierIndex).key,
    raterCount: stats.raterCount,
    effectiveWeight,
    strongVoteShare,
    uncappedTierIndex,
    deferredTierIndex: tierIndex === uncappedTierIndex ? null : uncappedTierIndex,
    gates,
    creditWeight: credits.reduce(
      (sum, c) => sum + (c.value >= SCORING.PRIOR_VALUE + 1 ? c.weight : -c.weight),
      0,
    ),
    countedVotes: counted,
    ignoredVotes: ignored,
  };
}

/**
 * Applies both demotion rails. Improvement passes straight through, so a
 * player whose ratings expire or improve is never held back.
 */
function limitDemotion(
  earned: number,
  current: number,
  now: number,
  lastDemotionAt: number | null,
): number {
  if (earned <= current) return earned;

  const cooldownMs = SCORING.MIN_HOURS_BETWEEN_DEMOTIONS * 60 * 60 * 1000;
  if (lastDemotionAt !== null && now - lastDemotionAt < cooldownMs) return current;

  return Math.min(earned, current + SCORING.MAX_TIER_JUMP_PER_UPDATE);
}

/**
 * How many fresh maximum-severity reports it would take to push somebody into
 * `targetTierIndex`, given the votes and adjustments they already carry.
 *
 * This is the number that makes an adjustment an honest choice rather than a
 * guess. A moderator granting relief is implicitly deciding how much evidence
 * it should take to overturn them, so the picker computes it and prints it
 * instead of leaving them to reason about a Bayesian mean in their head.
 *
 * It is a simulation, not a formula, and that is deliberate: it runs the real
 * engine, so it accounts for the prior, the gates, the consensus requirement
 * and the slack the member already has. A closed form would drift out of step
 * with the tuning values the first time anyone touched them.
 *
 * Returns null when the tier is out of reach within `maxProbe` reports, which
 * usually means a gate other than the score is the binding constraint.
 */
export function reportsToReach(
  targetTierIndex: number,
  votes: VoteInput[],
  now: number,
  currentTierIndex: number | null,
  context: StandingContext = {},
  maxProbe = 40,
): number | null {
  const probeContext = { ...context, lastDemotionAt: null };

  for (let n = 0; n <= maxProbe; n++) {
    const probes: VoteInput[] = Array.from({ length: n }, (_, i) => ({
      raterId: `__probe_${i}`,
      value: SCORING.MAX_RATING,
      castAt: now,
      tierIndex: DEFAULT_TIER_INDEX,
      participating: true,
      tenureMs: Number.MAX_SAFE_INTEGER,
    }));

    const { uncappedTierIndex } = computeStanding(
      [...votes, ...probes],
      now,
      currentTierIndex,
      probeContext,
    );

    if (uncappedTierIndex >= targetTierIndex) return n;
  }

  return null;
}

/**
 * Human-readable explanation of a standing, for the private `/my-standing`
 * view and the KING's challenge report. Never names individual voters.
 */
export function explainStanding(standing: Standing, guildId?: string): string {
  const t = stringsIn(guildId ?? '');

  const tier = tierAt(standing.tierIndex);
  const lines = [
    t.standing.explainTier({ area: tier.roleName }),
    t.standing.explainScore({ score: standing.score.toFixed(2), max: SCORING.MAX_RATING }),
    // Reported as a fact about the ratings, not as the derivation of the score
    // above it. A score can include a moderator adjustment, and "based on 0
    // ratings: 3.62" reads as a bug to the member looking at it. This wording
    // stays true either way without telling them a moderator was involved,
    // which the review design deliberately keeps quiet.
    t.standing.explainRaters({ count: standing.raterCount, trust: standing.effectiveWeight.toFixed(2) }),
  ];

  const nextTier = TIERS[standing.tierIndex + 1];
  if (nextTier) {
    const nextGate = standing.gates[standing.tierIndex + 1];
    if (nextGate && !nextGate.passed) {
      lines.push(t.standing.explainDistance({ area: nextTier.roleName, gates: nextGate.failedGates.join('; ') }));
    }
  }

  if (standing.ignoredVotes.length > 0) {
    const expired = standing.ignoredVotes.filter((v) => v.reason === 'expired').length;
    if (expired > 0) lines.push(t.standing.explainExpired({ count: expired }));
  }

  return lines.join('\n');
}
