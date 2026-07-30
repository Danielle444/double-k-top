/**
 * EXAM EX-SES-S4 — the ROUTE-LOCAL Hebrew wording for the stored ExamSession
 * CREATE outcome, and the ONLY thing that turns a query-string token into text.
 *
 * PURE and DEPENDENCY-FREE: no import of any kind. No React, no Next, no Prisma,
 * no server-only marker, no session, no clock. Every export is a total,
 * deterministic function of its arguments and never mutates anything, so this
 * module is importable from a server page and a client component alike and is
 * provable by an ordinary DB-free test.
 *
 * ===========================================================================
 * WHY THE HEBREW IS DUPLICATED HERE RATHER THAN IMPORTED
 * ===========================================================================
 * The committed exam validation cores own the authoritative message table, and
 * the committed containment guards forbid ANY file under `app/` from naming an
 * exam core module — by import OR in prose, because those guards match raw
 * source text. The sibling exams page duplicates the exam-kind labels locally
 * for exactly this reason, and the sibling definition-create message module is
 * the same decision applied to that slice's diagnostics; this module is the
 * third application of it.
 *
 * The trade-off is stated rather than hidden: a code added to the domain cores
 * will render here as the explicit fallback sentence below instead of failing
 * the build. All three duplications should collapse back onto the shared tables
 * when the containment boundary is lifted, and NOT before — a shared-core
 * refactor is outside this slice.
 *
 * ===========================================================================
 * A CODE IS NEVER A SUBMITTED VALUE
 * ===========================================================================
 * Everything this module accepts is a STABLE TOKEN that the server chose from a
 * closed set — never a definition id, a date, a start time, an arena, a title,
 * a note or any other thing a manager typed. `examSessionCreateIssueTexts` is
 * the enforcement of that claim and not merely its description: it renders ONLY
 * tokens it recognizes and DROPS everything else, so a hand-crafted query string
 * cannot put arbitrary text on the page even though the query string is
 * attacker-controllable. That is why it filters against the table instead of
 * echoing an unknown token back.
 */

/**
 * The refusal codes the session-create outcome can carry, minus
 * `offering_not_found` — that one never reaches this page, because the action
 * redirects it to the course list instead of back here.
 */
export type ExamSessionCreateErrorCode =
  | "plan_not_found"
  | "operation_not_allowed"
  | "definition_not_found"
  | "invalid_input";

/** The session-shape diagnostics a CREATE submission can produce. */
export type ExamSessionCreateIssueCode =
  | "EX-SES-DEFINITION-REQUIRED"
  | "EX-SES-DATE-INVALID"
  | "EX-SES-START-TIME-INVALID"
  | "EX-SES-ARENA-INVALID"
  | "EX-SES-TITLE-INVALID"
  | "EX-SES-NOTES-INVALID";

/**
 * One sentence per refusal, each describing WHAT HAPPENED and what the manager
 * can do — never a database detail, never an id, never a submitted value.
 *
 * `definition_not_found` deliberately does NOT distinguish "no such definition"
 * from "a definition belonging to another course's plan". The committed writer
 * reports both identically on purpose, and a message that separated them would
 * be an oracle over another course's data.
 */
export const EXAM_SESSION_CREATE_ERROR_TEXT: Readonly<
  Record<ExamSessionCreateErrorCode, string>
> = Object.freeze({
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן לא ניתן להוסיף מועד בחינה. יצירת תוכנית אינה מתבצעת במסך זה.",
  operation_not_allowed: "לא ניתן לערוך את מועדי המבחנים של קורס בארכיון.",
  definition_not_found:
    "הגדרת הבחינה שנבחרה אינה קיימת בתוכנית המבחנים של קורס זה. יש לרענן את הדף ולבחור שוב.",
  invalid_input: "לא ניתן היה לשמור את מועד הבחינה. יש לתקן את הפרטים ולנסות שוב.",
});

/**
 * The per-field diagnostics. The wording matches the committed domain rules in
 * meaning; it is duplicated here for the containment reason in the header.
 *
 * Deliberately NON-ECHOING and deliberately vague about WHY, exactly as the
 * committed table is: a message that distinguished "not a string" from "wrongly
 * formatted" would be an oracle over the exact validator and buys a manager
 * nothing, because the correction is the same either way.
 */
export const EXAM_SESSION_CREATE_ISSUE_TEXT: Readonly<
  Record<ExamSessionCreateIssueCode, string>
> = Object.freeze({
  "EX-SES-DEFINITION-REQUIRED": "יש לבחור הגדרת בחינה",
  "EX-SES-DATE-INVALID": "תאריך הבחינה אינו תקין",
  "EX-SES-START-TIME-INVALID": "שעת ההתחלה אינה תקינה (HH:MM)",
  "EX-SES-ARENA-INVALID": "שדה הזירה אינו תקין",
  "EX-SES-TITLE-INVALID": "שדה הכותרת אינו תקין",
  "EX-SES-NOTES-INVALID": "שדה ההערות אינו תקין",
});

/** The sentence shown when the server reported a refusal this build predates. */
const UNRECOGNIZED_ERROR_TEXT =
  "לא ניתן היה לשמור את מועד הבחינה. יש לרענן את הדף ולנסות שוב.";

function isKnownErrorCode(value: string): value is ExamSessionCreateErrorCode {
  return Object.prototype.hasOwnProperty.call(EXAM_SESSION_CREATE_ERROR_TEXT, value);
}

function isKnownIssueCode(value: string): value is ExamSessionCreateIssueCode {
  return Object.prototype.hasOwnProperty.call(EXAM_SESSION_CREATE_ISSUE_TEXT, value);
}

/**
 * The headline sentence for one raw `sessionError` token.
 *
 * `null` means "there is nothing to report" and is returned ONLY for a genuinely
 * absent parameter. An unrecognized token is NOT silently dropped: it produces
 * the explicit fallback above, because a refusal that renders as a blank page
 * would read to the manager as a successful save.
 *
 * Own-property lookup only, so `toString`, `constructor` and every other
 * prototype member read as unknown rather than as a message.
 */
export function examSessionCreateErrorText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return isKnownErrorCode(raw)
    ? EXAM_SESSION_CREATE_ERROR_TEXT[raw]
    : UNRECOGNIZED_ERROR_TEXT;
}

/**
 * The per-field sentences for one raw comma-separated `sessionIssues` token.
 *
 * RECOGNIZED CODES ONLY. An unknown token is DROPPED rather than rendered, which
 * is what makes it impossible to place arbitrary text on the page through the
 * query string. Duplicates collapse, and the table's own order is NOT imposed:
 * the server's order is preserved, so the diagnostics read in the same sequence
 * the domain rules produced them.
 *
 * Total over every input: a non-string, an empty string, a string of separators
 * and a string of unknown tokens all yield an empty list.
 */
export function examSessionCreateIssueTexts(raw: unknown): readonly string[] {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const texts: string[] = [];
  for (const token of raw.split(",")) {
    const code = token.trim();
    if (code.length === 0 || seen.has(code) || !isKnownIssueCode(code)) {
      continue;
    }
    seen.add(code);
    texts.push(EXAM_SESSION_CREATE_ISSUE_TEXT[code]);
  }
  return texts;
}
