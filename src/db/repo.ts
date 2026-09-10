import { getDatabase } from './index.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface GuildSettings {
  guild_id: string;
  rating_channel_id: string | null;
  king_role_id: string | null;
  /** Where challenge reports and the action log go. */
  king_channel_id: string | null;
  /** Where the live stats-and-menu message lives. */
  king_menu_channel_id?: string | null;
  setup_at: number | null;
  /** Non-null while the system is paused for maintenance. */
  paused_at?: number | null;
  /** Language locale for all bot messages ('en' | 'he'). Defaults to 'en'. */
  locale?: string | null;
}

export interface TierRole {
  guild_id: string;
  tier_key: string;
  role_id: string;
  category_id: string | null;
}

export interface MemberRecord {
  guild_id: string;
  user_id: string;
  /** 1 = takes part in the standing system, 0 = outside it. */
  participating: number;
  /** 1 when a moderator removed them, which blocks them rejoining themselves. */
  removed_by_admin: number;
  /** When the one-time launch DM was delivered, or null if it never was. */
  notice_sent_at: number | null;
  /** When delivery was last attempted, successful or not. Throttles retries. */
  notice_attempted_at: number | null;
  tier_key: string | null;
  score: number | null;
  rater_count: number;
  first_seen_at: number;
  updated_at: number;
  /**
   * Epoch ms of this member's last move to a worse tier.
   *
   * (The override_* columns still exist on the table but are not declared
   * here. Two retired mechanisms wrote them; nothing reads them now, and a
   * moderator's influence lives in score_credits instead.)
   */
  last_demotion_at: number | null;
}

export type VoteStatus = 'active' | 'expired' | 'dropped' | 'suspended';

export interface VoteRecord {
  id: number;
  guild_id: string;
  rater_id: string;
  target_id: string;
  value: number;
  status: VoteStatus;
  created_at: number;
  /** When the opinion was last affirmed. This is the timestamp scoring ages. */
  updated_at: number;
}

/**
 * 'open' is waiting on a KING; 'closed' is settled.
 *
 * 'collecting' and 'king_review' are the two phases of the older flow, which
 * DMed past raters and then gave the KING a second window. Nothing creates
 * them any more, but rows written before the change still carry them, so they
 * are kept in the type and treated as open everywhere.
 */
export type ChallengeState = 'open' | 'collecting' | 'king_review' | 'closed';

export interface ChallengeRecord {
  id: number;
  guild_id: string;
  target_id: string;
  state: ChallengeState;
  opened_at: number;
  response_deadline: number;
  king_deadline: number | null;
  snapshot_json: string;
  king_message_id: string | null;
  king_channel_id: string | null;
  king_action: string | null;
  king_user_id: string | null;
  closed_at: number | null;
}

export type ChallengeVoterResponse = 'pending' | 'rerated' | 'kept' | 'dropped' | 'unreachable';

export interface ChallengeVoterRecord {
  challenge_id: number;
  rater_id: string;
  previous_value: number;
  response: ChallengeVoterResponse;
  responded_at: number | null;
}

/** What we store before a challenge runs, so the KING can revert it wholesale. */
export interface ChallengeSnapshot {
  tier_key: string | null;
  score: number | null;
  rater_count: number;
  votes: Array<{ rater_id: string; value: number; status: VoteStatus; updated_at: number }>;
}

/* -------------------------------------------------------------------------- */
/* Guild settings                                                             */
/* -------------------------------------------------------------------------- */

export function getGuildSettings(guildId: string): GuildSettings | undefined {
  return getDatabase()
    .prepare<[string], GuildSettings>('SELECT * FROM guilds WHERE guild_id = ?')
    .get(guildId);
}

