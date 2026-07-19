/**
 * MULTI-COURSE W8A-2 - PURE planning/classification for the enrollment-scoped
 * horse backfill (scripts/backfill-horse-enrollment.ts and its guarded apply).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no
 * environment access, no top-level execution. Every function takes plain data
 * and returns plain data, so the full matching / interval-resolution / cache
 * contract is unit-testable without a database (see
 * horse-enrollment-backfill-plan.test.ts). The runner scripts own all I/O,
 * connection handling, and writes; this module only decides WHAT the target
 * rows are and REPORTS (never repairs) every anomaly.
 *
 * WHAT THE BACKFILL DOES (W8A-2 goal):
 *  1. Link each existing TraineeHorseAssignment to the Student's single
 *     CourseEnrollment in the current CourseOffering (the FK courseEnrollmentId,
 *     added but unpopulated by W8A-1).
 *  2. Populate the three CourseEnrollment horse cache fields
 *     (hasPrivateHorse/privateHorseName/assignedHorseName) from the horse
 *     assignment interval that is CURRENT at a single captured asOf date.
 *
 * NON-GOALS / INVARIANTS (locked by the W8A-2 brief):
 *  - Never create/delete history rows, never change effectiveFrom/effectiveTo,
 *    studentId, or the horse values ON a TraineeHorseAssignment.
 *  - Never modify Student horse fields. Student is the runtime compatibility
 *    source; it is NEVER the cache authority here - the resolved current horse
 *    HISTORY interval is the only source of the enrollment cache values.
 *  - Never overwrite a non-null courseEnrollmentId that points elsewhere.
 *  - Fail CLOSED: any anomaly at all makes the plan un-appliable.
 *
 * INTERVAL MODEL: identical half-open semantics to
 * lib/trainee-history/interval-resolver (effectiveFrom inclusive, effectiveTo
 * exclusive, null effectiveTo = open-ended). This module counts ALL covering
 * rows itself - resolveIntervalAtDate returns only the first match and cannot
 * surface a multiple-current anomaly, which this backfill must fail closed on.
 *
 * HORSE NORMALIZATION: the current interval's horse value is collapsed into one
 * of the four canonical states via lib/trainee-history/normalize-horse; a
 * noncanonical value is an INVALID_HORSE_STATE anomaly, never silently coerced.
 */

import {
  assertValidDateKey,
  compareDateKeys,
  type DateKey,
} from "../trainee-history/interval-resolver";
import { normalizeHorse, type NormalizedHorse } from "../trainee-history/normalize-horse";

/** The subset of TraineeHorseAssignment columns this backfill reads. */
export interface HorseAssignmentInput {
  id: string;
  studentId: string;
  /** Current FK value: null = unpopulated (W8A-1), a string = already linked. */
  courseEnrollmentId: string | null;
  assignedHorseName: string | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  effectiveFrom: DateKey;
  effectiveTo: DateKey | null;
}

