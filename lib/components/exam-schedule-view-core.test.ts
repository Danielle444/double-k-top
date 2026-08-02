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
  countBeginnerRows,
  earliestExamDate,
  examBeginnerFormatLabel,
  filterExamRows,
  groupExamAssignmentsIntoWaves,
  isBeginnerExamRow,
  listExamDates,
  listExamDefinitionNames,
  selectSelfAssignmentRows,
  sortExamRowsByStartTime,
  summarizeBeginnerRendering,
  EXAM_BEGINNER_FORMAT_VIEW_LABELS,
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
  // EX-TRAINEE-DATE-NAV RE-POINT — this swept the WHOLE FILE for `.sort(`.
  //
  // That claim was about the WAVE GROUPING, which must never re-order what the
  // read layer handed it, and it was expressible as a file-wide sweep only while
  // the file held nothing else. The core now also exposes the DISPLAY order of
  // whole blocks — a STABLE sort on block start time, tested in full in section
  // 8 below — and the file-wide form would be satisfied only by deleting it.
  //
  // The claim is REPLACED by the same claim about the same function, stated
  // against the grouping's own body: it still sorts nothing, still orders by no
  // name, and a sort smuggled into it fails here exactly as before.
  const grouping = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function groupExamAssignmentsIntoWaves"),
    SOURCE_CODE.indexOf("export interface ExamNavigableRow"),
  );
  assert.ok(grouping.length > 0, "the wave grouping could not be located");
  assert.equal(grouping.includes(".sort("), false, "the wave grouping sorts");
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
  const details = selectSelfAssignmentRows(rows);
  assert.equal(details.length, 1);
  assert.equal(details[0].participantName, "רון");
  assert.equal(details[0].horseName, "סופה");
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

  const details = selectSelfAssignmentRows(rows);
  assert.equal(details.length, 1);
  assert.equal(details[0].participantName, "רון");
  assert.equal(details[0].horseName, "סופה", "the other rider's horse was returned");
  assert.equal(details[0].instructionTopic, "קפיצה");
  assert.equal(details[0].discipline, "ראווה");
  assert.deepEqual(details[0].pairedParticipantNames, ["נועה ברק"]);
});

test("5c. every marked row is returned whatever its role, position or time", () => {
  // None of those is consulted to CHOOSE it — they are only read out of it.
  const first = selectSelfAssignmentRows([
    self(instructed({ participantName: "יעל" }), true),
    self(examinee({ participantName: "דנה" }), false),
  ]);
  assert.equal(first.length, 1);
  assert.equal(first[0].participantName, "יעל");
  assert.equal(first[0].role, "INSTRUCTED_TRAINEE");

  const last = selectSelfAssignmentRows([
    self(examinee({ participantName: "דנה" }), false),
    self(examinee({ participantName: "רון" }), false),
    self(instructed({ participantName: "יעל", personalStartTime: null, personalEndTime: null }), true),
  ]);
  assert.equal(last.length, 1);
  assert.equal(last[0].participantName, "יעל", "a row with no personal window was skipped");
});

test("5d. ZERO marked rows returns an empty array", () => {
  const rows = [
    self(examinee({ participantName: "דנה" }), false),
    self(instructed({ participantName: "יעל" }), false),
  ];
  assert.deepEqual(selectSelfAssignmentRows(rows), []);
  // ...and so do the empty and absent collections.
  assert.deepEqual(selectSelfAssignmentRows([]), []);
  assert.deepEqual(selectSelfAssignmentRows(null), []);
  assert.deepEqual(selectSelfAssignmentRows(undefined), []);
});

test("5e. MORE THAN ONE marked row returns EVERY one of them, in arrival order", () => {
  // EX-ASG-MULTIPLICITY: a trainee legitimately holds several assignments in one
  // block. Neither is dropped, and neither is picked arbitrarily over the other.
  const rows = [
    self(examinee({ participantName: "דנה", horseName: "רקיע" }), true),
    self(instructed({ participantName: "רון", instructionTopic: "קפיצה" }), true),
  ];
  const details = selectSelfAssignmentRows(rows);
  assert.equal(details.length, 2);
  assert.deepEqual(
    details.map((d) => d.participantName),
    ["דנה", "רון"],
  );
});

