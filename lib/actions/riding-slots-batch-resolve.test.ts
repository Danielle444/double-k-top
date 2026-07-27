/**
 * PERF-1 / P1 - focused behavioural tests for BATCHED riding-slot resolution
 * (lib/actions/riding-slot-batch-resolve-core.ts), plus source-level contract
 * assertions on the shell that consumes it (lib/actions/riding-slots.ts).
 *
 * The core is pure, so these exercise it with plain fixtures - no Next.js
 * cookies, no live Prisma, no database. The shell itself is a "use server"
 * module and is therefore never imported here (same convention as
 * riding-slot-roster-scope.contract.test.ts, which also reads riding-slots.ts
 * as text); the handful of assertions that must hold in the shell are made
 * against its source.
 *
 * What is locked here:
 *  - resolution produces the same result the previous per-activity
 *    resolveRidingSlotForIds produced, for single / merged / pair / span
 *    activities alike;
 *  - the query COUNT is constant per day (one link read, one slot read) and
 *    drops to fewer when nothing is linked - never O(activities);
 *  - the three null outcomes (no ids, no link, no fetched row) survive;
 *  - a merged activity resolves through ANY linked constituent id;
 *  - duplicate ids neither duplicate the query input nor change the output;
 *  - activities sharing a slot share one fetched row while keeping their own
 *    schedule metadata;
 *  - activity order is preserved and the shell still applies its
 *    startTime/endTime sort last;
 *  - the ambiguous-match tie-break is deterministic and documented.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slots-batch-resolve.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectActivityScheduleItemIds,
  collectLinkedRidingSlotIds,
  indexRidingSlotLinks,
  pickRidingSlotIdForActivity,
  resolveRidingSlotForActivity,
  type RidingSlotLinkRow,
} from "./riding-slot-batch-resolve-core";

// ---------------------------------------------------------------------------
// Fixtures + a faithful model of the OLD per-activity behaviour
// ---------------------------------------------------------------------------

/** Stand-in for a mapped RidingSlotRow - the core is generic over this. */
interface FakeSlotRow {
  id: string;
  marker: string;
}

/**
 * The previous implementation, modelled exactly:
 *   if (ids.length === 0) return null;
 *   link = findFirst({ where: { scheduleItemId: { in: ids } } });   // no orderBy
 *   if (!link) return null;
 *   slot = findUnique({ where: { id: link.ridingSlotId } });
 *   return slot ? toRidingSlotRow(slot) : null;
 *
 * `findFirst` is modelled as "the first matching row in the link table's own
 * order", which is what an unordered scan degenerates to. Fixtures used for the
 * equivalence test are built so this is unambiguous (no activity spans two
 * slots); the deliberately ambiguous case is asserted separately below.
 */
function resolveTheOldWay(
  scheduleItemIds: readonly string[],
  links: readonly RidingSlotLinkRow[],
  slotsById: ReadonlyMap<string, FakeSlotRow>,
): FakeSlotRow | null {
  if (scheduleItemIds.length === 0) return null;
  const link = links.find((l) => scheduleItemIds.includes(l.scheduleItemId));
  if (!link) return null;
  return slotsById.get(link.ridingSlotId) ?? null;
}

/** The new path, as the shell composes it. */
function resolveTheNewWay(
  idSets: readonly (readonly string[])[],
  links: readonly RidingSlotLinkRow[],
  slotsById: ReadonlyMap<string, FakeSlotRow>,
): (FakeSlotRow | null)[] {
  const linkIndex = indexRidingSlotLinks(links);
  const wanted = collectLinkedRidingSlotIds(idSets, linkIndex);
  // Only the wanted slots are "fetched" - mirrors the shell's `in:` slot read.
  const fetched = new Map<string, FakeSlotRow>();
  for (const id of wanted) {
    const row = slotsById.get(id);
    if (row) fetched.set(id, row);
  }
  return idSets.map((ids) => resolveRidingSlotForActivity(ids, linkIndex, fetched));
}

// ---------------------------------------------------------------------------
// 1. Equivalence across single / merged / pair / span activity shapes
// ---------------------------------------------------------------------------

