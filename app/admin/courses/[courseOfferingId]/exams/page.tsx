/**
 * EXAM EX-S5B-5B + EXAM PLAN P3 + EXAM EX-S5B-5C + EXAM EX-SES-UI-1 + EXAM
 * EX-SES-UI-2 + EXAM EX-ASG-UI1 — the admin Exams surface of ONE course offering:
 * a read of its ExamDefinition configuration, of its scheduled exam sessions AND
 * of the examinees assigned to them, plus the SEVEN explicit mutation affordances
 * that belong to it.
 *
 * Server Component. The page itself holds no state and renders no form control:
 * every form is a separate client component, and the only mutations it can reach
 * are the seven Server Actions bound below.
 *
 * ===========================================================================
 * WHAT THIS ROUTE MAY MUTATE — AND WHAT IT STILL MAY NOT
 * ===========================================================================
 * EXACTLY SEVEN mutations exist here. The first two are MUTUALLY EXCLUSIVE by the
 * state of the plan; the third additionally requires something to schedule; the
 * next two are PER SESSION and require a session to already exist; the last two
 * are PER ASSIGNMENT and require a session to be there to assign anyone to:
 *
 *   - no plan yet     -> create ONE empty, unpublished ExamPlan;
 *   - plan present    -> append ONE ExamDefinition to it;
 *   - plan + at least
 *     one definition  -> append ONE ExamSession to it;
 *   - per session     -> edit THAT session, or remove THAT session;
 *   - per session     -> assign ONE examinee to it;
 *   - per assignment  -> remove THAT assignment.
 *
 * Editing, removing and reordering definitions, reordering sessions, deleting or
 * publishing the plan, EDITING or REORDERING an assignment, creating an
 * INSTRUCTED_TRAINEE row, breaks, supervisors and source dates are NOT reachable —
 * not disabled, not hidden behind a flag, but absent, with no import that could
 * reach them.
 *
 * All seven mutations are ALWAYS an explicit click on a POST-ing form. The page
 * performs no write, so a plain GET of this route — a refresh, a back button, a
 * prefetch, a bookmark — can never bring a plan, a definition, a session or an
 * assignment into existence, and can never remove one either. No session id and no
 * assignment id appears in any href on this page. There is no effect, no
 * auto-submit and no redirect that writes.
 *
 * ===========================================================================
 * WHAT THE ASSIGNMENT SURFACE MAY AND MAY NOT SAY
 * ===========================================================================
 * The create form collects EXACTLY three values — the session (hidden, fixed by
 * the row it was rendered under), the trainee and the horse. The ROLE is not among
 * them: the committed create core fixes the single EXAMINEE literal and its
 * payload type cannot express another, so this surface writes examinees and
 * nothing else.
 *
 * The LIST, by contrast, is HISTORY and shows every stored row — including an
 * `INSTRUCTED_TRAINEE` row this surface cannot create. Hiding one would make a
 * session look emptier than it is and would disagree with the count beside it.
 *
 * A definition that ALSO demands a lesson topic or a discipline gets no create
 * form: this slice collects neither, and the committed writer refuses the whole
 * create rather than storing a half-filled row. `requiresInstructedTrainee` is
 * deliberately NOT consulted — the instructed trainee is a SECOND row written by a
 * later operation, and it never blocks the examinee.
 *
 * Nothing here renders an identity number, a phone, a parent or guardian contact,
 * a group, a subgroup or any enrolment detail. The committed readers do not select
 * one, so this page could not render one even by mistake.
 *
 * ===========================================================================
 * THE ASSIGNMENT COUNT DECIDES WHAT IS SHOWN, NEVER WHAT IS ALLOWED
 * ===========================================================================
 * Each session's assignment count is read here and used for exactly two display
 * decisions: the delete control renders an explanatory sentence instead of a form
 * when the count is non-zero, and the edit form shows an advisory that the
 * DEFINITION cannot be changed while it is. Both are courtesies.
 *
 * The COUNT from the session reader stays the authority for those two decisions,
 * and the assignment ROWS are used only to render the list. The two come from
 * separate reads, so a create or a removal landing between them can briefly make
 * the count and the visible rows disagree. UI1 invents NO reconciliation for that:
 * the next revalidation resolves it, and a page that quietly "corrected" one read
 * with the other would be inventing a state neither read reported.
 *
 * The count came from a read that has already finished, and an examinee can be
 * assigned a moment later — so it is never sent to a Server Action, never reaches
 * a writer, and never appears in any FormData. The committed writers re-count
 * assignments themselves and carry an atomic `assignments: { none: {} }` condition
 * on the statements that need it, which is what actually decides the outcome.
 *
 * An ARCHIVED offering stays fully READABLE and gains NEITHER affordance. That is
 * decided by the course-lifecycle policy rather than by a hand-written status
 * test — see the gates below — and each server binding independently refuses
 * regardless of what is on screen.
 *
 * A PUBLISHED plan does not lose the definition-create form: whether a published
 * plan may still be configured is the committed lifecycle policy's decision, not
 * this page's, so publication only adds an advisory notice.
 *
 * ===========================================================================
 * THE ORDER
 * ===========================================================================
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering. Only the typed not-found fails closed as `notFound()`,
 *      and it never reflects the requested id back; the auth redirect and every
 *      unexpected error propagate untouched.
 *   2. `assertCourseOperationAllowed(context.status, "HISTORICAL_READ")` — the
 *      course-lifecycle READ gate, on the VERIFIED status. This is the READ gate
 *      and NOT either write gate, so archived exam configuration stays readable.
 *      It is the ONLY gate on this page that can deny the page itself.
 *   3. `readExamDefinitionsForAdmin(context.id)` — with the VERIFIED context id,
 *      never the raw route param.
 *   4. `readAdminExamSessions(context.id)` — the same, for the stored sessions.
 *   5. `readEligibleExamTraineesForAdmin(context.id)` — the same, for the trainees
 *      who may be assigned RIGHT NOW. Asked ONCE for the page: the eligible roster
 *      is a property of the OFFERING, so a per-session read would repeat one query.
 *   6. `readAdminExamAssignments(context.id)` — the same, for every stored
 *      assignment of the plan. Asked ONCE and bucketed in memory below — never
 *      once per session, which would be an N+1 over the session list.
 *   7. `groupAdminExamSessionsByDay(...)` — a PURE grouping of what step 4
 *      returned. It reaches no database, no clock and no locale, and it is the
 *      FINAL ordering authority for what is rendered, so the page never sorts.
 *   8. The in-memory assignment bucketing — a `Map` filled by a `for...of` that
 *      APPENDS in arrival order, which preserves the committed reader's own total
 *      order. The page therefore never sorts, filters, slices or reverses.
 *   9. `evaluateCourseOperationPolicy(context.status, ...)` — the write gate,
 *      asked ONCE as a QUESTION rather than as an assertion, purely to decide
 *      which forms to render. It is pure, total and default-deny, so an unknown
 *      status hides every form instead of exposing any.
 *
 * All four readers independently re-run the admin/offering boundary and the read
 * gate, and each Server Action's committed writer independently re-runs the admin
 * boundary, the offering lookup AND the write gate. Step 9 is therefore a DISPLAY
 * decision only: hiding a form prevents a pointless round trip and is never what
 * makes the write safe.
 *
 * The reads are SEQUENTIAL rather than a `Promise.all`, matching the route flow
 * that was already here: each is wrapped in its own `try` so a typed
 * "that offering does not exist" fails closed as `notFound()` while every other
 * failure keeps its identity and propagates. A combined await would have to
 * re-derive which reader threw before it could preserve that distinction.
 *
 * ===========================================================================
 * `searchParams` IS FEEDBACK ONLY — IT IS NOT SCOPE
 * ===========================================================================
 * The route's `[courseOfferingId]` remains the ONLY thing that decides which
 * course is read or written. No cookie, no current-offering resolver and no form
 * field can influence it. `searchParams` carries CLOSED feedback tokens and
 * nothing else, resolved ONCE, only after authorization and the read:
 *
 *   - `created=1`            — the plan was created by the previous click;
 *   - `existing=1`           — a plan was already there and nothing was touched;
 *   - `error=<code>`         — one of two known plan refusal codes;
 *   - `createdDefinition=1`  — the definition was created;
 *   - `createError=<code>`   — a known definition refusal code;
 *   - `createIssues=<codes>` — known definition validation issue codes;
 *   - `createdSession=1`     — the session was created;
 *   - `sessionError=<code>`  — a known session refusal code;
 *   - `sessionIssues=<codes>`— known session validation issue codes;
 *   - `updatedSession=1`     — a session edit changed something;
 *   - `unchangedSession=1`   — a session edit was a no-op and wrote nothing;
 *   - `sessionEditError=<code>`  — a known session-edit refusal code;
 *   - `sessionEditIssues=<codes>`— known session-edit validation issue codes;
 *   - `deletedSession=1`     — a session was removed;
 *   - `sessionDeleteError=<code>`— a known session-removal refusal code;
 *   - `createdAssignment=1`  — an examinee was assigned;
 *   - `assignmentError=<code>`   — a known assignment-create refusal code;
 *   - `assignmentIssues=<codes>` — known assignment validation issue codes;
 *   - `deletedAssignment=1`  — an assignment was removed;
 *   - `assignmentDeleteError=<code>` — a known assignment-removal refusal code.
 *
 * Every parser here is CLOSED in both directions. `created`, `existing`,
 * `createdDefinition`, `createdSession`, `updatedSession`, `unchangedSession`,
 * `deletedSession`, `createdAssignment` and `deletedAssignment` are honoured only
 * on the exact string `"1"`; `error` only on a key the message table actually
 * OWNS — checked with `Object.hasOwn`, so an inherited property name such as
 * `constructor` cannot select a message — and the definition, session-create,
 * session-edit, session-delete and assignment parsers recognize only their own
 * committed code sets. Every other query value, and every unknown code, is
 * silently IGNORED.
 *
 * The two ASSIGNMENT headline parsers are closed but NOT silent: an unrecognized
 * refusal code renders their module's explicit fallback sentence rather than
 * nothing, because a refusal that renders as a blank page would read to the
 * manager as a successful save. The per-field issue parser still DROPS unknown
 * tokens, which is what keeps arbitrary text off the page.
 *
 * No session id, plan id, definition id, student id, assignment id, horse name or
 * version stamp is ever a query key or a query value. The outcome tokens say WHAT
 * happened and never to WHICH row: a per-row diagnostic would need an id in the
 * URL, and this page does not put one there.
 *
 * A REPEATED query key arrives as an ARRAY, which is why every key is typed
 * `string | string[]` and every check is a `typeof === "string"` comparison: an
 * array must simply not be a recognized token, and a loose comparison would let
 * `["1"]` coerce its way to a match.
 *
 * Nothing read from the query is ever interpolated into the page. Every rendered
 * string is a constant chosen by a parser, so a submitted value cannot be
 * reflected back — the query can only pick a message, never supply one.
 *
 * Structurally, no query value can influence scope: `courseOfferingId` comes from
 * `params`, everything downstream uses the VERIFIED `context.id`, and the parsed
 * feedback reaches nothing but JSX. There is no plan id and no definition id
 * anywhere on this page — the create actions produce them and never reveal them.
 *
 * ===========================================================================
 * WHAT IS SHOWN, AND WHAT IS DELIBERATELY NOT
 * ===========================================================================
 * Each definition renders the manager's own configuration plus how many sessions
 * use it. No database id, no plan id and no `updatedAt` is rendered: the id
 * appears only as a React `key`, which is never text on the page, and the version
 * stamp belongs to a future conditional-edit slice, not to a reader.
 *
 * Each SESSION renders its start time, the exam it is scheduled against, and any
 * title, arena or note the manager wrote — nothing more. Deliberately absent: an
 * END time (this surface derives no duration), the exam kind, the sequence number,
 * waves, slots, capacity and every assignment detail. The assignment COUNT is
 * shown as explanatory text only; the writers, not this page, remain the authority
 * on what that count permits. Every date the plan holds is listed, earliest first,
 * including past ones: this is a configuration surface, not a "what is next" view,
 * so it reads no clock and filters against none.
 *
 * The session id, the definition id and the version stamp are read but are NEVER
 * TEXT. The session id is a React `key` and a hidden form field; the definition id
 * selects the current option of the edit picker and keys the requirement lookup;
 * and `updatedAt` is carried only as a hidden epoch-millisecond concurrency token.
 * None of the three is rendered as visible content, and none appears in an href —
 * which is exactly the narrowing EX-SES-UI-2 makes to the previous "no id and no
 * version stamp exists here at all" rule, and the reason those guards were
 * re-pointed rather than dropped.
 *
 * EX-ASG-UI1 adds two ids under the SAME rule and no third. The assignment id is a
 * React `key` and the removal form's one hidden field; the trainee's `Student.id`
 * is a React `key` and a `<select>` option VALUE in the create form. Neither is
 * ever rendered as text and neither appears in an href. The assignment reader does
 * not even SELECT a `Student.id`, so the only one on this page comes from the
 * eligible-trainee picker, which exists precisely to be submitted back.
 *
 * Each assignment row renders the trainee's display name, the horse — or the ONE
 * fixed placeholder when it is absent, which historical rows may be — and the role
 * label. The order position is read but never shown: it decides sequence, and a
 * visible index would invite someone to treat it as a stable number.
 *
 * Nothing on this page touches Teaching Practice, a trainee, a coach, a child or
 * a parent contact — the reader cannot express any of them, and no such module is
 * imported.
 *
 * The Hebrew exam-kind labels are spelled out LOCALLY rather than imported from
 * the shared label module: that module is still inside the committed EX-C1
 * containment boundary, which forbids a page from naming it. The trade-off is
 * recorded deliberately — a kind added to the enum will render as the explicit
 * unknown text below instead of failing the build here — and both this map and
 * the create form's own option list should collapse back onto the shared table
 * when that boundary is lifted.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  evaluateCourseOperationPolicy,
} from "@/lib/course/operation-policy-core";
import {
  readExamDefinitionsForAdmin,
  type AdminExamDefinitionListView,
} from "@/lib/actions/exam-definition-read-io";
import {
  readAdminExamSessions,
  type AdminExamSessionsView,
} from "@/lib/actions/admin-exam-session-read-io";
import {
  readAdminExamAssignments,
  readEligibleExamTraineesForAdmin,
  type AdminExamAssignmentListView,
  type AdminExamAssignmentRow,
  type EligibleExamTraineeListView,
} from "@/lib/actions/exam-assignment-read-io";
import { groupAdminExamSessionsByDay } from "@/lib/exam/admin-exam-session-grouping-core";
import {
  createExamPlanAction,
  createExamDefinitionAction,
  createExamSessionAction,
  updateExamSessionAction,
  deleteExamSessionAction,
  createExamAssignmentAction,
  deleteExamAssignmentAction,
} from "./actions";
import { ExamPlanCreateForm } from "./ExamPlanCreateForm";
import { ExamDefinitionCreateForm } from "./ExamDefinitionCreateForm";
import { ExamSessionCreateForm } from "./ExamSessionCreateForm";
import { ExamSessionEditForm } from "./ExamSessionEditForm";
import { ExamSessionDeleteForm } from "./ExamSessionDeleteForm";
import { CreateExamAssignmentForm } from "./CreateExamAssignmentForm";
import { DeleteExamAssignmentForm } from "./DeleteExamAssignmentForm";
import {
  examDefinitionCreateErrorText,
  examDefinitionCreateIssueTexts,
} from "./exam-definition-create-error-messages";
import {
  examSessionCreateErrorText,
  examSessionCreateIssueTexts,
} from "./exam-session-create-error-messages";
import {
  examAssignmentCreateErrorText,
  examAssignmentCreateIssueTexts,
  examAssignmentDeleteErrorText,
  isExamAssignmentSuccessToken,
  EXAM_ASSIGNMENT_CREATED_TEXT,
  EXAM_ASSIGNMENT_DELETED_TEXT,
} from "./exam-assignment-messages";

export const dynamic = "force-dynamic";

/**
 * The CLOSED plan-refusal table. A code the plan-create action can actually
 * produce maps to a fixed Hebrew sentence; anything else is ignored entirely
 * rather than falling back to a generic message, so an attacker-chosen `?error=`
 * value cannot make the page display a banner at all.
 *
 * `offering_not_found` is deliberately absent: that refusal never returns to this
 * course-scoped route, because an id that did not resolve cannot be used to build
 * a URL for it. It routes to the courses list instead.
 */
