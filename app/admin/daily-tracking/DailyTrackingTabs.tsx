"use client";

import { useState } from "react";
import Link from "next/link";
import { AttendanceTrackingClient } from "@/app/admin/daily-tracking/AttendanceTrackingClient";
import { CompletionClient, type CompletionRow } from "@/app/admin/completion/CompletionClient";
import { CourseSettingsForm } from "@/app/admin/availability/CourseSettingsForm";
import { PresetsClient } from "@/app/admin/availability/PresetsClient";
import { AvailabilityFilterableGrid } from "@/app/admin/availability/AvailabilityFilterableGrid";
import type { AttendanceTrackingRow } from "@/lib/actions/attendance";

type Tab = "attendance" | "completion" | "availability";

const TAB_LABELS: Record<Tab, string> = {
  attendance: "נוכחות ומעקב יומי",
  completion: "ביצוע תורנויות",
  availability: "זמינות לתורנויות",
};

interface StudentOption {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
}

interface PresetRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

type AvailabilityTabData =
  | {
      hasSettings: true;
      startDate: string;
      endDate: string;
      presets: PresetRow[];
      students: StudentOption[];
      dateKeys: string[];
      availabilityMap: Record<string, boolean>;
    }
  | { hasSettings: false };

export function DailyTrackingTabs({
  attendance,
  completion,
  availability,
}: {
  attendance: {
    initialDateKey: string;
    initialRows: AttendanceTrackingRow[];
    courseStartDateKey: string | null;
    courseEndDateKey: string | null;
  };
  completion: {
    assignments: CompletionRow[];
    defaultDateKey: string;
  };
  availability: AvailabilityTabData;
}) {
  const [tab, setTab] = useState<Tab>("attendance");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "attendance" && (
        <AttendanceTrackingClient
          initialDateKey={attendance.initialDateKey}
          initialRows={attendance.initialRows}
          courseStartDateKey={attendance.courseStartDateKey}
          courseEndDateKey={attendance.courseEndDateKey}
        />
      )}

      {tab === "completion" && (
        <div className="flex flex-col gap-3">
          <CompletionClient
            assignments={completion.assignments}
            defaultDateKey={completion.defaultDateKey}
          />
          <Link
            href="/admin/completion"
            className="self-start text-sm text-muted-foreground underline hover:text-card-foreground"
          >
            מעבר לניהול ביצוע תורנויות (עמוד מלא)
          </Link>
        </div>
      )}

      {tab === "availability" && (
        <div className="flex flex-col gap-4">
          {availability.hasSettings ? (
            <>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-base font-semibold text-card-foreground">
                  תאריכי הקורס
                </h2>
                <CourseSettingsForm
                  startDate={availability.startDate}
                  endDate={availability.endDate}
                />
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-base font-semibold text-card-foreground">
                  פריסטים לזמינות
                </h2>
                <PresetsClient presets={availability.presets} students={availability.students} />
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <h2 className="mb-3 text-base font-semibold text-card-foreground">
                  זמינות חניכים לפי תאריך
                </h2>
                <AvailabilityFilterableGrid
                  students={availability.students}
                  dateKeys={availability.dateKeys}
                  initialAvailability={availability.availabilityMap}
                />
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              יש להגדיר תחילה את תאריכי ההתחלה והסיום של הקורס.
            </p>
          )}
          <Link
            href="/admin/availability"
            className="self-start text-sm text-muted-foreground underline hover:text-card-foreground"
          >
            מעבר לניהול זמינות לתורנויות (עמוד מלא)
          </Link>
        </div>
      )}
    </div>
  );
}
