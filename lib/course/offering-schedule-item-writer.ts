/**
 * MULTI-COURSE Schedule Slice W-S3A - server-side IO orchestration for the
 * OFFERING-SCOPED WeeklySchedule VIEW/EDIT operations:
 *
 *   1. authorizeOfferingWeekTarget  - prove a WEEK belongs to an offering
 *                                     (used by: read gate, item CREATE);
 *   2. authorizeOfferingItemTarget  - prove an ITEM's week belongs to an offering
 *                                     (used by: item UPDATE / DELETE);
 *   3. updateOfferingWeekMetadata   - atomically update a week's name/dates ONLY,
 *                                     scoped by (id AND courseOfferingId).
 *
 * The offering is NEVER inferred - not from dates, week name, level, group,
 * schedule contents, a cookie, resolveCurrentCourseOffering, or a Level 1
 * fallback. It is the exact id the caller passes, re-validated through
 * requireAdminCourseOffering (admin-authorization-first, exact-id lookup, no
 * fallback).
 *
 * COMMON ORDERING (hard safety contract for every operation here):
 *   1. resolve EXACTLY the requested offering; CourseOfferingNotFoundError ->
 *      "offering_not_found";
 *   2. gate by the offering's status via the pure default-deny operation policy
 *      under SCHEDULE_DRAFT_CONFIGURATION (PLANNED allowed - Level 2 can be edited
 *      before it goes ACTIVE; ACTIVE allowed; ARCHIVED denied) ->
 *      CourseOperationNotPermittedError -> "operation_not_allowed";
 *   3. prove ownership of the exact target (week, or item -> week). A missing,
 *      NULL-scoped or other-offering target ALL collapse to the SAME
 *      "week_not_found", so an id can never be probed across courses;
 *   4. only then (for a metadata write) mutate.
 *
 * WHY ITEM WRITES ARE NOT DONE HERE
 * ---------------------------------
 * This module proves ownership; the actual ScheduleItem create/update/delete is
 * delegated by the action layer to the committed schedule-items.ts server actions,
 * which own the single zod schedule-item validation schema. That keeps ONE
 * item-validation contract in the codebase. The metadata write, by contrast, has
 * no pre-existing action, so it is performed here - as an updateMany scoped by
 * (id AND courseOfferingId), which makes the ownership proof and the write a
 * single atomic statement (a foreign/NULL/missing week matches zero rows ->
 * "week_not_found", never a blind write).
 *
 * The pure decisions live in offering-schedule-item-writer-core.ts; the
 * orchestration is dependency-injected so a DB-free test proves the whole
 * boundary. The thin prod wrappers bind the real Prisma client and the real
 * admin/offering resolver.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "./admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "./operation-policy-core";
import { isWeekOwnedByOffering } from "./offering-weekly-schedule-writer-core";
import type { WeekOwnerRow } from "./offering-weekly-schedule-writer-core";
import {
  buildWeekMetadataUpdateData,
  isItemOwnedByOffering,
  validateWeekMetadataInput,
  type ItemWeekOwnerRow,
  type RawWeekMetadataInput,
  type WeekMetadataValidationErrorCode,
} from "./offering-schedule-item-writer-core";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** The three IO outcomes shared by every operation in this module. */
export type OfferingScheduleOwnershipErrorCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "week_not_found";

/** The full metadata error surface: validation codes plus the ownership codes. */
export type OfferingWeekMetadataErrorCode =
  | WeekMetadataValidationErrorCode
  | OfferingScheduleOwnershipErrorCode;

/** The narrow, validated offering context these operations need (id + status). */
export interface ResolvedOfferingForScheduleEdit {
  readonly id: string;
  readonly status: CourseOfferingStatus;
}

/**
 * A proven-ownership result: on success it carries the SERVER-authoritative
 * weeklyScheduleId (for an item target, the id read from the stored item, never
 * the caller's string), so the caller writes and revalidates against that.
 */
export type OwnershipResult =
  | { readonly ok: true; readonly weeklyScheduleId: string }
  | { readonly ok: false; readonly error: OfferingScheduleOwnershipErrorCode };

