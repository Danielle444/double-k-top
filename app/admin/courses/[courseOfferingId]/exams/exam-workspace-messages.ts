/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the CLOSED feedback vocabulary of the two
 * operations this slice adds: saving one examinee's card, and moving one
 * examinee within its block.
 *
 * ONE MODULE, and it is the only place these sentences exist. The route's page
 * SELECTS a message from here with a token it read out of the query string; it
 * never builds one. That is what makes it impossible for a submitted value to be
 * reflected back onto the screen: the query can pick a sentence and can never
 * supply one.
 *
 * Every parser below is CLOSED IN BOTH DIRECTIONS and TOTAL:
 *
 *  - a non-string — which is what a REPEATED query key produces — is not a
 *    recognized token. The `typeof` test is load-bearing rather than decorative:
 *    a loose comparison would let `["1"]` coerce its way to a match;
 *  - an empty string is not a token;
 *  - `Object.hasOwn` rather than a plain property lookup, so an inherited name
 *    such as `constructor` or `toString` cannot select a message;
 *  - an unrecognized code renders the module's own explicit fallback for the
 *    HEADLINE parsers, and is DROPPED for the per-field one. A refusal that
 *    rendered as a blank page would read to a manager as a successful save,
 *    while a per-field list that echoed unknown tokens would be a way to put
 *    arbitrary text on the page.
 *
 * `offering_not_found` is deliberately absent from every table here, exactly as
 * it is from the route's existing ones: that refusal never returns to this
 * course-scoped route, because an id that did not resolve cannot be used to
 * build a URL for it. It routes to the courses list instead.
 *
 * The Hebrew is spelled out LOCALLY rather than imported from the committed
 * domain tables, for the containment reason the page's own header records: the
 * committed guards forbid any file under `app/` from naming an exam core module,
 * by import OR in prose.
 */

// ===========================================================================
// 1. Saving one examinee's card
// ===========================================================================

/**
 * The THREE outcomes a card save can report, and no fourth.
 *
 * A card save writes through TWO committed writers — the assignment's own detail
 * columns, and the teaching link — and the two are not one transaction. So the
 * result must never be a general "saved": a manager whose detail change landed
 * and whose link did not has to be told exactly that, and told that the link
 * they had is still the link they have.
 *
 *  - SAVED          — everything the card asked for was written;
 *  - PAIRING_FAILED — the details were written, the teaching link was NOT, and
 *                     the previous link is untouched;
 *  - NO_CHANGE      — the submission matched what was already stored, so nothing
 *                     was written at all.
 */
export const EXAM_ASSIGNMENT_EDIT_SAVED_TOKEN = "SAVED";
export const EXAM_ASSIGNMENT_EDIT_PAIRING_FAILED_TOKEN = "PAIRING_FAILED";
export const EXAM_ASSIGNMENT_EDIT_NO_CHANGE_TOKEN = "NO_CHANGE";

export const EXAM_ASSIGNMENT_EDIT_SAVED_TEXT = "כל השינויים בכרטיס הנבחן/ת נשמרו.";
/**
 * The PARTIAL outcome, stated in full: what was saved, what was not, and what is
 * still in force. It names no trainee, no examinee, no id and no refusal code —
 * the manager can see the card they submitted from, and the correction is the
 * same whatever the backend's reason was.
 */
export const EXAM_ASSIGNMENT_EDIT_PAIRING_FAILED_TEXT =
  "פרטי הנבחן/ת נשמרו, אך החלפת החניך המודרך לא בוצעה. השיוך הקודם נותר ללא שינוי. יש לרענן את הדף ולנסות שוב.";
export const EXAM_ASSIGNMENT_EDIT_NO_CHANGE_TEXT =
  "לא בוצע שינוי — הפרטים שנשלחו זהים לפרטים השמורים.";

