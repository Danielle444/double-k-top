// Pure, dependency-free builder: real ScheduleItem id -> the configured riding
// activity that owns it.
//
// Why this exists: the instructor schedule surfaces (today / full schedule)
// render one card per real ScheduleItem (InstructorScheduleItem.id is a single
// atomic ScheduleItem id). The riding read (getInstructorRidingSlots) returns
// only *configured* activities - each already backed by a RidingSlot - and each
// activity carries the full set of atomic ScheduleItem ids behind it
// (scheduleItemIds, the split of a "+"-joined merged display box). This core
// inverts that into a per-id lookup so a schedule card can decide, purely from
// its own id, whether it maps to a real riding activity and is therefore
// clickable.
//
// Deliberately has NO React, Prisma, server-action, auth, env, cookie, clock,
// or DB dependency: it only reads the activities it is handed and returns a
// Map. It never mutates the activities, their id arrays, or copies any field
// (least of all trainee PII, which is not present on this shape at all) into a
// broader structure - the map values are the same activity references passed
// in.

// Minimal structural shape the mapping needs from each activity. The real
// WeeklyRidingActivity (from getInstructorRidingSlots) is structurally
// assignable to this, so the same array flows through unchanged; no runtime
// import from the server-action module is required here.
export interface ScheduleMappableActivity {
  scheduleItemIds: readonly string[];
  // An activity only counts as "configured" (and thus clickable) once a real
  // RidingSlot backs it. getInstructorRidingSlots already filters to these,
  // but the core re-checks so it can never mint a clickable card for an
  // unconfigured activity even if handed one.
  ridingSlot: { id: string } | null;
}

// Builds the scheduleItemId -> activity lookup.
//
// Rules (see the task contract):
// - each activity may contain multiple scheduleItemIds -> every one of them
//   maps to that same activity
// - unlinked ids are simply absent from the map
// - null / empty / whitespace-only / non-string ids are ignored safely
// - an id claimed by two *different* activities is a collision: it fails
//   closed (removed from the map and permanently poisoned) rather than
//   guessing which activity wins - deterministically absent regardless of
//   input order
// - the same id repeated within one activity is idempotent, never a collision
// - source activities and their id arrays are never mutated
export function buildScheduleItemActivityMap<T extends ScheduleMappableActivity>(
  activities: readonly T[]
): Map<string, T> {
  const map = new Map<string, T>();
  // Ids seen to belong to two different activities - once poisoned, an id can
  // never re-enter the map, so the fail-closed outcome does not depend on the
  // order activities are visited in.
  const collided = new Set<string>();

  for (const activity of activities) {
    if (!activity || !activity.ridingSlot) continue;
    for (const rawId of activity.scheduleItemIds) {
      if (typeof rawId !== "string") continue;
      const id = rawId.trim();
      if (id === "") continue;
      if (collided.has(id)) continue;

      const existing = map.get(id);
      if (existing === undefined) {
        map.set(id, activity);
      } else if (existing !== activity) {
        // Same id owned by two distinct activities -> ambiguous -> fail closed.
        map.delete(id);
        collided.add(id);
      }
      // existing === activity: this id already points at this exact activity
      // (a duplicate within one activity's own id list) - nothing to do.
    }
  }

  return map;
}

// Resolves a rendered schedule card's own id back to its configured riding
// activity, given the per-atomic-id lookup that buildScheduleItemActivityMap
// backs. A card's id may be a "+"-joined COMPOSITE of several atomic
// ScheduleItem ids: the instructor timegrid merges same-time א/ב cards and
// coalesces contiguous same-title rows into one displayed card whose id is
// `${a.id}+${b.id}` (see mergeSameActivityItems / coalesceAdjacentSameActivity).
// The activity map is keyed by ATOMIC ids only, so a composite id never hits it
// directly - this inverts that by splitting the card id into its atomic parts
// and resolving each through the same lookup.
//
// Fails closed to null unless the WHOLE card resolves cleanly to exactly one
// activity:
// - the card id must be a string with at least one non-empty (post-trim) part
// - EVERY non-empty part must resolve (a composite mixing a known part with an
//   unknown one is null - a configured merged riding activity is expected to
//   own all of its atomic scheduleItemIds, so a partial match is treated as a
//   mismatch, never a lucky hit)
// - all resolved parts must reference the same activity (parts pointing at two
//   different activities are ambiguous -> null)
// - duplicate atomic parts that resolve to the same activity are fine
//
// Pure and deterministic: reads only its arguments, mutates nothing, and (like
// the builder above) has no React/Prisma/server/DB dependency.
export function resolveActivityForScheduleCardId<T>(
  lookup: ((scheduleItemId: string) => T | null) | undefined,
  cardId: string
): T | null {
  if (!lookup || typeof cardId !== "string") return null;

  const parts = cardId
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length === 0) return null;

  let found: T | null = null;
  for (const part of parts) {
    const activity = lookup(part);
    // Any unresolved part fails the whole card closed - never a partial match.
    if (activity === null || activity === undefined) return null;
    if (found === null) {
      found = activity;
    } else if (found !== activity) {
      // Two atomic parts of one displayed card own two different activities ->
      // ambiguous -> null, same fail-closed philosophy as the builder's
      // collision rule.
      return null;
    }
  }
  return found;
}
