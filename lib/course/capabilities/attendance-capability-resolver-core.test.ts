/**
 * ATT-2 — focused tests for the PURE, dependency-injected attendance capability
 * RESOLUTION core (attendance-capability-resolver-core.ts).
 *
 * These exercise the orchestration with plain fake loaders, so no Next.js
 * cookies, no live Prisma, and no database connection are needed. They lock the
 * ATT-2 contract:
 *   - a trusted offering context whose effective ATTENDANCE is ENABLED /
 *     READ_ONLY / DISABLED yields the ATT-1 view/read/write decision verbatim;
 *   - a null/undefined context or a malformed/empty offering id fails closed
 *     WITHOUT ever querying the loader (no singleton/first-offering fallback);
 *   - offering-not-found (loader yields an all-DISABLED / attendance-absent map)
 *     fails closed;
 *   - a loader that resolves to null fails closed; a loader that REJECTS
 *     propagates and can never yield a permissive result;
 *   - the resolver needs no actor id, student id, date, or attendance fact, and
 *     introduces no public "use server" action / StudentAttendance assumption.
 *
 * Structural guards assert the module reuses the ATT-1 policy helper (no
 * duplicated status mapping), stays a pure side-effect-free orchestration, and
 * that the server adapter reuses getEffectiveCapabilities (no parallel resolver).
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/attendance-capability-resolver-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveAttendanceCapabilityAccessWithDeps,
  type AttendanceCapabilityResolutionDeps,
  type EffectiveCapabilityMap,
  type TrustedOfferingContext,
} from "./attendance-capability-resolver-core";
import { CAPABILITY_KEYS } from "./capability-keys";
import type { EffectiveCapabilityStatus } from "./effective-capability-core";

// --- fixtures ---------------------------------------------------------------

const TRUSTED_OFFERING: TrustedOfferingContext = { id: "offering-cuid-1" };

/**
 * A full effective map (exhaustive over the canonical keys, as the real
 * resolver produces) with ATTENDANCE set to `attendance`; every other key is
 * DISABLED so no unrelated key can influence the attendance decision.
 */
function fullEffectiveMap(attendance: EffectiveCapabilityStatus): EffectiveCapabilityMap {
  const map: Partial<Record<(typeof CAPABILITY_KEYS)[number], EffectiveCapabilityStatus>> = {};
  for (const key of CAPABILITY_KEYS) {
    map[key] = "DISABLED";
  }
  map.ATTENDANCE = attendance;
  return map;
}

/** A loader that records whether it was called and returns `map`. */
function recordingLoader(map: EffectiveCapabilityMap | null): {
  deps: AttendanceCapabilityResolutionDeps;
  calledWith: () => string | null;
} {
  let seen: string | null = null;
  let called = false;
  return {
    deps: {
      loadEffectiveCapabilities: async (courseOfferingId) => {
        called = true;
        seen = courseOfferingId;
        return map;
      },
    },
    calledWith: () => (called ? seen : null),
  };
}

/** A loader that MUST NOT be called; fails the test if it is. */
function forbiddenLoader(): AttendanceCapabilityResolutionDeps {
  return {
    loadEffectiveCapabilities: async () => {
      throw new Error("loader must not be queried for a missing/malformed context");
    },
  };
}

// ===========================================================================
// Valid resolution — ENABLED / READ_ONLY / DISABLED map to the ATT-1 decision
// ===========================================================================

test("ENABLED offering -> view + read + write all allowed", async () => {
  const loader = recordingLoader(fullEffectiveMap("ENABLED"));
  const access = await resolveAttendanceCapabilityAccessWithDeps(loader.deps, TRUSTED_OFFERING);

  assert.deepEqual(access, {
    status: "ENABLED",
    canView: true,
    canRead: true,
    canWrite: true,
    reason: "ENABLED",
  });
  // The exact trusted offering id reached the loader (no fallback / rewrite).
  assert.equal(loader.calledWith(), "offering-cuid-1");
});

test("READ_ONLY offering -> view + read allowed, write DENIED", async () => {
  const loader = recordingLoader(fullEffectiveMap("READ_ONLY"));
  const access = await resolveAttendanceCapabilityAccessWithDeps(loader.deps, TRUSTED_OFFERING);

  assert.deepEqual(access, {
    status: "READ_ONLY",
    canView: true,
    canRead: true,
    canWrite: false,
    reason: "READ_ONLY",
  });
});

