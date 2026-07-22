/**
 * RS-SEC-1I-CP-RD - focused behavioral tests for the session-bound instructor
 * complex-plan READ orchestration (lib/actions/riding-slot-complex-read-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They are the PRIMARY security
 * evidence for the RS-SEC-1I-CP-RD contract for both readers:
 *  - each read is gated on a server-derived instructor actor; an unauthenticated
 *    (null) actor - or a thrown actor resolution - fails closed to null and never
 *    runs the underlying reader;
 *  - identity comes ONLY from the injected actor resolver - neither orchestration
 *    has an instructor-id parameter a client could supply;
 *  - viewing does NOT require canEditRidingNotes to be ALLOWED (a read-only
 *    instructor still reads); but the plan reader's returned canEdit is the SIGNED
 *    actor's canEditRidingNotes (true or false), never a borrowed/client value;
 *  - the publication-status reader consults identity only (no canEditRidingNotes);
 *  - denial happens strictly before the reader/Prisma dependency is invoked;
 *  - a genuine authorized reader error still propagates (only actor resolution is
 *    caught) and is never converted to a null authorization denial.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slot-complex-read-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadComplexPlanForInstructorWithDeps,
  loadComplexPublicationStatusForInstructorWithDeps,
  type ComplexPlanForInstructorReadDeps,
  type ComplexPublicationStatusForInstructorReadDeps,
} from "./riding-slot-complex-read-auth";
import type { RidingSlotComplexPlanForEditing } from "./riding-slot-complex";
import type { ComplexRidingPlanPublicationStatus } from "./riding-slot-complex-publications";

// --- fixtures ---------------------------------------------------------------

// Minimal sentinel results - shape is irrelevant to the gate under test, only
// object identity / a couple of fields are asserted, so the DTOs are cast. The
// plan sentinel echoes back the canEdit it was built with, so a test can prove
// the SIGNED actor's flag (not a client value) reached the builder.
function sentinelPlan(ridingSlotId: string, canEdit: boolean): RidingSlotComplexPlanForEditing {
  return { ridingSlotId, canEdit } as unknown as RidingSlotComplexPlanForEditing;
}

function sentinelStatus(ridingSlotId: string): ComplexRidingPlanPublicationStatus {
  return { ridingSlotId, status: "CURRENT" } as unknown as ComplexRidingPlanPublicationStatus;
}

// ===========================================================================
// getRidingSlotComplexPlanForInstructor orchestration
// ===========================================================================

test("plan: signed active instructor with canEditRidingNotes=true reads with canEdit=true", async () => {
  let seen: [string, boolean] | null = null;
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true }),
    readPlan: async (slotId, canEdit) => {
      seen = [slotId, canEdit];
      return sentinelPlan(slotId, canEdit);
    },
  };
  const result = await loadComplexPlanForInstructorWithDeps(deps, "slot-1");
  assert.deepEqual(seen, ["slot-1", true], "ridingSlotId + signed canEdit=true forwarded exactly once");
  assert.equal(result?.canEdit, true, "returned canEdit reflects the signed actor (true)");
  assert.equal(result?.ridingSlotId, "slot-1");
});

test("plan: signed active instructor with canEditRidingNotes=false still reads, canEdit=false", async () => {
  let calls = 0;
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: false }),
    readPlan: async (slotId, canEdit) => {
      calls++;
      return sentinelPlan(slotId, canEdit);
    },
  };
  const result = await loadComplexPlanForInstructorWithDeps(deps, "slot-2");
  assert.equal(calls, 1, "a read-only instructor still executes the plan reader");
  assert.equal(result?.canEdit, false, "returned canEdit reflects the signed actor (false)");
  assert.equal(result?.ridingSlotId, "slot-2");
});

test("plan: another instructor's permission cannot determine canEdit (only the signed actor does)", async () => {
  // Two different signed actors -> two different canEdit outcomes, with NO
  // parameter path by which a client could inject a competing value.
  const build = async (flag: boolean) =>
    (
      await loadComplexPlanForInstructorWithDeps(
        {
          getCurrentInstructor: async () => ({ canEditRidingNotes: flag }),
          readPlan: async (slotId, canEdit) => sentinelPlan(slotId, canEdit),
        },
        "slot"
      )
    )?.canEdit;
  assert.equal(await build(true), true);
  assert.equal(await build(false), false);
});

test("plan: unauthenticated (null actor) fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readPlan: async (slotId, canEdit) => {
      calls++;
      return sentinelPlan(slotId, canEdit);
    },
  };
  assert.equal(await loadComplexPlanForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "plan reader must NOT run for a null actor");
});

test("plan: trainee/wrong-role/missing/inactive/malformed actor (null) -> null and never reads", async () => {
  // getCurrentInstructor returns null for every such case (wrong audience,
  // inactive/missing row, subject mismatch, malformed derive); one null case
  // proves the whole class handled identically by this gate.
  let calls = 0;
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readPlan: async (slotId, canEdit) => {
      calls++;
      return sentinelPlan(slotId, canEdit);
    },
  };
  assert.equal(await loadComplexPlanForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("plan: actor-resolution rejection fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    readPlan: async (slotId, canEdit) => {
      calls++;
      return sentinelPlan(slotId, canEdit);
    },
  };
  assert.equal(await loadComplexPlanForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "plan reader must NOT run when actor resolution throws");
});

test("plan: a genuine reader error still propagates (only actor resolution is caught)", async () => {
  const deps: ComplexPlanForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ canEditRidingNotes: true }),
    readPlan: async () => {
      throw new Error("plan read failed");
    },
  };
  await assert.rejects(() => loadComplexPlanForInstructorWithDeps(deps, "slot"), /plan read failed/);
});

// ===========================================================================
// getComplexRidingPlanPublicationStatusForInstructor orchestration
// ===========================================================================

test("status: signed active instructor reads (no edit-permission gate applied)", async () => {
  let seenSlot: string | null = null;
  const deps: ComplexPublicationStatusForInstructorReadDeps = {
    // NOTE: resolver shape carries NO canEditRidingNotes - reading status is
    // identity-only, so an id-only actor is fully authorized.
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readStatus: async (slotId) => {
      seenSlot = slotId;
      return sentinelStatus(slotId);
    },
  };
  const result = await loadComplexPublicationStatusForInstructorWithDeps(deps, "slot-9");
  assert.equal(seenSlot, "slot-9", "ridingSlotId forwarded as a record selector only");
  assert.equal(result?.ridingSlotId, "slot-9");
  assert.equal(result?.status, "CURRENT", "existing publication-status result preserved");
});

test("status: unauthenticated (null actor) fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: ComplexPublicationStatusForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readStatus: async (slotId) => {
      calls++;
      return sentinelStatus(slotId);
    },
  };
  assert.equal(await loadComplexPublicationStatusForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "status builder must NOT run for a null actor");
});

test("status: trainee/wrong-role/missing/inactive/malformed actor (null) -> null and never reads", async () => {
  let calls = 0;
  const deps: ComplexPublicationStatusForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readStatus: async (slotId) => {
      calls++;
      return sentinelStatus(slotId);
    },
  };
  assert.equal(await loadComplexPublicationStatusForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("status: actor-resolution rejection fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: ComplexPublicationStatusForInstructorReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("infra");
    },
    readStatus: async (slotId) => {
      calls++;
      return sentinelStatus(slotId);
    },
  };
  assert.equal(await loadComplexPublicationStatusForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "status builder must NOT run when actor resolution throws");
});

test("status: a genuine reader error still propagates (only actor resolution is caught)", async () => {
  const deps: ComplexPublicationStatusForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readStatus: async () => {
      throw new Error("status read failed");
    },
  };
  await assert.rejects(
    () => loadComplexPublicationStatusForInstructorWithDeps(deps, "slot"),
    /status read failed/
  );
});

// ===========================================================================
// Contract: no client-supplied actor identity; ridingSlotId is the only selector
// ===========================================================================

test("neither orchestration accepts an instructor-id / actor-identity parameter", () => {
  // Arity guard (secondary evidence): each read takes its deps object plus its
  // single record selector - no positional instructor-id slot on either.
  assert.equal(loadComplexPlanForInstructorWithDeps.length, 2, "deps + ridingSlotId");
  assert.equal(loadComplexPublicationStatusForInstructorWithDeps.length, 2, "deps + ridingSlotId");
});

test("riding-slot-complex-read-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./riding-slot-complex-read-auth.ts", import.meta.url)),
    "utf8"
  );
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.ok(!/from ["']next\/(headers|cache)["']/.test(src), "must not import next/headers or next/cache");
});

// ===========================================================================
// Wiring assertion (SECONDARY evidence).
// The behavioral DI tests above are the primary proof. This source check only
// confirms the public "use server" actions are wired to that contract (they
// can't be imported here - they transitively pull in Prisma / next). Same
// convention as riding-slots-read-auth.test.ts's own wiring assertion.
// ===========================================================================

test("wiring: both readers delegate to the session-bound orchestration, no actor id, no client findUnique", () => {
  const planSrc = readFileSync(fileURLToPath(new URL("./riding-slot-complex.ts", import.meta.url)), "utf8");
  const pubSrc = readFileSync(
    fileURLToPath(new URL("./riding-slot-complex-publications.ts", import.meta.url)),
    "utf8"
  );

  // Plan reader: delegates to the gate, threads the signed canEdit, no client id.
  assert.match(planSrc, /loadComplexPlanForInstructorWithDeps/, "plan reader delegates to the gate");
  assert.match(
    planSrc,
    /export async function getRidingSlotComplexPlanForInstructor\(\s*ridingSlotId: string\s*\)/,
    "plan reader signature takes only ridingSlotId (no acting instructorId)"
  );

  // Status reader: delegates to the gate, identity only, no client id.
  assert.match(pubSrc, /loadComplexPublicationStatusForInstructorWithDeps/, "status reader delegates to the gate");
  assert.match(
    pubSrc,
    /export async function getComplexRidingPlanPublicationStatusForInstructor\(\s*ridingSlotId: string\s*\)/,
    "status reader signature takes only ridingSlotId (no acting instructorId)"
  );

  // Neither reader re-reads an Instructor by a client id: slice each reader body
  // and assert no prisma.instructor.findUnique inside it.
  const planBody = sliceFn(planSrc, "getRidingSlotComplexPlanForInstructor");
  const statusBody = sliceFn(pubSrc, "getComplexRidingPlanPublicationStatusForInstructor");
  assert.ok(
    !/prisma\.instructor\.findUnique/.test(planBody),
    "plan reader must not re-read Instructor by a client id"
  );
  assert.ok(
    !/prisma\.instructor\.findUnique/.test(statusBody),
    "status reader must not re-read Instructor by a client id"
  );
});

// Slice one exported async function's declaration+body (up to the next
// `export async function`), for the scoped body assertions above.
function sliceFn(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `function not found: ${name}`);
  const next = src.indexOf("export async function ", start + 1);
  return src.slice(start, next > start ? next : undefined);
}
