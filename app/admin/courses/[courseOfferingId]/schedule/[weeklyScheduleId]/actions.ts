"use server";

/**
 * MULTI-COURSE Schedule Slice W-S3B - the Server Actions of the OFFERING-SCOPED
 * weekly-schedule VIEW/EDIT route.
 *
 * Four narrow mutations, each bound to a SERVER-owned courseOfferingId (the page
 * binds context.id via .bind, so it travels inside the encrypted server-action
 * payload and is never a form field, query string, cookie, or client-forgeable
 * value):
 *
 *   - updateOfferingWeekMetadataAction  - name/start/end ONLY (items untouched);
 *   - createOfferingScheduleItemAction  - add ONE ScheduleItem to this week;
 *   - updateOfferingScheduleItemAction  - edit ONE ScheduleItem;
 *   - deleteOfferingScheduleItemAction  - delete ONE ScheduleItem.
 *
 * ORDER, for every mutation (fail-closed at each step):
 *   1. requireAdmin() FIRST - the first awaited operation, before any client value
 *      is read and before any offering lookup or write;
 *   2. prove ownership through the committed W-S3A writer, which re-resolves the
 *      exact offering (requireAdminCourseOffering), gates it by
 *      SCHEDULE_DRAFT_CONFIGURATION (PLANNED + ACTIVE allowed, ARCHIVED denied),
 *      and proves the target belongs to THIS offering:
 *        * metadata / create -> WEEK ownership (id AND courseOfferingId);
 *        * update / delete    -> ITEM ownership (item -> weeklySchedule ->
 *                                courseOfferingId).
 *      A missing, NULL-scoped or other-offering target all collapse to the SAME
 *      "week_not_found" code, so an id can never be probed across courses;
 *   3. perform the write. The metadata write is an atomic ownership-scoped
 *      updateMany inside the writer. The item create/update/delete DELEGATE to the
 *      committed schedule-items.ts server actions AFTER the ownership proof, so the
 *      single zod schedule-item validation schema is reused verbatim (no competing
 *      validation contract is introduced here);
 *   4. revalidate ONLY the two course-scoped schedule paths (the offering's week
 *      list and this week's editor). This route performs no /admin/weekly-schedule,
 *      /student or /instructor revalidation of its own. (The delegated legacy item
 *      actions additionally revalidate those Level 1 paths from THEIR module; that
 *      is a harmless cache refresh - a Level 2 PLANNED week is invisible to
 *      trainees/instructors regardless - and is out of this route's own control.)
 *
 * This module imports NO Prisma client, NO publication action, NO riding / duty /
 * day-plan / no-duty / export surface. The item writes reach the database only
 * through the delegated, already-committed schedule-item actions.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  authorizeOfferingItemTarget,
  authorizeOfferingWeekTarget,
  updateOfferingWeekMetadata,
  type OfferingWeekMetadataResult,
} from "@/lib/course/offering-schedule-item-writer";
import {
  createScheduleItem,
  deleteScheduleItem,
  updateScheduleItem,
  type ScheduleItemInput,
  type ScheduleItemActionResult,
} from "@/lib/actions/schedule-items";
import type { ActionResult } from "@/lib/actions/students";

/** Revalidate ONLY this offering's week list and this week's editor page. */
function revalidateOfferingSchedule(courseOfferingId: string, weeklyScheduleId: string): void {
  const base = `/admin/courses/${encodeURIComponent(courseOfferingId)}/schedule`;
  revalidatePath(base);
  revalidatePath(`${base}/${encodeURIComponent(weeklyScheduleId)}`);
}

/**
 * The client-supplied half of a metadata edit. It deliberately has NO
 * courseOfferingId key and NO weeklyScheduleId key: both are server-bound leading
 * arguments, and there is no items/isPublished field through which an edit could
 * touch schedule rows or publication.
 */
export interface OfferingWeekMetadataClientInput {
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Update the week's name/start/end only. courseOfferingId and weeklyScheduleId are
 * both server-bound. Items are provably untouched (the writer's payload has no
 * items reference), ownership and publication are provably unchanged.
 */
export async function updateOfferingWeekMetadataAction(
  courseOfferingId: string,
  weeklyScheduleId: string,
  input: OfferingWeekMetadataClientInput,
): Promise<OfferingWeekMetadataResult> {
  await requireAdmin();

  const raw: Record<string, unknown> =
    typeof input === "object" && input !== null
      ? (input as unknown as Record<string, unknown>)
      : {};

  const result = await updateOfferingWeekMetadata({
    courseOfferingId,
    weeklyScheduleId,
    name: raw.name,
    startDate: raw.startDate,
    endDate: raw.endDate,
  });

  if (result.success) {
    revalidateOfferingSchedule(courseOfferingId, weeklyScheduleId);
  }
  return result;
}

/**
 * Create one ScheduleItem in this week. Ownership is proven against the
 * SERVER-bound week before the delegated create runs; item validation is the
 * delegated action's own zod schema.
 */
export async function createOfferingScheduleItemAction(
  courseOfferingId: string,
  weeklyScheduleId: string,
  input: ScheduleItemInput,
): Promise<ScheduleItemActionResult> {
  await requireAdmin();

  const auth = await authorizeOfferingWeekTarget(courseOfferingId, weeklyScheduleId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const result = await createScheduleItem(auth.weeklyScheduleId, input);
  if (result.success) {
    revalidateOfferingSchedule(courseOfferingId, auth.weeklyScheduleId);
  }
  return result;
}

/**
 * Edit one ScheduleItem. Ownership is proven along item -> weeklySchedule ->
 * courseOfferingId before the delegated update runs. A foreign / NULL-scoped /
 * missing item collapses to "week_not_found" and never reaches the write.
 */
export async function updateOfferingScheduleItemAction(
  courseOfferingId: string,
  itemId: string,
  input: ScheduleItemInput,
): Promise<ScheduleItemActionResult> {
  await requireAdmin();

  const auth = await authorizeOfferingItemTarget(courseOfferingId, itemId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const result = await updateScheduleItem(itemId, input);
  if (result.success) {
    revalidateOfferingSchedule(courseOfferingId, auth.weeklyScheduleId);
  }
  return result;
}

/**
 * Delete one ScheduleItem. Same item -> week -> offering ownership proof as the
 * edit path; a target that is not owned collapses to "week_not_found".
 */
export async function deleteOfferingScheduleItemAction(
  courseOfferingId: string,
  itemId: string,
): Promise<ActionResult> {
  await requireAdmin();

  const auth = await authorizeOfferingItemTarget(courseOfferingId, itemId);
  if (!auth.ok) {
    return { success: false, error: auth.error };
  }

  const result = await deleteScheduleItem(itemId);
  if (result.success) {
    revalidateOfferingSchedule(courseOfferingId, auth.weeklyScheduleId);
  }
  return result;
}
