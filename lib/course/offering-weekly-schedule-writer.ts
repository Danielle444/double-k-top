/**
 * MULTI-COURSE Schedule Slice W-S2A - server-side IO orchestration for the
 * OFFERING-SCOPED WeeklySchedule writer.
 *
 * ONE operation: create OR re-import exactly one WeeklySchedule (and replace its
 * ScheduleItem rows) for ONE EXPLICIT CourseOffering. The offering is never
 * inferred - not from dates, week name, level, group, schedule contents, a
 * cookie, resolveCurrentCourseOffering, or a Level 1 fallback. It is the exact id
 * the caller passes, re-validated through requireAdminCourseOffering
 * (admin-authorization-first, exact-id lookup, no fallback).
 *
 * ORDERING (hard safety contract - no read of a week and no write before EVERY
 * gate has passed):
 *   1. PURE input validation (no DB): a bad payload never reaches the offering
 *      resolver, the policy gate, the week lookup, or the commit;
 *   2. resolve EXACTLY the requested offering; CourseOfferingNotFoundError ->
 *      "offering_not_found";
 *   3. gate by the offering's status via the pure default-deny operation policy
 *      under SCHEDULE_DRAFT_CONFIGURATION (PLANNED: allowed - this is what lets a
 *      Level 2 week be prepared before the course goes ACTIVE; ACTIVE: allowed;
 *      ARCHIVED: denied) -> CourseOperationNotPermittedError ->
 *      "operation_not_allowed";
 *   4. RE-IMPORT ONLY: fetch the week's owner columns and require STRICT
 *      ownership by the resolved offering. Missing, NULL-scoped and
 *      other-offering all collapse to the SAME "week_not_found", so a week id can
 *      never be probed across courses;
 *   5. only then commit, inside a single transaction.
 *
 * CREATE always writes the SERVER-RESOLVED offering id (offering.id, never the
 * raw caller argument), so this path cannot produce a NULL-scoped week.
 * RE-IMPORT's payload type has no courseOfferingId key at all, so it cannot
 * erase, adopt or retarget ownership. Neither payload carries isPublished -
 * publication remains a separate action, and a new week keeps the schema default
 * (false).
 *
 * DEPENDENCY SURFACE (deliberately three members, and no more): resolve an
 * offering, read one week's owner columns, commit. There is NO dependency
 * capable of writing isPublished, a CourseOffering, a CourseDayPlan, a
 * DutyAssignment, a Student, a CourseEnrollment or a GroupMembership - so no
 * day-plan, duty-generation, publication or enrollment side effect is
 * expressible, let alone reachable.
 *
 * The pure decisions live in offering-weekly-schedule-writer-core.ts; the
 * orchestration is dependency-injected so a DB-free test can prove the whole
 * write boundary (see offering-weekly-schedule-writer.test.ts). The thin
 * commitOfferingWeeklySchedule wrapper binds the real Prisma client and the real
 * admin/offering resolver.
 *
 * DORMANT: this module is NOT a Server Action ("use server" is deliberately
 * absent) and nothing imports it - no route, no page, no action, no UI.
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
import {
  attachWeeklyScheduleId,
  buildWeekCreateData,
  buildWeekUpdateData,
  isWeekOwnedByOffering,
  selectImportableItems,
  validateOfferingWeekInput,
  type NormalizedScheduleItem,
  type OfferingWeekValidationErrorCode,
  type RawOfferingWeekInput,
  type WeekCreateData,
  type WeekOwnerRow,
  type WeekUpdateData,
} from "./offering-weekly-schedule-writer-core";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/** The full error surface: pure validation codes plus the three IO outcomes. */
export type OfferingWeekWriterErrorCode =
  | OfferingWeekValidationErrorCode
  | "offering_not_found"
  | "operation_not_allowed"
  | "week_not_found";

/**
 * The writer input. `courseOfferingId` is the SERVER-BOUND offering (a route- or
 * caller-supplied explicit id, re-validated in step 2), and `weeklyScheduleId` is
 * the UNTRUSTED re-import target - present means "re-import that week", absent
 * means "create a new one". A present id is never authorization on its own.
 */
export interface CommitOfferingWeekInput extends RawOfferingWeekInput {
  readonly courseOfferingId: string;
  readonly weeklyScheduleId?: unknown;
}

