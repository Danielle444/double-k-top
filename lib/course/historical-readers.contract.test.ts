/**
 * Non-DB CONTRACT (source-scan) tests locking the W6D3-HOTFIX wiring: every
 * historical group/horse reader must resolve via loadHistoricalTraineeState keyed
 * by the record's OWN date and must NOT read the current Student mirror for the
 * historical value. Mirrors the source-scan pattern already used by
 * group-change-service.contract.test.ts. No Prisma, no DB. Run with:
 *   npx tsx --test lib/course/historical-readers.contract.test.ts
 *
 * The as-of-date SEMANTICS (before→א1, on/after→ב5, half-open boundary, missing→
 * unknown, no mirror fallback) are proven in historical-trainee-state-core.test.ts;
 * these tests prove each reader feeds the correct date into that resolver.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const COMPLETION = read("app/admin/completion/page.tsx");
const SCHEDULE_PAGE = read("app/admin/schedule/page.tsx");
const SCHEDULE_CLIENT = read("app/admin/schedule/ScheduleClient.tsx");
const EXPORT = read("lib/exports/schedule-export.ts");
const DIAGNOSTICS = read("lib/schedule-diagnostics.ts");
const FAIRNESS = read("lib/schedule-fairness.ts");
const WEEKLY = read("lib/actions/weekly-feedback.ts");
const INSTRUCTOR_DUTIES = read("lib/actions/instructor-schedule.ts");
const RIDING = read("lib/actions/riding-slots.ts");

function usesHelper(src: string): boolean {
  return /loadHistoricalTraineeState/.test(src);
}

// --- A: duty readers resolve group by the duty's own date ---

test("3. completion resolves group at the duty date, not the current mirror", () => {
  assert.ok(usesHelper(COMPLETION));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(COMPLETION), "keyed by a.date");
  assert.ok(!/groupName:\s*a\.student\.groupName/.test(COMPLETION), "no current-mirror group output");
});

test("1/2. admin schedule resolves per-assignment group at the duty date", () => {
  assert.ok(usesHelper(SCHEDULE_PAGE));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(SCHEDULE_PAGE), "keyed by a.date");
  // Client renders/filters the per-assignment historical group, not studentById.
  assert.ok(/a\.groupName \?\? "-"/.test(SCHEDULE_CLIENT), "display uses per-assignment group");
  assert.ok(
    /filterGroup && a\.groupName !== filterGroup/.test(SCHEDULE_CLIENT),
    "filter uses per-assignment group",
  );
  assert.ok(
    !/studentById\.get\(a\.studentId\)\?\.groupName/.test(SCHEDULE_CLIENT),
    "no current-mirror group lookup remains for display/filter",
  );
});

test("4. day export resolves at the export date; grid export resolves at endDate", () => {
  assert.ok(usesHelper(EXPORT));
  assert.ok(/groupAt\(a\.studentId,\s*date\)/.test(EXPORT), "day export keyed by the export date");
  assert.ok(/groupAt\(s\.id,\s*endDate\)/.test(EXPORT), "grid export keyed by endDate");
  assert.ok(!/groupName:\s*a\.student\.groupName/.test(EXPORT), "no current-mirror group output");
});

test("6. diagnostics buckets each assignment's subgroup at the duty date", () => {
  assert.ok(usesHelper(DIAGNOSTICS));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(DIAGNOSTICS), "keyed by a.date");
  assert.ok(
    !/subgroupKey\(a\.student\.groupName/.test(DIAGNOSTICS),
    "no current-mirror subgroup bucketing",
  );
});

test("7. fairness resolves each student's group at the report endDate", () => {
  assert.ok(usesHelper(FAIRNESS));
  assert.ok(/groupAt\(s\.id,\s*endDate\)/.test(FAIRNESS), "keyed by endDate");
});

// --- B: weekly feedback resolves by the feedback week ---

test("8/9. weekly feedback resolves group at the feedback week's startDate", () => {
  assert.ok(usesHelper(WEEKLY));
  assert.ok(/weekStart = form\.weeklySchedule\.startDate/.test(WEEKLY), "week start selected");
  assert.ok(/groupAt\(r\.studentId,\s*weekStart\)/.test(WEEKLY), "submitted keyed by week start");
  // L2-F1B renamed the not-submitted source from the global active-student rows
  // (`s`) to the form's own course roster members (`member`). The historical
  // contract is unchanged: whoever is listed is still keyed at the week start.
  assert.ok(/groupAt\(member\.id,\s*weekStart\)/.test(WEEKLY), "not-submitted keyed by week start");
  assert.ok(!/groupName:\s*r\.student\.groupName/.test(WEEKLY), "no current-mirror group output");
});

// --- G: already-shipped readers not regressed ---

test("already-fixed readers still resolve historically (not regressed)", () => {
  assert.ok(usesHelper(INSTRUCTOR_DUTIES));
  assert.ok(/groupAt\(a\.studentId,\s*a\.date\)/.test(INSTRUCTOR_DUTIES), "instructor duties keyed by a.date");
  assert.ok(usesHelper(RIDING));
  // L2-RH1: riding history is still keyed by the LESSON's own date; the group
  // lookup now additionally carries that lesson's own offering (see section L2-RH1).
  assert.ok(
    /groupAt\(\s*studentId,\s*first\.date,\s*first\.weeklySchedule\.courseOfferingId\s*\)/.test(RIDING),
    "riding history group keyed by lesson date + the lesson's own offering",
  );
  assert.ok(/horseAt\(studentId,\s*first\.date\)/.test(RIDING), "riding history horse keyed by lesson date");
});

// --- L2-RH1: riding history resolves group by the LESSON'S OWN CourseOffering ---
//
// A RidingLessonNote may belong to a Level 1 OR a Level 2 riding slot. The
// per-offering SEMANTICS (ignore other offerings, fail closed on zero/multiple/
// null offering, no Student-mirror fallback) are proven in
// historical-trainee-state-offering-core.test.ts; these tests prove the reader
// feeds the correct OFFERING - and only the correct offering - into that resolver,
// and that the pre-existing loader and its other call sites are untouched.

const LOADER = read("lib/course/historical-trainee-state.ts");

/** The production call sites of the pre-existing zero-argument loader. */
const UNCHANGED_CALL_SITES: [string, string][] = [
  ["app/admin/completion/page.tsx", COMPLETION],
  ["app/admin/schedule/page.tsx", SCHEDULE_PAGE],
  ["lib/actions/instructor-schedule.ts", INSTRUCTOR_DUTIES],
  ["lib/actions/weekly-feedback.ts", WEEKLY],
  ["lib/exports/schedule-export.ts", EXPORT],
  ["lib/schedule-diagnostics.ts", DIAGNOSTICS],
  ["lib/schedule-fairness.ts", FAIRNESS],
];

