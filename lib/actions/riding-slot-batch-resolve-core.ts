/**
 * PERF-1 / P1 - the PURE core for BATCHED riding-slot resolution.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/headers, no React, and deliberately NO "use server". It only
 * indexes already-fetched link rows and picks, per displayed activity, which
 * already-fetched RidingSlot row that activity resolves to - so the whole
 * resolution contract is unit-testable without a database (see
 * riding-slots-batch-resolve.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * buildActivitiesForDay (lib/actions/riding-slots.ts) used to resolve each
 * displayed activity's RidingSlot one at a time, inside a sequential `for`
 * loop, through resolveRidingSlotForIds - two awaited queries
 * (ridingSlotScheduleItem.findFirst, then ridingSlot.findUnique) PER ACTIVITY.
 * A single day with 12 activities therefore cost ~24 sequential round trips,
 * and an instructor week (six days, plus every unlinked schedule item, which is
 * resolved and only then discarded) cost roughly eighty. This core lets that
 * shell issue exactly TWO queries per day - one link read, one slot read -
 * and resolve every activity from memory, with identical results.
 *
 * IT LIVES IN ITS OWN MODULE, NOT IN riding-slots.ts, FOR ONE CONCRETE REASON:
 * riding-slots.ts carries the "use server" directive, under which every runtime
 * export must be an async Server Action (all sixteen of its current exports
 * are). A synchronous helper cannot be exported from it without breaking the
 * build, and making these helpers async would mint new public POST entry points
 * for what is pure in-memory bookkeeping. Splitting the pure half out is the
 * same convention riding-slots-read-auth.ts, riding-slot-roster-scope.ts and
 * every lib/course/*-core.ts already follow.
 *
 * WHAT THIS DOES NOT OWN
 * ----------------------
 *  - It performs NO authorization. buildActivitiesForDay never had a gate of
 *    its own (its callers - getWeeklyRidingOverview's requireAdmin() and
 *    getInstructorRidingSlots' getCurrentInstructor() - own that), and this
 *    core does not become the place one is bolted on.
 *  - It performs NO IO and builds NO query. The shell owns both Prisma calls.
 *  - It does NOT map a RidingSlot row into a RidingSlotRow view. That is
 *    toRidingSlotRow's job and it stays, verbatim, in riding-slots.ts - which is
 *    why every function here is GENERIC over the row type and this module
 *    imports nothing at all.
 */

/**
 * One fetched RidingSlotScheduleItem link, projected to exactly the two columns
 * resolution needs. Structural: the shell passes whole link rows (the same
 * unnarrowed projection the previous findFirst returned), and the extra columns
 * are simply ignored here.
 */
export interface RidingSlotLinkRow {
  scheduleItemId: string;
  ridingSlotId: string;
}

/**
 * The de-duplicated union of every ScheduleItem id referenced by a day's
 * activities, in first-seen order.
 *
 * De-duplication matters because merged/coalesced display cards legitimately
 * repeat ids across the `span` layout (the long side and each short-side box
 * can name overlapping rows), and because an `in:` predicate should not carry
 * the same id twice. First-seen order keeps the emitted query deterministic,
 * which keeps it comparable across runs; it carries no selection meaning.
 */
