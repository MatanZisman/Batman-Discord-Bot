import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { CREDITS, tierIndexByKey } from '../config.js';
import { logAction } from '../core/action-log.js';
import {
  applyAdjustment,
  areaName,
  clearAdjustments,
  describeLiveAdjustments,
  previewSizes,
} from '../core/adjustments.js';
import { publishRatingHub } from '../core/guild-setup.js';
import { publishKingMenu } from '../core/king-panel.js';
import { pauseGuild, resumeGuild } from '../core/maintenance.js';
import { applyTierRoles, recalculateGuild, recalculateStanding } from '../core/standing-service.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { respondPrivately } from '../lib/respond.js';
import { buildAdjustmentPicker, buildMemberPicker } from '../ui/king-menu.js';
import { checkAdminAccess } from './guards.js';

type MenuInteraction = ButtonInteraction | StringSelectMenuInteraction | UserSelectMenuInteraction;

/* -------------------------------------------------------------------------- */
/* Routing                                                                    */
/* -------------------------------------------------------------------------- */

export async function routeKingMenu(interaction: MenuInteraction, action: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  // The panel sits in a KING-only channel, but permissions can be edited after
  // the fact, so every press is re-checked rather than trusted for its
  // location. A stale panel in a channel that has been opened up is not a way
  // in.
  const access = checkAdminAccess(interaction);
  if (!access.ok) {
    await interaction.reply({ content: access.message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isUserSelectMenu()) {
    const target = interaction.values[0];
    if (!target) return;
    if (action === 'pick-adjust') return showAdjustmentPicker(interaction, target);
    if (action === 'pick-undo') return doUndo(interaction, target);
    if (action === 'pick-remove') return doRemove(interaction, target);
    if (action === 'pick-reinstate') return doReinstate(interaction, target);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (action === 'adjust-size') return doAdjust(interaction);
    return;
  }

  switch (action) {
    case 'refresh':
      return doRefresh(interaction);
    case 'recalc':
      return doRecalculate(interaction);
    case 'adjust':
      return respondPrivately(interaction, buildMemberPicker('adjust'));
    case 'undo':
      return respondPrivately(interaction, buildMemberPicker('undo'));
    case 'remove':
      return respondPrivately(interaction, buildMemberPicker('remove'));
    case 'reinstate':
      return respondPrivately(interaction, buildMemberPicker('reinstate'));
    case 'pause':
      return doPause(interaction);
    case 'resume':
      return doResume(interaction);
    case 'notice-on':
      return doNotice(interaction, true);
    case 'notice-off':
      return doNotice(interaction, false);
    case 'refresh-hub':
      return doRefreshHub(interaction);
  }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every action below ends by rewriting the panel, so the numbers a KING is
 * looking at always reflect what they just did. The per-action feedback is
 * ephemeral: the panel is shared, and one KING's confirmation message is not
 * something the others need to see.
 */
async function finish(interaction: MenuInteraction, message: string): Promise<void> {
  const guild = interaction.guild;
  if (guild) await publishKingMenu(guild).catch(() => undefined);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message, components: [] });
    return;
  }
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function doRefresh(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await finish(interaction, 'Refreshed.');
}

async function doRecalculate(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const count = await recalculateGuild(guild);
  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `recalculated ${count} standing(s)`,
  });

  await finish(interaction, `Recomputed ${count} standing(s) against the current tuning values.`);
}

/**
 * Prices every offered size against this member before showing the menu.
 *
 * The deferral matters: collecting the votes means fetching each rater from
 * Discord, which can outrun the three-second window on a member with a lot of
 * ratings.
 */
async function showAdjustmentPicker(
  interaction: UserSelectMenuInteraction,
  targetId: string,
): Promise<void> {
  const guild = interaction.guild!;
  const record = repo.ensureMember(guild.id, targetId);

  if (record.participating === 0) {
    await interaction.update({
      content: `<@${targetId}> is outside the standing system, so there is no score to lean on. Reinstate them, or wait for them to join, first.`,
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();

  const previews = await previewSizes(guild, targetId);
  const live = describeLiveAdjustments(guild.id, targetId);

  await interaction.editReply(buildAdjustmentPicker(targetId, previews, live));
}

async function doAdjust(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild!;
  const targetId = interaction.customId.split(':')[2];
  const choice = interaction.values[0];
  if (!targetId || !choice) return;

  await interaction.deferUpdate();

  if (choice === 'clear') return doUndo(interaction, targetId);

  const [rawDirection, rawReports] = choice.split(':');
  const reports = Number(rawReports);
  if ((rawDirection !== 'ease' && rawDirection !== 'push') || Number.isNaN(reports)) return;

  const outcome = await applyAdjustment(
    guild,
    targetId,
    rawDirection,
    reports,
    interaction.user.id,
  );

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `${rawDirection === 'ease' ? 'eased' : 'pushed'} <@${targetId}> by ${reports} report(s)' worth`,
  });

  const { preview } = outcome;
  const undo =
    preview.reportsToUndo !== null
      ? ` **${preview.reportsToUndo}** more report(s) at the top of the scale would put them back.`
      : '';

  await finish(
    interaction,
    [
      `<@${targetId}> is now in **${areaName(outcome.appliedTierIndex)}** at **${preview.projectedScore.toFixed(2)}**, from ${preview.currentScore.toFixed(2)}.${undo}`,
      '',
      `The community score never stopped running, so this can be outvoted rather than waited out. It fades over ${CREDITS.LIFETIME_DAYS} days. ${outcome.moved ? 'They were told their area changed, with no reason given and no mention of who decided.' : 'Their area did not move, so they were told nothing.'}`,
    ].join('\n'),
  );
}

async function doUndo(
  interaction: UserSelectMenuInteraction | StringSelectMenuInteraction,
  targetId: string,
): Promise<void> {
  const guild = interaction.guild!;
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

  const undone = await clearAdjustments(guild, targetId, interaction.user.id);

  if (undone === 0) {
    await finish(interaction, `<@${targetId}> is not carrying any adjustments.`);
    return;
  }

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `took back ${undone} adjustment(s) on <@${targetId}>`,
  });

  const record = repo.getMember(guild.id, targetId);
  await finish(
    interaction,
    `Took back ${undone} adjustment(s). <@${targetId}> is on the community score alone, which puts them in **${record?.tier_key ? areaName(tierIndexByKey(record.tier_key)) : 'their default area'}**.`,
  );
}

