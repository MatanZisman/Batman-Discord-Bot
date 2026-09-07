# Community Standing Bot

A Discord bot for Counter-Strike servers that sorts social channels by how people actually experience playing together, using ratings from the players themselves rather than moderator judgement.

Everyone starts in **Green**. Teammates privately rate each other 1–5. A weighted, decaying, consensus-gated score decides which area of the server you sit in. Cleaner tiers can see everything below them; nobody can see upward.

```
Green     ──▶ sees Green, Yellow, Orange, Red
Yellow    ──▶ sees Yellow, Orange, Red
Orange    ──▶ sees Orange, Red
Red       ──▶ sees Red
Opted out ──▶ sees none of the above
```

**Everything that was already in your server stays exactly as it is.** The bot creates no
"white" category and moves nothing: it only adds permission overwrites to the four
categories it creates itself, so installing it cannot change who can see any channel you
already had. Those channels remain open to everyone, including members who opt out.

Each colour category gets the same four channels:

| Channel | Type | Cap |
| --- | --- | --- |
| `#הודעות` | text | — |
| `Greens` / `Yellows` / `Oranges` / `Reds` | voice | none |
| `Comp` ×2 | voice | 5 |

Plus two channels outside the cascade: a public read-only `#standing-ratings` holding the
explanation and the buttons, and a private `#king-review` for staff.

## Getting it running

```powershell
npm install
copy .env.example .env      # then fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_IDS
npm run dev                 # or: npm run build && npm start
```

In the Discord Developer Portal the application needs the **Server Members Intent** enabled, and the bot needs **Manage Roles** and **Manage Channels**. Once it is in your server:

1. Run `/standing-setup`. It creates the roles, the four tier categories with their channels and the visibility cascade already wired up, the public `#standing-ratings` channel with its pinned explanation, and the private KING review channel. It also gives every existing member their starting role.
2. Drag the bot's own role **above** Green/Yellow/Orange/Red in Server Settings → Roles, or it cannot assign them.
3. Give someone the `KING` role.

`/standing-setup` is idempotent — run it again any time to repair a deleted channel or apply renamed config values. If a role or channel with a configured name already exists it is adopted rather than duplicated, and `/standing-revert` will later hand it back rather than delete it.

### Who can run the admin commands

`/standing-setup`, `/standing-revert` and `/standing-admin` all require the **KING role**, and only work **inside the KING channel**, so administration never happens in front of the members. Two deliberate exceptions keep you from locking yourself out:

- **Manage Server also passes.** On a fresh install the KING role exists but nobody holds it, and it is the way back in if the role is ever deleted.
- **The channel rule only applies once the KING channel exists**, since the first `/standing-setup` is what creates it.

These commands carry no Discord-level permission gate, because Discord can only gate on built-in permissions and `KING` is a plain role — gating on Manage Server would hide the commands from the people meant to run them. The check happens at runtime instead, so a member who tries gets a private "that is not for you" and nothing else.

## Deploying on Railway

The repo carries a `railway.json`, so a fresh service needs three things: the environment variables, a volume, and one setting turned off.

**1. Attach a volume before the first deploy.** Service → Variables → Volumes → New Volume, mounted at `/data`. Railway sets `RAILWAY_VOLUME_MOUNT_PATH` automatically and the bot puts the database there on its own — leave `DATABASE_PATH` unset.

This is not optional, and the bot **refuses to start** without it rather than warning. A container filesystem is wiped on every deploy, and the damage is worse than losing the ratings: the same file holds the record of which roles and channels the bot created versus adopted, so losing it leaves `/standing-revert` unable to tell the difference and reduced to guessing by name. A bot that boots happily onto disposable storage looks perfectly healthy right up until the deploy that quietly resets the whole server. If you really do want a throwaway test service, `ALLOW_EPHEMERAL_DB=true` overrides the check.