/**
 * The CLOSED refusal table of a card save.
 *
 * Each sentence states the RULE that was applied and names NO trainee, NO horse,
 * NO session and NO id: the manager can see the card they submitted from, and an
 * id in a banner would be noise at best.
 */
const EXAM_ASSIGNMENT_EDIT_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  operation_not_allowed: "לא ניתן לערוך שיבוצים במצב הנוכחי של הקורס.",
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין מה לערוך. יש לרענן את הדף.",
  invalid_input: "לא ניתן היה לשמור את הפרטים. יש לתקן את השדות ולנסות שוב.",
  assignment_not_found:
    "השיבוץ שנערך אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  role_not_editable:
    "ניתן לערוך בכרטיס הזה רק שיבוץ של נבחן/ת. יש לרענן את הדף.",
  lesson_topic_required: "סוג המבחן הזה מחייב נושא הדרכה. יש למלא אותו ולשמור שוב.",
  discipline_required: "סוג המבחן הזה מחייב ענף. יש למלא אותו ולשמור שוב.",
});

/** The ONE sentence an unrecognized refusal code renders. */
const EXAM_ASSIGNMENT_EDIT_FALLBACK_TEXT =
  "שמירת פרטי הנבחן/ת לא הושלמה. יש לרענן את הדף ולנסות שוב.";

/** The CLOSED per-field diagnostics a card save can produce. */
const EXAM_ASSIGNMENT_EDIT_ISSUE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "EX-ASG-ED-ASSIGNMENT-REQUIRED": "בקשת העריכה אינה תקינה. יש לרענן את הדף",
  "EX-ASG-ED-HORSE-REQUIRED": "חובה לציין סוס עבור הנבחן/ת",
});

// ===========================================================================
// 2. Moving one examinee
// ===========================================================================

/** The two SUCCESS tokens of a move. */
export const EXAM_ASSIGNMENT_MOVED_TOKEN = "MOVED";
export const EXAM_ASSIGNMENT_AT_EDGE_TOKEN = "AT_EDGE";

export const EXAM_ASSIGNMENT_MOVED_TEXT = "סדר הנבחנים עודכן, והשעות חושבו מחדש.";
export const EXAM_ASSIGNMENT_AT_EDGE_TEXT = "הנבחן/ת כבר נמצא/ת בקצה הסדר — לא בוצע שינוי.";

/** The CLOSED refusal table of a move. */
const EXAM_ASSIGNMENT_ORDER_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  operation_not_allowed: "לא ניתן לשנות את סדר הנבחנים במצב הנוכחי של הקורס.",
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין סדר לשנות. יש לרענן את הדף.",
  invalid_input: "בקשת שינוי הסדר אינה תקינה. יש לרענן את הדף ולנסות שוב.",
  assignment_not_found:
    "השיבוץ שביקשת להזיז אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  role_not_movable: "ניתן לשנות סדר רק לנבחנים. יש לרענן את הדף.",
});

/** The ONE sentence an unrecognized move refusal renders. */
const EXAM_ASSIGNMENT_ORDER_FALLBACK_TEXT =
  "שינוי הסדר לא בוצע. יש לרענן את הדף ולנסות שוב.";

// ===========================================================================
// 3. The parsers
// ===========================================================================

/** A tone and a sentence this module chose itself. */
export interface ExamWorkspaceFeedback {
  readonly tone: "success" | "neutral" | "error";
  readonly message: string;
}

