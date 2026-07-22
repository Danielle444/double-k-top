/**
 * ATT-SEC-1 - focused tests for the session-bound attendance READ orchestration
 * (lib/actions/attendance-read-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the ATT-SEC-1
 * contract:
 *  - the instructor tracking read is gated on a server-derived instructor actor;
 *    an unauthenticated (null) actor fails closed to [] and never reads;
 *  - identity comes ONLY from the injected actor resolver - there is no
 *    instructor/student id parameter a client could supply to select another;
 *  - the trainee notice read queries ONLY the authenticated trainee's own id;
 *  - ABSENT/PARTIAL surface a notice; PRESENT/missing return null; a malformed
 *    dateKey returns null without any actor or DB read.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/attendance-read-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadInstructorAttendanceTrackingWithDeps,
  loadStudentAttendanceNoticeWithDeps,
  type InstructorAttendanceTrackingDeps,
  type StudentAttendanceNoticeDeps,
  type StudentAttendanceNoticeRow,
} from "./attendance-read-auth";
import type { AttendanceTrackingRow } from "./attendance";

// --- fixtures ---------------------------------------------------------------

// A minimal sentinel tracking row - shape is irrelevant to the gate under test,
// only object identity is asserted, so the full DTO is cast rather than filled.
function sentinelRows(tag: string): AttendanceTrackingRow[] {
  return [{ studentId: tag } as unknown as AttendanceTrackingRow];
}

function noticeRow(
  status: StudentAttendanceNoticeRow["status"],
  extra: Partial<StudentAttendanceNoticeRow> = {},
): StudentAttendanceNoticeRow {
  return {
    status,
    arrivalTime: extra.arrivalTime ?? null,
    departureTime: extra.departureTime ?? null,
    notes: extra.notes ?? null,
  };
}

// ===========================================================================
// Instructor attendance tracking read
// ===========================================================================

test("instructor read: authenticated active instructor gets the same tracking result", async () => {
  const rows = sentinelRows("ok");
  let buildArgs: [string, string] | null = null;
  const deps: InstructorAttendanceTrackingDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    buildRows: async (start, end) => {
      buildArgs = [start, end];
      return rows;
    },
  };

  const result = await loadInstructorAttendanceTrackingWithDeps(
    deps,
    "2026-07-01",
    "2026-07-07",
  );

  assert.equal(result, rows, "returns the reader's rows unchanged");
  assert.deepEqual(buildArgs, ["2026-07-01", "2026-07-07"], "date range is passed through unchanged");
});

test("instructor read: unauthenticated access is rejected (empty, no DB read)", async () => {
  let buildCalled = false;
  const deps: InstructorAttendanceTrackingDeps = {
    getCurrentInstructor: async () => null,
    buildRows: async () => {
      buildCalled = true;
      return sentinelRows("should-not-happen");
    },
  };

  const result = await loadInstructorAttendanceTrackingWithDeps(
    deps,
    "2026-07-01",
    "2026-07-07",
  );

  assert.deepEqual(result, [], "fails closed to []");
  assert.equal(buildCalled, false, "the reader is never invoked without an actor");
});

test("instructor read: inactive/invalid instructor (canonical null actor) is rejected", async () => {
  // getCurrentInstructor returns null for an inactive/invalid/wrong-audience
  // session (proven by actor-core tests: deriveInstructorActor requires
  // isActive===true and a subject-binding match). The orchestration must treat
  // that null exactly like an unauthenticated caller.
  let buildCalled = false;
  const deps: InstructorAttendanceTrackingDeps = {
    getCurrentInstructor: async () => null,
    buildRows: async () => {
      buildCalled = true;
      return sentinelRows("should-not-happen");
    },
  };

  const result = await loadInstructorAttendanceTrackingWithDeps(deps, "2026-07-01", "2026-07-01");

  assert.deepEqual(result, []);
  assert.equal(buildCalled, false);
});

test("instructor read: no client-supplied identity can select another instructor", async () => {
  // The orchestration exposes NO instructor-id parameter; identity is whatever
  // the injected resolver yields. Regardless of the (start,end) a client
  // controls, the reader is driven only by the resolved actor's existence -
  // there is no code path that accepts an instructor id from the caller.
  let buildCalled = false;
  const deps: InstructorAttendanceTrackingDeps = {
    getCurrentInstructor: async () => ({ id: "real-instructor" }),
    buildRows: async () => {
      buildCalled = true;
      return sentinelRows("real");
    },
  };

  await loadInstructorAttendanceTrackingWithDeps(deps, "2026-07-01", "2026-07-07");

  assert.equal(buildCalled, true, "reader runs for the resolved actor only");
  // Compile-time guarantee: loadInstructorAttendanceTrackingWithDeps has arity
  // (deps, startDateKey, endDateKey) - there is no instructorId argument.
  assert.equal(loadInstructorAttendanceTrackingWithDeps.length, 3);
});

// ===========================================================================
// Trainee attendance notice read
// ===========================================================================

test("trainee notice: reads only the authenticated trainee's own id", async () => {
  let readArgs: [string, string] | null = null;
  const deps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "trainee-self" }),
    readAttendanceRow: async (studentId, dk) => {
      readArgs = [studentId, dk];
      return noticeRow("ABSENT", { notes: "away" });
    },
  };

  const notice = await loadStudentAttendanceNoticeWithDeps(deps, "2026-07-03");

  assert.deepEqual(readArgs, ["trainee-self", "2026-07-03"], "queries the actor's own id only");
  assert.deepEqual(notice, {
    dateKey: "2026-07-03",
    status: "ABSENT",
    arrivalTime: null,
    departureTime: null,
    notes: "away",
  });
});

test("trainee notice: caller cannot request another trainee's notice", async () => {
  // The public signature is (deps, dateKeyStr) - no studentId. Whatever the
  // resolver returns is the ONLY id the reader ever sees.
  let observedId: string | null = null;
  const deps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "actor-id" }),
    readAttendanceRow: async (studentId) => {
      observedId = studentId;
      return null;
    },
  };

  await loadStudentAttendanceNoticeWithDeps(deps, "2026-07-03");

  assert.equal(observedId, "actor-id");
  // Compile-time guarantee: arity is (deps, dateKeyStr) - no id argument.
  assert.equal(loadStudentAttendanceNoticeWithDeps.length, 2);
});

test("trainee notice: unauthenticated access is rejected (null, no DB read)", async () => {
  let readCalled = false;
  const deps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => null,
    readAttendanceRow: async () => {
      readCalled = true;
      return noticeRow("ABSENT");
    },
  };

  const notice = await loadStudentAttendanceNoticeWithDeps(deps, "2026-07-03");

  assert.equal(notice, null, "fails closed to null");
  assert.equal(readCalled, false, "no row is read without an actor");
});

test("trainee notice: ABSENT and PARTIAL return the expected notice", async () => {
  const absentDeps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "t" }),
    readAttendanceRow: async () => noticeRow("ABSENT", { notes: "sick" }),
  };
  const absent = await loadStudentAttendanceNoticeWithDeps(absentDeps, "2026-07-03");
  assert.deepEqual(absent, {
    dateKey: "2026-07-03",
    status: "ABSENT",
    arrivalTime: null,
    departureTime: null,
    notes: "sick",
  });

  const partialDeps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "t" }),
    readAttendanceRow: async () =>
      noticeRow("PARTIAL", { arrivalTime: "09:30", departureTime: "12:00" }),
  };
  const partial = await loadStudentAttendanceNoticeWithDeps(partialDeps, "2026-07-03");
  assert.deepEqual(partial, {
    dateKey: "2026-07-03",
    status: "PARTIAL",
    arrivalTime: "09:30",
    departureTime: "12:00",
    notes: null,
  });
});

test("trainee notice: PRESENT and missing row return null", async () => {
  const presentDeps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "t" }),
    readAttendanceRow: async () => noticeRow("PRESENT"),
  };
  assert.equal(await loadStudentAttendanceNoticeWithDeps(presentDeps, "2026-07-03"), null);

  const missingDeps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => ({ id: "t" }),
    readAttendanceRow: async () => null,
  };
  assert.equal(await loadStudentAttendanceNoticeWithDeps(missingDeps, "2026-07-03"), null);
});

test("trainee notice: malformed dateKey returns null without actor or DB read", async () => {
  let actorCalled = false;
  let readCalled = false;
  const deps: StudentAttendanceNoticeDeps = {
    getCurrentTrainee: async () => {
      actorCalled = true;
      return { id: "t" };
    },
    readAttendanceRow: async () => {
      readCalled = true;
      return noticeRow("ABSENT");
    },
  };

  assert.equal(await loadStudentAttendanceNoticeWithDeps(deps, "not-a-date"), null);
  assert.equal(await loadStudentAttendanceNoticeWithDeps(deps, "2026-7-3"), null);
  assert.equal(actorCalled, false, "no session read for a malformed dateKey");
  assert.equal(readCalled, false, "no DB read for a malformed dateKey");
});

// ===========================================================================
// Structural guard: the orchestration is a pure, side-effect-free module
// ===========================================================================

test("attendance-read-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./attendance-read-auth.ts", import.meta.url)),
    "utf8",
  );
  // Match the actual directive / imports, not prose that merely mentions them
  // in a comment.
  const hasUseServerDirective = src
    .split("\n")
    .some((line) => /^\s*["']use server["'];?\s*$/.test(line));
  assert.ok(!hasUseServerDirective, "must NOT be a Server Action module");
  assert.ok(!/from\s+["']@\/lib\/prisma["']/.test(src), "must not import Prisma");
  assert.ok(!/from\s+["']next\/headers["']/.test(src), "must not import next/headers");
  assert.ok(!/from\s+["']next\/cache["']/.test(src), "must not import next/cache");
});