test("9. loadHistoricalTraineeState keeps its exact signature and singleton behaviour", () => {
  assert.ok(
    /export async function loadHistoricalTraineeState\(\s*studentIds: readonly string\[\],\s*\): Promise<HistoricalTraineeStateResolver>/.test(
      LOADER,
    ),
    "the pre-existing loader's signature is unchanged (one arg, same return type)",
  );
  const start = LOADER.indexOf("export async function loadHistoricalTraineeState(");
  const end = LOADER.indexOf("export async function loadHistoricalTraineeStateForOfferings");
  assert.ok(end > start, "the new loader is ADDITIVE, declared after the existing one");
  assert.ok(
    /resolveCurrentCourseOffering\(\)/.test(LOADER.slice(start, end)),
    "the pre-existing loader still resolves through the singleton current offering",
  );
  assert.ok(
    /groupAt\(studentId, date\)/.test(LOADER.slice(start, end)),
    "the pre-existing resolver still exposes a two-argument groupAt",
  );
});

test("10. every other production call site of the existing loader is unchanged", () => {
  for (const [name, src] of UNCHANGED_CALL_SITES) {
    assert.ok(
      /loadHistoricalTraineeState\(/.test(src),
      `${name} still calls the pre-existing zero-argument loader`,
    );
    assert.ok(
      !/loadHistoricalTraineeStateForOfferings/.test(src),
      `${name} must NOT be rewired to the offering-aware loader in this slice`,
    );
    assert.ok(
      !/groupAt\([^)]*,[^)]*,[^)]*\)/.test(src),
      `${name} must still use the two-argument groupAt`,
    );
  }
});

