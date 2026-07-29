/**
 * EXAM X0 / EX-S4A — executable tests for the PURE conflict-detection core
 * (exam-conflict-core.ts), aligned to the authoritative numbered matrix.
 *
 * Run with: npx tsx --test lib/exam/exam-conflict-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env.
 *
 * SCOPE OF PROOF (X0): every EX-BLK-0N and EX-WRN-0N code; unified examinee
 * double-booking (internal AND external under EX-BLK-01); examinee↔instructed
 * cross-role double-booking (EX-BLK-02); examinee==instructed within a session
 * (EX-BLK-03); duplicate nationalId in the plan (EX-BLK-04); horse / supervisor
 * / examiner-set (incl. different arenas) / arena overlaps; capacity; normalized
 * name-duplicate warning (EX-WRN-06); single staffing code with details
 * (EX-WRN-07); and STABLE ordering with no exact-duplicate entries.
 *
 * SCOPE OF PROOF (EX-S4A): SLOT granularity for EX-BLK-01/02 and EX-WRN-01 over
 * a definition-backed parallel block (real derived timetables, including a
 * positional break and an inherited instructed-trainee slot); the unresolved
 * pairing exclusion; the globally-unresolved whole-block fallback and its
 * TIMETABLE_UNRESOLVED token; horse normalization; live-beginner behaviour
 * (participants, responsible instructor, no examiner set, no arena comparison);
 * the beginner-to-beginner TP_OWNED downgrade; the block grain of
 * EX-WRN-02/03/04; and the legacy-only EX-WRN-05 condition.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectExamConflicts,
  EXAM_CONFLICT_MESSAGES,
  type ConflictSession,
  type ConflictAssignment,
  type ConflictAssignmentSlot,
  type ExamConflict,
  type ExamConflictCode,
} from "./exam-conflict-core";
import {
  computeExamBlockTimetable,
  resolveInstructedTraineeSlots,
} from "./exam-block-timetable-core";
import type { ParticipantRef } from "./exam-domain-core";

const D = "2026-07-26";

function internal(id: string): ParticipantRef {
  return { kind: "INTERNAL", studentId: id };
}
function external(id: string): ParticipantRef {
  return { kind: "EXTERNAL", candidateId: id };
}
function examinee(p: ParticipantRef): ConflictAssignment {
  return { role: "EXAMINEE", participant: p };
}
function instructed(p: ParticipantRef): ConflictAssignment {
  return { role: "INSTRUCTED_TRAINEE", participant: p };
}

function session(over: Partial<ConflictSession>): ConflictSession {
  return {
    sessionId: "s",
    interval: { date: D, start: "09:00", end: "10:00" },
    assignments: [],
    supervisorIds: ["sup-1"],
    examinerSetId: "eset-1",
    horseIds: [],
    arenaId: null,
    capacity: null,
    expectsStaffing: true,
    ...over,
  };
}

function codes(conflicts: readonly ExamConflict[]): ExamConflictCode[] {
  return conflicts.map((c) => c.code);
}
function hasCode(conflicts: readonly ExamConflict[], code: ExamConflictCode): boolean {
  return conflicts.some((c) => c.code === code);
}
function find(
  conflicts: readonly ExamConflict[],
  code: ExamConflictCode,
): ExamConflict | undefined {
  return conflicts.find((c) => c.code === code);
}

// --- EX-BLK-01: unified examinee double-booking ----------------------------

test("EX-BLK-01: internal examinee vs internal examinee in overlapping sessions", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", assignments: [examinee(shared)] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [examinee(shared)],
      }),
    ],
  });
  const blk = conflicts.find((c) => c.code === "EX-BLK-01");
  assert.ok(blk, "expected EX-BLK-01");
  assert.equal(blk!.severity, "BLOCK");
  assert.equal(blk!.subjectKind, "TRAINEE");
  assert.equal(blk!.subjectId, "INTERNAL:stu-1");
  assert.deepEqual([...blk!.sessionIds], ["a", "b"]);
  assert.equal(blk!.message, EXAM_CONFLICT_MESSAGES["EX-BLK-01"]);
});

test("EX-BLK-01: an external candidate double-booking is reported under EX-BLK-01, NOT a separate code", () => {
  const cand = external("ext-9");
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", assignments: [examinee(cand)] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:15", end: "09:45" },
        assignments: [examinee(cand)],
      }),
    ],
  });
  const blk = conflicts.find((c) => c.code === "EX-BLK-01");
  assert.ok(blk, "external double-booking must surface as EX-BLK-01");
  assert.equal(blk!.subjectKind, "CANDIDATE");
  assert.equal(blk!.subjectId, "EXTERNAL:ext-9");
  // No legacy separate external-only business code exists anymore.
  assert.equal(
    conflicts.every((c) => c.code === "EX-BLK-01" || c.code.startsWith("EX-WRN-")),
    true,
    "no separate external-candidate double-booking code",
  );
});

test("an examinee in NON-overlapping (touching) sessions is not double-booked", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", assignments: [examinee(shared)] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "10:00", end: "11:00" }, // touches, no overlap
        assignments: [examinee(shared)],
      }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-01"), false);
});

// --- EX-BLK-02: examinee in one, instructed trainee in another -------------

test("EX-BLK-02: internal examinee in one session and instructed trainee in another overlapping session", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", assignments: [examinee(shared)] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [instructed(shared)],
      }),
    ],
  });
  const blk = conflicts.find((c) => c.code === "EX-BLK-02");
  assert.ok(blk, "expected EX-BLK-02");
  assert.equal(blk!.severity, "BLOCK");
  assert.equal(blk!.subjectId, "INTERNAL:stu-1");
  assert.deepEqual([...blk!.sessionIds], ["a", "b"]);
  // This is NOT the same-examinee case, so EX-BLK-01 must not also fire here.
  assert.equal(hasCode(conflicts, "EX-BLK-01"), false);
});

// --- EX-BLK-03: examinee == instructed within one session ------------------

test("EX-BLK-03: the same person is examinee and instructed trainee within one session", () => {
  const self = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [session({ sessionId: "a", assignments: [examinee(self), instructed(self)] })],
  });
  const blk = conflicts.find((c) => c.code === "EX-BLK-03");
  assert.ok(blk, "expected EX-BLK-03");
  assert.equal(blk!.severity, "BLOCK");
  assert.equal(blk!.subjectId, "INTERNAL:stu-1");
  assert.deepEqual([...blk!.sessionIds], ["a"]);
  assert.equal(blk!.message, EXAM_CONFLICT_MESSAGES["EX-BLK-03"]);
});

test("distinct examinee and instructed trainee within one session is fine", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        assignments: [examinee(internal("examinee")), instructed(internal("pupil"))],
      }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-03"), false);
});

// --- EX-BLK-04: duplicate nationalId within the plan -----------------------

test("EX-BLK-04: two external-candidate records share one non-empty nationalId", () => {
  const conflicts = detectExamConflicts({
    sessions: [],
    externalCandidates: [
      { candidateId: "ext-1", nationalId: "123", normalizedName: "דנה כהן" },
      { candidateId: "ext-2", nationalId: "123", normalizedName: "דנה כהן" },
      { candidateId: "ext-3", nationalId: "999", normalizedName: "רון לוי" },
    ],
  });
  const dup = conflicts.filter((c) => c.code === "EX-BLK-04");
  assert.equal(dup.length, 1, "only the shared nationalId is a duplicate");
  assert.equal(dup[0].subjectId, "123");
  assert.equal(dup[0].severity, "BLOCK");
  // A confirmed nationalId match suppresses the name warning for that pair.
  assert.equal(hasCode(conflicts, "EX-WRN-06"), false);
});

// --- EX-WRN-01..04: resource overlaps --------------------------------------

test("EX-WRN-01: overlapping sessions share a horse", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", horseIds: ["h1", "h2"] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        horseIds: ["h2", "h3"],
      }),
    ],
  });
  const w = conflicts.find((c) => c.code === "EX-WRN-01");
  assert.ok(w);
  assert.equal(w!.severity, "WARN");
  assert.equal(w!.subjectId, "h2");
});

test("EX-WRN-02: overlapping sessions share a supervising instructor", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", supervisorIds: ["sup-x"] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        supervisorIds: ["sup-x"],
      }),
    ],
  });
  const w = conflicts.find((c) => c.code === "EX-WRN-02");
  assert.ok(w);
  assert.equal(w!.subjectId, "sup-x");
});

test("EX-WRN-03: the same examiner set overlaps EVEN IN DIFFERENT ARENAS (warning, not block)", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", examinerSetId: "eset-7", arenaId: "arena-1" }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        examinerSetId: "eset-7",
        arenaId: "arena-2", // DIFFERENT arena
      }),
    ],
  });
  const w = conflicts.find((c) => c.code === "EX-WRN-03");
  assert.ok(w, "shared examiner set across different arenas must still warn");
  assert.equal(w!.severity, "WARN", "examiner-set overlap is a WARNING, never a block");
  assert.equal(w!.subjectId, "eset-7");
  // Different arenas ⇒ no arena overlap.
  assert.equal(hasCode(conflicts, "EX-WRN-04"), false);
});

test("EX-WRN-04: overlapping sessions share an arena", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", arenaId: "arena-1" }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        arenaId: "arena-1",
      }),
    ],
  });
  const w = conflicts.find((c) => c.code === "EX-WRN-04");
  assert.ok(w);
  assert.equal(w!.subjectId, "arena-1");
});

// --- EX-WRN-05: capacity ---------------------------------------------------

test("EX-WRN-05: examinee count exceeds capacity; exactly-at-capacity is fine", () => {
  const over = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        capacity: 1,
        assignments: [examinee(internal("s1")), examinee(internal("s2"))],
      }),
    ],
  });
  assert.ok(hasCode(over, "EX-WRN-05"));

  const atCap = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        capacity: 2,
        assignments: [examinee(internal("s1")), examinee(internal("s2"))],
      }),
    ],
  });
  assert.equal(hasCode(atCap, "EX-WRN-05"), false);
});

// --- EX-WRN-06: normalized-name duplicate warning --------------------------

test("EX-WRN-06: same normalized name with NO nationalId warns as a possible duplicate", () => {
  const conflicts = detectExamConflicts({
    sessions: [],
    externalCandidates: [
      { candidateId: "ext-1", nationalId: null, normalizedName: "דנה כהן" },
      { candidateId: "ext-2", nationalId: null, normalizedName: "דנה כהן" },
    ],
  });
  const w = conflicts.filter((c) => c.code === "EX-WRN-06");
  assert.equal(w.length, 1);
  assert.equal(w[0].severity, "WARN");
  assert.equal(w[0].subjectId, "דנה כהן");
  assert.equal(w[0].message, EXAM_CONFLICT_MESSAGES["EX-WRN-06"]);
  // No confirmed identity ⇒ no hard duplicate.
  assert.equal(hasCode(conflicts, "EX-BLK-04"), false);
});

test("EX-WRN-06: same name with DIFFERENT nationalIds still warns (no confirmed match)", () => {
  const conflicts = detectExamConflicts({
    sessions: [],
    externalCandidates: [
      { candidateId: "ext-1", nationalId: "111", normalizedName: "דנה כהן" },
      { candidateId: "ext-2", nationalId: "222", normalizedName: "דנה כהן" },
    ],
  });
  assert.equal(hasCode(conflicts, "EX-WRN-06"), true);
  assert.equal(hasCode(conflicts, "EX-BLK-04"), false);
});

test("EX-WRN-06 is suppressed when the same name shares a confirmed nationalId (that is EX-BLK-04)", () => {
  const conflicts = detectExamConflicts({
    sessions: [],
    externalCandidates: [
      { candidateId: "ext-1", nationalId: "123", normalizedName: "דנה כהן" },
      { candidateId: "ext-2", nationalId: "123", normalizedName: "דנה כהן" },
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-04"), true);
  assert.equal(hasCode(conflicts, "EX-WRN-06"), false);
});

test("a unique name does not warn", () => {
  const conflicts = detectExamConflicts({
    sessions: [],
    externalCandidates: [
      { candidateId: "ext-1", nationalId: null, normalizedName: "דנה כהן" },
      { candidateId: "ext-2", nationalId: null, normalizedName: "רון לוי" },
    ],
  });
  assert.equal(hasCode(conflicts, "EX-WRN-06"), false);
});

// --- EX-WRN-07: single staffing code with details --------------------------

test("EX-WRN-07: missing supervisor only ⇒ one code, details=['SUPERVISOR']", () => {
  const conflicts = detectExamConflicts({
    sessions: [session({ sessionId: "a", supervisorIds: [], examinerSetId: "eset-1" })],
  });
  const w = conflicts.filter((c) => c.code === "EX-WRN-07");
  assert.equal(w.length, 1);
  assert.deepEqual([...w[0].details], ["SUPERVISOR"]);
});

test("EX-WRN-07: missing examiner set only ⇒ one code, details=['EXAMINER_SET']", () => {
  const conflicts = detectExamConflicts({
    sessions: [session({ sessionId: "a", supervisorIds: ["sup-1"], examinerSetId: null })],
  });
  const w = conflicts.filter((c) => c.code === "EX-WRN-07");
  assert.equal(w.length, 1);
  assert.deepEqual([...w[0].details], ["EXAMINER_SET"]);
});

test("EX-WRN-07: both missing ⇒ still ONE code with both details (no duplicate business codes)", () => {
  const conflicts = detectExamConflicts({
    sessions: [session({ sessionId: "a", supervisorIds: [], examinerSetId: null })],
  });
  const w = conflicts.filter((c) => c.code === "EX-WRN-07");
  assert.equal(w.length, 1, "exactly one staffing warning code");
  assert.deepEqual([...w[0].details], ["SUPERVISOR", "EXAMINER_SET"]);
  // There is no second, separate staffing code.
  assert.equal(
    conflicts.filter((c) => c.code === "EX-WRN-07").length,
    1,
  );
});

test("EX-WRN-07 does not fire when the session does not expect staffing", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", supervisorIds: [], examinerSetId: null, expectsStaffing: false }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-WRN-07"), false);
});

test("EX-WRN-07 does not fire when staffing is complete", () => {
  const conflicts = detectExamConflicts({
    sessions: [session({ sessionId: "a", supervisorIds: ["sup-1"], examinerSetId: "eset-1" })],
  });
  assert.equal(hasCode(conflicts, "EX-WRN-07"), false);
});

// --- every approved code is reachable and messaged -------------------------

test("every EX-BLK-0N and EX-WRN-0N code is reachable and carries a Hebrew message", () => {
  const allCodes: ExamConflictCode[] = [
    "EX-BLK-01",
    "EX-BLK-02",
    "EX-BLK-03",
    "EX-BLK-04",
    "EX-WRN-01",
    "EX-WRN-02",
    "EX-WRN-03",
    "EX-WRN-04",
    "EX-WRN-05",
    "EX-WRN-06",
    "EX-WRN-07",
  ];
  for (const code of allCodes) {
    assert.equal(typeof EXAM_CONFLICT_MESSAGES[code], "string");
    assert.ok(EXAM_CONFLICT_MESSAGES[code].length > 0, code);
  }

  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        interval: { date: D, start: "09:00", end: "11:00" },
        assignments: [
          examinee(internal("stu-shared")), // EX-BLK-01 (with b) + EX-BLK-02 target
          examinee(external("ext-shared")), // EX-BLK-01 (with b)
          examinee(internal("selfie")),
          instructed(internal("selfie")), // EX-BLK-03 (within a)
        ],
        supervisorIds: ["sup-1"],
        examinerSetId: "eset-1",
        horseIds: ["h1"],
        arenaId: "arena-1",
        capacity: 1, // 3 examinees > 1 ⇒ EX-WRN-05 (legacy: no definitionId)
        expectsStaffing: true,
      }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [
          examinee(external("ext-shared")), // EX-BLK-01
          instructed(internal("stu-shared")), // EX-BLK-02 (examinee in a, instructed in b)
        ],
        supervisorIds: ["sup-1"], // EX-WRN-02
        examinerSetId: "eset-1", // EX-WRN-03
        horseIds: ["h1"], // EX-WRN-01
        arenaId: "arena-1", // EX-WRN-04
        capacity: null,
        expectsStaffing: true,
      }),
      session({
        sessionId: "c",
        interval: { date: D, start: "14:00", end: "15:00" },
        assignments: [],
        supervisorIds: [], // EX-WRN-07
        examinerSetId: null,
        horseIds: [],
        arenaId: null,
        capacity: null,
        expectsStaffing: true,
      }),
    ],
    externalCandidates: [
      { candidateId: "ext-A", nationalId: "555", normalizedName: "שם כפול" }, // EX-BLK-04
      { candidateId: "ext-B", nationalId: "555", normalizedName: "שם כפול" },
      { candidateId: "ext-C", nationalId: null, normalizedName: "שם ללא זהות" }, // EX-WRN-06
      { candidateId: "ext-D", nationalId: null, normalizedName: "שם ללא זהות" },
    ],
  });

  const seen = new Set(codes(conflicts));
  for (const code of allCodes) {
    assert.ok(seen.has(code), `expected code not produced: ${code}`);
  }
});

// --- stable ordering + de-duplication + immutability -----------------------

test("output is stably ordered (BLOCK before WARN) and deterministic across runs", () => {
  const build = () =>
    detectExamConflicts({
      sessions: [
        session({ sessionId: "a", assignments: [examinee(internal("s1"))], horseIds: ["h1"] }),
        session({
          sessionId: "b",
          interval: { date: D, start: "09:30", end: "10:30" },
          assignments: [examinee(internal("s1"))],
          horseIds: ["h1"],
        }),
      ],
    });
  const first = build();
  const second = build();
  assert.deepEqual(codes(first), codes(second), "deterministic across runs");

  const severities = first.map((c) => c.severity);
  const firstWarn = severities.indexOf("WARN");
  if (firstWarn !== -1) {
    assert.equal(
      severities.slice(firstWarn).every((s) => s === "WARN"),
      true,
      "no BLOCK appears after the first WARN",
    );
  }
});

test("no exact-duplicate conflict entries are emitted", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({ sessionId: "a", horseIds: ["h1", "h1"], assignments: [examinee(internal("s1"))] }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        horseIds: ["h1"],
        assignments: [examinee(internal("s1"))],
      }),
    ],
  });
  const keys = conflicts.map(
    (c) => `${c.code}|${c.subjectId ?? ""}|${[...c.sessionIds].join(",")}`,
  );
  assert.equal(new Set(keys).size, keys.length, "conflict tuples must be unique");
});

test("detectExamConflicts does not mutate its input", () => {
  const input = {
    sessions: [
      session({ sessionId: "a", assignments: [examinee(internal("s1"))], horseIds: ["h1"] }),
    ],
    externalCandidates: [{ candidateId: "ext-1", nationalId: "1", normalizedName: "x" }],
  };
  const snapshot = JSON.stringify(input);
  detectExamConflicts(input);
  assert.equal(JSON.stringify(input), snapshot);
});

// ===========================================================================
// EX-S4A — slot-aware granularity
// ===========================================================================

/**
 * The canonical definition-backed block used below: start 09:00, 15 minutes per
 * examinee, two examined at a time, six waves.
 *   wave 0 — a1,a2 — 09:00-09:15   …   wave 5 — a11,a12 — 10:15-10:30
 * The stored block interval is the whole 09:00-10:30.
 */
