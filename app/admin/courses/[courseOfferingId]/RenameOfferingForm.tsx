"use client";

/**
 * ACTIVE-RENAME - the minimal client rename form.
 *
 * The ONLY reason this is a client component is the "disable duplicate submission
 * while pending" requirement: useFormStatus() (which must run inside the <form>)
 * disables the submit button while the server action is in flight. It holds no
 * other client state - the offering id is bound into the server action on the
 * server, the current name is passed in as a prop, and success/error feedback is
 * rendered by the server page from the redirect query, not here.
 *
 * The hidden `expectedCurrentName` carries the name as it was at page load; the
 * server compares it inside an atomic conditional update for stale-write
 * protection. The visible text input is uncontrolled (defaultValue) so the
 * manager can edit it freely.
 */
import { useFormStatus } from "react-dom";

function RenameSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "שומר…" : "שמור שם"}
    </button>
  );
}

export function RenameOfferingForm({
  action,
  currentName,
}: {
  action: (formData: FormData) => void | Promise<void>;
  currentName: string;
}) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="expectedCurrentName" value={currentName} readOnly />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-card-foreground">שם הקורס</span>
        <input
          type="text"
          name="name"
          required
          defaultValue={currentName}
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-card-foreground"
        />
      </label>
      <div>
        <RenameSubmitButton />
      </div>
    </form>
  );
}
