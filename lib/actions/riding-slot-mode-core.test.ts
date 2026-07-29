/**
 * PERF-1 / P3A - focused behavioural tests for payload-derived riding-slot mode
 * resolution (lib/actions/riding-slot-mode-core.ts), plus source-level contract
 * assertions on the three shells that consume it.
 *
 * The core is pure, so the rule itself is exercised with plain fixtures - no
 * Next.js cookies, no live Prisma, no database. riding-slots.ts ("use server")
 * and the two instructor client components cannot be imported here, so the
 * properties that must hold in them are asserted against their source, the same
 * convention riding-slots-batch-resolve.test.ts and
 * riding-slot-roster-scope.contract.test.ts already follow.
 *
 * What is locked here:
 *  - the full two-boolean truth table, and complex precedence;
 *  - equivalence with the OLD short-circuit detection order;
 *  - RidingSlotRow keeps every pre-existing field, and the two mode fields are
 *    additive presence-only booleans;
 *  - RIDING_SLOT_INCLUDE still carries assignments and scheduleItems; horseList
 *    still selects nothing but `id`, and complexPlan selects `id` plus - since
 *    RIDING-MINE-COMPLEX - blocks -> stations -> instructorId AND NOTHING ELSE
 *    (the co-located riding-slot-assignment-scope-core.test.ts owns the
 *    forbidden-content scan of that select in full detail);
 *  - neither instructor component performs load-time per-slot mode detection;
 *  - refreshModeFor still performs its user-initiated refresh, and the reader it
 *    depends on still exists;
 *  - getInstructorRidingSlots keeps its session-derived instructor gate and the
 *    admin readers keep requireAdmin();
 *  - the core mints no Server Action and reaches no forbidden area.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slot-mode-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildRidingSlotModeMap,
  resolveRidingSlotMode,
  type ResolvedRidingSlotMode,
} from "./riding-slot-mode-core";

/** Raw file text, with line endings normalised (this repo mixes LF and CRLF). */
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/**
 * File text with COMMENTS STRIPPED.
 *
 * Every structural assertion below uses this rather than the raw source. These
 * modules document themselves exhaustively - the mode core's own header
 * discusses `"use server"`, Prisma and the two editing readers precisely to
 * explain why it touches none of them - so a raw substring scan would flag the
 * documentation instead of the code it describes.
 */
const readCode = (relativePath: string): string =>
  readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/** Collapse whitespace so an assertion cannot depend on wrapping or indentation. */
const flat = (source: string): string => source.replace(/\s+/g, " ");

const RIDING_SLOTS = "./riding-slots.ts";
const MODE_CORE = "./riding-slot-mode-core.ts";
const INSTRUCTOR_CLIENT = "../../app/instructor/InstructorClient.tsx";
const RIDING_SECTION = "../../app/instructor/InstructorRidingSlotsSection.tsx";

// ---------------------------------------------------------------------------
// 1-4. The truth table
// ---------------------------------------------------------------------------

test("hasComplexPlan=true, hasHorseList=true resolves to complex", () => {
  assert.equal(resolveRidingSlotMode({ hasComplexPlan: true, hasHorseList: true }), "complex");
});

test("hasComplexPlan=true, hasHorseList=false resolves to complex", () => {
  assert.equal(resolveRidingSlotMode({ hasComplexPlan: true, hasHorseList: false }), "complex");
});

test("hasComplexPlan=false, hasHorseList=true resolves to simple", () => {
  assert.equal(resolveRidingSlotMode({ hasComplexPlan: false, hasHorseList: true }), "simple");
});

test("both false resolves to none", () => {
  assert.equal(resolveRidingSlotMode({ hasComplexPlan: false, hasHorseList: false }), "none");
});

// ---------------------------------------------------------------------------
// 5. Equivalence with the OLD short-circuit
// ---------------------------------------------------------------------------

