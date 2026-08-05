/**
 * RIDING-MINE-COMPLEX - behavioural tests for the pure riding ownership rule
 * (lib/actions/riding-slot-assignment-scope-core.ts), plus source-level contract
 * assertions on the reader and the client component that consume it.
 *
 * THE BUG THIS LOCKS SHUT: an instructor who coaches a station inside a complex
 * riding plan saw their own rides only under "כל הרכיבות". "הרכיבות שלי" was
 * empty and no "משובץ/ת אליי" badge appeared, because ownership recognised only
 * regular RidingSlotAssignment rows - and a complex ride commonly has none.
 *
 * The core is pure, so the rule itself is exercised with plain fixtures - no
 * Next.js cookies, no live Prisma, no database. riding-slots.ts ("use server")
 * and the instructor client component cannot be imported here, so the properties
 * that must hold in them are asserted against their source, the same convention
 * riding-slot-mode-core.test.ts and riding-slots-batch-resolve.test.ts already
 * follow.
 *
 * What is locked here:
 *  - both ownership sources count, additively, and neither replaces the other;
 *  - matching is exact equality on authoritative Instructor.id values, never on
 *    instructorName / fullName / any display text;
 *  - every degenerate input (no slot, no activity, blank id, blank station id)
 *    fails closed to false;
 *  - collectComplexStationInstructorIds flattens, trims, drops blanks, dedupes
 *    and sorts deterministically;
 *  - RIDING_SLOT_INCLUDE selects complexPlan.id plus blocks -> stations ->
 *    instructorId AND NOTHING ELSE - no pairs, trainees, horses, arena, station
 *    times, titles, notes, sortOrder, version or publication data;
 *  - the DTO field is required (never optional) and the mapper delegates to the
 *    collector;
 *  - the component holds no local ownership helper and uses the one shared
 *    predicate for BOTH the filter and the badge;
 *  - no trainee/student reader was touched.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slot-assignment-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  collectComplexStationInstructorIds,
  isRidingActivityAssignedToInstructor,
} from "./riding-slot-assignment-scope-core";

/** Raw file text, with line endings normalised (this repo mixes LF and CRLF). */
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/**
 * File text with COMMENTS STRIPPED - these modules document themselves
 * exhaustively (the scope core's own header names instructorName and fullName
 * precisely to explain that it never reads them), so a raw substring scan would
 * flag the documentation instead of the code it describes.
 */
const readCode = (relativePath: string): string =>
  readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/** Collapse whitespace so an assertion cannot depend on wrapping or indentation. */
const flat = (source: string): string => source.replace(/\s+/g, " ");

const SCOPE_CORE = "./riding-slot-assignment-scope-core.ts";
const RIDING_SLOTS = "./riding-slots.ts";
const RIDING_SECTION = "../../app/instructor/InstructorRidingSlotsSection.tsx";
const STUDENT_SCHEDULE = "./student-schedule.ts";

const ME = "instructor-me";
const SOMEONE_ELSE = "instructor-other";

/** A regular assignment split as the reader produces it (instructorIds already folded). */
const assignment = (...instructorIds: (string | null)[]) => ({ instructorIds });

/** A displayed activity carrying a riding slot with the two ownership sources. */
const activityWith = (slot: {
  assignments?: { instructorIds: (string | null)[] }[];
  complexStationInstructorIds?: (string | null)[];
}) => ({
  ridingSlot: {
    assignments: slot.assignments ?? [],
    complexStationInstructorIds: slot.complexStationInstructorIds ?? [],
  },
});

// ---------------------------------------------------------------------------
// 1-2. The bug itself: a complex-station coach owns the ride
// ---------------------------------------------------------------------------

test("1. complex ride with ZERO regular assignments - a station coach owns it", () => {
  // This is exactly the reported production shape: rides shown under
  // "כל הרכיבות", no "מדריך/ה" line on the card at all, empty "הרכיבות שלי".
  const activity = activityWith({ assignments: [], complexStationInstructorIds: [ME] });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), true);
});

