/**
 * SECURITY / LEVEL 2 SLICE L2-MATERIAL-NOTIFY-1 - the PURE core for the
 * COURSE-SCOPED material-added notification fan-out.
 *
 * PURE by construction: no Prisma, no database, no `next/headers`, no cookies,
 * no session, no auth, no clock, no randomness, no environment access, no
 * network, no logging, no React, and no "use server" directive. Every function
 * decides from its arguments alone, so the whole contract is unit-testable
 * without a database (see material-notification-recipient-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * The committed fan-out (lib/actions/notifications.ts) resolves trainee
 * recipients from a GLOBAL `Student.isActive` query. It consults no offering, no
 * enrollment and no capability, so a Level 1 material add materializes a
 * Notification row - carrying the material's real title in `body` - for every
 * Level 2 trainee, even though the trainee materials reader correctly denies
 * them the document itself. This slice supplies the pieces the later IO shell
 * needs to replace that global query with an offering-scoped one.
 *
 * WHAT THIS DELIBERATELY DOES **NOT** DO
 * --------------------------------------
 * It does NOT model, re-implement, mirror, or approximate effective-capability
 * evaluation. Row absence, READ_ONLY, catalog retirement, malformed status,
 * duplicate rows and dependency clamping are ALREADY owned - and already tested
 * - by ./effective-capability-core.ts behind the committed
 * getEffectiveCapabilities reader. Restating any part of that decision here
 * would create a second, silently-drifting authorization path, which is exactly
 * the failure mode this codebase's capability layer was built to avoid. The
 * later IO shell calls that committed reader per candidate offering and keeps an
 * offering only on a positively enabled COURSE_MATERIALS status; this module
 * never sees a capability status at all.
 *
 * It also owns NO course-scope inference of any kind. There is deliberately no
 * parameter here through which a caller could supply - or this module could
 * consult - a date, a level number, a course name, an activity year, a group
 * name, a subgroup number, or a hardcoded offering id.
 *
 * FAIL-CLOSED ON IDENTIFIERS
 * --------------------------
 * A blank or non-string identifier REFUSES the whole fan-out by throwing. It is
 * never skipped, never coerced, and never repaired: silently dropping one bad id
 * would turn a data defect into a partial send that is indistinguishable from a
 * correct one, and silently repairing it would invent a recipient.
 *
 * P-MATERIALS M3A - EXTENDED WITH THE FULL PURE DECISION SET
 * ----------------------------------------------------------
 * The original slice supplied the visibility predicate, the capability key and
 * the two identifier dedupers. M3A adds the remaining pure decisions the later
 * IO shell needs, all of them additive - no existing export changed shape or
 * behaviour:
 *
 *   - shouldMaterialNotifyTrainees ................ the material gate;
 *   - resolveEligibleMaterialNotificationOfferingIds  which audience offerings
 *                                                    may notify at all;
 *   - resolveMaterialNotificationRecipientIds ..... offerings -> trainee ids,
 *                                                    collapsed to one per
 *                                                    trainee;
 *   - resolveNewlyEligibleMaterialNotificationRecipientIds ... the delta that
 *                                                    keeps an audience edit from
 *                                                    re-notifying trainees who
 *                                                    could already see the
 *                                                    material.
 *
 * Every lifecycle and capability verdict arrives as an ALREADY-RESOLVED boolean.
 * This module accepts no status string, compares no lifecycle value, and reads
 * no database column, so it cannot become a second interpretation of any rule
 * that is owned elsewhere. The new functions return FROZEN arrays; the two
 * original dedupers keep returning ordinary arrays exactly as before, since
 * changing that would be a behaviour change to a committed contract.
 *
 * WIRED BY P-MATERIALS M3B: this pure decision core is imported by EXACTLY ONE
 * approved production module - the material-notification trainee-recipient shell
 * (./material-notification-trainee-recipients.ts), which supplies the resolved
 * booleans these functions consume. That one-importer rule is enforced by this
 * module's own test suite, because a second consumer would be a second
 * recipient-resolution path free to drift from this one.
 *
 * The architectural boundary is UNCHANGED by that wiring: database access,
 * capability resolution and notification writes all remain OUTSIDE this module.
 * It stays pure - no database client, no "use server" directive, no session or
 * authorization logic - and M3B added no runtime behaviour to it.
 */
