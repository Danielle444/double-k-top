// RC-B2a - pure CourseOffering resolver for complex-riding source selection.
//
// PURE by construction: NO imports at all. No Prisma, no DB, no next/headers,
// no auth/session/cookies, no env, NO hidden clock (`Date.now()` / argless
// `new Date()`), no random, no `localeCompare`, no locale/timezone. The answer
// is derived solely from the explicit, already-read offering-id values.
//
// PURPOSE: the production relation
//   RidingSlot -> RidingSlotScheduleItem -> ScheduleItem
//              -> WeeklySchedule.courseOfferingId
// means one riding slot can span several linked schedule items, each carrying a
// `courseOfferingId` that is a real cuid string OR null (a legacy/unassigned
// slot). Before a template source can be scoped by offering, those linked values
// must agree on a SINGLE offering identity. This helper makes that decision from
// the already-read values; it never queries Prisma and is not wired into runtime
// code in this stage.
//
// CONTRACT (locked):
//  - null is a REAL legacy/unassigned identity - it is NEVER coerced to a level
//    (e.g. Level 1) and only ever matches another null.
//  - RESOLVED: every linked value represents the exact same identity - one
//    non-null id repeated resolves to that id; null repeated resolves to null.
//  - AMBIGUOUS: two different non-null ids; null mixed with any non-null id; or
//    any input carrying a value that is neither a string nor null (fail closed -
//    such a value cannot be proven to share one identity, so it is never
//    silently ignored or coerced).
//  - NO_ITEMS: an empty collection, or (fail-closed) a non-array input.
//  - Never silently picks the first value; deterministic and order-independent;
//    input is never mutated; the returned object is frozen.

/** The three resolution states. */
export type OfferingResolutionStatus = "RESOLVED" | "AMBIGUOUS" | "NO_ITEMS";

/**
 * The discriminated result of resolving one offering identity. `status` is the
 * tag: RESOLVED carries the single agreed `courseOfferingId` (a string, or null
 * for a legacy/unassigned slot); AMBIGUOUS and NO_ITEMS carry only the tag.
 */
export type OfferingResolution =
  | { readonly status: "RESOLVED"; readonly courseOfferingId: string | null }
  | { readonly status: "AMBIGUOUS" }
  | { readonly status: "NO_ITEMS" };

const AMBIGUOUS: OfferingResolution = Object.freeze({ status: "AMBIGUOUS" as const });
const NO_ITEMS: OfferingResolution = Object.freeze({ status: "NO_ITEMS" as const });

/**
 * Resolve a single CourseOffering identity from the `courseOfferingId` values of
 * every schedule item linked to a complex riding slot.
 *
 * Pure, deterministic, order-independent, non-mutating. Returns a frozen
 * {@link OfferingResolution}: RESOLVED with the single agreed id (string | null),
 * AMBIGUOUS when the values represent more than one distinct identity (or carry
 * a malformed value), or NO_ITEMS for an empty / non-array input.
 */
export function resolveOffering(
  values: readonly (string | null)[]
): OfferingResolution {
  if (!Array.isArray(values) || values.length === 0) {
    return NO_ITEMS;
  }

  // Distinct identities. `null` is stored as a Set member distinct from every
  // string, so it can only ever match another null - never a string, and never
  // coerced to a level. A string "null" is a different member from real null.
  const identities = new Set<string | null>();
  for (const value of values) {
    // Fail closed: a value that is neither a string nor null cannot be proven to
    // represent a single identity - treat the whole set as ambiguous rather than
    // ignoring or coercing it.
    if (typeof value !== "string" && value !== null) {
      return AMBIGUOUS;
    }
    identities.add(value);
    // More than one distinct identity is already present - no need to look
    // further, and the result is the same regardless of input order.
    if (identities.size > 1) {
      return AMBIGUOUS;
    }
  }

  // Exactly one distinct identity across every linked item.
  const [only] = identities;
  return Object.freeze({ status: "RESOLVED" as const, courseOfferingId: only });
}
