import { ChannelType, REST, Routes, type Guild, type TextChannel } from 'discord.js';
import { isLocale, LOCALE_LABELS } from '../i18n/locale.js';
import * as repo from '../db/repo.js';
import { publishRatingHub } from './guild-setup.js';
import { publishKingMenu } from './king-panel.js';
import { logger } from '../lib/logger.js';

/**
 * Stores the new locale for the guild and refreshes every persistent Discord
 * message that embeds bot-authored text: the pinned rating hub and the pinned
 * KING control panel.
 *
 * What is NOT refreshed here:
 *  - Past DMs (tier-change, arrival, voice-join) — those are one-shot sends
 *    with no edit path, and members do not need the backlog updated.
 *  - The action log history in #kings-log — append-only, never edited.
 *  - Open challenge messages — only the active buttons matter and they are
 *    identified by challenge id, not by text, so language does not affect them.
 *
 * All ephemeral replies (handlers, commands) use stringsIn() at call time and
 * so automatically use the new locale without any refresh step here.
 */
export async function applyLanguage(guild: Guild, locale: string): Promise<{ ok: boolean; label: string }> {
  if (!isLocale(locale)) {
    return { ok: false, label: locale };
  }

  repo.setGuildLocale(guild.id, locale);

  const settings = repo.getGuildSettings(guild.id);
  const label = LOCALE_LABELS[locale];

  // Re-register slash commands with the new locale's descriptions.
  // We import lazily to avoid a circular dependency chain at module load time.
  try {
    const { buildCommands } = await import('../commands.js');
    const botToken = process.env.DISCORD_BOT_TOKEN ?? '';
    const appId = guild.client.application?.id ?? '';
    if (botToken && appId) {
      const commands = buildCommands(locale);
      const rest = new REST({ version: '10' }).setToken(botToken);
      await rest.put(Routes.applicationGuildCommands(appId, guild.id), { body: commands });
      // Reset the fingerprint so the next startup does not skip re-registration.
      repo.setState(`commands:${appId}:${guild.id}`, '');
    }
  } catch (error) {
    logger.warn(`Could not re-register commands after language change in ${guild.id}`, error);
  }

  // Republish the pinned rating-hub (buildRatingHubMessage reads locale via stringsIn)
  if (settings?.rating_channel_id) {
    const ch = await guild.channels.fetch(settings.rating_channel_id).catch(() => null);
    if (ch?.type === ChannelType.GuildText) {
      await publishRatingHub(ch as TextChannel).catch((error) =>
        logger.warn(`Could not republish rating hub after language change in ${guild.id}`, error),
      );
    }
  }

  // Republish the KING control panel (buildKingMenuMessage reads locale via stringsIn)
  await publishKingMenu(guild).catch((error) =>
    logger.warn(`Could not republish KING panel after language change in ${guild.id}`, error),
  );

  return { ok: true, label };
}
