"use server";

import { prisma } from "@/lib/prisma";
import type { ActionResult } from "@/lib/actions/students";
import type { AttendanceStatusValue } from "@/lib/actions/attendance";
import type { CourseMaterialVisibilityValue } from "@/lib/actions/materials";

export interface NotificationRow {
  id: string;
  type: "ATTENDANCE_MARKED" | "MATERIAL_ADDED";
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

function toNotificationRow(n: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  readAt: Date | null;
  createdAt: Date;
}): NotificationRow {
  return {
    id: n.id,
    type: n.type as NotificationRow["type"],
    title: n.title,
    body: n.body,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

// Read-only, unrestricted - same "no NextAuth session for students/
// instructors" convention as every other student/instructor-facing read in
// this app (e.g. getStudentMessages, getRidingSlotStudentNotes). The
// studentId/instructorId filter is what actually scopes the result, not any
// caller-side trust.
export async function getNotificationsForStudent(studentId: string): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientRole: "STUDENT", studentId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toNotificationRow);
}

export async function getNotificationsForInstructor(instructorId: string): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { recipientRole: "INSTRUCTOR", instructorId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toNotificationRow);
}

// Students/instructors have no NextAuth session, so ownership is re-verified
// by re-reading the row and comparing studentId/instructorId before writing -
// never trusted from client-supplied state, same convention as
// markMessageRead/markDutyCompleted.
export async function markNotificationReadAsStudent(
  notificationId: string,
  studentId: string
): Promise<ActionResult> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!notification || notification.recipientRole !== "STUDENT" || notification.studentId !== studentId) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  if (!notification.readAt) {
    await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
  return { success: true };
}

export async function markNotificationReadAsInstructor(
  notificationId: string,
  instructorId: string
): Promise<ActionResult> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (
    !notification ||
    notification.recipientRole !== "INSTRUCTOR" ||
    notification.instructorId !== instructorId
  ) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  if (!notification.readAt) {
    await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  }
  return { success: true };
}

const ATTENDANCE_STATUS_TITLE: Record<Extract<AttendanceStatusValue, "ABSENT" | "PARTIAL">, string> = {
  ABSENT: "סומנת כנעדר/ת",
  PARTIAL: "סומנת כנוכחות חלקית",
};

// Called from upsertAttendanceRecord (lib/actions/attendance.ts) whenever a
// student's attendance is saved. Only ABSENT/PARTIAL ever produce a
// notification - a PRESENT save never creates or touches one, and does not
// remove/reset a previously-created notification either (see the schema
// comment on Notification and this stage's report for why that's the
// deliberately simplest safe choice).
//
// Deduplication: one notification per (studentId, ATTENDANCE_MARKED,
// relatedId=attendanceId) - upserted, not always-created, so repeatedly
// editing the same day's attendance updates the same row (and re-opens it as
// unread, since the content may have changed) instead of piling up
// duplicates for one underlying StudentAttendance record.
export async function syncAttendanceMarkedNotification(params: {
  studentId: string;
  attendanceId: string;
  status: AttendanceStatusValue;
  notes: string | null;
}): Promise<void> {
  if (params.status !== "ABSENT" && params.status !== "PARTIAL") return;

  const title = ATTENDANCE_STATUS_TITLE[params.status];
  const body = params.notes ? `הערת נוכחות: ${params.notes}` : null;

  const existing = await prisma.notification.findFirst({
    where: {
      type: "ATTENDANCE_MARKED",
      recipientRole: "STUDENT",
      studentId: params.studentId,
      relatedId: params.attendanceId,
    },
  });

  if (existing) {
    await prisma.notification.update({
      where: { id: existing.id },
      data: { title, body, readAt: null },
    });
    return;
  }

  await prisma.notification.create({
    data: {
      type: "ATTENDANCE_MARKED",
      recipientRole: "STUDENT",
      studentId: params.studentId,
      relatedId: params.attendanceId,
      title,
      body,
    },
  });
}

// Called from createLinkMaterial (lib/actions/materials.ts) and the file
// upload route whenever a brand-new CourseMaterial row is created - never on
// update/replace of an existing one. Fans recipients out at creation time
// (one Notification row per currently-active student/instructor in scope),
// mirroring how MessageTaskRecipient already materializes recipients for
// MessageTask, so a later roster change never retroactively adds/removes
// notifications for an already-added material.
export async function createMaterialAddedNotifications(params: {
  materialId: string;
  title: string;
  visibility: CourseMaterialVisibilityValue;
}): Promise<void> {
  const notificationTitle = "נוסף חומר קורס חדש";

  if (params.visibility === "STUDENTS" || params.visibility === "BOTH") {
    const students = await prisma.student.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (students.length > 0) {
      await prisma.notification.createMany({
        data: students.map((s) => ({
          type: "MATERIAL_ADDED" as const,
          recipientRole: "STUDENT" as const,
          studentId: s.id,
          relatedId: params.materialId,
          title: notificationTitle,
          body: params.title,
        })),
      });
    }
  }

  if (params.visibility === "INSTRUCTORS" || params.visibility === "BOTH") {
    const instructors = await prisma.instructor.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (instructors.length > 0) {
      await prisma.notification.createMany({
        data: instructors.map((i) => ({
          type: "MATERIAL_ADDED" as const,
          recipientRole: "INSTRUCTOR" as const,
          instructorId: i.id,
          relatedId: params.materialId,
          title: notificationTitle,
          body: params.title,
        })),
      });
    }
  }
}
