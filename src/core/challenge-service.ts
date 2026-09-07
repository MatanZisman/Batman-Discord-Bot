import {
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { DAY_MS, HOUR_MS, LIMITS, SERVER_LAYOUT, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { buildChallengeOpened, buildChallengeRequestDm, buildKingReport } from '../ui/challenge.js';
import { logAction } from './action-log.js';
import { recalculateStanding } from './standing-service.js';

/**
 * ============================================================================
 *  RE-REVIEW ("CHALLENGE") WORKFLOW
 * ============================================================================
 *  A rated player may ask, at most once every CHALLENGE_COOLDOWN_DAYS, for
 *  their raters to take another look.
 *
 *  Phase 1 — collecting  (CHALLENGE_RESPONSE_WINDOW_HOURS)
 *      Everyone holding a current rating on the player is DMed privately.
 *      They can re-rate, or explicitly keep what they had. The KING channel
 *      gets a notice that a review is running, with no action required.
 *
 *  Phase 2 — king_review  (KING_REVIEW_WINDOW_HOURS)
 *      Anyone who never answered has their rating removed: an unanswered
 *      rating is treated as stale rather than as a vote. The standing is
 *      recomputed and posted to the KING channel, where the KING role can
 *      accept it, undo the whole review, or place the player manually.
 *
 *  Phase 3 — closed
 *      Silence from the KING accepts the outcome. The player is told the
 *      result privately, and only ever the result.
 * ============================================================================
 */

export type OpenChallengeOutcome =
  | { ok: true; voterCount: number; deadline: number; message: string }
  | { ok: false; message: string };

export async function openChallenge(guild: Guild, member: GuildMember): Promise<OpenChallengeOutcome> {
  const record = repo.ensureMember(guild.id, member.id, member.joinedTimestamp ?? Date.now());

  if (record.participating === 0) {
    return { ok: false, message: 'You are outside the standing system, so there is nothing to review.' };
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
    return {
      ok: false,
      message: `You already have a review running. It closes <t:${Math.floor(
        (previous.king_deadline ?? previous.response_deadline) / 1000,
      )}:R>.`,
    };
  }

  if (previous) {
    const cooldownMs = LIMITS.CHALLENGE_COOLDOWN_DAYS * DAY_MS;
    const elapsed = Date.now() - previous.opened_at;
    if (elapsed < cooldownMs) {
      const readyAt = Math.floor((previous.opened_at + cooldownMs) / 1000);
      return { ok: false, message: `You can ask for another review <t:${readyAt}:R>.` };
    }
  }

  const activeVotes = repo.getVotesForTarget(guild.id, member.id, 'active');
  if (activeVotes.length === 0) {
    return {
      ok: false,
      message: 'You have no current ratings to review. Your standing will settle on its own shortly.',
    };
  }

  const deadline = Date.now() + LIMITS.CHALLENGE_RESPONSE_WINDOW_HOURS * HOUR_MS;

  const snapshot: repo.ChallengeSnapshot = {
    tier_key: record.tier_key,
    score: record.score,
    rater_count: record.rater_count,
    votes: repo.getVotesForTarget(guild.id, member.id).map((v) => ({
      rater_id: v.rater_id,
      value: v.value,
      status: v.status,
      updated_at: v.updated_at,
    })),
  };

  const challengeId = repo.createChallenge({
    guildId: guild.id,
    targetId: member.id,
    responseDeadline: deadline,
    snapshot,
  });

  for (const vote of activeVotes) {
    repo.addChallengeVoter(challengeId, vote.rater_id, vote.value);
  }

  const playerName = member.displayName;
  let reachable = 0;

  for (const vote of activeVotes) {
    const rater = await guild.members.fetch(vote.rater_id).catch(() => null);
    if (!rater) {
      repo.setChallengeVoterResponse(challengeId, vote.rater_id, 'unreachable');
      continue;
    }

    try {
      await rater.send(
        buildChallengeRequestDm({ challengeId, playerName, guildName: guild.name, deadline }),
      );
      reachable += 1;
    } catch {
      // Closed DMs. Their rating cannot be reaffirmed, so it will be treated
      // like any other unanswered rating when the window closes.
      repo.setChallengeVoterResponse(challengeId, vote.rater_id, 'unreachable');
      logger.debug(`Could not DM rater ${vote.rater_id} for challenge ${challengeId}`);
    }
  }

  await postKingNotice(guild, challengeId);
  repo.audit(guild.id, 'challenge_opened', member.id, `voters=${activeVotes.length}`);
  logAction(guild, { kind: 'challenge_opened', actorId: member.id, invited: activeVotes.length });

  return {
    ok: true,
    voterCount: activeVotes.length,
    deadline,
    message: buildChallengeOpened(reachable, deadline),
  };
}

/** Records that a rater wants to keep the rating they already gave. */
export async function reaffirmRating(
  client: Client,
  challenge: repo.ChallengeRecord,
  raterId: string,
): Promise<void> {
  const vote = repo.getVote(challenge.guild_id, raterId, challenge.target_id);
  if (vote) repo.touchVote(vote.id);
  repo.setChallengeVoterResponse(challenge.id, raterId, 'kept');

  const guild = await client.guilds.fetch(challenge.guild_id).catch(() => null);
  if (guild) logAction(guild, { kind: 'challenge_kept', actorId: raterId });
}

/** Records a fresh rating cast during a review. Bypasses the normal cooldown. */
export async function recordReRating(
  client: Client,
  challenge: repo.ChallengeRecord,
  raterId: string,
  value: number,
): Promise<void> {
  repo.upsertVote(challenge.guild_id, raterId, challenge.target_id, value);
  repo.setChallengeVoterResponse(challenge.id, raterId, 'rerated');

  const guild = await client.guilds.fetch(challenge.guild_id).catch(() => null);
  if (!guild) return;

  logAction(guild, { kind: 'challenge_rerated', actorId: raterId });
  await recalculateStanding(guild, challenge.target_id, { notifyUser: false });
}

/**
 * Phase 1 -> Phase 2. Drops unanswered ratings, recomputes, and hands the
 * outcome to the KING role.
 */
export async function closeResponseWindow(client: Client, challenge: repo.ChallengeRecord): Promise<void> {
  const guild = await client.guilds.fetch(challenge.guild_id).catch(() => null);
  if (!guild) return;

  const voters = repo.getChallengeVoters(challenge.id);

  for (const voter of voters) {
    if (voter.response !== 'pending' && voter.response !== 'unreachable') continue;

    const vote = repo.getVote(challenge.guild_id, voter.rater_id, challenge.target_id);
    if (vote && vote.status === 'active') repo.setVoteStatus(vote.id, 'dropped');
    repo.setChallengeVoterResponse(challenge.id, voter.rater_id, 'dropped');
  }

  const result = await recalculateStanding(guild, challenge.target_id, { notifyUser: false });
  const kingDeadline = Date.now() + LIMITS.KING_REVIEW_WINDOW_HOURS * HOUR_MS;

  repo.updateChallenge(challenge.id, { state: 'king_review', king_deadline: kingDeadline });
  repo.audit(challenge.guild_id, 'challenge_window_closed', challenge.target_id, result?.standing.tierKey);

  await postKingDecision(guild, challenge.id);
}

export type KingAction = { type: 'accept' } | { type: 'revert' } | { type: 'place'; tierKey: string };

/**
 * Phase 2 -> Phase 3. Applies the KING's decision, or the default acceptance
 * when the window lapses, then tells the player the result and nothing else.
 */
export async function finalizeChallenge(
  client: Client,
  challenge: repo.ChallengeRecord,
  action: KingAction,
  kingUserId?: string,
): Promise<void> {
  const guild = await client.guilds.fetch(challenge.guild_id).catch(() => null);
  if (!guild) return;

  if (action.type === 'revert') {
    const snapshot = JSON.parse(challenge.snapshot_json) as repo.ChallengeSnapshot;
    for (const vote of snapshot.votes) {
      repo.restoreVote(
        challenge.guild_id,
        vote.rater_id,
        challenge.target_id,
        vote.value,
        vote.status,
        vote.updated_at,
      );
    }
    repo.setTierOverride(challenge.guild_id, challenge.target_id, null, null);
  }

  if (action.type === 'place') {
    repo.setTierOverride(
      challenge.guild_id,
      challenge.target_id,
      action.tierKey,
      Date.now() + LIMITS.KING_OVERRIDE_DAYS * DAY_MS,
    );
  }

  repo.updateChallenge(challenge.id, {
    state: 'closed',
    closed_at: Date.now(),
    king_action: action.type === 'place' ? `place:${action.tierKey}` : action.type,
    king_user_id: kingUserId ?? null,
  });

  const result = await recalculateStanding(guild, challenge.target_id, { notifyUser: false });
  repo.audit(
    challenge.guild_id,
    'challenge_closed',
    challenge.target_id,
    `${action.type}${kingUserId ? ' by king' : ' by timeout'}`,
  );

  await notifyChallengeOutcome(guild, challenge, result?.standing.tierKey ?? null, action);
  await clearKingButtons(guild, challenge.id, action, kingUserId);
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

function tallyResponses(challengeId: number) {
  const voters = repo.getChallengeVoters(challengeId);
  return {
    invited: voters.length,
    rerated: voters.filter((v) => v.response === 'rerated').length,
    kept: voters.filter((v) => v.response === 'kept').length,
    dropped: voters.filter((v) => v.response === 'dropped').length,
    pending: voters.filter((v) => v.response === 'pending' || v.response === 'unreachable').length,
  };
}

async function postKingNotice(guild: Guild, challengeId: number): Promise<void> {
  const channel = await getKingChannel(guild);
  const challenge = repo.getChallenge(challengeId);
  if (!channel || !challenge) return;

  const snapshot = JSON.parse(challenge.snapshot_json) as repo.ChallengeSnapshot;
  const settings = repo.getGuildSettings(guild.id);

  const message = await channel.send({
    content: settings?.king_role_id ? `<@&${settings.king_role_id}>` : undefined,
    ...buildKingReport({
      challengeId,
      playerId: challenge.target_id,
      state: 'collecting',
      ...tallyResponses(challengeId),
      beforeTierKey: snapshot.tier_key,
      afterTierKey: snapshot.tier_key,
      beforeScore: snapshot.score,
      afterScore: snapshot.score,
      deadline: challenge.response_deadline,
    }),
  });

  repo.updateChallenge(challengeId, { king_message_id: message.id, king_channel_id: channel.id });
}

async function postKingDecision(guild: Guild, challengeId: number): Promise<void> {
  const channel = await getKingChannel(guild);
  const challenge = repo.getChallenge(challengeId);
  if (!channel || !challenge) return;

  const snapshot = JSON.parse(challenge.snapshot_json) as repo.ChallengeSnapshot;
  const current = repo.getMember(challenge.guild_id, challenge.target_id);
  const settings = repo.getGuildSettings(guild.id);

  const payload = buildKingReport({
    challengeId,
    playerId: challenge.target_id,
    state: 'king_review',
    ...tallyResponses(challengeId),
    beforeTierKey: snapshot.tier_key,
    afterTierKey: current?.tier_key ?? null,
    beforeScore: snapshot.score,
    afterScore: current?.score ?? null,
    deadline: challenge.king_deadline,
  });

  const message = await channel.send({
    content: settings?.king_role_id ? `<@&${settings.king_role_id}>` : undefined,
    ...payload,
  });

  repo.updateChallenge(challengeId, { king_message_id: message.id, king_channel_id: channel.id });
}

/** Strips the decision buttons once a challenge is settled. */
async function clearKingButtons(
  guild: Guild,
  challengeId: number,
  action: KingAction,
  kingUserId?: string,
): Promise<void> {
  const challenge = repo.getChallenge(challengeId);
  if (!challenge?.king_message_id || !challenge.king_channel_id) return;

  const channel = await guild.channels.fetch(challenge.king_channel_id).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(challenge.king_message_id).catch(() => null);
  if (!message) return;

  const verdict =
    action.type === 'accept'
      ? 'Outcome accepted'
      : action.type === 'revert'
        ? 'Review undone, previous ratings restored'
        : `Placed manually in ${tierAt(tierIndexByKey(action.tierKey)).roleName}`;

  await message
    .edit({
      content: `**Settled:** ${verdict}${kingUserId ? ` by <@${kingUserId}>` : ' automatically'}.`,
      components: [],
    })
    .catch(() => undefined);
}

async function notifyChallengeOutcome(
  guild: Guild,
  challenge: repo.ChallengeRecord,
  tierKey: string | null,
  action: KingAction,
): Promise<void> {
  const member = await guild.members.fetch(challenge.target_id).catch(() => null);
  if (!member) return;

  const tally = tallyResponses(challenge.id);
  const tierName = tierKey ? tierAt(tierIndexByKey(tierKey)).roleName : 'unchanged';

  const lines = [
    '**Your re-review is complete.**',
    '',
    `Your standing is now **${tierName}**.`,
    `${tally.rerated} of your raters rated you again, ${tally.kept} kept what they had, and ${tally.dropped} did not answer, so their ratings were removed.`,
  ];

  if (action.type === 'revert') {
    lines.push(
      '',
      `The ${SERVER_LAYOUT.kingRoleName} role rolled this review back, so your previous ratings still stand. You can ask again after the usual waiting period.`,
    );
  }

  if (action.type === 'place') {
    lines.push(
      '',
      `The ${SERVER_LAYOUT.kingRoleName} role set your placement directly for the next ${LIMITS.KING_OVERRIDE_DAYS} days.`,
    );
  }

  lines.push('', 'You were never shown who rated you, and they were never shown what you asked.');

  await member.send(lines.join('\n')).catch(() => undefined);
}
