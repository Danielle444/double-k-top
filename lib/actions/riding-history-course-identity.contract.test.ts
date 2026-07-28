/**
 * R1-RIDING-HISTORY-COURSE - non-DB CONTRACT (source-scan) tests locking the
 * riding/instruction history course-identity wiring. No Prisma, no DB, no session.
 * Run with:
 *   npx tsx --test lib/actions/riding-history-course-identity.contract.test.ts
 *
 * Mirrors the source-scan pattern already used by
 * lib/course/historical-readers.contract.test.ts (and
 * riding-slot-complex-title.contract.test.ts): the SEMANTICS of the identity and
 * its label live in lib/course/riding-history-course-scope-core.test.ts; these
 * tests prove the reader feeds the AUTHORITATIVE source into it, that no second
 * query or per-row query was introduced, that no other inference path exists, and
 * that everything explicitly out of scope for this slice (writers, the
 * student-level journals, averages, filtering, ordering) is untouched.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const RIDING = read("lib/actions/riding-slots.ts");
const LIST = read("lib/components/RidingHistoryList.tsx");
const DETAIL = read("lib/components/TraineeProgressDetail.tsx");
const CORE = read("lib/course/riding-history-course-scope-core.ts");

/**
 * Comment-stripped view, so a "never infer from X" DOC COMMENT can never satisfy
 * (or falsely fail) a "no such call exists" assertion - the comments in these
 * files deliberately name the forbidden helpers, including with parentheses.
 * Every use below re-asserts a sentinel of real code survived the strip, so a
 * mis-strip can't silently make these assertions vacuous.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\/[^"'\n]*$/gm, "");
}

/** Source slice of one function/interface, from its opening marker to `end`. */
function bodyOf(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `marker not found: ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `end marker not found after ${startMarker}: ${endMarker}`);
  return src.slice(start, end);
}

const ROW_INTERFACE = bodyOf(RIDING, "export interface RidingHistoryRow {", "\n}");
const HISTORY_BODY = bodyOf(
  RIDING,
  "async function buildStudentRidingHistory",
  "export async function getStudentRidingHistoryForAdmin",
);
const HISTORY_LOOP = HISTORY_BODY.slice(HISTORY_BODY.indexOf("for (const n of notes)"));
const WRITER_BODY = bodyOf(
  RIDING,
  "async function writeRidingLessonNote",
  "export async function upsertRidingLessonNoteAsInstructor",
);
const RIDING_TIMELINE_BUILDER = bodyOf(
  DETAIL,
  "function buildRidingTimelineItems",
  "function buildTeachingPracticeTimelineItems",
);

// ---------------------------------------------------------------------------
// A: the payload preserves course identity (additively)
// ---------------------------------------------------------------------------

test("1. RidingHistoryRow gains exactly the three additive course fields", () => {
  assert.match(ROW_INTERFACE, /courseOfferingId: string \| null;/);
  assert.match(ROW_INTERFACE, /courseName: string \| null;/);
  assert.match(ROW_INTERFACE, /courseLevel: number \| null;/);
});

test("2. every pre-existing RidingHistoryRow field is still present (purely additive)", () => {
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
    assert.ok(new RegExp(`\\b${field}\\b`).test(ROW_INTERFACE), `row field lost: ${field}`);
  }
});

// ---------------------------------------------------------------------------
// B: the identity comes ONLY from the lesson's own schedule spine
// ---------------------------------------------------------------------------

test("3. the offering is joined off the lesson's own WeeklySchedule, inside the slot's linked ScheduleItems", () => {
  assert.match(
    HISTORY_BODY,
    /weeklySchedule: \{\s*select: \{\s*courseOfferingId: true,\s*courseOffering: \{ select: \{ id: true, name: true, level: true \} \},/,
    "the existing weeklySchedule select must be WIDENED with the joined offering",
  );
  // Authoritative chain order: ridingSlot -> scheduleItems (the linked set) ->
  // scheduleItem -> weeklySchedule -> courseOffering.
  const chain = ["ridingSlot: {", "scheduleItems: {", "scheduleItem: {", "weeklySchedule: {", "courseOffering: {"];
  let cursor = -1;
  for (const link of chain) {
    const next = HISTORY_BODY.indexOf(link, cursor + 1);
    assert.ok(next > cursor, `derivation chain broken at: ${link}`);
    cursor = next;
  }
});

test("4. identity is resolved PER ROW from the same linked ScheduleItem that supplies date + group", () => {
  assert.match(
    HISTORY_LOOP,
    /const courseIdentity = resolveRidingHistoryCourseIdentity\(first\.weeklySchedule\.courseOffering\);/,
    "must resolve from `first`, the same linked item used for the date/group lookup",
  );
  // Inside the per-note loop and after `first` is chosen, so two lessons on ONE
  // calendar date belonging to different offerings each get their own identity.
  assert.ok(
    HISTORY_LOOP.indexOf("const first = scheduleItems[0]") <
      HISTORY_LOOP.indexOf("resolveRidingHistoryCourseIdentity"),
    "identity must be resolved after the row's own linked item is selected",
  );
  // L2-RH1 group scoping still keyed off the very same item - unchanged.
  assert.match(HISTORY_LOOP, /first\.weeklySchedule\.courseOfferingId/, "L2-RH1 group scoping preserved");
});

test("5. the row's course fields are written ONLY from that resolved identity", () => {
  assert.match(HISTORY_LOOP, /courseOfferingId: courseIdentity\.courseOfferingId,/);
  assert.match(HISTORY_LOOP, /courseName: courseIdentity\.courseName,/);
  assert.match(HISTORY_LOOP, /courseLevel: courseIdentity\.courseLevel,/);
  // Exactly one assignment each - no second, competing source.
  assert.equal((HISTORY_LOOP.match(/courseOfferingId: /g) ?? []).length, 1);
  assert.equal((HISTORY_LOOP.match(/courseLevel: /g) ?? []).length, 1);
});

test("6. no resolveCurrentCourseOffering / temporary-Level-2 / ambient-course fallback", () => {
  const code = stripComments(RIDING);
  assert.ok(code.includes("prisma.ridingLessonNote.findMany"), "sentinel: strip kept real code");
  assert.ok(!/resolveCurrentCourseOffering/.test(code), "no singleton current-offering resolver");
  assert.ok(!/temporary-level2-compatibility/.test(code), "no temporary Level 2 compatibility import");
  assert.ok(!/INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS/.test(code));
  assert.ok(!/readRememberedAdminCourseOfferingId/.test(code), "no admin selected-course cookie");
  const coreCode = stripComments(CORE);
  assert.ok(coreCode.includes("export function resolveRidingHistoryCourseIdentity"), "sentinel");
  assert.ok(!/resolveCurrentCourseOffering/.test(coreCode));
});

test("7. no date / title / group / session inference of the course in the history reader", () => {
  const loop = stripComments(HISTORY_LOOP);
  assert.ok(loop.includes("courseIdentity"), "sentinel: strip kept real code");
  // The only thing feeding identity is the joined offering - never these.
  assert.ok(!/resolveRidingHistoryCourseIdentity\([^)]*first\.date/.test(loop));
  assert.ok(!/resolveRidingHistoryCourseIdentity\([^)]*first\.title/.test(loop));
  assert.ok(!/resolveRidingHistoryCourseIdentity\([^)]*histGroupName/.test(loop));
  assert.ok(!/resolveRidingHistoryCourseIdentity\([^)]*studentId/.test(loop));
  // And no level-threshold branching in this reader (the level>=2 roster branch
  // belongs to a different function and is deliberately not reused here).
  assert.ok(!/offeringLevel/.test(loop), "no level-based branching in the history reader");
  assert.ok(!/level >= 2|level === 1|level === 2/.test(loop));
});

test("8. no hardcoded offering id anywhere in the touched runtime files", () => {
  for (const [name, src] of [
    ["riding-slots.ts", RIDING],
    ["RidingHistoryList.tsx", LIST],
    ["TraineeProgressDetail.tsx", DETAIL],
    ["riding-history-course-scope-core.ts", CORE],
  ] as const) {
    const literals = src.match(/["'`]c[a-z0-9]{24,}["'`]/g) ?? [];
    assert.deepEqual(literals, [], `hardcoded cuid-like id in ${name}: ${literals.join(", ")}`);
  }
});

