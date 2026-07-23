/**
 * MULTI-COURSE (enrollment slice E1) - PURE, dependency-injected orchestration
 * for ATOMIC, offering-scoped enrollment of an EXISTING trainee into an
 * EXPLICITLY identified PLANNED CourseOffering.
 *
 * This module is deliberately NOT a "use server" module and imports NO Prisma
 * client: it is a plain, DB-free server-side library, so the entire business
 * contract is unit-testable without a database (see
 * enroll-existing-trainee-core.test.ts). Every impure capability (the four
 * transaction-local reads and the three writes) is passed in via
 * {@link EnrollTxClient}. The thin real-Prisma binding lives in
 * enroll-existing-trainee.ts.
 *
 * WHAT IT DOES (locked slice-E1 contract):
 *   - Enrolls an ALREADY-EXISTING Student into an EXPLICIT CourseOffering id.
 *   - Creates, atomically, exactly TWO rows: CourseEnrollment (status ACTIVE,
 *     isPrimary=false, startDate=offering.startDate) and the initial
 *     GroupMembership into a proven leaf subgroup.
 *   - Uses ONLY the exact offering id supplied by the caller. It NEVER resolves
 *     the ACTIVE singleton (resolveCurrentCourseOffering), NEVER reads a
 *     selected-course cookie, and NEVER selects an offering by name/level/"the
 *     only planned course".
 *
 * NO TraineeHorseAssignment (locked correction): this service deliberately does
 * NOT create, reuse, relink, close, or update any TraineeHorseAssignment row.
 * Horse history is still GLOBALLY keyed and resolved by studentId (unique
 * (studentId, effectiveFrom); the live writer/historical reader require exactly
 * one interval covering a date). Adding a second open-ended Level 2 interval for
 * a dual-enrolled trainee would overlap the existing Level 1 interval and break
 * active Level 1 horse editing and historical horse reads. An empty horse
 * interval is NOT required to create a PLANNED Level 2 enrollment; the
 * per-enrollment horse-history redesign is a separate schema/migration wave.
 *
 * WHAT IT NEVER DOES (locked compatibility rule):
 *   - It NEVER creates or updates a Student row. The {@link EnrollTxClient}
 *     surface has NO student.create / student.update, so the operation is
 *     STRUCTURALLY incapable of touching Student.groupName / subgroupNumber /
 *     isActive / identity / name / phone / horse compatibility fields.
 *   - It NEVER writes the legacy studentId-based TraineeGroupMembership and NEVER
 *     writes a TraineeHorseAssignment.
 *   - For a dual-enrolled trainee, the shared Student compatibility fields keep
 *     representing Level 1; the Level 2 group exists ONLY through
 *     CourseEnrollment -> GroupMembership -> CourseGroup.
 *   - It does NOT reuse createTraineeWithEnrollmentSafe /
 *     createTraineeWithEnrollmentWithDeps / createStudent (those create a Student
 *     and write the compatibility mirrors).
 *
 * TRUST BOUNDARY: this is admin-only infrastructure. It performs NO requireAdmin()
 * itself - the FUTURE server action (a separate slice) MUST call requireAdmin()
 * (and pass an admin-validated route offering id) BEFORE invoking this service.
 *
 * CONCURRENCY (locked correction): a pre-transaction check is NOT sufficient.
 * Every mutable prerequisite is re-read and re-proven INSIDE the SAME interactive
 * transaction that performs the writes (see runEnrollmentCreateInTx). The
 * transaction-local reads are the authoritative proofs; the DB unique constraints
 * are the final backstop.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Public result surface
// ---------------------------------------------------------------------------

/** Stable, non-PII error codes for the enrollment service. */
export type EnrollExistingTraineeErrorCode =
  | "invalid_input"
  | "offering_not_found"
  | "operation_not_allowed"
  | "offering_start_date_missing"
  | "student_not_found"
  | "inactive_student"
  | "invalid_group"
  | "already_enrolled"
  | "unexpected";

/** Discriminated result: the new enrollment id, or a stable non-PII error code. */
export type EnrollExistingTraineeResult =
  | { readonly success: true; readonly enrollmentId: string }
  | { readonly success: false; readonly error: EnrollExistingTraineeErrorCode };

/**
 * The only input this service accepts. Every operational value (status,
 * isPrimary, startDate, effectiveFrom) is SERVER-DERIVED, never accepted from the
 * caller, so there is deliberately no such field here.
 */
export interface EnrollExistingTraineeInput {
  readonly courseOfferingId: string;
  readonly studentId: string;
  readonly courseGroupId: string;
}

