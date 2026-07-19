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
