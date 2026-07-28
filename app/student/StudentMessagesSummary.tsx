"use client";

import type { StudentMessageItem } from "@/lib/actions/messages";

// Renders nothing until there's something to show - a summary of zeros isn't
// useful on a "today" home screen.
//
// PERF-1 / P2B - THIS COMPONENT NO LONGER FETCHES. It used to call
// getStudentMessages(studentId) itself, which meant the trainee home screen
// issued that exact request TWICE: once here for the unread/open counts, and
// once in StudentClient for the "new since last opened" dot - two serialized
// Server Action round trips (Next.js dispatches them one at a time per client)
// carrying one identical payload. StudentClient now owns that single load and
// passes the items down.
//
// The COUNTING RULE IS UNCHANGED and deliberately stays here rather than moving
// into the shell: it is this card's own presentation logic, and hoisting it
// would put the same derivation in a second place. The items are consumed
// exactly as the action returns them - no archived-row filtering is added or
// removed - so whatever getStudentMessages includes is counted precisely as
// before.
export function StudentMessagesSummary({
  items,
  onOpen,
}: {
  // The trainee's own messages/tasks, already loaded by StudentClient.
  // `null` = NOT LOADED YET, deliberately distinct from `[]` (= none at all).
  // Both render nothing, which is exactly what this card did while its own
  // request was in flight, so the loading and empty states are unchanged.
  //
  // No studentId is accepted any more: with the fetch gone there is nothing here
  // for an identity to select, and the payload was already resolved from the
  // signed session server-side.
  items: StudentMessageItem[] | null;
  onOpen: () => void;
}) {
  const unreadMessages =
    items?.filter((i) => i.type === "MESSAGE" && !i.readAt).length ?? 0;
  const openTasks = items?.filter((i) => i.type === "TASK" && !i.completedAt).length ?? 0;

  if (unreadMessages === 0 && openTasks === 0) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-between rounded-2xl border border-accent bg-secondary p-4 text-right"
    >
      <div className="flex flex-col gap-0.5">
        {unreadMessages > 0 && (
          <p className="text-sm font-semibold text-secondary-foreground">
            {unreadMessages} הודעות שלא נקראו
          </p>
        )}
        {openTasks > 0 && (
          <p className="text-sm font-semibold text-secondary-foreground">
            {openTasks} משימות פתוחות
          </p>
        )}
      </div>
      <span className="text-secondary-foreground">‹</span>
    </button>
  );
}
