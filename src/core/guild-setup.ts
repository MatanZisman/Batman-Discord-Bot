import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildChannel,
  type Message,
  type OverwriteResolvable,
  type Role,
  type TextChannel,
} from 'discord.js';
import { SERVER_LAYOUT, TIERS, type ChannelSpec } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { buildRatingHubMessage } from '../ui/rating-hub.js';
import { recalculateGuild } from './standing-service.js';

/**
 * Provisions (or repairs) everything the standing system needs in a server.
 *
 * Safe to run repeatedly: every step looks for an existing role/channel by
 * name first, so re-running after you rename something in config.ts fills in
 * the gaps rather than duplicating the server.
 *
 * It never touches a channel that already existed outside its own categories.
 * No "White" category is created and nothing is moved: every channel the server
 * already had keeps its place and its permissions, which is exactly what makes
 * those channels white by default.
 *
 * ---------------------------------------------------------------------------
 *  THE VISIBILITY CASCADE
 * ---------------------------------------------------------------------------
 *  Each tier gets a category, and the category denies View Channel to
 *  @everyone then allows it for that tier plus every cleaner tier:
 *
 *      Green category   -> Green
 *      Yellow category  -> Green, Yellow
 *      Orange category  -> Green, Yellow, Orange
 *      Red category     -> Green, Yellow, Orange, Red
 *
 *  So a Green player can see the whole server, a Red player sees only the Red
 *  area, and nobody can see "upward". Channels are created with permissions
 *  synced to their category, which means moving a player between tiers is a
 *  single role swap and Discord does the rest.
 * ---------------------------------------------------------------------------
 */

export interface SetupReport {
  createdRoles: string[];
  createdChannels: string[];
  repaired: string[];
  ratingChannelId: string;
  kingRoleId: string;
  membersInitialised: number;
}

/** Snapshots a channel's permission overwrites so revert can restore them. */
function snapshotOverwrites(channel: GuildChannel): repo.StoredOverwrite[] {
  return channel.permissionOverwrites.cache.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  }));
}

async function findOrCreateRole(
  guild: Guild,
  name: string,
  options: { color?: number; report: SetupReport },
): Promise<Role> {
  const existing = guild.roles.cache.find((r) => r.name === name);
  if (existing) {
    options.report.repaired.push(`role ${name}`);
    repo.recordProvisionedItem({
      guildId: guild.id,
      kind: 'role',
      discordId: existing.id,
      name,
      createdByBot: false,
    });
    return existing;
  }

  const role = await guild.roles.create({
    name,
    colors: options.color === undefined ? undefined : { primaryColor: options.color },
    // Anti-shaming: tier roles are not hoisted into their own member-list
    // section and cannot be @mentioned, so standing is never on display.
    hoist: false,
    mentionable: false,
    reason: 'Community standing setup',
  });

  options.report.createdRoles.push(name);
  repo.recordProvisionedItem({
    guildId: guild.id,
    kind: 'role',
    discordId: role.id,
    name,
    createdByBot: true,
  });
  return role;
}

async function findOrCreateCategory(
  guild: Guild,
  name: string,
  overwrites: OverwriteResolvable[],
  report: SetupReport,
): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (c): c is CategoryChannel => c.type === ChannelType.GuildCategory && c.name === name,
  );

  if (existing) {
    // Capture the old permissions before we overwrite them.
    repo.recordProvisionedItem({
      guildId: guild.id,
      kind: 'category',
      discordId: existing.id,
      name,
      createdByBot: false,
      previousOverwrites: snapshotOverwrites(existing),
    });

    await existing.permissionOverwrites.set(overwrites, 'Community standing setup');
    report.repaired.push(`category ${name}`);
    return existing;
  }

  const category = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    permissionOverwrites: overwrites,
    reason: 'Community standing setup',
  });

  report.createdChannels.push(name);
  repo.recordProvisionedItem({
    guildId: guild.id,
    kind: 'category',
    discordId: category.id,
    name,
    createdByBot: true,
  });
  return category;
}

/**
 * Creates the channels a tier's category should contain.
 *
 * Lookups are scoped to the category rather than the whole server, which
 * matters for two reasons: every tier has its own channel with the same name
 * (#הודעות), and a spec can ask for several channels sharing a name (two
 * "Comp" rooms). A global name search would collapse all of those together.
 *
 * Channels already sitting in the category are adopted rather than duplicated,
 * so re-running setup repairs instead of piling up.
 */
