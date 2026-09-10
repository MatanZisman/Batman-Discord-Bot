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
import { stringsIn } from '../i18n/index.js';
import { truncateBidi } from '../i18n/bidi.js';
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
  /** Guild id for locale lookup. */
  guildId?: string;
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
  const t = stringsIn(input.guildId ?? '');

  const embed = new EmbedBuilder()
    .setTitle(t.review.kingTitle)
    .setColor(tierAt(0).color)
    .setDescription(t.review.kingDesc({ mention: `<@${input.playerId}>` }))
    .addFields(
      {
        name: t.review.kingWhereTitle,
        value: [
          t.review.kingWhereArea({ area: labelFor(input.tierKey) }),
          input.score !== null
            ? t.review.kingWhereScore({ score: input.score.toFixed(2) })
            : t.review.kingWhereUnscored,
          t.review.kingWhereRaters({ count: input.raterCount }),
        ].join('\n'),
        inline: true,
      },
      {
        name: t.review.kingAdjTitle,
        value: t.review.kingAdjBody({ days: CREDITS.LIFETIME_DAYS }),
        inline: true,
      },
    )
    .setFooter({ text: t.review.kingFooter });

  if (input.liveAdjustments.length > 0) {
    embed.addFields({
      name: t.review.kingAlreadyAdjTitle,
      value: input.liveAdjustments.join('\n'),
    });
  }

  if (input.deadline) {
    embed.addFields({
      name: t.review.kingClosesTitle,
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
          .setPlaceholder(t.review.kingAdjustPlaceholder)
          .addOptions(buildAdjustmentOptions(input.options, input.guildId)),
      ),
    );
  }

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeId(NS.KING, 'dismiss', input.challengeId))
      .setLabel(t.review.kingDismissBtn)
      .setStyle(ButtonStyle.Secondary),
  );

  if (input.liveAdjustments.length > 0) {
    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(encodeId(NS.KING, 'clear', input.challengeId))
        .setLabel(t.review.kingClearBtn)
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
  guildId?: string,
): StringSelectMenuOptionBuilder[] {
  const t = stringsIn(guildId ?? '');

  return previews.map((preview) => {
    const verb = preview.direction === 'ease' ? t.review.adjVerbEase : t.review.adjVerbPush;
    const area = tierAt(preview.projectedTierIndex).roleName;

    const moved = preview.projectedTierIndex !== preview.currentTierIndex;
    const landing = moved
      ? t.review.adjLandingMoved({ area, score: preview.projectedScore.toFixed(2) })
      : t.review.adjLandingStays({ area, score: preview.projectedScore.toFixed(2) });

    // Order matters: a blocked push is the one outcome a moderator will
    // otherwise read as a broken button, so it takes precedence over the
    // cost note.
    const note = preview.blockedBy
      ? t.review.adjNoteBlocked({ reason: preview.blockedBy })
      : preview.reportsToUndo !== null
        ? t.review.adjNoteUndo({ count: preview.reportsToUndo })
        : preview.direction === 'ease' && moved
          ? t.review.adjNoteEaseMoved
          : '';

    return new StringSelectMenuOptionBuilder()
      .setValue(`${preview.direction}:${preview.reports}`)
      .setLabel(t.review.adjLabel({ verb, reports: preview.reports }))
      .setDescription(truncateBidi(`${landing}${note}`, 100));
  });
}

function labelFor(tierKey: string | null): string {
  if (!tierKey) return 'none';
  return TIERS.find((t) => t.key === tierKey)?.roleName ?? tierKey;
}
