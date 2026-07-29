/**
 * EXAM EX-S4D — executable tests for the PURE trainee exam-day view core
 * (exam-trainee-view-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-trainee-view-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: that "לו״ז שלי" is LITERALLY "לו״ז כולל" filtered by `isSelf`
 * and shares its row objects; that the viewer is matched by authoritative
 * student id and by nothing else; that a stored personal time comes from the
 * viewer's own slot and is NEVER substituted with the block interval; that
 * beginner rows are read from their own live lesson interval without consulting
 * stored detail; that unresolved, detail-less and contradictory rows are hidden
 * with stable non-PII issues; the locked ordering and its independence from
 * input order; immutability and freezing; and that `ProjectionSession` was not
 * widened by this slice.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  projectTraineeExamDay,
  TRAINEE_EXAM_VIEW_MESSAGES,
  type StoredExamBlockDetail,
  type TraineeExamDayRow,
  type TraineeExamViewIssueCode,
} from "./exam-trainee-view-core";
import {
  projectByDate,
  type ProjectionSession,
} from "./exam-schedule-projection-core";

const CORE_PATH = join(import.meta.dirname, "exam-trainee-view-core.ts");
const CORE_SOURCE = readFileSync(CORE_PATH, "utf8");

/**
 * The core's source with its comments stripped. The structural guards must
 * assert on CODE, not on the prose documenting the very rules they enforce — the
 * file legitimately explains at length why names, `Date`, the conflict core and
 * block-interval fallbacks are excluded, and a naive text scan would fire on
 * every explanation.
 */
const CORE_CODE = CORE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const DATE = "2026-08-02";
const OTHER_DATE = "2026-08-03";
const VIEWER = "stu-viewer";

function session(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return {
    sessionId: "S1",
    kind: "INTERFACE_RIDING",
    beginnerFormat: null,
    date: DATE,
    startTime: "16:00",
    endTime: "17:00",
    orderIndex: 0,
    examineeStudentIds: [],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
    ...over,
  };
}

/** A stored, definition-backed block with a computed timetable. */
function stored(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return session({
    definitionId: "def-riding",
    definitionName: "רכיבה",
    derivedBlockEndTime: "19:00",
    timetableStatus: "OK",
    ...over,
  });
}

/** A live Teaching-Practice beginner row: no definition, no timetable, ever. */
function beginner(over: Partial<ProjectionSession> = {}): ProjectionSession {
  return session({
    sessionId: "tp:lesson-1",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "LUNGE",
    startTime: "16:00",
    endTime: "16:30",
    timetableStatus: "NOT_APPLICABLE",
    ...over,
  });
}

function detail(
  sessionId: string,
  slots: StoredExamBlockDetail["slots"],
): StoredExamBlockDetail {
  return { source: "STORED", sessionId, slots };
}

function lookup(...details: StoredExamBlockDetail[]): Map<string, StoredExamBlockDetail> {
  return new Map(details.map((d) => [d.sessionId, d]));
}

function codes(issues: readonly { code: TraineeExamViewIssueCode }[]): string[] {
  return issues.map((i) => i.code);
}

// ===========================================================================
// 1-4. One projection, two views
// ===========================================================================

test("1. לו״ז כולל includes every valid row on the selected date", () => {
  const rows = [
    stored({ sessionId: "A", startTime: "09:00", examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "B", startTime: "11:00", examineeStudentIds: ["stu-other"] }),
    beginner({ sessionId: "tp:1", startTime: "13:00", examineeStudentIds: ["stu-other"] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "09:00", endTime: "09:15" },
    ]),
    detail("B", [
      { assignmentId: "b1", studentId: "stu-other", role: "EXAMINEE", startTime: "11:00", endTime: "11:15" },
    ]),
  );

  const { allRows } = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.deepEqual(allRows.map((r) => r.session.sessionId), ["A", "B", "tp:1"]);
  assert.deepEqual(allRows.map((r) => r.isSelf), [true, false, false]);
});

test("2. לו״ז שלי equals allRows filtered by isSelf", () => {
  const rows = [
    stored({ sessionId: "A", startTime: "09:00", examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "B", startTime: "11:00", examineeStudentIds: ["stu-other"] }),
    beginner({ sessionId: "tp:1", startTime: "13:00", examineeStudentIds: [VIEWER] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "09:00", endTime: "09:15" },
    ]),
    detail("B", [
      { assignmentId: "b1", studentId: "stu-other", role: "EXAMINEE", startTime: "11:00", endTime: "11:15" },
    ]),
  );

  const { allRows, myRows } = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.deepEqual(myRows, allRows.filter((r) => r.isSelf));
  assert.deepEqual(myRows.map((r) => r.session.sessionId), ["A", "tp:1"]);
});

