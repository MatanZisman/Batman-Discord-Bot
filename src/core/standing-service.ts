import { type Guild, type GuildMember } from 'discord.js';
import { DEFAULT_TIER_INDEX, SCORING, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { logAction } from './action-log.js';
import {
  computeStanding,
  type CreditInput,
  type Standing,
  type StandingContext,
  type VoteInput,
} from './scoring.js';

/**
 * Glue between the pure scoring engine and Discord. This module owns the
 * "recalculate someone's standing and make the server reflect it" workflow.
 */

/** Fetches a member, returning null when they have left the server. */
async function tryFetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

/**
 * Builds scoring inputs from stored votes, enriching each with the rater's
 * current standing and server tenure.
 */
export async function collectVoteInputs(guild: Guild, targetId: string): Promise<VoteInput[]> {
  const votes = repo.getVotesForTarget(guild.id, targetId, 'active');
  const inputs: VoteInput[] = [];

  for (const vote of votes) {
    const raterMember = await tryFetchMember(guild, vote.rater_id);

    if (!raterMember && SCORING.IGNORE_VOTES_FROM_DEPARTED_MEMBERS) continue;

    const raterRecord = repo.getMember(guild.id, vote.rater_id);
    const tierIndex = raterRecord?.tier_key ? tierIndexByKey(raterRecord.tier_key) : DEFAULT_TIER_INDEX;

    inputs.push({
      raterId: vote.rater_id,
      value: vote.value,
      castAt: vote.updated_at,
      tierIndex,
      participating: raterRecord ? raterRecord.participating === 1 : true,
      tenureMs: raterMember?.joinedTimestamp ? Date.now() - raterMember.joinedTimestamp : 0,
    });
  }

  return inputs;
}

/** Live moderator adjustments, in the shape the scoring engine wants. */
export function collectCredits(guildId: string, targetId: string): CreditInput[] {
  return repo.listLiveCredits(guildId, targetId).map((credit) => ({
    value: credit.value,
    reports: credit.reports,
    grantedAt: credit.created_at,
    expiresAt: credit.expires_at,
  }));
}

export interface RecalculationResult {
  standing: Standing;
  previousTierIndex: number | null;
  changed: boolean;
  /** True when a moderator adjustment is part of the score behind this result. */
  adjusted: boolean;
}

/**
 * Everything the engine needs about one member, assembled in one place.
 *
 * This exists because the alternative already went wrong. Every caller used
 * to build its own context inline, and `/my-standing` quietly omitted the
 * adjustments — so a member the server had at 3.62 was shown 1.00 to their
 * face, which is worse than showing nothing. The context is not optional
 * decoration; leaving a field out changes the answer.
 *
 * Any code path that computes a standing goes through here.
 */
export function standingContextFor(
  guild: Guild,
  record: repo.MemberRecord,
  credits: CreditInput[],
): StandingContext {
  return {
    // The newcomer ramp is relative to the community's own age, so a young
    // server does not silence everybody in it.
    communityAgeMs: Date.now() - guild.createdTimestamp,
    lastDemotionAt: record.last_demotion_at,
    credits,
  };
}

/**
 * Computes a member's standing without persisting anything or touching roles.
 *
 * The read-only half of `recalculateStanding`, for views that need to show a
 * standing rather than apply one.
 */
export async function evaluateStanding(
  guild: Guild,
  userId: string,
  record: repo.MemberRecord,
): Promise<{ standing: Standing; credits: CreditInput[]; previousTierIndex: number | null }> {
  const previousTierIndex = record.tier_key ? tierIndexByKey(record.tier_key) : null;
  const votes = await collectVoteInputs(guild, userId);
  const credits = collectCredits(guild.id, userId);

  return {
    standing: computeStanding(
      votes,
      Date.now(),
      previousTierIndex,
      standingContextFor(guild, record, credits),
    ),
    credits,
    previousTierIndex,
  };
}

/**
 * Recomputes a player's standing, persists it, and reconciles their Discord
 * roles. Opted-out players are skipped entirely: they hold no tier and see
 * only the white channels.
 */
export async function recalculateStanding(
  guild: Guild,
  userId: string,
  options: { notifyUser?: boolean } = {},
): Promise<RecalculationResult | null> {
  const member = await tryFetchMember(guild, userId);
  const record = repo.ensureMember(guild.id, userId, member?.joinedTimestamp ?? Date.now());

  if (record.participating === 0) {
    if (member) await applyTierRoles(guild, member, null);
    return null;
  }

  // One path, always. A moderator's adjustment is an argument inside this
  // call, not a branch around it, so there is no such thing as a standing the
  // engine did not produce and no second placement rule to keep in step.
  const { standing, credits, previousTierIndex } = await evaluateStanding(guild, userId, record);

  const tierKey = tierAt(standing.tierIndex).key;
  const isDemotion = previousTierIndex !== null && standing.tierIndex > previousTierIndex;
  repo.saveStanding(guild.id, userId, tierKey, standing.score, standing.raterCount, isDemotion);

  if (member) await applyTierRoles(guild, member, standing.tierIndex);

  const changed = previousTierIndex !== standing.tierIndex;
  if (changed) {
    repo.audit(
      guild.id,
      'tier_change',
      userId,
      `${previousTierIndex === null ? 'none' : tierAt(previousTierIndex).key} -> ${tierKey}${
        credits.length > 0 ? ' (adjusted)' : ''
      }`,
    );

    logAction(guild, {
      kind: 'tier_change',
      subjectId: userId,
      fromTierKey: previousTierIndex === null ? null : tierAt(previousTierIndex).key,
      toTierKey: tierKey,
    });

    // Tier changes are never announced publicly. The only person told is the
    // player themselves, by DM — and only when something they knew has
    // actually changed.
    const initialising = isInitialisation(previousTierIndex, standing.tierIndex);
    if (options.notifyUser !== false && member && !initialising) {
      await notifyTierChange(member, standing.tierIndex, previousTierIndex, standing.tierIndex > 0);
    }
  }

  return { standing, previousTierIndex, changed, adjusted: credits.length > 0 };
}

/**
 * True when this is the first time anybody evaluated this member and the
 * answer was "the default area" — i.e. nothing happened.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS NOT JUST `changed`
 * ---------------------------------------------------------------------------
 *  A stored tier of null is indistinguishable from a change under a plain
 *  comparison, because `null !== 0`. So every member who had never been
 *  evaluated generated a "your community standing is now Green" DM the first
 *  time anything touched them — telling somebody their standing is the same
 *  thing it has been since the day they arrived.
 *
 *  Three routes hit that, and the third is the one that actually spammed
 *  people: a rating landing on a member the setup backfill missed; a member
 *  who joined while the bot was offline; and the periodic resweep, whose
 *  query treats a null tier as "not the default area" (`NULL IS NOT 'green'`
 *  is true in SQLite) and so pulls in exactly the un-evaluated members, with
 *  notifications left on.
 *
 *  An initialisation is not news. It is the first time anyone looked.
 *
 *  NOTE the deliberate narrowness: only a landing in the *default* area is
 *  suppressed. A first evaluation that puts somebody straight into a
 *  restricted area does still tell them, because they are about to lose sight
 *  of channels and silence would be worse than a message.
 * ---------------------------------------------------------------------------
 */
export function isInitialisation(previousTierIndex: number | null, tierIndex: number): boolean {
  return previousTierIndex === null && tierIndex === DEFAULT_TIER_INDEX;
}

/**
 * Ensures the member holds exactly one tier role (or none, when opted out).
 * Channel visibility itself is driven by category permission overwrites set up
 * by /setup, so this single role swap moves the player between areas.
 */
export async function applyTierRoles(
  guild: Guild,
  member: GuildMember,
  tierIndex: number | null,
): Promise<void> {
  const tierRoles = repo.getTierRoles(guild.id);
  if (tierRoles.length === 0) return;

  const targetKey = tierIndex === null ? null : tierAt(tierIndex).key;
  const wanted = targetKey ? tierRoles.find((r) => r.tier_key === targetKey)?.role_id : undefined;
  const unwanted = tierRoles.filter((r) => r.role_id !== wanted).map((r) => r.role_id);

  const toRemove = unwanted.filter((id) => member.roles.cache.has(id));
  const shouldAdd = wanted && !member.roles.cache.has(wanted);

  try {
    if (toRemove.length > 0) await member.roles.remove(toRemove, 'Community standing update');
    if (shouldAdd && wanted) await member.roles.add(wanted, 'Community standing update');
  } catch (error) {
    logger.warn(`Could not update roles for ${member.id} in ${guild.id}`, error);
  }
}

async function notifyTierChange(
  member: GuildMember,
  tierIndex: number,
  previousTierIndex: number | null,
  canChallenge: boolean,
): Promise<void> {
  const now = tierAt(tierIndex);
  const before = previousTierIndex === null ? null : tierAt(previousTierIndex);
  const improved = previousTierIndex !== null && tierIndex < previousTierIndex;

  const headline = improved
    ? `Your community standing moved up to **${now.roleName}**.`
    : `Your community standing is now **${now.roleName}**.`;

  const body = [
    headline,
    before ? `Previously: ${before.roleName}` : null,
    '',
    'This is private. Nobody is notified, no list of who rated you exists anywhere you or anyone else can read, and ratings expire on their own over time.',
    // Says "the moderators", not "your raters": a review request goes to the
    // KING role and contacts nobody else. The earlier design did DM every past
    // rater, and this line outlived it — promising a member something the bot
    // no longer does, two lines under a privacy guarantee.
    canChallenge
      ? 'If you think this is wrong, run `/challenge` in the server to ask the moderators to take another look. Nobody who rated you is contacted, and nobody is told you asked.'
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    await member.send(body);
  } catch {
    logger.debug(`Could not DM ${member.id} about their standing change (DMs likely closed).`);
  }
}

/**
 * Walks every human member of the server and brings their standing and roles
 * in line with the current tuning values.
 *
 * This also serves as the backfill after /setup: members who have never
 * interacted with the bot get their member row and their starting tier role
 * here, which is what makes the channel cascade take effect immediately rather
 * than trickling in as people happen to use a command.
 */
export async function recalculateGuild(guild: Guild): Promise<number> {
  const members = await guild.members.fetch();
  let processed = 0;

  for (const member of members.values()) {
    if (member.user.bot) continue;
    repo.ensureMember(guild.id, member.id, member.joinedTimestamp ?? Date.now());
    await recalculateStanding(guild, member.id, { notifyUser: false });
    processed += 1;
  }

  return processed;
}

/**
 * Cheaper cousin of recalculateGuild for the periodic sweep: only touches
 * members who could plausibly move, i.e. anyone carrying ratings or anyone not
 * already in the default tier. No full member fetch from Discord.
 *
 * This is what makes two otherwise-stale situations resolve on their own:
 *   - a demotion that the cooldown deferred, which would otherwise sit until
 *     somebody happened to vote again (days, on a quiet server),
 *   - the knock-on effect of a rater's own standing changing, which alters the
 *     weight their votes carry on everyone they have rated.
 */
export async function resweepGuild(guild: Guild): Promise<number> {
  const members = repo.listMembersToResweep(guild.id, tierAt(DEFAULT_TIER_INDEX).key);

  for (const member of members) {
    await recalculateStanding(guild, member.user_id).catch((error) =>
      logger.warn(`Resweep failed for ${member.user_id}`, error),
    );
  }

  return members.length;
}
