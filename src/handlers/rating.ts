import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { DAY_MS, HOUR_MS, LIMITS, SCORING, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { logAction } from '../core/action-log.js';
import { computeStanding, explainStanding } from '../core/scoring.js';
import { collectVoteInputs, recalculateStanding } from '../core/standing-service.js';
import { logger } from '../lib/logger.js';
import {
  buildPlayerPicker,
  buildRatingSaved,
  buildRatingScale,
  buildSessionClosed,
} from '../ui/rating-flow.js';
import { buildParticipationMenu } from '../ui/participation.js';

/**
 * In-memory session state for the private rating conversation. It only tracks
 * how many ratings the member has cast in this sitting so the wording can say
 * "3 ratings recorded"; losing it on restart is harmless, and deliberately
 * nothing about who was rated is kept here.
 */
interface RatingSession {
  ratedCount: number;
  lastActivity: number;
}

const sessions = new Map<string, RatingSession>();

function sessionKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function getSession(guildId: string, userId: string): RatingSession {
  const key = sessionKey(guildId, userId);
  const existing = sessions.get(key);
  const timeout = LIMITS.RATING_SESSION_TIMEOUT_MINUTES * 60 * 1000;

  if (existing && Date.now() - existing.lastActivity < timeout) {
    existing.lastActivity = Date.now();
    return existing;
  }

  const fresh: RatingSession = { ratedCount: 0, lastActivity: Date.now() };
  sessions.set(key, fresh);
  return fresh;
}

function remainingVotesToday(guildId: string, userId: string): number {
  const used = repo.countVotesCreatedSince(guildId, userId, Date.now() - DAY_MS);
  return Math.max(LIMITS.MAX_NEW_VOTES_PER_DAY - used, 0);
}

/* -------------------------------------------------------------------------- */
/* Entry points                                                               */
/* -------------------------------------------------------------------------- */

export async function startRatingSession(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const rater = repo.ensureMember(guild.id, interaction.user.id, interaction.member
    ? ('joinedTimestamp' in interaction.member ? (interaction.member.joinedTimestamp ?? Date.now()) : Date.now())
    : Date.now());

  // Opted-out members cannot hand out ratings. Offer them the way back in
  // rather than a dead end.
  if (rater.participating === 0) {
    await reply(interaction, {
      content:
        'You are currently outside the standing system, so you cannot rate other players. You can rejoin below — rejoining means others may rate you too.',
      ...buildParticipationMenu(false),
    });
    return;
  }

  const session = getSession(guild.id, interaction.user.id);
  await reply(
    interaction,
    buildPlayerPicker({
      ratedSoFar: session.ratedCount,
      remainingToday: remainingVotesToday(guild.id, interaction.user.id),
    }),
  );
}

/** The user-select menu came back with a chosen player. */
export async function handlePlayerPicked(interaction: UserSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const targetId = interaction.values[0];
  if (!targetId) return;

  const problem = await validateTarget(guild, interaction.user.id, targetId);
  if (problem) {
    await interaction.update({ content: problem, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existing = repo.getVote(guild.id, interaction.user.id, targetId);
  const cooldown = describeUpdateCooldown(existing);
  if (cooldown) {
    await interaction.update({ content: cooldown, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existingValue = existing?.status === 'active' ? existing.value : null;
  await interaction.update(buildRatingScale(targetId, existingValue));
}

/** A rating value was chosen. Save it and recompute the target's standing. */
export async function handleRatingValue(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const decoded = interaction.customId.split(':');
  const targetId = decoded[2];
  const rawValue = Number(interaction.values[0]);

  if (!targetId || Number.isNaN(rawValue)) {
    await interaction.update({ content: 'Something went wrong reading that rating.', components: [] });
    return;
  }

  const value = Math.min(Math.max(Math.round(rawValue), SCORING.MIN_RATING), SCORING.MAX_RATING);

  // Re-validate: the state could have changed while the panel sat open.
  const problem = await validateTarget(guild, interaction.user.id, targetId);
  if (problem) {
    await interaction.update({ content: problem, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existing = repo.getVote(guild.id, interaction.user.id, targetId);
  const cooldown = describeUpdateCooldown(existing);
  if (cooldown) {
    await interaction.update({ content: cooldown, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const isNewVote = !existing || existing.status !== 'active';
  if (isNewVote && remainingVotesToday(guild.id, interaction.user.id) <= 0) {
    await interaction.update({
      content: `You have used all ${LIMITS.MAX_NEW_VOTES_PER_DAY} new ratings for today. This limit exists so no group can rate someone down in a single evening. Come back tomorrow.`,
      components: [],
    });
    return;
  }

  const result = repo.upsertVote(guild.id, interaction.user.id, targetId, value);
  repo.audit(guild.id, result.previousValue === null ? 'vote_cast' : 'vote_updated', targetId);

  logAction(guild, {
    kind: result.previousValue === null ? 'rating_created' : 'rating_updated',
    actorId: interaction.user.id,
    targetId,
    value,
  });

  const session = getSession(guild.id, interaction.user.id);
  session.ratedCount += 1;

  await interaction.update(buildRatingSaved(targetId, value, result.previousValue !== null));

  // Recalculating touches roles and may DM the target, so do it after the UI
  // has already responded to keep the interaction snappy.
  recalculateStanding(guild, targetId).catch((error) =>
    logger.error(`Failed to recalculate standing for ${targetId}`, error),
  );
}

export async function handleRatingBack(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const session = getSession(guild.id, interaction.user.id);
  await interaction.update(
    buildPlayerPicker({
      ratedSoFar: session.ratedCount,
      remainingToday: remainingVotesToday(guild.id, interaction.user.id),
    }),
  );
}

export async function handleRatingDone(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const key = sessionKey(guild.id, interaction.user.id);
  const count = sessions.get(key)?.ratedCount ?? 0;
  sessions.delete(key);

  await interaction.update(buildSessionClosed(count));
}

/**
 * The member's private view of their own standing. This is the only place any
 * standing detail is ever shown, and it only ever shows your own.
 */
export async function showOwnStanding(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const record = repo.ensureMember(guild.id, interaction.user.id);

  if (record.participating === 0) {
    await reply(interaction, {
      content:
        'You are outside the standing system. You hold no standing and no ratings, and you can see the open channels only.',
      ...buildParticipationMenu(false),
    });
    return;
  }

  const currentTierIndex = record.tier_key ? tierIndexByKey(record.tier_key) : null;
  const inputs = await collectVoteInputs(guild, interaction.user.id);
  const standing = computeStanding(inputs, Date.now(), currentTierIndex);

  const lines = [
    `**Your ${tierAt(standing.tierIndex).roleName} standing**`,
    '',
    explainStanding(standing),
    '',
    'Who rated you is not stored in any form that can be looked up, by you or by anyone else.',
  ];

  await reply(interaction, { content: lines.join('\n') });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

async function validateTarget(guild: Guild, raterId: string, targetId: string): Promise<string | null> {
  if (targetId === raterId) return 'You cannot rate yourself.';

  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) return 'That player is not in this server.';
  if (target.user.bot) return 'Bots are not part of the standing system.';

  const targetRecord = repo.ensureMember(guild.id, targetId, target.joinedTimestamp ?? Date.now());
  if (targetRecord.participating === 0) {
    return 'That player has chosen not to take part in the standing system, so they cannot be rated.';
  }

  return null;
}

/**
 * Ratings can be changed, but not repeatedly within the cooldown. This stops
 * someone from oscillating a rating to nudge a target across a boundary.
 */
function describeUpdateCooldown(existing: repo.VoteRecord | undefined): string | null {
  if (!existing || existing.status !== 'active') return null;

  const cooldownMs = LIMITS.VOTE_UPDATE_COOLDOWN_HOURS * HOUR_MS;
  const elapsed = Date.now() - existing.updated_at;
  if (elapsed >= cooldownMs) return null;

  const hoursLeft = Math.ceil((cooldownMs - elapsed) / HOUR_MS);
  return `You already rated that player recently. You can change that rating again in about ${hoursLeft} hour(s).`;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

async function reply(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  payload: Omit<InteractionReplyOptions, 'flags'>,
): Promise<void> {
  const body: InteractionReplyOptions = { ...payload, flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(body);
  } else {
    await interaction.reply(body);
  }
}

/** Sends a fresh picker as a follow-up after an error message replaced the panel. */
async function followUpPicker(
  interaction: UserSelectMenuInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const session = getSession(guild.id, interaction.user.id);
  await interaction.followUp({
    ...buildPlayerPicker({
      ratedSoFar: session.ratedCount,
      remainingToday: remainingVotesToday(guild.id, interaction.user.id),
    }),
    flags: MessageFlags.Ephemeral,
  });
}
