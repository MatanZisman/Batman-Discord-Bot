import {
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildMemberRoleManager,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';
import { SERVER_LAYOUT } from '../config.js';
import * as repo from '../db/repo.js';

type AnyGuildInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction;

export type GuardResult = { ok: true } | { ok: false; message: string };

/** True when the caller holds the KING role. */
export function hasKingRole(interaction: AnyGuildInteraction): boolean {
  const settings = interaction.guildId ? repo.getGuildSettings(interaction.guildId) : undefined;
  if (!settings?.king_role_id) return false;

  const roles = interaction.member?.roles as GuildMemberRoleManager | string[] | undefined;
  if (!roles) return false;
  if (Array.isArray(roles)) return roles.includes(settings.king_role_id);
  return roles.cache.has(settings.king_role_id);
}

function hasManageGuild(interaction: AnyGuildInteraction): boolean {
  if (typeof interaction.memberPermissions?.has !== 'function') return false;
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Gate for the server-wide commands: /standing-setup, /standing-revert and
 * /standing-admin.
 *
 * Two conditions, both of which have a deliberate escape hatch:
 *
 *   WHO   The caller needs the KING role, or Manage Server. The second is not
 *         a loophole but a bootstrap: on a fresh install the KING role exists
 *         but nobody holds it yet, so without this the owner could never run
 *         anything. It is also the recovery path if the KING role is deleted.
 *
 *   WHERE Once the admin channels exist, these commands only work inside
 *         them, so administration never happens in front of the members. Both
 *         the log and the menu channel count: the menu is where the buttons
 *         live, and the log is where someone reading history will reach for a
 *         command. The first /standing-setup is necessarily exempt, because it
 *         is the thing that creates those channels.
 */
export function checkAdminAccess(interaction: AnyGuildInteraction): GuardResult {
  if (!interaction.guildId) {
    return { ok: false, message: 'That only works inside a server.' };
  }

  if (!hasKingRole(interaction) && !hasManageGuild(interaction)) {
    return {
      ok: false,
      message: `Only the ${SERVER_LAYOUT.kingRoleName} role can do that. (Members with Manage Server can too, so the role can always be handed out again.)`,
    };
  }

  const settings = repo.getGuildSettings(interaction.guildId);
  const allowed = [settings?.king_menu_channel_id, settings?.king_channel_id].filter(
    (id): id is string => Boolean(id),
  );

  if (allowed.length > 0 && !allowed.includes(interaction.channelId ?? '')) {
    const preferred = settings?.king_menu_channel_id ?? settings?.king_channel_id;
    return {
      ok: false,
      message: `Administration happens in <#${preferred}>, out of sight of the members. Run this there instead — most of it is buttons on the pinned panel, so you rarely need the commands at all.`,
    };
  }

  return { ok: true };
}
