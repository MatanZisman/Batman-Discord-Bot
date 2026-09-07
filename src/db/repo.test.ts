import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase } from './index.js';
import * as repo from './repo.js';

/**
 * Exercises the real schema against a real SQLite file. The point is to catch
 * broken SQL and to prove the storage-level guarantees the product relies on:
 * one rating per rater per target, and expiry that leaves the row re-votable.
 */
const dbPath = join(tmpdir(), `standing-test-${process.pid}.db`);
const GUILD = 'guild-1';

beforeAll(() => {
  rmSync(dbPath, { force: true });
  openDatabase(dbPath);
});

afterAll(() => {
  closeDatabase();
  rmSync(dbPath, { force: true });
});

describe('votes', () => {
  it('keeps exactly one rating per rater per target', () => {
    const first = repo.upsertVote(GUILD, 'matan', 'meitar', 4);
    const second = repo.upsertVote(GUILD, 'matan', 'meitar', 2);

    expect(first.previousValue).toBeNull();
    expect(second.previousValue).toBe(4);

    const stored = repo.getVotesForTarget(GUILD, 'meitar');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.value).toBe(2);
  });

  it('counts ratings from different raters separately', () => {
    repo.upsertVote(GUILD, 'someone-else', 'meitar', 5);
    expect(repo.getVotesForTarget(GUILD, 'meitar', 'active')).toHaveLength(2);
  });

  it('expires stale ratings and reports who needs recomputing', () => {
    const affected = repo.expireStaleVotes(Date.now() + 1);

    expect(affected).toEqual(expect.arrayContaining([{ guild_id: GUILD, target_id: 'meitar' }]));
    expect(repo.getVotesForTarget(GUILD, 'meitar', 'active')).toHaveLength(0);
    expect(repo.getVotesForTarget(GUILD, 'meitar', 'expired')).toHaveLength(2);
  });

  it('lets an expired rating be cast again by the same rater', () => {
    const result = repo.upsertVote(GUILD, 'matan', 'meitar', 1);

    expect(result.created).toBe(true);
    expect(repo.getVotesForTarget(GUILD, 'meitar', 'active')).toHaveLength(1);
    expect(repo.getVotesForTarget(GUILD, 'meitar')).toHaveLength(2);
  });

  it('wipes both directions when someone opts out', () => {
    repo.ensureMember(GUILD, 'matan');
    repo.upsertVote(GUILD, 'third-party', 'matan', 5);

    const affected = repo.deleteVotesInvolving(GUILD, 'matan');

    expect(affected).toContain('meitar');
    expect(repo.getVotesForTarget(GUILD, 'matan')).toHaveLength(0);
    expect(repo.getVote(GUILD, 'matan', 'meitar')).toBeUndefined();
  });
});

describe('members', () => {
  it('creates a member once and preserves their first-seen time', () => {
    const created = repo.ensureMember(GUILD, 'stable-user', 1000);
    const again = repo.ensureMember(GUILD, 'stable-user', 9999);

    expect(created.first_seen_at).toBe(1000);
    expect(again.first_seen_at).toBe(1000);
    expect(again.participating).toBe(1);
  });

  it('clears standing when a member opts out and restores a clean slate on return', () => {
    repo.ensureMember(GUILD, 'leaver');
    repo.saveStanding(GUILD, 'leaver', 'orange', 3.4, 7);

    repo.setParticipation(GUILD, 'leaver', false);
    const out = repo.getMember(GUILD, 'leaver');
    expect(out?.participating).toBe(0);
    expect(out?.tier_key).toBeNull();
    expect(out?.score).toBeNull();
    expect(out?.rater_count).toBe(0);

    repo.setParticipation(GUILD, 'leaver', true);
    expect(repo.getMember(GUILD, 'leaver')?.participating).toBe(1);
  });

  it('stores and clears a KING placement override', () => {
    repo.ensureMember(GUILD, 'disputed');
    repo.setTierOverride(GUILD, 'disputed', 'yellow', 5_000);

    expect(repo.getMember(GUILD, 'disputed')?.override_tier_key).toBe('yellow');
    expect(repo.getMember(GUILD, 'disputed')?.override_until).toBe(5_000);

    repo.setTierOverride(GUILD, 'disputed', null, null);
    expect(repo.getMember(GUILD, 'disputed')?.override_tier_key).toBeNull();
  });
});

