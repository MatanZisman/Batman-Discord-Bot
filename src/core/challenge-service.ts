import { type Client, type Guild, type GuildMember, type TextChannel } from 'discord.js';
import { DAY_MS, HOUR_MS, LIMITS, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { stringsIn } from '../i18n/index.js';
import { logger } from '../lib/logger.js';
import { buildKingRequest } from '../ui/challenge.js';
import { logAction } from './action-log.js';
import {
  applyAdjustment,
  clearAdjustments,
  describeLiveAdjustments,
  previewSizes,
  type AdjustmentOutcome,
  type Direction,
} from './adjustments.js';
import { recalculateStanding } from './standing-service.js';

/**
 * ============================================================================
 *  ASKING FOR A REVIEW
 * ============================================================================
 *  A rated player may ask, at most once every CHALLENGE_COOLDOWN_DAYS, for the
 *  KING role to take another look at their value.
 *
 *  It is one step. The request is posted to the KING channel and pings the
 *  role; a KING either sets the player's toxicity value by hand or dismisses
 *  it. Nothing is asked of anybody else.
 *
 *  WHY NO RATERS ARE CONTACTED
 *  The previous design DMed every past rater asking them to look again, and
 *  dropped the rating of anyone who did not reply. Three things were wrong
 *  with that. It turned one person's request into unsolicited DMs for a dozen
 *  others, which is the kind of thing that gets a bot blocked and members
 *  irritated. It made silence load-bearing: a rater on holiday had their
 *  honest rating deleted, so the reliable way to win a review was to be rated
 *  by inattentive people. And it leaked timing — a DM arriving told you
 *  someone you had rated was unhappy, which is a step towards working out who.
 *
 *  WHAT THE PLAYER IS PROMISED
 *  Nothing. They are told the request was sent and that any change will show
 *  up within a day. No reply, no outcome message, no reasons. An ignored
 *  request lapsing is a legitimate outcome, and promising a verdict would
 *  create an obligation on volunteers that nobody agreed to.
 * ============================================================================
 */

export type OpenChallengeOutcome = { ok: true; message: string } | { ok: false; message: string };

export async function openChallenge(guild: Guild, member: GuildMember): Promise<OpenChallengeOutcome> {
  const record = repo.ensureMember(guild.id, member.id, member.joinedTimestamp ?? Date.now());

  const t = stringsIn(guild.id);

  if (record.participating === 0) {
    return { ok: false, message: t.review.notParticipating };
  }

  const tierIndex = record.tier_key ? tierIndexByKey(record.tier_key) : 0;
  if (tierIndex === 0) {
    return {
      ok: false,
      message: `You are already in **${tierAt(0).roleName}**, the best standing there is. Nothing to review.`,
    };
  }

  const previous = repo.getLatestChallenge(guild.id, member.id);

  if (previous && previous.state !== 'closed') {
    return { ok: false, message: t.review.alreadyOpen };
  }

  if (previous) {
    const cooldownMs = LIMITS.CHALLENGE_COOLDOWN_DAYS * DAY_MS;
    const elapsed = Date.now() - previous.opened_at;
    if (elapsed < cooldownMs) {
      const daysLeft = Math.ceil((cooldownMs - elapsed) / DAY_MS);
      return { ok: false, message: t.review.cooldown({ daysLeft }) };
    }
  }

  const activeVotes = repo.getVotesForTarget(guild.id, member.id, 'active');
  if (activeVotes.length === 0) {
    return {
      ok: false,
      message: 'You have no current ratings to review. Your standing will settle on its own shortly.',
    };
  }

  // Kept as a record of what was disputed, so a KING reading the request later
  // can see the state it was made in.
  const snapshot: repo.ChallengeSnapshot = {
    tier_key: record.tier_key,
    score: record.score,
    rater_count: record.rater_count,
    votes: [],
  };

  const challengeId = repo.createChallenge({
    guildId: guild.id,
    targetId: member.id,
    responseDeadline: Date.now() + LIMITS.CHALLENGE_REQUEST_WINDOW_HOURS * HOUR_MS,
    snapshot,
  });

  await postKingRequest(guild, challengeId);
  repo.audit(guild.id, 'challenge_opened', member.id);
  logAction(guild, { kind: 'challenge_opened', actorId: member.id, invited: 0 });

  return { ok: true, message: t.review.requestSent };
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

export type KingDecision =
  | { type: 'adjust'; direction: Direction; reports: number }
  | { type: 'clear' }
  | { type: 'dismiss' }
  | { type: 'lapsed' };

/**
 * Applies a KING's decision and closes the request.
 *
 * Deliberately sends the player nothing beyond what any member gets. If the
 * adjustment moved their area, the ordinary tier-change notice fires on its
 * own — the same neutral message the community produces, with no hint that it
 * followed a request. That is the whole point: a review that succeeds is
 * indistinguishable from people easing off.
 */
export async function resolveChallenge(
  client: Client,
  challenge: repo.ChallengeRecord,
  decision: KingDecision,
  kingUserId?: string,
): Promise<void> {
  const guild = await client.guilds.fetch(challenge.guild_id).catch(() => null);
  if (!guild) return;

  let outcome: AdjustmentOutcome | null = null;

  if (decision.type === 'adjust' && kingUserId) {
    outcome = await applyAdjustment(
      guild,
      challenge.target_id,
      decision.direction,
      decision.reports,
      kingUserId,
      'review request',
    ).catch((error) => {
      logger.error(`Applying a review adjustment failed for ${challenge.target_id}`, error);
      return null;
    });
  }

  if (decision.type === 'clear' && kingUserId) {
    await clearAdjustments(guild, challenge.target_id, kingUserId).catch(() => 0);
  }

  repo.updateChallenge(challenge.id, {
    state: 'closed',
    closed_at: Date.now(),
    king_action:
      decision.type === 'adjust' ? `${decision.direction}:${decision.reports}` : decision.type,
    king_user_id: kingUserId ?? null,
  });

  // Nothing changed the member's inputs on a dismissal or a lapse, but their
  // votes may have aged in the meantime, so this runs either way.
  if (!outcome) {
    await recalculateStanding(guild, challenge.target_id).catch((error) =>
      logger.error(`Recalculation after a review failed for ${challenge.target_id}`, error),
    );
  }

  repo.audit(
    challenge.guild_id,
    'challenge_closed',
    challenge.target_id,
    `${decision.type}${kingUserId ? ' by king' : ' automatically'}`,
  );

  if (kingUserId) {
    logAction(guild, {
      kind: 'admin',
      actorId: kingUserId,
      summary:
        decision.type === 'adjust'
          ? `${decision.direction === 'ease' ? 'eased' : 'pushed'} a review request by ${decision.reports} report(s)' worth`
          : decision.type === 'clear'
            ? 'took back the adjustments behind a review request'
            : 'dismissed a review request',
    });
  }

  await settleRequestMessage(guild, challenge.id, decision, kingUserId);
}

/**
 * Closes requests nobody acted on. Called by the sweeper.
 *
 * A lapsed request is not a rejection and is not reported to the player, who
 * was never promised an answer. It only stops the queue growing forever.
 */
export async function expireStaleRequests(client: Client): Promise<number> {
  const stale = repo.listChallengesNeedingAttention(Date.now());
  let closed = 0;

  for (const challenge of stale) {
    await resolveChallenge(client, challenge, { type: 'lapsed' });
    closed += 1;
  }

  return closed;
}

/* -------------------------------------------------------------------------- */
/* KING channel plumbing                                                      */
/* -------------------------------------------------------------------------- */

async function getKingChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = repo.getGuildSettings(guild.id);
  if (!settings?.king_channel_id) return null;

  const channel = await guild.channels.fetch(settings.king_channel_id).catch(() => null);
  return channel && channel.isTextBased() ? (channel as TextChannel) : null;
}

async function postKingRequest(guild: Guild, challengeId: number): Promise<void> {
  const channel = await getKingChannel(guild);
  const challenge = repo.getChallenge(challengeId);
  if (!channel || !challenge) return;

  const settings = repo.getGuildSettings(guild.id);
  const record = repo.getMember(challenge.guild_id, challenge.target_id);

  // The request arrives already priced. A KING should not have to open a
  // second screen, or do arithmetic, to know what each option costs.
  const options = await previewSizes(guild, challenge.target_id).catch(() => []);

  const message = await channel.send({
    content: settings?.king_role_id ? `<@&${settings.king_role_id}>` : undefined,
    ...buildKingRequest({
      challengeId,
      playerId: challenge.target_id,
      tierKey: record?.tier_key ?? null,
      score: record?.score ?? null,
      raterCount: record?.rater_count ?? 0,
      liveAdjustments: describeLiveAdjustments(challenge.guild_id, challenge.target_id),
      options,
      deadline: challenge.response_deadline,
      guildId: guild.id,
    }),
  });

  repo.updateChallenge(challengeId, { king_message_id: message.id, king_channel_id: channel.id });
}

/** Replaces the request's buttons with what was decided. */
async function settleRequestMessage(
  guild: Guild,
  challengeId: number,
  decision: KingDecision,
  kingUserId?: string,
): Promise<void> {
  const challenge = repo.getChallenge(challengeId);
  if (!challenge?.king_message_id || !challenge.king_channel_id) return;

  const channel = await guild.channels.fetch(challenge.king_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(challenge.king_message_id).catch(() => null);
  if (!message) return;

  const verdict =
    decision.type === 'adjust'
      ? `${decision.direction === 'ease' ? 'eased' : 'pushed'} by **${decision.reports}** report(s)' worth`
      : decision.type === 'clear'
        ? 'adjustments taken back'
        : decision.type === 'dismiss'
          ? 'dismissed, no change'
          : `closed with no action after ${LIMITS.CHALLENGE_REQUEST_WINDOW_HOURS} hours`;

  await message
    .edit({
      content: `**Settled:** ${verdict}${kingUserId ? ` — <@${kingUserId}>` : ''}.`,
      components: [],
    })
    .catch(() => undefined);
}