export function saveGuildSettings(settings: Omit<GuildSettings, 'setup_at'> & { setup_at?: number }): void {
  getDatabase()
    .prepare(
      `INSERT INTO guilds (guild_id, rating_channel_id, king_role_id, king_channel_id, king_menu_channel_id, setup_at)
       VALUES (@guild_id, @rating_channel_id, @king_role_id, @king_channel_id, @king_menu_channel_id, @setup_at)
       ON CONFLICT(guild_id) DO UPDATE SET
         rating_channel_id    = excluded.rating_channel_id,
         king_role_id         = excluded.king_role_id,
         king_channel_id      = excluded.king_channel_id,
         king_menu_channel_id = excluded.king_menu_channel_id,
         setup_at             = excluded.setup_at`,
    )
    .run({
      king_menu_channel_id: null,
      ...settings,
      setup_at: settings.setup_at ?? Date.now(),
    });
}

/**
 * Marks a member as removed by a moderator, or reinstates them.
 *
 * Removal is deliberately not the same row-state as opting out. Both leave the
 * member outside the system, but a removal cannot be undone by the member
 * pressing Join, which is the entire point of it.
 */
export function setAdminRemoval(guildId: string, userId: string, removed: boolean): void {
  getDatabase()
    .prepare('UPDATE members SET removed_by_admin = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?')
    .run(removed ? 1 : 0, Date.now(), guildId, userId);
}

/** Pauses or resumes the whole system for a guild. Touches no ratings. */
export function setGuildPaused(guildId: string, paused: boolean): void {
  getDatabase()
    .prepare('UPDATE guilds SET paused_at = ? WHERE guild_id = ?')
    .run(paused ? Date.now() : null, guildId);
}

export function isGuildPaused(guildId: string): boolean {
  const row = getDatabase()
    .prepare<[string], { paused_at: number | null }>('SELECT paused_at FROM guilds WHERE guild_id = ?')
    .get(guildId);
  return Boolean(row?.paused_at);
}

/** Returns the stored locale for this guild, or null when not set. */
export function getGuildLocale(guildId: string): string | null {
  const row = getDatabase()
    .prepare<[string], { locale: string | null }>('SELECT locale FROM guilds WHERE guild_id = ?')
    .get(guildId);
  return row?.locale ?? null;
}

/** Persists the locale for this guild. */
export function setGuildLocale(guildId: string, locale: string): void {
  getDatabase()
    .prepare('UPDATE guilds SET locale = ? WHERE guild_id = ?')
    .run(locale, guildId);
}

/* -------------------------------------------------------------------------- */
/* The one-time launch notice                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Switches the launch notice on or off, recording the moment it went live.
 *
 * That timestamp is what "the first voice join since activation" is measured
 * against, so it is stored rather than inferred: the bot restarts, and a
 * process-start time would re-arm the notice on every deploy.
 */
export function setJoinNoticeActive(guildId: string, active: boolean): void {
  getDatabase()
    .prepare('UPDATE guilds SET notice_active_at = ? WHERE guild_id = ?')
    .run(active ? Date.now() : null, guildId);
}

export function getJoinNoticeActiveAt(guildId: string): number | null {
  const row = getDatabase()
    .prepare<[string], { notice_active_at: number | null }>(
      'SELECT notice_active_at FROM guilds WHERE guild_id = ?',
    )
    .get(guildId);
  return row?.notice_active_at ?? null;
}

/**
 * Claims the exclusive right to send one member their launch notice.
 *
 * This is the whole guarantee of "exactly once". Voice state events arrive in
 * bursts and can be delivered more than once for what a human would call a
 * single join, so the check and the claim have to be one operation: the WHERE
 * clause tests `notice_sent_at IS NULL` and the UPDATE stakes the claim in the
 * same statement. SQLite serialises it, so of two simultaneous events exactly
 * one sees `changes === 1` and earns the right to call Discord.
 *
 * Returns false when someone else already claimed it, when the notice has
 * already landed, or when a failed attempt is still inside its retry cooldown.
 */
