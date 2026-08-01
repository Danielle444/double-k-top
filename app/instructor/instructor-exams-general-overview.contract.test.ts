/**
 * Instructor general/all exam schedule view must be overview-only.
 *
 * `לו״ז כללי` (navMode === "all") must show only schedule-level facts (date,
 * start/end time, exam type/name, arena/location) - exactly like the admin
 * general view - and must never show a trainee name, an examinee name, an
 * instructed-trainee name, a supervisor name, an assignment, a horse, a topic
 * or a self/role marker. The by-date and by-type views must keep their full
 * existing detail, and the two static beginner placeholder cards must remain
 * scoped to their approved by-date locations only.
 *
 * InstructorExamsSection.tsx cannot be rendered in node:test (no DOM/testing-
 * library in this project - see the admin exam-workspace.contract.test.ts
 * convention, which asserts against the SOURCE the same way), so this checks
 * the guard is wired correctly at the source level.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-exams-general-overview.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const SRC = readSource("./InstructorExamsSection.tsx");

// The participant-detail block, delimited by the general-view guard on one
// side and the next unconditional block (the timetable status label) on the
// other - both anchors already exist in the file regardless of this change.
const GUARD_OPEN = '{navMode !== "all" && (';
const GUARD_CLOSE_ANCHOR = "{statusLabel !== null && (";

function guardedBlock(): string {
  const start = SRC.indexOf(GUARD_OPEN);
  assert.notEqual(start, -1, "the by-type/by-date-only guard must exist");
  const end = SRC.indexOf(GUARD_CLOSE_ANCHOR, start);
  assert.ok(end > start, "the guarded block must be delimited before the status label");
  return SRC.slice(start, end);
}

test("1. every participant-level element is gated behind navMode !== 'all'", () => {
  const guarded = guardedBlock();
  for (const mustBeGuarded of [
    "<PeopleLine",
    "<ExamAssignmentRows",
    "<ExamBeginnerRows",
    'label="נבחנים"',
    'label="חניכים מדריכים"',
    'label="משגיחים"',
  ]) {
    const totalCount = SRC.split(mustBeGuarded).length - 1;
    const guardedCount = guarded.split(mustBeGuarded).length - 1;
    assert.ok(totalCount > 0, `${mustBeGuarded} must still exist somewhere in the file`);
    assert.equal(
      totalCount,
      guardedCount,
      `every occurrence of ${mustBeGuarded} must be inside the navMode !== "all" guard`,
    );
  }
});

test("2. the general view still renders the block facts unconditionally: date, start/end time, type, place", () => {
  const start = SRC.indexOf(GUARD_OPEN);
  // The block-facts JSX (definition name, start/end time, place) sits BEFORE
  // the guard, in the same card, and is therefore never hidden by it.
  const beforeGuard = SRC.slice(0, start);
  const cardStart = beforeGuard.lastIndexOf('className="rounded-2xl border border-border bg-card p-4 shadow-sm"');
  assert.notEqual(cardStart, -1);
  const blockFacts = beforeGuard.slice(cardStart);
  assert.ok(blockFacts.includes("row.definitionName"), "exam type/name must render unconditionally");
  assert.ok(blockFacts.includes("row.startTime"), "start time must render unconditionally");
  assert.ok(blockFacts.includes("row.displayEndTime"), "end time must render unconditionally");
  assert.ok(blockFacts.includes("place"), "arena/location must render unconditionally");
});

test("3. a read-only note is shown ONLY in the general/all view", () => {
  assert.ok(SRC.includes("GENERAL_VIEW_READ_ONLY_TEXT"), "the general view must state it is structure-only");
  assert.match(
    SRC,
    /\{navMode === "all" && \(\s*<p[^>]*>\s*\{GENERAL_VIEW_READ_ONLY_TEXT\}/,
    "the note must be gated to navMode === \"all\"",
  );
});

test("4. by-date and by-type keep the full existing detail - the guard only excludes 'all'", () => {
  // The guard is a single NEGATIVE check against exactly one mode ("all");
  // both other modes ("type" and "date") fall through to the guarded
  // (full-detail) block unchanged, so neither loses anything relative to
  // before this change - there is no separate per-mode gate to keep in sync.
  assert.ok(SRC.includes(GUARD_OPEN), 'the guard must exclude only navMode === "all"');
  const guarded = guardedBlock();
  assert.ok(
    !/navMode\s*===\s*"(type|date)"/.test(guarded),
    "the guarded detail block must not itself branch on type/date - it renders identically for both",
  );
});

test("5. the two static beginner-teaching-practice placeholders stay scoped to their approved by-date locations, never the general view", () => {
  const idx = SRC.indexOf("BeginnerPlaceholderCard");
  assert.notEqual(idx, -1);
  const placeholderUsageStart = SRC.indexOf("<BeginnerPlaceholderCard");
  assert.notEqual(placeholderUsageStart, -1, "the placeholder cards must still be rendered somewhere");

  // Both placeholder render sites must be gated on navMode === "date" AND the
  // specific approved date - never on "all" and never unconditionally.
  const placeholderSection = SRC.slice(SRC.indexOf('navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_A'));
  assert.ok(placeholderSection.includes("BEGINNER_PLACEHOLDER_DATE_A"));
  assert.ok(placeholderSection.includes("BEGINNER_PLACEHOLDER_DATE_B"));
  assert.equal(
    (SRC.match(/navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_[AB]/g) ?? []).length,
    2,
    "each placeholder must be gated on the by-date view plus its own approved date",
  );
  // Never reachable from the general/all view.
  assert.ok(
    !/navMode === "all"[\s\S]{0,200}BEGINNER_PLACEHOLDER/.test(SRC),
    "a beginner placeholder must never be conditioned on navMode === \"all\"",
  );
});

test("6. the view-layer filter touches no reader, DTO, Prisma or Teaching Practice module", () => {
  const importBlock = SRC.slice(0, SRC.indexOf("const LOADING_TEXT"));
  for (const forbiddenImportPathFragment of [
    "@prisma/client",
    "exam-read-dto",
    "exam-read-scope-core",
    "/teaching-practice",
  ]) {
    assert.ok(
      !importBlock.toLowerCase().includes(forbiddenImportPathFragment.toLowerCase()),
      `InstructorExamsSection.tsx must not import from a module matching ${forbiddenImportPathFragment}`,
    );
  }
  // The single existing Server Action call site is unchanged - no new reader.
  assert.equal(
    (SRC.match(/getInstructorExamSchedule\(/g) ?? []).length,
    1,
    "there must still be exactly one call to the existing instructor exam reader",
  );
});
