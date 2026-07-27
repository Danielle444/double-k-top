/**
 * P-MATERIALS M2A - the PURE core for course-material AUDIENCE input validation
 * and audience-row reconciliation.
 *
 * PURE by construction: no Prisma, no database, no IO, no `next/headers`, no
 * cookies, no session, no auth, no clock (`Date.now()` / argument-less
 * `new Date()`), no randomness, no environment access, no network, no logging,
 * no `localeCompare`, no timezone logic, no React, and no `"use server"`
 * directive. Every function decides from its arguments alone, so the whole
 * contract is unit-testable without a database (see
 * material-audience-reconcile-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * A course material is scoped to one or more CourseOfferings through the
 * additive audience join added by P-MATERIALS M0. The later writer slice (M2B)
 * must, on every create/edit and across BOTH write paths (the LINK server
 * action and the FILE upload route), turn a raw admin selection into a validated
 * offering-id set and then into a minimal create/delete plan against the rows
 * that already exist. This module owns exactly those two pure decisions so the
 * two write paths share ONE tested contract rather than re-deriving it.
 *
 * FAIL-CLOSED ON IDENTIFIERS (PII-FREE)
 * -------------------------------------
 * Malformed input throws a typed domain error carrying ONLY a stable code, an
 * optional field name, and a positional index - never the rejected value. A bad
 * id is never trimmed into validity, never silently dropped, and never repaired:
 * dropping one bad id would turn a data defect into a partial write that is
 * indistinguishable from a correct one. This mirrors the fail-closed identifier
 * discipline of ./capabilities/material-notification-recipient-core.ts
 * (MaterialNotificationIdError).
 *
 * UNWIRED IN THIS SLICE (M2A): nothing in the repository imports this module.
 * The M0 unwired-runtime invariant therefore still holds.
 */

// ---------------------------------------------------------------------------
// Typed, PII-free domain error
// ---------------------------------------------------------------------------

/** The closed, code-owned set of audience-input failure codes. */
export type MaterialAudienceInputErrorCode = "NOT_ARRAY" | "EMPTY_SELECTION" | "INVALID_ID";

/**
 * A malformed audience-input refusal.
 *
 * PII-FREE BY CONSTRUCTION: it carries only a stable `code`, an optional
 * code-owned `field` name, and the positional `index` of the offending element
 * (null when the failure is not element-specific). The offending VALUE is never
 * placed on the error, never interpolated into the message, and never stored on
 * the instance - so this error can be logged or surfaced without disclosing an
 * offering id or any fragment of whatever malformed data produced it.
 */
export class MaterialAudienceInputError extends Error {
  readonly code: MaterialAudienceInputErrorCode;
  readonly field: string | null;
  readonly index: number | null;

  constructor(
    code: MaterialAudienceInputErrorCode,
    options: { field?: string; index?: number } = {},
  ) {
    const field = options.field ?? null;
    const index = options.index ?? null;
    const locus =
      index !== null
        ? ` at index ${index}${field !== null ? ` (${field})` : ""}`
        : field !== null
          ? ` (${field})`
          : "";
    super(
      `Material audience input refused: ${code}${locus}. A malformed identifier ` +
        `is never trimmed into validity, dropped, or repaired.`,
    );
    this.name = "MaterialAudienceInputError";
    this.code = code;
    this.field = field;
    this.index = index;
  }
}

// ---------------------------------------------------------------------------
// Identifier validity (shared)
// ---------------------------------------------------------------------------

/**
 * Is `value` a usable identifier?
 *
 * `trim()` is used ONLY as an emptiness test - it never touches the value that
 * is compared, deduplicated, or returned. NOTHING here normalizes an identifier:
 * an id that is valid is emitted byte-for-byte as supplied, so two ids can never
 * be collapsed into one by whitespace folding, case folding, or any other
 * rewriting.
 */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/**
 * Validate and normalize an admin-supplied selection of CourseOffering ids for a
 * course material.
 *
 * Contract:
 *  - `input` MUST be an array          -> else MaterialAudienceInputError NOT_ARRAY;
 *  - every element MUST be a non-blank string
 *                                      -> else INVALID_ID with the element index;
 *  - accepted ids are kept BYTE-FOR-BYTE (never trimmed or rewritten);
 *  - exact duplicates are collapsed, first-seen order preserved;
 *  - a selection that is empty (or contained only... it never can, since any
 *    valid element survives) yields EMPTY_SELECTION;
 *  - the returned array is FROZEN.
 *
 * A malformed element is never silently removed: the whole selection is refused,
 * so a create/edit either stores exactly the admin's intent or fails loudly.
 */