export function claimJoinNotice(guildId: string, userId: string, retryCutoff: number): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE members
          SET notice_attempted_at = ?
        WHERE guild_id = ?
          AND user_id  = ?
          AND notice_sent_at IS NULL
          AND (notice_attempted_at IS NULL OR notice_attempted_at <= ?)`,
    )
    .run(Date.now(), guildId, userId, retryCutoff);

  return result.changes === 1;
}

/** Confirms the DM actually arrived. Until this runs, the send can be retried. */
export function confirmJoinNoticeSent(guildId: string, userId: string): void {
  getDatabase()
    .prepare('UPDATE members SET notice_sent_at = ? WHERE guild_id = ? AND user_id = ? AND notice_sent_at IS NULL')
    .run(Date.now(), guildId, userId);
}

/**
 * Marks members who demonstrably already know the system exists, so switching
 * the notice on does not DM people who have been using it for weeks. Anyone
 * who has cast a rating, or who has already made an opt-out decision, has met
 * the system by definition.
 */
export function skipNoticeForExistingUsers(guildId: string): number {
  const now = Date.now();
  const result = getDatabase()
    .prepare(
      `UPDATE members
          SET notice_sent_at = ?
        WHERE guild_id = ?
          AND notice_sent_at IS NULL
          AND (participating = 0
               OR user_id IN (SELECT DISTINCT rater_id FROM votes WHERE guild_id = ?))`,
    )
    .run(now, guildId, guildId);

  return result.changes;
}

/** How many members are still waiting to be told. Counts only, never names. */
export function countPendingNotices(guildId: string): number {
  const row = getDatabase()
    .prepare<[string], { n: number }>(
      'SELECT COUNT(*) AS n FROM members WHERE guild_id = ? AND notice_sent_at IS NULL',
    )
    .get(guildId);
  return row?.n ?? 0;
}

export function setTierRole(guildId: string, tierKey: string, roleId: string, categoryId: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO tier_roles (guild_id, tier_key, role_id, category_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, tier_key) DO UPDATE SET
         role_id = excluded.role_id,
         category_id = excluded.category_id`,
    )
    .run(guildId, tierKey, roleId, categoryId);
}

export function getTierRoles(guildId: string): TierRole[] {
  return getDatabase()
    .prepare<[string], TierRole>('SELECT * FROM tier_roles WHERE guild_id = ?')
    .all(guildId);
}

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export function getMember(guildId: string, userId: string): MemberRecord | undefined {
  return getDatabase()
    .prepare<[string, string], MemberRecord>('SELECT * FROM members WHERE guild_id = ? AND user_id = ?')
    .get(guildId, userId);
}

/**
 * Makes sure a member row exists. `firstSeenAt` should be the Discord
 * "joined the server" timestamp when we know it, because the scoring engine
 * uses server tenure to dampen brand-new accounts' vote weight.
 */
