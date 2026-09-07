import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { COPY, LIMITS } from '../config.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Every message in this file is sent ephemerally, i.e. only the person who
 * clicked can see it. The rating conversation is invisible to the rest of the
 * server, including to the player being rated.
 */

/** Step 1: choose who you want to rate. */
export function buildPlayerPicker(context: { ratedSoFar: number; remainingToday: number }): BaseMessageOptions {
  const rows = [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(encodeId(NS.RATE, 'pick'))
        .setPlaceholder('Choose a player')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeId(NS.RATE, 'done'))
        .setLabel('Finish')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const notes = [
    context.ratedSoFar > 0 ? `Rated this session: ${context.ratedSoFar}.` : null,
    `New ratings left today: ${context.remainingToday}.`,
    `This panel stops responding after ${LIMITS.RATING_SESSION_TIMEOUT_MINUTES} minutes.`,
  ]
    .filter(Boolean)
    .join(' ');

  return {
    content: ['**Who would you like to rate?**', '', notes].join('\n'),
    components: rows,
  };
}

/** Step 2: the 1..5 scale for the chosen player. */
export function buildRatingScale(targetId: string, existingValue: number | null): BaseMessageOptions {
  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeId(NS.RATE, 'value', targetId))
    // Deliberately no .setDefault() on the matching option, even when we know
    // the current rating. A select menu with a default renders that value in
    // place of the placeholder, which makes the control look like a filled-in
    // field rather than a dropdown to open — so the panel reads as a dead end
    // saying "you already rated this person" with nothing to do about it. The
    // current value goes in the placeholder instead, where it still tells you
    // where you stand but the menu plainly invites a choice.
    .setPlaceholder(existingValue ? `Currently ${existingValue} — choose a new value` : 'Choose a rating')
    .addOptions(
      COPY.ratingScale.map((step) =>
        new StringSelectMenuOptionBuilder()
          .setValue(String(step.value))
          .setLabel(`${step.value} · ${step.label}`)
          .setDescription(step.description),
      ),
    );

  const header = existingValue
    ? `You currently rate <@${targetId}> **${existingValue}**. Pick a value below to change it, or leave it as it is.`
    : `Rating <@${targetId}>.`;

  return {
    content: [`**${COPY.ratingPromptTitle}**`, header].join('\n'),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      // Two ways out, so choosing not to change a rating is never a dead end.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'back'))
          .setLabel('Pick someone else')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'done'))
          .setLabel('Finish')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** Step 3: confirmation, then the "rate another player?" loop. */
export function buildRatingSaved(
  targetId: string,
  value: number,
  wasUpdate: boolean,
): BaseMessageOptions {
  const step = COPY.ratingScale.find((s) => s.value === value);

  return {
    content: [
      wasUpdate
        ? `Updated your rating of <@${targetId}> to **${value} · ${step?.label ?? ''}**.`
        : `Saved your rating of <@${targetId}>: **${value} · ${step?.label ?? ''}**.`,
      '',
      'Would you like to rate another player?',
    ].join('\n'),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'back'))
          .setLabel('Rate another player')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'done'))
          .setLabel('No, I am done')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildSessionClosed(ratedCount: number): BaseMessageOptions {
  return {
    content:
      ratedCount > 0
        ? `Thanks. ${ratedCount} rating(s) recorded. They stay private and will expire on their own.`
        : 'No ratings recorded. You can come back any time.',
    components: [],
  };
}