/** Metadata update result: a stable code, or the affected week id. */
export type OfferingWeekMetadataResult =
  | { readonly success: true; readonly weeklyScheduleId: string }
  | { readonly success: false; readonly error: OfferingWeekMetadataErrorCode };

// ---------------------------------------------------------------------------
// Injected boundaries
// ---------------------------------------------------------------------------

/** Resolve + gate: shared by every operation. */
export interface OfferingResolveDeps {
  resolveOffering: (
    courseOfferingId: string,
  ) => Promise<ResolvedOfferingForScheduleEdit>;
}

/** Deps for proving a WEEK target (read gate, item create). */
export interface WeekTargetDeps extends OfferingResolveDeps {
  fetchWeekOwner: (weeklyScheduleId: string) => Promise<WeekOwnerRow | null>;
}

/** Deps for proving an ITEM target (item update / delete). */
export interface ItemTargetDeps extends OfferingResolveDeps {
  fetchItemOwner: (itemId: string) => Promise<ItemWeekOwnerRow | null>;
}

/** Deps for the metadata write (atomic ownership-scoped update). */
export interface MetadataWriteDeps extends OfferingResolveDeps {
  /**
   * Update ONLY name/startDate/endDate of the row matching BOTH the id and the
   * courseOfferingId, and return how many rows matched (0 => not owned / missing).
   * The implementation must never widen the where clause or the data set.
   */
  commitMetadata: (args: {
    weeklyScheduleId: string;
    courseOfferingId: string;
    data: { name: string; startDate: Date; endDate: Date };
  }) => Promise<number>;
}

// ---------------------------------------------------------------------------
// Shared resolve + status gate
// ---------------------------------------------------------------------------

/**
 * Resolve the exact offering and apply the draft-configuration status gate. A
 * typed not-found fails closed with a stable code; a typed policy denial likewise;
 * auth redirects and unexpected errors propagate untouched.
 */
async function resolveAndGate(
  courseOfferingId: string,
  deps: OfferingResolveDeps,
): Promise<
  | { ok: true; offering: ResolvedOfferingForScheduleEdit }
  | { ok: false; error: "offering_not_found" | "operation_not_allowed" }
> {
  let offering: ResolvedOfferingForScheduleEdit;
  try {
    offering = await deps.resolveOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { ok: false, error: "offering_not_found" };
    }
    throw error;
  }

  try {
    assertCourseOperationAllowed(offering.status, "SCHEDULE_DRAFT_CONFIGURATION");
  } catch (error) {
    if (error instanceof CourseOperationNotPermittedError) {
      return { ok: false, error: "operation_not_allowed" };
    }
    throw error;
  }

  return { ok: true, offering };
}

// ---------------------------------------------------------------------------
// Ownership orchestration
// ---------------------------------------------------------------------------

/**
 * Prove a WEEK belongs to the offering. Order: resolve+gate -> fetch the week's
 * owner columns -> strict ownership. Missing / NULL-scoped / other-offering all
 * collapse to "week_not_found".
 */
export async function authorizeOfferingWeekTargetWithDeps(
  courseOfferingId: string,
  weeklyScheduleId: string,
  deps: WeekTargetDeps,
): Promise<OwnershipResult> {
  const gate = await resolveAndGate(courseOfferingId, deps);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const owner = await deps.fetchWeekOwner(weeklyScheduleId);
  if (!isWeekOwnedByOffering(owner, gate.offering.id)) {
    return { ok: false, error: "week_not_found" };
  }

  // Use the STORED id, never the caller's string.
  return { ok: true, weeklyScheduleId: (owner as WeekOwnerRow).id };
}

/**
 * Prove an ITEM's week belongs to the offering. Order: resolve+gate -> fetch the
 * item's (id, weeklyScheduleId, week.courseOfferingId) -> item->week->offering
 * ownership. Missing item / NULL-scoped week / other-offering week all collapse to
 * "week_not_found". Returns the item's STORED parent week id.
 */
export async function authorizeOfferingItemTargetWithDeps(
  courseOfferingId: string,
  itemId: string,
  deps: ItemTargetDeps,
): Promise<OwnershipResult> {
  const gate = await resolveAndGate(courseOfferingId, deps);
  if (!gate.ok) {
    return { ok: false, error: gate.error };
  }

  const owner = await deps.fetchItemOwner(itemId);
  if (!isItemOwnedByOffering(owner, gate.offering.id)) {
    return { ok: false, error: "week_not_found" };
  }

  return { ok: true, weeklyScheduleId: (owner as ItemWeekOwnerRow).weeklyScheduleId };
}

