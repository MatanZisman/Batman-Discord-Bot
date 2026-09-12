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
 *    - Ratings do not expire. Once cast they stay until the rater changes
 *      them, leaves the system, or a review drops them. Set VOTES_EXPIRE to
 *      true and tune VOTE_LIFETIME_DAYS if you want time-limited ratings again.
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
 *  Worked examples (Green voters, fresh votes, with GOOD_VOTE_WEIGHTS on):
 *
 *    1 voter says 5      -> stays Green  (one grudge is noise)
 *    4 voters say 5      -> Green, Yellow blocked at headcount (< 5)
 *    5 voters say 3      -> Green  (score still below Yellow 2.5)
 *    5 voters say 4      -> Yellow
 *    5 voters say 5      -> Yellow
 *    ~10 voters say 5    -> Orange becomes reachable on score
 *    Red (4.25) needs a large, consistent pile of harsh ratings
 *
 *  Good ratings (1) weigh more than harsh ones (5), so positive evidence is
 *  stronger than negative evidence of the same headcount.
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
    enterAtScore: 2.5,
    minRaters: 5,
    // Five harsh ratings weigh 0.5 each under GOOD_VOTE_WEIGHTS → 2.5 total.
    minEffectiveWeight: 2.5,
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
    enterAtScore: 3.5,
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
    enterAtScore: 4.25,
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
   * GOOD-VOTE EMPHASIS — a rating of 1 (great teammate) carries more influence
   * than a rating of 5 (very difficult). Positive evidence is stronger than
   * negative evidence of the same headcount. Keys are the rating values.
   * Set every entry to 1 to disable.
   */
  GOOD_VOTE_WEIGHTS: {
    1: 1.5,
    2: 1.25,
    3: 1.0,
    4: 0.75,
    5: 0.5,
  } as Readonly<Record<number, number>>,

  /**
   * VOTE LIFETIME — when VOTES_EXPIRE is true, a vote stops counting this many
   * days after it was cast. When false (the shipped setting), ratings never
   * age out on their own.
   */
  VOTES_EXPIRE: false,
  VOTE_LIFETIME_DAYS: 30,

  /**
   * RECENCY DECAY — within a lifetime a vote linearly loses influence from
   * 100% (just cast) down to RECENCY_FLOOR_WEIGHT. Only meaningful when
   * VOTES_EXPIRE is true. Left off while ratings never expire.
   */
  RECENCY_DECAY_ENABLED: false,
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
  /** How often a player may ask for a review. */
  CHALLENGE_COOLDOWN_DAYS: 7,
  /**
   * How long a request sits in the KING channel before it closes itself as
   * "no action taken".
   *
   * Requests are not obligations. Nobody is required to answer one, and an
   * ignored request quietly lapsing is a legitimate outcome — that is why the
   * player is never promised a reply. This exists so the queue on the panel
   * stays a real number rather than an ever-growing pile.
   */
  CHALLENGE_REQUEST_WINDOW_HOURS: 48,
  /** Minutes an ephemeral rating session stays interactive. */
  RATING_SESSION_TIMEOUT_MINUTES: 10,
  /**
   * How often the background sweeper runs. It advances challenges past their
   * deadlines, re-evaluates anyone whose adjustment has run out, and (only if
   * VOTES_EXPIRE is on) ages out old ratings.
   */
  SWEEP_INTERVAL_MINUTES: 15,
} as const;

