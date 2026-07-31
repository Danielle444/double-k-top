"use client";

/**
 * EXAM EX-ASG-UI1 — the removal control for ONE stored exam assignment.
 *
 * A POST-ing `<form>`, never a link. A removal must not be reachable by a GET: a
 * bookmark, a prefetch, a crawler, an "open in new tab" or a browser that
 * speculatively fetches a hovered href would all issue one, and any of those
 * would unassign a trainee nobody clicked. For the same reason no assignment id
 * appears in an `href` anywhere in this file — the id travels as a hidden form
 * field inside the submission, and the only navigation this component can cause
 * is the one the Server Action performs after the write.
 *
 * This is a client component for exactly ONE reason, and it is pure UX:
 * `useFormStatus()` (which must run INSIDE the `<form>`) disables the button
 * while the action is in flight, so a double click cannot send two removals.
 *
 * ===========================================================================
 * ONE HIDDEN FIELD, AND DELIBERATELY NOT A SECOND
 * ===========================================================================
 * `assignmentId` names the row, and it is the ONLY thing submitted. There is no
 * session field, no plan field, no offering field, no trainee field, no role
 * field and no order field: none of them could make the removal safer, and each
 * would be one more client-supplied value the server would have to distrust.
 *
 * The id proves nothing on its own. The committed writer resolves the plan from
 * the SERVER-BOUND offering id and locates this id WITHIN that plan, then deletes
 * exactly the row THAT read returned — so an id belonging to another course's
 * plan is reported as "not found" and nothing is deleted.
 *
 * ===========================================================================
 * NO CONFIRMATION DIALOG, AND NO OPTIMISTIC REMOVAL
 * ===========================================================================
 * UI1 adds no `confirm()` and no modal. A removal here is cheap and immediately
 * repeatable — the manager can simply assign the trainee again — so a blocking
 * dialog would cost more than the mistake it guards against, and a JS
 * confirmation is not a security control in any case. If a confirmation step is
 * wanted later it is a product decision with its own review.
 *
 * The form removes no row from the screen itself and holds no local list. On
 * success the action revalidates and redirects, and the assignment list is
 * re-read from the database — so what the manager sees afterwards is what was
 * actually stored.
 */
import { useFormStatus } from "react-dom";

/**
 * The destructive submit.
 *
 * Styled with the danger tokens rather than the ordinary secondary button: this
 * is a HARD delete of the stored row, with no archive column behind it.
 */
function DeleteSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-danger-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "מסיר..." : "הסר שיבוץ"}
    </button>
  );
}

export function DeleteExamAssignmentForm({
  action,
  courseOfferingId,
  assignmentId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  courseOfferingId: string;
  assignmentId: string;
}) {
  // Referenced ONLY so the narrow, page-typed prop does not read as an
  // accidentally unused parameter. It is never rendered, never submitted and
  // never put in an href: the offering reaches the writer through the action's
  // server-side binding alone.
  void courseOfferingId;

  return (
    <form action={action}>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <DeleteSubmitButton />
    </form>
  );
}
