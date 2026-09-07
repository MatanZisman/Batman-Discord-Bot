import type { Client } from 'discord.js';
import { DAY_MS, LIMITS, SCORING } from '../config.js';
import { getDatabase } from '../db/index.js';
import * as repo from '../db/repo.js';
import { recalculateStanding, resweepGuild } from '../core/standing-service.js';
import { advanceChallenge } from '../handlers/challenge.js';
import { logger } from '../lib/logger.js';

/**
 * The only clock in the system. Everything time-based happens here so there is
 * exactly one place to look when something did not fire.
 *
 *   1. Votes older than VOTE_LIFETIME_DAYS stop counting, and the members they
 *      were about get recomputed (which is how people climb back up over time
 *      without doing anything at all).
 *   2. Challenges past their response or KING deadline advance a phase.
 *   3. KING overrides whose window has lapsed are cleared, handing the member
 *      back to the community score.
 *   4. Every member who could plausibly move is re-evaluated, which lands
 *      demotions that the cooldown deferred and picks up changes in what a
 *      rater's vote is worth.
 */
export function startSweeper(client: Client): NodeJS.Timeout {
  const intervalMs = LIMITS.SWEEP_INTERVAL_MINUTES * 60 * 1000;

  const run = () => {
    sweep(client).catch((error) => logger.error('Sweep failed', error));
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

export async function sweep(client: Client): Promise<void> {
  const now = Date.now();

  /* 1. Expire aged-out votes ------------------------------------------- */
  const cutoff = now - SCORING.VOTE_LIFETIME_DAYS * DAY_MS;
  const affected = repo.expireStaleVotes(cutoff);

  if (affected.length > 0) {
    logger.info(`Expired votes affecting ${affected.length} member(s)`);
  }

  for (const { guild_id, target_id } of affected) {
    if (repo.isGuildPaused(guild_id)) continue;
    const guild = await client.guilds.fetch(guild_id).catch(() => null);
    if (!guild) continue;
    await recalculateStanding(guild, target_id).catch((error) =>
      logger.error(`Recalculation after expiry failed for ${target_id}`, error),
    );
  }

  /* 2. Advance challenges ---------------------------------------------- */
  for (const challenge of repo.listChallengesNeedingAttention(now)) {
    await advanceChallenge(client, challenge);
  }

  /* 3. Release lapsed KING overrides ----------------------------------- */
  for (const { guild_id, user_id } of lapsedOverrides(now)) {
    repo.setTierOverride(guild_id, user_id, null, null);
    const guild = await client.guilds.fetch(guild_id).catch(() => null);
    if (guild) await recalculateStanding(guild, user_id).catch(() => undefined);
  }

  /* 4. Re-evaluate anyone who could have moved ------------------------- */
  for (const guild of client.guilds.cache.values()) {
    // A paused guild has no visible channels and no member activity, so
    // moving people between hidden areas would only generate DMs about
    // changes nobody can see.
    if (repo.isGuildPaused(guild.id)) continue;

    const count = await resweepGuild(guild).catch((error) => {
      logger.error(`Resweep failed for guild ${guild.id}`, error);
      return 0;
    });
    logger.debug(`Re-evaluated ${count} standing(s) in ${guild.id}`);
  }
}

function lapsedOverrides(now: number): Array<{ guild_id: string; user_id: string }> {
  return getDatabase()
    .prepare<[number], { guild_id: string; user_id: string }>(
      'SELECT guild_id, user_id FROM members WHERE override_tier_key IS NOT NULL AND override_until IS NOT NULL AND override_until < ?',
    )
    .all(now);
}
