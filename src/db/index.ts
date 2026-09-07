import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';
import { logger } from '../lib/logger.js';
import { MIGRATIONS, SCHEMA } from './schema.js';

let db: Database.Database | null = null;

export interface DatabaseLocation {
  path: string;
  /** False when the file sits on storage that a redeploy will wipe. */
  durable: boolean;
  /** Human-readable explanation, used in the startup error. */
  reason: string;
}

/** True when we appear to be running on Railway rather than a developer laptop. */
function onRailway(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.RAILWAY_ENVIRONMENT_NAME ?? env.RAILWAY_PROJECT_ID ?? env.RAILWAY_SERVICE_ID);
}

function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  // An empty result means the two are the same path; ".." means we escaped it.
  // Checking the relative path rather than a string prefix avoids treating
  // /data2/x as living inside /data.
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Decides where the database file goes, and whether that location survives a
 * redeploy.
 *
 * Container filesystems on hosts like Railway are ephemeral: anything not on a
 * mounted volume is discarded on every deploy. For this bot that is worse than
 * it first sounds. Losing the ratings would be bad enough, but the same file
 * holds `provisioned_items`, the record of which roles and channels the bot
 * created versus adopted. Lose that and /standing-revert can no longer tell
 * the difference, so it degrades to guessing by name — which is exactly the
 * situation its warnings exist to avoid.
 *
 * Railway sets RAILWAY_VOLUME_MOUNT_PATH automatically once a volume is
 * attached, so the default needs no configuration when one is present.
 */
export function resolveDatabaseLocation(env: NodeJS.ProcessEnv = process.env): DatabaseLocation {
  const volume = env.RAILWAY_VOLUME_MOUNT_PATH;
  const explicit = env.DATABASE_PATH;
  const hosted = onRailway(env);

  if (explicit) {
    if (!hosted) {
      return { path: explicit, durable: true, reason: 'DATABASE_PATH on a local filesystem' };
    }
    if (volume && isInside(explicit, volume)) {
      return { path: explicit, durable: true, reason: `DATABASE_PATH inside the volume at ${volume}` };
    }
    return {
      path: explicit,
      durable: false,
      reason: volume
        ? `DATABASE_PATH (${explicit}) is outside the mounted volume (${volume})`
        : `DATABASE_PATH (${explicit}) is set but no volume is mounted`,
    };
  }

  if (volume) {
    // A mount path is always a Linux container path, even when this code is
    // being exercised from a Windows machine, so join it as one.
    return {
      path: posix.join(volume, 'standing.db'),
      durable: true,
      reason: `volume mounted at ${volume}`,
    };
  }

  return {
    path: './data/standing.db',
    durable: !hosted,
    reason: hosted ? 'no volume is mounted and DATABASE_PATH is unset' : 'local ./data directory',
  };
}

/** Opens (and on first call creates) the SQLite database. */
export function openDatabase(path?: string): Database.Database {
  if (db) return db;

  const location = path
    ? { path, durable: true, reason: 'explicit path' }
    : resolveDatabaseLocation();

  // Refusing to start is deliberately harsher than warning. A bot that boots
  // happily onto disposable storage looks completely healthy right up until a
  // deploy silently resets every rating in the server.
  if (!location.durable && process.env.ALLOW_EPHEMERAL_DB !== 'true') {
    throw new Error(
      [
        `Refusing to start: the database would not survive a redeploy (${location.reason}).`,
        '',
        'Attach a volume to this service (Railway: service → Variables → Volumes → New Volume)',
        'and the bot will pick it up automatically. Mounting it at /data is a fine choice.',
        '',
        'If you genuinely want throwaway storage — a scratch test service, say — set',
        'ALLOW_EPHEMERAL_DB=true and every rating will be lost on each deploy.',
      ].join('\n'),
    );
  }

  const absolute = resolve(location.path);
  mkdirSync(dirname(absolute), { recursive: true });

  logger.info(`Database at ${absolute} (${location.reason})`);

  db = new Database(absolute);
  db.exec(SCHEMA);

  for (const statement of MIGRATIONS) {
    try {
      db.exec(statement);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('duplicate column name')) throw error;
    }
  }

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) return openDatabase();
  return db;
}

/** Runs a function inside a transaction. Rolls back on any throw. */
export function transact<T>(fn: () => T): T {
  return getDatabase().transaction(fn)();
}

export function closeDatabase(): void {
  db?.close();
  db = null;
}
