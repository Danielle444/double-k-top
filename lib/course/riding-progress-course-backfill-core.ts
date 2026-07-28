/**
 * RIDING PROGRESS COURSE SCOPE - S3: the PURE, DB-free planner for the ONE-TIME
 * backfill that scopes the legacy StudentRidingProgressFeedback rows to their
 * course offering.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * session read, no argv read. It receives already-fetched plain rows plus the
 * already-fetched target offering and returns a plan (or refusals). The whole
 * contract is unit-testable without a database.
 *
 * WHAT MAKES THIS BACKFILL SAFE
 * -----------------------------
 * The legacy rows predate the course dimension entirely, so they carry no
 * evidence of their own course. They are attributable ONLY because the audit
 * established a closed, fully-enumerated dataset:
 *   - exactly EXPECTED_LEGACY_TOTAL_ROWS rows exist;
 *   - every one of them is dated EXPECTED_LEGACY_DATE_KEY;
 *   - that date precedes the Level 2 offering's enrollment start by nine days,
 *     so no row can belong to Level 2 - including the four rows whose trainees
 *     have SINCE become dual-enrolled.
 *
 * That last point is why this planner NEVER looks at current enrollments: a
 * trainee's enrollment set today says nothing about which course a row written
 * before the second course existed belonged to. Current dual-enrollment is
 * precisely the misleading signal this design refuses to consult.
 *
 * THE TARGET IS AN OPERATOR ARGUMENT, NEVER A DERIVATION
 * -----------------------------------------------------
 * The offering id is supplied on the command line and passed in here as data.
 * This module hardcodes NO offering id. It also never identifies the target by
 * name, level name, date window, group or trainee: `name` is carried through as
 * REPORTED EVIDENCE only, so the operator can eyeball what they targeted, and is
 * never used as identity. The level/status checks are ACCEPTANCE tests on the
 * operator's choice, not a search for a course.
 *
 * FAIL CLOSED, NEVER WIDEN
 * ------------------------
 * If production no longer matches the audited shape - a different row count, an
 * unexpected date, a duplicate id, a row already pointing at some OTHER offering
 * - the plan REFUSES. The correct response is a fresh audit, never a loosened
 * script. There is deliberately no force flag and no confirmation bypass.
 */

/** The audited number of legacy rows. A different total refuses the plan. */
export const EXPECTED_LEGACY_TOTAL_ROWS = 11;

/**
 * The audited date every legacy row carries. This is NOT date-based course
 * inference: the date does not select a course, it only proves the dataset is
 * still the one the audit enumerated. A row on any other date refuses.
 */
export const EXPECTED_LEGACY_DATE_KEY = "2026-07-17";

/** The target must be a Level 1 offering - this alone excludes the Level 2 one. */
export const REQUIRED_TARGET_LEVEL = 1;

/** The target must be ACTIVE. */
export const REQUIRED_TARGET_STATUS = "ACTIVE";

/** One legacy feedback row, already projected to plain values by the caller. */
export interface RidingProgressBackfillRowInput {
  readonly id: string;
  readonly studentId: string;
  /** YYYY-MM-DD, normalized by the caller from the @db.Date column. */
  readonly dateKey: string;
  readonly courseOfferingId: string | null;
}

/** The operator-requested offering, as fetched by id. `name` is evidence only. */
export interface RidingProgressBackfillTargetInput {
  readonly id: string;
  readonly level: number;
  readonly status: string;
  readonly name: string;
  readonly activityYearId: string;
}

/** One planned write. `currentCourseOfferingId` is always null by construction. */
export interface RidingProgressBackfillUpdate {
  readonly id: string;
  readonly studentId: string;
  readonly dateKey: string;
  readonly currentCourseOfferingId: null;
  readonly proposedCourseOfferingId: string;
}

export type RidingProgressBackfillRefusalCode =
  | "TARGET_ID_MALFORMED"
  | "TARGET_NOT_FOUND"
  | "TARGET_ID_MISMATCH"
  | "TARGET_WRONG_LEVEL"
  | "TARGET_NOT_ACTIVE"
  | "MALFORMED_ROW"
  | "DUPLICATE_ROW_ID"
  | "UNEXPECTED_TOTAL_ROW_COUNT"
  | "UNEXPECTED_ROW_DATE"
  | "ROW_SCOPED_TO_OTHER_OFFERING";

export interface RidingProgressBackfillRefusal {
  readonly code: RidingProgressBackfillRefusalCode;
  readonly detail: string;
}