describe('provisioned items', () => {
  it('remembers whether the bot created an item or adopted it', () => {
    repo.recordProvisionedItem({
      guildId: GUILD,
      kind: 'channel',
      discordId: 'chan-created',
      name: 'green-chat',
      createdByBot: true,
    });
    repo.recordProvisionedItem({
      guildId: GUILD,
      kind: 'channel',
      discordId: 'chan-adopted',
      name: 'general',
      createdByBot: false,
      previousParentId: null,
      previousOverwrites: [{ id: 'everyone', type: 0, allow: '1024', deny: '0' }],
    });

    const items = repo.listProvisionedItems(GUILD);
    const created = items.find((i) => i.discord_id === 'chan-created');
    const adopted = items.find((i) => i.discord_id === 'chan-adopted');

    expect(created?.created_by_bot).toBe(1);
    expect(adopted?.created_by_bot).toBe(0);
    expect(JSON.parse(adopted?.previous_overwrites ?? '[]')).toHaveLength(1);
  });

  it('never relabels an adopted item as bot-created on re-setup', () => {
    // Re-running /standing-setup must not make revert delete #general.
    repo.recordProvisionedItem({
      guildId: GUILD,
      kind: 'channel',
      discordId: 'chan-adopted',
      name: 'general',
      createdByBot: true,
    });

    const adopted = repo.listProvisionedItems(GUILD).find((i) => i.discord_id === 'chan-adopted');
    expect(adopted?.created_by_bot).toBe(0);
  });

  it('never relabels a bot-created item as adopted on re-setup', () => {
    // The dangerous direction: a second /standing-setup finds its own channel
    // already present and reports it as adopted. If that stuck, revert would
    // leave the bot's own channels behind forever.
    repo.recordProvisionedItem({
      guildId: GUILD,
      kind: 'channel',
      discordId: 'chan-created',
      name: 'green-chat',
      createdByBot: false,
    });

    const created = repo.listProvisionedItems(GUILD).find((i) => i.discord_id === 'chan-created');
    expect(created?.created_by_bot).toBe(1);
  });

  it('keeps the original snapshot when setup runs again', () => {
    repo.recordProvisionedItem({
      guildId: GUILD,
      kind: 'channel',
      discordId: 'chan-adopted',
      name: 'general',
      createdByBot: false,
      previousOverwrites: [{ id: 'everyone', type: 0, allow: '999', deny: '999' }],
    });

    const adopted = repo.listProvisionedItems(GUILD).find((i) => i.discord_id === 'chan-adopted');
    const stored = JSON.parse(adopted?.previous_overwrites ?? '[]') as repo.StoredOverwrite[];
    expect(stored[0]?.allow).toBe('1024');
  });
});

describe('challenges', () => {
  it('runs through the phases and can restore its snapshot', () => {
    repo.ensureMember(GUILD, 'appellant');
    repo.upsertVote(GUILD, 'rater-a', 'appellant', 5);
    repo.upsertVote(GUILD, 'rater-b', 'appellant', 4);

    const snapshot: repo.ChallengeSnapshot = {
      tier_key: 'orange',
      score: 3.4,
      rater_count: 2,
      votes: repo.getVotesForTarget(GUILD, 'appellant').map((v) => ({
        rater_id: v.rater_id,
        value: v.value,
        status: v.status,
        updated_at: v.updated_at,
      })),
    };

    const id = repo.createChallenge({
      guildId: GUILD,
      targetId: 'appellant',
      responseDeadline: Date.now() - 1,
      snapshot,
    });

    repo.addChallengeVoter(id, 'rater-a', 5);
    repo.addChallengeVoter(id, 'rater-b', 4);
    repo.addChallengeVoter(id, 'rater-a', 5); // duplicate invite is a no-op
    expect(repo.getChallengeVoters(id)).toHaveLength(2);

    // rater-a answers, rater-b goes silent and is dropped.
    repo.setChallengeVoterResponse(id, 'rater-a', 'kept');
    const silent = repo.getVote(GUILD, 'rater-b', 'appellant');
    repo.setVoteStatus(silent!.id, 'dropped');
    repo.setChallengeVoterResponse(id, 'rater-b', 'dropped');

    expect(repo.getVotesForTarget(GUILD, 'appellant', 'active')).toHaveLength(1);
    expect(repo.listChallengesNeedingAttention(Date.now())).toHaveLength(1);

    // The KING undoes it: every rating comes back exactly as it was.
    for (const vote of snapshot.votes) {
      repo.restoreVote(GUILD, vote.rater_id, 'appellant', vote.value, vote.status, vote.updated_at);
    }
    expect(repo.getVotesForTarget(GUILD, 'appellant', 'active')).toHaveLength(2);

    repo.updateChallenge(id, { state: 'closed', closed_at: Date.now(), king_action: 'revert' });
    expect(repo.getChallenge(id)?.state).toBe('closed');
    expect(repo.listChallengesNeedingAttention(Date.now())).toHaveLength(0);
  });
});

describe('clearing a guild', () => {
  it('erases every trace of the guild and leaves other guilds alone', () => {
    const OTHER = 'guild-2';
    repo.ensureMember(OTHER, 'bystander');
    repo.upsertVote(OTHER, 'bystander', 'someone', 3);

    // Something in every table for the guild being wiped.
    repo.saveGuildSettings({
      guild_id: GUILD,
      rating_channel_id: 'c1',
      king_role_id: 'r1',
      king_channel_id: 'c2',
    });
    repo.setTierRole(GUILD, 'green', 'role-green', 'cat-green');
    repo.audit(GUILD, 'setup');

    const removed = repo.clearGuildData(GUILD);

    expect(removed).toBeGreaterThan(0);
    expect(repo.getGuildSettings(GUILD)).toBeUndefined();
    expect(repo.getTierRoles(GUILD)).toHaveLength(0);
    expect(repo.listProvisionedItems(GUILD)).toHaveLength(0);
    expect(repo.listParticipatingMembers(GUILD)).toHaveLength(0);
    expect(repo.getVotesForTarget(GUILD, 'appellant')).toHaveLength(0);
    expect(repo.getLatestChallenge(GUILD, 'appellant')).toBeUndefined();

    // The other server is untouched.
    expect(repo.getMember(OTHER, 'bystander')).toBeDefined();
    expect(repo.getVotesForTarget(OTHER, 'someone')).toHaveLength(1);
  });
});
