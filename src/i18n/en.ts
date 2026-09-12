import type { Locale } from './locale.js';

/* -------------------------------------------------------------------------- */
/*  ENGLISH CATALOG                                                            */
/*                                                                            */
/*  This file is the single source of truth for the Strings type.             */
/*  Every entry with dynamic values is a typed function rather than a string. */
/*  The Hebrew catalog (he.ts) must satisfy `typeof en`, checked at compile   */
/*  time. If you add a key here, you must add it there too.                   */
/* -------------------------------------------------------------------------- */

export const en = {
  // -------------------------------------------------------------------------
  // Meta
  // -------------------------------------------------------------------------
  locale: 'en' as Locale,

  // -------------------------------------------------------------------------
  // Rating scale (maps COPY.ratingScale)
  // -------------------------------------------------------------------------
  systemName: 'Community Standing',
  ratingPromptTitle: 'How was this player to play with?',
  scale: [
    { value: 1, label: 'Great teammate', description: 'Positive, calm, good comms' },
    { value: 2, label: 'Fine', description: 'Nothing to report' },
    { value: 3, label: 'Mixed', description: 'Occasionally hard to play with' },
    { value: 4, label: 'Difficult', description: 'Frequently disruptive' },
    { value: 5, label: 'Very difficult', description: 'Consistently ruins the game' },
  ],

  // -------------------------------------------------------------------------
  // Rating hub (pinned embed in #standing-ratings)
  // -------------------------------------------------------------------------
  hub: {
    description: (a: { firstArea: string }) =>
      [
        'This server has a set of social areas sorted by how people experience playing together. Which area you can see is decided by your teammates, not by a moderator — the idea is simply that everyone gets to play with people they enjoy playing with.',
        '',
        `**Everyone starts in ${a.firstArea}, with a clean slate.**`,
      ].join('\n'),

    areasTitle: '① The areas',
    areasArea: (a: { name: string; canSee: string }) => `**${a.name}** — sees ${a.canSee}`,
    areasChannels: (a: { roomLines: string }) =>
      `Each area has its own channels: ${a.roomLines}.`,
    areasNote:
      'Being in a cleaner area means you can see *more* of the server, not less. Every channel that existed before this system was added is unaffected and stays open to everyone as it always was.',

    ratingTitle: '② How you rate someone',
    ratingInstructions:
      'Press **Rate a player** below. Pick a player, choose a number, and you will be asked whether you want to rate someone else. That is the whole thing.',

    effectTitle: '③ What your rating does',
    effectPoints: [
      '• **One rating per person, per player.** You can change your rating later, but you can never stack a second one on top.',
      '• **Ratings from people in good standing count for more.** A group in poor standing cannot gang up on someone.',
      '• **One rating barely moves anyone.** Neither do two. Moving between areas takes a real group of people who broadly agree.',
      '• **Ratings do not expire on their own.** They stay until the person who gave them changes them, leaves the system, or a review drops them.',
      '• **Brand new accounts count for very little**, so nobody can swing a result with throwaway alts.',
    ] as const,

    privacyTitle: '④ Your privacy — read this part',
    privacyPoints: [
      '• **Everything you do here is visible only to you.** The player picker, the rating, the confirmation: all of it is private, and none of it appears in this channel.',
      '• **You are never told who rated you**, and neither is anyone else. There is no command, for members or for staff, that shows another person\'s standing or who rated whom.',
      '• **No announcements.** If your area changes, the only message sent is a private one to you.',
      '• **No labels.** The roles are named after colours. There is no "toxic" role, they are hidden from the member list, and they cannot be pinged.',
    ],

    reviewTitle: '⑤ If you think a rating is unfair',
    reviewBody: (a: { days: number; king: string }) =>
      [
        `Press **Ask for a re-review**, at most once every ${a.days} days. It sends a short request to the ${a.king} role asking them to look at your value.`,
        `**Nobody who rated you is contacted**, and nobody is told you asked. The ${a.king} role may adjust your value or leave it alone, and you will not get a reply either way — if it is accepted, you will simply see your area change within a day.`,
      ].join('\n'),

    optOutTitle: '⑥ Opting out',
    optOutBody:
      [
        'Press **Participation** to leave the system entirely. Every rating involving you stops counting, you have no standing, nobody can rate you, and you cannot rate anyone. You keep access to all the channels that existed before this system, and you can rejoin whenever you like.',
        '',
        'Leaving is not a shortcut to a clean slate: if you rejoin, the ratings that were paused come back. They are suspended while you are out, not erased.',
      ].join('\n'),

    footer: 'Nothing you press here is visible to anyone else in this server.',

    // Hub buttons
    btnRate: 'Rate a player',
    btnMyStanding: 'My standing',
    btnReview: 'Ask for a re-review',
    btnParticipation: 'Participation',

    // Rooms description helpers
    roomText: (a: { count: number }) => (a.count > 1 ? `${a.count} × text channel` : 'text channel'),
    roomVoice: (a: { name: string; cap: string; count: number }) =>
      (a.count > 1 ? `${a.count} × ` : '') + `voice \`${a.name}\` (${a.cap})`,
    roomCapNone: 'no limit',
    roomCapUp: (a: { n: number }) => `up to ${a.n}`,
  },

  // -------------------------------------------------------------------------
  // Rating flow (ephemeral)
  // -------------------------------------------------------------------------
  rating: {
    notParticipating:
      'You are currently outside the standing system, so you cannot rate other players. You can rejoin below — rejoining means others may rate you too.',
    who: '**Who would you like to rate?**',
    pickerPlaceholder: 'Choose a player',
    sessionNotes: (a: { ratedSoFar: number; remaining: number; timeout: number }) => {
      const parts: string[] = [];
      if (a.ratedSoFar > 0) parts.push(`Rated this session: ${a.ratedSoFar}.`);
      parts.push(`New ratings left today: ${a.remaining}.`);
      parts.push(`This panel stops responding after ${a.timeout} minutes.`);
      return parts.join(' ');
    },
    finishBtn: 'Finish',

    scalePlaceholderNew: 'Choose a rating',
    scalePlaceholderExisting: (a: { value: number }) => `Currently ${a.value} — choose a new value`,
    scaleHeaderNew: (a: { mention: string }) => `Rating ${a.mention}.`,
    scaleHeaderExisting: (a: { mention: string; value: number }) =>
      `You currently rate ${a.mention} **${a.value}**. Pick a value below to change it, or leave it as it is.`,
    pickSomeoneElseBtn: 'Pick someone else',

    savedUpdated: (a: { mention: string; value: number; label: string }) =>
      `Updated your rating of ${a.mention} to **${a.value} · ${a.label}**.`,
    savedNew: (a: { mention: string; value: number; label: string }) =>
      `Saved your rating of ${a.mention}: **${a.value} · ${a.label}**.`,
    savedPrompt: 'Would you like to rate another player?',
    rateAnotherBtn: 'Rate another player',
    doneBtn: 'No, I am done',

    closedWithRatings: (a: { count: number }) =>
      `Thanks. ${a.count} rating(s) recorded. They stay private.`,
    closedNone: 'No ratings recorded. You can come back any time.',

    errorSelf: 'You cannot rate yourself.',
    errorNotMember: 'That player is not in this server.',
    errorBot: 'Bots are not part of the standing system.',
    errorOptedOut: 'That player has chosen not to take part in the standing system, so they cannot be rated.',
    errorBadRating: 'Something went wrong reading that rating.',
    errorDailyCap: (a: { cap: number }) =>
      `You have used all ${a.cap} new ratings for today. This limit exists so no group can rate someone down in a single evening. Come back tomorrow.`,
    cooldownMsg: (a: { minutesLeft: number }) =>
      `You changed that rating recently. You can change it again in ${a.minutesLeft} minute(s).`,

    wrongChannel: (a: { channel: string }) =>
      `Ratings happen in ${a.channel}. Everything there is private to you.`,
  },

  // -------------------------------------------------------------------------
  // My standing (/my-standing)
  // -------------------------------------------------------------------------
  standing: {
    notParticipating:
      'You are outside the standing system. You hold no standing and no ratings, and you can see the open channels only.',
    header: (a: { area: string }) => `**Your ${a.area} standing**`,
    who: 'Who rated you is not stored in any form that can be looked up, by you or by anyone else.',
    explainTier: (a: { area: string }) => `Tier: ${a.area}`,
    explainScore: (a: { score: string; max: number }) =>
      `Score: ${a.score} / ${a.max} (lower is better)`,
    explainRaters: (a: { count: number; trust: string }) =>
      `Active ratings counting toward it: ${a.count} (combined trust ${a.trust})`,
    explainDistance: (a: { area: string; gates: string }) =>
      `Distance from ${a.area}: ${a.gates}`,
    explainExpired: (a: { count: number }) =>
      `${a.count} older rating(s) have expired and no longer count.`,
  },

  // -------------------------------------------------------------------------
  // Participation (join / leave)
  // -------------------------------------------------------------------------
  participation: {
    leaveBtn: 'Leave the standing system',
    joinBtn: 'Join the standing system',

    statusIn: (a: { areas: string }) =>
      [
        '**You are taking part in the standing system.**',
        '',
        `You can rate other players, other players can rate you, and you have access to the ${a.areas} areas your standing allows.`,
      ].join('\n'),

    statusOut: (a: { areas: string }) =>
      [
        '**You are outside the standing system.**',
        '',
        `You have no standing, and no rating involving you counts for anything. Nobody can rate you, you cannot rate anyone, and you see only the channels that were already in this server before the ${a.areas} areas were added.`,
      ].join('\n'),

    confirmLeaveTitle: '**Leave the standing system?**',
    confirmLeaveBody: [
      'If you leave:',
      '• Every rating you have given and received stops counting immediately.',
      '• You lose access to the colour areas, and keep every channel that was in the server beforehand.',
      '• Nobody can rate you, and you cannot rate anyone.',
      '',
      'If you rejoin, the paused ratings come back where they left off — leaving is not a way to clear them.',
    ].join('\n'),

    confirmLeaveYes: 'Yes, leave',
    confirmLeaveCancel: 'Cancel',

    leftMsg: [
      'Done. You are now outside the standing system.',
      '',
      'Every rating involving you has stopped counting, and you have no standing. Nobody can rate you and you cannot rate anyone. You keep access to the open channels and can rejoin at any time.',
      '',
      'If you come back, the paused ratings pick up where they left off. Leaving does not erase them.',
    ].join('\n'),

    joinedMsg: (a: { area: string }) =>
      [
        `You are back in, in **${a.area}**.`,
        '',
        'You can now rate other players, and other players can rate you. You can leave again at any time.',
      ].join('\n'),

    removedByAdmin: (a: { king: string }) =>
      `You were removed from the standing system by a moderator, so you cannot rejoin on your own. Speak to the ${a.king} role if you think that should change.`,
  },

  // -------------------------------------------------------------------------
  // Review (challenge)
  // -------------------------------------------------------------------------
  review: {
    // Sent to the member who asked
    requestSent: [
      '**Your request has been sent to the moderators.**',
      '',
      'Your rating will be reviewed. If it is accepted you will see the change within 24 hours.',
      "Nobody who rated you has been contacted, and nobody has been told you asked. You can ask again in 7 days.",
    ].join('\n'),
    alreadyOpen:
      'You already have an open review request. The moderators will look at it — you can try again once it is resolved.',
    cooldown: (a: { daysLeft: number }) =>
      `You asked for a review recently. You can ask again in ${a.daysLeft} day(s).`,
    notParticipating: 'You are outside the standing system, so there is nothing to review.',

    // KING channel request embed
    kingTitle: 'A player has asked for a review',
    kingDesc: (a: { mention: string }) =>
      [
        `${a.mention} would like their rating looked at.`,
        '',
        'Ease off if you think the community has been harsh, push down if you think it has been generous, or dismiss it. Nobody who rated them has been contacted, and they have not been promised an answer.',
      ].join('\n'),
    kingWhereTitle: 'Where they are',
    kingWhereArea: (a: { area: string }) => `Area: **${a.area}**`,
    kingWhereScore: (a: { score: string }) => `Score: **${a.score}**`,
    kingWhereUnscored: 'Score: **not yet scored**',
    kingWhereRaters: (a: { count: number }) => `From **${a.count}** rater(s)`,
    kingAdjTitle: 'What an adjustment does',
    kingAdjBody: (a: { days: number }) =>
      [
        'Adds that many reports of signal, for or against.',
        'The score keeps running underneath.',
        `Fades out over ${a.days} days.`,
      ].join('\n'),
    kingFooter: 'Individual raters are never shown, by design. Doing nothing is a valid answer.',
    kingAlreadyAdjTitle: 'Already adjusted',
    kingClosesTitle: 'Closes itself',
    kingAdjustPlaceholder: 'Adjust their score',
    kingDismissBtn: 'Dismiss, no change',
    kingClearBtn: 'Take back existing adjustments',

    // Adjustment select options
    adjVerbEase: 'Ease off',
    adjVerbPush: 'Push down',
    adjLabel: (a: { verb: string; reports: number }) => `${a.verb} — ${a.reports} report(s)' worth`,
    adjLandingMoved: (a: { area: string; score: string }) => `→ ${a.area} at ${a.score}`,
    adjLandingStays: (a: { area: string; score: string }) => `stays ${a.area}, ${a.score}`,
    adjNoteBlocked: (a: { reason: string }) => ` · no move: ${a.reason}`,
    adjNoteUndo: (a: { count: number }) => ` · ${a.count} report(s) to undo`,
    adjNoteEaseMoved: ' · out of reach by reports alone',

    // Settled message
    settled: (a: { action: string }) => `**Settled:** ${a.action}`,
  },

  // -------------------------------------------------------------------------
  // DMs
  // -------------------------------------------------------------------------
  dm: {
    // Arrival notice
    arrivalGreeting: `**Welcome — one thing to know**`,
    arrivalBody: (a: { firstArea: string }) =>
      `This server has a community rating system for how people are to play with. Teammates rate each other privately, and that decides which set of channels you see. You start in **${a.firstArea}**, along with everyone else.`,

    // Voice-join notice
    voiceGreeting: `**From the server — there is something new:**`,
    voiceBody: (a: { firstArea: string }) =>
      `There is now a community rating system for how people are to play with. Teammates rate each other privately, and that decides which set of channels you see. You start in **${a.firstArea}**, along with everyone else.`,

    // Shared notice body (after greeting)
    noticeShort:
      'The short version: ratings are private, nobody can see who rated them or what anyone else was given, and no channel ever announces anyone\'s rating. You can rate people, see your own standing, ask for a re-review if you think yours is wrong, or leave the system entirely.',
    noticeHub: (a: { channel: string }) => `Everything is explained in ${a.channel}, and anything you do there is visible only to you.`,
    noticeOptOut: (a: { channel: string; king: string }) =>
      `This is the only message I will send you about this. If you would rather not take part at all, there is a button in ${a.channel} to opt out, and the ${a.king} role can answer questions.`,

    // Tier change DM
    tierImproved: (a: { area: string }) => `Your community standing moved up to **${a.area}**.`,
    tierChanged: (a: { area: string }) => `Your community standing is now **${a.area}**.`,
    tierPreviously: (a: { area: string }) => `Previously: ${a.area}`,
    tierPrivate: 'This is private. Ratings do not expire on their own.',
    tierChallenge:
      'If you think this is wrong, run `/challenge` in the server to ask the moderators to take another look. Nobody who rated you is contacted, and nobody is told you asked.',
  },

  // -------------------------------------------------------------------------
  // Maintenance
  // -------------------------------------------------------------------------
  maintenance: {
    notice:
      'The standing system is paused for maintenance right now. Nothing has been lost — your standing and every rating are exactly as you left them, and it will all be back shortly.',
  },

  // -------------------------------------------------------------------------
  // Guards / permission errors
  // -------------------------------------------------------------------------
  guards: {
    guildOnly: 'That only works inside a server.',
    kingOnly: (a: { king: string }) =>
      `Only the ${a.king} role can do that. (Members with Manage Server can too, so the role can always be handed out again.)`,
    wrongAdminChannel: (a: { channel: string }) =>
      `Administration happens in <#${a.channel}>, out of sight of the members. Run this there instead — most of it is buttons on the pinned panel, so you rarely need the commands at all.`,
    kingReviewOnly: (a: { king: string }) =>
      `Only the ${a.king} role can decide a review.`,
    requestMissing: 'That review request could not be found.',
    requestClosed: 'That request is already closed.',
  },

  // -------------------------------------------------------------------------
  // Generic error
  // -------------------------------------------------------------------------
  genericError: 'Something went wrong on my side. Nothing was recorded — please try again.',
  unknownCommand: 'Unknown command.',

  // -------------------------------------------------------------------------
  // Admin / KING panel
  // -------------------------------------------------------------------------
  admin: {
    // Panel stats text (renderStats)
    panelTitle: (a: { king: string }) => `# ${a.king} control panel`,
    running: 'Running normally.',
    paused: '**PAUSED** — channels hidden, member commands refused, all data intact.',
    announceOn: (a: { ts: number; pending: number }) =>
      `On since <t:${a.ts}:R>. ${a.pending} still to be told.`,
    announceOff: (a: { pending: number }) =>
      `Off. ${a.pending} member(s) have never been told the system exists.`,
    whereTitle: '**Where everyone sits**',
    tierCount: (a: { name: string; count: number }) => `${a.name} **${a.count}**`,
    membersSummary: (a: { in: number; out: number; removed: number }) =>
      `${a.in} taking part · ${a.out} opted out · ${a.removed} removed`,
    activityTitle: '**Activity**',
    activityRatings: (a: { day: number; week: number }) =>
      `${a.day} rating(s) in the last day, ${a.week} in the last week.`,
    activityCurrent: (a: { ratings: number; raters: number }) =>
      `${a.ratings} rating(s) currently counting, from ${a.raters} rater(s).`,
    announceTitle: '**Announcement**',
    needsLookTitle: '**Needs a look**',
    reviewsPending: (a: { count: number }) =>
      `**${a.count} review(s) waiting on a decision from you.**`,
    reviewsOpen: (a: { count: number }) =>
      `${a.count} review(s) still gathering answers.`,
    adjustedMembers: (a: { count: number }) =>
      `${a.count} member(s) carrying a moderator adjustment.`,
    panelFooter: (a: { logChannel: string | null }) =>
      [
        '-# Counts only — nothing here names anyone, by design.',
        'Accurate as of the last Refresh.',
        a.logChannel ? `Action history is in <#${a.logChannel}>.` : null,
      ]
        .filter(Boolean)
        .join(' '),

    // Panel buttons
    refreshBtn: 'Refresh',
    recalcBtn: 'Recalculate all',
    adjustBtn: "Adjust a member's score",
    undoBtn: 'Undo an adjustment',
    removeBtn: 'Remove a member',
    reinstateBtn: 'Reinstate a member',
    pauseBtn: 'Pause for maintenance',
    resumeBtn: 'Resume the system',
    announceOnBtn: 'Announce to members',
    announceOffBtn: 'Stop announcing',
    refreshHubBtn: 'Repost the public guide',
    languageBtn: 'Language / שפה',
    dmBtn: 'Send a DM',

    // Member picker prompts
    pickerAdjust: 'Whose score do you want to lean on?',
    pickerUndo: 'Whose adjustments do you want to take back?',
    pickerRemove: 'Who do you want to remove from the system?',
    pickerReinstate: 'Who do you want to let back in?',
    pickerDm: 'Who do you want to message?',
    pickerChoose: 'Choose a member',

    pickerWarnAdjust:
      'You are adding signal, not setting an area. The community score keeps running, so enough people can still overrule you — the next screen tells you exactly how many.',
    pickerWarnUndo:
      "Everything currently granted to them is withdrawn and their score goes back to being the community's alone.",
    pickerWarnRemove:
      'They leave the system and cannot rejoin themselves. Their ratings are suspended, not deleted, so reinstating them puts things back.',
    pickerWarnReinstate:
      'This only lifts the block. They stay outside the system until they choose to rejoin, and their suspended ratings resume then.',
    pickerWarnDm:
      'You will write the message yourself on the next screen. It is sent as a private DM from the bot.',

    dmModalTitle: 'Send a private DM',
    dmModalLabel: 'Message',
    dmModalPlaceholder: 'Write the message the member should receive…',
    dmSent: (a: { mention: string }) => `Sent your message to ${a.mention}.`,
    dmFailed: (a: { mention: string }) =>
      `Could not DM ${a.mention}. Their DMs from server members are probably closed.`,
    dmEmpty: 'Write a message first.',

    // Adjustment picker
    adjPickerTitle: (a: { mention: string }) => `**How much should ${a.mention}'s score be leaned on?**`,
    adjPickerCurrent: (a: { area: string; score: string }) =>
      `They are in **${a.area}** at **${a.score}** right now.`,
    adjPickerUnit: (a: { days: number }) =>
      `One report's worth is one synthetic rating, weighted like a full-strength member. It fades over ${a.days} days and the real votes keep counting the whole time, so this leans on the number without taking it over.`,
    adjPickerLive: '**Already live**',
    adjPickerPlaceholder: 'Choose a direction and a size',
    adjClearOption: 'Take back every adjustment on them',
    adjClearDesc: 'Back to the community score alone',

    // Action replies
    recalcDone: (a: { count: number }) =>
      `Recomputed ${a.count} standing(s) against the current tuning values.`,
    refreshDone: 'Refreshed.',
    refreshHubDone: (a: { channel: string }) =>
      `Reposted the explanation and buttons in <#${a.channel}>.`,
    refreshHubMissing:
      'I could not find the public channel. Run `/standing-setup` instead.',

    distribution: (a: { lines: string }) =>
      ['**Where the server currently sits**', a.lines, '', 'Counts only. There is no command, for anyone, that lists which members are where.'].join('\n'),

    adjustApplied: (a: { mention: string; area: string; score: string; from: string; undo: string; blocked: string; days: number; reports: number; moved: boolean }) =>
      [
        `${a.mention} is now in **${a.area}** at **${a.score}**, from ${a.from}.${a.undo}${a.blocked}`,
        '',
        `The adjustment is ${a.reports} report(s)' worth of signal, not a placement: every real rating still counts, and this fades out over ${a.days} days. ${a.moved ? 'They have been told their area changed, privately, with no reason given and no mention of who decided it.' : 'Their area did not move, so they were told nothing.'}`,
      ].join('\n'),
    adjustUndoStr: (a: { count: number }) =>
      `\n\nIt would take **${a.count}** fresh report(s) at the top of the scale to put them back where they were — the community can overrule this, it does not have to wait it out.`,
    adjustBlockedStr: (a: { reason: string }) =>
      `\n\n**Their area did not move, and will not on this alone:** ${a.reason}. Adjustments move the score and never the headcount or consensus gates, so pressure cannot place somebody the community has not actually rated. The score is recorded and takes effect once enough real people have weighed in.`,

    adjustCleared: (a: { mention: string; count: number }) =>
      `Took back ${a.count} adjustment(s). ${a.mention} is on the community score alone.`,
    adjustClearedNone: (a: { mention: string }) =>
      `${a.mention} is not carrying any adjustments.`,
    adjustNotParticipating: (a: { mention: string }) =>
      `${a.mention} is outside the standing system, so there is no score to lean on. Reinstate them, or ask them to join, first.`,
    adjustBadDirection: 'That is not one of the directions.',

    removeDone: (a: { mention: string }) =>
      [
        `${a.mention} is out of the standing system and cannot rejoin themselves.`,
        '',
        'Every rating involving them is suspended rather than deleted, so `/standing-admin reinstate` puts things back as they were.',
      ].join('\n'),

    reinstateDone: (a: { mention: string }) =>
      `${a.mention} can rejoin again whenever they choose to. They are still outside the system until they press Join, and any suspended ratings resume at that point.`,

    pauseDone: (a: { hidden: string; failures: string | null }) =>
      [
        '**Paused.**',
        a.hidden || 'Nothing needed hiding.',
        a.failures,
        '',
        'Every rating, standing and open re-review is untouched, and member commands now say the system is down for maintenance. This channel stays visible so you can run `/standing-admin resume`.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    resumeDone: (a: { count: number }) =>
      [
        '**Back up.**',
        `Channels are visible again and ${a.count} member(s) have been re-checked against their standing.`,
        '',
        'Standings are exactly what they were before the pause. Anything deleted during the downtime was rebuilt, and the pinned explanation was reposted.',
      ].join('\n'),

    resumeError: (a: { error: string }) => `Could not resume: ${a.error}`,

    noticeStatus: (a: { ts: number; pending: number }) =>
      [
        `**On** since <t:${a.ts}:F>.`,
        `${a.pending} member(s) are still to be told, and will be on their next voice join.`,
        '',
        'Anyone whose DMs are closed is retried the next day rather than written off, so this number can fall slowly.',
      ].join('\n'),
    noticeStatusOff: (a: { pending: number }) =>
      `**Off.** Nobody is being told. ${a.pending} member(s) have never received the notice.`,
    noticeOff:
      'Off. Nobody else will be messaged. Everyone already told stays told, so switching it back on will not repeat anyone.',
    noticeOn: (a: { pending: number; skipped: number }) =>
      [
        '**On.**',
        `${a.pending} member(s) will each get one private DM, the first time they join a voice channel from now on.`,
        a.skipped > 0
          ? `${a.skipped} member(s) were skipped because they have already rated someone or already chose to opt out — they know it exists.`
          : null,
        '',
        'Nobody is messaged twice, including across restarts and redeploys. Nobody is messaged for joining the AFK channel, and nobody is messaged while the system is paused.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    languageSwitched: (a: { label: string }) =>
      `Language set to **${a.label}**. The pinned messages have been updated.`,
  },

  // -------------------------------------------------------------------------
  // Setup replies
  // -------------------------------------------------------------------------
  setup: {
    done: '**Setup complete.**',
    createdRoles: (a: { names: string }) => `Created roles: ${a.names}`,
    createdChannels: (a: { names: string }) => `Created channels: ${a.names}`,
    reused: (a: { count: number }) => `Reused existing: ${a.count} item(s)`,
    initialised: (a: { count: number }) => `Gave a starting role to ${a.count} member(s).`,
    ratingChannel: (a: { channel: string }) =>
      `Members read the rules and rate each other in <#${a.channel}>.`,
    existing:
      'Channels that already existed were left exactly as they were — no category moves, no permission changes.',
    roleOrder: (a: { roles: string }) =>
      `Make sure my role sits **above** ${a.roles} in Server Settings → Roles, or I cannot assign them.`,
    error: (a: { message: string }) =>
      `Setup failed: ${a.message}\n\nCheck that I have Manage Roles and Manage Channels.`,
  },

  // -------------------------------------------------------------------------
  // Revert UI
  // -------------------------------------------------------------------------
  revert: {
    confirmTitle: (a: { guild: string }) => `Undo all of the standing system in ${a.guild}?`,
    confirmDesc:
      'Everything this bot created is listed below. Every rating, standing and open review will be erased. This cannot be undone.',
    toDeleteRoles: (a: { count: number }) => `Roles to delete (${a.count})`,
    toDeleteChannels: (a: { count: number }) => `Channels to delete (${a.count})`,
    toRestoreChannels: (a: { count: number }) => `Channels to restore (${a.count})`,
    toRestoreDesc:
      'These existed before the bot arrived, so they keep their messages and go back to their original category and permissions.',
    toEmptyRoles: (a: { count: number }) => `Roles kept but cleared (${a.count})`,
    toEmptyRolesDesc:
      'These existed before the bot arrived. The role stays, but it comes off every member, because the bot is what put them there.',
    toLeaveRoles: (a: { count: number }) => `Roles left completely alone (${a.count})`,
    toLeaveRolesDesc:
      'The bot only read these to decide who could run commands — it never handed them out. Members, permissions and name all stay exactly as they are.',
    unrecorded: (a: { count: number }) => `Also matched on name — no record (${a.count})`,
    unrecordedDesc:
      'Provenance is missing. These match the configured names but were not recorded by this bot, so the plan treats them the same way it would a newly created item.',
    nothingToDo: 'There is nothing recorded for this server. The bot has either never run setup here, or has already been reverted.',
    confirmBtn: 'Yes, undo everything',
    cancelBtn: 'Cancel',

    // Report
    deleted: (a: { roles: string }) => `Deleted roles: ${a.roles}`,
    deletedChannels: (a: { channels: string }) => `Deleted channels: ${a.channels}`,
    restored: (a: { channels: string }) => `Restored ${a.channels} to their original setup.`,
    released: (a: { roles: string }) => `Left ${a.roles} in place but took them off every member.`,
    untouched: (a: { roles: string }) => `Did not touch ${a.roles} at all — members and permissions intact.`,
    cleared: (a: { count: number }) => `Erased ${a.count} database row(s). No ratings or standings remain.`,
    failures: (a: { items: string }) => `Could not complete: ${a.items}`,
    inProgress: '⏳ Working on it…',
    cancelled: 'Cancelled. Nothing was changed.',
  },

  // -------------------------------------------------------------------------
  // Action log (KING channel)
  // -------------------------------------------------------------------------
  log: {
    ratingCreatedFull: (a: { actor: string; target: string; value: number }) =>
      `${a.actor} rated ${a.target} **${a.value}**`,
    ratingCreatedRedacted: (a: { actor: string }) =>
      `${a.actor} submitted a rating`,
    ratingUpdatedFull: (a: { actor: string; target: string; value: number }) =>
      `${a.actor} changed their rating of ${a.target} to **${a.value}**`,
    ratingUpdatedRedacted: (a: { actor: string }) =>
      `${a.actor} changed a rating they had given`,
    optIn: (a: { actor: string }) =>
      `${a.actor} joined the standing system; suspended ratings resumed`,
    optOut: (a: { actor: string }) =>
      `${a.actor} left the standing system; ratings involving them are suspended`,
    challengeOpened: (a: { actor: string; invited: number }) =>
      `${a.actor} opened a re-review, ${a.invited} rater(s) asked`,
    challengeRerated: (a: { actor: string }) =>
      `${a.actor} re-rated a player during a re-review`,
    challengeKept: (a: { actor: string }) =>
      `${a.actor} kept their existing rating during a re-review`,
    tierChange: (a: { subject: string; from: string; to: string }) =>
      `${a.subject} moved **${a.from} → ${a.to}**`,
    admin: (a: { actor: string; summary: string }) =>
      `${a.actor} ${a.summary}`,
  },

  // -------------------------------------------------------------------------
  // Command descriptions (for slash-command registration)
  // -------------------------------------------------------------------------
  commandDescs: {
    rate: 'Privately rate the players you have been playing with',
    myStanding: 'See your own standing. Only you can see the reply.',
    challenge: 'Ask the people who rated you to take another look',
    participation: 'Join or leave the community standing system',
    standingSetup: 'Create or repair the roles, categories and permissions this system needs',
    standingSetupLanguage: 'Language for all messages and UI (default: English)',
    standingSetupLanguageEn: 'English',
    standingSetupLanguageHe: 'Hebrew (עברית)',
    standingRevert: 'Undo everything this bot created and erase all its data for this server',
    standingRevertInclude: 'Also delete roles and channels matching my config that I have no record of creating',
    standingAdmin: 'Maintenance tools',
    adminRecalculate: 'Recompute every standing, e.g. after changing the tuning values',
    adminDistribution: 'How many members sit in each area. Counts only, never names.',
    adminAdjust: "Lean on a member's score without taking it over",
    adminAdjustUser: 'Who to adjust',
    adminAdjustDirection: 'Which way to lean, or undo what is already there',
    adminAdjustEase: 'ease off — argue the community has been harsh',
    adminAdjustPush: 'push down — argue the community has been generous',
    adminAdjustUndo: 'undo — take back every adjustment on them',
    adminAdjustReports: (a: { def: number }) =>
      `How many reports' worth. Defaults to ${a.def}. Ignored when undoing.`,
    adminRemove: 'Remove a member from the system. They cannot rejoin themselves.',
    adminRemoveUser: 'Who to remove',
    adminReinstate: 'Undo a removal, letting the member choose to rejoin',
    adminReinstateUser: 'Who to reinstate',
    adminPause: 'Hide the system for maintenance. Keeps every rating and standing.',
    adminResume: 'Bring the system back after a pause',
    adminRefreshHub: 'Repost the pinned explanation and buttons in the public channel',
    adminNotice: 'The one-time DM telling each member the system exists',
    adminNoticeAction: 'Turn it on, turn it off, or see how far it has got',
    adminNoticeOn: 'on — start telling people on their first voice join',
    adminNoticeOff: 'off — stop telling anyone new',
    adminNoticeStatus: 'status — how many are still to be told',
  },
} as const;

/**
 * Recursively converts string literal types to `string` while preserving
 * function signatures, Locale, and array shapes.
 * This lets `he.ts` satisfy `Strings` with different text values.
 */
type Loosen<T> =
  T extends Locale ? Locale
  : T extends string ? string
  : T extends (...args: infer A) => string ? (...args: A) => string
  : T extends readonly (infer U)[] ? ReadonlyArray<Loosen<U>>
  : { readonly [K in keyof T]: Loosen<T[K]> };

export type Strings = Loosen<typeof en>;