test("5f. only the boolean TRUE marks a row — nothing truthy stands in for it", () => {
  const rows = [
    { ...examinee({ participantName: "דנה" }), isSelf: "true" },
    { ...examinee({ participantName: "רון" }), isSelf: 1 },
  ] as unknown as readonly TraineeExamAssignmentRowView[];
  assert.deepEqual(selectSelfAssignmentRows(rows), [], "a truthy non-boolean marked a row");
});

test("5g. the REMOVED heuristic is gone: no role or time selection remains", () => {
  // The selector's whole body must not name a role, a personal time, a horse, a
  // topic, a discipline, a pairing or an index — the values the old
  // `selfRole` + `personalStartTime` + `personalEndTime` matching used to
  // compare. It may only read `isSelf`.
  // EX-BEGINNER-EXAM-UI RE-POINT: bounded at the END of the selector rather
  // than at the end of the FILE. The unbounded form measured everything that
  // happened to sit after this function, so a later, unrelated section of the
  // core would register as the selector consulting a field it never reads.
  const selector = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function selectSelfAssignmentRows"),
    SOURCE_CODE.indexOf("export type ExamRowSourceView"),
  );
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
  // It is a filter, never a positional pick among several matches.
  assert.ok(selector.includes(".filter("), "the selector must filter, not select one by position");
  // The old entry point and its marker type are GONE from the module entirely.
  for (const removed of ["selectSelfAssignmentDetail", "ExamSelfMarker"]) {
    assert.equal(SOURCE.includes(removed), false, `${removed} still exists`);
  }
});

