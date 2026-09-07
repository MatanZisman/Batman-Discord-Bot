import { MessageFlags, type Interaction } from 'discord.js';
import { NS, decodeId } from './lib/custom-ids.js';
import { logger } from './lib/logger.js';
import { dispatchCommand } from './commands.js';
import {
  handleChallengeKeep,
  handleChallengeLook,
  handleChallengeReRate,
  handleKingDecision,
  handleKingPlace,
  handleKingPlacePrompt,
  handleOpenChallenge,
} from './handlers/challenge.js';
import {
  handleJoin,
  handleLeave,
  showLeaveConfirmation,
  showParticipationMenu,
} from './handlers/participation.js';
import {
  handlePlayerPicked,
  handleRatingBack,
  handleRatingDone,
  handleRatingValue,
  showOwnStanding,
  startRatingSession,
} from './handlers/rating.js';
import { handleRevertCancel, handleRevertConfirm } from './handlers/revert.js';

/**
 * Single entry point for every interaction. Component custom ids are
 * `namespace:action:args`, so routing is a two-level switch and each handler
 * stays unaware of the others.
 */
export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await dispatchCommand(interaction);
      return;
    }

    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isUserSelectMenu()) {
      const id = decodeId(interaction.customId);
      if (!id) return;

      switch (id.ns) {
        case NS.RATE:
          await routeRating(interaction, id.action);
          return;
        case NS.CHALLENGE:
          await routeChallenge(interaction, id.action);
          return;
        case NS.KING:
          await routeKing(interaction, id.action);
          return;
        case NS.PARTICIPATION:
          await routeParticipation(interaction, id.action);
          return;
        case NS.REVERT:
          await routeRevert(interaction, id.action);
          return;
      }
    }
  } catch (error) {
    logger.error('Interaction failed', error);
    await reportFailure(interaction);
  }
}

async function routeRating(
  interaction: Extract<Interaction, { customId: string }>,
  action: string,
): Promise<void> {
  if (action === 'pick' && interaction.isUserSelectMenu()) return handlePlayerPicked(interaction);
  if (action === 'value' && interaction.isStringSelectMenu()) return handleRatingValue(interaction);
  if (!interaction.isButton()) return;

  if (action === 'start') return startRatingSession(interaction);
  if (action === 'mine') return showOwnStanding(interaction);
  if (action === 'back') return handleRatingBack(interaction);
  if (action === 'done') return handleRatingDone(interaction);
}

async function routeChallenge(
  interaction: Extract<Interaction, { customId: string }>,
  action: string,
): Promise<void> {
  if (action === 'rerate' && interaction.isStringSelectMenu()) return handleChallengeReRate(interaction);
  if (!interaction.isButton()) return;

  if (action === 'open') return handleOpenChallenge(interaction);
  if (action === 'look') return handleChallengeLook(interaction);
  if (action === 'keep') return handleChallengeKeep(interaction);
}

async function routeKing(
  interaction: Extract<Interaction, { customId: string }>,
  action: string,
): Promise<void> {
  if (action === 'settier' && interaction.isStringSelectMenu()) return handleKingPlace(interaction);
  if (!interaction.isButton()) return;

  if (action === 'accept') return handleKingDecision(interaction, 'accept');
  if (action === 'revert') return handleKingDecision(interaction, 'revert');
  if (action === 'set') return handleKingPlacePrompt(interaction);
}

async function routeParticipation(
  interaction: Extract<Interaction, { customId: string }>,
  action: string,
): Promise<void> {
  if (!interaction.isButton()) return;

  if (action === 'menu') return showParticipationMenu(interaction);
  if (action === 'leave') return showLeaveConfirmation(interaction);
  if (action === 'leave-confirm') return handleLeave(interaction);
  if (action === 'join') return handleJoin(interaction);
}

async function routeRevert(
  interaction: Extract<Interaction, { customId: string }>,
  action: string,
): Promise<void> {
  if (!interaction.isButton()) return;

  if (action === 'confirm') return handleRevertConfirm(interaction);
  if (action === 'cancel') return handleRevertCancel(interaction);
}

/** Best-effort apology so a member never stares at "This interaction failed". */
async function reportFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;

  const content = 'Something went wrong on my side. Nothing was recorded — please try again.';
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // The interaction token is already dead; nothing more we can do.
  }
}
