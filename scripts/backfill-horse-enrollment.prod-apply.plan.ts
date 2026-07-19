/**
 * MULTI-COURSE W8A-2 - PURE guard + verification logic for the PRODUCTION-ONLY
 * enrollment-scoped horse backfill apply entrypoint
 * (scripts/backfill-horse-enrollment.prod-apply.ts).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * argv, no top-level execution. Every function takes plain data and returns
 * plain data, so the entire production safety contract is unit-testable without
 * a database (see backfill-horse-enrollment.prod-apply.test.ts) and importing
 * this module can never trigger a write.
 *
 * The gates between the operator and a production write:
 *  - evaluateHorseProdApplyGuard: refuses unless --apply + --confirm-production
 *    exactly equal the locked production ref (and agree with the detected DB
 *    target), AND every reviewed expected count is present and valid.
 *  - checkExpectedHorsePlan: refuses unless the re-run plan matches the operator-
 *    reviewed expected counts EXACTLY and has zero anomalies. The cache-update
 *    count is NOT hardcoded here - it is a reviewed CLI input compared against
 *    the plan's derived value, so a drift in either direction stops the apply.
 *  - checkHorsePostWrite / checkHorsePreservation: post-write assertions that the
 *    backfill fully converged and that NO history row / enrollment was created or
 *    destroyed.
 *
 * The one locked literal here is the production project ref, re-exported from the
 * pure planner so it can never drift. Expected COUNTS are deliberately operator-
 * supplied (reviewed from the dry-run), never hardcoded.
 */
import { PRODUCTION_PROJECT_REF } from "./backfill-course-offering.plan";
import type { HorseEnrollmentBackfillSummary } from "../lib/course/horse-enrollment-backfill-plan";

/** The one production Supabase project ref this entrypoint may ever write to. */
export const EXPECTED_PRODUCTION_REF = PRODUCTION_PROJECT_REF;

/**
 * Recovery policy after a failure. This entrypoint writes the whole backfill in
 * ONE transaction, so a failed apply rolls back with no partial writes; recovery
 * is simply to fix the cause and re-run (the writes are idempotent). It performs
 * NO automatic cleanup or retry.
 */
export const FAILURE_RECOVERY_POLICY = [
  "All writes execute in ONE transaction: a failure rolls back with NO partial state.",
  "The writes are idempotent - after fixing the cause, re-running is safe and re-plans only outstanding work.",
  "This script performs NO automatic deletion, rollback loop, or resume. Never touch Student or history horse values.",
].join("\n");

/** The reviewed expected counts an operator locks in from the dry-run. */
export interface ExpectedHorseCounts {
  historyRows: number;
  enrollments: number;
  linkUpdates: number;
  /** Derived by the dry-run, reviewed, then supplied - NEVER hardcoded. */
  cacheUpdates: number;
}

/** Everything the production confirmation guard needs, already parsed. */
export interface HorseProdApplyGuardInput {
  apply: boolean;
  confirmProductionRef: string | null;
  detectedRef: string | null;
  detectedIsProduction: boolean;
  expectedHistoryRows: number | null;
  expectedEnrollments: number | null;
  expectedLinkUpdates: number | null;
  expectedCacheUpdates: number | null;
}

export type HorseProdApplyGuardResult =
  | { ok: true; expected: ExpectedHorseCounts }
  | { ok: false; reasons: string[] };

const isCount = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0;

/**
 * The single production write authorization gate. Returns ok:true ONLY when
 * --apply is set, the confirmation ref exactly equals the locked production ref
 * and agrees with the detected DB target, and every reviewed expected count is a
 * present, valid non-negative integer. Fails CLOSED. Reasons never echo raw
 * operator input or credentials - they name WHICH confirmation failed.
 */
