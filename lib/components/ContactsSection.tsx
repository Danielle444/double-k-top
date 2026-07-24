"use client";

import { useEffect, useMemo, useState } from "react";
import { InstructorCourseScopedContactsSection } from "@/app/instructor/InstructorCourseScopedContactsSection";
import { StudentInstructorContactsSection } from "@/app/student/StudentInstructorContactsSection";
import { getTraineeStudentContacts, type TraineeContactRow } from "@/lib/actions/contacts";
import { formatPhoneDisplay, getPhoneHref, getWhatsAppHref } from "@/lib/phone-format";

type ContactsTab = "students" | "instructors";

// LEVEL 2 CONTACTS SLICE C1B: the trainee-facing fellow-trainee directory (the
// restored "חניכים" tab). View-only, full name + phone only. courseOfferingId is
// the trainee's REQUESTED course, forwarded verbatim to getTraineeStudentContacts
// which re-resolves it server-side against this trainee's own ACTIVE enrollments
// and requires the resolved offering's CONTACTS capability - so an unauthorized,
// cross-course, or (dual, unchosen) value just yields the same empty list as any
// other denial. Mirrors StudentInstructorContactsSection's proven flat list.
function TraineeStudentContactsPanel({
  courseOfferingId,
}: {
  courseOfferingId?: string | null;
}) {
  const [rows, setRows] = useState<TraineeContactRow[] | null>(null);
  const [nameQuery, setNameQuery] = useState("");
  const [phoneQuery, setPhoneQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    getTraineeStudentContacts(courseOfferingId).then((result) => {
      if (!cancelled) setRows(result);
    });
    return () => {
      cancelled = true;
    };
  }, [courseOfferingId]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const nameQ = nameQuery.trim().toLowerCase();
    const phoneQ = phoneQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (nameQ && !r.fullName.toLowerCase().includes(nameQ)) return false;
      if (phoneQ && !(r.phone ?? "").toLowerCase().includes(phoneQ)) return false;
      return true;
    });
  }, [rows, nameQuery, phoneQuery]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2">
          <input
            value={nameQuery}
            onChange={(e) => setNameQuery(e.target.value)}
            placeholder="חיפוש לפי שם חניך/ה..."
            className="w-full rounded-xl border border-border px-3 py-2.5 text-base"
          />
          <input
            value={phoneQuery}
            onChange={(e) => setPhoneQuery(e.target.value)}
            placeholder="חיפוש לפי טלפון..."
            className="w-full rounded-xl border border-border px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {rows === null ? (
        <p className="text-base text-muted-foreground">טוען...</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
          אין חניכים התואמים את החיפוש
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRows.map((row) => {
            const phoneHref = getPhoneHref(row.phone);
            const whatsAppHref = getWhatsAppHref(row.phone);
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-border p-4"
              >
                <p className="text-lg font-bold text-card-foreground">{row.fullName}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {phoneHref ? (
                    <a href={phoneHref} className="text-base font-semibold text-accent underline">
                      {formatPhoneDisplay(row.phone)}
                    </a>
                  ) : (
                    <span className="text-base italic text-muted-foreground">
                      {formatPhoneDisplay(row.phone)}
                    </span>
                  )}
                  {whatsAppHref && (
                    <a
                      href={whatsAppHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full bg-success-muted px-2.5 py-1 text-xs font-medium text-success"
                    >
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ContactsSectionProps {
  /**
   * Which app is mounting this. REQUIRED - there is deliberately no default,
   * because the two audiences must NOT share the students-tab implementation
   * (see below) and a silent default would be the wrong one for somebody.
   */
  audience: "instructor" | "trainee";
  /**
   * L2-DUAL: the TRAINEE's requested course, forwarded to the instructors tab. A
   * request only - the server re-resolves it against that trainee's own ACTIVE
   * enrollments and requires the resolved offering's CONTACTS capability.
   *
   * Meaningful for audience="trainee" only. The instructor app passes nothing and
   * its behaviour is unchanged; the students tab ignores it entirely (the
   * instructor roster there has its own separate, explicit course selection).
   */
  traineeCourseOfferingId?: string | null;
}

// Shared by both the student and instructor apps. The INSTRUCTORS tab is
// genuinely common: StudentInstructorContactsSection renders the flat
// instructor-contacts list (name/phone search) for both roles, and its
// no-argument getInstructorContacts() action course-authorizes the trainee
// audience server-side (slice C1A).
//
// The STUDENTS tab is NOT common, as of slice C0-B. Trainee PII is instructor-
// only, and the instructor read now requires an EXPLICIT course context, so the
// two audiences diverge here:
//
//  - INSTRUCTOR -> InstructorCourseScopedContactsSection: pick a course, then see
//    that course's roster.
//  - TRAINEE -> TraineeStudentContactsPanel (slice C1B): the RESTORED trainee
//    view of fellow trainees, bound to the trainee's REQUESTED course
//    (traineeCourseOfferingId). It is course-scoped server-side by
//    getTraineeStudentContacts (the trainee's OWN enrollment resolves the course,
//    CONTACTS must be ENABLED, roster scoped to that offering) and shows full
//    name + phone only. The client sends only the requested offering id - never a
//    studentId or membership claim. A dual trainee who has not chosen a course
//    resolves ambiguously server-side and gets an empty list (fail closed).
export function ContactsSection({ audience, traineeCourseOfferingId }: ContactsSectionProps) {
  const [tab, setTab] = useState<ContactsTab>("students");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("students")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${
            tab === "students"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          חניכים
        </button>
        <button
          type="button"
          onClick={() => setTab("instructors")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold ${
            tab === "instructors"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          מדריכים / מאמנים
        </button>
      </div>

      {tab === "students" ? (
        audience === "instructor" ? (
          <InstructorCourseScopedContactsSection />
        ) : (
          <TraineeStudentContactsPanel courseOfferingId={traineeCourseOfferingId} />
        )
      ) : (
        <StudentInstructorContactsSection
          courseOfferingId={audience === "trainee" ? traineeCourseOfferingId : undefined}
        />
      )}
    </div>
  );
}
