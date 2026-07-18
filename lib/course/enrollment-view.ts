/**
 * MULTI-COURSE W5B0 - PURE enrollment-to-legacy-view mapping, current-membership
 * resolution, deterministic ordering, and roster parity comparison.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness. Every
 * function takes plain data (including an explicit `asOf` where time matters)
 * and returns plain data, so the entire mapping/ordering/parity contract is
 * unit-testable without a database (see enrollment-view.test.ts).
 *
 * INTERVAL CONVENTION (single, explicit, used everywhere here):
 *   [effectiveFrom, effectiveTo)  -- effectiveFrom INCLUSIVE, effectiveTo
 *   EXCLUSIVE, null effectiveTo = open-ended. A membership is "current at asOf"
 *   iff effectiveFrom <= asOf AND (effectiveTo IS NULL OR effectiveTo > asOf).
 *   A null effectiveTo alone does NOT make a row current - effectiveFrom is
 *   always checked, so a future open-ended membership is not treated as current.
 *
 * This module maps offering-scoped spine rows onto the SAME shape the legacy
 * Student contact directory exposes (groupName/subgroupNumber), so a later pilot
 * can swap sources without changing its output. It is NOT wired into runtime in
 * this stage.
 */
import type { CourseEnrollmentStatus } from "@/app/generated/prisma/client";

/** Stable trainee view, shaped for the later getStudentContacts pilot. */
export interface EnrolledTraineeView {
  id: string; // studentId (the global person identity)
  fullName: string;
  lastName: string;
  phone: string | null;
  groupName: string | null;
  subgroupNumber: number | null;
  enrollmentStatus: CourseEnrollmentStatus;
  isPrimary: boolean;
}

export type EnrollmentMembershipAnomalyKind =
  | "NO_CURRENT_MEMBERSHIP"
  | "MULTIPLE_CURRENT_MEMBERSHIPS"
  | "MALFORMED_SUBGROUP"
  | "MISSING_PARENT_GROUP";

/** Safe-identifier-only anomaly record (never contains PII or raw errors). */
export interface EnrollmentMembershipAnomaly {
  enrollmentId: string;
  studentId: string;
  kind: EnrollmentMembershipAnomalyKind;
  /** Number of memberships found current at asOf (0, or the count when >1). */
  currentMembershipCount: number;
}

/** A CourseGroup as fetched for a membership (nested parent, Prisma shape). */
export interface RawMembershipGroup {
  name: string;
  parentGroupId: string | null;
  parentGroup: { name: string } | null;
}

/** One GroupMembership row with its dated interval and target group. */
export interface RawMembership {
  effectiveFrom: Date;
  effectiveTo: Date | null;
  courseGroup: RawMembershipGroup;
}

/** One ACTIVE CourseEnrollment with its student and all memberships. */
export interface RawEnrollment {
  id: string;
  status: CourseEnrollmentStatus;
  isPrimary: boolean;
  student: { id: string; fullName: string; lastName: string; phone: string | null };
  memberships: RawMembership[];
}

/** The batch result: mapped rows plus every explicitly-surfaced anomaly. */
export interface EnrollmentRosterResult {
  rows: EnrolledTraineeView[];
  anomalies: EnrollmentMembershipAnomaly[];
}

/**
 * Half-open interval test: is this membership current at `asOf`?
 * effectiveFrom inclusive, effectiveTo exclusive, null effectiveTo open-ended.
 */
export function isMembershipCurrentAt(
  interval: { effectiveFrom: Date; effectiveTo: Date | null },
  asOf: Date,
): boolean {
  const at = asOf.getTime();
  if (interval.effectiveFrom.getTime() > at) return false; // not started yet
  if (interval.effectiveTo === null) return true; // open-ended and started
  return interval.effectiveTo.getTime() > at; // exclusive upper bound
}

export type SubgroupParse = { ok: true; value: number } | { ok: false };

/**
 * Parse a subgroup CourseGroup name into a positive subgroup number. Accepts
 * ONLY a canonical positive-integer decimal string (no sign, no leading zero,
 * no decimal, no whitespace) - matching the backfill's `String(int)` output.
 * Blank, "0", negatives, decimals, and any non-canonical form are rejected
 * (never silently coerced to null).
 */
