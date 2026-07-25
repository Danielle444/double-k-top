/**
 * DUTY LEVEL-2-ONLY FILTER (P1) - the SINGLE source of truth for "who belongs in
 * the Level 1 duty pool".
 *
 * PROBLEM
 * -------
 * Duty pools historically keyed on `Student.isActive` ALONE. When the Level 2
 * offering went ACTIVE, all 8 Level-2-only trainees became `isActive = true`,
 * so they leaked into Level 1 duty pools / pickers / exports even though they
 * have no Level 1 enrollment.
 *
 * RULE
 * ----
 * A trainee belongs in the Level 1 duty pool IFF:
 *   `Student.isActive === true` AND they hold an ACTIVE `CourseEnrollment` for
 *   the Level 1 offering.
 *
 *  - Level-1-only  -> included (has active L1 enrollment).
 *  - Dual (L1+L2)  -> included THROUGH the active L1 enrollment (never via L2).
 *  - L1 enrollment INACTIVE / absent -> excluded.
 *  - Level-2-only  -> excluded (no active L1 enrollment).
 *
 * `isActive` remains a NECESSARY gate; it is no longer SUFFICIENT.
 *
 * PURE by construction: no Prisma runtime import, no DB, no clock. It imports
 * only the verified Level 1 offering id constant and a TYPE-only Prisma
 * namespace (erased at compile time), so it is fully unit-testable DB-free.
 * The read paths (scheduler / export / diagnostics) filter at the DB via
 * `dutyEligibleStudentWhere`; the write paths re-check a single student via
 * `isDutyEligible`. Both encodings are built from the SAME offering id + ACTIVE
 * status defined here, so pool-read and write-validate share one rule.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { LEVEL_1_COURSE_OFFERING_ID } from "./temporary-level2-compatibility";

/**
 * The offering whose ACTIVE enrollment makes a trainee duty-eligible.
 *
 * TEMPORARY SINGLE-DUTY-OFFERING RULE. Duties are not offering-scoped in the
 * schema: there is one global duty domain. This rule is valid ONLY while both
 * hold at this launch:
 *   - Level 2 has NO duties, and
 *   - there is EXACTLY ONE known Level 1 duty course.
 * Under those facts "the duty course" is unambiguously the established Level 1
 * offering, so this reuses the single verified `LEVEL_1_COURSE_OFFERING_ID`
 * constant rather than re-deriving "which offering is Level 1" (and introduces
 * NO new literal offering id here).
 *
 * MUST BE REPLACED when duties become offering-scoped (a second duty-bearing
 * offering, or a per-offering duty domain): at that point this constant stops
 * being a correct global answer and eligibility must be resolved against the
 * request's own offering. Every duty pool reader and every duty write path
 * routes through this one helper precisely so that replacement is a single-site
 * change.
 */
export const DUTY_POOL_OFFERING_ID = LEVEL_1_COURSE_OFFERING_ID;

/**
 * The Prisma `where` predicate for the Level 1 duty pool. Applied at the DB by
 * every duty-pool READER (scheduler, export, diagnostics) so Level-2-only
 * trainees are never fetched into a Level 1 pool in the first place. Encodes the
 * exact same rule as `isDutyEligible`, from the same constants.
 */
export const dutyEligibleStudentWhere: Prisma.StudentWhereInput = {
  isActive: true,
  courseEnrollments: {
    some: { courseOfferingId: DUTY_POOL_OFFERING_ID, status: "ACTIVE" },
  },
};

/** Minimal shape the pure predicate needs; a superset of any real Student row. */
export interface DutyEligibilityStudent {
  isActive: boolean;
  courseEnrollments: readonly { courseOfferingId: string; status: string }[];
}

/**
 * Server-side eligibility re-check for the manual duty WRITE paths
 * (create / reassign / upsert). Fail-closed: any student lacking an ACTIVE
 * Level 1 enrollment - including every Level-2-only trainee - returns false and
 * must be rejected, never silently dropped.
 */
export function isDutyEligible(student: DutyEligibilityStudent): boolean {
  return (
    student.isActive === true &&
    student.courseEnrollments.some(
      (e) => e.status === "ACTIVE" && e.courseOfferingId === DUTY_POOL_OFFERING_ID,
    )
  );
}
