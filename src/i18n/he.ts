import { ltr, rtlLine } from './bidi.js';
import type { Strings } from './en.js';
import type { Locale } from './locale.js';

/* -------------------------------------------------------------------------- */
/*  HEBREW CATALOG                                                             */
/*                                                                            */
/*  Must satisfy `Strings` (checked at the bottom of this file).             */
/*  Dynamic tokens — Discord mentions, numbers, channel links — are wrapped   */
/*  with ltr() so the Unicode Bidi algorithm keeps them in reading order.     */
/*  Multi-line blocks use rtlLine() so Discord renders them RTL.              */
/* -------------------------------------------------------------------------- */

export const he = {
  locale: 'he' as Locale,

  systemName: 'מעמד קהילתי',
  ratingPromptTitle: 'איך היה לשחק עם השחקן הזה?',
  scale: [
    { value: 1, label: 'חבר קבוצה מצוין', description: 'חיובי, רגוע, תקשורת טובה' },
    { value: 2, label: 'בסדר', description: 'אין מה לדווח' },
    { value: 3, label: 'מעורב', description: 'לפעמים קשה לשחק איתו' },
    { value: 4, label: 'קשה', description: 'לעתים קרובות מפריע' },
    { value: 5, label: 'קשה מאוד', description: 'בעקביות מקלקל את המשחק' },
  ],

  hub: {
    description: (a: { firstArea: string }) =>
      [
        rtlLine(`לשרת הזה יש מערכת אזורים חברתית, ממוינת לפי חוויית השחקנים. האזור שאתה רואה נקבע על ידי חבריך לקבוצה, לא על ידי מנהל — הרעיון פשוט: כולם ישחקו עם אנשים שנעים להם לשחק איתם.`),
        '',
        rtlLine(`**כולם מתחילים ב-${a.firstArea}, עם דף נקי.**`),
      ].join('\n'),

    areasTitle: '① האזורים',
    areasArea: (a: { name: string; canSee: string }) =>
      rtlLine(`**${a.name}** — רואה ${a.canSee}`),
    areasChannels: (a: { roomLines: string }) =>
      rtlLine(`לכל אזור יש ערוצים משלו: ${a.roomLines}.`),
    areasNote: rtlLine(
      'להיות באזור נקי יותר פירושו לראות *יותר* מהשרת, לא פחות. כל ערוץ שהיה בשרת לפני המערכת נשאר פתוח לכולם כפי שהיה.',
    ),

    ratingTitle: '② איך מדרגים',
    ratingInstructions: rtlLine(
      'לחץ **דרג שחקן** למטה. בחר שחקן, בחר מספר, ותישאל אם ברצונך לדרג עוד מישהו. זה הכל.',
    ),

    effectTitle: '③ מה הדירוג עושה',
    effectPoints: [
      rtlLine('• **דירוג אחד לאדם, לכל שחקן.** ניתן לשנות את הדירוג מאוחר יותר, אבל לא לצבור שניים.'),
      rtlLine('• **דירוגים מאנשים במעמד טוב שוקלים יותר.** קבוצה במעמד רע לא יכולה להכריע לבד.'),
      rtlLine('• **דירוג אחד כמעט לא זז.** גם לא שניים. לעבור בין אזורים צריך קבוצה אמיתית שרחבה מסכימה.'),
      (a: { days: number }) =>
        rtlLine(`• **דירוגים פגים מעצמם לאחר ${ltr(a.days)} ימים.** שום דבר לא ירדוף אחריך לנצח, ולא צריך שיסלחו לך — זה פשוט פוקע.`),
      rtlLine('• **חשבונות חדשים שוקלים מעט מאוד**, כך שאף אחד לא יכול לשנות תוצאה עם חשבונות מזויפים.'),
    ] as const,

    privacyTitle: '④ הפרטיות שלך — חשוב לקרוא',
    privacyPoints: [
      rtlLine('• **כל מה שאתה עושה כאן גלוי רק לך.** בוחר השחקנים, הדירוג, האישור — הכל פרטי, ולא מופיע בערוץ.'),
      rtlLine('• **לעולם לא יגידו לך מי דירג אותך**, וגם לא לאחרים. אין פקודה, לחברים או לצוות, שמציגה מעמד של אחר או מי דירג את מי.'),
      rtlLine('• **ללא הכרזות.** אם האזור שלך משתנה, ההודעה היחידה היא הודעה פרטית אליך.'),
      rtlLine('• **ללא תיוגים.** התפקידים קרויים על שם צבעים. אין תפקיד "רעיל", הם מוסתרים מרשימת החברים ולא ניתן לפנג\'ות אותם.'),
    ],

    reviewTitle: '⑤ אם חושב שהדירוג לא הוגן',
    reviewBody: (a: { days: number; king: string }) =>
      [
        rtlLine(`לחץ **בקש סקירה מחדש**, לכל היותר פעם אחת בכל ${ltr(a.days)} ימים. זה שולח בקשה קצרה לתפקיד ${a.king} שיבדוק את הערך שלך.`),
        rtlLine(`**אף אחד שדירג אותך לא נמצא בקשר**, ולא נאמר לאף אחד שביקשת. תפקיד ${a.king} עשוי לשנות את הערך או להשאירו — לא תקבל תשובה, אבל אם יתקבל, פשוט תראה שהאזור שלך השתנה תוך יום.`),
      ].join('\n'),

    optOutTitle: '⑥ יציאה מהמערכת',
    optOutBody: (a: { days: number }) =>
      [
        rtlLine('לחץ **השתתפות** לצאת מהמערכת לחלוטין. כל דירוג שנוגע בך מפסיק לספור, אין לך מעמד, אף אחד לא יכול לדרג אותך ואתה לא יכול לדרג אף אחד. תשמור גישה לכל ערוץ שהיה בשרת לפני המערכת, ותוכל לחזור בכל עת.'),
        '',
        rtlLine(`יציאה היא לא קיצור דרך לדף נקי: אם תחזור, דירוגים שטרם פגו יחזרו לתוקף. הם פוגים ${ltr(a.days)} ימים לאחר שניתנו בכל מקרה, כך שהזמן מנקה את הרשומה — לכולם, באותם תנאים.`),
      ].join('\n'),

    footer: 'שום דבר שתלחץ כאן אינו גלוי לאף אחד אחר בשרת.',

    btnRate: 'דרג שחקן',
    btnMyStanding: 'המעמד שלי',
    btnReview: 'בקש סקירה מחדש',
    btnParticipation: 'השתתפות',

    roomText: (a: { count: number }) => (a.count > 1 ? `${ltr(a.count)} × ערוץ טקסט` : 'ערוץ טקסט'),
    roomVoice: (a: { name: string; cap: string; count: number }) =>
      (a.count > 1 ? `${ltr(a.count)} × ` : '') + `קול \`${a.name}\` (${a.cap})`,
    roomCapNone: 'ללא הגבלה',
    roomCapUp: (a: { n: number }) => `עד ${ltr(a.n)}`,
  },

  rating: {
    notParticipating: rtlLine(
      'אתה כעת מחוץ למערכת המעמד, ולכן אינך יכול לדרג שחקנים אחרים. אתה יכול להצטרף מחדש למטה — חזרה פירושה שאחרים יוכלו לדרג אותך.',
    ),
    who: rtlLine('**את מי ברצונך לדרג?**'),
    pickerPlaceholder: 'בחר שחקן',
    sessionNotes: (a: { ratedSoFar: number; remaining: number; timeout: number }) => {
      const parts: string[] = [];
      if (a.ratedSoFar > 0) parts.push(rtlLine(`דורגו בסשן הזה: ${ltr(a.ratedSoFar)}.`));
      parts.push(rtlLine(`דירוגים חדשים שנשארו היום: ${ltr(a.remaining)}.`));
      parts.push(rtlLine(`הלוח מפסיק להגיב לאחר ${ltr(a.timeout)} דקות.`));
      return parts.join(' ');
    },
    finishBtn: 'סיום',

    scalePlaceholderNew: 'בחר דירוג',
    scalePlaceholderExisting: (a: { value: number }) => `כעת ${ltr(a.value)} — בחר ערך חדש`,
    scaleHeaderNew: (a: { mention: string }) => rtlLine(`מדרג את ${ltr(a.mention)}.`),
    scaleHeaderExisting: (a: { mention: string; value: number }) =>
      rtlLine(`אתה מדרג כרגע את ${ltr(a.mention)} **${ltr(a.value)}**. בחר ערך למטה לשנות, או השאר כפי שהוא.`),
    pickSomeoneElseBtn: 'בחר מישהו אחר',

    savedUpdated: (a: { mention: string; value: number; label: string }) =>
      rtlLine(`עדכנת את הדירוג של ${ltr(a.mention)} ל-**${ltr(a.value)} · ${a.label}**.`),
    savedNew: (a: { mention: string; value: number; label: string }) =>
      rtlLine(`שמרת את הדירוג של ${ltr(a.mention)}: **${ltr(a.value)} · ${a.label}**.`),
    savedPrompt: rtlLine('האם ברצונך לדרג שחקן נוסף?'),
    rateAnotherBtn: 'דרג שחקן נוסף',
    doneBtn: 'לא, סיימתי',

    closedWithRatings: (a: { count: number }) =>
      rtlLine(`תודה. ${ltr(a.count)} דירוג/ים נרשמו. הם נשארים פרטיים ויפגו מעצמם.`),
    closedNone: rtlLine('לא נרשמו דירוגים. תוכל לחזור בכל עת.'),

    errorSelf: rtlLine('אינך יכול לדרג את עצמך.'),
    errorNotMember: rtlLine('השחקן הזה אינו בשרת.'),
    errorBot: rtlLine('בוטים אינם חלק ממערכת המעמד.'),
    errorOptedOut: rtlLine('השחקן הזה בחר שלא להשתתף במערכת המעמד, ולכן לא ניתן לדרג אותו.'),
    errorBadRating: rtlLine('משהו השתבש בקריאת הדירוג.'),
    errorDailyCap: (a: { cap: number }) =>
      rtlLine(`השתמשת בכל ${ltr(a.cap)} הדירוגים החדשים להיום. המגבלה קיימת כדי שאף קבוצה לא תוריד מישהו בערב אחד. חזור מחר.`),
    cooldownMsg: (a: { minutesLeft: number }) =>
      rtlLine(`שינית דירוג זה לאחרונה. תוכל לשנות שוב בעוד ${ltr(a.minutesLeft)} דקה/ות.`),

    wrongChannel: (a: { channel: string }) =>
      rtlLine(`דירוגים נעשים ב-${ltr(a.channel)}. הכל שם פרטי אליך.`),
  },

  standing: {
    notParticipating: rtlLine(
      'אתה מחוץ למערכת המעמד. אין לך מעמד ואין לך דירוגים, ואתה רואה רק את הערוצים הפתוחים.',
    ),
    header: (a: { area: string }) => rtlLine(`**המעמד שלך — ${a.area}**`),
    who: rtlLine('מי דירג אותך לא נשמר בשום צורה שניתנת לחיפוש, על ידך או על ידי אחרים.'),
    explainTier: (a: { area: string }) => rtlLine(`אזור: ${a.area}`),
    explainScore: (a: { score: string; max: number }) =>
      rtlLine(`ציון: ${ltr(a.score)} / ${ltr(a.max)} (נמוך יותר = טוב יותר)`),
    explainRaters: (a: { count: number; trust: string }) =>
      rtlLine(`דירוגים פעילים: ${ltr(a.count)} (אמון כולל ${ltr(a.trust)})`),
    explainDistance: (a: { area: string; gates: string }) =>
      rtlLine(`מרחק מ-${a.area}: ${a.gates}`),
    explainExpired: (a: { count: number }) =>
      rtlLine(`${ltr(a.count)} דירוג/ים ישנים פגו ואינם סופרים יותר.`),
  },

  participation: {
    leaveBtn: 'עזוב את מערכת המעמד',
    joinBtn: 'הצטרף למערכת המעמד',

    statusIn: (a: { areas: string }) =>
      [
        rtlLine('**אתה משתתף במערכת המעמד.**'),
        '',
        rtlLine(`אתה יכול לדרג שחקנים אחרים, שחקנים אחרים יכולים לדרג אותך, ויש לך גישה לאזורי ${a.areas} שהמעמד שלך מאפשר.`),
      ].join('\n'),

    statusOut: (a: { areas: string }) =>
      [
        rtlLine('**אתה מחוץ למערכת המעמד.**'),
        '',
        rtlLine(`אין לך מעמד, ואף דירוג שנוגע בך לא סופר לכלום. אף אחד לא יכול לדרג אותך, אתה לא יכול לדרג אף אחד, ואתה רואה רק ערוצים שהיו בשרת לפני הוספת אזורי ${a.areas}.`),
      ].join('\n'),

    confirmLeaveTitle: rtlLine('**לעזוב את מערכת המעמד?**'),
    confirmLeaveBody: (a: { days: number }) =>
      [
        rtlLine('אם תעזוב:'),
        rtlLine('• כל דירוג שנתת וקיבלת יפסיק לספור מיידית.'),
        rtlLine('• תאבד גישה לאזורי הצבעים, ותשמור כל ערוץ שהיה בשרת לפני כן.'),
        rtlLine('• אף אחד לא יוכל לדרג אותך, ואתה לא תוכל לדרג אף אחד.'),
        '',
        rtlLine(`אם תחזור, דירוגים שטרם פגו יחזרו לתוקף — עזיבה לא מוחקת אותם. הם פוגים מעצמם ${ltr(a.days)} ימים מאז שניתנו, בין אם אתה במערכת ובין אם לא, אז שהייה מחוצה לה אותו זמן מנקה אותם בדיוק כפי שהיה לכולם.`),
      ].join('\n'),

    confirmLeaveYes: 'כן, עזוב',
    confirmLeaveCancel: 'ביטול',

    leftMsg: (a: { days: number }) =>
      [
        rtlLine('סיום. אתה כעת מחוץ למערכת המעמד.'),
        '',
        rtlLine('כל דירוג שנוגע בך הפסיק לספור, ואין לך מעמד. אף אחד לא יכול לדרג אותך ואתה לא יכול לדרג אף אחד. יש לך גישה לערוצים הפתוחים ותוכל להצטרף שוב בכל עת.'),
        '',
        rtlLine(`אם תחזור, כל דירוג שטרם פג יחזור לתוקף ממקום שהפסיק. הוא פוג מעצמו ${ltr(a.days)} ימים לאחר שניתן, בין אם אתה במערכת ובין אם לא — אז שהייה מחוצה לה אותו זמן כן מנקה אותם, בדיוק כמו כולם.`),
      ].join('\n'),

    joinedMsg: (a: { area: string }) =>
      [
        rtlLine(`חזרת, ב-**${a.area}**.`),
        '',
        rtlLine('אתה יכול כעת לדרג שחקנים אחרים, ושחקנים אחרים יכולים לדרג אותך. תוכל לעזוב שוב בכל עת.'),
      ].join('\n'),

    removedByAdmin: (a: { king: string }) =>
      rtlLine(`הוסרת ממערכת המעמד על ידי מנהל, ולכן אינך יכול להצטרף מחדש בעצמך. פנה לתפקיד ${a.king} אם לדעתך זה צריך להשתנות.`),
  },

  review: {
    requestSent: [
      rtlLine('**הבקשה שלך נשלחה למנהלים.**'),
      '',
      rtlLine('הדירוג שלך יבחן. אם יתקבל, תראה את השינוי תוך 24 שעות.'),
      rtlLine('אף אחד שדירג אותך לא פנה אליו, ולא נאמר לאף אחד שביקשת. תוכל לבקש שוב בעוד 7 ימים.'),
    ].join('\n'),
    alreadyOpen: rtlLine(
      'כבר יש לך בקשת סקירה פתוחה. המנהלים יסתכלו עליה — תוכל לנסות שוב לאחר שתיסגר.',
    ),
    cooldown: (a: { daysLeft: number }) =>
      rtlLine(`ביקשת סקירה לאחרונה. תוכל לבקש שוב בעוד ${ltr(a.daysLeft)} ימים.`),
    notParticipating: rtlLine('אתה מחוץ למערכת המעמד, אז אין מה לבדוק.'),

    kingTitle: 'שחקן ביקש סקירה',
    kingDesc: (a: { mention: string }) =>
      [
        `${ltr(a.mention)} רוצה שיסתכלו על הדירוג שלו.`,
        '',
        'הקל אם לדעתך הקהילה הייתה קשה, לחץ מטה אם לדעתך הייתה נדיבה, או בטל. אף אחד שדירג אותו לא פנה אליו, ולא הובטחה לו תשובה.',
      ].join('\n'),
    kingWhereTitle: 'איפה הם נמצאים',
    kingWhereArea: (a: { area: string }) => `אזור: **${a.area}**`,
    kingWhereScore: (a: { score: string }) => `ציון: **${ltr(a.score)}**`,
    kingWhereUnscored: 'ציון: **טרם ניתן**',
    kingWhereRaters: (a: { count: number }) => `מ-**${ltr(a.count)}** מדרגים`,
    kingAdjTitle: 'מה שינוי עושה',
    kingAdjBody: (a: { days: number }) =>
      [
        'מוסיף אותה כמות של אות, בעד או נגד.',
        'הציון ממשיך לרוץ מתחת.',
        `דועך לאחר ${ltr(a.days)} ימים.`,
      ].join('\n'),
    kingFooter: 'מדרגים בודדים לא מוצגים, בכוונה. לא לעשות כלום זו תשובה תקפה.',
    kingAlreadyAdjTitle: 'כבר מותאם',
    kingClosesTitle: 'נסגר מעצמו',
    kingAdjustPlaceholder: 'שנה את הציון שלהם',
    kingDismissBtn: 'בטל, ללא שינוי',
    kingClearBtn: 'בטל התאמות קיימות',

    adjVerbEase: 'הקל',
    adjVerbPush: 'לחץ מטה',
    adjLabel: (a: { verb: string; reports: number }) => `${a.verb} — שווה ${ltr(a.reports)} דוחות`,
    adjLandingMoved: (a: { area: string; score: string }) => `→ ${a.area} בציון ${ltr(a.score)}`,
    adjLandingStays: (a: { area: string; score: string }) => `נשאר ${a.area}, ${ltr(a.score)}`,
    adjNoteBlocked: (a: { reason: string }) => ` · לא עובר: ${a.reason}`,
    adjNoteUndo: (a: { count: number }) => ` · ${ltr(a.count)} דוחות לביטול`,
    adjNoteEaseMoved: ' · מחוץ להישג על ידי דוחות בלבד',

    settled: (a: { action: string }) => `**הוחלט:** ${a.action}`,
  },

  dm: {
    arrivalGreeting: rtlLine('**ברוך הבא — דבר אחד לדעת**'),
    arrivalBody: (a: { firstArea: string }) =>
      rtlLine(`לשרת הזה יש מערכת דירוג קהילתית לחוויית המשחק. חברי קבוצה מדרגים זה את זה בפרטיות, וזה קובע אילו ערוצים אתה רואה. אתה מתחיל ב-**${a.firstArea}**, יחד עם כולם.`),

    voiceGreeting: rtlLine('**מהשרת — יש משהו חדש:**'),
    voiceBody: (a: { firstArea: string }) =>
      rtlLine(`יש כעת מערכת דירוג קהילתית לחוויית המשחק. חברי קבוצה מדרגים זה את זה בפרטיות, וזה קובע אילו ערוצים אתה רואה. אתה מתחיל ב-**${a.firstArea}**, יחד עם כולם.`),

    noticeShort: rtlLine(
      'הגרסה הקצרה: דירוגים פרטיים, אף אחד לא רואה מי דירג מי או מה ניתן לאחרים, ואף ערוץ לא מכריז על מעמד של אף אחד. אתה יכול לדרג אחרים, לראות את המעמד שלך, לבקש סקירה מחדש אם לדעתך משהו לא צודק, או לעזוב את המערכת לחלוטין.',
    ),
    noticeHub: (a: { channel: string }) =>
      rtlLine(`הכל מוסבר ב-${ltr(a.channel)}, וכל מה שאתה עושה שם גלוי רק לך.`),
    noticeOptOut: (a: { channel: string; king: string }) =>
      rtlLine(`זו ההודעה היחידה שאשלח לך בנושא זה. אם אתה מעדיף לא להשתתף, יש כפתור ב-${ltr(a.channel)} לצאת, ותפקיד ${a.king} יכול לענות על שאלות.`),

    tierImproved: (a: { area: string }) => rtlLine(`המעמד הקהילתי שלך עלה ל-**${a.area}**.`),
    tierChanged: (a: { area: string }) => rtlLine(`המעמד הקהילתי שלך הוא כעת **${a.area}**.`),
    tierPreviously: (a: { area: string }) => rtlLine(`לפני כן: ${a.area}`),
    tierPrivate: rtlLine('זה פרטי, ודירוגים פוגים מעצמם עם הזמן.'),
    tierChallenge: rtlLine(
      'אם לדעתך זה שגוי, הרץ `/challenge` בשרת כדי לבקש מהמנהלים לבחון את הנושא מחדש. אף אחד שדירג אותך לא יפנה אליו, ולא יגידו לאף אחד שביקשת.',
    ),
  },

  maintenance: {
    notice: rtlLine(
      'מערכת המעמד מושהית כרגע לתחזוקה. שום דבר לא אבד — המעמד שלך וכל הדירוגים בדיוק כפי שהם, והכל יחזור בקרוב.',
    ),
  },

  guards: {
    guildOnly: 'זה עובד רק בתוך שרת.',
    kingOnly: (a: { king: string }) =>
      `רק תפקיד ${a.king} יכול לעשות זאת. (גם חברים עם Manage Server יכולים, כך שניתן תמיד לחלק מחדש את התפקיד.)`,
    wrongAdminChannel: (a: { channel: string }) =>
      `ניהול נעשה ב-${ltr(a.channel)}, הרחק מהחברים. הרץ זאת שם — רוב הפעולות הן כפתורים על הלוח הצמוד, אז ממש לא צריך פקודות.`,
    kingReviewOnly: (a: { king: string }) =>
      `רק תפקיד ${a.king} יכול להחליט על סקירה.`,
    requestMissing: 'לא נמצאה בקשת הסקירה.',
    requestClosed: 'הבקשה כבר סגורה.',
  },

  genericError: 'משהו השתבש אצלי. שום דבר לא נרשם — נסה שוב.',
  unknownCommand: 'פקודה לא מוכרת.',

  admin: {
    panelTitle: (a: { king: string }) => `# לוח בקרה — ${a.king}`,
    running: 'פועל כרגיל.',
    paused: '**מושהה** — ערוצים מוסתרים, פקודות חברים נדחות, כל הנתונים שלמים.',
    announceOn: (a: { ts: number; pending: number }) =>
      `פעיל מ-<t:${a.ts}:R>. ${ltr(a.pending)} עוד ממתינים לקבל הודעה.`,
    announceOff: (a: { pending: number }) =>
      `כבוי. ${ltr(a.pending)} חברים מעולם לא נאמר להם על המערכת.`,
    whereTitle: '**היכן כולם נמצאים**',
    tierCount: (a: { name: string; count: number }) => `${a.name} **${ltr(a.count)}**`,
    membersSummary: (a: { in: number; out: number; removed: number }) =>
      `${ltr(a.in)} משתתפים · ${ltr(a.out)} יצאו · ${ltr(a.removed)} הוסרו`,
    activityTitle: '**פעילות**',
    activityRatings: (a: { day: number; week: number }) =>
      `${ltr(a.day)} דירוג/ים ביום האחרון, ${ltr(a.week)} בשבוע האחרון.`,
    activityCurrent: (a: { ratings: number; raters: number }) =>
      `${ltr(a.ratings)} דירוג/ים סופרים כרגע, מ-${ltr(a.raters)} מדרגים.`,
    announceTitle: '**הכרזה**',
    needsLookTitle: '**דורש תשומת לב**',
    reviewsPending: (a: { count: number }) =>
      `**${ltr(a.count)} בקשת/בקשות סקירה ממתינות להחלטתך.**`,
    reviewsOpen: (a: { count: number }) =>
      `${ltr(a.count)} בקשת/בקשות סקירה עוד בתהליך.`,
    adjustedMembers: (a: { count: number }) =>
      `${ltr(a.count)} חבר/חברים עם התאמה פעילה.`,
    panelFooter: (a: { logChannel: string | null }) =>
      [
        '-# ספירות בלבד — שום דבר כאן לא מזהה אף אחד, בכוונה.',
        'מדויק נכון לרענון האחרון.',
        a.logChannel ? `היסטוריית פעולות נמצאת ב-<#${a.logChannel}>.` : null,
      ]
        .filter(Boolean)
        .join(' '),

    refreshBtn: 'רענן',
    recalcBtn: 'חשב מחדש הכל',
    adjustBtn: 'שנה ציון חבר',
    undoBtn: 'בטל התאמה',
    removeBtn: 'הסר חבר',
    reinstateBtn: 'החזר חבר',
    pauseBtn: 'השהה לתחזוקה',
    resumeBtn: 'חדש את המערכת',
    announceOnBtn: 'הודע לחברים',
    announceOffBtn: 'הפסק הכרזה',
    refreshHubBtn: 'פרסם מחדש את המדריך',
    languageBtn: 'Language / שפה',

    pickerAdjust: 'על ציון מי תרצה להשפיע?',
    pickerUndo: 'את ההתאמות של מי תרצה לבטל?',
    pickerRemove: 'את מי תרצה להסיר מהמערכת?',
    pickerReinstate: 'את מי תרצה להחזיר?',
    pickerChoose: 'בחר חבר',

    pickerWarnAdjust:
      'אתה מוסיף אות, לא קובע אזור. ציון הקהילה ממשיך לרוץ, כך שמספיק אנשים יכולים עדיין לבטל זאת — המסך הבא יגיד לך בדיוק כמה.',
    pickerWarnUndo:
      'כל מה שניתן להם מבוטל והציון חוזר להיות של הקהילה בלבד.',
    pickerWarnRemove:
      'הם עוזבים את המערכת ולא יכולים להצטרף בעצמם. הדירוגים מושהים, לא נמחקים, אז החזרתם מחזירה הכל.',
    pickerWarnReinstate:
      'זה רק מסיר את החסימה. הם עדיין מחוץ למערכת עד שיבחרו להצטרף, והדירוגים המושהים יחזרו אז.',

    adjPickerTitle: (a: { mention: string }) => `**כמה להשפיע על ציון ${ltr(a.mention)}?**`,
    adjPickerCurrent: (a: { area: string; score: string }) =>
      `הם נמצאים ב-**${a.area}** עם ציון **${ltr(a.score)}** כרגע.`,
    adjPickerUnit: (a: { days: number }) =>
      `שווה דוח אחד הוא דירוג סינתטי אחד, משוקלל כמו חבר מלא. הוא דועך תוך ${ltr(a.days)} ימים והדירוגים האמיתיים ממשיכים כל הזמן.`,
    adjPickerLive: '**פעיל כבר**',
    adjPickerPlaceholder: 'בחר כיוון וגודל',
    adjClearOption: 'בטל כל התאמה עליהם',
    adjClearDesc: 'חזרה לציון הקהילה בלבד',

    recalcDone: (a: { count: number }) =>
      `חושב מחדש ${ltr(a.count)} מעמד/ות לפי ערכי הכוונון הנוכחיים.`,
    refreshDone: 'רוענן.',
    refreshHubDone: (a: { channel: string }) =>
      `פורסמו מחדש ההסבר והכפתורים ב-<#${a.channel}>.`,
    refreshHubMissing: 'לא מצאתי את הערוץ הציבורי. הרץ `/standing-setup` במקום.',

    distribution: (a: { lines: string }) =>
      ['**היכן השרת נמצא כעת**', a.lines, '', 'ספירות בלבד. אין פקודה, לאף אחד, שמפרטת אילו חברים נמצאים היכן.'].join('\n'),

    adjustApplied: (a: { mention: string; area: string; score: string; from: string; undo: string; blocked: string; days: number; reports: number; moved: boolean }) =>
      [
        `${ltr(a.mention)} נמצא כעת ב-**${a.area}** בציון **${ltr(a.score)}**, לעומת ${ltr(a.from)}.${a.undo}${a.blocked}`,
        '',
        rtlLine(`ההתאמה שווה ${ltr(a.reports)} דוחות של אות, לא מיקום: כל דירוג אמיתי עדיין סופר, וזה דועך תוך ${ltr(a.days)} ימים. ${a.moved ? 'הם נאמר להם שהאזור שלהם השתנה, בפרטיות, ללא סיבה וללא ציון שמות.' : 'האזור שלהם לא השתנה, אז לא נאמר להם כלום.'}`),
      ].join('\n'),
    adjustUndoStr: (a: { count: number }) =>
      `\n\nיידרשו **${ltr(a.count)}** דוחות חדשים בראש הסולם כדי להחזיר אותם לאיפה שהיו — הקהילה יכולה לבטל זאת, היא לא חייבת לחכות.`,
    adjustBlockedStr: (a: { reason: string }) =>
      `\n\n**האזור שלהם לא השתנה, ולא ישתנה רק בגלל זה:** ${a.reason}. התאמות מזיזות את הציון, לא את ספירת האנשים או שיעור ההסכמה, אז לחץ לא יכול למקם מישהו שהקהילה לא דירגה באמת. הציון נרשם ויכנס לתוקף כשיספיק אנשים אמיתיים יצביעו.`,

    adjustCleared: (a: { mention: string; count: number }) =>
      `בוטלו ${ltr(a.count)} התאמות. ${ltr(a.mention)} נמצא על ציון הקהילה בלבד.`,
    adjustClearedNone: (a: { mention: string }) =>
      `${ltr(a.mention)} לא נושא שום התאמות.`,
    adjustNotParticipating: (a: { mention: string }) =>
      `${ltr(a.mention)} מחוץ למערכת המעמד, אז אין ציון להשפיע עליו. החזר אותם, או בקש מהם להצטרף, תחילה.`,
    adjustBadDirection: 'זה לא אחד מהכיוונים.',

    removeDone: (a: { mention: string }) =>
      [
        `${ltr(a.mention)} מחוץ למערכת המעמד ולא יכול להצטרף בעצמו.`,
        '',
        'כל דירוג שנוגע בהם מושהה ולא נמחק, אז `/standing-admin reinstate` מחזיר הכל כפי שהיה.',
      ].join('\n'),

    reinstateDone: (a: { mention: string }) =>
      `${ltr(a.mention)} יכול להצטרף שוב בכל עת. הם עדיין מחוץ למערכת עד שיבחרו ללחוץ הצטרף, ודירוגים מושהים יחזרו אז.`,

    pauseDone: (a: { hidden: string; failures: string | null }) =>
      [
        '**מושהה.**',
        a.hidden || 'לא היה צורך להסתיר שום דבר.',
        a.failures,
        '',
        'כל דירוג, מעמד ובקשת סקירה פתוחה שלמים, ופקודות חברים מציינות עכשיו שהמערכת בתחזוקה. ערוץ זה נשאר גלוי כדי שתוכל להריץ `/standing-admin resume`.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    resumeDone: (a: { count: number }) =>
      [
        '**חזרנו.**',
        `הערוצים שוב גלויים ו-${ltr(a.count)} חברים נבדקו מחדש לפי המעמד שלהם.`,
        '',
        'המעמדות בדיוק כפי שהיו לפני ההשהיה. כל מה שנמחק במהלך ההשבתה נבנה מחדש, וההסבר הצמוד פורסם מחדש.',
      ].join('\n'),

    resumeError: (a: { error: string }) => `לא ניתן לחדש: ${a.error}`,

    noticeStatus: (a: { ts: number; pending: number }) =>
      [
        `**פעיל** מ-<t:${a.ts}:F>.`,
        `${ltr(a.pending)} חברים עדיין ממתינים לקבל הודעה, ויקבלו אותה בהצטרפות הבאה לוויס.`,
        '',
        'כל מי שה-DM שלו סגור מנוסה שוב למחרת ולא נמחק, אז המספר עלול לרדת לאט.',
      ].join('\n'),
    noticeStatusOff: (a: { pending: number }) =>
      `**כבוי.** אף אחד לא מקבל הודעה. ${ltr(a.pending)} חברים מעולם לא קיבלו הודעה.`,
    noticeOff:
      'כבוי. אף אחד אחר לא יקבל הודעה, וכל מי שכבר קיבל — קיבל, אז הדלקה מחדש לא תשלח לאף אחד פעמיים.',
    noticeOn: (a: { pending: number; skipped: number }) =>
      [
        '**פעיל.**',
        `${ltr(a.pending)} חברים יקבלו כל אחד DM פרטי אחד, בפעם הראשונה שיצטרפו לערוץ קול מעכשיו.`,
        a.skipped > 0
          ? `${ltr(a.skipped)} חברים דולגו כי כבר דירגו מישהו או כבר בחרו לצאת — הם יודעים שהמערכת קיימת.`
          : null,
        '',
        'אף אחד לא מקבל הודעה פעמיים, כולל אחרי הפעלות מחדש ופריסות. אף אחד לא מקבל הודעה על הצטרפות לערוץ AFK, ואף אחד לא מקבל הודעה כשהמערכת מושהית.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    languageSwitched: (a: { label: string }) =>
      `שפה שונתה ל-**${a.label}**. ההודעות הצמודות עודכנו.`,
  },

  setup: {
    done: '**ההגדרה הושלמה.**',
    createdRoles: (a: { names: string }) => `תפקידים שנוצרו: ${a.names}`,
    createdChannels: (a: { names: string }) => `ערוצים שנוצרו: ${a.names}`,
    reused: (a: { count: number }) => `נעשה שימוש קיים: ${ltr(a.count)} פריטים.`,
    initialised: (a: { count: number }) => `ניתן תפקיד התחלתי ל-${ltr(a.count)} חברים.`,
    ratingChannel: (a: { channel: string }) =>
      `חברים קוראים את הכללים ומדרגים זה את זה ב-${ltr(a.channel)}.`,
    existing:
      'ערוצים שכבר היו קיימים נשארו בדיוק כפי שהיו — ללא העברת קטגוריה, ללא שינוי הרשאות.',
    roleOrder: (a: { roles: string }) =>
      `ודא שהתפקיד שלי נמצא **מעל** ${a.roles} ב-Server Settings → Roles, אחרת לא אוכל להקצות אותם.`,
    error: (a: { message: string }) =>
      `ההגדרה נכשלה: ${a.message}\n\nבדוק שיש לי Manage Roles ו-Manage Channels.`,
  },

  revert: {
    confirmTitle: (a: { guild: string }) => `לבטל את כל מערכת המעמד ב-${a.guild}?`,
    confirmDesc:
      'כל מה שהבוט יצר מפורט למטה. כל דירוג, מעמד ובקשת סקירה פתוחה יימחקו. לא ניתן לבטל זאת.',
    toDeleteRoles: (a: { count: number }) => `תפקידים למחיקה (${ltr(a.count)})`,
    toDeleteChannels: (a: { count: number }) => `ערוצים למחיקה (${ltr(a.count)})`,
    toRestoreChannels: (a: { count: number }) => `ערוצים לשחזור (${ltr(a.count)})`,
    toRestoreDesc:
      'אלה היו בשרת לפני הגעת הבוט, ולכן הם שומרים את ההודעות שלהם וחוזרים לקטגוריה ולהרשאות המקוריות.',
    toEmptyRoles: (a: { count: number }) => `תפקידים שנשמרים אך מתרוקנים (${ltr(a.count)})`,
    toEmptyRolesDesc:
      'אלה היו בשרת לפני הגעת הבוט. התפקיד נשמר, אבל יוסר מכל חבר, כי הבוט הוא שהכניס אותם.',
    toLeaveRoles: (a: { count: number }) => `תפקידים שנשארים ללא שינוי (${ltr(a.count)})`,
    toLeaveRolesDesc:
      'הבוט רק קרא אותם כדי להחליט מי יכול להריץ פקודות — הוא מעולם לא חילק אותם. חברים, הרשאות ושם נשארים בדיוק כפי שהם.',
    unrecorded: (a: { count: number }) => `גם הותאמו לפי שם — אין רשומה (${ltr(a.count)})`,
    unrecordedDesc:
      'רישום מקור חסר. אלה מתאימים לשמות המוגדרים אך לא נרשמו על ידי הבוט הזה, ולכן התוכנית מתייחסת אליהם כאל פריט שנוצר לאחרונה.',
    nothingToDo:
      'אין שום רישום עבור שרת זה. הבוט לא הגדיר כאן מעולם, או שכבר בוצעה חזרה.',
    confirmBtn: 'כן, בטל הכל',
    cancelBtn: 'ביטול',

    deleted: (a: { roles: string }) => `תפקידים שנמחקו: ${a.roles}`,
    deletedChannels: (a: { channels: string }) => `ערוצים שנמחקו: ${a.channels}`,
    restored: (a: { channels: string }) => `שוחזר ${a.channels} להגדרה המקורית.`,
    released: (a: { roles: string }) => `השאיר ${a.roles} במקום אך הסיר מכל החברים.`,
    untouched: (a: { roles: string }) => `לא נגע ב-${a.roles} בכלל — חברים והרשאות שלמים.`,
    cleared: (a: { count: number }) => `נמחקו ${ltr(a.count)} שורות מסד נתונים. אין דירוגים או מעמדות.`,
    failures: (a: { items: string }) => `לא ניתן היה להשלים: ${a.items}`,
    inProgress: '⏳ עובד על זה…',
    cancelled: 'בוטל. לא שום דבר לא שונה.',
  },

  log: {
    ratingCreatedFull: (a: { actor: string; target: string; value: number }) =>
      `${ltr(a.actor)} דירג את ${ltr(a.target)} **${ltr(a.value)}**`,
    ratingCreatedRedacted: (a: { actor: string }) =>
      `${ltr(a.actor)} הגיש דירוג`,
    ratingUpdatedFull: (a: { actor: string; target: string; value: number }) =>
      `${ltr(a.actor)} שינה דירוג של ${ltr(a.target)} ל-**${ltr(a.value)}**`,
    ratingUpdatedRedacted: (a: { actor: string }) =>
      `${ltr(a.actor)} שינה דירוג שנתן`,
    optIn: (a: { actor: string }) =>
      `${ltr(a.actor)} הצטרף למערכת המעמד; דירוגים מושהים חודשו`,
    optOut: (a: { actor: string }) =>
      `${ltr(a.actor)} עזב את מערכת המעמד; דירוגים שנוגעים בהם מושהים`,
    challengeOpened: (a: { actor: string; invited: number }) =>
      `${ltr(a.actor)} פתח סקירה מחדש, ${ltr(a.invited)} מדרגים נשאלו`,
    challengeRerated: (a: { actor: string }) =>
      `${ltr(a.actor)} דירג מחדש שחקן בסקירה`,
    challengeKept: (a: { actor: string }) =>
      `${ltr(a.actor)} שמר על הדירוג הקיים בסקירה`,
    tierChange: (a: { subject: string; from: string; to: string }) =>
      `${ltr(a.subject)} עבר **${a.from} → ${a.to}**`,
    admin: (a: { actor: string; summary: string }) =>
      `${ltr(a.actor)} ${a.summary}`,
  },

  commandDescs: {
    rate: 'דרג בפרטיות את השחקנים שמשחקת איתם',
    myStanding: 'ראה את המעמד שלך בלבד. רק אתה רואה את התשובה.',
    challenge: 'בקש מאלה שדירגו אותך לבדוק שוב',
    participation: 'הצטרף לתוכנית המעמד הקהילתי או עזוב אותה',
    standingSetup: 'צור או תקן את התפקידים, הקטגוריות וההרשאות הנדרשות',
    standingSetupLanguage: 'שפה לכל ההודעות וממשק המשתמש (ברירת מחדל: אנגלית)',
    standingSetupLanguageEn: 'English',
    standingSetupLanguageHe: 'עברית (Hebrew)',
    standingRevert: 'בטל כל מה שהבוט יצר ומחק את כל הנתונים שלו לשרת זה',
    standingRevertInclude: 'מחק גם תפקידים וערוצים המתאימים להגדרות שלי שאין לי רשומה שיצרתי',
    standingAdmin: 'כלי תחזוקה',
    adminRecalculate: 'חשב מחדש כל מעמד, לדוגמה לאחר שינוי ערכי הכוונון',
    adminDistribution: 'כמה חברים נמצאים בכל אזור. ספירות בלבד, ללא שמות.',
    adminAdjust: 'השפע על ציון חבר מבלי להשתלט עליו',
    adminAdjustUser: 'מי להתאים',
    adminAdjustDirection: 'לאיזה כיוון להתכופף, או לבטל מה שיש כבר',
    adminAdjustEase: 'הקל — טען שהקהילה הייתה קשה',
    adminAdjustPush: 'לחץ מטה — טען שהקהילה הייתה נדיבה',
    adminAdjustUndo: 'בטל — קח בחזרה כל התאמה עליהם',
    adminAdjustReports: (a: { def: number }) =>
      `כמה שווה דוחות. ברירת מחדל ${ltr(a.def)}. מוזנח בביטול.`,
    adminRemove: 'הסר חבר מהמערכת. לא יוכל להצטרף בעצמו.',
    adminRemoveUser: 'מי להסיר',
    adminReinstate: 'בטל הסרה, ואפשר לחבר לבחור להצטרף שוב',
    adminReinstateUser: 'מי להחזיר',
    adminPause: 'הסתר את המערכת לתחזוקה. שומר כל דירוג ומעמד.',
    adminResume: 'החזר את המערכת לאחר השהיה',
    adminRefreshHub: 'פרסם מחדש את ההסבר הצמוד והכפתורים בערוץ הציבורי',
    adminNotice: 'ה-DM החד-פעמי שמספר לכל חבר על קיום המערכת',
    adminNoticeAction: 'הפעל, כבה, או ראה עד כמה הגענו',
    adminNoticeOn: 'on — התחל לספר לאנשים בהצטרפות הראשונה לוויס',
    adminNoticeOff: 'off — הפסק לספר לחברים חדשים',
    adminNoticeStatus: 'status — כמה עוד צריכים לשמוע',
  },
} as const satisfies Strings;
