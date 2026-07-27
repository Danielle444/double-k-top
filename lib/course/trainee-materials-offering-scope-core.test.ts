/**
 * P-MATERIALS M2C - focused tests for the trainee materials offering-scope core.
 *
 * Two halves, both DB-free and storage-free:
 *  1. PURE - resolveTraineeMaterialsOfferingIdsFromRows: the union/dedup/order
 *     and fail-closed rules over already-read enrollment+capability rows.
 *  2. ORCHESTRATION - loadTraineeScopedMaterialsWithDeps against plain fakes:
 *     session denial, "load all enrollments", bounded per-offering capability
 *     resolution, the empty->[] short-circuit (no material read), infra-error
 *     propagation, and that loadMaterials receives exactly the enabled union.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/trainee-materials-offering-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveTraineeMaterialsOfferingIdsFromRows,
  loadTraineeScopedMaterialsWithDeps,
  type TraineeMaterialsScopeRow,
  type TraineeEnrollmentScopeRow,
  type TraineeScopedMaterialsDeps,
} from "@/lib/course/trainee-materials-offering-scope-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";

const L1 = "offering-l1";
const L2 = "offering-l2";

function row(overrides: Partial<TraineeMaterialsScopeRow> = {}): TraineeMaterialsScopeRow {
  return {
    courseOfferingId: L1,
    enrollmentStatus: "ACTIVE",
    offeringStatus: "ACTIVE",
    materialsCapabilityEnabled: true,
    ...overrides,
  };
}

// ===========================================================================
// PART 1 - pure resolveTraineeMaterialsOfferingIdsFromRows
// ===========================================================================

// 1
test("L1-only active + enabled -> [L1]", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({ enrollments: [row({ courseOfferingId: L1 })] });
  assert.deepEqual([...ids], [L1]);
});

// 2
test("active offering but capability DISABLED -> excluded", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ courseOfferingId: L2, materialsCapabilityEnabled: false })],
  });
  assert.deepEqual([...ids], []);
});

// 3
test("dual-enrolled, both enabled -> both ids, first-seen order", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ courseOfferingId: L1 }), row({ courseOfferingId: L2 })],
  });
  assert.deepEqual([...ids], [L1, L2]);
});

// 4
test("dual-enrolled, only L1 enabled -> only L1", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [
      row({ courseOfferingId: L1, materialsCapabilityEnabled: true }),
      row({ courseOfferingId: L2, materialsCapabilityEnabled: false }),
    ],
  });
  assert.deepEqual([...ids], [L1]);
});

// 5
test("INACTIVE enrollment excluded", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ enrollmentStatus: "INACTIVE" })],
  });
  assert.deepEqual([...ids], []);
});

// 6
test("PLANNED offering excluded", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ offeringStatus: "PLANNED" })],
  });
  assert.deepEqual([...ids], []);
});

// 7
test("ARCHIVED offering excluded", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ offeringStatus: "ARCHIVED" })],
  });
  assert.deepEqual([...ids], []);
});

// 8
test("duplicate enrollment rows deduplicate (first-seen)", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ courseOfferingId: L1 }), row({ courseOfferingId: L1 }), row({ courseOfferingId: L2 })],
  });
  assert.deepEqual([...ids], [L1, L2]);
});

// 9
test("no enrollments -> []", () => {
  assert.deepEqual([...resolveTraineeMaterialsOfferingIdsFromRows({ enrollments: [] })], []);
});

// 10 - no null/name/level fallback: a malformed/blank id never becomes an id
test("blank / non-string id and malformed rows fail closed (no fallback)", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [
      row({ courseOfferingId: "   " }),
      row({ courseOfferingId: "" }),
      { ...row(), courseOfferingId: 123 as unknown as string },
      null as unknown as TraineeMaterialsScopeRow,
    ],
  });
  assert.deepEqual([...ids], []);
  // A non-array input also fails closed rather than throwing.
  assert.deepEqual(
    [...resolveTraineeMaterialsOfferingIdsFromRows({ enrollments: undefined as unknown as [] })],
    [],
  );
});

test("a truthy but non-boolean capability flag does NOT enable (strict true)", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [row({ materialsCapabilityEnabled: "ENABLED" as unknown as boolean })],
  });
  assert.deepEqual([...ids], []);
});

// 11
test("first-seen deterministic order across a larger mix", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({
    enrollments: [
      row({ courseOfferingId: "c" }),
      row({ courseOfferingId: "a" }),
      row({ courseOfferingId: "c" }),
      row({ courseOfferingId: "b" }),
    ],
  });
  assert.deepEqual([...ids], ["c", "a", "b"]);
});

// 12
test("the input is not mutated", () => {
  const enrollments = [row({ courseOfferingId: L1 }), row({ courseOfferingId: L2 })];
  const snapshot = enrollments.map((e) => ({ ...e }));
  resolveTraineeMaterialsOfferingIdsFromRows({ enrollments });
  assert.deepEqual(enrollments, snapshot);
});

// 13
test("the result is frozen", () => {
  const ids = resolveTraineeMaterialsOfferingIdsFromRows({ enrollments: [row()] });
  assert.ok(Object.isFrozen(ids));
  assert.throws(() => (ids as string[]).push("x"));
});

// ===========================================================================
// PART 2 - loadTraineeScopedMaterialsWithDeps orchestration
// ===========================================================================

interface Spy {
  calls: string[];
  loadMaterialsArgs: string[][];
}

function makeDeps(options: {
  traineeIdError?: unknown;
  enrollments?: readonly TraineeEnrollmentScopeRow[];
  enrollmentsError?: unknown;
  enabledOfferingIds?: string[];
  capabilityError?: unknown;
  materials?: string[];
  materialsError?: unknown;
}): { deps: TraineeScopedMaterialsDeps<string>; spy: Spy } {
  const spy: Spy = { calls: [], loadMaterialsArgs: [] };
  const enabled = new Set(options.enabledOfferingIds ?? []);
  return {
    spy,
    deps: {
      requireTraineeId: async () => {
        spy.calls.push("actor");
        if (options.traineeIdError !== undefined) throw options.traineeIdError;
        return "trainee-1";
      },
      loadEnrollments: async (traineeId) => {
        spy.calls.push(`enrollments:${traineeId}`);
        if (options.enrollmentsError !== undefined) throw options.enrollmentsError;
        return options.enrollments ?? [];
      },
      isMaterialsCapabilityEnabled: async (offeringId) => {
        spy.calls.push(`capability:${offeringId}`);
        if (options.capabilityError !== undefined) throw options.capabilityError;
        return enabled.has(offeringId);
      },
      loadMaterials: async (ids) => {
        spy.calls.push(`materials:${[...ids].join(",")}`);
        spy.loadMaterialsArgs.push([...ids]);
        if (options.materialsError !== undefined) throw options.materialsError;
        return options.materials ?? [];
      },
    },
  };
}

const enroll = (
  courseOfferingId: string,
  enrollmentStatus: "ACTIVE" | "INACTIVE" = "ACTIVE",
  offeringStatus: "ACTIVE" | "PLANNED" | "ARCHIVED" = "ACTIVE",
): TraineeEnrollmentScopeRow => ({ courseOfferingId, enrollmentStatus, offeringStatus });

// 21
test("anonymous / inactive trainee -> [] and no enrollment read", async () => {
  const { deps, spy } = makeDeps({ traineeIdError: new UnauthenticatedActorError("No authenticated trainee") });
  const result = await loadTraineeScopedMaterialsWithDeps(deps);
  assert.deepEqual(result, []);
  assert.deepEqual(spy.calls, ["actor"], "stops at the actor gate; no enrollment/capability/material read");
});

// 15 + 3 + 16 + 17
test("dual-enrolled both enabled: loads all enrollments, then materials for the union once", async () => {
  const { deps, spy } = makeDeps({
    enrollments: [enroll(L1), enroll(L2), enroll(L1)],
    enabledOfferingIds: [L1, L2],
    materials: ["m-shared"],
  });
  const result = await loadTraineeScopedMaterialsWithDeps(deps);
  assert.deepEqual(result, ["m-shared"], "a material shared by both offerings is returned once");
  assert.deepEqual(spy.loadMaterialsArgs, [[L1, L2]], "loadMaterials receives the deduped enabled union");
  assert.ok(spy.calls.includes("enrollments:trainee-1"), "all enrollments are loaded");
  // Capability resolved once per distinct active candidate, not per raw row.
  assert.deepEqual(
    spy.calls.filter((c) => c.startsWith("capability:")),
    [`capability:${L1}`, `capability:${L2}`],
  );
});

// 2 (reader level)
test("L2-only, capability disabled -> [] and NO material read", async () => {
  const { deps, spy } = makeDeps({ enrollments: [enroll(L2)], enabledOfferingIds: [] });
  const result = await loadTraineeScopedMaterialsWithDeps(deps);
  assert.deepEqual(result, []);
  assert.ok(!spy.calls.some((c) => c.startsWith("materials:")), "no material query when nothing is enabled");
});

// 4 (reader level)
test("dual-enrolled, only L1 enabled -> materials for [L1] only", async () => {
  const { deps, spy } = makeDeps({
    enrollments: [enroll(L1), enroll(L2)],
    enabledOfferingIds: [L1],
    materials: ["m-l1"],
  });
  const result = await loadTraineeScopedMaterialsWithDeps(deps);
  assert.deepEqual(result, ["m-l1"]);
  assert.deepEqual(spy.loadMaterialsArgs, [[L1]]);
});

// 5/6 reader level - inactive enrollment & non-active offering never reach capability
test("inactive enrollment and non-active offering are not candidates", async () => {
  const { deps, spy } = makeDeps({
    enrollments: [enroll(L1, "INACTIVE"), enroll(L2, "ACTIVE", "PLANNED")],
    enabledOfferingIds: [L1, L2],
  });
  const result = await loadTraineeScopedMaterialsWithDeps(deps);
  assert.deepEqual(result, []);
  assert.deepEqual(
    spy.calls.filter((c) => c.startsWith("capability:")),
    [],
    "capability is never resolved for an ineligible enrollment/offering",
  );
});

// 9 reader level
test("no enrollments -> [] without a material read", async () => {
  const { deps, spy } = makeDeps({ enrollments: [] });
  assert.deepEqual(await loadTraineeScopedMaterialsWithDeps(deps), []);
  assert.ok(!spy.calls.some((c) => c.startsWith("materials:")));
});

// 22
test("infrastructure errors propagate (never become [])", async () => {
  await assert.rejects(
    () => loadTraineeScopedMaterialsWithDeps(makeDeps({ enrollmentsError: new Error("db down") }).deps),
    /db down/,
  );
  await assert.rejects(
    () =>
      loadTraineeScopedMaterialsWithDeps(
        makeDeps({ enrollments: [enroll(L1)], capabilityError: new Error("cap read failed") }).deps,
      ),
    /cap read failed/,
  );
  await assert.rejects(
    () =>
      loadTraineeScopedMaterialsWithDeps(
        makeDeps({ enrollments: [enroll(L1)], enabledOfferingIds: [L1], materialsError: new Error("sign failed") }).deps,
      ),
    /sign failed/,
  );
  // A non-denial error from the actor step also propagates (only
  // UnauthenticatedActorError is a denial).
  await assert.rejects(
    () => loadTraineeScopedMaterialsWithDeps(makeDeps({ traineeIdError: new Error("session store unreachable") }).deps),
    /session store unreachable/,
  );
});
