import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type BaseMessageOptions,
} from 'discord.js';
import { SCORING, TIERS } from '../config.js';
import { stringsIn } from '../i18n/index.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Opting out is a first-class, reversible choice, not a punishment. Someone
 * outside the system holds no standing, cannot be rated, cannot rate, and sees
 * only the channels that were in the server before the system was added.
 */
export function buildParticipationMenu(participating: boolean, guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');
  const button = participating
    ? new ButtonBuilder()
        .setCustomId(encodeId(NS.PARTICIPATION, 'leave'))
        .setLabel(t.participation.leaveBtn)
        .setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder()
        .setCustomId(encodeId(NS.PARTICIPATION, 'join'))
        .setLabel(t.participation.joinBtn)
        .setStyle(ButtonStyle.Primary);

  return { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] };
}

export function buildParticipationStatus(participating: boolean, guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');
  const areas = TIERS.map((tier) => tier.roleName).join(', ');

  const content = participating
    ? t.participation.statusIn({ areas })
    : t.participation.statusOut({ areas });

  const menu = buildParticipationMenu(participating, guildId);
  return { content, components: menu.components };
}

export function buildLeaveConfirmation(guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');
  return {
    content: [
      t.participation.confirmLeaveTitle,
      '',
      t.participation.confirmLeaveBody({ days: SCORING.VOTE_LIFETIME_DAYS }),
    ].join('\n'),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.PARTICIPATION, 'leave-confirm'))
          .setLabel(t.participation.confirmLeaveYes)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.PARTICIPATION, 'menu'))
          .setLabel(t.participation.confirmLeaveCancel)
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
