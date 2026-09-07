/**
 * ============================================================================
 *  CENTRAL TUNING FILE
 * ============================================================================
 *  Everything that controls how the community standing system behaves lives in
 *  this file. Nothing else in the codebase hard-codes a number. If you want to
 *  make the system stricter, softer, faster or slower, you change ONE value
 *  here and restart the bot.
 *
 *  The scoring philosophy (see src/core/scoring.ts for the implementation):
 *
 *    - A rating is a 1..5 number. 1 = "great to play with", 5 = "very toxic".
 *    - Votes from people in good standing count for more than votes from
 *      people who are themselves poorly rated. Bad actors cannot brigade.
 *    - A player with only one or two votes is barely moved at all. We do this
 *      with Bayesian shrinkage toward Green, not with a hard "min votes" cliff,
 *      so standing moves smoothly as evidence accumulates.
 *    - Votes expire individually after VOTE_LIFETIME_DAYS. The voter is free to
 *      cast a fresh vote afterwards. Nobody is branded forever.
 *    - The system is ASYMMETRIC ON PURPOSE. Sliding into Green is easy and
 *      cheap; reaching Red requires a high score AND a real crowd AND broad
 *      agreement. False positives on Red are the expensive mistake, so Red is
 *      gated three different ways.
 * ============================================================================
 */

/** A channel the bot creates inside a tier's category. */
export interface ChannelSpec {
  /** Discord lowercases text channel names; voice names keep their casing. */
  name: string;
  kind: 'text' | 'voice';
  /** Voice only. Omit or use 0 for no cap. */
  userLimit?: number;
  /** Create this many channels with the same name. Defaults to 1. */
  count?: number;
}

/** A single standing tier. Tiers are ordered from cleanest (index 0) to worst. */
export interface TierConfig {
  /** Stable machine key, used in the database. Never change these. */
  key: string;
  /** Name of the Discord role created for this tier. */
  roleName: string;
  /** Role colour in the Discord member list. */
  color: number;
  /** Name of the channel category gated to this tier. */
  categoryName: string;
  /** Channels auto-created inside the category by /standing-setup. */
  channels: ChannelSpec[];

  /**
   * How much a vote cast BY someone in this tier is worth.
   * Greens carry the most signal; the worse your own standing, the less your
   * opinion moves someone else. Set every value to 1 to disable weighting.
   */
  voteWeight: number;

  /**
   * Weighted score a player must reach to ENTER this tier.
   * Ignored for the first tier (index 0), which is the default for everyone.
   */
  enterAtScore: number;

  /**
   * Minimum number of distinct, currently-valid voters required before this
   * tier can be applied at all. This is the "a good margin of people" gate.
   */
  minRaters: number;

  /**
   * Same idea, but on summed vote weight rather than headcount. Stops five
   * Red-tier accounts (weight 0.2 each = 1.0 total) from acting like five
   * Greens. Keep this at roughly 60-70% of minRaters.
   */
  minEffectiveWeight: number;

  /**
   * Consensus gate. Share of the player's total vote weight that must come
   * from ratings at or above STRONG_VOTE_THRESHOLD. It is not enough for the
   * average to be high, the crowd has to actually agree. Measured on weight
   * rather than headcount so a pile of low-trust accounts cannot satisfy it.
   * 0 disables the gate.
   */
  minStrongVoteShare: number;
}