test("sparse ATTENDANCE absence (effective DISABLED) -> full denial", async () => {
  // Real resolver yields ATTENDANCE:"DISABLED" when the offering has no ATTENDANCE row.
  const loader = recordingLoader(fullEffectiveMap("DISABLED"));
  const access = await resolveAttendanceCapabilityAccessWithDeps(loader.deps, TRUSTED_OFFERING);

  assert.deepEqual(access, {
    status: "DISABLED",
    canView: false,
    canRead: false,
    canWrite: false,
    reason: "DISABLED",
  });
});

test("ATTENDANCE key entirely absent from the map -> fail closed (UNKNOWN_STATUS)", async () => {
  // An incomplete/malformed resolver output (no ATTENDANCE entry) must not grant.
  const loader = recordingLoader({} as EffectiveCapabilityMap);
  const access = await resolveAttendanceCapabilityAccessWithDeps(loader.deps, TRUSTED_OFFERING);

  assert.equal(access.canView, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "DENIED_UNKNOWN_STATUS");
});

// ===========================================================================
// Missing / malformed trusted context — fail closed WITHOUT touching the loader
// ===========================================================================

test("null trusted context -> fail closed, loader never queried", async () => {
  const access = await resolveAttendanceCapabilityAccessWithDeps(forbiddenLoader(), null);
  assert.deepEqual(access, {
    status: null,
    canView: false,
    canRead: false,
    canWrite: false,
    reason: "DENIED_MISSING_CONTEXT",
  });
});

test("undefined trusted context -> fail closed, loader never queried", async () => {
  const access = await resolveAttendanceCapabilityAccessWithDeps(forbiddenLoader(), undefined);
  assert.equal(access.canView, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "DENIED_MISSING_CONTEXT");
});

test("empty / whitespace-only offering id -> fail closed, loader never queried", async () => {
  for (const badId of ["", "   ", "\t\n"]) {
    const access = await resolveAttendanceCapabilityAccessWithDeps(forbiddenLoader(), { id: badId });
    assert.equal(access.canWrite, false, `id=${JSON.stringify(badId)} must not grant write`);
    assert.equal(access.canView, false);
    assert.equal(access.reason, "DENIED_MISSING_CONTEXT");
  }
});

test("caller cannot cause a singleton/first-offering fallback: missing context never selects one", async () => {
  // The forbidden loader throws if queried; a null context must short-circuit
  // to denial WITHOUT any loader call, proving there is no fallback selection.
  const access = await resolveAttendanceCapabilityAccessWithDeps(forbiddenLoader(), null);
  assert.equal(access.canView, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canWrite, false);
});

// ===========================================================================
// Offering not found / loader failure — never grants access
// ===========================================================================

test("offering-not-found (loader yields all-DISABLED map) -> fail closed", async () => {
  // getEffectiveCapabilities cannot distinguish a not-found offering from one
  // with no ATTENDANCE row: both collapse to effective DISABLED. Either way the
  // result is full denial.
  const loader = recordingLoader(fullEffectiveMap("DISABLED"));
  const access = await resolveAttendanceCapabilityAccessWithDeps(loader.deps, TRUSTED_OFFERING);
  assert.equal(access.canView, false);
  assert.equal(access.canWrite, false);
});

test("loader resolving to null -> fail closed (missing context)", async () => {
  const access = await resolveAttendanceCapabilityAccessWithDeps(recordingLoader(null).deps, TRUSTED_OFFERING);
  assert.equal(access.canView, false);
  assert.equal(access.canRead, false);
  assert.equal(access.canWrite, false);
  assert.equal(access.reason, "DENIED_MISSING_CONTEXT");
});

test("loader/resolution FAILURE cannot grant access (rejection propagates, never permissive)", async () => {
  const deps: AttendanceCapabilityResolutionDeps = {
    loadEffectiveCapabilities: async () => {
      throw new Error("simulated capability/catalog DB read failure");
    },
  };
  // The infrastructure failure propagates: the caller receives an exception, not
  // a (possibly permissive) access object. It can NEVER resolve to canWrite=true.
  await assert.rejects(
    () => resolveAttendanceCapabilityAccessWithDeps(deps, TRUSTED_OFFERING),
    /simulated capability\/catalog DB read failure/,
  );
});

