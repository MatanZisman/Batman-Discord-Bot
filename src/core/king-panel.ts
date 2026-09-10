import { ChannelType, type Guild, type Message, type TextChannel } from 'discord.js';
import * as repo from '../db/repo.js';
import { buildKingMenuMessage } from '../ui/king-menu.js';
import { collectAdminStats } from './king-stats.js';

/**
 * Writes the KING control panel into the menu channel.
 *
 * Lives in core rather than alongside its button handlers because setup needs
 * to publish the panel and the handlers need to republish it after every
 * action — putting it in the handler module would make it and guild-setup
 * import each other.
 *
 * The panel is deliberately one message that gets edited in place: the channel
 * is a control surface, not a history, and a fresh post per refresh would bury
 * the thing you came to press.
 */
export async function publishKingMenu(guild: Guild): Promise<void> {
  const settings = repo.getGuildSettings(guild.id);
  if (!settings?.king_menu_channel_id) return;

  const channel = await guild.channels.fetch(settings.king_menu_channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const text = channel as TextChannel;
  const payload = buildKingMenuMessage(guild.id, collectAdminStats(guild.id), settings.king_channel_id);
  const existing = await findOwnPanel(text);

  if (existing) {
    await existing.edit(payload).catch(() => undefined);
    return;
  }

  const message = await text.send(payload);
  await message.pin().catch(() => undefined);
}

async function findOwnPanel(channel: TextChannel): Promise<Message | null> {
  const pins = await channel.messages.fetchPins().catch(() => null);
  const pinned = pins?.items.find((pin) => pin.message.author.id === channel.client.user?.id);
  if (pinned) return pinned.message;

  // Unpinned by someone: fall back to our most recent message so a refresh
  // edits it instead of posting a second panel underneath.
  const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  return recent?.find((m) => m.author.id === channel.client.user?.id) ?? null;
}
