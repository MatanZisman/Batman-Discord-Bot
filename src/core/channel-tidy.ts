import { ChannelType, type Guild, type TextChannel } from 'discord.js';
import { CLEANUP, MINUTE_MS } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';

/**
 * ============================================================================
 *  KEEPING THE PUBLIC CHANNEL CLEAN
 * ============================================================================
 *  Worth knowing before reading further: the rating channel stays clean mostly
 *  on its own. Members cannot post in it (SendMessages is denied to @everyone
 *  in the setup overwrites), and every reply the bot gives them is ephemeral —
 *  ephemeral messages are never written to channel history, so the thousands
 *  of ratings and button presses this channel will see leave no trace to sweep.
 *
 *  So this exists for the litter that *does* accumulate:
 *
 *    - Discord's own "Batman pinned a message to this channel" system notices,
 *      one per pin, which nobody can turn off.
 *    - A duplicate guide, if the pin is ever removed: publishRatingHub posts a
 *      fresh message when it cannot find its own pinned one.
 *    - Anything posted by an Administrator, whose permissions bypass the
 *      channel's SendMessages denial entirely.
 *
 *  THE RULE IS DELIBERATELY SIMPLE: pinned stays, everything else goes. It is
 *  easy to explain, it cannot accidentally eat the guide, and it gives anyone
 *  who wants a lasting notice in here a one-click way to protect it.
 * ============================================================================
 */

/**
 * Deletes unpinned messages from a guild's rating channel.
 *
 * Safe to call repeatedly; returns how many messages it removed.
 */
export async function tidyRatingChannel(guild: Guild): Promise<number> {
  if (!CLEANUP.RATING_CHANNEL_ENABLED) return 0;

  const settings = repo.getGuildSettings(guild.id);
  if (!settings?.rating_channel_id) return 0;

  const channel = await guild.channels.fetch(settings.rating_channel_id).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return 0;

  const text = channel as TextChannel;
  const me = guild.members.me;
  if (!me || !text.permissionsFor(me).has('ManageMessages')) {
    logger.debug(`No Manage Messages in #${text.name}; skipping tidy.`);
    return 0;
  }

  const messages = await text.messages.fetch({ limit: CLEANUP.MESSAGES_PER_PASS }).catch(() => null);
  if (!messages) return 0;

  const cutoff = Date.now() - CLEANUP.MIN_AGE_MINUTES * MINUTE_MS;
  const doomed = messages.filter((message) => {
    if (message.pinned) return false;
    if (message.createdTimestamp > cutoff) return false;
    return message.deletable;
  });

  if (doomed.size === 0) return 0;

  let removed = 0;

  // bulkDelete cannot touch anything over 14 days old. The `true` flag makes
  // it skip those rather than reject the whole batch, and the leftovers are
  // then deleted one at a time.
  const bulk = await text.bulkDelete(doomed, true).catch((error) => {
    logger.warn(`Bulk delete failed in #${text.name}`, error);
    return null;
  });
  removed += bulk?.size ?? 0;

  for (const [id, message] of doomed) {
    if (bulk?.has(id)) continue;
    await message.delete().catch(() => undefined);
    removed += 1;
  }

  if (removed > 0) logger.debug(`Tidied ${removed} message(s) from #${text.name}`);
  return removed;
}