const EXAM_PLAN_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  operation_not_allowed: "לא ניתן ליצור תוכנית מבחנים במצב הנוכחי של הקורס.",
  plan_conflict: "יצירת תוכנית המבחנים לא הושלמה. יש לרענן את הדף ולנסות שוב.",
});

/** What the page may display as plan feedback: a tone and a message it chose itself. */
type PlanFeedback = { tone: "success" | "neutral" | "error"; message: string };

/**
 * Parse the CLOSED plan feedback query. Total, and closed in both directions:
 * every input that is not an exactly-recognized token yields `null`.
 *
 * The `typeof === "string"` checks matter. A repeated query key arrives as an
 * array, and a loose comparison would let `["1"]` coerce its way to a match; an
 * array must simply not be a recognized token. `Object.hasOwn` matters for the
 * same reason on the other side: a plain property lookup would let
 * `?error=constructor` resolve to an inherited value.
 *
 * Nothing from the query reaches the returned message — the strings are constants
 * owned by this module, so a submitted value can never be echoed back.
 */
function feedbackFrom(query: {
  created?: string | string[];
  existing?: string | string[];
  error?: string | string[];
}): PlanFeedback | null {
  if (typeof query.created === "string" && query.created === "1") {
    return { tone: "success", message: "תוכנית המבחנים נוצרה. היא ריקה — עדיין לא הוגדר בה אף מבחן." };
  }
  if (typeof query.existing === "string" && query.existing === "1") {
    return { tone: "neutral", message: "תוכנית מבחנים כבר קיימת לקורס זה. לא בוצע שינוי." };
  }
  if (typeof query.error === "string" && Object.hasOwn(EXAM_PLAN_ERROR_MESSAGES, query.error)) {
    return { tone: "error", message: EXAM_PLAN_ERROR_MESSAGES[query.error] };
  }
  return null;
}

