/**
 * EXAM EX-S5B-5B + EXAM PLAN P3 + EXAM EX-S5B-5C + EXAM EX-SES-UI-1 + EXAM
 * EX-SES-UI-2 + EXAM EX-ASG-UI1 + EXAM EX-ASG-IT2 + EXAM EX-ASG-LTD2-B1 + EXAM
 * EX-PUB-UI-MVP + EXAM EX-PAIR-UI-MVP + EXAM EX-ADMIN-WORKSPACE-UX — the admin
 * Exams WORKSPACE of ONE course offering.
 *
 * Server Component. The page holds NO state and runs NO client code of its own.
 *
 * ===========================================================================
 * WHAT EX-ADMIN-WORKSPACE-UX CHANGED, AND WHAT IT DELIBERATELY DID NOT
 * ===========================================================================
 * This route used to be ONE very long page that mixed exam type definitions,
 * scheduled blocks, assignments and publication into a single scroll. Everything
 * it could do it did all at once, and editing anything meant finding it.
 *
 * It is now FOUR SECTIONS, selected by a `tab` search param and rendered by this
 * same one Server Component: `סוגי מבחנים`, `מופעים וזמנים`, `שיבוצים` and
 * `פרסום`. There is no second route, no layout file, no client state, no
 * `useState`, no accordion and no effect — a section is a query token, so the
 * back button, a refresh and a bookmark all behave exactly as they did.
 *
 * The READS are unchanged: the same five committed readers, in the same order,
 * on the same VERIFIED offering id, whichever section is open. A section decides
 * what is RENDERED and never what is fetched, so no arrangement of tabs can
 * widen what this page can see.
 *
 * ===========================================================================
 * THE THREE SCHEDULE VIEWS ARE ARRANGEMENTS, NEVER COPIES
 * ===========================================================================
 * `לו״ז כללי`, `לפי סוג מבחן` and `לפי תאריך` are three arrangements of the ONE
 * list the committed session reader returned, produced by the route-local pure
 * view module and never persisted. The committed day grouping remains the FINAL
 * ordering authority — the view module preserves arrival order and sorts
 * nothing — so no two views can disagree about what exists or about sequence.
 *
 * Each of them states the same facts about a block, because a manager reading
 * any one of them has to be able to run the day from it: the date, the block's
 * start and its DERIVED end, the personal wave times, how many examinees run in
 * parallel, the place, and the exam type.
 *
 * ===========================================================================
 * THE WAVE OWNS THE TIME — THE EXAMINEE NEVER DOES
 * ===========================================================================
 * Personal times are DERIVED, never stored — and this route DERIVES NONE OF
 * THEM. Every clock value on this page comes from `readAdminExamWaveView`, the
 * admin reading of the committed exam plan pipeline: the same `loadPlan`, the
 * same adapter and the same block timetable core the instructor DTO and the
 * trainee day are built from. The admin schedule therefore shows, by
 * construction, exactly the times everybody else is shown.
 *
 * There is NO exam duration, NO parallel capacity, NO wave index and NO `HH:MM`
 * arithmetic anywhere in this file. The page joins the canonical wave's
 * assignment ids to the rows it already read, and prints the strings it was
 * given.
 *
 * Two examinees examined together are therefore rendered INSIDE ONE WAVE — two
 * columns where there is room, stacked on a phone — with the time printed ONCE
 * on the wave and never repeated inside a card. That is the whole reason the
 * wave is a rendering unit at all.
 *
 * The Hebrew exam-kind labels, the role labels and every sentence on this page
 * are spelled out LOCALLY rather than imported from the shared domain tables,
 * for the containment reason this header has always recorded: the committed
 * guards forbid a file under `app/` from naming an exam core module, by import
 * OR in prose. The wave arithmetic is local for the same reason, and the
 * trade-off is stated rather than hidden.
 *
 * ===========================================================================
 * THE EXAMINEE'S CARD IS THE UNIT OF EDITING
 * ===========================================================================
 * An examinee is now ONE card carrying the person, the horse, the instruction
 * topic, the branch and the ONE instructed trainee they TEACH — saved by ONE
 * button.
 *
 * The instructed trainee gets NO schedule card of its own. The relationship is
 * one-to-one and the examinee owns it, so the standalone pairing form that used
 * to sit under the trainee's row is gone: it was the same link, asked backwards,
 * with a second save button. An instructed trainee that is not linked to anybody
 * yet is still LISTED — under its own explicitly-labelled "not linked" heading,
 * with its removal control — because a row that vanished would make a session
 * look emptier than it is and would disagree with the count beside it.
 *
 * ORDERING is two buttons and a visible position number per card. There is no
 * drag-and-drop: none existed, a pointer-only affordance would be unusable on
 * the phones this admin area is actually used on, and the committed writer
 * expresses a move as one step in one direction.
 *
 * ===========================================================================
 * WHAT THIS ROUTE MAY MUTATE
 * ===========================================================================
 * TWELVE mutations exist here — the ten this route already had, plus the two
 * EX-ADMIN-WORKSPACE-UX adds:
 *
 *   - no plan yet     -> create ONE empty, unpublished ExamPlan;
 *   - plan present    -> append ONE ExamDefinition to it;
 *   - plan + at least
 *     one definition  -> append ONE ExamSession to it;
 *   - per session     -> edit THAT session, or remove THAT session;
 *   - per session     -> assign ONE examinee to it;
 *   - per session     -> assign ONE instructed trainee to it, when that session's
 *                        exam actually asks for one;
 *   - per assignment  -> remove THAT assignment, whatever role it holds;
 *   - draft plan      -> PUBLISH it to the trainees;
 *   - published plan  -> UNPUBLISH it;
 *   - per instructed
 *     trainee         -> PAIR it with ONE examinee of ITS OWN session, or clear
 *                        that one pairing — now submitted from the EXAMINEE's
 *                        card, through the SAME committed writer;
 *   - per examinee    -> SAVE that card's horse, topic, branch and teaching link;
 *   - per examinee    -> MOVE it one position up or down inside its own block.
 *
 * Editing or removing a definition, reordering definitions, reordering sessions,
 * DELETING the plan, moving a person BETWEEN sessions, publishing an INDIVIDUAL
 * session, breaks, supervisors and source dates are still NOT reachable — not
 * disabled, not hidden behind a flag, but absent, with no import that could reach
 * them. Neither is a publication NOTIFICATION or a publication HISTORY.
 *
 * All twelve are ALWAYS an explicit click on a POST-ing form. The page performs
 * no write, so a plain GET of this route — a refresh, a back button, a prefetch,
 * a bookmark, a tab link — can never bring anything into existence, remove
 * anything, publish anything or move anybody. Every tab and view link is a plain
 * `<Link>` carrying ONE closed token and no id whatsoever.
 *
 * ===========================================================================
 * BEGINNER EXAMS ARE A LABELLED HOLE, AND NOTHING ELSE, IN THIS BRANCH
 * ===========================================================================
 * A separate branch is adding a READ-ONLY beginner-exam projection sourced from
 * Teaching Practice. This page therefore renders ONE isolated, explicitly named
 * region for it inside the assignments section, holding a fixed sentence and no
 * data.
 *
 * NOTHING here touches Teaching Practice, a coach, a child or a parent contact:
 * no such module is imported, no reader can express one, and the region below is
 * markup with a constant inside it. When that branch lands, its rows go into
 * that one region — and nothing else on this page has to move. It stays
 * READ-ONLY here: beginner exams are edited on the existing Teaching Practice
 * screen and nowhere else.
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
 *   5. `readEligibleExamTraineesForAdmin(context.id)` — the same, for the
 *      trainees who may be assigned RIGHT NOW. Asked ONCE for the page.
 *   6. `readAdminExamAssignments(context.id)` — the same, for every stored
 *      assignment of the plan. Asked ONCE and bucketed in memory below.
 *   7. `groupAdminExamSessionsByDay(...)` — a PURE grouping of what step 4
 *      returned, and the FINAL ordering authority for everything rendered.
 *   8. The in-memory bucketing — plain `for...of` loops that APPEND in arrival
 *      order, which preserves the committed reader's own total order. The page
 *      never sorts, filters, slices or reverses.
 *   9. `evaluateCourseOperationPolicy(context.status, ...)` — the write gate,
 *      asked ONCE as a QUESTION rather than as an assertion, purely to decide
 *      which forms to render. It is pure, total and default-deny, so an unknown
 *      status hides every form instead of exposing any.
 *
 * All readers independently re-run the admin/offering boundary and the read
 * gate, and each Server Action's committed writer independently re-runs the
 * admin boundary, the offering lookup AND the write gate. Step 9 is therefore a
 * DISPLAY decision only.
 *
 * ===========================================================================
 * `searchParams` IS FEEDBACK AND ARRANGEMENT — IT IS NEVER SCOPE
 * ===========================================================================
 * The route's `[courseOfferingId]` remains the ONLY thing that decides which
 * course is read or written. No cookie, no current-offering resolver and no form
 * field can influence it. `searchParams` carries CLOSED tokens and nothing else,
 * resolved ONCE, only after authorization and the reads:
 *
 *   - `tab=<section>`        — which of the four sections is open;
 *   - `view=<arrangement>`   — which of the three schedule arrangements is shown;
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
 *   - `assignmentDeleteError=<code>` — a known assignment-removal refusal code;
 *   - `createdInstructedTrainee=1` — an instructed trainee was assigned;
 *   - `instructedTraineeError=<code>`  — a known instructed-trainee refusal code;
 *   - `instructedTraineeIssues=<codes>`— known instructed-trainee issue codes;
 *   - `publication=<token>`  — the publication outcome, success or refusal alike;
 *   - `pairing=<token>`      — the pairing outcome, success or refusal alike;
 *   - `assignmentEdit=<token>`      — the card-save outcome;
 *   - `assignmentEditIssues=<codes>`— known card-save field diagnostics;
 *   - `assignmentOrder=<token>`     — the move outcome.
 *
 * `tab` and `view` are ARRANGEMENT and never STATE: both are parsed by closed
 * route-local parsers that fall back to a default, so a hand-typed value can
 * select a section and can never supply one, reach a reader, open an affordance
 * or influence a scope. Neither ever carries an id.
 *
 * Every other parser here is CLOSED in both directions. `created`, `existing`,
 * `createdDefinition`, `createdSession`, `updatedSession`, `unchangedSession`,
 * `deletedSession`, `createdAssignment` and `deletedAssignment` are honoured only
 * on the exact string `"1"`; `error` only on a key the message table actually
 * OWNS — checked with `Object.hasOwn`, so an inherited property name such as
 * `constructor` cannot select a message — and the definition, session-create,
 * session-edit, session-delete and assignment parsers recognize only their own
 * committed code sets. Every other query value, and every unknown code, is
 * silently IGNORED.
 *
 * The two ASSIGNMENT headline parsers, and the two EX-ADMIN-WORKSPACE-UX ones,
 * are closed but NOT silent: an unrecognized refusal code renders an explicit
 * fallback sentence rather than nothing, because a refusal that renders as a
 * blank page would read to the manager as a successful save. The per-field issue
 * parsers still DROP unknown tokens, which is what keeps arbitrary text off the
 * page.
 *
 * A REPEATED query key arrives as an ARRAY, which is why every key is typed
 * `string | string[]` and every check is a `typeof === "string"` comparison.
 *
 * Nothing read from the query is ever interpolated into the page. Every rendered
 * string is a constant chosen by a parser.
 *
 * ===========================================================================
 * IDS, AND WHERE THEY MAY APPEAR
 * ===========================================================================
 * No database id is ever TEXT on this page and none appears in an href — the tab
 * and view links carry a closed token and nothing else.
 *
 * A session id is a React `key` and a hidden form field. A definition id selects
 * the current option of the session edit picker and keys the requirement lookup.
 * An assignment id is a React `key`, a hidden field of the removal, edit and move
 * forms, and an `<option>` VALUE of the teaching-link picker. A `Student.id` is a
 * React `key` and an `<option>` VALUE in the two create forms. `updatedAt` is
 * carried only as a hidden epoch-millisecond concurrency token.
 *
 * The POSITION NUMBER a card now displays is its place in the RENDERED
 * arrangement — `index + 1` — and never the stored `orderIndex`, which stays
 * server-internal: a visible stored index would invite someone to treat it as a
 * stable number, and duplicated positions are explicitly tolerated by the
 * committed create binding.
 *
 * Nothing here renders an identity number, a phone, a parent or guardian
 * contact, a group, a subgroup or any enrolment detail. The committed readers do
 * not select one, so this page could not render one even by mistake.
 *
 * ===========================================================================
 * MOBILE
 * ===========================================================================
 * There is no fixed-width table anywhere on this page, in any section or view.
 * Every arrangement is a stack of cards and responsive grids that collapse to one
 * column, because this admin area is used on phones and tablets and a wide table
 * would be unreadable on them.
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
import { readAdminExamPlan, readAdminExamWaveView } from "@/lib/actions/exam-role-readers";
import type { AdminExamWaveView } from "@/lib/exam/admin-exam-wave-view-core";
import { examBeginnerDatesSupportedForLevel } from "@/lib/actions/admin-exam-source-date-io";
import {
  createExamPlanAction,
  createExamDefinitionAction,
  createExamSessionAction,
  updateExamSessionAction,
  deleteExamSessionAction,
  createExamAssignmentAction,
  deleteExamAssignmentAction,
  createExamInstructedTraineeAssignmentAction,
  setExamPlanPublicationAction,
  updateExamAssignmentDetailsAction,
  moveExamAssignmentAction,
  replaceExamSourceDatesAction,
} from "./actions";
import { ExamPlanCreateForm } from "./ExamPlanCreateForm";
import { ExamDefinitionCreateForm } from "./ExamDefinitionCreateForm";
import { ExamSessionCreateForm } from "./ExamSessionCreateForm";
import { ExamSessionEditForm } from "./ExamSessionEditForm";
import { ExamSessionDeleteForm } from "./ExamSessionDeleteForm";
import { CreateExamAssignmentForm } from "./CreateExamAssignmentForm";
import { DeleteExamAssignmentForm } from "./DeleteExamAssignmentForm";
import { CreateExamInstructedTraineeAssignmentForm } from "./CreateExamInstructedTraineeAssignmentForm";
import { EditExamAssignmentCard } from "./EditExamAssignmentCard";
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
import {
  examInstructedTraineeErrorText,
  examInstructedTraineeIssueTexts,
  isExamInstructedTraineeSuccessToken,
  EXAM_INSTRUCTED_TRAINEE_CREATED_TEXT,
} from "./exam-instructed-trainee-assignment-messages";
import {
  examAssignmentEditFeedback,
  examAssignmentEditIssueTexts,
  examAssignmentOrderFeedback,
  examSourceDatesFeedback,
  examSourceDatesIssueTexts,
} from "./exam-workspace-messages";
import {
  EXAM_WORKSPACE_TABS,
  EXAM_WORKSPACE_TAB_LABELS,
  EXAM_SCHEDULE_VIEWS,
  EXAM_SCHEDULE_VIEW_LABELS,
  resolveExamWorkspaceTab,
  parseExamScheduleView,
  attachExamineesToWaves,
  collectUntimedExaminees,
  buildGeneralTimeline,
  groupTimelineByDefinition,
  orderWorkspaceTimeline,
  groupTimelineByDate,
  parseWorkspaceGroupIndex,
  parseAddAssignmentDisclosure,
  collectDayLabels,
  buildScheduleOverview,
  beginnerRowsOnDate,
  orderBeginnerRows,
  NO_BEGINNER_ROWS,
  type ExamScheduleView,
  type ExamWave,
  type WorkspaceBeginnerRow,
  type WorkspaceExaminee,
} from "./exam-workspace-view";

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
 * `INSTRUCTED_TRAINEE` was listed here before this surface could create such a
 * row, because the committed assignment reader is HISTORY and reports every
 * stored row. The workspace changes WHERE such a row appears — inside the
 * examinee's card when it is linked, under the "not linked" heading when it is
 * not — and never WHETHER it appears.
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
 * The safe display placeholder for a value with nothing stored in it.
 *
 * New EXAMINEE rows always carry a horse — the committed input core refuses a
 * blank — but historical rows may not, and a blank cell would read as a rendering
 * bug rather than as absent data. The same placeholder stands in for a derived
 * time the block's configuration cannot produce.
 */