test("3. row object identity is shared between allRows and myRows", () => {
  const rows = [stored({ sessionId: "A", examineeStudentIds: [VIEWER] })];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:20" },
    ]),
  );

  const { allRows, myRows } = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.equal(myRows.length, 1);
  assert.equal(myRows[0], allRows[0], "the SAME row object, not a copy");
});

test("4. the ORIGINAL ProjectionSession object is carried through by reference", () => {
  const original = stored({ sessionId: "A", examineeStudentIds: [VIEWER] });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:20" },
    ]),
  );

  const { allRows, myRows } = projectTraineeExamDay([original], details, DATE, VIEWER);
  assert.equal(allRows[0].session, original, "never copied, spread or re-shaped");
  assert.equal(myRows[0].session, original);
});

// ===========================================================================
// 5-7. Exact personal times
// ===========================================================================

test("5. a stored EXAMINEE receives its EXACT slot time, not the block interval", () => {
  const row = stored({
    sessionId: "A",
    startTime: "16:00",
    endTime: "17:00",
    derivedBlockEndTime: "19:00",
    examineeStudentIds: ["stu-first", VIEWER],
  });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: "stu-first", role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
      { assignmentId: "a2", studentId: VIEWER, role: "EXAMINEE", startTime: "16:15", endTime: "16:30" },
    ]),
  );

  const { myRows } = projectTraineeExamDay([row], details, DATE, VIEWER);
  assert.equal(myRows.length, 1);
  assert.equal(myRows[0].selfRole, "EXAMINEE");
  assert.equal(myRows[0].selfStartTime, "16:15");
  assert.equal(myRows[0].selfEndTime, "16:30");
  // Explicitly NOT the block's own interval, and NOT the derived block end.
  assert.notEqual(myRows[0].selfStartTime, row.startTime);
  assert.notEqual(myRows[0].selfEndTime, row.endTime);
  assert.notEqual(myRows[0].selfEndTime, row.derivedBlockEndTime);
});

test("6. a stored INSTRUCTED_TRAINEE receives its inherited EXACT slot time", () => {
  const row = stored({
    sessionId: "A",
    examineeStudentIds: ["stu-examinee"],
    instructedTraineeStudentIds: [VIEWER],
  });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: "stu-examinee", role: "EXAMINEE", startTime: "16:30", endTime: "16:45" },
      // The inherited slot: same interval as the paired examinee, resolved
      // upstream and arriving here already computed.
      { assignmentId: "a2", studentId: VIEWER, role: "INSTRUCTED_TRAINEE", startTime: "16:30", endTime: "16:45" },
    ]),
  );

  const { myRows } = projectTraineeExamDay([row], details, DATE, VIEWER);
  assert.equal(myRows.length, 1);
  assert.equal(myRows[0].selfRole, "INSTRUCTED_TRAINEE");
  assert.equal(myRows[0].selfStartTime, "16:30");
  assert.equal(myRows[0].selfEndTime, "16:45");
});

test("7. a beginner participant receives the REAL lesson interval", () => {
  const row = beginner({
    sessionId: "tp:1",
    startTime: "16:00",
    endTime: "16:30",
    examineeStudentIds: ["stu-other", VIEWER],
  });

  const { myRows } = projectTraineeExamDay([row], lookup(), DATE, VIEWER);
  assert.equal(myRows.length, 1);
  assert.equal(myRows[0].selfRole, "EXAMINEE");
  assert.equal(myRows[0].selfStartTime, "16:00");
  assert.equal(myRows[0].selfEndTime, "16:30");
});

// ===========================================================================
// 8-11. Identity
// ===========================================================================

test("8. a beginner non-participant is not marked", () => {
  const row = beginner({ sessionId: "tp:1", examineeStudentIds: ["stu-other"] });

  const { allRows, myRows } = projectTraineeExamDay([row], lookup(), DATE, VIEWER);
  assert.equal(allRows.length, 1);
  assert.equal(allRows[0].isSelf, false);
  assert.equal(allRows[0].selfRole, null);
  assert.equal(allRows[0].selfStartTime, null);
  assert.equal(allRows[0].selfEndTime, null);
  assert.deepEqual(myRows, []);
});

