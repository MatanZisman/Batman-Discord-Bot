/**
 * Discord component custom ids are plain strings limited to 100 characters, so
 * we encode a small namespaced payload into them: `ns:action:arg1:arg2`.
 * Keeping the encoding in one place means handlers never string-parse by hand.
 */

export interface ComponentId {
  ns: string;
  action: string;
  args: string[];
}

export function encodeId(ns: string, action: string, ...args: Array<string | number>): string {
  const id = [ns, action, ...args.map(String)].join(':');
  if (id.length > 100) throw new Error(`custom_id too long: ${id}`);
  return id;
}

export function decodeId(customId: string): ComponentId | null {
  const [ns, action, ...args] = customId.split(':');
  if (!ns || !action) return null;
  return { ns, action, args };
}

export const NS = {
  RATE: 'rate',
  CHALLENGE: 'chal',
  KING: 'king',
  PARTICIPATION: 'part',
  REVERT: 'revert',
  /** The KING control panel in #kings-menu. */
  MENU: 'menu',
} as const;