/**
 * The previous implementation, modelled exactly (it was byte-identical in
 * InstructorClient.detectScheduleRidingSlotMode and
 * InstructorRidingSlotsSection.detectInstructorRidingSlotMode):
 *
 *   const complexPlan = await getRidingSlotComplexPlanForInstructor(id);
 *   if (complexPlan) return "complex";
 *   const horseList = await getRidingSlotHorseListForInstructor(id);
 *   if (horseList?.listId) return "simple";
 *   return "none";
 *
 * `complexPlan` is non-null exactly when a RidingSlotComplexPlan row exists
 * (buildComplexPlanForEditing returns null on `!plan`), and `listId` is truthy
 * exactly when a RidingSlotHorseList row exists (buildHorseListStatus sets
 * listId: null in the `!list` branch and list.id otherwise) - which is precisely
 * what the two presence booleans carry.
 */
function detectTheOldWay(rowsExist: {
  complexPlanRowExists: boolean;
  horseListRowExists: boolean;
}): ResolvedRidingSlotMode {
  const complexPlan = rowsExist.complexPlanRowExists ? { plan: {} } : null;
  if (complexPlan) return "complex";
  const horseList = rowsExist.horseListRowExists ? { listId: "list-1" } : { listId: null };
  if (horseList?.listId) return "simple";
  return "none";
}

test("the new rule matches the old short-circuit across the whole truth table", () => {
  for (const hasComplexPlan of [true, false]) {
    for (const hasHorseList of [true, false]) {
      assert.equal(
        resolveRidingSlotMode({ hasComplexPlan, hasHorseList }),
        detectTheOldWay({
          complexPlanRowExists: hasComplexPlan,
          horseListRowExists: hasHorseList,
        }),
        `mismatch for complex=${hasComplexPlan} horse=${hasHorseList}`,
      );
    }
  }
});

test("complex wins over simple, reproducing the old read-complex-first order", () => {
  // The old code returned before ever reading the horse list, so a slot holding
  // both rows was "complex". That must not silently become "simple".
  assert.equal(resolveRidingSlotMode({ hasComplexPlan: true, hasHorseList: true }), "complex");
  assert.equal(detectTheOldWay({ complexPlanRowExists: true, horseListRowExists: true }), "complex");
});

test("non-boolean/absent facts fail closed to the less capable mode", () => {
  const asFacts = (v: unknown) => v as { hasComplexPlan: boolean; hasHorseList: boolean };
  assert.equal(resolveRidingSlotMode(asFacts({})), "none");
  assert.equal(resolveRidingSlotMode(asFacts({ hasComplexPlan: undefined })), "none");
  // Truthy-but-not-true must NOT open the complex editor.
  assert.equal(resolveRidingSlotMode(asFacts({ hasComplexPlan: 1, hasHorseList: true })), "simple");
  assert.equal(resolveRidingSlotMode(asFacts({ hasComplexPlan: "yes" })), "none");
  assert.equal(resolveRidingSlotMode(asFacts(null)), "none");
});

// ---------------------------------------------------------------------------
// The map seeder
// ---------------------------------------------------------------------------

test("buildRidingSlotModeMap keys by riding slot id and delegates the rule", () => {
  const modes = buildRidingSlotModeMap([
    { id: "s-complex", hasComplexPlan: true, hasHorseList: false },
    { id: "s-simple", hasComplexPlan: false, hasHorseList: true },
    { id: "s-none", hasComplexPlan: false, hasHorseList: false },
    { id: "s-both", hasComplexPlan: true, hasHorseList: true },
  ]);
  assert.deepEqual(modes, {
    "s-complex": "complex",
    "s-simple": "simple",
    "s-none": "none",
    "s-both": "complex",
  });
});

test("the same slot referenced by several activities collapses to one entry", () => {
  const slot = { id: "shared", hasComplexPlan: false, hasHorseList: true };
  const modes = buildRidingSlotModeMap([slot, slot, slot]);
  assert.deepEqual(modes, { shared: "simple" });
  assert.equal(Object.keys(modes).length, 1);
});

