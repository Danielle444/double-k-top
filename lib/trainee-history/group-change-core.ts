/**
 * Pure, database-free core for the future enrollment-scoped GROUP-CHANGE
 * service (Stage W6D2).
 *
 * PURE by construction: no Prisma, no DB access, no next/headers, no clock, no
 * environment access, no logging, no calendar-day input. This module reasons
 * only over plain data: it validates an already-resolved target CourseGroup,
 * decides whether a move is a real change or an idempotent no-op, derives the
 * Student compatibility mirror, and verifies post-write parity.
 *
 * Everything with side effects — resolving the target from CourseGroup ids,
 * reading the authoritative GroupMembership, stamping Israel-local today, and
 * writing rows in a transaction — belongs to the future transaction adapter,
 * NOT here. There is intentionally no clock and no effective-from input in this
 * module.
 *
 * AUTHORITY MODEL (locked, W6D2):
 *  - GroupMembership is the AUTHORITATIVE dated group history. The current
 *    group is identified solely by its `courseGroupId`.
 *  - Student.groupName / Student.subgroupNumber are COMPATIBILITY MIRRORS only.
 *    They are DERIVED from the authoritative target and are never treated as
 *    the source of truth for the change decision.
 *  - The legacy `TraineeGroupMembership` model is NOT part of this flow. It is
 *    intentionally neither imported nor referenced anywhere in this module.
 *
 * TARGET RESOLUTION BOUNDARY:
 *  - This core never parses free-text group labels. The target arrives already
 *    resolved and carries an explicit numeric `subgroupNumber`, produced by the
 *    future IO layer (which owns any CourseGroup.name parsing). Keeping the
 *    resolved numeric subgroup on the input keeps this pure contract minimal
 *    and prevents label parsing from leaking into the write service.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * A target CourseGroup that the future transaction adapter has already resolved
 * and validated against the enrollment's course offering. The pure core accepts
 * only this shape — never an arbitrary free-text group label.
 */
export type ResolvedTargetCourseGroup = {
  courseGroupId: string;
  courseOfferingId: string;
  parentGroupId: string;
  groupName: string;
  subgroupNumber: number;
};

/**
 * The authoritative interval value for a dated GroupMembership row. Minimal by
 * design: the current group is identified only by its CourseGroup id.
 */
export type GroupMembershipValue = {
  courseGroupId: string;
};

/** The Student compatibility mirror derived from the authoritative target. */
export type GroupMirrorValue = {
  groupName: string;
  subgroupNumber: number;
};

/** Structural validation failure codes for a resolved target. */
export type TargetValidationCode =
  | "EMPTY_COURSE_GROUP_ID"
  | "EMPTY_COURSE_OFFERING_ID"
  | "EMPTY_PARENT_GROUP_ID"
  | "EMPTY_GROUP_NAME"
  | "INVALID_SUBGROUP_NUMBER";

export type ValidateTargetResult =
  | { ok: true; value: ResolvedTargetCourseGroup }
  | { ok: false; code: TargetValidationCode };

/** The two possible outcomes of a group-change decision. */
export type GroupChangeDecision = "NO_CHANGE" | "APPLY_CHANGE";

export type DecideGroupChangeResult =
  | { ok: true; decision: GroupChangeDecision }
  | { ok: false; code: TargetValidationCode | "EMPTY_CURRENT_COURSE_GROUP_ID" };

/** Which observed field failed the post-write parity check. */
export type ParityMismatchField =
  | "MEMBERSHIP_COURSE_GROUP_ID"
  | "MIRROR_GROUP_NAME"
  | "MIRROR_SUBGROUP_NUMBER";

export type GroupChangeParityResult =
  | { ok: true }
  | { ok: false; mismatches: ParityMismatchField[] };

// ============================================================================
// INTERNAL PURE HELPERS
// ============================================================================

/**
 * Return the trimmed string when `value` is a string with non-whitespace
 * content, otherwise `null`. Used to enforce the "non-empty" structural rules
 * without constructing any objects with side effects.
 */
