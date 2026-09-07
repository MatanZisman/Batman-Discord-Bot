import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { CREDITS, SERVER_LAYOUT, tierAt } from '../config.js';
import type { AdjustmentPreview } from '../core/adjustments.js';
import type { AdminStats } from '../core/king-stats.js';
import { NS, encodeId } from '../lib/custom-ids.js';
import { buildAdjustmentOptions } from './challenge.js';

/**
 * The pinned control panel: a snapshot at the top, the buttons underneath.
 *
 * This is one message that gets rewritten in place, which is why it lives in
 * its own channel. Every button either edits it or answers ephemerally, so the
 * channel never accumulates anything and two KINGs looking at it at the same
 * time do not fight over each other's screens.
 */
export function buildKingMenuMessage(stats: AdminStats, logChannelId: string | null): BaseMessageOptions {
  return {
    content: renderStats(stats, logChannelId),
    components: [
      // Row 1: the things you press most, and the one that needs attention.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'refresh'))
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'recalc'))
          .setLabel('Recalculate all')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'adjust'))
          .setLabel("Adjust a member's score")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'undo'))
          .setLabel('Undo an adjustment')
          .setStyle(ButtonStyle.Secondary),
      ),
      // Row 2: membership, which is the destructive corner.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'remove'))
          .setLabel('Remove a member')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'reinstate'))
          .setLabel('Reinstate a member')
          .setStyle(ButtonStyle.Secondary),
      ),
      // Row 3: whole-system switches.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, stats.paused ? 'resume' : 'pause'))
          .setLabel(stats.paused ? 'Resume the system' : 'Pause for maintenance')
          .setStyle(stats.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, stats.noticeActiveAt ? 'notice-off' : 'notice-on'))
          .setLabel(stats.noticeActiveAt ? 'Stop announcing' : 'Announce to members')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'refresh-hub'))
          .setLabel('Repost the public guide')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function renderStats(stats: AdminStats, logChannelId: string | null): string {
  const status = stats.paused
    ? '**PAUSED** — channels hidden, member commands refused, all data intact.'
    : 'Running normally.';

  const announce = stats.noticeActiveAt
    ? `On since <t:${Math.floor(stats.noticeActiveAt / 1000)}:R>. ${stats.noticePending} still to be told.`
    : `Off. ${stats.noticePending} member(s) have never been told the system exists.`;

  const spread = stats.tiers.map((t) => `${t.roleName} **${t.count}**`).join(' · ');

  const attention = [
    stats.challengesAwaitingKing > 0
      ? `**${stats.challengesAwaitingKing} review(s) waiting on a decision from you.**`
      : null,
    stats.openChallenges > stats.challengesAwaitingKing
      ? `${stats.openChallenges - stats.challengesAwaitingKing} review(s) still gathering answers.`
      : null,
    stats.adjustedMembers > 0
      ? `${stats.adjustedMembers} member(s) carrying a moderator adjustment.`
      : null,
  ].filter(Boolean);

  return [
    `# ${SERVER_LAYOUT.kingRoleName} control panel`,
    status,
    '',
    '**Where everyone sits**',
    spread,
    `${stats.participating} taking part · ${stats.optedOut} opted out · ${stats.removed} removed`,
    '',
    '**Activity**',
    `${stats.ratingsLastDay} rating(s) in the last day, ${stats.ratingsLastWeek} in the last week.`,
    `${stats.activeRatings} rating(s) currently counting, from ${stats.activeRaters} rater(s).`,
    '',
    '**Announcement**',
    announce,
    ...(attention.length > 0 ? ['', '**Needs a look**', ...attention] : []),
    '',
    [
      '-# Counts only — nothing here names anyone, by design.',
      'Accurate as of the last Refresh.',
      logChannelId ? `Action history is in <#${logChannelId}>.` : null,
    ]
      .filter(Boolean)
      .join(' '),
  ].join('\n');
}

/** Step 1 of the member-targeted actions: who? */
export function buildMemberPicker(
  action: 'adjust' | 'remove' | 'reinstate' | 'undo',
): BaseMessageOptions {
  const prompt = {
    adjust: 'Whose score do you want to lean on?',
    undo: 'Whose adjustments do you want to take back?',
    remove: 'Who do you want to remove from the system?',
    reinstate: 'Who do you want to let back in?',
  }[action];

  const warning = {
    adjust:
      'You are adding signal, not setting an area. The community score keeps running, so enough people can still overrule you — the next screen tells you exactly how many.',
    undo: 'Everything currently granted to them is withdrawn and their score goes back to being the community\'s alone.',
    remove:
      'They leave the system and cannot rejoin themselves. Their ratings are suspended, not deleted, so reinstating them puts things back.',
    reinstate:
      'This only lifts the block. They stay outside the system until they choose to rejoin, and their suspended ratings resume then.',
  }[action];

  return {
    content: [`**${prompt}**`, '', warning].join('\n'),
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(encodeId(NS.MENU, `pick-${action}`))
          .setPlaceholder('Choose a member')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ],
  };
}

/**
 * Step 2 of "lean on a member's score": by how much, and which way.
 *
 * The unit is reports, because that is the only unit anyone in this server has
 * intuition for. Nobody knows what moving a Bayesian mean by 0.8 feels like;
 * everybody knows what five people complaining feels like.
 *
 * Each option carries its own consequence, computed against this member's real
 * votes at the moment the picker was opened — where they land, and what it
 * would take to overturn it. That is the difference between a moderator
 * deciding how much to intervene and a moderator guessing.
 */
export function buildAdjustmentPicker(
  targetId: string,
  previews: AdjustmentPreview[],
  liveAdjustments: string[],
): BaseMessageOptions {
  const current = previews[0];

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeId(NS.MENU, 'adjust-size', targetId))
    .setPlaceholder('Choose a direction and a size')
    .addOptions([
      ...buildAdjustmentOptions(previews),
      ...(liveAdjustments.length > 0
        ? [
            new StringSelectMenuOptionBuilder()
              .setValue('clear')
              .setLabel('Take back every adjustment on them')
              .setDescription('Back to the community score alone'),
          ]
        : []),
    ]);

  return {
    content: [
      `**How much should <@${targetId}>'s score be leaned on?**`,
      current
        ? `They are in **${tierAt(current.currentTierIndex).roleName}** at **${current.currentScore.toFixed(2)}** right now.`
        : null,
      '',
      `One report's worth is one synthetic rating, weighted like a full-strength member. It fades over ${CREDITS.LIFETIME_DAYS} days and the real votes keep counting the whole time, so this leans on the number without taking it over.`,
      ...(liveAdjustments.length > 0 ? ['', '**Already live**', ...liveAdjustments] : []),
    ]
      .filter((line) => line !== null)
      .join('\n'),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}