/**
 * ---------------------------------------------------------------------------
 *  THE TIER LADDER
 * ---------------------------------------------------------------------------
 *  These values are calibrated for a SMALL SERVER, on the assumption that a
 *  typical lobby produces five or six ratings rather than fifty. The whole
 *  ladder is reachable at that volume; see CALIBRATION BY SERVER SIZE at the
 *  bottom of this file for what to raise as the server grows.
 *
 *  Worked examples (assume all voters are Green, so every vote carries weight
 *  1.0, and all votes are fresh):
 *
 *    1 voter says 5      -> score 1.80  -> stays Green  (one grudge is noise)
 *    2 voters say 5      -> score 2.33  -> Green, Yellow blocked at 2 raters
 *    3 voters say 3      -> score 1.86  -> Green  (mild friction is not a tier)
 *    3 voters say 5      -> score 2.71  -> Yellow
 *    4 voters say 3      -> score 2.00  -> Yellow
 *    5 voters say 3      -> score 2.11  -> Yellow  <- the small-lobby case
 *    5 voters average 3.4-> score 2.33  -> Yellow
 *    5 voters say 4      -> score 2.67  -> Yellow
 *    6 voters say 3      -> score 2.20  -> Yellow
 *    5 voters say 5      -> score 3.22  -> Orange
 *    6 voters say 5      -> score 3.67  -> Orange
 *    8 voters say 5      -> score 3.67  -> Red
 *    8 voters say 4      -> score 3.00  -> Yellow  (agreement, but on "4")
 *   12 voters, 6 say 5 and 6 say 1
 *                        -> score 2.50  -> Yellow, and the consensus gate
 *                                          would block Orange regardless
 *
 *  So: a lone angry teammate does nothing, two do nothing, but a whole small
 *  lobby that broadly agrees moves you immediately — and Red still needs eight
 *  people independently saying the worst thing on the scale.
 * ---------------------------------------------------------------------------
 */
export const TIERS: TierConfig[] = [
  {
    key: 'green',
    roleName: 'Green',
    color: 0x57f287,
    categoryName: 'Green Channels',
    channels: [
      { name: 'הודעות', kind: 'text' },
      { name: 'Greens', kind: 'voice' },
      { name: 'Comp', kind: 'voice', userLimit: 5, count: 2 },
    ],
    voteWeight: 1.0,
    enterAtScore: 0, // default tier, threshold unused
    minRaters: 0,
    minEffectiveWeight: 0,
    minStrongVoteShare: 0,
  },
  {
    key: 'yellow',
    roleName: 'Yellow',
    color: 0xfee75c,
    categoryName: 'Yellow Channels',
    channels: [
      { name: 'הודעות', kind: 'text' },
      { name: 'Yellows', kind: 'voice' },
      { name: 'Comp', kind: 'voice', userLimit: 5, count: 2 },
    ],
    voteWeight: 0.65,
    // Set so that five people who broadly agree you are hard to play with are
    // enough. Five ratings averaging 3.0 land on 2.11, just over this line.
    enterAtScore: 2.0,
    minRaters: 3,
    minEffectiveWeight: 2.0,
    minStrongVoteShare: 0,
  },
  {
    key: 'orange',
    roleName: 'Orange',
    color: 0xe67e22,
    categoryName: 'Orange Channels',
    channels: [
      { name: 'הודעות', kind: 'text' },
      { name: 'Oranges', kind: 'voice' },
      { name: 'Comp', kind: 'voice', userLimit: 5, count: 2 },
    ],
    voteWeight: 0.4,
    enterAtScore: 3.2,
    minRaters: 5,
    minEffectiveWeight: 3.5,
    minStrongVoteShare: 0.5,
  },
  {
    key: 'red',
    roleName: 'Red',
    color: 0xed4245,
    categoryName: 'Red Channels',
    channels: [
      { name: 'הודעות', kind: 'text' },
      { name: 'Reds', kind: 'voice' },
      { name: 'Comp', kind: 'voice', userLimit: 5, count: 2 },
    ],
    voteWeight: 0.2,
    // 4.00 was unreachable below twelve unanimous raters, which a small server
    // never produces. At 3.60 the binding constraint becomes minRaters below:
    // Red means eight separate people rating you 4 or 5, with 60% of the
    // weight at 5. Raise this back toward 4.00 once you outgrow that.
    enterAtScore: 3.6,
    minRaters: 8,
    minEffectiveWeight: 5.5,
    minStrongVoteShare: 0.6,
  },
];