test("2. a regular assignment naming SOMEONE ELSE does not cancel station ownership", () => {
  const activity = activityWith({
    assignments: [assignment(SOMEONE_ELSE)],
    complexStationInstructorIds: [ME],
  });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), true);
  // ...and the other instructor still owns it too. The sources are additive, so
  // one ride can legitimately be "mine" for several people at once.
  assert.equal(isRidingActivityAssignedToInstructor(activity, SOMEONE_ELSE), true);
});

// ---------------------------------------------------------------------------
// 3-5. The regular assignment source still works, unchanged
// ---------------------------------------------------------------------------

test("3. a regular join-table instructor match still owns the ride", () => {
  const activity = activityWith({ assignments: [assignment(ME)] });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), true);
});

test("4. the legacy scalar instructorId is honoured through getAssignmentInstructors", () => {
  // The reader folds RidingSlotAssignment.instructorId into instructorIds[0]
  // (see getAssignmentInstructors / toAssignmentRow), so a legacy-only
  // assignment reaches this predicate as a one-element list. That is why the
  // predicate needs no separate legacy branch - and this test is what keeps the
  // folding contract visible from here.
  const legacyOnly = activityWith({ assignments: [assignment(ME)] });
  assert.equal(isRidingActivityAssignedToInstructor(legacyOnly, ME), true);

  const src = readCode(RIDING_SLOTS);
  const fn = flat(src.slice(src.indexOf("function toAssignmentRow("), src.indexOf("const ASSIGNMENT_WITH_INSTRUCTORS_INCLUDE")));
  assert.ok(fn.includes("const instructors = getAssignmentInstructors(a)"), "still folds via the shared helper");
  assert.ok(fn.includes("instructorIds: instructors.map((i) => i.id)"), "instructorIds is the folded list");
});

test("5. a CO-instructor who is not first in instructorIds still owns the ride", () => {
  const activity = activityWith({ assignments: [assignment(SOMEONE_ELSE, "someone-third", ME)] });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), true);
});

// ---------------------------------------------------------------------------
// 6-11. Negative and degenerate cases - all fail closed
// ---------------------------------------------------------------------------

test("6. an instructor in NEITHER source does not own the ride", () => {
  const activity = activityWith({
    assignments: [assignment(SOMEONE_ELSE)],
    complexStationInstructorIds: ["instructor-third"],
  });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), false);
});

test("7. null / undefined / blank station instructor ids are ignored safely", () => {
  const noisy = activityWith({
    complexStationInstructorIds: [null, "", "   ", SOMEONE_ELSE],
  });
  assert.equal(isRidingActivityAssignedToInstructor(noisy, ME), false);
  // A blank current id must not be able to "match" a blank station id.
  assert.equal(isRidingActivityAssignedToInstructor(noisy, "   "), false);
  // The good id in the same list still matches.
  assert.equal(isRidingActivityAssignedToInstructor(noisy, SOMEONE_ELSE), true);
  // Same tolerance on the regular side.
  assert.equal(
    isRidingActivityAssignedToInstructor(activityWith({ assignments: [assignment(null, "")] }), ME),
    false,
  );
});

test("8. the same instructor in BOTH sources is true, once, without double counting", () => {
  const activity = activityWith({
    assignments: [assignment(ME)],
    complexStationInstructorIds: [ME],
  });
  assert.equal(isRidingActivityAssignedToInstructor(activity, ME), true);
});

test("9. an activity whose ridingSlot is null is never owned", () => {
  assert.equal(isRidingActivityAssignedToInstructor({ ridingSlot: null }, ME), false);
  assert.equal(isRidingActivityAssignedToInstructor({}, ME), false);
});

test("10. a null / undefined activity is never owned", () => {
  assert.equal(isRidingActivityAssignedToInstructor(null, ME), false);
  assert.equal(isRidingActivityAssignedToInstructor(undefined, ME), false);
});

test("11. a null / undefined / blank current instructor id never owns anything", () => {
  const activity = activityWith({
    assignments: [assignment(ME)],
    complexStationInstructorIds: [ME],
  });
  assert.equal(isRidingActivityAssignedToInstructor(activity, null), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, undefined), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, ""), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, "   "), false);
});

// ---------------------------------------------------------------------------
// 12. Ids only - never display text
// ---------------------------------------------------------------------------