async function doRemove(interaction: UserSelectMenuInteraction, targetId: string): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferUpdate();

  repo.ensureMember(guild.id, targetId);
  const affected = repo.suspendVotesInvolving(guild.id, targetId);
  repo.setParticipation(guild.id, targetId, false);
  repo.revokeCreditsFor(guild.id, targetId, interaction.user.id);
  repo.setAdminRemoval(guild.id, targetId, true);
  repo.audit(guild.id, 'admin_remove', targetId);

  const member = await guild.members.fetch(targetId).catch(() => null);
  if (member) await applyTierRoles(guild, member, null);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `removed <@${targetId}> from the standing system`,
  });

  await finish(
    interaction,
    `<@${targetId}> is out and cannot rejoin themselves. Their ratings are suspended rather than deleted, so reinstating puts things back as they were.`,
  );

  for (const id of affected) {
    recalculateStanding(guild, id).catch(() => undefined);
  }
}

async function doReinstate(interaction: UserSelectMenuInteraction, targetId: string): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferUpdate();

  repo.ensureMember(guild.id, targetId);
  repo.setAdminRemoval(guild.id, targetId, false);
  repo.audit(guild.id, 'admin_reinstate', targetId);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `reinstated <@${targetId}>`,
  });

  await finish(
    interaction,
    `<@${targetId}> can rejoin whenever they choose to. They stay outside the system until they press Join, and their suspended ratings resume then.`,
  );
}

async function doPause(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const report = await pauseGuild(guild);
  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'paused the standing system for maintenance',
  });

  await finish(
    interaction,
    [
      `**Paused.** Hidden: ${report.hidden.length > 0 ? report.hidden.join(', ') : 'nothing needed hiding'}.`,
      report.failures.length > 0 ? `Could not hide: ${report.failures.join('; ')}` : null,
      '',
      'Every rating and standing is untouched. This channel stays visible so you can resume.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function doResume(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { membersInitialised } = await resumeGuild(guild);
    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'resumed the standing system',
    });
    await finish(
      interaction,
      `**Back up.** ${membersInitialised} member(s) re-checked. Standings are exactly what they were before the pause, and anything deleted during the downtime was rebuilt.`,
    );
  } catch (error) {
    await finish(
      interaction,
      `Could not resume: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function doNotice(interaction: ButtonInteraction, on: boolean): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!on) {
    repo.setJoinNoticeActive(guild.id, false);
    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'switched the launch notice off',
    });
    await finish(
      interaction,
      'Off. Nobody else will be messaged, and everyone already told stays told, so switching it back on will not repeat anyone.',
    );
    return;
  }

  const skipped = repo.skipNoticeForExistingUsers(guild.id);
  repo.setJoinNoticeActive(guild.id, true);
  const pending = repo.countPendingNotices(guild.id);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'switched the launch notice on',
  });

  await finish(
    interaction,
    [
      `**On.** ${pending} member(s) will each get one private DM, the first time they join a voice channel from now on.`,
      skipped > 0
        ? `${skipped} were skipped because they have already rated someone or already opted out.`
        : null,
      'Nobody is messaged twice, including across restarts.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function doRefreshHub(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = repo.getGuildSettings(guild.id);
  const channel = settings?.rating_channel_id
    ? await guild.channels.fetch(settings.rating_channel_id).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    await finish(interaction, 'I could not find the public channel. Run `/standing-setup` instead.');
    return;
  }

  await publishRatingHub(channel as TextChannel).catch((error) =>
    logger.error('Could not republish the rating hub', error),
  );
  await finish(interaction, `Reposted the explanation and buttons in <#${channel.id}>.`);
}