**2. Set the variables:** `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and optionally `DISCORD_GUILD_IDS` and `LOG_LEVEL`.

**3. Turn off App Sleeping** for the service. It is triggered by a lack of *inbound* traffic, and this bot has none — its gateway connection is outbound, so it would be put to sleep while working perfectly.

There is no port and no healthcheck. It is a worker, and Railway reporting nothing listening is expected.

### The two non-obvious lines in `railway.json`

`railway.json` is plain JSON and cannot hold comments, so the reasoning lives here. Both settings exist because SQLite is a file, not a server, and exactly one process may write to it:

- **`numReplicas: 1`.** Two instances would mean two sweepers expiring the same votes and advancing the same re-reviews, two bots answering every interaction, and two writers on one database file.
- **`overlapSeconds: 0`.** By default Railway briefly runs the old and new containers side by side during a deploy for a zero-downtime handover. That is the right behaviour for a web service and the wrong one here — for a few seconds you would have the doubled-up bot described above. Zero stops the old container before starting the new one, at the cost of a few seconds of downtime that nobody will notice.

### What changed to make deploys safe

- **Command registration is fingerprinted.** Railway restarts the process on every deploy and every crash, and re-pushing identical slash commands each time is wasted calls against Discord's daily command-write budget. The definitions are hashed and skipped when unchanged; `FORCE_COMMAND_REGISTRATION=true` pushes anyway.
- **Shutdown is bounded, not just correct.** Railway sends `SIGTERM` and kills the process shortly after, so the handler flushes the batched action log behind a timeout and closes the database regardless. That last part matters most: a clean close is what leaves the WAL file on the volume in a good state.
- **Unhandled rejections no longer kill the process.** One rejected promise in an interaction handler used to be enough to take the bot offline and start a restart loop. They are now logged and survived. Uncaught exceptions still exit non-zero, since the process state is no longer trustworthy and a clean restart is better.

Node is pinned to 22 via `.nvmrc`. `better-sqlite3` is a native module, but ships prebuilt binaries for that version, so Nixpacks needs no extra build configuration. If the volume ever gives permission errors, Railway's fix is `RAILWAY_RUN_UID=0`.

## Removing it again

`/standing-revert` puts the server back the way the bot found it, then erases every rating, standing and open re-review for that server. It shows you the exact list first and needs a button confirmation.

"The way it found it" is not the same as "delete everything named in the config", so setup records provenance for every role, category and channel it touches:

- **Created by the bot** → deleted.
- **Adopted by the bot** (something that already existed under a config name) → kept, with its original parent category and permission overwrites restored. Pre-existing roles are kept too, but taken off every member, since their membership was the bot's doing.

If that record is missing — the database was reset, or the server was provisioned by an older build — `/standing-revert` will tell you so and do nothing. Add `include-unrecorded:true` to match on the config names instead. That mode genuinely cannot distinguish "the bot made this" from "this happens to share a name", so it lists every match for you to read before you confirm, and it refuses to touch the system, rules or community-updates channels, integration-managed roles, and anything above the bot in the role hierarchy.

## What a member sees

Everything below is ephemeral or a DM. There is no public output anywhere in the system.

**Rating** — press *Rate a player* on the pinned message in `#standing-ratings` (or `/rate`), pick someone from the dropdown, choose 1–5 on a labelled scale, then "rate another player?" loops you back to the picker until you press Finish.

**One rating per person, per player.** The database has a `UNIQUE (guild_id, rater_id, target_id)` index, so rating someone twice is impossible by construction — a second rating replaces the first. You can change a rating, but only once every 24 hours per target, so nobody can oscillate a rating to nudge someone across a boundary.

**Their own standing** — `/my-standing` or the *My standing* button. Shows your tier, your score, how many active ratings it rests on, and exactly which gate is keeping you from the next tier. Only ever your own.

**Opting out** — `/participation`. Leaving deletes every rating you have given and received, strips your tier role, and leaves you with every channel that was in the server before the bot arrived. Nobody can rate you and you cannot rate anyone. Rejoining is one button and starts you fresh in Green.

**Asking for a re-review** — `/challenge`, at most once every 7 days. See below.

## The scoring model

The full derivation lives in the comment block at the top of [`src/core/scoring.ts`](src/core/scoring.ts); every number lives in [`src/config.ts`](src/config.ts). The short version:

Each vote's influence is `trust × recency × tenure`:

| Factor | What it does | Knob |
| --- | --- | --- |
| trust | Green votes count 1.0, Yellow 0.65, Orange 0.4, Red 0.2. Opted-out members count 0. | `TIERS[].voteWeight` |
| recency | Fades linearly from 1.0 to 0.5 across the vote's 30-day life, then stops counting. | `RECENCY_FLOOR_WEIGHT` |
| tenure | A day-old account counts 0.35, ramping to full weight over two weeks — but the ramp is capped at the server's own age, so a young server doesn't dampen its founders. | `NEW_MEMBER_WEIGHT_MULTIPLIER` |

Those weights feed a Bayesian mean pulled toward Green:

```
score = (Σ wᵢ·ratingᵢ + PRIOR_STRENGTH · PRIOR_VALUE) / (Σ wᵢ + PRIOR_STRENGTH)
```

`PRIOR_STRENGTH: 4` behaves like four invisible "this player is fine" votes everyone carries. It is the single most important dial: raise it and small vote counts matter even less, lower it and the system reacts faster. It is why one angry teammate scores you 1.80 (nothing) and two score you 2.33 (still nothing).

Moving to a **worse** tier then has to clear four independent gates — score, headcount, summed trust, and a consensus share of votes ≥ 4. Moving to a **better** tier clears none, because being wrongly placed in Red costs far more than being wrongly left in Green. Two further rails: hysteresis means you stay in a tier until your score drops 0.15 below its entry threshold, and you slide at most one tier worse per 12 hours, so there is always time to read the DM and open a re-review before falling further.

