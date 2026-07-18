/**
 * Pure audience-gate predicates for the read-only contact directories
 * (Stage 0A3 — secure contacts self-access).
 *
 * PURE by construction: no next/headers, no Prisma, no environment access, no
 * logging, never throws. Each predicate takes ALREADY server-derived actor ids
 * (from getCurrentInstructor()/getCurrentTrainee() — each already null for a
 * missing/invalid/wrong-audience/inactive session) and decides ONE thing:
 * whether the calling audience may read a given contact directory.
 *
 * These directories are NOT self-reads — they return the whole active roster,
 * so there is no client-supplied id to compare (unlike the notification/push
 * self-service path in ./self-actor-authorization). Authority is the PRESENCE
 * of a trustworthy server-derived actor of the permitted audience; an empty or
 * absent id is never honored, so an anonymous caller can never pass either gate.
 *
 * These predicates make NO permission (can*) allow/deny decision. Audience
 * mapping (who may see which directory) is intentional product policy:
 *  - the STUDENT directory carries trainee PII → instructors only;
 *  - the INSTRUCTOR directory is shown to both instructors and trainees.
 *
 * While only one CourseOffering is active the directories remain global; this
 * stage adds identity/audience gating only and deliberately does NOT add any
 * per-offering scoping. See COURSE-ARCHITECTURE-HANDOFF.md — Stage 0A.
 */

/** True only for a non-empty, server-derived actor id. */
function isPresentActorId(actorId: string | null | undefined): boolean {
  return typeof actorId === "string" && actorId !== "";
}

/**
 * May the caller read the STUDENT contact directory (trainee names/phones)?
 *
 * Granted ONLY to an authenticated instructor actor. A trainee actor id is not
 * accepted here (it is irrelevant to this gate), and an absent instructor id
 * (anonymous, wrong-audience, or inactive → null upstream) is denied.
 */
export function mayAccessStudentContactDirectory(
  instructorActorId: string | null | undefined,
): boolean {
  return isPresentActorId(instructorActorId);
}

/**
 * May the caller read the INSTRUCTOR contact directory (instructor names/
 * phones)?
 *
 * Granted to EITHER an authenticated instructor OR an authenticated trainee —
 * both audiences are intended to see instructor contacts. Denied only when both
 * ids are absent (i.e. no trustworthy actor of either audience), so an
 * anonymous caller receives nothing.
 */
export function mayAccessInstructorContactDirectory(
  instructorActorId: string | null | undefined,
  traineeActorId: string | null | undefined,
): boolean {
  return isPresentActorId(instructorActorId) || isPresentActorId(traineeActorId);
}
