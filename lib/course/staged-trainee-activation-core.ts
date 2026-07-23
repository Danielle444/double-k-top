/**
 * MULTI-COURSE (staged-trainee activation guard, Slice G1) - PURE, DB-free core
 * that answers ONE narrow question:
 *
 *   "Is activating this currently-inactive trainee temporarily blocked, because
 *    their only live course affiliation is a course that has not started yet?"
 *
 * WHY THIS EXISTS: the Level-2-only new-trainee flow deliberately stages a brand
 * new Student as isActive=false with an ACTIVE CourseEnrollment into a PLANNED
 * CourseOffering. That inactive flag is what currently contains them: every known
 * Level 1 operational reader (schedule, duty generation, attendance, messages,
 * contacts, horse assignment, teaching practice, exports) filters on
 * Student.isActive === true. Flipping that one boolean from the general admin
 * trainee screen would drop a staged trainee into every one of those surfaces at
 * once, and would let them log in. This core is the classification half of the
 * temporary guard against that accidental activation.
 *
 * PURE by construction: no Prisma client, no database, no transaction, no clock,
 * no randomness, no environment, no Next.js, no auth/session/cookie/header, no IO.
 * The only import is a TYPE-ONLY import of the two Prisma status enums, so the
 * generated client is never loaded at runtime. Everything is a pure function of
 * its arguments, so the whole contract is unit-testable without a database.
 *
 * AUTHORITATIVE INPUTS (locked Rule C): CourseEnrollment.status and
 * CourseOffering.status, and nothing else. This core deliberately CANNOT see the
 * Student group mirrors, an offering's level or name, any id, a selected-course
 * cookie, or the current-offering resolver - its input type cannot even carry
 * them. In particular the rule is NOT Level-2-specific: keying policy on
 * CourseOffering.level was rejected, because level is a display attribute and a
 * level-specific rule would silently fail to protect any other staged cohort.
 *
 * TEMPORARY FLOOR (accepted product decision): when a PLANNED offering later
 * becomes ACTIVE, this rule stops blocking automatically. That is a floor, not a
 * full release gate - offering status alone does not mean operational roster and
 * schedule isolation are ready. Operationally, an offering must not be switched to
 * ACTIVE before that isolation exists. No release flag and no new lifecycle
 * operation is introduced here.
 *
 * SCOPE (Slice G1): this module is pure classification plus its stable Hebrew
 * strings. It is NOT wired into any server action or UI in this slice; it performs
 * and enables no write.
 */
import type {
  CourseEnrollmentStatus,
  CourseOfferingStatus,
} from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Input surface (deliberately minimal)
// ---------------------------------------------------------------------------

/**
 * The ONLY per-enrollment shape this core accepts: the enrollment's own lifecycle
 * status plus the lifecycle status of the offering it points at. It carries no
 * identifier, no offering name or level, no group mirror, no date and no primary
 * flag - a caller physically cannot feed this core anything that Rule C must not
 * consider, and a future field cannot creep in unnoticed.
 */
export interface ActivationEnrollmentInput {
  readonly status: CourseEnrollmentStatus;
  readonly offeringStatus: CourseOfferingStatus;
}

// ---------------------------------------------------------------------------
// Known enum values (exhaustive, prototype-safe, no runtime Prisma import)
// ---------------------------------------------------------------------------

/**
 * The known enum members, stated as `Record<Enum, true>` rather than imported as
 * runtime values (which would pull in the generated Prisma client). The Record
 * annotation is what makes these exhaustive: adding a future member to either
 * Prisma enum leaves the object missing a key and fails TypeScript until it is
 * classified here. Both tables are module-private, so no caller can widen or
 * mutate what counts as a well-formed value.
 */
const KNOWN_ENROLLMENT_STATUSES: Record<CourseEnrollmentStatus, true> = {
  ACTIVE: true,
  INACTIVE: true,
};

const KNOWN_OFFERING_STATUSES: Record<CourseOfferingStatus, true> = {
  PLANNED: true,
  ACTIVE: true,
  ARCHIVED: true,
};

/**
 * True only for a string that is an OWN key of the given table. Inherited keys
 * ("toString", "constructor", "__proto__", ...) must never resolve through the
 * prototype chain, and a non-string value is rejected before any property access,
 * so a hostile object with a throwing toString can never make this throw.
 */
function isKnownStatus(table: object, value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(table, value);
}

/**
 * A row is well-formed only when it is a real object whose OWN `status` and
 * `offeringStatus` are both known enum members. Anything else (null, a primitive,
 * an array, a missing field, a typo'd or prototype-inherited status) is malformed
 * and triggers the fail-closed branch below.
 */