const SIX_WAVE_IDS = [
  "a1",
  "a2",
  "a3",
  "a4",
  "a5",
  "a6",
  "a7",
  "a8",
  "a9",
  "a10",
  "a11",
  "a12",
] as const;

function sixWaveTimetable() {
  return computeExamBlockTimetable({
    blockStartTime: "09:00",
    durationMinutes: 15,
    parallelCapacity: 2,
    examinees: SIX_WAVE_IDS.map((assignmentId, index) => ({ assignmentId, orderIndex: index })),
  });
}

/** A definition-backed stored block with derived slots attached. */
function storedBlock(
  over: Partial<ConflictSession> & { readonly slots: readonly ConflictAssignmentSlot[] },
): ConflictSession {
  return session({
    definitionId: "def-1",
    source: "STORED",
    timetableStatus: "OK",
    ...over,
  });
}

/** A live Teaching-Practice beginner row: its own real lesson interval. */
function beginnerRow(over: Partial<ConflictSession>): ConflictSession {
  return session({
    source: "BEGINNER",
    definitionId: null,
    supervisorIds: [],
    examinerSetId: null,
    expectsStaffing: false,
    ...over,
  });
}

// --- 1/2/3: participant slot granularity -----------------------------------

test("S4A-1: a wave-1 examinee does NOT conflict with an event occurring only during wave 6", () => {
  const tt = sixWaveTimetable();
  assert.equal(tt.ok, true);
  assert.equal(tt.waveCount, 6);
  assert.equal(tt.waves[0].startTime, "09:00");
  assert.equal(tt.waves[5].startTime, "10:15");

  const wave1Trainee = internal("stu-wave1");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        // a1 is in wave 0 (09:00-09:15).
        assignments: [{ ...examinee(wave1Trainee), assignmentId: "a1" }],
      }),
      session({
        sessionId: "late",
        // Overlaps the BLOCK, but only during the last wave.
        interval: { date: D, start: "10:15", end: "10:30" },
        assignments: [examinee(wave1Trainee)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(
    hasCode(conflicts, "EX-BLK-01"),
    false,
    "the whole-block interval must not be used for a participant",
  );
});

test("S4A-2: a genuine same-slot overlap is still reported", () => {
  const tt = sixWaveTimetable();
  const wave1Trainee = internal("stu-wave1");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        assignments: [{ ...examinee(wave1Trainee), assignmentId: "a1" }],
      }),
      session({
        sessionId: "early",
        interval: { date: D, start: "09:05", end: "09:20" }, // inside wave 0
        assignments: [examinee(wave1Trainee)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  const blk = find(conflicts, "EX-BLK-01");
  assert.ok(blk, "expected a real slot overlap to be reported");
  assert.equal(blk!.severity, "BLOCK");
  assert.equal(blk!.subjectId, "INTERNAL:stu-wave1");
  assert.deepEqual([...blk!.details], [], "a resolved slot carries no fallback token");
});

test("S4A-3: touching slot boundaries are NOT an overlap", () => {
  const tt = sixWaveTimetable();
  const trainee = internal("stu-wave1");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        assignments: [{ ...examinee(trainee), assignmentId: "a1" }], // 09:00-09:15
      }),
      session({
        sessionId: "next",
        interval: { date: D, start: "09:15", end: "09:30" }, // starts exactly at slot end
        assignments: [examinee(trainee)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-01"), false);
});

// --- 4/5: instructed-trainee inheritance and unresolved pairing ------------

/** A two-wave block: a1 09:00-09:15 (pairing 1), a2 09:15-09:30 (pairing 2). */
function pairedBlockTimetable() {
  return computeExamBlockTimetable({
    blockStartTime: "09:00",
    durationMinutes: 15,
    parallelCapacity: 1,
    examinees: [
      { assignmentId: "a1", orderIndex: 0 },
      { assignmentId: "a2", orderIndex: 1 },
    ],
  });
}

test("S4A-4: an instructed trainee is compared on its INHERITED slot, not the block", () => {
  const tt = pairedBlockTimetable();
  const inherited = resolveInstructedTraineeSlots(
    tt,
    [
      { assignmentId: "a1", pairingIndex: 1 },
      { assignmentId: "a2", pairingIndex: 2 },
    ],
    [{ assignmentId: "i2", pairingIndex: 2 }],
  );
  assert.equal(inherited.length, 1);
  assert.equal(inherited[0].startTime, "09:15");
  assert.equal(inherited[0].endTime, "09:30");

  const pupil = internal("stu-pupil");
  const block = storedBlock({
    sessionId: "block",
    interval: { date: D, start: "09:00", end: "09:30" },
    slots: [...tt.slots, ...inherited],
    assignments: [
      { ...examinee(internal("stu-e1")), assignmentId: "a1" },
      { ...examinee(internal("stu-e2")), assignmentId: "a2" },
      { ...instructed(pupil), assignmentId: "i2" },
    ],
  });

  const duringInherited = detectExamConflicts({
    sessions: [
      block,
      session({
        sessionId: "other",
        interval: { date: D, start: "09:20", end: "09:40" },
        assignments: [examinee(pupil)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  const blk = find(duringInherited, "EX-BLK-02");
  assert.ok(blk, "the inherited slot must be compared");
  assert.equal(blk!.subjectId, "INTERNAL:stu-pupil");

  const beforeInherited = detectExamConflicts({
    sessions: [
      block,
      session({
        sessionId: "other",
        interval: { date: D, start: "09:00", end: "09:15" }, // the OTHER wave
        assignments: [examinee(pupil)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(
    hasCode(beforeInherited, "EX-BLK-02"),
    false,
    "the instructed trainee is not present during the paired examinee's other wave",
  );
});

test("S4A-5: an UNRESOLVED individual pairing does not fall back to the block interval", () => {
  const tt = pairedBlockTimetable();
  const orphan = internal("stu-orphan");
  const inherited = resolveInstructedTraineeSlots(
    tt,
    [
      { assignmentId: "a1", pairingIndex: 1 },
      { assignmentId: "a2", pairingIndex: 2 },
    ],
    [{ assignmentId: "i9", pairingIndex: 99 }], // matches no examinee
  );
  assert.equal(inherited.length, 0, "an unmatched pairing resolves no slot");

  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "09:30" },
        slots: tt.slots,
        assignments: [
          { ...examinee(internal("stu-e1")), assignmentId: "a1" },
          { ...examinee(internal("stu-e2")), assignmentId: "a2" },
          { ...instructed(orphan), assignmentId: "i9" },
        ],
      }),
      session({
        sessionId: "other",
        interval: { date: D, start: "09:00", end: "09:30" }, // the WHOLE block
        assignments: [examinee(orphan)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(
    hasCode(conflicts, "EX-BLK-02"),
    false,
    "an unresolved pairing must not inherit the whole-block interval",
  );
  assert.equal(
    conflicts.some((c) => c.details.includes("TIMETABLE_UNRESOLVED")),
    false,
    "an individual pairing problem is not a timetable failure",
  );
});

// --- 6: globally unresolved timetable --------------------------------------

test("S4A-6: a globally UNRESOLVED timetable falls back to the block and tags TIMETABLE_UNRESOLVED", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        timetableStatus: "UNRESOLVED",
        slots: [],
        assignments: [{ ...examinee(shared), assignmentId: "a1", horse: "Rex" }],
      }),
      session({
        sessionId: "late",
        interval: { date: D, start: "10:15", end: "10:30" },
        assignments: [examinee(shared)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
        horseIds: ["Rex"],
      }),
    ],
  });
  const blk = find(conflicts, "EX-BLK-01");
  assert.ok(blk, "conflicts must NOT be dropped when the timetable fails");
  assert.deepEqual([...blk!.details], ["TIMETABLE_UNRESOLVED"]);

  const horse = find(conflicts, "EX-WRN-01");
  assert.ok(horse, "horses fall back too");
  assert.deepEqual([...horse!.details], ["TIMETABLE_UNRESOLVED"]);
  assert.equal(horse!.subjectId, "rex");
});

test("S4A-6b: a definition-backed block with no slots at all defaults to the conservative fallback", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "block",
        definitionId: "def-1",
        interval: { date: D, start: "09:00", end: "10:30" },
        assignments: [{ ...examinee(shared), assignmentId: "a1" }],
      }),
      session({
        sessionId: "late",
        interval: { date: D, start: "10:15", end: "10:30" },
        assignments: [examinee(shared)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  const blk = find(conflicts, "EX-BLK-01");
  assert.ok(blk, "an absent timetable fails closed to the block interval");
  assert.deepEqual([...blk!.details], ["TIMETABLE_UNRESOLVED"]);
});

// --- 6c: a globally unresolved timetable is NOT an unresolved pairing -------

/**
 * A definition-backed block whose timetable failed globally (an invalid
 * duration/capacity/start), so NO slot exists for anybody. `pairingIndex` is
 * then the only thing that can still place an instructed trainee.
 */
function failedTimetableBlock(
  instructedAssignment: ConflictAssignment,
  over: Partial<ConflictSession> = {},
): ConflictSession {
  return session({
    sessionId: "block",
    definitionId: "def-1",
    source: "STORED",
    timetableStatus: "UNRESOLVED",
    slots: [],
    interval: { date: D, start: "09:00", end: "10:30" },
    assignments: [
      { ...examinee(internal("stu-e1")), assignmentId: "a1", pairingIndex: 1 },
      { ...examinee(internal("stu-e2")), assignmentId: "a2", pairingIndex: 2 },
      instructedAssignment,
    ],
    ...over,
  });
}

/** The counterpart session, overlapping only the tail of the failed block. */
function lateCounterpart(over: Partial<ConflictSession> = {}): ConflictSession {
  return session({
    sessionId: "late",
    interval: { date: D, start: "10:15", end: "10:30" },
    supervisorIds: ["sup-other"],
    examinerSetId: "eset-other",
    ...over,
  });
}

test("S4A-6c-1: globally unresolved timetable + VALID instructed pairing ⇒ block fallback + token", () => {
  const pupil = internal("stu-pupil");
  const conflicts = detectExamConflicts({
    sessions: [
      failedTimetableBlock({ ...instructed(pupil), assignmentId: "i2", pairingIndex: 2 }),
      lateCounterpart({ assignments: [examinee(pupil)] }),
    ],
  });
  const blk = find(conflicts, "EX-BLK-02");
  assert.ok(
    blk,
    "a uniquely paired instructed trainee is still KNOWN to be in the block — only un-timed",
  );
  assert.equal(blk!.severity, "BLOCK");
  assert.equal(blk!.subjectId, "INTERNAL:stu-pupil");
  assert.deepEqual([...blk!.details], ["TIMETABLE_UNRESOLVED"]);
});

test("S4A-6c-2: globally unresolved timetable + VALID instructed pairing ⇒ its horse falls back too", () => {
  const pupil = internal("stu-pupil");
  const conflicts = detectExamConflicts({
    sessions: [
      failedTimetableBlock({
        ...instructed(pupil),
        assignmentId: "i2",
        pairingIndex: 2,
        horse: "Rex",
      }),
      lateCounterpart({ horseIds: ["rex"] }),
    ],
  });
  const horse = find(conflicts, "EX-WRN-01");
  assert.ok(horse, "the instructed trainee's horse takes the same conservative fallback");
  assert.equal(horse!.subjectId, "rex");
  assert.deepEqual([...horse!.details], ["TIMETABLE_UNRESOLVED"]);
});

test("S4A-6c-3: globally unresolved timetable + ABSENT pairing ⇒ excluded, no false conflicts", () => {
  const orphan = internal("stu-orphan");
  const conflicts = detectExamConflicts({
    sessions: [
      failedTimetableBlock({ ...instructed(orphan), assignmentId: "i9", horse: "Rex" }),
      lateCounterpart({ assignments: [examinee(orphan)], horseIds: ["rex"] }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-02"), false, "no participant fallback");
  assert.equal(hasCode(conflicts, "EX-WRN-01"), false, "no horse fallback");
});

test("S4A-6c-4: globally unresolved timetable + UNMATCHED pairing ⇒ same exclusion", () => {
  const orphan = internal("stu-orphan");
  const unmatched = detectExamConflicts({
    sessions: [
      failedTimetableBlock({
        ...instructed(orphan),
        assignmentId: "i9",
        pairingIndex: 99, // matches no examinee
        horse: "Rex",
      }),
      lateCounterpart({ assignments: [examinee(orphan)], horseIds: ["rex"] }),
    ],
  });
  assert.equal(hasCode(unmatched, "EX-BLK-02"), false);
  assert.equal(hasCode(unmatched, "EX-WRN-01"), false);

  // An AMBIGUOUS pairing — claimed by two examinees — identifies neither.
  const ambiguous = detectExamConflicts({
    sessions: [
      session({
        sessionId: "block",
        definitionId: "def-1",
        source: "STORED",
        timetableStatus: "UNRESOLVED",
        slots: [],
        interval: { date: D, start: "09:00", end: "10:30" },
        assignments: [
          { ...examinee(internal("stu-e1")), assignmentId: "a1", pairingIndex: 1 },
          { ...examinee(internal("stu-e2")), assignmentId: "a2", pairingIndex: 1 }, // same index
          { ...instructed(orphan), assignmentId: "i1", pairingIndex: 1, horse: "Rex" },
        ],
      }),
      lateCounterpart({ assignments: [examinee(orphan)], horseIds: ["rex"] }),
    ],
  });
  assert.equal(hasCode(ambiguous, "EX-BLK-02"), false);
  assert.equal(hasCode(ambiguous, "EX-WRN-01"), false);
  // The examinees themselves still take the fallback — only the pupil is unplaced.
  assert.equal(
    ambiguous.every((c) => c.code !== "EX-BLK-02"),
    true,
  );
});

test("S4A-6c-5: timetable OK + unresolved pairing stays excluded — no whole-block fallback", () => {
  const tt = pairedBlockTimetable();
  const orphan = internal("stu-orphan");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "09:30" },
        slots: tt.slots, // resolves a1/a2 only — no inherited slot for i9
        assignments: [
          { ...examinee(internal("stu-e1")), assignmentId: "a1", pairingIndex: 1 },
          { ...examinee(internal("stu-e2")), assignmentId: "a2", pairingIndex: 2 },
          // A pairing that WOULD resolve uniquely, but the timetable is OK and
          // produced no inherited slot, so the pupil is still excluded.
          { ...instructed(orphan), assignmentId: "i9", pairingIndex: 2, horse: "Rex" },
        ],
      }),
      session({
        sessionId: "other",
        interval: { date: D, start: "09:00", end: "09:30" }, // the WHOLE block
        assignments: [examinee(orphan)],
        horseIds: ["rex"],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(hasCode(conflicts, "EX-BLK-02"), false, "OK requires a real inherited slot");
  assert.equal(hasCode(conflicts, "EX-WRN-01"), false);
  assert.equal(
    conflicts.some((c) => c.details.includes("TIMETABLE_UNRESOLVED")),
    false,
    "a successful timetable never emits the fallback token",
  );
});

// --- 7: positional break ---------------------------------------------------

test("S4A-7: a positional break shifts later slots and conflicts follow the shifted time", () => {
  const tt = computeExamBlockTimetable({
    blockStartTime: "09:00",
    durationMinutes: 15,
    parallelCapacity: 1,
    examinees: [
      { assignmentId: "a1", orderIndex: 0 },
      { assignmentId: "a2", orderIndex: 1 },
    ],
    breaks: [{ breakId: "brk-1", afterWaveIndex: 0, durationMinutes: 30 }],
  });
  assert.equal(tt.ok, true);
  assert.equal(tt.waves[0].startTime, "09:00");
  assert.equal(tt.waves[1].startTime, "09:45", "the break pushed wave 2 to 09:45");

  const shifted = internal("stu-shifted");
  const block = (): ConflictSession =>
    storedBlock({
      sessionId: "block",
      interval: { date: D, start: "09:00", end: "10:00" },
      slots: tt.slots,
      assignments: [{ ...examinee(shifted), assignmentId: "a2" }],
    });

  const atOldTime = detectExamConflicts({
    sessions: [
      block(),
      session({
        sessionId: "other",
        interval: { date: D, start: "09:15", end: "09:30" }, // where wave 2 would be without the break
        assignments: [examinee(shifted)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(hasCode(atOldTime, "EX-BLK-01"), false);

  const atShiftedTime = detectExamConflicts({
    sessions: [
      block(),
      session({
        sessionId: "other",
        interval: { date: D, start: "09:45", end: "10:00" },
        assignments: [examinee(shifted)],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(hasCode(atShiftedTime, "EX-BLK-01"), true);
});

// --- 8/9: horses -----------------------------------------------------------

test("S4A-8: a stored per-assignment horse is compared on its SLOT interval", () => {
  const tt = sixWaveTimetable();
  const block = (): ConflictSession =>
    storedBlock({
      sessionId: "block",
      interval: { date: D, start: "09:00", end: "10:30" },
      slots: tt.slots,
      assignments: [
        { ...examinee(internal("stu-1")), assignmentId: "a1", horse: "Rex" }, // wave 0
      ],
    });

  const late = detectExamConflicts({
    sessions: [
      block(),
      session({
        sessionId: "late",
        interval: { date: D, start: "10:15", end: "10:30" },
        horseIds: ["Rex"],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  assert.equal(hasCode(late, "EX-WRN-01"), false, "the horse is free during wave 6");

  const early = detectExamConflicts({
    sessions: [
      block(),
      session({
        sessionId: "early",
        interval: { date: D, start: "09:05", end: "09:20" },
        horseIds: ["Rex"],
        supervisorIds: ["sup-other"],
        examinerSetId: "eset-other",
      }),
    ],
  });
  const w = find(early, "EX-WRN-01");
  assert.ok(w, "a real slot-time horse clash must be reported");
  assert.equal(w!.subjectId, "rex");
});

test("S4A-9: horse values are trimmed, whitespace-collapsed and case-insensitive — and nothing else", () => {
  const matched = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        assignments: [{ ...examinee(internal("s1")), assignmentId: "a1", horse: "  Rex   Star " }],
      }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [{ ...examinee(internal("s2")), assignmentId: "b1", horse: "rex star" }],
      }),
    ],
  });
  const w = find(matched, "EX-WRN-01");
  assert.ok(w, "trim + whitespace collapse + case-insensitive must match");
  assert.equal(w!.subjectId, "rex star");

  // Digits, punctuation and extra words are NEVER stripped — a different horse.
  const distinct = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        assignments: [{ ...examinee(internal("s1")), assignmentId: "a1", horse: "סוסה 2" }],
      }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [{ ...examinee(internal("s2")), assignmentId: "b1", horse: "סוסה" }],
      }),
    ],
  });
  assert.equal(hasCode(distinct, "EX-WRN-01"), false);

  // A blank horse never participates.
  const blank = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        assignments: [{ ...examinee(internal("s1")), assignmentId: "a1", horse: "   " }],
      }),
      session({
        sessionId: "b",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [{ ...examinee(internal("s2")), assignmentId: "b1", horse: "" }],
      }),
    ],
  });
  assert.equal(hasCode(blank, "EX-WRN-01"), false);
});

// --- 10/11/12: live beginner rows ------------------------------------------

test("S4A-10: a beginner participant conflicts with a stored SLOT on the lesson's real interval", () => {
  const tt = sixWaveTimetable();
  const shared = internal("stu-shared");
  const block = (): ConflictSession =>
    storedBlock({
      sessionId: "block",
      interval: { date: D, start: "09:00", end: "10:30" },
      slots: tt.slots,
      assignments: [{ ...examinee(shared), assignmentId: "a1" }], // wave 0, 09:00-09:15
    });

  const clashing = detectExamConflicts({
    sessions: [
      block(),
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:10", end: "10:00" },
        assignments: [examinee(shared)],
      }),
    ],
  });
  const blk = find(clashing, "EX-BLK-01");
  assert.ok(blk, "a beginner lesson overlapping the stored slot is a real conflict");
  assert.equal(blk!.severity, "BLOCK", "beginner-vs-STORED keeps the normal severity");
  assert.deepEqual([...blk!.details], [], "only beginner-vs-beginner is TP_OWNED");

  const clear = detectExamConflicts({
    sessions: [
      block(),
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:30", end: "10:00" }, // after the trainee's slot
        assignments: [examinee(shared)],
      }),
    ],
  });
  assert.equal(hasCode(clear, "EX-BLK-01"), false);
});

test("S4A-11: a beginner responsible instructor competes with a stored supervisor (EX-WRN-02)", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:00" },
        supervisorIds: ["inst-7"],
      }),
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:30", end: "10:30" },
        responsibleInstructorId: "inst-7",
      }),
    ],
  });
  const w = find(conflicts, "EX-WRN-02");
  assert.ok(w, "the responsible TP instructor is occupied for the whole lesson");
  assert.equal(w!.subjectId, "inst-7");
  assert.deepEqual([...w!.sessionIds], ["block", "tp:lesson-1"]);
});

