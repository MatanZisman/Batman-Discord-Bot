import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMemberRoleManager,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { SERVER_LAYOUT, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { openChallenge, resolveChallenge, type KingDecision } from '../core/challenge-service.js';
import { publishKingMenu } from '../core/king-panel.js';

/* -------------------------------------------------------------------------- */
/* Asking for a review                                                        */
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

  // A new request changes the "needs a look" count on the admin panel.
  if (outcome.ok) await publishKingMenu(guild).catch(() => undefined);
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

/**
 * Checks the presser may decide this request, and that it is still open.
 *
 * The open/closed check matters more than it looks: the request message sits
 * in a channel several people watch, so two KINGs pressing at once is normal
 * rather than exceptional, and the second one must be told rather than
 * silently stacking a second adjustment on top of the first.
 */
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
    await interaction.reply({ content: 'That request no longer exists.', flags: MessageFlags.Ephemeral });
    return null;
  }

  if (challenge.state === 'closed') {
    await interaction.reply({
      content: 'That request has already been settled by someone else.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return challenge;
}

/** A KING granted an adjustment in one direction or the other. */
export async function handleKingAdjust(interaction: StringSelectMenuInteraction): Promise<void> {
  const challenge = await guardKing(interaction);
  if (!challenge) return;

  const [rawDirection, rawReports] = (interaction.values[0] ?? '').split(':');
  const reports = Number(rawReports);
  if ((rawDirection !== 'ease' && rawDirection !== 'push') || Number.isNaN(reports)) return;

  await interaction.deferUpdate();
  await resolveChallenge(
    interaction.client,
    challenge,
    { type: 'adjust', direction: rawDirection, reports },
    interaction.user.id,
  );

  const record = repo.getMember(challenge.guild_id, challenge.target_id);
  const area = record?.tier_key ? tierAt(tierIndexByKey(record.tier_key)).roleName : 'unchanged';

  await interaction.followUp({
    content: [
      `Done. ${reports} report(s)' worth ${rawDirection === 'ease' ? 'of relief' : 'of pressure'}, and they now sit in **${area}** at **${record?.score?.toFixed(2) ?? '—'}**.`,
      '',
      'The community score is still running underneath, so this can be outvoted. They were not told a review decided anything — they just see their area change, if it moved.',
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
  });

  if (interaction.guild) await publishKingMenu(interaction.guild).catch(() => undefined);
}

/** Dismissed, or existing adjustments taken back. */
export async function handleKingClose(
  interaction: ButtonInteraction,
  type: 'dismiss' | 'clear',
): Promise<void> {
  const challenge = await guardKing(interaction);
  if (!challenge) return;

  await interaction.deferUpdate();
  await resolveChallenge(interaction.client, challenge, { type } as KingDecision, interaction.user.id);

  await interaction.followUp({
    content:
      type === 'dismiss'
        ? 'Dismissed. Nothing changed, and they were not told.'
        : 'Every adjustment on them is taken back. They are on the community score alone.',
    flags: MessageFlags.Ephemeral,
  });

  if (interaction.guild) await publishKingMenu(interaction.guild).catch(() => undefined);
}