const NO_HORSE_TEXT = "—";

function horseText(horseName: string | null): string {
  return horseName === null || horseName.trim().length === 0 ? NO_HORSE_TEXT : horseName;
}

/** A derived clock time, or the one fixed placeholder when it cannot be derived. */
function timeText(value: string | null): string {
  return value === null ? NO_HORSE_TEXT : value;
}

/**
 * The two DETAIL labels of an examinee's stored row.
 *
 * The wording is the domain's own and is deliberately NOT the wording the
 * DEFINITION facts above use for the requirement FLAGS: a flag says whether an
 * exam demands such a value, and these two say what was actually stored for one
 * person. Spelling them out locally is the same containment trade-off the exam
 * kind and role labels already record in the header.
 */
const INSTRUCTION_TOPIC_LABEL = "נושא הדרכה";
const DISCIPLINE_LABEL = "ענף";

/**
 * ONE stored detail value, or `null` when there is nothing to show.
 *
 * The presence test is the SAME one the horse uses: `null` and a value that is
 * blank once trimmed are both "nothing stored", because a label followed by an
 * empty run of spaces reads as a rendering bug rather than as data. What is
 * RETURNED is the untrimmed stored string — the reader carries it verbatim and so
 * does this page, so what a manager typed is what a manager sees.
 */
function storedDetailText(value: string | null): string | null {
  return value === null || value.trim().length === 0 ? null : value;
}

/**
 * The two read-only diagnostics for a HISTORICAL row that is missing a value its
 * exam actually demanded.
 *
 * They are sentences this module owns, never anything derived from a stored value,
 * and they carry no id, no name and no instruction to act: they say that something
 * is absent, and the correction now lives on the card beside them.
 */
const MISSING_INSTRUCTION_TOPIC_TEXT = "חסר נושא הדרכה בשיבוץ ההיסטורי הזה.";
const MISSING_DISCIPLINE_TEXT = "חסר ענף בשיבוץ ההיסטורי הזה.";

/** The frozen list a session with no assignment renders from. */
const NO_ASSIGNMENTS: readonly AdminExamAssignmentRow[] = Object.freeze([]);

/** The frozen list a block with no canonical wave renders from. */
const NO_RENDERED_WAVES: readonly ExamWave[] = Object.freeze([]);

/**
 * What a manager is told about examinees the committed timetable produced no
 * moment for — an unresolved block, or a row it could not place.
 *
 * They are still LISTED. A session that hid them would look emptier than it is,
 * and knowing WHO is in a block whose timetable failed is exactly what makes it
 * fixable. No time is invented for them.
 */
const UNTIMED_HEADING = "לא ניתן לחשב שעות אישיות למופע הזה — מוצגים הנבחנים בלבד.";

// ===========================================================================
// EX-PUB-UI-MVP — the publication surface
// ===========================================================================

/**
 * The CLOSED publication outcome table: every token the publication action can
 * put in the query, mapped to a TONE and to ONE fixed Hebrew sentence this module
 * owns.
 *
 * ONE table rather than a success table and an error table, because the action
 * uses ONE query key: a publication has exactly one outcome per submission, and
 * only one publication control can be on screen at a time, so there is no second
 * form whose diagnostic could be rendered above it. The tone is carried here
 * rather than derived from the token's shape, so nothing has to guess whether an
 * unfamiliar literal is a success.
 *
 * `offering_not_found` is deliberately absent, for the same reason it is absent
 * from the plan and session tables above: that refusal never returns to this
 * course-scoped route, because an id that did not resolve cannot be used to build
 * a URL for it. It routes to the courses list instead.
 *
 * The Hebrew is spelled out LOCALLY rather than imported from the committed
 * domain tables, for the containment reason recorded in the header: the committed
 * guards forbid any file under `app/` from naming an exam core module, by import
 * OR in prose.
 */
const EXAM_PUBLICATION_MESSAGES: Readonly<Record<string, PlanFeedback>> = Object.freeze({
  PUBLISHED: { tone: "success", message: "לוח המבחנים פורסם לחניכים." },
  UNPUBLISHED: { tone: "success", message: "פרסום לוח המבחנים בוטל." },
  NO_CHANGE: { tone: "neutral", message: "מצב הפרסום כבר מעודכן." },
  plan_not_found: { tone: "error", message: "לא נמצאה תוכנית מבחנים לפרסום." },
  operation_not_allowed: {
    tone: "error",
    message: "לא ניתן לשנות את מצב הפרסום של הקורס כעת.",
  },
  stale_write: {
    tone: "error",
    message: "מצב הפרסום השתנה בינתיים. יש לרענן ולנסות שוב.",
  },
  unknown_operation: { tone: "error", message: "בקשת הפרסום אינה תקינה." },
});

/**
 * ONE publication banner for one raw token, chosen from the frozen table above.
 *
 * Closed in BOTH directions and total over every input: a non-string (which is
 * what a repeated query key produces), an empty string and any token the table
 * does not OWN all yield `null`, which renders nothing. `Object.hasOwn` rather
 * than a plain lookup, so an inherited property name such as `constructor` cannot
 * select a message. Nothing from the query reaches the returned object — both
 * fields are constants owned by this module, so a submitted value can never be
 * echoed back.
 */
function publicationFeedbackFrom(
  raw: string | string[] | undefined,
): PlanFeedback | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return Object.hasOwn(EXAM_PUBLICATION_MESSAGES, raw)
    ? EXAM_PUBLICATION_MESSAGES[raw]
    : null;
}

/** The two publication states, as the manager is told them. */
const PUBLICATION_DRAFT_TEXT = "טיוטה";
const PUBLICATION_PUBLISHED_TEXT = "פורסם";

/** The two publication controls. */
const PUBLISH_BUTTON_TEXT = "פרסום לחניכים";
const UNPUBLISH_BUTTON_TEXT = "ביטול פרסום";

/**
 * The advisory a PUBLISHED plan carries.
 *
 * INFORMATIONAL ONLY. It disables no control, hides no form and blocks no edit:
 * whether a published plan may still be configured is the committed lifecycle
 * policy's decision and not this page's, exactly as the two existing published-
 * plan advisories on the definition and session forms already record.
 */
const PUBLISHED_WARNING_TEXT =
  "הלוח כבר פורסם לחניכים. שינויים שתבצעי כעת עשויים לשנות את המידע שהם רואים.";

/** What a manager is told when there is no plan to publish yet. */
const NO_PLAN_PUBLICATION_TEXT = "יש ליצור תוכנית מבחנים לפני הפרסום.";

// ===========================================================================
// EX-PAIR-UI-MVP — the pairing outcome vocabulary
// ===========================================================================

/**
 * The CLOSED pairing outcome table: every token a pairing write can put in the
 * query, mapped to a TONE and to ONE fixed Hebrew sentence this module owns.
 *
 * ONE table rather than a success table and an error table, for exactly the
 * reason the publication table above gives: a pairing has ONE outcome per
 * submission, and the banner is PAGE-LEVEL rather than per row — a per-row
 * diagnostic would need an assignment id in the query string, and this page puts
 * none there.
 *
 * EX-ADMIN-WORKSPACE-UX moved the CONTROL onto the examinee's card and left this
 * table exactly where it was, because the same committed writer produces the same
 * outcomes: the card save reports its teaching-link leg through this very token,
 * so not one of these sentences is restated anywhere else.
 *
 * `offering_not_found` is deliberately absent, for the same reason it is absent
 * from every other table here: that refusal never returns to this course-scoped
 * route, because an id that did not resolve cannot be used to build a URL for it.
 *
 * Every sentence is this module's own, states the RULE that was applied, and
 * names NO trainee, NO examinee, NO session and NO id.
 */
const EXAM_PAIRING_MESSAGES: Readonly<Record<string, PlanFeedback>> = Object.freeze({
  PAIRED: { tone: "success", message: "השיוך לנבחן/ת נשמר." },
  UNPAIRED: { tone: "success", message: "השיוך לנבחן/ת הוסר." },
  NO_CHANGE: { tone: "neutral", message: "לא בוצע שינוי בשיוך." },
  plan_not_found: {
    tone: "error",
    message: "לא קיימת תוכנית מבחנים לקורס זה, ולכן אין מה לשייך. יש לרענן את הדף.",
  },
  operation_not_allowed: {
    tone: "error",
    message: "לא ניתן לשנות שיוכים במצב הנוכחי של הקורס.",
  },
  invalid_input: {
    tone: "error",
    message: "בקשת השיוך אינה תקינה. יש לרענן את הדף ולנסות שוב.",
  },
  instructed_assignment_not_found: {
    tone: "error",
    message: "החניך המודרך שנבחר אינו קיים עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  },
  examinee_assignment_not_found: {
    tone: "error",
    message: "הנבחן/ת שנבחר/ה אינו/ה קיים/ת עוד בתוכנית המבחנים של קורס זה. יש לרענן את הדף.",
  },
  instructed_role_mismatch: {
    tone: "error",
    message: "לא ניתן לשייך: השיבוץ שנשלח אינו של חניך מודרך. יש לרענן את הדף.",
  },
  examinee_role_mismatch: {
    tone: "error",
    message: "לא ניתן לשייך: השיבוץ שנבחר אינו של נבחן/ת. יש לרענן את הדף.",
  },
  different_sessions: {
    tone: "error",
    message: "ניתן לשייך רק לנבחן/ת מאותו מפגש מבחן. יש לרענן את הדף ולבחור שוב.",
  },
  ambiguous_pairing_index: {
    tone: "error",
    message: "לא ניתן לקבוע את השיוך: קיימים שיוכים כפולים במפגש הזה. יש לתקן את השיבוצים.",
  },
  /*
    THE ONE-TO-ONE REFUSAL — and it is the BACKEND'S rule, not this page's.

    Nothing here re-implements it. The teaching-link picker still offers every
    instructed trainee of this session, the card still submits ONE selection, and
    the committed pairing writer alone decides whether that selection is allowed.
    Re-deriving the rule in the UI would give a manager a second, drifting
    opinion about what is legal, and would go wrong the moment the backend's
    definition of the conflict changed.

    The sentence names NOTHING: not the conflicting trainee, not the examinee,
    not an assignment id, not a pairing index and not any submitted value. It is
    a constant this module owns, selected by a closed parser, so no value from
    the query or from a submission can be echoed through it. The manager can see
    the card they submitted from, and the correction is the same whoever the
    other party is.

    It reaches the screen through exactly the path every other pairing outcome
    does: the card's save reports its teaching-link leg on the shared `pairing`
    token, and the banner above the workspace renders this sentence.
  */
  examinee_already_paired: {
    tone: "error",
    message: "הנבחן/ת כבר משויך/ת לחניך/ה מודרך/ת אחר/ת.",
  },
  stale_write: {
    tone: "error",
    message: "השיוך השתנה מאז שהדף נטען, ולכן לא נשמר. יש לרענן את הדף ולנסות שוב.",
  },
});

/**
 * ONE pairing banner for one raw token, chosen from the frozen table above.
 *
 * Closed in BOTH directions and total over every input, exactly like the
 * publication parser beside it.
 */
function pairingFeedbackFrom(raw: string | string[] | undefined): PlanFeedback | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }
  return Object.hasOwn(EXAM_PAIRING_MESSAGES, raw) ? EXAM_PAIRING_MESSAGES[raw] : null;
}

