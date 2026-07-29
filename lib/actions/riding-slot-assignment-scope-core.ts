/**
 * RIDING-MINE-COMPLEX - the PURE core for "is this ride MINE?" ownership.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React, and deliberately NO "use server". It
 * decides from already-resolved instructor ids and nothing else, so the whole
 * rule is unit-testable without a database (see the co-located test).
 *
 * WHY THIS EXISTS
 * ---------------
 * An instructor's "הרכיבות שלי" used to recognise exactly ONE ownership source:
 * a regular RidingSlotAssignment (its legacy scalar instructorId, folded by
 * getAssignmentInstructors into the RidingSlotAssignmentInstructor join-table
 * list). That is not how a complex-riding session is staffed. There, the coach
 * of a station is stored on RidingSlotComplexStation.instructorId, and such a
 * ride frequently carries NO regular instructor assignment at all - so a coach
 * who was running several stations that day saw their own rides only under
 * "כל הרכיבות", with an empty "הרכיבות שלי" and no "משובץ/ת אליי" badge.
 *
 * THE RULE IS ADDITIVE, NOT A REPLACEMENT. A ride is the current instructor's
 * when they are named through EITHER source:
 *   1. a regular RidingSlotAssignment instructor assignment, or
 *   2. a RidingSlotComplexStation.instructorId inside the slot's complex plan.
 * Neither model is mirrored into the other, and nothing here writes anything.
 *
 * AUTHORITATIVE IDS ONLY. Matching is exact equality on trimmed Instructor.id
 * values. Display text - instructorName, fullName, a formatted name list - is
 * never consulted, never case-folded and never substring-matched: two people can
 * share a name, and a rendered string is not an identity.
 *
 * IT LIVES IN ITS OWN MODULE, NOT IN riding-slots.ts, FOR THE SAME REASON THE
 * MODE AND BATCH-RESOLVE CORES DO: riding-slots.ts carries the "use server"
 * directive, under which every runtime export must be an async Server Action. A
 * synchronous helper cannot be exported from it without breaking the build, and
 * making this one async would both mint a public POST endpoint for a string
 * comparison and make it unusable from the client component that needs it
 * synchronously while rendering.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * -----------------------------------
 *  - NO authorization. This is a DISPLAY FILTER over a payload the caller was
 *    already authorized to read (getInstructorRidingSlots is gated on a
 *    server-derived instructor actor). Being "not mine" hides a card from one
 *    tab; it grants and denies nothing, and "כל הרכיבות" still shows everything.
 *  - NO IO, and no knowledge of Prisma, of WeeklyRidingDay/WeeklyRidingActivity,
 *    or of how the ids were fetched.
 */

/** One station of a complex plan, narrowed to the only field ownership needs. */
export interface ComplexStationInstructorFacts {
  readonly instructorId?: string | null;
}

/** One block of a complex plan, narrowed to its stations. */
export interface ComplexBlockInstructorFacts {
  readonly stations?: readonly ComplexStationInstructorFacts[] | null;
}

/**
 * Flatten a complex plan's blocks -> stations into the distinct coach ids it
 * names.
 *
 * Blank-safe and total: null/undefined blocks, a block with no stations, a
 * station with no coach yet (instructorId is nullable by design - a station may
 * be drafted before a coach is chosen) and a whitespace-only id all simply
 * contribute nothing. The result is trimmed, de-duplicated and sorted
 * lexicographically, so a slot's id list is a deterministic function of its plan
 * and never depends on block/station ordering - which matters because this array
 * is serialized into a client payload and compared in tests.
 *
 * Carries ONLY instructor ids. No pair, trainee, horse, arena, time, title,
 * note, sortOrder, version or publication value is read here, and none is
 * accepted by the input types above.
 *
 * The input is never mutated.
 */
export function collectComplexStationInstructorIds(
  blocks: readonly ComplexBlockInstructorFacts[] | null | undefined,
): string[] {
  if (!blocks) return [];
  const ids = new Set<string>();
  for (const block of blocks) {
    for (const station of block?.stations ?? []) {
      const id = typeof station?.instructorId === "string" ? station.instructorId.trim() : "";
      if (id.length > 0) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** One regular assignment split, narrowed to its resolved instructor id list. */
export interface RidingAssignmentInstructorFacts {
  readonly instructorIds?: readonly (string | null | undefined)[] | null;
}

/**
 * A riding slot, narrowed to the two ownership sources.
 *
 * `instructorIds` is the list the reader already produced through
 * getAssignmentInstructors, which folds the legacy scalar
 * RidingSlotAssignment.instructorId into the join-table list (the scalar is kept
 * in sync as instructorIds[0]). That is why this predicate needs no separate
 * legacy branch: by the time a row reaches here, the legacy fallback is already
 * inside instructorIds.
 */
export interface RidingSlotOwnershipFacts {
  readonly assignments?: readonly RidingAssignmentInstructorFacts[] | null;
  readonly complexStationInstructorIds?: readonly (string | null | undefined)[] | null;
}

/** A displayed riding activity, narrowed to its (possibly absent) slot. */
export interface RidingActivityOwnershipFacts {
  readonly ridingSlot?: RidingSlotOwnershipFacts | null;
}

/**
 * THE single ownership predicate.
 *
 * It powers both the "הרכיבות שלי" filter and the "משובץ/ת אליי" badge, so the
 * two can never disagree - a card that survives the filter always carries the
 * badge, and a badge never appears on a ride the filter would drop.
 *
 * Fails closed: an activity with no slot (admin has not defined the ride yet), a
 * slot with neither source populated, or a missing/blank current instructor id
 * all yield false. Comparison is exact equality after trimming both sides - no
 * case folding, no substring match, no name match.
 */
export function isRidingActivityAssignedToInstructor(
  activity: RidingActivityOwnershipFacts | null | undefined,
  instructorId: string | null | undefined,
): boolean {
  const wanted = typeof instructorId === "string" ? instructorId.trim() : "";
  if (wanted.length === 0) return false;

  const slot = activity?.ridingSlot;
  if (!slot) return false;

  const matches = (candidate: string | null | undefined): boolean =>
    typeof candidate === "string" && candidate.trim() === wanted;

  for (const assignment of slot.assignments ?? []) {
    for (const candidate of assignment?.instructorIds ?? []) {
      if (matches(candidate)) return true;
    }
  }

  for (const candidate of slot.complexStationInstructorIds ?? []) {
    if (matches(candidate)) return true;
  }

  return false;
}
