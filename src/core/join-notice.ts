import type { GuildMember, VoiceState } from 'discord.js';
import { HOUR_MS, SERVER_LAYOUT, TIERS } from '../config.js';
import * as repo from '../db/repo.js';
import { logger } from '../lib/logger.js';
import { maintenanceNotice } from './maintenance.js';

/**
 * ============================================================================
 *  THE ONE-TIME LAUNCH NOTICE
 * ============================================================================
 *  Tells each member the system exists, once, as a private DM, triggered by
 *  their first voice join after the notice was switched on.
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
  if (member.user.bot) return;

  const guild = member.guild;
  if (!repo.getJoinNoticeActiveAt(guild.id)) return;
  // Nothing to advertise while the system is hidden.
  if (maintenanceNotice(guild.id)) return;
  // Sitting in AFK is not sitting down to play.
  if (guild.afkChannelId && channelId === guild.afkChannelId) return;

  const record = repo.ensureMember(guild.id, member.id, member.joinedTimestamp ?? Date.now());
  if (record.notice_sent_at !== null) return;
  // Someone outside the system has already made a decision about it.
  if (record.participating === 0) return;

  const retryCutoff = Date.now() - RETRY_COOLDOWN_HOURS * HOUR_MS;
  if (!repo.claimJoinNotice(guild.id, member.id, retryCutoff)) return;

  try {
    await member.send(buildNoticeBody(guild.id));
    repo.confirmJoinNoticeSent(guild.id, member.id);
    repo.audit(guild.id, 'notice_sent', member.id);
    logger.debug(`Sent the launch notice to ${member.id} in ${guild.id}`);
  } catch {
    // Almost always error 50007: DMs from server members are closed. The
    // claim stands as an attempt, so they come round again after the
    // cooldown rather than being written off.
    logger.debug(`Could not DM the launch notice to ${member.id}; will retry after the cooldown.`);
  }
}

function buildNoticeBody(guildId: string): string {
  const settings = repo.getGuildSettings(guildId);
  const hub = settings?.rating_channel_id ? `<#${settings.rating_channel_id}>` : 'the standing channel';
  const firstTier = TIERS[0]?.roleName ?? 'the first area';

  return [
    `**Something new in the server**`,
    '',
    `There is now a community rating system for how people are to play with. Teammates rate each other privately, and that decides which set of channels you see. You start in **${firstTier}**, along with everyone else.`,
    '',
    `The short version: ratings are private, nobody can see who rated them or what anyone else was given, and no channel ever announces anyone's rating. You can rate people, see your own standing, ask for a re-review if you think yours is wrong, or leave the system entirely.`,
    '',
    `Everything is explained in ${hub}, and anything you do there is visible only to you.`,
    '',
    `This is the only message I will send you about this. If you would rather not take part at all, there is a button in ${hub} to opt out, and the ${SERVER_LAYOUT.kingRoleName} role can answer questions.`,
  ].join('\n');
}