export function parseSubgroupName(name: string): SubgroupParse {
  if (!/^[1-9][0-9]*$/.test(name)) return { ok: false };
  const value = Number(name);
  if (!Number.isInteger(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

export type GroupResolution =
  | { ok: true; groupName: string; subgroupNumber: number | null }
  | { ok: false; kind: "MALFORMED_SUBGROUP" | "MISSING_PARENT_GROUP" };

/**
 * Map a membership's target CourseGroup onto the legacy (groupName,
 * subgroupNumber) pair.
 *  - top-level group (parentGroupId === null): groupName = group.name, subgroup = null
 *  - subgroup (parentGroupId set): groupName = parentGroup.name, subgroup = parsed group.name
 * A subgroup whose parent is missing, or whose name is not a canonical positive
 * integer, is reported (never repaired).
 */
export function resolveGroupFromMembership(group: RawMembershipGroup): GroupResolution {
  if (group.parentGroupId === null) {
    return { ok: true, groupName: group.name, subgroupNumber: null };
  }
  if (group.parentGroup === null) {
    return { ok: false, kind: "MISSING_PARENT_GROUP" };
  }
  const parsed = parseSubgroupName(group.name);
  if (!parsed.ok) {
    return { ok: false, kind: "MALFORMED_SUBGROUP" };
  }
  return { ok: true, groupName: group.parentGroup.name, subgroupNumber: parsed.value };
}

export type EnrollmentClassification =
  | { ok: true; view: EnrolledTraineeView }
  | { ok: false; anomaly: EnrollmentMembershipAnomaly };

function makeAnomaly(
  enrollment: RawEnrollment,
  kind: EnrollmentMembershipAnomalyKind,
  currentMembershipCount: number,
): EnrollmentMembershipAnomaly {
  return {
    enrollmentId: enrollment.id,
    studentId: enrollment.student.id,
    kind,
    currentMembershipCount,
  };
}

/**
 * Classify one enrollment at `asOf`: it must have EXACTLY ONE membership current
 * at asOf. Zero -> NO_CURRENT_MEMBERSHIP anomaly; more than one ->
 * MULTIPLE_CURRENT_MEMBERSHIPS anomaly. Never picks the first/newest/arbitrary
 * membership. A single current membership whose group cannot be mapped becomes a
 * MALFORMED_SUBGROUP / MISSING_PARENT_GROUP anomaly.
 */
export function classifyEnrollment(
  enrollment: RawEnrollment,
  asOf: Date,
): EnrollmentClassification {
  const current = enrollment.memberships.filter((m) => isMembershipCurrentAt(m, asOf));
  if (current.length === 0) {
    return { ok: false, anomaly: makeAnomaly(enrollment, "NO_CURRENT_MEMBERSHIP", 0) };
  }
  if (current.length > 1) {
    return {
      ok: false,
      anomaly: makeAnomaly(enrollment, "MULTIPLE_CURRENT_MEMBERSHIPS", current.length),
    };
  }
  const resolution = resolveGroupFromMembership(current[0].courseGroup);
  if (!resolution.ok) {
    return { ok: false, anomaly: makeAnomaly(enrollment, resolution.kind, 1) };
  }
  return {
    ok: true,
    view: {
      id: enrollment.student.id,
      fullName: enrollment.student.fullName,
      lastName: enrollment.student.lastName,
      phone: enrollment.student.phone,
      groupName: resolution.groupName,
      subgroupNumber: resolution.subgroupNumber,
      enrollmentStatus: enrollment.status,
      isPrimary: enrollment.isPrimary,
    },
  };
}

/**
 * Build the roster from ACTIVE enrollments at `asOf`: map the valid ones and
 * collect anomalies separately, then sort the valid rows deterministically.
 */
export function buildEnrollmentRoster(
  enrollments: readonly RawEnrollment[],
  asOf: Date,
): EnrollmentRosterResult {
  const rows: EnrolledTraineeView[] = [];
  const anomalies: EnrollmentMembershipAnomaly[] = [];
  for (const enrollment of enrollments) {
    const classified = classifyEnrollment(enrollment, asOf);
    if (classified.ok) rows.push(classified.view);
    else anomalies.push(classified.anomaly);
  }
  rows.sort(compareTraineeView);
  return { rows, anomalies };
}

// --- Deterministic ordering -------------------------------------------------
//
// Reproduces the legacy contact-directory ordering:
//   1. groupName ascending (Hebrew-aware, "he")
//   2. subgroupNumber ascending, NULLS LAST (mirrors Postgres `ASC` default,
//      which the legacy `orderBy: subgroupNumber asc` relies on)
//   3. lastName ascending (Hebrew-aware, "he")
//   4. student id ascending (deterministic final tie-breaker)
// Uses localeCompare("he"), consistent with the app's other Hebrew sorts
// (lib/actions/horse-feeding.ts, lib/actions/parent-signatures.ts), so ordering
// never depends on incidental JS-engine ordering.

const HE_LOCALE = "he";

function compareGroupName(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last (Postgres ASC default)
  if (b === null) return -1;
  return a.localeCompare(b, HE_LOCALE);
}

function compareSubgroupNumber(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1; // nulls last (Postgres ASC default)
  if (b === null) return -1;
  return a - b;
}

function compareId(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function compareTraineeView(a: EnrolledTraineeView, b: EnrolledTraineeView): number {
  return (
    compareGroupName(a.groupName, b.groupName) ||
    compareSubgroupNumber(a.subgroupNumber, b.subgroupNumber) ||
    a.lastName.localeCompare(b.lastName, HE_LOCALE) ||
    compareId(a.id, b.id)
  );
}

// --- Roster parity comparison (pure) ----------------------------------------

/** The legacy roster shape, as read from Student where isActive=true. */
export interface LegacyRosterRow {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
  lastName: string;
}

/** A structured, PII-free parity report between the two roster sources. */
export interface RosterParityReport {
  ok: boolean;
  legacyCount: number;
  enrollmentCount: number;
  anomalyCount: number;
  primaryCount: number;
  /** ids present in the legacy roster but missing from the enrollment roster. */
  missingFromEnrollment: string[];
  /** ids present in the enrollment roster but absent from the legacy roster. */
  extraInEnrollment: string[];
  duplicateLegacyIds: string[];
  duplicateEnrollmentIds: string[];
  groupMismatches: string[];
  subgroupMismatches: string[];
  /** enrollment rows whose status is not ACTIVE (should never happen). */
  statusMismatches: string[];
  orderMismatch: boolean;
  /** index of the first ordering divergence, or null when order matches. */
  orderFirstDivergenceIndex: number | null;
}

/**
 * Compare the legacy Student roster against the enrollment-backed roster. PURE:
 * no IO. `ok` is true only when the two sources agree on count, id set, group,
 * subgroup, status, and ordering AND there are no membership anomalies. Every
 * reported detail is a safe internal id (never phone/identityNumber).
 */
export function compareRosters(
  legacy: readonly LegacyRosterRow[],
  enrollment: EnrollmentRosterResult,
): RosterParityReport {
  const enrollmentRows = enrollment.rows;

  const legacyById = new Map<string, LegacyRosterRow>();
  const duplicateLegacyIds: string[] = [];
  for (const row of legacy) {
    if (legacyById.has(row.id)) duplicateLegacyIds.push(row.id);
    else legacyById.set(row.id, row);
  }

  const enrollmentById = new Map<string, EnrolledTraineeView>();
  const duplicateEnrollmentIds: string[] = [];
  for (const row of enrollmentRows) {
    if (enrollmentById.has(row.id)) duplicateEnrollmentIds.push(row.id);
    else enrollmentById.set(row.id, row);
  }

  const missingFromEnrollment: string[] = [];
  for (const id of legacyById.keys()) {
    if (!enrollmentById.has(id)) missingFromEnrollment.push(id);
  }
  const extraInEnrollment: string[] = [];
  for (const id of enrollmentById.keys()) {
    if (!legacyById.has(id)) extraInEnrollment.push(id);
  }

  const groupMismatches: string[] = [];
  const subgroupMismatches: string[] = [];
  const statusMismatches: string[] = [];
  for (const [id, enrolled] of enrollmentById) {
    const legacyRow = legacyById.get(id);
    if (!legacyRow) continue; // reported via extraInEnrollment
    if ((legacyRow.groupName ?? null) !== (enrolled.groupName ?? null)) {
      groupMismatches.push(id);
    }
    if ((legacyRow.subgroupNumber ?? null) !== (enrolled.subgroupNumber ?? null)) {
      subgroupMismatches.push(id);
    }
    if (enrolled.enrollmentStatus !== "ACTIVE") {
      statusMismatches.push(id);
    }
  }

  let orderMismatch = false;
  let orderFirstDivergenceIndex: number | null = null;
  const compared = Math.min(legacy.length, enrollmentRows.length);
  for (let i = 0; i < compared; i++) {
    if (legacy[i].id !== enrollmentRows[i].id) {
      orderMismatch = true;
      orderFirstDivergenceIndex = i;
      break;
    }
  }
  if (!orderMismatch && legacy.length !== enrollmentRows.length) {
    orderMismatch = true;
    orderFirstDivergenceIndex = compared;
  }

  const primaryCount = enrollmentRows.filter((row) => row.isPrimary).length;
  const anomalyCount = enrollment.anomalies.length;

  // `ok` is the HARD data-parity verdict and deliberately EXCLUDES orderMismatch.
  // Legacy ordering comes from PostgreSQL collation while the enrollment roster
  // is ordered by JavaScript localeCompare("he"); the two engines are not
  // guaranteed to produce identical Hebrew ordering, so a collation-only
  // difference must NOT classify otherwise-correct course data as corrupt.
  // orderMismatch / orderFirstDivergenceIndex are still computed and returned as
  // a separate observation for human review.
  const ok =
    legacy.length === enrollmentRows.length &&
    missingFromEnrollment.length === 0 &&
    extraInEnrollment.length === 0 &&
    duplicateLegacyIds.length === 0 &&
    duplicateEnrollmentIds.length === 0 &&
    groupMismatches.length === 0 &&
    subgroupMismatches.length === 0 &&
    statusMismatches.length === 0 &&
    anomalyCount === 0;

  return {
    ok,
    legacyCount: legacy.length,
    enrollmentCount: enrollmentRows.length,
    anomalyCount,
    primaryCount,
    missingFromEnrollment,
    extraInEnrollment,
    duplicateLegacyIds,
    duplicateEnrollmentIds,
    groupMismatches,
    subgroupMismatches,
    statusMismatches,
    orderMismatch,
    orderFirstDivergenceIndex,
  };
}
