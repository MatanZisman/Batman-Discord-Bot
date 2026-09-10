import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { LIMITS } from '../config.js';
import { stringsIn } from '../i18n/index.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Every message in this file is sent ephemerally, i.e. only the person who
 * clicked can see it. The rating conversation is invisible to the rest of the
 * server, including to the player being rated.
 */

/** Step 1: choose who you want to rate. */
export function buildPlayerPicker(context: { ratedSoFar: number; remainingToday: number; guildId?: string }): BaseMessageOptions {
  const t = stringsIn(context.guildId ?? '');

  const rows = [
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(encodeId(NS.RATE, 'pick'))
        .setPlaceholder(t.rating.pickerPlaceholder)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeId(NS.RATE, 'done'))
        .setLabel(t.rating.finishBtn)
        .setStyle(ButtonStyle.Secondary),
    ),
  ];

  const notes = t.rating.sessionNotes({
    ratedSoFar: context.ratedSoFar,
    remaining: context.remainingToday,
    timeout: LIMITS.RATING_SESSION_TIMEOUT_MINUTES,
  });

  return {
    content: [t.rating.who, '', notes].join('\n'),
    components: rows,
  };
}

/** Step 2: the 1..5 scale for the chosen player. */
export function buildRatingScale(targetId: string, existingValue: number | null, guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeId(NS.RATE, 'value', targetId))
    // Deliberately no .setDefault() on the matching option, even when we know
    // the current rating. A select menu with a default renders that value in
    // place of the placeholder, which makes the control look like a filled-in
    // field rather than a dropdown to open — so the panel reads as a dead end
    // saying "you already rated this person" with nothing to do about it. The
    // current value goes in the placeholder instead, where it still tells you
    // where you stand but the menu plainly invites a choice.
    .setPlaceholder(
      existingValue
        ? t.rating.scalePlaceholderExisting({ value: existingValue })
        : t.rating.scalePlaceholderNew,
    )
    .addOptions(
      t.scale.map((step) =>
        new StringSelectMenuOptionBuilder()
          .setValue(String(step.value))
          .setLabel(`${step.value} · ${step.label}`)
          .setDescription(step.description),
      ),
    );

  const header = existingValue
    ? t.rating.scaleHeaderExisting({ mention: `<@${targetId}>`, value: existingValue })
    : t.rating.scaleHeaderNew({ mention: `<@${targetId}>` });

  return {
    content: [`**${t.ratingPromptTitle}**`, header].join('\n'),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      // Two ways out, so choosing not to change a rating is never a dead end.
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'back'))
          .setLabel(t.rating.pickSomeoneElseBtn)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'done'))
          .setLabel(t.rating.finishBtn)
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
  guildId?: string,
): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');
  const step = t.scale.find((s) => s.value === value);

  return {
    content: [
      wasUpdate
        ? t.rating.savedUpdated({ mention: `<@${targetId}>`, value, label: step?.label ?? '' })
        : t.rating.savedNew({ mention: `<@${targetId}>`, value, label: step?.label ?? '' }),
      '',
      t.rating.savedPrompt,
    ].join('\n'),
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'back'))
          .setLabel(t.rating.rateAnotherBtn)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.RATE, 'done'))
          .setLabel(t.rating.doneBtn)
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildSessionClosed(ratedCount: number, guildId?: string): BaseMessageOptions {
  const t = stringsIn(guildId ?? '');
  return {
    content:
      ratedCount > 0
        ? t.rating.closedWithRatings({ count: ratedCount })
        : t.rating.closedNone,
    components: [],
  };
}
