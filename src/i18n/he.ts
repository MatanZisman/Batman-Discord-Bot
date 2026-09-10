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

  systemName: 'מערכת דירוג קהילתית',
  ratingPromptTitle: 'איך הייתה חוויית המשחק המשותפת?',
  scale: [
    { value: 1, label: 'אחלה חבר לקבוצה', description: 'חיובי, רגוע ומתקשר טוב' },
    { value: 2, label: 'סבבה', description: 'אין משהו מיוחד לציין' },
    { value: 3, label: 'ככה ככה', description: 'לפעמים לא נעים לשחק איתו' },
    { value: 4, label: 'לא פשוט', description: 'מפריע למשחק לעיתים קרובות' },
    { value: 5, label: 'ממש קשה', description: 'הורס את המשחק באופן קבוע' },
  ],

  hub: {
    description: (a: { firstArea: string }) =>
      [
        rtlLine('בשרת הזה יש מערכת דירוג קהילתית שמחלקת את ערוצי המשחק לאזורים לפי חוויית המשחק המשותפת. חברי הקבוצה שלך קובעים אילו אזורים תראה, לא מנהל — כדי שלכולם יהיה נעים יותר לשחק יחד.'),
        '',
        rtlLine(`**כולם מתחילים ב-${a.firstArea}, עם דף חלק.**`),
      ].join('\n'),

    areasTitle: '① האזורים',
    areasArea: (a: { name: string; canSee: string }) =>
      rtlLine(`**${a.name}** — גישה אל ${a.canSee}`),
    areasChannels: (a: { roomLines: string }) =>
      rtlLine(`בכל אזור יש ערוצים משלו: ${a.roomLines}.`),
    areasNote: rtlLine(
      'אזור נקי יותר נותן גישה ל-*יותר* מהשרת, לא לפחות. כל ערוץ שהיה קיים לפני הוספת המערכת נשאר פתוח לכולם בדיוק כמו קודם.',
    ),

    ratingTitle: '② איך מדרגים',
    ratingInstructions: rtlLine(
      'לוחצים למטה על **דרג שחקן**, בוחרים שחקן ומספר, ואז אפשר לבחור אם לדרג מישהו נוסף. זה הכול.',
    ),

    effectTitle: '③ מה הדירוג עושה',
    effectPoints: [
      rtlLine('• **כל אחד יכול לתת לכל שחקן דירוג אחד בלבד.** אפשר לשנות אותו אחר כך, אבל אי אפשר לצבור כמה דירוגים על אותו שחקן.'),
      rtlLine('• **דירוגים משחקנים עם דירוג קהילתי טוב משפיעים יותר.** קבוצה שנמצאת באזור נמוך יותר לא יכולה להתאגד נגד מישהו ולהכריע לבד.'),
      rtlLine('• **דירוג אחד כמעט לא מזיז כלום.** גם שניים לא. מעבר בין אזורים דורש קבוצה אמיתית של אנשים שבגדול מסכימים זה עם זה.'),
      (a: { days: number }) =>
        rtlLine(`• **דירוגים פגים אוטומטית אחרי ${ltr(a.days)} ימים.** שום דבר לא רודף אחריך לנצח, ולא צריך לחכות שמישהו יסלח — הדירוג פשוט פג.`),
      rtlLine('• **לחשבונות חדשים יש השפעה קטנה מאוד**, כך שאי אפשר להטות תוצאה בעזרת חשבונות פיקטיביים.'),
    ] as const,

    privacyTitle: '④ הפרטיות שלך — חשוב לקרוא',
    privacyPoints: [
      rtlLine('• **כל מה שאתה עושה כאן גלוי רק לך.** בחירת השחקן, הדירוג והאישור — הכול פרטי ולא מופיע בערוץ.'),
      rtlLine('• **אף פעם לא מגלים לך מי דירג אותך**, וגם לא לאף אחד אחר. אין פקודה, לא לחברים ולא לצוות, שמציגה דירוג של אדם אחר או מי דירג את מי.'),
      rtlLine('• **אין הכרזות.** אם האזור שלך משתנה, רק אתה מקבל על כך הודעה פרטית.'),
      rtlLine('• **אין תוויות מביישות.** התפקידים נקראים על שם צבעים. אין תפקיד בשם "רעיל", התפקידים מוסתרים מרשימת החברים ואי אפשר לתייג אותם.'),
    ],

    reviewTitle: '⑤ אם הדירוג שלך לא נראה הוגן',
    reviewBody: (a: { days: number; king: string }) =>
      [
        rtlLine(`אפשר ללחוץ על **בקש בדיקה מחדש** פעם אחת בכל ${ltr(a.days)} ימים. הפעולה שולחת לבעלי התפקיד ${a.king} בקשה קצרה לבדוק את הדירוג שלך.`),
        rtlLine(`**לא פונים לאף אחד שדירג אותך**, ולא מספרים לאף אחד שביקשת בדיקה. בעלי התפקיד ${a.king} יכולים לשנות את הדירוג או להשאיר אותו כפי שהוא. לא תישלח תשובה, אבל אם הבקשה תתקבל, האזור שלך ישתנה בתוך יום.`),
      ].join('\n'),

    optOutTitle: '⑥ יציאה מהמערכת',
    optOutBody: (a: { days: number }) =>
      [
        rtlLine('לוחצים על **השתתפות** כדי לצאת מהמערכת לגמרי. כל הדירוגים שנתת או קיבלת מפסיקים להשפיע, אין לך דירוג קהילתי, ואף אחד לא יכול לדרג אותך וגם אתה לא יכול לדרג אחרים. כל ערוץ שהיה קיים לפני המערכת נשאר פתוח בפניך, ואפשר לחזור מתי שרוצים.'),
        '',
        rtlLine(`יציאה מהמערכת היא לא קיצור דרך לדף חלק: אם תחזור, דירוגים שעדיין לא פגו יחזרו להשפיע. בכל מקרה הם פגים ${ltr(a.days)} ימים אחרי שניתנו, כך שהזמן מנקה את הדף של כולם באותם תנאים.`),
      ].join('\n'),

    footer: 'אף אחד אחר בשרת לא רואה על מה לחצת כאן.',

    btnRate: 'דרג שחקן',
    btnMyStanding: 'הדירוג שלי',
    btnReview: 'בקש בדיקה מחדש',
    btnParticipation: 'השתתפות',

    roomText: (a: { count: number }) => (a.count > 1 ? `${ltr(a.count)} × ערוץ טקסט` : 'ערוץ טקסט'),
    roomVoice: (a: { name: string; cap: string; count: number }) =>
      (a.count > 1 ? `${ltr(a.count)} × ` : '') + `ערוץ קולי \`${a.name}\` (${a.cap})`,
    roomCapNone: 'ללא הגבלה',
    roomCapUp: (a: { n: number }) => `עד ${ltr(a.n)}`,
  },

  rating: {
    notParticipating: rtlLine(
      'אתה כרגע מחוץ למערכת הדירוג, ולכן אי אפשר לדרג שחקנים אחרים. אפשר להצטרף מחדש למטה — ואז גם אחרים יוכלו לדרג אותך.',
    ),
    who: rtlLine('**את מי תרצה לדרג?**'),
    pickerPlaceholder: 'בחר שחקן',
    sessionNotes: (a: { ratedSoFar: number; remaining: number; timeout: number }) => {
      const parts: string[] = [];
      if (a.ratedSoFar > 0) parts.push(rtlLine(`דירגת בסבב הזה: ${ltr(a.ratedSoFar)}.`));
      parts.push(rtlLine(`נשארו לך היום עוד ${ltr(a.remaining)} דירוגים חדשים.`));
      parts.push(rtlLine(`המסך יפסיק להגיב אחרי ${ltr(a.timeout)} דקות.`));
      return parts.join(' ');
    },
    finishBtn: 'סיום',

    scalePlaceholderNew: 'בחר דירוג',
    scalePlaceholderExisting: (a: { value: number }) => `כרגע ${ltr(a.value)} — בחר דירוג חדש`,
    scaleHeaderNew: (a: { mention: string }) => rtlLine(`עכשיו מדרגים את ${ltr(a.mention)}.`),
    scaleHeaderExisting: (a: { mention: string; value: number }) =>
      rtlLine(`הדירוג הנוכחי שנתת ל-${ltr(a.mention)} הוא **${ltr(a.value)}**. אפשר לבחור דירוג אחר למטה או להשאיר אותו כמו שהוא.`),
    pickSomeoneElseBtn: 'בחר מישהו אחר',

    savedUpdated: (a: { mention: string; value: number; label: string }) =>
      rtlLine(`הדירוג שנתת ל-${ltr(a.mention)} עודכן ל-**${ltr(a.value)} · ${a.label}**.`),
    savedNew: (a: { mention: string; value: number; label: string }) =>
      rtlLine(`הדירוג שנתת ל-${ltr(a.mention)} נשמר: **${ltr(a.value)} · ${a.label}**.`),
    savedPrompt: rtlLine('רוצה לדרג שחקן נוסף?'),
    rateAnotherBtn: 'דרג עוד שחקן',
    doneBtn: 'לא, זה הכול',

    closedWithRatings: (a: { count: number }) =>
      rtlLine(`תודה, שמרתי ${ltr(a.count)} דירוגים. הם נשארים פרטיים ויפגו אוטומטית.`),
    closedNone: rtlLine('לא נשמרו דירוגים. אפשר לחזור מתי שרוצים.'),

    errorSelf: rtlLine('אי אפשר לדרג את עצמך.'),
    errorNotMember: rtlLine('השחקן הזה לא נמצא בשרת.'),
    errorBot: rtlLine('בוטים לא משתתפים במערכת הדירוג.'),
    errorOptedOut: rtlLine('השחקן הזה בחר לא להשתתף במערכת הדירוג, ולכן אי אפשר לדרג אותו.'),
    errorBadRating: rtlLine('לא הצלחתי לקרוא את הדירוג הזה.'),
    errorDailyCap: (a: { cap: number }) =>
      rtlLine(`ניצלת את כל ${ltr(a.cap)} הדירוגים החדשים להיום. המגבלה מונעת מקבוצה להוריד למישהו את הדירוג בערב אחד. אפשר לחזור מחר.`),
    cooldownMsg: (a: { minutesLeft: number }) =>
      rtlLine(`שינית את הדירוג הזה לאחרונה. אפשר לשנות אותו שוב בעוד ${ltr(a.minutesLeft)} דקות.`),

    wrongChannel: (a: { channel: string }) =>
      rtlLine(`מדרגים ב-${ltr(a.channel)}. כל מה שקורה שם גלוי רק לך.`),
  },

  standing: {
    notParticipating: rtlLine(
      'אתה מחוץ למערכת הדירוג. אין לך דירוג קהילתי או דירוגים פעילים, ויש לך גישה רק לערוצים הפתוחים.',
    ),
    header: (a: { area: string }) => rtlLine(`**הדירוג הקהילתי שלך — ${a.area}**`),
    who: rtlLine('זהות המדרגים לא נשמרת בצורה שאפשר לחפש או לבדוק — לא על ידך ולא על ידי אף אחד אחר.'),
    explainTier: (a: { area: string }) => rtlLine(`אזור: ${a.area}`),
    explainScore: (a: { score: string; max: number }) =>
      rtlLine(`ציון: ${ltr(a.score)} / ${ltr(a.max)} (נמוך יותר = טוב יותר)`),
    explainRaters: (a: { count: number; trust: string }) =>
      rtlLine(`מספר הדירוגים הפעילים: ${ltr(a.count)} (רמת אמון משולבת: ${ltr(a.trust)})`),
    explainDistance: (a: { area: string; gates: string }) =>
      rtlLine(`המרחק מ-${a.area}: ${a.gates}`),
    explainExpired: (a: { count: number }) =>
      rtlLine(`מספר הדירוגים הישנים שפגו וכבר לא משפיעים: ${ltr(a.count)}.`),
  },

  participation: {
    leaveBtn: 'צא ממערכת הדירוג',
    joinBtn: 'הצטרף למערכת הדירוג',

    statusIn: (a: { areas: string }) =>
      [
        rtlLine('**אתה משתתף במערכת הדירוג.**'),
        '',
        rtlLine(`אפשר לדרג שחקנים אחרים, אחרים יכולים לדרג אותך, ויש לך גישה לאזורי ${a.areas} בהתאם לדירוג הקהילתי שלך.`),
      ].join('\n'),

    statusOut: (a: { areas: string }) =>
      [
        rtlLine('**אתה מחוץ למערכת הדירוג.**'),
        '',
        rtlLine(`אין לך דירוג קהילתי, ואף דירוג שנתת או קיבלת לא משפיע. אף אחד לא יכול לדרג אותך, גם אתה לא יכול לדרג אחרים, ויש לך גישה רק לערוצים שהיו בשרת לפני הוספת אזורי ${a.areas}.`),
      ].join('\n'),

    confirmLeaveTitle: rtlLine('**לצאת ממערכת הדירוג?**'),
    confirmLeaveBody: (a: { days: number }) =>
      [
        rtlLine('אם תצא:'),
        rtlLine('• כל דירוג שנתת או קיבלת יפסיק להשפיע מיד.'),
        rtlLine('• הגישה לאזורי הצבעים תוסר, אבל כל ערוץ שהיה בשרת קודם יישאר פתוח בפניך.'),
        rtlLine('• אף אחד לא יוכל לדרג אותך, וגם אתה לא תוכל לדרג אחרים.'),
        '',
        rtlLine(`אם תחזור, דירוגים שעדיין לא פגו יחזרו להשפיע — היציאה לא מוחקת אותם. הם פגים אוטומטית ${ltr(a.days)} ימים אחרי שניתנו, בין אם אתה במערכת ובין אם לא. לכן, אחרי פרק הזמן הזה הם ייעלמו בדיוק כמו אצל כולם.`),
      ].join('\n'),

    confirmLeaveYes: 'כן, צא',
    confirmLeaveCancel: 'ביטול',

    leftMsg: (a: { days: number }) =>
      [
        rtlLine('יצאת ממערכת הדירוג.'),
        '',
        rtlLine('כל דירוג שנתת או קיבלת הפסיק להשפיע, ואין לך דירוג קהילתי. אף אחד לא יכול לדרג אותך, וגם אתה לא יכול לדרג אחרים. הערוצים הפתוחים נשארו זמינים, ואפשר להצטרף שוב בכל שלב.'),
        '',
        rtlLine(`אם תחזור, כל דירוג שעדיין לא פג יחזור להשפיע. דירוגים פגים אוטומטית ${ltr(a.days)} ימים אחרי שניתנו, גם בזמן שאתה מחוץ למערכת — כך שאחרי פרק הזמן הזה הם אכן נעלמים, בדיוק כמו אצל כולם.`),
      ].join('\n'),

    joinedMsg: (a: { area: string }) =>
      [
        rtlLine(`חזרת למערכת, באזור **${a.area}**.`),
        '',
        rtlLine('אפשר שוב לדרג שחקנים אחרים, וגם הם יכולים לדרג אותך. אפשר לצאת שוב בכל שלב.'),
      ].join('\n'),

    removedByAdmin: (a: { king: string }) =>
      rtlLine(`מנהל הסיר אותך ממערכת הדירוג, ולכן אי אפשר להצטרף אליה מחדש לבד. אם לדעתך צריך לשנות את זה, אפשר לפנות לתפקיד ${a.king}.`),
  },

  review: {
    requestSent: [
      rtlLine('**הבקשה שלך נשלחה לצוות.**'),
      '',
      rtlLine('הדירוג שלך ייבדק. אם הבקשה תתקבל, השינוי יופיע בתוך 24 שעות.'),
      rtlLine('לא פנינו לאף אחד שדירג אותך, ולא סיפרנו לאף אחד שביקשת בדיקה. אפשר לבקש שוב בעוד 7 ימים.'),
    ].join('\n'),
    alreadyOpen: rtlLine(
      'כבר יש לך בקשה פתוחה לבדיקה מחדש. הצוות יעבור עליה, ואפשר יהיה להגיש בקשה נוספת אחרי שהיא תיסגר.',
    ),
    cooldown: (a: { daysLeft: number }) =>
      rtlLine(`ביקשת בדיקה מחדש לאחרונה. אפשר לבקש שוב בעוד ${ltr(a.daysLeft)} ימים.`),
    notParticipating: rtlLine('אתה מחוץ למערכת הדירוג, אז אין כרגע מה לבדוק.'),

    kingTitle: 'שחקן ביקש בדיקה מחדש',
    kingDesc: (a: { mention: string }) =>
      [
        `${ltr(a.mention)} ביקש שהדירוג שלו ייבדק.`,
        '',
        'אם לדעתך הקהילה החמירה מדי, אפשר להקל בדירוג. אם היא הקלה מדי, אפשר להחמיר. אפשר גם לסגור בלי שינוי. לא פנינו לאף אחד שדירג את השחקן ולא הבטחנו לו תשובה.',
      ].join('\n'),
    kingWhereTitle: 'המצב הנוכחי',
    kingWhereArea: (a: { area: string }) => `אזור: **${a.area}**`,
    kingWhereScore: (a: { score: string }) => `ציון: **${ltr(a.score)}**`,
    kingWhereUnscored: 'ציון: **עדיין לא חושב**',
    kingWhereRaters: (a: { count: number }) => `מספר המדרגים: **${ltr(a.count)}**`,
    kingAdjTitle: 'איך ההתאמה משפיעה',
    kingAdjBody: (a: { days: number }) =>
      [
        'ההתאמה מוסיפה השפעה בעד או נגד, לפי מספר הדיווחים שנבחר.',
        'הדירוגים של הקהילה ממשיכים להשפיע במקביל.',
        `ההשפעה נחלשת ונעלמת בתוך ${ltr(a.days)} ימים.`,
      ].join('\n'),
    kingFooter: 'זהות המדרגים לא מוצגת, בכוונה. גם החלטה לא לשנות דבר היא החלטה לגיטימית.',
    kingAlreadyAdjTitle: 'התאמות פעילות',
    kingClosesTitle: 'נסגר אוטומטית',
    kingAdjustPlaceholder: 'בחר התאמה לציון',
    kingDismissBtn: 'סגור בלי שינוי',
    kingClearBtn: 'בטל את ההתאמות',

    adjVerbEase: 'הקל בדירוג',
    adjVerbPush: 'החמר בדירוג',
    adjLabel: (a: { verb: string; reports: number }) => `${a.verb} — שווה ערך ל-${ltr(a.reports)} דיווחים`,
    adjLandingMoved: (a: { area: string; score: string }) => `→ ${a.area} בציון ${ltr(a.score)}`,
    adjLandingStays: (a: { area: string; score: string }) => `נשאר ב-${a.area}, בציון ${ltr(a.score)}`,
    adjNoteBlocked: (a: { reason: string }) => ` · אין מעבר: ${a.reason}`,
    adjNoteUndo: (a: { count: number }) => ` · נדרשים ${ltr(a.count)} דיווחים כדי לבטל`,
    adjNoteEaseMoved: ' · דיווחים לבדם כבר לא יכולים לבטל',

    settled: (a: { action: string }) => `**הבקשה נסגרה:** ${a.action}`,
  },

  dm: {
    arrivalGreeting: rtlLine('**ברוך הבא — משהו קטן שכדאי לדעת**'),
    arrivalBody: (a: { firstArea: string }) =>
      rtlLine(`בשרת הזה פועלת מערכת דירוג קהילתית שנועדה לשפר את חוויית המשחק המשותפת. חברי הקבוצה מדרגים זה את זה בפרטיות, והדירוג קובע לאילו ערוצים יש גישה. כמו כולם, גם אתה מתחיל ב-**${a.firstArea}**.`),

    voiceGreeting: rtlLine('**עדכון קטן מהשרת:**'),
    voiceBody: (a: { firstArea: string }) =>
      rtlLine(`מעכשיו פועלת בשרת מערכת דירוג קהילתית שנועדה לשפר את חוויית המשחק המשותפת. חברי הקבוצה מדרגים זה את זה בפרטיות, והדירוג קובע לאילו ערוצים יש גישה. כמו כולם, גם אתה מתחיל ב-**${a.firstArea}**.`),

    noticeShort: rtlLine(
      'בקצרה: הדירוגים פרטיים. אף אחד לא רואה מי דירג את מי או איזה דירוג קיבלו אחרים, ובשום ערוץ לא מפרסמים דירוג של שחקן. אפשר לדרג אחרים, לראות רק את הדירוג שלך, לבקש בדיקה מחדש אם משהו נראה לא הוגן, או לצאת מהמערכת לגמרי.',
    ),
    noticeHub: (a: { channel: string }) =>
      rtlLine(`כל הפרטים נמצאים ב-${ltr(a.channel)}, וכל מה שעושים שם גלוי רק לך.`),
    noticeOptOut: (a: { channel: string; king: string }) =>
      rtlLine(`זו ההודעה היחידה שאשלח בנושא. אם אתה מעדיף לא להשתתף, אפשר לצאת דרך הכפתור ב-${ltr(a.channel)}. לשאלות אפשר לפנות לתפקיד ${a.king}.`),

    tierImproved: (a: { area: string }) => rtlLine(`הדירוג הקהילתי שלך השתפר ועברת ל-**${a.area}**.`),
    tierChanged: (a: { area: string }) => rtlLine(`הדירוג הקהילתי שלך השתנה ל-**${a.area}**.`),
    tierPreviously: (a: { area: string }) => rtlLine(`האזור הקודם: ${a.area}`),
    tierPrivate: rtlLine('ההודעה הזאת פרטית, והדירוגים פגים אוטומטית עם הזמן.'),
    tierChallenge: rtlLine(
      'אם לדעתך יש כאן טעות, אפשר להריץ `/challenge` בשרת ולבקש מהצוות לבדוק שוב. לא פונים לאף אחד שדירג אותך ולא מספרים לאף אחד שביקשת בדיקה.',
    ),
  },

  maintenance: {
    notice: rtlLine(
      'מערכת הדירוג מושבתת כרגע לצורך תחזוקה. שום דבר לא אבד — הדירוג הקהילתי שלך וכל הדירוגים נשמרו בדיוק כפי שהיו, והמערכת תחזור בקרוב.',
    ),
  },

  guards: {
    guildOnly: 'אפשר להשתמש בזה רק בתוך שרת.',
    kingOnly: (a: { king: string }) =>
      `רק בעלי התפקיד ${a.king} יכולים לבצע את הפעולה הזאת. גם מי שיש לו הרשאת Manage Server יכול, כדי שתמיד יהיה אפשר להקצות מחדש את התפקיד.`,
    wrongAdminChannel: (a: { channel: string }) =>
      `פעולות הניהול מתבצעות ב-${ltr(a.channel)}, מחוץ לעיני החברים. צריך להריץ את הפקודה שם. רוב הפעולות זמינות גם ככפתורים בלוח הבקרה המוצמד.`,
    kingReviewOnly: (a: { king: string }) =>
      `רק בעלי התפקיד ${a.king} יכולים להחליט לגבי בקשה לבדיקה מחדש.`,
    requestMissing: 'לא נמצאה הבקשה לבדיקה מחדש.',
    requestClosed: 'הבקשה כבר סגורה.',
  },

  genericError: 'משהו השתבש אצלי. שום דבר לא נשמר — נסה שוב בבקשה.',
  unknownCommand: 'פקודה לא מוכרת.',

  admin: {
    panelTitle: (a: { king: string }) => `# לוח בקרה — ${a.king}`,
    running: 'המערכת פועלת כרגיל.',
    paused: '**מושבתת** — הערוצים מוסתרים, פקודות החברים חסומות וכל הנתונים שמורים.',
    announceOn: (a: { ts: number; pending: number }) =>
      `פעיל מאז <t:${a.ts}:R>. נותרו ${ltr(a.pending)} חברים שעדיין לא קיבלו הודעה.`,
    announceOff: (a: { pending: number }) =>
      `כבוי. ${ltr(a.pending)} חברים עדיין לא קיבלו הודעה על המערכת.`,
    whereTitle: '**חלוקת החברים בין האזורים**',
    tierCount: (a: { name: string; count: number }) => `${a.name} **${ltr(a.count)}**`,
    membersSummary: (a: { in: number; out: number; removed: number }) =>
      `משתתפים: ${ltr(a.in)} · יצאו: ${ltr(a.out)} · הוסרו: ${ltr(a.removed)}`,
    activityTitle: '**פעילות**',
    activityRatings: (a: { day: number; week: number }) =>
      `דירוגים חדשים: ${ltr(a.day)} ביממה האחרונה, ${ltr(a.week)} בשבוע האחרון.`,
    activityCurrent: (a: { ratings: number; raters: number }) =>
      `דירוגים שמשפיעים כרגע: ${ltr(a.ratings)}, שניתנו על ידי ${ltr(a.raters)} מדרגים.`,
    announceTitle: '**הכרזה**',
    needsLookTitle: '**מחכה לטיפול**',
    reviewsPending: (a: { count: number }) =>
      `**מספר הבקשות לבדיקה שמחכות להחלטה: ${ltr(a.count)}.**`,
    reviewsOpen: (a: { count: number }) =>
      `בקשות בדיקה שעדיין אוספות תשובות: ${ltr(a.count)}.`,
    adjustedMembers: (a: { count: number }) =>
      `חברים עם התאמת מנהל פעילה: ${ltr(a.count)}.`,
    panelFooter: (a: { logChannel: string | null }) =>
      [
        '-# מוצגים כאן מספרים בלבד — אין שום פרט שמזהה חבר מסוים, בכוונה.',
        'הנתונים נכונים לרענון האחרון.',
        a.logChannel ? `היסטוריית הפעולות נמצאת ב-<#${a.logChannel}>.` : null,
      ]
        .filter(Boolean)
        .join(' '),

    refreshBtn: 'רענן',
    recalcBtn: 'חשב הכול מחדש',
    adjustBtn: 'התאם ציון',
    undoBtn: 'בטל התאמה',
    removeBtn: 'הסר חבר',
    reinstateBtn: 'החזר חבר',
    pauseBtn: 'השבת לתחזוקה',
    resumeBtn: 'הפעל מחדש',
    announceOnBtn: 'שלח הודעה לחברים',
    announceOffBtn: 'הפסק לשלוח הודעות',
    refreshHubBtn: 'פרסם מחדש את המדריך',
    languageBtn: 'Language / שפה',

    pickerAdjust: 'למי תרצה להתאים את הציון?',
    pickerUndo: 'אצל מי תרצה לבטל את ההתאמות?',
    pickerRemove: 'את מי תרצה להסיר מהמערכת?',
    pickerReinstate: 'למי תרצה לאפשר לחזור?',
    pickerChoose: 'בחר חבר',

    pickerWarnAdjust:
      'ההתאמה מוסיפה משקל לציון, אבל לא קובעת אזור. דירוגי הקהילה ממשיכים להשפיע, ולכן מספיק אנשים עדיין יכולים לגבור עליה. במסך הבא יופיע המספר המדויק.',
    pickerWarnUndo:
      'כל ההתאמות הפעילות יתבטלו, והציון יחזור להתבסס רק על דירוגי הקהילה.',
    pickerWarnRemove:
      'החבר ייצא מהמערכת ולא יוכל להצטרף שוב בעצמו. הדירוגים שנתן או קיבל יוקפאו ולא יימחקו, ואם יחזור למערכת הם ישובו להשפיע.',
    pickerWarnReinstate:
      'הפעולה רק מסירה את החסימה. החבר יישאר מחוץ למערכת עד שיבחר להצטרף, ורק אז הדירוגים המוקפאים יחזרו להשפיע.',

    adjPickerTitle: (a: { mention: string }) => `**בכמה להתאים את הציון של ${ltr(a.mention)}?**`,
    adjPickerCurrent: (a: { area: string; score: string }) =>
      `כרגע השחקן נמצא ב-**${a.area}** עם ציון **${ltr(a.score)}**.`,
    adjPickerUnit: (a: { days: number }) =>
      `התאמה בשווי דיווח אחד היא דירוג מלאכותי אחד במשקל של חבר בעל השפעה מלאה. היא נחלשת בתוך ${ltr(a.days)} ימים, וכל הדירוגים האמיתיים ממשיכים להשפיע במקביל.`,
    adjPickerLive: '**התאמות שכבר פעילות**',
    adjPickerPlaceholder: 'בחר כיוון ועוצמה',
    adjClearOption: 'בטל את כל ההתאמות',
    adjClearDesc: 'חזרה לציון הקהילה בלבד',

    recalcDone: (a: { count: number }) =>
      `חושבו מחדש ${ltr(a.count)} דירוגים קהילתיים לפי הגדרות הכוונון הנוכחיות.`,
    refreshDone: 'לוח הבקרה רוענן.',
    refreshHubDone: (a: { channel: string }) =>
      `ההסבר והכפתורים פורסמו מחדש ב-<#${a.channel}>.`,
    refreshHubMissing: 'לא מצאתי את הערוץ הציבורי. הרץ `/standing-setup` במקום.',

    distribution: (a: { lines: string }) =>
      ['**החלוקה הנוכחית בשרת**', a.lines, '', 'מוצגים מספרים בלבד. אין פקודה שמאפשרת למישהו לראות אילו חברים נמצאים בכל אזור.'].join('\n'),

    adjustApplied: (a: { mention: string; area: string; score: string; from: string; undo: string; blocked: string; days: number; reports: number; moved: boolean }) =>
      [
        `${ltr(a.mention)} נמצא עכשיו ב-**${a.area}** עם ציון **${ltr(a.score)}**, במקום ${ltr(a.from)}.${a.undo}${a.blocked}`,
        '',
        rtlLine(`ההתאמה שוות ערך ל-${ltr(a.reports)} דיווחים ומשפיעה על הציון, לא קובעת אזור. כל דירוג אמיתי ממשיך להשפיע, וההתאמה נחלשת בתוך ${ltr(a.days)} ימים. ${a.moved ? 'השחקן קיבל הודעה פרטית שהאזור השתנה, בלי סיבה ובלי לציין מי החליט.' : 'האזור לא השתנה, ולכן לא נשלחה לשחקן שום הודעה.'}`),
      ].join('\n'),
    adjustUndoStr: (a: { count: number }) =>
      `\n\nיידרשו **${ltr(a.count)}** דיווחים חדשים בראש הסולם כדי להחזיר את השחקן למצב הקודם. הקהילה יכולה לגבור על ההתאמה בלי לחכות שתפוג.`,
    adjustBlockedStr: (a: { reason: string }) =>
      `\n\n**האזור לא השתנה, וההתאמה לבדה לא תשנה אותו:** ${a.reason}. התאמות מזיזות את הציון, אך לא את מספר המדרגים או את סף ההסכמה. לכן מנהל לא יכול למקם שחקן שהקהילה עדיין לא דירגה באמת. הציון נשמר וישפיע כשמספיק אנשים אמיתיים ידרגו.`,

    adjustCleared: (a: { mention: string; count: number }) =>
      `בוטלו ${ltr(a.count)} התאמות. הציון של ${ltr(a.mention)} מבוסס עכשיו רק על דירוגי הקהילה.`,
    adjustClearedNone: (a: { mention: string }) =>
      `אין ל-${ltr(a.mention)} התאמות פעילות.`,
    adjustNotParticipating: (a: { mention: string }) =>
      `${ltr(a.mention)} מחוץ למערכת הדירוג, ולכן אין כרגע ציון שאפשר להתאים. קודם צריך להסיר את החסימה או לבקש מהשחקן להצטרף.`,
    adjustBadDirection: 'הכיוון שנבחר לא קיים.',

    removeDone: (a: { mention: string }) =>
      [
        `${ltr(a.mention)} הוסר ממערכת הדירוג ולא יכול להצטרף אליה מחדש לבד.`,
        '',
        'כל הדירוגים שהשחקן נתן או קיבל הוקפאו ולא נמחקו. הפקודה `/standing-admin reinstate` תאפשר לשחזר את המצב.',
      ].join('\n'),

    reinstateDone: (a: { mention: string }) =>
      `${ltr(a.mention)} יכול שוב לבחור להצטרף. עד אז השחקן נשאר מחוץ למערכת, והדירוגים המוקפאים יחזרו להשפיע רק אחרי ההצטרפות.`,

    pauseDone: (a: { hidden: string; failures: string | null }) =>
      [
        '**המערכת הושבתה.**',
        a.hidden || 'לא היה מה להסתיר.',
        a.failures,
        '',
        'כל הדירוגים, הדירוגים הקהילתיים והבקשות הפתוחות נשמרו. פקודות החברים מציגות עכשיו הודעת תחזוקה. הערוץ הזה נשאר גלוי כדי שיהיה אפשר להריץ `/standing-admin resume`.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    resumeDone: (a: { count: number }) =>
      [
        '**המערכת חזרה לפעול.**',
        `הערוצים שוב גלויים, והדירוג הקהילתי של ${ltr(a.count)} חברים נבדק מחדש.`,
        '',
        'כל הדירוגים הקהילתיים נשארו כפי שהיו לפני ההשבתה. כל דבר שנמחק בזמן התחזוקה נבנה מחדש, והמדריך המוצמד פורסם שוב.',
      ].join('\n'),

    resumeError: (a: { error: string }) => `לא הצלחתי להפעיל מחדש את המערכת: ${a.error}`,

    noticeStatus: (a: { ts: number; pending: number }) =>
      [
        `**פעיל** מ-<t:${a.ts}:F>.`,
        `נותרו ${ltr(a.pending)} חברים שיקבלו את ההודעה בפעם הבאה שיצטרפו לערוץ קולי.`,
        '',
        'אם ההודעות הפרטיות של חבר סגורות, המערכת תנסה שוב למחרת ולא תוותר עליו. לכן המספר עשוי לרדת לאט.',
      ].join('\n'),
    noticeStatusOff: (a: { pending: number }) =>
      `**כבוי.** לא נשלחות הודעות. ${ltr(a.pending)} חברים עדיין לא קיבלו את הודעת ההיכרות.`,
    noticeOff:
      'השליחה הופסקה. לא יישלחו הודעות נוספות, ומי שכבר קיבל הודעה לא יקבל אותה שוב גם אם השליחה תופעל מחדש.',
    noticeOn: (a: { pending: number; skipped: number }) =>
      [
        '**פעיל.**',
        `${ltr(a.pending)} חברים יקבלו כל אחד הודעה פרטית אחת, בפעם הבאה שיצטרפו לערוץ קולי.`,
        a.skipped > 0
          ? `דילגנו על ${ltr(a.skipped)} חברים שכבר דירגו מישהו או בחרו לצאת מהמערכת, כי הם כבר יודעים שהיא קיימת.`
          : null,
        '',
        'אף אחד לא יקבל את ההודעה פעמיים, גם אחרי הפעלה מחדש או פריסה. הצטרפות לערוץ AFK לא שולחת הודעה, וגם לא נשלחות הודעות בזמן שהמערכת מושבתת.',
      ]
        .filter((l) => l != null)
        .join('\n'),

    languageSwitched: (a: { label: string }) =>
      `השפה שונתה ל-**${a.label}**. ההודעות המוצמדות עודכנו.`,
  },

  setup: {
    done: '**ההגדרה הסתיימה בהצלחה.**',
    createdRoles: (a: { names: string }) => `נוצרו התפקידים: ${a.names}`,
    createdChannels: (a: { names: string }) => `נוצרו הערוצים: ${a.names}`,
    reused: (a: { count: number }) => `נעשה שימוש מחדש ב-${ltr(a.count)} פריטים קיימים.`,
    initialised: (a: { count: number }) => `${ltr(a.count)} חברים קיבלו תפקיד התחלתי.`,
    ratingChannel: (a: { channel: string }) =>
      `החברים יכולים לקרוא את הכללים ולדרג זה את זה ב-${ltr(a.channel)}.`,
    existing:
      'ערוצים שכבר היו קיימים נשארו בדיוק כפי שהיו — לא הועברו לקטגוריה אחרת וההרשאות שלהם לא השתנו.',
    roleOrder: (a: { roles: string }) =>
      `צריך לוודא שהתפקיד שלי נמצא **מעל** ${a.roles} תחת Server Settings → Roles, אחרת לא אוכל להקצות את התפקידים האלה.`,
    error: (a: { message: string }) =>
      `ההגדרה נכשלה: ${a.message}\n\nצריך לוודא שיש לי הרשאות Manage Roles ו-Manage Channels.`,
  },

  revert: {
    confirmTitle: (a: { guild: string }) => `לבטל את כל מערכת הדירוג ב-${a.guild}?`,
    confirmDesc:
      'כל מה שהבוט יצר מפורט למטה. כל הדירוגים, הדירוגים הקהילתיים והבקשות הפתוחות יימחקו. אי אפשר לבטל את הפעולה הזאת אחר כך.',
    toDeleteRoles: (a: { count: number }) => `תפקידים למחיקה (${ltr(a.count)})`,
    toDeleteChannels: (a: { count: number }) => `ערוצים למחיקה (${ltr(a.count)})`,
    toRestoreChannels: (a: { count: number }) => `ערוצים לשחזור (${ltr(a.count)})`,
    toRestoreDesc:
      'הערוצים האלה היו בשרת לפני הבוט, ולכן ההודעות שלהם יישמרו והם יחזרו לקטגוריה ולהרשאות המקוריות.',
    toEmptyRoles: (a: { count: number }) => `תפקידים שיישארו אך יתרוקנו (${ltr(a.count)})`,
    toEmptyRolesDesc:
      'התפקידים האלה היו בשרת לפני הבוט. הם יישארו קיימים, אבל יוסרו מכל החברים שהבוט הקצה להם אותם.',
    toLeaveRoles: (a: { count: number }) => `תפקידים שיישארו בלי שינוי (${ltr(a.count)})`,
    toLeaveRolesDesc:
      'הבוט רק בדק את התפקידים האלה כדי להחליט מי יכול להריץ פקודות, ומעולם לא הקצה אותם. השם, ההרשאות והחברים יישארו בדיוק כפי שהם.',
    unrecorded: (a: { count: number }) => `התאמות נוספות לפי שם, ללא רישום (${ltr(a.count)})`,
    unrecordedDesc:
      'אין תיעוד שמראה מי יצר אותם. השמות תואמים להגדרות, אבל הבוט לא רשם שהוא יצר אותם, ולכן תוכנית הביטול מתייחסת אליהם כמו לפריטים חדשים.',
    nothingToDo:
      'אין לבוט שום רישום על השרת הזה. ייתכן שההגדרה מעולם לא הופעלה כאן, או שכבר בוטלה.',
    confirmBtn: 'כן, בטל הכול',
    cancelBtn: 'ביטול',

    deleted: (a: { roles: string }) => `נמחקו התפקידים: ${a.roles}`,
    deletedChannels: (a: { channels: string }) => `נמחקו הערוצים: ${a.channels}`,
    restored: (a: { channels: string }) => `${a.channels} הוחזר להגדרות המקוריות.`,
    released: (a: { roles: string }) => `${a.roles} נשארו קיימים, אך הוסרו מכל החברים.`,
    untouched: (a: { roles: string }) => `לא בוצע שום שינוי ב-${a.roles} — החברים וההרשאות נשמרו.`,
    cleared: (a: { count: number }) => `נמחקו ${ltr(a.count)} רשומות ממסד הנתונים. לא נשארו דירוגים או דירוגים קהילתיים.`,
    failures: (a: { items: string }) => `לא הצלחתי להשלים את הפעולות הבאות: ${a.items}`,
    inProgress: '⏳ מבצע את הביטול…',
    cancelled: 'הביטול הופסק. שום דבר לא השתנה.',
  },

  log: {
    ratingCreatedFull: (a: { actor: string; target: string; value: number }) =>
      `${ltr(a.actor)} דירג את ${ltr(a.target)} **${ltr(a.value)}**`,
    ratingCreatedRedacted: (a: { actor: string }) =>
      `${ltr(a.actor)} שלח דירוג`,
    ratingUpdatedFull: (a: { actor: string; target: string; value: number }) =>
      `${ltr(a.actor)} שינה את הדירוג של ${ltr(a.target)} ל-**${ltr(a.value)}**`,
    ratingUpdatedRedacted: (a: { actor: string }) =>
      `${ltr(a.actor)} עדכן דירוג שנתן`,
    optIn: (a: { actor: string }) =>
      `${ltr(a.actor)} הצטרף למערכת הדירוג; הדירוגים המוקפאים חזרו להשפיע`,
    optOut: (a: { actor: string }) =>
      `${ltr(a.actor)} יצא ממערכת הדירוג; הדירוגים שנתן או קיבל הוקפאו`,
    challengeOpened: (a: { actor: string; invited: number }) =>
      `${ltr(a.actor)} ביקש בדיקה מחדש; נשלחה בקשה ל-${ltr(a.invited)} מדרגים`,
    challengeRerated: (a: { actor: string }) =>
      `${ltr(a.actor)} דירג מחדש שחקן במהלך הבדיקה`,
    challengeKept: (a: { actor: string }) =>
      `${ltr(a.actor)} השאיר את הדירוג הקיים במהלך הבדיקה`,
    tierChange: (a: { subject: string; from: string; to: string }) =>
      `${ltr(a.subject)} עבר **${a.from} → ${a.to}**`,
    admin: (a: { actor: string; summary: string }) =>
      `${ltr(a.actor)} ${a.summary}`,
  },

  commandDescs: {
    rate: 'דרג בפרטיות שחקנים ששיחקת איתם',
    myStanding: 'הצג את הדירוג הקהילתי שלך. רק אתה רואה את התשובה',
    challenge: 'בקש בדיקה מחדש של הדירוג שלך',
    participation: 'הצטרף למערכת הדירוג הקהילתית או צא ממנה',
    standingSetup: 'צור או תקן את התפקידים, הקטגוריות וההרשאות של המערכת',
    standingSetupLanguage: 'השפה של כל ההודעות והממשק (ברירת מחדל: אנגלית)',
    standingSetupLanguageEn: 'English',
    standingSetupLanguageHe: 'עברית (Hebrew)',
    standingRevert: 'בטל את הגדרת המערכת ומחק את כל הנתונים שלה מהשרת',
    standingRevertInclude: 'מחק גם תפקידים וערוצים תואמים שאין רישום שהבוט יצר',
    standingAdmin: 'כלי תחזוקה',
    adminRecalculate: 'חשב מחדש את כל הדירוגים לפי הגדרות הכוונון הנוכחיות',
    adminDistribution: 'הצג כמה חברים נמצאים בכל אזור, בלי שמות',
    adminAdjust: 'התאם ציון של חבר בלי להחליף את דירוגי הקהילה',
    adminAdjustUser: 'למי להתאים את הציון',
    adminAdjustDirection: 'בחר אם להקל, להחמיר או לבטל התאמות',
    adminAdjustEase: 'הקל — הקהילה החמירה מדי',
    adminAdjustPush: 'החמר — הקהילה הקלה מדי',
    adminAdjustUndo: 'בטל — הסר את כל ההתאמות',
    adminAdjustReports: (a: { def: number }) =>
      `עוצמת ההתאמה בדיווחים. ברירת מחדל: ${ltr(a.def)}. לא בשימוש בביטול`,
    adminRemove: 'הסר חבר מהמערכת וחסום הצטרפות עצמאית',
    adminRemoveUser: 'את מי להסיר',
    adminReinstate: 'הסר חסימה ואפשר לחבר לבחור להצטרף שוב',
    adminReinstateUser: 'למי להסיר את החסימה',
    adminPause: 'הסתר את המערכת לתחזוקה ושמור את כל הדירוגים',
    adminResume: 'הפעל מחדש את המערכת אחרי תחזוקה',
    adminRefreshHub: 'פרסם שוב את המדריך והכפתורים בערוץ הציבורי',
    adminNotice: 'נהל את הודעת ההיכרות הפרטית שנשלחת פעם אחת לכל חבר',
    adminNoticeAction: 'הפעל, כבה או בדוק את מצב השליחה',
    adminNoticeOn: 'on — שלח בהצטרפות הראשונה לערוץ קולי',
    adminNoticeOff: 'off — הפסק לשלוח הודעות היכרות',
    adminNoticeStatus: 'status — בדוק כמה חברים עדיין מחכים',
  },
} as const satisfies Strings;