test("S4A-12: a beginner location is never compared to a stored arena; stored-vs-stored still warns", () => {
  const withBeginner = detectExamConflicts({
    sessions: [
      session({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:00" },
        arenaId: "arena-1",
      }),
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:30", end: "10:30" },
        arenaId: "arena-1", // free TP text, NOT an arena identity
      }),
    ],
  });
  assert.equal(hasCode(withBeginner, "EX-WRN-04"), false);
  assert.equal(
    hasCode(withBeginner, "EX-WRN-03"),
    false,
    "a beginner row has no examiner-set concept",
  );

  const storedOnly = detectExamConflicts({
    sessions: [
      session({
        sessionId: "block-a",
        interval: { date: D, start: "09:00", end: "10:00" },
        arenaId: "arena-1",
      }),
      session({
        sessionId: "block-b",
        interval: { date: D, start: "09:30", end: "10:30" },
        arenaId: "arena-1",
      }),
    ],
  });
  assert.equal(hasCode(storedOnly, "EX-WRN-04"), true, "stored-vs-stored arena stays active");
});

// --- 13: beginner-to-beginner ----------------------------------------------

test("S4A-13: a beginner-to-beginner BLOCK is downgraded to WARN and tagged TP_OWNED", () => {
  const shared = internal("stu-shared");
  const conflicts = detectExamConflicts({
    sessions: [
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:00", end: "10:00" },
        assignments: [examinee(shared)],
        horseIds: ["Rex"],
        responsibleInstructorId: "inst-7",
      }),
      beginnerRow({
        sessionId: "tp:lesson-2",
        interval: { date: D, start: "09:30", end: "10:30" },
        assignments: [examinee(shared)],
        horseIds: ["rex"],
        responsibleInstructorId: "inst-7",
      }),
    ],
  });

  const blk = find(conflicts, "EX-BLK-01");
  assert.ok(blk, "the conflict is reported, never suppressed");
  assert.equal(blk!.severity, "WARN", "the Exams module cannot fix two TP lessons");
  assert.deepEqual([...blk!.details], ["TP_OWNED"]);

  const horse = find(conflicts, "EX-WRN-01");
  assert.ok(horse);
  assert.deepEqual([...horse!.details], ["TP_OWNED"]);

  const sup = find(conflicts, "EX-WRN-02");
  assert.ok(sup, "two TP lessons sharing one responsible instructor still warn");
  assert.equal(sup!.subjectId, "inst-7");
  assert.deepEqual([...sup!.details], ["TP_OWNED"]);
});