/**
 * Discriminated result. Failure carries ONLY a stable, non-PII code - never a raw
 * id, a Prisma/SQL error, a stack, or any internal detail.
 */
export type CommitOfferingWeekResult =
  | {
      readonly success: true;
      readonly weeklyScheduleId: string;
      readonly savedCount: number;
      readonly skippedCount: number;
    }
  | { readonly success: false; readonly error: OfferingWeekWriterErrorCode };

/** The narrow, validated offering context this operation needs (id + status). */
export interface ResolvedOfferingForWeekWrite {
  readonly id: string;
  readonly status: CourseOfferingStatus;
}

/**
 * The commit plan, as a discriminated union. This is where the two structural
 * guarantees live:
 *   - the "create" variant REQUIRES a WeekCreateData, whose courseOfferingId is
 *     non-optional, so a NULL-scoped create is inexpressible;
 *   - the "reimport" variant carries a WeekUpdateData, which has NO
 *     courseOfferingId key, so a re-import cannot touch ownership.
 * Neither variant has an isPublished field anywhere.
 */
export type OfferingWeekCommitPlan =
  | {
      readonly mode: "create";
      readonly createData: WeekCreateData;
      readonly items: readonly NormalizedScheduleItem[];
    }
  | {
      readonly mode: "reimport";
      readonly weeklyScheduleId: string;
      readonly updateData: WeekUpdateData;
      readonly items: readonly NormalizedScheduleItem[];
    };

/**
 * The injected boundary - exactly three members. `resolveOffering` re-validates
 * the admin AND the exact offering id (throwing CourseOfferingNotFoundError for
 * an invalid/nonexistent id); `fetchWeekOwner` reads ONLY a week's id +
 * courseOfferingId (no name, no items, no publication state, no descendants);
 * `commit` performs the single transactional write and returns the week id.
 */