export function normalizeMaterialAudienceOfferingIds(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new MaterialAudienceInputError("NOT_ARRAY", { field: "courseOfferingIds" });
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < input.length; index++) {
    const value = input[index];
    if (!isUsableId(value)) {
      throw new MaterialAudienceInputError("INVALID_ID", {
        field: "courseOfferingId",
        index,
      });
    }
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ids.push(value);
  }

  if (ids.length === 0) {
    throw new MaterialAudienceInputError("EMPTY_SELECTION", { field: "courseOfferingIds" });
  }

  return Object.freeze(ids);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * One already-persisted audience join row, projected to just the two fields the
 * diff needs: its own primary key `id` and the `courseOfferingId` it targets.
 */
export interface MaterialAudienceRow {
  readonly id: string;
  readonly courseOfferingId: string;
}

/** The minimal create/delete plan produced by {@link reconcileMaterialAudiences}. */
export interface MaterialAudienceReconciliation {
  /** courseOfferingIds that have no existing row and must be inserted. */
  readonly toCreate: readonly string[];
  /** existing audience-row ids whose offering is no longer desired. */
  readonly toDelete: readonly string[];
}

/**
 * Compute the minimal set of audience-row inserts and deletes that move the
 * persisted audience of one material from `existing` to `desiredOfferingIds`.
 *
 * `desiredOfferingIds` is expected to have already passed
 * {@link normalizeMaterialAudienceOfferingIds}, but this function still fails
 * safely for malformed runtime input (a blank/non-string desired id, or a
 * malformed existing row) with MaterialAudienceInputError, so a caller that
 * bypasses normalization can never smuggle `undefined` into the diff.
 *
 * Contract:
 *  - `toCreate`  = desired ids with NO existing row, in desired (first-seen)
 *                  order, deduplicated;
 *  - `toDelete`  = existing row ids whose `courseOfferingId` is not desired, in
 *                  existing-row order, deduplicated by row id;
 *  - a row whose offering is still desired is neither deleted nor recreated
 *    (unchanged rows are untouched);
 *  - duplicate existing rows for one offering never yield a duplicate delete id;
 *  - inputs are never mutated; the result and both arrays are FROZEN;
 *  - idempotent: when `existing` already matches `desiredOfferingIds` exactly,
 *    both arrays are empty.
 */
export function reconcileMaterialAudiences(
  desiredOfferingIds: readonly string[],
  existing: readonly MaterialAudienceRow[],
): MaterialAudienceReconciliation {
  if (!Array.isArray(desiredOfferingIds)) {
    throw new MaterialAudienceInputError("NOT_ARRAY", { field: "desiredOfferingIds" });
  }
  if (!Array.isArray(existing)) {
    throw new MaterialAudienceInputError("NOT_ARRAY", { field: "existing" });
  }

  // Desired offerings, validated and first-seen-deduplicated. The Set of desired
  // offering ids drives both "which existing rows survive" and "which desired
  // ids still need a row".
  const desiredSet = new Set<string>();
  const desiredOrder: string[] = [];
  for (let index = 0; index < desiredOfferingIds.length; index++) {
    const value = desiredOfferingIds[index];
    if (!isUsableId(value)) {
      throw new MaterialAudienceInputError("INVALID_ID", {
        field: "desiredOfferingId",
        index,
      });
    }
    if (desiredSet.has(value)) {
      continue;
    }
    desiredSet.add(value);
    desiredOrder.push(value);
  }

  // Offerings that already have at least one row: any desired offering in this
  // set needs no insert; any existing offering NOT desired must be deleted.
  const existingOfferingIds = new Set<string>();
  for (let index = 0; index < existing.length; index++) {
    const row = existing[index];
    if (
      row === null ||
      typeof row !== "object" ||
      !isUsableId((row as MaterialAudienceRow).id) ||
      !isUsableId((row as MaterialAudienceRow).courseOfferingId)
    ) {
      throw new MaterialAudienceInputError("INVALID_ID", { field: "existing", index });
    }
    existingOfferingIds.add(row.courseOfferingId);
  }

  const toCreate: string[] = [];
  for (const offeringId of desiredOrder) {
    if (!existingOfferingIds.has(offeringId)) {
      toCreate.push(offeringId);
    }
  }

  const seenDeleteIds = new Set<string>();
  const toDelete: string[] = [];
  for (const row of existing) {
    if (desiredSet.has(row.courseOfferingId)) {
      continue;
    }
    if (seenDeleteIds.has(row.id)) {
      continue;
    }
    seenDeleteIds.add(row.id);
    toDelete.push(row.id);
  }

  return Object.freeze({
    toCreate: Object.freeze(toCreate),
    toDelete: Object.freeze(toDelete),
  });
}
