/**
 * EXAM EX-S5B-5B / EX-S5B-5C — the admin Exams surface of ONE course offering:
 * a read of its ExamDefinition configuration, plus the ONE create affordance.
 *
 * Server Component. The page itself holds no state and renders no form control:
 * the create form is a separate client component, and the only mutation it can
 * reach is the single Server Action bound below.
 *
 * ===========================================================================
 * WHAT THIS ROUTE MAY MUTATE — AND WHAT IT STILL MAY NOT
 * ===========================================================================
 * EXACTLY ONE mutation exists here: appending one definition to an ALREADY
 * EXISTING exam plan. Editing, removing, reordering, creating the plan itself,
 * exam sessions, source dates and publication are NOT reachable — not disabled,
 * not hidden behind a flag, but absent. No such action is imported, and the
 * committed write bindings for them are never named.
 *
 * A "no exam plan yet" offering is therefore still reported as an ordinary state
 * and is NOT offered a create form: this slice may not bring a plan into
 * existence, and a form that could only fail would be a lie.
 *
 * An ARCHIVED offering stays fully readable and gains no form. That is decided
 * by the course-lifecycle policy rather than by a hand-written status test — see
 * the two gates below.
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
 *      and NOT the definition write gate, so archived exam configuration stays
 *      readable.
 *   3. `readExamDefinitionsForAdmin(context.id)` — with the VERIFIED context id,
 *      never the raw route param.
 *   4. `evaluateCourseOperationPolicy(context.status, ...)` — the write gate,
 *      asked as a QUESTION rather than as an assertion, purely to decide whether
 *      to render the form. It is pure, total and default-deny, so an unknown
 *      status hides the form instead of exposing it.
 *
 * The reader independently re-runs both the admin/offering boundary and the read
 * gate, and the Server Action's committed writer independently re-runs the admin
 * boundary, the offering lookup AND the write gate. Step 4 is therefore a
 * DISPLAY decision only: hiding the form prevents a pointless round trip and is
 * never what makes the write safe.
 *
 * The route's `[courseOfferingId]` is the ONLY scope input. No cookie, no
 * current-offering resolver and no form field can influence which course is
 * read or written. `searchParams` is read for ONE purpose — rendering the
 * outcome of the last create attempt — and never reaches authorization, the
 * reader, the gates or the bound action.
 *
 * ===========================================================================
 * WHAT IS SHOWN, AND WHAT IS DELIBERATELY NOT
 * ===========================================================================
 * Each definition renders the manager's own configuration plus how many sessions
 * use it. No database id, no plan id and no `updatedAt` is rendered: the id
 * appears only as a React `key`, which is never text on the page, and the
 * version stamp belongs to a future conditional-edit slice, not here.
 *
 * The create outcome is rendered from STABLE TOKENS only. The action never puts
 * a submitted name, duration or capacity in the URL, and the local message
 * module renders only codes it recognizes — so the query string cannot place
 * arbitrary text on this page.
 *
 * Nothing on this page touches Teaching Practice, a trainee, a coach, a child or
 * a parent contact — no such module is imported and the reader cannot express
 * any of them.
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
import { createExamDefinitionAction } from "./actions";
import { ExamDefinitionCreateForm } from "./ExamDefinitionCreateForm";
import {
  examDefinitionCreateErrorText,
  examDefinitionCreateIssueTexts,
} from "./exam-definition-create-error-messages";

export const dynamic = "force-dynamic";

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
    createdDefinition?: string;
    createError?: string;
    createIssues?: string;
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

  // 4. The last create attempt's outcome. Read AFTER authorization and the read,
  //    and used for NOTHING but the two notices below.
  const { createdDefinition, createError, createIssues } = await searchParams;
  const createErrorText = examDefinitionCreateErrorText(createError);
  const createIssueTexts = examDefinitionCreateIssueTexts(createIssues);
  const showCreatedNotice = createdDefinition === "1";

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const isPublished = view.publishedAt !== null;
  const hasDefinitions = view.definitions.length > 0;

  // 5. The DISPLAY decision for the create form: the plan must already exist,
  //    and the offering's lifecycle must permit configuring it. Asked without
  //    throwing, so an ARCHIVED offering stays readable while losing the form.
  const mayConfigure = evaluateCourseOperationPolicy(
    context.status,
    "SCHEDULE_DRAFT_CONFIGURATION",
  ).allowed;
  const showCreateForm = view.planExists && mayConfigure;

  return (
    <div className="flex flex-col gap-4">
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
            אין זו שגיאה — פשוט טרם הוגדרה תוכנית מבחנים עבור הקורס. יצירת תוכנית
            אינה מתבצעת במסך זה, ולכן גם לא ניתן להוסיף כאן מבחנים כרגע.
          </p>
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
