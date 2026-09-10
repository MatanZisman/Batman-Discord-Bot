import type { GuildMember, VoiceState } from 'discord.js';
import { HOUR_MS, SERVER_LAYOUT, TIERS } from '../config.js';
import * as repo from '../db/repo.js';
import { stringsIn } from '../i18n/index.js';
import { logger } from '../lib/logger.js';
import { maintenanceNotice } from './maintenance.js';

/**
 * ============================================================================
 *  THE ONE-TIME "THIS SYSTEM EXISTS" DM
 * ============================================================================
 *  Tells each member the system exists, once, as a private DM. Two triggers
 *  feed one ledger:
 *
 *    ARRIVAL   somebody joins the server and is enrolled. This is the only
 *              way a member who was not present at launch ever hears about
 *              the system.
 *    VOICE     the first voice join after a KING switched announcements on.
 *              This is the launch case, for the members already in the server.
 *
 *  ONE LEDGER, NOT TWO. Both write `notice_sent_at`, so a member who arrives
 *  today and plays tomorrow is told once, not twice. Keeping them separate
 *  would produce exactly the duplicate the ledger exists to prevent, since
 *  every new arrival is also, shortly afterwards, a first voice join.
 *
 *  WHY THIS TRIGGER
 *  Two reasons, and the second is the load-bearing one. It is courteous:
 *  people hear about it as they sit down to play, which is when it is relevant
 *  and when they are most likely to read it. And it is safe: DMing every
 *  member of a server inside a few minutes is exactly the pattern Discord's
 *  anti-spam heuristics act on, and can get a bot flagged. A voice trigger
 *  spreads the same messages over days without any scheduling code.
 *
 *  WHY IT IS EXACTLY ONCE
 *  Voice state events are not one-per-join: a client can emit several for what
 *  a person experiences as a single action, and reconnects replay them. So the
 *  send is claimed atomically in SQLite before Discord is called, and the
 *  claim is persistent — a redeploy does not re-arm anyone. See
 *  repo.claimJoinNotice for the mechanics.
 *
 *  WHY A FAILED DM IS NOT A SENT DM
 *  Members can refuse DMs from the server, and the API simply errors. Marking
 *  those people "notified" would drop them silently, so delivery is confirmed
 *  in a second column and a failure leaves them eligible for their next voice
 *  join, throttled by RETRY_COOLDOWN_HOURS so a member with DMs closed does
 *  not generate a failed call every time they hop channels.
 * ============================================================================
 */

/** A failed delivery is not retried more often than this. */
const RETRY_COOLDOWN_HOURS = 24;

/** True only for "was in no voice channel, now is in one". */
export function isFreshVoiceJoin(oldState: VoiceState, newState: VoiceState): boolean {
  // Mutes, deafens, streams and camera toggles all arrive as voice state
  // updates with an unchanged channel, and a move between two channels is a
  // change between two non-null ones. Neither is someone arriving.
  return oldState.channelId === null && newState.channelId !== null;
}

/**
 * Sends the notice if this member is due one. Safe to call on every voice
 * event: all the gating lives here, and the common case is one indexed read.
 */
export async function maybeSendJoinNotice(member: GuildMember, channelId: string): Promise<void> {
  const guild = member.guild;

  // The launch case only, so it waits for a KING to switch announcements on.
  if (!repo.getJoinNoticeActiveAt(guild.id)) return;
  // Sitting in AFK is not sitting down to play.
  if (guild.afkChannelId && channelId === guild.afkChannelId) return;

  await deliver(member, 'voice');
}

/**
 * Sends the welcome to somebody who has just joined the server.
 *
 * Not gated on the announcement switch, unlike the voice trigger. That switch
 * answers "should I go and tell the people already here?", which is a one-off
 * decision about a bulk send. A single new arrival is a different question,
 * and a server that has had the system running for months should still
 * introduce it to the person who walked in five seconds ago — otherwise they
 * are the only member who never finds out why some channels are invisible.
 */
export async function maybeSendArrivalNotice(member: GuildMember): Promise<void> {
  await deliver(member, 'arrival');
}

type Flavour = 'voice' | 'arrival';

async function deliver(member: GuildMember, flavour: Flavour): Promise<void> {
  if (member.user.bot) return;

  const guild = member.guild;

  // Nothing to point them at before setup has run, and nothing to advertise
  // while the system is hidden for maintenance.
  const settings = repo.getGuildSettings(guild.id);
  if (!settings?.rating_channel_id) return;
  if (maintenanceNotice(guild.id)) return;

  const record = repo.ensureMember(guild.id, member.id, member.joinedTimestamp ?? Date.now());
  if (record.notice_sent_at !== null) return;
  // Someone outside the system has already made a decision about it.
  if (record.participating === 0) return;

  const retryCutoff = Date.now() - RETRY_COOLDOWN_HOURS * HOUR_MS;
  if (!repo.claimJoinNotice(guild.id, member.id, retryCutoff)) return;

  try {
    await member.send(buildNoticeBody(guild.id, flavour));
    repo.confirmJoinNoticeSent(guild.id, member.id);
    repo.audit(guild.id, 'notice_sent', member.id, flavour);
    logger.debug(`Sent the ${flavour} notice to ${member.id} in ${guild.id}`);
  } catch {
    // Almost always error 50007: DMs from server members are closed. The
    // claim stands as an attempt, so they come round again after the
    // cooldown rather than being written off.
    logger.debug(`Could not DM the notice to ${member.id}; will retry after the cooldown.`);
  }
}

function buildNoticeBody(guildId: string, flavour: Flavour): string {
  const t = stringsIn(guildId);
  const settings = repo.getGuildSettings(guildId);
  const hub = settings?.rating_channel_id ? `<#${settings.rating_channel_id}>` : 'the standing channel';
  const firstTier = TIERS[0]?.roleName ?? 'the first area';

  const greeting = flavour === 'arrival' ? t.dm.arrivalGreeting : t.dm.voiceGreeting;
  const body = flavour === 'arrival'
    ? t.dm.arrivalBody({ firstArea: firstTier })
    : t.dm.voiceBody({ firstArea: firstTier });

  return [
    greeting,
    '',
    body,
    '',
    t.dm.noticeShort,
    '',
    t.dm.noticeHub({ channel: hub }),
    '',
    t.dm.noticeOptOut({ channel: hub, king: SERVER_LAYOUT.kingRoleName }),
  ].join('\n');
}