/** The subset of CourseEnrollment columns this backfill reads (current offering). */
export interface EnrollmentInput {
  id: string;
  studentId: string;
  /** The enrollment's CURRENT cache values (defaults until this backfill runs). */
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

/** Everything the pure plan builder needs, already fetched + date-normalized. */
export interface BuildHorseEnrollmentPlanInput {
  /** The single server-resolved current CourseOffering id (a public cuid). */
  currentOfferingId: string;
  /** The single captured effective date at which "current horse" is resolved. */
  asOf: DateKey;
  /** ALL CourseEnrollment rows in the current offering (already offering-scoped). */
  enrollments: readonly EnrollmentInput[];
  /** ALL TraineeHorseAssignment rows to be linked. */
  horseAssignments: readonly HorseAssignmentInput[];
}

/**
 * One planned row per cleanly-resolved TraineeHorseAssignment. Carries enough to
 * apply BOTH the FK link (per assignment) and, on the single cache-source row of
 * each enrollment, the enrollment cache values (from the current interval).
 */
export interface HorseEnrollmentPlanRow {
  traineeHorseAssignmentId: string;
  studentId: string;
  /** The resolved target CourseEnrollment (the FK this row should point at). */
  courseEnrollmentId: string;
  /** Target enrollment cache values (from the enrollment's current interval). */
  targetHasPrivateHorse: boolean;
  targetPrivateHorseName: string | null;
  targetAssignedHorseName: string | null;
  /** True iff this row's FK needs to be set (was null). */
  linkNeedsUpdate: boolean;
  /** True iff this row's FK already points at the correct enrollment. */
  alreadyLinkedCorrectly: boolean;
  /** True iff this row is the current interval that sources the enrollment cache. */
  isCacheSource: boolean;
  /** True iff (isCacheSource and) the enrollment cache needs update. */
  cacheNeedsUpdate: boolean;
  /** True iff (isCacheSource and) the enrollment cache already matches the target. */
  cacheAlreadyMatches: boolean;
}

/** A reported, never-repaired anomaly. Every field is a safe id (no PII). */
export type HorseBackfillAnomaly =
  | { kind: "zero-enrollment"; studentId: string; traineeHorseAssignmentId: string }
  | { kind: "multiple-enrollment"; studentId: string; courseEnrollmentIds: string[] }
  | { kind: "missing-current-history"; studentId: string; courseEnrollmentId: string }
  | {
      kind: "multiple-current-history";
      studentId: string;
      courseEnrollmentId: string;
      traineeHorseAssignmentIds: string[];
    }
  | {
      kind: "student-enrollment-mismatch";
      traineeHorseAssignmentId: string;
      historyStudentId: string;
      enrollmentStudentId: string;
      courseEnrollmentId: string;
    }
  | { kind: "invalid-horse-state"; studentId: string; traineeHorseAssignmentId: string }
  | {
      kind: "pre-linked-wrong-enrollment";
      traineeHorseAssignmentId: string;
      studentId: string;
      currentCourseEnrollmentId: string;
      expectedCourseEnrollmentId: string;
    }
  | { kind: "duplicate-history-row"; traineeHorseAssignmentId: string }
  | { kind: "duplicate-enrollment"; courseEnrollmentId: string };

/** Deterministic, PII-free counts describing the whole plan. */
export interface HorseEnrollmentBackfillSummary {
  currentOfferingId: string;
  asOf: DateKey;
  totalHistoryRows: number;
  totalEnrollments: number;
  linkUpdatesRequired: number;
  cacheUpdatesRequired: number;
  alreadyCorrectLinks: number;
  alreadyCorrectCaches: number;
  zeroEnrollment: number;
  multipleEnrollment: number;
  missingCurrentHistory: number;
  multipleCurrentHistory: number;
  studentEnrollmentMismatch: number;
  invalidHorseState: number;
  preLinkedWrongEnrollment: number;
  duplicateHistoryRow: number;
  duplicateEnrollment: number;
  anomalyTotal: number;
}

export interface HorseEnrollmentBackfillPlan {
  currentOfferingId: string;
  asOf: DateKey;
  /** Deterministic order: (studentId, traineeHorseAssignmentId). */
  rows: HorseEnrollmentPlanRow[];
  /** Deterministic order (see buildHorseEnrollmentPlan). */
  anomalies: HorseBackfillAnomaly[];
  summary: HorseEnrollmentBackfillSummary;
  /** True iff there are zero anomalies of any kind - the ONLY appliable state. */
  canApply: boolean;
}

/**
 * A row covers `date` iff effectiveFrom <= date AND (effectiveTo === null OR
 * date < effectiveTo). Identical to resolveIntervalAtDate's predicate, but here
 * we evaluate it over EVERY row so a caller can detect zero vs one vs many
 * covering intervals (resolveIntervalAtDate returns only the first match).
 */
function covers(
  row: { effectiveFrom: DateKey; effectiveTo: DateKey | null },
  date: DateKey,
): boolean {
  const startsOnOrBeforeDate = compareDateKeys(row.effectiveFrom, date) <= 0;
  const endsAfterDate = row.effectiveTo === null || compareDateKeys(date, row.effectiveTo) < 0;
  return startsOnOrBeforeDate && endsAfterDate;
}

/** The per-enrollment cache decision resolved from its current horse interval. */
interface CacheDecision {
  sourceAssignmentId: string;
  target: NormalizedHorse;
  needsUpdate: boolean;
  alreadyMatches: boolean;
}

/**
 * Build the deterministic, fail-closed backfill plan. PURE: identical inputs
 * always yield an identical plan regardless of input array order.
 *
 * MATCHING RULE (locked): for each TraineeHorseAssignment, resolve the Student's
 * enrollment in the current offering strictly by studentId; require EXACTLY ONE
 * (zero/multiple are anomalies). Never match by name/phone/identity/horse/order.
 *
 * INTERVAL RULE: the enrollment cache source is the single history interval that
 * is current at `asOf`; zero or multiple current intervals are anomalies.
 *
 * CACHE RULE: cache values come only from the normalized current interval, never
 * from Student. A noncanonical horse value is an INVALID_HORSE_STATE anomaly.
 */
export function buildHorseEnrollmentPlan(
  input: BuildHorseEnrollmentPlanInput,
): HorseEnrollmentBackfillPlan {
  assertValidDateKey(input.asOf, "buildHorseEnrollmentPlan.asOf");

  // Sort copies up front so all downstream iteration is order-independent.
  const assignments = [...input.horseAssignments].sort((a, b) =>
    a.studentId === b.studentId
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.studentId < b.studentId
        ? -1
        : 1,
  );
  const enrollments = [...input.enrollments].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const anomalies: HorseBackfillAnomaly[] = [];

  // --- Integrity: duplicate input ids (defensive, PII-free). -----------------
  const seenAssignmentIds = new Set<string>();
  const duplicateAssignmentIds = new Set<string>();
  for (const a of assignments) {
    if (seenAssignmentIds.has(a.id)) {
      if (!duplicateAssignmentIds.has(a.id)) {
        duplicateAssignmentIds.add(a.id);
        anomalies.push({ kind: "duplicate-history-row", traineeHorseAssignmentId: a.id });
      }
    } else {
      seenAssignmentIds.add(a.id);
    }
  }
  const seenEnrollmentIds = new Set<string>();
  const duplicateEnrollmentIds = new Set<string>();
  for (const e of enrollments) {
    if (seenEnrollmentIds.has(e.id)) {
      if (!duplicateEnrollmentIds.has(e.id)) {
        duplicateEnrollmentIds.add(e.id);
        anomalies.push({ kind: "duplicate-enrollment", courseEnrollmentId: e.id });
      }
    } else {
      seenEnrollmentIds.add(e.id);
    }
  }

  // --- Index enrollments by their studentId (the ONLY matching key). ---------
  const enrollmentsByStudent = new Map<string, EnrollmentInput[]>();
  const enrollmentById = new Map<string, EnrollmentInput>();
  for (const e of enrollments) {
    if (!enrollmentById.has(e.id)) enrollmentById.set(e.id, e);
    const list = enrollmentsByStudent.get(e.studentId);
    if (list) list.push(e);
    else enrollmentsByStudent.set(e.studentId, [e]);
  }

  // --- Index assignments by studentId (for current-interval resolution). -----
  const assignmentsByStudent = new Map<string, HorseAssignmentInput[]>();
  for (const a of assignments) {
    if (duplicateAssignmentIds.has(a.id)) continue; // ambiguous id - excluded
    const list = assignmentsByStudent.get(a.studentId);
    if (list) list.push(a);
    else assignmentsByStudent.set(a.studentId, [a]);
  }

  // --- Per-enrollment cache decision from its single current interval. --------
  // Keyed by enrollment id; only clean (single-enrollment, single-current,
  // canonical-horse) enrollments get a decision. Its sourceAssignmentId marks
  // the one row that carries the cache write.
  const cacheByEnrollment = new Map<string, CacheDecision>();
  for (const e of enrollments) {
    if (duplicateEnrollmentIds.has(e.id)) continue;
    // A duplicated studentId across enrollments is a multiple-enrollment anomaly
    // handled in the assignment pass; skip cache resolution to avoid a spurious
    // decision for an enrollment we will refuse to link to anyway.
    const sameStudent = enrollmentsByStudent.get(e.studentId) ?? [];
    if (sameStudent.length !== 1) continue;

    const studentAssignments = assignmentsByStudent.get(e.studentId) ?? [];
    const covering = studentAssignments.filter((a) => covers(a, input.asOf));
    if (covering.length === 0) {
      anomalies.push({
        kind: "missing-current-history",
        studentId: e.studentId,
        courseEnrollmentId: e.id,
      });
      continue;
    }
    if (covering.length > 1) {
      anomalies.push({
        kind: "multiple-current-history",
        studentId: e.studentId,
        courseEnrollmentId: e.id,
        traineeHorseAssignmentIds: covering.map((a) => a.id).sort(),
      });
      continue;
    }
    const source = covering[0];
    const normalized = normalizeHorse({
      assignedHorseName: source.assignedHorseName,
      hasPrivateHorse: source.hasPrivateHorse,
      privateHorseName: source.privateHorseName,
    });
    if (!normalized.ok) {
      anomalies.push({
        kind: "invalid-horse-state",
        studentId: e.studentId,
        traineeHorseAssignmentId: source.id,
      });
      continue;
    }
    const target = normalized.value;
    const alreadyMatches =
      e.hasPrivateHorse === target.hasPrivateHorse &&
      e.privateHorseName === target.privateHorseName &&
      e.assignedHorseName === target.assignedHorseName;
    cacheByEnrollment.set(e.id, {
      sourceAssignmentId: source.id,
      target,
      needsUpdate: !alreadyMatches,
      alreadyMatches,
    });
  }

  // --- Per-assignment link resolution -> planned rows. -----------------------
  const rows: HorseEnrollmentPlanRow[] = [];
  for (const a of assignments) {
    if (duplicateAssignmentIds.has(a.id)) continue;

    const studentEnrollments = enrollmentsByStudent.get(a.studentId) ?? [];
    if (studentEnrollments.length === 0) {
      anomalies.push({
        kind: "zero-enrollment",
        studentId: a.studentId,
        traineeHorseAssignmentId: a.id,
      });
      continue;
    }
    if (studentEnrollments.length > 1) {
      anomalies.push({
        kind: "multiple-enrollment",
        studentId: a.studentId,
        courseEnrollmentIds: studentEnrollments.map((e) => e.id).sort(),
      });
      continue;
    }
    const target = studentEnrollments[0];

    // Defensive: the matching key IS studentId, so the resolved enrollment's
    // studentId always equals the history studentId here. The genuinely
    // reachable studentId mismatch is a PRE-EXISTING link pointing at another
    // student's enrollment, checked below.
    let linkNeedsUpdate = false;
    let alreadyLinkedCorrectly = false;
    if (a.courseEnrollmentId === null) {
      linkNeedsUpdate = true;
    } else if (a.courseEnrollmentId === target.id) {
      alreadyLinkedCorrectly = true;
    } else {
      const linked = enrollmentById.get(a.courseEnrollmentId);
      if (linked && linked.studentId !== a.studentId) {
        anomalies.push({
          kind: "student-enrollment-mismatch",
          traineeHorseAssignmentId: a.id,
          historyStudentId: a.studentId,
          enrollmentStudentId: linked.studentId,
          courseEnrollmentId: a.courseEnrollmentId,
        });
      } else {
        // Points at a different (or unknown) enrollment: never overwritten.
        anomalies.push({
          kind: "pre-linked-wrong-enrollment",
          traineeHorseAssignmentId: a.id,
          studentId: a.studentId,
          currentCourseEnrollmentId: a.courseEnrollmentId,
          expectedCourseEnrollmentId: target.id,
        });
      }
      continue;
    }

    const cache = cacheByEnrollment.get(target.id);
    const isCacheSource = cache !== undefined && cache.sourceAssignmentId === a.id;
    rows.push({
      traineeHorseAssignmentId: a.id,
      studentId: a.studentId,
      courseEnrollmentId: target.id,
      targetHasPrivateHorse: cache ? cache.target.hasPrivateHorse : target.hasPrivateHorse,
      targetPrivateHorseName: cache ? cache.target.privateHorseName : target.privateHorseName,
      targetAssignedHorseName: cache ? cache.target.assignedHorseName : target.assignedHorseName,
      linkNeedsUpdate,
      alreadyLinkedCorrectly,
      isCacheSource,
      cacheNeedsUpdate: isCacheSource ? (cache as CacheDecision).needsUpdate : false,
      cacheAlreadyMatches: isCacheSource ? (cache as CacheDecision).alreadyMatches : false,
    });
  }

  rows.sort((a, b) =>
    a.studentId === b.studentId
      ? a.traineeHorseAssignmentId < b.traineeHorseAssignmentId
        ? -1
        : a.traineeHorseAssignmentId > b.traineeHorseAssignmentId
          ? 1
          : 0
      : a.studentId < b.studentId
        ? -1
        : 1,
  );

  const count = (kind: HorseBackfillAnomaly["kind"]): number =>
    anomalies.reduce((n, x) => (x.kind === kind ? n + 1 : n), 0);

  const summary: HorseEnrollmentBackfillSummary = {
    currentOfferingId: input.currentOfferingId,
    asOf: input.asOf,
    totalHistoryRows: input.horseAssignments.length,
    totalEnrollments: input.enrollments.length,
    linkUpdatesRequired: rows.reduce((n, r) => (r.linkNeedsUpdate ? n + 1 : n), 0),
    cacheUpdatesRequired: rows.reduce(
      (n, r) => (r.isCacheSource && r.cacheNeedsUpdate ? n + 1 : n),
      0,
    ),
    alreadyCorrectLinks: rows.reduce((n, r) => (r.alreadyLinkedCorrectly ? n + 1 : n), 0),
    alreadyCorrectCaches: rows.reduce(
      (n, r) => (r.isCacheSource && r.cacheAlreadyMatches ? n + 1 : n),
      0,
    ),
    zeroEnrollment: count("zero-enrollment"),
    multipleEnrollment: count("multiple-enrollment"),
    missingCurrentHistory: count("missing-current-history"),
    multipleCurrentHistory: count("multiple-current-history"),
    studentEnrollmentMismatch: count("student-enrollment-mismatch"),
    invalidHorseState: count("invalid-horse-state"),
    preLinkedWrongEnrollment: count("pre-linked-wrong-enrollment"),
    duplicateHistoryRow: count("duplicate-history-row"),
    duplicateEnrollment: count("duplicate-enrollment"),
    anomalyTotal: anomalies.length,
  };

  return {
    currentOfferingId: input.currentOfferingId,
    asOf: input.asOf,
    rows,
    anomalies,
    summary,
    canApply: anomalies.length === 0,
  };
}

/**
 * Render a PII-free, credential-free one-block summary of a plan for operator
 * logs. Deliberately emits ONLY counts and safe ids (studentId / assignmentId /
 * enrollmentId / offeringId) - never a fullName, phone, identityNumber, horse
 * name, connection string, or DATABASE_URL.
 */
export function formatHorseEnrollmentPlanSummary(plan: HorseEnrollmentBackfillPlan): string {
  const s = plan.summary;
  const lines: string[] = [
    `current offering:            ${s.currentOfferingId}`,
    `asOf (current-horse date):   ${s.asOf}`,
    `total history rows:          ${s.totalHistoryRows}`,
    `total enrollments considered:${s.totalEnrollments}`,
    `link updates required:       ${s.linkUpdatesRequired}`,
    `cache updates required:      ${s.cacheUpdatesRequired}`,
    `already-correct links:       ${s.alreadyCorrectLinks}`,
    `already-correct caches:      ${s.alreadyCorrectCaches}`,
    `anomalies (total):           ${s.anomalyTotal}`,
    `  zero-enrollment:              ${s.zeroEnrollment}`,
    `  multiple-enrollment:          ${s.multipleEnrollment}`,
    `  missing-current-history:      ${s.missingCurrentHistory}`,
    `  multiple-current-history:     ${s.multipleCurrentHistory}`,
    `  student/enrollment mismatch:  ${s.studentEnrollmentMismatch}`,
    `  invalid-horse-state:          ${s.invalidHorseState}`,
    `  pre-linked-to-wrong:          ${s.preLinkedWrongEnrollment}`,
    `  duplicate-history-row:        ${s.duplicateHistoryRow}`,
    `  duplicate-enrollment:         ${s.duplicateEnrollment}`,
    `appliable:                   ${plan.canApply ? "yes (0 anomalies)" : "NO (anomalies present)"}`,
  ];
  return lines.join("\n");
}

/**
 * Render each anomaly as a single PII-free diagnostic line (safe ids only), so
 * an operator can locate the offending rows without any names/credentials.
 */
export function formatHorseEnrollmentAnomalies(plan: HorseEnrollmentBackfillPlan): string[] {
  return plan.anomalies.map((x) => {
    switch (x.kind) {
      case "zero-enrollment":
        return `zero-enrollment: student ${x.studentId} history ${x.traineeHorseAssignmentId} has no enrollment in the current offering`;
      case "multiple-enrollment":
        return `multiple-enrollment: student ${x.studentId} has ${x.courseEnrollmentIds.length} enrollments (${x.courseEnrollmentIds.join(", ")}) in the current offering`;
      case "missing-current-history":
        return `missing-current-history: enrollment ${x.courseEnrollmentId} (student ${x.studentId}) has no history interval current at asOf`;
      case "multiple-current-history":
        return `multiple-current-history: enrollment ${x.courseEnrollmentId} (student ${x.studentId}) has ${x.traineeHorseAssignmentIds.length} intervals current at asOf (${x.traineeHorseAssignmentIds.join(", ")})`;
      case "student-enrollment-mismatch":
        return `student-enrollment-mismatch: history ${x.traineeHorseAssignmentId} (student ${x.historyStudentId}) is linked to enrollment ${x.courseEnrollmentId} owned by student ${x.enrollmentStudentId}`;
      case "invalid-horse-state":
        return `invalid-horse-state: history ${x.traineeHorseAssignmentId} (student ${x.studentId}) is not a canonical horse state`;
      case "pre-linked-wrong-enrollment":
        return `pre-linked-wrong-enrollment: history ${x.traineeHorseAssignmentId} (student ${x.studentId}) already points at ${x.currentCourseEnrollmentId}, expected ${x.expectedCourseEnrollmentId}`;
      case "duplicate-history-row":
        return `duplicate-history-row: traineeHorseAssignmentId ${x.traineeHorseAssignmentId} appears more than once`;
      case "duplicate-enrollment":
        return `duplicate-enrollment: courseEnrollmentId ${x.courseEnrollmentId} appears more than once`;
    }
  });
}
