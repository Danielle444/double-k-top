/**
 * ACTIVE-RENAME - DB-free IO-boundary tests for renameCourseOfferingWithDeps.
 *
 * Run with: npx tsx --test lib/course/rename-offering.test.ts
 * No Prisma, no DB: the offering resolver and the single atomic conditional
 * update are injected as fakes that record their calls, so these tests prove the
 * write boundary (only the name column, gated by OFFERING_METADATA_UPDATE, no
 * write for a no-op, P2002 -> duplicate, zero count -> stale, no unguarded
 * fallback) without a live database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  renameCourseOfferingWithDeps,
  type RenameOfferingDeps,
  type ResolvedOfferingForRename,
} from "./rename-offering";
import type { RawRenameOfferingInput } from "./rename-offering-core";
import { CourseOfferingNotFoundError } from "./admin-course-context";

const OLD_NAME = "קורס מדריכים ומאמנים – רמה 1";
const NEW_NAME = "קורס מדריכים קיץ – רמה 1";

function validInput(overrides: Partial<RawRenameOfferingInput> = {}): RawRenameOfferingInput {
  return {
    courseOfferingId: "offering-1",
    expectedCurrentName: OLD_NAME,
    name: NEW_NAME,
    ...overrides,
  };
}

interface RenameCall {
  courseOfferingId: string;
  expectedCurrentName: string;
  name: string;
}

function makeDeps(
  opts: {
    status?: CourseOfferingStatus;
    resolveThrows?: unknown;
    renameThrows?: unknown;
    renameCount?: number;
  } = {},
): { deps: RenameOfferingDeps; resolveCalls: string[]; renameCalls: RenameCall[] } {
  const resolveCalls: string[] = [];
  const renameCalls: RenameCall[] = [];
  const deps: RenameOfferingDeps = {
    resolveOffering: async (id): Promise<ResolvedOfferingForRename> => {
      resolveCalls.push(id);
      if (opts.resolveThrows !== undefined) {
        throw opts.resolveThrows;
      }
      return { id, status: opts.status ?? "ACTIVE" };
    },
    renameOffering: async (courseOfferingId, expectedCurrentName, name) => {
      renameCalls.push({ courseOfferingId, expectedCurrentName, name });
      if (opts.renameThrows !== undefined) {
        throw opts.renameThrows;
      }
      return opts.renameCount ?? 1;
    },
  };
  return { deps, resolveCalls, renameCalls };
}

test("ACTIVE offering: renames only the name via one atomic conditional update", async () => {
  const { deps, resolveCalls, renameCalls } = makeDeps({ status: "ACTIVE" });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);

  assert.deepEqual(result, { success: true, id: "offering-1", changed: true });
  assert.deepEqual(resolveCalls, ["offering-1"]);
  // Exactly one write, carrying only (id, expected name, new name) - nothing else.
  assert.equal(renameCalls.length, 1);
  assert.deepEqual(renameCalls[0], {
    courseOfferingId: "offering-1",
    expectedCurrentName: OLD_NAME,
    name: NEW_NAME,
  });
});

test("PLANNED offering: rename is allowed", async () => {
  const { deps, renameCalls } = makeDeps({ status: "PLANNED" });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: true, id: "offering-1", changed: true });
  assert.equal(renameCalls.length, 1);
});

test("ARCHIVED offering: rejected as operation_not_allowed with NO write", async () => {
  const { deps, resolveCalls, renameCalls } = makeDeps({ status: "ARCHIVED" });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.deepEqual(resolveCalls, ["offering-1"]);
  assert.equal(renameCalls.length, 0);
});

test("same-name input succeeds as a no-op with NO write", async () => {
  const { deps, resolveCalls, renameCalls } = makeDeps({ status: "ACTIVE" });
  const result = await renameCourseOfferingWithDeps(
    validInput({ name: OLD_NAME }),
    deps,
  );
  assert.deepEqual(result, { success: true, id: "offering-1", changed: false });
  assert.deepEqual(resolveCalls, ["offering-1"]);
  assert.equal(renameCalls.length, 0);
});

test("no-op on an ARCHIVED offering is still rejected (gate precedes no-op)", async () => {
  const { deps, renameCalls } = makeDeps({ status: "ARCHIVED" });
  const result = await renameCourseOfferingWithDeps(
    validInput({ name: OLD_NAME }),
    deps,
  );
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.equal(renameCalls.length, 0);
});

test("P2002 from the conditional update maps to duplicate_name", async () => {
  const { deps } = makeDeps({ status: "ACTIVE", renameThrows: { code: "P2002" } });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: false, error: "duplicate_name" });
});

test("zero-row conditional update maps to stale_name with no fallback write", async () => {
  const { deps, renameCalls } = makeDeps({ status: "ACTIVE", renameCount: 0 });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: false, error: "stale_name" });
  // The conditional update ran exactly once; no unguarded fallback update.
  assert.equal(renameCalls.length, 1);
});

test("unexpected persistence error fails closed as unexpected", async () => {
  const { deps } = makeDeps({
    status: "ACTIVE",
    renameThrows: new Error("connection reset"),
  });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: false, error: "unexpected" });
});

test("offering not found: CourseOfferingNotFoundError maps to offering_not_found, NO write", async () => {
  const { deps, renameCalls } = makeDeps({
    resolveThrows: new CourseOfferingNotFoundError("offering-1"),
  });
  const result = await renameCourseOfferingWithDeps(validInput(), deps);
  assert.deepEqual(result, { success: false, error: "offering_not_found" });
  assert.equal(renameCalls.length, 0);
});

test("validation failure (empty name) short-circuits before any resolve/write", async () => {
  const { deps, resolveCalls, renameCalls } = makeDeps({ status: "ACTIVE" });
  const result = await renameCourseOfferingWithDeps(validInput({ name: "  " }), deps);
  assert.deepEqual(result, { success: false, error: "name_required" });
  assert.equal(resolveCalls.length, 0);
  assert.equal(renameCalls.length, 0);
});

test("a non-not-found resolver error propagates untouched", async () => {
  const boom = new Error("auth redirect / unexpected");
  const { deps } = makeDeps({ resolveThrows: boom });
  await assert.rejects(
    () => renameCourseOfferingWithDeps(validInput(), deps),
    /auth redirect \/ unexpected/,
  );
});
