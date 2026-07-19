/**
 * Reusable effective-dated write service for trainee HORSE assignments
 * (Stage GH2A1; ENROLLMENT-SCOPED in Stage MULTI-COURSE W8A-5).
 *
 * Thin domain wrapper over the shared engine in ./apply-plan: it supplies the
 * horse `DomainWriteAdapter` (TraineeHorseAssignment delegate wiring + Student
 * horse cache), plugs normalize-horse into the engine's pre-transaction step,
 * delegates field-level enforcement to enforceHorseFieldPolicy, and exposes the
 * public `writeTraineeHorseAssignment` API. It adds no UI and no auth, and never
 * touches the Prisma schema.
 *
 * W8A-5 ENROLLMENT SCOPING (this stage): the admin writer now maintains a single
 * atomic transaction across THREE aligned sources for the current offering:
 *   1. TraineeHorseAssignment history scoped by `courseEnrollmentId`;
 *   2. the CourseEnrollment horse cache;
 *   3. the Student compatibility horse cache (a TEMPORARY mirror, kept in sync).
 *
 * The adapter is now built PER CALL by {@link createHorseAdapter} so the resolved
 * enrollment id and every per-transaction datum live in a per-invocation closure
 * (NEVER module-level mutable state). Two concurrent writes for two trainees each
 * get their own adapter instance and therefore share nothing.
 *
 * FAIL CLOSED: after locking the Student the adapter resolves the exact
 * CourseEnrollment by the unique (studentId, courseOfferingId) key, requires it
 * ACTIVE, and asserts the full three-way pre-write invariant (exactly one current
 * history interval linked to that enrollment, canonical, and equal to both
 * caches) BEFORE any change. The same consistency assertion runs again on the
 * post-apply re-read, giving the three-way post-write verification; any anomaly
 * throws and rolls back the whole transaction. Anomalies are never silently
 * repaired. The engine, the GH1A primitives, and the Prisma schema are consumed
 * UNCHANGED (no second transaction, no new lock).
 */

import { Prisma } from "@/app/generated/prisma/client";
import { compareDateKeys } from "./interval-resolver";
import type { DateKey, IntervalRow } from "./interval-resolver";
import { normalizeHorse, type NormalizedHorse } from "./normalize-horse";
import { israelDateKeyFromInstant, utcMidnightToDateKey } from "./israel-date";
import {
  enforceHorseFieldPolicy,
  runEffectiveDatedWrite,
  TraineeHistoryTxError,
  type DomainWriteAdapter,
  type PublicErrorCode,
  type WriteOutcome,
  type WritePolicy,
} from "./apply-plan";

/** The horse cache/history value: the three canonical horse cache fields. */
interface HorseValue {
  assignedHorseName: string | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
}

/** Half-open coverage test (effectiveFrom inclusive, effectiveTo exclusive). */
function covers(row: { effectiveFrom: DateKey; effectiveTo: DateKey | null }, date: DateKey): boolean {
  const startsOnOrBeforeDate = compareDateKeys(row.effectiveFrom, date) <= 0;
  const endsAfterDate = row.effectiveTo === null || compareDateKeys(date, row.effectiveTo) < 0;
  return startsOnOrBeforeDate && endsAfterDate;
}

/** Canonicalize a horse triple via the shared normalizer; null when noncanonical. */
function normalizedOrNull(triple: {
  assignedHorseName: string | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
}): NormalizedHorse | null {
  const result = normalizeHorse(triple);
  return result.ok ? result.value : null;
}

/** Strict field equality of two already-canonical horse values. */
function sameNormalized(a: NormalizedHorse, b: NormalizedHorse): boolean {
  return (
    a.assignedHorseName === b.assignedHorseName &&
    a.hasPrivateHorse === b.hasPrivateHorse &&
    a.privateHorseName === b.privateHorseName
  );
}

/** A raw history row carrying its enrollment link for the consistency check. */
interface RawHorseHistoryRow {
  id: string;
  courseEnrollmentId: string | null;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
  value: HorseValue;
}

/**
 * Build a FRESH horse adapter for a single service invocation.
 *
 * All per-transaction state (the resolved enrollment id, the derived Israel-local
 * `today`) is captured in this closure — there is NO module-level mutable state,
 * so concurrent writes for two trainees never share an enrollment id or any other
 * per-call datum. `now` is the trusted explicit instant supplied by the caller;
 * `today` is derived from it with the same pure helper the engine uses, so the
 * adapter and the engine always agree on today.
 */
