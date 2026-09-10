import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { LIMITS, SCORING, SERVER_LAYOUT, TIERS } from '../config.js';
import { stringsIn } from '../i18n/index.js';
import { NS, encodeId } from '../lib/custom-ids.js';

/**
 * The pinned message in the public channel, and the only public-facing
 * explanation of the system. The channel is read-only, so this message plus its
 * buttons is the entire interface a member sees before everything goes private.
 *
 * The wording matters as much as the mechanics here. Tiers are described as
 * areas of the server, never as labels for people, and the privacy guarantees
 * are stated plainly because they are the reason the system is safe to use.
 */
export function buildRatingHubMessage(guildId: string): BaseMessageOptions {
  const t = stringsIn(guildId);
  const firstTier = TIERS[0];

  const areaLines = TIERS.map((tier, index) => {
    const canSee = TIERS.slice(index)
      .map((tier2) => tier2.roleName)
      .join(' + ');
    return t.hub.areasArea({ name: tier.roleName, canSee });
  }).join('\n');

  const roomLines = (firstTier?.channels ?? [])
    .map((spec) => {
      const count = spec.count ?? 1;
      if (spec.kind === 'text') return t.hub.roomText({ count });
      const cap = spec.userLimit
        ? t.hub.roomCapUp({ n: spec.userLimit })
        : t.hub.roomCapNone;
      return t.hub.roomVoice({ name: spec.name, cap, count });
    })
    .join(' · ');

  const scaleLines = t.scale
    .map((step) => `**${step.value}** · ${step.label} — ${step.description}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(t.systemName)
    .setColor(firstTier?.color ?? 0x57f287)
    .setDescription(t.hub.description({ firstArea: firstTier?.roleName ?? 'the first area' }))
    .addFields(
      {
        name: t.hub.areasTitle,
        value: [
          areaLines,
          '',
          t.hub.areasChannels({ roomLines }),
          t.hub.areasNote,
        ].join('\n'),
      },
      {
        name: t.hub.ratingTitle,
        value: [
          t.hub.ratingInstructions,
          '',
          scaleLines,
        ].join('\n'),
      },
      {
        name: t.hub.effectTitle,
        value: t.hub.effectPoints
          .map((p) => (typeof p === 'function' ? p({ days: SCORING.VOTE_LIFETIME_DAYS }) : p))
          .join('\n'),
      },
      {
        name: t.hub.privacyTitle,
        value: t.hub.privacyPoints.join('\n'),
      },
      {
        name: t.hub.reviewTitle,
        value: t.hub.reviewBody({ days: LIMITS.CHALLENGE_COOLDOWN_DAYS, king: SERVER_LAYOUT.kingRoleName }),
      },
      {
        name: t.hub.optOutTitle,
        value: t.hub.optOutBody({ days: SCORING.VOTE_LIFETIME_DAYS }),
      },
    )
    .setFooter({ text: t.hub.footer });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeId(NS.RATE, 'start'))
      .setLabel(t.hub.btnRate)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.RATE, 'mine'))
      .setLabel(t.hub.btnMyStanding)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.CHALLENGE, 'open'))
      .setLabel(t.hub.btnReview)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.PARTICIPATION, 'menu'))
      .setLabel(t.hub.btnParticipation)
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}
