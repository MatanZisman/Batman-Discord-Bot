/**
 * SQLite schema. All timestamps are epoch milliseconds (INTEGER) so that they
 * round-trip through JavaScript without timezone surprises.
 *
 * The statements are idempotent, so this runs on every boot. Columns added to
 * an existing table go in MIGRATIONS at the bottom of this file.
 */
export const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per Discord server, holding the ids created by /setup.
CREATE TABLE IF NOT EXISTS guilds (
  guild_id           TEXT PRIMARY KEY,
  rating_channel_id  TEXT,
  king_role_id       TEXT,
  -- Where challenge reports and the action log are written.
  king_channel_id    TEXT,
  -- Where the live stats-and-buttons message lives. A separate channel so
  -- rewriting it in place never disturbs the log.
  king_menu_channel_id TEXT,
  -- Legacy. The bot no longer creates a "white" category: channels that were
  -- already in the server are simply left alone. Kept so existing databases
  -- still open, never read or written.
  white_category_id  TEXT,
  setup_at           INTEGER,
  -- Set while the system is paused for maintenance. Channels are hidden and
  -- member-facing commands are refused, but every rating and standing stays
  -- exactly where it is, so resuming picks up where things left off.
  paused_at          INTEGER,
  -- When the one-time "the system is live" DM was switched on. Members are
  -- told on their first voice join after this moment, never before it.
  notice_active_at   INTEGER,
  -- Language for all bot messages in this guild. NULL means English (default).
  -- Values: 'en' | 'he'
  locale             TEXT NOT NULL DEFAULT 'en'
);

-- Small key/value scratchpad for things the bot needs to remember across
-- restarts but that do not warrant a table, such as the fingerprint of the
-- slash commands last registered with Discord.
CREATE TABLE IF NOT EXISTS bot_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Role + category ids for each tier, per server.
CREATE TABLE IF NOT EXISTS tier_roles (
  guild_id    TEXT NOT NULL,
  tier_key    TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  category_id TEXT,
  PRIMARY KEY (guild_id, tier_key)
);