test("a blank or non-string id is skipped rather than creating a junk key", () => {
  const modes = buildRidingSlotModeMap([
    { id: "", hasComplexPlan: true, hasHorseList: false },
    { id: "ok", hasComplexPlan: true, hasHorseList: false },
  ]);
  assert.deepEqual(modes, { ok: "complex" });
});

test("an empty slot list produces an empty map, never a throw", () => {
  assert.deepEqual(buildRidingSlotModeMap([]), {});
});

test("the resolved mode type is assignable to the client InstructorSlotMode union", () => {
  // Compile-time subset check, made executable: "error" belongs to the CLIENT
  // union only (a failed user-initiated refresh) and must never be derivable.
  const wider: "none" | "simple" | "complex" | "error" = resolveRidingSlotMode({
    hasComplexPlan: false,
    hasHorseList: false,
  });
  assert.ok(["none", "simple", "complex"].includes(wider));
  assert.ok(!readCode(MODE_CORE).includes('"error"'), "the core must not produce an error mode");
});

// ---------------------------------------------------------------------------
// 6-9. The reader payload
// ---------------------------------------------------------------------------

test("RidingSlotRow retains every pre-existing field", () => {
  const src = readCode(RIDING_SLOTS);
  const row = src.slice(src.indexOf("export interface RidingSlotRow"));
  const body = row.slice(0, row.indexOf("}"));
  for (const field of [
    "id: string;",
    "scheduleItemId: string;",
    "scheduleItemIds: string[];",
    "showInstructorToStudents: boolean;",
    "showArenaToStudents: boolean;",
    "showSubgroupToStudents: boolean;",
    "assignments: RidingSlotAssignmentRow[];",
  ]) {
    assert.ok(body.includes(field), `RidingSlotRow must still declare ${field}`);
  }
});

test("hasComplexPlan and hasHorseList are additive booleans on RidingSlotRow", () => {
  const src = readCode(RIDING_SLOTS);
  const row = src.slice(src.indexOf("export interface RidingSlotRow"));
  const body = row.slice(0, row.indexOf("}"));
  assert.ok(body.includes("hasComplexPlan: boolean;"));
  assert.ok(body.includes("hasHorseList: boolean;"));
  // Presence only - no plan/list/roster payload may ride along.
  for (const leaked of ["blocks", "stations", "pairs", "candidates", "items:", "version"]) {
    assert.ok(!body.includes(leaked), `RidingSlotRow must not carry ${leaked}`);
  }
});

test("RIDING_SLOT_INCLUDE still includes assignments and scheduleItems", () => {
  const src = readCode(RIDING_SLOTS);
  const include = src.slice(src.indexOf("const RIDING_SLOT_INCLUDE = {"));
  const body = include.slice(0, include.indexOf("\n};"));
  assert.ok(body.includes("assignments:"), "assignments must still be included");
  assert.ok(
    body.includes("ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE"),
    "the assignment include shape is reused verbatim",
  );
  assert.ok(body.includes('orderBy: [{ groupName: "asc" as const }'), "assignment order preserved");
  assert.ok(
    body.includes("scheduleItems: { select: { scheduleItemId: true } }"),
    "scheduleItems must still be included, unchanged",
  );
});

test("the two mode relations still carry presence, and complexPlan carries only coach ids beyond it", () => {
  const src = readCode(RIDING_SLOTS);
  const include = src.slice(src.indexOf("const RIDING_SLOT_INCLUDE = {"));
  const body = flat(include.slice(0, include.indexOf("\n};")));
  // horseList is unchanged: presence only.
  assert.ok(body.includes("horseList: { select: { id: true } }"));
  // complexPlan still selects `id` - the mode rule's entire input - and, since
  // RIDING-MINE-COMPLEX, traverses blocks -> stations for `instructorId` only.
  assert.ok(body.includes("complexPlan: { select: { id: true,"));
  assert.ok(body.includes("blocks: { select: { stations: { select: { instructorId: true } } } }"));
  // The traversal is narrowly allowed; NO station content may ride along with
  // it. (Duplicated deliberately from the scope core's own test - this file
  // owns the mode contract and must not silently lose the boundary it asserted
  // when the select was presence-only.)
  for (const leaked of [
    "pairs",
    "trainee1Id",
    "trainee2Id",
    "horseName",
    "arena",
    "startTime",
    "endTime",
    "title",
    "notes",
    "sortOrder",
    "version",
    "publication",
  ]) {
    assert.ok(!body.includes(leaked), `RIDING_SLOT_INCLUDE must not select ${leaked}`);
  }
});

