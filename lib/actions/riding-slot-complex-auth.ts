/**
 * RS-SEC-1I-CP - PURE, dependency-injected authorization boundary that binds the
 * ten instructor-facing complex riding-plan WRITE actions to the server-derived
 * signed instructor identity.
 *
 * Like ./riding-slots-write-auth, ./horse-feeding-auth, and ./attendance-write-auth,
 * this is deliberately NOT a "use server" module: it is a plain server-side
 * library, so nothing here is registered as a Server Action. It carries the one
 * testable authorization gate that every scoped instructor wrapper in
 * ./riding-slot-complex and ./riding-slot-complex-move-swap imports and wires to
 * real dependencies (the canonical actor DAL getCurrentInstructor + the existing
 * internal mutation core).
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the mutation
 * core) is passed in per call via the deps interface.
 *
 * SECURITY CONTRACT (why this exists):
 *  - Every complex-plan instructor writer previously trusted a CLIENT-SUPPLIED
 *    instructorId: it re-read the Instructor row by that id and evaluated
 *    isActive && canEditRidingNotes on it, so a caller could submit ANOTHER
 *    instructor's id to borrow that instructor's edit permission, and the
 *    persisted authorship (updatedByInstructorId / updatedByName) was that
 *    borrowed instructor's identity.
 *  The write now derives identity ONLY from the injected server-side actor
 *  resolver (getCurrentInstructor), never from a client-supplied id. There is no
 *  instructorId parameter. A missing / invalid / inactive / wrong-audience /
 *  subject-mismatched session yields a null actor (the resolver returns null in
 *  every such case) and the mutation core is NEVER invoked. Attribution is taken
 *  from the server-derived actor's id + fullName, never from client input.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the RS-SEC-1I-W / horse-feeding
 * convention, a THROWN actor resolution (session/infra failure - e.g. a
 * missing/weak SESSION_SECRET or a Prisma error inside getCurrentInstructor) is
 * caught around the resolver ONLY and treated exactly like a null actor: the
 * write returns the denial result without touching the mutation core. The catch
 * is scoped strictly to the resolver so a genuine onAuthorized() (mutation core)
 * error still propagates unchanged, and no internal session/reason detail is
 * surfaced.
 *
 * This stage binds WHO the instructor is and enforces the existing
 * canEditRidingNotes permission on that signed actor. It intentionally introduces
 * NO slot-assignment ownership, NO CourseOffering capability/membership, and does
 * NOT change any mutation behaviour (the internal cores are unchanged; instructor
 * identity is not part of plan/block/station/pair identity).
 */

/**
 * The minimal actor shape this boundary consumes: the edit permission plus the
 * attribution identity. Structurally satisfied by the canonical InstructorActor
 * (lib/auth/actor-core.ts), which carries exactly these fields (among others).
 */
export interface ComplexPlanInstructorActor {
  id: string;
  fullName: string;
  canEditRidingNotes: boolean;
}

/**
 * The trusted, server-derived identity handed to a mutation core on success -
 * ONLY id + fullName, exactly the shape instructorActor() (riding-slot-complex.ts)
 * and the move/swap MoveSwapActor builder already accept.
 */
export interface AuthorizedComplexPlanInstructor {
  id: string;
  fullName: string;
}

/** Injectable dependencies for {@link runComplexPlanInstructorWrite}. */
export interface ComplexPlanInstructorWriteDeps<T> {
  /**
   * The canonical server-side actor resolver (null for any unauthenticated /
   * invalid / inactive / wrong-audience / subject-mismatched session).
   */
  getCurrentInstructor: () => Promise<ComplexPlanInstructorActor | null>;
  /** The existing internal mutation core, invoked ONLY for an authorized actor. */
  onAuthorized: (actor: AuthorizedComplexPlanInstructor) => Promise<T>;
  /** This action's unchanged generic denial result (no id/PII). */
  denied: T;
}

/**
 * Gate an instructor complex-plan write on a trustworthy server-derived actor
 * that holds canEditRidingNotes, THEN delegate to the unchanged mutation core.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor or
 * borrow another instructor's permission. A null actor (unauthenticated / invalid
 * / inactive / wrong-audience / subject-mismatched) OR an actor whose
 * canEditRidingNotes is not exactly true is rejected with deps.denied and
 * onAuthorized is NEVER invoked - so no protected plan/slot/block/station read, no
 * transaction, no mutation, and no revalidation occur on rejection (the denial
 * happens strictly before the mutation dependency). A THROWN actor resolution is
 * caught around the resolver ONLY and fails closed to the same denial; a genuine
 * onAuthorized() error still propagates unchanged (it is outside the catch). For
 * an authorized actor the mutation core runs exactly as before, and attribution
 * (updatedByInstructorId / updatedByName) is the actor's own id + fullName, never
 * a client value.
 */
export async function runComplexPlanInstructorWrite<T>(
  deps: ComplexPlanInstructorWriteDeps<T>,
): Promise<T> {
  let actor: ComplexPlanInstructorActor | null;
  try {
    actor = await deps.getCurrentInstructor();
  } catch {
    return deps.denied;
  }
  if (!actor || actor.canEditRidingNotes !== true) {
    return deps.denied;
  }
  return deps.onAuthorized({ id: actor.id, fullName: actor.fullName });
}
