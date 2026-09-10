import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import { CREDITS, TIERS } from './config.js';
import { applyAdjustment, areaName, clearAdjustments } from './core/adjustments.js';
import * as repo from './db/repo.js';
import { publishRatingHub, setupGuild } from './core/guild-setup.js';
import { publishKingMenu } from './core/king-panel.js';
import { maintenanceNotice, pauseGuild, resumeGuild } from './core/maintenance.js';
import { applyTierRoles, recalculateGuild, recalculateStanding } from './core/standing-service.js';
import { handleOpenChallenge } from './handlers/challenge.js';
import { showParticipationMenu } from './handlers/participation.js';
import { showOwnStanding, startRatingSession } from './handlers/rating.js';
import { showRevertConfirmation } from './handlers/revert.js';
import { checkAdminAccess } from './handlers/guards.js';
import { logAction } from './core/action-log.js';

import { stringsFor, stringsIn, type Locale } from './i18n/index.js';

/**
 * Slash command surface. Deliberately small: everything a normal member needs
 * is also reachable from the buttons on the pinned message in the rating
 * channel, so nobody has to memorise commands.
 */
const GUILD_ONLY = [InteractionContextType.Guild];

/**
 * Builds the command array with descriptions from the given locale.
 * Command *names* are always English (they are the Discord identifiers and
 * must never change). Only descriptions are locale-aware.
 *
 * Used when registering commands for a specific guild after a language change.
 */
export function buildCommands(locale: Locale): ReturnType<typeof buildCommandsFor> {
  return buildCommandsFor(locale);
}