// ---------------------------------------------------------------------------
// Transaction-local IO surface (injected)
// ---------------------------------------------------------------------------

/** The narrow offering shape the transaction-local proof needs. */
export interface TxOfferingRow {
  readonly id: string;
  readonly status: CourseOfferingStatus;
  /** @db.Date UTC-midnight start; nullable in schema, proven non-null here. */
  readonly startDate: Date | null;
}

/** The narrow student shape the transaction-local proof needs. */
export interface TxStudentRow {
  readonly id: string;
  readonly isActive: boolean;
}

/** Exact data the single CourseEnrollment write receives (all server-fixed). */
export interface EnrollmentCreateData {
  readonly studentId: string;
  readonly courseOfferingId: string;
  readonly status: "ACTIVE";
  readonly isPrimary: false;
  readonly startDate: Date;
}

/** Exact data the single GroupMembership write receives. */
export interface MembershipCreateData {
  readonly courseEnrollmentId: string;
  readonly courseGroupId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: null;
}

/**
 * The injected transaction-scoped boundary. Every method runs INSIDE the same
 * interactive transaction. There is deliberately NO dependency capable of
 * creating or updating a Student, writing a legacy TraineeGroupMembership,
 * writing a TraineeHorseAssignment, touching another enrollment/membership, or
 * resolving the ACTIVE offering: the operation is structurally incapable of
 * anything but the two additive writes below, each gated by a transaction-local
 * read proof.
 */
export interface EnrollTxClient {
  /** Re-read exactly the target offering (id/status/startDate) or null. */
  findOffering: (courseOfferingId: string) => Promise<TxOfferingRow | null>;
  /** Re-read exactly the target student (id/isActive) or null. */
  findStudent: (studentId: string) => Promise<TxStudentRow | null>;
  /**
   * Compound leaf-ownership proof: returns the group ONLY when its id matches,
   * it belongs to THIS offering, AND it is a subgroup (parentGroupId not null).
   * Returns null for missing / other-offering / top-level groups alike.
   */
  findLeafGroup: (
    courseGroupId: string,
    courseOfferingId: string,
  ) => Promise<{ id: string } | null>;
  /** Re-read whether an enrollment already exists for (studentId, offeringId). */
  findExistingEnrollment: (
    studentId: string,
    courseOfferingId: string,
  ) => Promise<{ id: string } | null>;
  /** SOLE enrollment write. A unique violation here means already_enrolled. */
  createEnrollment: (data: EnrollmentCreateData) => Promise<{ id: string }>;
  /** SOLE membership write. */
  createMembership: (data: MembershipCreateData) => Promise<{ id: string }>;
}

/**
 * Internal signal thrown ONLY when the CourseEnrollment write hits a unique
 * violation (the (studentId, courseOfferingId) constraint - the sole unique that
 * write can violate). It is thrown so the real interactive transaction rolls
 * back all writes, and is mapped to `already_enrolled` by the DI wrapper. It is
 * exported solely so that wrapper can `instanceof`-match it across the module
 * boundary; it is not part of the public success/error surface.
 */