/**
 * The CLOSED session-EDIT refusal table.
 *
 * `offering_not_found` is deliberately absent for the same reason it is absent
 * from the plan table above: that refusal never returns to this course-scoped
 * route, because an id that did not resolve cannot be used to build a URL for it.
 *
 * `definition_change_not_allowed` deliberately does NOT name the definition, the
 * session or how many examinees are assigned. It states the RULE the writer
 * applied, which is the only thing the manager can act on.
 *
 * The Hebrew is spelled out LOCALLY rather than imported from the committed
 * domain tables, for the containment reason recorded in the sibling message
 * module's header: the committed guards forbid any file under `app/` from naming
 * an exam core module, by import OR in prose. The trade-off is stated rather than
 * hidden — a code added to the domain cores will render as no banner at all here
 * until this table learns about it, which is why the actions map every refusal
 * they can produce onto a key that exists below.
 */
const EXAM_SESSION_EDIT_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  session_not_found:
    "מועד הבחינה שנערך אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  definition_change_not_allowed:
    "לא ניתן להחליף את הגדרת המבחן של מועד שכבר משובצים אליו נבחנים. יש להסיר תחילה את השיבוצים.",
  stale_write:
    "מועד הבחינה השתנה מאז שהדף נטען, ולכן העריכה לא נשמרה. יש לרענן את הדף ולנסות שוב.",
  invalid_input: "לא ניתן היה לשמור את השינויים. יש לתקן את הפרטים ולנסות שוב.",
  operation_not_allowed: "לא ניתן לערוך את מועדי המבחנים של קורס בארכיון.",
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן לא ניתן לערוך מועד בחינה. יש לרענן את הדף.",
  definition_not_found:
    "הגדרת הבחינה שנבחרה אינה קיימת בתוכנית המבחנים של קורס זה. יש לרענן את הדף ולבחור שוב.",
});

