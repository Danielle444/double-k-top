/**
 * EXAM EX-S5B-5B + EXAM PLAN P3 + EXAM EX-S5B-5C — the admin Exams surface of ONE
 * course offering: a read of its ExamDefinition configuration, plus the TWO
 * explicit create affordances that belong to it.
 *
 * Server Component. The page itself holds no state and renders no form control:
 * each create form is a separate client component, and the only mutations it can
 * reach are the two Server Actions bound below.
 *
 * ===========================================================================
 * WHAT THIS ROUTE MAY MUTATE — AND WHAT IT STILL MAY NOT
 * ===========================================================================
 * EXACTLY TWO mutations exist here, and they are MUTUALLY EXCLUSIVE by the state
 * of the plan:
 *
 *   - no plan yet  -> create ONE empty, unpublished ExamPlan;
 *   - plan present -> append ONE ExamDefinition to it.
 *
 * Editing, removing and reordering definitions, deleting or publishing the plan,
 * exam sessions and source dates are NOT reachable — not disabled, not hidden
 * behind a flag, but absent, with no import that could reach them.
 *
 * Both creates are ALWAYS an explicit click. The page performs no write, so a
 * plain GET of this route — a refresh, a back button, a prefetch, a bookmark —
 * can never bring a plan or a definition into existence. There is no effect, no
 * auto-submit and no redirect that writes.
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
 *   4. `evaluateCourseOperationPolicy(context.status, ...)` — the write gate,
 *      asked ONCE as a QUESTION rather than as an assertion, purely to decide
 *      which form to render. It is pure, total and default-deny, so an unknown
 *      status hides both forms instead of exposing either.
 *
 * The reader independently re-runs both the admin/offering boundary and the read
 * gate, and each Server Action's committed writer independently re-runs the admin
 * boundary, the offering lookup AND the write gate. Step 4 is therefore a DISPLAY
 * decision only: hiding a form prevents a pointless round trip and is never what
 * makes the write safe.
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
 *   - `createIssues=<codes>` — known definition validation issue codes.
 *
 * Every parser here is CLOSED in both directions. `created`, `existing` and
 * `createdDefinition` are honoured only on the exact string `"1"`; `error` only on
 * a key the message table actually OWNS — checked with `Object.hasOwn`, so an
 * inherited property name such as `constructor` cannot select a message — and the
 * two definition parsers recognize only their own committed code sets. Every other
 * query value, and every unknown code, is silently IGNORED.
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
import { createExamPlanAction, createExamDefinitionAction } from "./actions";
import { ExamPlanCreateForm } from "./ExamPlanCreateForm";
import { ExamDefinitionCreateForm } from "./ExamDefinitionCreateForm";
import {
  examDefinitionCreateErrorText,
  examDefinitionCreateIssueTexts,
} from "./exam-definition-create-error-messages";

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

  // 4. The CLOSED feedback query, resolved ONCE and only AFTER authorization and
  //    the read. It selects constant messages and influences nothing else — not
  //    the read above, not the back link, not either create affordance.
  const query = await searchParams;
  const feedback = feedbackFrom(query);
  const { createdDefinition, createError, createIssues } = query;
  const createErrorText = examDefinitionCreateErrorText(createError);
  const createIssueTexts = examDefinitionCreateIssueTexts(createIssues);
  const showCreatedNotice = createdDefinition === "1";

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const isPublished = view.publishedAt !== null;
  const hasDefinitions = view.definitions.length > 0;

  // 5. ONE lifecycle evaluation, two display decisions derived from it. The gate
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