test("9. a null viewer marks nobody and never throws", () => {
  const rows = [
    stored({ sessionId: "A", examineeStudentIds: [VIEWER] }),
    beginner({ sessionId: "tp:1", examineeStudentIds: [VIEWER] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );

  const result = projectTraineeExamDay(rows, details, DATE, null);
  assert.equal(result.allRows.length, 2);
  assert.ok(result.allRows.every((r) => r.isSelf === false));
  assert.deepEqual(result.myRows, []);
  assert.deepEqual(result.issues, []);

  // `undefined` behaves identically — an absent viewer, not an error.
  const undef = projectTraineeExamDay(rows, details, DATE, undefined);
  assert.deepEqual(undef.myRows, []);
  assert.equal(undef.allRows.length, 2);
});

test("10. a blank or whitespace-only viewer marks nobody", () => {
  const rows = [
    stored({ sessionId: "A", examineeStudentIds: [VIEWER, ""] }),
    beginner({ sessionId: "tp:1", examineeStudentIds: ["   "] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: "", role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
      { assignmentId: "a2", studentId: "  ", role: "EXAMINEE", startTime: "16:15", endTime: "16:30" },
    ]),
  );

  for (const blank of ["", "   ", "\t\n"]) {
    const result = projectTraineeExamDay(rows, details, DATE, blank);
    assert.deepEqual(result.myRows, [], `blank viewer ${JSON.stringify(blank)} marks nobody`);
    assert.equal(result.allRows.length, 2);
    assert.deepEqual(result.issues, []);
  }
});

test("11. matching is by student id only — never by any display name", () => {
  // The viewer id happens to equal nothing in the row except a NAME-shaped
  // value; nothing in this core reads a name, so nothing matches.
  const row = stored({
    sessionId: "A",
    definitionName: "דנה",
    examineeStudentIds: ["stu-other"],
  });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: "stu-other", role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );

  const byName = projectTraineeExamDay([row], details, DATE, "דנה");
  assert.deepEqual(byName.myRows, [], "a name is never an identity");

  // Nor by assignment id, nor by array position.
  assert.deepEqual(projectTraineeExamDay([row], details, DATE, "a1").myRows, []);
  assert.deepEqual(projectTraineeExamDay([row], details, DATE, "0").myRows, []);

  // The one thing that DOES match is the authoritative student id.
  const byId = projectTraineeExamDay([row], details, DATE, "stu-other");
  assert.equal(byId.myRows.length, 1);

  // And the core carries no name field at all in its input or output contract.
  assert.equal(/\bname\b/i.test(CORE_CODE), false, "no name field anywhere in the code");
});

// ===========================================================================
// 12-14. Date filtering and ordering
// ===========================================================================

test("12. rows from another date are excluded, with no issue", () => {
  const rows = [
    stored({ sessionId: "A", date: DATE, examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "B", date: OTHER_DATE, examineeStudentIds: [VIEWER] }),
    beginner({ sessionId: "tp:1", date: OTHER_DATE, examineeStudentIds: [VIEWER] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
    detail("B", [
      { assignmentId: "b1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );

  const result = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.deepEqual(result.allRows.map((r) => r.session.sessionId), ["A"]);
  assert.deepEqual(result.issues, [], "another date is not an error");

  // A blank selected date selects nothing rather than matching everything.
  assert.deepEqual(projectTraineeExamDay(rows, details, "  ", VIEWER).allRows, []);
});

test("13. rows sort by startTime, then orderIndex, then sessionId", () => {
  const rows = [
    stored({ sessionId: "Z", startTime: "10:00", orderIndex: 1 }),
    stored({ sessionId: "A", startTime: "10:00", orderIndex: 1 }),
    stored({ sessionId: "M", startTime: "10:00", orderIndex: 0 }),
    stored({ sessionId: "B", startTime: "09:00", orderIndex: 5 }),
  ];
  const details = lookup(
    ...["Z", "A", "M", "B"].map((id) => detail(id, [])),
  );

  const { allRows } = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.deepEqual(allRows.map((r) => r.session.sessionId), ["B", "M", "A", "Z"]);

  // Parity with the projection core's locked `projectByDate` order.
  assert.deepEqual(
    allRows.map((r) => r.session.sessionId),
    projectByDate(rows, DATE).map((s) => s.sessionId),
  );
});

test("14. output is independent of input order", () => {
  const rows = [
    stored({ sessionId: "Z", startTime: "10:00", orderIndex: 1 }),
    stored({ sessionId: "A", startTime: "10:00", orderIndex: 1 }),
    stored({ sessionId: "M", startTime: "10:00", orderIndex: 0 }),
    stored({ sessionId: "D", startTime: "09:00", orderIndex: 0 }),
    // Two rows that must be reported, to prove issue order is stable too.
    stored({ sessionId: "X" }),
    stored({ sessionId: "C" }),
  ];
  const details = lookup(...["Z", "A", "M", "D"].map((id) => detail(id, [])));

  const forward = projectTraineeExamDay(rows, details, DATE, VIEWER);
  const reversed = projectTraineeExamDay([...rows].reverse(), details, DATE, VIEWER);
  const shuffled = projectTraineeExamDay(
    [rows[3], rows[5], rows[0], rows[4], rows[2], rows[1]],
    details,
    DATE,
    VIEWER,
  );

  for (const other of [reversed, shuffled]) {
    assert.deepEqual(
      other.allRows.map((r) => r.session.sessionId),
      forward.allRows.map((r) => r.session.sessionId),
    );
    assert.deepEqual(other.issues, forward.issues);
  }
  assert.deepEqual(forward.issues.map((i) => i.sessionId), ["C", "X"]);
});

// ===========================================================================
// 15-19. Fail closed on stored rows
// ===========================================================================

test("15. a stored UNRESOLVED row is hidden even from its own participant", () => {
  const row = stored({
    sessionId: "A",
    timetableStatus: "UNRESOLVED",
    derivedBlockEndTime: null,
    examineeStudentIds: [VIEWER],
  });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );

  const result = projectTraineeExamDay([row], details, DATE, VIEWER);
  assert.deepEqual(result.allRows, []);
  assert.deepEqual(result.myRows, []);
  assert.deepEqual(result.issues, [], "a known admin-side state, not a view defect");
});

test("16. a stored row with missing detail is hidden and reported", () => {
  const rows = [
    stored({ sessionId: "A", examineeStudentIds: [VIEWER] }),
    // Legacy row with no timetableStatus at all: detail is still required.
    stored({ sessionId: "B", timetableStatus: undefined, derivedBlockEndTime: undefined }),
  ];

  const result = projectTraineeExamDay(rows, lookup(), DATE, VIEWER);
  assert.deepEqual(result.allRows, []);
  assert.deepEqual(codes(result.issues), [
    "EX-TRN-STORED-DETAIL-REQUIRED",
    "EX-TRN-STORED-DETAIL-REQUIRED",
  ]);
  assert.deepEqual(result.issues.map((i) => i.sessionId), ["A", "B"]);
  assert.equal(
    result.issues[0].message,
    TRAINEE_EXAM_VIEW_MESSAGES["EX-TRN-STORED-DETAIL-REQUIRED"],
  );

  // A detail entry keyed to another session, or not declaring itself stored, is
  // no detail at all.
  const mismatched = lookup(detail("OTHER", []));
  mismatched.set("A", detail("OTHER", []));
  assert.deepEqual(
    codes(projectTraineeExamDay([rows[0]], mismatched, DATE, VIEWER).issues),
    ["EX-TRN-STORED-DETAIL-REQUIRED"],
  );
  assert.equal(projectTraineeExamDay([rows[0]], undefined, DATE, VIEWER).allRows.length, 0);
});

test("17. duplicate slots for one student are hidden and reported", () => {
  const row = stored({ sessionId: "A", examineeStudentIds: [VIEWER] });
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
      { assignmentId: "a2", studentId: VIEWER, role: "EXAMINEE", startTime: "16:15", endTime: "16:30" },
    ]),
  );

  const result = projectTraineeExamDay([row], details, DATE, VIEWER);
  assert.deepEqual(result.allRows, []);
  assert.deepEqual(codes(result.issues), ["EX-TRN-DUPLICATE-STUDENT-SLOT"]);
  assert.equal(result.issues[0].sessionId, "A");
});

test("18. a malformed personal slot time is hidden and reported", () => {
  const row = stored({ sessionId: "A", examineeStudentIds: [VIEWER] });
  const malformed: readonly (readonly [string, string])[] = [
    ["", "16:15"],
    ["16:00", ""],
    ["25:00", "26:00"],
    ["16:60", "17:00"],
    ["9:00", "09:15"],
    ["16:15", "16:00"],
    ["16:00", "16:00"],
  ];

  for (const [startTime, endTime] of malformed) {
    const details = lookup(
      detail("A", [{ assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime, endTime }]),
    );
    const result = projectTraineeExamDay([row], details, DATE, VIEWER);
    assert.deepEqual(result.allRows, [], `${startTime}-${endTime} must be excluded`);
    assert.deepEqual(codes(result.issues), ["EX-TRN-INVALID-PERSONAL-TIME"]);
  }

  // An illegal role token fails closed the same way, under its own code.
  const badRole = lookup(
    detail("A", [
      {
        assignmentId: "a1",
        studentId: VIEWER,
        role: "OBSERVER" as unknown as "EXAMINEE",
        startTime: "16:00",
        endTime: "16:15",
      },
    ]),
  );
  assert.deepEqual(
    codes(projectTraineeExamDay([row], badRole, DATE, VIEWER).issues),
    ["EX-TRN-INVALID-PERSONAL-ROLE"],
  );
});

test("19. a missing viewer slot NEVER falls back to the block interval", () => {
  // (a) the viewer is declared on the row but has no slot: excluded, reported.
  const declared = stored({
    sessionId: "A",
    startTime: "16:00",
    endTime: "17:00",
    examineeStudentIds: [VIEWER],
  });
  const withoutSlot = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: "stu-other", role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );
  const conflict = projectTraineeExamDay([declared], withoutSlot, DATE, VIEWER);
  assert.deepEqual(conflict.allRows, []);
  assert.deepEqual(codes(conflict.issues), ["EX-TRN-SELF-ASSIGNMENT-CONFLICT"]);

  // (b) the mirror contradiction: a slot claims the viewer, the row does not.
  const undeclared = stored({ sessionId: "A", examineeStudentIds: ["stu-other"] });
  const claiming = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );
  assert.deepEqual(
    codes(projectTraineeExamDay([undeclared], claiming, DATE, VIEWER).issues),
    ["EX-TRN-SELF-ASSIGNMENT-CONFLICT"],
  );

  // (c) an ordinary non-participant row stays visible and unmarked, with NO
  //     time inherited from the block.
  const plain = projectTraineeExamDay([undeclared], withoutSlot, DATE, VIEWER);
  assert.equal(plain.allRows.length, 1);
  assert.equal(plain.allRows[0].isSelf, false);
  assert.equal(plain.allRows[0].selfStartTime, null);
  assert.equal(plain.allRows[0].selfEndTime, null);
  assert.deepEqual(plain.myRows, []);
});

// ===========================================================================
// 20-21. Beginner rows
// ===========================================================================

test("20. a beginner row neither requires nor consumes stored detail", () => {
  const row = beginner({
    sessionId: "tp:1",
    startTime: "16:00",
    endTime: "16:30",
    examineeStudentIds: [VIEWER],
  });

  // No detail map at all: still projected, still personal.
  for (const details of [lookup(), undefined, null]) {
    const result = projectTraineeExamDay([row], details, DATE, VIEWER);
    assert.equal(result.allRows.length, 1);
    assert.equal(result.myRows.length, 1);
    assert.equal(result.myRows[0].selfStartTime, "16:00");
    assert.equal(result.myRows[0].selfEndTime, "16:30");
    assert.deepEqual(result.issues, []);
  }

  // A beginner row with an empty examinee list is simply not personal.
  const empty = projectTraineeExamDay(
    [beginner({ sessionId: "tp:2", examineeStudentIds: [] })],
    lookup(),
    DATE,
    VIEWER,
  );
  assert.equal(empty.allRows.length, 1);
  assert.equal(empty.allRows[0].isSelf, false);
});

test("21. contradictory beginner stored-state is excluded and reported", () => {
  const contradictions: readonly Partial<ProjectionSession>[] = [
    { definitionId: "def-1" },
    { definitionName: "רכיבה" },
    { derivedBlockEndTime: "19:00" },
    { instructedTraineeStudentIds: ["stu-other"] },
  ];

  for (const over of contradictions) {
    const row = beginner({ sessionId: "tp:1", examineeStudentIds: [VIEWER], ...over });
    const result = projectTraineeExamDay([row], lookup(), DATE, VIEWER);
    assert.deepEqual(result.allRows, [], `excluded for ${JSON.stringify(over)}`);
    assert.deepEqual(codes(result.issues), ["EX-TRN-BEGINNER-STATE-CONFLICT"]);
    assert.equal(result.issues[0].sessionId, "tp:1");
  }

  // A stored detail entry for a live row is the same contradiction.
  const row = beginner({ sessionId: "tp:1", examineeStudentIds: [VIEWER] });
  const details = lookup(
    detail("tp:1", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:10" },
    ]),
  );
  const result = projectTraineeExamDay([row], details, DATE, VIEWER);
  assert.deepEqual(result.allRows, []);
  assert.deepEqual(codes(result.issues), ["EX-TRN-BEGINNER-STATE-CONFLICT"]);

  // A malformed live lesson interval fails closed for its participant too.
  const badTime = beginner({
    sessionId: "tp:3",
    startTime: "16:30",
    endTime: "16:00",
    examineeStudentIds: [VIEWER],
  });
  assert.deepEqual(
    codes(projectTraineeExamDay([badTime], lookup(), DATE, VIEWER).issues),
    ["EX-TRN-INVALID-PERSONAL-TIME"],
  );
});

