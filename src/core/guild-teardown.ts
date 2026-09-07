import {
  ChannelType,
  PermissionsBitField,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import { SERVER_LAYOUT, TIERS } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { findOwnPinnedMessage } from './guild-setup.js';

/**
 * ============================================================================
 *  UNDOING EVERYTHING
 * ============================================================================
 *  The inverse of setupGuild. The goal is "as if the bot had never been here",
 *  which is not the same as "delete everything named in the config" — a server
 *  may well have had a #general or a Green role before the bot arrived, and
 *  deleting those would be far worse than leaving the system in place.
 *
 *  So /standing-setup records provenance for every role, category and channel
 *  it touches (see the provisioned_items table), and this module splits its
 *  work in two:
 *
 *    created by the bot  -> deleted
 *    adopted by the bot  -> restored to its previous parent and permissions
 *
 *  Then every database row for the guild is erased.
 *
 *  ---------------------------------------------------------------------------
 *  WHEN THE RECORD IS MISSING
 *  ---------------------------------------------------------------------------
 *  Provenance can be absent: the database was reset, the server was set up by
 *  an older build, or someone recreated a channel by hand. `includeUnrecorded`
 *  covers that by additionally matching anything in the server against the
 *  names in config.ts.
 *
 *  That mode cannot tell "the bot made this" from "this happened to have the
 *  same name", so it is opt-in, it lists every match by name for the operator
 *  to read before confirming, and it refuses to touch channels Discord itself
 *  depends on (system, rules, community updates) or roles it could not delete
 *  anyway (integration-managed, or above the bot in the hierarchy).
 * ============================================================================
 */

export interface PlannedItem {
  id: string;
  name: string;
  kind: repo.ProvisionedKind;
}

export interface RevertPlan {
  /** Recorded as created by the bot, so they get deleted. */
  rolesToDelete: PlannedItem[];
  channelsToDelete: PlannedItem[];
  /** Recorded as pre-existing, so they get handed back instead. */
  channelsToRestore: PlannedItem[];
  rolesToRelease: PlannedItem[];
  /** Name matches the config but there is no record. Only with includeUnrecorded. */
  unrecordedRoles: PlannedItem[];
  unrecordedChannels: PlannedItem[];
  /** Recorded items that no longer exist in Discord. */
  alreadyGone: number;
  includeUnrecorded: boolean;
}

export interface RevertReport {
  deletedRoles: string[];
  deletedChannels: string[];
  restoredChannels: string[];
  releasedRoles: string[];
  clearedRows: number;
  failures: string[];
}

export interface RevertOptions {
  includeUnrecorded?: boolean;
}

export function planIsEmpty(plan: RevertPlan): boolean {
  return (
    plan.rolesToDelete.length === 0 &&
    plan.channelsToDelete.length === 0 &&
    plan.channelsToRestore.length === 0 &&
    plan.rolesToRelease.length === 0 &&
    plan.unrecordedRoles.length === 0 &&
    plan.unrecordedChannels.length === 0
  );
}

/**
 * Works out what a revert would do without doing any of it, so the operator
 * gets an accurate confirmation prompt rather than a generic warning.
 */
export function planRevert(guild: Guild, options: RevertOptions = {}): RevertPlan {
  const plan: RevertPlan = {
    rolesToDelete: [],
    channelsToDelete: [],
    channelsToRestore: [],
    rolesToRelease: [],
    unrecordedRoles: [],
    unrecordedChannels: [],
    alreadyGone: 0,
    includeUnrecorded: options.includeUnrecorded === true,
  };

  const recorded = new Set<string>();

  for (const item of repo.listProvisionedItems(guild.id)) {
    recorded.add(item.discord_id);

    const exists =
      item.kind === 'role'
        ? guild.roles.cache.has(item.discord_id)
        : guild.channels.cache.has(item.discord_id);

    if (!exists) {
      plan.alreadyGone += 1;
      continue;
    }

    const entry: PlannedItem = { id: item.discord_id, name: item.name, kind: item.kind };

    if (item.kind === 'role') {
      if (item.created_by_bot === 1) plan.rolesToDelete.push(entry);
      else plan.rolesToRelease.push(entry);
      continue;
    }

    if (item.created_by_bot === 1) plan.channelsToDelete.push(entry);
    else plan.channelsToRestore.push(entry);
  }

  if (plan.includeUnrecorded) {
    collectUnrecorded(guild, recorded, plan);
  }

  return plan;
}

/** Every role and channel name setupGuild is capable of producing. */
function configuredNames(): { roles: Set<string>; categories: Set<string>; channels: Set<string> } {
  return {
    roles: new Set([SERVER_LAYOUT.kingRoleName, ...TIERS.map((t) => t.roleName)]),
    categories: new Set([SERVER_LAYOUT.adminCategoryName, ...TIERS.map((t) => t.categoryName)]),
    // Text channel names are stored lowercased by Discord; voice names are not.
    channels: new Set([
      SERVER_LAYOUT.ratingChannelName.toLowerCase(),
      SERVER_LAYOUT.kingChannelName.toLowerCase(),
      SERVER_LAYOUT.kingMenuChannelName.toLowerCase(),
      // Servers set up before the admin area was split still have this one.
      SERVER_LAYOUT.legacyKingChannelName.toLowerCase(),
      ...TIERS.flatMap((t) =>
        t.channels.map((c) => (c.kind === 'text' ? c.name.toLowerCase() : c.name)),
      ),
    ]),
  };
}

function collectUnrecorded(guild: Guild, recorded: Set<string>, plan: RevertPlan): void {
  const names = configuredNames();

  // Deleting any of these would damage the server itself, so they are never
  // candidates no matter what they are called.
  const protectedChannels = new Set(
    [guild.systemChannelId, guild.rulesChannelId, guild.publicUpdatesChannelId, guild.widgetChannelId].filter(
      (id): id is string => Boolean(id),
    ),
  );

  const botHighestPosition = guild.members.me?.roles.highest.position ?? 0;

  for (const role of guild.roles.cache.values()) {
    if (recorded.has(role.id)) continue;
    if (role.id === guild.roles.everyone.id) continue;
    if (!names.roles.has(role.name)) continue;
    // Integration roles cannot be deleted, and anything at or above the bot in
    // the hierarchy would fail with a permissions error.
    if (role.managed || role.position >= botHighestPosition) continue;

    plan.unrecordedRoles.push({ id: role.id, name: role.name, kind: 'role' });
  }

  for (const channel of guild.channels.cache.values()) {
    if (recorded.has(channel.id)) continue;
    if (protectedChannels.has(channel.id)) continue;

    if (channel.type === ChannelType.GuildCategory && names.categories.has(channel.name)) {
      plan.unrecordedChannels.push({ id: channel.id, name: channel.name, kind: 'category' });
      continue;
    }

    if (channel.type === ChannelType.GuildText && names.channels.has(channel.name)) {
      plan.unrecordedChannels.push({ id: channel.id, name: `#${channel.name}`, kind: 'channel' });
      continue;
    }

    if (channel.type === ChannelType.GuildVoice && names.channels.has(channel.name)) {
      plan.unrecordedChannels.push({ id: channel.id, name: `🔊 ${channel.name}`, kind: 'channel' });
    }
  }
}

export async function revertGuild(guild: Guild, options: RevertOptions = {}): Promise<RevertReport> {
  const report: RevertReport = {
    deletedRoles: [],
    deletedChannels: [],
    restoredChannels: [],
    releasedRoles: [],
    clearedRows: 0,
    failures: [],
  };

  const plan = planRevert(guild, options);
  const items = repo.listProvisionedItems(guild.id);
  const byId = new Map(items.map((item) => [item.discord_id, item]));

  /* 1. Take the pinned hub message out of any channel we are keeping ----- */
  for (const entry of plan.channelsToRestore) {
    const channel = guild.channels.cache.get(entry.id);
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    const mine = await findOwnPinnedMessage(channel as TextChannel).catch(() => null);
    await mine?.delete().catch(() => undefined);
  }

  /* 2. Restore adopted channels and categories --------------------------- */
  for (const entry of plan.channelsToRestore) {
    const channel = guild.channels.cache.get(entry.id);
    const item = byId.get(entry.id);
    if (!channel || !item) continue;

    try {
      await restoreChannel(channel, item);
      report.restoredChannels.push(entry.name);
    } catch (error) {
      report.failures.push(`could not restore ${entry.name}: ${describe(error)}`);
    }
  }

  /* 3. Delete channels, leaves before the categories holding them -------- */
  const toDelete = [...plan.channelsToDelete, ...plan.unrecordedChannels];
  const ordered = [
    ...toDelete.filter((i) => i.kind === 'channel'),
    ...toDelete.filter((i) => i.kind === 'category'),
  ];

  for (const entry of ordered) {
    const channel = guild.channels.cache.get(entry.id);
    if (!channel) continue;

    try {
      await channel.delete('Community standing revert');
      report.deletedChannels.push(entry.name);
    } catch (error) {
      report.failures.push(`could not delete ${entry.name}: ${describe(error)}`);
    }
  }

  /* 4. Delete our roles -------------------------------------------------- */
  for (const entry of [...plan.rolesToDelete, ...plan.unrecordedRoles]) {
    const role = guild.roles.cache.get(entry.id);
    if (!role) continue;

    try {
      await role.delete('Community standing revert');
      report.deletedRoles.push(entry.name);
    } catch (error) {
      report.failures.push(`could not delete role ${entry.name}: ${describe(error)}`);
    }
  }

  /* 5. Hand back roles that predate us, but empty them ------------------- */
  for (const entry of plan.rolesToRelease) {
    const role = guild.roles.cache.get(entry.id);
    if (!role) continue;

    // The role is not ours to delete. Its current membership is ours though,
    // because the bot has been assigning and removing it wholesale, so
    // clearing it is closer to "never touched" than leaving it in place.
    for (const member of role.members.values()) {
      await member.roles.remove(role, 'Community standing revert').catch(() => undefined);
    }
    report.releasedRoles.push(entry.name);
  }

  /* 6. Forget the guild entirely ----------------------------------------- */
  report.clearedRows = repo.clearGuildData(guild.id);

  logger.info(`Reverted guild ${guild.id}`, report);
  return report;
}

async function restoreChannel(channel: GuildBasedChannel, item: repo.ProvisionedItem): Promise<void> {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildCategory) return;

  const target = channel as TextChannel | CategoryChannel;

  if (item.previous_overwrites) {
    const stored = JSON.parse(item.previous_overwrites) as repo.StoredOverwrite[];
    const overwrites: OverwriteResolvable[] = stored.map((o) => ({
      id: o.id,
      type: o.type,
      allow: new PermissionsBitField(BigInt(o.allow)),
      deny: new PermissionsBitField(BigInt(o.deny)),
    }));
    await target.permissionOverwrites.set(overwrites, 'Community standing revert');
  }

  if (target.type === ChannelType.GuildText) {
    // previous_parent_id is null when the channel sat outside any category.
    await target.setParent(item.previous_parent_id, { lockPermissions: false });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