// --- 14: the block-grained rules stay block-grained -------------------------

test("S4A-14: supervisor, examiner-set and arena stay BLOCK-grained across two stored blocks", () => {
  const tt = sixWaveTimetable();
  const shared = internal("stu-shared");
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block-a",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        assignments: [{ ...examinee(shared), assignmentId: "a1" }], // 09:00-09:15
        supervisorIds: ["sup-shared"],
        examinerSetId: "eset-shared",
        arenaId: "arena-shared",
      }),
      storedBlock({
        sessionId: "block-b",
        interval: { date: D, start: "10:00", end: "11:30" },
        slots: [{ assignmentId: "b1", startTime: "11:15", endTime: "11:30" }],
        assignments: [{ ...examinee(shared), assignmentId: "b1" }], // 11:15-11:30
        supervisorIds: ["sup-shared"],
        examinerSetId: "eset-shared",
        arenaId: "arena-shared",
      }),
    ],
  });

  assert.equal(hasCode(conflicts, "EX-WRN-02"), true, "supervisor is held for the whole block");
  assert.equal(hasCode(conflicts, "EX-WRN-03"), true, "examiner set is held for the whole block");
  assert.equal(hasCode(conflicts, "EX-WRN-04"), true, "arena is held for the whole block");
  assert.equal(
    hasCode(conflicts, "EX-BLK-01"),
    false,
    "the shared trainee's own slots do not overlap",
  );
});