function readToken(raw: string | string[] | undefined): string | null {
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * ONE banner for one raw card-save token.
 *
 * `null` means "render nothing", and it is reached ONLY by an absent or
 * non-string value. A code the refusal table does not own still renders the
 * fallback sentence, because a refusal that showed nothing would read as a save.
 */
export function examAssignmentEditFeedback(
  raw: string | string[] | undefined,
): ExamWorkspaceFeedback | null {
  const token = readToken(raw);
  if (token === null) return null;
  if (token === EXAM_ASSIGNMENT_EDIT_SAVED_TOKEN) {
    return { tone: "success", message: EXAM_ASSIGNMENT_EDIT_SAVED_TEXT };
  }
  if (token === EXAM_ASSIGNMENT_EDIT_PAIRING_FAILED_TOKEN) {
    // WARNING rather than success: something the manager asked for did not
    // happen, and a green banner would read as "all done".
    return { tone: "error", message: EXAM_ASSIGNMENT_EDIT_PAIRING_FAILED_TEXT };
  }
  if (token === EXAM_ASSIGNMENT_EDIT_NO_CHANGE_TOKEN) {
    return { tone: "neutral", message: EXAM_ASSIGNMENT_EDIT_NO_CHANGE_TEXT };
  }
  return {
    tone: "error",
    message: Object.hasOwn(EXAM_ASSIGNMENT_EDIT_ERROR_MESSAGES, token)
      ? EXAM_ASSIGNMENT_EDIT_ERROR_MESSAGES[token]
      : EXAM_ASSIGNMENT_EDIT_FALLBACK_TEXT,
  };
}

/**
 * The per-field sentences for one raw comma-separated issue token.
 *
 * RECOGNIZED CODES ONLY — an unknown token is DROPPED rather than rendered.
 * Duplicates collapse, and the SERVER's order is preserved rather than the
 * table's, so the diagnostics read in the sequence the rules produced them.
 */
export function examAssignmentEditIssueTexts(
  raw: string | string[] | undefined,
): readonly string[] {
  const token = readToken(raw);
  if (token === null) return [];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const part of token.split(",")) {
    const code = part.trim();
    if (
      code.length === 0 ||
      seen.has(code) ||
      !Object.hasOwn(EXAM_ASSIGNMENT_EDIT_ISSUE_MESSAGES, code)
    ) {
      continue;
    }
    seen.add(code);
    texts.push(EXAM_ASSIGNMENT_EDIT_ISSUE_MESSAGES[code]);
  }
  return texts;
}

// ===========================================================================
// 4. Selecting which Teaching-Practice dates the plan runs as exam days
// ===========================================================================

/**
 * The TWO SUCCESS tokens of a source-date replacement.
 *
 * `NO_CHANGE` is reported separately from a real replacement and is deliberately
 * NEUTRAL: the backend issued no statement at all, and a green "saved" banner
 * over a database that was never touched is the one thing a manager must not be
 * shown here — this selection is exactly what decides whether beginner exams
 * appear at all.
 */
export const EXAM_SOURCE_DATES_REPLACED_TOKEN = "REPLACED";
export const EXAM_SOURCE_DATES_NO_CHANGE_TOKEN = "NO_CHANGE";

export const EXAM_SOURCE_DATES_REPLACED_TEXT =
  "רשימת תאריכי מבחני המתחילים עודכנה. מבחני המתחילים מוצגים לפי התאריכים שנבחרו.";
export const EXAM_SOURCE_DATES_NO_CHANGE_TEXT =
  "לא בוצע שינוי — התאריכים שנשלחו זהים לתאריכים השמורים.";

/**
 * The CLOSED refusal table of a source-date replacement.
 *
 * Each sentence states the RULE that was applied and names NO date, NO lesson,
 * NO child and NO id: the manager can see the dates they submitted, and a token
 * echoed into a banner would be a way to put arbitrary text on the page.
 */
const EXAM_SOURCE_DATES_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  operation_not_allowed: "לא ניתן לשנות את תאריכי מבחני המתחילים במצב הנוכחי של הקורס.",
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין למה לשייך תאריכים. יש לרענן את הדף.",
  invalid_input: "לא ניתן היה לשמור את התאריכים. יש לתקן את הבחירה ולנסות שוב.",
});

/** The ONE sentence an unrecognized refusal code renders. */
const EXAM_SOURCE_DATES_FALLBACK_TEXT =
  "עדכון תאריכי מבחני המתחילים לא הושלם. יש לרענן את הדף ולנסות שוב.";

