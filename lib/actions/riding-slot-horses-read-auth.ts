/**
 * RS-SEC-1I-HL-RD - PURE, dependency-injected authorization boundary that binds
 * the instructor-facing simple horse-list READ path to the server-derived signed
 * instructor identity.
 *
 * Like ./riding-slots-read-auth (RS-SEC-1IR) and ./riding-slot-complex-read-auth
 * (RS-SEC-1I-CP-RD), this is deliberately NOT a "use server" module: it is a plain
 * server-side library, so nothing here is registered as a Server Action. It
 * carries the single testable authorization gate that the public server action
 * imports and wires to real dependencies (the canonical actor DAL
 * getCurrentInstructor + the existing internal horse-list reader core). Importing a
 * plain helper module from a "use server" module is the exact same, already-
 * established edge that ./riding-slots imports ./riding-slots-read-auth and
 * ./riding-slot-complex imports ./riding-slot-complex-read-auth across.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the reader)
 * is passed in via the Deps interface. The only edge back to the "use server"
 * module is an erased `import type`, so the type-only edge creates no runtime
 * circular import and pulls in neither next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - getRidingSlotHorseListForInstructor previously trusted a CLIENT-SUPPLIED
 *    instructorId: it re-read the Instructor row by that id and checked only
 *    isActive, so ANY caller (including unauthenticated / trainee / wrong-role)
 *    could submit another active instructor's id to read protected horse-list
 *    content (saved items, updatedByName attribution, publication existence /
 *    staleness flags, and the candidate roster).
 *  It now derives identity ONLY from the injected server-side actor resolver
 *  (getCurrentInstructor), never from a client-supplied id (there is no instructor
 *  id parameter). A missing / invalid / inactive / wrong-audience / subject-
 *  mismatched session yields a null actor (the resolver returns null in every such
 *  case): the reader fails closed to null and the underlying reader is NEVER
 *  invoked - revealing nothing, the same fail-closed read convention as
 *  loadComplexPublicationStatusForInstructorWithDeps.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the RS-SEC-1IR / RS-SEC-1I-CP-RD
 * convention, a THROWN actor resolution (session/infra failure - e.g. a
 * missing/weak SESSION_SECRET or a Prisma error inside getCurrentInstructor) is
 * caught around the actor resolution ONLY and treated exactly like a null actor:
 * the reader returns null, never touching the underlying reader. The catch is
 * scoped strictly to the actor resolution so a genuine reader error still
 * propagates unchanged (preserving current horse-list load behaviour), and no
 * internal session/reason-code detail is surfaced.
 *
 * This stage protects WHO the instructor is (identity ONLY). Viewing the horse
 * list intentionally does NOT require canEditRidingNotes (that flag gates saving/
 * publishing only), does NOT require riding-slot assignment, and is NOT publication-
 * gated (signed active instructors read draft/unpublished data). The returned
 * payload is viewer-INDEPENDENT (it never depended on the acting instructor id), so
 * the resolver's minimal shape here is deliberately just a presence signal and this
 * gate consumes NO actor permission flag, NO assignment, and NO CourseOffering
 * membership.
 */
import type { RidingSlotHorseListForEditing } from "./riding-slot-horses";

/**
 * Injectable dependencies for {@link loadHorseListForInstructorWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for any
 * unauthenticated / invalid / inactive / wrong-audience session). Reading the horse
 * list needs IDENTITY ONLY - no canEditRidingNotes and no assignment is consumed -
 * so the resolver's minimal shape here is deliberately just a presence signal.
 * `readList` is the existing horse-list-for-editing builder, invoked with the target
 * slot only.
 */
export interface HorseListForInstructorReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  readList: (
    ridingSlotId: string,
  ) => Promise<RidingSlotHorseListForEditing | null>;
}

/**
 * Gate the instructor horse-list read on a trustworthy server-derived instructor
 * actor, THEN delegate to the unchanged horse-list builder.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor id
 * parameter, so no client value can select or impersonate an instructor. ridingSlotId
 * remains a record selector only. canEditRidingNotes is intentionally NOT consulted
 * (reading is not gated on edit permission, matching the committed convention), and
 * no assignment/publication input exists here at all. A null actor - or a thrown
 * actor resolution (caught around the resolver only) - fails closed to null and the
 * reader is NEVER invoked. For a valid active instructor the reader runs exactly as
 * before; a genuine readList() error still propagates (it is outside the catch).
 */
export async function loadHorseListForInstructorWithDeps(
  deps: HorseListForInstructorReadDeps,
  ridingSlotId: string,
): Promise<RidingSlotHorseListForEditing | null> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return null;
  }
  if (!instructor) {
    return null;
  }
  return deps.readList(ridingSlotId);
}
