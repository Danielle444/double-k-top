"use client";

import { useState } from "react";
import { InstructorCourseScopedContactsSection } from "@/app/instructor/InstructorCourseScopedContactsSection";
import { StudentInstructorContactsSection } from "@/app/student/StudentInstructorContactsSection";

type ContactsTab = "students" | "instructors";

interface ContactsSectionProps {
  /**
   * Which app is mounting this. REQUIRED - there is deliberately no default,
   * because the two audiences must NOT share the students-tab implementation
   * (see below) and a silent default would be the wrong one for somebody.
   */
  audience: "instructor" | "trainee";
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
//  - TRAINEE -> a static panel. Trainees have never been able to read this
//    directory (the server-side audience gate has always returned [] for them,
//    so the tab has only ever rendered an empty list), and they must not be
//    given a course selector or any way to send a courseOfferingId. So the
//    trainee branch mounts NO roster component and issues NO server request at
//    all - the outcome is the same empty tab, reached without a pointless
//    round-trip that could only ever return [].
export function ContactsSection({ audience }: ContactsSectionProps) {
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
          <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
            אין חניכים להצגה
          </p>
        )
      ) : (
        <StudentInstructorContactsSection />
      )}
    </div>
  );
}