/**
 * The CLOSED per-field diagnostics a session EDIT can produce: the six shared
 * session-shape codes, plus the one the edit owns for an unusable version token.
 *
 * Deliberately NON-ECHOING and deliberately vague about WHY, exactly as the
 * committed tables are: a message that distinguished "not a string" from "wrongly
 * formatted" would be an oracle over the exact validator and buys a manager
 * nothing, because the correction is the same either way.
 */
const EXAM_SESSION_EDIT_ISSUE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "EX-SES-DEFINITION-REQUIRED": "יש לבחור הגדרת בחינה",
  "EX-SES-DATE-INVALID": "תאריך הבחינה אינו תקין",
  "EX-SES-START-TIME-INVALID": "שעת ההתחלה אינה תקינה (HH:MM)",
  "EX-SES-ARENA-INVALID": "שדה המגרש אינו תקין",
  "EX-SES-TITLE-INVALID": "שדה הכותרת אינו תקין",
  "EX-SES-NOTES-INVALID": "שדה ההערות אינו תקין",
  "EX-SES-VERSION-INVALID": "בקשת העריכה אינה תקינה. יש לרענן את הדף ולנסות שוב",
});

/**
 * The CLOSED session-REMOVAL refusal table.
 *
 * `session_has_assignments` is the one that matters most, and it is why the delete
 * writer must keep its atomic condition even though the page hides the button:
 * this message exists precisely for the case where the button was legitimately
 * shown and an examinee was assigned before the click landed.
 */
const EXAM_SESSION_DELETE_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  session_not_found:
    "מועד הבחינה שנבחר למחיקה אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  session_has_assignments:
    "לא ניתן למחוק מועד בחינה שמשובצים אליו נבחנים. יש להסיר תחילה את השיבוצים.",
  stale_write:
    "מועד הבחינה השתנה מאז שהדף נטען, ולכן המחיקה לא בוצעה. יש לרענן את הדף ולנסות שוב.",
  invalid_input: "בקשת המחיקה אינה תקינה. יש לרענן את הדף ולנסות שוב.",
  operation_not_allowed: "לא ניתן למחוק את מועדי המבחנים של קורס בארכיון.",
  plan_not_found:
    "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין מועד בחינה למחוק. יש לרענן את הדף.",
});

/**
 * A CLOSED success token. Honoured ONLY on the exact string `"1"`.
 *
 * The `typeof` test is load-bearing rather than decorative: a REPEATED query key
 * arrives as an ARRAY, and a loose comparison would let `["1"]` coerce its way to
 * a match. An array must simply not be a recognized token.
 */
function isSuccessToken(raw: string | string[] | undefined): boolean {
  return typeof raw === "string" && raw === "1";
}

/**
 * ONE headline sentence for one raw error token, chosen from a frozen table.
 *
 * `null` means "render nothing". Closed in BOTH directions: a non-string (which is
 * what a repeated key produces), an empty string and any code the table does not
 * OWN all yield `null`. `Object.hasOwn` rather than a plain lookup, so an
 * inherited property name such as `constructor` or `toString` cannot select a
 * message. Nothing from the query reaches the returned string — every message is a
 * constant owned by this module, so a submitted value can never be echoed back.
 */
function closedErrorText(
  table: Readonly<Record<string, string>>,
  raw: string | string[] | undefined,
): string | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return Object.hasOwn(table, raw) ? table[raw] : null;
}

/**
 * The per-field sentences for one raw comma-separated issue token.
 *
 * RECOGNIZED CODES ONLY. An unknown token is DROPPED rather than rendered, which
 * is what makes it impossible to place arbitrary text on the page through the
 * query string. Duplicates collapse, and the table's own order is NOT imposed: the
 * server's order is preserved, so the diagnostics read in the same sequence the
 * domain rules produced them.
 *
 * Total over every input: an array, an empty string, a string of separators and a
 * string of unknown tokens all yield an empty list.
 */
function closedIssueTexts(
  table: Readonly<Record<string, string>>,
  raw: string | string[] | undefined,
): readonly string[] {
  if (typeof raw !== "string" || raw.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const token of raw.split(",")) {
    const code = token.trim();
    if (code.length === 0 || seen.has(code) || !Object.hasOwn(table, code)) {
      continue;
    }
    seen.add(code);
    texts.push(table[code]);
  }
  return texts;
}

/** Tone -> the one banner class set it is allowed to use. */
const FEEDBACK_CLASS: Readonly<Record<PlanFeedback["tone"], string>> = Object.freeze({
  success: "rounded-lg bg-success-muted px-4 py-3 text-sm font-medium text-success",
  neutral: "rounded-lg bg-muted px-4 py-3 text-sm font-medium text-muted-foreground",
  error: "rounded-lg bg-danger-muted px-4 py-3 text-sm font-medium text-danger",
});