function buildCommandsFor(locale: Locale): object[] {
  const d = stringsFor(locale).commandDescs;
  const CREDITS_DEFAULT = CREDITS.OFFERED_SIZES[1] ?? 5;

  return [
    new SlashCommandBuilder()
      .setName('rate')
      .setDescription(d.rate)
      .setContexts(GUILD_ONLY),

    new SlashCommandBuilder()
      .setName('my-standing')
      .setDescription(d.myStanding)
      .setContexts(GUILD_ONLY),

    new SlashCommandBuilder()
      .setName('challenge')
      .setDescription(d.challenge)
      .setContexts(GUILD_ONLY),

    new SlashCommandBuilder()
      .setName('participation')
      .setDescription(d.participation)
      .setContexts(GUILD_ONLY),

    new SlashCommandBuilder()
      .setName('standing-setup')
      .setDescription(d.standingSetup)
      .setContexts(GUILD_ONLY)
      .addStringOption((o) =>
        o
          .setName('language')
          .setDescription(d.standingSetupLanguage)
          .addChoices(
            { name: d.standingSetupLanguageEn, value: 'en' },
            { name: d.standingSetupLanguageHe, value: 'he' },
          ),
      ),

    new SlashCommandBuilder()
      .setName('standing-revert')
      .setDescription(d.standingRevert)
      .setContexts(GUILD_ONLY)
      .addBooleanOption((option) =>
        option
          .setName('include-unrecorded')
          .setDescription(d.standingRevertInclude),
      ),

    new SlashCommandBuilder()
      .setName('standing-admin')
      .setDescription(d.standingAdmin)
      .setContexts(GUILD_ONLY)
      .addSubcommand((sub) =>
        sub.setName('recalculate').setDescription(d.adminRecalculate),
      )
      .addSubcommand((sub) =>
        sub.setName('distribution').setDescription(d.adminDistribution),
      )
      .addSubcommand((sub) =>
        sub
          .setName('adjust')
          .setDescription(d.adminAdjust)
          .addUserOption((o) => o.setName('user').setDescription(d.adminAdjustUser).setRequired(true))
          .addStringOption((o) =>
            o
              .setName('direction')
              .setDescription(d.adminAdjustDirection)
              .setRequired(true)
              .addChoices(
                { name: d.adminAdjustEase, value: 'ease' },
                { name: d.adminAdjustPush, value: 'push' },
                { name: d.adminAdjustUndo, value: 'clear' },
              ),
          )
          .addIntegerOption((o) =>
            o
              .setName('reports')
              .setDescription(d.adminAdjustReports({ def: CREDITS_DEFAULT }))
              .setMinValue(1)
              .setMaxValue(50),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription(d.adminRemove)
          .addUserOption((o) => o.setName('user').setDescription(d.adminRemoveUser).setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub
          .setName('reinstate')
          .setDescription(d.adminReinstate)
          .addUserOption((o) => o.setName('user').setDescription(d.adminReinstateUser).setRequired(true)),
      )
      .addSubcommand((sub) =>
        sub.setName('pause').setDescription(d.adminPause),
      )
      .addSubcommand((sub) =>
        sub.setName('resume').setDescription(d.adminResume),
      )
      .addSubcommand((sub) =>
        sub.setName('refresh-hub').setDescription(d.adminRefreshHub),
      )
      .addSubcommand((sub) =>
        sub
          .setName('notice')
          .setDescription(d.adminNotice)
          .addStringOption((o) =>
            o
              .setName('action')
              .setDescription(d.adminNoticeAction)
              .setRequired(true)
              .addChoices(
                { name: d.adminNoticeOn, value: 'on' },
                { name: d.adminNoticeOff, value: 'off' },
                { name: d.adminNoticeStatus, value: 'status' },
              ),
          ),
      ),
  ].map((c) => c.toJSON());
}

/**
 * Default (English) command definitions, used at startup when guild locale is
 * not yet known or is English. For other locales, buildCommands(locale) is
 * called during per-guild registration.
 */
export const COMMANDS = buildCommandsFor('en');


const MEMBER_COMMANDS = new Set(['rate', 'my-standing', 'challenge', 'participation']);

export async function dispatchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  // Admin commands keep working while paused; that is how you unpause.
  if (MEMBER_COMMANDS.has(interaction.commandName)) {
    const notice = maintenanceNotice(interaction.guildId);
    if (notice) {
      await interaction.reply({ content: notice, flags: MessageFlags.Ephemeral });
      return;
    }
  }

  switch (interaction.commandName) {
    case 'rate': {
      if (await wrongChannel(interaction)) return;
      await startRatingSession(interaction);
      return;
    }
    case 'my-standing':
      await showOwnStanding(interaction);
      return;
    case 'challenge':
      await handleOpenChallenge(interaction);
      return;
    case 'participation':
      await showParticipationMenu(interaction);
      return;
    // The three server-wide commands share one gate: KING role (or Manage
    // Server), and only inside the KING channel once that channel exists.
    case 'standing-setup':
    case 'standing-revert':
    case 'standing-admin': {
      const access = checkAdminAccess(interaction);
      if (!access.ok) {
        await interaction.reply({ content: access.message, flags: MessageFlags.Ephemeral });
        return;
      }

      if (interaction.commandName === 'standing-setup') await runSetup(interaction);
      else if (interaction.commandName === 'standing-revert') await showRevertConfirmation(interaction);
      else await runAdmin(interaction);

      // The commands and the pinned panel are two views of the same state, so
      // anything done by command is reflected on the panel straight away.
      if (interaction.guild && interaction.commandName === 'standing-admin') {
        await publishKingMenu(interaction.guild).catch(() => undefined);
      }
      return;
    }
    default:
      await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
  }
}

/**
 * Keeps the rating conversation in its own channel when one is configured, so
 * that a stray `/rate` in a public channel does not create the impression that
 * ratings happen in the open.
 */
async function wrongChannel(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const settings = interaction.guildId ? repo.getGuildSettings(interaction.guildId) : undefined;
  if (!settings?.rating_channel_id) return false;
  if (interaction.channelId === settings.rating_channel_id) return false;

  await interaction.reply({
    content: `Ratings happen in <#${settings.rating_channel_id}>. Everything there is private to you.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function runSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Persist language selection before setup runs, so publishRatingHub and
  // publishKingMenu pick up the right locale.
  const rawLang = interaction.options.getString('language');
  if (rawLang && interaction.guild) {
    repo.setGuildLocale(interaction.guild.id, rawLang);
  }

  try {
    const report = await setupGuild(interaction.guild);
    const t = stringsIn(interaction.guild.id);

    logAction(interaction.guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'ran the server setup',
    });

    const lines = [
      t.setup.done,
      report.createdRoles.length > 0 ? t.setup.createdRoles({ names: report.createdRoles.join(', ') }) : null,
      report.createdChannels.length > 0 ? t.setup.createdChannels({ names: report.createdChannels.join(', ') }) : null,
      report.repaired.length > 0 ? t.setup.reused({ count: report.repaired.length }) : null,
      t.setup.initialised({ count: report.membersInitialised }),
      '',
      t.setup.ratingChannel({ channel: report.ratingChannelId }),
      t.setup.existing,
      t.setup.roleOrder({ roles: TIERS.map((t2) => t2.roleName).join(', ') }),
    ].filter(Boolean);

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    const t = stringsIn(interaction.guild.id);
    await interaction.editReply(
      t.setup.error({ message: error instanceof Error ? error.message : String(error) }),
    );
  }
}

async function runAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();

  const t2 = stringsIn(interaction.guild.id);

  if (sub === 'recalculate') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const count = await recalculateGuild(interaction.guild);

    logAction(interaction.guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: `recalculated ${count} standing(s)`,
    });

    await interaction.editReply(t2.admin.recalcDone({ count }));
    return;
  }

  if (sub === 'distribution') {
    const members = repo.listParticipatingMembers(interaction.guild.id);
    const counts = new Map<string, number>();
    for (const tier of TIERS) counts.set(tier.key, 0);
    for (const member of members) {
      const key = member.tier_key ?? TIERS[0]?.key ?? 'green';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const lines = TIERS.map((tier) => `${tier.roleName}: **${counts.get(tier.key) ?? 0}**`).join('\n');
    await interaction.reply({
      content: t2.admin.distribution({ lines }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'adjust') await runAdjust(interaction);
  else if (sub === 'remove') await runRemove(interaction);
  else if (sub === 'reinstate') await runReinstate(interaction);
  else if (sub === 'pause') await runPause(interaction);
  else if (sub === 'resume') await runResume(interaction);
  else if (sub === 'refresh-hub') await runRefreshHub(interaction);
  else if (sub === 'notice') await runNotice(interaction);
}

/**
 * Arms, disarms or reports on the one-time launch DM.
 *
 * Switching it on is an explicit act rather than something setup does, because
 * it starts sending messages to real people: you want the pinned explanation
 * in place and the channels looking right *before* anyone is pointed at them.
 */
async function runNotice(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const action = interaction.options.getString('action', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const t = stringsIn(guild.id);

  if (action === 'status') {
    const activeAt = repo.getJoinNoticeActiveAt(guild.id);
    const pending = repo.countPendingNotices(guild.id);

    await interaction.editReply(
      activeAt
        ? t.admin.noticeStatus({ ts: Math.floor(activeAt / 1000), pending })
        : t.admin.noticeStatusOff({ pending }),
    );
    return;
  }

  if (action === 'off') {
    repo.setJoinNoticeActive(guild.id, false);
    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'switched the launch notice off',
    });
    await interaction.editReply(t.admin.noticeOff);
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

  await interaction.editReply(t.admin.noticeOn({ pending, skipped }));
}

/**
 * Leans on a member's score without taking it over.
 *
 * The command is the same mechanism as the panel button, deliberately — there
 * is exactly one way a moderator influences a standing, and it is measured in
 * reports. What the command adds is a free choice of size, for the cases the
 * three offered presets do not fit.
 */
async function runAdjust(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const user = interaction.options.getUser('user', true);
  const direction = interaction.options.getString('direction', true);
  const reports = interaction.options.getInteger('reports') ?? CREDITS.OFFERED_SIZES[1] ?? 5;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const t = stringsIn(guild.id);
  const record = repo.ensureMember(guild.id, user.id);
  if (record.participating === 0) {
    await interaction.editReply(t.admin.adjustNotParticipating({ mention: `<@${user.id}>` }));
    return;
  }

  if (direction === 'clear') {
    const undone = await clearAdjustments(guild, user.id, interaction.user.id);

    if (undone === 0) {
      await interaction.editReply(t.admin.adjustClearedNone({ mention: `<@${user.id}>` }));
      return;
    }

    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: `took back ${undone} adjustment(s) on <@${user.id}>`,
    });

    await interaction.editReply(t.admin.adjustCleared({ mention: `<@${user.id}>`, count: undone }));
    return;
  }

  if (direction !== 'ease' && direction !== 'push') {
    await interaction.editReply(t.admin.adjustBadDirection);
    return;
  }

  const outcome = await applyAdjustment(
    guild,
    user.id,
    direction,
    reports,
    interaction.user.id,
  );

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `${direction === 'ease' ? 'eased' : 'pushed'} <@${user.id}> by ${reports} report(s)' worth`,
  });

  const { preview } = outcome;
  const undoStr = preview.reportsToUndo !== null
    ? t.admin.adjustUndoStr({ count: preview.reportsToUndo })
    : '';
  const blockedStr = preview.blockedBy
    ? t.admin.adjustBlockedStr({ reason: preview.blockedBy })
    : '';

  await interaction.editReply(
    t.admin.adjustApplied({
      mention: `<@${user.id}>`,
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

async function runRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  repo.ensureMember(guild.id, user.id);

  // Same suspension the member's own opt-out uses, so a removal that is later
  // undone does not silently wipe the ratings involved.
  const affected = repo.suspendVotesInvolving(guild.id, user.id);
  repo.setParticipation(guild.id, user.id, false);
  repo.revokeCreditsFor(guild.id, user.id, interaction.user.id);
  repo.setAdminRemoval(guild.id, user.id, true);
  repo.audit(guild.id, 'admin_remove', user.id);

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member) await applyTierRoles(guild, member, null);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `removed <@${user.id}> from the standing system`,
  });

  await interaction.editReply(t.admin.removeDone({ mention: `<@${user.id}>` }));

  for (const targetId of affected) {
    recalculateStanding(guild, targetId).catch(() => undefined);
  }
}

async function runReinstate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  repo.ensureMember(guild.id, user.id);
  repo.setAdminRemoval(guild.id, user.id, false);
  repo.audit(guild.id, 'admin_reinstate', user.id);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: `reinstated <@${user.id}>`,
  });

  // Left opted out on purpose: taking part is the member's choice, so the
  // block is lifted and they decide whether to walk back through the door.
  await interaction.editReply(t.admin.reinstateDone({ mention: `<@${user.id}>` }));
}

async function runPause(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);
  const report = await pauseGuild(guild);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'paused the standing system for maintenance',
  });

  await interaction.editReply(
    t.admin.pauseDone({
      hidden: report.hidden.length > 0 ? report.hidden.join(', ') : '',
      failures: report.failures.length > 0 ? `Could not hide: ${report.failures.join('; ')}` : null,
    }),
  );
}

async function runResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  try {
    const { membersInitialised } = await resumeGuild(guild);

    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'resumed the standing system',
    });

    await interaction.editReply(t.admin.resumeDone({ count: membersInitialised }));
  } catch (error) {
    await interaction.editReply(
      t.admin.resumeError({ error: error instanceof Error ? error.message : String(error) }),
    );
  }
}

async function runRefreshHub(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const t = stringsIn(guild.id);

  const settings = repo.getGuildSettings(guild.id);
  const channel = settings?.rating_channel_id
    ? await guild.channels.fetch(settings.rating_channel_id).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    await interaction.editReply(t.admin.refreshHubMissing);
    return;
  }

  await publishRatingHub(channel as TextChannel);
  await interaction.editReply(t.admin.refreshHubDone({ channel: channel.id }));
}