test("21b. a beginner row must declare timetableStatus NOT_APPLICABLE explicitly", () => {
  // The one valid reading: the explicit value the live adapter always emits.
  const valid = projectTraineeExamDay(
    [
      beginner({
        sessionId: "tp:1",
        timetableStatus: "NOT_APPLICABLE",
        examineeStudentIds: [VIEWER],
      }),
    ],
    lookup(),
    DATE,
    VIEWER,
  );
  assert.equal(valid.allRows.length, 1);
  assert.equal(valid.myRows.length, 1);
  assert.equal(valid.myRows[0].selfStartTime, "16:00");
  assert.equal(valid.myRows[0].selfEndTime, "16:30");
  assert.deepEqual(valid.issues, []);

  // Everything else — absent, null, a stored status, or a token that could only
  // arrive from a malformed payload — fails closed. NOT_APPLICABLE is never
  // inferred and never defaulted.
  const invalidStatuses: readonly unknown[] = [
    undefined,
    null,
    "OK",
    "UNRESOLVED",
    "NOT-APPLICABLE",
    "not_applicable",
    "",
    7,
  ];

  for (const timetableStatus of invalidStatuses) {
    const row = beginner({
      sessionId: "tp:1",
      examineeStudentIds: [VIEWER],
      timetableStatus: timetableStatus as ProjectionSession["timetableStatus"],
    });
    const result = projectTraineeExamDay([row], lookup(), DATE, VIEWER);
    assert.deepEqual(
      result.allRows,
      [],
      `timetableStatus ${JSON.stringify(timetableStatus)} must exclude the row`,
    );
    assert.deepEqual(result.myRows, []);
    assert.deepEqual(codes(result.issues), ["EX-TRN-BEGINNER-STATE-CONFLICT"]);
    assert.equal(result.issues[0].sessionId, "tp:1");
  }

  // A row that simply never declares the property at all — not even as
  // `undefined` — is the same defect.
  const omitted: ProjectionSession = {
    sessionId: "tp:2",
    kind: "BEGINNER_INSTRUCTION",
    beginnerFormat: "LUNGE",
    date: DATE,
    startTime: "16:00",
    endTime: "16:30",
    orderIndex: 0,
    examineeStudentIds: [VIEWER],
    instructedTraineeStudentIds: [],
    beginnerChildCount: 0,
  };
  const missing = projectTraineeExamDay([omitted], lookup(), DATE, VIEWER);
  assert.deepEqual(missing.allRows, []);
  assert.deepEqual(codes(missing.issues), ["EX-TRN-BEGINNER-STATE-CONFLICT"]);

  // The core must not carry a default for it.
  assert.equal(
    /timetableStatus\s*(\?\?|\|\|)\s*"NOT_APPLICABLE"/.test(CORE_CODE),
    false,
    "NOT_APPLICABLE is never defaulted in",
  );
});

