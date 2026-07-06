import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getStudentRidingHistoryForAdmin } from "@/lib/actions/riding-slots";
import { formatHebrewDate, formatHebrewDateTime, getDayPartLabel, parseDateKey } from "@/lib/dates";
import { getRidingHistoryTitle } from "@/lib/schedule-title";

export const dynamic = "force-dynamic";

export default async function StudentRidingHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const result = await getStudentRidingHistoryForAdmin(id);
  if (!result) notFound();

  const { student, rows } = result;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/admin/students"
          className="text-sm text-muted-foreground underline hover:text-card-foreground"
        >
          &larr; חזרה לתלמידים
        </Link>
        <h1 className="mt-1 text-xl font-bold text-card-foreground">
          היסטוריית רכיבה - {student.fullName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {student.groupName ? `קבוצה ${student.groupName}` : "ללא קבוצה"}
          {student.subgroupNumber != null ? ` / תת-קבוצה ${student.subgroupNumber}` : ""} · סוס:{" "}
          {student.horseNameDisplay}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          עדיין לא הוזנו הערות רכיבה לחניך/ה זה/זו.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.ridingSlotId} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-card-foreground">
                  {formatHebrewDate(parseDateKey(row.dateKey))}
                  {getDayPartLabel(row.startTime) && ` · ${getDayPartLabel(row.startTime)}`}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    row.ratingHalfPoints != null
                      ? "bg-success-muted text-success"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.ratingHalfPoints != null ? `דירוג: ${row.ratingHalfPoints / 2}` : "אין דירוג"}
                </span>
              </div>
              <p className="mb-1 text-base font-bold text-card-foreground">
                {getRidingHistoryTitle(row.title)}
              </p>
              <p className="mb-1 text-xs text-muted-foreground">
                מאמן/ת: {row.instructorName ?? "לא הוגדר"} · מגרש: {row.arena ?? "לא הוגדר"}
              </p>
              <p className="mb-1 text-xs text-muted-foreground">{row.horseDisplay}</p>
              {row.note && (
                <p className="mb-1 text-sm text-card-foreground">הערה: {row.note}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
                {row.updatedByName && " · "}
                עודכן בתאריך: {formatHebrewDateTime(new Date(row.updatedAt))}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