test("batched resolution equals the old per-activity result for single/merged/pair/span", () => {
  // Modelled on what buildScheduleSlots flattens into rawActivities:
  //  - single: one id
  //  - merged: several coalesced ids joined with "+"
  //  - pair:   two side-by-side boxes, each its own activity
  //  - span:   one long box plus each short-side box
  const idSets: string[][] = [
    ["single-1"], // single, linked
    ["merged-a", "merged-b", "merged-c"], // merged, linked via a middle id
    ["pair-left"], // pair box 1, linked
    ["pair-right"], // pair box 2, unlinked
    ["span-long"], // span long side, linked
    ["span-short-1"], // span short box 1, unlinked
    ["span-short-2"], // span short box 2, linked to the SAME slot as span-long
  ];

  const links: RidingSlotLinkRow[] = [
    { scheduleItemId: "single-1", ridingSlotId: "slot-single" },
    { scheduleItemId: "merged-b", ridingSlotId: "slot-merged" },
    { scheduleItemId: "pair-left", ridingSlotId: "slot-pair" },
    { scheduleItemId: "span-long", ridingSlotId: "slot-span" },
    { scheduleItemId: "span-short-2", ridingSlotId: "slot-span" },
  ];

  const slotsById = new Map<string, FakeSlotRow>([
    ["slot-single", { id: "slot-single", marker: "S" }],
    ["slot-merged", { id: "slot-merged", marker: "M" }],
    ["slot-pair", { id: "slot-pair", marker: "P" }],
    ["slot-span", { id: "slot-span", marker: "N" }],
  ]);

  const oldResults = idSets.map((ids) => resolveTheOldWay(ids, links, slotsById));
  const newResults = resolveTheNewWay(idSets, links, slotsById);

  assert.deepEqual(newResults, oldResults);
  assert.deepEqual(
    newResults.map((r) => r?.id ?? null),
    ["slot-single", "slot-merged", "slot-pair", null, "slot-span", null, "slot-span"],
    "each activity shape resolves to the slot the previous implementation chose",
  );
});

// ---------------------------------------------------------------------------
// 2. Constant query count
// ---------------------------------------------------------------------------

test("twelve activities need one link fetch and one slot fetch, not two per activity", () => {
  const idSets = Array.from({ length: 12 }, (_, i) => [`item-${i}`]);
  const links: RidingSlotLinkRow[] = idSets.map((ids, i) => ({
    scheduleItemId: ids[0],
    ridingSlotId: `slot-${i}`,
  }));

  let linkFetches = 0;
  let slotFetches = 0;

  // Exactly the shell's control flow.
  const allIds = collectActivityScheduleItemIds(idSets);
  if (allIds.length > 0) linkFetches++;
  const linkIndex = indexRidingSlotLinks(links);
  const wantedSlotIds = collectLinkedRidingSlotIds(idSets, linkIndex);
  if (wantedSlotIds.length > 0) slotFetches++;

  assert.equal(linkFetches, 1);
  assert.equal(slotFetches, 1);
  assert.equal(
    linkFetches + slotFetches,
    2,
    "12 activities cost 2 queries; the old path cost 24",
  );
  assert.equal(allIds.length, 12, "every activity id reaches the single link predicate");
});

test("a day with no linked riding slots costs one link fetch and zero slot fetches", () => {
  const idSets = [["a"], ["b"], ["c"]];
  const allIds = collectActivityScheduleItemIds(idSets);
  const linkIndex = indexRidingSlotLinks([]);
  const wantedSlotIds = collectLinkedRidingSlotIds(idSets, linkIndex);

  assert.equal(allIds.length > 0, true, "the link read still happens - nothing is known yet");
  assert.deepEqual(wantedSlotIds, [], "but no slot read is issued at all");
});

test("a day with no activities costs zero queries", () => {
  const allIds = collectActivityScheduleItemIds([]);
  const wantedSlotIds = collectLinkedRidingSlotIds([], indexRidingSlotLinks([]));
  assert.deepEqual(allIds, []);
  assert.deepEqual(wantedSlotIds, []);
});

// ---------------------------------------------------------------------------
// 3 + 4. The null outcomes
// ---------------------------------------------------------------------------

