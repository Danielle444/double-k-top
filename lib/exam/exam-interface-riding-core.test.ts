/**
 * EXAM X0 — executable tests for the PURE interface/riding pairing + seed core
 * (exam-interface-riding-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-interface-riding-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env.
 *
 * SCOPE OF PROOF: a valid INTERFACE+RIDING pair; rejecting two INTERFACE or two
 * RIDING sessions; rejecting cross-plan pairing; rejecting a riding link that is
 * missing or does not point at the interface partner; the one-time seed copies
 * the requested values; seeded outputs share no mutable reference with the
 * source; and later changes to the source do not affect the seed (no permanent
 * synchronization).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  validateInterfaceRidingPair,
  seedRidingFromInterface,
  type PairSessionRef,
  type InterfaceSeedSource,
  type InterfaceSeedOptions,
} from "./exam-interface-riding-core";

function ifaceSession(over: Partial<PairSessionRef> = {}): PairSessionRef {
  return {
    sessionId: "if-1",
    planId: "plan-1",
    kind: "INTERFACE_RIDING",
    phase: "INTERFACE",
    interfaceSessionId: null,
    ...over,
  };
}
function ridingSession(over: Partial<PairSessionRef> = {}): PairSessionRef {
  return {
    sessionId: "rd-1",
    planId: "plan-1",
    kind: "INTERFACE_RIDING",
    phase: "RIDING",
    interfaceSessionId: "if-1",
    ...over,
  };
}

// --- pairing validation ----------------------------------------------------

test("a valid INTERFACE + RIDING pair (correct link, same plan) is accepted", () => {
  const r = validateInterfaceRidingPair(ifaceSession(), ridingSession());
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  // order-independent
  const r2 = validateInterfaceRidingPair(ridingSession(), ifaceSession());
  assert.equal(r2.ok, true, JSON.stringify(r2.issues));
});

test("two INTERFACE sessions are rejected (EX-IR-PHASE-DUPLICATE)", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession({ sessionId: "if-1" }),
    ifaceSession({ sessionId: "if-2" }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-PHASE-DUPLICATE"));
});

test("two RIDING sessions are rejected (EX-IR-PHASE-DUPLICATE)", () => {
  const r = validateInterfaceRidingPair(
    ridingSession({ sessionId: "rd-1", interfaceSessionId: "if-1" }),
    ridingSession({ sessionId: "rd-2", interfaceSessionId: "if-1" }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-PHASE-DUPLICATE"));
});

test("cross-plan pairing is rejected (EX-IR-CROSS-PLAN)", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession({ planId: "plan-1" }),
    ridingSession({ planId: "plan-2" }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-CROSS-PLAN"));
});

test("a riding session with no interface link is rejected (EX-IR-RIDING-LINK-MISSING)", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession(),
    ridingSession({ interfaceSessionId: null }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-RIDING-LINK-MISSING"));
});

test("a riding link pointing at a non-interface partner is rejected", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession({ sessionId: "if-1" }),
    ridingSession({ interfaceSessionId: "some-other-session" }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-RIDING-LINK-TO-NON-INTERFACE"));
});

test("an interface session that itself carries a link is rejected (EX-IR-INTERFACE-HAS-LINK)", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession({ interfaceSessionId: "another-if" }),
    ridingSession(),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-INTERFACE-HAS-LINK"));
});

test("a non-INTERFACE_RIDING kind is rejected (EX-IR-NOT-INTERFACE-RIDING-KIND)", () => {
  const r = validateInterfaceRidingPair(
    ifaceSession({ kind: "LUNGE_NO_RIDER" }),
    ridingSession(),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-IR-NOT-INTERFACE-RIDING-KIND"));
});

// --- one-time seed ---------------------------------------------------------

function source(): InterfaceSeedSource {
  return {
    examineeIds: ["e1", "e2"],
    horseIds: ["h1"],
    supervisorIds: ["sup-1", "sup-2"],
    examinerSetId: "eset-1",
  };
}
const COPY_ALL: InterfaceSeedOptions = {
  copyExaminees: true,
  copyHorses: true,
  copySupervisors: true,
  copyExaminerSet: true,
};

test("the seed copies exactly the requested values", () => {
  const seeded = seedRidingFromInterface(source(), COPY_ALL);
  assert.deepEqual([...seeded.examineeIds], ["e1", "e2"]);
  assert.deepEqual([...seeded.horseIds], ["h1"]);
  assert.deepEqual([...seeded.supervisorIds], ["sup-1", "sup-2"]);
  assert.equal(seeded.examinerSetId, "eset-1");
});

test("non-requested fields are not copied", () => {
  const seeded = seedRidingFromInterface(source(), {
    copyExaminees: true,
    copyHorses: false,
    copySupervisors: false,
    copyExaminerSet: false,
  });
  assert.deepEqual([...seeded.examineeIds], ["e1", "e2"]);
  assert.deepEqual([...seeded.horseIds], []);
  assert.deepEqual([...seeded.supervisorIds], []);
  assert.equal(seeded.examinerSetId, null);
});

test("seeded outputs do not share a mutable array reference with the source", () => {
  const src = source();
  const seeded = seedRidingFromInterface(src, COPY_ALL);
  assert.notEqual(seeded.examineeIds, src.examineeIds);
  assert.notEqual(seeded.horseIds, src.horseIds);
  assert.notEqual(seeded.supervisorIds, src.supervisorIds);
  // equal contents, distinct instances
  assert.deepEqual([...seeded.examineeIds], [...src.examineeIds]);
});

test("later changes to a mutable source do not propagate to the seed (no permanent sync)", () => {
  // Build a mutable source, seed once, then mutate the source arrays.
  const mutableExaminees = ["e1", "e2"];
  const mutableSupervisors = ["sup-1"];
  const src: InterfaceSeedSource = {
    examineeIds: mutableExaminees,
    horseIds: ["h1"],
    supervisorIds: mutableSupervisors,
    examinerSetId: "eset-1",
  };
  const seeded = seedRidingFromInterface(src, COPY_ALL);

  mutableExaminees.push("e3-added-after-seed");
  mutableSupervisors.length = 0;

  // The one-time seed is a snapshot; the source diverging does not change it.
  assert.deepEqual([...seeded.examineeIds], ["e1", "e2"]);
  assert.deepEqual([...seeded.supervisorIds], ["sup-1"]);
});

test("the seed does not mutate its source", () => {
  const src = source();
  const snapshot = JSON.stringify(src);
  seedRidingFromInterface(src, COPY_ALL);
  assert.equal(JSON.stringify(src), snapshot);
});