export const SCORING = {
  /** Lowest rating a member can give. */
  MIN_RATING: 1,
  /** Highest rating a member can give. */
  MAX_RATING: 5,

  /**
   * BAYESIAN PRIOR — the "innocent until proven guilty" dial.
   *
   * Every player is treated as if they already had PRIOR_STRENGTH invisible
   * votes of value PRIOR_VALUE. The final score is:
   *
   *     score = (SUM(weight_i * rating_i) + PRIOR_STRENGTH * PRIOR_VALUE)
   *             / (SUM(weight_i) + PRIOR_STRENGTH)
   *
   * Raise PRIOR_STRENGTH to make small vote counts matter even less.
   * Lower it to make the system react faster. This single number is the main
   * defence against "one person with a grudge".
   */
  PRIOR_STRENGTH: 4,
  PRIOR_VALUE: 1,

  /**
   * VOTE LIFETIME — a vote stops counting this many days after it was cast.
   * Expired votes are cleared from the tally and the voter may cast a new one.
   */
  VOTE_LIFETIME_DAYS: 30,

  /**
   * RECENCY DECAY — within its lifetime a vote linearly loses influence from
   * 100% (just cast) down to RECENCY_FLOOR_WEIGHT (about to expire). This
   * removes the cliff edge where an expiring vote suddenly vanishes.
   * Set RECENCY_DECAY_ENABLED to false for flat weighting.
   */
  RECENCY_DECAY_ENABLED: true,
  RECENCY_FLOOR_WEIGHT: 0.5,

  /**
   * NEWCOMER DAMPENING — anti alt-account measure. A brand new member starts
   * Green, which would otherwise hand them a full-weight vote on day one.
   * Their vote weight is scaled by NEW_MEMBER_WEIGHT_MULTIPLIER and ramps up
   * linearly to full strength once they have been in the server for
   * FULL_WEIGHT_TENURE_DAYS.
   *
   * IMPORTANT: "new" means new *relative to the community*, not new in
   * absolute terms. The ramp is shortened to the age of the server, so in a
   * server that is itself four days old everyone counts as established and
   * carries full weight. Without that, a freshly launched server would dampen
   * every single member to NEW_MEMBER_WEIGHT_MULTIPLIER for two weeks and no
   * amount of ratings could move anybody.
   */
  NEW_MEMBER_WEIGHT_MULTIPLIER: 0.35,
  FULL_WEIGHT_TENURE_DAYS: 14,

  /**
   * Votes from people who opted OUT of the system. Default 0: if you do not
   * expose yourself to community feedback, you do not get to hand it out.
   * Raise this if you would rather let non-participants vote.
   */
  OPTED_OUT_VOTE_WEIGHT: 0,

  /** A vote at or above this value counts as "strong" for the consensus gate. */
  STRONG_VOTE_THRESHOLD: 4,

  /**
   * Ratings cast by members who have since left the server. Ignored by
   * default: they cannot be challenged or re-affirmed, so leaving them in
   * would make a standing permanently un-appealable.
   */
  IGNORE_VOTES_FROM_DEPARTED_MEMBERS: true,

  /**
   * HYSTERESIS — a player only drops back out of a tier once their score falls
   * this far below the tier's entry threshold. Without it, a player sitting
   * exactly on a boundary would flip roles every time anyone votes.
   */
  TIER_EXIT_MARGIN: 0.15,

  /**
   * SAFETY RAIL — how many tiers a player may move in a single step.
   * 1 means the worst that can happen from one step is Green -> Yellow, never
   * Green -> Red. Set to TIERS.length to disable.
   */
  MAX_TIER_JUMP_PER_UPDATE: 1,

  /**
   * ...and how long before the next step down is allowed. Together with the
   * rail above this means "at most one tier worse per half day", which gives a
   * player time to read their DM and open a re-review before sliding further.
   *
   * A deferred step is not forgotten: the background sweeper re-evaluates
   * standings, so the move lands as soon as the cooldown lapses even if nobody
   * votes again in the meantime. Set to 0 to apply demotions immediately.
   */
  MIN_HOURS_BETWEEN_DEMOTIONS: 12,
} as const;

