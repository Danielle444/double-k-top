/**
 * MULTI-COURSE W9A-4 - DB-free IO-boundary tests for createCourseSubgroupWithDeps.
 *
 * Run with: npx tsx --test lib/course/create-course-subgroup.test.ts
 * No Prisma, no DB: the offering resolver, the compound top-level-parent resolver
 * and the single subgroup write are injected as fakes that record their calls, so
 * these tests prove the write boundary (exactly one subgroup, the validated
 * explicit offering id used, the proven top-level parent id used, the canonical
 * normalized name written, PLANNED allowed / ACTIVE & ARCHIVED rejected before any
 * parent lookup or write, invalid input performs no parent lookup or write, a
 * null compound lookup maps to invalid_parent with no write, P2002 ->
 * duplicate_name, unexpected -> unexpected) without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { CourseOfferingNotFoundError } from "./admin-course-context";
import {
  createCourseSubgroupWithDeps,
  type CreateCourseSubgroupDeps,
  type NewCourseSubgroupWriteData,
  type ResolvedOfferingForSubgroup,
} from "./create-course-subgroup";

interface ParentCall {
  courseOfferingId: string;
  parentGroupId: string;
}

interface Recorder {
  resolveCalls: string[];
  parentCalls: ParentCall[];
  writes: NewCourseSubgroupWriteData[];
  deps: CreateCourseSubgroupDeps;
}

/**
 * Build recording fakes. The fake compound resolver models the real
 * offering-scoped, top-level-only lookup: it returns the configured parent ONLY
 * when BOTH the (validated) offering id and the submitted parent id match the
 * configured top-level parent; otherwise null (covering missing / other-offering
 * / subgroup-as-parent, exactly as the real `parentGroupId: null` predicate does).
 */
function recordingDeps(opts: {
  status?: CourseOfferingStatus;
  resolvedId?: string;
  resolveThrows?: unknown;
  parent?: { id: string; courseOfferingId: string } | null;
  createId?: string;
  createThrows?: unknown;
}): Recorder {
  const resolveCalls: string[] = [];
  const parentCalls: ParentCall[] = [];
  const writes: NewCourseSubgroupWriteData[] = [];
  const deps: CreateCourseSubgroupDeps = {
    resolveOffering: async (id): Promise<ResolvedOfferingForSubgroup> => {
      resolveCalls.push(id);
      if (opts.resolveThrows !== undefined) {
        throw opts.resolveThrows;
      }
      return { id: opts.resolvedId ?? id.trim(), status: opts.status ?? "PLANNED" };
    },
    resolveTopLevelParent: async (courseOfferingId, parentGroupId) => {
      parentCalls.push({ courseOfferingId, parentGroupId });
      const p = opts.parent;
      if (p && p.id === parentGroupId && p.courseOfferingId === courseOfferingId) {
        return { id: p.id };
      }
      return null;
    },
    createSubgroup: async (data) => {
      writes.push(data);
      if (opts.createThrows !== undefined) {
        throw opts.createThrows;
      }
      return { id: opts.createId ?? "subgroup-new" };
    },
  };
  return { resolveCalls, parentCalls, writes, deps };
}

test("a valid PLANNED request creates exactly one subgroup and returns its id", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
    createId: "subgroup-new",
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: true, id: "subgroup-new" });
  assert.equal(rec.writes.length, 1);
});

test("the write uses the VALIDATED offering id, the PROVEN parent id and the normalized name", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-canonical",
    parent: { id: "parent-1", courseOfferingId: "offering-canonical" },
  });
  await createCourseSubgroupWithDeps(
    "  offering-canonical  ",
    "parent-1",
    { subgroupNumber: "2" },
    rec.deps,
  );
  assert.equal(rec.writes.length, 1);
  assert.deepEqual(rec.writes[0], {
    courseOfferingId: "offering-canonical",
    parentGroupId: "parent-1",
    name: "2",
  });
});

test("leading zeros normalize to the canonical name before the write", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "007" },
    rec.deps,
  );
  assert.equal(rec.writes.length, 1);
  assert.equal(rec.writes[0].name, "7");
});

test("PLANNED permits the operation", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "3" },
    rec.deps,
  );
  assert.equal(result.success, true);
  assert.equal(rec.writes.length, 1);
});

