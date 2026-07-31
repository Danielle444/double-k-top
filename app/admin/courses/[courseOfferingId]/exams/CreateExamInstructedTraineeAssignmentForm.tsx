"use client";

/**
 * EXAM EX-ASG-IT2 — the create form for ONE stored INSTRUCTED_TRAINEE assignment
 * on ONE stored exam session.
 *
 * This is a client component for exactly ONE reason, and it is pure UX:
 * `useFormStatus()` (which must run INSIDE the `<form>`) disables the submit
 * button while the action is in flight, so a double click cannot send two
 * creates for the same trainee. Everything else here is ordinary markup.
 *
 * ===========================================================================
 * EXACTLY TWO FIELDS LEAVE THIS FORM
 * ===========================================================================
 *   - `sessionId`  — hidden, the session this form was rendered under;
 *   - `studentId`  — the chosen trainee, a native `<select>` value.
 *
 * AND DELIBERATELY NOT A THIRD. There is no horse field: an INSTRUCTED TRAINEE
 * is the person BEING INSTRUCTED in an advanced-instruction block, the horse is
 * the examinee's concern, and the committed create path has no field for one at
 * any layer. There is no role field either — the role is a literal the committed
 * core fixes and no submission can express — and no pairing field, because this
 * slice writes no pairing. There is no course field, no plan field, no definition
 * field, no order field and no count field: not hidden, not disabled, but ABSENT
 * from the markup. The offering is bound into the action on the SERVER, the plan
 * is derived from it, and the position is computed by the writer inside its own
 * transaction.
 *
 * `courseOfferingId` is a PROP and NOT a field. It exists so the calling page can
 * be typed against the same offering it bound into the action, and it is never
 * rendered, never submitted and never placed in an `href`. A hidden offering
 * input would be exactly the forgeable scope this route refuses to have.
 *
 * ===========================================================================
 * THE CHOSEN TRAINEE IS A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The select submits an OPAQUE `Student.id`. It proves nothing: the committed
 * writer re-resolves the offering, and then matches the trainee through ONE
 * fail-closed statement requiring an ACTIVE enrolment IN THAT OFFERING and an
 * active trainee — so a hand-edited option value naming another course's trainee
 * is refused, indistinguishably from an unknown id. Rendering only the offered
 * trainees is a convenience for the manager; it is not the enforcement, and
 * nothing here should ever be read as if it were.
 *
 * The list is NOT narrowed by who is already assigned, here or on the server.
 * Whether a person may take a second place in one session is the DATABASE's
 * role-blind unique key to decide, and a client-side filter over a read that has
 * already finished could only ever disagree with it.
 *
 * ONLY `fullName` IS DISPLAYED. Two trainees who share a display name therefore
 * look identical in the list while remaining DISTINCT options, because their
 * values differ. That is a deliberate trade: an identity number rendered merely
 * to tell two names apart would put a national id on a screen that has no
 * product reason to show one. No phone, parent contact, group, subgroup or
 * enrolment detail is available to this component either — the choice type
 * carries two fields and cannot express any of them.
 *
 * ===========================================================================
 * A NATIVE SELECT, ON PURPOSE
 * ===========================================================================
 * No searchable-select dependency is introduced. A native `<select>` is
 * keyboard- and screen-reader-accessible by default, works on the phones and
 * tablets this admin area is actually used on, and adds nothing to the bundle.
 *
 * ===========================================================================
 * NOTHING IS INSERTED OPTIMISTICALLY
 * ===========================================================================
 * The form renders no pending row and holds no local list. On success the action
 * revalidates and redirects, and the assignment list is re-read from the
 * database — so what the manager sees afterwards is what was actually stored,
 * never what this component hoped would be. There is no `fetch`, no `useEffect`,
 * no router call, no auto-submit and no client-side copy of any business rule:
 * the eligibility rule, the definition requirement and the duplicate rule are all
 * decided server-side, and duplicating them here would only let the two drift.
 *
 * There is no edit control and no reorder control anywhere in this file.
 */
import { useFormStatus } from "react-dom";

/**
 * ONE assignable trainee, as the page describes her to this form.
 *
 * Two fields, and deliberately only two: an opaque id that exists to be
 * submitted back, and the display name. Nothing else is offered, so nothing else
 * can be leaked or accidentally rendered.
 *
 * Declared LOCALLY rather than imported from the sibling examinee form: that
 * type is that component's own contract, and sharing it would tie two separately
 * reviewed surfaces together so that widening either one silently widens the
 * other.
 */
interface InstructedTraineeChoice {
  readonly studentId: string;
  readonly fullName: string;
}

const FIELD_CLASS =
  "rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The submit button.
 *
 * Disabled while the action is in flight AND whenever there is no trainee to
 * choose — the two reasons are independent, and either one alone is enough.
 */
function CreateSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      aria-disabled={isDisabled}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "שומר..." : "שבץ חניך מודרך"}
    </button>
  );
}

export function CreateExamInstructedTraineeAssignmentForm({
  action,
  courseOfferingId,
  sessionId,
  eligibleTrainees,
}: {
  action: (formData: FormData) => void | Promise<void>;
  courseOfferingId: string;
  sessionId: string;
  eligibleTrainees: readonly InstructedTraineeChoice[];
}) {
  // Referenced ONLY so the narrow, page-typed prop does not read as an
  // accidentally unused parameter. It is never rendered, never submitted and
  // never put in an href: the offering reaches the writer through the action's
  // server-side binding alone.
  void courseOfferingId;

  /**
   * An assignment must name a trainee, so with none to offer there is nothing
   * this form could legitimately submit. The whole field set is disabled rather
   * than hidden, and the reason is stated in words: a form that vanished would
   * leave the manager guessing, and one that submitted would fail server-side
   * with a diagnostic that describes the same missing prerequisite one round
   * trip later.
   *
   * A disabled `<fieldset>` disables every control inside it — the select and,
   * through the button's own prop, the submit — and disabled controls submit no
   * entry at all, so this is not merely a visual state.
   */
  const hasNoTrainees = eligibleTrainees.length === 0;

  return (
    <form action={action} className="flex flex-col gap-3">
      {hasNoTrainees ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          אין כרגע חניכים פעילים הזמינים לשיבוץ בקורס הזה.
        </p>
      ) : null}

      {/*
        The session this form belongs to. Hidden rather than chosen: the manager
        already picked the session by clicking under it, and offering a second
        session picker here would let one form write to a session the manager is
        not looking at. It proves nothing either — the committed writer looks the
        id up WITHIN the plan it resolved from the server-bound offering.
      */}
      <input type="hidden" name="sessionId" value={sessionId} />

      <fieldset disabled={hasNoTrainees} className="flex flex-col gap-3 border-0 p-0">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-card-foreground">חניך מודרך</span>
          <select name="studentId" required defaultValue="" className={FIELD_CLASS}>
            {/*
              An empty, non-selectable placeholder rather than a pre-selected
              first trainee: who is being instructed is a decision the manager
              must make, and defaulting to whoever sorts first would let a
              distracted submit assign the wrong person.
            */}
            <option value="" disabled>
              בחירת חניך
            </option>
            {eligibleTrainees.map((trainee) => (
              <option key={trainee.studentId} value={trainee.studentId}>
                {trainee.fullName}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div>
        <CreateSubmitButton disabled={hasNoTrainees} />
      </div>
    </form>
  );
}
