"use client";

/**
 * EXAM PLAN P3 — the minimal client form that creates an empty exam plan.
 *
 * ===========================================================================
 * WHY THIS IS A CLIENT COMPONENT AT ALL
 * ===========================================================================
 * For ONE reason: `useFormStatus()` must run inside the `<form>` it describes, and
 * it is what disables the submit button while the action is in flight. Creating a
 * plan is idempotent server-side (a second create finds the existing plan and
 * reports `existing=1` rather than writing again), so a double click cannot produce
 * two plans — but it can produce a confusing second navigation, and a button that
 * stays live while the server works reads as a dead button.
 *
 * It holds NO other client state. There is no `useState`, no `useEffect`, no
 * `useTransition` and no fetch: the offering id is bound into the server action on
 * the SERVER, and all success/refusal feedback is rendered by the server page from
 * the redirect query rather than here.
 *
 * ===========================================================================
 * THE FORM SUBMITS NOTHING
 * ===========================================================================
 * There is deliberately no `<input>` of any kind — not a text field, not a hidden
 * field, not an offering id, not a plan id. The FormData this form produces is
 * EMPTY, and the action it posts to never reads it.
 *
 * That is the point: the only thing that decides which course is written is the id
 * already bound into `action` on the server, and a form that carries no fields
 * cannot be edited in a browser devtools panel to point somewhere else.
 *
 * ===========================================================================
 * CREATION IS ALWAYS AN EXPLICIT CLICK
 * ===========================================================================
 * The write happens on SUBMIT and only on submit. Nothing here fires on mount,
 * on render or on navigation — there is no effect, no auto-submit, no timer and
 * no `router` call. A manager who merely opens the exams screen never creates
 * anything, which is why the page can safely be a plain GET.
 *
 * The button's own label and the surrounding copy on the page both say plainly
 * that this creates an EMPTY plan: no exam is defined, no date is set and nothing
 * is published by clicking it.
 */
import { useFormStatus } from "react-dom";

function CreateExamPlanSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "יוצר…" : "צור תוכנית מבחנים"}
    </button>
  );
}

export function ExamPlanCreateForm({
  action,
}: {
  action: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action}>
      <CreateExamPlanSubmitButton />
    </form>
  );
}
