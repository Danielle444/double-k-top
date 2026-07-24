"use server";

/**
 * URGENT LEVEL 2 ACCESS - SLICE S2A: the COURSE-SCOPED instructor schedule
 * actions. These are the ONLY instructor schedule readers in the app - the
 * legacy global getScheduleForInstructor was deleted in the same slice.
 *
 * These are THIN bindings by design: every decision (gate ordering, the exact
 * offering-scoped query shapes, the "mine" filter, the uniform denial) lives in
 * the PURE core (@/lib/course/instructor-schedule-scope-core), which is where the
 * DB-free tests exercise them. This file only supplies the real session reader,
 * the real offering resolver, the real capability reader, the real Prisma
 * queries and the real server clock.
 *
 * IDENTITY IS SESSION-DERIVED. No action here takes an instructorId, and none is
 * accepted even if sent: requireCurrentInstructor() derives the actor from the
 * signed session (returning/throwing for anonymous, wrong-audience, invalid or
 * INACTIVE callers), and the ONLY thing read afterwards is that same actor's own
 * firstName/fullName, looked up by actor.id, purely for the "השיעורים שלי" text
 * match. This closes the pre-existing hole where any caller could pass an
 * arbitrary instructorId and receive a whole week of schedule content.
 *
 * COURSE CONTEXT IS EXPLICIT AND RE-VALIDATED. `courseOfferingId` is a REQUEST,
 * never a grant: resolveInstructorCourseOffering re-applies the audience gate,
 * checks the id against the temporary allowed-offerings policy and proves the
 * offering exists as exactly that id. Only the RESOLVED offering's id then
 * reaches the SCHEDULE capability read and the week queries, so a request can
 * never address an offering the server did not verify. There is no default
 * course, no resolveCurrentCourseOffering, and no Level 1 fallback.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/app/generated/prisma/client";
import { requireCurrentInstructor } from "@/lib/auth/actor";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { resolveInstructorCourseOffering } from "@/lib/course/actor-course-offering";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import { todayDateKey } from "@/lib/dates";
import {
  loadInstructorScheduleWithDeps,
  loadInstructorTodayScheduleWithDeps,
  loadInstructorWeekSelectionWithDeps,
  type InstructorScheduleFilter,
  type InstructorScheduleResult,
  type InstructorWeekSelection,
} from "@/lib/course/instructor-schedule-scope-core";

export type {
  InstructorScheduleFilter,
  InstructorScheduleItem,
  InstructorScheduleResult,
  InstructorWeekOption,
  InstructorWeekSelection,
} from "@/lib/course/instructor-schedule-scope-core";

/**
 * The row PROJECTION for both week reads, owned by this shell because Prisma
 * infers a result type only from a literal select at the call site.
 *
 * It decides what is read BACK; the pure core decides what is REACHABLE (the
 * WHERE). Deliberately narrow: no uploadedFileName, no isPublished, no
 * courseOfferingId, no timestamps - only the columns the view contract needs.
 * The item ordering is the same one the deleted legacy reader used.
 */
const WEEK_WITH_ITEMS_SELECT = {
  id: true,
  name: true,
  items: {
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: {
      id: true,
      date: true,
      startTime: true,
      endTime: true,
      title: true,
      description: true,
      groupName: true,
      instructorName: true,
      location: true,
    },
  },
} satisfies Prisma.WeeklyScheduleSelect;

/**
 * The identity boundary every action below shares.
 *
 * requireCurrentInstructor() is the FIRST awaited operation and supplies the
 * whole audience gate. Its `id` is used for exactly one thing - looking up that
 * same actor's own name columns, which the InstructorActor shape does not carry
 * (it exposes fullName but not firstName, and the "mine" match needs both). A
 * row that vanished between the two reads is a race, not an authorization, so it
 * fails closed as unauthenticated rather than degrading to an unfiltered read.
 */
async function requireInstructorIdentity(): Promise<{ firstName: string; fullName: string }> {
  const actor = await requireCurrentInstructor();
  const row = await prisma.instructor.findUnique({
    where: { id: actor.id },
    select: { firstName: true, fullName: true },
  });
  if (row === null) {
    throw new UnauthenticatedActorError("Authenticated instructor row disappeared");
  }
  return row;
}

/**
 * The weeks of ONE explicitly requested course, for the instructor week picker.
 *
 * Unpublished weeks are INCLUDED, preserving the pre-existing instructor
 * behaviour (the query carries no isPublished predicate - see
 * buildInstructorWeekOptionsQuery). An unauthorized caller, a course outside the
 * temporary policy and a course whose SCHEDULE capability is not ENABLED all
 * receive the same empty selection.
 */
export async function getInstructorWeekSelection(
  courseOfferingId: string,
): Promise<InstructorWeekSelection> {
  return loadInstructorWeekSelectionWithDeps(courseOfferingId, {
    requireInstructorIdentity,
    resolveInstructorCourseOffering,
    getEffectiveCapabilities,
    fetchWeekOptionRows: (query) => prisma.weeklySchedule.findMany(query),
    todayDateKey,
  });
}

/**
 * One week of ONE explicitly requested course.
 *
 * The week is fetched with a COMPOSITE where (id AND courseOfferingId), so a
 * week belonging to the other course never matches and its contents are never
 * loaded. findFirst (not findUnique) because the predicate is deliberately not
 * the primary key alone - that is the whole point.
 */
export async function getCourseScopedScheduleForInstructor(
  courseOfferingId: string,
  weeklyScheduleId: string | null,
  dayKey: string | "all",
  filter: InstructorScheduleFilter,
): Promise<InstructorScheduleResult> {
  return loadInstructorScheduleWithDeps(courseOfferingId, weeklyScheduleId, dayKey, filter, {
    requireInstructorIdentity,
    resolveInstructorCourseOffering,
    getEffectiveCapabilities,
    fetchWeekWithItems: (query) =>
      prisma.weeklySchedule.findFirst({ where: query.where, select: WEEK_WITH_ITEMS_SELECT }),
  });
}

/**
 * Today's items from whichever week of the requested course covers today.
 *
 * "Today" is derived SERVER-SIDE (todayDateKey) and only AFTER the identity,
 * offering and capability gates pass - the client sends no date. The date range
 * chooses which week INSIDE the already-resolved offering, never which offering.
 */
export async function getTodayScheduleForInstructor(
  courseOfferingId: string,
  filter: InstructorScheduleFilter,
): Promise<InstructorScheduleResult> {
  return loadInstructorTodayScheduleWithDeps(courseOfferingId, filter, {
    requireInstructorIdentity,
    resolveInstructorCourseOffering,
    getEffectiveCapabilities,
    fetchTodayWeekWithItems: (query) =>
      prisma.weeklySchedule.findFirst({
        where: query.where,
        orderBy: query.orderBy,
        select: WEEK_WITH_ITEMS_SELECT,
      }),
    todayDateKey,
  });
}
