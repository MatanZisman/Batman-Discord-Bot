import { type Guild, type TextChannel } from 'discord.js';
import { LOGGING, tierAt, tierIndexByKey } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';

/**
 * ============================================================================
 *  MEMBER ACTION LOG
 * ============================================================================
 *  Posts a running feed of member activity into the KING channel.
 *
 *  Read the LOGGING block in config.ts before changing anything here. The
 *  default 'redacted' mode is load-bearing: it reports that a rating happened
 *  without reporting who it was about or what it said, which is what lets the
 *  public channel keep promising that nobody can look up who rated whom.
 *
 *  Lines are batched and flushed on a timer rather than sent one per action,
 *  so a busy evening of rating cannot hit Discord's per-channel rate limit or
 *  bury the challenge reports that share this channel.
 * ============================================================================
 */

export type LoggedAction =
  | { kind: 'rating_created'; actorId: string; targetId: string; value: number }
  | { kind: 'rating_updated'; actorId: string; targetId: string; value: number }
  | { kind: 'opt_in'; actorId: string }
  | { kind: 'opt_out'; actorId: string }
  | { kind: 'challenge_opened'; actorId: string; invited: number }
  | { kind: 'challenge_rerated'; actorId: string }
  | { kind: 'challenge_kept'; actorId: string }
  | { kind: 'tier_change'; subjectId: string; fromTierKey: string | null; toTierKey: string }
  | { kind: 'admin'; actorId: string; summary: string };

interface PendingBatch {
  guild: Guild;
  lines: string[];
  timer: NodeJS.Timeout | null;
}

const batches = new Map<string, PendingBatch>();

/**
 * Records an action. Fire and forget: never awaited by the interaction path,
 * so a logging problem can never break a member's rating flow.
 */
export function logAction(guild: Guild, action: LoggedAction): void {
  if (!LOGGING.enabled) return;
  if (action.kind === 'tier_change' && !LOGGING.includeTierChanges) return;

  const line = format(action);
  if (!line) return;

  const batch = batches.get(guild.id) ?? { guild, lines: [], timer: null };
  batch.guild = guild;
  batch.lines.push(`<t:${Math.floor(Date.now() / 1000)}:t> ${line}`);

  if (!batch.timer) {
    batch.timer = setTimeout(() => void flush(guild.id), LOGGING.flushSeconds * 1000);
    batch.timer.unref?.();
  }

  batches.set(guild.id, batch);
}

function format(action: LoggedAction): string | null {
  const full = LOGGING.detail === 'full';

  switch (action.kind) {
    case 'rating_created':
      return full
        ? `<@${action.actorId}> rated <@${action.targetId}> **${action.value}**`
        : `<@${action.actorId}> submitted a rating`;

    case 'rating_updated':
      return full
        ? `<@${action.actorId}> changed their rating of <@${action.targetId}> to **${action.value}**`
        : `<@${action.actorId}> changed a rating they had given`;

    case 'opt_in':
      return `<@${action.actorId}> joined the standing system; suspended ratings resumed`;

    case 'opt_out':
      return `<@${action.actorId}> left the standing system; ratings involving them are suspended`;

    case 'challenge_opened':
      return `<@${action.actorId}> opened a re-review, ${action.invited} rater(s) asked`;

    case 'challenge_rerated':
      return `<@${action.actorId}> re-rated a player during a re-review`;

    case 'challenge_kept':
      return `<@${action.actorId}> kept their existing rating during a re-review`;

    case 'tier_change': {
      const to = tierAt(tierIndexByKey(action.toTierKey)).roleName;
      const from = action.fromTierKey ? tierAt(tierIndexByKey(action.fromTierKey)).roleName : 'none';
      return `<@${action.subjectId}> moved **${from} → ${to}**`;
    }

    case 'admin':
      return `<@${action.actorId}> ${action.summary}`;

    default:
      return null;
  }
}

async function flush(guildId: string): Promise<void> {
  const batch = batches.get(guildId);
  if (!batch) return;

  batches.delete(guildId);
  if (batch.timer) clearTimeout(batch.timer);
  if (batch.lines.length === 0) return;

  try {
    const channel = await resolveLogChannel(batch.guild);
    if (!channel) return;

    // Discord caps a message at 2000 characters, so send in chunks.
    for (const chunk of chunkLines(batch.lines, 1900)) {
      await channel.send({
        content: chunk,
        allowedMentions: { parse: [] }, // render names, never ping anyone
      });
    }
  } catch (error) {
    logger.warn(`Could not write the action log for guild ${guildId}`, error);
  }
}

async function resolveLogChannel(guild: Guild): Promise<TextChannel | null> {
  const settings = repo.getGuildSettings(guild.id);
  if (!settings?.king_channel_id) return null;

  const channel = await guild.channels.fetch(settings.king_channel_id).catch(() => null);
  return channel?.isTextBased() ? (channel as TextChannel) : null;
}

function chunkLines(lines: string[], limit: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if (current.length + line.length + 1 > limit) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/** Flushes everything immediately. Used on shutdown so nothing is lost. */
export async function flushAllLogs(): Promise<void> {
  await Promise.all([...batches.keys()].map((guildId) => flush(guildId)));
}
