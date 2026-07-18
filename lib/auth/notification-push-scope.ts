/**
 * Pure ownership-scoped Prisma filter builders for the self-service push /
 * notification actions (Stage 0A2).
 *
 * PURE by construction: no next/headers, no Prisma, no environment access, no
 * logging, never throws. Each builder takes an ALREADY server-derived actor id
 * (from getCurrentTrainee()/getCurrentInstructor() via
 * authorizeSelfActingClientId) and returns the exact where-filter object the
 * corresponding action passes to Prisma.
 *
 * The whole point is that the scope is bound to the server actor id and the
 * recipient role. A client-supplied id can never widen or redirect the scope,
 * and for push-unsubscribe the endpoint is NEVER the sole scope — the actor's
 * studentId is always ANDed in, so a globally @unique endpoint that belongs to
 * another Student can never be deleted through this path.
 *
 * These builders make NO permission (can*) allow/deny decision and perform no
 * authorization — that decision already happened in
 * ./self-actor-authorization. See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A.
 */

/**
 * Where-filter for deleting THIS trainee's push subscription by endpoint.
 *
 * Scoped by both `endpoint` and the server-derived `studentId` (recipientRole
 * STUDENT). Because `endpoint` is globally @unique, a subscription belongs to
 * exactly one Student; ANDing the actor's studentId means a deleteMany can only
 * remove the row when it belongs to this trainee, never another trainee's.
 */
export function studentPushUnsubscribeWhere(actorStudentId: string, endpoint: string) {
  return {
    endpoint,
    recipientRole: "STUDENT" as const,
    studentId: actorStudentId,
  };
}

/** Where-filter for reading THIS trainee's notifications (all). */
export function studentNotificationsWhere(actorStudentId: string) {
  return {
    recipientRole: "STUDENT" as const,
    studentId: actorStudentId,
  };
}

/** Where-filter for reading THIS instructor's notifications (all). */
export function instructorNotificationsWhere(actorInstructorId: string) {
  return {
    recipientRole: "INSTRUCTOR" as const,
    instructorId: actorInstructorId,
  };
}

/** Where-filter for counting THIS trainee's UNREAD notifications. */
export function studentUnreadNotificationsWhere(actorStudentId: string) {
  return {
    recipientRole: "STUDENT" as const,
    studentId: actorStudentId,
    readAt: null,
  };
}

/** Where-filter for counting THIS instructor's UNREAD notifications. */
export function instructorUnreadNotificationsWhere(actorInstructorId: string) {
  return {
    recipientRole: "INSTRUCTOR" as const,
    instructorId: actorInstructorId,
    readAt: null,
  };
}
