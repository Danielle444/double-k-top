"use server";

import { prisma } from "@/lib/prisma";
import {
  dateKey,
  formatHebrewDate,
  formatHebrewWeekday,
  parseDateKey,
} from "@/lib/dates";

export interface InstructorScheduleItem {
  id: string;
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string | null;
  groupName: string | null;
  instructorName: string | null;
  location: string | null;
}

export interface InstructorScheduleResult {
  hasSchedule: boolean;
  weekName: string | null;
  items: InstructorScheduleItem[];
}

export type InstructorScheduleFilter = "mine" | "all";

// dayKey: a specific date within the week, or "all" for the whole week.
// Matching against the schedule's free-text instructorName column (there is
// no FK from ScheduleItem to Instructor - the Excel import only ever
// produces a name string), so comparison is trimmed/case-insensitive.
export async function getScheduleForInstructor(
  instructorId: string,
  weeklyScheduleId: string,
  dayKey: string | "all",
  filter: InstructorScheduleFilter
): Promise<InstructorScheduleResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor) return { hasSchedule: false, weekName: null, items: [] };

  const week = await prisma.weeklySchedule.findUnique({
    where: { id: weeklyScheduleId },
    include: { items: { orderBy: [{ date: "asc" }, { startTime: "asc" }] } },
  });
  if (!week) return { hasSchedule: false, weekName: null, items: [] };

  const normalizedName = instructor.fullName.trim().toLowerCase();
  const items = week.items.filter((i) => {
    if (filter === "mine" && (i.instructorName ?? "").trim().toLowerCase() !== normalizedName) {
      return false;
    }
    if (dayKey !== "all" && dateKey(i.date) !== dayKey) return false;
    return true;
  });

  return {
    hasSchedule: true,
    weekName: week.name,
    items: items.map((i) => ({
      id: i.id,
      dateKey: dateKey(i.date),
      dateLabel: formatHebrewDate(i.date),
      dayLabel: formatHebrewWeekday(i.date),
      startTime: i.startTime,
      endTime: i.endTime,
      title: i.title,
      description: i.description,
      groupName: i.groupName,
      instructorName: i.instructorName,
      location: i.location,
    })),
  };
}

export interface InstructorDutyRow {
  id: string;
  dateKey: string;
  dateLabel: string;
  dayLabel: string;
  studentId: string;
  studentName: string;
  studentGroupName: string | null;
  studentSubgroupNumber: number | null;
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

  return assignments.map((a) => ({
    id: a.id,
    dateKey: dateKey(a.date),
    dateLabel: formatHebrewDate(a.date),
    dayLabel: formatHebrewWeekday(a.date),
    studentId: a.studentId,
    studentName: a.student.fullName,
    studentGroupName: a.student.groupName,
    studentSubgroupNumber: a.student.subgroupNumber,
    dutyTypeId: a.dutyTypeId,
    dutyTypeName: a.dutyType.name,
    isCompleted: a.isCompleted,
    isPublished: a.isPublished,
  }));
}
