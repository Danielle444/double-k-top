"use server";

import { prisma } from "@/lib/prisma";
import {
  dateKey,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
} from "@/lib/dates";
import { loadHistoricalTraineeState } from "@/lib/course/historical-trainee-state";

/**
 * LEVEL 2 SLICE S2A - the GLOBAL instructor schedule reader that used to live
 * here (`getScheduleForInstructor`) has been DELETED, along with the
 * InstructorScheduleItem / InstructorScheduleResult / InstructorScheduleFilter
 * types and the normalizeHebrewName / isInstructorMatch / isMealItem helpers.
 *
 * It was the last instructor schedule reader that could not tell Level 1 from
 * Level 2: it looked a week up by bare id with no offering predicate, and it
 * accepted a CLIENT-SUPPLIED instructorId as identity with no session check at
 * all. Both properties are gone rather than patched.
 *
 * Its replacement is @/lib/actions/instructor-schedule-course-scoped, which
 * derives identity from the signed session, re-validates an explicitly requested
 * courseOfferingId, requires SCHEDULE=ENABLED, and scopes every week query to the
 * resolved offering. The view types and the "mine"/meal helpers moved verbatim
 * to the pure core @/lib/course/instructor-schedule-scope-core.
 *
 * The duty readers below are UNCHANGED by that slice.
 */

export interface InstructorDutyRow {
  id: string;
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  studentId: string;
  studentName: string;
  studentGroupName: string | null;
  studentSubgroupNumber: number | null;
  studentPhone: string | null;
  dutyTypeId: string;
  dutyTypeName: string;
  isCompleted: boolean;
  isPublished: boolean;
}

export interface InstructorDutyFilters {
  weeklyScheduleId?: string;
  startDateKey?: string;
  endDateKey?: string;
  studentId?: string;
  dutyTypeId?: string;
}

// Instructors can view every duty assignment (published or draft, per the
// manager's decision) for a chosen range, optionally narrowed by student or
// duty type - "draft" rows are still returned, marked via isPublished so the
// UI can label them "טיוטה" instead of hiding them.
export async function getDutyAssignmentsForInstructor(
  filters: InstructorDutyFilters
): Promise<InstructorDutyRow[]> {
  let start: Date;
  let end: Date;

  if (filters.weeklyScheduleId) {
    const week = await prisma.weeklySchedule.findUnique({
      where: { id: filters.weeklyScheduleId },
    });
    if (!week) return [];
    start = week.startDate;
    end = week.endDate;
  } else if (filters.startDateKey && filters.endDateKey) {
    start = parseDateKey(filters.startDateKey);
    end = parseDateKey(filters.endDateKey);
  } else {
    return [];
  }

  const assignments = await prisma.dutyAssignment.findMany({
    where: {
      date: { gte: start, lte: end },
      ...(filters.studentId ? { studentId: filters.studentId } : {}),
      ...(filters.dutyTypeId ? { dutyTypeId: filters.dutyTypeId } : {}),
    },
    include: { student: true, dutyType: true },
    orderBy: [{ date: "asc" }],
  });

  // W6D3-HOTFIX: a duty's group must reflect the group the trainee was in ON THE
  // DUTY'S OWN DATE, not the current Student mirror (which would relabel past
  // duty weeks after a group change). Resolve group from the effective-dated
  // GroupMembership covering each row's date; fail closed to null (no current-
  // mirror fallback) when no single interval covers it — the record still shows.
  const historical = await loadHistoricalTraineeState(assignments.map((a) => a.studentId));

  return assignments.map((a) => {
    const group = historical.groupAt(a.studentId, a.date);
    return {
      id: a.id,
      dateKey: dateKey(a.date),
      dateLabel: formatHebrewDate(a.date),
      dayLabel: formatHebrewWeekday(a.date),
      studentId: a.studentId,
      studentName: a.student.fullName,
      studentGroupName: group.ok ? group.value.groupName : null,
      studentSubgroupNumber: group.ok ? group.value.subgroupNumber : null,
      studentPhone: a.student.phone,
      dutyTypeId: a.dutyTypeId,
      dutyTypeName: a.dutyType.name,
      isCompleted: a.isCompleted,
      isPublished: a.isPublished,
    };
  });
}
