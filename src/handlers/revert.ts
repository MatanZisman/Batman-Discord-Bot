import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { logAction } from '../core/action-log.js';
import { planRevert, revertGuild } from '../core/guild-teardown.js';
import { stringsIn } from '../i18n/index.js';
import { logger } from '../lib/logger.js';
import { buildRevertConfirmation, buildRevertReport } from '../ui/revert.js';
import { checkAdminAccess } from './guards.js';

export async function showRevertConfirmation(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const includeUnrecorded = interaction.options.getBoolean('include-unrecorded') ?? false;
  const plan = planRevert(guild, { includeUnrecorded });

  await interaction.reply({ ...buildRevertConfirmation(plan, guild.id), flags: MessageFlags.Ephemeral });
}

export async function handleRevertConfirm(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  // Re-checked on the button, because a component can be clicked by anyone who
  // can see the message it sits on.
  const access = checkAdminAccess(interaction);
  if (!access.ok) {
    await interaction.reply({ content: access.message, flags: MessageFlags.Ephemeral });
    return;
  }

  // The flag the operator confirmed is carried in the button id, so a stale
  // panel can never apply a different mode than the one it described.
  const includeUnrecorded = interaction.customId.split(':')[2] === '1';

  const t = stringsIn(guild.id);
  await interaction.update({
    content: t.revert.inProgress,
    embeds: [],
    components: [],
  });

  // Logged before the wipe, since the log channel is about to disappear.
  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'removed the standing system from this server',
  });

  const report = await revertGuild(guild, { includeUnrecorded });
  const summary = buildRevertReport(report, guild.id);

  // The channel this was run from may well have just been deleted, in which
  // case editing the original reply fails. Fall back to a DM so the operator
  // always sees the outcome.
  try {
    await interaction.editReply({ content: summary, embeds: [], components: [] });
  } catch {
    logger.debug('Revert reply channel is gone; sending the report by DM instead.');
    await interaction.user.send(summary).catch(() => undefined);
  }
}

export async function handleRevertCancel(interaction: ButtonInteraction): Promise<void> {
  const t = stringsIn(interaction.guild?.id ?? '');
  await interaction.update({
    content: t.revert.cancelled,
    embeds: [],
    components: [],
  });
}
