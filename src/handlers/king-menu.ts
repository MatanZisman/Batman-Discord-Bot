import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { NS, decodeId, encodeId } from '../lib/custom-ids.js';
import { CREDITS, tierAt, tierIndexByKey } from '../config.js';
import { logAction } from '../core/action-log.js';
import {
  applyAdjustment,
  areaName,
  clearAdjustments,
  describeLiveAdjustments,
  previewSizes,
} from '../core/adjustments.js';
import { publishRatingHub } from '../core/guild-setup.js';
import { applyLanguage } from '../core/language.js';
import { publishKingMenu } from '../core/king-panel.js';
import { pauseGuild, resumeGuild } from '../core/maintenance.js';
import { explainStanding } from '../core/scoring.js';
import { applyTierRoles, evaluateStanding, recalculateGuild, recalculateStanding } from '../core/standing-service.js';
import * as repo from '../db/repo.js';
import { stringsIn } from '../i18n/index.js';
import { LOCALE_LABELS } from '../i18n/locale.js';
import { logger } from '../lib/logger.js';
import { respondPrivately } from '../lib/respond.js';
import { buildAdjustmentPicker, buildMemberPicker } from '../ui/king-menu.js';
import { checkAdminAccess } from './guards.js';

type MenuInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

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
    if (action === 'pick-dm') return showDmModal(interaction, target);
    if (action === 'pick-view-score') return doViewScore(interaction, target);
    return;
  }

  if (interaction.isModalSubmit()) {
    if (action === 'dm-send') return doSendDm(interaction);
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (action === 'adjust-size') return doAdjust(interaction);
    if (action === 'language-pick') return doSetLanguageFromSelect(interaction);
    return;
  }

  switch (action) {
    case 'refresh':
      return doRefresh(interaction);
    case 'recalc':
      return doRecalculate(interaction);
    case 'adjust':
      return respondPrivately(interaction, buildMemberPicker('adjust', guild.id));
    case 'undo':
      return respondPrivately(interaction, buildMemberPicker('undo', guild.id));
    case 'remove':
      return respondPrivately(interaction, buildMemberPicker('remove', guild.id));
    case 'reinstate':
      return respondPrivately(interaction, buildMemberPicker('reinstate', guild.id));
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
    case 'language':
      return doLanguagePicker(interaction);
    case 'view-score':
      return respondPrivately(interaction, buildMemberPicker('view-score', guild.id));
    case 'dm':
      return respondPrivately(interaction, buildMemberPicker('dm', guild.id));
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
  const t = stringsIn(interaction.guild!.id);
  await finish(interaction, t.admin.refreshDone);
}

async function doRecalculate(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  const count = await recalculateGuild(guild);
  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `recalculated ${count} standing(s)`,
  });

  await finish(interaction, t.admin.recalcDone({ count }));
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

  const t = stringsIn(guild.id);

  if (record.participating === 0) {
    await interaction.update({
      content: t.admin.adjustNotParticipating({ mention: `<@${targetId}>` }),
      components: [],
    });
    return;
  }

  await interaction.deferUpdate();

  const previews = await previewSizes(guild, targetId);
  const live = describeLiveAdjustments(guild.id, targetId);

  await interaction.editReply(buildAdjustmentPicker(targetId, previews, live, guild.id));
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

  const t = stringsIn(guild.id);
  const { preview } = outcome;
  const undoStr = preview.reportsToUndo !== null
    ? t.admin.adjustUndoStr({ count: preview.reportsToUndo })
    : '';
  const blockedStr = preview.blockedBy
    ? t.admin.adjustBlockedStr({ reason: preview.blockedBy })
    : '';

  await finish(
    interaction,
    t.admin.adjustApplied({
      mention: `<@${targetId}>`,
      area: areaName(outcome.appliedTierIndex),
      score: preview.projectedScore.toFixed(2),
      from: preview.currentScore.toFixed(2),
      undo: undoStr,
      blocked: blockedStr,
      days: CREDITS.LIFETIME_DAYS,
      reports,
      moved: outcome.moved,
    }),
  );
}

async function doUndo(
  interaction: UserSelectMenuInteraction | StringSelectMenuInteraction,
  targetId: string,
): Promise<void> {
  const guild = interaction.guild!;
  if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();

  const undone = await clearAdjustments(guild, targetId, interaction.user.id);

  const t = stringsIn(guild.id);

  if (undone === 0) {
    await finish(interaction, t.admin.adjustClearedNone({ mention: `<@${targetId}>` }));
    return;
  }

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `took back ${undone} adjustment(s) on <@${targetId}>`,
  });

  await finish(interaction, t.admin.adjustCleared({ mention: `<@${targetId}>`, count: undone }));
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

  const t = stringsIn(guild.id);
  await finish(interaction, t.admin.removeDone({ mention: `<@${targetId}>` }));

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

  const t = stringsIn(guild.id);
  await finish(interaction, t.admin.reinstateDone({ mention: `<@${targetId}>` }));
}