// ===========================================================================
// 22-25. Identity, immutability, freezing, determinism
// ===========================================================================

test("22. myRows contains the exact same row references as allRows", () => {
  const rows = [
    stored({ sessionId: "A", startTime: "09:00", examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "B", startTime: "10:00", examineeStudentIds: ["stu-other"] }),
    beginner({ sessionId: "tp:1", startTime: "11:00", examineeStudentIds: [VIEWER] }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "09:00", endTime: "09:15" },
    ]),
    detail("B", [
      { assignmentId: "b1", studentId: "stu-other", role: "EXAMINEE", startTime: "10:00", endTime: "10:15" },
    ]),
  );

  const { allRows, myRows } = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.equal(myRows.length, 2);
  for (const row of myRows) {
    assert.ok(allRows.includes(row), "reference-identical membership, not a rebuild");
  }
  // Relative order is preserved by filtering.
  assert.deepEqual(
    myRows.map((r) => allRows.indexOf(r)),
    [...myRows.map((r) => allRows.indexOf(r))].sort((a, b) => a - b),
  );
});

test("23. inputs are not mutated", () => {
  const rows = [
    stored({ sessionId: "Z", startTime: "10:00", examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "A", startTime: "09:00" }),
    beginner({ sessionId: "tp:1", examineeStudentIds: [VIEWER] }),
  ];
  const slots = [
    { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE" as const, startTime: "10:00", endTime: "10:15" },
  ];
  const details = lookup(detail("Z", slots), detail("A", []));

  const rowsBefore = JSON.stringify(rows);
  const orderBefore = rows.map((r) => r.sessionId);
  const slotsBefore = JSON.stringify(slots);
  const detailKeysBefore = [...details.keys()];

  projectTraineeExamDay(rows, details, DATE, VIEWER);

  assert.equal(JSON.stringify(rows), rowsBefore, "no session field may change");
  assert.deepEqual(rows.map((r) => r.sessionId), orderBefore, "the input array is not re-sorted");
  assert.equal(JSON.stringify(slots), slotsBefore, "no slot may change");
  assert.deepEqual([...details.keys()], detailKeysBefore, "the lookup is not written to");
  // The caller's own objects must NOT be frozen behind its back.
  assert.equal(Object.isFrozen(rows), false);
  assert.equal(Object.isFrozen(rows[0]), false);
  assert.equal(Object.isFrozen(slots), false);
});

test("24. the result, its arrays, its rows and its issues are frozen", () => {
  const rows = [
    stored({ sessionId: "A", examineeStudentIds: [VIEWER] }),
    stored({ sessionId: "B" }),
  ];
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );

  const result = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.ok(result.allRows.length > 0 && result.issues.length > 0, "sanity: both are non-empty");

  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.allRows));
  assert.ok(Object.isFrozen(result.myRows));
  assert.ok(Object.isFrozen(result.issues));
  assert.ok(result.allRows.every((r) => Object.isFrozen(r)));
  assert.ok(result.issues.every((i) => Object.isFrozen(i)));
  assert.ok(Object.isFrozen(TRAINEE_EXAM_VIEW_MESSAGES));

  // Frozen means frozen: a write throws in this strict ESM module.
  assert.throws(() => {
    (result.allRows as TraineeExamDayRow[]).push(result.allRows[0]);
  });
  assert.throws(() => {
    (result.myRows as TraineeExamDayRow[]).pop();
  });
});

