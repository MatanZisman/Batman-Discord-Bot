import { PermissionFlagsBits, type CategoryChannel, type Guild, type GuildChannel } from 'discord.js';
import * as repo from '../db/repo.js';
import { stringsIn } from '../i18n/index.js';
import { logger } from '../lib/logger.js';
import { setupGuild } from './guild-setup.js';

/**
 * ============================================================================
 *  MAINTENANCE MODE
 * ============================================================================
 *  Takes the system off the air without dismantling it. Every rating, every
 *  standing, every provenance record and every open re-review stays exactly
 *  where it is; only the visible surface goes away. Resuming brings the server
 *  back in the state it was paused in.
 *
 *  This is the deliberate opposite of /standing-revert, which exists to remove
 *  the bot and erase its data. Pausing is for a quiet week or a rethink.
 *
 *  HOW IT HIDES
 *  Tier categories and the public channel get a single overwrite denying
 *  @everyone View Channel, and the tier-role allows are stripped so the
 *  cascade cannot grant it back. Roles stay assigned to members, harmlessly:
 *  with nothing to see, a role is just a label, and leaving them in place is
 *  what makes resuming instant rather than a re-assignment run over every
 *  member in the server.
 *
 *  WHAT STAYS VISIBLE
 *  The KING category and channel. This is not an oversight — admin commands
 *  only work inside the KING channel, so hiding it would leave nobody able to
 *  run /standing-admin resume.
 * ============================================================================
 */

export interface MaintenanceReport {
  hidden: string[];
  failures: string[];
}

/** Categories and channels that maintenance mode hides, KING area excluded. */
function memberFacingChannels(guild: Guild): GuildChannel[] {
  const channels: GuildChannel[] = [];
  const settings = repo.getGuildSettings(guild.id);

  for (const tier of repo.getTierRoles(guild.id)) {
    if (!tier.category_id) continue;
    const category = guild.channels.cache.get(tier.category_id);
    if (category) channels.push(category as CategoryChannel);
  }

  if (settings?.rating_channel_id) {
    const hub = guild.channels.cache.get(settings.rating_channel_id);
    if (hub) channels.push(hub as GuildChannel);
  }

  return channels;
}

export async function pauseGuild(guild: Guild): Promise<MaintenanceReport> {
  const report: MaintenanceReport = { hidden: [], failures: [] };
  const everyone = guild.roles.everyone;
  const tierRoleIds = new Set(repo.getTierRoles(guild.id).map((t) => t.role_id));

  for (const channel of memberFacingChannels(guild)) {
    try {
      await channel.permissionOverwrites.edit(
        everyone,
        { ViewChannel: false },
        { reason: 'Community standing paused for maintenance' },
      );

      // Without this the cascade would still let each tier see its own area.
      for (const roleId of tierRoleIds) {
        if (!channel.permissionOverwrites.cache.has(roleId)) continue;
        await channel.permissionOverwrites.edit(
          roleId,
          { ViewChannel: false },
          { reason: 'Community standing paused for maintenance' },
        );
      }

      report.hidden.push(channel.name);
    } catch (error) {
      report.failures.push(`${channel.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  repo.setGuildPaused(guild.id, true);
  repo.audit(guild.id, 'paused', undefined, JSON.stringify(report));
  logger.info(`Standing system paused for guild ${guild.id}`, report);
  return report;
}

/**
 * Brings everything back.
 *
 * Rather than remembering and replaying the old overwrites, this re-runs the
 * normal setup, which is idempotent and rebuilds the cascade from config. That
 * also repairs anything deleted during the downtime and republishes the hub,
 * so a pause doubles as a safe window to reorganise the server.
 */
export async function resumeGuild(guild: Guild): Promise<{ membersInitialised: number }> {
  // Cleared first: setup recalculates standings at the end, and that is a
  // no-op while the guild still reads as paused.
  repo.setGuildPaused(guild.id, false);

  const report = await setupGuild(guild);

  repo.audit(guild.id, 'resumed');
  logger.info(`Standing system resumed for guild ${guild.id}`);
  return { membersInitialised: report.membersInitialised };
}

/**
 * The message member-facing interactions get while paused, or null when the
 * system is running normally.
 */
export function maintenanceNotice(guildId: string | null): string | null {
  if (!guildId || !repo.isGuildPaused(guildId)) return null;
  return stringsIn(guildId).maintenance.notice;
}

/** Permission overwrite bit used above, exported for the tests. */
export const VIEW_CHANNEL = PermissionFlagsBits.ViewChannel;