test("toRidingSlotRow maps relation presence, never content", () => {
  const src = readCode(RIDING_SLOTS);
  // Boundary is the NEXT top-level declaration, not the first "\n}" - the
  // parameter object's own closing brace sits at column 0 and would cut the
  // body away before it starts.
  const fn = src.slice(
    src.indexOf("function toRidingSlotRow("),
    src.indexOf("const RIDING_SLOT_INCLUDE = {"),
  );
  const body = flat(fn);
  // Mode is still derived from PRESENCE, not from the plan's content - the
  // widened select must never have turned this into "has blocks" or similar.
  assert.ok(body.includes("hasComplexPlan: slot.complexPlan != null"));
  assert.ok(body.includes("hasHorseList: slot.horseList != null"));
  // The parameter type accepts them as optional so a narrower future select
  // degrades to `false` rather than failing to compile. Since
  // RIDING-MINE-COMPLEX the complexPlan parameter additionally accepts an
  // optional blocks -> stations -> instructorId shape, and nothing else.
  assert.ok(
    body.includes(
      "complexPlan?: { id: string; blocks?: { stations: { instructorId: string | null }[] }[] } | null",
    ),
  );
  assert.ok(body.includes("horseList?: { id: string } | null"));
});

// ---------------------------------------------------------------------------
// 10-11. Client behaviour
// ---------------------------------------------------------------------------

