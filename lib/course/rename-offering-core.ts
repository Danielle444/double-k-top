/**
 * ACTIVE-RENAME - PURE validation core for renaming exactly one existing
 * CourseOffering (changing ONLY its name).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no auth, no
 * cookie, no env, no IO. It validates and normalizes the raw server-received
 * rename fields and returns either a normalized value object or a stable,
 * non-PII error code, so the whole input contract is unit-testable without a
 * database (see rename-offering-core.test.ts).
 *
 * NAME RULE REUSE: the new-name rule is NOT re-implemented here. It delegates to
 * validateOfferingName from create-offering-core.ts, so a renamed offering is
 * held to EXACTLY the same normalization (trim + non-empty, no maximum-length
 * bound) as a newly-created one. There is deliberately no second, drift-prone
 * copy of the offering-name rule.
 *
 * SCOPE: it validates ONLY the three fields a rename needs - the target offering
 * id, the expected current name (for optimistic stale-write protection), and the
 * requested new name - and reports whether the change is a same-name no-op. It
 * never decides the offering status gate (the IO layer's job via the operation
 * policy), never verifies the offering exists (a DB read the IO layer does), and
 * never touches status, dates, level, activityYear, groups, enrollments,
 * memberships, capabilities or any operational record.
 */
import { validateOfferingName } from "./create-offering-core";

/** Stable, non-PII validation error codes (never echo raw input to the client). */
export type RenameOfferingValidationErrorCode =
  | "offering_id_required"
  | "expected_name_required"
  | "name_required";

/** Raw, untrusted values as received from the action (each may be a non-string). */
export interface RawRenameOfferingInput {
  readonly courseOfferingId: unknown;
  readonly expectedCurrentName: unknown;
  readonly name: unknown;
}

/** The normalized, validated rename input the IO layer will act on. */
export interface ValidatedRenameOffering {
  readonly courseOfferingId: string;
  readonly expectedCurrentName: string;
  readonly name: string;
  /**
   * True when the normalized new name equals the (normalized) expected current
   * name. The IO layer treats this as a successful no-op and performs NO write.
   */
  readonly isNoOp: boolean;
}

/** Discriminated validation result: a normalized value, or a stable error code. */
export type ValidateRenameOfferingResult =
  | { readonly ok: true; readonly value: ValidatedRenameOffering }
  | { readonly ok: false; readonly error: RenameOfferingValidationErrorCode };

/** Trim a runtime value to a string, or null when it is not a string. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Validate and normalize the raw rename input. Returns a normalized value on
 * success or a stable error code on the FIRST failed rule, in a fixed order:
 * offering id -> expected current name -> new name. Never throws, never reflects
 * raw input.
 *
 *   - a non-string / absent / empty / whitespace-only courseOfferingId
 *     -> "offering_id_required";
 *   - a non-string / absent / empty / whitespace-only expectedCurrentName
 *     -> "expected_name_required" (the stale-write guard needs a concrete
 *     baseline to compare against);
 *   - a new name failing the shared offering-name rule -> "name_required";
 *   - otherwise the normalized triple is returned, with isNoOp set when the new
 *     name matches the expected current name (both already trimmed).
 */
export function validateRenameOfferingInput(
  input: RawRenameOfferingInput,
): ValidateRenameOfferingResult {
  const courseOfferingId = asTrimmedString(input.courseOfferingId);
  if (courseOfferingId === null || courseOfferingId === "") {
    return { ok: false, error: "offering_id_required" };
  }

  const expectedCurrentName = asTrimmedString(input.expectedCurrentName);
  if (expectedCurrentName === null || expectedCurrentName === "") {
    return { ok: false, error: "expected_name_required" };
  }

  const nameResult = validateOfferingName(input.name);
  if (!nameResult.ok) {
    // The shared rule's only failure code is "name_required".
    return { ok: false, error: nameResult.error };
  }
  const name = nameResult.value;

  return {
    ok: true,
    value: {
      courseOfferingId,
      expectedCurrentName,
      name,
      isNoOp: name === expectedCurrentName,
    },
  };
}