test("an activity with no matching link stays present with ridingSlot null", () => {
  const links: RidingSlotLinkRow[] = [{ scheduleItemId: "linked", ridingSlotId: "slot-1" }];
  const slotsById = new Map<string, FakeSlotRow>([["slot-1", { id: "slot-1", marker: "A" }]]);
  const idSets = [["linked"], ["unlinked"]];

  const results = resolveTheNewWay(idSets, links, slotsById);

  assert.equal(results.length, 2, "the unlinked activity is NOT dropped here");
  assert.equal(results[1], null, "it carries ridingSlot: null; filtering is the caller's job");
  assert.deepEqual(results, idSets.map((ids) => resolveTheOldWay(ids, links, slotsById)));
});

test("an empty scheduleItemIds list resolves to null without consulting anything", () => {
  const linkIndex = indexRidingSlotLinks([
    { scheduleItemId: "x", ridingSlotId: "slot-x" },
  ]);
  const rows = new Map<string, FakeSlotRow>([["slot-x", { id: "slot-x", marker: "X" }]]);

  assert.equal(pickRidingSlotIdForActivity([], linkIndex), null);
  assert.equal(resolveRidingSlotForActivity([], linkIndex, rows), null);
  assert.deepEqual(collectLinkedRidingSlotIds([[]], linkIndex), []);
});

test("a linked slot id with no fetched row fails closed to null, as the old findUnique guard did", () => {
  // The FK makes this unreachable in practice; the previous code still guarded
  // it with `slot ? toRidingSlotRow(slot) : null` and so must this.
  const linkIndex = indexRidingSlotLinks([
    { scheduleItemId: "orphan", ridingSlotId: "slot-gone" },
  ]);
  assert.equal(resolveRidingSlotForActivity(["orphan"], linkIndex, new Map()), null);
});

// ---------------------------------------------------------------------------
// 5. Merged activities resolve through ANY constituent id
// ---------------------------------------------------------------------------

test("a merged activity resolves through any linked constituent id, not just the first", () => {
  const slotsById = new Map<string, FakeSlotRow>([["slot-m", { id: "slot-m", marker: "M" }]]);

  for (const linkedId of ["m-a", "m-b", "m-c"]) {
    const links: RidingSlotLinkRow[] = [{ scheduleItemId: linkedId, ridingSlotId: "slot-m" }];
    const [result] = resolveTheNewWay([["m-a", "m-b", "m-c"]], links, slotsById);
    assert.equal(
      result?.id,
      "slot-m",
      `a merged card must resolve when only ${linkedId} is linked`,
    );
    assert.deepEqual(result, resolveTheOldWay(["m-a", "m-b", "m-c"], links, slotsById));
  }
});

// ---------------------------------------------------------------------------
// 6. Duplicate ids
// ---------------------------------------------------------------------------

test("duplicate scheduleItemIds neither duplicate the query input nor change the output", () => {
  // The `span` layout legitimately repeats ids across boxes.
  const idSets = [
    ["dup", "dup", "other"],
    ["other", "dup"],
  ];

  const allIds = collectActivityScheduleItemIds(idSets);
  assert.deepEqual(allIds, ["dup", "other"], "the `in:` predicate carries each id once");

  const links: RidingSlotLinkRow[] = [{ scheduleItemId: "dup", ridingSlotId: "slot-d" }];
  const slotsById = new Map<string, FakeSlotRow>([["slot-d", { id: "slot-d", marker: "D" }]]);

  const results = resolveTheNewWay(idSets, links, slotsById);
  assert.deepEqual(
    results.map((r) => r?.id ?? null),
    ["slot-d", "slot-d"],
    "output is unaffected by the repetition",
  );
  assert.deepEqual(results, idSets.map((ids) => resolveTheOldWay(ids, links, slotsById)));
});

test("a duplicated link row cannot corrupt the index (scheduleItemId is UNIQUE in schema)", () => {
  const linkIndex = indexRidingSlotLinks([
    { scheduleItemId: "s", ridingSlotId: "slot-first" },
    { scheduleItemId: "s", ridingSlotId: "slot-second" },
  ]);
  assert.equal(
    linkIndex.get("s"),
    "slot-first",
    "first row wins, so DB return order cannot change the result",
  );
});