async function doPause(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  const report = await pauseGuild(guild);
  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'paused the standing system for maintenance',
  });

  await finish(
    interaction,
    t.admin.pauseDone({
      hidden: report.hidden.length > 0 ? report.hidden.join(', ') : '',
      failures: report.failures.length > 0 ? `Could not hide: ${report.failures.join('; ')}` : null,
    }),
  );
}

async function doResume(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  try {
    const { membersInitialised } = await resumeGuild(guild);
    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'resumed the standing system',
    });
    await finish(interaction, t.admin.resumeDone({ count: membersInitialised }));
  } catch (error) {
    await finish(
      interaction,
      t.admin.resumeError({ error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

async function doNotice(interaction: ButtonInteraction, on: boolean): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  if (!on) {
    repo.setJoinNoticeActive(guild.id, false);
    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'switched the launch notice off',
    });
    await finish(interaction, t.admin.noticeOff);
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

  await finish(interaction, t.admin.noticeOn({ pending, skipped }));
}

async function doRefreshHub(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild!;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  const settings = repo.getGuildSettings(guild.id);
  const channel = settings?.rating_channel_id
    ? await guild.channels.fetch(settings.rating_channel_id).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    await finish(interaction, t.admin.refreshHubMissing);
    return;
  }

  await publishRatingHub(channel as TextChannel).catch((error) =>
    logger.error('Could not republish the rating hub', error),
  );
  await finish(interaction, t.admin.refreshHubDone({ channel: channel.id }));
}

async function doLanguagePicker(interaction: ButtonInteraction): Promise<void> {
  const t = stringsIn(interaction.guild!.id);

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeId(NS.KING, 'language-pick'))
    .setPlaceholder(t.admin.languageBtn)
    .addOptions(
      Object.entries(LOCALE_LABELS).map(([value, label]) =>
        new StringSelectMenuOptionBuilder().setValue(value).setLabel(label),
      ),
    );

  await interaction.reply({
    content: t.admin.languageBtn,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

async function doSetLanguageFromSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild!;
  const locale = interaction.values[0] ?? 'en';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await applyLanguage(guild, locale);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `changed language to ${locale}`,
  });

  // After language change, stringsIn now returns the new locale
  const t = stringsIn(guild.id);
  await finish(interaction, t.admin.languageSwitched({ label: result.label }));
}

async function showDmModal(interaction: UserSelectMenuInteraction, targetId: string): Promise<void> {
  const t = stringsIn(interaction.guild!.id);

  const modal = new ModalBuilder()
    .setCustomId(encodeId(NS.MENU, 'dm-send', targetId))
    .setTitle(t.admin.dmModalTitle)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('message')
          .setLabel(t.admin.dmModalLabel)
          .setPlaceholder(t.admin.dmModalPlaceholder)
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(2000),
      ),
    );

  await interaction.showModal(modal);
}

async function doViewScore(interaction: UserSelectMenuInteraction, targetId: string): Promise<void> {
  const guild = interaction.guild!;
  const t = stringsIn(guild.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const record = repo.ensureMember(guild.id, targetId);
  if (record.participating === 0) {
    await interaction.editReply({
      content: t.admin.viewScoreOutside({ mention: `<@${targetId}>` }),
      components: [],
    });
    return;
  }

  const { standing } = await evaluateStanding(guild, targetId, record);
  const area = tierAt(standing.tierIndex).roleName;

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `viewed score for <@${targetId}>`,
  });

  await interaction.editReply({
    content: [
      t.admin.viewScoreHeader({ mention: `<@${targetId}>`, area }),
      '',
      explainStanding(standing, guild.id),
      '',
      t.admin.viewScoreNote,
    ].join('\n'),
    components: [],
  });
}

async function doSendDm(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild!;
  const t = stringsIn(guild.id);
  const targetId = decodeId(interaction.customId)?.args[0];
  const message = interaction.fields.getTextInputValue('message').trim();

  if (!targetId) {
    await interaction.reply({ content: t.genericError, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!message) {
    await interaction.reply({ content: t.admin.dmEmpty, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const member = await guild.members.fetch(targetId);
    await member.send(message);

    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: `sent a custom DM to <@${targetId}>`,
    });

    await interaction.editReply({ content: t.admin.dmSent({ mention: `<@${targetId}>` }) });
  } catch (error) {
    logger.warn(`Could not send KING DM to ${targetId} in ${guild.id}`, error);
    await interaction.editReply({ content: t.admin.dmFailed({ mention: `<@${targetId}>` }) });
  }
}
