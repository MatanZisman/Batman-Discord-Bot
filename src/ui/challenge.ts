import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { CREDITS, TIERS, tierAt } from '../config.js';
import type { AdjustmentPreview } from '../core/adjustments.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Wording rules for this flow:
 *
 *   - The player asking is never described as toxic, disputed or problematic.
 *     They asked a question; that is all the request says.
 *   - No per-rater detail ever appears. A KING sees a value and a count of
 *     people, never who rated or what any individual gave.
 *   - Nothing is phrased as a verdict on a person. The subject is a number.
 */

export interface KingRequestInput {
  challengeId: number;
  playerId: string;
  tierKey: string | null;
  score: number | null;
  raterCount: number;
  /** Adjustments already live on this member, if any. */
  liveAdjustments: string[];
  /** Each offered size, already priced against this member's real votes. */
  options: AdjustmentPreview[];
  deadline: number | null;
}

/**
 * The request posted to the KING channel.
 *
 * One message, one decision, and the consequences printed on the options
 * themselves. A KING is choosing how much of the community's verdict to
 * discount, which is a judgement worth making deliberately — but not one
 * worth making twice, so the whole thing is a single interaction.
 */
export function buildKingRequest(input: KingRequestInput): BaseMessageOptions {
  const embed = new EmbedBuilder()
    .setTitle('A player has asked for a review')
    .setColor(tierAt(0).color)
    .setDescription(
      [
        `<@${input.playerId}> would like their rating looked at.`,
        '',
        'Ease off if you think the community has been harsh, push down if you think it has been generous, or dismiss it. Nobody who rated them has been contacted, and they have not been promised an answer.',
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Where they are',
        value: [
          `Area: **${labelFor(input.tierKey)}**`,
          `Score: **${input.score !== null ? input.score.toFixed(2) : 'not yet scored'}**`,
          `From **${input.raterCount}** rater(s)`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'What an adjustment does',
        value: [
          'Adds that many reports of signal, for or against.',
          'The score keeps running underneath.',
          `Fades out over ${CREDITS.LIFETIME_DAYS} days.`,
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({
      text: 'Individual raters are never shown, by design. Doing nothing is a valid answer.',
    });

  if (input.liveAdjustments.length > 0) {
    embed.addFields({
      name: 'Already adjusted',
      value: input.liveAdjustments.join('\n'),
    });
  }

  if (input.deadline) {
    embed.addFields({
      name: 'Closes itself',
      value: `<t:${Math.floor(input.deadline / 1000)}:R>`,
    });
  }

  const components: Array<
    ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>
  > = [];

  if (input.options.length > 0) {
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId(NS.KING, 'adjust', input.challengeId))
          .setPlaceholder('Adjust their score')
          .addOptions(buildAdjustmentOptions(input.options)),
      ),
    );
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeId(NS.KING, 'dismiss', input.challengeId))
      .setLabel('Dismiss, no change')
      .setStyle(ButtonStyle.Secondary),
  );

  if (input.liveAdjustments.length > 0) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeId(NS.KING, 'clear', input.challengeId))
        .setLabel('Take back existing adjustments')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  components.push(buttons);

  return { embeds: [embed], components };
}

/**
 * Turns priced previews into select options.
 *
 * The description is the part that matters. "Ease off by five" means nothing
 * on its own; "lands them in Yellow at 2.60, and five real reports puts them
 * back" is a decision someone can actually make. Both halves are computed
 * against this member's real votes, so neither can drift out of date when the
 * tuning values change.
 */
export function buildAdjustmentOptions(
  previews: AdjustmentPreview[],
): StringSelectMenuOptionBuilder[] {
  return previews.map((preview) => {
    const verb = preview.direction === 'ease' ? 'Ease off' : 'Push down';
    const area = tierAt(preview.projectedTierIndex).roleName;

    const moved = preview.projectedTierIndex !== preview.currentTierIndex;
    const landing = moved
      ? `→ ${area} at ${preview.projectedScore.toFixed(2)}`
      : `stays ${area}, ${preview.projectedScore.toFixed(2)}`;

    const cost =
      preview.reportsToUndo !== null
        ? ` · ${preview.reportsToUndo} report(s) to undo`
        : preview.direction === 'ease' && moved
          ? ' · out of reach by reports alone'
          : '';

    return new StringSelectMenuOptionBuilder()
      .setValue(`${preview.direction}:${preview.reports}`)
      .setLabel(`${verb} — ${preview.reports} report(s)' worth`)
      .setDescription(`${landing}${cost}`.slice(0, 100));
  });
}

function labelFor(tierKey: string | null): string {
  if (!tierKey) return 'none';
  return TIERS.find((t) => t.key === tierKey)?.roleName ?? tierKey;
}
