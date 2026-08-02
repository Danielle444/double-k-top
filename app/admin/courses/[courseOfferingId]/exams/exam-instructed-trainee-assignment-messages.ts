/**
 * EXAM EX-ASG-IT2 — the ROUTE-LOCAL Hebrew wording for the stored
 * INSTRUCTED_TRAINEE assignment CREATE outcome, and the ONLY thing that turns
 * one of that operation's query-string tokens into text on this surface.
 *
 * PURE and DEPENDENCY-FREE: no import of any kind. No React, no Next, no Prisma,
 * no server-only marker, no session, no clock. Every export is a total,
 * deterministic function of its arguments and never mutates anything, so this
 * module is importable from a server page and a client component alike and is
 * provable by an ordinary DB-free test.
 *
 * ===========================================================================
 * WHY THIS IS A SEPARATE MODULE FROM ITS EXAMINEE SIBLING
 * ===========================================================================
 * The sibling assignment message module owns the EXAMINEE create and removal
 * wording, and its tables are keyed by that operation's own closed code sets.
 * This operation's set is DIFFERENT in both directions: it owns a refusal the
 * examinee create cannot produce (the definition does not ask for an instructed
 * trainee at all), and it deliberately CANNOT produce the horse diagnostic,
 * because an instructed trainee carries no horse and this surface collects none.
 *
 * Folding the two together would mean one table holding codes neither operation
 * can produce on its own, and a manager could then be shown "יש להזין שם סוס"
 * for a form that has no horse field. Two closed tables, each exactly its own
 * operation's set, is what makes that unrepresentable rather than merely
 * unlikely.
 *
 * ===========================================================================
 * WHY THE HEBREW IS SPELLED OUT HERE RATHER THAN IMPORTED
 * ===========================================================================
 * The committed exam validation cores own the authoritative message table, and
 * the committed containment guards forbid ANY file under `app/` from naming an
 * exam core module — by import OR in prose, because those guards match raw
 * source text. The sibling exams page duplicates the exam-kind labels locally
 * for exactly this reason, and the three sibling message modules are the same
 * decision applied to the definition-create, session-create and assignment
 * diagnostics; this module is the fourth application of it.
 *
 * The trade-off is stated rather than hidden: a code added to the domain cores
 * will render here as the explicit fallback sentence below instead of failing
 * the build. All of these duplications should collapse back onto the shared
 * tables when the containment boundary is lifted, and NOT before.
 *
 * ===========================================================================
 * A CODE IS NEVER A SUBMITTED VALUE
 * ===========================================================================
 * Everything this module accepts is a STABLE TOKEN that the server chose from a
 * closed set — never a session id, a trainee id, an assignment id, a trainee's
 * name or any other thing a manager typed or chose. `examInstructedTraineeIssueTexts`
 * is the enforcement of that claim and not merely its description: it renders
 * ONLY tokens it recognizes and DROPS everything else, so a hand-crafted query
 * string cannot put arbitrary text on the page even though the query string is
 * attacker-controllable.
 *
 * The headline table is CLOSED but NOT silent: an unrecognized refusal renders
 * the explicit fallback below rather than nothing, because a refusal that
 * rendered as a blank page would read to the manager as a successful save. The
 * DIFFERENCE between the two behaviours is deliberate — a missing headline
 * misreports the outcome, while a missing per-field diagnostic merely omits one
 * line of advice.
 */

/**
 * The refusal codes the instructed-trainee CREATE outcome can carry.
 *
 * `offering_not_found` is listed for TOTALITY rather than as an expectation: the
 * action routes that one refusal to the safe courses list, exactly as its seven
 * neighbours do, because an id that did not resolve cannot be used to build a URL
 * for this course-scoped route. It is kept in the table so the closed set stays
 * the writer's own set, and so a future caller that DID return here would find a
 * sentence waiting rather than the fallback.
 */
export type ExamInstructedTraineeErrorCode =
  | "definition_does_not_require_instructed_trainee"
  | "assignment_conflict"
  | "trainee_not_eligible"
  | "session_not_found"
  | "plan_not_found"
  | "operation_not_allowed"
  | "offering_not_found"
  | "invalid_input";

/**
 * The input-shape diagnostics an instructed-trainee CREATE submission can
 * produce — EXACTLY two, because the submission carries exactly two fields.
 *
 * The horse diagnostic is deliberately ABSENT rather than unused: this role
 * carries no horse, the form has no such field, and a table that could name one
 * would let a future edit render advice about a control that does not exist.
 */
export type ExamInstructedTraineeIssueCode =
  | "EX-ASG-IN-SESSION-REQUIRED"
  | "EX-ASG-IN-STUDENT-REQUIRED";

/** The one sentence shown after a create that actually wrote a row. */
export const EXAM_INSTRUCTED_TRAINEE_CREATED_TEXT = "החניך המודרך שובץ בהצלחה.";

