import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { NS, encodeId } from '../lib/custom-ids.js';
import { planIsEmpty, type RevertPlan, type RevertReport } from '../core/guild-teardown.js';

/**
 * A destructive command deserves an accurate prompt rather than a scary one,
 * so this lists the exact roles and channels involved and separates the two
 * outcomes: things that get deleted, and things that get handed back.
 */
export function buildRevertConfirmation(plan: RevertPlan): BaseMessageOptions {
  if (planIsEmpty(plan)) {
    return {
      content: plan.includeUnrecorded
        ? 'There is nothing to revert. No roles or channels here match the names in the config, and I have no record of creating anything.'
        : [
            'There is nothing on record to revert.',
            '',
            'If the server clearly does have my roles and channels, my record of creating them is missing — most likely the database was reset, or the server was set up by an earlier build.',
            'Run `/standing-revert include-unrecorded:true` and I will match on the names in the config instead.',
          ].join('\n'),
      components: [],
    };
  }

  const embed = new EmbedBuilder()
    .setTitle('Remove the standing system from this server?')
    .setColor(0xed4245)
    .setDescription(
      'This puts the server back the way it was found. Anything the bot created is deleted; anything it merely borrowed is handed back untouched.',
    );

  if (plan.channelsToDelete.length > 0) {
    embed.addFields({
      name: `Channels to delete (${plan.channelsToDelete.length})`,
      value: truncate(plan.channelsToDelete.map((c) => c.name).join(', ')),
    });
  }

  if (plan.rolesToDelete.length > 0) {
    embed.addFields({
      name: `Roles to delete (${plan.rolesToDelete.length})`,
      value: truncate(plan.rolesToDelete.map((r) => r.name).join(', ')),
    });
  }

  if (plan.channelsToRestore.length > 0) {
    embed.addFields({
      name: `Kept and restored (${plan.channelsToRestore.length})`,
      value: `${truncate(
        plan.channelsToRestore.map((c) => `#${c.name}`).join(', '),
      )}\nThese existed before the bot arrived, so they keep their messages and go back to their original category and permissions.`,
    });
  }

  if (plan.rolesToRelease.length > 0) {
    embed.addFields({
      name: `Roles kept but cleared (${plan.rolesToRelease.length})`,
      value: `${truncate(
        plan.rolesToRelease.map((r) => r.name).join(', '),
      )}\nThese existed before the bot arrived. The role stays, but it is taken off every member, since its membership was the bot's doing.`,
    });
  }

  const unrecorded = [...plan.unrecordedChannels, ...plan.unrecordedRoles];
  if (unrecorded.length > 0) {
    embed.addFields({
      name: `⚠ Name matches, but not on my record (${unrecorded.length})`,
      value: [
        truncate(unrecorded.map((i) => i.name).join(', ')),
        '',
        'These will be **deleted**. I have no record of creating them, so I cannot tell whether they are mine or simply share a name with something in my config. Read this list carefully — if anything here predates the bot and you want to keep it, cancel and rename it first.',
      ].join('\n'),
    });
  }

  embed.addFields({
    name: 'Also erased',
    value:
      'Every rating, standing, and open re-review for this server. This is not recoverable — there is no undo and no export.',
  });

  if (plan.alreadyGone > 0) {
    embed.setFooter({ text: `${plan.alreadyGone} recorded item(s) are already gone and will be skipped.` });
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.REVERT, 'confirm', plan.includeUnrecorded ? 1 : 0))
          .setLabel('Yes, remove everything')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.REVERT, 'cancel'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildRevertReport(report: RevertReport): string {
  const lines = [
    '**Done. The server is back to how it was.**',
    '',
    `Deleted ${report.deletedChannels.length} channel(s) and ${report.deletedRoles.length} role(s).`,
  ];

  if (report.restoredChannels.length > 0) {
    lines.push(`Restored ${report.restoredChannels.map((c) => `#${c}`).join(', ')} to their original setup.`);
  }

  if (report.releasedRoles.length > 0) {
    lines.push(`Left ${report.releasedRoles.join(', ')} in place but took them off every member.`);
  }

  lines.push(`Erased ${report.clearedRows} database row(s). No ratings or standings remain.`);

  if (report.failures.length > 0) {
    lines.push(
      '',
      `**${report.failures.length} thing(s) needed manual cleanup:**`,
      ...report.failures.map((f) => `• ${f}`),
      '',
      'The usual cause is my role sitting below something I was asked to delete.',
    );
  } else {
    lines.push('', 'You can run `/standing-setup` again any time to start fresh.');
  }

  return lines.join('\n');
}

function truncate(value: string, max = 1000): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