/**
 * THE STANDALONE PAIRING FORM IS GONE, AND WHY ITS ACTION IS NOT.
 *
 * EX-PAIR-UI-MVP rendered a picker and a second save button under every
 * INSTRUCTED_TRAINEE row, asking the same one-to-one link backwards. The
 * workspace absorbs that control into the examinee's card, which owns the
 * relationship — so this page no longer renders a pairing form, no longer holds
 * the pairing form's own Hebrew, and no longer binds the standalone pairing
 * action.
 *
 * That committed Server Action is deliberately LEFT IN PLACE rather than
 * deleted: it is an already-reviewed endpoint that re-runs the admin boundary,
 * the offering lookup and the lifecycle gate for itself, and removing a public
 * endpoint is a lifecycle decision of its own rather than a UX one. What is gone
 * is the surface, which is what the workspace was asked to change.
 *
 * The OUTCOME vocabulary above stays exactly where it was, because the card's
 * teaching-link leg calls the SAME committed writer and reports through the SAME
 * query token — so not one of those sentences is duplicated anywhere.
 */

// ===========================================================================
// EX-ADMIN-WORKSPACE-UX — the workspace's own vocabulary
// ===========================================================================

/** The fixed labels of a block's derived timetable facts. */
const BLOCK_DATE_LABEL = "תאריך";
const BLOCK_START_LABEL = "תחילת המופע";
const BLOCK_END_LABEL = "סיום המופע";
const BLOCK_ARENA_LABEL = "מקום";
const BLOCK_KIND_LABEL = "סוג מבחן";
const BLOCK_PARALLEL_LABEL = "נבחנים במקביל";
const BLOCK_ASSIGNED_LABEL = "נבחנים משובצים";
/**
 * THE WAVE HEADING IS A TIME RANGE, AND NOTHING ELSE.
 *
 * There is deliberately no noun in front of it. The internal model still calls a
 * group of simultaneously-examined people a wave — that is the committed
 * timetable core's own vocabulary and it stays — but the WORD meant nothing to
 * the managers reading this screen, who see a time and the people examined at it.
 * This is a display-copy correction only: no derivation, no grouping and no
 * ordering changed with it.
 */
const WAVE_TIME_SEPARATOR = "–";
const POSITION_LABEL = "מיקום";
const MOVE_UP_LABEL = "העלאה בסדר";
const MOVE_DOWN_LABEL = "הורדה בסדר";
const MOVE_UP_GLYPH = "▲";
const MOVE_DOWN_GLYPH = "▼";
const TEACHES_LABEL = "מדריך/ה את";
const NO_TEACHING_LINK_TEXT = "טרם שויך חניך מודרך.";
const UNLINKED_INSTRUCTED_HEADING = "חניכים מודרכים שטרם שויכו לנבחן/ת";
const NO_ARENA_TEXT = "לא צוין מקום";
const EMPTY_BLOCK_TEXT = "עדיין אין נבחנים משובצים למופע הזה.";
const NO_SESSIONS_TEXT = "עדיין לא נוצרו מפגשי מבחנים לקורס הזה.";
const GROUPING_FAILED_TEXT =
  "לא ניתן להציג כרגע את מפגשי המבחנים. יש לבדוק את נתוני המפגשים.";

/**
 * The BEGINNER-EXAM region's heading.
 *
 * Its old single "these will be shown here read-only" sentence is GONE, replaced
 * by the THREE distinguishable states below: a course level that has no beginner
 * exams at all, a plan that has selected no Teaching-Practice days, and a plan
 * whose selected days hold no lessons. One sentence could not tell those apart,
 * and each has a different fix.
 */
const BEGINNER_REGION_HEADING = "מבחני מתחילים";


/**
 * The rule the region states WHATEVER it holds: these rows are a PROJECTION of
 * Teaching Practice and are corrected there, never here. It is rendered beside
 * the rows as well as instead of them, so the read-only rule does not disappear
 * the moment the region stops being empty.
 */
/** The labels one beginner row and one beginner child are described by. */
const BEGINNER_GROUP_LABEL = "\u05e7\u05d1\u05d5\u05e6\u05d4";
const BEGINNER_RESPONSIBLE_LABEL = "\u05de\u05d3\u05e8\u05d9\u05da/\u05d4 \u05d0\u05d7\u05e8\u05d0\u05d9/\u05ea";
const BEGINNER_PARTICIPANTS_LABEL = "\u05de\u05e9\u05ea\u05ea\u05e4\u05d9\u05dd";
const BEGINNER_AGE_LABEL = "\u05d2\u05d9\u05dc";
const BEGINNER_PARENT_LABEL = "\u05d4\u05d5\u05e8\u05d4";
const BEGINNER_PARENT_PHONE_LABEL = "\u05d8\u05dc\u05e4\u05d5\u05df \u05d4\u05d5\u05e8\u05d4";
const BEGINNER_ABSENT_TEXT = "\u05e0\u05e2\u05d3\u05e8/\u05ea";
const BEGINNER_DRAFT_TEXT = "\u05d4\u05e9\u05d9\u05e2\u05d5\u05e8 \u05d8\u05e8\u05dd \u05e4\u05d5\u05e8\u05e1\u05dd";

/**
 * ONE optional text value, or the caller's own placeholder.
 *
 * A blank once trimmed is "nothing stored", because a label followed by an empty
 * run of spaces reads as a rendering bug rather than as data.
 */
function presentTextOr(value: string | null, placeholder: string): string {
  return value === null || value.trim().length === 0 ? placeholder : value;
}

const BEGINNER_READ_ONLY_TEXT =
  "מבחני מתחילים הם תצוגה בלבד. כל שינוי נעשה במסך התרגול המעשי.";

// ===========================================================================
// EX-ADMIN-SRCDATE — the source-date selection surface
// ===========================================================================

/**
 * THE MISSING LINK, STATED PLAINLY.
 *
 * Beginner exams are a LIVE PROJECTION of Teaching Practice, and the exam plan
 * stores exactly one beginner fact: which Teaching-Practice DAYS it runs as exam
 * days. Until this control existed nothing in the product could write that fact,
 * so every plan held an empty selection and the read pipeline projected NO
 * beginner rows anywhere. The rows were not hidden by this page — they never
 * existed.
 *
 * The control below is the smallest thing that fixes it: a list of the days the
 * plan currently selects, each with a checkbox, and one field for adding a day.
 * The submission is the COMPLETE set, so unchecking a day removes it and there is
 * no second endpoint that could disagree about what is selected.
 *
 * IT CREATES NO TEACHING-PRACTICE DATA. It selects days that already have
 * lessons; the committed writer refuses a day that has none. Nothing about a
 * lesson, a child, a horse or a contact is written, copied or duplicated, and
 * editing any of that stays on the Teaching-Practice screen exactly as before.
 */
const SOURCE_DATES_HEADING = "תאריכי מבחני מתחילים";
const SOURCE_DATES_INTRO =
  "מבחני המתחילים נגזרים מהתרגול המעשי. יש לבחור כאן את ימי התרגול המעשי שמתקיימים בהם מבחני מתחילים — רק ימים שנבחרו יופיעו בלוח.";
const SOURCE_DATES_SELECTED_LABEL = "ימים שנבחרו";
const SOURCE_DATES_KEEP_LABEL = "נבחר";
const SOURCE_DATES_ADD_LABEL = "הוספת יום תרגול מעשי";
const SOURCE_DATES_SAVE_TEXT = "שמירת התאריכים";
const SOURCE_DATES_NONE_TEXT = "טרם נבחרו ימי תרגול מעשי עבור מבחני המתחילים.";
const SOURCE_DATES_UNCHECK_HINT =
  "הסרת הסימון מיום מסירה אותו מהרשימה בעת השמירה. שמירה ללא ימים מסומנים מבטלת את כל מבחני המתחילים בתוכנית.";

/**
 * The THREE states a manager must be able to tell apart, and why each exists.
 *
 * They are genuinely different problems with genuinely different fixes, and a
 * single "no beginner exams" sentence would send a manager looking for the wrong
 * one:
 *
 *  - the course LEVEL has no beginner exams at all — nothing to configure, and no
 *    selection could ever help;
 *  - no day is SELECTED — the fix is the control above;
 *  - days are selected but no Teaching-Practice lesson was found on them — the
 *    fix is on the Teaching-Practice screen, or the wrong days were chosen.
 */
const BEGINNER_LEVEL_UNSUPPORTED_TEXT =
  "ברמת הקורס הזו אין מבחני מתחילים, ולכן אין תאריכים לבחור ולא יוצגו שיעורים.";
const BEGINNER_NO_SOURCE_DATES_TEXT =
  "לא נבחרו ימי תרגול מעשי, ולכן אין מבחני מתחילים בלוח. הבחירה נעשית בלשונית מופעים וזמנים.";
const BEGINNER_NO_MATCHING_LESSONS_TEXT =
  "נבחרו ימי תרגול מעשי, אך לא נמצאו בהם שיעורי תרגול מעשי. יש לבדוק את התאריכים או את מסך התרגול המעשי.";

/**
 * The two ARRANGEMENT sentences. Neither is an empty state: beginner lessons
 * exist and are being shown somewhere else on the manager's own screen.
 */
const BEGINNER_IN_GENERAL_VIEW_TEXT =
  "שעות מבחני המתחילים מופיעות בלו״ז הכללי למעלה. הפרטים המלאים מוצגים בתצוגות לפי סוג מבחן ולפי תאריך.";
const BEGINNER_NONE_IN_VIEW_TEXT = "אין מבחני מתחילים בתאריך שנבחר.";

// ===========================================================================
// EX-ADMIN-UX-FIXES — the assignments disclosure
// ===========================================================================

/**
 * THE ADD-ASSIGNMENT CONTROL, AND WHY IT IS A LINK RATHER THAN A FORM.
 *
 * The create forms used to sit permanently open under every block, at the bottom
 * of a page that can run to many screens. They are now CLOSED BY DEFAULT and
 * opened by one control at the TOP of the assignments workspace, which carries a
 * closed disclosure token and no id.
 *
 * A `<Link>` and not a button: opening a form is a NAVIGATION and never a write,
 * so a GET of it — a refresh, a back button, a bookmark — must be able to do
 * exactly what it does here, which is render the same page with one more section
 * visible. The forms themselves are unchanged and still sit behind the same
 * lifecycle gate.
 */
const ADD_ASSIGNMENT_OPEN_TEXT = "הוספת שיבוץ";
const ADD_ASSIGNMENT_CLOSE_TEXT = "סגירת טופס השיבוץ";
const ADD_ASSIGNMENT_HINT_TEXT =
  "טופס השיבוץ נפתח מתחת לכל מופע המוצג כעת. לסיום יש לסגור אותו.";

/** What the general view tells a manager who came looking for the roster. */
const GENERAL_VIEW_READ_ONLY_TEXT =
  "לו״ז כללי הוא תצוגת מבנה היום בלבד. לשיבוץ נבחנים יש לעבור ללפי סוג מבחן או ללפי תאריך.";
const GENERAL_VIEW_BEGINNER_LABEL = "מבחן מתחילים";
const NO_SCHEDULE_ENTRIES_TEXT = "אין עדיין מופעים או שיעורי מתחילים להצגה.";

/**
 * The DEFINITION facts that decide what a session may show and offer.
 *
 * Carried per definition id, from the definition reader the page already loaded —
 * no second query, and no widening of the session reader, which reports none of
 * them.
 *
 * The first two decide whether an EXAMINEE can be assigned through this surface
 * at all. The third is read only by the instructed-trainee affordance: the two
 * gates are separate on purpose, because a definition that demands a lesson topic
 * still legitimately wants its instructed trainee. The last three are what the
 * wave derivation and the block facts need.
 */
/**
 * The narrow shape every arrangement needs of ONE scheduled block.
 *
 * Structural rather than imported, and deliberately so: the committed session
 * reader's row and the committed day grouping's row are two different types with
 * the same facts in them, and both arrangements below have to render from either.
 * Naming exactly the eight fields the workspace uses is what lets one component
 * serve both without either reader widening.
 */
interface WorkspaceBlockFacts {
  readonly sessionId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly startTime: string;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly assignmentCount: number;
}

interface AssignmentDefinitionRequirements {
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly requiresInstructedTrainee: boolean;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly kind: string;
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

/**
 * The facts every schedule view states about ONE block, so a manager can run the
 * day from whichever arrangement they happen to be reading.
 *
 * A responsive grid and never a table: it collapses to two columns on a phone.
 */
function BlockFacts({
  dateLabel,
  dayLabel,
  startTime,
  endTime,
  arena,
  kind,
  parallelCapacity,
  assignmentCount,
}: {
  dateLabel: string;
  dayLabel: string;
  startTime: string;
  endTime: string | null;
  arena: string | null;
  kind: string;
  parallelCapacity: number;
  assignmentCount: number;
}) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
      <DefinitionFact label={BLOCK_DATE_LABEL} value={`${dayLabel} ${dateLabel}`} />
      <DefinitionFact label={BLOCK_START_LABEL} value={startTime} />
      <DefinitionFact label={BLOCK_END_LABEL} value={timeText(endTime)} />
      <DefinitionFact label={BLOCK_KIND_LABEL} value={kind} />
      <DefinitionFact
        label={BLOCK_ARENA_LABEL}
        value={arena === null || arena === "" ? NO_ARENA_TEXT : arena}
      />
      <DefinitionFact label={BLOCK_PARALLEL_LABEL} value={String(parallelCapacity)} />
      <DefinitionFact label={BLOCK_ASSIGNED_LABEL} value={String(assignmentCount)} />
    </dl>
  );
}

