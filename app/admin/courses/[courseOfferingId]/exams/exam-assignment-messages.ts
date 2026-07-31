/**
 * EXAM EX-ASG-UI1 — the ROUTE-LOCAL Hebrew wording for the stored exam
 * ASSIGNMENT create and removal outcomes, and the ONLY thing that turns a
 * query-string token into text on this surface.
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
 * for exactly this reason, and the two sibling message modules are the same
 * decision applied to the definition-create and session-create diagnostics;
 * this module is the fourth application of it.
 *
 * The trade-off is stated rather than hidden: a code added to the domain cores
 * will render here as the explicit fallback sentence below instead of failing
 * the build. All four duplications should collapse back onto the shared tables
 * when the containment boundary is lifted, and NOT before — a shared-core
 * refactor is outside this slice.
 *
 * ===========================================================================
 * A CODE IS NEVER A SUBMITTED VALUE
 * ===========================================================================
 * Everything this module accepts is a STABLE TOKEN that the server chose from a
 * closed set — never a session id, a trainee id, an assignment id, a horse name
 * or any other thing a manager typed or chose. `examAssignmentCreateIssueTexts`
 * is the enforcement of that claim and not merely its description: it renders
 * ONLY tokens it recognizes and DROPS everything else, so a hand-crafted query
 * string cannot put arbitrary text on the page even though the query string is
 * attacker-controllable.
 *
 * The two headline tables are CLOSED but NOT silent: an unrecognized refusal
 * renders the explicit fallback below rather than nothing, because a refusal
 * that renders as a blank page would read to the manager as a successful save.
 * The DIFFERENCE between the two behaviours is deliberate — a missing headline
 * misreports the outcome, while a missing per-field diagnostic merely omits one
 * line of advice.
 */

/**
 * The refusal codes the assignment-CREATE outcome can carry.
 *
 * `offering_not_found` is listed for TOTALITY rather than as an expectation:
 * the action routes that one refusal to the safe courses list, exactly as its
 * four neighbours do, because an id that did not resolve cannot be used to build
 * a URL for this course-scoped route. It is kept in the table so the closed set
 * stays the writer's own set, and so a future caller that DID return here would
 * find a sentence waiting rather than the fallback.
 *
 * `definition_requires_unsupported_fields` is kept on the SAME terms, and is now
 * UNREACHABLE from a fresh submission: the create endpoint calls the committed
 * DETAILED writer, which COLLECTS the lesson topic and the branch instead of
 * refusing over them, and whose refusal set does not contain this code at all. It
 * stays because this table's job is to have a sentence ready for whatever token
 * arrives — an older tab, a bookmark or a back button can still carry this one —
 * and a retired code that rendered the generic fallback would tell the manager
 * less than the sentence that already exists for it.
 */
export type ExamAssignmentCreateErrorCode =
  | "invalid_input"
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "trainee_not_eligible"
  | "assignment_conflict"
  | "definition_requires_unsupported_fields";

/** The refusal codes the assignment-REMOVAL outcome can carry. */
export type ExamAssignmentDeleteErrorCode =
  | "invalid_input"
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "assignment_not_found";

/**
 * The input-shape diagnostics an assignment CREATE submission can produce.
 *
 * TWO GENERATIONS, ON PURPOSE. The `EX-ASG-LTD-*` set is what the create endpoint
 * emits today: it calls the committed DETAILED writer, whose five-field input core
 * owns that closed namespace. The `EX-ASG-IN-*` set belongs to the committed
 * three-field writer this route no longer calls.
 *
 * The legacy three are KEPT rather than deleted, and it costs nothing to keep
 * them: a diagnostic travels through the QUERY STRING, so a manager who is holding
 * a page rendered by the previous build — or who simply pressed back — can still
 * arrive here carrying one. Dropping the codes would render that submission's
 * per-field advice as nothing at all, which reads as "no reason given". They are
 * unreachable from a fresh submission, not wrong.
 */
export type ExamAssignmentIssueCode =
  | "EX-ASG-LTD-SESSION-REQUIRED"
  | "EX-ASG-LTD-STUDENT-REQUIRED"
  | "EX-ASG-LTD-HORSE-REQUIRED"
  | "EX-ASG-LTD-TOPIC-REQUIRED"
  | "EX-ASG-LTD-DISCIPLINE-REQUIRED"
  | "EX-ASG-IN-SESSION-REQUIRED"
  | "EX-ASG-IN-STUDENT-REQUIRED"
  | "EX-ASG-IN-HORSE-REQUIRED";

/** The one sentence shown after a create that actually wrote a row. */
export const EXAM_ASSIGNMENT_CREATED_TEXT = "שיבוץ החניך נשמר בהצלחה.";

/** The one sentence shown after a removal that actually deleted a row. */
export const EXAM_ASSIGNMENT_DELETED_TEXT = "השיבוץ הוסר בהצלחה.";

/**
 * One sentence per CREATE refusal, each describing WHAT HAPPENED and what the
 * manager can do — never a database detail, never an id, never a submitted
 * value.
 *
 * `trainee_not_eligible` deliberately does NOT distinguish "no such trainee"
 * from "a trainee of another course" from "a trainee whose enrolment ended".
 * The committed writer reports all of them identically on purpose, and a message
 * that separated them would be an existence oracle over every other course's
 * roster.
 *
 * `session_not_found` is deliberately vague for the same reason: a session
 * belonging to another course's plan and a session that never existed read
 * alike.
 */
export const EXAM_ASSIGNMENT_CREATE_ERROR_TEXT: Readonly<
  Record<ExamAssignmentCreateErrorCode, string>