-- Cached standing per member. Derived data: safe to delete and recompute.
-- A moderator's decisions live in score_credits, not here.
CREATE TABLE IF NOT EXISTS members (
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  participating INTEGER NOT NULL DEFAULT 1,
  tier_key      TEXT,
  score         REAL,
  rater_count   INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  -- Legacy, all three. Two earlier designs let a KING pin a member's area or
  -- their value outright, suspending the score while it held. That is gone:
  -- moderators now grant adjustments in score_credits, which the engine reads
  -- as ordinary signal. Kept so existing databases still open; never read, and
  -- blanked once by the migration at the bottom of this file so nobody is left
  -- parked under an override with nothing left to release it.
  override_score    REAL,
  override_tier_key TEXT,
  override_until    INTEGER,
  -- Last time this member moved to a worse tier, for the demotion cooldown.
  last_demotion_at  INTEGER,
  -- 1 when a moderator removed them, as opposed to them opting out. The
  -- difference matters only in one place: they cannot press Join to undo it.
  removed_by_admin  INTEGER NOT NULL DEFAULT 0,
  -- Set once the "the system is live" DM has actually been delivered. Two
  -- columns, not one, because a failed DM is not a delivery: attempted_at
  -- throttles retries while sent_at is the thing that guarantees exactly one.
  notice_sent_at      INTEGER,
  notice_attempted_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

-- The ratings themselves.
--   status 'active'    : counts toward the target's standing
--   status 'expired'   : aged out past VOTE_LIFETIME_DAYS, ignored, re-votable
--   status 'dropped'   : removed by a challenge because the voter went silent
--   status 'suspended' : one of the two people involved has opted out, so it
--                        counts for nobody. Restored if they come back before
--                        it would have expired anyway. This is what stops
--                        opt-out/opt-in being used to wipe a bad record.
-- The UNIQUE index is what enforces "one rating per person, per target".
CREATE TABLE IF NOT EXISTS votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  rater_id   TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  value      INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (guild_id, rater_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_target ON votes (guild_id, target_id, status);
CREATE INDEX IF NOT EXISTS idx_votes_rater  ON votes (guild_id, rater_id, status);

-- Re-review requests opened by a rated player.
--   state 'collecting'  : waiting on voter DM responses
--   state 'king_review' : voter window closed, KING may still override
--   state 'closed'      : finalised
CREATE TABLE IF NOT EXISTS challenges (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id           TEXT NOT NULL,
  target_id          TEXT NOT NULL,
  state              TEXT NOT NULL DEFAULT 'collecting',
  opened_at          INTEGER NOT NULL,
  response_deadline  INTEGER NOT NULL,
  king_deadline      INTEGER,
  snapshot_json      TEXT NOT NULL,
  king_message_id    TEXT,
  king_channel_id    TEXT,
  king_action        TEXT,
  king_user_id       TEXT,
  closed_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_challenges_open ON challenges (state, response_deadline);
CREATE INDEX IF NOT EXISTS idx_challenges_target ON challenges (guild_id, target_id, opened_at);

-- One row per voter invited to re-rate during a challenge.
--   response 'pending' | 'rerated' | 'kept' | 'dropped' | 'unreachable'
CREATE TABLE IF NOT EXISTS challenge_voters (
  challenge_id  INTEGER NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  rater_id      TEXT NOT NULL,
  previous_value INTEGER NOT NULL,
  response      TEXT NOT NULL DEFAULT 'pending',
  responded_at  INTEGER,
  PRIMARY KEY (challenge_id, rater_id)
);

-- Moderator adjustments: the only way a KING influences a standing.
--
-- A row is a bundle of synthetic votes: "reports" is how many, "value" is what
-- each one says (1 to ease off, 5 to push down). The scoring engine folds them
-- into the same weighted mean the real votes go into, so the community keeps
-- talking and can still overrule what a moderator did.
--
-- Rows are never deleted. Revoking sets revoked_at, which keeps a moderator's
-- decision to undo their own grant as visible as the grant itself.
CREATE TABLE IF NOT EXISTS score_credits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  target_id  TEXT NOT NULL,
  value      REAL NOT NULL,
  reports    REAL NOT NULL,
  granted_by TEXT NOT NULL,
  -- Free text from the granting KING, shown only in the admin channels.
  reason     TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_credits_live
  ON score_credits (guild_id, target_id, revoked_at, expires_at);

-- Provenance for everything /standing-setup touched, so /standing-revert can
-- put the server back exactly as it found it.
--   created_by_bot = 1  the bot made this, so revert deletes it
--   created_by_bot = 0  the bot adopted something that already existed, so
--                       revert restores its old parent and permissions instead
-- previous_overwrites is a JSON array of { id, type, allow, deny }, with the
-- permission bitfields kept as strings because they exceed Number.MAX_SAFE_INTEGER.
CREATE TABLE IF NOT EXISTS provisioned_items (
  guild_id            TEXT NOT NULL,
  kind                TEXT NOT NULL,
  discord_id          TEXT NOT NULL,
  name                TEXT NOT NULL,
  created_by_bot      INTEGER NOT NULL,
  previous_parent_id  TEXT,
  previous_overwrites TEXT,
  created_at          INTEGER NOT NULL,
  PRIMARY KEY (guild_id, discord_id)
);

-- Append-only trail. Deliberately stores no vote values for third parties,
-- so an admin reading the table cannot reconstruct who rated whom badly.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  subject_id TEXT,
  detail     TEXT,
  created_at INTEGER NOT NULL
);
`;

/**
 * Additive column migrations for databases created by an earlier version.
 * Each statement is attempted once per boot and a "duplicate column" error is
 * swallowed, which is the cheapest correct thing for a single-file SQLite app.
 */
export const MIGRATIONS: string[] = [
  'ALTER TABLE members ADD COLUMN override_tier_key TEXT',
  'ALTER TABLE members ADD COLUMN override_until INTEGER',
  'ALTER TABLE members ADD COLUMN last_demotion_at INTEGER',
  'ALTER TABLE members ADD COLUMN removed_by_admin INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE guilds ADD COLUMN paused_at INTEGER',
  'ALTER TABLE members ADD COLUMN notice_sent_at INTEGER',
  'ALTER TABLE members ADD COLUMN notice_attempted_at INTEGER',
  'ALTER TABLE guilds ADD COLUMN notice_active_at INTEGER',
  'ALTER TABLE guilds ADD COLUMN king_menu_channel_id TEXT',
  'ALTER TABLE members ADD COLUMN override_score REAL',
  // Retire the override mechanism. Nothing reads these columns any more, and
  // nothing writes them, so leaving a live override in place would strand the
  // member on a value with no code path left to lapse it. Idempotent by the
  // same token: after the first run there is nothing left to blank.
  'UPDATE members SET override_score = NULL, override_tier_key = NULL, override_until = NULL',
  "ALTER TABLE guilds ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'",
];
