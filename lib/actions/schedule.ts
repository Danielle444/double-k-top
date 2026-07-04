"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { generateSchedule, type GenerateMode } from "@/lib/scheduler";
import { parseDateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";

export interface GenerateResult extends ActionResult {
  daysProcessed?: number;
  assignedCount?: number;
  warnings?: string[];
}

export interface RunGenerateOptions {
  startDate?: Date;
  endDate?: Date;
  mode?: GenerateMode;
}

function revalidateScheduleRelatedPaths() {
  revalidatePath("/admin/schedule");
  revalidatePath("/admin/completion");
  revalidatePath("/admin");
  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/student");
}

export async function runGenerateSchedule(
  options: RunGenerateOptions = {}
): Promise<GenerateResult> {
  let { startDate, endDate } = options;
  const mode = options.mode ?? "regeneratePreserveManual";

  if (!startDate || !endDate) {
    const settings = await prisma.courseSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return { success: false, error: "יש להגדיר תחילה את תאריכי הקורס" };
    }
    startDate = settings.startDate;
    endDate = settings.endDate;
  }

  const result = await generateSchedule({ startDate, endDate, mode });

  revalidateScheduleRelatedPaths();

  return { success: true, ...result };
}

export async function setPublishStatus(
  startDate: Date,
  endDate: Date,
  isPublished: boolean
): Promise<ActionResult> {
  await prisma.dutyAssignment.updateMany({
    where: { date: { gte: startDate, lte: endDate } },
    data: { isPublished },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function reassignDuty(
  assignmentId: string,
  newStudentId: string
): Promise<ActionResult> {
  const assignment = await prisma.dutyAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (!assignment) {
    return { success: false, error: "השיבוץ לא נמצא" };
  }

  const conflict = await prisma.dutyAssignment.findUnique({
    where: { date_studentId: { date: assignment.date, studentId: newStudentId } },
  });
  if (conflict && conflict.id !== assignmentId) {
    return { success: false, error: "לתלמיד/ה זה כבר יש תורנות ביום זה" };
  }

  await prisma.dutyAssignment.update({
    where: { id: assignmentId },
    data: { studentId: newStudentId, isManual: true },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function createManualAssignment(
  dateKeyStr: string,
  dutyTypeId: string,
  studentId: string
): Promise<ActionResult> {
  const date = parseDateKey(dateKeyStr);
  const conflict = await prisma.dutyAssignment.findUnique({
    where: { date_studentId: { date, studentId } },
  });
  if (conflict) {
    return { success: false, error: "לתלמיד/ה זה כבר יש תורנות ביום זה" };
  }

  await prisma.dutyAssignment.create({
    data: { date, dutyTypeId, studentId, isManual: true },
  });

  revalidateScheduleRelatedPaths();
  return { success: true };
}

export async function deleteAssignment(assignmentId: string): Promise<ActionResult> {
  await prisma.dutyAssignment.delete({ where: { id: assignmentId } });

  revalidateScheduleRelatedPaths();
  return { success: true };
}