### Calibrated for a small server

The shipped values assume a busy player collects **five or six ratings, not fifty**, and the whole ladder is reachable at that volume. One lobby that broadly agrees is enough to move someone:

| Situation | Score | Result |
| --- | --- | --- |
| 1 voter says 5 | 1.80 | Green — a lone grudge is noise |
| 2 voters say 5 | 2.33 | Green — headcount gate not met |
| 3 voters say 3 | 1.86 | Green — mild friction is not a tier |
| 3 voters say 5 | 2.71 | Yellow |
| **5 voters say 3** | **2.11** | **Yellow** — the small-lobby case |
| 5 voters say 4, 4, 3, 3, 3 | 2.33 | Yellow |
| 6 voters say 3 | 2.20 | Yellow |
| 5 voters say 5 | 3.22 | Orange |
| 8 voters say 5 | 3.67 | Red |
| 8 voters say 4 | 3.00 | Yellow — agreement, but only on "difficult" |
| 8 red-tier voters say 5 | 2.14 | Green — 8 × 0.2 of trust between them |
| 24 say 5, 26 say 3 | 3.74 | Yellow — no consensus, so Orange is refused |

All of these are locked in as tests: `npm test`.

Two things had to change to make that work, both of which are worth knowing about:

- **Red's threshold is 3.6, not 4.0.** With `PRIOR_STRENGTH: 4`, `n` unanimous 5s cap out at `(5n + 4) / (n + 4)` — six voters can only ever reach 3.67. A threshold of 4.0 needed twelve unanimous raters, which a small server never produces, so Red was a dead tier. At 3.6 the binding constraint is `minRaters: 8` instead: Red means eight separate people, with 60% of the weight at 5.
- **The newcomer ramp is relative to the server's age.** "New" only means something compared to everyone else. In a server that is four days old, four days of membership is full tenure — otherwise a freshly launched server dampens *every* member to 0.35 for two weeks and no amount of ratings can move anyone. In a two-year-old server a day-old account still votes at 0.35, which is the case the measure actually exists for.

### Retuning as you grow

Change one number in `src/config.ts`, restart, then run `/standing-admin recalculate` to reapply it to everyone. The scoring engine is pure, so `npm test` tells you immediately whether your change broke an invariant you cared about.

The same settings that make five ratings *meaningful* make five ratings *powerful*, so this is the thing to revisit as the server fills up. Let N be how many ratings a typical active player accumulates:

| | `PRIOR_STRENGTH` | Yellow | Red | `minRaters` |
| --- | --- | --- | --- | --- |
| N ≈ 5 (now) | 4 | 2.0 | 3.6 | 3 / 5 / 8 |
| N ≈ 15 | 5 | 2.1 | 3.8 | 4 / 7 / 11 |
| N ≈ 40+ | 6 | 2.2 | 4.0 | 5 / 9 / 15 |

Interpolate rather than copy: `PRIOR_STRENGTH` wants to sit around N/4 to N/2, entry thresholds have to stay under the reachable ceiling for that N, and `minEffectiveWeight` wants to stay at roughly 60–70% of `minRaters`. The reasoning is written out in the `CALIBRATION BY SERVER SIZE` block in `src/config.ts`.

For specific complaints:

- **Red is too easy to reach** → raise `TIERS[3].minRaters` or `minStrongVoteShare`.
- **Nobody ever leaves Green** → lower `TIERS[1].enterAtScore` first, `PRIOR_STRENGTH` second.
- **Standing feels sticky** → shorten `VOTE_LIFETIME_DAYS`.
- **Brigading happened anyway** → lower `MAX_NEW_VOTES_PER_DAY` and raise `minEffectiveWeight`.
- **Turn a mechanic off** → `RECENCY_DECAY_ENABLED: false`, `TIER_EXIT_MARGIN: 0`, `MIN_HOURS_BETWEEN_DEMOTIONS: 0`, `MAX_TIER_JUMP_PER_UPDATE: TIERS.length`, or set every `voteWeight` to 1.

## Re-review ("challenge")

A rated player can ask their raters to look again, once every 7 days. Green players cannot — there is nothing to review.

**Phase 1 — collecting (48h).** Everyone holding a current rating gets a private DM: *"Matan would like to be rated again, would you like to do so?"* with two buttons — rate them again, or keep the current rating. The KING channel gets a notice that a review is running; no action needed.

**Phase 2 — KING review (24h).** Anyone who never answered has their rating removed, on the principle that an unanswered rating is stale rather than a vote. Closed DMs count as no answer. The standing is recomputed and posted to the KING channel with three buttons: accept the outcome, undo the whole review (restoring every rating exactly as it was, original timestamps included), or place the player manually.