test("ACTIVE is rejected before any parent lookup or write", async () => {
  const rec = recordingDeps({
    status: "ACTIVE",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.equal(rec.parentCalls.length, 0);
  assert.equal(rec.writes.length, 0);
});

test("ARCHIVED is rejected before any parent lookup or write", async () => {
  const rec = recordingDeps({
    status: "ARCHIVED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.equal(rec.parentCalls.length, 0);
  assert.equal(rec.writes.length, 0);
});

test("invalid subgroup input performs no parent lookup and no write (gated + resolved first)", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "0" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "subgroup_invalid" });
  assert.equal(rec.parentCalls.length, 0);
  assert.equal(rec.writes.length, 0);
  // The offering was still resolved first (ordering contract).
  assert.equal(rec.resolveCalls.length, 1);
});

test("a missing/nonexistent offering is rejected before any parent lookup or write", async () => {
  const rec = recordingDeps({
    resolveThrows: new CourseOfferingNotFoundError("bad-id"),
  });
  const result = await createCourseSubgroupWithDeps(
    "bad-id",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "offering_not_found" });
  assert.equal(rec.parentCalls.length, 0);
  assert.equal(rec.writes.length, 0);
});

test("a missing parent (null compound lookup) returns invalid_parent with no write", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: null,
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "invalid_parent" });
  assert.equal(rec.parentCalls.length, 1);
  assert.equal(rec.writes.length, 0);
});

test("a parent from ANOTHER offering returns invalid_parent with no write", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-OTHER" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "invalid_parent" });
  assert.equal(rec.writes.length, 0);
  // The compound resolver was called with the VALIDATED offering id and the
  // SUBMITTED parent id; the offering mismatch is what yields null.
  assert.deepEqual(rec.parentCalls, [
    { courseOfferingId: "offering-1", parentGroupId: "parent-1" },
  ]);
});

test("a subgroup supplied as the parent returns invalid_parent with no write (depth-3 prevented)", async () => {
  // Configured top-level parent is "top-1"; the submitted id "sub-1" is a
  // subgroup, so the offering-scoped top-level-only lookup returns null - exactly
  // as the real query's `parentGroupId: null` predicate excludes a subgroup.
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "top-1", courseOfferingId: "offering-1" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "sub-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "invalid_parent" });
  assert.equal(rec.writes.length, 0);
  assert.deepEqual(rec.parentCalls, [
    { courseOfferingId: "offering-1", parentGroupId: "sub-1" },
  ]);
});

test("the compound resolver is called using the validated offering id and submitted parent id", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-canonical",
    parent: { id: "parent-1", courseOfferingId: "offering-canonical" },
  });
  await createCourseSubgroupWithDeps(
    "  offering-canonical  ",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(rec.parentCalls, [
    { courseOfferingId: "offering-canonical", parentGroupId: "parent-1" },
  ]);
});

test("P2002 maps to the safe duplicate_name result", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
    createThrows: { code: "P2002" },
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(result, { success: false, error: "duplicate_name" });
  assert.equal(rec.writes.length, 1);
});

test("an unexpected write error collapses to unexpected without exposing details or the submitted value", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
    createThrows: new Error("connection reset at 10.0.0.1 while inserting 42"),
  });
  const result = await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "42" },
    rec.deps,
  );
  // Only the stable code is returned - no raw message, no submitted number.
  assert.deepEqual(result, { success: false, error: "unexpected" });
});

test("the operation depends only on an offering resolver, a parent resolver and a single subgroup write", async () => {
  // The dependency surface itself proves no offering/capability/enrollment/
  // membership/student/top-level-group/operational creation is part of the
  // operation: the deps expose exactly three methods, and a successful run
  // resolves once, looks up the parent once, and writes once.
  const rec = recordingDeps({
    status: "PLANNED",
    resolvedId: "offering-1",
    parent: { id: "parent-1", courseOfferingId: "offering-1" },
  });
  await createCourseSubgroupWithDeps(
    "offering-1",
    "parent-1",
    { subgroupNumber: "1" },
    rec.deps,
  );
  assert.deepEqual(Object.keys(rec.deps).sort(), [
    "createSubgroup",
    "resolveOffering",
    "resolveTopLevelParent",
  ]);
  assert.equal(rec.resolveCalls.length, 1);
  assert.equal(rec.parentCalls.length, 1);
  assert.equal(rec.writes.length, 1);
});