// --- 15/16: EX-WRN-05 ------------------------------------------------------

test("S4A-15: EX-WRN-05 still fires for a LEGACY definition-less block over capacity", () => {
  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "legacy",
        capacity: 2,
        assignments: [
          examinee(internal("s1")),
          examinee(internal("s2")),
          examinee(internal("s3")),
        ],
      }),
    ],
  });
  const w = find(conflicts, "EX-WRN-05");
  assert.ok(w, "the legacy capacity warning is preserved");
  assert.equal(w!.subjectKind, "SESSION");
  assert.deepEqual([...w!.sessionIds], ["legacy"]);
});

test("S4A-16: EX-WRN-05 NEVER fires for a definition-backed block, however many waves it has", () => {
  const tt = sixWaveTimetable();
  const conflicts = detectExamConflicts({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        // parallelCapacity 2 with 12 examinees is SIX WAVES — entirely normal.
        capacity: 2,
        assignments: SIX_WAVE_IDS.map((assignmentId, index) => ({
          ...examinee(internal(`stu-${index}`)),
          assignmentId,
        })),
      }),
    ],
  });
  assert.equal(
    hasCode(conflicts, "EX-WRN-05"),
    false,
    "parallelCapacity is examinees per wave, not a maximum assignment count",
  );
});

