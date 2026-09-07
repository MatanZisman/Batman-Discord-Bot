import { type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import { DAY_MS, SCORING, SERVER_LAYOUT, TIERS, tierAt } from '../config.js';
import { logAction } from '../core/action-log.js';
import * as repo from '../db/repo.js';
import { applyTierRoles, recalculateStanding } from '../core/standing-service.js';
import { logger } from '../lib/logger.js';
import { respondPrivately } from '../lib/respond.js';
import {
  buildLeaveConfirmation,
  buildParticipationStatus,
} from '../ui/participation.js';

export async function showParticipationMenu(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const record = repo.ensureMember(guild.id, interaction.user.id);

  // respondPrivately, not update(): the Participation button lives on the
  // shared pinned hub, and editing that in place rewrites it for everyone.
  await respondPrivately(interaction, buildParticipationStatus(record.participating === 1));
}

export async function showLeaveConfirmation(interaction: ButtonInteraction): Promise<void> {
  await respondPrivately(interaction, buildLeaveConfirmation());
}

export async function handleLeave(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const userId = interaction.user.id;
  repo.ensureMember(guild.id, userId);

  // Their ratings of other people stop counting, which changes those people's
  // standings, so the affected targets come back for recomputation.
  const affectedTargets = repo.suspendVotesInvolving(guild.id, userId);
  repo.setParticipation(guild.id, userId, false);
  repo.audit(guild.id, 'opt_out', userId);
  logAction(guild, { kind: 'opt_out', actorId: userId });

  const member = await guild.members.fetch(userId).catch(() => null);
  if (member) await applyTierRoles(guild, member, null);

  await respondPrivately(interaction, {
    content: [
      'Done. You are now outside the standing system.',
      '',
      `Every rating involving you has stopped counting, and you have no standing. Nobody can rate you and you cannot rate anyone. You keep access to the open channels and can rejoin at any time.`,
      '',
      `If you come back, any ratings that have not yet aged out will pick up where they left off. They expire on their own ${SCORING.VOTE_LIFETIME_DAYS} days after they were given, whether you are in the system or not — so staying out that long does clear them, the same way it would for anyone else.`,
    ].join('\n'),
    components: [],
  });

  for (const targetId of affectedTargets) {
    recalculateStanding(guild, targetId).catch((error) =>
      logger.error(`Recalculation after opt-out failed for ${targetId}`, error),
    );
  }
}

export async function handleJoin(interaction: ButtonInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const userId = interaction.user.id;
  const record = repo.ensureMember(guild.id, userId);

  // Someone an admin removed cannot let themselves back in, or the removal
  // would mean nothing.
  if (record.removed_by_admin === 1) {
    await respondPrivately(interaction, {
      content: `You were removed from the standing system by a moderator, so you cannot rejoin on your own. Speak to the ${SERVER_LAYOUT.kingRoleName} role if you think that should change.`,
      components: [],
    });
    return;
  }

  repo.setParticipation(guild.id, userId, true);
  repo.audit(guild.id, 'opt_in', userId);
  logAction(guild, { kind: 'opt_in', actorId: userId });

  // Ratings that were paused when they left come back, minus any that aged out
  // in the meantime.
  const cutoff = Date.now() - SCORING.VOTE_LIFETIME_DAYS * DAY_MS;
  const affectedTargets = repo.restoreVotesInvolving(guild.id, userId, cutoff);

  const result = await recalculateStanding(guild, userId, { notifyUser: false });
  const tierName = result
    ? tierAt(result.standing.tierIndex).roleName
    : (TIERS[0]?.roleName ?? 'the first tier');

  await respondPrivately(interaction, {
    content: [
      `You are back in, in **${tierName}**.`,
      '',
      'You can now rate other players, and other players can rate you. You can leave again at any time.',
    ].join('\n'),
    components: [],
  });

  for (const targetId of affectedTargets) {
    recalculateStanding(guild, targetId).catch((error) =>
      logger.error(`Recalculation after opt-in failed for ${targetId}`, error),
    );
  }
}
