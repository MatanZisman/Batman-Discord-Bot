import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMemberRoleManager,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { SCORING, SERVER_LAYOUT, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import {
  closeResponseWindow,
  finalizeChallenge,
  openChallenge,
  reaffirmRating,
  recordReRating,
  type KingAction,
} from '../core/challenge-service.js';
import { logger } from '../lib/logger.js';
import { buildChallengeScale, buildKingTierPicker } from '../ui/challenge.js';

/* -------------------------------------------------------------------------- */
/* Opening a review                                                           */
/* -------------------------------------------------------------------------- */

export async function handleOpenChallenge(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply('Could not read your server membership.');
    return;
  }

  const outcome = await openChallenge(guild, member);
  await interaction.editReply(outcome.message);
}

/* -------------------------------------------------------------------------- */
/* Rater responses (these arrive from DMs, so interaction.guild is null)      */
/* -------------------------------------------------------------------------- */

/**
 * Loads the challenge behind a DM button and checks that this user is actually
 * one of its invited raters and still able to answer.
 */
function loadRaterContext(challengeId: number, raterId: string):
  | { ok: true; challenge: repo.ChallengeRecord }
  | { ok: false; message: string } {
  const challenge = repo.getChallenge(challengeId);
  if (!challenge) return { ok: false, message: 'That review no longer exists.' };

  if (challenge.state !== 'collecting') {
    return { ok: false, message: 'That review has already closed. Thanks anyway.' };
  }

  const voter = repo.getChallengeVoters(challengeId).find((v) => v.rater_id === raterId);
  if (!voter) return { ok: false, message: 'This review was not addressed to you.' };

  if (voter.response === 'rerated' || voter.response === 'kept') {
    return { ok: false, message: 'You already answered this one.' };
  }

  return { ok: true, challenge };
}

export async function handleChallengeLook(interaction: ButtonInteraction): Promise<void> {
  const challengeId = Number(interaction.customId.split(':')[2]);
  const context = loadRaterContext(challengeId, interaction.user.id);

  if (!context.ok) {
    await interaction.update({ content: context.message, embeds: [], components: [] });
    return;
  }

  const playerName = await resolveDisplayName(
    interaction,
    context.challenge.guild_id,
    context.challenge.target_id,
  );
  await interaction.update(buildChallengeScale(challengeId, playerName));
}

export async function handleChallengeKeep(interaction: ButtonInteraction): Promise<void> {
  const challengeId = Number(interaction.customId.split(':')[2]);
  const context = loadRaterContext(challengeId, interaction.user.id);

  if (!context.ok) {
    await interaction.update({ content: context.message, embeds: [], components: [] });
    return;
  }

  await reaffirmRating(interaction.client, context.challenge, interaction.user.id);

  await interaction.update({
    content: 'Kept as it was. Your rating stays on record and its clock has been refreshed.',
    embeds: [],
    components: [],
  });
}

export async function handleChallengeReRate(interaction: StringSelectMenuInteraction): Promise<void> {
  const challengeId = Number(interaction.customId.split(':')[2]);
  const context = loadRaterContext(challengeId, interaction.user.id);

  if (!context.ok) {
    await interaction.update({ content: context.message, embeds: [], components: [] });
    return;
  }

  const raw = Number(interaction.values[0]);
  if (Number.isNaN(raw)) {
    await interaction.update({ content: 'Could not read that rating.', embeds: [], components: [] });
    return;
  }

  const value = Math.min(Math.max(Math.round(raw), SCORING.MIN_RATING), SCORING.MAX_RATING);
  await recordReRating(interaction.client, context.challenge, interaction.user.id, value);

  await interaction.update({
    content: `Thanks. Your new rating of **${value}** has replaced the old one.`,
    embeds: [],
    components: [],
  });
}

/* -------------------------------------------------------------------------- */
/* KING decisions                                                             */
/* -------------------------------------------------------------------------- */

function isKing(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  const settings = interaction.guildId ? repo.getGuildSettings(interaction.guildId) : undefined;
  if (!settings?.king_role_id) return false;

  const roles = interaction.member?.roles as GuildMemberRoleManager | string[] | undefined;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(settings.king_role_id);
  return roles.cache.has(settings.king_role_id);
}

async function guardKing(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<repo.ChallengeRecord | null> {
  if (!isKing(interaction)) {
    await interaction.reply({
      content: `Only the ${SERVER_LAYOUT.kingRoleName} role can decide a review.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const challenge = repo.getChallenge(Number(interaction.customId.split(':')[2]));
  if (!challenge) {
    await interaction.reply({ content: 'That review no longer exists.', flags: MessageFlags.Ephemeral });
    return null;
  }

  if (challenge.state === 'closed') {
    await interaction.reply({ content: 'That review is already settled.', flags: MessageFlags.Ephemeral });
    return null;
  }

  if (challenge.state === 'collecting') {
    await interaction.reply({
      content: 'Raters are still answering. You can decide once the response window closes.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return challenge;
}

export async function handleKingDecision(
  interaction: ButtonInteraction,
  action: 'accept' | 'revert',
): Promise<void> {
  const challenge = await guardKing(interaction);
  if (!challenge) return;

  await interaction.deferUpdate();
  await finalizeChallenge(
    interaction.client,
    challenge,
    { type: action } as KingAction,
    interaction.user.id,
  );
}

export async function handleKingPlacePrompt(interaction: ButtonInteraction): Promise<void> {
  const challenge = await guardKing(interaction);
  if (!challenge) return;

  await interaction.reply({
    ...buildKingTierPicker(challenge.id),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleKingPlace(interaction: StringSelectMenuInteraction): Promise<void> {
  const challenge = await guardKing(interaction);
  if (!challenge) return;

  const tierKey = interaction.values[0];
  if (!tierKey) return;

  await finalizeChallenge(interaction.client, challenge, { type: 'place', tierKey }, interaction.user.id);

  await interaction.update({
    content: `Placed in **${tierAt(tierIndexByKey(tierKey)).roleName}**.`,
    components: [],
  });
}

/* -------------------------------------------------------------------------- */
/* Timers                                                                     */
/* -------------------------------------------------------------------------- */

/** Called by the scheduler for challenges whose deadline has passed. */
export async function advanceChallenge(
  client: import('discord.js').Client,
  challenge: repo.ChallengeRecord,
): Promise<void> {
  try {
    if (challenge.state === 'collecting') {
      await closeResponseWindow(client, challenge);
      return;
    }

    if (challenge.state === 'king_review') {
      // Silence from the KING accepts the community's outcome.
      await finalizeChallenge(client, challenge, { type: 'accept' });
    }
  } catch (error) {
    logger.error(`Failed to advance challenge ${challenge.id}`, error);
  }
}

async function resolveDisplayName(
  interaction: ButtonInteraction,
  guildId: string,
  userId: string,
): Promise<string> {
  const guild = await interaction.client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch(userId).catch(() => null);
  return member?.displayName ?? 'that player';
}