test("12. matching never uses instructorName, fullName or any display text", () => {
  // A slot whose ONLY reference to this person is by name must not be owned.
  const byNameOnly = {
    ridingSlot: {
      assignments: [
        { instructorIds: [SOMEONE_ELSE], instructorId: SOMEONE_ELSE, instructorName: "סער בן חמו" },
      ],
      complexStationInstructorIds: [],
      instructors: [{ id: SOMEONE_ELSE, fullName: "סער בן חמו" }],
    },
  };
  assert.equal(isRidingActivityAssignedToInstructor(byNameOnly, "סער בן חמו"), false);

  // No fuzzy/substring/case-folded id matching either: only exact equality.
  const activity = activityWith({ complexStationInstructorIds: ["Instructor-Me"] });
  assert.equal(isRidingActivityAssignedToInstructor(activity, "instructor-me"), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, "Instructor-M"), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, "Instructor-Mee"), false);
  assert.equal(isRidingActivityAssignedToInstructor(activity, "Instructor-Me"), true);

  // Surrounding whitespace on either side is trimmed, and only trimmed.
  assert.equal(
    isRidingActivityAssignedToInstructor(
      activityWith({ complexStationInstructorIds: [`  ${ME}  `] }),
      ` ${ME} `,
    ),
    true,
  );

  // And the rule's source reads no display field at all.
  const core = readCode(SCOPE_CORE);
  for (const forbidden of ["instructorName", "fullName", "toLowerCase", "toUpperCase", "localeCompare", "includes("]) {
    assert.ok(!core.includes(forbidden), `the ownership rule must not use ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 13. The collector
// ---------------------------------------------------------------------------

test("13. collectComplexStationInstructorIds flattens, trims, drops blanks, dedupes and sorts", () => {
  const ids = collectComplexStationInstructorIds([
    { stations: [{ instructorId: "c-zeta" }, { instructorId: "  c-alpha  " }] },
    { stations: [{ instructorId: "c-zeta" }, { instructorId: null }, { instructorId: "" }] },
    { stations: [{ instructorId: "   " }, { instructorId: undefined }, { instructorId: "c-mid" }] },
  ]);
  assert.deepEqual(ids, ["c-alpha", "c-mid", "c-zeta"]);
});

test("13b. the collector is deterministic regardless of block/station ordering", () => {
  const a = collectComplexStationInstructorIds([
    { stations: [{ instructorId: "b" }] },
    { stations: [{ instructorId: "a" }, { instructorId: "c" }] },
  ]);
  const b = collectComplexStationInstructorIds([
    { stations: [{ instructorId: "c" }, { instructorId: "a" }] },
    { stations: [{ instructorId: "b" }] },
  ]);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["a", "b", "c"]);
});

test("13c. empty / null / undefined input yields [], never a throw", () => {
  assert.deepEqual(collectComplexStationInstructorIds([]), []);
  assert.deepEqual(collectComplexStationInstructorIds(null), []);
  assert.deepEqual(collectComplexStationInstructorIds(undefined), []);
  assert.deepEqual(collectComplexStationInstructorIds([{ stations: [] }, { stations: null }, {}]), []);
});

test("13d. the collector never mutates its input", () => {
  const blocks = [
    { stations: [{ instructorId: "  z  " }, { instructorId: null }] },
    { stations: [{ instructorId: "a" }] },
  ];
  const snapshot = JSON.parse(JSON.stringify(blocks));
  const ids = collectComplexStationInstructorIds(blocks);
  assert.deepEqual(JSON.parse(JSON.stringify(blocks)), snapshot, "input must be untouched");
  assert.deepEqual(ids, ["a", "z"]);
});

test("13e. the scope core is pure and reaches no forbidden area", () => {
  const core = readCode(SCOPE_CORE);
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
    assert.ok(!core.includes(forbidden), `the scope core must not reference ${forbidden}`);
  }
  assert.ok(!/^\s*import\s/m.test(core), "the scope core imports nothing at all");
  assert.ok(!/export\s+async\s+function/.test(core), "the scope core exports nothing async");
});

// ---------------------------------------------------------------------------
// 14-15. The Prisma select boundary
// ---------------------------------------------------------------------------

/** The RIDING_SLOT_INCLUDE literal, comment-stripped and whitespace-collapsed. */
function ridingSlotIncludeBody(): string {
  const src = readCode(RIDING_SLOTS);
  const include = src.slice(src.indexOf("const RIDING_SLOT_INCLUDE = {"));
  return flat(include.slice(0, include.indexOf("\n};")));
}

test("14. RIDING_SLOT_INCLUDE selects complexPlan.id and blocks -> stations -> instructorId", () => {
  const body = ridingSlotIncludeBody();
  assert.ok(body.includes("complexPlan: { select: { id: true,"), "the presence `id` is preserved");
  assert.ok(
    body.includes("blocks: { select: { stations: { select: { instructorId: true } } } }"),
    "the traversal must reach instructorId and stop there",
  );
});

test("15. RIDING_SLOT_INCLUDE selects NO trainee, pair, horse or station content", () => {
  const body = ridingSlotIncludeBody();
  for (const leaked of [
    "pairs",
    "trainee1Id",
    "trainee2Id",
    "traineeId",
    "student",
    "horseName",
    "privateHorseName",
    "arena",
    "startTime",
    "endTime",
    "title",
    "notes",
    "sortOrder",
    "version",
    "publication",
    "updatedBy",
    "createdAt",
    "updatedAt",
  ]) {
    assert.ok(!body.includes(leaked), `RIDING_SLOT_INCLUDE must not select ${leaked}`);
  }
  // `instructorId` is the ONLY station column selected - assert the traversal
  // reaches exactly one leaf, so a future edit cannot quietly add a sibling.
  const stationSelect = body.slice(body.indexOf("stations: { select: {"));
  assert.equal(
    (stationSelect.slice(0, stationSelect.indexOf("} }")).match(/: true/g) ?? []).length,
    1,
    "exactly one station column may be selected",
  );
});

// ---------------------------------------------------------------------------
// 16. The client component
// ---------------------------------------------------------------------------

test("16. the component imports the shared predicate and has no local ownership helper", () => {
  const section = readCode(RIDING_SECTION);
  assert.ok(
    section.includes(
      'import { isRidingActivityAssignedToInstructor } from "@/lib/actions/riding-slot-assignment-scope-core"',
    ),
    "the shared predicate must be imported from the pure core",
  );
  assert.ok(
    !/\bisAssignedToInstructor\b/.test(section),
    "the local isAssignedToInstructor helper must be gone entirely",
  );
  // No second, divergent rule may be reintroduced inside the component either.
  assert.ok(
    !/assignments\??\.some\(/.test(section),
    "ownership must not be re-derived inline from assignments",
  );
});

test("16b. ONE predicate powers BOTH the filter and the badge", () => {
  const section = readCode(RIDING_SECTION);
  const flatSection = flat(section);

  // The "כל הרכיבות" short-circuit is unchanged, and the predicate is what the
  // "הרכיבות שלי" branch falls through to.
  assert.ok(
    flatSection.includes(
      '(a) => scopeMode === "all" || isRidingActivityAssignedToInstructor(a, instructorId)',
    ),
    "the scope filter must short-circuit on `all` and otherwise use the shared predicate",
  );
  // The "משובץ/ת אליי" badge is computed from the very same call.
  assert.ok(
    flatSection.includes(
      "const assignedToMe = isRidingActivityAssignedToInstructor(activity, instructorId);",
    ),
    "the badge must use the shared predicate",
  );
  assert.ok(readSource(RIDING_SECTION).includes("משובץ/ת אליי"), "the badge itself still renders");

  // Exactly two call sites plus the single import - no third, drifting copy.
  assert.equal(
    (section.match(/isRidingActivityAssignedToInstructor/g) ?? []).length,
    3,
    "one import + exactly two call sites (filter and badge)",
  );
});

// ---------------------------------------------------------------------------
// 17. The DTO and the mapper
// ---------------------------------------------------------------------------

test("17. RidingSlotRow declares complexStationInstructorIds as a REQUIRED string[]", () => {
  const src = readCode(RIDING_SLOTS);
  const row = src.slice(src.indexOf("export interface RidingSlotRow"));
  const body = row.slice(0, row.indexOf("}"));
  assert.ok(body.includes("complexStationInstructorIds: string[];"), "the field must exist");
  assert.ok(
    !body.includes("complexStationInstructorIds?:"),
    "it must never be optional - `[]` is the no-plan/no-coach value",
  );
});

test("17b. toRidingSlotRow delegates to the collector, so the array is deduped and deterministic", () => {
  const src = readCode(RIDING_SLOTS);
  const fn = flat(
    src.slice(src.indexOf("function toRidingSlotRow("), src.indexOf("const RIDING_SLOT_INCLUDE = {")),
  );
  assert.ok(
    fn.includes(
      "complexStationInstructorIds: collectComplexStationInstructorIds(slot.complexPlan?.blocks)",
    ),
    "the mapper must delegate the trim/blank-drop/dedupe/sort rule to the pure core",
  );
  assert.ok(
    readCode(RIDING_SLOTS).includes(
      'import { collectComplexStationInstructorIds } from "@/lib/actions/riding-slot-assignment-scope-core"',
    ),
    "imported from the pure core rather than re-implemented",
  );

  // And that rule, exercised directly on a realistic multi-block plan, produces
  // the deduplicated deterministic array the DTO promises.
  assert.deepEqual(
    collectComplexStationInstructorIds([
      { stations: [{ instructorId: SOMEONE_ELSE }, { instructorId: ME }] },
      { stations: [{ instructorId: ME }, { instructorId: null }] },
    ]),
    [ME, SOMEONE_ELSE].sort(),
  );
});

// ---------------------------------------------------------------------------
// 18. Blast radius
// ---------------------------------------------------------------------------

test("18. no trainee/student reader was changed by this fix", () => {
  // The trainee-facing schedule reader keeps its own PRESENCE-ONLY complexPlan
  // select - the widening is confined to the instructor/admin include.
  const studentSchedule = readCode(STUDENT_SCHEDULE);
  assert.ok(
    studentSchedule.includes("complexPlan: { select: { id: true } }"),
    "the trainee schedule reader must still select complex-plan presence only",
  );
  assert.ok(
    !studentSchedule.includes("riding-slot-assignment-scope-core"),
    "no trainee reader imports the ownership core",
  );
  assert.ok(
    !studentSchedule.includes("complexStationInstructorIds"),
    "no station coach id is exposed to a trainee payload",
  );

  // The per-slot student-notes reader is untouched: same complex-plan trainee
  // collector, same roster query shape.
  const src = readCode(RIDING_SLOTS);
  assert.ok(src.includes("function collectComplexPlanTraineeIds("), "still present");
  assert.ok(
    src.includes("const complexTraineeIds = collectComplexPlanTraineeIds(complexPlan)"),
    "buildRidingSlotStudentNotes still derives its roster union exactly as before",
  );
});

test("18b. the exported Server Action surface of riding-slots.ts is unchanged plus RS-SEC-1ADMIN-CAND's new admin-audience reader", () => {
  // RS-SEC-1ADMIN-CAND added exactly one new export: getRidingSlotStudentNotesForAdmin,
  // the requireAdmin()-gated admin-audience twin of getRidingSlotStudentNotes
  // (fixes the admin/instructor candidate-audience mismatch - see that
  // function's own comment in riding-slots.ts).
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
    "getRidingSlotStudentNotesForAdmin",
    "getStudentRidingHistoryForAdmin",
    "getStudentRidingHistoryForInstructor",
    "getStudentRidingHistoryForInstructorTraineeProgress",
    "getWeeklyRidingOverview",
    "updateRidingSlotVisibility",
    "upsertRidingLessonNoteAsInstructor",
    "upsertRidingSlotAssignment",
  ]);
});

test("18c. the instructor riding read keeps its session-derived gate", () => {
  const src = readCode(RIDING_SLOTS);
  const fn = src.slice(src.indexOf("export async function getInstructorRidingSlots("));
  assert.ok(fn.includes("loadInstructorRidingSlotsWithDeps"), "still delegates to the auth boundary");
  assert.ok(fn.includes("getCurrentInstructor"), "still passes the server-derived actor resolver");
});