**Phase 3 — closed.** KING silence accepts the community's outcome. A manual placement holds for 30 days and then hands the member back to the score. The player is told the result and the response counts, privately, and nothing else.

## How shaming is designed out

This was a hard requirement, so it is worth being explicit about the mechanisms rather than the intent:

- **No pejorative label exists anywhere.** Roles are colours. There is no "Toxic" or "Bad Player" role, and the config's `COPY` block keeps every player-visible string neutral — "standing", "difficult to play with", never "toxic".
- **Tier roles are not hoisted and not mentionable**, so standing never appears as a section in the member list and cannot be pinged.
- **Tier changes are never announced.** The only message sent is a DM to the affected player.
- **No one can look up anyone else's standing.** There is no such command, for members or for staff. `/standing-admin distribution` returns per-tier counts with no names.
- **Who rated whom is never surfaced.** Not to the target, not to the KING, not in the action log at its default setting. The KING's report shows how many people re-rated, kept, or went silent — never who or what. (The one way to break this is deliberate; see the trade-off section below.)
- **The rating conversation is fully private**, ephemeral end to end. The public channel it starts from is read-only for members, so nothing about anybody's standing can ever be posted in it — not by the bot, and not by another member.
- **Both directions are reversible by design.** Ratings expire in 30 days on their own, improvement is never throttled, and opting out is one button.

## The action log, and the one real trade-off

The KING channel carries a running feed of what members do: ratings submitted and changed, people joining and leaving the system, re-reviews opened and answered, placement changes, and admin commands. Lines are batched every few seconds so a busy evening cannot rate-limit the channel or bury the challenge reports.

This is the one place where two requirements genuinely collide. "Log every action" and "nobody, including staff, can look up who rated whom" cannot both be fully true, so `LOGGING.detail` in `config.ts` decides which one wins:

- **`'redacted'` (the default)** — the log says *"Matan submitted a rating"* with a timestamp, and never the target or the score. A KING sees all the activity, and can still spot brigading, alt patterns or someone rating fifty people in a minute, without being able to reconstruct a single rating. Every privacy promise printed in the public channel stays true.
- **`'full'`** — the log says *"Matan rated Meitar 4"*. Pick this only knowingly. It hands the KING role exactly the who-rated-whom map that the ephemeral flows, the hidden member lists and the deliberately vague challenge reports all exist to prevent, and it makes the public channel's wording a lie that members will eventually find out about.

`LOGGING.includeTierChanges` is separate, and covers the automatic placements. Those are not member actions, but they are usually what a KING actually wants to see. Turning it off tightens things further: standings then only ever appear in challenge reports.

## Layout

```
src/
  config.ts                 every tunable number and every player-visible string
  index.ts                  client bootstrap, gateway events, command registration
  commands.ts               slash command definitions + dispatch
  interactions.ts           one router for all buttons and select menus
  core/
    scoring.ts              pure scoring engine — no DB, no Discord, no clock
    scoring.test.ts         17 tests pinning the behaviour above
    standing-service.ts     scoring ↔ Discord: recalculate, assign roles, DM
    guild-setup.ts          roles, categories, the visibility cascade
    guild-teardown.ts       the inverse, driven by recorded provenance
    challenge-service.ts    the three-phase re-review workflow
    action-log.ts           batched member-activity feed for the KING channel
  handlers/                 interaction handlers (rating, challenge, participation)
    guards.ts               the KING role + KING channel gate on admin commands
  ui/                       message builders, kept separate from logic
  db/                       SQLite schema, connection, typed queries
  jobs/sweeper.ts           the only clock: vote expiry, challenge deadlines,
                            override release, deferred demotions
  lib/                      logger, custom-id encoding
```

The scoring engine is deliberately isolated from everything else. That is what makes the balance testable, and it means the tuning conversation ("is Red too easy to reach?") never turns into a code change.

## Known limits

- Vote weight uses the rater's standing *at scoring time*, not at voting time. A rater who slides to Red retroactively quietens their old votes. That is the intended reading of "greens' votes count more", but it is a choice.
- The sweeper re-evaluates every member holding ratings on each cycle, which is what lets a deferred demotion land without a new vote and what picks up the knock-on effect above. It walks members serially — fine for a clan server, but a few thousand members would want batching or an event-driven fan-out instead.
- Session state for the rating loop is in memory, so a restart mid-session loses the "3 ratings recorded" counter. The ratings themselves are already committed. This is worth knowing on a platform that restarts on every deploy, though a member simply presses the button again.
- One SQLite file, so this runs as a single process — see `numReplicas` above. Sharding, or more than one instance for any reason, would need a real database.
- Nothing backs up the volume. Railway does not snapshot volumes automatically, and the database holds both the ratings and the provenance records that `/standing-revert` depends on. A periodic copy of `standing.db` somewhere else is worth setting up before this matters.