export interface OfferingWeekWriterDeps {
  resolveOffering: (courseOfferingId: string) => Promise<ResolvedOfferingForWeekWrite>;
  fetchWeekOwner: (weeklyScheduleId: string) => Promise<WeekOwnerRow | null>;
  commit: (plan: OfferingWeekCommitPlan) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Re-import target resolution
// ---------------------------------------------------------------------------

/**
 * Interpret the untrusted `weeklyScheduleId`. Fail-closed by construction:
 *   - absent / null / "" -> not requested, i.e. this is a CREATE;
 *   - a non-empty string -> a re-import of exactly that id (NOT trimmed: the
 *     stored ids are cuids, so a padded value must miss rather than be
 *     "helpfully" normalized into a hit);
 *   - anything else (a number, an object, a boolean) -> a re-import request that
 *     cannot resolve, which becomes "week_not_found". It is deliberately NOT
 *     silently downgraded to a create: a caller that asked to replace a week must
 *     never get a new one instead.
 */
type RequestedWeek =
  | { readonly requested: false }
  | { readonly requested: true; readonly id: string | null };

function resolveRequestedWeek(value: unknown): RequestedWeek {
  if (value === undefined || value === null || value === "") {
    return { requested: false };
  }
  if (typeof value === "string") {
    return { requested: true, id: value };
  }
  return { requested: true, id: null };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Create or re-import one offering-scoped week. Order is fail-closed at every
 * step (validate -> resolve offering -> status policy -> ownership -> commit);
 * no week is read and nothing is written until every preceding gate passes.
 */
export async function commitOfferingWeeklyScheduleWithDeps(
  input: CommitOfferingWeekInput,
  deps: OfferingWeekWriterDeps,
): Promise<CommitOfferingWeekResult> {
  // 1. PURE validation first - no DB touched for a malformed payload.
  const validated = validateOfferingWeekInput(input);
  if (!validated.ok) {
    return { success: false, error: validated.error };
  }

  // 2. Resolve EXACTLY the requested offering. A typed not-found (invalid /
  //    whitespace / nonexistent id) fails closed; auth redirects and unexpected
  //    errors propagate untouched.
  let offering: ResolvedOfferingForWeekWrite;
  try {
    offering = await deps.resolveOffering(input.courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "offering_not_found" };
    }
    throw error;
  }

  // 3. Gate by the offering's status. Drafting/importing a week is
  //    SCHEDULE_DRAFT_CONFIGURATION: allowed for PLANNED and ACTIVE, denied for
  //    ARCHIVED. Publication (SCHEDULE_PUBLICATION) is a different operation and
  //    is deliberately not evaluated here.
  try {
    assertCourseOperationAllowed(offering.status, "SCHEDULE_DRAFT_CONFIGURATION");
  } catch (error) {
    if (error instanceof CourseOperationNotPermittedError) {
      return { success: false, error: "operation_not_allowed" };
    }
    throw error;
  }

  // 4. RE-IMPORT ONLY: prove the target week belongs to THIS offering. Missing,
  //    NULL-scoped and other-offering are indistinguishable to the caller.
  const requested = resolveRequestedWeek(input.weeklyScheduleId);
  let existingWeekId: string | null = null;
  if (requested.requested) {
    const owner = requested.id === null ? null : await deps.fetchWeekOwner(requested.id);
    if (!isWeekOwnedByOffering(owner, offering.id)) {
      return { success: false, error: "week_not_found" };
    }
    // Use the STORED id, never the caller's string, as the write target.
    existingWeekId = (owner as WeekOwnerRow).id;
  }

  // 5. Only now shape and perform the write.
  const { importable, savedCount, skippedCount } = selectImportableItems(
    validated.value.items,
  );

  const plan: OfferingWeekCommitPlan =
    existingWeekId === null
      ? {
          mode: "create",
          // The SERVER-RESOLVED offering id, never the raw input argument.
          createData: buildWeekCreateData(validated.value, offering.id),
          items: importable,
        }
      : {
          mode: "reimport",
          weeklyScheduleId: existingWeekId,
          updateData: buildWeekUpdateData(validated.value),
          items: importable,
        };

  const weeklyScheduleId = await deps.commit(plan);
  return { success: true, weeklyScheduleId, savedCount, skippedCount };
}

// ---------------------------------------------------------------------------
// Production-bound wrapper
// ---------------------------------------------------------------------------

/**
 * Thin wrapper binding the real dependencies.
 *
 * `resolveOffering` re-validates the admin and the exact offering through
 * requireAdminCourseOffering (returning only its id + status). `fetchWeekOwner`
 * selects ONLY id + courseOfferingId. `commit` is a SINGLE prisma.$transaction:
 *
 *   create   -> weeklySchedule.create (with the explicit courseOfferingId)
 *               + scheduleItem.createMany
 *   reimport -> weeklySchedule.update (payload has no courseOfferingId key)
 *               + scheduleItem.deleteMany + scheduleItem.createMany
 *
 * so a re-import's destructive item replacement and its re-insert either both
 * land or neither does. No other model is written, and no revalidatePath is
 * performed here - cache invalidation belongs to the (future) action layer.
 */
export async function commitOfferingWeeklySchedule(
  input: CommitOfferingWeekInput,
): Promise<CommitOfferingWeekResult> {
  return commitOfferingWeeklyScheduleWithDeps(input, {
    resolveOffering: async (courseOfferingId) => {
      const context = await requireAdminCourseOffering(courseOfferingId);
      return { id: context.id, status: context.status };
    },

    fetchWeekOwner: (weeklyScheduleId) =>
      prisma.weeklySchedule.findUnique({
        where: { id: weeklyScheduleId },
        select: { id: true, courseOfferingId: true },
      }),

    commit: (plan) =>
      prisma.$transaction(async (tx) => {
        let weeklyScheduleId: string;

        if (plan.mode === "create") {
          const created = await tx.weeklySchedule.create({
            data: plan.createData,
            select: { id: true },
          });
          weeklyScheduleId = created.id;
        } else {
          weeklyScheduleId = plan.weeklyScheduleId;
          await tx.weeklySchedule.update({
            where: { id: weeklyScheduleId },
            data: plan.updateData,
          });
          await tx.scheduleItem.deleteMany({ where: { weeklyScheduleId } });
        }

        const rows = attachWeeklyScheduleId(plan.items, weeklyScheduleId);
        if (rows.length > 0) {
          await tx.scheduleItem.createMany({ data: rows });
        }

        return weeklyScheduleId;
      }),
  });
}