import type { CapabilityKey } from "./capability-keys";

// ---------------------------------------------------------------------------
// The capability key
// ---------------------------------------------------------------------------

/**
 * The single capability that authorizes any trainee material notification.
 *
 * It is the EXISTING canonical key added by L2-M1A and already enforced by the
 * trainee materials READER (L2-M1C) - deliberately the same key, so a notice
 * about a material can never reach a trainee whose offering is denied the
 * material itself. This slice invents no key and reuses no unrelated one. The
 * `CapabilityKey` annotation makes a typo a compile error.
 */
export const MATERIAL_NOTIFICATION_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";

// ---------------------------------------------------------------------------
// Audience predicate
// ---------------------------------------------------------------------------

/**
 * Does this material's visibility address TRAINEES at all?
 *
 * Positive allow-list (`"STUDENTS"` or `"BOTH"`), never a negative
 * `!== "INSTRUCTORS"` test: `undefined`, `null`, `""`, a number, an object, a
 * casing variant, and any future or misspelled visibility value must all answer
 * `false` rather than accidentally opening the trainee path.
 *
 * The parameter is `unknown` on purpose. The persisted visibility domain lives
 * on the Prisma enum and its mirror in lib/actions/materials.ts, which is a
 * `"use server"` module this pure core must not import; accepting `unknown` lets
 * the check be genuinely defensive instead of trusting a compile-time type that
 * says nothing about the value actually read back from the database.
 */
export function shouldNotifyTrainees(visibility: unknown): boolean {
  return visibility === "STUDENTS" || visibility === "BOTH";
}

// ---------------------------------------------------------------------------
// Identifier refusal
// ---------------------------------------------------------------------------

/** Which identifier list a refusal came from. A closed, code-owned set. */
export type MaterialNotificationIdField = "courseOfferingId" | "studentId";

/**
 * A malformed-identifier refusal.
 *
 * PII-FREE BY CONSTRUCTION: it carries only the field name (one of two
 * code-owned constants) and the positional index. The offending VALUE is never
 * placed on the error, never interpolated into the message, and never stored on
 * the instance - so this error can be logged or surfaced without disclosing a
 * trainee id, an offering id, a name, a phone number, an identity number, or any
 * fragment of whatever malformed data produced it.
 */
export class MaterialNotificationIdError extends Error {
  readonly field: MaterialNotificationIdField;
  readonly index: number;

  constructor(field: MaterialNotificationIdField, index: number) {
    super(
      `Material notification fan-out refused: ${field} at index ${index} is not a ` +
        `non-blank string. A malformed identifier is never skipped or repaired.`,
    );
    this.name = "MaterialNotificationIdError";
    this.field = field;
    this.index = index;
  }
}

/**
 * Validity test for one identifier.
 *
 * `trim()` is used ONLY as a test for emptiness - it never touches the value
 * that is compared, deduplicated or returned. NOTHING here normalizes an
 * identifier: an id that is valid is emitted byte-for-byte as supplied, so two
 * database ids can never be collapsed into one by whitespace folding, case
 * folding, or any other rewriting.
 */
function isUsableId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Shared first-seen deduplication over one projected identifier.
 *
 * Order is the caller's input order, which for the real IO shell is the database
 * result order - deterministic for identical input, and never re-sorted, so the
 * produced fan-out is reproducible.
 */
