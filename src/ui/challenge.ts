import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { COPY, LIMITS, SERVER_LAYOUT, TIERS, tierAt } from '../config.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * Wording rules for this whole flow, since it is the one place where a player
 * and their raters are put in contact:
 *
 *   - The player asking is never described as toxic, disputed or problematic.
 *   - The rater is never told what they originally voted in the public-facing
 *     text of the request; they are asked to look again, not to defend a score.
 *   - The KING report shows counts and a score, never a per-rater breakdown.
 */

/** The DM sent to each person who currently has a rating on the player. */
export function buildChallengeRequestDm(input: {
  challengeId: number;
  playerName: string;
  guildName: string;
  deadline: number;
}): BaseMessageOptions {
  const deadlineSeconds = Math.floor(input.deadline / 1000);

  const embed = new EmbedBuilder()
    .setTitle('A player has asked for a fresh look')
    .setColor(tierAt(0).color)
    .setDescription(
      [
        `**${input.playerName}** in **${input.guildName}** would like to be rated again.`,
        '',
        'You rated them at some point in the last few weeks. Would you like to take another look? People change, and so can your rating.',
        '',
        `If you do nothing by <t:${deadlineSeconds}:f>, your rating is simply removed from their total — no rating is better than a stale one. You can always rate them again later.`,
      ].join('\n'),
    )
    .setFooter({ text: 'Your answer is private. The player is never told what you chose.' });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.CHALLENGE, 'look', input.challengeId))
          .setLabel('Rate them again')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.CHALLENGE, 'keep', input.challengeId))
          .setLabel('Keep my current rating')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

/** The 1..5 scale, in DM form, for a rater who agreed to look again. */
export function buildChallengeScale(challengeId: number, playerName: string): BaseMessageOptions {
  return {
    content: [`**${COPY.ratingPromptTitle}**`, `Re-rating **${playerName}**.`].join('\n'),
    embeds: [],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId(NS.CHALLENGE, 'rerate', challengeId))
          .setPlaceholder('Pick a rating')
          .addOptions(
            COPY.ratingScale.map((step) =>
              new StringSelectMenuOptionBuilder()
                .setValue(String(step.value))
                .setLabel(`${step.value} · ${step.label}`)
                .setDescription(step.description),
            ),
          ),
      ),
    ],
  };
}

/** Confirmation shown to the player who opened the challenge. */
export function buildChallengeOpened(voterCount: number, deadline: number): string {
  return [
    '**Your re-review is open.**',
    '',
    `${voterCount} ${voterCount === 1 ? 'person' : 'people'} with a current rating on you have been asked, privately, to take another look. The ${SERVER_LAYOUT.kingRoleName} role has been notified that a review is running.`,
    '',
    `Anyone who does not answer by <t:${Math.floor(deadline / 1000)}:f> has their rating removed from your total. After that the ${SERVER_LAYOUT.kingRoleName} role has ${LIMITS.KING_REVIEW_WINDOW_HOURS} hours to look over the outcome, and then it is final.`,
    '',
    `You can ask for another review in ${LIMITS.CHALLENGE_COOLDOWN_DAYS} days.`,
  ].join('\n');
}

export interface KingReportInput {
  challengeId: number;
  playerId: string;
  state: 'collecting' | 'king_review';
  invited: number;
  rerated: number;
  kept: number;
  dropped: number;
  pending: number;
  beforeTierKey: string | null;
  afterTierKey: string | null;
  beforeScore: number | null;
  afterScore: number | null;
  deadline: number | null;
}

/**
 * The report posted in the KING channel. Note the absence of any per-rater
 * detail: the KING sees how many people did what, not who did what.
 */
export function buildKingReport(input: KingReportInput): BaseMessageOptions {
  const collecting = input.state === 'collecting';

  const embed = new EmbedBuilder()
    .setTitle(collecting ? 'Re-review opened' : 'Re-review outcome — your call')
    .setColor(collecting ? tierAt(1).color : tierAt(0).color)
    .setDescription(
      collecting
        ? `<@${input.playerId}> asked their raters to take another look. Responses are being collected.`
        : `The response window for <@${input.playerId}> has closed. Ratings from people who did not answer have been removed.`,
    )
    .addFields(
      {
        name: 'Responses',
        value: [
          `Invited: **${input.invited}**`,
          `Re-rated: **${input.rerated}**`,
          `Kept as-is: **${input.kept}**`,
          `Removed for no answer: **${input.dropped}**`,
          collecting ? `Still pending: **${input.pending}**` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        inline: true,
      },
      {
        name: 'Placement',
        value: [
          `Before: **${labelFor(input.beforeTierKey)}**${
            input.beforeScore !== null ? ` (${input.beforeScore.toFixed(2)})` : ''
          }`,
          `After: **${labelFor(input.afterTierKey)}**${
            input.afterScore !== null ? ` (${input.afterScore.toFixed(2)})` : ''
          }`,
        ].join('\n'),
        inline: true,
      },
    )
    .setFooter({
      text: collecting
        ? 'No action needed yet.'
        : `Doing nothing accepts this outcome${
            input.deadline ? '' : ''
          }. Individual raters are never shown, by design.`,
    });

  if (input.deadline) {
    embed.addFields({
      name: collecting ? 'Responses close' : 'Auto-accepts',
      value: `<t:${Math.floor(input.deadline / 1000)}:R>`,
    });
  }

  if (collecting) return { embeds: [embed], components: [] };

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(encodeId(NS.KING, 'accept', input.challengeId))
          .setLabel('Accept outcome')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.KING, 'revert', input.challengeId))
          .setLabel('Undo the review')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(encodeId(NS.KING, 'set', input.challengeId))
          .setLabel('Place manually')
          .setStyle(ButtonStyle.Danger),
      ),
    ],
  };
}

/** Tier picker shown to a KING who chose to place the player manually. */
export function buildKingTierPicker(challengeId: number): BaseMessageOptions {
  return {
    content: [
      'Choose the placement to apply.',
      `It holds for ${LIMITS.KING_OVERRIDE_DAYS} days, then the community score takes over again.`,
    ].join('\n'),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(encodeId(NS.KING, 'settier', challengeId))
          .setPlaceholder('Pick an area')
          .addOptions(
            TIERS.map((tier, index) =>
              new StringSelectMenuOptionBuilder()
                .setValue(tier.key)
                .setLabel(tier.roleName)
                .setDescription(
                  `Sees: ${TIERS.slice(index)
                    .map((t) => t.roleName)
                    .join(', ')}`,
                ),
            ),
          ),
      ),
    ],
  };
}

function labelFor(tierKey: string | null): string {
  if (!tierKey) return 'none';
  return TIERS.find((t) => t.key === tierKey)?.roleName ?? tierKey;
}
