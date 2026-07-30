/**
 * EXAM EX-S5B-5B — the FIRST Exams surface: a READ-ONLY admin view of ONE course
 * offering's ExamDefinition configuration.
 *
 * Server Component only. There is no `"use client"` here and no client component
 * in this route: everything on the page is static text derived from one server
 * read, so there is no state to hold, nothing to hydrate and no optimistic
 * update to get wrong.
 *
 * ===========================================================================
 * READ-ONLY BY CONSTRUCTION
 * ===========================================================================
 * This route contains NO Server Action, no `<form>`, no `<button>`, no `action=`
 * and no mutation import of any kind. The committed definition WRITE bindings
 * (create / edit / delete / reorder) and the plan-creation, source-date and
 * session slices are deliberately NOT reachable from here — not disabled, not
 * hidden behind a policy flag, but absent. A "no exam plan yet" offering is
 * therefore reported as an ordinary state and NOT offered a create button: this
 * slice may not bring a plan into existence, and a fake disabled affordance
 * would only claim otherwise.
 *
 * That is also why an ARCHIVED offering needs no special handling. The page is
 * readable history for PLANNED, ACTIVE and ARCHIVED alike, and there is no
 * mutation affordance for the lifecycle to have to withdraw.
 *
 * ===========================================================================
 * THE ORDER
 * ===========================================================================
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin FIRST, then the
 *      exact offering. Only the typed not-found fails closed as `notFound()`,
 *      and it never reflects the requested id back; the auth redirect and every
 *      unexpected error propagate untouched.
 *   2. `assertCourseOperationAllowed(context.status, "HISTORICAL_READ")` — the
 *      course-lifecycle READ gate, on the VERIFIED status. This is the read gate
 *      and NOT the definition write gate, so archived exam configuration stays
 *      readable.
 *   3. `readExamDefinitionsForAdmin(context.id)` — with the VERIFIED context id,
 *      never the raw route param.
 *
 * The reader independently re-runs both the admin/offering boundary and the same
 * lifecycle gate. That repetition is intended: the page must not be the only
 * thing standing between a caller and the data, and the page needs the verified
 * context anyway for its own back link.
 *
 * The route's `[courseOfferingId]` is the ONLY scope input. No `searchParams`, no
 * cookie, no current-offering resolver and no form field can influence which
 * course is read.
 *
 * ===========================================================================
 * WHAT IS SHOWN, AND WHAT IS DELIBERATELY NOT
 * ===========================================================================
 * Each definition renders the manager's own configuration plus how many sessions
 * use it. No database id, no plan id and no `updatedAt` is rendered: the id
 * appears only as a React `key`, which is never text on the page, and the
 * version stamp belongs to a future conditional-edit slice, not to a reader.
 *
 * Nothing on this page touches Teaching Practice, a student, an instructor, a
 * child or a parent contact — the reader cannot express any of them, and no such
 * module is imported.
 *
 * The Hebrew exam-kind labels are spelled out LOCALLY rather than imported from
 * the shared label module: that module is still inside the committed EX-C1
 * containment boundary, which forbids a page from importing it. The trade-off is
 * recorded deliberately — a kind added to the enum will render as the explicit
 * unknown text below instead of failing the build here — and both should collapse
 * back onto the shared map when that boundary is lifted.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
  type AdminCourseContext,
} from "@/lib/course/admin-course-context";
import { assertCourseOperationAllowed } from "@/lib/course/operation-policy-core";
import {
  readExamDefinitionsForAdmin,
  type AdminExamDefinitionListView,
} from "@/lib/actions/exam-definition-read-io";

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
}: {
  params: Promise<{ courseOfferingId: string }>;
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

  const dashboardHref = `/admin/courses/${encodeURIComponent(context.id)}`;
  const isPublished = view.publishedAt !== null;
  const hasDefinitions = view.definitions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-card-foreground">מבחנים</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          הגדרות המבחנים של הקורס, לקריאה בלבד. מוצגות ההגדרות עצמן בלבד — ללא
          מועדי מבחן, ללא שיבוץ נבחנים וללא נתוני חניכים או מדריכים.
        </p>
      </div>

      {!view.planExists ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-5">
          <h3 className="text-sm font-semibold text-card-foreground">
            עדיין לא נוצרה תוכנית מבחנים לקורס זה
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            אין זו שגיאה — פשוט טרם הוגדרה תוכנית מבחנים עבור הקורס. יצירת תוכנית
            והגדרת מבחנים אינן מתבצעות במסך זה, שהוא מסך צפייה בלבד.
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
                קיימת תוכנית מבחנים לקורס, אך עדיין לא הוגדר בה אף מבחן. הגדרת
                מבחנים אינה מתבצעת במסך זה.
              </p>
            </div>
          )}
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
