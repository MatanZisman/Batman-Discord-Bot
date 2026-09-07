import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Guild } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SERVER_LAYOUT, TIERS } from '../config.js';
import { closeDatabase, getDatabase, openDatabase } from '../db/index.js';
import * as repo from '../db/repo.js';
import { planRevert, revertGuild } from './guild-teardown.js';

/**
 * ============================================================================
 *  THE KING ROLE MUST SURVIVE A REVERT UNHARMED
 * ============================================================================
 *  A server that already had a KING role before the bot arrived has a
 *  membership list the bot never wrote: the actual moderators. The bot only
 *  ever reads that role, to decide who may run a command. So revert has two
 *  obligations towards it that it does not have towards a tier role — don't
 *  delete it, and don't empty it — and getting either wrong destroys state
 *  that exists nowhere else and cannot be rebuilt.
 *
 *  These drive the real revertGuild against a guild stub that records every
 *  mutation, rather than asserting on the plan, so that the assertions are
 *  about what happens to the role and not about how the code is organised.
 * ============================================================================
 */

const dbPath = join(tmpdir(), `teardown-test-${process.pid}.db`);
const GUILD = 'guild-teardown';

const KING_ID = 'role-king';
const GREEN_ID = 'role-green';
const YELLOW_ID = 'role-yellow';

const greenName = TIERS[0]!.roleName;
const yellowName = TIERS[1]!.roleName;

interface Mutations {
  deletedRoles: string[];
  /** `${roleId}/${memberId}` for every role taken off somebody. */
  removals: string[];
}

interface StubRole {
  id: string;
  name: string;
  /** Member ids currently holding the role. */
  holders?: string[];
}

/**
 * The smallest thing revertGuild will accept, with the role mutations wired to
 * a log instead of Discord. An empty channel cache makes steps 1-3 no-ops, so
 * what remains is exactly the role handling under test.
 */
function fakeGuild(roles: StubRole[]): { guild: Guild; mutations: Mutations } {
  const mutations: Mutations = { deletedRoles: [], removals: [] };

  const cache = new Map(
    roles.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        position: 1,
        managed: false,
        delete: async () => {
          mutations.deletedRoles.push(r.id);
        },
        members: new Map(
          (r.holders ?? []).map((memberId) => [
            memberId,
            {
              id: memberId,
              roles: {
                remove: async () => {
                  mutations.removals.push(`${r.id}/${memberId}`);
                },
              },
            },
          ]),
        ),
      },
    ]),
  );

  const guild = {
    id: GUILD,
    roles: { cache, everyone: { id: 'role-everyone' } },
    channels: { cache: new Map() },
    members: { me: { roles: { highest: { position: 99 } } } },
  } as unknown as Guild;

  return { guild, mutations };
}

beforeAll(() => {
  rmSync(dbPath, { force: true });
  openDatabase(dbPath);
});

afterAll(() => {
  closeDatabase();
  rmSync(dbPath, { force: true });
});

beforeEach(() => {
  const db = getDatabase();
  db.prepare('DELETE FROM provisioned_items WHERE guild_id = ?').run(GUILD);
  db.prepare('DELETE FROM tier_roles WHERE guild_id = ?').run(GUILD);
});

/** Records what setupGuild records when it adopts a role it found in place. */
function adopt(id: string, name: string): void {
  repo.recordProvisionedItem({ guildId: GUILD, kind: 'role', discordId: id, name, createdByBot: false });
}

/** Records what setupGuild records for a role it created itself. */
function created(id: string, name: string): void {
  repo.recordProvisionedItem({ guildId: GUILD, kind: 'role', discordId: id, name, createdByBot: true });
}

describe('a KING role that predates the bot', () => {
  it('survives revert with its moderators still in it', async () => {
    adopt(KING_ID, SERVER_LAYOUT.kingRoleName);
    created(YELLOW_ID, yellowName);
    repo.setTierRole(GUILD, TIERS[1]!.key, YELLOW_ID, null);

    const { guild, mutations } = fakeGuild([
      { id: KING_ID, name: SERVER_LAYOUT.kingRoleName, holders: ['mod-a', 'mod-b'] },
      { id: YELLOW_ID, name: yellowName, holders: ['player'] },
    ]);

    const report = await revertGuild(guild);

    // The role itself is still there...
    expect(mutations.deletedRoles).not.toContain(KING_ID);
    // ...and so is every moderator in it.
    expect(mutations.removals.filter((r) => r.startsWith(`${KING_ID}/`))).toEqual([]);
    expect(report.untouchedRoles).toContain(SERVER_LAYOUT.kingRoleName);

    // The bot's own tier role is deleted outright, which is the contrast.
    expect(mutations.deletedRoles).toContain(YELLOW_ID);
  });

  it('is left alone even when the bot cannot prove who made it', async () => {
    // Provenance gone: the database was reset, or setup ran on an older
    // build. The name-matching sweep is all that is left, and it must not
    // reach for KING on the strength of a name alone.
    const { guild, mutations } = fakeGuild([
      { id: KING_ID, name: SERVER_LAYOUT.kingRoleName, holders: ['mod-a'] },
      { id: GREEN_ID, name: greenName, holders: ['player'] },
    ]);

    await revertGuild(guild, { includeUnrecorded: true });

    expect(mutations.deletedRoles).not.toContain(KING_ID);
    expect(mutations.removals).toEqual([]);
    // A tier role by the same measure *is* swept: the bot assigns those, so
    // leaving one behind leaves the bot's placements on real members.
    expect(mutations.deletedRoles).toContain(GREEN_ID);
  });

  it('is not confused with a tier role in the plan', () => {
    adopt(KING_ID, SERVER_LAYOUT.kingRoleName);
    adopt(GREEN_ID, greenName);
    repo.setTierRole(GUILD, TIERS[0]!.key, GREEN_ID, null);

    const { guild } = fakeGuild([
      { id: KING_ID, name: SERVER_LAYOUT.kingRoleName },
      { id: GREEN_ID, name: greenName },
    ]);
    const plan = planRevert(guild);

    expect(plan.rolesToRelease.find((r) => r.id === KING_ID)?.assignedByBot).not.toBe(true);
    expect(plan.rolesToRelease.find((r) => r.id === GREEN_ID)?.assignedByBot).toBe(true);
  });
});

describe('a tier role that predates the bot', () => {
  it('is kept, but comes off the members the bot put in it', async () => {
    adopt(GREEN_ID, greenName);
    repo.setTierRole(GUILD, TIERS[0]!.key, GREEN_ID, null);

    const { guild, mutations } = fakeGuild([
      { id: GREEN_ID, name: greenName, holders: ['player-a', 'player-b'] },
    ]);

    const report = await revertGuild(guild);

    expect(mutations.deletedRoles).not.toContain(GREEN_ID);
    expect(mutations.removals).toEqual([`${GREEN_ID}/player-a`, `${GREEN_ID}/player-b`]);
    expect(report.releasedRoles).toContain(greenName);
  });
});
