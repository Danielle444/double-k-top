/**
 * PERF-1 / P3A - the PURE core for RIDING-SLOT MODE resolution.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React, and deliberately NO "use server". It
 * decides from two already-resolved booleans and nothing else, so the whole rule
 * is unit-testable without a database (see riding-slot-mode-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * Both instructor riding surfaces used to discover a slot's mode by CALLING TWO
 * FULL EDITING READERS, per slot, at load:
 *
 *   const complexPlan = await getRidingSlotComplexPlanForInstructor(id);
 *   if (complexPlan) return "complex";
 *   const horseList = await getRidingSlotHorseListForInstructor(id);
 *   if (horseList?.listId) return "simple";
 *   return "none";
 *
 * Those two readers exist to POPULATE AN EDITOR. Between them they load the whole
 * complex plan tree (blocks -> stations -> pairs), the whole horse list and its
 * items, the trainee candidate roster, and every known horse name - roughly a
 * dozen queries per slot - and every byte of it was discarded except a
 * four-character string. Worse, each call is a Server Action, and Next.js
 * dispatches those ONE AT A TIME per client, so a schedule week holding fifteen
 * riding slots serialized fifteen-to-thirty round trips before its cards settled.
 *
 * The mode is not derived information at all: it is the presence or absence of
 * two rows. RidingSlotComplexPlan.ridingSlotId and RidingSlotHorseList.ridingSlotId
 * are both UNIQUE in the schema, so each is a 1:1 relation off RidingSlot and a
 * presence-only `select: { id: true }` answers the question outright. The riding
 * slot payload the surfaces ALREADY fetch now carries those two booleans, and
 * this core turns them into the mode - no request, no waterfall, and the answer
 * is known at first paint instead of settling asynchronously.
 *
 * IT LIVES IN ITS OWN MODULE, NOT IN riding-slots.ts, FOR THE SAME REASON THE
 * BATCH-RESOLVE CORE DOES: riding-slots.ts carries the "use server" directive,
 * under which every runtime export must be an async Server Action. A synchronous
 * helper cannot be exported from it without breaking the build, and making this
 * one async would mint a public POST endpoint for a two-boolean comparison.
 *
 * WHAT THIS DELIBERATELY DOES NOT OWN
 * -----------------------------------
 *  - NO authorization. The booleans reach it from getInstructorRidingSlots, which
 *    is already gated on a server-derived instructor actor; this core never sees
 *    an actor, a session or an id.
 *  - NO IO, and no knowledge of Prisma, of the two readers, or of the shape of
 *    what they return.
 *  - NO "error" state. That is a CLIENT-side outcome, produced only when a
 *    user-initiated refresh (refreshModeFor) rejects. A payload-derived mode has
 *    no per-slot failure channel - if the riding read fails there are no cards at
 *    all - so this core's return type is narrowed to the three DERIVABLE values
 *    and is assignable to the client's wider InstructorSlotMode union.
 */

/**
 * The three modes derivable from persisted state.
 *
 * A strict subset of the client-side InstructorSlotMode
 * (app/instructor/instructor-riding-shared-types.ts), which additionally carries
 * "error" for a failed user-initiated refresh. The subset relationship is what
 * lets a value from this core be assigned wherever that union is expected, and it
 * is asserted in the co-located test.
 */
export type ResolvedRidingSlotMode = "none" | "simple" | "complex";

/**
 * The two persisted facts the mode is a function of - nothing more.
 *
 * Both are ROW PRESENCE, already resolved by the reader that fetched the slot:
 * `hasComplexPlan` is "a RidingSlotComplexPlan row exists for this slot" and
 * `hasHorseList` is "a RidingSlotHorseList row exists for this slot". Neither is
 * a status, a version, a publication state or a count, and this core must never
 * grow a third input: any further condition belongs to whichever module owns it.
 */
export interface RidingSlotModeFacts {
  readonly hasComplexPlan: boolean;
  readonly hasHorseList: boolean;
}

/**
 * Resolve a riding slot's horse-planning mode from persisted row presence.
 *
 * COMPLEX WINS. When both rows exist the answer is "complex", which reproduces
 * the previous implementation's SHORT-CIRCUIT exactly: it asked for the complex
 * plan first and returned on a hit without ever reading the horse list. The two
 * modes are mutually exclusive by construction (the server-side guard in
 * createComplexPlanInternal / saveRidingSlotHorseListInternal takes an advisory
 * lock precisely to keep them so), so "both" should be unreachable - but it is
 * defined here rather than left implicit, because an unreachable state that
 * silently changes meaning is how a data repair turns into a UI regression.
 *
 * Strict `=== true` comparisons, never truthiness: an `undefined` arriving from
 * an older cached payload, a partially-constructed object, or a JSON round trip
 * must fail CLOSED to a less-capable mode rather than opening the complex editor
 * over a slot that has no plan.
 */
export function resolveRidingSlotMode(facts: RidingSlotModeFacts): ResolvedRidingSlotMode {
  if (facts?.hasComplexPlan === true) return "complex";
  if (facts?.hasHorseList === true) return "simple";
  return "none";
}

/**
 * Seed a whole `modeByRidingSlotId` map from the riding slots a payload already
 * carries, keyed by RidingSlot id.
 *
 * Convenience over `resolveRidingSlotMode`, not a second rule: it delegates every
 * decision to that function. Later entries for the same slot id overwrite earlier
 * ones, which is a no-op in practice - the same slot surfaced by two activities
 * carries the same two persisted booleans - and keeps the result independent of
 * how many activities happened to reference it.
 *
 * Slots are accepted as a flat, already-extracted list so this core needs no
 * knowledge of WeeklyRidingDay, WeeklyRidingActivity, or the null `ridingSlot`
 * an unlinked activity carries; the caller filters those out.
 */
export function buildRidingSlotModeMap(
  slots: readonly (RidingSlotModeFacts & { readonly id: string })[],
): Record<string, ResolvedRidingSlotMode> {
  const modes: Record<string, ResolvedRidingSlotMode> = {};
  for (const slot of slots) {
    const id = slot?.id;
    if (typeof id !== "string" || id.length === 0) continue;
    modes[id] = resolveRidingSlotMode(slot);
  }
  return modes;
}
