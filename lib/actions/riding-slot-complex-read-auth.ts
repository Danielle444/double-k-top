/**
 * RS-SEC-1I-CP-RD - PURE, dependency-injected authorization boundary that binds
 * the two instructor-facing complex riding-plan READ paths to the server-derived
 * signed instructor identity.
 *
 * Like ./riding-slots-read-auth (RS-SEC-1IR) and ./riding-slot-complex-auth
 * (RS-SEC-1I-CP, the write boundary), this is deliberately NOT a "use server"
 * module: it is a plain server-side library, so nothing here is registered as a
 * Server Action. It carries the two testable authorization gates that the public
 * server actions import and wire to real dependencies (the canonical actor DAL
 * getCurrentInstructor + the existing internal reader cores). Importing a plain
 * helper module from a "use server" module is the exact same, already-established
 * edge that ./riding-slots imports ./riding-slots-read-auth and
 * ./riding-slot-complex imports ./riding-slot-complex-auth across.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the readers)
 * is passed in via the *Deps interfaces. The only edges back to the two
 * "use server" modules are erased `import type`s, so the type-only edge creates no
 * runtime circular import and pulls in neither next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - getRidingSlotComplexPlanForInstructor and
 *    getComplexRidingPlanPublicationStatusForInstructor previously trusted a
 *    CLIENT-SUPPLIED instructorId: each re-read the Instructor row by that id and
 *    checked only isActive, so ANY caller (including unauthenticated / trainee /
 *    wrong-role) could submit another active instructor's id to read protected
 *    complex-plan content and publication metadata. The plan reader additionally
 *    derived its returned `canEdit` from the BORROWED instructor's
 *    canEditRidingNotes, so a caller also borrowed another instructor's edit flag.
 *  Both now derive identity ONLY from the injected server-side actor resolver
 *  (getCurrentInstructor), never from a client-supplied id (there is no instructor
 *  id parameter). A missing / invalid / inactive / wrong-audience / subject-
 *  mismatched session yields a null actor (the resolver returns null in every such
 *  case): both readers fail closed to null and the underlying reader is NEVER
 *  invoked - revealing nothing, the same fail-closed read convention as
 *  loadStudentRidingHistoryForInstructorWithDeps.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the RS-SEC-1IR / RS-SEC-1I-CP convention,
 * a THROWN actor resolution (session/infra failure - e.g. a missing/weak
 * SESSION_SECRET or a Prisma error inside getCurrentInstructor) is caught around
 * the actor resolution ONLY and treated exactly like a null actor: both readers
 * return null, never touching the underlying reader. The catch is scoped strictly
 * to the actor resolution so a genuine reader error still propagates unchanged
 * (preserving current plan / publication-status load behaviour), and no internal
 * session/reason-code detail is surfaced.
 *
 * This stage protects WHO the instructor is (identity only). Viewing complex-plan
 * data intentionally does NOT require canEditRidingNotes (that flag gates editing/
 * publishing only), so neither gate checks any actor-level permission flag to
 * ALLOW the read - matching the committed "all active instructors may view"
 * convention. The plan reader still THREADS the signed actor's canEditRidingNotes
 * into its returned `canEdit` field (so a read-only instructor sees canEdit=false
 * yet still reads the plan); the publication-status reader needs identity only.
 * NO slot-assignment ownership and NO CourseOffering membership is introduced.
 */
import type { RidingSlotComplexPlanForEditing } from "./riding-slot-complex";
import type { ComplexRidingPlanPublicationStatus } from "./riding-slot-complex-publications";

// --- instructor complex-plan read --------------------------------------------

/**
 * Injectable dependencies for {@link loadComplexPlanForInstructorWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / inactive / wrong-audience session), and carries
 * the signed actor's canEditRidingNotes so it can be threaded into the returned
 * `canEdit` WITHOUT a second Instructor read; `readPlan` is the existing plan
 * builder, invoked with the target slot AND the trusted server-derived canEdit.
 */
export interface ComplexPlanForInstructorReadDeps {
  getCurrentInstructor: () => Promise<{ canEditRidingNotes: boolean } | null>;
  readPlan: (
    ridingSlotId: string,
    canEdit: boolean,
  ) => Promise<RidingSlotComplexPlanForEditing | null>;
}

/**
 * Gate the instructor complex-plan read on a trustworthy server-derived instructor
 * actor, THEN delegate to the unchanged plan builder.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor or
 * borrow another instructor's canEditRidingNotes. ridingSlotId remains a record
 * selector only. A null actor - or a thrown actor resolution (caught around the
 * resolver only) - fails closed to null and the reader is NEVER invoked. For a
 * valid active instructor the plan builder runs exactly as before and its returned
 * `canEdit` is the SIGNED actor's canEditRidingNotes (true or false), never a
 * client value; a genuine readPlan() error still propagates (it is outside the
 * catch).
 */
export async function loadComplexPlanForInstructorWithDeps(
  deps: ComplexPlanForInstructorReadDeps,
  ridingSlotId: string,
): Promise<RidingSlotComplexPlanForEditing | null> {
  let instructor: { canEditRidingNotes: boolean } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return null;
  }
  if (!instructor) {
    return null;
  }
  return deps.readPlan(ridingSlotId, instructor.canEditRidingNotes);
}

// --- instructor complex-plan publication-status read -------------------------

/**
 * Injectable dependencies for {@link loadComplexPublicationStatusForInstructorWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver;
 * `readStatus` is the existing publication-status builder. Reading status needs
 * IDENTITY ONLY - no canEditRidingNotes is consumed - so the resolver's minimal
 * shape here is deliberately just a presence signal.
 */
export interface ComplexPublicationStatusForInstructorReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readStatus: (
    ridingSlotId: string,
  ) => Promise<ComplexRidingPlanPublicationStatus | null>;
}

/**
 * Gate the instructor complex-plan publication-status read on a trustworthy
 * server-derived instructor actor, THEN delegate to the unchanged status builder.
 *
 * ridingSlotId remains a record selector only, never actor identity. canEditRiding-
 * Notes is intentionally NOT consulted (reading status is not gated on edit
 * permission, matching the committed convention). A null actor - or a thrown actor
 * resolution (caught around the resolver only) - fails closed to null and the
 * status builder is NEVER invoked. For a valid active instructor the returned
 * status is exactly as before; a genuine readStatus() error still propagates.
 */
export async function loadComplexPublicationStatusForInstructorWithDeps(
  deps: ComplexPublicationStatusForInstructorReadDeps,
  ridingSlotId: string,
): Promise<ComplexRidingPlanPublicationStatus | null> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return null;
  }
  if (!instructor) {
    return null;
  }
  return deps.readStatus(ridingSlotId);
}
