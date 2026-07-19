/**
 * MULTI-COURSE W8A-2 - pure unit tests for the PRODUCTION apply guard +
 * verification gates. No DB, no framework: node:test + node:assert/strict:
 *
 *   npx tsx --test scripts/backfill-horse-enrollment.prod-apply.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import { identifyDbTarget, PRODUCTION_PROJECT_REF } from "./backfill-course-offering.plan";
import type { HorseEnrollmentBackfillSummary } from "../lib/course/horse-enrollment-backfill-plan";
import {
  checkExpectedHorsePlan,
  checkHorsePostWrite,
  checkHorsePreservation,
  evaluateHorseProdApplyGuard,
  EXPECTED_PRODUCTION_REF,
  type ExpectedHorseCounts,
  type HorseProdApplyGuardInput,
} from "./backfill-horse-enrollment.prod-apply.plan";

const REF = PRODUCTION_PROJECT_REF;
const SYNTH_PW = "synthetic-password-not-real";

function validGuardInput(over: Partial<HorseProdApplyGuardInput> = {}): HorseProdApplyGuardInput {
  return {
    apply: true,
    confirmProductionRef: REF,
    detectedRef: REF,
    detectedIsProduction: true,
    expectedHistoryRows: 41,
    expectedEnrollments: 41,
    expectedLinkUpdates: 41,
    expectedCacheUpdates: 37,
    ...over,
  };
}

const EXPECTED: ExpectedHorseCounts = {
  historyRows: 41,
  enrollments: 41,
  linkUpdates: 41,
  cacheUpdates: 37,
};

function summary(over: Partial<HorseEnrollmentBackfillSummary> = {}): HorseEnrollmentBackfillSummary {
  return {
    currentOfferingId: "off_current",
    asOf: "2026-07-19",
    totalHistoryRows: 41,
    totalEnrollments: 41,
    linkUpdatesRequired: 41,
    cacheUpdatesRequired: 37,
    alreadyCorrectLinks: 0,
    alreadyCorrectCaches: 4,
    zeroEnrollment: 0,
    multipleEnrollment: 0,
    missingCurrentHistory: 0,
    multipleCurrentHistory: 0,
    studentEnrollmentMismatch: 0,
    invalidHorseState: 0,
    preLinkedWrongEnrollment: 0,
    duplicateHistoryRow: 0,
    duplicateEnrollment: 0,
    anomalyTotal: 0,
    ...over,
  };
}

test("guard passes on a fully-valid production confirmation and returns expected counts", () => {
  const r = evaluateHorseProdApplyGuard(validGuardInput());
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.expected.cacheUpdates === 37);
});

test("EXPECTED_PRODUCTION_REF is the re-exported locked ref (no drift literal)", () => {
  assert.equal(EXPECTED_PRODUCTION_REF, REF);
});

test("guard is a strict AND-gate: each single missing/wrong field refuses", () => {
  const mutations: Partial<HorseProdApplyGuardInput>[] = [
    { apply: false },
    { confirmProductionRef: null },
    { confirmProductionRef: "wrong-ref" },
    { detectedRef: "some-other-ref" },
    { detectedIsProduction: false },
    { expectedHistoryRows: null },
    { expectedEnrollments: null },
    { expectedLinkUpdates: null },
    { expectedCacheUpdates: null },
    { expectedCacheUpdates: -1 },
  ];
  for (const m of mutations) {
    const r = evaluateHorseProdApplyGuard(validGuardInput(m));
    assert.equal(r.ok, false, `expected refusal for ${JSON.stringify(m)}`);
  }
});

test("guard refuses a correct confirm-ref pointed at the WRONG detected database", () => {
  const r = evaluateHorseProdApplyGuard(
    validGuardInput({ confirmProductionRef: REF, detectedRef: "different", detectedIsProduction: false }),
  );
  assert.equal(r.ok, false);
});

test("guard reasons never leak a synthetic password from a realistic pooler URL", () => {
  const url = `postgresql://postgres.${REF}:${SYNTH_PW}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;
  const target = identifyDbTarget(url);
  assert.equal(target.display.includes(SYNTH_PW), false);
  const r = evaluateHorseProdApplyGuard(
    validGuardInput({ detectedRef: target.projectRef, detectedIsProduction: target.isProduction }),
  );
  const blob = r.ok ? "" : r.reasons.join("\n");
  assert.equal(blob.includes(SYNTH_PW), false);
});

test("checkExpectedHorsePlan passes on the exact reviewed plan", () => {
  const r = checkExpectedHorsePlan(summary(), EXPECTED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.mismatches, []);
});

test("checkExpectedHorsePlan refuses when the cache-update count differs from reviewed", () => {
  const r = checkExpectedHorsePlan(summary({ cacheUpdatesRequired: 40 }), EXPECTED);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.includes("cache updates required")));
});

test("checkExpectedHorsePlan refuses when link updates differ", () => {
  const r = checkExpectedHorsePlan(
    summary({ linkUpdatesRequired: 40, alreadyCorrectLinks: 1 }),
    EXPECTED,
  );
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.includes("link updates required")));
});

test("checkExpectedHorsePlan refuses when any anomaly is present", () => {
  const r = checkExpectedHorsePlan(summary({ anomalyTotal: 1, zeroEnrollment: 1 }), EXPECTED);
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.includes("anomalies present")));
});

test("checkExpectedHorsePlan refuses when history rows are unaccounted for", () => {
  // linkUpdates + alreadyCorrectLinks != totalHistoryRows
  const r = checkExpectedHorsePlan(
    summary({ linkUpdatesRequired: 40, alreadyCorrectLinks: 0 }),
    { ...EXPECTED, linkUpdates: 40 },
  );
  assert.equal(r.ok, false);
  assert.ok(r.mismatches.some((m) => m.includes("unaccounted history rows")));
});

test("checkHorsePostWrite passes only on a fully-converged re-plan", () => {
  const converged = summary({
    linkUpdatesRequired: 0,
    cacheUpdatesRequired: 0,
    alreadyCorrectLinks: 41,
    alreadyCorrectCaches: 41,
  });
  assert.equal(checkHorsePostWrite(converged).ok, true);
  assert.equal(checkHorsePostWrite(summary()).ok, false); // still has outstanding work
});

test("checkHorsePreservation refuses when history/enrollment counts drift", () => {
  assert.equal(checkHorsePreservation({ historyRows: 41, enrollments: 41 }, EXPECTED).ok, true);
  assert.equal(checkHorsePreservation({ historyRows: 42, enrollments: 41 }, EXPECTED).ok, false);
  assert.equal(checkHorsePreservation({ historyRows: 41, enrollments: 40 }, EXPECTED).ok, false);
});