// ---------------------------------------------------------------------------
// C: no extra query, no N+1, signatures unchanged
// ---------------------------------------------------------------------------

test("9. no query was added: exactly two Prisma calls and three awaits in the reader", () => {
  assert.equal((HISTORY_BODY.match(/prisma\./g) ?? []).length, 2, "one Student read + one notes read");
  assert.match(HISTORY_BODY, /prisma\.student\.findUnique/);
  assert.match(HISTORY_BODY, /prisma\.ridingLessonNote\.findMany/);
  assert.equal(
    (HISTORY_BODY.match(/await /g) ?? []).length,
    3,
    "student read + notes read + the bounded historical loader, nothing else",
  );
  assert.match(HISTORY_BODY, /await loadHistoricalTraineeStateForOfferings\(/);
});

test("10. no N+1: zero awaits and zero Prisma calls from the per-row loop onward", () => {
  assert.equal((HISTORY_LOOP.match(/await /g) ?? []).length, 0, "no await inside the row loop");
  assert.equal((HISTORY_LOOP.match(/prisma\./g) ?? []).length, 0, "no query inside the row loop");
  assert.equal((HISTORY_LOOP.match(/findMany|findUnique|findFirst/g) ?? []).length, 0);
});

test("11. all public reader signatures are unchanged", () => {
  for (const signature of [
    "export async function getStudentRidingHistoryForAdmin(\n  studentId: string\n): Promise<StudentRidingHistoryResult | null> {",
    "export async function getStudentRidingHistoryForInstructor(\n  studentId: string\n): Promise<StudentRidingHistoryResult | null> {",
    "export async function getStudentRidingHistoryForInstructorTraineeProgress(\n  instructorId: string,\n  studentId: string\n): Promise<StudentRidingHistoryResult | null> {",
    "async function buildStudentRidingHistory(studentId: string): Promise<StudentRidingHistoryResult | null> {",
  ]) {
    assert.ok(RIDING.includes(signature), `signature changed: ${signature.split("(")[0]}`);
  }
  // No offering/course parameter was added to any reader - so no client-supplied
  // course identity can ever reach this reader.
  assert.ok(!/getStudentRidingHistoryFor\w+\([^)]*courseOffering/.test(RIDING));
});

// ---------------------------------------------------------------------------
// D: display - badge and chip, nothing else
// ---------------------------------------------------------------------------

test("12. RidingHistoryList renders the shared course badge (both admin screen and instructor modal)", () => {
  assert.match(LIST, /import \{ formatRidingHistoryCourseLabel \} from "@\/lib\/course\/riding-history-course-scope-core";/);
  assert.match(LIST, /\{formatRidingHistoryCourseLabel\(row\)\}/, "badge text from the shared core");
  assert.match(LIST, /title=\{row\.courseName \?\? undefined\}/, "full course name as secondary context only");
  // The level label must not be composed locally from the name/level.
  assert.ok(!/רמה \$\{/.test(LIST), "no local label composition");
});

test("13. the trainee-progress timeline chips ONLY the lesson-note entries", () => {
  assert.match(RIDING_TIMELINE_BUILDER, /courseLabel: formatRidingHistoryCourseLabel\(row\),/);
  assert.match(DETAIL, /\{item\.courseLabel && \(/, "chip renders only when identity exists");
  assert.match(DETAIL, /courseLabel\?: string;/, "optional, so other sources render nothing");
  // S4 UPDATE: buildRidingProgressTimelineItems is no longer in this list - the
  // riding-progress JOURNAL now carries its own course identity (see test 14).
  // The remaining three journals stay course-blind, and the lesson-note
  // assertions above are unchanged.
  for (const other of [
    "function buildTeachingPracticeTimelineItems",
    "function buildLungeProgressTimelineItems",
    "function buildPresentationProgressTimelineItems",
  ]) {
    const body = bodyOf(DETAIL, other, "\n}\n");
    assert.ok(!body.includes("courseLabel"), `${other} must not set courseLabel`);
  }
});

test("14. S4 - the riding-progress JOURNAL carries its OWN course identity, not the lesson's", () => {
  const journal = bodyOf(DETAIL, "function buildRidingProgressTimelineItems", "\n}\n");
  assert.match(journal, /title: "רכיבה",/, "journal entry title unchanged");
  // The journal's chip comes from the row's OWN stored course projection...
  assert.match(journal, /courseLabel: ridingProgressCourseChipLabel\(row\.courseOffering\)/);
  // ...never from the lesson-note label helper, which resolves a lesson's course
  // through its week's offering - an authoritative source that says nothing
  // about a standalone journal entry.
  assert.ok(
    !journal.includes("formatRidingHistoryCourseLabel"),
    "the journal must not borrow the lesson-note course resolution",
  );
  // The two remaining journals still have no course dimension at all.
  for (const other of ["function buildLungeProgressTimelineItems", "function buildPresentationProgressTimelineItems"]) {
    assert.ok(!/course/i.test(bodyOf(DETAIL, other, "\n}\n")), `${other} stays course-blind`);
  }
});

test("15. averages are untouched", () => {
  assert.ok(
    DETAIL.includes(
      "return averageRatingFromHalfPoints([\n      ...ridingProgressRows.map((r) => r.ratingHalfPoints),\n      ...lungeProgressRows.map((r) => r.ratingHalfPoints),\n      ...ridingRows.map((r) => r.ratingHalfPoints),\n      ...teachingPracticeRows.map((r) => r.ratingHalfPoints),\n    ]);",
    ),
    "combinedAverageRating must pool exactly the same four sources as before",
  );
  assert.ok(
    DETAIL.includes(
      "() => (ridingRows ? averageRatingFromHalfPoints(ridingRows.map((r) => r.ratingHalfPoints)) : null),",
    ),
    "the riding average is unchanged (no per-course split in this slice)",
  );
  assert.ok(!/courseLabel[\s\S]{0,80}averageRating/.test(DETAIL), "no average reads the course label");
});

// ---------------------------------------------------------------------------
// E: nothing else moved
// ---------------------------------------------------------------------------

test("16. row ordering and counts are unchanged (no filtering added in this slice)", () => {
  assert.match(HISTORY_BODY, /orderBy: \{ updatedAt: "desc" \}/, "reader ordering unchanged");
  assert.ok(
    DETAIL.includes(
      "b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.updatedAt.localeCompare(a.updatedAt)",
    ),
    "timeline ordering unchanged",
  );
  // The list's client-side filters remain exactly date + topic text.
  assert.ok(LIST.includes("if (dateFilter && row.dateKey !== dateFilter) return false;"));
  assert.equal((LIST.match(/useState\(/g) ?? []).length, 2, "no new filter state");
  assert.ok(LIST.includes("מציג {filteredRows.length} מתוך {rows.length} רשומות"), "counts unchanged");
  assert.ok(!/courseOfferingId|courseLevel/.test(LIST), "the badge uses the label only, no course filtering");
});

test("17. the note WRITER is untouched - no course field is written", () => {
  const writer = stripComments(WRITER_BODY);
  assert.ok(writer.includes("tx.ridingLessonNote.upsert"), "sentinel: strip kept real code");
  assert.ok(!/course/i.test(writer), "the writer must not gain any course awareness");
  assert.match(
    WRITER_BODY,
    /update: \{ note, ratingHalfPoints, sessionHorseName, lessonTopic, updatedByName \},/,
    "persisted note fields unchanged",
  );
});

test("18. the core is pure: no Prisma, no server directive, no clock, no session", () => {
  assert.ok(!/prisma/i.test(CORE), "no Prisma");
  assert.ok(!/"use server"/.test(CORE), "not a server-action module");
  assert.ok(!/import /.test(CORE), "no imports at all - fully self-contained");
  assert.ok(!/Date\.now|new Date|cookies\(|headers\(/.test(CORE), "no clock, no request state");
});