test("25. issues are deterministic, non-PII and sorted by sessionId then code", () => {
  const rows = [
    stored({ sessionId: "X" }),
    stored({ sessionId: "C", examineeStudentIds: [VIEWER] }),
    beginner({ sessionId: "tp:1", definitionId: "def-1" }),
    stored({ sessionId: "A", examineeStudentIds: [VIEWER] }),
  ];
  const details = lookup(
    detail("C", [
      { assignmentId: "c1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:00" },
    ]),
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
      { assignmentId: "a2", studentId: VIEWER, role: "EXAMINEE", startTime: "16:15", endTime: "16:30" },
    ]),
  );

  const result = projectTraineeExamDay(rows, details, DATE, VIEWER);
  assert.deepEqual(result.issues.map((i) => [i.sessionId, i.code]), [
    ["A", "EX-TRN-DUPLICATE-STUDENT-SLOT"],
    ["C", "EX-TRN-INVALID-PERSONAL-TIME"],
    ["X", "EX-TRN-STORED-DETAIL-REQUIRED"],
    ["tp:1", "EX-TRN-BEGINNER-STATE-CONFLICT"],
  ]);

  // Every issue carries exactly the three agreed keys — no student id, no name,
  // no time, no title.
  for (const issue of result.issues) {
    assert.deepEqual(Object.keys(issue).sort(), ["code", "message", "sessionId"]);
    assert.equal(issue.message, TRAINEE_EXAM_VIEW_MESSAGES[issue.code]);
    assert.equal(issue.message.trim().length > 0, true, "every code carries a Hebrew message");
    assert.equal(issue.message.includes(VIEWER), false, "no student id leaks into an issue");
  }

  // Same input, same output — twice.
  assert.deepEqual(projectTraineeExamDay(rows, details, DATE, VIEWER).issues, result.issues);
});