export function collectActivityScheduleItemIds(
  activityScheduleItemIdSets: readonly (readonly string[])[],
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const idSet of activityScheduleItemIdSets) {
    for (const id of idSet) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Index fetched link rows by their ScheduleItem id.
 *
 * A Map is exact here rather than merely convenient: RidingSlotScheduleItem
 * .scheduleItemId is UNIQUE in the schema (see prisma/schema.prisma -
 * `scheduleItemId String @unique`), so at most ONE link row can exist per
 * ScheduleItem and this index can never lose information. A duplicate id would
 * be a schema violation; should one ever appear, the FIRST row wins, so the
 * index stays independent of the order the database happened to return rows in.
 */
export function indexRidingSlotLinks(
  links: readonly RidingSlotLinkRow[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const link of links) {
    if (index.has(link.scheduleItemId)) continue;
    index.set(link.scheduleItemId, link.ridingSlotId);
  }
  return index;
}

/**
 * Which RidingSlot does ONE displayed activity resolve to?
 *
 * THE TIE-BREAK, AND WHY IT IS NEW.
 * The previous implementation ran
 *   ridingSlotScheduleItem.findFirst({ where: { scheduleItemId: { in: ids } } })
 * with NO orderBy. Because scheduleItemId is UNIQUE, a single-id activity was
 * never ambiguous - but a MERGED card carries several ids ("a+b+c"), and if two
 * of those rows were linked to DIFFERENT RidingSlots, `findFirst` without an
 * ORDER BY returned whichever row PostgreSQL produced first. That was genuinely
 * arbitrary and not a contract worth preserving bug-for-bug.
 *
 * This replaces it with a deterministic rule: walk the activity's OWN id list in
 * the order it already has - `item.id.split("+")`, i.e. the display/merge order
 * buildScheduleSlots produced - and take the FIRST id that has a link. The
 * choice therefore depends only on caller input, never on database row order and
 * never on Map insertion order, and it preserves the documented intent of the
 * original ("resolves to an existing slot if ANY of those real rows already
 * belong to one - not just the card's first row").
 *
 * An empty id list, a list whose ids have no link at all, and a linked slot id
 * with no corresponding fetched row (a dangling reference the FK makes
 * impossible, guarded defensively exactly as the previous
 * `slot ? toRidingSlotRow(slot) : null` did) ALL collapse to the same null -
 * the same three null outcomes the per-activity resolver produced.
 */
export function resolveRidingSlotForActivity<TRow>(
  scheduleItemIdsInDisplayOrder: readonly string[],
  linkIndex: ReadonlyMap<string, string>,
  rowsByRidingSlotId: ReadonlyMap<string, TRow>,
): TRow | null {
  const ridingSlotId = pickRidingSlotIdForActivity(scheduleItemIdsInDisplayOrder, linkIndex);
  if (ridingSlotId === null) return null;
  return rowsByRidingSlotId.get(ridingSlotId) ?? null;
}

/**
 * The tie-break itself, exposed separately so the shell can collect the slot ids
 * it must fetch BEFORE any row exists to resolve against - and so the rule can
 * be asserted on its own. See resolveRidingSlotForActivity for the contract.
 */
export function pickRidingSlotIdForActivity(
  scheduleItemIdsInDisplayOrder: readonly string[],
  linkIndex: ReadonlyMap<string, string>,
): string | null {
  for (const scheduleItemId of scheduleItemIdsInDisplayOrder) {
    const ridingSlotId = linkIndex.get(scheduleItemId);
    if (ridingSlotId !== undefined) return ridingSlotId;
  }
  return null;
}

/**
 * Every distinct RidingSlot id a day's activities actually resolve to, in
 * first-seen activity order - the exact `in:` input for the single slot read.
 *
 * Deliberately derived through the SAME pickRidingSlotIdForActivity the
 * resolution step uses, not from the raw link set: an activity contributes only
 * the ONE slot its tie-break selects, so a merged card spanning two slots never
 * causes the other slot's assignments and instructors to be fetched. Several
 * activities resolving to the same slot contribute it once, and that single
 * fetched row is then shared by all of them.
 */
export function collectLinkedRidingSlotIds(
  activityScheduleItemIdSets: readonly (readonly string[])[],
  linkIndex: ReadonlyMap<string, string>,
): string[] {
  const seen = new Set<string>();
  const ridingSlotIds: string[] = [];
  for (const idSet of activityScheduleItemIdSets) {
    const ridingSlotId = pickRidingSlotIdForActivity(idSet, linkIndex);
    if (ridingSlotId === null || seen.has(ridingSlotId)) continue;
    seen.add(ridingSlotId);
    ridingSlotIds.push(ridingSlotId);
  }
  return ridingSlotIds;
}
