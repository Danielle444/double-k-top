/**
 * MULTI-COURSE (enrollment slice E1) - DB-free tests for the DI IO orchestration
 * enrollExistingTraineeWithDeps.
 *
 * Run with: npx tsx --test lib/course/enroll-existing-trainee.test.ts
 * No Prisma, no DB: the interactive transaction is injected as a fake that
 * observes commit-vs-rollback and passes a fake EnrollTxClient to the core body.
 * These tests prove: invalid_input short-circuits BEFORE any transaction is
 * opened; proof failures pass through unchanged (never mislabelled "unexpected");
 * a concurrent enrollment unique violation maps to already_enrolled with a rolled
 * back transaction; any other write failure maps to unexpected with rollback; and
 * the EXACT courseOfferingId is used (no ACTIVE-singleton / cookie / name lookup).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  enrollExistingTraineeWithDeps,
  type EnrollExistingTraineeDeps,
} from "./enroll-existing-trainee";
import type {
  EnrollTxClient,
  EnrollExistingTraineeInput,
  TxOfferingRow,
  TxStudentRow,
} from "./enroll-existing-trainee-core";

const START = new Date("2026-07-26T00:00:00.000Z");

const VALID_INPUT: EnrollExistingTraineeInput = {
  courseOfferingId: "off-L2",
  studentId: "stu-1",
  courseGroupId: "grp-leaf",
};

const P2002 = { code: "P2002", meta: { target: ["studentId", "courseOfferingId"] } };

interface FakeTxConfig {
  offering?: TxOfferingRow | null;
  student?: TxStudentRow | null;
  leafGroup?: { id: string } | null;
  existingEnrollment?: { id: string } | null;
  createEnrollmentError?: unknown;
  createMembershipError?: unknown;
}

function makeFakeTxClient(config: FakeTxConfig, rec: { offeringQueried: string | null }): EnrollTxClient {
  const offering =
    config.offering !== undefined
      ? config.offering
      : ({ id: "off-L2", status: "PLANNED" as CourseOfferingStatus, startDate: START });
  const student =
    config.student !== undefined ? config.student : ({ id: "stu-1", isActive: true });
  const leafGroup = config.leafGroup !== undefined ? config.leafGroup : { id: "grp-leaf" };
  const existingEnrollment =
    config.existingEnrollment !== undefined ? config.existingEnrollment : null;

  return {
    findOffering: async (courseOfferingId) => {
      rec.offeringQueried = courseOfferingId;
      return offering;
    },
    findStudent: async () => student,
    findLeafGroup: async () => leafGroup,
    findExistingEnrollment: async () => existingEnrollment,
    createEnrollment: async () => {
      if (config.createEnrollmentError !== undefined) throw config.createEnrollmentError;
      return { id: "enr-new" };
    },
    createMembership: async () => {
      if (config.createMembershipError !== undefined) throw config.createMembershipError;
      return { id: "mem-new" };
    },
  };
}

interface FakeTransaction {
  deps: EnrollExistingTraineeDeps;
  opened: boolean;
  committed: boolean;
  rolledBack: boolean;
  offeringQueried: string | null;
}

function makeFakeTransaction(config: FakeTxConfig = {}): FakeTransaction {
  const state: FakeTransaction = {
    opened: false,
    committed: false,
    rolledBack: false,
    offeringQueried: null,
    deps: undefined as unknown as EnrollExistingTraineeDeps,
  };
  state.deps = {
    transaction: async (fn) => {
      state.opened = true;
      const tx = makeFakeTxClient(config, state);
      try {
        const result = await fn(tx);
        state.committed = true;
        return result;
      } catch (err) {
        state.rolledBack = true;
        throw err;
      }
    },
  };
  return state;
}

// ---------------------------------------------------------------------------

test("invalid_input short-circuits BEFORE any transaction is opened", async () => {
  const t = makeFakeTransaction();
  const r = await enrollExistingTraineeWithDeps({ ...VALID_INPUT, studentId: "  " }, t.deps);
  assert.deepEqual(r, { success: false, error: "invalid_input" });
  assert.equal(t.opened, false);
});

test("happy path returns success and commits the transaction", async () => {
  const t = makeFakeTransaction();
  const r = await enrollExistingTraineeWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: true, enrollmentId: "enr-new" });
  assert.equal(t.opened, true);
  assert.equal(t.committed, true);
  assert.equal(t.rolledBack, false);
});

test("uses the EXACT courseOfferingId (no ACTIVE-singleton / cookie / name lookup)", async () => {
  const t = makeFakeTransaction();
  await enrollExistingTraineeWithDeps({ ...VALID_INPUT, courseOfferingId: "off-explicit" }, t.deps);
  assert.equal(t.offeringQueried, "off-explicit");
});

test("a proof failure passes through unchanged (NOT mislabelled unexpected)", async () => {
  const t = makeFakeTransaction({ offering: null });
  const r = await enrollExistingTraineeWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "offering_not_found" });
  // Proof failure returns before any write, so the (empty) transaction commits.
  assert.equal(t.committed, true);
  assert.equal(t.rolledBack, false);
});

test("concurrent enrollment unique violation (P2002) -> already_enrolled with rollback", async () => {
  const t = makeFakeTransaction({ createEnrollmentError: P2002 });
  const r = await enrollExistingTraineeWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "already_enrolled" });
  assert.equal(t.rolledBack, true);
  assert.equal(t.committed, false);
});

test("any other write failure (membership) -> unexpected with rollback", async () => {
  const t = makeFakeTransaction({ createMembershipError: new Error("membership write failed") });
  const r = await enrollExistingTraineeWithDeps(VALID_INPUT, t.deps);
  assert.deepEqual(r, { success: false, error: "unexpected" });
  assert.equal(t.rolledBack, true);
  assert.equal(t.committed, false);
});