// --- 17/18: legacy compatibility, immutability, determinism ----------------

test("S4A-17: a legacy fixture with no slot fields keeps whole-block behaviour and no tokens", () => {
  const shared = internal("stu-1");
  const conflicts = detectExamConflicts({
    sessions: [
      session({
        sessionId: "a",
        interval: { date: D, start: "09:00", end: "10:30" },
        assignments: [examinee(shared)],
        horseIds: ["h1"],
      }),
      session({
        sessionId: "b",
        interval: { date: D, start: "10:15", end: "10:45" },
        assignments: [examinee(shared)],
        horseIds: ["h1"],
      }),
    ],
  });
  const blk = find(conflicts, "EX-BLK-01");
  assert.ok(blk, "a legacy session still compares its whole interval");
  assert.equal(blk!.severity, "BLOCK");
  assert.deepEqual([...blk!.details], [], "legacy input carries no S4A tokens");
  const horse = find(conflicts, "EX-WRN-01");
  assert.ok(horse, "the session-level horse list is still honoured as a fallback");
  assert.deepEqual([...horse!.details], []);
});

test("S4A-18: slot-aware input is never mutated and the output stays deterministic and ordered", () => {
  const tt = sixWaveTimetable();
  const shared = internal("stu-shared");
  const build = () => ({
    sessions: [
      storedBlock({
        sessionId: "block",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: tt.slots,
        assignments: [{ ...examinee(shared), assignmentId: "a1", horse: " Rex " }],
        supervisorIds: ["sup-shared"],
        examinerSetId: "eset-shared",
        arenaId: "arena-shared",
      }),
      storedBlock({
        sessionId: "block-2",
        interval: { date: D, start: "09:00", end: "10:30" },
        slots: [{ assignmentId: "c1", startTime: "09:05", endTime: "09:20" }],
        assignments: [{ ...examinee(shared), assignmentId: "c1", horse: "REX" }],
        supervisorIds: ["sup-shared"],
        examinerSetId: "eset-shared",
        arenaId: "arena-shared",
      }),
      beginnerRow({
        sessionId: "tp:lesson-1",
        interval: { date: D, start: "09:00", end: "10:00" },
        assignments: [examinee(shared)],
        responsibleInstructorId: "sup-shared",
      }),
    ],
  });

  const input = build();
  const snapshot = JSON.stringify(input);
  const first = detectExamConflicts(input);
  assert.equal(JSON.stringify(input), snapshot, "input must not be mutated");

  const second = detectExamConflicts(build());
  assert.deepEqual(codes(first), codes(second), "deterministic across runs");
  assert.deepEqual(
    first.map((c) => `${c.severity}|${c.code}|${c.subjectId ?? ""}|${c.sessionIds.join(",")}`),
    second.map((c) => `${c.severity}|${c.code}|${c.subjectId ?? ""}|${c.sessionIds.join(",")}`),
    "full tuples are deterministic",
  );

  const severities = first.map((c) => c.severity);
  const firstWarn = severities.indexOf("WARN");
  if (firstWarn !== -1) {
    assert.equal(
      severities.slice(firstWarn).every((s) => s === "WARN"),
      true,
      "no BLOCK appears after the first WARN",
    );
  }

  const keys = first.map((c) => `${c.code}|${c.subjectId ?? ""}|${[...c.sessionIds].join(",")}`);
  assert.equal(new Set(keys).size, keys.length, "no duplicate conflict tuples");

  // The frozen output must not be writable.
  assert.equal(Object.isFrozen(first), true);
});
