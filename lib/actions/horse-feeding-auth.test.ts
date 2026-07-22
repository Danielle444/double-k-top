/**
 * HF-SEC-1RW - focused behavioral tests for the session-bound instructor
 * horse-feeding READ + WRITE orchestration (lib/actions/horse-feeding-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the HF-SEC-1RW
 * contract:
 *  - the instructor overview read is gated on a server-derived instructor actor;
 *    an unauthenticated (null) actor - or a thrown actor resolution - fails closed
 *    to [] and never reads;
 *  - the instructor meal upsert derives identity + permission + authorship ONLY
 *    from the server actor; a null actor, an actor without canEditHorseFeeding, or
 *    a thrown resolution is rejected before the mutator runs;
 *  - neither path has an instructor-id parameter a client could supply to select
 *    another actor, borrow a permission, or choose updatedByName;
 *  - authorization denial happens strictly before the reader/mutator dependency.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/horse-feeding-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadInstructorHorseFeedingOverviewWithDeps,
  upsertInstructorHorseFeedingMealsWithDeps,
  type InstructorHorseFeedingReadDeps,
  type InstructorHorseFeedingUpsertDeps,
} from "./horse-feeding-auth";
import type { HorseFeedingOverviewRow, HorseFeedingUpsertInput } from "./horse-feeding";

// --- fixtures ---------------------------------------------------------------

// Minimal sentinel overview rows - shape is irrelevant to the gate under test,
// only object identity is asserted, so the DTO is cast rather than fully filled.
// Includes an attendance-derived field to document that the authorized read
// passes the attendance-derived operational data through unchanged.
function sentinelRows(tag: string): HorseFeedingOverviewRow[] {
  return [
    {
      horseName: tag,
      attendanceStatus: "ABSENT",
      attendanceNotes: "notes-" + tag,
    } as unknown as HorseFeedingOverviewRow,
  ];
}

// A minimal valid-looking upsert payload. Its content is never inspected by the
// orchestration under test (validation lives in the real mutator), so a cast is
// sufficient; identity/permission/authorship are what these tests exercise.
function samplePayload(): HorseFeedingUpsertInput {
  return {
    horseName: "Rakia",
    morning: {},
    evening: {},
    hasLunch: false,
    lunch: {},
  } as unknown as HorseFeedingUpsertInput;
}

const NO_PERMISSION_ERROR = "אין הרשאה לערוך האכלות";

// ===========================================================================
// Instructor horse-feeding overview READ
// ===========================================================================

test("read: authorized active instructor gets the same overview result", async () => {
  const rows = sentinelRows("ok");
  let buildCalls = 0;
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    buildOverview: async () => {
      buildCalls++;
      return rows;
    },
  };
  const result = await loadInstructorHorseFeedingOverviewWithDeps(deps);
  assert.equal(buildCalls, 1, "reader must run for an authorized instructor");
  assert.equal(result, rows, "authorized read returns the reader's exact result");
});

test("read: authorized read preserves attendance-derived feeding fields", async () => {
  const rows = sentinelRows("att");
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    buildOverview: async () => rows,
  };
  const result = await loadInstructorHorseFeedingOverviewWithDeps(deps);
  assert.equal(result[0].attendanceStatus, "ABSENT");
  assert.equal(result[0].attendanceNotes, "notes-att");
});

test("read: unauthenticated (null actor) fails closed to [] and never reads", async () => {
  let buildCalls = 0;
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => null,
    buildOverview: async () => {
      buildCalls++;
      return sentinelRows("should-not-happen");
    },
  };
  const result = await loadInstructorHorseFeedingOverviewWithDeps(deps);
  assert.deepEqual(result, [], "unauthenticated read must be []");
  assert.equal(buildCalls, 0, "reader must NOT run for a null actor");
});

test("read: trainee / wrong-role / inactive / missing actor all resolve to null -> [] and never reads", async () => {
  // getCurrentInstructor returns null in every such case (wrong audience,
  // inactive row, missing/deleted row, subject mismatch) - one representative
  // null case proves the whole class fails closed without reading.
  let buildCalls = 0;
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => null,
    buildOverview: async () => {
      buildCalls++;
      return sentinelRows("nope");
    },
  };
  const result = await loadInstructorHorseFeedingOverviewWithDeps(deps);
  assert.deepEqual(result, []);
  assert.equal(buildCalls, 0);
});

test("read: actor-resolution rejection fails closed to [] and never reads", async () => {
  let buildCalls = 0;
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    buildOverview: async () => {
      buildCalls++;
      return sentinelRows("nope");
    },
  };
  const result = await loadInstructorHorseFeedingOverviewWithDeps(deps);
  assert.deepEqual(result, [], "a thrown actor resolution must fail closed to []");
  assert.equal(buildCalls, 0, "reader must NOT run when actor resolution throws");
});

test("read: a genuine reader error still propagates (only actor resolution is caught)", async () => {
  const deps: InstructorHorseFeedingReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    buildOverview: async () => {
      throw new Error("db read failed");
    },
  };
  await assert.rejects(
    () => loadInstructorHorseFeedingOverviewWithDeps(deps),
    /db read failed/,
    "buildOverview errors must not be swallowed by the actor catch"
  );
});

// ===========================================================================
// Instructor horse-feeding meal UPSERT (write)
// ===========================================================================

test("write: authorized instructor with canEditHorseFeeding=true runs the mutator", async () => {
  let mutatorCalls = 0;
  let seenName: string | null = null;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "Dana Instructor" }),
    upsertMeals: async (_input, updatedByName) => {
      mutatorCalls++;
      seenName = updatedByName;
      return { success: true };
    },
  };
  const result = await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.deepEqual(result, { success: true });
  assert.equal(mutatorCalls, 1, "mutator runs for an authorized instructor");
  assert.equal(seenName, "Dana Instructor", "updatedByName comes from the signed-in actor");
});

test("write: updatedByName is the server actor's fullName, never a client value", async () => {
  // The payload carries no authorship field, and the mutator receives only the
  // server-derived fullName - this documents that a client cannot select it.
  let seenName: string | null = null;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "Real Actor" }),
    upsertMeals: async (_input, updatedByName) => {
      seenName = updatedByName;
      return { success: true };
    },
  };
  await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.equal(seenName, "Real Actor");
});

test("write: unauthenticated (null actor) is rejected and never mutates", async () => {
  let mutatorCalls = 0;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => null,
    upsertMeals: async () => {
      mutatorCalls++;
      return { success: true };
    },
  };
  const result = await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalls, 0, "mutator must NOT run for a null actor");
});

test("write: trainee / wrong-role / inactive / missing actor (null) is rejected and never mutates", async () => {
  let mutatorCalls = 0;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => null,
    upsertMeals: async () => {
      mutatorCalls++;
      return { success: true };
    },
  };
  const result = await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.equal(result.success, false);
  assert.equal(mutatorCalls, 0);
});

test("write: instructor with canEditHorseFeeding=false is rejected and never mutates", async () => {
  let mutatorCalls = 0;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditHorseFeeding: false, fullName: "No Perm" }),
    upsertMeals: async () => {
      mutatorCalls++;
      return { success: true };
    },
  };
  const result = await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalls, 0, "an actor lacking the permission must not write");
});

test("write: actor-resolution rejection fails closed and never mutates", async () => {
  let mutatorCalls = 0;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    upsertMeals: async () => {
      mutatorCalls++;
      return { success: true };
    },
  };
  const result = await upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload());
  assert.deepEqual(result, { success: false, error: NO_PERMISSION_ERROR });
  assert.equal(mutatorCalls, 0, "a thrown actor resolution must not reach the mutator");
});

test("write: denial happens before the mutator dependency is invoked", async () => {
  // Ordering proof: the mutator throws if ever reached; every denial path must
  // return a failure result rather than surfacing that throw.
  const throwingMutator: InstructorHorseFeedingUpsertDeps["upsertMeals"] = async () => {
    throw new Error("mutator must not be reached on denial");
  };
  for (const actor of [
    null,
    { canEditHorseFeeding: false, fullName: "x" },
  ] as const) {
    const result = await upsertInstructorHorseFeedingMealsWithDeps(
      { getCurrentInstructor: async () => actor, upsertMeals: throwingMutator },
      samplePayload()
    );
    assert.equal(result.success, false);
  }
});

test("write: an authorized mutator error propagates (mutator owns create/update/delete + validation)", async () => {
  // The orchestration does not swallow real mutator failures - payload validation
  // and the upsert/delete transaction remain the mutator's responsibility and run
  // only after authorization passes.
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "Dana" }),
    upsertMeals: async () => {
      throw new Error("transaction failed");
    },
  };
  await assert.rejects(
    () => upsertInstructorHorseFeedingMealsWithDeps(deps, samplePayload()),
    /transaction failed/
  );
});

test("write: the authorized mutator receives the exact payload it was given", async () => {
  const payload = samplePayload();
  let seenInput: HorseFeedingUpsertInput | null = null;
  const deps: InstructorHorseFeedingUpsertDeps = {
    getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "Dana" }),
    upsertMeals: async (input) => {
      seenInput = input;
      return { success: true };
    },
  };
  await upsertInstructorHorseFeedingMealsWithDeps(deps, payload);
  assert.equal(seenInput, payload, "payload is forwarded unchanged to the mutator");
});

// ===========================================================================
// Contract: no client-supplied actor identity participates
// ===========================================================================

test("neither orchestration accepts an instructor-id / actor-identity parameter", () => {
  // Arity guard (secondary evidence): the read takes exactly its deps object and
  // the write takes deps + the feeding input - no positional instructor-id slot
  // exists on either signed-session-bound entry point.
  assert.equal(
    loadInstructorHorseFeedingOverviewWithDeps.length,
    1,
    "reader takes only its deps - no client identity parameter"
  );
  assert.equal(
    upsertInstructorHorseFeedingMealsWithDeps.length,
    2,
    "writer takes deps + payload only - no client identity parameter"
  );
});

test("horse-feeding-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(fileURLToPath(new URL("./horse-feeding-auth.ts", import.meta.url)), "utf8");
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.ok(
    !/from ["']next\/(headers|cache)["']/.test(src),
    "must not import next/headers or next/cache"
  );
});

// ===========================================================================
// Wiring assertions (SECONDARY evidence).
//
// The behavioral DI tests above are the primary proof of the authorization
// contract. These source checks only confirm the public "use server" actions and
// the one client call site are wired to that contract - they cannot be imported
// directly here because they transitively pull in Prisma / next. Same convention
// as lib/actions/attendance-write-auth.test.ts's source assertion on attendance.ts.
// ===========================================================================

test("wiring: the instructor server actions route through the session-bound orchestration", () => {
  const src = readFileSync(fileURLToPath(new URL("./horse-feeding.ts", import.meta.url)), "utf8");

  // Reader: no client identity parameter, routed through the DI reader.
  assert.match(
    src,
    /getHorseFeedingOverviewForInstructor\(\s*\)\s*:/,
    "instructor reader must take no parameters"
  );
  assert.match(
    src,
    /loadInstructorHorseFeedingOverviewWithDeps/,
    "instructor reader must delegate to the session-bound orchestration"
  );

  // Writer: signature carries ONLY the feeding input (no instructorId), routed
  // through the DI writer, and no longer re-reads the instructor row by a
  // client id (prisma.instructor.findUnique is gone from this file entirely).
  assert.match(
    src,
    /upsertHorseFeedingMealsAsInstructor\(\s*input:\s*HorseFeedingUpsertInput\s*\)/,
    "instructor writer must accept only the feeding input"
  );
  assert.match(
    src,
    /upsertInstructorHorseFeedingMealsWithDeps/,
    "instructor writer must delegate to the session-bound orchestration"
  );
  assert.ok(
    !/prisma\.instructor\.findUnique/.test(src),
    "the writer must not re-read an instructor row by a client-supplied id"
  );
});

test("wiring: the client call site invokes the writer without an instructorId", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../app/instructor/InstructorHorsesSection.tsx", import.meta.url)),
    "utf8"
  );
  assert.match(
    src,
    /upsertHorseFeedingMealsAsInstructor\(input\)/,
    "the call site must pass only the validated feeding input"
  );
  assert.ok(
    !/upsertHorseFeedingMealsAsInstructor\(instructorId/.test(src),
    "the call site must not pass a client instructorId to the writer"
  );
});

test("wiring: getHorseFeedingOverviewForAdmin keeps its separate requireAdmin boundary", () => {
  const src = readFileSync(fileURLToPath(new URL("./horse-feeding.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /getHorseFeedingOverviewForAdmin[\s\S]*?requireAdmin\(\)/,
    "admin reader must still gate on requireAdmin, unchanged and separate"
  );
  assert.match(
    src,
    /upsertHorseFeedingMealsAsAdmin[\s\S]*?requireAdmin\(\)/,
    "admin writer must still gate on requireAdmin, unchanged and separate"
  );
});
