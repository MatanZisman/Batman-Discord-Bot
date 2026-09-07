import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { TIERS } from './config.js';
import * as repo from './db/repo.js';
import { setupGuild } from './core/guild-setup.js';
import { recalculateGuild } from './core/standing-service.js';
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
    ),
].map((command) => command.toJSON());

export async function dispatchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
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
  }
}