export function ensureMember(guildId: string, userId: string, firstSeenAt = Date.now()): MemberRecord {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO members (guild_id, user_id, participating, first_seen_at, updated_at)
     VALUES (?, ?, 1, ?, ?)
     ON CONFLICT(guild_id, user_id) DO NOTHING`,
  ).run(guildId, userId, firstSeenAt, Date.now());

  const member = getMember(guildId, userId);
  if (!member) throw new Error(`Failed to create member row for ${userId}`);
  return member;
}

export function setParticipation(guildId: string, userId: string, participating: boolean): void {
  getDatabase()
    .prepare(
      `UPDATE members
          SET participating = ?,
              tier_key = CASE WHEN ? = 0 THEN NULL ELSE tier_key END,
              score    = CASE WHEN ? = 0 THEN NULL ELSE score END,
              rater_count = CASE WHEN ? = 0 THEN 0 ELSE rater_count END,
              updated_at = ?
        WHERE guild_id = ? AND user_id = ?`,
    )
    .run(participating ? 1 : 0, participating ? 1 : 0, participating ? 1 : 0, participating ? 1 : 0, Date.now(), guildId, userId);
}

export function saveStanding(
  guildId: string,
  userId: string,
  tierKey: string,
  score: number,
  raterCount: number,
  /** Pass true when this save moves the member to a worse tier. */
  isDemotion = false,
): void {
  getDatabase()
    .prepare(
      `UPDATE members
          SET tier_key = ?, score = ?, rater_count = ?, updated_at = ?,
              last_demotion_at = CASE WHEN ? = 1 THEN ? ELSE last_demotion_at END
        WHERE guild_id = ? AND user_id = ?`,
    )
    .run(tierKey, score, raterCount, Date.now(), isDemotion ? 1 : 0, Date.now(), guildId, userId);
}

/**
 * Members the sweeper should re-evaluate: anyone carrying ratings, anyone not
 * in the default tier, and anyone who has ever been adjusted. This is what
 * lets a deferred demotion land, what picks up the knock-on effect of a
 * rater's own standing changing, and what makes an adjustment fade out on
 * schedule instead of on the next vote.
 */
export function listMembersToResweep(guildId: string, defaultTierKey: string): MemberRecord[] {
  return getDatabase()
    .prepare<[string, string], MemberRecord>(
      `SELECT * FROM members
        WHERE guild_id = ? AND participating = 1
          AND (
            rater_count > 0
            OR tier_key IS NOT ?
            OR user_id IN (SELECT target_id FROM score_credits WHERE guild_id = members.guild_id)
          )`,
    )
    .all(guildId, defaultTierKey);
}

/* -------------------------------------------------------------------------- */
/* Moderator adjustments                                                      */
/* -------------------------------------------------------------------------- */

export interface ScoreCreditRecord {
  id: number;
  guild_id: string;
  target_id: string;
  /** SCORING.MIN_RATING for relief, MAX_RATING for pressure. */
  value: number;
  /** Reports' worth. */
  reports: number;
  granted_by: string;
  reason: string | null;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  revoked_by: string | null;
}

export function grantCredit(input: {
  guildId: string;
  targetId: string;
  value: number;
  reports: number;
  grantedBy: string;
  reason?: string | null;
  expiresAt: number;
}): number {
  const result = getDatabase()
    .prepare(
      `INSERT INTO score_credits
         (guild_id, target_id, value, reports, granted_by, reason, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.guildId,
      input.targetId,
      input.value,
      input.reports,
      input.grantedBy,
      input.reason ?? null,
      Date.now(),
      input.expiresAt,
    );

  return Number(result.lastInsertRowid);
}

/** Adjustments currently counting toward a member's score. */
export function listLiveCredits(
  guildId: string,
  targetId: string,
  now: number = Date.now(),
): ScoreCreditRecord[] {
  return getDatabase()
    .prepare<[string, string, number], ScoreCreditRecord>(
      `SELECT * FROM score_credits
        WHERE guild_id = ? AND target_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?
        ORDER BY created_at DESC`,
    )
    .all(guildId, targetId, now);
}