/**
 * ============================================================================
 *  ADJUSTMENTS — how a moderator leans on a score without owning it
 * ============================================================================
 *  A KING reviewing a request does not set anybody's area. They grant an
 *  adjustment, measured in *reports*, and the scoring engine takes it from
 *  there.
 *
 *  One report's worth is one synthetic vote: value 1 to ease off, value 5 to
 *  push down, carrying the weight of one full-strength rater. It goes into the
 *  same weighted mean everything else goes into.
 *
 *  ---------------------------------------------------------------------------
 *  WHY THIS RATHER THAN SETTING THE VALUE OUTRIGHT
 *  ---------------------------------------------------------------------------
 *  An override answers the question "where does this person belong?" and locks
 *  the answer in. While it is live the community is talking to itself: people
 *  keep rating, the score keeps moving, and none of it does anything. That is
 *  a bad shape for a system whose entire claim is that the community decides.
 *
 *  An adjustment answers a smaller and more honest question: "how much of this
 *  do I think is wrong?" Five reports' worth of forgiveness says exactly that,
 *  and it stays answerable — five more people reporting the same thing
 *  overrules it, because the arithmetic never stopped running.
 *
 *  It also self-normalises, which a flat offset cannot. Five reports of relief
 *  is a lot against six raters and very little against sixty, so a moderator's
 *  judgement carries real weight over a thin signal and is quietly outvoted by
 *  a thick one. Nobody has to write that rule down; it falls out of the mean.
 *
 *  ---------------------------------------------------------------------------
 *  WHAT IT COSTS TO UNDO ONE
 *  ---------------------------------------------------------------------------
 *  Reaching a threshold T needs (T-1)/(5-T) extra maximum-severity reports per
 *  report's worth of relief granted. With the shipped thresholds:
 *
 *      Yellow (2.5)    0.60 reports per credit
 *      Orange (3.5)    1.67
 *      Red    (4.25)   4.33
 *
 *  So relief barely slows a slide into Yellow and strongly resists Red, which
 *  is the right shape: a moderator saying "this is overblown" should be hard
 *  to overrule on the severe end and easy to overrule on the mild one.
 *
 *  Nobody has to do that arithmetic in their head. The picker computes the
 *  exact consequence of each size against the member's real votes and prints
 *  it, so the choice is made with the answer already on screen.
 * ============================================================================
 */
export const CREDITS = {
  /**
   * How long a grant lasts. One vote lifetime, so by the time it runs out
   * every rating it was granted against has expired anyway and the member is
   * back on a score built entirely from things that happened after the review.
   */
  LIFETIME_DAYS: 30,

  /**
   * Fade a grant out over its lifetime, exactly as votes fade, instead of
   * having it vanish on a cliff edge.
   *
   * This also settles a fairness question. A grant made a month ago competing
   * with a report made this morning should lose, and decay is what makes that
   * happen without a special rule: the old thing is quiet and the new thing is
   * loud, whoever made it.
   */
  DECAY_ENABLED: true,

  /** Sizes offered in the picker, in reports' worth. */
  OFFERED_SIZES: [3, 5, 8] as const,

  /**
   * Ceiling on a single grant. Fifteen full-weight reports is far more signal
   * than a small server produces in a month, so anything above this is not a
   * judgement about a score, it is an override wearing a disguise.
   */
  MAX_REPORTS_PER_GRANT: 15,
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
  /**
   * The admin area is two channels, not one, because they want opposite
   * things. The log is append-only history that must never be disturbed; the
   * menu is a single live message that is constantly rewritten in place. Put
   * them together and every stats refresh either buries the log or gets buried
   * by it.
   */
  kingChannelName: 'kings-log',
  kingMenuChannelName: 'kings-menu',
  /**
   * What the log channel used to be called. Setup renames it rather than
   * leaving an orphan behind, so existing challenge history and the action
   * log survive the split.
   */
  legacyKingChannelName: 'king-review',
  /** Category holding the KING channel. */
  adminCategoryName: 'Standing Administration',
} as const;

/**
 * Housekeeping for the public rating channel.
 *
 * The channel is read-only and every reply the bot gives a member is ephemeral,
 * so in normal use almost nothing accumulates there — ephemeral messages never
 * enter channel history at all. What does build up is litter: Discord's own
 * "so-and-so pinned a message" notices, and a stray duplicate guide if the pin
 * is ever removed and the guide gets republished.
 *
 * THE RULE: pinned stays, everything else goes. That keeps the channel down to
 * the guide, and gives anyone who genuinely wants a notice to live there an
 * obvious way to protect it — pin it.
 */
export const CLEANUP = {
  RATING_CHANNEL_ENABLED: true,
  /** How many recent messages to examine per pass. Discord's fetch cap is 100. */
  MESSAGES_PER_PASS: 100,
  /**
   * Grace period before an unpinned message is swept. Long enough that nobody
   * watches their own message vanish mid-sentence, short enough to stay tidy.
   */
  MIN_AGE_MINUTES: 10,
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
