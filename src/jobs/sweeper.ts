import type { Client } from 'discord.js';
import { DAY_MS, LIMITS, SCORING } from '../config.js';
import { getDatabase } from '../db/index.js';
import * as repo from '../db/repo.js';
import { tidyRatingChannel } from '../core/channel-tidy.js';
import { recalculateStanding, resweepGuild } from '../core/standing-service.js';
import { expireStaleRequests } from '../core/challenge-service.js';
import { logger } from '../lib/logger.js';

/**
 * The only clock in the system. Everything time-based happens here so there is
 * exactly one place to look when something did not fire.
 *
 *   1. Votes older than VOTE_LIFETIME_DAYS stop counting, and the members they
 *      were about get recomputed (which is how people climb back up over time
 *      without doing anything at all).
 *   2. Review requests nobody acted on close themselves.
 *   3. Members whose moderator adjustment has just run out are re-evaluated,
 *      so their roles follow a score that changed on a clock.
 *   4. Every member who could plausibly move is re-evaluated, which lands
 *      demotions that the cooldown deferred and picks up changes in what a
 *      rater's vote is worth.
 *   5. Litter is cleared out of the public rating channel.
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

  /* 2. Close review requests nobody acted on --------------------------- */
  const lapsed = await expireStaleRequests(client).catch((error) => {
    logger.error('Expiring stale review requests failed', error);
    return 0;
  });
  if (lapsed > 0) logger.info(`Closed ${lapsed} unanswered review request(s)`);

  /* 3. Pick up adjustments that have just run out ----------------------- */
  //
  // Nothing needs undoing here — an expired adjustment simply stops being read
  // by the scoring engine. What does need doing is noticing, so the member's
  // roles catch up with a score that quietly changed on a timestamp rather
  // than on anybody's action.
  const since = now - LIMITS.SWEEP_INTERVAL_MINUTES * 60 * 1000;
  for (const guild of client.guilds.cache.values()) {
    if (repo.isGuildPaused(guild.id)) continue;

    for (const userId of repo.listMembersWithLapsedCredits(guild.id, since)) {
      await recalculateStanding(guild, userId).catch((error) =>
        logger.error(`Recalculation after an adjustment lapsed failed for ${userId}`, error),
      );
    }
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

    /* 5. Clear litter out of the public channel ------------------------ */
    await tidyRatingChannel(guild).catch((error) =>
      logger.error(`Tidying the rating channel failed for ${guild.id}`, error),
    );
  }
}

