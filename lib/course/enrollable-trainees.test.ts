/**
 * MULTI-COURSE (enrollment slice E2) - DB-free tests for the offering-scoped
 * enrollable-trainees reader.
 *
 * Run with: npx tsx --test lib/course/enrollable-trainees.test.ts
 * No Prisma, no DB: the single Student read is injected as a fake that records
 * the exact query it receives, so these tests prove the offering-scoped exclusion
 * (active-only + status-agnostic exact-offering enrollment exclusion, supporting
 * dual enrollment), the minimal privacy-narrow select, the deterministic order,
 * the invalid-id fail-closed behaviour, and that the reader neither mutates nor
 * touches any other table - without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  listEnrollableTraineesWithDeps,
  buildEnrollableTraineesQuery,
  ENROLLABLE_TRAINEE_SELECT,
  type EnrollableTrainee,
  type EnrollableTraineesDeps,
  type EnrollableTraineesQuery,
} from "./enrollable-trainees";

interface Recorder {
  queries: EnrollableTraineesQuery[];
  deps: EnrollableTraineesDeps;
}

function recordingDeps(rows: EnrollableTrainee[] = []): Recorder {
  const rec: Recorder = { queries: [], deps: undefined as unknown as EnrollableTraineesDeps };
  rec.deps = {
    fetchEnrollableTrainees: async (query) => {
      rec.queries.push(query);
      return rows;
    },
  };
  return rec;
}

const TRAINEE = (id: string, fullName: string, identityNumber: string): EnrollableTrainee => ({
  id,
  fullName,
  identityNumber,
});

// ---------------------------------------------------------------------------
// Invalid / empty input (fail closed to an empty list, no fetch)
// ---------------------------------------------------------------------------

test("empty courseOfferingId -> [] and NO fetch", async () => {
  const rec = recordingDeps([TRAINEE("s1", "אבי כהן", "111")]);
  const result = await listEnrollableTraineesWithDeps("", rec.deps);
  assert.deepEqual(result, []);
  assert.equal(rec.queries.length, 0);
});

test("whitespace-only courseOfferingId -> [] and NO fetch", async () => {
  const rec = recordingDeps([TRAINEE("s1", "אבי כהן", "111")]);
  const result = await listEnrollableTraineesWithDeps("   ", rec.deps);
  assert.deepEqual(result, []);
  assert.equal(rec.queries.length, 0);
});

// ---------------------------------------------------------------------------
// Offering scoping + filter encoding
// ---------------------------------------------------------------------------

test("the EXACT courseOfferingId is used in the enrollment-exclusion filter", async () => {
  // normalizeOfferingId (the shared Slice-1 primitive) rejects blank ids but
  // passes a non-blank id through unchanged - the same convention as
  // getCourseOfferingById. A padded/nonexistent id is rejected upstream by the
  // future requireAdminCourseOffering gate, never here.
  const rec = recordingDeps();
  await listEnrollableTraineesWithDeps("off-L2", rec.deps);
  assert.equal(rec.queries.length, 1);
  assert.deepEqual(rec.queries[0].where, {
    isActive: true,
    courseEnrollments: { none: { courseOfferingId: "off-L2" } },
  });
});

test("query requires Student.isActive === true", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  assert.equal(q.where.isActive, true);
});

test("exclusion is status-AGNOSTIC (any target-offering enrollment excludes; INACTIVE too)", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  // The `none` relation filter matches on courseOfferingId ONLY - it carries no
  // `status`, so an INACTIVE prior enrollment in the target offering still
  // excludes the Student (mirrors @@unique([studentId, courseOfferingId])).
  const none = (q.where.courseEnrollments as { none: Record<string, unknown> }).none;
  assert.deepEqual(none, { courseOfferingId: "off-L2" });
  assert.equal("status" in none, false);
  assert.equal("isPrimary" in none, false);
});

test("filter is keyed ONLY to courseOfferingId (dual enrollment: other-offering rows do NOT exclude)", () => {
  // Because the exclusion matches only the exact target offering, a Student whose
  // only enrollment is in another offering (e.g. ACTIVE Level 1) is NOT excluded
  // for a different (Level 2) target. Proven structurally: the sole filter key is
  // the exact courseOfferingId, and there is no offering-agnostic enrollment check.
  const q = buildEnrollableTraineesQuery("off-L2-target");
  assert.deepEqual(q.where, {
    isActive: true,
    courseEnrollments: { none: { courseOfferingId: "off-L2-target" } },
  });
});

test("query never filters by groupName / subgroupNumber / isPrimary / offering name / level", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  const whereKeys = Object.keys(q.where);
  assert.deepEqual(whereKeys.sort(), ["courseEnrollments", "isActive"]);
  const serialized = JSON.stringify(q.where);
  for (const forbidden of ["groupName", "subgroupNumber", "isPrimary", "status", "name", "level"]) {
    assert.equal(serialized.includes(forbidden), false, `where must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Minimal fields + deterministic order
// ---------------------------------------------------------------------------

test("select is exactly the three minimal fields (no phone/horse/notes/health)", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  assert.deepEqual(q.select, { id: true, fullName: true, identityNumber: true });
  assert.deepEqual(ENROLLABLE_TRAINEE_SELECT, { id: true, fullName: true, identityNumber: true });
  const selectKeys = Object.keys(q.select);
  for (const forbidden of ["phone", "hasPrivateHorse", "privateHorseName", "assignedHorseName", "groupName", "subgroupNumber", "isActive"]) {
    assert.equal(selectKeys.includes(forbidden), false, `select must not include ${forbidden}`);
  }
});

test("deterministic ordering: fullName asc, then id as tie-breaker", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  assert.deepEqual(q.orderBy, [{ fullName: "asc" }, { id: "asc" }]);
});

// ---------------------------------------------------------------------------
// Pass-through + no other-table access + no mutation surface
// ---------------------------------------------------------------------------

test("returns the fetched rows unchanged (ordering delegated to the DB query)", async () => {
  const rows = [TRAINEE("s1", "אבי כהן", "111"), TRAINEE("s2", "בני לוי", "222")];
  const rec = recordingDeps(rows);
  const result = await listEnrollableTraineesWithDeps("off-L2", rec.deps);
  assert.deepEqual(result, rows);
});

test("returned items expose only the three approved fields", async () => {
  const rec = recordingDeps([TRAINEE("s1", "אבי כהן", "111")]);
  const [row] = await listEnrollableTraineesWithDeps("off-L2", rec.deps);
  assert.deepEqual(Object.keys(row).sort(), ["fullName", "id", "identityNumber"]);
});

test("the dependency surface is a single READ (no write, no other-table method)", () => {
  const rec = recordingDeps();
  const keys = Object.keys(rec.deps);
  assert.deepEqual(keys, ["fetchEnrollableTrainees"]);
  for (const k of keys) {
    assert.equal(/create|update|delete|write|upsert/i.test(k), false);
    assert.equal(/membership|horse|schedule|dut(y|ies)|capabilit/i.test(k), false);
  }
});

test("the query touches no group-membership / horse / other relation", () => {
  const q = buildEnrollableTraineesQuery("off-L2");
  const serialized = JSON.stringify({ where: q.where, select: q.select, orderBy: q.orderBy });
  for (const forbidden of ["memberships", "groupMemberships", "horseAssignment", "traineeHorse", "attendance", "assignments"]) {
    assert.equal(serialized.includes(forbidden), false, `query must not reference ${forbidden}`);
  }
});