test("11. riding history takes courseOfferingId ONLY from the lesson's weekly schedule", () => {
  // R1-RIDING-HISTORY-COURSE widened this same weeklySchedule select with the
  // joined CourseOffering (id/name/level) for the row's course badge, which
  // reformatted it across several lines. The assertion is therefore anchored on
  // the AUTHORITATIVE CHAIN (linked scheduleItem -> weeklySchedule select ->
  // courseOfferingId) rather than on the old single-line literal; the intent -
  // courseOfferingId comes only from the lesson's own week - is unchanged, and the
  // additional course-identity wiring has its own contract test in
  // lib/actions/riding-history-course-identity.contract.test.ts.
  assert.ok(
    /scheduleItem: \{\s*include: \{\s*weeklySchedule: \{\s*select: \{\s*courseOfferingId: true,?/.test(
      RIDING,
    ),
    "the existing linked-ScheduleItem include is extended with weeklySchedule.courseOfferingId",
  );
  assert.ok(
    /loadHistoricalTraineeStateForOfferings\(/.test(RIDING),
    "riding history uses the offering-aware loader",
  );
  // The offering ids handed to the loader come from the already-fetched notes.
  assert.ok(
    /notes\.flatMap\(\(n\) =>[\s\S]{0,240}?link\.scheduleItem\.weeklySchedule\.courseOfferingId\s*\)/.test(
      RIDING,
    ),
    "offering ids are collected in memory from the notes already read",
  );
  // Forbidden derivations: none of these may appear anywhere in the reader.
  assert.ok(!/resolveCurrentCourseOffering/.test(RIDING), "no singleton current-offering resolver");
  assert.ok(
    !/temporary-level2-compatibility|LEVEL_1_COURSE_OFFERING_ID|LEVEL_2_COURSE_OFFERING_ID/.test(RIDING),
    "no temporary Level 2 compatibility helper and no hardcoded offering id",
  );
  assert.ok(
    !/resolveTraineeSelectedCourseOffering|getCurrentCourseOffering|selectedCourseOfferingId/.test(RIDING),
    "the offering is never taken from a session or a selected course",
  );
});

test("11. no N+1: the history reader adds no per-row query", () => {
  const start = RIDING.indexOf("async function buildStudentRidingHistory");
  const end = RIDING.indexOf("export async function getStudentRidingHistoryForAdmin");
  assert.ok(start > 0 && end > start, "the history builder body is locatable");
  const body = RIDING.slice(start, end);
  // Exactly the two pre-existing awaits (student, notes) plus the one batched
  // historical load - and nothing inside the row loop.
  const awaits = body.match(/await /g) ?? [];
  assert.equal(awaits.length, 3, "exactly three awaits in the whole builder");
  const loopStart = body.indexOf("for (const n of notes)");
  assert.ok(loopStart > 0, "the per-row loop is locatable");
  assert.ok(!/await /.test(body.slice(loopStart)), "no await inside the per-row loop");
});

test("13. the Level 1 riding-history row payload is unchanged", () => {
  const start = RIDING.indexOf("rows.push({");
  assert.ok(start > 0, "the history row builder is locatable");
  const body = RIDING.slice(start, RIDING.indexOf("});", start));
  for (const field of [
    "ridingSlotId",
    "dateKey",
    "startTime",
    "endTime",
    "title",
    "groupName",
    "subgroupNumber",
    "instructorName",
    "arena",
    "horseDisplay",
    "ratingHalfPoints",
    "note",
    "lessonTopic",
    "taughtStudents",
    "updatedByName",
    "updatedAt",
  ]) {
    // `horseDisplay` is emitted as an ES shorthand property, so accept both forms.
    assert.ok(
      new RegExp(`\\b${field}\\s*[:,]`).test(body),
      `history row still emits ${field}`,
    );
  }
  // The historical group still drives the row + the assignment match, and the
  // current-profile header is still the current mirror by design.
  assert.ok(/groupName: histGroupName/.test(body), "row group is the historical value");
  assert.ok(/subgroupNumber: histSubgroupNumber/.test(body), "row subgroup is the historical value");
  assert.ok(
    /findAssignmentForStudent\(\s*n\.ridingSlot\.assignments,\s*histGroupName,\s*histSubgroupNumber,?\s*\)/.test(
      RIDING,
    ),
    "assignment matching still uses the historical group/subgroup",
  );
});

test("14. no schema / auth / capability / production-data change is introduced", () => {
  const forbidden =
    /@\/lib\/auth\/|@\/lib\/course\/capabilities\/|prisma\/schema|apply_migration|\$executeRaw/;
  assert.ok(!forbidden.test(LOADER), "the offering-aware loader adds no auth/capability/DDL edge");
  const CORE = read("lib/course/historical-trainee-state-core.ts");
  assert.ok(!forbidden.test(CORE), "the pure core adds no auth/capability/DDL edge");
  // Comments stripped, so the core's own "no Prisma" prose never satisfies this.
  const coreCode = CORE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/prisma/i.test(coreCode), "the pure core stays DB-free");
  // The reader's own auth wrappers are untouched: viewing is still gated by the
  // pre-existing admin / instructor-actor boundaries, and no new gate is added.
  assert.ok(
    /export async function getStudentRidingHistoryForAdmin\(/.test(RIDING) &&
      /export async function getStudentRidingHistoryForInstructor\(/.test(RIDING) &&
      /export async function getStudentRidingHistoryForInstructorTraineeProgress\(/.test(RIDING),
    "all three pre-existing history entry points survive unchanged",
  );
});
