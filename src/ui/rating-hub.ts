import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type BaseMessageOptions,
} from 'discord.js';
import { COPY, LIMITS, SCORING, SERVER_LAYOUT, TIERS } from '../config.js';
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
export function buildRatingHubMessage(): BaseMessageOptions {
  const firstTier = TIERS[0];

  const areaLines = TIERS.map((tier, index) => {
    const canSee = TIERS.slice(index)
      .map((t) => t.roleName)
      .join(' + ');
    return `**${tier.roleName}** — sees ${canSee}`;
  }).join('\n');

  const roomLines = (firstTier?.channels ?? [])
    .map((spec) => {
      const count = spec.count ?? 1;
      const copies = count > 1 ? `${count} × ` : '';
      if (spec.kind === 'text') return `${copies}text channel`;
      const cap = spec.userLimit ? `up to ${spec.userLimit}` : 'no limit';
      return `${copies}voice \`${spec.name}\` (${cap})`;
    })
    .join(' · ');

  const scaleLines = COPY.ratingScale
    .map((step) => `**${step.value}** · ${step.label} — ${step.description}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(COPY.systemName)
    .setColor(firstTier?.color ?? 0x57f287)
    .setDescription(
      [
        'This server has a set of social areas sorted by how people experience playing together. Which area you can see is decided by your teammates, not by a moderator — the idea is simply that everyone gets to play with people they enjoy playing with.',
        '',
        `**Everyone starts in ${firstTier?.roleName ?? 'the first area'}, with a clean slate.**`,
      ].join('\n'),
    )
    .addFields(
      {
        name: '① The areas',
        value: [
          areaLines,
          '',
          'Each area has its own channels: ' + roomLines + '.',
          'Being in a cleaner area means you can see *more* of the server, not less. Every channel that existed before this system was added is unaffected and stays open to everyone as it always was.',
        ].join('\n'),
      },
      {
        name: '② How you rate someone',
        value: [
          'Press **Rate a player** below. Pick a player, choose a number, and you will be asked whether you want to rate someone else. That is the whole thing.',
          '',
          scaleLines,
        ].join('\n'),
      },
      {
        name: '③ What your rating does',
        value: [
          '• **One rating per person, per player.** You can change your rating later, but you can never stack a second one on top.',
          '• **Ratings from people in good standing count for more.** A group in poor standing cannot gang up on someone.',
          '• **One rating barely moves anyone.** Neither do two. Moving between areas takes a real group of people who broadly agree.',
          `• **Ratings expire by themselves after ${SCORING.VOTE_LIFETIME_DAYS} days.** Nothing you do follows you around forever, and nobody has to forgive you for it — it just lapses.`,
          '• **Brand new accounts count for very little**, so nobody can swing a result with throwaway alts.',
        ].join('\n'),
      },
      {
        name: '④ Your privacy — read this part',
        value: [
          '• **Everything you do here is visible only to you.** The player picker, the rating, the confirmation: all of it is private, and none of it appears in this channel.',
          '• **You are never told who rated you**, and neither is anyone else. There is no command, for members or for staff, that shows another person\'s standing or who rated whom.',
          '• **No announcements.** If your area changes, the only message sent is a private one to you.',
          '• **No labels.** The roles are named after colours. There is no "toxic" role, they are hidden from the member list, and they cannot be pinged.',
        ].join('\n'),
      },
      {
        name: '⑤ If you think a rating is unfair',
        value: [
          `Press **Ask for a re-review**, at most once every ${LIMITS.CHALLENGE_COOLDOWN_DAYS} days. Everyone currently holding a rating on you gets a private message asking whether they would like to take another look — they are never told what you said or what they originally gave you.`,
          `Anyone who does not answer within ${LIMITS.CHALLENGE_RESPONSE_WINDOW_HOURS} hours has their rating dropped, on the basis that an unanswered rating is stale. The ${SERVER_LAYOUT.kingRoleName} role then has ${LIMITS.KING_REVIEW_WINDOW_HOURS} hours to look over the outcome.`,
        ].join('\n'),
      },
      {
        name: '⑥ Opting out',
        value: [
          'Press **Participation** to leave the system entirely. Every rating involving you stops counting, you have no standing, nobody can rate you, and you cannot rate anyone. You keep access to all the channels that existed before this system, and you can rejoin whenever you like.',
          '',
          `Leaving is not a shortcut to a clean slate: if you rejoin, ratings that have not yet aged out resume. They expire ${SCORING.VOTE_LIFETIME_DAYS} days after they were given either way, so time clears your record — for everyone, on the same terms.`,
        ].join('\n'),
      },
    )
    .setFooter({ text: 'Nothing you press here is visible to anyone else in this server.' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeId(NS.RATE, 'start'))
      .setLabel('Rate a player')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.RATE, 'mine'))
      .setLabel('My standing')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.CHALLENGE, 'open'))
      .setLabel('Ask for a re-review')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeId(NS.PARTICIPATION, 'menu'))
      .setLabel('Participation')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}
