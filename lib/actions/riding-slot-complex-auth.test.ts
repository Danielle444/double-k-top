// RS-SEC-1I-CP - BEHAVIORAL security test for the shared, dependency-injected
// authorization boundary (runComplexPlanInstructorWrite) that every one of the
// ten instructor-facing complex riding-plan writers now routes through. This is
// the PRIMARY security evidence for the stage: it exercises the real gate with an
// injected resolver + injected mutation core (spies), asserting exactly WHEN the
// protected core runs, WHEN it is denied, and WHAT identity is passed as
// attribution - none of it relies on reading source text.
//
// It proves, once, the invariants shared by all ten wrappers (Section N of the
// stage contract):
//   - a signed active instructor WITH canEditRidingNotes is authorized; the core
//     runs and receives ONLY the actor's own id + fullName (attribution);
//   - an actor WITHOUT canEditRidingNotes is denied and the core never runs;
//   - a null actor (the resolver returns null for unauthenticated / trainee /
//     wrong-audience / missing / inactive / subject-mismatched sessions - see
//     lib/auth/actor-core.ts) is denied and the core never runs;
//   - a THROWN resolver (session/infra failure) fails closed to the same denial
//     and the core never runs;
//   - an authorized core failure/throw is NOT converted into an authorization
//     denial (it propagates / is returned unchanged);
//   - another instructor's identity can never be passed to the core, because the
//     boundary takes no id argument at all and forwards only the resolved actor.
//
// Run: npx tsx --test lib/actions/riding-slot-complex-auth.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  runComplexPlanInstructorWrite,
  type ComplexPlanInstructorActor,
} from "./riding-slot-complex-auth";

// A representative result union (denial shape used by the nine RidingSlotComplexPlan
// writers, plus a success shape). The move/swap writer uses a superset shape; the
// boundary is generic over the result type, so one representative union exercises
// the contract. Typing both values as the same union keeps the generic T inferred
// consistently across `denied` and `onAuthorized`.
type Result =
  | { success: false; error: string }
  | { success: true; ran: boolean };
const DENIED: Result = { success: false, error: "אין הרשאה לערוך תכנון רכיבה מורכבת" };
const SUCCESS: Result = { success: true, ran: true };

const activeEditor: ComplexPlanInstructorActor = {
  id: "instr-self",
  fullName: "Signed Instructor",
  canEditRidingNotes: true,
};

// A DIFFERENT instructor - used to prove the boundary can never be steered to
// another instructor's identity (there is no id argument to supply one).
const otherEditor: ComplexPlanInstructorActor = {
  id: "instr-other",
  fullName: "Someone Else",
  canEditRidingNotes: true,
};

test("authorized: active instructor with canEditRidingNotes -> core runs with the actor's own id + fullName", async () => {
  const seen: Array<{ id: string; fullName: string }> = [];
  const result = await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => activeEditor,
    denied: DENIED,
    onAuthorized: async (actor) => {
      seen.push(actor);
      return SUCCESS;
    },
  });
  assert.deepEqual(result, SUCCESS, "the core's success result is returned unchanged");
  assert.equal(seen.length, 1, "the protected core runs exactly once for an authorized actor");
  // Attribution: ONLY id + fullName are forwarded - never canEditRidingNotes or
  // any other resolver field, and never a client-chosen value.
  assert.deepEqual(seen[0], { id: "instr-self", fullName: "Signed Instructor" });
});

test("denied: actor without canEditRidingNotes -> denial returned, core NEVER runs", async () => {
  let ran = false;
  const result = await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => ({ ...activeEditor, canEditRidingNotes: false }),
    denied: DENIED,
    onAuthorized: async () => {
      ran = true;
      return SUCCESS;
    },
  });
  assert.deepEqual(result, DENIED);
  assert.equal(ran, false, "the protected core must not run without canEditRidingNotes");
});

test("denied: null actor (unauthenticated / trainee / missing / inactive / subject-mismatch) -> denial, core NEVER runs", async () => {
  let ran = false;
  const result = await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => null,
    denied: DENIED,
    onAuthorized: async () => {
      ran = true;
      return SUCCESS;
    },
  });
  assert.deepEqual(result, DENIED);
  assert.equal(ran, false, "a null actor must never reach the protected core");
});

test("fail-closed: a THROWN resolver is caught and denied; core NEVER runs", async () => {
  let ran = false;
  const result = await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => {
      throw new Error("session/infra failure (e.g. missing SESSION_SECRET, Prisma error)");
    },
    denied: DENIED,
    onAuthorized: async () => {
      ran = true;
      return SUCCESS;
    },
  });
  assert.deepEqual(result, DENIED, "a resolver rejection fails closed to the denial contract");
  assert.equal(ran, false, "the protected core must not run when the resolver throws");
});

test("an authorized core FAILURE result is returned unchanged, not converted to an authorization denial", async () => {
  const coreFailure: Result = { success: false, error: "התכנון השתנה מאז שנפתח. יש לרענן ולבדוק מחדש לפני שמירה." };
  const result = await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => activeEditor,
    denied: DENIED,
    onAuthorized: async () => coreFailure,
  });
  assert.deepEqual(result, coreFailure, "an authorized mutation failure keeps its own contract, not NO_PERMISSION");
});

test("a genuine core THROW propagates (only the resolver is wrapped, never the mutation core)", async () => {
  await assert.rejects(
    runComplexPlanInstructorWrite<Result>({
      getCurrentInstructor: async () => activeEditor,
      denied: DENIED,
      onAuthorized: async () => {
        throw new Error("genuine database error");
      },
    }),
    /genuine database error/,
    "a mutation-core error must NOT be swallowed into a denial",
  );
});

test("the boundary takes no id argument, so another instructor's identity can never be forwarded", async () => {
  // Whatever the resolver returns IS the identity; there is no separate id
  // parameter a caller could use to select a different instructor. When the
  // resolved actor is 'other', 'other' (and nothing else) reaches the core.
  const seen: Array<{ id: string; fullName: string }> = [];
  await runComplexPlanInstructorWrite<Result>({
    getCurrentInstructor: async () => otherEditor,
    denied: DENIED,
    onAuthorized: async (actor) => {
      seen.push(actor);
      return SUCCESS;
    },
  });
  assert.deepEqual(seen[0], { id: "instr-other", fullName: "Someone Else" });
  // The public boundary signature accepts exactly one deps object - no positional
  // instructor-id slot exists to spoof.
  assert.equal(runComplexPlanInstructorWrite.length, 1, "the boundary accepts only its deps object");
});