export function createHorseAdapter(opts: {
  courseOfferingId: string;
  now: Date;
}): DomainWriteAdapter<HorseValue> {
  const { courseOfferingId } = opts;
  const today = israelDateKeyFromInstant(opts.now);

  // Per-invocation, per-transaction only. Set when the locked Student's exact
  // enrollment is first resolved; never shared across service calls.
  let resolvedEnrollmentId: string | null = null;

  async function readRawHistory(
    tx: Prisma.TransactionClient,
    studentId: string,
  ): Promise<RawHorseHistoryRow[]> {
    const rows = await tx.traineeHorseAssignment.findMany({
      where: { studentId },
      select: {
        id: true,
        courseEnrollmentId: true,
        assignedHorseName: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
      orderBy: { effectiveFrom: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      courseEnrollmentId: row.courseEnrollmentId,
      effectiveFrom: utcMidnightToDateKey(row.effectiveFrom),
      effectiveTo: row.effectiveTo === null ? null : utcMidnightToDateKey(row.effectiveTo),
      value: {
        assignedHorseName: row.assignedHorseName,
        hasPrivateHorse: row.hasPrivateHorse,
        privateHorseName: row.privateHorseName,
      },
    }));
  }

  /**
   * Assert the full three-way horse consistency for the current-offering
   * enrollment, using freshly-read enrollment + Student caches (never a stale
   * closure snapshot). This SAME assertion is valid both BEFORE the change (all
   * three sources equal the current value) and AFTER it (all three equal the new
   * value), so the engine's two `loadHistory` calls give the pre-write invariant
   * check and the three-way post-write verification from one function. Fails
   * closed — it never repairs an anomaly.
   */
  async function assertEnrollmentHorseConsistency(
    tx: Prisma.TransactionClient,
    studentId: string,
    rawRows: readonly RawHorseHistoryRow[],
  ): Promise<void> {
    const enrollment = await tx.courseEnrollment.findUnique({
      where: { studentId_courseOfferingId: { studentId, courseOfferingId } },
      select: {
        id: true,
        status: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        assignedHorseName: true,
      },
    });
    if (!enrollment) {
      throw new TraineeHistoryTxError("TRAINEE_NOT_FOUND");
    }
    if (enrollment.status !== "ACTIVE") {
      throw new TraineeHistoryTxError("TRAINEE_INACTIVE");
    }
    // Defensive: the enrollment resolved here must be the one captured at lock
    // time; a divergence would mean a mid-transaction identity change.
    if (resolvedEnrollmentId !== null && enrollment.id !== resolvedEnrollmentId) {
      throw new TraineeHistoryTxError("TRANSACTION_FAILURE");
    }

    const student = await tx.student.findUnique({
      where: { id: studentId },
      select: { hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    });
    if (!student) {
      throw new TraineeHistoryTxError("TRAINEE_NOT_FOUND");
    }

    // Exactly one history interval must be current at today.
    const covering = rawRows.filter((row) => covers(row, today));
    if (covering.length !== 1) {
      // Zero (missing / not seeded) OR multiple current intervals: both are
      // integrity anomalies and must fail closed (never a first-write path).
      throw new TraineeHistoryTxError("INTERVAL_INVARIANT_FAILURE");
    }
    const current = covering[0];

    // The current interval must be linked to the resolved enrollment. A wrong or
    // null link fails closed rather than being silently corrected.
    if (current.courseEnrollmentId !== enrollment.id) {
      throw new TraineeHistoryTxError("INTERVAL_INVARIANT_FAILURE");
    }

    // The current interval must be a canonical horse state (it is the authority).
    const historyHorse = normalizedOrNull(current.value);
    if (historyHorse === null) {
      throw new TraineeHistoryTxError("INVALID_HORSE_STATE");
    }

    // Both caches must be canonical and equal to the history value and to each
    // other (three-way parity).
    const enrollmentHorse = normalizedOrNull(enrollment);
    const studentHorse = normalizedOrNull(student);
    if (enrollmentHorse === null || studentHorse === null) {
      throw new TraineeHistoryTxError("CACHE_MISMATCH");
    }
    if (!sameNormalized(historyHorse, enrollmentHorse)) {
      throw new TraineeHistoryTxError("CACHE_MISMATCH");
    }
    if (!sameNormalized(historyHorse, studentHorse)) {
      throw new TraineeHistoryTxError("CACHE_MISMATCH");
    }
    if (!sameNormalized(enrollmentHorse, studentHorse)) {
      throw new TraineeHistoryTxError("CACHE_MISMATCH");
    }
  }

  return {
    domain: "horse",
    emptyValue: { assignedHorseName: null, hasPrivateHorse: false, privateHorseName: null },
    valuesEqual(a, b) {
      return (
        a.assignedHorseName === b.assignedHorseName &&
        a.hasPrivateHorse === b.hasPrivateHorse &&
        a.privateHorseName === b.privateHorseName
      );
    },
    enforceFieldPolicy(policy, lockedCache, requested) {
      return enforceHorseFieldPolicy(policy, lockedCache, requested);
    },
    async readLockedStudent(tx, studentId) {
      const student = await tx.student.findUnique({
        where: { id: studentId },
        select: {
          isActive: true,
          assignedHorseName: true,
          hasPrivateHorse: true,
          privateHorseName: true,
        },
      });
      if (!student) {
        return null;
      }
      // Resolve the exact current-offering enrollment by the unique compound key
      // (never by horse name, Student cache, first enrollment, isPrimary, or
      // ordering) and require it ACTIVE. Student.isActive is kept as a separate
      // compatibility guard (enforced by the engine on the returned isActive),
      // NOT a substitute for enrollment status.
      const enrollment = await tx.courseEnrollment.findUnique({
        where: { studentId_courseOfferingId: { studentId, courseOfferingId } },
        select: { id: true, status: true },
      });
      if (!enrollment) {
        throw new TraineeHistoryTxError("TRAINEE_NOT_FOUND");
      }
      if (enrollment.status !== "ACTIVE") {
        throw new TraineeHistoryTxError("TRAINEE_INACTIVE");
      }
      resolvedEnrollmentId = enrollment.id;
      return {
        isActive: student.isActive,
        cache: {
          assignedHorseName: student.assignedHorseName,
          hasPrivateHorse: student.hasPrivateHorse,
          privateHorseName: student.privateHorseName,
        },
      };
    },
    async loadHistory(tx, studentId) {
      const rawRows = await readRawHistory(tx, studentId);
      // Runs on BOTH engine loads: the first is the pre-write invariant check,
      // the re-read is the three-way post-write verification.
      await assertEnrollmentHorseConsistency(tx, studentId, rawRows);
      return rawRows.map(
        (row): IntervalRow<HorseValue> => ({
          id: row.id,
          effectiveFrom: row.effectiveFrom,
          effectiveTo: row.effectiveTo,
          value: row.value,
        }),
      );
    },
    async insertRow(tx, studentId, effectiveFrom, effectiveTo, value) {
      if (resolvedEnrollmentId === null) {
        // Unreachable: readLockedStudent always resolves the enrollment first.
        throw new TraineeHistoryTxError("TRANSACTION_FAILURE");
      }
      await tx.traineeHorseAssignment.create({
        data: {
          studentId,
          courseEnrollmentId: resolvedEnrollmentId,
          assignedHorseName: value.assignedHorseName,
          hasPrivateHorse: value.hasPrivateHorse,
          privateHorseName: value.privateHorseName,
          effectiveFrom,
          effectiveTo,
        },
      });
    },
    async updateRow(tx, id, effectiveTo, value) {
      // Deliberately does NOT touch courseEnrollmentId: an existing row's link is
      // preserved on same-day corrections and on close-and-open boundary updates.
      await tx.traineeHorseAssignment.update({
        where: { id },
        data: {
          assignedHorseName: value.assignedHorseName,
          hasPrivateHorse: value.hasPrivateHorse,
          privateHorseName: value.privateHorseName,
          effectiveTo,
        },
      });
    },
    async updateStudentCache(tx, studentId, value) {
      if (resolvedEnrollmentId === null) {
        // Unreachable: readLockedStudent always resolves the enrollment first.
        throw new TraineeHistoryTxError("TRANSACTION_FAILURE");
      }
      // Update the Student compatibility mirror AND the CourseEnrollment cache
      // within the same transaction, with the identical normalized value. The
      // Student update is retained (temporary mirror) and never removed.
      await tx.student.update({
        where: { id: studentId },
        data: {
          assignedHorseName: value.assignedHorseName,
          hasPrivateHorse: value.hasPrivateHorse,
          privateHorseName: value.privateHorseName,
        },
      });
      await tx.courseEnrollment.update({
        where: { id: resolvedEnrollmentId },
        data: {
          assignedHorseName: value.assignedHorseName,
          hasPrivateHorse: value.hasPrivateHorse,
          privateHorseName: value.privateHorseName,
        },
      });
    },
  };
}

/**
 * Write a trainee horse assignment effective from `input.effectiveFrom`, scoped
 * to the trusted, server-resolved current offering.
 *
 * `input.courseOfferingId` is supplied by the trusted admin action (never
 * client-controlled); the service resolves the exact CourseEnrollment from
 * (studentId, courseOfferingId). `now` is a trusted explicit instant; the
 * service derives Israel-local today from it (no hidden clock). The result never
 * carries history rows, Prisma records, or ids.
 */
export function writeTraineeHorseAssignment(
  input: {
    studentId: string;
    courseOfferingId: string;
    effectiveFrom: DateKey;
    assignedHorseName: string | null;
    hasPrivateHorse: boolean;
    privateHorseName: string | null;
  },
  policy: WritePolicy,
  now: Date,
): Promise<WriteOutcome> {
  return runEffectiveDatedWrite<HorseValue>({
    domain: "horse",
    studentId: input.studentId,
    effectiveFrom: input.effectiveFrom,
    policy,
    now,
    normalize: (): { ok: true; value: HorseValue } | { ok: false; code: PublicErrorCode } => {
      const result = normalizeHorse({
        assignedHorseName: input.assignedHorseName,
        hasPrivateHorse: input.hasPrivateHorse,
        privateHorseName: input.privateHorseName,
      });
      return result.ok ? { ok: true, value: result.value } : { ok: false, code: result.code };
    },
    adapter: createHorseAdapter({ courseOfferingId: input.courseOfferingId, now }),
  });
}