/** The Hebrew name of each exam kind. See the header note on why this is local. */
const EXAM_KIND_TEXT: Readonly<Record<string, string>> = Object.freeze({
  INTERFACE_RIDING: "ממשק ורכיבה",
  LUNGE_NO_RIDER: "לונג ללא רוכב",
  ADVANCED_INSTRUCTION: "הדרכת מתקדמים",
  BEGINNER_INSTRUCTION: "הדרכת מתחילים",
});

/**
 * Total and fail-visible: a kind the label map does not know renders as an
 * explicit "unrecognized" sentence rather than leaking a raw enum token or
 * silently rendering a blank cell.
 */
function kindText(kind: string): string {
  return EXAM_KIND_TEXT[kind] ?? "סוג מבחן לא מזוהה";
}

function requirementText(required: boolean): string {
  return required ? "כן" : "לא";
}

/**
 * The Hebrew name of each assignment role.
 *
 * `INSTRUCTED_TRAINEE` is listed because the committed assignment reader is
 * HISTORY and reports every stored row: this surface cannot CREATE such a row,
 * but a row created by a future operation must still be shown rather than
 * silently dropped — a hidden row would make a session look emptier than it is
 * and would disagree with the count beside it.
 */
const EXAM_ROLE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  EXAMINEE: "נבחן/ת",
  INSTRUCTED_TRAINEE: "חניך מודרך",
});

/**
 * Total and fail-visible: a role the label map does not know renders as an
 * explicit "unrecognized" sentence rather than leaking a raw enum token.
 */
function roleText(role: string): string {
  return EXAM_ROLE_TEXT[role] ?? "תפקיד לא מזוהה";
}

/**
 * The safe display placeholder for an assignment with no stored horse.
 *
 * New EXAMINEE rows always carry one — the committed input core refuses a blank —
 * but historical rows may not, and a blank cell would read as a rendering bug
 * rather than as absent data.
 */
const NO_HORSE_TEXT = "—";

function horseText(horseName: string | null): string {
  return horseName === null || horseName.trim().length === 0 ? NO_HORSE_TEXT : horseName;
}

/** The frozen list a session with no assignment renders from. */
const NO_ASSIGNMENTS: readonly AdminExamAssignmentRow[] = Object.freeze([]);

/**
 * The two DEFINITION requirements that decide whether an examinee can be assigned
 * through THIS surface at all. Carried per definition id, from the definition
 * reader the page already loaded — no second query, and no widening of the
 * session reader, which does not report them.
 */
interface AssignmentDefinitionRequirements {
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

/**
 * One label/value pair. A compact responsive grid rather than a ten-column
 * table: a wide table would be unreadable on the phones and tablets this admin
 * area is actually used on.
 */
function DefinitionFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-card-foreground">{value}</dd>
    </div>
  );
}