/**
 * Update ONLY a week's name/startDate/endDate, scoped to (id AND
 * courseOfferingId). Order: PURE validation -> resolve+gate -> atomic
 * ownership-scoped update. A zero-row update (missing / NULL-scoped /
 * other-offering week) becomes "week_not_found". Items are never referenced, so
 * their ids and count are provably preserved; the payload has no courseOfferingId
 * and no isPublished key, so ownership and publication are provably unchanged.
 */
export async function updateOfferingWeekMetadataWithDeps(
  input: { courseOfferingId: string; weeklyScheduleId: string } & RawWeekMetadataInput,
  deps: MetadataWriteDeps,
): Promise<OfferingWeekMetadataResult> {
  const validated = validateWeekMetadataInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  const gate = await resolveAndGate(input.courseOfferingId, deps);
  if (!gate.ok) {
    return { success: false, error: gate.error };
  }

  const count = await deps.commitMetadata({
    weeklyScheduleId: input.weeklyScheduleId,
    courseOfferingId: gate.offering.id,
    data: buildWeekMetadataUpdateData(validated.value),
  });

  if (count === 0) {
    return { success: false, error: "week_not_found" };
  }

  return { success: true, weeklyScheduleId: input.weeklyScheduleId };
}

// ---------------------------------------------------------------------------
// Production-bound wrappers
// ---------------------------------------------------------------------------

const resolveOffering = async (
  courseOfferingId: string,
): Promise<ResolvedOfferingForScheduleEdit> => {
  const context = await requireAdminCourseOffering(courseOfferingId);
  return { id: context.id, status: context.status };
};

const fetchWeekOwner = (weeklyScheduleId: string) =>
  prisma.weeklySchedule.findUnique({
    where: { id: weeklyScheduleId },
    select: { id: true, courseOfferingId: true },
  });

const fetchItemOwner = (itemId: string) =>
  prisma.scheduleItem
    .findUnique({
      where: { id: itemId },
      select: {
        id: true,
        weeklyScheduleId: true,
        weeklySchedule: { select: { courseOfferingId: true } },
      },
    })
    .then((row) =>
      row === null
        ? null
        : {
            id: row.id,
            weeklyScheduleId: row.weeklyScheduleId,
            weekCourseOfferingId: row.weeklySchedule.courseOfferingId,
          },
    );

/** Prove a week belongs to the offering (read gate / item create). */
export function authorizeOfferingWeekTarget(
  courseOfferingId: string,
  weeklyScheduleId: string,
): Promise<OwnershipResult> {
  return authorizeOfferingWeekTargetWithDeps(courseOfferingId, weeklyScheduleId, {
    resolveOffering,
    fetchWeekOwner,
  });
}

/** Prove an item's week belongs to the offering (item update / delete). */
export function authorizeOfferingItemTarget(
  courseOfferingId: string,
  itemId: string,
): Promise<OwnershipResult> {
  return authorizeOfferingItemTargetWithDeps(courseOfferingId, itemId, {
    resolveOffering,
    fetchItemOwner,
  });
}

/**
 * Metadata-only update. The commit is a single prisma.weeklySchedule.updateMany
 * whose where clause carries BOTH the id and the courseOfferingId, so ownership
 * is proven by the write itself, and whose data carries ONLY the three metadata
 * columns - no items relation, no courseOfferingId, no isPublished.
 */
export function updateOfferingWeekMetadata(
  input: { courseOfferingId: string; weeklyScheduleId: string } & RawWeekMetadataInput,
): Promise<OfferingWeekMetadataResult> {
  return updateOfferingWeekMetadataWithDeps(input, {
    resolveOffering,
    commitMetadata: async ({ weeklyScheduleId, courseOfferingId, data }) => {
      const result = await prisma.weeklySchedule.updateMany({
        where: { id: weeklyScheduleId, courseOfferingId },
        data,
      });
      return result.count;
    },
  });
}
