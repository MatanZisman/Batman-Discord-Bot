import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { stringsIn } from '../i18n/index.js';
import { NS, encodeId } from '../lib/custom-ids.js';
import { planIsEmpty, type RevertPlan, type RevertReport } from '../core/guild-teardown.js';

/**
 * A destructive command deserves an accurate prompt rather than a scary one,
 * so this lists the exact roles and channels involved and separates the two
 * outcomes: things that get deleted, and things that get handed back.
 */
export function buildRevertConfirmation(plan: RevertPlan, guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');

  if (planIsEmpty(plan)) {
    return { content: t.revert.nothingToDo, components: [] };
  }

  const embed = new EmbedBuilder()
    .setTitle(t.revert.confirmTitle({ guild: 'this server' }))
    .setColor(0xed4245)
    .setDescription(t.revert.confirmDesc);

  if (plan.channelsToDelete.length > 0) {
    embed.addFields({
      name: t.revert.toDeleteChannels({ count: plan.channelsToDelete.length }),
      value: truncate(plan.channelsToDelete.map((c) => c.name).join(', ')),
    });
  }

  if (plan.rolesToDelete.length > 0) {
    embed.addFields({
      name: t.revert.toDeleteRoles({ count: plan.rolesToDelete.length }),
      value: truncate(plan.rolesToDelete.map((r) => r.name).join(', ')),
    });
  }

  if (plan.channelsToRestore.length > 0) {
    embed.addFields({
      name: t.revert.toRestoreChannels({ count: plan.channelsToRestore.length }),
      value: `${truncate(plan.channelsToRestore.map((c) => `#${c.name}`).join(', '))}\n${t.revert.toRestoreDesc}`,
    });
  }

  const toEmpty = plan.rolesToRelease.filter((r) => r.assignedByBot === true);
  const toLeave = plan.rolesToRelease.filter((r) => r.assignedByBot !== true);

  if (toEmpty.length > 0) {
    embed.addFields({
      name: t.revert.toEmptyRoles({ count: toEmpty.length }),
      value: `${truncate(toEmpty.map((r) => r.name).join(', '))}\n${t.revert.toEmptyRolesDesc}`,
    });
  }

  if (toLeave.length > 0) {
    embed.addFields({
      name: t.revert.toLeaveRoles({ count: toLeave.length }),
      value: `${truncate(toLeave.map((r) => r.name).join(', '))}\n${t.revert.toLeaveRolesDesc}`,
    });
  }

  const unrecorded = [...plan.unrecordedChannels, ...plan.unrecordedRoles];
  if (unrecorded.length > 0) {
    embed.addFields({
      name: t.revert.unrecorded({ count: unrecorded.length }),
      value: [truncate(unrecorded.map((i) => i.name).join(', ')), '', t.revert.unrecordedDesc].join('\n'),
    });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.REVERT, 'confirm', plan.includeUnrecorded ? 1 : 0))
          .setLabel(t.revert.confirmBtn)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.REVERT, 'cancel'))
          .setLabel(t.revert.cancelBtn)
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildRevertReport(report: RevertReport, guildId?: string): string {
  const t = stringsIn(guildId ?? '');
  const lines: string[] = [];

  if (report.deletedRoles.length > 0) {
    lines.push(t.revert.deleted({ roles: report.deletedRoles.join(', ') }));
  }
  if (report.deletedChannels.length > 0) {
    lines.push(t.revert.deletedChannels({ channels: report.deletedChannels.join(', ') }));
  }
  if (report.restoredChannels.length > 0) {
    lines.push(t.revert.restored({ channels: report.restoredChannels.map((c) => `#${c}`).join(', ') }));
  }
  if (report.releasedRoles.length > 0) {
    lines.push(t.revert.released({ roles: report.releasedRoles.join(', ') }));
  }
  if (report.untouchedRoles.length > 0) {
    lines.push(t.revert.untouched({ roles: report.untouchedRoles.join(', ') }));
  }
  lines.push(t.revert.cleared({ count: report.clearedRows }));
  if (report.failures.length > 0) {
    lines.push(t.revert.failures({ items: report.failures.join('; ') }));
  }

  return lines.join('\n');
}

function truncate(value: string, max = 1000): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
