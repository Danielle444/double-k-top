/**
 * MULTI-COURSE W4 - PURE guard + verification logic for the PRODUCTION-ONLY
 * seed CourseOffering backfill apply entrypoint
 * (scripts/backfill-course-offering.prod-apply.ts).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * argv, no top-level execution. Every function takes plain data and returns
 * plain data, so the entire production safety contract is unit-testable without
 * a database (see backfill-course-offering.prod-apply.test.ts) and importing
 * this module can never trigger a write.
 *
 * These are the gates that stand between the operator and a production write:
 *  - evaluateProductionApplyGuard: refuses unless EVERY confirmation is present
 *    AND exactly equals the locked seed identity + detected production ref.
 *  - checkExpectedPlan: refuses unless the re-run pre-write audit matches the
 *    exact locked plan (all creates, zero reuse, zero invalid/ungrouped).
 *  - checkPostWriteCounts / checkPreservationCounts: post-write assertions that
 *    the new spine landed exactly and NO existing source data changed.
 *
 * The locked seed values are duplicated NOWHERE else as literals that could
 * drift: the production project ref is re-exported from the pure planner, and
 * the seed name/year/level are the single source of truth here.
 */
import { PRODUCTION_PROJECT_REF } from "./backfill-course-offering.plan";

/** The one production Supabase project ref this entrypoint may ever write to. */
export const EXPECTED_PRODUCTION_REF = PRODUCTION_PROJECT_REF;

/** Locked seed identity (from the W4 brief; never invented, never defaulted). */
export const EXPECTED_OFFERING_NAME = "קורס מדריכים ומאמנים – רמה 1";
export const EXPECTED_ACTIVITY_YEAR = "2026";
export const EXPECTED_LEVEL = 1;

/**
 * Recovery policy after a PARTIAL Phase 2 failure. This script does NOT
 * auto-resume and does NOT auto-clean: recovery is a deliberate manual runbook.
 * Surfaced to the operator (printed on any partial failure) rather than acted on.
 */
export const PARTIAL_FAILURE_RECOVERY_POLICY = [
  "Phase 1 (ActivityYear + CourseOffering + CourseGroups) is written in ONE atomic transaction.",
  "Phase 2 writes each student's enrollment + membership in its OWN transaction.",
  "A partial Phase 2 failure may therefore leave SOME enrollments/memberships written for the target offering.",
  "The strict reuse=0 pre-write gate INTENTIONALLY blocks an automatic retry (a re-run would see reuse>0 and refuse).",
  "Recovery is manual: STOP, audit the exact partial rows, and delete ONLY the target offering's newly-created",
  "multi-course rows (GroupMembership -> CourseEnrollment -> CourseGroup -> CourseOffering -> ActivityYear, in FK-safe",
  "order, scoped to this offering) to return to a pristine state, then re-run this entrypoint from scratch.",
  "This script performs NO automatic deletion, rollback, or resume. Never touch Student or trainee-history rows.",
].join("\n");

/** Everything the production confirmation guard needs, already parsed. */
export interface ProdApplyGuardInput {
  /** Whether --apply was passed. */
  apply: boolean;
  /** The value of --confirm-production=<ref>, or null if absent/blank. */
  confirmProductionRef: string | null;
  /** The project ref detected from DATABASE_URL (identifyDbTarget), or null. */
  detectedRef: string | null;
  /** Whether the detected target is the production project ref. */
  detectedIsProduction: boolean;
  /** The value of --offering-name=<name>, or null if absent/blank. */
  offeringName: string | null;
  /** The value of --activity-year-name=<name>, or null if absent/blank. */
  activityYearName: string | null;
  /** The value of --offering-level=<int>, or null if absent/invalid. */
  offeringLevel: number | null;
}

export type ProdApplyGuardResult =
  | { ok: true }
  | { ok: false; reasons: string[] };

/**
 * The single production write authorization gate. Returns ok:true ONLY when
 * every one of the required confirmations is present and exactly matches the
 * locked seed identity and the detected production ref. Fails CLOSED: any
 * missing or differing value refuses. Reasons never echo raw operator input or
 * credentials - they describe WHICH confirmation failed, not its value.
 */
