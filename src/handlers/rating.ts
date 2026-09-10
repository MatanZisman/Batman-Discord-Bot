import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type InteractionReplyOptions,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { DAY_MS, LIMITS, MINUTE_MS, SCORING, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { logAction } from '../core/action-log.js';
import { explainStanding } from '../core/scoring.js';
import { evaluateStanding, recalculateStanding } from '../core/standing-service.js';
import { stringsIn } from '../i18n/index.js';
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

  const t = stringsIn(guild.id);

  // Opted-out members cannot hand out ratings. Offer them the way back in
  // rather than a dead end.
  if (rater.participating === 0) {
    await reply(interaction, {
      content: t.rating.notParticipating,
      ...buildParticipationMenu(false, guild.id),
    });
    return;
  }

  const session = getSession(guild.id, interaction.user.id);
  await reply(
    interaction,
    buildPlayerPicker({
      ratedSoFar: session.ratedCount,
      remainingToday: remainingVotesToday(guild.id, interaction.user.id),
      guildId: guild.id,
    }),
  );
}

/** The user-select menu came back with a chosen player. */
export async function handlePlayerPicked(interaction: UserSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const targetId = interaction.values[0];
  if (!targetId) return;

  const problem = await validateTarget(guild, interaction.user.id, targetId, guild.id);
  if (problem) {
    await interaction.update({ content: problem, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existing = repo.getVote(guild.id, interaction.user.id, targetId);
  const cooldown = describeUpdateCooldown(existing, guild.id);
  if (cooldown) {
    await interaction.update({ content: cooldown, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existingValue = existing?.status === 'active' ? existing.value : null;
  await interaction.update(buildRatingScale(targetId, existingValue, guild.id));
}

/** A rating value was chosen. Save it and recompute the target's standing. */
export async function handleRatingValue(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const decoded = interaction.customId.split(':');
  const targetId = decoded[2];
  const rawValue = Number(interaction.values[0]);

  if (!targetId || Number.isNaN(rawValue)) {
    const t = stringsIn(interaction.guild?.id ?? '');
    await interaction.update({ content: t.rating.errorBadRating, components: [] });
    return;
  }

  const value = Math.min(Math.max(Math.round(rawValue), SCORING.MIN_RATING), SCORING.MAX_RATING);
  const t = stringsIn(guild.id);

  // Re-validate: the state could have changed while the panel sat open.
  const problem = await validateTarget(guild, interaction.user.id, targetId, guild.id);
  if (problem) {
    await interaction.update({ content: problem, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const existing = repo.getVote(guild.id, interaction.user.id, targetId);
  const cooldown = describeUpdateCooldown(existing, guild.id);
  if (cooldown) {
    await interaction.update({ content: cooldown, components: [] });
    await followUpPicker(interaction);
    return;
  }

  const isNewVote = !existing || existing.status !== 'active';
  if (isNewVote && remainingVotesToday(guild.id, interaction.user.id) <= 0) {
    await interaction.update({
      content: t.rating.errorDailyCap({ cap: LIMITS.MAX_NEW_VOTES_PER_DAY }),
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

  await interaction.update(buildRatingSaved(targetId, value, result.previousValue !== null, guild.id));

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
      guildId: guild.id,
    }),
  );
}

export async function handleRatingDone(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const key = sessionKey(guild.id, interaction.user.id);
  const count = sessions.get(key)?.ratedCount ?? 0;
  sessions.delete(key);

  await interaction.update(buildSessionClosed(count, guild.id));
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
  const t = stringsIn(guild.id);

  if (record.participating === 0) {
    await reply(interaction, {
      content: t.standing.notParticipating,
      ...buildParticipationMenu(false, guild.id),
    });
    return;
  }

  const { standing } = await evaluateStanding(guild, interaction.user.id, record);

  const lines = [
    t.standing.header({ area: tierAt(standing.tierIndex).roleName }),
    '',
    explainStanding(standing, guild.id),
    '',
    t.standing.who,
  ];

  await reply(interaction, { content: lines.join('\n') });
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

async function validateTarget(guild: Guild, raterId: string, targetId: string, guildId?: string): Promise<string | null> {
  const t = stringsIn(guildId ?? '');

  if (targetId === raterId) return t.rating.errorSelf;

  const target = await guild.members.fetch(targetId).catch(() => null);
  if (!target) return t.rating.errorNotMember;
  if (target.user.bot) return t.rating.errorBot;

  const targetRecord = repo.ensureMember(guild.id, targetId, target.joinedTimestamp ?? Date.now());
  if (targetRecord.participating === 0) {
    return t.rating.errorOptedOut;
  }

  return null;
}

/**
 * Ratings can be changed, but not repeatedly within the cooldown. This stops
 * someone from oscillating a rating to nudge a target across a boundary.
 */
function describeUpdateCooldown(existing: repo.VoteRecord | undefined, guildId?: string): string | null {
  if (!existing || existing.status !== 'active') return null;

  const cooldownMs = LIMITS.VOTE_UPDATE_COOLDOWN_MINUTES * MINUTE_MS;
  const elapsed = Date.now() - existing.updated_at;
  if (elapsed >= cooldownMs) return null;

  const minutesLeft = Math.max(1, Math.ceil((cooldownMs - elapsed) / MINUTE_MS));
  const t = stringsIn(guildId ?? '');
  return t.rating.cooldownMsg({ minutesLeft });
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
      guildId: guild.id,
      remainingToday: remainingVotesToday(guild.id, interaction.user.id),
    }),
    flags: MessageFlags.Ephemeral,
  });
}
