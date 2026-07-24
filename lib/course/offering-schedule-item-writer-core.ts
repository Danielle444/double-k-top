/**
 * MULTI-COURSE Schedule Slice W-S3A - the PURE core for the OFFERING-SCOPED
 * WeeklySchedule VIEW/EDIT writer (week metadata + per-item ownership).
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * cookies, no next/*, no React, no filesystem. It only validates raw metadata
 * input, decides week/item ownership from explicitly supplied arguments, and
 * SHAPES the metadata write payload - so the whole edit contract is
 * unit-testable without a database (see offering-schedule-item-writer.test.ts).
 *
 * WHY IT REUSES W-S2A's CORE
 * --------------------------
 * Week ownership ("does this week belong to this offering?") is answered by the
 * committed isWeekOwnedByOffering from offering-weekly-schedule-writer-core, and
 * the strict YYYY-MM-DD calendar-date rule by isValidDateKey. Importing both
 * (rather than re-deriving them) guarantees the view/edit side answers ownership
 * and date validity IDENTICALLY to the create/re-import side.
 *
 * WHAT LIVES HERE (and nowhere else in this slice)
 * ------------------------------------------------
 *  - validateWeekMetadataInput: the ONE metadata-only validation contract. It is
 *    NOT the schedule-item validation contract - the item create/edit/delete
 *    actions delegate to the existing schedule-items.ts server actions, which own
 *    the single zod schedule-item schema, so no competing item validator exists.
 *  - buildWeekMetadataUpdateData: the metadata write payload. It has NO
 *    courseOfferingId key and NO isPublished key at the type level, so a metadata
 *    edit is structurally incapable of retargeting a week's course ownership or
 *    flipping publication. It carries ONLY name/startDate/endDate, so items are
 *    never referenced, replaced or deleted by a metadata edit.
 *  - isItemOwnedByOffering: the item -> week -> offering ownership predicate,
 *    expressed on top of isWeekOwnedByOffering so item ownership can never drift
 *    from week ownership.
 *
 * Every failure is a stable, non-PII code. Raw input is never reflected back.
 */
import { parseDateKey } from "@/lib/dates";
import {
  isValidDateKey,
  isWeekOwnedByOffering,
} from "@/lib/course/offering-weekly-schedule-writer-core";

// ---------------------------------------------------------------------------
// Metadata validation
// ---------------------------------------------------------------------------

/** Stable, non-PII metadata validation error codes. */
export type WeekMetadataValidationErrorCode =
  | "name_required"
  | "dates_required"
  | "invalid_date"
  | "end_before_start";

/**
 * The raw, untrusted metadata payload. `courseOfferingId` is deliberately ABSENT:
 * the offering is a server-bound argument resolved by the IO layer, never part of
 * the validated client input, so there is no field here through which a caller
 * could name (or retarget) a course. There is likewise no items key, no
 * isPublished key and no uploadedFileName key - a metadata edit touches none of
 * those.
 */
export interface RawWeekMetadataInput {
  readonly name: unknown;
  readonly startDate: unknown;
  readonly endDate: unknown;
}

/** The normalized, validated week metadata the payload builder operates on. */
export interface ValidatedWeekMetadata {
  readonly name: string;
  readonly startDateKey: string;
  readonly endDateKey: string;
}

/** Discriminated validation result: a normalized value, or a stable code. */
export type ValidateWeekMetadataResult =
  | { readonly ok: true; readonly value: ValidatedWeekMetadata }
  | { readonly ok: false; readonly error: WeekMetadataValidationErrorCode };

/** A runtime value trimmed to a string, or null when it is not a string. */
function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" ? value.trim() : null;
}

/**
 * Validate and normalize a metadata-only edit. Returns a normalized value, or a
 * stable code for the FIRST failed rule, in this fixed order:
 *
 *   name -> date presence -> date format -> date ordering
 *
 *   - a non-string / absent / empty / whitespace-only name -> "name_required";
 *   - either date absent, non-string or blank                -> "dates_required";
 *   - either date not a strict YYYY-MM-DD calendar key       -> "invalid_date";
 *   - startDate strictly after endDate                       -> "end_before_start".
 *
 * The ordering rule (start <= end) is enforced here because a metadata edit is a
 * deliberate, standalone action - unlike the importer, which never invented one.
 * A strict YYYY-MM-DD key sorts lexicographically exactly as it does
 * chronologically, so the plain string comparison is a correct date comparison.
 * Never throws, never reflects raw input.
 */
export function validateWeekMetadataInput(
  input: RawWeekMetadataInput,
): ValidateWeekMetadataResult {
  const name = asTrimmedString(input.name);
  if (name === null || name === "") {
    return { ok: false, error: "name_required" };
  }

  const startDate = asTrimmedString(input.startDate);
  const endDate = asTrimmedString(input.endDate);
  if (startDate === null || startDate === "" || endDate === null || endDate === "") {
    return { ok: false, error: "dates_required" };
  }

  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    return { ok: false, error: "invalid_date" };
  }

  if (startDate > endDate) {
    return { ok: false, error: "end_before_start" };
  }

  return {
    ok: true,
    value: { name, startDateKey: startDate, endDateKey: endDate },
  };
}

// ---------------------------------------------------------------------------
// Metadata write payload
// ---------------------------------------------------------------------------

/**
 * The metadata UPDATE payload. It has NO courseOfferingId key and NO isPublished
 * key - at the type level - so a metadata edit is structurally incapable of
 * erasing, adopting or retargeting course ownership, or of changing publication.
 * It carries no items reference either, so existing ScheduleItem rows (their ids
 * and count) are provably untouched by a metadata edit.
 */
export interface WeekMetadataUpdateData {
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
}

/** Build the metadata UPDATE payload - exactly three columns, nothing else. */
export function buildWeekMetadataUpdateData(
  metadata: ValidatedWeekMetadata,
): WeekMetadataUpdateData {
  return {
    name: metadata.name,
    startDate: parseDateKey(metadata.startDateKey),
    endDate: parseDateKey(metadata.endDateKey),
  };
}

// ---------------------------------------------------------------------------
// Item -> week -> offering ownership
// ---------------------------------------------------------------------------

/**
 * The ONLY columns an item ownership check may read: the item's own id, its
 * parent week id, and that week's courseOfferingId. No item content, no other
 * item, no publication state.
 */
export interface ItemWeekOwnerRow {
  readonly id: string;
  readonly weeklyScheduleId: string;
  readonly weekCourseOfferingId: string | null;
}

/**
 * The item-mutation ownership predicate: item -> weeklySchedule ->
 * courseOfferingId. ALL of the following must hold:
 *
 *  1. the item exists and carries a non-empty parent week id;
 *  2. its parent week is owned by the resolved offering, decided by the SAME
 *     committed isWeekOwnedByOffering the create/re-import side uses (non-null,
 *     strict === on the exact offering id - a NULL-scoped or foreign week fails).
 *
 * So a missing item, an item whose week is NULL-scoped, and an item whose week
 * belongs to another offering are ALL rejected - and, because the caller collapses
 * them to one contained result, they are indistinguishable to the client.
 */
export function isItemOwnedByOffering(
  item: ItemWeekOwnerRow | null | undefined,
  resolvedOfferingId: string,
): boolean {
  if (!item) {
    return false;
  }
  if (typeof item.weeklyScheduleId !== "string" || item.weeklyScheduleId.length === 0) {
    return false;
  }
  return isWeekOwnedByOffering(
    { courseOfferingId: item.weekCourseOfferingId },
    resolvedOfferingId,
  );
}