test("neither instructor component performs load-time per-slot mode detection", () => {
  const client = readCode(INSTRUCTOR_CLIENT);
  const section = readCode(RIDING_SECTION);

  // InstructorClient's own detection helper is gone entirely, along with both
  // editing-reader imports it existed to call.
  assert.ok(!client.includes("detectScheduleRidingSlotMode"), "the helper is removed");
  assert.ok(!client.includes("getRidingSlotComplexPlanForInstructor"), "reader no longer imported");
  assert.ok(!client.includes("getRidingSlotHorseListForInstructor"), "reader no longer imported");
  assert.ok(client.includes("buildRidingSlotModeMap"), "it seeds from the payload instead");

  // The riding section keeps the helper for refreshModeFor, but no longer calls
  // it from a loop over the loaded days. The seeding effect is delimited by the
  // `days` dependency array that closes it and by refreshModeFor after it.
  const seeding = section.slice(
    section.indexOf("useEffect(() => {", section.indexOf("const slots = (days ?? [])") - 400),
    section.indexOf("function refreshModeFor("),
  );
  assert.ok(seeding.includes("buildRidingSlotModeMap"), "the seeding effect must exist");
  assert.ok(
    !seeding.includes("detectInstructorRidingSlotMode"),
    "the load-time path must not call the per-slot detector",
  );
  assert.ok(!/for \(const ridingSlotId of/.test(seeding), "the per-slot loop is gone");
  assert.ok(!/\.then\(/.test(seeding), "seeding is synchronous - no per-slot request remains");
});

test("both components still MERGE into the shared map rather than replacing it", () => {
  for (const [name, path] of [
    ["InstructorClient", INSTRUCTOR_CLIENT],
    ["InstructorRidingSlotsSection", RIDING_SECTION],
  ] as const) {
    const code = flat(readCode(path));
    assert.ok(
      code.includes("setModeByRidingSlotId((prev) => ({ ...prev, ...buildRidingSlotModeMap("),
      `${name} must merge into the previous map so a refreshed mode survives`,
    );
  }
});

test("refreshModeFor still performs the user-initiated refresh, with its error path", () => {
  const section = readCode(RIDING_SECTION);
  const raw = readSource(RIDING_SECTION);
  const fn = flat(
    section.slice(section.indexOf("function refreshModeFor("), section.indexOf("function refreshModeFor(") + 500),
  );
  assert.ok(fn.includes("detectInstructorRidingSlotMode(ridingSlotId)"), "still re-reads");
  assert.ok(fn.includes('[ridingSlotId]: "error"'), "keeps its error outcome");
  assert.ok(
    section.includes("async function detectInstructorRidingSlotMode("),
    "the reader helper it depends on must be preserved",
  );
  assert.ok(
    section.includes("getRidingSlotComplexPlanForInstructor") &&
      section.includes("getRidingSlotHorseListForInstructor"),
    "both underlying readers stay imported for the refresh path",
  );
  // It is still reachable from the UI, not merely defined.
  assert.ok(raw.includes("refreshModeFor("), "refreshModeFor must still be called");
});

// ---------------------------------------------------------------------------
// 12-15. Gates, endpoints, blast radius
// ---------------------------------------------------------------------------

test("getInstructorRidingSlots keeps its session-derived instructor gate", () => {
  const src = readCode(RIDING_SLOTS);
  const fn = src.slice(src.indexOf("export async function getInstructorRidingSlots("));
  assert.ok(fn.includes("loadInstructorRidingSlotsWithDeps"), "still delegates to the auth boundary");
  assert.ok(fn.includes("getCurrentInstructor"), "still passes the server-derived actor resolver");
});

test("admin riding readers keep requireAdmin()", () => {
  const src = readCode(RIDING_SLOTS);
  for (const name of ["getRidingSlotForScheduleItem", "getWeeklyRidingOverview"]) {
    const fn = src.slice(src.indexOf(`export async function ${name}(`));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.ok(body.includes("await requireAdmin();"), `${name} must keep its admin gate`);
  }
});

test("buildActivitiesForDay still has no gate of its own", () => {
  const src = readCode(RIDING_SLOTS);
  const start = src.indexOf("async function buildActivitiesForDay");
  const end = src.indexOf("export async function getWeeklyRidingOverview");
  const body = src.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.ok(!body.includes("requireAdmin") && !body.includes("getCurrentInstructor"));
});

test("no new Server Action was created", () => {
  const core = readCode(MODE_CORE);
  assert.ok(!core.includes('"use server"'), "the mode core mints no endpoint");
  assert.ok(!/export\s+async\s+function/.test(core), "the mode core exports nothing async");

  // riding-slots.ts's exported async surface is unchanged - same 16 actions.
  const exported = Array.from(
    readCode(RIDING_SLOTS).matchAll(/export async function (\w+)/g),
    (m) => m[1],
  ).sort();
  assert.deepEqual(exported, [
    "bulkApplyRidingAssignment",
    "bulkSetRidingVisibility",
    "createOrGetRidingSlot",
    "deleteRidingSlotAssignment",
    "getInstructorRidingSlots",
    "getKnownRidingHorseNames",
    "getKnownRidingLessonTopics",
    "getRidingSlotForScheduleItem",
    "getRidingSlotStudentNotes",
    "getStudentRidingHistoryForAdmin",
    "getStudentRidingHistoryForInstructor",
    "getStudentRidingHistoryForInstructorTraineeProgress",
    "getWeeklyRidingOverview",
    "updateRidingSlotVisibility",
    "upsertRidingLessonNoteAsInstructor",
    "upsertRidingSlotAssignment",
  ]);
});

test("the mode core is pure and reaches no forbidden area", () => {
  // readCode strips comments, so the module's own documentation - which
  // legitimately discusses Prisma, "use server" and the readers - is not flagged.
  const code = readCode(MODE_CORE);
  for (const forbidden of [
    '"use server"',
    "@/lib/prisma",
    "prisma.",
    "next/",
    "@/lib/auth",
    "@/app/student",
    "@/app/admin",
    "react",
  ]) {
    assert.ok(!code.includes(forbidden), `the mode core must not reference ${forbidden}`);
  }
  assert.ok(!/^\s*import\s/m.test(code), "the mode core imports nothing at all");
});