async function ensureCategoryChannels(
  guild: Guild,
  category: CategoryChannel,
  specs: ChannelSpec[],
  report: SetupReport,
): Promise<void> {
  for (const spec of specs) {
    const wantedType = spec.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
    // Discord lowercases text channel names, so match the way it will store it.
    const storedName = spec.kind === 'text' ? spec.name.toLowerCase() : spec.name;

    const existing = [...category.children.cache.values()].filter(
      (child) => child.type === wantedType && child.name === storedName,
    );

    const wanted = spec.count ?? 1;

    for (let index = 0; index < wanted; index++) {
      const found = existing[index];

      if (found) {
        repo.recordProvisionedItem({
          guildId: guild.id,
          kind: 'channel',
          discordId: found.id,
          name: spec.kind === 'text' ? `#${storedName}` : storedName,
          createdByBot: false,
          previousParentId: found.parentId,
          previousOverwrites: snapshotOverwrites(found),
        });

        // Keep the voice cap in line with the config on a repair run.
        if (spec.kind === 'voice' && found.type === ChannelType.GuildVoice) {
          const limit = spec.userLimit ?? 0;
          if (found.userLimit !== limit) {
            await found.setUserLimit(limit, 'Community standing setup').catch(() => undefined);
          }
        }

        report.repaired.push(`channel ${storedName}`);
        continue;
      }

      const channel = await guild.channels.create({
        name: spec.name,
        type: wantedType,
        parent: category.id,
        userLimit: spec.kind === 'voice' ? (spec.userLimit ?? 0) : undefined,
        reason: 'Community standing setup',
      });

      // Inherit the category's cascade rather than carrying its own copy, so
      // moving a member between tiers is a single role swap.
      await channel.lockPermissions().catch(() => undefined);

      report.createdChannels.push(spec.kind === 'text' ? `#${channel.name}` : channel.name);
      repo.recordProvisionedItem({
        guildId: guild.id,
        kind: 'channel',
        discordId: channel.id,
        name: spec.kind === 'text' ? `#${channel.name}` : channel.name,
        createdByBot: true,
      });
    }
  }
}

/**
 * The single public channel: read-only, visible to everyone, holding the
 * explanation and the buttons that start the private flows.
 *
 * It deliberately has no parent category. The bot does not create a "White"
 * category and does not move anything that already exists — every channel the
 * server already had keeps its category and its permissions untouched.
 */