export function evaluateProductionApplyGuard(input: ProdApplyGuardInput): ProdApplyGuardResult {
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
  // Cross-check: the operator's confirmation and the detected target must agree,
  // so a correct --confirm-production against the WRONG database is still refused.
  if (
    input.confirmProductionRef !== null &&
    input.detectedRef !== null &&
    input.confirmProductionRef !== input.detectedRef
  ) {
    reasons.push("--confirm-production ref and detected DATABASE_URL ref disagree");
  }
  if (input.offeringName === null) {
    reasons.push("missing required --offering-name");
  } else if (input.offeringName !== EXPECTED_OFFERING_NAME) {
    reasons.push("--offering-name does not match the locked seed offering name");
  }
  if (input.activityYearName === null) {
    reasons.push("missing required --activity-year-name");
  } else if (input.activityYearName !== EXPECTED_ACTIVITY_YEAR) {
    reasons.push("--activity-year-name does not match the locked seed activity year");
  }
  if (input.offeringLevel === null) {
    reasons.push("missing/invalid required --offering-level");
  } else if (input.offeringLevel !== EXPECTED_LEVEL) {
    reasons.push("--offering-level does not match the locked seed level");
  }

  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

/** The subset of a pre-write audit the expected-plan gate inspects. */
export interface ObservedPlan {
  activityYearCreate: number;
  offeringCreate: number;
  topCreate: number;
  topReuse: number;
  subCreate: number;
  subReuse: number;
  enrollmentCreate: number;
  enrollmentReuse: number;
  membershipCreate: number;
  membershipReuse: number;
  invalid: number;
  ungrouped: number;
  offeringConflict: string | null;
}

/** The exact plan the W4 production DRY RUN produced; anything else must stop. */
export const EXPECTED_PLAN = {
  activityYearCreate: 1,
  offeringCreate: 1,
  topCreate: 2,
  subCreate: 8,
  enrollmentCreate: 41,
  membershipCreate: 41,
} as const;

export interface CheckResult {
  ok: boolean;
  mismatches: string[];
}

/**
 * Pre-write plan gate: the re-run audit must match the locked expected plan
 * EXACTLY - the precise create counts, zero reuse of any kind, no offering
 * identity conflict, and zero invalid/ungrouped students. Any deviation returns
 * ok:false so the entrypoint stops BEFORE any write.
 */
export function checkExpectedPlan(observed: ObservedPlan): CheckResult {
  const mismatches: string[] = [];
  const expectExact = (label: string, actual: number, expected: number): void => {
    if (actual !== expected) mismatches.push(`${label}: expected ${expected}, got ${actual}`);
  };

  if (observed.offeringConflict !== null) {
    mismatches.push(`offering identity conflict: ${observed.offeringConflict}`);
  }
  expectExact("ActivityYear create", observed.activityYearCreate, EXPECTED_PLAN.activityYearCreate);
  expectExact("CourseOffering create", observed.offeringCreate, EXPECTED_PLAN.offeringCreate);
  expectExact("top-level group create", observed.topCreate, EXPECTED_PLAN.topCreate);
  expectExact("subgroup create", observed.subCreate, EXPECTED_PLAN.subCreate);
  expectExact("enrollment create", observed.enrollmentCreate, EXPECTED_PLAN.enrollmentCreate);
  expectExact("membership create", observed.membershipCreate, EXPECTED_PLAN.membershipCreate);
  // reuse=0 across every entity type (a fresh production is required).
  expectExact("top-level group reuse", observed.topReuse, 0);
  expectExact("subgroup reuse", observed.subReuse, 0);
  expectExact("enrollment reuse", observed.enrollmentReuse, 0);
  expectExact("membership reuse", observed.membershipReuse, 0);
  expectExact("invalid students", observed.invalid, 0);
  expectExact("ungrouped students", observed.ungrouped, 0);

  return { ok: mismatches.length === 0, mismatches };
}

/** Post-write counts scoped to the newly-created seed offering. */
export interface PostWriteCounts {
  activityYear: number;
  offering: number;
  enrollment: number;
  topGroups: number;
  subGroups: number;
  membership: number;
}

export const EXPECTED_POSTWRITE: PostWriteCounts = {
  activityYear: 1,
  offering: 1,
  enrollment: 41,
  topGroups: 2,
  subGroups: 8,
  membership: 41,
};

/** Post-write gate: the created spine must match the expected counts exactly. */
export function checkPostWriteCounts(observed: PostWriteCounts): CheckResult {
  const mismatches: string[] = [];
  for (const key of Object.keys(EXPECTED_POSTWRITE) as (keyof PostWriteCounts)[]) {
    if (observed[key] !== EXPECTED_POSTWRITE[key]) {
      mismatches.push(`${key}: expected ${EXPECTED_POSTWRITE[key]}, got ${observed[key]}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Existing source-data counts that MUST be unchanged by the backfill. */
export interface PreservationCounts {
  student: number;
  traineeGroupMembership: number;
  traineeHorseAssignment: number;
}

export const EXPECTED_PRESERVATION: PreservationCounts = {
  student: 41,
  traineeGroupMembership: 41,
  traineeHorseAssignment: 41,
};

/**
 * Preservation gate: the backfill must never touch Student / trainee-history
 * rows, so these existing counts must be exactly what they were before.
 */
export function checkPreservationCounts(observed: PreservationCounts): CheckResult {
  const mismatches: string[] = [];
  for (const key of Object.keys(EXPECTED_PRESERVATION) as (keyof PreservationCounts)[]) {
    if (observed[key] !== EXPECTED_PRESERVATION[key]) {
      mismatches.push(`${key}: expected ${EXPECTED_PRESERVATION[key]}, got ${observed[key]}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}
