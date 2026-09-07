import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';
import { TIERS } from '../config.js';
import { logAction } from '../core/action-log.js';
import * as repo from '../db/repo.js';
import { applyTierRoles, recalculateStanding } from '../core/standing-service.js';
import { logger } from '../lib/logger.js';
import {
  buildLeaveConfirmation,
  buildParticipationStatus,
} from '../ui/participation.js';

export async function showParticipationMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const record = repo.ensureMember(guild.id, interaction.user.id);
  const payload = buildParticipationStatus(record.participating === 1);

  if (interaction.isButton()) {
    await interaction.update(payload);
    return;
  }
  await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral } as InteractionReplyOptions);
}

export async function showLeaveConfirmation(interaction: ButtonInteraction): Promise<void> {
  await interaction.update(buildLeaveConfirmation());
}

export async function handleLeave(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const userId = interaction.user.id;
  repo.ensureMember(guild.id, userId);

  // Deleting their ratings changes other people's standings, so collect the
  // affected targets before the rows disappear.
  const affectedTargets = repo.deleteVotesInvolving(guild.id, userId);
  repo.setParticipation(guild.id, userId, false);
  repo.audit(guild.id, 'opt_out', userId);
  logAction(guild, { kind: 'opt_out', actorId: userId });

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await applyTierRoles(guild, member, null);

  await interaction.update({
    content: [
      'Done. You are now outside the standing system.',
      '',
      'Your ratings, given and received, have been deleted. You keep access to the open channels and can rejoin at any time from the standing channel.',
    ].join('\n'),
    components: [],
  });

  for (const targetId of affectedTargets) {
    recalculateStanding(guild, targetId).catch((error) =>
      logger.error(`Recalculation after opt-out failed for ${targetId}`, error),
    );
  }
}

export async function handleJoin(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const userId = interaction.user.id;
  repo.ensureMember(guild.id, userId);
  repo.setParticipation(guild.id, userId, true);
  repo.audit(guild.id, 'opt_in', userId);
  logAction(guild, { kind: 'opt_in', actorId: userId });

  await recalculateStanding(guild, userId, { notifyUser: false });

  await interaction.update({
    content: [
      `You are in. You start in **${TIERS[0]?.roleName ?? 'the first tier'}** with a clean slate.`,
      '',
      'You can now rate other players, and other players can rate you. You can leave again at any time.',
    ].join('\n'),
    components: [],
  });
}