function dedupeIds(
  rows: readonly unknown[],
  field: MaterialNotificationIdField,
  read: (row: unknown) => unknown,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const value = row === null || row === undefined ? undefined : read(row);
    if (!isUsableId(value)) {
      throw new MaterialNotificationIdError(field, index);
    }
    if (seen.has(value)) continue;
    seen.add(value);
    ids.push(value);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Collapse capability rows to the unique candidate offering ids, in first-seen
 * order.
 *
 * The database's `@@unique([courseOfferingId, capabilityKey])` already prevents
 * a duplicate here for a single capability key, so this is defence in depth
 * rather than a repair: a duplicate collapses to ONE candidate instead of
 * causing the same offering's roster to be loaded - and its trainees notified -
 * twice.
 *
 * A blank or non-string id throws {@link MaterialNotificationIdError}.
 */
export function dedupeMaterialNotificationOfferingIds(
  rows: readonly { courseOfferingId: string }[],
): string[] {
  return dedupeIds(rows, "courseOfferingId", (row) => (row as { courseOfferingId: unknown }).courseOfferingId);
}

/**
 * Collapse enrollment rows to the unique recipient trainee ids, in first-seen
 * order.
 *
 * REQUIRED, not cosmetic: one Student may hold simultaneous ACTIVE enrollments
 * in several offerings, and `Notification` has no uniqueness constraint, so a
 * trainee enrolled in two enabled offerings would otherwise receive two
 * identical notifications for a single material.
 *
 * A blank or non-string id throws {@link MaterialNotificationIdError}.
 */
export function dedupeMaterialNotificationRecipientIds(
  rows: readonly { studentId: string }[],
): string[] {
  return dedupeIds(rows, "studentId", (row) => (row as { studentId: unknown }).studentId);
}

// ---------------------------------------------------------------------------
// M3A - shared internals for the eligibility / recipient / delta decisions
// ---------------------------------------------------------------------------

/**
 * TWO DIFFERENT FAILURE MODES, DELIBERATELY NOT UNIFIED
 * -----------------------------------------------------
 * An IDENTIFIER defect and a FLAG defect are not the same kind of problem, and
 * this module treats them differently on purpose:
 *
 *  - a malformed IDENTIFIER (blank / non-string) THROWS and refuses the whole
 *    fan-out. Skipping it would turn a data defect into a partial send that is
 *    indistinguishable from a correct one, and repairing it would invent a
 *    recipient;
 *  - a malformed FLAG (anything that is not the boolean `true`) EXCLUDES that
 *    row and never throws. Every flag reaching this module has already been
 *    decided upstream, so "not positively true" is a complete answer and must
 *    fail CLOSED - the row simply does not qualify. Throwing instead would let a
 *    single odd row block a fan-out that is otherwise perfectly resolvable.
 *
 * An ABSENT LIST (a non-array argument) is likewise not an identifier defect: it
 * carries no ids to be wrong about. It resolves to "no rows", which for a
 * fan-out means "notify nobody" - the safe direction. Malformed ids *inside* a
 * real array still throw.
 */

/** Read one property off a possibly-malformed row without ever throwing. */
function readRowField(row: unknown, field: string): unknown {
  if (row === null || row === undefined) return undefined;
  return (row as Record<string, unknown>)[field];
}

/** Coerce a possibly-absent list argument to an array, never throwing. */
function asRowList<T>(rows: unknown): readonly T[] {
  return Array.isArray(rows) ? (rows as readonly T[]) : [];
}

/**
 * Return `value` when it is a usable identifier, else refuse with the typed,
 * PII-free {@link MaterialNotificationIdError}. Never trims, never repairs.
 */
function requireUsableId(
  value: unknown,
  field: MaterialNotificationIdField,
  index: number,
): string {
  if (!isUsableId(value)) {
    throw new MaterialNotificationIdError(field, index);
  }
  return value;
}

/**
 * Validate + first-seen-deduplicate a bare list of offering ids by routing it
 * through the already-tested row-shaped dedupe above, so there is exactly ONE
 * identifier-refusal implementation for offering ids in this module. Indices in
 * a refusal refer to positions in the supplied list.
 */
function usableOfferingIdList(ids: unknown): readonly string[] {
  return dedupeMaterialNotificationOfferingIds(
    asRowList<unknown>(ids).map((courseOfferingId) => ({ courseOfferingId })) as {
      courseOfferingId: string;
    }[],
  );
}

/**
 * Validate + first-seen-deduplicate a bare list of trainee ids, routed through
 * the already-tested row-shaped dedupe for the same single-implementation
 * reason as {@link usableOfferingIdList}.
 */
function usableRecipientIdList(ids: unknown): readonly string[] {
  return dedupeMaterialNotificationRecipientIds(
    asRowList<unknown>(ids).map((studentId) => ({ studentId })) as { studentId: string }[],
  );
}

// ---------------------------------------------------------------------------
// The material gate
// ---------------------------------------------------------------------------

/**
 * May this material notify TRAINEES at all?
 *
 * Both halves are already-read values and both must be positively satisfied:
 * the material is live (`materialActive` is the boolean `true`, never a truthy
 * stand-in) AND its visibility addresses trainees via the existing
 * {@link shouldNotifyTrainees} allow-list. The visibility half is DELEGATED, not
 * restated - there is exactly one trainee-visibility predicate in this module
 * and a second one could silently drift from it.
 *
 * Both parameters are `unknown` on purpose, for the same reason
 * {@link shouldNotifyTrainees} is: these values are read back from the database,
 * and a compile-time type says nothing about what actually arrived. A hidden,
 * de-activated or instructor-only material therefore answers `false` rather than
 * quietly opening the trainee path.
 */
export function shouldMaterialNotifyTrainees(
  materialActive: unknown,
  visibility: unknown,
): boolean {
  return materialActive === true && shouldNotifyTrainees(visibility);
}

// ---------------------------------------------------------------------------
// Eligible offerings
// ---------------------------------------------------------------------------

/**
 * One candidate audience offering, carrying ALREADY-RESOLVED booleans.
 *
 * Neither flag is a status string, and that is the whole point: the offering
 * lifecycle decision and the effective-capability decision are both owned
 * upstream (the committed capability reader and the offering row itself). This
 * module receives their verdicts and must never re-derive, re-compare or
 * re-interpret them - a second interpretation here would be a silently-drifting
 * authorization path.
 */
export interface MaterialNotificationOfferingRow {
  readonly courseOfferingId: string;
  /** The offering itself is live. Resolved upstream from the offering row. */
  readonly offeringActive: boolean;
  /** The offering's effective course-materials capability is on. Resolved upstream. */
  readonly materialsCapabilityEnabled: boolean;
}

/**
 * The ordered, deduplicated offering ids whose trainees may be notified.
 *
 * An offering qualifies only when BOTH flags are strictly the boolean `true`.
 * A truthy non-boolean (`1`, `"true"`, `"ENABLED"`, `[]`) does NOT qualify: the
 * upstream decision must arrive as a real boolean, so a mis-shaped value fails
 * closed instead of granting a fan-out.
 *
 * EVERY row's identifier is validated, including rows that go on to be excluded
 * by their flags - a malformed id is a data defect wherever it sits, and letting
 * it pass unnoticed just because its row did not qualify would hide exactly the
 * kind of corruption this discipline exists to surface. The refusal's index is
 * therefore the position in the SUPPLIED array.
 *
 * The result is frozen and the input is never mutated.
 */
export function resolveEligibleMaterialNotificationOfferingIds(
  rows: readonly MaterialNotificationOfferingRow[],
): readonly string[] {
  const list = asRowList<MaterialNotificationOfferingRow>(rows);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < list.length; index++) {
    const row = list[index];
    const courseOfferingId = requireUsableId(
      readRowField(row, "courseOfferingId"),
      "courseOfferingId",
      index,
    );
    if (readRowField(row, "offeringActive") !== true) continue;
    if (readRowField(row, "materialsCapabilityEnabled") !== true) continue;
    if (seen.has(courseOfferingId)) continue;
    seen.add(courseOfferingId);
    ids.push(courseOfferingId);
  }
  return Object.freeze(ids);
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * One trainee enrollment considered for the fan-out, with ALREADY-RESOLVED
 * booleans (same rationale as {@link MaterialNotificationOfferingRow}).
 */
export interface MaterialNotificationEnrollmentRow {
  readonly studentId: string;
  readonly courseOfferingId: string;
  /** This enrollment is live. Resolved upstream from the enrollment row. */
  readonly enrollmentActive: boolean;
  /** The trainee account itself is live. Resolved upstream. */
  readonly traineeActive: boolean;
}

/**
 * The ordered, deduplicated trainee ids to notify for one already-resolved
 * eligible offering set.
 *
 * A row contributes its trainee only when `enrollmentActive` and `traineeActive`
 * are both strictly the boolean `true` AND its offering is in
 * `eligibleOfferingIds`.
 *
 * THE DEDUPLICATION IS THE POINT, not a tidiness pass. A trainee enrolled in two
 * offerings that BOTH appear in the audience of one shared material matches
 * twice; `Notification` has no uniqueness constraint, so without this collapse
 * that trainee would receive the same material notification twice. One trainee
 * appears at most once, at the position of their FIRST matching row.
 *
 * Both id columns of every row are validated (see
 * {@link resolveEligibleMaterialNotificationOfferingIds} for why exclusion does
 * not exempt a row), `studentId` before `courseOfferingId`, with the row's
 * position as the refusal index. `eligibleOfferingIds` is validated FIRST, so a
 * refusal that names an index in that list is reported before any row is read.
 *
 * The result is frozen and neither input is mutated.
 */
export function resolveMaterialNotificationRecipientIds(
  rows: readonly MaterialNotificationEnrollmentRow[],
  eligibleOfferingIds: readonly string[],
): readonly string[] {
  const eligible = new Set<string>(usableOfferingIdList(eligibleOfferingIds));
  const list = asRowList<MaterialNotificationEnrollmentRow>(rows);
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < list.length; index++) {
    const row = list[index];
    const studentId = requireUsableId(readRowField(row, "studentId"), "studentId", index);
    const courseOfferingId = requireUsableId(
      readRowField(row, "courseOfferingId"),
      "courseOfferingId",
      index,
    );
    if (readRowField(row, "enrollmentActive") !== true) continue;
    if (readRowField(row, "traineeActive") !== true) continue;
    if (!eligible.has(courseOfferingId)) continue;
    if (seen.has(studentId)) continue;
    seen.add(studentId);
    ids.push(studentId);
  }
  return Object.freeze(ids);
}

