/**
 * EXAM EX-S5B-5C — the ROUTE-LOCAL Hebrew wording for the ExamDefinition CREATE
 * outcome, and the ONLY thing that turns a query-string token into text.
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
 * the committed EX-C1 containment guard forbids ANY file under `app/` from
 * naming an exam core module — by import OR in prose, because that guard matches
 * raw source text. The sibling exams page already duplicates the exam-kind
 * labels locally for exactly this reason and records the trade-off in its
 * header; this module is the same decision applied to the create diagnostics.
 *
 * The trade-off is stated rather than hidden: a code added to the domain cores
 * will render here as the explicit fallback sentence below instead of failing
 * the build. Both duplications should collapse back onto the shared tables when
 * the containment boundary is lifted, and NOT before — a shared-core refactor is
 * outside this slice.
 *
 * ===========================================================================
 * A CODE IS NEVER A SUBMITTED VALUE
 * ===========================================================================
 * Everything this module accepts is a STABLE TOKEN that the server chose from a
 * closed set — never a name, a duration, a capacity or any other thing a manager
 * typed. `examDefinitionCreateIssueTexts` is the enforcement of that claim and
 * not merely its description: it renders ONLY tokens it recognizes and DROPS
 * everything else, so a hand-crafted query string cannot put arbitrary text on
 * the page even though the query string is attacker-controllable. That is why it
 * filters against the table instead of echoing an unknown token back.
 */

/**
 * The refusal codes the create outcome can carry, minus `offering_not_found` —
 * that one never reaches this page, because the action redirects it to the
 * course list instead of back here.
 */
export type ExamDefinitionCreateErrorCode =
  | "plan_not_found"
  | "operation_not_allowed"
  | "duplicate_name"
  | "invalid_input";

/** The definition-shape diagnostics a CREATE submission can produce. */
export type ExamDefinitionCreateIssueCode =
  | "EX-DEF-NAME-REQUIRED"
  | "EX-DEF-KIND-NOT-STORABLE"
  | "EX-DEF-INVALID-DURATION"
  | "EX-DEF-INVALID-CAPACITY"
  | "EX-DEF-INSTRUCTED-NOT-APPLICABLE"
  | "EX-DEF-TOPIC-NOT-APPLICABLE";

/**
 * One sentence per refusal, each describing WHAT HAPPENED and what the manager
 * can do — never a database detail, never an id, never a submitted value.
 */
export const EXAM_DEFINITION_CREATE_ERROR_TEXT: Readonly<
  Record<ExamDefinitionCreateErrorCode, string>
> = Object.freeze({
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן לא ניתן להוסיף הגדרת מבחן. יצירת תוכנית אינה מתבצעת במסך זה.",
  operation_not_allowed:
    "לא ניתן לערוך את הגדרות המבחנים של קורס בארכיון.",
  duplicate_name: "כבר קיימת הגדרת מבחן בשם זה בתוכנית המבחנים של הקורס.",
  invalid_input: "לא ניתן היה לשמור את הגדרת המבחן. יש לתקן את הפרטים ולנסות שוב.",
});

/**
 * The per-field diagnostics. The wording matches the committed domain rules in
 * meaning; it is duplicated here for the containment reason in the header.
 */
export const EXAM_DEFINITION_CREATE_ISSUE_TEXT: Readonly<
  Record<ExamDefinitionCreateIssueCode, string>
> = Object.freeze({
  "EX-DEF-NAME-REQUIRED": "חובה להזין שם בחינה",
  "EX-DEF-KIND-NOT-STORABLE": "סוג בחינה זה אינו נשמר כהגדרת בחינה",
  "EX-DEF-INVALID-DURATION": "משך הבחינה לכל נבחן חייב להיות מספר שלם וחיובי",
  "EX-DEF-INVALID-CAPACITY": "מספר הנבחנים במקביל חייב להיות מספר שלם וחיובי",
  "EX-DEF-INSTRUCTED-NOT-APPLICABLE":
    "רק בבחינת הדרכת מתקדמים ניתן לדרוש חניך מודרך",
  "EX-DEF-TOPIC-NOT-APPLICABLE": "רק בבחינת הדרכת מתקדמים ניתן לדרוש נושא הדרכה",
});

/** The sentence shown when the server reported a refusal this build predates. */
const UNRECOGNIZED_ERROR_TEXT =
  "לא ניתן היה לשמור את הגדרת המבחן. יש לרענן את הדף ולנסות שוב.";

function isKnownErrorCode(value: string): value is ExamDefinitionCreateErrorCode {
  return Object.prototype.hasOwnProperty.call(
    EXAM_DEFINITION_CREATE_ERROR_TEXT,
    value,
  );
}

function isKnownIssueCode(value: string): value is ExamDefinitionCreateIssueCode {
  return Object.prototype.hasOwnProperty.call(
    EXAM_DEFINITION_CREATE_ISSUE_TEXT,
    value,
  );
}

/**
 * The headline sentence for one raw `createError` token.
 *
 * `null` means "there is nothing to report" and is returned ONLY for a genuinely
 * absent parameter. An unrecognized token is NOT silently dropped: it produces
 * the explicit fallback above, because a refusal that renders as a blank page
 * would read to the manager as a successful save.
 *
 * Own-property lookup only, so `toString`, `constructor` and every other
 * prototype member read as unknown rather than as a message.
 */
export function examDefinitionCreateErrorText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return isKnownErrorCode(raw)
    ? EXAM_DEFINITION_CREATE_ERROR_TEXT[raw]
    : UNRECOGNIZED_ERROR_TEXT;
}

/**
 * The per-field sentences for one raw comma-separated `createIssues` token.
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
export function examDefinitionCreateIssueTexts(raw: unknown): readonly string[] {
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
    texts.push(EXAM_DEFINITION_CREATE_ISSUE_TEXT[code]);
  }
  return texts;
}
