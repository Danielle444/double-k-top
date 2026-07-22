/**
 * RS-SEC-1I-HL-RD - focused behavioral tests for the session-bound instructor
 * simple horse-list READ orchestration (lib/actions/riding-slot-horses-read-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They are the PRIMARY security
 * evidence for the RS-SEC-1I-HL-RD contract:
 *  - the read is gated on a server-derived instructor actor; an unauthenticated
 *    (null) actor - or a thrown actor resolution - fails closed to null and never
 *    runs the underlying reader;
 *  - identity comes ONLY from the injected actor resolver - the orchestration has
 *    no instructor-id parameter a client could supply;
 *  - viewing does NOT require canEditRidingNotes and does NOT require assignment:
 *    the resolver shape is identity-only ({ id }), and the gate consults no
 *    permission and no assignment input at all;
 *  - publication state is never inspected by the boundary (it is protected-reader/
 *    domain behavior, threaded through the returned payload unchanged);
 *  - the returned payload is viewer-independent: readList receives ONLY ridingSlotId,
 *    so no actor identity/permission/assignment can alter it;
 *  - denial happens strictly before the reader/Prisma dependency is invoked;
 *  - a genuine authorized reader error still propagates (only actor resolution is
 *    caught) and is never converted to a null authorization denial.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/riding-slot-horses-read-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  loadHorseListForInstructorWithDeps,
  type HorseListForInstructorReadDeps,
} from "./riding-slot-horses-read-auth";
import type { RidingSlotHorseListForEditing } from "./riding-slot-horses";

// --- fixtures ---------------------------------------------------------------

// Minimal sentinel result - shape is irrelevant to the gate under test, only
// object identity / a couple of fields are asserted, so the DTO is cast. The
// sentinel echoes back the ridingSlotId it was built with, so a test can prove
// the record selector (and ONLY the record selector) reached the builder.
function sentinelList(ridingSlotId: string): RidingSlotHorseListForEditing {
  return { ridingSlotId, listId: "list-1", version: 3, candidates: [] } as unknown as RidingSlotHorseListForEditing;
}

// ===========================================================================
// getRidingSlotHorseListForInstructor orchestration
// ===========================================================================

test("signed active instructor reads: callback runs exactly once, ridingSlotId forwarded, result returned", async () => {
  let calls = 0;
  let seenSlot: string | null = null;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readList: async (slotId) => {
      calls++;
      seenSlot = slotId;
      return sentinelList(slotId);
    },
  };
  const result = await loadHorseListForInstructorWithDeps(deps, "slot-1");
  assert.equal(calls, 1, "protected reader runs exactly once for a signed active instructor");
  assert.equal(seenSlot, "slot-1", "ridingSlotId forwarded as the ONLY record selector");
  assert.equal(result?.ridingSlotId, "slot-1");
  assert.equal(result?.version, 3, "existing success value returned unchanged");
});

test("signed active instructor without canEditRidingNotes still reads (no edit-permission gate)", async () => {
  // The resolver shape carries NO canEditRidingNotes - reading is identity-only.
  // An id-only actor is fully authorized, proving no edit-permission gate exists.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "read-only-instructor" }),
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  const result = await loadHorseListForInstructorWithDeps(deps, "slot-2");
  assert.equal(calls, 1, "a read-only instructor still executes the horse-list reader");
  assert.equal(result?.ridingSlotId, "slot-2");
});

test("unassigned signed active instructor still reads (no assignment dependency)", async () => {
  // The boundary receives NO assignment data at all - the same id-only actor is
  // authorized regardless of any riding-slot assignment, proving no assignment gate.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "unassigned-instructor" }),
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  const result = await loadHorseListForInstructorWithDeps(deps, "slot-3");
  assert.equal(calls, 1, "an unassigned instructor still executes the horse-list reader");
  assert.equal(result?.ridingSlotId, "slot-3");
});

test("publication-independent: the boundary passes ONLY ridingSlotId and inspects no publication state", async () => {
  // Whatever publication flags the reader returns are threaded straight through;
  // the gate itself never sees or branches on them - readList receives only the slot.
  const received: unknown[] = [];
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readList: async (...args) => {
      received.push(args);
      return { ridingSlotId: args[0], hasPublications: true, hasStalePublication: true } as unknown as RidingSlotHorseListForEditing;
    },
  };
  const result = await loadHorseListForInstructorWithDeps(deps, "slot-4");
  assert.deepEqual(received, [["slot-4"]], "reader is invoked with ONLY the ridingSlotId record selector");
  assert.equal(result?.hasPublications, true, "publication flags pass through unchanged (domain behavior)");
});

test("unauthenticated (null actor) fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "reader must NOT run for a null actor");
});

test("trainee/wrong-role actor (null) -> null and never reads", async () => {
  // getCurrentInstructor returns null for a wrong-audience/wrong-role session;
  // this null case proves that whole class is denied identically by the gate.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("missing Instructor (null) -> null and never reads", async () => {
  // getCurrentInstructor returns null when the Instructor row is missing.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("inactive Instructor (null) -> null and never reads", async () => {
  // getCurrentInstructor returns null when the resolved Instructor is inactive.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("malformed or denied Actor DAL result (null) -> null and never reads", async () => {
  // A malformed session / subject-mismatch / audience-mismatch all collapse to a
  // null actor from the derive logic; the gate denies identically.
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => null,
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0);
});

test("actor-resolution rejection fails closed to null and never reads", async () => {
  let calls = 0;
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure");
    },
    readList: async (slotId) => {
      calls++;
      return sentinelList(slotId);
    },
  };
  assert.equal(await loadHorseListForInstructorWithDeps(deps, "slot"), null);
  assert.equal(calls, 0, "reader must NOT run when actor resolution throws");
});

test("another instructor's identity cannot change the result (payload is viewer-independent)", async () => {
  // Two different signed actors -> the reader receives the SAME single argument
  // (ridingSlotId) both times and returns the same slot-keyed payload. There is
  // no parameter path by which a client could inject a competing actor value, and
  // no permission/assignment reaches the reader to differentiate the result.
  const seen: string[][] = [];
  const build = async (actorId: string) => {
    const result = await loadHorseListForInstructorWithDeps(
      {
        getCurrentInstructor: async () => ({ id: actorId }),
        readList: async (...args) => {
          seen.push(args);
          return sentinelList(args[0]);
        },
      },
      "slot-shared"
    );
    return result?.ridingSlotId;
  };
  assert.equal(await build("instructor-A"), "slot-shared");
  assert.equal(await build("instructor-B"), "slot-shared");
  assert.deepEqual(seen, [["slot-shared"], ["slot-shared"]], "reader receives only ridingSlotId regardless of actor");
});

test("a genuine reader error still propagates (only actor resolution is caught)", async () => {
  const deps: HorseListForInstructorReadDeps = {
    getCurrentInstructor: async () => ({ id: "instructor-1" }),
    readList: async () => {
      throw new Error("horse-list read failed");
    },
  };
  await assert.rejects(
    () => loadHorseListForInstructorWithDeps(deps, "slot"),
    /horse-list read failed/
  );
});

// ===========================================================================
// Contract: no client-supplied actor identity; ridingSlotId is the only selector
// ===========================================================================

test("orchestration accepts no instructor-id / actor-identity parameter", () => {
  // Arity guard (secondary evidence): the read takes its deps object plus its
  // single record selector - no positional instructor-id slot.
  assert.equal(loadHorseListForInstructorWithDeps.length, 2, "deps + ridingSlotId");
});

test("riding-slot-horses-read-auth is a pure orchestration (no prisma / next / use-server)", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./riding-slot-horses-read-auth.ts", import.meta.url)),
    "utf8"
  );
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(src), "must not be a Server Action module");
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(src), "must not import prisma");
  assert.ok(!/from ["']next\/(headers|cache)["']/.test(src), "must not import next/headers or next/cache");
});

// ===========================================================================
// Wiring / structural evidence (SECONDARY).
// The behavioral DI tests above are the primary proof. These source checks only
// confirm the public "use server" action is wired to that contract (it can't be
// imported here - it transitively pulls in Prisma / next). Same convention as
// riding-slot-complex-read-auth.test.ts's own wiring assertion.
// ===========================================================================

test("wiring: reader delegates to the session-bound orchestration, no actor id, no client instructor findUnique", () => {
  const horsesSrc = readFileSync(fileURLToPath(new URL("./riding-slot-horses.ts", import.meta.url)), "utf8");

  // Reader signature takes ONLY ridingSlotId (no acting instructorId).
  assert.match(
    horsesSrc,
    /export async function getRidingSlotHorseListForInstructor\(\s*ridingSlotId: string\s*\)/,
    "reader signature takes only ridingSlotId"
  );
  // Reader delegates to the gate and threads getCurrentInstructor + the reader core.
  assert.match(horsesSrc, /loadHorseListForInstructorWithDeps/, "reader delegates to the gate");
  assert.match(horsesSrc, /getCurrentInstructor/, "reader threads the canonical actor DAL resolver");

  // The public reader body must not re-read an Instructor by a client id.
  const readerBody = sliceExportedFn(horsesSrc, "getRidingSlotHorseListForInstructor");
  assert.ok(
    !/prisma\.instructor\.findUnique/.test(readerBody),
    "reader must not re-read Instructor by a client id"
  );
});

test("structural: all three runtime call sites pass only ridingSlotId", () => {
  const editorSrc = readFileSync(
    fileURLToPath(new URL("../components/RidingHorseListEditor.tsx", import.meta.url)),
    "utf8"
  );
  const sectionSrc = readFileSync(
    fileURLToPath(new URL("../../app/instructor/InstructorRidingSlotsSection.tsx", import.meta.url)),
    "utf8"
  );
  const clientSrc = readFileSync(
    fileURLToPath(new URL("../../app/instructor/InstructorClient.tsx", import.meta.url)),
    "utf8"
  );
  for (const [name, src] of [
    ["RidingHorseListEditor.tsx", editorSrc],
    ["InstructorRidingSlotsSection.tsx", sectionSrc],
    ["InstructorClient.tsx", clientSrc],
  ] as const) {
    const calls = src.match(/getRidingSlotHorseListForInstructor\([^)]*\)/g) ?? [];
    assert.ok(calls.length > 0, `${name} should still call the reader`);
    for (const call of calls) {
      assert.match(call, /getRidingSlotHorseListForInstructor\(\s*ridingSlotId\s*\)/, `${name}: ${call} must pass only ridingSlotId`);
    }
  }
});

test("structural: excluded adjacent surfaces remain unchanged (out of this stage's scope)", () => {
  const horsesSrc = readFileSync(fileURLToPath(new URL("./riding-slot-horses.ts", import.meta.url)), "utf8");
  const pubSrc = readFileSync(
    fileURLToPath(new URL("./riding-slot-horse-publications.ts", import.meta.url)),
    "utf8"
  );

  // Save writer still takes the client instructorId (unchanged this stage).
  assert.match(
    horsesSrc,
    /export async function saveRidingSlotHorseListAsInstructor\(\s*instructorId: string,/,
    "saveRidingSlotHorseListAsInstructor signature unchanged"
  );
  // Admin reader still requireAdmin-gated and instructorId-free.
  assert.match(
    horsesSrc,
    /export async function getRidingSlotHorseListForAdmin\(\s*ridingSlotId: string\s*\)/,
    "getRidingSlotHorseListForAdmin signature unchanged"
  );
  // Publication-status readers still take the client instructorId (RS-SEC-1I-HL-PUB-RD, NOT this stage).
  assert.match(
    pubSrc,
    /export async function getInstructorHorsePublicationStatusForInstructor\(\s*instructorId: string,/,
    "getInstructorHorsePublicationStatusForInstructor unchanged (deferred stage)"
  );
  assert.match(
    pubSrc,
    /export async function getGroupHorsePublicationStatusForInstructor\(\s*instructorId: string,/,
    "getGroupHorsePublicationStatusForInstructor unchanged (deferred stage)"
  );
});

// Slice one exported async function's declaration+body (up to the next
// `export async function`), for the scoped body assertions above. The internal
// readHorseListForEditing core is declared with a non-exported `async function`,
// so it is never captured by this exported-only slice.
function sliceExportedFn(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `function not found: ${name}`);
  const next = src.indexOf("export async function ", start + 1);
  return src.slice(start, next > start ? next : undefined);
}