// ---------------------------------------------------------------------------
// The newly-eligible delta
// ---------------------------------------------------------------------------

/**
 * The trainees who become NEWLY able to see a material, given the recipients
 * resolved for its new audience and the recipients resolved for its previous
 * audience: `newAudienceRecipientIds` MINUS `previousAudienceRecipientIds`.
 *
 * WHY IT SUBTRACTS THE WHOLE PREVIOUS SET, NOT JUST THE RETAINED OFFERINGS
 * -----------------------------------------------------------------------
 * Consider a save that removes one offering and adds another (previous
 * {Level 1}, new {Level 2}) for a trainee enrolled in both. Under a
 * "still-reachable-through-a-retained-offering" rule they would be notified,
 * because the offering they had access through is gone - yet they could already
 * see the material before the save and can still see it after. Subtracting
 * everyone who was ALREADY a recipient is the smallest rule that is correct for
 * every combination of additions and removals, and it needs no notification
 * history - which matters, because notification history is not a usable ledger
 * of past access here.
 *
 * It follows that a pure removal, a re-save of an identical audience, and an
 * edit that touches no offering all yield an EMPTY result: nobody became newly
 * eligible, so nobody is notified.
 *
 * Both lists are validated with the same fail-closed identifier discipline
 * (`newAudienceRecipientIds` first, in parameter order). Order is first-seen
 * order within the new list; the result is frozen and neither input is mutated.
 */
export function resolveNewlyEligibleMaterialNotificationRecipientIds(
  newAudienceRecipientIds: readonly string[],
  previousAudienceRecipientIds: readonly string[],
): readonly string[] {
  const next = usableRecipientIdList(newAudienceRecipientIds);
  const previous = new Set<string>(usableRecipientIdList(previousAudienceRecipientIds));
  const ids: string[] = [];
  for (const studentId of next) {
    if (previous.has(studentId)) continue;
    ids.push(studentId);
  }
  return Object.freeze(ids);
}