export const LIMITS = {
  /**
   * A voter may only change an existing rating this often, per target.
   *
   * Short on purpose: this is a correction window, not a brake. Someone who
   * misclicks a 5 instead of a 2 should be able to fix it while they still
   * remember, and a few minutes is enough to stop a rating being flipped back
   * and forth in real time to nudge a target across a tier boundary. The daily
   * cap below is what actually does the anti-brigade work.
   */
  VOTE_UPDATE_COOLDOWN_MINUTES: 5,
  /** Anti-brigade: max brand new ratings one member can cast per rolling day. */
  MAX_NEW_VOTES_PER_DAY: 20,
  /** How often a player may open a re-review challenge. */
  CHALLENGE_COOLDOWN_DAYS: 7,
  /** How long voters have to answer a challenge DM before their vote is dropped. */
  CHALLENGE_RESPONSE_WINDOW_HOURS: 48,
  /** Extra window after that in which the KING role can override the outcome. */
  KING_REVIEW_WINDOW_HOURS: 24,
  /**
   * How long a KING placement override holds before the community score takes
   * over again. Defaults to one vote lifetime, so by the time it lapses every
   * rating behind the disputed placement has expired anyway.
   */
  KING_OVERRIDE_DAYS: 30,
  /** Minutes an ephemeral rating session stays interactive. */
  RATING_SESSION_TIMEOUT_MINUTES: 10,
  /**
   * How often the background sweeper runs. It expires aged-out votes, advances
   * challenges past their deadlines, and lets lapsed KING overrides go.
   */
  SWEEP_INTERVAL_MINUTES: 15,
} as const;

export const SERVER_LAYOUT = {
  /**
   * The one public channel the bot creates: read-only, visible to everyone,
   * holding the explanation of the system and the buttons that open the
   * private rating flow.
   *
   * NOTE ON "WHITE" CHANNELS: the bot creates none, and touches none. Every
   * channel that already exists in the server is left exactly as it is —
   * untouched parent, untouched permissions — which is what makes it "white".
   * The bot only ever adds permission overwrites to the categories it creates
   * itself, so installing it cannot change who can see anything that was
   * already there.
   */
  ratingChannelName: 'standing-ratings',
  /** Privileged role that arbitrates challenges and runs admin commands. */
  kingRoleName: 'KING',
  /** Private channel for challenge reports and the member action log. */
  kingChannelName: 'king-review',
  /** Category holding the KING channel. */
  adminCategoryName: 'Standing Administration',
} as const;

/**
 * ---------------------------------------------------------------------------
 *  MEMBER ACTION LOG
 * ---------------------------------------------------------------------------
 *  A running feed of what members do, posted in the KING channel.
 *
 *  This setting is where two of the project's requirements meet head-on:
 *  "log every action made by members" and "nobody, including staff, can look
 *  up who rated whom". You cannot fully have both, so the default resolves it
 *  in favour of the privacy guarantee and the trade is made explicit here.
 * ---------------------------------------------------------------------------
 */
export const LOGGING = {
  enabled: true,

  /**
   * 'redacted' (default)
   *     Logs that a member rated somebody, with a timestamp, but never who or
   *     what score. The KING sees all the activity — who is participating, who
   *     is rating, who opened a re-review — without being able to reconstruct
   *     a single rating. The rest of the design's privacy promise holds.
   *
   * 'full'
   *     Also logs the target and the score, e.g. "Matan rated Meitar 4".
   *     Choose this only knowingly: it hands the KING role exactly the
   *     who-rated-whom map that the ephemeral flows, the hidden member lists
   *     and the challenge reports all work to prevent, and it makes the
   *     promise printed in the public channel untrue.
   */
  detail: 'redacted' as 'redacted' | 'full',

  /**
   * Also log automatic placement changes. These are not member actions, but
   * they are usually what a KING wants to see. Turning this off tightens
   * privacy further: standings then only ever appear in challenge reports.
   */
  includeTierChanges: true,

  /** Lines are batched for this long before posting, to stay well inside
   *  Discord's per-channel rate limit on a busy evening. */
  flushSeconds: 5,
} as const;

