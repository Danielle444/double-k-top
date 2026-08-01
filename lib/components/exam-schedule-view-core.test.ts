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
  selectSelfAssignmentRow,
  type ExamAssignmentRowView,
  type TraineeExamAssignmentRowView,
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

/**
 * The same row as the TRAINEE contract carries it: with the server's own answer
 * attached. `isSelf` is the ONLY thing that ever decides which row is the
 * viewer's, so every fixture states it explicitly.
 */
function self(
  row: ExamAssignmentRowView,
  isSelf: boolean,
): TraineeExamAssignmentRowView {
  return { ...row, isSelf };
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
// 5. The viewer's own row — the SERVER's boolean, and nothing else
// ===========================================================================

test("5. the row the server marked is the row returned", () => {
  const rows = [
    self(examinee({ participantName: "דנה", horseName: "רקיע" }), false),
    self(examinee({ participantName: "רון", horseName: "סופה" }), true),
  ];
  const detail = selectSelfAssignmentRow(rows);
  assert.equal(detail?.participantName, "רון");
  assert.equal(detail?.horseName, "סופה");
});

test("5b. TWO PARALLEL EXAMINEES, identical personal windows — the right one wins", () => {
  // This is the case the removed heuristic could not answer. Both rows carry the
  // SAME role and the SAME exact personal start and end; only `isSelf` differs,
  // and that is enough because the server decided it by student id.
  const rows = [
    self(examinee({ participantName: "דנה", horseName: "רקיע", discipline: "אילוף" }), false),
    self(
      examinee({
        participantName: "רון",
        horseName: "סופה",
        instructionTopic: "קפיצה",
        discipline: "ראווה",
        pairedParticipantNames: ["נועה ברק"],
      }),
      true,
    ),
  ];
  // Sanity: the two rows are indistinguishable by role and by time.
  assert.equal(rows[0].role, rows[1].role);
  assert.equal(rows[0].personalStartTime, rows[1].personalStartTime);
  assert.equal(rows[0].personalEndTime, rows[1].personalEndTime);

  const detail = selectSelfAssignmentRow(rows);
  assert.equal(detail?.participantName, "רון");
  assert.equal(detail?.horseName, "סופה", "the other rider's horse was returned");
  assert.equal(detail?.instructionTopic, "קפיצה");
  assert.equal(detail?.discipline, "ראווה");
  assert.deepEqual(detail?.pairedParticipantNames, ["נועה ברק"]);
});

test("5c. the marked row is returned whatever its role, position or time", () => {
  // None of those is consulted to CHOOSE it — they are only read out of it.
  const first = selectSelfAssignmentRow([
    self(instructed({ participantName: "יעל" }), true),
    self(examinee({ participantName: "דנה" }), false),
  ]);
  assert.equal(first?.participantName, "יעל");
  assert.equal(first?.role, "INSTRUCTED_TRAINEE");

  const last = selectSelfAssignmentRow([
    self(examinee({ participantName: "דנה" }), false),
    self(examinee({ participantName: "רון" }), false),
    self(instructed({ participantName: "יעל", personalStartTime: null, personalEndTime: null }), true),
  ]);
  assert.equal(last?.participantName, "יעל", "a row with no personal window was skipped");
});

test("5d. ZERO marked rows fail closed", () => {
  const rows = [
    self(examinee({ participantName: "דנה" }), false),
    self(instructed({ participantName: "יעל" }), false),
  ];
  assert.equal(selectSelfAssignmentRow(rows), null);
  // ...and so do the empty and absent collections.
  assert.equal(selectSelfAssignmentRow([]), null);
  assert.equal(selectSelfAssignmentRow(null), null);
  assert.equal(selectSelfAssignmentRow(undefined), null);
});

test("5e. MORE THAN ONE marked row fails closed — the first is never taken", () => {
  // A contradiction the client cannot resolve and must not paper over.
  const rows = [
    self(examinee({ participantName: "דנה", horseName: "רקיע" }), true),
    self(examinee({ participantName: "רון", horseName: "סופה" }), true),
  ];
  assert.equal(selectSelfAssignmentRow(rows), null);
});

test("5f. only the boolean TRUE marks a row — nothing truthy stands in for it", () => {
  const rows = [
    { ...examinee({ participantName: "דנה" }), isSelf: "true" },
    { ...examinee({ participantName: "רון" }), isSelf: 1 },
  ] as unknown as readonly TraineeExamAssignmentRowView[];
  assert.equal(selectSelfAssignmentRow(rows), null, "a truthy non-boolean marked a row");
});

test("5g. the REMOVED heuristic is gone: no role or time selection remains", () => {
  // The selector's whole body must not name a role, a personal time, a horse, a
  // topic, a discipline, a pairing or an index — the values the old
  // `selfRole` + `personalStartTime` + `personalEndTime` matching used to
  // compare. It may only read `isSelf`.
  const selector = SOURCE_CODE.slice(SOURCE_CODE.indexOf("export function selectSelfAssignmentRow"));
  for (const token of [
    "personalStartTime",
    "personalEndTime",
    "startTime",
    "endTime",
    "marker",
    "selfRole",
    "role ===",
    "horseName",
    "instructionTopic",
    "discipline",
    "pairedParticipantNames",
    "indexOf",
    "findIndex",
    ".find(",
  ]) {
    assert.equal(selector.includes(token), false, `the selector still consults ${token}`);
  }
  assert.ok(selector.includes("row.isSelf === true"), "the selector does not read the marker");
  // The one index it uses is reached ONLY after proving there is exactly one
  // match — it is never a positional pick among several.
  assert.ok(
    selector.includes("matches.length === 1 ? matches[0] : null"),
    "the selector picks a row by position rather than by uniqueness",
  );
  // The old entry point and its marker type are GONE from the module entirely.
  for (const removed of ["selectSelfAssignmentDetail", "ExamSelfMarker"]) {
    assert.equal(SOURCE.includes(removed), false, `${removed} still exists`);
  }
});

test("5h. no viewer identity is an input, and none is representable", () => {
  const selector = SOURCE_CODE.slice(SOURCE_CODE.indexOf("export function selectSelfAssignmentRow"));
  const params = selector.slice(selector.indexOf("(") + 1, selector.indexOf(")"));
  assert.match(
    params.replace(/\s+/g, " ").trim(),
    /^rows: readonly TraineeExamAssignmentRowView\[\] \| null \| undefined,?$/,
    "the selector accepts something besides the rows",
  );
  // The trainee row type adds EXACTLY the one boolean — no id came with it.
  const contract = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface TraineeExamAssignmentRowView"),
    SOURCE_CODE.indexOf("export function selectSelfAssignmentRow"),
  );
  assert.deepEqual(
    [...contract.matchAll(/readonly (\w+):/g)].map(([, name]) => name),
    ["isSelf"],
  );
  for (const token of ["studentId", "assignmentId", "enrollmentId", "viewerStudentId", "pairingIndex"]) {
    assert.equal(contract.includes(token), false, `the trainee row carries ${token}`);
  }
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
  // Identity enters this module as ONE boolean the server already decided. There
  // is no viewer id, no viewer name and no marker type anywhere in it.
  for (const token of ["viewerStudentId", "studentId", "assignmentId", "enrollmentId"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the core names ${token}`);
  }
  assert.equal(
    (SOURCE_CODE.match(/isSelf/g) ?? []).length,
    2,
    "isSelf is read somewhere beyond the trainee row type and the selector",
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
