"use client";

/**
 * EXAM EX-SES-UI-2 — the removal control for ONE stored ExamSession.
 *
 * A POST-ing `<form>`, never a link. A removal must not be reachable by a GET: a
 * bookmark, a prefetch, a crawler, a "open in new tab" or a browser that
 * speculatively fetches a hovered href would all issue one, and any of those would
 * delete an exam date nobody clicked. For the same reason no session id appears in
 * an `href` anywhere in this file — the id travels as a hidden form field inside
 * the submission, and the only navigation this component can cause is the one the
 * Server Action performs after the write.
 *
 * This is a client component for exactly ONE reason, and it is pure UX:
 * `useFormStatus()` (which must run INSIDE the `<form>`) disables the button while
 * the action is in flight, so a double click cannot send two deletes.
 *
 * ===========================================================================
 * THE TWO HIDDEN FIELDS
 * ===========================================================================
 *   - `sessionId` names the row. It proves nothing: the committed writer resolves
 *     the plan from the SERVER-BOUND offering id and looks this id up WITHIN that
 *     plan, so an id belonging to another course's plan is reported as "not found"
 *     and nothing is deleted.
 *   - `expectedUpdatedAt` is the OPTIMISTIC CONCURRENCY token — the `updatedAt`
 *     epoch-millisecond stamp of the row this control was rendered from. It is
 *     carried as a hidden field and NEVER rendered as text, put in an href, or
 *     transformed here. The committed writer's conditional delete matches on it,
 *     so a click built from a stale page refuses instead of removing a session
 *     that has changed since it was shown.
 *
 * ===========================================================================
 * THE BLOCKED STATE IS AN EXPLANATION, NOT AN AUTHORIZATION
 * ===========================================================================
 * When the page reports that examinees are already assigned, this component
 * renders a fixed sentence INSTEAD of an active form: there is no button, no
 * hidden field and no `<form>` at all in that branch, so there is nothing to
 * submit — which is stronger than a disabled button, since a disabled control can
 * be re-enabled from a console while an absent form cannot be submitted at all.
 *
 * That is a courtesy to the manager and NOT the rule. The count came from a read
 * that has already happened, and an examinee can be assigned a moment later, so
 * the committed removal writer counts assignments again itself AND carries an
 * atomic `assignments: { none: {} }` condition on the delete statement. A session
 * that gains an assignment between the page read and the click is refused by the
 * DATABASE, and the resulting `session_has_assignments` code is rendered by the
 * page. Nothing in this file may ever be read as if it were the authority.
 */
import { useFormStatus } from "react-dom";

/**
 * The destructive submit.
 *
 * Deliberately worded so the consequence is unmistakable before the click, and
 * styled with the danger tokens rather than the ordinary secondary button: this is
 * a HARD delete, and the session's breaks and supervisors go with it by the
 * schema's own cascade.
 */
function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-danger px-4 py-2 text-sm font-medium text-danger-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "מוחק…" : "מחיקת מועד הבחינה"}
    </button>
  );
}

export function ExamSessionDeleteForm({
  action,
  sessionId,
  expectedUpdatedAt,
  hasAssignments,
}: {
  action: (formData: FormData) => void | Promise<void>;
  sessionId: string;
  expectedUpdatedAt: number;
  hasAssignments: boolean;
}) {
  // The blocked branch renders NO form and NO field — see the header.
  if (hasAssignments) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        לא ניתן למחוק מועד בחינה שכבר משובצים אליו נבחנים. יש להסיר תחילה את
        השיבוצים, ולאחר מכן ניתן יהיה למחוק את המועד.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
      <p className="text-xs leading-relaxed text-muted-foreground">
        מחיקת מועד הבחינה היא סופית ואינה ניתנת לביטול.
      </p>
      <div>
        <DeleteSubmitButton />
      </div>
    </form>
  );
}