export function evaluateHorseProdApplyGuard(
  input: HorseProdApplyGuardInput,
): HorseProdApplyGuardResult {
  const reasons: string[] = [];

  if (!input.apply) {
    reasons.push("missing required --apply flag");
  }
  if (input.confirmProductionRef === null) {
    reasons.push(`missing required --confirm-production=${EXPECTED_PRODUCTION_REF}`);
  } else if (input.confirmProductionRef !== EXPECTED_PRODUCTION_REF) {
    reasons.push("--confirm-production does not equal the locked production project ref");
  }
  if (input.detectedRef !== EXPECTED_PRODUCTION_REF) {
    reasons.push("DATABASE_URL project ref does not match the locked production project ref");
  }
  if (!input.detectedIsProduction) {
    reasons.push("DATABASE_URL is not detected as the production target");
  }
  if (
    input.confirmProductionRef !== null &&
    input.detectedRef !== null &&
    input.confirmProductionRef !== input.detectedRef
  ) {
    reasons.push("--confirm-production ref and detected DATABASE_URL ref disagree");
  }
  if (!isCount(input.expectedHistoryRows)) {
    reasons.push("missing/invalid required --expected-history-rows=<int>");
  }
  if (!isCount(input.expectedEnrollments)) {
    reasons.push("missing/invalid required --expected-enrollments=<int>");
  }
  if (!isCount(input.expectedLinkUpdates)) {
    reasons.push("missing/invalid required --expected-link-updates=<int>");
  }
  if (!isCount(input.expectedCacheUpdates)) {
    reasons.push("missing/invalid required --expected-cache-updates=<int>");
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  return {
    ok: true,
    expected: {
      historyRows: input.expectedHistoryRows as number,
      enrollments: input.expectedEnrollments as number,
      linkUpdates: input.expectedLinkUpdates as number,
      cacheUpdates: input.expectedCacheUpdates as number,
    },
  };
}

export interface CheckResult {
  ok: boolean;
  mismatches: string[];
}

/**
 * Pre-write plan gate: the re-run plan must match the operator-reviewed expected
 * counts EXACTLY, carry zero anomalies, and account for every history row/
 * enrollment (no un-planned rows). Any deviation returns ok:false so the
 * entrypoint stops BEFORE any write.
 */
export function checkExpectedHorsePlan(
  observed: HorseEnrollmentBackfillSummary,
  expected: ExpectedHorseCounts,
): CheckResult {
  const mismatches: string[] = [];
  const expectExact = (label: string, actual: number, want: number): void => {
    if (actual !== want) mismatches.push(`${label}: expected ${want}, got ${actual}`);
  };

  if (observed.anomalyTotal !== 0) {
    mismatches.push(`anomalies present: ${observed.anomalyTotal} (must be 0)`);
  }
  expectExact("total history rows", observed.totalHistoryRows, expected.historyRows);
  expectExact("total enrollments", observed.totalEnrollments, expected.enrollments);
  expectExact("link updates required", observed.linkUpdatesRequired, expected.linkUpdates);
  expectExact("cache updates required", observed.cacheUpdatesRequired, expected.cacheUpdates);
  // Every history row is either a link update or already correct (no dropped row).
  if (observed.linkUpdatesRequired + observed.alreadyCorrectLinks !== observed.totalHistoryRows) {
    mismatches.push(
      `unaccounted history rows: linkUpdates(${observed.linkUpdatesRequired}) + ` +
        `alreadyCorrectLinks(${observed.alreadyCorrectLinks}) != totalHistoryRows(${observed.totalHistoryRows})`,
    );
  }

  return { ok: mismatches.length === 0, mismatches };
}

/**
 * Post-write gate: after a correct apply the re-run plan must have converged -
 * zero outstanding link/cache updates, zero anomalies, and every row/enrollment
 * now correct.
 */
export function checkHorsePostWrite(observed: HorseEnrollmentBackfillSummary): CheckResult {
  const mismatches: string[] = [];
  if (observed.anomalyTotal !== 0) mismatches.push(`anomalies after apply: ${observed.anomalyTotal}`);
  if (observed.linkUpdatesRequired !== 0) {
    mismatches.push(`link updates still required: ${observed.linkUpdatesRequired}`);
  }
  if (observed.cacheUpdatesRequired !== 0) {
    mismatches.push(`cache updates still required: ${observed.cacheUpdatesRequired}`);
  }
  if (observed.alreadyCorrectLinks !== observed.totalHistoryRows) {
    mismatches.push(
      `not all links correct: ${observed.alreadyCorrectLinks}/${observed.totalHistoryRows}`,
    );
  }
  if (observed.alreadyCorrectCaches !== observed.totalEnrollments) {
    mismatches.push(
      `not all caches correct: ${observed.alreadyCorrectCaches}/${observed.totalEnrollments}`,
    );
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** History-row + enrollment counts that MUST be unchanged (nothing created/deleted). */
export interface HorsePreservationCounts {
  historyRows: number;
  enrollments: number;
}

/**
 * Preservation gate: the backfill only UPDATES existing rows, so the total
 * history-row and enrollment counts must be exactly what the reviewed plan saw.
 */
export function checkHorsePreservation(
  observed: HorsePreservationCounts,
  expected: ExpectedHorseCounts,
): CheckResult {
  const mismatches: string[] = [];
  if (observed.historyRows !== expected.historyRows) {
    mismatches.push(`history rows: expected ${expected.historyRows}, got ${observed.historyRows}`);
  }
  if (observed.enrollments !== expected.enrollments) {
    mismatches.push(`enrollments: expected ${expected.enrollments}, got ${observed.enrollments}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}