test("5h. no viewer identity is an input, and none is representable", () => {
  // EX-BEGINNER-EXAM-UI RE-POINT: bounded at the END of the selector rather
  // than at the end of the FILE. The unbounded form measured everything that
  // happened to sit after this function, so a later, unrelated section of the
  // core would register as the selector consulting a field it never reads.
  const selector = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function selectSelfAssignmentRows"),
    SOURCE_CODE.indexOf("export type ExamRowSourceView"),
  );
  const params = selector.slice(selector.indexOf("(") + 1, selector.indexOf(")"));
  assert.match(
    params.replace(/\s+/g, " ").trim(),
    /^rows: readonly TraineeExamAssignmentRowView\[\] \| null \| undefined,?$/,
    "the selector accepts something besides the rows",
  );
  // The trainee row type adds EXACTLY the one boolean — no id came with it.
  const contract = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface TraineeExamAssignmentRowView"),
    SOURCE_CODE.indexOf("export function selectSelfAssignmentRows"),
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
  // EX-TRAINEE-ID-CONTAINMENT RE-POINT — the count was 2 (the trainee row
  // type's `isSelf` field and the selector). A live beginner row has NO exam
  // assignment to hang a self-marker on, so `ExamBeginnerDetailView` gained its
  // own restatement of the SAME server-derived answer, `isSelfRelevant`. It is
  // read, never computed — this file still holds no viewer identity and
  // compares no display name — so the claim is unweakened; only the count
  // widens by one to admit the field's own name.
  assert.equal(
    (SOURCE_CODE.match(/isSelf/g) ?? []).length,
    3,
    "isSelf is read somewhere beyond the trainee row type, the selector and isSelfRelevant",
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
  // EX-BEGINNER-EXAM-UI RE-POINT — `parentName`, `parentPhone` and `childNotes`
  // LEAVE THIS SWEEP, and only these three.
  //
  // The sweep ran over the WHOLE FILE while the only row this core described was
  // an ADVANCED assignment row, on which a parent contact would indeed have been
  // an unreviewed widening. The core now also describes the LIVE BEGINNER child,
  // and child/parent contact detail is carried to every authorized exam-access
  // role — trainees included — by the committed read layer's own locked
  // decision. Keeping the blanket claim would pin the opposite of that decision
  // and would be satisfied only by HIDING data the server deliberately sent.
  //
  // The claim is REPLACED, not weakened. Every identifier stays swept over the
  // whole file; the three contact fields are permitted ONLY inside the beginner
  // child contract, which is spelled out field-by-field below, so they cannot
  // appear on the assignment row, in the wave grouping or in the self-selector.
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
    "phone",
    "email",
    "grade",
    "rating",
    "feedback",
    "JSON.stringify",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the core names ${token}`);
  }
  // The assignment contract itself still names none of the three, so the
  // permission above reaches the beginner child and nothing else.
  for (const token of ["parentName", "parentPhone", "childNotes"]) {
    assert.equal(contract.includes(token), false, `the assignment row names ${token}`);
  }
});

// ===========================================================================
// 7. EX-TRAINEE-DATE-NAV — the earliest date, and the chronological order
// ===========================================================================

test("7. the earliest date is the chronologically first one, whatever the input order", () => {
  assert.equal(earliestExamDate(["2026-08-03", "2026-08-01", "2026-08-02"]), "2026-08-01");
  assert.equal(earliestExamDate(["2026-08-01"]), "2026-08-01");
  // Across a month and a year boundary — plain string order IS chronological for
  // a zero-padded YYYY-MM-DD token, which is the whole reason no Date is built.
  assert.equal(earliestExamDate(["2026-01-02", "2025-12-31"]), "2025-12-31");
  assert.equal(earliestExamDate(["2026-10-01", "2026-09-30"]), "2026-09-30");
});

test("7b. no dates at all yields null — never a fabricated default", () => {
  assert.equal(earliestExamDate([]), null);
  assert.equal(earliestExamDate(null), null);
  assert.equal(earliestExamDate(undefined), null);
});

test("7c. a blank or malformed entry is never chosen as the earliest", () => {
  assert.equal(earliestExamDate(["", "2026-08-02"]), "2026-08-02");
  assert.equal(earliestExamDate(["   ", "2026-08-02"]), "2026-08-02");
  assert.equal(
    earliestExamDate([null as unknown as string, "2026-08-02"]),
    "2026-08-02",
  );
  // ...and a list of nothing but junk yields null rather than junk.
  assert.equal(earliestExamDate(["", "  "]), null);
});

test("7d. the earliest date is derived from the loaded rows, through the same core", () => {
  const rows = [
    { date: "2026-08-03", definitionName: "רכיבה" },
    { date: "2026-08-01", definitionName: "ממשק" },
    { date: "2026-08-03", definitionName: "ממשק" },
  ];
  // `listExamDates` is first-appearance order and deliberately NOT sorted...
  assert.deepEqual(listExamDates(rows), ["2026-08-03", "2026-08-01"]);
  // ...so the default is the earliest of them, not the first of them.
  assert.equal(earliestExamDate(listExamDates(rows)), "2026-08-01");
});

test("8. blocks are ordered by start time ascending", () => {
  const rows = [
    { startTime: "12:00", id: "c" },
    { startTime: "08:30", id: "a" },
    { startTime: "09:15", id: "b" },
  ];
  assert.deepEqual(
    sortExamRowsByStartTime(rows).map((row) => row.id),
    ["a", "b", "c"],
  );
});

test("8b. equal start times keep the order they arrived in — the server's own", () => {
  const rows = [
    { startTime: "09:00", id: "first" },
    { startTime: "09:00", id: "second" },
    { startTime: "09:00", id: "third" },
    { startTime: "08:00", id: "earlier" },
  ];
  assert.deepEqual(
    sortExamRowsByStartTime(rows).map((row) => row.id),
    ["earlier", "first", "second", "third"],
  );
});

test("8c. an already-ordered contract is returned unchanged — the sort is a no-op", () => {
  const rows = [
    { startTime: "08:00", id: "a" },
    { startTime: "09:00", id: "b" },
    { startTime: "09:00", id: "c" },
    { startTime: "10:30", id: "d" },
  ];
  assert.deepEqual(
    sortExamRowsByStartTime(rows).map((row) => row.id),
    ["a", "b", "c", "d"],
  );
});

test("8d. a live beginner row and a stored block are ordered by the SAME one rule", () => {
  const rows = [
    { startTime: "10:00", id: "stored-late", source: "STORED" as const },
    { startTime: "08:00", id: "beginner-early", source: "BEGINNER" as const },
    { startTime: "09:00", id: "stored-mid", source: "STORED" as const },
    { startTime: "11:00", id: "beginner-late", source: "BEGINNER" as const },
  ];
  // Interleaved chronologically — never grouped into a beginner section.
  assert.deepEqual(
    sortExamRowsByStartTime(rows).map((row) => row.id),
    ["beginner-early", "stored-mid", "stored-late", "beginner-late"],
  );
});

test("8e. a malformed or absent start time sorts LAST and is never dropped", () => {
  const rows = [
    { startTime: "" as string, id: "blank" },
    { startTime: "09:00", id: "real" },
    { startTime: "not-a-time", id: "junk" },
  ];
  const ordered = sortExamRowsByStartTime(rows).map((row) => row.id);
  assert.equal(ordered[0], "real", "a defective row was promoted above a real one");
  assert.equal(ordered.length, 3, "a defective row was dropped from the schedule");
});

test("8f. the input array is never mutated, and null/undefined never throw", () => {
  const rows = [
    { startTime: "12:00", id: "c" },
    { startTime: "08:00", id: "a" },
  ];
  sortExamRowsByStartTime(rows);
  assert.deepEqual(rows.map((row) => row.id), ["c", "a"], "the caller's array was reordered");
  assert.deepEqual(sortExamRowsByStartTime(null), []);
  assert.deepEqual(sortExamRowsByStartTime(undefined), []);
  assert.deepEqual(sortExamRowsByStartTime([]), []);
});

test("8g. the sort reads the start time and NOTHING else", () => {
  // `orderIndex` and `sessionId` are the server's own tie-breaks. Re-deriving
  // them here would be a second schedule; the stable sort is what stands in for
  // them, so neither may be named.
  const sortBody = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function sortExamRowsByStartTime"),
    SOURCE_CODE.indexOf("export interface ExamScheduleFilter"),
  );
  for (const token of ["orderIndex", "sessionId", "date", "definitionName", "isSelf"]) {
    assert.equal(sortBody.includes(token), false, `the sort reads ${token}`);
  }
});

// ===========================================================================
// 9. EX-BEGINNER-EXAM-UI — beginner rows, told apart by the contract alone
// ===========================================================================

test("9. a beginner row is recognised by the contract's own source field", () => {
  assert.equal(isBeginnerExamRow({ source: "BEGINNER" }), true);
  assert.equal(isBeginnerExamRow({ source: "STORED" }), false);
  assert.equal(isBeginnerExamRow(null), false);
  assert.equal(isBeginnerExamRow(undefined), false);
});

test("9b. it is never INFERRED from an empty assignment list or a missing name", () => {
  // A stored block with nothing in it is still a stored block. If the predicate
  // guessed from emptiness, this would come back true and a real exam would grow
  // a Teaching-Practice banner.
  const emptyStoredBlock = {
    source: "STORED" as const,
    assignments: [],
    definitionName: null,
    beginner: null,
  };
  assert.equal(isBeginnerExamRow(emptyStoredBlock), false);
  // ...and the predicate's body reads exactly one field.
  const body = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function isBeginnerExamRow"),
    SOURCE_CODE.indexOf("export function countBeginnerRows"),
  );
  for (const token of ["assignments", "definitionName", "beginner.", "timetableStatus", "kind"]) {
    assert.equal(body.includes(token), false, `the predicate guesses from ${token}`);
  }
});

test("9c. the beginner format labels are exhaustive and in Hebrew", () => {
  assert.deepEqual(Object.keys(EXAM_BEGINNER_FORMAT_VIEW_LABELS).sort(), [
    "BEGINNER_GROUP",
    "BEGINNER_PRIVATE",
    "LUNGE",
  ]);
  assert.equal(examBeginnerFormatLabel("LUNGE"), "לונג");
  assert.equal(examBeginnerFormatLabel("BEGINNER_PRIVATE"), "מתחילים פרטני");
  assert.equal(examBeginnerFormatLabel("BEGINNER_GROUP"), "מתחילים קבוצתי");
});

test("9d. an unknown or proto-shaped format yields no label rather than a wrong one", () => {
  assert.equal(examBeginnerFormatLabel("SOMETHING_NEW"), null);
  assert.equal(examBeginnerFormatLabel(""), null);
  assert.equal(examBeginnerFormatLabel(null), null);
  assert.equal(examBeginnerFormatLabel(undefined), null);
  assert.equal(examBeginnerFormatLabel(42), null);
  // Own-property lookup: an inherited key is not a format.
  assert.equal(examBeginnerFormatLabel("__proto__"), null);
  assert.equal(examBeginnerFormatLabel("toString"), null);
  assert.equal(examBeginnerFormatLabel("constructor"), null);
});

test("9e. the beginner child contract carries the committed visibility decision", () => {
  const child = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface ExamBeginnerChildView"),
    SOURCE_CODE.indexOf("export interface ExamBeginnerDetailView"),
  );
  // EX-TRAINEE-ID-CONTAINMENT: `childAssignmentId` (a database primary key) is
  // REMOVED from the shared view; `childKey` (a positional display key) is the
  // replacement, and it carries no identity.
  assert.deepEqual(
    [...child.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    [
      "age",
      "childKey",
      "childNotes",
      "equipmentNotes",
      "fullName",
      "gender",
      "horseName",
      "isAbsent",
      "parentName",
      "parentPhone",
    ],
  );
});

test("9f. the beginner detail carries NO date and NO time of its own", () => {
  const detail = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface ExamBeginnerDetailView"),
    SOURCE_CODE.indexOf("export interface ExamSourcedRow"),
  );
  // The row's day and window are printed once, by the card that owns them. A
  // second copy in here is how two disagreeing times reach one screen.
  for (const token of ["date", "startTime", "endTime", "displayEndTime"]) {
    assert.equal(detail.includes(token), false, `the beginner detail carries ${token}`);
  }
  // The three operational-only fields are OPTIONAL, so a trainee contract that
  // does not carry them satisfies this type without anything being stubbed.
  for (const token of ["practiceType?:", "notes?:", "isPublished?:"]) {
    assert.ok(detail.includes(token), `${token} is not optional`);
  }
});

// ===========================================================================
// 10. EX-BEGINNER-EXAM-UI — "the server sent none" is not "the UI dropped them"
// ===========================================================================

const STORED_ROW = { source: "STORED" as const };
const BEGINNER_ROW = { source: "BEGINNER" as const };

test("10. zero beginner rows returned is reported as exactly that", () => {
  const summary = summarizeBeginnerRendering([STORED_ROW, STORED_ROW], [STORED_ROW, STORED_ROW]);
  assert.equal(summary.verdict, "NO_BEGINNER_ROWS_RETURNED");
  assert.equal(summary.loadedBeginnerCount, 0);
  assert.equal(summary.renderedBeginnerCount, 0);
});

test("10b. rows that ARRIVED and were not rendered are a DIFFERENT verdict", () => {
  const summary = summarizeBeginnerRendering([STORED_ROW, BEGINNER_ROW], [STORED_ROW]);
  assert.equal(summary.verdict, "BEGINNER_ROWS_NOT_RENDERED");
  assert.equal(summary.loadedBeginnerCount, 1);
  assert.equal(summary.renderedBeginnerCount, 0);
});

test("10c. rows that arrived and are on screen are reported as rendered", () => {
  const summary = summarizeBeginnerRendering(
    [STORED_ROW, BEGINNER_ROW],
    [STORED_ROW, BEGINNER_ROW],
  );
  assert.equal(summary.verdict, "BEGINNER_ROWS_RENDERED");
  assert.equal(summary.loadedBeginnerCount, 1);
  assert.equal(summary.renderedBeginnerCount, 1);
});

test("10d. a PARTIAL drop is visible in the counts, never rounded off", () => {
  const summary = summarizeBeginnerRendering(
    [BEGINNER_ROW, BEGINNER_ROW, BEGINNER_ROW],
    [BEGINNER_ROW],
  );
  // The verdict says rows ARE reaching the screen — which is true — and the two
  // unequal counts are what says two of them are not.
  assert.equal(summary.verdict, "BEGINNER_ROWS_RENDERED");
  assert.equal(summary.loadedBeginnerCount, 3);
  assert.equal(summary.renderedBeginnerCount, 1);
});

test("10e. an empty or absent contract is safe and reads as 'none returned'", () => {
  for (const empty of [[], null, undefined]) {
    const summary = summarizeBeginnerRendering(empty, empty);
    assert.equal(summary.verdict, "NO_BEGINNER_ROWS_RETURNED");
    assert.equal(summary.loadedBeginnerCount, 0);
    assert.equal(summary.renderedBeginnerCount, 0);
  }
  assert.equal(countBeginnerRows(null), 0);
  assert.equal(countBeginnerRows(undefined), 0);
  assert.equal(countBeginnerRows([]), 0);
});

test("6d. the derived singular pairing field is not read at all", () => {
  assert.equal(
    /pairedParticipantName\b(?!s)/.test(SOURCE_CODE),
    false,
    "the core reads the derived singular pairing field",
  );
});
