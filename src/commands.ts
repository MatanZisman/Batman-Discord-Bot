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

/**
 * Slash command surface. Deliberately small: everything a normal member needs
 * is also reachable from the buttons on the pinned message in the rating
 * channel, so nobody has to memorise commands.
 */
const GUILD_ONLY = [InteractionContextType.Guild];

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName('rate')
    .setDescription('Privately rate the players you have been playing with')
    .setContexts(GUILD_ONLY),

  new SlashCommandBuilder()
    .setName('my-standing')
    .setDescription('See your own standing. Only you can see the reply.')
    .setContexts(GUILD_ONLY),

  new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Ask the people who rated you to take another look')
    .setContexts(GUILD_ONLY),

  new SlashCommandBuilder()
    .setName('participation')
    .setDescription('Join or leave the community standing system')
    .setContexts(GUILD_ONLY),

  /*
   * The three admin commands below deliberately carry no
   * setDefaultMemberPermissions. Discord's own gate can only test built-in
   * permissions, and a KING is a plain role — gating on Manage Server would
   * hide these commands from the very people who are supposed to run them.
   * checkAdminAccess() enforces the real rule instead: KING role (or Manage
   * Server), inside the KING channel.
   */
  new SlashCommandBuilder()
    .setName('standing-setup')
    .setDescription('Create or repair the roles, categories and permissions this system needs')
    .setContexts(GUILD_ONLY),

  new SlashCommandBuilder()
    .setName('standing-revert')
    .setDescription('Undo everything this bot created and erase all its data for this server')
    .setContexts(GUILD_ONLY)
    .addBooleanOption((option) =>
      option
        .setName('include-unrecorded')
        .setDescription('Also delete roles and channels matching my config that I have no record of creating'),
    ),

  new SlashCommandBuilder()
    .setName('standing-admin')
    .setDescription('Maintenance tools')
    .setContexts(GUILD_ONLY)
    .addSubcommand((sub) =>
      sub
        .setName('recalculate')
        .setDescription('Recompute every standing, e.g. after changing the tuning values'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('distribution')
        .setDescription('How many members sit in each area. Counts only, never names.'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('adjust')
        .setDescription("Lean on a member's score without taking it over")
        .addUserOption((o) => o.setName('user').setDescription('Who to adjust').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('direction')
            .setDescription('Which way to lean, or undo what is already there')
            .setRequired(true)
            .addChoices(
              { name: 'ease off — argue the community has been harsh', value: 'ease' },
              { name: 'push down — argue the community has been generous', value: 'push' },
              { name: 'undo — take back every adjustment on them', value: 'clear' },
            ),
        )
        .addIntegerOption((o) =>
          o
            .setName('reports')
            .setDescription(
              `How many reports' worth. Defaults to ${CREDITS.OFFERED_SIZES[1] ?? 5}. Ignored when undoing.`,
            )
            .setMinValue(1)
            .setMaxValue(CREDITS.MAX_REPORTS_PER_GRANT),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a member from the system. They cannot rejoin themselves.')
        .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reinstate')
        .setDescription('Undo a removal, letting the member choose to rejoin')
        .addUserOption((o) => o.setName('user').setDescription('Who to reinstate').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('pause')
        .setDescription('Hide the system for maintenance. Keeps every rating and standing.'),
    )
    .addSubcommand((sub) =>
      sub.setName('resume').setDescription('Bring the system back after a pause'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('refresh-hub')
        .setDescription('Repost the pinned explanation and buttons in the public channel'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('notice')
        .setDescription('The one-time DM telling each member the system exists')
        .addStringOption((o) =>
          o
            .setName('action')
            .setDescription('Turn it on, turn it off, or see how far it has got')
            .setRequired(true)
            .addChoices(
              { name: 'on — start telling people on their first voice join', value: 'on' },
              { name: 'off — stop telling anyone new', value: 'off' },
              { name: 'status — how many are still to be told', value: 'status' },
            ),
        ),
    ),
].map((command) => command.toJSON());

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

  try {
    const report = await setupGuild(interaction.guild);

    logAction(interaction.guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'ran the server setup',
    });

    const lines = [
      '**Setup complete.**',
      report.createdRoles.length > 0 ? `Created roles: ${report.createdRoles.join(', ')}` : null,
      report.createdChannels.length > 0
        ? `Created channels: ${report.createdChannels.join(', ')}`
        : null,
      report.repaired.length > 0 ? `Reused existing: ${report.repaired.length} item(s)` : null,
      `Gave a starting role to ${report.membersInitialised} member(s).`,
      '',
      `Members read the rules and rate each other in <#${report.ratingChannelId}>.`,
      'Channels that already existed were left exactly as they were — no category moves, no permission changes.',
      `Make sure my role sits **above** ${TIERS.map((t) => t.roleName).join(', ')} in Server Settings → Roles, or I cannot assign them.`,
    ].filter(Boolean);

    await interaction.editReply(lines.join('\n'));
  } catch (error) {
    await interaction.editReply(
      `Setup failed: ${error instanceof Error ? error.message : String(error)}\n\nCheck that I have Manage Roles and Manage Channels.`,
    );
  }
}

async function runAdmin(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const sub = interaction.options.getSubcommand();

  if (sub === 'recalculate') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const count = await recalculateGuild(interaction.guild);

    logAction(interaction.guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: `recalculated ${count} standing(s)`,
    });

    await interaction.editReply(`Recomputed ${count} standing(s) against the current tuning values.`);
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

    const lines = TIERS.map((tier) => `${tier.roleName}: **${counts.get(tier.key) ?? 0}**`);
    await interaction.reply({
      content: [
        '**Where the server currently sits**',
        ...lines,
        '',
        'Counts only. There is no command, for anyone, that lists which members are where.',
      ].join('\n'),
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

  if (action === 'status') {
    const activeAt = repo.getJoinNoticeActiveAt(guild.id);
    const pending = repo.countPendingNotices(guild.id);

    await interaction.editReply(
      activeAt
        ? [
            `**On** since <t:${Math.floor(activeAt / 1000)}:F>.`,
            `${pending} member(s) are still to be told, and will be on their next voice join.`,
            '',
            'Anyone whose DMs are closed is retried the next day rather than written off, so this number can fall slowly.',
          ].join('\n')
        : `**Off.** Nobody is being told. ${pending} member(s) have never received the notice.`,
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
    await interaction.editReply(
      'Off. Nobody else will be messaged. Everyone already told stays told, so switching it back on will not repeat anyone.',
    );
    return;
  }

  const alreadyKnown = repo.skipNoticeForExistingUsers(guild.id);
  repo.setJoinNoticeActive(guild.id, true);
  const pending = repo.countPendingNotices(guild.id);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'switched the launch notice on',
  });

  await interaction.editReply(
    [
      '**On.**',
      `${pending} member(s) will each get one private DM, the first time they join a voice channel from now on.`,
      alreadyKnown > 0
        ? `${alreadyKnown} member(s) were skipped because they have already rated someone or already chose to opt out — they know it exists.`
        : null,
      '',
      'Nobody is messaged twice, including across restarts and redeploys. Nobody is messaged for joining the AFK channel, and nobody is messaged while the system is paused.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
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

  const record = repo.ensureMember(guild.id, user.id);
  if (record.participating === 0) {
    await interaction.editReply(
      `${user} is outside the standing system, so there is no score to lean on. Reinstate them, or ask them to join, first.`,
    );
    return;
  }

  if (direction === 'clear') {
    const undone = await clearAdjustments(guild, user.id, interaction.user.id);

    if (undone === 0) {
      await interaction.editReply(`${user} is not carrying any adjustments.`);
      return;
    }

    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: `took back ${undone} adjustment(s) on <@${user.id}>`,
    });

    await interaction.editReply(
      `Took back ${undone} adjustment(s). ${user} is on the community score alone.`,
    );
    return;
  }

  if (direction !== 'ease' && direction !== 'push') {
    await interaction.editReply('That is not one of the directions.');
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
  const undo =
    preview.reportsToUndo !== null
      ? `\n\nIt would take **${preview.reportsToUndo}** fresh report(s) at the top of the scale to put them back where they were — the community can overrule this, it does not have to wait it out.`
      : '';

  const blocked = preview.blockedBy
    ? `\n\n**Their area did not move, and will not on this alone:** ${preview.blockedBy}. Adjustments move the score and never the headcount or consensus gates, so pressure cannot place somebody the community has not actually rated. The score is recorded and takes effect once enough real people have weighed in.`
    : '';

  await interaction.editReply(
    [
      `${user} is now in **${areaName(outcome.appliedTierIndex)}** at **${preview.projectedScore.toFixed(2)}**, from ${preview.currentScore.toFixed(2)}.${undo}${blocked}`,
      '',
      `The adjustment is ${reports} report(s)' worth of signal, not a placement: every real rating still counts, and this fades out over ${CREDITS.LIFETIME_DAYS} days. ${outcome.moved ? 'They have been told their area changed, privately, with no reason given and no mention of who decided it.' : 'Their area did not move, so they were told nothing.'}`,
    ].join('\n'),
  );
}

async function runRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

  await interaction.editReply(
    [
      `${user} is out of the standing system and cannot rejoin themselves.`,
      '',
      'Every rating involving them is suspended rather than deleted, so `/standing-admin reinstate` puts things back as they were.',
    ].join('\n'),
  );

  for (const targetId of affected) {
    recalculateStanding(guild, targetId).catch(() => undefined);
  }
}

async function runReinstate(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const user = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
  await interaction.editReply(
    `${user} can rejoin again whenever they choose to. They are still outside the system until they press Join, and any suspended ratings resume at that point.`,
  );
}

async function runPause(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const report = await pauseGuild(guild);

  logAction(guild, {
    kind: 'admin',
    actorId: interaction.user.id,
    summary: 'paused the standing system for maintenance',
  });

  await interaction.editReply(
    [
      '**Paused.**',
      report.hidden.length > 0 ? `Hidden: ${report.hidden.join(', ')}` : 'Nothing needed hiding.',
      report.failures.length > 0 ? `Could not hide: ${report.failures.join('; ')}` : null,
      '',
      'Every rating, standing and open re-review is untouched, and member commands now say the system is down for maintenance. This channel stays visible so you can run `/standing-admin resume`.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

async function runResume(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const { membersInitialised } = await resumeGuild(guild);

    logAction(guild, {
      kind: 'admin',
      actorId: interaction.user.id,
      summary: 'resumed the standing system',
    });

    await interaction.editReply(
      [
        '**Back up.**',
        `Channels are visible again and ${membersInitialised} member(s) have been re-checked against their standing.`,
        '',
        'Standings are exactly what they were before the pause. Anything deleted during the downtime was rebuilt, and the pinned explanation was reposted.',
      ].join('\n'),
    );
  } catch (error) {
    await interaction.editReply(
      `Could not resume: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function runRefreshHub(interaction: ChatInputCommandInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const settings = repo.getGuildSettings(guild.id);
  const channel = settings?.rating_channel_id
    ? await guild.channels.fetch(settings.rating_channel_id).catch(() => null)
    : null;

  if (!channel?.isTextBased()) {
    await interaction.editReply('I could not find the public channel. Run `/standing-setup` instead.');
    return;
  }

  await publishRatingHub(channel as TextChannel);
  await interaction.editReply(`Reposted the explanation and buttons in <#${channel.id}>.`);
}