// ---------------------------------------------------------------------------
// 7. Shared slot rows
// ---------------------------------------------------------------------------

test("activities resolving to one slot share the single fetched row and keep their own metadata", () => {
  const idSets = [["a"], ["b"], ["c"]];
  const links: RidingSlotLinkRow[] = [
    { scheduleItemId: "a", ridingSlotId: "shared" },
    { scheduleItemId: "b", ridingSlotId: "shared" },
    { scheduleItemId: "c", ridingSlotId: "other" },
  ];
  const slotsById = new Map<string, FakeSlotRow>([
    ["shared", { id: "shared", marker: "SH" }],
    ["other", { id: "other", marker: "OT" }],
  ]);

  const linkIndex = indexRidingSlotLinks(links);
  const wanted = collectLinkedRidingSlotIds(idSets, linkIndex);
  assert.deepEqual(wanted, ["shared", "other"], "the shared slot is fetched exactly once");

  const results = resolveTheNewWay(idSets, links, slotsById);
  assert.equal(results[0], results[1], "both activities point at the SAME fetched row object");
  assert.notEqual(results[0], results[2]);

  // The shell builds each WeeklyRidingActivity from its own item's fields and
  // only shares the resolved slot - modelled here.
  const built = idSets.map((ids, i) => ({
    scheduleItemIds: ids,
    startTime: `${String(i + 8).padStart(2, "0")}:00`,
    ridingSlot: results[i],
  }));
  assert.deepEqual(
    built.map((b) => [b.scheduleItemIds[0], b.startTime, b.ridingSlot?.id ?? null]),
    [
      ["a", "08:00", "shared"],
      ["b", "09:00", "shared"],
      ["c", "10:00", "other"],
    ],
    "shared slot, independent schedule metadata",
  );
});

// ---------------------------------------------------------------------------
// 8. Ordering
// ---------------------------------------------------------------------------

test("input activity order is preserved one-for-one by the resolution step", () => {
  const idSets = [["z"], ["y"], ["x"], ["w"]];
  const links: RidingSlotLinkRow[] = [
    { scheduleItemId: "y", ridingSlotId: "slot-y" },
    { scheduleItemId: "w", ridingSlotId: "slot-w" },
  ];
  const slotsById = new Map<string, FakeSlotRow>([
    ["slot-y", { id: "slot-y", marker: "Y" }],
    ["slot-w", { id: "slot-w", marker: "W" }],
  ]);

  const results = resolveTheNewWay(idSets, links, slotsById);
  assert.equal(results.length, idSets.length, "one result per activity, positionally aligned");
  assert.deepEqual(results.map((r) => r?.id ?? null), [null, "slot-y", null, "slot-w"]);
});

test("the shell still applies the startTime/endTime sort as the LAST step", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  const sortIndex = src.indexOf(
    "a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)",
  );
  const pushIndex = src.indexOf("activities.push({");
  assert.ok(sortIndex > 0, "the existing sort must still be present, unchanged");
  assert.ok(pushIndex > 0 && pushIndex < sortIndex, "and must still run after the build loop");
});

// ---------------------------------------------------------------------------
// 9. The documented tie-break
// ---------------------------------------------------------------------------

test("an ambiguous merged activity picks the first id IN DISPLAY ORDER that has a link", () => {
  const links: RidingSlotLinkRow[] = [
    // Deliberately listed in the opposite order to the display order below, so
    // any dependence on link/DB/Map order would show up here.
    { scheduleItemId: "b", ridingSlotId: "slot-b" },
    { scheduleItemId: "a", ridingSlotId: "slot-a" },
  ];
  const linkIndex = indexRidingSlotLinks(links);

  assert.equal(pickRidingSlotIdForActivity(["a", "b"], linkIndex), "slot-a");
  assert.equal(pickRidingSlotIdForActivity(["b", "a"], linkIndex), "slot-b");
  assert.equal(
    pickRidingSlotIdForActivity(["unlinked", "b", "a"], linkIndex),
    "slot-b",
    "leading unlinked ids are skipped, then the first LINKED id in display order wins",
  );
});