/**
 * The CLOSED per-rule diagnostics a source-date replacement can produce.
 *
 * The codes are the committed backend's own. Each sentence states the RULE and
 * never the offending value, so a submitted token can never reach the screen.
 */
const EXAM_SOURCE_DATES_ISSUE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "EX-SRC-INPUT-NOT-A-LIST": "בקשת עדכון התאריכים אינה תקינה. יש לרענן את הדף",
  "EX-SRC-DATE-INVALID": "אחד התאריכים שנבחרו אינו תאריך תקין",
  "EX-SRC-LEVEL-NOT-SUPPORTED": "ברמת הקורס הזו אין מבחני מתחילים, ולכן לא ניתן לבחור תאריכים",
  "EX-SRC-DATE-OUT-OF-COURSE-RANGE": "אחד התאריכים שנבחרו נמצא מחוץ לתקופת הקורס",
  "EX-SRC-DATE-HAS-NO-PRACTICE":
    "באחד התאריכים שנבחרו אין תרגול מעשי. יש לבחור תאריך שבו מתקיים תרגול מעשי",
});

/** ONE banner for one raw source-date token, on exactly the card save's terms. */
export function examSourceDatesFeedback(
  raw: string | string[] | undefined,
): ExamWorkspaceFeedback | null {
  const token = readToken(raw);
  if (token === null) return null;
  if (token === EXAM_SOURCE_DATES_REPLACED_TOKEN) {
    return { tone: "success", message: EXAM_SOURCE_DATES_REPLACED_TEXT };
  }
  if (token === EXAM_SOURCE_DATES_NO_CHANGE_TOKEN) {
    return { tone: "neutral", message: EXAM_SOURCE_DATES_NO_CHANGE_TEXT };
  }
  return {
    tone: "error",
    message: Object.hasOwn(EXAM_SOURCE_DATES_ERROR_MESSAGES, token)
      ? EXAM_SOURCE_DATES_ERROR_MESSAGES[token]
      : EXAM_SOURCE_DATES_FALLBACK_TEXT,
  };
}

/**
 * The per-rule sentences for one raw comma-separated issue token.
 *
 * RECOGNIZED CODES ONLY — an unknown token is DROPPED rather than rendered,
 * exactly as the card-save diagnostics are. Duplicates collapse and the SERVER's
 * order is preserved.
 */
export function examSourceDatesIssueTexts(
  raw: string | string[] | undefined,
): readonly string[] {
  const token = readToken(raw);
  if (token === null) return [];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const part of token.split(",")) {
    const code = part.trim();
    if (
      code.length === 0 ||
      seen.has(code) ||
      !Object.hasOwn(EXAM_SOURCE_DATES_ISSUE_MESSAGES, code)
    ) {
      continue;
    }
    seen.add(code);
    texts.push(EXAM_SOURCE_DATES_ISSUE_MESSAGES[code]);
  }
  return texts;
}

/** ONE banner for one raw move token, on exactly the terms above. */
export function examAssignmentOrderFeedback(
  raw: string | string[] | undefined,
): ExamWorkspaceFeedback | null {
  const token = readToken(raw);
  if (token === null) return null;
  if (token === EXAM_ASSIGNMENT_MOVED_TOKEN) {
    return { tone: "success", message: EXAM_ASSIGNMENT_MOVED_TEXT };
  }
  if (token === EXAM_ASSIGNMENT_AT_EDGE_TOKEN) {
    return { tone: "neutral", message: EXAM_ASSIGNMENT_AT_EDGE_TEXT };
  }
  return {
    tone: "error",
    message: Object.hasOwn(EXAM_ASSIGNMENT_ORDER_ERROR_MESSAGES, token)
      ? EXAM_ASSIGNMENT_ORDER_ERROR_MESSAGES[token]
      : EXAM_ASSIGNMENT_ORDER_FALLBACK_TEXT,
  };
}
