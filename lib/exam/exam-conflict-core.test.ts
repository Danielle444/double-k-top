/**
 * EXAM X0 — executable tests for the PURE conflict-detection core
 * (exam-conflict-core.ts), aligned to the authoritative numbered matrix.
 *
 * Run with: npx tsx --test lib/exam/exam-conflict-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env.
 *
 * SCOPE OF PROOF: every EX-BLK-0N and EX-WRN-0N code; unified examinee
 * double-booking (internal AND external under EX-BLK-01); examinee↔instructed
 * cross-role double-booking (EX-BLK-02); examinee==instructed within a session
 * (EX-BLK-03); duplicate nationalId in the plan (EX-BLK-04); horse / supervisor
 * / examiner-set (incl. different arenas) / arena overlaps; capacity; normalized
 * name-duplicate warning (EX-WRN-06); single staffing code with details
 * (EX-WRN-07); and STABLE ordering with no exact-duplicate entries.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  detectExamConflicts,
  EXAM_CONFLICT_MESSAGES,
  type ConflictSession,
  type ConflictAssignment,
  type ExamConflict,
  type ExamConflictCode,
} from "./exam-conflict-core";
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
        capacity: 1, // 3 examinees > 1 ⇒ EX-WRN-05
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