/**
 * WORDING — every player-visible string that touches standing lives here.
 *
 * This is a deliberate anti-shaming measure, not decoration. Roles are named
 * after colours only; there is no "Toxic" or "Bad Player" role, no hoisting in
 * the member list, no role mentions, no public tier-change announcements, and
 * no command anywhere that lets one member look up another member's standing.
 * Keep replacements neutral if you edit these.
 */
export const COPY = {
  systemName: 'Community Standing',
  scoreNoun: 'standing',
  ratingPromptTitle: 'How was this player to play with?',
  ratingScale: [
    { value: 1, label: 'Great teammate', description: 'Positive, calm, good comms' },
    { value: 2, label: 'Fine', description: 'Nothing to report' },
    { value: 3, label: 'Mixed', description: 'Occasionally hard to play with' },
    { value: 4, label: 'Difficult', description: 'Frequently disruptive' },
    { value: 5, label: 'Very difficult', description: 'Consistently ruins the game' },
  ],
} as const;

/**
 * ============================================================================
 *  CALIBRATION BY SERVER SIZE
 * ============================================================================
 *  The shipped values assume a small server where a busy player collects five
 *  or six ratings, not fifty. That is a deliberate choice, and it is the one
 *  thing you should revisit as the server grows, because the same settings
 *  that make five ratings meaningful make five ratings *powerful*.
 *
 *  Everything below scales on the same idea: how many ratings does a typical
 *  active player actually accumulate? Call that N.
 *
 *    N ~ 5      (now)        PRIOR_STRENGTH 4, yellow 2.0, red 3.6, minRaters 3/5/8
 *    N ~ 15                  PRIOR_STRENGTH 5, yellow 2.1, red 3.8, minRaters 4/7/11
 *    N ~ 40+                 PRIOR_STRENGTH 6, yellow 2.2, red 4.0, minRaters 5/9/15
 *
 *  The reasoning, so you can interpolate rather than copy:
 *
 *    - PRIOR_STRENGTH is measured in votes. It should stay well under N, or
 *      real feedback gets drowned; and well over 1, or a single grudge lands.
 *      Somewhere around N/4 to N/2 is the sweet spot.
 *    - enterAtScore ceilings rise with N, because the prior's drag shrinks as
 *      votes accumulate. With PRIOR_STRENGTH 4, n unanimous 5s cap out at
 *      (5n + 4) / (n + 4): six voters can only ever reach 3.67, twenty can
 *      reach 4.33. A threshold above the reachable ceiling is a dead tier.
 *    - minRaters is the "good margin of people" gate and should track N
 *      directly. Keep minEffectiveWeight at roughly 60-70% of it.
 *
 *  After changing anything here: restart, then run `/standing-admin
 *  recalculate` to reapply it to everyone. `npm test` will tell you
 *  immediately if you broke an invariant worth keeping.
 * ============================================================================
 */

/** Number of tiers, and helpers so the rest of the code never indexes blindly. */
export const TIER_COUNT = TIERS.length;
export const DEFAULT_TIER_INDEX = 0;

export function tierAt(index: number): TierConfig {
  const tier = TIERS[Math.min(Math.max(index, 0), TIER_COUNT - 1)];
  if (!tier) throw new Error(`No tier configured at index ${index}`);
  return tier;
}

export function tierIndexByKey(key: string): number {
  const index = TIERS.findIndex((t) => t.key === key);
  if (index === -1) throw new Error(`Unknown tier key: ${key}`);
  return index;
}

export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
