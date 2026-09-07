import type { Guild } from 'discord.js';
import { CREDITS, DAY_MS, SCORING, TIER_COUNT, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import {
  computeStanding,
  reportsToReach,
  type CreditInput,
  type StandingContext,
  type VoteInput,
} from './scoring.js';
import {
  collectCredits,
  collectVoteInputs,
  recalculateStanding,
  standingContextFor,
} from './standing-service.js';

/**
 * ============================================================================
 *  MODERATOR ADJUSTMENTS
 * ============================================================================
 *  Everything a KING can do to somebody's standing goes through this module,
 *  and all of it reduces to one action: add some reports' worth of signal, in
 *  one direction or the other, for a while.
 *
 *  There is deliberately no way to set an area, and no way to set a value. A
 *  moderator supplies evidence and the engine decides, exactly as it does for
 *  everyone else. What makes that acceptable rather than toothless is that
 *  moderator evidence is heavy: five reports' worth against a member carrying
 *  six ratings is most of the picture.
 *
 *  The counterpart to that weight is that it stays contestable. Every function
 *  here can tell you, before you commit, how many real reports it would take
 *  to overturn what you are about to do — see `previewAdjustment`. A decision
 *  you cannot price is a decision you are making blind.
 * ============================================================================
 */

export type Direction = 'ease' | 'push';

/** Relief argues the member is fine; pressure argues the opposite. */
function valueFor(direction: Direction): number {
  return direction === 'ease' ? SCORING.MIN_RATING : SCORING.MAX_RATING;
}

export interface AdjustmentPreview {
  direction: Direction;
  reports: number;

  currentScore: number;
  currentTierIndex: number;

  projectedScore: number;
  projectedTierIndex: number;

  /**
   * Fresh maximum-severity reports the community would need in order to undo
   * this and put the member back where they are now. Null when no realistic
   * number of reports would do it, which means a gate other than the score is
   * holding them back.
   *
   * Only meaningful for relief. Pressure is already denominated in reports —
   * pushing somebody down by five is, arithmetically, five people reporting
   * them — so there is nothing further to price.
   */
  reportsToUndo: number | null;

  /**
   * Why pressure did not move them, when it did not.
   *
   * This is the case that looks like a bug and is not. Adjustments move the
   * score and never the gates, so pushing somebody with no raters produces a
   * terrible score and no movement at all: the next area still wants three
   * real people and there are none. Without saying so the picker reports
   * "stays Green at 3.62" and leaves a moderator to conclude the button is
   * broken.
   */
  blockedBy: string | null;
}

interface Basis {
  votes: VoteInput[];
  credits: CreditInput[];
  context: StandingContext;
  currentTierIndex: number;
}

/**
 * Gathers everything the engine needs for one member, once.
 *
 * Pulled out because collecting votes hits Discord for each rater, and the
 * picker prices three sizes at a time. Fetch once, simulate as often as you
 * like — the engine itself is pure and free.
 */
async function basisFor(guild: Guild, targetId: string): Promise<Basis> {
  const record = repo.ensureMember(guild.id, targetId);
  const votes = await collectVoteInputs(guild, targetId);
  const credits = collectCredits(guild.id, targetId);

  // Credits are supplied per simulation below, so they are stripped from the
  // shared context rather than baked in.
  const { credits: _ignored, ...context } = standingContextFor(guild, record, credits);

  return {
    votes,
    credits,
    context,
    currentTierIndex: record.tier_key ? tierIndexByKey(record.tier_key) : 0,
  };
}

function priceOne(basis: Basis, direction: Direction, reports: number, now: number): AdjustmentPreview {
  const { votes, credits, context, currentTierIndex } = basis;

  const proposed: CreditInput = {
    value: valueFor(direction),
    reports,
    grantedAt: now,
    expiresAt: now + CREDITS.LIFETIME_DAYS * DAY_MS,
  };

  const before = computeStanding(votes, now, currentTierIndex, { ...context, credits });
  const after = computeStanding(votes, now, currentTierIndex, {
    ...context,
    credits: [...credits, proposed],
  });

  // Priced from where the grant lands, not from where they are, because
  // hysteresis makes re-entering a tier you have left harder than staying in
  // it — and re-entering is precisely what we are asking about.
  const reportsToUndo =
    direction === 'ease' && after.uncappedTierIndex < currentTierIndex
      ? reportsToReach(currentTierIndex, votes, now, after.uncappedTierIndex, {
          ...context,
          credits: [...credits, proposed],
        })
      : null;

  // Only asked for pressure that failed to land. Relief that does not move
  // somebody is held by the score itself, which the label already shows.
  const stuck = direction === 'push' && after.uncappedTierIndex <= currentTierIndex;
  const nextGate = after.gates[Math.min(after.uncappedTierIndex + 1, TIER_COUNT - 1)];
  const nonScoreGates = (nextGate?.failedGates ?? []).filter((gate) => !gate.startsWith('score'));

  return {
    direction,
    reports,
    currentScore: before.score,
    currentTierIndex: before.uncappedTierIndex,
    projectedScore: after.score,
    projectedTierIndex: after.uncappedTierIndex,
    reportsToUndo,
    blockedBy: stuck && nonScoreGates.length > 0 ? nonScoreGates.join(', ') : null,
  };
}

/** What one specific grant would do. */
export async function previewAdjustment(
  guild: Guild,
  targetId: string,
  direction: Direction,
  reports: number,
): Promise<AdjustmentPreview> {
  return priceOne(await basisFor(guild, targetId), direction, reports, Date.now());
}

/** What each offered size would do, for labelling the picker. */
export async function previewSizes(
  guild: Guild,
  targetId: string,
  sizes: readonly number[] = CREDITS.OFFERED_SIZES,
): Promise<AdjustmentPreview[]> {
  const basis = await basisFor(guild, targetId);
  const now = Date.now();

  return [
    ...sizes.map((n) => priceOne(basis, 'ease', n, now)),
    ...sizes.map((n) => priceOne(basis, 'push', n, now)),
  ];
}

export interface AdjustmentOutcome {
  preview: AdjustmentPreview;
  /** The area they actually ended up in, after the safety rails. */
  appliedTierIndex: number;
  moved: boolean;
}

/**
 * Grants an adjustment and reapplies the member's standing.
 *
 * `notifyUser` stays on: if the area moves, the member gets the same neutral
 * note any move sends. Nothing tells them a moderator was involved, which is
 * the point — a successful review is indistinguishable from the community
 * easing off on its own.
 */
export async function applyAdjustment(
  guild: Guild,
  targetId: string,
  direction: Direction,
  reports: number,
  grantedBy: string,
  reason?: string | null,
): Promise<AdjustmentOutcome> {
  const capped = Math.min(Math.max(reports, 1), CREDITS.MAX_REPORTS_PER_GRANT);
  const preview = await previewAdjustment(guild, targetId, direction, capped);

  repo.grantCredit({
    guildId: guild.id,
    targetId,
    value: valueFor(direction),
    reports: capped,
    grantedBy,
    reason: reason ?? null,
    expiresAt: Date.now() + CREDITS.LIFETIME_DAYS * DAY_MS,
  });

  repo.audit(guild.id, 'adjustment', targetId, `${direction} ${capped}`);

  const result = await recalculateStanding(guild, targetId, { notifyUser: true });

  return {
    preview,
    appliedTierIndex: result?.standing.tierIndex ?? preview.currentTierIndex,
    moved: result?.changed ?? false,
  };
}

/** Takes back every live adjustment on a member. Returns how many were undone. */
export async function clearAdjustments(
  guild: Guild,
  targetId: string,
  byUserId: string,
): Promise<number> {
  const undone = repo.revokeCreditsFor(guild.id, targetId, byUserId);
  if (undone > 0) {
    repo.audit(guild.id, 'adjustment_cleared', targetId, String(undone));
    await recalculateStanding(guild, targetId, { notifyUser: true });
  }
  return undone;
}

/** One line per live adjustment, for the admin channels. */
export function describeLiveAdjustments(guildId: string, targetId: string): string[] {
  return repo.listLiveCredits(guildId, targetId).map((credit) => {
    const direction = credit.value <= SCORING.PRIOR_VALUE ? 'eased' : 'pushed';
    const granted = Math.floor(credit.created_at / 1000);
    const expires = Math.floor(credit.expires_at / 1000);
    return `${direction} by **${credit.reports}** report(s)' worth, granted <t:${granted}:R> by <@${credit.granted_by}>, runs out <t:${expires}:R>`;
  });
}

/** Short label for an area, used all over the admin copy. */
export function areaName(tierIndex: number): string {
  return tierAt(tierIndex).roleName;
}