export default async function CourseExamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<{
    created?: string | string[];
    existing?: string | string[];
    error?: string | string[];
    createdDefinition?: string | string[];
    createError?: string | string[];
    createIssues?: string | string[];
    createdSession?: string | string[];
    sessionError?: string | string[];
    sessionIssues?: string | string[];
    updatedSession?: string | string[];
    unchangedSession?: string | string[];
    sessionEditError?: string | string[];
    sessionEditIssues?: string | string[];
    deletedSession?: string | string[];
    sessionDeleteError?: string | string[];
    createdAssignment?: string | string[];
    assignmentError?: string | string[];
    assignmentIssues?: string | string[];
    deletedAssignment?: string | string[];
    assignmentDeleteError?: string | string[];
  }>;
}) {
  const { courseOfferingId } = await params;

  // 1. Authorize the admin and re-validate EXACTLY this offering first.
  let context: AdminCourseContext;
  try {
    context = await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 2. The course-lifecycle READ gate, on the VERIFIED status.
  assertCourseOperationAllowed(context.status, "HISTORICAL_READ");

  // 3. The read, scoped by the VALIDATED context id only. A typed not-found from
  //    the reader's own re-validation fails closed the same way; every other
  //    failure — including a lifecycle denial — keeps its identity and propagates.
  let view: AdminExamDefinitionListView;
  try {
    view = await readExamDefinitionsForAdmin(context.id);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 4. The stored SESSIONS of the SAME verified offering, through the committed
  //    admin session reader. It re-runs the admin/offering boundary and the read
  //    gate on its own, and like the definition read it is given the VALIDATED
  //    context id and never the raw route param. A typed not-found fails closed
  //    the same way; every other failure keeps its identity and propagates.
  let sessionView: AdminExamSessionsView;
  try {
    sessionView = await readAdminExamSessions(context.id);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 5. The ASSIGNABLE trainees of the SAME verified offering, through the
  //    committed admin picker reader. Like both reads above it re-runs the
  //    admin/offering boundary and the READ gate on its own and is given the
  //    VALIDATED context id, never the raw route param. It is asked ONCE for the
  //    whole page rather than once per session: the eligible roster is a property
  //    of the OFFERING, so a per-session read would be the same query repeated.
  let eligibleView: EligibleExamTraineeListView;
  try {
    eligibleView = await readEligibleExamTraineesForAdmin(context.id);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 6. The STORED assignments of the SAME verified offering, through the
  //    committed admin assignment reader. Asked ONCE for the whole plan and
  //    grouped in memory below — never once per session, which would be an N+1
  //    over the session list.
  let assignmentView: AdminExamAssignmentListView;
  try {
    assignmentView = await readAdminExamAssignments(context.id);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 7. The day grouping. The committed core is the FINAL presentation-order
  //    authority — orderIndex, then start time, then definition name, then session
  //    id — so the page neither sorts nor re-orders what it renders. The core is
  //    total: it never throws, and reports a closed failure arm instead, which the
  //    markup below turns into ONE fixed sentence rather than a raw diagnostic.
  const grouping = groupAdminExamSessionsByDay(sessionView.sessions);

  // 8. The assignment rows, bucketed by the session they belong to. A plain
  //    grouping and nothing else: the committed reader already imposed the total
  //    order — session, then position, then assignment id — and a `for...of` that
  //    appends in arrival order PRESERVES it, which is why the page neither sorts,
  //    filters, slices nor reverses anything here.
  //
  //    No row is dropped. An `INSTRUCTED_TRAINEE` row that this surface cannot
  //    create is bucketed exactly like an examinee, because hiding it would make
  //    a session disagree with its own count.
  const assignmentsBySession = new Map<string, AdminExamAssignmentRow[]>();
  for (const assignment of assignmentView.assignments) {
    const bucket = assignmentsBySession.get(assignment.sessionId);
    if (bucket === undefined) {
      assignmentsBySession.set(assignment.sessionId, [assignment]);
      continue;
    }
    bucket.push(assignment);
  }

  // The two definition requirements that gate the create form, keyed by
  // definition id and taken from the DEFINITION reader already loaded above — no
  // second query, and no widening of the session reader, which reports neither.
  const requirementsByDefinition = new Map<string, AssignmentDefinitionRequirements>();
  for (const definition of view.definitions) {
    requirementsByDefinition.set(definition.id, {
      requiresLessonTopic: definition.requiresLessonTopic,
      requiresDiscipline: definition.requiresDiscipline,
    });
  }

  // 9. The CLOSED feedback query, resolved ONCE and only AFTER authorization and
  //    all four reads. It selects constant messages and influences nothing else —
  //    not any read above, not the back link, not any create affordance.
  const query = await searchParams;
  const feedback = feedbackFrom(query);
  const { createdDefinition, createError, createIssues } = query;
  const createErrorText = examDefinitionCreateErrorText(createError);
  const createIssueTexts = examDefinitionCreateIssueTexts(createIssues);
  const showCreatedNotice = createdDefinition === "1";

  // The session outcome tokens, taken by DESTRUCTURING from that same one resolved
  // query and parsed by the committed route-local table. `createdSession` is
  // honoured only on the exact string "1": a repeated key arrives as an ARRAY, and
  // the `typeof` test is what stops `["1"]` coercing its way to a match. The other
  // two parsers recognize only codes their frozen tables own, so an unknown code
  // and an array alike select nothing. No value from here is ever interpolated.
  const { createdSession, sessionError, sessionIssues } = query;
  const sessionErrorText = examSessionCreateErrorText(sessionError);
  const sessionIssueTexts = examSessionCreateIssueTexts(sessionIssues);
  const showSessionCreatedNotice =
    typeof createdSession === "string" && createdSession === "1";

  // The session EDIT and REMOVAL outcome tokens, destructured from that SAME one
  // resolved query and parsed by the closed route-local tables above. Six more
  // tokens, no more query resolutions, and no value from any of them is ever
  // interpolated: each one can only SELECT a constant sentence, never supply one.
  const {
    updatedSession,
    unchangedSession,
    sessionEditError,
    sessionEditIssues,
    deletedSession,
    sessionDeleteError,
  } = query;
  const showSessionUpdatedNotice = isSuccessToken(updatedSession);
  const showSessionUnchangedNotice = isSuccessToken(unchangedSession);
  const showSessionDeletedNotice = isSuccessToken(deletedSession);
  const sessionEditErrorText = closedErrorText(
    EXAM_SESSION_EDIT_ERROR_MESSAGES,
    sessionEditError,
  );
  const sessionEditIssueTexts = closedIssueTexts(
    EXAM_SESSION_EDIT_ISSUE_MESSAGES,
    sessionEditIssues,
  );
  const sessionDeleteErrorText = closedErrorText(
    EXAM_SESSION_DELETE_ERROR_MESSAGES,
    sessionDeleteError,
  );

  // The ASSIGNMENT outcome tokens, destructured from that SAME one resolved query
  // and parsed by the route-local message module — which is closed in both
  // directions and owns every sentence, so a query value can only SELECT text and
  // never supply it. Five more tokens, no more query resolutions, and none of
  // them is ever interpolated into the page.
  const {
    createdAssignment,
    assignmentError,
    assignmentIssues,
    deletedAssignment,
    assignmentDeleteError,
  } = query;
  const showAssignmentCreatedNotice = isExamAssignmentSuccessToken(createdAssignment);
  const showAssignmentDeletedNotice = isExamAssignmentSuccessToken(deletedAssignment);
  const assignmentErrorText = examAssignmentCreateErrorText(assignmentError);
  const assignmentIssueTexts = examAssignmentCreateIssueTexts(assignmentIssues);
  const assignmentDeleteErrorText = examAssignmentDeleteErrorText(assignmentDeleteError);

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const isPublished = view.publishedAt !== null;
  const hasDefinitions = view.definitions.length > 0;

  // 10. ONE lifecycle evaluation, every display decision derived from it. The gate
  //    is the non-throwing policy question on the VERIFIED status, so an ARCHIVED
  //    offering keeps a readable, affordance-free page instead of an error. Each
  //    server binding re-evaluates the same gate and refuses on its own, so this
  //    can never be the enforcement.
  //
  //    The two affordances are mutually exclusive by CONSTRUCTION and not merely
  //    by position: a plan either exists or it does not, and publication is not
  //    consulted by either flag.
  const mayConfigure = evaluateCourseOperationPolicy(
    context.status,
    "SCHEDULE_DRAFT_CONFIGURATION",
  ).allowed;
  const canCreatePlan = mayConfigure && !view.planExists;
  const showCreateForm = view.planExists && mayConfigure;

  // The THIRD affordance, over the SAME single evaluation. A session must name a
  // stored exam, so this one carries an extra structural precondition the other
  // two do not: with no definition configured there is nothing a session could be
  // scheduled against, and the empty-definitions state below says so instead.
  const showSessionCreateForm =
    sessionView.planExists && view.definitions.length > 0 && mayConfigure;

  // The picker's options come from the DEFINITION reader already loaded above —
  // no second query — narrowed to exactly the three fields the form accepts. The
  // parameter is not named `definition`: the id here legitimately becomes a form
  // value, and the committed guard that pins `definition.id` to its single use as
  // a React key is what keeps it from ever being rendered as text.
  const sessionDefinitionOptions = view.definitions.map((option) => ({
    id: option.id,
    name: option.name,
    kind: option.kind,
  }));

  // The two ASSIGNMENT actions, bound ONCE to the VERIFIED context id and reused
  // by every per-session control below. Hoisted rather than bound inline, for the
  // same reason every other mutation's binding expression appears exactly once in
  // this file: one binding site is one place to check that the id came from
  // `context`, and never from the raw route param.
  const boundCreateAssignmentAction = createExamAssignmentAction.bind(null, context.id);
  const boundDeleteAssignmentAction = deleteExamAssignmentAction.bind(null, context.id);

  return (
    <div className="flex flex-col gap-4">
      {feedback && <div className={FEEDBACK_CLASS[feedback.tone]}>{feedback.message}</div>}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">מבחנים</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          הגדרות המבחנים של הקורס. מוצגות ההגדרות עצמן בלבד — ללא מועדי מבחן, ללא
          שיבוץ נבחנים וללא נתוני חניכים או מדריכים.
        </p>
      </div>

      {showCreatedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">הגדרת המבחן נוספה בהצלחה.</p>
        </div>
      ) : null}

      {createErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{createErrorText}</p>
          {createIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-danger">
              {createIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showSessionCreatedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">מפגש המבחן נוסף בהצלחה.</p>
        </div>
      ) : null}

      {sessionErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{sessionErrorText}</p>
          {sessionIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-danger">
              {sessionIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {showSessionUpdatedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">מועד המבחן עודכן בהצלחה.</p>
        </div>
      ) : null}

      {showSessionUnchangedNotice ? (
        <div className="rounded-xl border border-border bg-muted px-5 py-4">
          <p className="text-sm font-medium text-muted-foreground">
            לא בוצע שינוי במועד המבחן — הפרטים שנשלחו זהים לפרטים השמורים.
          </p>
        </div>
      ) : null}

      {showSessionDeletedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">מועד המבחן נמחק.</p>
        </div>
      ) : null}

      {sessionEditErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{sessionEditErrorText}</p>
          {sessionEditIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-danger">
              {sessionEditIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {sessionDeleteErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{sessionDeleteErrorText}</p>
        </div>
      ) : null}

      {showAssignmentCreatedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">{EXAM_ASSIGNMENT_CREATED_TEXT}</p>
        </div>
      ) : null}

      {showAssignmentDeletedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">{EXAM_ASSIGNMENT_DELETED_TEXT}</p>
        </div>
      ) : null}

      {assignmentErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{assignmentErrorText}</p>
          {assignmentIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-danger">
              {assignmentIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {assignmentDeleteErrorText !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{assignmentDeleteErrorText}</p>
        </div>
      ) : null}

      {!view.planExists ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <h3 className="text-sm font-semibold text-card-foreground">
            עדיין לא נוצרה תוכנית מבחנים לקורס זה
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            אין זו שגיאה — פשוט טרם הוגדרה תוכנית מבחנים עבור הקורס.
          </p>
          {canCreatePlan && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-3 text-sm leading-relaxed text-muted-foreground">
                יצירת התוכנית פותחת מסגרת <strong>ריקה</strong> בלבד: לא נוצר אף
                מבחן, לא נקבע אף מועד ולא מתפרסם דבר. הגדרת המבחנים עצמם נעשית
                בשלב נפרד, ולאחר מכן.
              </p>
              <ExamPlanCreateForm
                action={createExamPlanAction.bind(null, context.id)}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-5 py-4">
            <span className="text-sm text-muted-foreground">מצב תוכנית המבחנים:</span>
            <span
              className={
                isPublished
                  ? "rounded-lg bg-success-muted px-3 py-1 text-sm font-medium text-success"
                  : "rounded-lg bg-muted px-3 py-1 text-sm font-medium text-muted-foreground"
              }
            >
              {isPublished ? "פורסמה" : "טיוטה"}
            </span>
          </div>

          {hasDefinitions ? (
            <ul className="flex flex-col gap-3">
              {view.definitions.map((definition) => (
                <li
                  key={definition.id}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <h3 className="text-sm font-semibold text-card-foreground">
                    {definition.name}
                  </h3>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                    <DefinitionFact label="סוג מבחן" value={kindText(definition.kind)} />
                    <DefinitionFact
                      label="משך"
                      value={`${definition.durationMinutes} דקות`}
                    />
                    <DefinitionFact
                      label="נבחנים במקביל"
                      value={String(definition.parallelCapacity)}
                    />
                    <DefinitionFact
                      label="חניך מודרך נדרש"
                      value={requirementText(definition.requiresInstructedTrainee)}
                    />
                    <DefinitionFact
                      label="נושא שיעור נדרש"
                      value={requirementText(definition.requiresLessonTopic)}
                    />
                    <DefinitionFact
                      label="דיסציפלינה נדרשת"
                      value={requirementText(definition.requiresDiscipline)}
                    />
                    <DefinitionFact
                      label="מפגשים משובצים"
                      value={String(definition.sessionCount)}
                    />
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted p-5">
              <h3 className="text-sm font-semibold text-card-foreground">
                לא הוגדרו מבחנים בתוכנית זו
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                קיימת תוכנית מבחנים לקורס, אך עדיין לא הוגדר בה אף מבחן.
              </p>
            </div>
          )}

          {showCreateForm ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-card-foreground">
                הוספת הגדרת מבחן
              </h3>
              {isPublished ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  שימו לב: תוכנית המבחנים כבר פורסמה. ניתן להוסיף הגדרת מבחן, והיא
                  תיכלל בתוכנית שפורסמה.
                </p>
              ) : null}
              <div className="mt-3">
                <ExamDefinitionCreateForm
                  action={createExamDefinitionAction.bind(null, context.id)}
                />
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-card-foreground">מפגשי המבחנים</h3>
            {grouping.ok ? (
              grouping.days.length > 0 ? (
                <ul className="mt-4 flex flex-col gap-5">
                  {grouping.days.map((day) => (
                    <li key={day.dateKey}>
                      <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
                        <span className="text-sm font-semibold text-card-foreground">
                          {day.dayLabel}
                        </span>
                        <span className="text-xs text-muted-foreground">{day.dateLabel}</span>
                      </div>
                      <ul className="mt-3 flex flex-col gap-2">
                        {day.sessions.map((session) => {
                          // This session's own assignment rows, in the committed
                          // reader's order — the grouping above only bucketed them.
                          // A session nobody is assigned to renders from the ONE
                          // frozen empty list rather than a fresh array.
                          const sessionAssignments =
                            assignmentsBySession.get(session.sessionId) ?? NO_ASSIGNMENTS;

                          // The definition's two extra requirements, from the
                          // definition reader. `undefined` means the session names
                          // a definition the definition reader did not report,
                          // which this page treats as "requirements unknown" and
                          // therefore FAILS CLOSED below: an unknown definition
                          // must not open a write surface.
                          const requirements = requirementsByDefinition.get(
                            session.definitionId,
                          );

                          // A definition that also demands a lesson topic or a
                          // discipline cannot be assigned from UI1: this form
                          // collects neither, and the committed writer refuses the
                          // whole create rather than storing a half-filled row.
                          // `requiresInstructedTrainee` is deliberately NOT
                          // consulted — the instructed trainee is a SECOND row
                          // written by a later operation, and it never blocks the
                          // examinee.
                          const requiresUnsupportedFields =
                            requirements === undefined ||
                            requirements.requiresLessonTopic ||
                            requirements.requiresDiscipline;

                          return (
                          <li
                            key={session.sessionId}
                            className="rounded-lg border border-border bg-muted px-4 py-3"
                          >
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span className="text-sm font-semibold text-card-foreground">
                                {session.startTime}
                              </span>
                              <span className="text-sm text-card-foreground">
                                {session.definitionName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                נבחנים משובצים: {session.assignmentCount}
                              </span>
                            </div>
                            {session.title !== null && session.title !== "" ? (
                              <p className="mt-1 text-sm text-card-foreground">{session.title}</p>
                            ) : null}
                            {session.arena !== null && session.arena !== "" ? (
                              <p className="mt-1 text-xs text-muted-foreground">{session.arena}</p>
                            ) : null}
                            {session.notes !== null && session.notes !== "" ? (
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                                {session.notes}
                              </p>
                            ) : null}

                            {/*
                              THE ASSIGNMENT SECTION.

                              The LIST is rendered whatever the lifecycle allows —
                              an ARCHIVED offering keeps a readable roster, because
                              the committed assignment reader is behind the READ
                              gate and not the write gate. Only the CONTROLS are
                              behind `mayConfigure`.

                              Every row shows the trainee's display name, the horse
                              (or the fixed placeholder) and the role. Deliberately
                              absent: the assignment id, the Student.id and the
                              order position. The id travels only as a hidden field
                              inside the removal form, and the reader never selects
                              a Student.id on this path at all.
                            */}
                            <div className="mt-3 border-t border-border pt-3">
                              <h4 className="text-xs font-semibold text-card-foreground">
                                נבחנים משובצים
                              </h4>
                              {sessionAssignments.length > 0 ? (
                                <ul className="mt-2 flex flex-col gap-1.5">
                                  {sessionAssignments.map((assignment) => (
                                    <li
                                      key={assignment.assignmentId}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-card px-3 py-2"
                                    >
                                      <span className="text-sm text-card-foreground">
                                        {assignment.traineeName}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        סוס: {horseText(assignment.horseName)}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {roleText(assignment.role)}
                                      </span>
                                      {mayConfigure ? (
                                        <DeleteExamAssignmentForm
                                          action={boundDeleteAssignmentAction}
                                          courseOfferingId={context.id}
                                          assignmentId={assignment.assignmentId}
                                        />
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                  עדיין אין חניכים משובצים ליחידת המבחן הזו.
                                </p>
                              )}

                              {mayConfigure ? (
                                requiresUnsupportedFields ? (
                                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                                    סוג מבחן זה דורש פרטים נוספים, ולכן השיבוץ ייפתח
                                    בשלב הבא.
                                  </p>
                                ) : (
                                  <div className="mt-3">
                                    <CreateExamAssignmentForm
                                      action={boundCreateAssignmentAction}
                                      courseOfferingId={context.id}
                                      sessionId={session.sessionId}
                                      eligibleTrainees={eligibleView.trainees}
                                    />
                                  </div>
                                )
                              ) : null}
                            </div>

                            {/*
                              The two PER-SESSION affordances, behind the SAME single
                              lifecycle evaluation the three create forms use. With
                              `mayConfigure` false — an ARCHIVED offering, or any status
                              the default-deny policy does not recognize — neither control
                              is rendered at all. Each server binding re-evaluates the same
                              gate and refuses on its own, so this is a display decision
                              and never the enforcement.

                              `day.dateKey` is the session's own stored day: the grouping
                              core keyed the day by it, so the edit form's date default is
                              the stored value and not a derived one. No clock is read.
                            */}
                            {mayConfigure ? (
                              <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                                <ExamSessionEditForm
                                  action={updateExamSessionAction.bind(null, context.id)}
                                  sessionId={session.sessionId}
                                  expectedUpdatedAt={session.updatedAt}
                                  definitionId={session.definitionId}
                                  date={day.dateKey}
                                  startTime={session.startTime}
                                  arena={session.arena}
                                  title={session.title}
                                  notes={session.notes}
                                  hasAssignments={session.assignmentCount > 0}
                                  definitions={sessionDefinitionOptions}
                                />
                                <ExamSessionDeleteForm
                                  action={deleteExamSessionAction.bind(null, context.id)}
                                  sessionId={session.sessionId}
                                  expectedUpdatedAt={session.updatedAt}
                                  hasAssignments={session.assignmentCount > 0}
                                />
                              </div>
                            ) : null}
                          </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  עדיין לא נוצרו מפגשי מבחנים לקורס הזה.
                </p>
              )
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-danger">
                לא ניתן להציג כרגע את מפגשי המבחנים. יש לבדוק את נתוני המפגשים.
              </p>
            )}
          </div>

          {showSessionCreateForm ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-card-foreground">הוספת מפגש מבחן</h3>
              {isPublished ? (
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  התוכנית כבר פורסמה. מפגש חדש שתוסיפי ייכלל בלוח שפורסם.
                </p>
              ) : null}
              <div className="mt-3">
                <ExamSessionCreateForm
                  action={createExamSessionAction.bind(null, context.id)}
                  definitions={sessionDefinitionOptions}
                />
              </div>
            </div>
          ) : null}
        </>
      )}

      <div>
        <Link
          href={dashboardHref}
          className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          חזרה ללוח הקורס
        </Link>
      </div>
    </div>
  );
}
