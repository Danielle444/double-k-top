/**
 * MULTI-COURSE W4 - executable tests for the PURE production-apply guard +
 * verification logic (backfill-course-offering.prod-apply.plan.ts).
 *
 * Run with: npx tsx --test scripts/backfill-course-offering.prod-apply.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env. Importing the module
 * under test can never trigger a write, so these tests exercise every gate that
 * stands in front of a production write without touching a database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPECTED_ACTIVITY_YEAR,
  EXPECTED_LEVEL,
  EXPECTED_OFFERING_NAME,
  EXPECTED_PRODUCTION_REF,
  checkExpectedPlan,
  checkPostWriteCounts,
  checkPreservationCounts,
  evaluateProductionApplyGuard,
  type ObservedPlan,
  type PostWriteCounts,
  type PreservationCounts,
  type ProdApplyGuardInput,
} from "./backfill-course-offering.prod-apply.plan";
import { identifyDbTarget } from "./backfill-course-offering.plan";
import { subGroupKey } from "./backfill-course-offering.apply";

// A fully-valid guard input (every confirmation present and exactly correct).
function validGuardInput(over: Partial<ProdApplyGuardInput> = {}): ProdApplyGuardInput {
  return {
    apply: true,
    confirmProductionRef: EXPECTED_PRODUCTION_REF,
    detectedRef: EXPECTED_PRODUCTION_REF,
    detectedIsProduction: true,
    offeringName: EXPECTED_OFFERING_NAME,
    activityYearName: EXPECTED_ACTIVITY_YEAR,
    offeringLevel: EXPECTED_LEVEL,
    ...over,
  };
}

// The exact locked pre-write plan (all creates, zero reuse, nothing invalid).
function validPlan(over: Partial<ObservedPlan> = {}): ObservedPlan {
  return {
    activityYearCreate: 1,
    offeringCreate: 1,
    topCreate: 2,
    topReuse: 0,
    subCreate: 8,
    subReuse: 0,
    enrollmentCreate: 41,
    enrollmentReuse: 0,
    membershipCreate: 41,
    membershipReuse: 0,
    invalid: 0,
    ungrouped: 0,
    offeringConflict: null,
    ...over,
  };
}

test("guard: exact confirmation is accepted", () => {
  const result = evaluateProductionApplyGuard(validGuardInput());
  assert.equal(result.ok, true);
});

test("guard: missing --apply is refused", () => {
  const result = evaluateProductionApplyGuard(validGuardInput({ apply: false }));
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.reasons.some((r) => r.includes("--apply")));
});

test("guard: missing --confirm-production is refused", () => {
  const result = evaluateProductionApplyGuard(validGuardInput({ confirmProductionRef: null }));
  assert.equal(result.ok, false);
});

test("guard: wrong --confirm-production ref is refused", () => {
  const result = evaluateProductionApplyGuard(
    validGuardInput({ confirmProductionRef: "not-the-prod-ref" }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.reasons.some((r) => r.includes("--confirm-production")));
});

test("guard: detected DATABASE_URL ref mismatch is refused", () => {
  // Correct confirmation flag, but the connected DB is NOT production.
  const result = evaluateProductionApplyGuard(
    validGuardInput({ detectedRef: "some-dev-ref", detectedIsProduction: false }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && result.reasons.some((r) => r.includes("DATABASE_URL")));
});

test("guard: confirm ref and detected ref must agree (right flag, wrong DB)", () => {
  // --confirm-production is the prod ref, but DATABASE_URL points elsewhere.
  const result = evaluateProductionApplyGuard(
    validGuardInput({ detectedRef: "other-ref", detectedIsProduction: false }),
  );
  assert.equal(result.ok, false);
});

test("guard: wrong offering name / year / level are each refused", () => {
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ offeringName: "wrong" })).ok, false);
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ offeringName: null })).ok, false);
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ activityYearName: "2025" })).ok, false);
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ activityYearName: null })).ok, false);
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ offeringLevel: 2 })).ok, false);
  assert.equal(evaluateProductionApplyGuard(validGuardInput({ offeringLevel: null })).ok, false);
});

test("guard: reasons never echo raw credentials/input values", () => {
  const secret = "SUPER-SECRET-VALUE";
  const result = evaluateProductionApplyGuard(
    validGuardInput({ confirmProductionRef: secret, offeringName: secret }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && !result.reasons.join(" ").includes(secret));
});

test("guard: no write path is reachable unless EVERY confirmation passes", () => {
  // Dropping any single required confirmation must refuse; only the complete,
  // exactly-correct input is accepted. This is the AND-gate in front of writes.
  const mutations: Partial<ProdApplyGuardInput>[] = [
    { apply: false },
    { confirmProductionRef: null },
    { confirmProductionRef: "x" },
    { detectedRef: null },
    { detectedRef: "x" },
    { detectedIsProduction: false },
    { offeringName: null },
    { offeringName: "x" },
    { activityYearName: null },
    { activityYearName: "x" },
    { offeringLevel: null },
    { offeringLevel: 99 },
  ];
  for (const m of mutations) {
    assert.equal(
      evaluateProductionApplyGuard(validGuardInput(m)).ok,
      false,
      `expected refusal for mutation ${JSON.stringify(m)}`,
    );
  }
  // Only the untouched, fully-valid input passes.
  assert.equal(evaluateProductionApplyGuard(validGuardInput()).ok, true);
});

test("expected-plan gate: exact locked plan is accepted", () => {
  const result = checkExpectedPlan(validPlan());
  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
});

test("expected-plan gate: incorrect expected counts are refused", () => {
  assert.equal(checkExpectedPlan(validPlan({ enrollmentCreate: 40 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ topCreate: 3 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ subCreate: 7 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ membershipCreate: 42 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ activityYearCreate: 0 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ offeringCreate: 0 })).ok, false);
});

test("expected-plan gate: any reuse (fresh production required) is refused", () => {
  assert.equal(checkExpectedPlan(validPlan({ topReuse: 1 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ subReuse: 1 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ enrollmentReuse: 1 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ membershipReuse: 1 })).ok, false);
});

test("expected-plan gate: invalid/ungrouped students are refused", () => {
  assert.equal(checkExpectedPlan(validPlan({ invalid: 1 })).ok, false);
  assert.equal(checkExpectedPlan(validPlan({ ungrouped: 1 })).ok, false);
});

test("expected-plan gate: an offering identity conflict stops", () => {
  const result = checkExpectedPlan(validPlan({ offeringConflict: "CONFLICT: level mismatch" }));
  assert.equal(result.ok, false);
  assert.ok(result.mismatches.some((m) => m.includes("conflict")));
});

test("post-write gate: exact expected counts accepted", () => {
  const counts: PostWriteCounts = {
    activityYear: 1,
    offering: 1,
    enrollment: 41,
    topGroups: 2,
    subGroups: 8,
    membership: 41,
  };
  assert.equal(checkPostWriteCounts(counts).ok, true);
});

test("post-write gate: a count mismatch fails", () => {
  const base: PostWriteCounts = {
    activityYear: 1,
    offering: 1,
    enrollment: 41,
    topGroups: 2,
    subGroups: 8,
    membership: 41,
  };
  assert.equal(checkPostWriteCounts({ ...base, enrollment: 40 }).ok, false);
  assert.equal(checkPostWriteCounts({ ...base, subGroups: 9 }).ok, false);
  assert.equal(checkPostWriteCounts({ ...base, membership: 0 }).ok, false);
});

test("preservation gate: unchanged source counts accepted, changed counts fail", () => {
  const base: PreservationCounts = {
    student: 41,
    traineeGroupMembership: 41,
    traineeHorseAssignment: 41,
  };
  assert.equal(checkPreservationCounts(base).ok, true);
  assert.equal(checkPreservationCounts({ ...base, student: 40 }).ok, false);
  assert.equal(checkPreservationCounts({ ...base, traineeGroupMembership: 42 }).ok, false);
  assert.equal(checkPreservationCounts({ ...base, traineeHorseAssignment: 0 }).ok, false);
});

// --- End-to-end: realistic pooler DATABASE_URL -> detection -> guard ---------
// These prove the guard passes ONLY when the detected ref AND the confirmation
// both equal the locked production ref, using the REAL pooler URL shape. Uses a
// synthetic password only.
function guardForUrl(url: string, confirmProductionRef: string): ReturnType<typeof evaluateProductionApplyGuard> {
  const t = identifyDbTarget(url);
  return evaluateProductionApplyGuard({
    apply: true,
    confirmProductionRef,
    detectedRef: t.projectRef,
    detectedIsProduction: t.isProduction,
    offeringName: EXPECTED_OFFERING_NAME,
    activityYearName: EXPECTED_ACTIVITY_YEAR,
    offeringLevel: EXPECTED_LEVEL,
  });
}

test("e2e: real 6543 pooler URL + correct confirmation => guard passes", () => {
  const url = `postgresql://postgres.${EXPECTED_PRODUCTION_REF}:SYNTH_PW@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`;
  assert.equal(guardForUrl(url, EXPECTED_PRODUCTION_REF).ok, true);
});

test("e2e: real 5432 pooler URL + correct confirmation => guard passes", () => {
  const url = `postgresql://postgres.${EXPECTED_PRODUCTION_REF}:SYNTH_PW@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`;
  assert.equal(guardForUrl(url, EXPECTED_PRODUCTION_REF).ok, true);
});

test("e2e: real pooler URL but WRONG confirmation ref => guard refuses", () => {
  const url = `postgresql://postgres.${EXPECTED_PRODUCTION_REF}:SYNTH_PW@aws-0-eu-west-3.pooler.supabase.com:6543/postgres`;
  assert.equal(guardForUrl(url, "not-the-prod-ref").ok, false);
});

test("e2e: correct confirmation but NON-production pooler DB => guard refuses", () => {
  // DATABASE_URL points at a different project; confirmation alone must not pass.
  const url = "postgresql://postgres.someotherref:SYNTH_PW@aws-0-eu-west-3.pooler.supabase.com:6543/postgres";
  assert.equal(guardForUrl(url, EXPECTED_PRODUCTION_REF).ok, false);
});

test("e2e: guard failure reasons never leak the synthetic password", () => {
  const url = "postgresql://postgres.someotherref:SUPER_SECRET_PW@aws-0-eu-west-3.pooler.supabase.com:6543/postgres";
  const result = guardForUrl(url, EXPECTED_PRODUCTION_REF);
  assert.equal(result.ok, false);
  assert.ok(result.ok === false && !result.reasons.join(" ").includes("SUPER_SECRET_PW"));
  // The redacted display must not carry the password either.
  assert.ok(!identifyDbTarget(url).display.includes("SUPER_SECRET_PW"));
});

// --- Subgroup composite-key construction stays internally consistent ---------
test("subGroupKey: set-side and get-side keys match for the same (top, name)", () => {
  // The membership phase reads with (target.top, target.sub); the spine phase
  // wrote with (spec.parentTop, spec.name). Same pair => same key.
  assert.equal(subGroupKey("א", "2"), subGroupKey("א", "2"));
  assert.equal(subGroupKey("ב", "10"), subGroupKey("ב", "10"));
});

test("subGroupKey: uses a NUL separator and stays injective across boundaries", () => {
  // NUL separator: distinct (top, name) pairs never collide the way a space
  // separator could (e.g. ("a","b c") vs ("a b","c")).
  assert.equal(subGroupKey("a", "b"), "a\0b");
  assert.notEqual(subGroupKey("a", "b c"), subGroupKey("a b", "c"));
  assert.notEqual(subGroupKey("א", "1"), subGroupKey("א", "2"));
});
