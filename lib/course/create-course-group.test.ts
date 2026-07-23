/**
 * MULTI-COURSE W9A-3 - DB-free IO-boundary tests for createCourseGroupWithDeps.
 *
 * Run with: npx tsx --test lib/course/create-course-group.test.ts
 * No Prisma, no DB: the offering resolver and the single group write are injected
 * as fakes that record their calls, so these tests prove the write boundary
 * (exactly one top-level CourseGroup, parentGroupId always null, the validated
 * explicit offering id used, no write before context validation + status gating,
 * PLANNED allowed / ACTIVE & ARCHIVED rejected, P2002 -> duplicate_name) without
 * a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { CourseOfferingNotFoundError } from "./admin-course-context";
import {
  createCourseGroupWithDeps,
  type CreateCourseGroupDeps,
  type NewCourseGroupWriteData,
  type ResolvedOfferingForGroup,
} from "./create-course-group";

interface Recorder {
  resolveCalls: string[];
  writes: NewCourseGroupWriteData[];
  deps: CreateCourseGroupDeps;
}

function recordingDeps(opts: {
  status?: CourseOfferingStatus;
  resolvedId?: string;
  resolveThrows?: unknown;
  createId?: string;
  createThrows?: unknown;
}): Recorder {
  const resolveCalls: string[] = [];
  const writes: NewCourseGroupWriteData[] = [];
  const deps: CreateCourseGroupDeps = {
    resolveOffering: async (id): Promise<ResolvedOfferingForGroup> => {
      resolveCalls.push(id);
      if (opts.resolveThrows !== undefined) {
        throw opts.resolveThrows;
      }
      return { id: opts.resolvedId ?? id.trim(), status: opts.status ?? "PLANNED" };
    },
    createGroup: async (data) => {
      writes.push(data);
      if (opts.createThrows !== undefined) {
        throw opts.createThrows;
      }
      return { id: opts.createId ?? "group-new" };
    },
  };
  return { resolveCalls, writes, deps };
}

test("a valid PLANNED request creates exactly one group and returns its id", async () => {
  const rec = recordingDeps({ status: "PLANNED", createId: "group-new" });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: true, id: "group-new" });
  assert.equal(rec.writes.length, 1);
});

test("the write uses the VALIDATED explicit offering id, not the raw caller value", async () => {
  const rec = recordingDeps({ status: "PLANNED", resolvedId: "offering-canonical" });
  await createCourseGroupWithDeps("  offering-canonical  ", { name: "ב" }, rec.deps);
  assert.equal(rec.writes.length, 1);
  assert.equal(rec.writes[0].courseOfferingId, "offering-canonical");
});

test("parentGroupId is always null (top-level only) and the normalized name is used", async () => {
  const rec = recordingDeps({ status: "PLANNED" });
  await createCourseGroupWithDeps("offering-1", { name: "  קבוצת בוקר  " }, rec.deps);
  assert.equal(rec.writes[0].parentGroupId, null);
  assert.equal(rec.writes[0].name, "קבוצת בוקר");
});

test("PLANNED permits the operation", async () => {
  const rec = recordingDeps({ status: "PLANNED" });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.equal(result.success, true);
  assert.equal(rec.writes.length, 1);
});

test("ACTIVE is rejected before the write", async () => {
  const rec = recordingDeps({ status: "ACTIVE" });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.equal(rec.writes.length, 0);
});

test("ARCHIVED is rejected before the write", async () => {
  const rec = recordingDeps({ status: "ARCHIVED" });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.equal(rec.writes.length, 0);
});

test("a missing/invalid offering context is rejected before the write", async () => {
  const rec = recordingDeps({ resolveThrows: new CourseOfferingNotFoundError("bad-id") });
  const result = await createCourseGroupWithDeps("bad-id", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: false, error: "offering_not_found" });
  assert.equal(rec.writes.length, 0);
});

test("P2002 maps to the safe duplicate_name result", async () => {
  const rec = recordingDeps({ status: "PLANNED", createThrows: { code: "P2002" } });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: false, error: "duplicate_name" });
  assert.equal(rec.writes.length, 1);
});

test("an unexpected write error collapses to unexpected without exposing details", async () => {
  const rec = recordingDeps({
    status: "PLANNED",
    createThrows: new Error("connection reset at 10.0.0.1"),
  });
  const result = await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(result, { success: false, error: "unexpected" });
});

test("invalid input performs no group write (name validated after gating)", async () => {
  const rec = recordingDeps({ status: "PLANNED" });
  const result = await createCourseGroupWithDeps("offering-1", { name: "   " }, rec.deps);
  assert.deepEqual(result, { success: false, error: "name_required" });
  assert.equal(rec.writes.length, 0);
  // The offering was still resolved and gated first (ordering contract).
  assert.equal(rec.resolveCalls.length, 1);
});

test("the operation depends only on an offering resolve and a single group write", async () => {
  // The dependency surface itself proves no offering/capability/enrollment/
  // membership/student/subgroup creation is part of the operation: the deps
  // expose exactly two methods, and a successful run invokes each once.
  const rec = recordingDeps({ status: "PLANNED" });
  await createCourseGroupWithDeps("offering-1", { name: "א" }, rec.deps);
  assert.deepEqual(Object.keys(rec.deps).sort(), ["createGroup", "resolveOffering"]);
  assert.equal(rec.resolveCalls.length, 1);
  assert.equal(rec.writes.length, 1);
});
