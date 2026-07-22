/**
 * ATT-5WUI — focused tests for the PURE instructor ATTENDANCE UI-access core
 * (instructor-attendance-write-ui-core.ts).
 *
 * PURE: no Prisma, no DB, no cookies, no env, no React render. The UI-access
 * resolver is exercised with plain injected access fixtures / a throwing resolver;
 * the effective-editability reducer is exercised as a truth table.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/instructor-attendance-write-ui-core.test.ts
 *
 * Contract locked here:
 *  - one capability resolution yields BOTH booleans (canViewAttendance from
 *    access.canView, canWriteAttendance from access.canWrite);
 *  - ENABLED -> view+write; READ_ONLY -> view only (write=false); DISABLED and
 *    every fail-closed denial -> neither;
 *  - a resolver REJECTION fails closed to BOTH false and is never propagated;
 *  - no client-supplied offering identity is accepted (parameterless injected
 *    resolver; the reducer takes only `deps`);
 *  - effective editability = actor canEditAttendance AND canWriteAttendance, with
 *    the actor permission authoritative and irreplaceable.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveInstructorAttendanceUiAccessWithDeps,
  resolveEffectiveInstructorAttendanceEditability,
  type InstructorAttendanceUiAccessDeps,
} from "./instructor-attendance-write-ui-core";
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

// --- access fixtures (the exact shapes the ATT-1 policy / ATT-2 resolver emit) --

function enabledAccess(): AttendanceCapabilityAccess {
  return { status: "ENABLED", canView: true, canRead: true, canWrite: true, reason: "ENABLED" };
}
function readOnlyAccess(): AttendanceCapabilityAccess {
  return { status: "READ_ONLY", canView: true, canRead: true, canWrite: false, reason: "READ_ONLY" };
}
function disabledAccess(): AttendanceCapabilityAccess {
  return { status: "DISABLED", canView: false, canRead: false, canWrite: false, reason: "DISABLED" };
}
function deniedMissingContextAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_MISSING_CONTEXT" };
}
function deniedUnknownStatusAccess(): AttendanceCapabilityAccess {
  return { status: null, canView: false, canRead: false, canWrite: false, reason: "DENIED_UNKNOWN_STATUS" };
}

// ===========================================================================
// UI-access resolver — one resolution yields both booleans, fail-closed
// ===========================================================================

test("ui-access: ENABLED -> canView=true, canWrite=true", async () => {
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => enabledAccess(),
  };
  assert.deepEqual(await resolveInstructorAttendanceUiAccessWithDeps(deps), {
    canViewAttendance: true,
    canWriteAttendance: true,
  });
});

test("ui-access: READ_ONLY -> canView=true, canWrite=false (attendance stays visible, not editable)", async () => {
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => readOnlyAccess(),
  };
  assert.deepEqual(await resolveInstructorAttendanceUiAccessWithDeps(deps), {
    canViewAttendance: true,
    canWriteAttendance: false,
  });
});

test("ui-access: DISABLED -> canView=false, canWrite=false", async () => {
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => disabledAccess(),
  };
  assert.deepEqual(await resolveInstructorAttendanceUiAccessWithDeps(deps), {
    canViewAttendance: false,
    canWriteAttendance: false,
  });
});

test("ui-access: DENIED_MISSING_CONTEXT / DENIED_UNKNOWN_STATUS -> both false (malformed cannot produce write)", async () => {
  for (const access of [deniedMissingContextAccess(), deniedUnknownStatusAccess()]) {
    const deps: InstructorAttendanceUiAccessDeps = {
      resolveAttendanceAccess: async () => access,
    };
    assert.deepEqual(
      await resolveInstructorAttendanceUiAccessWithDeps(deps),
      { canViewAttendance: false, canWriteAttendance: false },
      `${access.reason} must fail closed on both axes`,
    );
  }
});

test("ui-access: a rejecting resolver fails closed to BOTH false — never propagates (would 500 the shell)", async () => {
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => {
      throw new Error("current offering / capability loader failed");
    },
  };
  const access = await resolveInstructorAttendanceUiAccessWithDeps(deps);
  assert.deepEqual(access, { canViewAttendance: false, canWriteAttendance: false });
});

test("ui-access: canWrite is authoritative for the write axis — canView cannot inflate it", async () => {
  // A (contrived) malformed access whose canWrite is false but canView is true
  // must still yield canWriteAttendance=false: the write axis is read from
  // canWrite, never substituted by canView.
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () =>
      ({ status: null, canView: true, canRead: true, canWrite: false, reason: "READ_ONLY" } as AttendanceCapabilityAccess),
  };
  assert.equal((await resolveInstructorAttendanceUiAccessWithDeps(deps)).canWriteAttendance, false);
});

test("ui-access: exactly ONE resolution derives BOTH booleans", async () => {
  let calls = 0;
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => {
      calls += 1;
      return enabledAccess();
    },
  };
  const access = await resolveInstructorAttendanceUiAccessWithDeps(deps);
  assert.equal(calls, 1, "the capability is resolved exactly once for both booleans");
  assert.equal(access.canViewAttendance, true);
  assert.equal(access.canWriteAttendance, true);
});

test("ui-access: no client-supplied offering identity is accepted (parameterless injected resolver)", async () => {
  let observedArgs: unknown[] | null = null;
  const deps: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async (...args: unknown[]) => {
      observedArgs = args;
      return enabledAccess();
    },
  };
  await resolveInstructorAttendanceUiAccessWithDeps(deps);
  assert.deepEqual(observedArgs, [], "the resolver is invoked with no offering id / actor / client value");
  // The reducer's arity is (deps) only — no courseOfferingId / actor identity param.
  assert.equal(resolveInstructorAttendanceUiAccessWithDeps.length, 1);
});

// ===========================================================================
// Effective editability reducer — actor AND capability, truth table
// ===========================================================================

test("editability truth table: actor AND capability, actor authoritative", () => {
  // actor / offering -> editable
  assert.equal(resolveEffectiveInstructorAttendanceEditability(false, false), false, "false/false -> not editable");
  assert.equal(resolveEffectiveInstructorAttendanceEditability(false, true), false, "false/true -> not editable (actor authoritative)");
  assert.equal(resolveEffectiveInstructorAttendanceEditability(true, false), false, "true/false -> not editable (READ_ONLY offering)");
  assert.equal(resolveEffectiveInstructorAttendanceEditability(true, true), true, "true/true -> editable");
});

test("editability: ENABLED offering + actor canEditAttendance=true -> editable", async () => {
  const { canWriteAttendance } = await resolveInstructorAttendanceUiAccessWithDeps({
    resolveAttendanceAccess: async () => enabledAccess(),
  });
  assert.equal(resolveEffectiveInstructorAttendanceEditability(true, canWriteAttendance), true);
});

test("editability: READ_ONLY offering + actor canEditAttendance=true -> read-only (write control gated off)", async () => {
  const { canViewAttendance, canWriteAttendance } = await resolveInstructorAttendanceUiAccessWithDeps({
    resolveAttendanceAccess: async () => readOnlyAccess(),
  });
  assert.equal(canViewAttendance, true, "attendance stays visible under READ_ONLY");
  assert.equal(resolveEffectiveInstructorAttendanceEditability(true, canWriteAttendance), false);
});

test("editability: capability canWrite=true can NEVER grant an actor without canEditAttendance", () => {
  assert.equal(
    resolveEffectiveInstructorAttendanceEditability(false, true),
    false,
    "a permissive offering capability must not make a non-editing actor editable",
  );
});

test("editability: DISABLED / denied / rejected -> not editable regardless of actor", async () => {
  const rejecting: InstructorAttendanceUiAccessDeps = {
    resolveAttendanceAccess: async () => {
      throw new Error("boom");
    },
  };
  for (const deps of [
    { resolveAttendanceAccess: async () => disabledAccess() },
    { resolveAttendanceAccess: async () => deniedMissingContextAccess() },
    rejecting,
  ] as InstructorAttendanceUiAccessDeps[]) {
    const { canWriteAttendance } = await resolveInstructorAttendanceUiAccessWithDeps(deps);
    assert.equal(resolveEffectiveInstructorAttendanceEditability(true, canWriteAttendance), false);
  }
});

test("editability: non-boolean inputs that bypass the type system fail closed", () => {
  assert.equal(
    resolveEffectiveInstructorAttendanceEditability(
      1 as unknown as boolean,
      "yes" as unknown as boolean,
    ),
    false,
    "only strict true/true is editable",
  );
});
