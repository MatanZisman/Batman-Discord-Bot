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
import { stringsIn } from '../i18n/index.js';

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
    const t = stringsIn(guild.id);
    await interaction.editReply(t.genericError);
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
  const t = stringsIn(interaction.guildId ?? '');

  if (!isKing(interaction)) {
    await interaction.reply({
      content: t.guards.kingReviewOnly({ king: SERVER_LAYOUT.kingRoleName }),
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const challenge = repo.getChallenge(Number(interaction.customId.split(':')[2]));
  if (!challenge) {
    await interaction.reply({ content: t.guards.requestMissing, flags: MessageFlags.Ephemeral });
    return null;
  }

  if (challenge.state === 'closed') {
    await interaction.reply({
      content: t.guards.requestClosed,
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
  const t = stringsIn(challenge.guild_id);

  await interaction.followUp({
    content: t.review.settled({
      action: `${reports} report(s)' worth ${rawDirection === 'ease' ? 'of relief' : 'of pressure'}, now in **${area}** at **${record?.score?.toFixed(2) ?? '—'}**`,
    }),
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

  const t = stringsIn(challenge.guild_id);
  await interaction.followUp({
    content: t.review.settled({
      action: type === 'dismiss' ? 'Dismissed. Nothing changed.' : 'Every adjustment taken back.',
    }),
    flags: MessageFlags.Ephemeral,
  });

  if (interaction.guild) await publishKingMenu(interaction.guild).catch(() => undefined);
}