> = Object.freeze({
  invalid_input: "לא ניתן היה לשמור את השיבוץ. יש לתקן את הפרטים ולנסות שוב.",
  offering_not_found: "הקורס לא נמצא.",
  operation_not_allowed: "לא ניתן לשנות שיבוצים במצב הקורס הנוכחי.",
  plan_not_found: "תוכנית המבחנים לא נמצאה.",
  session_not_found: "יחידת המבחן לא נמצאה.",
  trainee_not_eligible: "החניך אינו זמין לשיבוץ בקורס הזה.",
  assignment_conflict: "החניך כבר משובץ למבחן הזה.",
  definition_requires_unsupported_fields:
    "לא ניתן לשבץ כאן עדיין, משום שסוג המבחן דורש פרטים נוספים.",
});

/**
 * One sentence per REMOVAL refusal.
 *
 * `assignment_not_found` covers both "already removed" and "belongs to another
 * course's plan", which the committed writer reports identically — so the
 * wording names the outcome the manager can act on and nothing else.
 */
export const EXAM_ASSIGNMENT_DELETE_ERROR_TEXT: Readonly<
  Record<ExamAssignmentDeleteErrorCode, string>
> = Object.freeze({
  invalid_input: "לא ניתן היה לזהות את השיבוץ להסרה.",
  offering_not_found: "הקורס לא נמצא.",
  operation_not_allowed: "לא ניתן להסיר שיבוצים במצב הקורס הנוכחי.",
  plan_not_found: "תוכנית המבחנים לא נמצאה.",
  assignment_not_found: "השיבוץ לא נמצא או שכבר הוסר.",
});

/**
 * The per-field diagnostics. The wording matches the committed domain rules in
 * meaning; it is duplicated here for the containment reason in the header.
 *
 * Deliberately NON-ECHOING and deliberately vague about WHY, exactly as the
 * committed table is: a message that distinguished "not a string" from "blank
 * after trimming" would be an oracle over the exact validator and buys a manager
 * nothing, because the correction is the same either way.
 */
export const EXAM_ASSIGNMENT_ISSUE_TEXT: Readonly<
  Record<ExamAssignmentIssueCode, string>
> = Object.freeze({
  "EX-ASG-LTD-SESSION-REQUIRED": "יש לבחור יחידת מבחן.",
  "EX-ASG-LTD-STUDENT-REQUIRED": "יש לבחור חניך.",
  "EX-ASG-LTD-HORSE-REQUIRED": "יש להזין שם סוס.",
  "EX-ASG-LTD-TOPIC-REQUIRED": "יש להזין נושא הדרכה.",
  "EX-ASG-LTD-DISCIPLINE-REQUIRED": "יש להזין ענף.",
  "EX-ASG-IN-SESSION-REQUIRED": "יש לבחור יחידת מבחן.",
  "EX-ASG-IN-STUDENT-REQUIRED": "יש לבחור חניך.",
  "EX-ASG-IN-HORSE-REQUIRED": "יש להזין שם סוס.",
});

/** The sentence shown when the server reported a create refusal this build predates. */
const UNRECOGNIZED_CREATE_ERROR_TEXT = "לא ניתן היה לשמור את השיבוץ.";

/** The sentence shown when the server reported a removal refusal this build predates. */
const UNRECOGNIZED_DELETE_ERROR_TEXT = "לא ניתן היה להסיר את השיבוץ.";

function isKnownCreateErrorCode(value: string): value is ExamAssignmentCreateErrorCode {
  return Object.prototype.hasOwnProperty.call(EXAM_ASSIGNMENT_CREATE_ERROR_TEXT, value);
}

function isKnownDeleteErrorCode(value: string): value is ExamAssignmentDeleteErrorCode {
  return Object.prototype.hasOwnProperty.call(EXAM_ASSIGNMENT_DELETE_ERROR_TEXT, value);
}

function isKnownIssueCode(value: string): value is ExamAssignmentIssueCode {
  return Object.prototype.hasOwnProperty.call(EXAM_ASSIGNMENT_ISSUE_TEXT, value);
}

/**
 * Is this raw query value the exact success token `"1"`?
 *
 * The `typeof` test is load-bearing rather than decorative: a REPEATED query key
 * arrives as an ARRAY, and a loose comparison would let `["1"]` coerce its way to
 * a match. An array must simply not be a recognized token.
 */
export function isExamAssignmentSuccessToken(raw: unknown): boolean {
  return typeof raw === "string" && raw === "1";
}

/**
 * The headline sentence for one raw `assignmentError` token.
 *
 * `null` means "there is nothing to report" and is returned ONLY for a genuinely
 * absent or non-string parameter. An unrecognized token produces the explicit
 * fallback above.
 *
 * Own-property lookup only, so `toString`, `constructor` and every other
 * prototype member read as unknown rather than as a message.
 */
export function examAssignmentCreateErrorText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return isKnownCreateErrorCode(raw)
    ? EXAM_ASSIGNMENT_CREATE_ERROR_TEXT[raw]
    : UNRECOGNIZED_CREATE_ERROR_TEXT;
}

/** The headline sentence for one raw `assignmentDeleteError` token. */
export function examAssignmentDeleteErrorText(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return isKnownDeleteErrorCode(raw)
    ? EXAM_ASSIGNMENT_DELETE_ERROR_TEXT[raw]
    : UNRECOGNIZED_DELETE_ERROR_TEXT;
}

/**
 * The per-field sentences for one raw comma-separated `assignmentIssues` token.
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
export function examAssignmentCreateIssueTexts(raw: unknown): readonly string[] {
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
    texts.push(EXAM_ASSIGNMENT_ISSUE_TEXT[code]);
  }
  return texts;
}