test("the tie-break is stable across repeated calls and across link-row orderings", () => {
  const displayOrder = ["p", "q", "r"];
  const rows: RidingSlotLinkRow[] = [
    { scheduleItemId: "q", ridingSlotId: "slot-q" },
    { scheduleItemId: "r", ridingSlotId: "slot-r" },
  ];
  const permutations = [rows, [...rows].reverse()];

  for (const perm of permutations) {
    for (let i = 0; i < 5; i++) {
      assert.equal(
        pickRidingSlotIdForActivity(displayOrder, indexRidingSlotLinks(perm)),
        "slot-q",
        "same answer regardless of link-row order or repetition",
      );
    }
  }
});

test("only the tie-break winner is fetched - a spanning card never drags the other slot in", () => {
  const linkIndex = indexRidingSlotLinks([
    { scheduleItemId: "a", ridingSlotId: "slot-a" },
    { scheduleItemId: "b", ridingSlotId: "slot-b" },
  ]);
  assert.deepEqual(
    collectLinkedRidingSlotIds([["a", "b"]], linkIndex),
    ["slot-a"],
    "slot-b's assignments and instructors are never loaded",
  );
});

// ---------------------------------------------------------------------------
// Shell contract: the N+1 is gone, the reused pieces are still reused, and no
// gate moved.
// ---------------------------------------------------------------------------

test("buildActivitiesForDay no longer awaits a per-activity resolve inside its loop", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  const start = src.indexOf("async function buildActivitiesForDay");
  const end = src.indexOf("export async function getWeeklyRidingOverview");
  assert.ok(start > 0 && end > start, "buildActivitiesForDay must still exist");
  const body = src.slice(start, end);

  assert.ok(
    !body.includes("await resolveRidingSlotForIds"),
    "the per-activity N+1 call must be gone from this function",
  );
  assert.ok(body.includes("ridingSlotScheduleItem.findMany"), "one batched link read");
  assert.ok(body.includes("ridingSlot.findMany"), "one batched slot read");
  assert.ok(body.includes("RIDING_SLOT_INCLUDE"), "the existing include is reused verbatim");
  assert.ok(body.includes("toRidingSlotRow"), "the existing mapper is reused verbatim");
  assert.ok(
    !body.includes("requireAdmin") && !body.includes("getCurrentInstructor"),
    "no gate was added inside buildActivitiesForDay - its callers still own that",
  );
});

test("resolveRidingSlotForIds is preserved for its remaining caller", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  assert.ok(
    src.includes("async function resolveRidingSlotForIds("),
    "the single-activity resolver must still exist",
  );
  const getter = src.slice(src.indexOf("export async function getRidingSlotForScheduleItem"));
  assert.ok(
    getter.includes("await requireAdmin();") &&
      getter.includes("return resolveRidingSlotForIds(scheduleItemIds);"),
    "getRidingSlotForScheduleItem keeps its admin gate and its resolver call",
  );
});

test("the two riding-slot read gates are untouched", () => {
  const src = readFileSync(fileURLToPath(new URL("./riding-slots.ts", import.meta.url)), "utf8");
  const overview = src.slice(
    src.indexOf("export async function getWeeklyRidingOverview"),
    src.indexOf("async function buildInstructorRidingSlots"),
  );
  assert.ok(overview.includes("await requireAdmin();"), "admin gate intact");

  const instructor = src.slice(src.indexOf("export async function getInstructorRidingSlots"));
  assert.ok(
    instructor.includes("getCurrentInstructor") && instructor.includes("readSlots:"),
    "the session-derived instructor gate and its delegation are intact",
  );
});

test("the batch core is pure - no prisma, no next, no use server", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./riding-slot-batch-resolve-core.ts", import.meta.url)),
    "utf8",
  );
  // Comments are stripped first: this module's header legitimately DISCUSSES
  // "use server" and Prisma while containing neither, and a naive substring
  // scan over the raw text would flag its own documentation.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  for (const forbidden of ['"use server"', "@/lib/prisma", "next/", "@/lib/auth", "prisma."]) {
    assert.ok(!code.includes(forbidden), `the pure core must not reference ${forbidden}`);
  }
  assert.ok(!/^\s*import\s/m.test(code), "the pure core imports nothing at all");
  assert.ok(!/\basync\b/.test(code), "the pure core has no async surface");
});