export class AlreadyEnrolledError extends Error {
  constructor() {
    super("A CourseEnrollment already exists for this student and offering.");
    this.name = "AlreadyEnrolledError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True only for a Prisma unique-constraint violation (P2002), structurally. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** The normalized, non-empty input, or an invalid_input rejection. */
export type NormalizedEnrollInput =
  | { readonly ok: true; readonly value: EnrollExistingTraineeInput }
  | { readonly ok: false };

/**
 * Trim and require all three identifiers to be non-empty strings. cuids never
 * carry whitespace, so a trimmed non-empty string is the accepted shape; any
 * missing / blank / whitespace-only value is rejected as invalid_input before a
 * transaction is ever opened.
 */
export function normalizeEnrollInput(input: EnrollExistingTraineeInput): NormalizedEnrollInput {
  const norm = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  };
  const courseOfferingId = norm(input?.courseOfferingId);
  const studentId = norm(input?.studentId);
  const courseGroupId = norm(input?.courseGroupId);
  if (courseOfferingId === null || studentId === null || courseGroupId === null) {
    return { ok: false };
  }
  return { ok: true, value: { courseOfferingId, studentId, courseGroupId } };
}

/**
 * Classify a re-read offering for enrollment (pure). Slice E1 allows PLANNED
 * ONLY (ACTIVE is intentionally rejected here even though the broader dormant
 * lifecycle policy permits it); ARCHIVED and every other status are blocked. A
 * PLANNED offering with no startDate cannot supply the required effective date.
 * Order matches the error-precedence contract: status before startDate.
 */
export type OfferingEnrollClassification =
  | { readonly ok: true; readonly startDate: Date }
  | {
      readonly ok: false;
      readonly error: "operation_not_allowed" | "offering_start_date_missing";
    };

export function classifyOfferingForEnroll(
  status: CourseOfferingStatus,
  startDate: Date | null,
): OfferingEnrollClassification {
  if (status !== "PLANNED") {
    return { ok: false, error: "operation_not_allowed" };
  }
  if (startDate === null) {
    return { ok: false, error: "offering_start_date_missing" };
  }
  return { ok: true, startDate };
}

// ---------------------------------------------------------------------------
// Transaction body (DB-free via injected EnrollTxClient)
// ---------------------------------------------------------------------------

const fail = (
  error: Exclude<EnrollExistingTraineeErrorCode, "unexpected" | "invalid_input">,
): EnrollExistingTraineeResult => ({ success: false, error });

/**
 * The full transaction body: transaction-local proofs THEN the three writes, in
 * a fixed order. Run inside ONE interactive transaction by the caller.
 *
 * Proof order (each returns a stable error BEFORE any write, so an early exit
 * leaves zero rows - the empty transaction simply commits nothing):
 *   1. re-read the exact offering            -> offering_not_found
 *   2. status must still be PLANNED          -> operation_not_allowed
 *      (and startDate must still be present) -> offering_start_date_missing
 *   3. re-read the exact student             -> student_not_found
 *   4. student must still be isActive===true -> inactive_student
 *   5. compound leaf-ownership proof         -> invalid_group
 *   6. no enrollment may already exist       -> already_enrolled
 *
 * Write order (each after the previous id exists; any THROW aborts the whole
 * transaction so no partial rows survive):
 *   7. CourseEnrollment  (a unique violation -> throw AlreadyEnrolledError, which
 *      the DI wrapper maps to already_enrolled after the transaction rolls back)
 *   8. GroupMembership into the proven leaf subgroup
 *
 * Both dates are the SAME offering.startDate, so enrollment.startDate and
 * membership.effectiveFrom never disagree. NO TraineeHorseAssignment is written
 * (see the module header): a second open-ended Level 2 horse interval would
 * overlap the trainee's existing Level 1 interval and break live Level 1 horse
 * paths that resolve exactly one interval per studentId.
 */
export async function runEnrollmentCreateInTx(
  tx: EnrollTxClient,
  input: EnrollExistingTraineeInput,
): Promise<EnrollExistingTraineeResult> {
  // 1. Offering re-read (authoritative, transaction-local).
  const offering = await tx.findOffering(input.courseOfferingId);
  if (offering === null) {
    return fail("offering_not_found");
  }

  // 2. Lifecycle + effective-date source, re-proven at write time.
  const classified = classifyOfferingForEnroll(offering.status, offering.startDate);
  if (!classified.ok) {
    return fail(classified.error);
  }
  const effectiveDate = classified.startDate;

  // 3-4. Student re-read + still-active proof.
  const student = await tx.findStudent(input.studentId);
  if (student === null) {
    return fail("student_not_found");
  }
  if (student.isActive !== true) {
    return fail("inactive_student");
  }

  // 5. Compound leaf-ownership proof (id AND this offering AND subgroup).
  const group = await tx.findLeafGroup(input.courseGroupId, offering.id);
  if (group === null) {
    return fail("invalid_group");
  }

  // 6. No pre-existing enrollment for this (student, offering).
  const existing = await tx.findExistingEnrollment(student.id, offering.id);
  if (existing !== null) {
    return fail("already_enrolled");
  }

  // 7. Enrollment write. The ONLY unique this create can violate is
  //    (studentId, courseOfferingId): a P2002 here is a concurrent duplicate, so
  //    throw the sentinel to roll the transaction back and surface already_enrolled.
  let enrollment: { id: string };
  try {
    enrollment = await tx.createEnrollment({
      studentId: student.id,
      courseOfferingId: offering.id,
      status: "ACTIVE",
      isPrimary: false,
      startDate: effectiveDate,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new AlreadyEnrolledError();
    }
    throw error;
  }

  // 8. Initial membership into the proven leaf subgroup.
  await tx.createMembership({
    courseEnrollmentId: enrollment.id,
    courseGroupId: group.id,
    effectiveFrom: effectiveDate,
    effectiveTo: null,
  });

  return { success: true, enrollmentId: enrollment.id };
}
