"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/require-admin";
import { fanOutMaterialAddedNotifications } from "@/lib/course/capabilities/material-notification-fanout";
import { getCurrentInstructor, getCurrentTrainee } from "@/lib/auth/actor";
import { authorizeSelfActingClientId } from "@/lib/auth/self-actor-authorization";
import {
  studentNotificationsWhere,
  instructorNotificationsWhere,
  studentUnreadNotificationsWhere,
  instructorUnreadNotificationsWhere,
} from "@/lib/auth/notification-push-scope";
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

// Recipient identity is server-derived from the signed session via
// getCurrentTrainee()/getCurrentInstructor(). The public signatures are
// unchanged (the caller still passes studentId/instructorId), but that value is
// NOT trusted as authority: it is only compared against the authenticated actor
// id, and the query below is scoped by recipientRole AND the SERVER-derived
// actor id, so one recipient can never read another's notifications - not
// across trainees, not across instructors, and not across the trainee/
// instructor audience boundary (a wrong-audience session yields a null actor).
// A missing/invalid/wrong-audience/inactive session (actor === null) and a
// mismatched client-supplied id both fail safely to an empty list, revealing
// nothing about whether any notification exists. Ordering and the
// NotificationRow[] output shape are preserved unchanged.
export async function getNotificationsForStudent(studentId: string): Promise<NotificationRow[]> {
  const actor = await getCurrentTrainee();
  const authorization = authorizeSelfActingClientId(actor?.id, studentId);
  if (!authorization.authorized) {
    return [];
  }
  const rows = await prisma.notification.findMany({
    where: studentNotificationsWhere(authorization.actorId),
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toNotificationRow);
}

export async function getNotificationsForInstructor(instructorId: string): Promise<NotificationRow[]> {
  const actor = await getCurrentInstructor();
  const authorization = authorizeSelfActingClientId(actor?.id, instructorId);
  if (!authorization.authorized) {
    return [];
  }
  const rows = await prisma.notification.findMany({
    where: instructorNotificationsWhere(authorization.actorId),
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toNotificationRow);
}

// Cheap existence checks for the "עוד" tab / "עדכונים" menu-row unread dot -
// a count query instead of fetching full rows, since the caller only needs a
// boolean. Same server-derived actor scoping as the list reads above: the
// client-supplied id is compared only, the count is scoped by recipientRole AND
// the SERVER-derived actor id, and any missing/mismatched/wrong-audience actor
// fails safely to `false` (no unread dot, nothing leaked about another
// recipient's unread state).
export async function hasUnreadNotificationsForStudent(studentId: string): Promise<boolean> {
  const actor = await getCurrentTrainee();
  const authorization = authorizeSelfActingClientId(actor?.id, studentId);
  if (!authorization.authorized) {
    return false;
  }
  const count = await prisma.notification.count({
    where: studentUnreadNotificationsWhere(authorization.actorId),
  });
  return count > 0;
}

export async function hasUnreadNotificationsForInstructor(instructorId: string): Promise<boolean> {
  const actor = await getCurrentInstructor();
  const authorization = authorizeSelfActingClientId(actor?.id, instructorId);
  if (!authorization.authorized) {
    return false;
  }
  const count = await prisma.notification.count({
    where: instructorUnreadNotificationsWhere(authorization.actorId),
  });
  return count > 0;
}

// Trainee identity is server-derived from the signed session via
// getCurrentTrainee() (Stage 0B first-wave enforcement) - the client no longer
// supplies studentId, so it can never be used as identity. Unauthenticated,
// missing, and cross-owner cases all return the same generic failure so the
// response never reveals whether the notification exists or whom it belongs to.
// Ownership is verified atomically in a single ownership-scoped findFirst before
// any write, and first-read semantics are preserved (an already-read row keeps
// its original timestamp).
export async function markNotificationReadAsStudent(
  notificationId: string
): Promise<ActionResult> {
  const actor = await getCurrentTrainee();
  if (actor === null) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, recipientRole: "STUDENT", studentId: actor.id },
    select: { id: true, readAt: true },
  });
  if (!notification) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  if (!notification.readAt) {
    await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
  }
  return { success: true };
}

// Instructor identity is server-derived from the signed session via
// getCurrentInstructor(). The public signature is unchanged (the caller still
// passes instructorId), but that value is NOT trusted as authority: it is only
// compared against the authenticated actor id, and every ownership filter/write
// below uses the SERVER-derived actor id. A missing/invalid/wrong-audience/
// inactive session (actor === null) and a mismatched client-supplied id both
// collapse to the same generic "not found" failure, so the response never
// reveals whether the notification exists or whom it belongs to. Ownership is
// verified atomically in a single ownership-scoped findFirst before any write,
// and first-read semantics are preserved (an already-read row keeps its
// original timestamp).
export async function markNotificationReadAsInstructor(
  notificationId: string,
  instructorId: string
): Promise<ActionResult> {
  const actor = await getCurrentInstructor();
  const authorization = authorizeSelfActingClientId(actor?.id, instructorId);
  if (!authorization.authorized) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      recipientRole: "INSTRUCTOR",
      instructorId: authorization.actorId,
    },
    select: { id: true, readAt: true },
  });
  if (!notification) {
    return { success: false, error: "העדכון לא נמצא" };
  }
  if (!notification.readAt) {
    await prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
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

// P-MATERIALS M3B-0 - THE AUTHORIZATION BOUNDARY for material-added
// notification fan-out.
//
// This module carries "use server", so this export is a PUBLICLY DISPATCHABLE
// Server Action endpoint: reachable by a direct POST, not only through the
// application's UI, and even though no Client Component imports it (verified
// against the build's server-reference-manifest, where it is registered with its
// own action id). Page-level /admin gating is therefore NOT its authorization
// boundary - the proxy's session check is deliberately optimistic and does no
// database lookup, so a REVOKED admin still holding a valid session token would
// otherwise reach this fan-out and push attacker-chosen text to every active
// instructor. Before M3B widens this path to trainees, the gate lands here.
//
// requireAdmin() is the canonical shared helper (no local session/cookie/role
// check, no client-supplied admin identity, no inference from a name or role
// string) and it FAILS CLOSED: an anonymous, expired or non-allow-listed caller
// is redirected, never fanned out. It is the FIRST awaited operation, so an
// unauthorized direct invocation performs ZERO Prisma reads and ZERO writes and
// learns nothing about instructors, materials or notifications.
//
// The IO itself lives in lib/course/capabilities/material-notification-fanout.ts,
// which holds NO "use server" directive and therefore mints no endpoint of its
// own - architectural containment beside the explicit gate. This wrapper does no
// Prisma work itself; it authorizes and delegates.
//
// NOTE ON THE OTHER CALLER: the admin FILE upload Route Handler
// (app/api/admin/materials/upload/route.ts) deliberately calls the internal
// fan-out DIRECTLY rather than passing through this wrapper. It is invoked by
// fetch() and parses response.json(), and it already performs an equivalent
// fail-closed admin check (auth + adminEmail.isActive -> JSON 401/403) BEFORE
// any storage upload or database write. A redirect-throwing guard called there
// AFTER the material has committed would emit a 307 that re-POSTs to /login,
// turning a SUCCESSFUL save into a misleading client-side error. Authorization
// still precedes every side effect on that path; it simply happens at the top of
// the route instead of at the bottom of the write.
export async function createMaterialAddedNotifications(params: {
  materialId: string;
  title: string;
  visibility: CourseMaterialVisibilityValue;
}): Promise<void> {
  await requireAdmin();
  await fanOutMaterialAddedNotifications(params);
}
