import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { COMMANDS } from '../commands.js';
import { logger } from '../lib/logger.js';

/**
 * Standalone command registration, for when you want to push a command change
 * without restarting the bot: `npm run register`.
 */
const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildIds = (process.env.DISCORD_GUILD_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

if (!token || !clientId) {
  logger.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

if (guildIds.length === 0) {
  await rest.put(Routes.applicationCommands(clientId), { body: COMMANDS });
  logger.info(`Registered ${COMMANDS.length} global commands (may take up to an hour to appear).`);
} else {
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS });
    logger.info(`Registered ${COMMANDS.length} commands in guild ${guildId}.`);
  }
}
