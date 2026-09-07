import {
  MessageFlags,
  type BaseMessageOptions,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
} from 'discord.js';

type AnyInteraction = ChatInputCommandInteraction | MessageComponentInteraction;

/**
 * True when the message a component sits on belongs to one person.
 *
 * This is the distinction that makes `interaction.update()` safe or dangerous.
 * `update()` edits the message the component is attached to. On an ephemeral
 * message that is exactly what you want: the panel advances in place, visible
 * only to its owner. On the pinned public hub it rewrites the hub itself, for
 * the whole server.
 */
export function isOnPrivateMessage(interaction: MessageComponentInteraction): boolean {
  return Boolean(interaction.message.flags?.has(MessageFlags.Ephemeral));
}

/**
 * Answers an interaction with something only its user can see, choosing
 * between editing in place and sending a fresh private message.
 *
 * Always use this for anything reachable from the public hub. Reaching for
 * `interaction.update()` directly is only correct once you are already inside
 * a private flow, and getting it wrong is not a small bug: a button on the hub
 * answered with `update()` replaces the server's instructions and buttons with
 * one member's personal panel, and leaves them replaced.
 */
export async function respondPrivately(
  interaction: AnyInteraction,
  payload: BaseMessageOptions,
): Promise<void> {
  if (interaction.isMessageComponent() && isOnPrivateMessage(interaction)) {
    await interaction.update(payload);
    return;
  }

  const body = { ...payload, flags: MessageFlags.Ephemeral } as InteractionReplyOptions;
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(body);
    return;
  }
  await interaction.reply(body);
}
