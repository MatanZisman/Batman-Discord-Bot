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
import { stringsIn } from '../i18n/index.js';
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
export function buildKingMenuMessage(
  guildId: string,
  stats: AdminStats,
  logChannelId: string | null,
): BaseMessageOptions {
  const t = stringsIn(guildId);

  return {
    content: renderStats(guildId, stats, logChannelId),
    components: [
      // Row 1: the things you press most, and the one that needs attention.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'refresh'))
          .setLabel(t.admin.refreshBtn)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'recalc'))
          .setLabel(t.admin.recalcBtn)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'adjust'))
          .setLabel(t.admin.adjustBtn)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'undo'))
          .setLabel(t.admin.undoBtn)
          .setStyle(ButtonStyle.Secondary),
      ),
      // Row 2: membership, which is the destructive corner.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'remove'))
          .setLabel(t.admin.removeBtn)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'reinstate'))
          .setLabel(t.admin.reinstateBtn)
          .setStyle(ButtonStyle.Secondary),
      ),
      // Row 3: whole-system switches.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, stats.paused ? 'resume' : 'pause'))
          .setLabel(stats.paused ? t.admin.resumeBtn : t.admin.pauseBtn)
          .setStyle(stats.paused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, stats.noticeActiveAt ? 'notice-off' : 'notice-on'))
          .setLabel(stats.noticeActiveAt ? t.admin.announceOffBtn : t.admin.announceOnBtn)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'refresh-hub'))
          .setLabel(t.admin.refreshHubBtn)
          .setStyle(ButtonStyle.Secondary),
      ),
      // Row 4: language + free-text DM.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'language'))
          .setLabel(t.admin.languageBtn)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.MENU, 'dm'))
          .setLabel(t.admin.dmBtn)
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

function renderStats(guildId: string, stats: AdminStats, logChannelId: string | null): string {
  const t = stringsIn(guildId);

  const status = stats.paused ? t.admin.paused : t.admin.running;

  const announce = stats.noticeActiveAt
    ? t.admin.announceOn({ ts: Math.floor(stats.noticeActiveAt / 1000), pending: stats.noticePending })
    : t.admin.announceOff({ pending: stats.noticePending });

  const spread = stats.tiers.map((tier) => t.admin.tierCount({ name: tier.roleName, count: tier.count })).join(' · ');

  const attention = [
    stats.challengesAwaitingKing > 0
      ? t.admin.reviewsPending({ count: stats.challengesAwaitingKing })
      : null,
    stats.openChallenges > stats.challengesAwaitingKing
      ? t.admin.reviewsOpen({ count: stats.openChallenges - stats.challengesAwaitingKing })
      : null,
    stats.adjustedMembers > 0
      ? t.admin.adjustedMembers({ count: stats.adjustedMembers })
      : null,
  ].filter(Boolean);

  return [
    t.admin.panelTitle({ king: SERVER_LAYOUT.kingRoleName }),
    status,
    '',
    t.admin.whereTitle,
    spread,
    t.admin.membersSummary({ in: stats.participating, out: stats.optedOut, removed: stats.removed }),
    '',
    t.admin.activityTitle,
    t.admin.activityRatings({ day: stats.ratingsLastDay, week: stats.ratingsLastWeek }),
    t.admin.activityCurrent({ ratings: stats.activeRatings, raters: stats.activeRaters }),
    '',
    t.admin.announceTitle,
    announce,
    ...(attention.length > 0 ? ['', t.admin.needsLookTitle, ...attention] : []),
    '',
    t.admin.panelFooter({ logChannel: logChannelId }),
  ].join('\n');
}

/** Step 1 of the member-targeted actions: who? */
export function buildMemberPicker(
  action: 'adjust' | 'remove' | 'reinstate' | 'undo' | 'dm',
  guildId?: string,
): BaseMessageOptions {
  const t = guildId ? stringsIn(guildId) : stringsIn('');

  const prompt = {
    adjust: t.admin.pickerAdjust,
    undo: t.admin.pickerUndo,
    remove: t.admin.pickerRemove,
    reinstate: t.admin.pickerReinstate,
    dm: t.admin.pickerDm,
  }[action];

  const warning = {
    adjust: t.admin.pickerWarnAdjust,
    undo: t.admin.pickerWarnUndo,
    remove: t.admin.pickerWarnRemove,
    reinstate: t.admin.pickerWarnReinstate,
    dm: t.admin.pickerWarnDm,
  }[action];

  return {
    content: [`**${prompt}**`, '', warning].join('\n'),
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(encodeId(NS.MENU, `pick-${action}`))
          .setPlaceholder(t.admin.pickerChoose)
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
  guildId?: string,
): BaseMessageOptions {
  const t = guildId ? stringsIn(guildId) : stringsIn('');
  const current = previews[0];

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeId(NS.MENU, 'adjust-size', targetId))
    .setPlaceholder(t.admin.adjPickerPlaceholder)
    .addOptions([
      ...buildAdjustmentOptions(previews, guildId),
      ...(liveAdjustments.length > 0
        ? [
            new StringSelectMenuOptionBuilder()
              .setValue('clear')
              .setLabel(t.admin.adjClearOption)
              .setDescription(t.admin.adjClearDesc),
          ]
        : []),
    ]);

  return {
    content: [
      t.admin.adjPickerTitle({ mention: `<@${targetId}>` }),
      current
        ? t.admin.adjPickerCurrent({ area: tierAt(current.currentTierIndex).roleName, score: current.currentScore.toFixed(2) })
        : null,
      '',
      t.admin.adjPickerUnit({ days: CREDITS.LIFETIME_DAYS }),
      ...(liveAdjustments.length > 0 ? ['', t.admin.adjPickerLive, ...liveAdjustments] : []),
    ]
      .filter((line) => line !== null)
      .join('\n'),
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  };
}
