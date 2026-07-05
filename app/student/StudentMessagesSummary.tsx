"use client";

import { useEffect, useState } from "react";
import { getStudentMessages } from "@/lib/actions/messages";

// Renders nothing until there's something to show - a summary of zeros isn't
// useful on a "today" home screen. Reuses the same getStudentMessages read
// StudentMessagesSection already uses; no new query.
export function StudentMessagesSummary({
  studentId,
  onOpen,
}: {
  studentId: string;
  onOpen: () => void;
}) {
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [openTasks, setOpenTasks] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getStudentMessages(studentId).then((items) => {
      if (cancelled) return;
      setUnreadMessages(items.filter((i) => i.type === "MESSAGE" && !i.readAt).length);
      setOpenTasks(items.filter((i) => i.type === "TASK" && !i.completedAt).length);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId]);

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
