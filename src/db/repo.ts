import { getDatabase } from './index.js';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface GuildSettings {
  guild_id: string;
  rating_channel_id: string | null;
  king_role_id: string | null;
  king_channel_id: string | null;
  setup_at: number | null;
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
  /** 1 = takes part in the standing system, 0 = opted out (white channels only). */
  participating: number;
  tier_key: string | null;
  score: number | null;
  rater_count: number;
  first_seen_at: number;
  updated_at: number;
  /** Tier forced by the KING role, or null. */
  override_tier_key: string | null;
  /** Epoch ms at which the override lapses. */
  override_until: number | null;
  /** Epoch ms of this member's last move to a worse tier. */
  last_demotion_at: number | null;
}

export type VoteStatus = 'active' | 'expired' | 'dropped';

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

export type ChallengeState = 'collecting' | 'king_review' | 'closed';

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
      `INSERT INTO guilds (guild_id, rating_channel_id, king_role_id, king_channel_id, setup_at)
       VALUES (@guild_id, @rating_channel_id, @king_role_id, @king_channel_id, @setup_at)
       ON CONFLICT(guild_id) DO UPDATE SET
         rating_channel_id = excluded.rating_channel_id,
         king_role_id      = excluded.king_role_id,
         king_channel_id   = excluded.king_channel_id,
         setup_at          = excluded.setup_at`,
    )
    .run({ ...settings, setup_at: settings.setup_at ?? Date.now() });
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
 * Members the sweeper should re-evaluate: anyone carrying ratings, or anyone
 * not in the default tier. This is what lets a deferred demotion land, and
 * what picks up the knock-on effect of a rater's own standing changing.
 */
export function listMembersToResweep(guildId: string, defaultTierKey: string): MemberRecord[] {
  return getDatabase()
    .prepare<[string, string], MemberRecord>(
      `SELECT * FROM members
        WHERE guild_id = ? AND participating = 1
          AND (rater_count > 0 OR tier_key IS NOT ? )`,
    )
    .all(guildId, defaultTierKey);
}

/** Records or clears a KING placement override. Pass null to clear. */
export function setTierOverride(
  guildId: string,
  userId: string,
  tierKey: string | null,
  until: number | null,
): void {
  getDatabase()
    .prepare(
      'UPDATE members SET override_tier_key = ?, override_until = ?, updated_at = ? WHERE guild_id = ? AND user_id = ?',
    )
    .run(tierKey, until, Date.now(), guildId, userId);
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

  db.prepare(`UPDATE votes SET status = 'expired' WHERE status = 'active' AND updated_at < ?`).run(olderThan);
  return affected;
}

/** Wipes every rating involving a member. Used when someone opts out. */
export function deleteVotesInvolving(guildId: string, userId: string): string[] {
  const db = getDatabase();
  const affectedTargets = db
    .prepare<[string, string], { target_id: string }>(
      'SELECT DISTINCT target_id FROM votes WHERE guild_id = ? AND rater_id = ?',
    )
    .all(guildId, userId)
    .map((r) => r.target_id);

  db.prepare('DELETE FROM votes WHERE guild_id = ? AND (rater_id = ? OR target_id = ?)').run(
    guildId,
    userId,
    userId,
  );
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
       VALUES (?, ?, 'collecting', ?, ?, ?)`,
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
    .prepare<[number, number], ChallengeRecord>(
      `SELECT * FROM challenges
        WHERE (state = 'collecting'  AND response_deadline <= ?)
           OR (state = 'king_review' AND king_deadline <= ?)`,
    )
    .all(now, now);
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