export interface RidingProgressBackfillPlan {
  /** The matched target's OWN id, or null when the target was rejected. */
  readonly targetCourseOfferingId: string | null;
  /** Reported so the operator can verify what they targeted. Never identity. */
  readonly targetEvidence: {
    readonly level: number;
    readonly status: string;
    readonly name: string;
    readonly activityYearId: string;
  } | null;
  readonly totalRowsInspected: number;
  readonly nullRows: number;
  readonly alreadyScopedToTarget: number;
  readonly alreadyScopedToOther: number;
  /** Deterministic: ascending by row id. */
  readonly updates: readonly RidingProgressBackfillUpdate[];
  readonly refusals: readonly RidingProgressBackfillRefusal[];
  /** True only when there is NO refusal at all. Zero updates is still applicable. */
  readonly canApply: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate the operator's target. Returns the refusals (empty when acceptable).
 *
 * The requested id is compared to the FETCHED row's id by exact equality, so a
 * caller that fetched with a different key than it passed here cannot slip a
 * substituted offering through.
 */
function validateTarget(
  requestedTargetOfferingId: string,
  target: RidingProgressBackfillTargetInput | null | undefined,
): RidingProgressBackfillRefusal[] {
  const refusals: RidingProgressBackfillRefusal[] = [];

  if (!isNonEmptyString(requestedTargetOfferingId)) {
    refusals.push({
      code: "TARGET_ID_MALFORMED",
      detail: "the target offering id must be a non-empty string",
    });
    return refusals;
  }
  if (!target) {
    refusals.push({
      code: "TARGET_NOT_FOUND",
      detail: `no CourseOffering exists with id ${requestedTargetOfferingId}`,
    });
    return refusals;
  }
  if (target.id !== requestedTargetOfferingId) {
    refusals.push({
      code: "TARGET_ID_MISMATCH",
      detail: `fetched offering id ${target.id} does not equal the requested id`,
    });
    return refusals;
  }
  if (target.level !== REQUIRED_TARGET_LEVEL) {
    refusals.push({
      code: "TARGET_WRONG_LEVEL",
      detail: `target offering level is ${target.level}, expected ${REQUIRED_TARGET_LEVEL}`,
    });
  }
  if (target.status !== REQUIRED_TARGET_STATUS) {
    refusals.push({
      code: "TARGET_NOT_ACTIVE",
      detail: `target offering status is ${target.status}, expected ${REQUIRED_TARGET_STATUS}`,
    });
  }
  return refusals;
}

/**
 * Build the one-time backfill plan.
 *
 * Order is deliberate: the target is validated FIRST, so a bad target produces a
 * clean refusal without any row ever being paired with it. Rows are then
 * classified without mutating the input (the array is copied before sorting).
 *
 * Classification per row:
 *   - courseOfferingId === null            -> candidate (must pass the date check)
 *   - courseOfferingId === target.id       -> already scoped, SKIPPED (idempotent)
 *   - courseOfferingId === anything else   -> REFUSAL, never touched
 *
 * The dataset-shape gate is `totalRowsInspected === EXPECTED_LEGACY_TOTAL_ROWS`
 * AND `nullRows + alreadyScopedToTarget === EXPECTED_LEGACY_TOTAL_ROWS`. That
 * single invariant covers all three legitimate states - untouched (11 null),
 * fully applied (11 scoped) and a partially-completed apply - while refusing any
 * dataset that has grown, shrunk or drifted.
 */
export function buildRidingProgressCourseBackfillPlan(
  requestedTargetOfferingId: string,
  target: RidingProgressBackfillTargetInput | null | undefined,
  rows: readonly RidingProgressBackfillRowInput[],
): RidingProgressBackfillPlan {
  const refusals: RidingProgressBackfillRefusal[] = [...validateTarget(requestedTargetOfferingId, target)];
  const targetAccepted = refusals.length === 0 && target !== null && target !== undefined;
  const targetId = targetAccepted ? (target as RidingProgressBackfillTargetInput).id : null;

  // Copy before any ordering work - the caller's array is never mutated.
  const inspected = [...rows];

  const seenIds = new Set<string>();
  const candidates: RidingProgressBackfillRowInput[] = [];
  let nullRows = 0;
  let alreadyScopedToTarget = 0;
  let alreadyScopedToOther = 0;

  for (const row of inspected) {
    if (!isNonEmptyString(row?.id) || !isNonEmptyString(row?.studentId) || !isNonEmptyString(row?.dateKey)) {
      refusals.push({
        code: "MALFORMED_ROW",
        detail: `a row is missing id, studentId or dateKey (id ${String(row?.id)})`,
      });
      continue;
    }
    if (seenIds.has(row.id)) {
      refusals.push({ code: "DUPLICATE_ROW_ID", detail: `row id ${row.id} appears more than once` });
      continue;
    }
    seenIds.add(row.id);

    if (row.courseOfferingId === null) {
      nullRows += 1;
      if (row.dateKey !== EXPECTED_LEGACY_DATE_KEY) {
        refusals.push({
          code: "UNEXPECTED_ROW_DATE",
          detail: `row ${row.id} is dated ${row.dateKey}, expected ${EXPECTED_LEGACY_DATE_KEY}`,
        });
        continue;
      }
      candidates.push(row);
      continue;
    }

    if (targetId !== null && row.courseOfferingId === targetId) {
      alreadyScopedToTarget += 1;
      continue;
    }

    alreadyScopedToOther += 1;
    refusals.push({
      code: "ROW_SCOPED_TO_OTHER_OFFERING",
      detail: `row ${row.id} is already scoped to a different offering and must never be rewritten`,
    });
  }

  const totalRowsInspected = inspected.length;
  if (totalRowsInspected !== EXPECTED_LEGACY_TOTAL_ROWS) {
    refusals.push({
      code: "UNEXPECTED_TOTAL_ROW_COUNT",
      detail:
        `found ${totalRowsInspected} rows, expected exactly ${EXPECTED_LEGACY_TOTAL_ROWS}. ` +
        "The audited dataset has changed - re-audit rather than widening this script.",
    });
  } else if (nullRows + alreadyScopedToTarget !== EXPECTED_LEGACY_TOTAL_ROWS) {
    refusals.push({
      code: "UNEXPECTED_TOTAL_ROW_COUNT",
      detail:
        `${nullRows} unscoped + ${alreadyScopedToTarget} already-scoped rows do not account for ` +
        `all ${EXPECTED_LEGACY_TOTAL_ROWS} audited rows`,
    });
  }

  const canApply = refusals.length === 0;

  const updates: RidingProgressBackfillUpdate[] = canApply && targetId !== null
    ? candidates
        .map((row) => ({
          id: row.id,
          studentId: row.studentId,
          dateKey: row.dateKey,
          currentCourseOfferingId: null as null,
          proposedCourseOfferingId: targetId,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : [];

  return {
    targetCourseOfferingId: targetId,
    targetEvidence: targetAccepted
      ? {
          level: (target as RidingProgressBackfillTargetInput).level,
          status: (target as RidingProgressBackfillTargetInput).status,
          name: (target as RidingProgressBackfillTargetInput).name,
          activityYearId: (target as RidingProgressBackfillTargetInput).activityYearId,
        }
      : null,
    totalRowsInspected,
    nullRows,
    alreadyScopedToTarget,
    alreadyScopedToOther,
    updates,
    refusals,
    canApply,
  };
}

// ---------------------------------------------------------------------------
// CLI argument parsing - pure, so the runner script needs no top-level export
// just to be testable.
// ---------------------------------------------------------------------------

export interface RidingProgressBackfillArgs {
  readonly offeringId: string | null;
  readonly apply: boolean;
  readonly errors: readonly string[];
}

/**
 * Parse the runner's argv tail.
 *
 * DRY-RUN IS THE DEFAULT: `apply` is false unless the exact literal `--apply` is
 * present. `--offering-id=<id>` is ALWAYS required, in both modes, so a dry-run
 * can never be read as evidence for a target the operator did not name.
 *
 * There is deliberately NO force, yes, confirm-bypass or skip-checks flag, and
 * any unrecognized argument is a hard error rather than being ignored - a typo'd
 * guard flag must never silently degrade into "no guard".
 */
export function parseRidingProgressBackfillArgs(argv: readonly string[]): RidingProgressBackfillArgs {
  let offeringId: string | null = null;
  let apply = false;
  const errors: string[] = [];

  for (const arg of argv) {
    if (arg === "--apply") {
      apply = true;
    } else if (arg.startsWith("--offering-id=")) {
      const value = arg.slice("--offering-id=".length).trim();
      if (value.length === 0) {
        errors.push("--offering-id must not be empty");
      } else {
        offeringId = value;
      }
    } else {
      errors.push(`Unrecognized argument: ${arg}`);
    }
  }

  if (offeringId === null && !errors.some((e) => e.startsWith("--offering-id"))) {
    errors.push("--offering-id=<courseOfferingId> is required (in dry-run and apply alike)");
  }

  return { offeringId, apply, errors };
}

/** Human-readable plan summary. Emits ids and dates only - never PII. */
export function formatRidingProgressBackfillPlan(plan: RidingProgressBackfillPlan): string[] {
  const lines: string[] = [];
  lines.push(`Target offering id:      ${plan.targetCourseOfferingId ?? "<rejected>"}`);
  if (plan.targetEvidence) {
    lines.push(`  level:                 ${plan.targetEvidence.level}`);
    lines.push(`  status:                ${plan.targetEvidence.status}`);
    lines.push(`  name (evidence only):  ${plan.targetEvidence.name}`);
    lines.push(`  activityYearId:        ${plan.targetEvidence.activityYearId}`);
  }
  lines.push(`Total feedback rows:     ${plan.totalRowsInspected}`);
  lines.push(`Unscoped (NULL) rows:    ${plan.nullRows}`);
  lines.push(`Already scoped to target:${plan.alreadyScopedToTarget}`);
  lines.push(`Scoped to OTHER offering:${plan.alreadyScopedToOther}`);
  lines.push(`Rows selected for update:${plan.updates.length}`);
  return lines;
}

/** One evidence line per planned update. Ids and dates only - never PII. */
export function formatRidingProgressBackfillUpdates(plan: RidingProgressBackfillPlan): string[] {
  return plan.updates.map(
    (u, i) =>
      `${String(i + 1).padStart(2, " ")}. row ${u.id}  student ${u.studentId}  date ${u.dateKey}  ` +
      `current NULL -> ${u.proposedCourseOfferingId}`,
  );
}

/** One line per refusal. */
export function formatRidingProgressBackfillRefusals(plan: RidingProgressBackfillPlan): string[] {
  return plan.refusals.map((r) => `[${r.code}] ${r.detail}`);
}