/**
 * ONE wave, READ-ONLY: the time printed ONCE, and the people examined at it.
 *
 * Two columns where there is room and a single stack on a phone, which is exactly
 * why the time lives on the wave header and never inside a person's entry: a
 * parallel pair would otherwise print the same clock time twice.
 *
 * The instructed trainee a person teaches is named INSIDE that person's entry and
 * never as an entry of its own — it is examined alongside them and holds no slot.
 */
function ReadOnlyWave({
  wave,
  showTeachingLink,
}: {
  wave: ExamWave;
  showTeachingLink: boolean;
}) {
  return (
    <li className="rounded-lg border border-border bg-muted px-3 py-2">
      {/* THE TIME RANGE, AND NO NOUN IN FRONT OF IT. See WAVE_TIME_SEPARATOR. */}
      <p className="text-xs font-semibold text-card-foreground">
        {wave.startTime} {WAVE_TIME_SEPARATOR} {timeText(wave.endTime)}
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {wave.examinees.map((examinee) => (
          <li key={examinee.assignmentId} className="rounded-lg bg-card px-3 py-2">
            <p className="text-sm text-card-foreground">{examinee.traineeName}</p>
            <p className="text-xs text-muted-foreground">סוס: {horseText(examinee.horseName)}</p>
            {storedDetailText(examinee.instructionTopic) !== null ? (
              <p className="text-xs text-muted-foreground">
                {INSTRUCTION_TOPIC_LABEL}: {storedDetailText(examinee.instructionTopic)}
              </p>
            ) : null}
            {storedDetailText(examinee.discipline) !== null ? (
              <p className="text-xs text-muted-foreground">
                {DISCIPLINE_LABEL}: {storedDetailText(examinee.discipline)}
              </p>
            ) : null}
            {/*
              THE TEACHING LINK, ONLY WHERE THE EXAM ASKS FOR ONE.

              Gated on the DEFINITION's own requirement flag, or on this one
              person already carrying a stored link — never on the mere presence
              of an instructed-trainee row in the session, which would print an
              empty, meaningless field on a riding or interface block.
            */}
            {showTeachingLink || examinee.instructedTraineeName !== null ? (
              <p className="text-xs text-muted-foreground">
                {TEACHES_LABEL}:{" "}
                {examinee.instructedTraineeName ?? NO_TEACHING_LINK_TEXT}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

export default async function CourseExamsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseOfferingId: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    view?: string | string[];
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
    createdInstructedTrainee?: string | string[];
    instructedTraineeError?: string | string[];
    instructedTraineeIssues?: string | string[];
    publication?: string | string[];
    pairing?: string | string[];
    assignmentEdit?: string | string[];
    assignmentEditIssues?: string | string[];
    assignmentOrder?: string | string[];
    // EX-ADMIN-UX-FIXES — ARRANGEMENT and DISCLOSURE only. `group` is an ORDINAL
    // into whichever sub-tab list is on screen and never an id; `add` is the
    // closed "1" that opens the create forms. Neither reaches a reader, opens a
    // gate or influences a scope.
    group?: string | string[];
    add?: string | string[];
    // EX-ADMIN-SRCDATE — the source-date replacement outcome, and its closed
    // per-rule diagnostics.
    sourceDates?: string | string[];
    sourceDateIssues?: string | string[];
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
  //    context id and never the raw route param.
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
  //    committed admin picker reader. Asked ONCE for the whole page rather than
  //    once per session: the eligible roster is a property of the OFFERING.
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

  // 6b. The CANONICAL derived timetable of the SAME verified offering, through
  //     the admin reading of the committed exam plan pipeline. This is the ONLY
  //     source of a clock value on this page: it runs the same `loadPlan`, the
  //     same adapter and the same block timetable core the instructor DTO and
  //     the trainee day are built from, so the admin schedule shows exactly the
  //     times everybody else is shown. It publishes assignment ids and derived
  //     moments and nothing else — no student id, no pairing index, no name.
  let waveView: AdminExamWaveView;
  try {
    waveView = await readAdminExamWaveView(context.id);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      notFound();
    }
    throw error;
  }

  // 6c. The CANONICAL ADMIN READING of the same verified offering. It is the one
  //     source of BEGINNER rows: the merged pipeline gates beginner
  //     Teaching-Practice reads to Level 1 in the loader, so a Level-2 offering
  //     receives none and this page adds no second level test of its own. No
  //     second query, no Teaching-Practice import and no writer is reached.
  // Typed FROM THE READER rather than from the narrowing module: the committed
  // contract allows exactly one production module to name the read DTO, so that
  // narrowing stays in one place. Naming the reader's own return type asks for
  // precisely the rows this page is allowed to receive, and reaches nothing else.
  let planView: Awaited<ReturnType<typeof readAdminExamPlan>>;
  try {
    planView = await readAdminExamPlan(context.id);
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

  // 8. The assignment rows, bucketed by the session they belong to, and by role.
  //    A plain grouping and nothing else: the committed reader already imposed the
  //    total order — session, then position, then assignment id — and a `for...of`
  //    that appends in arrival order PRESERVES it, which is why the page neither
  //    sorts, filters, slices nor reverses anything here.
  //
  //    THREE buckets are filled in the SAME single pass. The EXAMINEE bucket is
  //    what the waves are dealt from and what the position numbers count within;
  //    the INSTRUCTED bucket is what the teaching-link picker offers, so "only
  //    trainees of THIS session" is a property of the DATA STRUCTURE rather than
  //    of a comparison somebody could later delete; and the `teaches` map answers,
  //    for one examinee, WHICH trainee it teaches — read from the committed
  //    reader's own resolved pairing and from nothing else.
  //
  //    No row is dropped. An instructed trainee that no examinee teaches is still
  //    listed under its own heading, because hiding it would make a session
  //    disagree with its own count.
  const examineesBySession = new Map<string, AdminExamAssignmentRow[]>();
  const instructedBySession = new Map<string, AdminExamAssignmentRow[]>();
  const teachesByExaminee = new Map<string, AdminExamAssignmentRow>();
  for (const assignment of assignmentView.assignments) {
    if (assignment.role === "EXAMINEE") {
      const examinees = examineesBySession.get(assignment.sessionId);
      if (examinees === undefined) {
        examineesBySession.set(assignment.sessionId, [assignment]);
      } else {
        examinees.push(assignment);
      }
      continue;
    }
    const instructed = instructedBySession.get(assignment.sessionId);
    if (instructed === undefined) {
      instructedBySession.set(assignment.sessionId, [assignment]);
    } else {
      instructed.push(assignment);
    }
    if (assignment.pairedExamineeAssignmentId !== null) {
      teachesByExaminee.set(assignment.pairedExamineeAssignmentId, assignment);
    }
  }

  // The definition facts that gate the affordances and feed the wave derivation,
  // keyed by definition id and taken from the DEFINITION reader already loaded
  // above — no second query, and no widening of the session reader.
  const requirementsByDefinition = new Map<string, AssignmentDefinitionRequirements>();
  for (const definition of view.definitions) {
    requirementsByDefinition.set(definition.id, {
      requiresLessonTopic: definition.requiresLessonTopic,
      requiresDiscipline: definition.requiresDiscipline,
      requiresInstructedTrainee: definition.requiresInstructedTrainee,
      durationMinutes: definition.durationMinutes,
      parallelCapacity: definition.parallelCapacity,
      kind: definition.kind,
    });
  }

  // 9. The CLOSED feedback query, resolved ONCE and only AFTER authorization and
  //    all four reads. It selects constant messages and the open section, and
  //    influences nothing else — not any read above, not the back link, not any
  //    create affordance and not any scope.
  const query = await searchParams;
  const feedback = feedbackFrom(query);
  const { createdDefinition, createError, createIssues } = query;
  const createErrorText = examDefinitionCreateErrorText(createError);
  const createIssueTexts = examDefinitionCreateIssueTexts(createIssues);
  const showCreatedNotice = createdDefinition === "1";

  // The session outcome tokens, taken by DESTRUCTURING from that same one resolved
  // query and parsed by the committed route-local table. `createdSession` is
  // honoured only on the exact string "1": a repeated key arrives as an ARRAY, and
  // the `typeof` test is what stops `["1"]` coercing its way to a match.
  const { createdSession, sessionError, sessionIssues } = query;
  const sessionErrorText = examSessionCreateErrorText(sessionError);
  const sessionIssueTexts = examSessionCreateIssueTexts(sessionIssues);
  const showSessionCreatedNotice =
    typeof createdSession === "string" && createdSession === "1";

  // The session EDIT and REMOVAL outcome tokens, destructured from that SAME one
  // resolved query and parsed by the closed route-local tables above.
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
  // never supply it.
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

  // The INSTRUCTED-TRAINEE outcome tokens, destructured from that SAME one
  // resolved query and parsed by their own closed route-local message module.
  const {
    createdInstructedTrainee,
    instructedTraineeError,
    instructedTraineeIssues,
  } = query;
  const showInstructedTraineeCreatedNotice = isExamInstructedTraineeSuccessToken(
    createdInstructedTrainee,
  );
  const instructedTraineeErrorTextValue =
    examInstructedTraineeErrorText(instructedTraineeError);
  const instructedTraineeIssueTexts =
    examInstructedTraineeIssueTexts(instructedTraineeIssues);

  // The PUBLICATION outcome token, destructured from that SAME one resolved query
  // and parsed by the closed route-local table above. It influences NO read, no
  // affordance and no scope — the publication STATE the controls below are derived
  // from comes from the database, never from here.
  const { publication } = query;
  const publicationFeedback = publicationFeedbackFrom(publication);

  // The PAIRING outcome token. It is FEEDBACK and never STATE: which trainee each
  // card pre-selects comes from the committed reader's own resolved answer, so a
  // hand-typed `?pairing=PAIRED` changes what one banner says and nothing else.
  const { pairing } = query;
  const pairingFeedback = pairingFeedbackFrom(pairing);

  // EX-ADMIN-WORKSPACE-UX's own two outcome families, parsed by the closed
  // route-local workspace message module. Neither is ever interpolated: each can
  // only SELECT a constant sentence and a constant tone, never supply either.
  const { assignmentEdit, assignmentEditIssues, assignmentOrder } = query;
  const assignmentEditFeedback = examAssignmentEditFeedback(assignmentEdit);
  const assignmentEditIssueTexts = examAssignmentEditIssueTexts(assignmentEditIssues);
  const assignmentOrderFeedback = examAssignmentOrderFeedback(assignmentOrder);

  // EX-ADMIN-SRCDATE's outcome family, parsed by the same closed route-local
  // module. Neither token is ever interpolated: each can only SELECT a constant
  // sentence and a constant tone, never supply either — so a submitted date can
  // never be echoed back onto the screen through a banner.
  const { sourceDates, sourceDateIssues } = query;
  const sourceDatesFeedback = examSourceDatesFeedback(sourceDates);
  const sourceDatesIssueTexts = examSourceDatesIssueTexts(sourceDateIssues);

  /**
   * THE BEGINNER ROWS — a projection of Teaching Practice, read-only here.
   *
   * Taken from the committed admin reading's own rows, narrowed to the fields
   * this screen renders. `row.source === "BEGINNER"` is the DTO's own
   * discriminator and the only test applied: WHICH beginner rows exist is the
   * merged loader's Level-1 containment decision, and re-checking the level here
   * would be a second opinion about a rule this route does not own.
   */
  const beginnerRows: readonly WorkspaceBeginnerRow[] = planView.rows
    .filter((row) => row.source === "BEGINNER" && row.beginner !== null)
    .map((row) => {
      const detail = row.beginner as NonNullable<typeof row.beginner>;
      return {
        sessionId: row.sessionId,
        date: row.date,
        startTime: row.startTime,
        displayEndTime: row.displayEndTime,
        beginnerFormat: detail.beginnerFormat,
        groupName: detail.groupName,
        location: detail.location,
        responsibleInstructorName: detail.responsibleInstructorName,
        participantNames: detail.participantNames,
        participantCount: detail.participantCount,
        children: detail.children.map((child) => ({
          fullName: child.fullName,
          age: child.age,
          gender: child.gender,
          childNotes: child.childNotes,
          parentName: child.parentName,
          parentPhone: child.parentPhone,
          horseName: child.horseName,
          equipmentNotes: child.equipmentNotes,
          isAbsent: child.isAbsent,
        })),
        notes: detail.notes,
        isPublished: detail.isPublished,
      };
    });

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const examsPath = `${dashboardHref}/exams`;
  const isPublished = view.publishedAt !== null;
  const hasDefinitions = view.definitions.length > 0;

  // WHICH SECTION IS OPEN. An explicit `tab` the manager clicked wins; otherwise
  // the family of feedback that came back decides, so a manager who published
  // lands on the publication section and one who saved a card lands back among
  // the assignments — WITHOUT any of the ten committed redirects changing.
  const activeTab = resolveExamWorkspaceTab({
    explicit: query.tab,
    hasDefinitionFeedback: showCreatedNotice || createErrorText !== null,
    hasScheduleFeedback:
      showSessionCreatedNotice ||
      showSessionUpdatedNotice ||
      showSessionUnchangedNotice ||
      showSessionDeletedNotice ||
      sessionErrorText !== null ||
      sessionEditErrorText !== null ||
      sessionDeleteErrorText !== null,
    hasAssignmentFeedback:
      showAssignmentCreatedNotice ||
      showAssignmentDeletedNotice ||
      showInstructedTraineeCreatedNotice ||
      assignmentErrorText !== null ||
      assignmentDeleteErrorText !== null ||
      instructedTraineeErrorTextValue !== null ||
      assignmentEditFeedback !== null ||
      assignmentOrderFeedback !== null ||
      pairingFeedback !== null,
    hasPublicationFeedback: publicationFeedback !== null,
  });

  // WHICH ARRANGEMENT the two schedule-bearing sections show. A closed parser
  // with a default, exactly like the section token.
  const scheduleView: ExamScheduleView = parseExamScheduleView(query.view);

  // WHETHER the create forms are open. Closed to the exact string "1", and a
  // DISCLOSURE rather than a permission: the lifecycle gate below still decides
  // whether a create form exists at all, and this token cannot open one it closed.
  const addAssignmentOpen = parseAddAssignmentDisclosure(query.add);

  // 10. ONE lifecycle evaluation, every display decision derived from it. The gate
  //    is the non-throwing policy question on the VERIFIED status, so an ARCHIVED
  //    offering keeps a readable, affordance-free page instead of an error. Each
  //    server binding re-evaluates the same gate and refuses on its own, so this
  //    can never be the enforcement.
  const mayConfigure = evaluateCourseOperationPolicy(
    context.status,
    "SCHEDULE_DRAFT_CONFIGURATION",
  ).allowed;
  const canCreatePlan = mayConfigure && !view.planExists;
  const showCreateForm = view.planExists && mayConfigure;

  // The THIRD affordance, over the SAME single evaluation. A session must name a
  // stored exam, so this one carries an extra structural precondition the other
  // two do not.
  const showSessionCreateForm =
    sessionView.planExists && view.definitions.length > 0 && mayConfigure;

  // The picker's options come from the DEFINITION reader already loaded above —
  // no second query — narrowed to exactly the three fields the form accepts.
  const sessionDefinitionOptions = view.definitions.map((option) => ({
    id: option.id,
    name: option.name,
    kind: option.kind,
  }));

  // Every ASSIGNMENT-writing action, bound ONCE to the VERIFIED context id and
  // reused by every per-session and per-card control below. Hoisted rather than
  // bound inline, for the reason every other binding expression appears exactly
  // once in this file: one binding site is one place to check that the id came
  // from `context`, and never from the raw route param. The offering id therefore
  // travels inside the encrypted Server Action payload and is never a form field.
  const boundCreateInstructedTraineeAssignmentAction =
    createExamInstructedTraineeAssignmentAction.bind(null, context.id);
  const boundSetExamPlanPublicationAction =
    setExamPlanPublicationAction.bind(null, context.id);
  const boundReplaceExamSourceDatesAction = replaceExamSourceDatesAction.bind(null, context.id);
  // boundCreateAssignmentAction, boundDeleteAssignmentAction,
  // boundUpdateExamAssignmentDetailsAction and boundMoveExamAssignmentAction are
  // all bound further below, once `groupQuery` — the current tab/view/sub-tab —
  // is known, so every assignment mutation can redirect back to the exact
  // arrangement the manager was looking at instead of always landing on the
  // general view.

  /**
   * The three arrangements of the stored schedule, built ONCE from the committed
   * day grouping and shared by both schedule-bearing sections. A failed grouping
   * yields an empty timeline and the fixed sentence below says so.
   */
  const scheduleDays = grouping.ok ? grouping.days : [];

  /**
   * THE ONE ORDERING RULE, APPLIED ONCE.
   *
   * The committed grouping hands its days over date-ascending and its rows in the
   * manager's own stored sequence. The workspace then puts the whole timeline
   * into the order a manager actually reads a day in — DATE, then START TIME,
   * then the sequence the rows already arrived in — using the route-local pure
   * comparator, which is STABLE and therefore preserves that stored sequence for
   * two blocks sharing a date and a clock time.
   *
   * It is applied HERE, once, to the ONE timeline every arrangement is derived
   * from — the general overview, the by-type view, the by-date view and the
   * assignments section alike — so no two surfaces can present a day differently.
   * Nothing below sorts again, and nothing anywhere sorts by a display name.
   */
  const timeline = orderWorkspaceTimeline(buildGeneralTimeline(scheduleDays));
  const definitionGroups = groupTimelineByDefinition(timeline);
  const timelineDays = groupTimelineByDate(timeline);

  /**
   * THE BEGINNER ROWS, IN THE SAME ORDER AND FROM THE SAME ONE READ.
   *
   * `beginnerRows` above is the committed admin reading's own projection. It is
   * ORDERED here by the same rule and never re-read, so the beginner times in the
   * general overview and the beginner detail in the by-date view are the same
   * rows, in the same sequence, from the same request.
   */
  const orderedBeginnerRows = orderBeginnerRows(beginnerRows);
  const dayLabels = collectDayLabels(timeline);
  const scheduleOverview = buildScheduleOverview(timeline, orderedBeginnerRows, dayLabels);

  /**
   * THE THREE BEGINNER STATES, decided from facts this page already holds.
   *
   * The level question is DELEGATED — the committed containment predicate is
   * asked through its one admin-facing binding rather than restated here, because
   * a second opinion about which courses have beginner exams is exactly how two
   * surfaces of one rule start disagreeing.
   *
   * `planView.sourceDates` is the committed admin reading's own report of the
   * plan's selection, so "nothing is selected" and "nothing was found for what is
   * selected" are read from the same one request that produced the rows.
   */
  const beginnerSupported = examBeginnerDatesSupportedForLevel(context.level);
  const selectedSourceDates = planView.sourceDates;
  const hasSourceDates = selectedSourceDates.length > 0;

  /**
   * Everything ONE block needs, assembled once and reused by every arrangement
   * and by the assignments section.
   *
   * IT DERIVES NO TIME. The waves, their moments and the block end all come from
   * the CANONICAL view read above; this function only looks that block up by its
   * session id and JOINS the workspace's own examinee rows to the assignment ids
   * the canonical waves named.
   *
   * A session the canonical view has no entry for — an unresolved block, or one
   * the plan loader did not report — yields no waves and lists every examinee as
   * untimed, so the roster is still complete and the surface says plainly that
   * the times are unavailable. It never invents one.
   *
   * The teaching link is read from the `teaches` map — the committed reader's own
   * resolved pairing — so an ambiguous, unmatched or absent one resolves to
   * `null` and the surface says plainly that there is none.
   */
  function describeBlock(session: WorkspaceBlockFacts) {
    const requirements = requirementsByDefinition.get(session.definitionId);
    const examineeRows = examineesBySession.get(session.sessionId) ?? NO_ASSIGNMENTS;
    const instructedRows = instructedBySession.get(session.sessionId) ?? NO_ASSIGNMENTS;
    const byAssignmentId = new Map<string, WorkspaceExaminee>();
    for (const row of examineeRows) {
      const taught = teachesByExaminee.get(row.assignmentId);
      byAssignmentId.set(row.assignmentId, {
        assignmentId: row.assignmentId,
        traineeName: row.traineeName,
        horseName: row.horseName,
        instructionTopic: row.instructionTopic,
        discipline: row.discipline,
        instructedTraineeAssignmentId: taught === undefined ? null : taught.assignmentId,
        instructedTraineeName: taught === undefined ? null : taught.traineeName,
      });
    }
    const canonical = waveView.blocks.get(session.sessionId);
    const waves =
      canonical === undefined
        ? NO_RENDERED_WAVES
        : attachExamineesToWaves(canonical.waves, byAssignmentId);
    const untimed = collectUntimedExaminees(
      canonical === undefined
        ? examineeRows.map((row) => row.assignmentId)
        : canonical.untimedExamineeAssignmentIds,
      byAssignmentId,
    );
    return {
      requirements,
      examineeRows,
      instructedRows,
      waves,
      untimed,
      blockEndTime: canonical === undefined ? null : canonical.derivedBlockEndTime,
    };
  }

  /** ONE block, rendered READ-ONLY, as all three schedule arrangements show it. */
  function renderScheduleBlock({
    session,
    dayLabel,
    dateLabel,
  }: {
    session: WorkspaceBlockFacts;
    dayLabel: string;
    dateLabel: string;
  }) {
    const { requirements, waves, untimed, blockEndTime } = describeBlock(session);
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-semibold text-card-foreground">
            {session.startTime}
          </span>
          <span className="text-sm text-card-foreground">{session.definitionName}</span>
        </div>
        {session.title !== null && session.title !== "" ? (
          <p className="mt-1 text-sm text-card-foreground">{session.title}</p>
        ) : null}
        <BlockFacts
          dayLabel={dayLabel}
          dateLabel={dateLabel}
          startTime={session.startTime}
          endTime={blockEndTime}
          arena={session.arena}
          kind={requirements === undefined ? kindText("") : kindText(requirements.kind)}
          parallelCapacity={requirements === undefined ? 0 : requirements.parallelCapacity}
          assignmentCount={session.assignmentCount}
        />
        {session.notes !== null && session.notes !== "" ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{session.notes}</p>
        ) : null}
        {waves.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {waves.map((wave) => (
              <ReadOnlyWave
                key={wave.startTime}
                wave={wave}
                showTeachingLink={
                  requirements !== undefined && requirements.requiresInstructedTrainee
                }
              />
            ))}
          </ul>
        ) : null}
        {untimed.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-semibold text-warning">{UNTIMED_HEADING}</p>
            <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {untimed.map((examinee) => (
                <li key={examinee.assignmentId} className="rounded-lg bg-card px-3 py-2">
                  <p className="text-sm text-card-foreground">{examinee.traineeName}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {waves.length === 0 && untimed.length === 0 ? (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{EMPTY_BLOCK_TEXT}</p>
        ) : null}
      </div>
    );
  }

  /**
   * The SAME three arrangements, expressed as SECTIONS so both schedule-bearing
   * tabs can render them identically: `general` is one unheaded section holding
   * the whole timeline, `type` is one section per exam definition, and `date` is
   * one section per stored day.
   *
   * Built from the SAME timeline and the SAME day grouping, so the two tabs can
   * never disagree about what exists or about sequence.
   */
  /**
   * ONE sub-tab of the by-type or by-date view.
   *
   * `key` is a React key and never an href value. The LINK carries the sub-tab's
   * POSITION instead, so no `ExamDefinition.id` and no other database id ever
   * reaches the address bar — see the ordinal parser's own note on why.
   */
  interface ScheduleSubTab {
    readonly key: string;
    readonly label: string;
    readonly sublabel: string | null;
    readonly entries: typeof timeline;
  }

  /**
   * THE SUB-TABS, and why the two grouped views have them at all.
   *
   * `לפי סוג מבחן` and `לפי תאריך` used to render EVERY group one after another,
   * which made both of them the same very long page the workspace was split up to
   * avoid — a manager looking for one exam type read all of them on the way. Each
   * is now a compact row of sub-tabs with exactly ONE group on screen.
   *
   * The general view has no sub-tabs: it is one continuous chronology by
   * definition, and slicing it would defeat its only purpose.
   */
  const scheduleSubTabs: readonly ScheduleSubTab[] =
    scheduleView === "type"
      ? definitionGroups.map((group) => ({
          key: group.definitionId,
          label: group.definitionName,
          sublabel: null,
          entries: group.entries,
        }))
      : scheduleView === "date"
        ? timelineDays.map((day) => ({
            key: day.dateKey,
            label: day.dayLabel,
            sublabel: day.dateLabel,
            entries: day.entries,
          }))
        : [];

  /**
   * WHICH sub-tab is open — a closed ordinal with a SAFE DEFAULT.
   *
   * Every unusable token falls back to position 0, which under the one ordering
   * rule is the FIRST available exam type or the EARLIEST available date. A
   * bookmark to a group that has since disappeared therefore lands on a real
   * group rather than on an empty page.
   */
  const activeSubTabIndex = parseWorkspaceGroupIndex(query.group, scheduleSubTabs.length);
  const activeSubTab: ScheduleSubTab | undefined = scheduleSubTabs[activeSubTabIndex];

  /** The entries the SELECTED arrangement actually renders. */
  const selectedEntries: typeof timeline =
    scheduleView === "general" ? timeline : activeSubTab === undefined ? [] : activeSubTab.entries;

  /**
   * WHICH beginner rows the open arrangement shows in FULL.
   *
   * The general view shows their TIMES in the merged overview and no detail at
   * all — it is a timetable. `לפי תאריך` shows the full read-only detail of the
   * selected day, and `לפי סוג מבחן` shows every beginner lesson, because a
   * beginner exam is a Teaching-Practice projection and belongs to no
   * `ExamDefinition` that could give it a sub-tab of its own.
   *
   * All three are FILTERS of the one already-ordered list. No second query, no
   * second reader and no duplicated row.
   */
  const beginnerRowsInView: readonly WorkspaceBeginnerRow[] =
    scheduleView === "general"
      ? NO_BEGINNER_ROWS
      : scheduleView === "date"
        ? beginnerRowsOnDate(
            orderedBeginnerRows,
            activeSubTab === undefined ? "" : activeSubTab.key,
          )
        : orderedBeginnerRows;

  /**
   * The query tail every in-view link has to carry so the workspace does not
   * silently reset itself: the section, the arrangement and — where one exists —
   * the open sub-tab.
   */
  const viewQuery = `tab=${activeTab}&view=${scheduleView}`;
  const groupQuery = scheduleView === "general" ? viewQuery : `${viewQuery}&group=${activeSubTabIndex}`;

  // Every assignment mutation redirects back into THIS arrangement, not always
  // the general one — `groupQuery` is the same closed tab/view/ordinal tail
  // every other in-view link already carries, bound in now that it is known,
  // same as the id above. The create endpoint ALSO gets `addAssignmentOpen`,
  // so a manager adding several trainees in a row is not kicked out of the
  // open add form after every save.
  const boundCreateAssignmentAction = createExamAssignmentAction.bind(
    null,
    context.id,
    groupQuery,
    addAssignmentOpen,
  );
  const boundDeleteAssignmentAction = deleteExamAssignmentAction.bind(null, context.id, groupQuery);
  const boundUpdateExamAssignmentDetailsAction =
    updateExamAssignmentDetailsAction.bind(null, context.id, groupQuery);
  const boundMoveExamAssignmentAction = moveExamAssignmentAction.bind(null, context.id, groupQuery);

  /**
   * The view switcher. Plain links carrying ONE closed token and never an id.
   *
   * Switching the arrangement deliberately DROPS the sub-tab ordinal: position 3
   * of the exam types is not position 3 of the dates, so carrying it across would
   * land the manager on an unrelated group. The safe default takes over instead.
   */
  function renderScheduleViewNav() {
    return (
      <nav aria-label="תצוגת הלו״ז" className="flex flex-wrap gap-2">
        {EXAM_SCHEDULE_VIEWS.map((token) => (
          <Link
            key={token}
            href={`${examsPath}?tab=${activeTab}&view=${token}`}
            aria-current={scheduleView === token ? "true" : undefined}
            className={
              scheduleView === token
                ? "rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground"
                : "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
            }
          >
            {EXAM_SCHEDULE_VIEW_LABELS[token]}
          </Link>
        ))}
      </nav>
    );
  }

  /**
   * The SUB-TAB switcher of whichever grouped view is open.
   *
   * Renders nothing at all in the general view and nothing when there is only one
   * group to choose from — a single sub-tab is a label pretending to be a control.
   * Every link carries the section, the arrangement and ONE ordinal.
   */
  function renderScheduleSubTabNav() {
    if (scheduleSubTabs.length < 2) return null;
    return (
      <nav
        aria-label={EXAM_SCHEDULE_VIEW_LABELS[scheduleView]}
        className="mt-3 flex flex-wrap gap-1.5"
      >
        {scheduleSubTabs.map((subTab, index) => (
          <Link
            key={subTab.key}
            href={`${examsPath}?${viewQuery}&group=${index}`}
            aria-current={index === activeSubTabIndex ? "true" : undefined}
            className={
              index === activeSubTabIndex
                ? "rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                : "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground"
            }
          >
            {subTab.label}
            {subTab.sublabel !== null ? (
              <span className="ms-1 opacity-70">{subTab.sublabel}</span>
            ) : null}
          </Link>
        ))}
      </nav>
    );
  }

  /** The heading of the ONE selected group, or nothing in the general view. */
  function renderSelectedGroupHeading() {
    if (scheduleView === "general" || activeSubTab === undefined) return null;
    return (
      <div className="mt-4 flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
        <span className="text-sm font-semibold text-card-foreground">{activeSubTab.label}</span>
        {activeSubTab.sublabel !== null ? (
          <span className="text-xs text-muted-foreground">{activeSubTab.sublabel}</span>
        ) : null}
      </div>
    );
  }

  /**
   * The three arrangements, from the SAME timeline.
   *
   * `general` is the flat continuous list, `type` buckets it by exam definition
   * and `date` by stored day. None of them re-reads anything and none of them
   * sorts: each is the committed order, arranged.
   */
  /**
   * THE GENERAL VIEW — A TIMETABLE, AND NOTHING ELSE.
   *
   * It answers ONE question: what does this day look like. So it prints the date,
   * the start, the derived end, the exam type, the place and how many people run
   * in parallel — and it prints NO examinee, NO instructed trainee, NO horse, NO
   * topic, NO branch, NO pairing and NO edit control of any kind. A manager
   * reading it is reading a structure; the roster lives in the two grouped views,
   * where it can actually be changed.
   *
   * BEGINNER Teaching-Practice exams are IN this chronology, interleaved with the
   * stored blocks by time rather than listed after them, because a manager
   * running the day needs one sequence and not two. They come from the SAME
   * already-loaded admin reading the rest of the page uses — no second query, no
   * second reader, no duplicated row — and their times are that reading's own.
   * Their DETAIL is deliberately absent here and appears in the grouped views.
   */
  function renderGeneralSchedule() {
    if (!grouping.ok) {
      return <p className="mt-2 text-sm leading-relaxed text-danger">{GROUPING_FAILED_TEXT}</p>;
    }
    if (scheduleOverview.length === 0) {
      return (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {NO_SCHEDULE_ENTRIES_TEXT}
        </p>
      );
    }
    return (
      <>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {GENERAL_VIEW_READ_ONLY_TEXT}
        </p>
        <ul className="mt-3 flex flex-col gap-2">
          {scheduleOverview.map((entry) =>
            entry.kind === "SESSION" ? (
              <li
                key={entry.session.sessionId}
                className="rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-card-foreground">
                    {entry.startTime}
                  </span>
                  <span className="text-sm text-card-foreground">
                    {entry.session.definitionName}
                  </span>
                </div>
                <BlockFacts
                  dayLabel={entry.dayLabel}
                  dateLabel={entry.dateLabel}
                  startTime={entry.startTime}
                  endTime={describeBlock(entry.session).blockEndTime}
                  arena={entry.session.arena}
                  kind={kindText(
                    requirementsByDefinition.get(entry.session.definitionId)?.kind ?? "",
                  )}
                  parallelCapacity={
                    requirementsByDefinition.get(entry.session.definitionId)?.parallelCapacity ?? 0
                  }
                  assignmentCount={entry.session.assignmentCount}
                />
              </li>
            ) : (
              <li
                key={`beginner:${entry.beginner.sessionId}`}
                className="rounded-lg border border-dashed border-border bg-muted px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-sm font-semibold text-card-foreground">
                    {entry.startTime}
                  </span>
                  <span className="text-sm text-card-foreground">
                    {kindText(entry.beginner.beginnerFormat)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {GENERAL_VIEW_BEGINNER_LABEL}
                  </span>
                </div>
                {/*
                  DATE, TIME AND PLACE, and deliberately not one field more. No
                  child, no participant, no horse and no contact appears in the
                  overview — those are the by-date and by-type views' business.
                */}
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                  <DefinitionFact
                    label={BLOCK_DATE_LABEL}
                    value={`${entry.dayLabel} ${entry.dateLabel}`}
                  />
                  <DefinitionFact label={BLOCK_START_LABEL} value={entry.startTime} />
                  <DefinitionFact
                    label={BLOCK_END_LABEL}
                    value={timeText(entry.beginner.displayEndTime)}
                  />
                  <DefinitionFact
                    label={BLOCK_ARENA_LABEL}
                    value={presentTextOr(entry.beginner.location, NO_ARENA_TEXT)}
                  />
                </dl>
              </li>
            ),
          )}
        </ul>
      </>
    );
  }

  /**
   * The TWO GROUPED arrangements, read-only, with ONE group on screen.
   *
   * Both render from the SAME ordered timeline the general view does, sliced by
   * the open sub-tab, so no arrangement can disagree with another about what
   * exists or about sequence.
   */
  function renderGroupedSchedule() {
    if (!grouping.ok) {
      return <p className="mt-2 text-sm leading-relaxed text-danger">{GROUPING_FAILED_TEXT}</p>;
    }
    if (timeline.length === 0) {
      return <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{NO_SESSIONS_TEXT}</p>;
    }
    return (
      <>
        {renderScheduleSubTabNav()}
        {renderSelectedGroupHeading()}
        <ul className="mt-3 flex flex-col gap-2">
          {selectedEntries.map((entry) => (
            <li key={entry.session.sessionId}>
              {renderScheduleBlock({
                session: entry.session,
                dayLabel: entry.dayLabel,
                dateLabel: entry.dateLabel,
              })}
            </li>
          ))}
        </ul>
      </>
    );
  }

  function renderScheduleViews() {
    return scheduleView === "general" ? renderGeneralSchedule() : renderGroupedSchedule();
  }

  return (
    <div className="flex flex-col gap-4">
      {feedback && <div className={FEEDBACK_CLASS[feedback.tone]}>{feedback.message}</div>}

      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">מבחנים</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          סביבת העבודה של מבחני הקורס: סוגי המבחנים, המופעים והזמנים, שיבוץ
          הנבחנים והפרסום לחניכים — כל אחד בלשונית משלו.
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

      {showInstructedTraineeCreatedNotice ? (
        <div className="rounded-xl border border-border bg-success-muted px-5 py-4">
          <p className="text-sm font-medium text-success">
            {EXAM_INSTRUCTED_TRAINEE_CREATED_TEXT}
          </p>
        </div>
      ) : null}

      {instructedTraineeErrorTextValue !== null ? (
        <div className="rounded-xl border border-border bg-danger-muted px-5 py-4">
          <p className="text-sm font-medium text-danger">{instructedTraineeErrorTextValue}</p>
          {instructedTraineeIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm text-danger">
              {instructedTraineeIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {publicationFeedback !== null ? (
        <div className={FEEDBACK_CLASS[publicationFeedback.tone]}>
          {publicationFeedback.message}
        </div>
      ) : null}

      {pairingFeedback !== null ? (
        <div className={FEEDBACK_CLASS[pairingFeedback.tone]}>
          {pairingFeedback.message}
        </div>
      ) : null}

      {assignmentEditFeedback !== null ? (
        <div className={FEEDBACK_CLASS[assignmentEditFeedback.tone]}>
          <p>{assignmentEditFeedback.message}</p>
          {assignmentEditIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm">
              {assignmentEditIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {assignmentOrderFeedback !== null ? (
        <div className={FEEDBACK_CLASS[assignmentOrderFeedback.tone]}>
          {assignmentOrderFeedback.message}
        </div>
      ) : null}

      {sourceDatesFeedback !== null ? (
        <div className={FEEDBACK_CLASS[sourceDatesFeedback.tone]}>
          <p>{sourceDatesFeedback.message}</p>
          {sourceDatesIssueTexts.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-sm">
              {sourceDatesIssueTexts.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          ) : null}
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
          {/*
            THE NO-PLAN PUBLICATION STATE.

            A sentence and nothing else. There is no publication form, no button
            and no hidden field in this branch — publishing a plan that does not
            exist is not a refusal to explain but an action that cannot be
            offered, and the committed writer would refuse it anyway.
          */}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {NO_PLAN_PUBLICATION_TEXT}
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
          {/*
            THE WORKSPACE NAVIGATION.

            Four plain links, each carrying ONE closed section token and nothing
            else — no session id, no assignment id, no definition id and no
            publication operation. A GET of any of them re-renders this same
            Server Component and can never write.
          */}
          <nav
            aria-label="סביבת העבודה של המבחנים"
            className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3"
          >
            {EXAM_WORKSPACE_TABS.map((token) => (
              <Link
                key={token}
                href={`${examsPath}?tab=${token}`}
                aria-current={activeTab === token ? "page" : undefined}
                className={
                  activeTab === token
                    ? "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                    : "rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
                }
              >
                {EXAM_WORKSPACE_TAB_LABELS[token]}
              </Link>
            ))}
          </nav>

          {/* =================================================================
              SECTION 1 — סוגי מבחנים
              ================================================================= */}
          {activeTab === "definitions" ? (
            <>
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
            </>
          ) : null}

          {/* =================================================================
              SECTION 2 — מופעים וזמנים

              The stored blocks, in whichever of the three arrangements is
              selected, plus the two PER-SESSION affordances and the create form.
              The arrangements are read-only: a manager edits a block through the
              session edit form below and its people in the assignments section.
              ================================================================= */}
          {activeTab === "schedule" ? (
            <>
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-card-foreground">
                  {EXAM_WORKSPACE_TAB_LABELS.schedule}
                </h3>
                <div className="mt-3">
                  {renderScheduleViewNav()}
                </div>
                {renderScheduleViews()}
              </div>

              {/* =============================================================
                  EX-ADMIN-SRCDATE — WHICH TEACHING-PRACTICE DAYS ARE EXAM DAYS.

                  The one stored beginner fact, and the reason beginner exams
                  were invisible everywhere before this control existed. It is
                  rendered in this section because it configures WHICH DAYS the
                  plan covers, which is exactly what this section is about.

                  It is shown ONLY when the course level actually has beginner
                  exams — the committed containment predicate decides that, not
                  this page — and the form ONLY when the lifecycle gate allows
                  configuration. The committed writer re-runs both for itself.
                  ============================================================= */}
              {beginnerSupported ? (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="text-sm font-semibold text-card-foreground">
                    {SOURCE_DATES_HEADING}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {SOURCE_DATES_INTRO}
                  </p>

                  {!view.planExists ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {NO_PLAN_PUBLICATION_TEXT}
                    </p>
                  ) : mayConfigure ? (
                    /*
                      ONE FORM, AND IT SUBMITS THE COMPLETE SET.

                      Every currently-selected day is a CHECKED checkbox sharing
                      the one field name, and the add field appends one more. The
                      committed writer replaces the whole selection with whatever
                      arrives, so unchecking a day removes it and there is no
                      second endpoint that could disagree about what is selected.

                      A date input and never a lesson picker: the only value this
                      surface can express is a DAY. No Teaching-Practice row is
                      nameable from here, and none is created, copied or
                      duplicated by submitting.
                    */
                    <form
                      action={boundReplaceExamSourceDatesAction}
                      className="mt-4 flex flex-col gap-3"
                    >
                      <fieldset className="border-0 p-0">
                        <legend className="text-xs font-medium text-card-foreground">
                          {SOURCE_DATES_SELECTED_LABEL}
                        </legend>
                        {hasSourceDates ? (
                          <>
                            <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {selectedSourceDates.map((selected) => (
                                <li key={selected}>
                                  <label className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
                                    <input
                                      type="checkbox"
                                      name="date"
                                      value={selected}
                                      defaultChecked
                                    />
                                    <span className="text-card-foreground">{selected}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {SOURCE_DATES_KEEP_LABEL}
                                    </span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                              {SOURCE_DATES_UNCHECK_HINT}
                            </p>
                          </>
                        ) : (
                          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                            {SOURCE_DATES_NONE_TEXT}
                          </p>
                        )}
                      </fieldset>

                      <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
                        <span className="font-medium text-card-foreground">
                          {SOURCE_DATES_ADD_LABEL}
                        </span>
                        {/*
                          The SAME field name as the checkboxes above, so an added
                          day joins the submitted set rather than replacing it. An
                          empty date input submits an empty string, which the
                          committed core refuses as an invalid date — so a save
                          that only unchecks days must leave this field blank, and
                          the hint above says exactly that.
                        */}
                        <input
                          type="date"
                          name="date"
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
                        />
                      </label>

                      <div>
                        <button
                          type="submit"
                          className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground"
                        >
                          {SOURCE_DATES_SAVE_TEXT}
                        </button>
                      </div>
                    </form>
                  ) : hasSourceDates ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {selectedSourceDates.map((selected) => (
                        <li
                          key={selected}
                          className="rounded-lg bg-muted px-3 py-1.5 text-sm text-card-foreground"
                        >
                          {selected}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {SOURCE_DATES_NONE_TEXT}
                    </p>
                  )}

                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {BEGINNER_READ_ONLY_TEXT}
                  </p>
                </div>
              ) : null}

              {/*
                The two PER-SESSION affordances, behind the SAME single lifecycle
                evaluation the create forms use. With `mayConfigure` false — an
                ARCHIVED offering, or any status the default-deny policy does not
                recognize — neither control is rendered at all. Each server binding
                re-evaluates the same gate and refuses on its own, so this is a
                display decision and never the enforcement.

                `day.dateKey` is the session's own stored day: the grouping core
                keyed the day by it, so the edit form's date default is the stored
                value and not a derived one. No clock is read.
              */}
              {mayConfigure && grouping.ok
                ? scheduleDays.map((day) => (
                    <div
                      key={day.dateKey}
                      className="rounded-xl border border-border bg-card p-5"
                    >
                      <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-2">
                        <span className="text-sm font-semibold text-card-foreground">
                          {day.dayLabel}
                        </span>
                        <span className="text-xs text-muted-foreground">{day.dateLabel}</span>
                      </div>
                      <ul className="mt-3 flex flex-col gap-4">
                        {day.sessions.map((session) => (
                          <li
                            key={session.sessionId}
                            className="flex flex-col gap-3 rounded-lg border border-border bg-muted px-4 py-3"
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
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                : null}

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
          ) : null}

          {/* =================================================================
              SECTION 3 — שיבוצים

              The SAME stored schedule, in the SAME three arrangements, with the
              write surfaces attached: one coherent card per examinee, the order
              controls, the two create forms and the removal control.
              ================================================================= */}
          {activeTab === "assignments" ? (
            <>
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-card-foreground">
                  {EXAM_WORKSPACE_TAB_LABELS.assignments}
                </h3>
                <div className="mt-3">
                  {renderScheduleViewNav()}
                </div>
                {/*
                  THE GENERAL VIEW IS READ-ONLY HERE TOO.

                  `לו״ז כללי` is one arrangement of one schedule, and it means the
                  same thing in both sections: a timetable. It therefore renders
                  the SAME structural overview in the assignments section and
                  carries no card, no name and no create form — the sentence it
                  prints says where the editing is instead.
                */}
                {scheduleView === "general" ? (
                  renderGeneralSchedule()
                ) : !grouping.ok ? (
                  <p className="mt-2 text-sm leading-relaxed text-danger">{GROUPING_FAILED_TEXT}</p>
                ) : timeline.length === 0 ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {NO_SESSIONS_TEXT}
                  </p>
                ) : (
                  <>
                    {renderScheduleSubTabNav()}

                    {/*
                      THE ADD-ASSIGNMENT CONTROL, AT THE TOP.

                      One link, immediately under the sub-tabs, so a manager never
                      has to scroll a whole exam day to reach the create form. It
                      carries the section, the arrangement, the open sub-tab and
                      ONE closed disclosure token — no session id, no definition
                      id and no trainee id — so a GET of it can only re-render
                      this same page with the forms shown.

                      It is rendered ONLY when the lifecycle gate already allows
                      configuration, so the control cannot advertise an action
                      that is not available.
                    */}
                    {mayConfigure ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Link
                          href={
                            addAssignmentOpen
                              ? `${examsPath}?${groupQuery}`
                              : `${examsPath}?${groupQuery}&add=1`
                          }
                          className={
                            addAssignmentOpen
                              ? "rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
                              : "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                          }
                        >
                          {addAssignmentOpen ? ADD_ASSIGNMENT_CLOSE_TEXT : ADD_ASSIGNMENT_OPEN_TEXT}
                        </Link>
                        {addAssignmentOpen ? (
                          <span className="text-xs text-muted-foreground">
                            {ADD_ASSIGNMENT_HINT_TEXT}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {renderSelectedGroupHeading()}
                    <ul className="mt-3 flex flex-col gap-5">
                    {selectedEntries.map((entry) => {
                      const session = entry.session;
                      const { requirements, instructedRows, waves, untimed, blockEndTime } =
                        describeBlock(session);

                      // IT2's own affordance, derived FIRST and kept entirely
                      // separate from the examinee gate below. It asks ONE question
                      // and no other — does this session's exam actually ask for an
                      // instructed trainee? — and consults neither topic nor branch,
                      // because refusing this role over the examinee's missing topic
                      // would block precisely the blocks it exists to complete.
                      //
                      // Declared ABOVE the examinee gate on purpose: the committed
                      // guard proves this flag never enters that gate by reading the
                      // source window that FOLLOWS it.
                      const showInstructedTraineeForm =
                        requirements !== undefined && requirements.requiresInstructedTrainee;

                      // FAIL-CLOSED on unknown requirements, exactly as before: a
                      // session naming a definition the definition reader did not
                      // report tells this page nothing about what its exam
                      // demands, and a write surface must never be opened on a
                      // requirement nobody can state.
                      const requirementsUnknown = requirements === undefined;

                      // THE TEACHING LINK IS A PROPERTY OF THE EXAM DEFINITION.
                      //
                      // It used to be offered whenever the session held ANY
                      // instructed-trainee row, which meant a riding or interface
                      // block could show an empty "מדריך/ה את" field that its exam
                      // never asks for — a field a manager cannot usefully fill
                      // reads as something they forgot to do.
                      //
                      // The rule is now the DEFINITION's own requirement flag, read
                      // from the definition reader this page already loaded. It is
                      // NOT inferred from whether a pairing happens to exist: that
                      // would make the field appear and disappear as rows are
                      // assigned, on exams that never wanted it.
                      //
                      // The ONE exception is per PERSON and not per session: an
                      // examinee that ALREADY carries a stored link keeps its own
                      // field, whatever the definition now says, because a value
                      // that exists and cannot be seen or cleared is worse than one
                      // shown on a definition that has since changed. It can never
                      // produce an EMPTY irrelevant field, because it is reached
                      // only when there is something stored to show.
                      const definitionWantsInstructedTrainee = showInstructedTraineeForm;

                      // The trainees this session's cards may offer. Narrowed to
                      // two display fields, from a bucket keyed by session id.
                      const instructedChoices = instructedRows.map((row) => ({
                        assignmentId: row.assignmentId,
                        traineeName: row.traineeName,
                      }));

                      // The instructed trainees NOBODY teaches yet. Listed under
                      // their own heading rather than given a schedule card: they
                      // hold no slot and no time of their own, but hiding them
                      // would make the session disagree with its own count.
                      const unlinkedInstructed = instructedRows.filter(
                        (row) => row.pairedExamineeAssignmentId === null,
                      );

                      // The running position of a card across the whole block, so
                      // the number a manager sees matches the order the move
                      // buttons act on. Derived from the RENDERED arrangement and
                      // never from the stored `orderIndex`.
                      let position = 0;

                      return (
                        <li key={session.sessionId}>
                          <div className="rounded-lg border border-border bg-card px-4 py-3">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <span className="text-sm font-semibold text-card-foreground">
                                {session.startTime}
                              </span>
                              <span className="text-sm text-card-foreground">
                                {session.definitionName}
                              </span>
                            </div>
                            <BlockFacts
                              dayLabel={entry.dayLabel}
                              dateLabel={entry.dateLabel}
                              startTime={session.startTime}
                              endTime={blockEndTime}
                              arena={session.arena}
                              kind={
                                requirements === undefined
                                  ? kindText("")
                                  : kindText(requirements.kind)
                              }
                              parallelCapacity={
                                requirements === undefined ? 0 : requirements.parallelCapacity
                              }
                              assignmentCount={session.assignmentCount}
                            />

                            {waves.length > 0 ? (
                              <ul className="mt-4 flex flex-col gap-3">
                                {waves.map((wave) => (
                                  <li
                                    key={wave.startTime}
                                    className="rounded-lg border border-border bg-muted px-3 py-2"
                                  >
                                    {/*
                                      THE TIME, PRINTED ONCE, AND NO NOUN IN
                                      FRONT OF IT.

                                      Two examinees examined together share this
                                      one heading and are laid out as two columns
                                      where there is room and stacked on a phone.
                                      No card below repeats the time.
                                    */}
                                    <p className="text-xs font-semibold text-card-foreground">
                                      {wave.startTime} {WAVE_TIME_SEPARATOR}{" "}
                                      {timeText(wave.endTime)}
                                    </p>
                                    <ul className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                                      {wave.examinees.map((examinee) => {
                                        position += 1;
                                        const topicText = storedDetailText(
                                          examinee.instructionTopic,
                                        );
                                        const disciplineText = storedDetailText(
                                          examinee.discipline,
                                        );
                                        const missingTopic =
                                          requirements !== undefined &&
                                          requirements.requiresLessonTopic &&
                                          topicText === null;
                                        const missingDiscipline =
                                          requirements !== undefined &&
                                          requirements.requiresDiscipline &&
                                          disciplineText === null;

                                        return (
                                          <li
                                            key={examinee.assignmentId}
                                            className="rounded-lg bg-card px-3 py-2"
                                          >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <span className="text-xs text-muted-foreground">
                                                {POSITION_LABEL} {position}
                                              </span>
                                              <span className="text-xs text-muted-foreground">
                                                {roleText("EXAMINEE")}
                                              </span>
                                            </div>

                                            {missingTopic ? (
                                              <p className="mt-1 text-xs text-danger">
                                                {MISSING_INSTRUCTION_TOPIC_TEXT}
                                              </p>
                                            ) : null}
                                            {missingDiscipline ? (
                                              <p className="mt-1 text-xs text-danger">
                                                {MISSING_DISCIPLINE_TEXT}
                                              </p>
                                            ) : null}

                                            {/*
                                              THE ORDERING CONTROLS.

                                              Two one-step forms, never a
                                              drag-and-drop: none existed, and a
                                              pointer-only affordance would be
                                              unusable on the phones this admin
                                              area is used on. Each carries the
                                              assignment id as a hidden value and
                                              a fixed direction literal; the
                                              committed writer derives the session
                                              itself and renumbers it atomically,
                                              after which the derived wave times
                                              above are recomputed on the re-read.
                                            */}
                                            {mayConfigure ? (
                                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                                <form action={boundMoveExamAssignmentAction}>
                                                  <input
                                                    type="hidden"
                                                    name="assignmentId"
                                                    value={examinee.assignmentId}
                                                    readOnly
                                                  />
                                                  <input
                                                    type="hidden"
                                                    name="direction"
                                                    value="UP"
                                                    readOnly
                                                  />
                                                  <button
                                                    type="submit"
                                                    aria-label={MOVE_UP_LABEL}
                                                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-card-foreground"
                                                  >
                                                    {MOVE_UP_GLYPH}
                                                  </button>
                                                </form>
                                                <form action={boundMoveExamAssignmentAction}>
                                                  <input
                                                    type="hidden"
                                                    name="assignmentId"
                                                    value={examinee.assignmentId}
                                                    readOnly
                                                  />
                                                  <input
                                                    type="hidden"
                                                    name="direction"
                                                    value="DOWN"
                                                    readOnly
                                                  />
                                                  <button
                                                    type="submit"
                                                    aria-label={MOVE_DOWN_LABEL}
                                                    className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-card-foreground"
                                                  >
                                                    {MOVE_DOWN_GLYPH}
                                                  </button>
                                                </form>
                                                <DeleteExamAssignmentForm
                                                  action={boundDeleteAssignmentAction}
                                                  courseOfferingId={context.id}
                                                  assignmentId={examinee.assignmentId}
                                                />
                                              </div>
                                            ) : null}

                                            {/*
                                              THE ONE COHERENT EDIT CARD.

                                              Person, horse, topic, branch and the
                                              ONE instructed trainee this examinee
                                              teaches — saved by ONE button. With
                                              `mayConfigure` false the card falls
                                              back to a read-only summary, so an
                                              ARCHIVED offering keeps a readable
                                              roster and gains no affordance.
                                            */}
                                            {mayConfigure && !requirementsUnknown ? (
                                              <EditExamAssignmentCard
                                                action={boundUpdateExamAssignmentDetailsAction}
                                                assignmentId={examinee.assignmentId}
                                                traineeName={examinee.traineeName}
                                                horseName={examinee.horseName}
                                                instructionTopic={examinee.instructionTopic}
                                                discipline={examinee.discipline}
                                                requiresLessonTopic={
                                                  requirements.requiresLessonTopic
                                                }
                                                requiresDiscipline={requirements.requiresDiscipline}
                                                showInstructedTrainee={
                                                  definitionWantsInstructedTrainee ||
                                                  examinee.instructedTraineeAssignmentId !== null
                                                }
                                                instructedTraineeOptions={instructedChoices}
                                                currentInstructedTraineeAssignmentId={
                                                  examinee.instructedTraineeAssignmentId
                                                }
                                              />
                                            ) : (
                                              <div className="mt-2">
                                                <p className="text-sm font-semibold text-card-foreground">
                                                  {examinee.traineeName}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                  סוס: {horseText(examinee.horseName)}
                                                </p>
                                                {topicText !== null ? (
                                                  <p className="text-xs text-muted-foreground">
                                                    {INSTRUCTION_TOPIC_LABEL}: {topicText}
                                                  </p>
                                                ) : null}
                                                {disciplineText !== null ? (
                                                  <p className="text-xs text-muted-foreground">
                                                    {DISCIPLINE_LABEL}: {disciplineText}
                                                  </p>
                                                ) : null}
                                                {definitionWantsInstructedTrainee ||
                                                examinee.instructedTraineeName !== null ? (
                                                  <p className="text-xs text-muted-foreground">
                                                    {TEACHES_LABEL}:{" "}
                                                    {examinee.instructedTraineeName ??
                                                      NO_TEACHING_LINK_TEXT}
                                                  </p>
                                                ) : null}
                                              </div>
                                            )}

                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </li>
                                ))}
                              </ul>
                            ) : null}

                            {/*
                              The examinees the committed timetable produced no
                              moment for. They are LISTED rather than hidden: a
                              block whose timetable failed still has real people
                              in it, and knowing who they are is what makes it
                              fixable. No time is invented for them.
                            */}
                            {untimed.length > 0 ? (
                              <div className="mt-4">
                                <p className="text-xs font-semibold text-warning">
                                  {UNTIMED_HEADING}
                                </p>
                                <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  {untimed.map((examinee) => (
                                    <li
                                      key={examinee.assignmentId}
                                      className="rounded-lg bg-card px-3 py-2"
                                    >
                                      <p className="text-sm text-card-foreground">
                                        {examinee.traineeName}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        סוס: {horseText(examinee.horseName)}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {waves.length === 0 && untimed.length === 0 ? (
                              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                                עדיין אין חניכים משובצים ליחידת המבחן הזו.
                              </p>
                            ) : null}

                            {/*
                              THE INSTRUCTED TRAINEES NOBODY TEACHES YET.

                              A roster and never a schedule card: no time, no wave
                              and no position, because such a row holds none of
                              them. It exists so a session never looks emptier
                              than its own count, and so a trainee assigned before
                              its examinee was can still be removed.
                            */}
                            {unlinkedInstructed.length > 0 ? (
                              <div className="mt-4 border-t border-border pt-3">
                                <h4 className="text-xs font-semibold text-card-foreground">
                                  {UNLINKED_INSTRUCTED_HEADING}
                                </h4>
                                <ul className="mt-2 flex flex-col gap-1.5">
                                  {unlinkedInstructed.map((assignment) => (
                                    <li
                                      key={assignment.assignmentId}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2"
                                    >
                                      <span className="text-sm text-card-foreground">
                                        {assignment.traineeName}
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
                              </div>
                            ) : null}

                            {/*
                              The two CREATE affordances, on their independent
                              gates — and now behind the DISCLOSURE as well.

                              The disclosure is an extra condition on top of the
                              lifecycle gate and never a replacement for it: with
                              `mayConfigure` false no `add=1` can bring either form
                              back, and each committed writer re-evaluates the same
                              gate for itself regardless.
                            */}
                            {addAssignmentOpen && mayConfigure ? (
                              <div className="mt-4 border-t border-border pt-3">
                                {requirementsUnknown ? (
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    לא ניתן לזהות את דרישות סוג המבחן של יחידה זו,
                                    ולכן אין כאן שיבוץ.
                                  </p>
                                ) : (
                                  <CreateExamAssignmentForm
                                    action={boundCreateAssignmentAction}
                                    courseOfferingId={context.id}
                                    sessionId={session.sessionId}
                                    eligibleTrainees={eligibleView.trainees}
                                    requiresLessonTopic={requirements.requiresLessonTopic}
                                    requiresDiscipline={requirements.requiresDiscipline}
                                  />
                                )}

                                {showInstructedTraineeForm ? (
                                  <div className="mt-3">
                                    <CreateExamInstructedTraineeAssignmentForm
                                      action={boundCreateInstructedTraineeAssignmentAction}
                                      courseOfferingId={context.id}
                                      sessionId={session.sessionId}
                                      eligibleTrainees={eligibleView.trainees}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                    </ul>
                  </>
                )}
              </div>

              {/* =============================================================
                  THE BEGINNER-EXAM REGION.

                  ISOLATED AND EMPTY IN THIS BRANCH. It holds one constant
                  sentence, reads nothing, imports nothing and offers no control.
                  The read-only projection a separate branch is building lands
                  HERE, and nothing else on this page has to move when it does.
                  Beginner exams remain editable only on the Teaching Practice
                  screen.
                  ============================================================= */}
              <section
                aria-label={BEGINNER_REGION_HEADING}
                className="rounded-xl border border-dashed border-border bg-muted p-5"
              >
                <h3 className="text-sm font-semibold text-card-foreground">
                  {BEGINNER_REGION_HEADING}
                </h3>
                {/*
                  THE THREE DISTINGUISHABLE EMPTY STATES.

                  They are different problems with different fixes, and a single
                  "no beginner exams" sentence used to send a manager looking for
                  the wrong one. The level question is delegated to the committed
                  containment predicate; the other two are read from the SAME one
                  admin reading that produced the rows, so what is said here can
                  never disagree with what is shown below it.
                */}
                {!beginnerSupported ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {BEGINNER_LEVEL_UNSUPPORTED_TEXT}
                  </p>
                ) : !hasSourceDates ? (
                  <p className="mt-2 text-sm leading-relaxed text-warning">
                    {BEGINNER_NO_SOURCE_DATES_TEXT}
                  </p>
                ) : orderedBeginnerRows.length === 0 ? (
                  <p className="mt-2 text-sm leading-relaxed text-warning">
                    {BEGINNER_NO_MATCHING_LESSONS_TEXT}
                  </p>
                ) : scheduleView === "general" ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {BEGINNER_IN_GENERAL_VIEW_TEXT}
                  </p>
                ) : beginnerRowsInView.length === 0 ? (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {BEGINNER_NONE_IN_VIEW_TEXT}
                  </p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-3">
                    {beginnerRowsInView.map((row) => (
                      <li
                        key={row.sessionId}
                        className="rounded-lg border border-border bg-card px-4 py-3"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-sm font-semibold text-card-foreground">
                            {row.startTime}
                          </span>
                          <span className="text-sm text-card-foreground">
                            {kindText(row.beginnerFormat)}
                          </span>
                          {row.isPublished ? null : (
                            <span className="text-xs text-warning">{BEGINNER_DRAFT_TEXT}</span>
                          )}
                        </div>
                        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
                          <DefinitionFact label={BLOCK_DATE_LABEL} value={row.date} />
                          <DefinitionFact
                            label={BLOCK_END_LABEL}
                            value={timeText(row.displayEndTime)}
                          />
                          <DefinitionFact
                            label={BLOCK_ARENA_LABEL}
                            value={presentTextOr(row.location, NO_ARENA_TEXT)}
                          />
                          <DefinitionFact
                            label={BEGINNER_GROUP_LABEL}
                            value={presentTextOr(row.groupName, NO_HORSE_TEXT)}
                          />
                          <DefinitionFact
                            label={BEGINNER_RESPONSIBLE_LABEL}
                            value={presentTextOr(row.responsibleInstructorName, NO_HORSE_TEXT)}
                          />
                          <DefinitionFact
                            label={BEGINNER_PARTICIPANTS_LABEL}
                            value={String(row.participantCount)}
                          />
                        </dl>
                        {row.participantNames.length > 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {BEGINNER_PARTICIPANTS_LABEL}: {row.participantNames.join(", ")}
                          </p>
                        ) : null}
                        {row.notes !== null && row.notes !== "" ? (
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {row.notes}
                          </p>
                        ) : null}
                        {row.children.length > 0 ? (
                          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {row.children.map((child) => (
                              <li
                                key={`${row.sessionId}:${child.fullName}:${child.parentPhone ?? ""}`}
                                className="rounded-lg bg-muted px-3 py-2"
                              >
                                <p className="text-sm text-card-foreground">
                                  {child.fullName}
                                  {child.isAbsent ? ` · ${BEGINNER_ABSENT_TEXT}` : ""}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  סוס: {horseText(child.horseName)}
                                </p>
                                {child.age !== null ? (
                                  <p className="text-xs text-muted-foreground">
                                    {BEGINNER_AGE_LABEL}: {String(child.age)}
                                  </p>
                                ) : null}
                                {child.gender !== null && child.gender !== "" ? (
                                  <p className="text-xs text-muted-foreground">{child.gender}</p>
                                ) : null}
                                {child.parentName !== null && child.parentName !== "" ? (
                                  <p className="text-xs text-muted-foreground">
                                    {BEGINNER_PARENT_LABEL}: {child.parentName}
                                  </p>
                                ) : null}
                                {child.parentPhone !== null && child.parentPhone !== "" ? (
                                  <p className="text-xs text-muted-foreground">
                                    {BEGINNER_PARENT_PHONE_LABEL}: {child.parentPhone}
                                  </p>
                                ) : null}
                                {child.equipmentNotes !== null && child.equipmentNotes !== "" ? (
                                  <p className="text-xs text-muted-foreground">
                                    {child.equipmentNotes}
                                  </p>
                                ) : null}
                                {child.childNotes !== null && child.childNotes !== "" ? (
                                  <p className="text-xs leading-relaxed text-muted-foreground">
                                    {child.childNotes}
                                  </p>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {BEGINNER_READ_ONLY_TEXT}
                </p>
              </section>
            </>
          ) : null}

          {/* =================================================================
              SECTION 4 — פרסום

              EX-PUB-UI-MVP, unchanged in every respect that matters: the same
              two mutually-exclusive forms chosen from the committed reader's
              `publishedAt`, the same warning, the same lifecycle gate and the
              same lifecycle policy. Only its position moved.
              ================================================================= */}
          {activeTab === "publication" ? (
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

              {/*
                EX-PUB-UI-MVP — THE PUBLICATION CARD.

                The one surface from which a manager makes the exam plan visible
                to trainees, or takes it back out of sight. It renders the state
                in the two exact words this slice owns, and — behind the SAME
                single lifecycle evaluation every other affordance on this page
                uses — ONE form carrying ONE fixed hidden `operation` value.

                The two forms are MUTUALLY EXCLUSIVE by the stored state: a draft
                plan gets the publish form and no unpublish control, and a
                published plan gets the unpublish form and no publish control.
                Neither is a toggle whose meaning depends on what the client
                believes, and neither reads the query string: `isPublished` comes
                from the committed reader's `publishedAt` and from nothing else.

                NO CLIENT COMPONENT. These are plain POST-ing forms on a Server
                Action, so a GET of this route — a refresh, a back button, a
                prefetch, a bookmark — can never change publication.

                The warning is INFORMATIONAL. It disables nothing: the definition
                and session forms stay exactly as available after publication as
                before, which is the committed lifecycle policy's decision and not
                this page's. EX-ADMIN-WORKSPACE-UX introduces NO publication
                blocking rule of any kind.
              */}
              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="text-sm font-semibold text-card-foreground">
                  פרסום לוח המבחנים
                </h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  מצב נוכחי:{" "}
                  <span className="font-medium text-card-foreground">
                    {isPublished ? PUBLICATION_PUBLISHED_TEXT : PUBLICATION_DRAFT_TEXT}
                  </span>
                </p>

                {isPublished ? (
                  <p className="mt-3 rounded-lg bg-warning-muted px-4 py-3 text-sm leading-relaxed text-warning">
                    {PUBLISHED_WARNING_TEXT}
                  </p>
                ) : null}

                {mayConfigure ? (
                  isPublished ? (
                    <form action={boundSetExamPlanPublicationAction} className="mt-4">
                      <input type="hidden" name="operation" value="UNPUBLISH" readOnly />
                      <button
                        type="submit"
                        className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-card-foreground"
                      >
                        {UNPUBLISH_BUTTON_TEXT}
                      </button>
                    </form>
                  ) : (
                    <form action={boundSetExamPlanPublicationAction} className="mt-4">
                      <input type="hidden" name="operation" value="PUBLISH" readOnly />
                      <button
                        type="submit"
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                      >
                        {PUBLISH_BUTTON_TEXT}
                      </button>
                    </form>
                  )
                ) : null}
              </div>
            </>
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
