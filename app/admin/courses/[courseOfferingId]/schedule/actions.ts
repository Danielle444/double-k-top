"use server";

/**
 * MULTI-COURSE Schedule Slice W-S2B - the SINGLE Server Action of the
 * offering-scoped weekly-schedule admin route.
 *
 * It does exactly ONE thing: create OR re-import one UNPUBLISHED WeeklySchedule
 * (and its ScheduleItem rows) for ONE EXPLICIT CourseOffering, by delegating to
 * the committed W-S2A writer. It performs no other write of any kind.
 *
 * Ordering is a hard safety contract:
 *   1. requireAdmin() FIRST - the first awaited operation in the body, so no
 *      offering lookup, no coercion of client input, and no write can run before
 *      the admin gate. requireAdmin() fails closed (it redirect()s -> throws), so
 *      a denial provably prevents every subsequent step;
 *   2. requireAdminCourseOffering(courseOfferingId) - the offering id is the
 *      SERVER-BOUND leading argument taken from the validated course route (the
 *      page binds context.id via .bind), NEVER a form field, hidden input, query
 *      string, cookie, current-offering resolver, or an inference from level /
 *      date / group / week name. The bound argument travels inside the encrypted
 *      server-action payload and is not forgeable from the client. Re-validating
 *      it here (in addition to the writer's own internal resolution) means a
 *      nonexistent offering fails closed with a stable code before the writer is
 *      ever entered;
 *   3. commitOfferingWeeklySchedule(...) - the committed W-S2A writer, which
 *      re-resolves the exact offering, gates it by SCHEDULE_DRAFT_CONFIGURATION
 *      (PLANNED and ACTIVE allowed, ARCHIVED denied), and - for a re-import -
 *      proves STRICT ownership of the target week by that offering before any
 *      write. A missing, NULL-scoped or other-offering week all collapse to the
 *      SAME "week_not_found" code, so a week id can never be probed across
 *      courses. Its CREATE payload always carries the server-resolved offering id
 *      and its RE-IMPORT payload has no courseOfferingId key at all, so ownership
 *      can be neither omitted nor retargeted;
 *   4. revalidate ONLY this course-scoped schedule path. No Level 1 path
 *      (/admin/weekly-schedule), no /student, no /instructor - the weeks this
 *      route writes are unpublished and offering-scoped, so no reader surface
 *      outside this page can be showing them.
 *
 * The result is the writer's own discriminated result: a stable, non-PII error
 * code or the saved/skipped counts. No raw Prisma error, no stack, no raw id is
 * ever returned to the client.
 *
 * This action imports NO publication, delete, day-plan or duty-generation
 * function, and no Prisma client - a week's isPublished, a CourseDayPlan and a
 * DutyAssignment are all unreachable from here.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "@/lib/course/admin-course-context";
import {
  commitOfferingWeeklySchedule,
  type CommitOfferingWeekResult,
} from "@/lib/course/offering-weekly-schedule-writer";

/**
 * The client-supplied half of the payload. It deliberately has NO
 * courseOfferingId key: the offering is the bound leading argument, so there is
 * no field through which a client could name a course. `weeklyScheduleId` is the
 * UNTRUSTED re-import target - present means "re-import that week", absent means
 * "create a new one" - and is never authorization on its own (the writer proves
 * ownership server-side).
 */
export interface OfferingWeekClientInput {
  weeklyScheduleId?: string;
  name: string;
  startDate: string;
  endDate: string;
  uploadedFileName: string;
  items: unknown[];
}

export async function saveOfferingWeeklyScheduleAction(
  courseOfferingId: string,
  input: OfferingWeekClientInput,
): Promise<CommitOfferingWeekResult> {
  // 1. Admin gate FIRST - before the offering lookup and before any client value
  //    is even read off the payload.
  await requireAdmin();

  // 2. Re-validate EXACTLY the bound offering. Only the typed not-found fails
  //    closed with a stable code; auth redirects and unexpected errors propagate.
  try {
    await requireAdminCourseOffering(courseOfferingId);
  } catch (error) {
    if (error instanceof CourseOfferingNotFoundError) {
      return { success: false, error: "offering_not_found" };
    }
    throw error;
  }

  // A server action's argument is untrusted at runtime regardless of its declared
  // type, so the payload is treated as an opaque bag here and every field is
  // handed to the writer as `unknown` for the writer's own pure validation.
  const raw: Record<string, unknown> =
    typeof input === "object" && input !== null
      ? (input as unknown as Record<string, unknown>)
      : {};

  // 3. The committed W-S2A writer owns validation, the status policy, the
  //    re-import ownership proof, and the single transactional write.
  const result = await commitOfferingWeeklySchedule({
    courseOfferingId,
    weeklyScheduleId: raw.weeklyScheduleId,
    name: raw.name,
    startDate: raw.startDate,
    endDate: raw.endDate,
    uploadedFileName: raw.uploadedFileName,
    items: raw.items,
  });

  if (!result.success) {
    return result;
  }

  // 4. Revalidate ONLY this course-scoped schedule page.
  revalidatePath(`/admin/courses/${encodeURIComponent(courseOfferingId)}/schedule`);
  return result;
}
