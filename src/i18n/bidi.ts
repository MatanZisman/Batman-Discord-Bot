/**
 * ============================================================================
 *  BIDI HELPERS
 * ============================================================================
 *  Discord renders text through the Unicode Bidi algorithm. Hebrew paragraphs
 *  render right-aligned automatically, which is correct. The trouble spots are
 *  within Hebrew prose: Discord mentions (<@id>), channel links (<#id>),
 *  numbers, and slash commands are LTR tokens that Bidi can scramble when
 *  surrounded by RTL text. These helpers wrap those tokens so they stay in
 *  reading order.
 *
 *  Rules:
 *    ltr()    Wrap a single LTR token (mention, number, ID) inside Hebrew prose.
 *    rtlLine  Prefix a full line with RLM so Discord's paragraph direction is Hebrew.
 *    rtlBlock Join multiple lines, each prefixed, into a single RTL block.
 *
 *  English callers (locale === 'en') should not call these — they are no-ops
 *  but add noise. Guard at the call site with isRtl(locale).
 * ============================================================================
 */

/** Unicode directional marks. */
const LRM = '\u200E'; // Left-to-Right Mark
const RLM = '\u200F'; // Right-to-Left Mark

/**
 * Wraps a LTR token so it stays in place inside RTL text.
 * Use for Discord mentions, channel links, numbers, or command names embedded
 * in Hebrew sentences.
 */
export function ltr(s: string | number): string {
  return `${LRM}${String(s)}${LRM}`;
}

/**
 * Prefixes a line with RLM so Discord treats it as an RTL paragraph.
 */
export function rtlLine(s: string): string {
  return `${RLM}${s}`;
}

/**
 * Joins multiple lines into a block, each prefixed with RLM.
 */
export function rtlBlock(lines: (string | null | undefined)[]): string {
  return lines
    .filter((l): l is string => l != null)
    .map(rtlLine)
    .join('\n');
}

/**
 * Truncates a string to at most `max` characters, appending "…" if cut.
 * Used to keep Discord select-option descriptions inside the 100-char limit.
 */
export function truncateBidi(s: string, max = 100): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