/** Everything ever granted to a member, live or not, newest first. */
export function listCreditHistory(
  guildId: string,
  targetId: string,
  limit = 10,
): ScoreCreditRecord[] {
  return getDatabase()
    .prepare<[string, string, number], ScoreCreditRecord>(
      `SELECT * FROM score_credits
        WHERE guild_id = ? AND target_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .all(guildId, targetId, limit);
}

/**
 * Takes back every live adjustment on a member.
 *
 * Revoked rather than deleted. A moderator undoing their own call is part of
 * the record, and a table that only ever shows grants would quietly overstate
 * how much intervention actually stuck.
 */
export function revokeCreditsFor(guildId: string, targetId: string, byUserId: string): number {
  const result = getDatabase()
    .prepare(
      `UPDATE score_credits
          SET revoked_at = ?, revoked_by = ?
        WHERE guild_id = ? AND target_id = ?
          AND revoked_at IS NULL
          AND expires_at > ?`,
    )
    .run(Date.now(), byUserId, guildId, targetId, Date.now());

  return result.changes;
}

/** Members carrying at least one live adjustment. */
export function listMembersWithLiveCredits(guildId: string, now: number = Date.now()): string[] {
  return getDatabase()
    .prepare<[string, number], { target_id: string }>(
      `SELECT DISTINCT target_id FROM score_credits
        WHERE guild_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .all(guildId, now)
    .map((row) => row.target_id);
}

/**
 * Members whose adjustment ran out since the sweeper last looked.
 *
 * Expiry is a timestamp, not an event, so nothing happens on its own when one
 * passes: the score is simply computed differently from that moment on. This
 * is what tells the sweeper whose roles are now stale.
 */
export function listMembersWithLapsedCredits(guildId: string, since: number): string[] {
  return getDatabase()
    .prepare<[string, number, number], { target_id: string }>(
      `SELECT DISTINCT target_id FROM score_credits
        WHERE guild_id = ? AND revoked_at IS NULL
          AND expires_at > ? AND expires_at <= ?`,
    )
    .all(guildId, since, Date.now())
    .map((row) => row.target_id);
}

export function listParticipatingMembers(guildId: string): MemberRecord[] {
  return getDatabase()
    .prepare<[string], MemberRecord>('SELECT * FROM members WHERE guild_id = ? AND participating = 1')
    .all(guildId);
}

/* -------------------------------------------------------------------------- */
/* Votes                                                                      */
/* -------------------------------------------------------------------------- */

export function getVote(guildId: string, raterId: string, targetId: string): VoteRecord | undefined {
  return getDatabase()
    .prepare<[string, string, string], VoteRecord>(
      'SELECT * FROM votes WHERE guild_id = ? AND rater_id = ? AND target_id = ?',
    )
    .get(guildId, raterId, targetId);
}

/**
 * Casts or updates a rating. There is exactly one row per (rater, target), so
 * "rate the same person twice" is impossible by construction; a second rating
 * overwrites the first and refreshes its clock.
 */
export function upsertVote(
  guildId: string,
  raterId: string,
  targetId: string,
  value: number,
): { created: boolean; previousValue: number | null } {
  const existing = getVote(guildId, raterId, targetId);
  const now = Date.now();

  if (existing) {
    getDatabase()
      .prepare(`UPDATE votes SET value = ?, status = 'active', updated_at = ? WHERE id = ?`)
      .run(value, now, existing.id);
    return { created: existing.status !== 'active', previousValue: existing.value };
  }

  getDatabase()
    .prepare(
      `INSERT INTO votes (guild_id, rater_id, target_id, value, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(guildId, raterId, targetId, value, now, now);
  return { created: true, previousValue: null };
}

export function getVotesForTarget(guildId: string, targetId: string, status?: VoteStatus): VoteRecord[] {
  const db = getDatabase();
  if (status) {
    return db
      .prepare<[string, string, string], VoteRecord>(
        'SELECT * FROM votes WHERE guild_id = ? AND target_id = ? AND status = ?',
      )
      .all(guildId, targetId, status);
  }
  return db
    .prepare<[string, string], VoteRecord>('SELECT * FROM votes WHERE guild_id = ? AND target_id = ?')
    .all(guildId, targetId);
}

export function getVotesByRater(guildId: string, raterId: string): VoteRecord[] {
  return getDatabase()
    .prepare<[string, string], VoteRecord>(
      `SELECT * FROM votes WHERE guild_id = ? AND rater_id = ? AND status = 'active'`,
    )
    .all(guildId, raterId);
}

/** Used by the anti-brigade daily cap. Counts first-time ratings only. */
export function countVotesCreatedSince(guildId: string, raterId: string, since: number): number {
  const row = getDatabase()
    .prepare<[string, string, number], { n: number }>(
      'SELECT COUNT(*) AS n FROM votes WHERE guild_id = ? AND rater_id = ? AND created_at >= ?',
    )
    .get(guildId, raterId, since);
  return row?.n ?? 0;
}

/**
 * Puts a vote back exactly as it was, including its original clock. Used when
 * the KING undoes a challenge, so a reverted review does not silently extend
 * the life of the ratings it touched.
 */
export function restoreVote(
  guildId: string,
  raterId: string,
  targetId: string,
  value: number,
  status: VoteStatus,
  updatedAt: number,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO votes (guild_id, rater_id, target_id, value, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, rater_id, target_id) DO UPDATE SET
         value = excluded.value,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    )
    .run(guildId, raterId, targetId, value, status, updatedAt, updatedAt);
}

/** Marks a rating as reaffirmed by its author without changing its value. */
export function touchVote(voteId: number): void {
  getDatabase().prepare('UPDATE votes SET updated_at = ? WHERE id = ?').run(Date.now(), voteId);
}

export function setVoteStatus(voteId: number, status: VoteStatus): void {
  getDatabase().prepare('UPDATE votes SET status = ? WHERE id = ?').run(status, voteId);
}

/**
 * Marks votes older than the lifetime as expired and returns the affected
 * (guild, target) pairs so callers know whose standing to recompute.
 */
export function expireStaleVotes(olderThan: number): Array<{ guild_id: string; target_id: string }> {
  const db = getDatabase();
  const affected = db
    .prepare<[number], { guild_id: string; target_id: string }>(
      `SELECT DISTINCT guild_id, target_id FROM votes WHERE status = 'active' AND updated_at < ?`,
    )
    .all(olderThan);

  // Suspended ratings age out on the same clock. Without this they would sit
  // there indefinitely waiting for a member who may never come back, and the
  // promise that a rating only lasts VOTE_LIFETIME_DAYS would quietly stop
  // being true for anyone who had opted out. They need no recalculation,
  // since they were already counting for nobody.
  db.prepare(
    `UPDATE votes SET status = 'expired'
      WHERE status IN ('active', 'suspended') AND updated_at < ?`,
  ).run(olderThan);
  return affected;
}

/**
 * Takes every rating involving a member out of circulation when they opt out.
 *
 * Deliberately a suspension and not a delete. Deleting would make opting out
 * and straight back in the cheapest way in the system to erase a bad record:
 * instant, unlimited, and requiring nobody's agreement, which is strictly
 * better than the challenge flow that exists for exactly that purpose. Here
 * the ratings stop counting immediately — the member really is out of the
 * system — but they are still there to be restored if the same person returns
 * before the ratings would have aged out on their own.
 *
 * @returns the other members whose standing needs recomputing, because this
 *          member's ratings of them have just stopped counting.
 */
export function suspendVotesInvolving(guildId: string, userId: string): string[] {
  const db = getDatabase();
  const affectedTargets = db
    .prepare<[string, string], { target_id: string }>(
      `SELECT DISTINCT target_id FROM votes
        WHERE guild_id = ? AND rater_id = ? AND status = 'active'`,
    )
    .all(guildId, userId)
    .map((r) => r.target_id);

  // Only active ratings are suspended. Ones already expired or dropped stay
  // that way, so coming back cannot resurrect a rating that a challenge
  // removed or that timed out long ago.
  db.prepare(
    `UPDATE votes SET status = 'suspended'
      WHERE guild_id = ? AND (rater_id = ? OR target_id = ?) AND status = 'active'`,
  ).run(guildId, userId, userId);

  return affectedTargets.filter((id) => id !== userId);
}

/**
 * Puts suspended ratings back when a member rejoins.
 *
 * Anything that would have aged out while they were away is expired instead of
 * restored, so sitting outside the system neither preserves ratings past their
 * natural life nor shortens it. Staying away for a full VOTE_LIFETIME_DAYS
 * genuinely does clear your record — that is the intended way to get a clean
 * slate, and it is the same way everybody else gets one.
 *
 * @param expiryCutoff ratings last touched before this are expired, not restored.
 * @returns the other members whose standing needs recomputing.
 */
export function restoreVotesInvolving(
  guildId: string,
  userId: string,
  expiryCutoff: number,
): string[] {
  const db = getDatabase();

  db.prepare(
    `UPDATE votes SET status = 'expired'
      WHERE guild_id = ? AND (rater_id = ? OR target_id = ?)
        AND status = 'suspended' AND updated_at < ?`,
  ).run(guildId, userId, userId, expiryCutoff);

  const affectedTargets = db
    .prepare<[string, string], { target_id: string }>(
      `SELECT DISTINCT target_id FROM votes
        WHERE guild_id = ? AND rater_id = ? AND status = 'suspended'`,
    )
    .all(guildId, userId)
    .map((r) => r.target_id);

  db.prepare(
    `UPDATE votes SET status = 'active'
      WHERE guild_id = ? AND (rater_id = ? OR target_id = ?) AND status = 'suspended'`,
  ).run(guildId, userId, userId);

  return affectedTargets.filter((id) => id !== userId);
}

/* -------------------------------------------------------------------------- */
/* Challenges                                                                 */
/* -------------------------------------------------------------------------- */

export function getLatestChallenge(guildId: string, targetId: string): ChallengeRecord | undefined {
  return getDatabase()
    .prepare<[string, string], ChallengeRecord>(
      'SELECT * FROM challenges WHERE guild_id = ? AND target_id = ? ORDER BY opened_at DESC LIMIT 1',
    )
    .get(guildId, targetId);
}

export function getChallenge(id: number): ChallengeRecord | undefined {
  return getDatabase()
    .prepare<[number], ChallengeRecord>('SELECT * FROM challenges WHERE id = ?')
    .get(id);
}

export function createChallenge(input: {
  guildId: string;
  targetId: string;
  responseDeadline: number;
  snapshot: ChallengeSnapshot;
}): number {
  const result = getDatabase()
    .prepare(
      `INSERT INTO challenges (guild_id, target_id, state, opened_at, response_deadline, snapshot_json)
       VALUES (?, ?, 'open', ?, ?, ?)`,
    )
    .run(input.guildId, input.targetId, Date.now(), input.responseDeadline, JSON.stringify(input.snapshot));
  return Number(result.lastInsertRowid);
}

export function addChallengeVoter(challengeId: number, raterId: string, previousValue: number): void {
  getDatabase()
    .prepare(
      `INSERT INTO challenge_voters (challenge_id, rater_id, previous_value)
       VALUES (?, ?, ?)
       ON CONFLICT(challenge_id, rater_id) DO NOTHING`,
    )
    .run(challengeId, raterId, previousValue);
}

export function getChallengeVoters(challengeId: number): ChallengeVoterRecord[] {
  return getDatabase()
    .prepare<[number], ChallengeVoterRecord>('SELECT * FROM challenge_voters WHERE challenge_id = ?')
    .all(challengeId);
}

export function setChallengeVoterResponse(
  challengeId: number,
  raterId: string,
  response: ChallengeVoterResponse,
): void {
  getDatabase()
    .prepare('UPDATE challenge_voters SET response = ?, responded_at = ? WHERE challenge_id = ? AND rater_id = ?')
    .run(response, Date.now(), challengeId, raterId);
}

export function updateChallenge(id: number, patch: Partial<ChallengeRecord>): void {
  const keys = Object.keys(patch) as Array<keyof ChallengeRecord>;
  if (keys.length === 0) return;
  const assignments = keys.map((k) => `${k} = @${k}`).join(', ');
  getDatabase()
    .prepare(`UPDATE challenges SET ${assignments} WHERE id = @id`)
    .run({ ...patch, id });
}

export function listChallengesNeedingAttention(now: number): ChallengeRecord[] {
  return getDatabase()
    .prepare<[number], ChallengeRecord>(
      // COALESCE covers rows from the older two-phase flow: those in
      // 'king_review' carry a king_deadline, everything else is judged on the
      // request deadline. One query, no special cases.
      `SELECT * FROM challenges
        WHERE state != 'closed'
          AND COALESCE(king_deadline, response_deadline) <= ?`,
    )
    .all(now);
}

/* -------------------------------------------------------------------------- */
/* Provisioned items (what /standing-setup created or adopted)                */
/* -------------------------------------------------------------------------- */

export type ProvisionedKind = 'role' | 'category' | 'channel';

export interface StoredOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface ProvisionedItem {
  guild_id: string;
  kind: ProvisionedKind;
  discord_id: string;
  name: string;
  /** 1 when the bot created it, 0 when it adopted something already there. */
  created_by_bot: number;
  previous_parent_id: string | null;
  previous_overwrites: string | null;
  created_at: number;
}

export function recordProvisionedItem(item: {
  guildId: string;
  kind: ProvisionedKind;
  discordId: string;
  name: string;
  createdByBot: boolean;
  previousParentId?: string | null;
  previousOverwrites?: StoredOverwrite[] | null;
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO provisioned_items
         (guild_id, kind, discord_id, name, created_by_bot, previous_parent_id, previous_overwrites, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, discord_id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         -- created_by_bot is deliberately NOT updated. The first observation is
         -- the true one: a second /standing-setup finds everything already
         -- present and would otherwise relabel the bot's own creations as
         -- "adopted", after which revert would refuse to delete them.
         previous_parent_id = COALESCE(provisioned_items.previous_parent_id, excluded.previous_parent_id),
         previous_overwrites = COALESCE(provisioned_items.previous_overwrites, excluded.previous_overwrites)`,
    )
    .run(
      item.guildId,
      item.kind,
      item.discordId,
      item.name,
      item.createdByBot ? 1 : 0,
      item.previousParentId ?? null,
      item.previousOverwrites ? JSON.stringify(item.previousOverwrites) : null,
      Date.now(),
    );
}

export function listProvisionedItems(guildId: string): ProvisionedItem[] {
  return getDatabase()
    .prepare<[string], ProvisionedItem>('SELECT * FROM provisioned_items WHERE guild_id = ?')
    .all(guildId);
}

/**
 * Erases every trace of this guild from the database. Returns the number of
 * rows removed, purely so the revert report can show it.
 */
export function clearGuildData(guildId: string): number {
  const db = getDatabase();

  return db.transaction(() => {
    let removed = 0;

    // challenge_voters goes first: it has a foreign key onto challenges.
    removed += db
      .prepare(
        'DELETE FROM challenge_voters WHERE challenge_id IN (SELECT id FROM challenges WHERE guild_id = ?)',
      )
      .run(guildId).changes;

    for (const table of [
      'challenges',
      'votes',
      'score_credits',
      'members',
      'tier_roles',
      'provisioned_items',
      'audit_log',
      'guilds',
    ]) {
      removed += db.prepare(`DELETE FROM ${table} WHERE guild_id = ?`).run(guildId).changes;
    }

    return removed;
  })();
}

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*  Bot state                                                                  */
/* -------------------------------------------------------------------------- */

export function getState(key: string): string | undefined {
  const row = getDatabase()
    .prepare<[string], { value: string }>('SELECT value FROM bot_state WHERE key = ?')
    .get(key);
  return row?.value;
}

export function setState(key: string, value: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO bot_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

/* -------------------------------------------------------------------------- */

export function audit(guildId: string, action: string, subjectId?: string, detail?: string): void {
  getDatabase()
    .prepare('INSERT INTO audit_log (guild_id, action, subject_id, detail, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(guildId, action, subjectId ?? null, detail ?? null, Date.now());
}