async function ensurePublicChannel(guild: Guild, report: SetupReport): Promise<TextChannel> {
  const name = SERVER_LAYOUT.ratingChannelName;
  const everyone = guild.roles.everyone;
  const me = guild.members.me;

  // Readable by all, writable by nobody but the bot. Members interact through
  // buttons and every reply they get is ephemeral, so there is never a public
  // message about anybody's standing in here.
  const overwrites: OverwriteResolvable[] = [
    {
      id: everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];

  if (me) {
    overwrites.push({
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  const existing = guild.channels.cache.find(
    (c): c is TextChannel => c.type === ChannelType.GuildText && c.name === name.toLowerCase(),
  );

  if (existing) {
    repo.recordProvisionedItem({
      guildId: guild.id,
      kind: 'channel',
      discordId: existing.id,
      name: `#${existing.name}`,
      createdByBot: false,
      previousParentId: existing.parentId,
      previousOverwrites: snapshotOverwrites(existing),
    });

    await existing.permissionOverwrites.set(overwrites, 'Community standing setup');
    report.repaired.push(`channel #${existing.name}`);
    return existing;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
    topic: 'How the community standing system works. Everything you do here is private to you.',
    reason: 'Community standing setup',
  });

  report.createdChannels.push(`#${channel.name}`);
  repo.recordProvisionedItem({
    guildId: guild.id,
    kind: 'channel',
    discordId: channel.id,
    name: `#${channel.name}`,
    createdByBot: true,
  });
  return channel;
}

/** The private KING channel, used for challenge reports and the action log. */
async function ensureKingChannel(
  guild: Guild,
  category: CategoryChannel,
  report: SetupReport,
): Promise<TextChannel> {
  const name = SERVER_LAYOUT.kingChannelName;

  const existing = [...category.children.cache.values()].find(
    (child): child is TextChannel =>
      child.type === ChannelType.GuildText && child.name === name.toLowerCase(),
  );

  if (existing) {
    repo.recordProvisionedItem({
      guildId: guild.id,
      kind: 'channel',
      discordId: existing.id,
      name: `#${existing.name}`,
      createdByBot: false,
      previousParentId: existing.parentId,
      previousOverwrites: snapshotOverwrites(existing),
    });
    report.repaired.push(`channel #${existing.name}`);
    return existing;
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    reason: 'Community standing setup',
  });
  await channel.lockPermissions().catch(() => undefined);

  report.createdChannels.push(`#${channel.name}`);
  repo.recordProvisionedItem({
    guildId: guild.id,
    kind: 'channel',
    discordId: channel.id,
    name: `#${channel.name}`,
    createdByBot: true,
  });
  return channel;
}

export async function setupGuild(guild: Guild): Promise<SetupReport> {
  const report: SetupReport = {
    createdRoles: [],
    createdChannels: [],
    repaired: [],
    ratingChannelId: '',
    kingRoleId: '',
    membersInitialised: 0,
  };

  const everyone = guild.roles.everyone;

  /* 1. Roles ------------------------------------------------------------- */
  const kingRole = await findOrCreateRole(guild, SERVER_LAYOUT.kingRoleName, { report });

  const tierRoles: Role[] = [];
  for (const tier of TIERS) {
    tierRoles.push(await findOrCreateRole(guild, tier.roleName, { color: tier.color, report }));
  }

  /* 2. The one public channel -------------------------------------------- */
  // Left outside any category so that nothing about the server's existing
  // structure has to change. Opted-out members can still read it and rejoin.
  const ratingChannel = await ensurePublicChannel(guild, report);
  report.ratingChannelId = ratingChannel.id;
  report.kingRoleId = kingRole.id;

  /* 3. Tier areas with the cascading overwrites -------------------------- */
  for (const [index, tier] of TIERS.entries()) {
    const allowedRoles = tierRoles.slice(0, index + 1); // this tier plus all cleaner ones

    const overwrites: OverwriteResolvable[] = [
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      ...allowedRoles.map((role) => ({
        id: role.id,
        allow: [PermissionFlagsBits.ViewChannel],
      })),
    ];

    const category = await findOrCreateCategory(guild, tier.categoryName, overwrites, report);
    await ensureCategoryChannels(guild, category, tier.channels, report);

    const roleId = tierRoles[index]?.id;
    if (roleId) repo.setTierRole(guild.id, tier.key, roleId, category.id);
  }

  /* 4. KING review area -------------------------------------------------- */
  const kingCategory = await findOrCreateCategory(
    guild,
    SERVER_LAYOUT.adminCategoryName,
    [
      { id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: kingRole.id, allow: [PermissionFlagsBits.ViewChannel] },
    ],
    report,
  );
  const kingChannel = await ensureKingChannel(guild, kingCategory, report);

  /* 5. Persist + publish the hub ---------------------------------------- */
  repo.saveGuildSettings({
    guild_id: guild.id,
    rating_channel_id: ratingChannel.id,
    king_role_id: kingRole.id,
    king_channel_id: kingChannel.id,
  });

  await publishRatingHub(ratingChannel);

  // Everyone already in the server needs their starting role, or the cascade
  // would leave existing members locked out of the tier areas entirely.
  report.membersInitialised = await recalculateGuild(guild);

  repo.audit(guild.id, 'setup', undefined, JSON.stringify(report));
  logger.info(`Setup complete for guild ${guild.id}`, report);
  return report;
}

/**
 * Posts (or refreshes) the pinned instructions message in the rating channel.
 * Everything a member needs is reachable from its buttons, so nobody has to
 * remember slash commands.
 */
export async function publishRatingHub(channel: TextChannel): Promise<void> {
  const payload = buildRatingHubMessage();
  const mine = await findOwnPinnedMessage(channel);

  if (mine) {
    await mine.edit(payload);
    return;
  }

  const message = await channel.send(payload);
  await message.pin().catch(() => undefined);
}

/** The bot's own pinned hub message, if it is already there. */
export async function findOwnPinnedMessage(channel: TextChannel): Promise<Message | null> {
  const pins = await channel.messages.fetchPins().catch(() => null);
  return pins?.items.find((pin) => pin.message.author.id === channel.client.user?.id)?.message ?? null;
}
