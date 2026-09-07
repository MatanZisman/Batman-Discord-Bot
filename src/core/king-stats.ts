import { DAY_MS, TIERS } from '../config.js';
import { getDatabase } from '../db/index.js';
import * as repo from '../db/repo.js';

/**
 * ============================================================================
 *  THE ADMIN SNAPSHOT
 * ============================================================================
 *  What goes above the menu, chosen to answer the questions a KING actually
 *  has when they open the channel:
 *
 *    "Is it on?"          paused, notice armed, members still to be told
 *    "Where is everyone?" the tier distribution, plus who is outside it
 *    "Is it being used?"  ratings in the last day and week, active raters
 *    "Does it need me?"   open challenges waiting on a KING decision
 *    "Is it drifting?"    how many scores currently carry a moderator's thumb
 *
 *  WHAT IS DELIBERATELY ABSENT: any way to go from these numbers to a person.
 *  No "most rated", no "worst rated", no leaderboards, no names anywhere. That
 *  is the same promise the members are given in the public channel, and an
 *  admin dashboard is exactly where it would be most tempting to break it.
 *  Counts only, so this screen can be read over someone's shoulder.
 * ============================================================================
 */

export interface TierCount {
  roleName: string;
  count: number;
}

export interface AdminStats {
  paused: boolean;
  noticeActiveAt: number | null;
  noticePending: number;

  tiers: TierCount[];
  participating: number;
  optedOut: number;
  removed: number;

  ratingsLastDay: number;
  ratingsLastWeek: number;
  activeRaters: number;
  activeRatings: number;

  openChallenges: number;
  challengesAwaitingKing: number;

  /** Members whose score currently includes a moderator adjustment. */
  adjustedMembers: number;
}

export function collectAdminStats(guildId: string): AdminStats {
  const db = getDatabase();
  const now = Date.now();

  const counts = new Map<string, number>();
  for (const tier of TIERS) counts.set(tier.key, 0);

  let participating = 0;
  for (const member of repo.listParticipatingMembers(guildId)) {
    participating += 1;
    const key = member.tier_key ?? TIERS[0]?.key ?? 'green';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const scalar = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare<unknown[], { n: number }>(sql).get(...params);
    return row?.n ?? 0;
  };

  return {
    paused: repo.isGuildPaused(guildId),
    noticeActiveAt: repo.getJoinNoticeActiveAt(guildId),
    noticePending: repo.countPendingNotices(guildId),

    tiers: TIERS.map((tier) => ({ roleName: tier.roleName, count: counts.get(tier.key) ?? 0 })),
    participating,
    optedOut: scalar(
      'SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND participating = 0 AND removed_by_admin = 0',
      guildId,
    ),
    removed: scalar(
      'SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND removed_by_admin = 1',
      guildId,
    ),

    ratingsLastDay: scalar(
      'SELECT COUNT(*) AS n FROM votes WHERE guild_id = ? AND updated_at >= ?',
      guildId,
      now - DAY_MS,
    ),
    ratingsLastWeek: scalar(
      'SELECT COUNT(*) AS n FROM votes WHERE guild_id = ? AND updated_at >= ?',
      guildId,
      now - 7 * DAY_MS,
    ),
    activeRaters: scalar(
      "SELECT COUNT(DISTINCT rater_id) AS n FROM votes WHERE guild_id = ? AND status = 'active'",
      guildId,
    ),
    activeRatings: scalar(
      "SELECT COUNT(*) AS n FROM votes WHERE guild_id = ? AND status = 'active'",
      guildId,
    ),

    // Every open request now waits on a KING, so these are the same number.
    // Both are kept so the panel copy does not have to change if a
    // multi-stage flow ever comes back.
    openChallenges: scalar(
      "SELECT COUNT(*) AS n FROM challenges WHERE guild_id = ? AND state != 'closed'",
      guildId,
    ),
    challengesAwaitingKing: scalar(
      "SELECT COUNT(*) AS n FROM challenges WHERE guild_id = ? AND state != 'closed'",
      guildId,
    ),

    adjustedMembers: scalar(
      `SELECT COUNT(DISTINCT target_id) AS n
         FROM score_credits
        WHERE guild_id = ? AND revoked_at IS NULL AND expires_at > ?`,
      guildId,
      now,
    ),
  };
}