function isWellFormedEnrollment(row: unknown): boolean {
  if (typeof row !== "object" || row === null) {
    return false;
  }
  if (
    !Object.prototype.hasOwnProperty.call(row, "status") ||
    !Object.prototype.hasOwnProperty.call(row, "offeringStatus")
  ) {
    return false;
  }
  const candidate = row as { status: unknown; offeringStatus: unknown };
  return (
    isKnownStatus(KNOWN_ENROLLMENT_STATUSES, candidate.status) &&
    isKnownStatus(KNOWN_OFFERING_STATUSES, candidate.offeringStatus)
  );
}

// ---------------------------------------------------------------------------
// Rule C
// ---------------------------------------------------------------------------

/**
 * Rule C (the approved temporary classification). Activation is blocked when ALL
 * of the following hold:
 *
 *   1. the trainee is currently inactive (isActive === false);
 *   2. NO enrollment is ACTIVE into an ACTIVE offering;
 *   3. at least one enrollment IS ACTIVE into a PLANNED offering.
 *
 * Clause 2 is what keeps ordinary reactivation working: a deactivated trainee who
 * still holds a live enrollment in the running course is never blocked, and a
 * single such enrollment outranks any number of PLANNED ones. Clause 3 is what
 * keeps legacy trainees activatable: no live PLANNED affiliation, no block - so an
 * empty enrollment history, an ARCHIVED-only history and an INACTIVE-only history
 * all stay activatable.
 *
 * DIRECTIONALITY: this is an ACTIVATION guard only. It says nothing about
 * deactivation, which must always remain available for everyone; a caller
 * evaluates this only when turning a trainee ON.
 *
 * MALFORMED INPUT - FAIL CLOSED (explicit runtime contract; the public types
 * already make these unreachable through normal typed use):
 *   - an already-active trainee (isActive === true) returns false, whatever the
 *     rows look like: no activation transition is being attempted, so there is
 *     nothing to block and a malformed row must not manufacture a phantom block;
 *   - a non-boolean isActive means the trainee's own state cannot be trusted, so
 *     the answer is "blocked";
 *   - a non-array enrollments argument, or ANY malformed row while the trainee is
 *     inactive, means the affiliation picture cannot be trusted, so the answer is
 *     "blocked" - even when a well-formed sibling row would otherwise have
 *     cleared the trainee. Fail-closed outranks clearing.
 *   - an ordinary EMPTY list is NOT malformed. It is the legitimate legacy case
 *     and returns false.
 *
 * PURITY: never throws, never mutates (the array is only read, and rows are only
 * read through own-property lookups), and the result is order-independent - the
 * whole list is scanned before deciding, so no early exit can make the answer
 * depend on where a row happened to sit.
 */
export function isStagedTraineeActivationBlocked(
  isActive: boolean,
  enrollments: readonly ActivationEnrollmentInput[],
): boolean {
  // No activation transition is being attempted for an already-active trainee.
  if (isActive === true) {
    return false;
  }
  // Not exactly `false` here means a runtime-malformed active state: fail closed.
  if (isActive !== false) {
    return true;
  }
  if (!Array.isArray(enrollments)) {
    return true;
  }

  let malformed = false;
  let hasActiveEnrollmentInActiveOffering = false;
  let hasActiveEnrollmentInPlannedOffering = false;

  for (const row of enrollments) {
    if (!isWellFormedEnrollment(row)) {
      malformed = true;
      continue;
    }
    if (row.status !== "ACTIVE") {
      continue;
    }
    if (row.offeringStatus === "ACTIVE") {
      hasActiveEnrollmentInActiveOffering = true;
    } else if (row.offeringStatus === "PLANNED") {
      hasActiveEnrollmentInPlannedOffering = true;
    }
  }

  if (malformed) {
    return true;
  }

  return hasActiveEnrollmentInPlannedOffering && !hasActiveEnrollmentInActiveOffering;
}

// ---------------------------------------------------------------------------
// Stable Hebrew strings
// ---------------------------------------------------------------------------

/**
 * The compact row-level label shown beside the existing status chip for a blocked
 * trainee. It is ADDITIVE: the existing active/inactive chip stays exactly as it
 * is, and this only explains why activation is unavailable.
 */
export const STAGED_TRAINEE_ROW_LABEL = "בהכנה לקורס";

/** Help text for the disabled activation control. */
export const STAGED_TRAINEE_ACTIVATION_TOOLTIP =
  "החניך/ה רשום/ה לקורס שנמצא בהכנה וטרם נפתח. הפעלת החשבון תתאפשר רק לאחר פתיחת הקורס ואישור ניהול המערכת.";

/** The stable rejection message a future server action will return. */
export const STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE =
  "לא ניתן להפעיל חשבון של חניך/ה שרשום/ה רק לקורס בהכנה. יש לפנות לניהול המערכת.";