// ===========================================================================
// Contract / structural guards
// ===========================================================================

/**
 * Strip block + line comments so "must not reference X" guards inspect the
 * executable code only — the doc comments deliberately DESCRIBE the boundary
 * (e.g. that StudentAttendance stays a shared fact) and must not trip a guard.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("no actor id, student id, date, or attendance fact is required by the resolver", async () => {
  // The public arity is exactly (deps, offeringContext) — there is no actor/
  // student/date parameter. A trusted context carrying ONLY an id resolves fully.
  assert.equal(resolveAttendanceCapabilityAccessWithDeps.length, 2);
  const access = await resolveAttendanceCapabilityAccessWithDeps(
    recordingLoader(fullEffectiveMap("ENABLED")).deps,
    { id: "offering-cuid-1" },
  );
  assert.equal(access.canWrite, true);
});

test("deterministic inputs produce a deterministic decision", async () => {
  const a = await resolveAttendanceCapabilityAccessWithDeps(recordingLoader(fullEffectiveMap("READ_ONLY")).deps, TRUSTED_OFFERING);
  const b = await resolveAttendanceCapabilityAccessWithDeps(recordingLoader(fullEffectiveMap("READ_ONLY")).deps, TRUSTED_OFFERING);
  assert.deepEqual(a, b);
});

test("core reuses the ATT-1 policy helper and does not duplicate the status mapping", () => {
  const src = codeOnly(readFileSync(fileURLToPath(new URL("./attendance-capability-resolver-core.ts", import.meta.url)), "utf8"));
  // Uses the ATT-1 helper for the final decision.
  assert.ok(
    /attendanceCapabilityAccessFromEffective/.test(src),
    "core must derive the final result via the ATT-1 policy helper",
  );
  // Does NOT re-implement the ENABLED/READ_ONLY/DISABLED -> access table.
  assert.ok(!/ACCESS_BY_STATUS/.test(src), "core must not redeclare the status->access table");
  assert.ok(!/canWrite:\s*true/.test(src), "core must not hardcode a permissive canWrite mapping");
});

test("core is a pure orchestration: no prisma / next / use-server / actor / attendance-fact coupling", () => {
  const src = codeOnly(readFileSync(fileURLToPath(new URL("./attendance-capability-resolver-core.ts", import.meta.url)), "utf8"));
  const hasUseServer = src.split("\n").some((line) => /^\s*["']use server["'];?\s*$/.test(line));
  assert.ok(!hasUseServer, "core must NOT be a Server Action module");
  assert.ok(!/from\s+["']@\/lib\/prisma["']/.test(src), "core must not import Prisma");
  assert.ok(!/from\s+["']server-only["']/.test(src), "core must stay client-importable (pure)");
  assert.ok(!/from\s+["']next\//.test(src), "core must not import next/*");
  // No actor/session, StudentAttendance, student id, or date coupling.
  assert.ok(!/getCurrentInstructor|getCurrentTrainee/.test(src), "core must not derive an actor");
  assert.ok(!/studentAttendance|StudentAttendance/.test(src), "core must not reference the attendance fact");
  assert.ok(!/studentId|dateKey/.test(src), "core must not require a student id or date");
});

test("server adapter reuses getEffectiveCapabilities (no parallel resolver) and is not a public action", () => {
  const src = codeOnly(readFileSync(fileURLToPath(new URL("./attendance-capability-resolver.ts", import.meta.url)), "utf8"));
  assert.ok(/getEffectiveCapabilities/.test(src), "adapter must reuse the existing effective-capability reader");
  // No parallel capability resolution and no direct attendance/offering querying.
  assert.ok(!/resolveEffectiveCapabilitiesFromRows/.test(src), "adapter must not re-run the generic resolver itself");
  assert.ok(!/findMany|findUnique|findFirst/.test(src), "adapter must not issue its own Prisma queries");
  // Not a public unauthenticated server action accepting a courseOfferingId.
  const hasUseServer = src.split("\n").some((line) => /^\s*["']use server["'];?\s*$/.test(line));
  assert.ok(!hasUseServer, "adapter must NOT be a Server Action");
  assert.ok(/server-only/.test(src), "adapter must use the server-only convention");
  // No singleton/first-offering selection is introduced by the adapter.
  assert.ok(!/resolveCurrentCourseOffering/.test(src), "adapter must not select the current offering");
});
