/**
 * EX-ROLE-SCHEDULE-REDESIGN — tests for the PURE exam schedule view core.
 *
 * The core has no imports, no React, no DOM and no IO, so every property below
 * is proven by calling it directly. NO DATABASE, NO NETWORK, NO SERVER ACTION is
 * touched by this file.
 *
 * A handful of STRUCTURAL claims are asserted against the source text too, for
 * the properties that are about what the module CANNOT do rather than what it
 * returns: that it reaches no read-pipeline module, that it sorts nothing, and
 * that it compares no display name for identity.
 *
 * Run with:
 *   npx tsx --test lib/components/exam-schedule-view-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  filterExamRows,
  groupExamAssignmentsIntoWaves,
  listExamDates,
  listExamDefinitionNames,
  selectSelfAssignmentDetail,
  type ExamAssignmentRowView,
} from "./exam-schedule-view-core";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./exam-schedule-view-core.ts", import.meta.url)),
  "utf8",
);

/** CODE only — the header legitimately NAMES the things it refuses to do. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

function examinee(overrides: Partial<ExamAssignmentRowView> = {}): ExamAssignmentRowView {
  return {
    participantName: "דנה כהן",
    role: "EXAMINEE",
    horseName: "רקיע",
    instructionTopic: "עבודה על מעגל",
    discipline: "אילוף",
    personalStartTime: "09:00",
    personalEndTime: "09:20",
    pairedParticipantNames: ["יעל לוי"],
    ...overrides,
  };
}

function instructed(overrides: Partial<ExamAssignmentRowView> = {}): ExamAssignmentRowView {
  return {
    participantName: "יעל לוי",
    role: "INSTRUCTED_TRAINEE",
    horseName: null,
    instructionTopic: "עבודה על מעגל",
    discipline: "אילוף",
    personalStartTime: "09:00",
    personalEndTime: "09:20",
    pairedParticipantNames: ["דנה כהן"],
    ...overrides,
  };
}

// ===========================================================================
// 1. Nesting — the instructed trainee lives INSIDE the examinee's unit
// ===========================================================================

test("1. an examinee becomes a unit carrying the trainee they teach", () => {
  const waves = groupExamAssignmentsIntoWaves([examinee(), instructed()]);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].units.length, 1);
  assert.equal(waves[0].units[0].examinee.participantName, "דנה כהן");
  assert.deepEqual(waves[0].units[0].instructedTraineeNames, ["יעל לוי"]);
});

test("1b. a paired instructed trainee gets NO independent unit and NO stray row", () => {
  const waves = groupExamAssignmentsIntoWaves([examinee(), instructed()]);
  // Exactly one visible entity in the wave: the examinee unit.
  assert.equal(waves[0].units.length, 1);
  assert.deepEqual(waves[0].unpairedInstructedRows, []);
  // ...and no unit anywhere is an instructed trainee.
  for (const wave of waves) {
    for (const unit of wave.units) assert.equal(unit.examinee.role, "EXAMINEE");
  }
});

test("1c. the trainee order inside a unit is the RESOLVED order, untouched", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ pairedParticipantNames: ["תמר", "אבי", "מיכל"] }),
  ]);
  assert.deepEqual(waves[0].units[0].instructedTraineeNames, ["תמר", "אבי", "מיכל"]);
});

test("1d. an UNPAIRED instructed trainee is kept, never erased", () => {
  // Nobody nests them, so dropping them would delete a real person from a real
  // schedule. They are carried separately instead.
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ pairedParticipantNames: [] }),
    instructed({ participantName: "נועה ברק", pairedParticipantNames: [] }),
  ]);
  assert.equal(waves.length, 1);
  assert.equal(waves[0].units.length, 1);
  assert.deepEqual(
    waves[0].unpairedInstructedRows.map((row) => row.participantName),
    ["נועה ברק"],
  );
});

test("1e. a blank paired name counts as no pairing at all", () => {
  const waves = groupExamAssignmentsIntoWaves([
    instructed({ participantName: "נועה ברק", pairedParticipantNames: ["   "] }),
  ]);
  assert.deepEqual(
    waves[0].unpairedInstructedRows.map((row) => row.participantName),
    ["נועה ברק"],
  );
});

// ===========================================================================
// 2. Waves — parallel examinees share ONE time
// ===========================================================================

test("2. two examinees in the same personal window land in ONE wave", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "דנה", pairedParticipantNames: ["יעל"] }),
    instructed({ participantName: "יעל", pairedParticipantNames: ["דנה"] }),
    examinee({ participantName: "רון", pairedParticipantNames: ["גל"] }),
    instructed({ participantName: "גל", pairedParticipantNames: ["רון"] }),
  ]);
  assert.equal(waves.length, 1, "the parallel pair was split across waves");
  assert.equal(waves[0].startTime, "09:00");
  assert.equal(waves[0].endTime, "09:20");
  assert.deepEqual(
    waves[0].units.map((unit) => unit.examinee.participantName),
    ["דנה", "רון"],
  );
});

test("2b. the wave states the window ONCE, and units carry no time of their own", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "דנה" }),
    examinee({ participantName: "רון" }),
  ]);
  assert.equal(waves.length, 1);
  // The window is a property of the WAVE. The unit type has no time field at
  // all — the only times reachable from a unit are the examinee row's own, and
  // the renderer beside this core never reads them.
  assert.deepEqual(Object.keys(waves[0].units[0]).sort(), ["examinee", "instructedTraineeNames"]);
});

test("2c. different windows are different waves, in first-appearance order", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "ראשונה", personalStartTime: "09:00", personalEndTime: "09:20" }),
    examinee({ participantName: "שנייה", personalStartTime: "10:00", personalEndTime: "10:20" }),
  ]);
  assert.equal(waves.length, 2);
  assert.equal(waves[0].startTime, "09:00");
  assert.equal(waves[1].startTime, "10:00");
});

test("2d. a later parallel row JOINS its earlier wave rather than starting a new one", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "א", personalStartTime: "09:00", personalEndTime: "09:20" }),
    examinee({ participantName: "ב", personalStartTime: "10:00", personalEndTime: "10:20" }),
    examinee({ participantName: "ג", personalStartTime: "09:00", personalEndTime: "09:20" }),
  ]);
  assert.equal(waves.length, 2);
  assert.deepEqual(
    waves[0].units.map((unit) => unit.examinee.participantName),
    ["א", "ג"],
  );
  assert.deepEqual(
    waves[1].units.map((unit) => unit.examinee.participantName),
    ["ב"],
  );
});

test("2e. waves are never SORTED — the contract order is the operational order", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "מאוחר", personalStartTime: "14:00", personalEndTime: "14:20" }),
    examinee({ participantName: "מוקדם", personalStartTime: "08:00", personalEndTime: "08:20" }),
  ]);
  assert.deepEqual(
    waves.map((wave) => wave.startTime),
    ["14:00", "08:00"],
  );
  assert.equal(SOURCE_CODE.includes(".sort("), false, "the core sorts");
  assert.equal(SOURCE_CODE.includes("localeCompare"), false, "the core orders by name");
});

// ===========================================================================
// 3. Incomplete and empty data
// ===========================================================================

test("3. a row with NO personal window gets its own wave with no time", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "א", personalStartTime: null, personalEndTime: null }),
    examinee({ participantName: "ב", personalStartTime: null, personalEndTime: null }),
  ]);
  // An ABSENT time is not a time two people can be said to share, so these are
  // never merged into one "wave" that would claim they ride together.
  assert.equal(waves.length, 2);
  for (const wave of waves) {
    assert.equal(wave.startTime, null);
    assert.equal(wave.endTime, null);
  }
});

test("3b. a HALF-known window is treated as no window", () => {
  const waves = groupExamAssignmentsIntoWaves([
    examinee({ participantName: "א", personalEndTime: null }),
    examinee({ participantName: "ב", personalEndTime: null }),
  ]);
  assert.equal(waves.length, 2);
  assert.equal(waves[0].startTime, null, "a half-known window was published as decided");
});

test("3c. an empty, null or undefined collection yields no wave at all", () => {
  assert.deepEqual(groupExamAssignmentsIntoWaves([]), []);
  assert.deepEqual(groupExamAssignmentsIntoWaves(null), []);
  assert.deepEqual(groupExamAssignmentsIntoWaves(undefined), []);
});

test("3d. a window holding ONLY a paired instructed trainee yields no empty wave", () => {
  // Their row is rendered inside their examinee's unit, which is in another
  // block or another wave; an empty time heading here would read as a wave with
  // nobody in it.
  assert.deepEqual(groupExamAssignmentsIntoWaves([instructed()]), []);
});

test("3e. a missing pairing list never throws", () => {
  const broken = {
    participantName: "דנה",
    role: "EXAMINEE",
    horseName: null,
    instructionTopic: null,
    discipline: null,
    personalStartTime: null,
    personalEndTime: null,
  } as unknown as ExamAssignmentRowView;
  const waves = groupExamAssignmentsIntoWaves([broken]);
  assert.equal(waves.length, 1);
  assert.deepEqual(waves[0].units[0].instructedTraineeNames, []);
});

// ===========================================================================
// 4. Navigation options and filtering
// ===========================================================================

const NAV_ROWS = [
  { date: "2026-08-01", definitionName: "ממשק" },
  { date: "2026-08-01", definitionName: "רכיבה" },
  { date: "2026-08-02", definitionName: "ממשק" },
  { date: "2026-08-02", definitionName: null },
];

test("4. the exam types are the distinct names, in first-appearance order", () => {
  assert.deepEqual(listExamDefinitionNames(NAV_ROWS), ["ממשק", "רכיבה"]);
});

test("4b. a row with no exam name contributes no type option", () => {
  assert.deepEqual(listExamDefinitionNames([{ date: "2026-08-01", definitionName: null }]), []);
  assert.deepEqual(listExamDefinitionNames([{ date: "2026-08-01", definitionName: "  " }]), []);
});

test("4c. the dates are the distinct dates, in first-appearance order and never sorted", () => {
  assert.deepEqual(listExamDates(NAV_ROWS), ["2026-08-01", "2026-08-02"]);
  assert.deepEqual(
    listExamDates([
      { date: "2026-08-09", definitionName: null },
      { date: "2026-08-02", definitionName: null },
    ]),
    ["2026-08-09", "2026-08-02"],
  );
});

test("4d. the GENERAL view is both axes unconstrained — every row, same order", () => {
  const all = filterExamRows(NAV_ROWS, { definitionName: null, date: null });
  assert.deepEqual(all, NAV_ROWS);
});

test("4e. filtering by exam type keeps only that type", () => {
  const rows = filterExamRows(NAV_ROWS, { definitionName: "ממשק", date: null });
  assert.deepEqual(rows, [NAV_ROWS[0], NAV_ROWS[2]]);
});

test("4f. filtering by date keeps only that date", () => {
  const rows = filterExamRows(NAV_ROWS, { definitionName: null, date: "2026-08-02" });
  assert.deepEqual(rows, [NAV_ROWS[2], NAV_ROWS[3]]);
});

test("4g. filtering can only ever NARROW — it invents no row", () => {
  const rows = filterExamRows(NAV_ROWS, { definitionName: "לא קיים", date: null });
  assert.deepEqual(rows, []);
  for (const row of filterExamRows(NAV_ROWS, { definitionName: "ממשק", date: null })) {
    assert.ok(NAV_ROWS.includes(row), "a row that was not loaded appeared");
  }
});

test("4h. a null/undefined collection filters to nothing rather than throwing", () => {
  assert.deepEqual(filterExamRows(null, { definitionName: null, date: null }), []);
  assert.deepEqual(filterExamRows(undefined, { definitionName: "x", date: "y" }), []);
});

// ===========================================================================
// 5. The viewer's own row — server markers only, fail-closed
// ===========================================================================

test("5. the viewer's row is found by role and exact personal window", () => {
  const rows = [
    examinee({ participantName: "דנה", personalStartTime: "09:00", personalEndTime: "09:20" }),
    examinee({ participantName: "רון", personalStartTime: "10:00", personalEndTime: "10:20" }),
  ];
  const detail = selectSelfAssignmentDetail(rows, {
    role: "EXAMINEE",
    startTime: "10:00",
    endTime: "10:20",
  });
  assert.equal(detail?.participantName, "רון");
});

test("5b. the role is part of the match: two people can share one window", () => {
  const rows = [examinee(), instructed()];
  const detail = selectSelfAssignmentDetail(rows, {
    role: "INSTRUCTED_TRAINEE",
    startTime: "09:00",
    endTime: "09:20",
  });
  assert.equal(detail?.role, "INSTRUCTED_TRAINEE");
  assert.equal(detail?.participantName, "יעל לוי");
});

test("5c. an AMBIGUOUS match yields nothing — never someone else's horse", () => {
  // Two examinees riding in parallel share a window, so the markers cannot tell
  // them apart. A missing detail is a gap; a guessed one is a wrong schedule.
  const rows = [
    examinee({ participantName: "דנה", horseName: "רקיע" }),
    examinee({ participantName: "רון", horseName: "סופה" }),
  ];
  assert.equal(
    selectSelfAssignmentDetail(rows, {
      role: "EXAMINEE",
      startTime: "09:00",
      endTime: "09:20",
    }),
    null,
  );
});

test("5d. a missing marker yields nothing", () => {
  const rows = [examinee()];
  for (const marker of [
    { role: null, startTime: "09:00", endTime: "09:20" },
    { role: "EXAMINEE" as const, startTime: null, endTime: "09:20" },
    { role: "EXAMINEE" as const, startTime: "09:00", endTime: null },
  ]) {
    assert.equal(selectSelfAssignmentDetail(rows, marker), null);
  }
  assert.equal(selectSelfAssignmentDetail(rows, null), null);
  assert.equal(selectSelfAssignmentDetail(rows, undefined), null);
});

test("5e. no matching row yields nothing, and no nearest match is invented", () => {
  const rows = [examinee({ personalStartTime: "09:00", personalEndTime: "09:20" })];
  assert.equal(
    selectSelfAssignmentDetail(rows, {
      role: "EXAMINEE",
      startTime: "09:05",
      endTime: "09:20",
    }),
    null,
  );
  assert.equal(selectSelfAssignmentDetail([], { role: "EXAMINEE", startTime: "09:00", endTime: "09:20" }), null);
});

// ===========================================================================
// 6. Structure — identity is never a name, and nothing here reaches a reader
// ===========================================================================

test("6. no display name is ever compared to decide identity or pairing", () => {
  for (const token of [
    "participantName ===",
    "=== row.participantName",
    "participantName ==",
    ".includes(row.participantName",
    "viewerName",
    "myName",
    "selfName",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the core matches identity by ${token}`);
  }
  // The self marker is an EXPLICIT field list with no name in it.
  const marker = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface ExamSelfMarker"),
    SOURCE_CODE.indexOf("export function selectSelfAssignmentDetail"),
  );
  assert.deepEqual(
    [...marker.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    ["endTime", "role", "startTime"],
  );
});

test("6b. the core reaches no read pipeline, no Prisma, no clock and no IO", () => {
  assert.deepEqual(SOURCE_CODE.match(/^\s*import\b.*$/gm), null, "the core gained an import");
  assert.equal(/\brequire\s*\(/.test(SOURCE_CODE), false, "no runtime require()");
  assert.equal(/\bimport\s*\(/.test(SOURCE_CODE), false, "no dynamic import()");
  for (const token of [
    "exam-read-dto",
    "exam-read-scope-core",
    "exam-role-readers",
    "exam-read-io",
    "prisma",
    "new Date",
    "Date.now",
    "Math.random",
    "process.env",
    "use server",
    "use client",
    "fetch(",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the core reaches ${token}`);
  }
});

test("6c. no identifier, contact detail or grade is representable in the row type", () => {
  const contract = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface ExamAssignmentRowView"),
    SOURCE_CODE.indexOf("export interface ExamExamineeUnitView"),
  );
  assert.deepEqual(
    [...contract.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    [
      "discipline",
      "horseName",
      "instructionTopic",
      "pairedParticipantNames",
      "participantName",
      "personalEndTime",
      "personalStartTime",
      "role",
    ],
  );
  for (const token of [
    "assignmentId",
    "studentId",
    "sessionId",
    "definitionId",
    "lessonId",
    "planId",
    "courseOfferingId",
    "pairingIndex",
    "nationalId",
    "parentName",
    "parentPhone",
    "phone",
    "email",
    "childNotes",
    "grade",
    "rating",
    "feedback",
    "JSON.stringify",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the core names ${token}`);
  }
});

test("6d. the derived singular pairing field is not read at all", () => {
  assert.equal(
    /pairedParticipantName\b(?!s)/.test(SOURCE_CODE),
    false,
    "the core reads the derived singular pairing field",
  );
});
