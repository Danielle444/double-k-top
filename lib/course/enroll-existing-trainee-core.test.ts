/**
 * MULTI-COURSE (enrollment slice E1) - DB-free tests for the PURE enrollment
 * core: input normalization, offering classification, and the transaction body
 * (runEnrollmentCreateInTx) exercised through a fake EnrollTxClient.
 *
 * Run with: npx tsx --test lib/course/enroll-existing-trainee-core.test.ts
 * No Prisma, no DB: every transaction-local read and every write is a fake that
 * records its calls, so these tests prove the proof order, the exact write
 * boundary (TWO additive rows - CourseEnrollment + GroupMembership - and NO
 * TraineeHorseAssignment / no Student write), the PLANNED-only lifecycle, the
 * leaf/ownership proof, duplicate handling, and the fail-before/rollback-by-throw
 * guarantees without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  runEnrollmentCreateInTx,
  normalizeEnrollInput,
  classifyOfferingForEnroll,
  isUniqueConstraintViolation,
  AlreadyEnrolledError,
  type EnrollTxClient,
  type EnrollExistingTraineeInput,
  type EnrollmentCreateData,
  type MembershipCreateData,
  type TxOfferingRow,
  type TxStudentRow,
} from "./enroll-existing-trainee-core";

const START = new Date("2026-07-26T00:00:00.000Z");

const VALID_INPUT: EnrollExistingTraineeInput = {
  courseOfferingId: "off-L2",
  studentId: "stu-1",
  courseGroupId: "grp-leaf",
};

interface FakeTxConfig {
  offering?: TxOfferingRow | null;
  student?: TxStudentRow | null;
  leafGroup?: { id: string } | null;
  existingEnrollment?: { id: string } | null;
  enrollmentId?: string;
  createEnrollmentError?: unknown;
  createMembershipError?: unknown;
}

interface FakeTxRecorder {
  tx: EnrollTxClient;
  calls: string[];
  offeringQueried: string | null;
  studentQueried: string | null;
  leafQueried: { groupId: string; offeringId: string } | null;
  existingQueried: { studentId: string; offeringId: string } | null;
  enrollmentData: EnrollmentCreateData | null;
  membershipData: MembershipCreateData | null;
}

function makeFakeTx(config: FakeTxConfig = {}): FakeTxRecorder {
  const offering =
    config.offering !== undefined
      ? config.offering
      : ({ id: "off-L2", status: "PLANNED" as CourseOfferingStatus, startDate: START });
  const student =
    config.student !== undefined ? config.student : ({ id: "stu-1", isActive: true });
  const leafGroup = config.leafGroup !== undefined ? config.leafGroup : { id: "grp-leaf" };
  const existingEnrollment =
    config.existingEnrollment !== undefined ? config.existingEnrollment : null;
  const enrollmentId = config.enrollmentId ?? "enr-new";

  const rec: FakeTxRecorder = {
    calls: [],
    offeringQueried: null,
    studentQueried: null,
    leafQueried: null,
    existingQueried: null,
    enrollmentData: null,
    membershipData: null,
    tx: undefined as unknown as EnrollTxClient,
  };

  rec.tx = {
    findOffering: async (courseOfferingId) => {
      rec.calls.push("findOffering");
      rec.offeringQueried = courseOfferingId;
      return offering;
    },
    findStudent: async (studentId) => {
      rec.calls.push("findStudent");
      rec.studentQueried = studentId;
      return student;
    },
    findLeafGroup: async (courseGroupId, courseOfferingId) => {
      rec.calls.push("findLeafGroup");
      rec.leafQueried = { groupId: courseGroupId, offeringId: courseOfferingId };
      return leafGroup;
    },
    findExistingEnrollment: async (studentId, courseOfferingId) => {
      rec.calls.push("findExistingEnrollment");
      rec.existingQueried = { studentId, offeringId: courseOfferingId };
      return existingEnrollment;
    },
    createEnrollment: async (data) => {
      rec.calls.push("createEnrollment");
      rec.enrollmentData = data;
      if (config.createEnrollmentError !== undefined) throw config.createEnrollmentError;
      return { id: enrollmentId };
    },
    createMembership: async (data) => {
      rec.calls.push("createMembership");
      rec.membershipData = data;
      if (config.createMembershipError !== undefined) throw config.createMembershipError;
      return { id: "mem-new" };
    },
  };

  return rec;
}

const P2002 = { code: "P2002", meta: { target: ["studentId", "courseOfferingId"] } };

// ---------------------------------------------------------------------------
// normalizeEnrollInput
// ---------------------------------------------------------------------------

test("normalize: rejects empty courseOfferingId", () => {
  const r = normalizeEnrollInput({ ...VALID_INPUT, courseOfferingId: "" });
  assert.equal(r.ok, false);
});

test("normalize: rejects empty studentId", () => {
  const r = normalizeEnrollInput({ ...VALID_INPUT, studentId: "   " });
  assert.equal(r.ok, false);
});

test("normalize: rejects empty courseGroupId", () => {
  const r = normalizeEnrollInput({ ...VALID_INPUT, courseGroupId: "" });
  assert.equal(r.ok, false);
});

test("normalize: trims and accepts a valid input", () => {
  const r = normalizeEnrollInput({
    courseOfferingId: "  off-L2 ",
    studentId: " stu-1 ",
    courseGroupId: " grp-leaf ",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.value, {
      courseOfferingId: "off-L2",
      studentId: "stu-1",
      courseGroupId: "grp-leaf",
    });
  }
});

// ---------------------------------------------------------------------------
// classifyOfferingForEnroll
// ---------------------------------------------------------------------------

test("classify: PLANNED + startDate is allowed", () => {
  const r = classifyOfferingForEnroll("PLANNED", START);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.startDate, START);
});

test("classify: ACTIVE is rejected in slice E1 (operation_not_allowed)", () => {
  const r = classifyOfferingForEnroll("ACTIVE", START);
  assert.deepEqual(r, { ok: false, error: "operation_not_allowed" });
});

test("classify: ARCHIVED is rejected (operation_not_allowed)", () => {
  const r = classifyOfferingForEnroll("ARCHIVED", START);
  assert.deepEqual(r, { ok: false, error: "operation_not_allowed" });
});

test("classify: PLANNED with null startDate -> offering_start_date_missing", () => {
  const r = classifyOfferingForEnroll("PLANNED", null);
  assert.deepEqual(r, { ok: false, error: "offering_start_date_missing" });
});

test("isUniqueConstraintViolation: only true for P2002", () => {
  assert.equal(isUniqueConstraintViolation(P2002), true);
  assert.equal(isUniqueConstraintViolation({ code: "P2003" }), false);
  assert.equal(isUniqueConstraintViolation(new Error("boom")), false);
  assert.equal(isUniqueConstraintViolation(null), false);
});

// ---------------------------------------------------------------------------
// runEnrollmentCreateInTx - proof failures (no writes)
// ---------------------------------------------------------------------------

test("offering not found -> offering_not_found; no writes", async () => {
  const rec = makeFakeTx({ offering: null });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "offering_not_found" });
  assert.deepEqual(rec.calls, ["findOffering"]);
});

test("transaction-local re-read sees ACTIVE (stale) -> operation_not_allowed; no writes", async () => {
  const rec = makeFakeTx({
    offering: { id: "off-L2", status: "ACTIVE", startDate: START },
  });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "operation_not_allowed" });
  assert.deepEqual(rec.calls, ["findOffering"]);
});

test("ARCHIVED offering -> operation_not_allowed; no writes", async () => {
  const rec = makeFakeTx({
    offering: { id: "off-L2", status: "ARCHIVED", startDate: START },
  });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "operation_not_allowed" });
});

test("PLANNED with missing startDate -> offering_start_date_missing; no writes", async () => {
  const rec = makeFakeTx({
    offering: { id: "off-L2", status: "PLANNED", startDate: null },
  });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "offering_start_date_missing" });
});

test("student not found -> student_not_found; no writes", async () => {
  const rec = makeFakeTx({ student: null });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "student_not_found" });
  assert.deepEqual(rec.calls, ["findOffering", "findStudent"]);
});

test("transaction-local re-read sees inactive student (stale) -> inactive_student; no writes", async () => {
  const rec = makeFakeTx({ student: { id: "stu-1", isActive: false } });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "inactive_student" });
  assert.deepEqual(rec.calls, ["findOffering", "findStudent"]);
});

test("leaf/ownership proof fails (null) -> invalid_group; no writes", async () => {
  const rec = makeFakeTx({ leafGroup: null });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "invalid_group" });
  assert.deepEqual(rec.calls, ["findOffering", "findStudent", "findLeafGroup"]);
  // The proof is scoped to the re-read offering id and the requested group id.
  assert.deepEqual(rec.leafQueried, { groupId: "grp-leaf", offeringId: "off-L2" });
});

test("existing enrollment found before insert -> already_enrolled; no writes", async () => {
  const rec = makeFakeTx({ existingEnrollment: { id: "enr-existing" } });
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: false, error: "already_enrolled" });
  assert.deepEqual(rec.calls, [
    "findOffering",
    "findStudent",
    "findLeafGroup",
    "findExistingEnrollment",
  ]);
});

// ---------------------------------------------------------------------------
// runEnrollmentCreateInTx - happy path (exact two writes)
// ---------------------------------------------------------------------------

test("happy path: creates enrollment -> membership in exact order (two writes only)", async () => {
  const rec = makeFakeTx();
  const r = await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.deepEqual(r, { success: true, enrollmentId: "enr-new" });
  assert.deepEqual(rec.calls, [
    "findOffering",
    "findStudent",
    "findLeafGroup",
    "findExistingEnrollment",
    "createEnrollment",
    "createMembership",
  ]);
});

test("happy path: enrollment is ACTIVE, non-primary, startDate = offering.startDate", async () => {
  const rec = makeFakeTx();
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  const d = rec.enrollmentData;
  assert.ok(d);
  assert.equal(d.studentId, "stu-1");
  assert.equal(d.courseOfferingId, "off-L2");
  assert.equal(d.status, "ACTIVE");
  assert.equal(d.isPrimary, false);
  assert.equal(d.startDate.getTime(), START.getTime());
});

test("happy path: membership targets the proven leaf and shares the effective date", async () => {
  const rec = makeFakeTx();
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  const m = rec.membershipData;
  assert.ok(m);
  assert.equal(m.courseEnrollmentId, "enr-new");
  assert.equal(m.courseGroupId, "grp-leaf");
  assert.equal(m.effectiveFrom.getTime(), START.getTime());
  assert.equal(m.effectiveTo, null);
});

test("happy path: both dates derive from the single offering.startDate", async () => {
  const rec = makeFakeTx();
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  const t = START.getTime();
  assert.equal(rec.enrollmentData?.startDate.getTime(), t);
  assert.equal(rec.membershipData?.effectiveFrom.getTime(), t);
});

test("membership uses the EXACT newly created enrollment id", async () => {
  const rec = makeFakeTx({ enrollmentId: "enr-canonical" });
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.equal(rec.membershipData?.courseEnrollmentId, "enr-canonical");
});

test("writes use the re-read offering.id, student.id and proven group.id", async () => {
  const rec = makeFakeTx({
    offering: { id: "off-canonical", status: "PLANNED", startDate: START },
    student: { id: "stu-canonical", isActive: true },
    leafGroup: { id: "grp-canonical" },
  });
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  assert.equal(rec.enrollmentData?.courseOfferingId, "off-canonical");
  assert.equal(rec.enrollmentData?.studentId, "stu-canonical");
  assert.equal(rec.membershipData?.courseGroupId, "grp-canonical");
});

// ---------------------------------------------------------------------------
// runEnrollmentCreateInTx - duplicate / concurrency / rollback (throws)
// ---------------------------------------------------------------------------

test("P2002 on enrollment create -> throws AlreadyEnrolledError; no membership write", async () => {
  const rec = makeFakeTx({ createEnrollmentError: P2002 });
  await assert.rejects(
    () => runEnrollmentCreateInTx(rec.tx, VALID_INPUT),
    (err) => err instanceof AlreadyEnrolledError,
  );
  assert.equal(rec.calls.includes("createMembership"), false);
  // No fallback write after P2002: createEnrollment attempted exactly once.
  assert.equal(rec.calls.filter((c) => c === "createEnrollment").length, 1);
});

test("non-P2002 error on enrollment create propagates unchanged; no later writes", async () => {
  const boom = new Error("infra down");
  const rec = makeFakeTx({ createEnrollmentError: boom });
  await assert.rejects(
    () => runEnrollmentCreateInTx(rec.tx, VALID_INPUT),
    (err) => err === boom,
  );
  assert.equal(rec.calls.includes("createMembership"), false);
});

test("failure during membership propagates (rollback by throw); enrollment was attempted first", async () => {
  const boom = new Error("membership write failed");
  const rec = makeFakeTx({ createMembershipError: boom });
  await assert.rejects(
    () => runEnrollmentCreateInTx(rec.tx, VALID_INPUT),
    (err) => err === boom,
  );
  assert.deepEqual(rec.calls.slice(-2), ["createEnrollment", "createMembership"]);
});

// ---------------------------------------------------------------------------
// Compatibility protection (structural)
// ---------------------------------------------------------------------------

test("the tx surface exposes NO student / horse / legacy-membership mutation method", () => {
  const rec = makeFakeTx();
  const keys = Object.keys(rec.tx);
  // Only these two write methods exist; nothing can create/update a Student,
  // write a TraineeHorseAssignment, or write a legacy studentId-based
  // TraineeGroupMembership.
  assert.equal(keys.includes("createEnrollment"), true);
  assert.equal(keys.includes("createMembership"), true);
  assert.equal(keys.includes("createHorseInterval"), false);
  for (const k of keys) {
    assert.equal(/student/i.test(k) && /create|update|write/i.test(k), false);
    assert.equal(/horse/i.test(k), false);
    assert.equal(/traineeGroupMembership/i.test(k), false);
  }
});

test("a full run performs EXACTLY two writes (enrollment + membership); no horse write", async () => {
  const rec = makeFakeTx();
  await runEnrollmentCreateInTx(rec.tx, VALID_INPUT);
  const writes = rec.calls.filter((c) => c.startsWith("create"));
  assert.deepEqual(writes, ["createEnrollment", "createMembership"]);
});
