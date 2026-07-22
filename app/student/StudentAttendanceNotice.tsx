"use client";

import { useEffect, useState } from "react";
import {
  getStudentAttendanceNotice,
  type StudentAttendanceNotice as AttendanceNoticeDTO,
} from "@/lib/actions/attendance";

const ABSENT_MESSAGE =
  "סומנת כלא נוכח/ת היום. יש לעדכן את הצוות מי מחליף אותך באחריות על הסוס.";
const PARTIAL_MESSAGE =
  "סומנת כנוכחות חלקית היום. יש לעדכן את הצוות אם נדרשת החלפה או התאמה באחריות על הסוס.";

// Renders nothing until there's an actual ABSENT/PARTIAL exception for this
// date - mirrors StudentMessagesSummary's "render nothing if there's nothing
// to show" pattern. Read-only: no edit or clear control is offered here.
// ATT-SEC-1: no studentId is passed - the server action derives the current
// trainee from the signed session and returns only that trainee's own record
// for this one date, and only for ABSENT/PARTIAL (never PRESENT, never another
// student).
export function StudentAttendanceNotice({
  dateKey,
}: {
  dateKey: string;
}) {
  const [notice, setNotice] = useState<AttendanceNoticeDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    getStudentAttendanceNotice(dateKey).then((n) => {
      if (cancelled) return;
      setNotice(n);
    });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  if (!notice) return null;

  const message = notice.status === "ABSENT" ? ABSENT_MESSAGE : PARTIAL_MESSAGE;

  return (
    <div className="rounded-2xl border border-warning bg-warning-muted p-4">
      <p className="text-sm font-semibold text-warning">{message}</p>
      {notice.status === "PARTIAL" && (notice.arrivalTime || notice.departureTime) && (
        <p className="mt-1 text-sm text-warning">
          {notice.arrivalTime && `הגעה: ${notice.arrivalTime}`}
          {notice.arrivalTime && notice.departureTime && " · "}
          {notice.departureTime && `יציאה: ${notice.departureTime}`}
        </p>
      )}
      {notice.notes && <p className="mt-1 text-sm text-warning">הערות הצוות: {notice.notes}</p>}
    </div>
  );
}