// ===========================================================================
// 26-28. Source purity and contract guards
// ===========================================================================

test("26. the core is DB-free, Prisma-free, clock-free, env-free and IO-free", () => {
  for (const banned of [
    /\bnew Date\b/,
    /\bDate\.now\b/,
    /\bDate\s*\(/,
    /\bMath\.random\b/,
    /\bprisma\b/i,
    /@prisma\/client/,
    /\bprocess\.env\b/,
    /\bfetch\s*\(/,
    /\bnode:fs\b/,
    /\breadFileSync\b/,
    /\bcookies\s*\(/,
    /\bheaders\s*\(/,
    /"use server"/,
    /\brequire\s*\(/,
    /\bsetTimeout\b/,
    /\bteaching-practice\b/i,
  ]) {
    assert.equal(banned.test(CORE_CODE), false, `banned in the core: ${banned}`);
  }
});

test("26b. the core imports ONLY the projection core, and only as a type", () => {
  const imports = [...CORE_CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(imports)].sort(), ["./exam-schedule-projection-core"]);
  assert.ok(
    /import type \{[^}]*\} from "\.\/exam-schedule-projection-core"/.test(CORE_CODE),
    "the projection core must be a TYPE-only import",
  );
  assert.equal(
    /import \{[^}]*\} from "\.\/exam-schedule-projection-core"/.test(CORE_CODE),
    false,
    "no value import from the projection core",
  );
  // The conflict core is explicitly out of scope for this slice.
  assert.equal(/exam-conflict-core/.test(CORE_CODE), false);
});

test("27. no client identity, display-name or UI payload is accepted or emitted", () => {
  for (const banned of [
    /\bname\b/i,
    /\bclientStudentId\b/,
    /\bcontact/i,
    /\bphone/i,
    /\bcolor/i,
    /\bicon\b/i,
    /\bhref\b/i,
    /\broute/i,
    /\bphase\b/i,
    /\binterfaceSessionId\b/,
  ]) {
    assert.equal(banned.test(CORE_CODE), false, `banned in the core: ${banned}`);
  }

  // The row carries exactly the agreed keys and nothing else.
  const details = lookup(
    detail("A", [
      { assignmentId: "a1", studentId: VIEWER, role: "EXAMINEE", startTime: "16:00", endTime: "16:15" },
    ]),
  );
  const { allRows } = projectTraineeExamDay(
    [stored({ sessionId: "A", examineeStudentIds: [VIEWER] })],
    details,
    DATE,
    VIEWER,
  );
  assert.deepEqual(Object.keys(allRows[0]).sort(), [
    "isSelf",
    "selfEndTime",
    "selfRole",
    "selfStartTime",
    "session",
  ]);
});

test("28. ProjectionSession was NOT widened with slots / isSelf / detail fields", () => {
  const projectionSource = readFileSync(
    join(import.meta.dirname, "exam-schedule-projection-core.ts"),
    "utf8",
  );
  const match = projectionSource.match(/export interface ProjectionSession \{([\s\S]*?)\n\}/);
  assert.ok(match, "the ProjectionSession interface must be findable");
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const fields = [...body.matchAll(/readonly\s+([A-Za-z0-9_]+)\??\s*:/g)].map((m) => m[1]).sort();

  assert.deepEqual(fields, [
    "beginnerChildCount",
    "beginnerFormat",
    "date",
    "definitionId",
    "definitionName",
    "derivedBlockEndTime",
    "endTime",
    "examineeStudentIds",
    "instructedTraineeStudentIds",
    "kind",
    "orderIndex",
    "sessionId",
    "startTime",
    "timetableStatus",
  ]);
  for (const banned of ["slots", "slot", "isSelf", "detail", "selfRole", "selfStartTime"]) {
    assert.equal(fields.includes(banned), false, `ProjectionSession must not carry ${banned}`);
  }
});

// ===========================================================================
// Totality
// ===========================================================================

test("totality: empty, absent and malformed input yield an empty frozen result", () => {
  for (const input of [
    [],
    undefined as unknown as ProjectionSession[],
    null as unknown as ProjectionSession[],
    "nope" as unknown as ProjectionSession[],
    [null, undefined, 7, "x"] as unknown as ProjectionSession[],
    [session({ sessionId: "   " })],
  ]) {
    const result = projectTraineeExamDay(input, lookup(), DATE, VIEWER);
    assert.deepEqual(result.allRows, []);
    assert.deepEqual(result.myRows, []);
    assert.deepEqual(result.issues, []);
    assert.ok(Object.isFrozen(result));
  }
});