/**
 * One sentence per refusal, each describing WHAT HAPPENED and what the manager
 * can do — never a database detail, never an id, never a submitted value.
 *
 * `assignment_conflict` deliberately does NOT say which role the existing row
 * holds: naming it would turn a failed create into a read of that row.
 *
 * EX-ASG-MULTIPLICITY narrowed the database key behind it from ROLE-BLIND to
 * `WHERE "role" = 'EXAMINEE'`, precisely so one trainee MAY be a session's
 * examinee and ALSO the instructed trainee of a different examinee of it. Every
 * row this slice writes carries the fixed role INSTRUCTED_TRAINEE, which that
 * predicate excludes, so the refusal is now UNREACHABLE from this surface. The
 * sentence is retained rather than deleted because the writer retains the code as
 * defence in depth, and a mapping table with a hole in it is worse than one with
 * an unused row.
 *
 * `trainee_not_eligible` deliberately does NOT distinguish "no such trainee" from
 * "a trainee of another course" from "a trainee whose enrolment ended", and
 * `session_not_found` is vague for the same reason: the committed writer reports
 * each group identically on purpose, and a message that separated them would be
 * an existence oracle over every other course's roster and schedule.
 */
export const EXAM_INSTRUCTED_TRAINEE_ERROR_TEXT: Readonly<
  Record<ExamInstructedTraineeErrorCode, string>
> = Object.freeze({
  definition_does_not_require_instructed_trainee: "סוג המבחן הזה אינו דורש חניך מודרך.",
  assignment_conflict: "החניך כבר משובץ ביחידת המבחן הזו.",
  trainee_not_eligible: "החניך אינו זמין לשיבוץ בקורס הזה.",
  session_not_found: "יחידת המבחן לא נמצאה.",
  plan_not_found: "תוכנית המבחנים לא נמצאה.",
  operation_not_allowed: "לא ניתן לשנות שיבוצים במצב הקורס הנוכחי.",
  offering_not_found: "הקורס לא נמצא.",
  invalid_input:
    "לא ניתן היה לשמור את שיבוץ החניך המודרך. יש לתקן את הפרטים ולנסות שוב.",
});

/**
 * The per-field diagnostics. The wording matches the committed domain rules in
 * meaning; it is spelled out here for the containment reason in the header.
 *
 * Deliberately NON-ECHOING and deliberately vague about WHY, exactly as the
 * committed table is: a message that distinguished "not a string" from "blank
 * after trimming" would be an oracle over the exact validator and buys a manager
 * nothing, because the correction is the same either way.
 */
export const EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT: Readonly<
  Record<ExamInstructedTraineeIssueCode, string>
> = Object.freeze({
  "EX-ASG-IN-SESSION-REQUIRED": "יש לבחור יחידת מבחן.",
  "EX-ASG-IN-STUDENT-REQUIRED": "יש לבחור חניך.",
});

/** The sentence shown when the server reported a refusal this build predates. */
const UNRECOGNIZED_ERROR_TEXT = "לא ניתן היה לשמור את שיבוץ החניך המודרך.";

function isKnownErrorCode(value: string): value is ExamInstructedTraineeErrorCode {
  return Object.prototype.hasOwnProperty.call(EXAM_INSTRUCTED_TRAINEE_ERROR_TEXT, value);
}

function isKnownIssueCode(value: string): value is ExamInstructedTraineeIssueCode {
  return Object.prototype.hasOwnProperty.call(EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT, value);
}

/**
 * Is this raw query value the exact success token `"1"`?
 *
 * The `typeof` test is load-bearing rather than decorative: a REPEATED query key
 * arrives as an ARRAY, and a loose comparison would let `["1"]` coerce its way to
 * a match. An array must simply not be a recognized token.
 */
export function isExamInstructedTraineeSuccessToken(raw: unknown): boolean {
  return typeof raw === "string" && raw === "1";
}

/**
 * The headline sentence for one raw `instructedTraineeError` token.
 *
 * `null` means "there is nothing to report" and is returned ONLY for a genuinely
 * absent or non-string parameter. An unrecognized token produces the explicit
 * fallback above.
 *
 * Own-property lookup only, so `toString`, `constructor` and every other
 * prototype member read as unknown rather than as a message.
 */
export function examInstructedTraineeErrorText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return isKnownErrorCode(raw)
    ? EXAM_INSTRUCTED_TRAINEE_ERROR_TEXT[raw]
    : UNRECOGNIZED_ERROR_TEXT;
}

/**
 * The per-field sentences for one raw comma-separated `instructedTraineeIssues`
 * token.
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
export function examInstructedTraineeIssueTexts(raw: unknown): readonly string[] {
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
    texts.push(EXAM_INSTRUCTED_TRAINEE_ISSUE_TEXT[code]);
  }
  return texts;
}
