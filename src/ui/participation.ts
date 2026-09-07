import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type BaseMessageOptions,
} from 'discord.js';
import { SCORING, TIERS } from '../config.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Opting out is a first-class, reversible choice, not a punishment. Someone
 * outside the system holds no standing, cannot be rated, cannot rate, and sees
 * only the channels that were in the server before the system was added.
 */
export function buildParticipationMenu(participating: boolean): BaseMessageOptions {
  const button = participating
    ? new ButtonBuilder()
        .setCustomId(encodeId(NS.PARTICIPATION, 'leave'))
        .setLabel('Leave the standing system')
        .setStyle(ButtonStyle.Secondary)
    : new ButtonBuilder()
        .setCustomId(encodeId(NS.PARTICIPATION, 'join'))
        .setLabel('Join the standing system')
        .setStyle(ButtonStyle.Primary);

  return { components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)] };
}

export function buildParticipationStatus(participating: boolean): BaseMessageOptions {
  const tierNames = TIERS.map((t) => t.roleName).join(', ');

  const content = participating
    ? [
        '**You are taking part in the standing system.**',
        '',
        `You can rate other players, other players can rate you, and you have access to the ${tierNames} areas your standing allows.`,
      ].join('\n')
    : [
        '**You are outside the standing system.**',
        '',
        `You have no standing, and no rating involving you counts for anything. Nobody can rate you, you cannot rate anyone, and you see only the channels that were already in this server before the ${tierNames} areas were added.`,
      ].join('\n');

  const menu = buildParticipationMenu(participating);
  return { content, components: menu.components };
}

export function buildLeaveConfirmation(): BaseMessageOptions {
  return {
    content: [
      '**Leave the standing system?**',
      '',
      'If you leave:',
      '• Every rating you have given and received stops counting immediately.',
      '• You lose access to the colour areas, and keep every channel that was in the server beforehand.',
      '• Nobody can rate you, and you cannot rate anyone.',
      '',
      `If you rejoin, ratings that have not yet aged out resume where they left off — leaving is not a way to clear them. They expire on their own ${SCORING.VOTE_LIFETIME_DAYS} days after they were given, whether you are in the system or not, so staying out that long clears them exactly as it would for anyone else.`,
    ].join('\n'),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.PARTICIPATION, 'leave-confirm'))
          .setLabel('Yes, leave')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.PARTICIPATION, 'menu'))
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}