function nonEmptyTrimmed(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A positive integer subgroup number, or `null` when the input is invalid. */
function positiveIntegerSubgroup(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

// ============================================================================
// TARGET VALIDATION
// ============================================================================

/**
 * Validate the purely structural requirements of a resolved target and return a
 * normalized {@link ResolvedTargetCourseGroup}. Never queries Prisma and never
 * parses free-text labels — it only checks the shape produced by the future IO
 * layer.
 *
 * Requirements (each failure is explicit and fails closed):
 *  - non-empty `courseGroupId`
 *  - non-empty `courseOfferingId`
 *  - non-empty `parentGroupId`
 *  - non-empty normalized `groupName`
 *  - `subgroupNumber` is a positive integer
 */
export function validateResolvedTarget(input: unknown): ValidateTargetResult {
  if (typeof input !== "object" || input === null) {
    return { ok: false, code: "EMPTY_COURSE_GROUP_ID" };
  }
  const raw = input as Record<string, unknown>;

  const courseGroupId = nonEmptyTrimmed(raw.courseGroupId);
  if (courseGroupId === null) {
    return { ok: false, code: "EMPTY_COURSE_GROUP_ID" };
  }

  const courseOfferingId = nonEmptyTrimmed(raw.courseOfferingId);
  if (courseOfferingId === null) {
    return { ok: false, code: "EMPTY_COURSE_OFFERING_ID" };
  }

  const parentGroupId = nonEmptyTrimmed(raw.parentGroupId);
  if (parentGroupId === null) {
    return { ok: false, code: "EMPTY_PARENT_GROUP_ID" };
  }

  const groupName = nonEmptyTrimmed(raw.groupName);
  if (groupName === null) {
    return { ok: false, code: "EMPTY_GROUP_NAME" };
  }

  const subgroupNumber = positiveIntegerSubgroup(raw.subgroupNumber);
  if (subgroupNumber === null) {
    return { ok: false, code: "INVALID_SUBGROUP_NUMBER" };
  }

  return {
    ok: true,
    value: { courseGroupId, courseOfferingId, parentGroupId, groupName, subgroupNumber },
  };
}

// ============================================================================
// CHANGE DECISION
// ============================================================================

/**
 * Decide between an idempotent no-op and a real move, comparing ONLY the
 * authoritative CourseGroup ids.
 *
 *  - same `courseGroupId` → `NO_CHANGE` (a successful, idempotent no-op — never
 *    an error).
 *  - different `courseGroupId` → `APPLY_CHANGE`.
 *  - malformed target → explicit validation failure (`ok: false`).
 *
 * Authority is the CourseGroup id, never the mirror labels: two targets with
 * matching `groupName`/`subgroupNumber` but different `courseGroupId` still
 * decide `APPLY_CHANGE`.
 */
export function decideGroupChange(
  currentCourseGroupId: unknown,
  target: unknown,
): DecideGroupChangeResult {
  const current = nonEmptyTrimmed(currentCourseGroupId);
  if (current === null) {
    return { ok: false, code: "EMPTY_CURRENT_COURSE_GROUP_ID" };
  }

  const validated = validateResolvedTarget(target);
  if (!validated.ok) {
    return { ok: false, code: validated.code };
  }

  const decision: GroupChangeDecision =
    validated.value.courseGroupId === current ? "NO_CHANGE" : "APPLY_CHANGE";
  return { ok: true, decision };
}

// ============================================================================
// MIRROR MAPPING
// ============================================================================

/**
 * Derive the Student compatibility mirror from an already-validated resolved
 * target. Pure projection: it reads the target's pre-resolved `groupName` and
 * numeric `subgroupNumber` and never parses an arbitrary label.
 */
export function deriveGroupMirror(target: ResolvedTargetCourseGroup): GroupMirrorValue {
  return { groupName: target.groupName, subgroupNumber: target.subgroupNumber };
}

// ============================================================================
// POST-WRITE PARITY
// ============================================================================

/**
 * Verify that, after a write, the authoritative membership and the Student
 * mirror both converged onto the resolved target:
 *  - the current GroupMembership `courseGroupId` equals the target id;
 *  - the Student mirror `groupName` equals the target `groupName`;
 *  - the Student mirror `subgroupNumber` equals the target `subgroupNumber`.
 *
 * Returns a structured result listing every mismatch. Never throws and never
 * returns a Prisma-specific error — the future adapter maps a failure onto its
 * own public outcome.
 */
export function checkGroupChangeParity(
  observed: {
    membershipCourseGroupId: string;
    mirror: GroupMirrorValue;
  },
  target: ResolvedTargetCourseGroup,
): GroupChangeParityResult {
  const mismatches: ParityMismatchField[] = [];

  if (observed.membershipCourseGroupId !== target.courseGroupId) {
    mismatches.push("MEMBERSHIP_COURSE_GROUP_ID");
  }
  if (observed.mirror.groupName !== target.groupName) {
    mismatches.push("MIRROR_GROUP_NAME");
  }
  if (observed.mirror.subgroupNumber !== target.subgroupNumber) {
    mismatches.push("MIRROR_SUBGROUP_NUMBER");
  }

  return mismatches.length === 0 ? { ok: true } : { ok: false, mismatches };
}
