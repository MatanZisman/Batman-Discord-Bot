import 'dotenv/config';
import { createHash } from 'node:crypto';
import {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type GuildMember,
} from 'discord.js';
import { COMMANDS } from './commands.js';
import { flushAllLogs } from './core/action-log.js';
import { isFreshVoiceJoin, maybeSendJoinNotice } from './core/join-notice.js';
import { recalculateStanding } from './core/standing-service.js';
import { closeDatabase, openDatabase } from './db/index.js';
import * as repo from './db/repo.js';
import { routeInteraction } from './interactions.js';
import { startSweeper } from './jobs/sweeper.js';
import { logger } from './lib/logger.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  logger.error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required. Copy .env.example to .env.');
  process.exit(1);
}

try {
  openDatabase();
} catch (error) {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    // Privileged: needed to assign tier roles and to read how long someone has
    // been in the server, which the scoring engine uses to dampen new accounts.
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages,
    // Not privileged, so it needs no approval. Used for one thing only: the
    // one-time launch notice, sent on a member's first voice join.
    GatewayIntentBits.GuildVoiceStates,
  ],
  // Challenge replies arrive from DM channels the bot has never cached.
  partials: [Partials.Channel],
});

client.once(Events.ClientReady, async (ready) => {
  logger.info(`Signed in as ${ready.user.tag}`);

  await registerCommands(token, clientId, [...ready.guilds.cache.keys()]);
  startSweeper(ready);

  logger.info(`Watching ${ready.guilds.cache.size} guild(s)`);
});

client.on(Events.InteractionCreate, (interaction) => {
  void routeInteraction(interaction);
});

// New members start in the first tier with a clean slate.
client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
  repo.ensureMember(member.guild.id, member.id, member.joinedTimestamp ?? Date.now());
  await recalculateStanding(member.guild, member.id, { notifyUser: false }).catch((error) =>
    logger.error(`Could not initialise standing for ${member.id}`, error),
  );
});

// Someone who leaves stops influencing other people's standings, so everyone
// they rated needs a fresh look.
client.on(Events.GuildMemberRemove, async (member) => {
  const guild = member.guild;
  for (const vote of repo.getVotesByRater(guild.id, member.id)) {
    await recalculateStanding(guild, vote.target_id, { notifyUser: false }).catch(() => undefined);
  }
});

// Someone arriving in voice is the trigger for their one-and-only "the system
// exists" DM. Everything that decides whether they are actually due one lives
// in maybeSendJoinNotice.
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (!isFreshVoiceJoin(oldState, newState)) return;

  const member = newState.member;
  const channelId = newState.channelId;
  if (!member || !channelId) return;

  void maybeSendJoinNotice(member, channelId).catch((error) =>
    logger.error(`Launch notice failed for ${member.id}`, error),
  );
});

client.on(Events.Error, (error) => logger.error('Gateway error', error));

/**
 * Pushes the command definitions to Discord, but only when they have actually
 * changed since the last boot.
 *
 * On a hosting platform this runs again on every deploy, every crash restart
 * and every dyno recycle, none of which usually change a single command. The
 * fingerprint keeps those boots free: no wasted calls against Discord's daily
 * command-write budget, and a faster startup. Set FORCE_COMMAND_REGISTRATION
 * to push regardless, which is the way back if commands are ever removed on
 * Discord's side without the definitions here changing.
 */
async function registerCommands(botToken: string, appId: string, guildIds: string[]): Promise<void> {
  const configured = (process.env.DISCORD_GUILD_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const targets = configured.length > 0 ? configured : guildIds;
  const rest = new REST({ version: '10' }).setToken(botToken);

  const body = JSON.stringify(COMMANDS);
  const fingerprint = createHash('sha256').update(body).digest('hex').slice(0, 16);
  const force = process.env.FORCE_COMMAND_REGISTRATION === 'true';

  for (const guildId of targets) {
    const key = `commands:${appId}:${guildId}`;

    if (!force && repo.getState(key) === fingerprint) {
      logger.debug(`Commands unchanged in guild ${guildId}, skipping registration`);
      continue;
    }

    try {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), { body: COMMANDS });
      repo.setState(key, fingerprint);
      logger.info(`Registered ${COMMANDS.length} commands in guild ${guildId}`);
    } catch (error) {
      logger.warn(`Could not register commands in guild ${guildId}`, error);
    }
  }
}

/**
 * Platforms send SIGTERM and then kill the process a short while later, so
 * shutdown has to be bounded rather than merely correct. The batched action
 * log is flushed first, but never at the cost of hanging: if Discord is slow
 * or already gone, the timeout wins and the database still gets closed
 * cleanly, which is what protects the WAL file on the volume.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  const hardStop = setTimeout(() => {
    logger.warn('Shutdown took too long, exiting anyway');
    process.exit(0);
  }, 8000);
  hardStop.unref();

  await withTimeout(flushAllLogs(), 4000).catch((error) =>
    logger.warn('Could not flush the action log', error),
  );
  await withTimeout(client.destroy(), 2000).catch(() => undefined);

  closeDatabase();
  clearTimeout(hardStop);
  logger.info('Shutdown complete');
  process.exit(0);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref();
    }),
  ]);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => void shutdown(signal));
}

// A single rejected promise somewhere in an interaction handler should not
// take a bot offline and start a restart loop, so these are logged and
// survived. An uncaught exception is different: the process state is no longer
// trustworthy, so exit non-zero and let the platform restart cleanly.
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', reason));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception, restarting', error);
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

void client.login(token);
