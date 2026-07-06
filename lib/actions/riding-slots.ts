"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import { buildScheduleSlots } from "@/lib/schedule-grouping";
import type { ActionResult } from "@/lib/actions/students";

const NOT_FOUND_SCHEDULE_ITEM = 'פריט הלו"ז לא נמצא. נסי לרענן את העמוד.';
const NOT_FOUND_RIDING_SLOT = "ניהול הרכיבה לא נמצא. נסי לרענן את העמוד.";
const NOT_FOUND_INSTRUCTOR = "המדריך/ה שנבחר/ה לא נמצא/ת";
const NOT_FOUND_ASSIGNMENT = "השיוך לא נמצא. נסי לרענן את העמוד.";

export interface RidingSlotAssignmentRow {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
  instructorId: string | null;
  instructorName: string | null;
  arena: string | null;
}

export interface RidingSlotRow {
  id: string;
  scheduleItemId: string;
  // All real ScheduleItem rows this logical riding slot covers, including
  // the anchor (scheduleItemId) - a merged/coalesced display card's full
  // "+"-joined id list, once linked, resolves to this set.
  scheduleItemIds: string[];
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
  assignments: RidingSlotAssignmentRow[];
}

export interface RidingSlotActionResult extends ActionResult {
  ridingSlot?: RidingSlotRow;
}

export interface RidingSlotAssignmentActionResult extends ActionResult {
  assignment?: RidingSlotAssignmentRow;
}

type AssignmentWithInstructor = {
  id: string;
  groupName: string | null;
  subgroupNumber: number | null;
  instructorId: string | null;
  arena: string | null;
  instructor: { fullName: string } | null;
};

function toAssignmentRow(a: AssignmentWithInstructor): RidingSlotAssignmentRow {
  return {
    id: a.id,
    groupName: a.groupName,
    subgroupNumber: a.subgroupNumber,
    instructorId: a.instructorId,
    instructorName: a.instructor?.fullName ?? null,
    arena: a.arena,
  };
}

function toRidingSlotRow(slot: {
  id: string;
  scheduleItemId: string;
  showInstructorToStudents: boolean;
  showArenaToStudents: boolean;
  showSubgroupToStudents: boolean;
  assignments: AssignmentWithInstructor[];
  scheduleItems: { scheduleItemId: string }[];
}): RidingSlotRow {
  return {
    id: slot.id,
    scheduleItemId: slot.scheduleItemId,
    scheduleItemIds: slot.scheduleItems.map((s) => s.scheduleItemId),
    showInstructorToStudents: slot.showInstructorToStudents,
    showArenaToStudents: slot.showArenaToStudents,
    showSubgroupToStudents: slot.showSubgroupToStudents,
    assignments: slot.assignments.map(toAssignmentRow),
  };
}

const RIDING_SLOT_INCLUDE = {
  assignments: {
    include: { instructor: true },
    orderBy: [{ groupName: "asc" as const }, { subgroupNumber: "asc" as const }],
  },
  scheduleItems: { select: { scheduleItemId: true } },
};

// Shared by getRidingSlotForScheduleItem and getWeeklyRidingOverview - no
// requireAdmin() here (callers already gate), so the weekly overview isn't
// re-checking admin auth once per activity row.
async function resolveRidingSlotForIds(scheduleItemIds: string[]): Promise<RidingSlotRow | null> {
  if (scheduleItemIds.length === 0) return null;

  const link = await prisma.ridingSlotScheduleItem.findFirst({
    where: { scheduleItemId: { in: scheduleItemIds } },
  });
  if (!link) return null;

  const slot = await prisma.ridingSlot.findUnique({
    where: { id: link.ridingSlotId },
    include: RIDING_SLOT_INCLUDE,
  });
  return slot ? toRidingSlotRow(slot) : null;
}

// Read-only - does not create a RidingSlot just for viewing. A merged
// display card's full source id list is passed in so this resolves to an
// existing slot if ANY of those real rows already belong to one - not just
// the card's first row. Returns null when none of the given ids are linked
// to a riding slot yet.
export async function getRidingSlotForScheduleItem(
  scheduleItemIds: string[]
): Promise<RidingSlotRow | null> {
  await requireAdmin();
  return resolveRidingSlotForIds(scheduleItemIds);
}

// The only place a RidingSlot row is ever created - never touches
// ScheduleItem itself. Takes the full source id list of the (possibly
// merged/coalesced) displayed card: if any of those real rows already
// belong to a riding slot, that slot is reused and any of the card's rows
// not yet linked are linked to it (self-healing, so the slot always ends
// up covering the full currently-displayed activity); otherwise a new slot
// is created anchored at the first id, then every id is linked to it.
export async function createOrGetRidingSlot(
  scheduleItemIds: string[]
): Promise<RidingSlotActionResult> {
  await requireAdmin();

  if (scheduleItemIds.length === 0) {
    return { success: false, error: NOT_FOUND_SCHEDULE_ITEM };
  }

  const scheduleItems = await prisma.scheduleItem.findMany({
    where: { id: { in: scheduleItemIds } },
  });
  if (scheduleItems.length !== scheduleItemIds.length) {
    return { success: false, error: NOT_FOUND_SCHEDULE_ITEM };
  }

  const existingLink = await prisma.ridingSlotScheduleItem.findFirst({
    where: { scheduleItemId: { in: scheduleItemIds } },
  });

  let ridingSlotId = existingLink?.ridingSlotId ?? null;

  if (!ridingSlotId) {
    // Defends against a RidingSlot that predates this join-table fix (or
    // was otherwise created without a corresponding link row) - reuse it
    // rather than colliding on the unique scheduleItemId anchor constraint.
    const existingAnchor = await prisma.ridingSlot.findUnique({
      where: { scheduleItemId: scheduleItemIds[0] },
    });
    ridingSlotId = existingAnchor?.id ?? null;
  }

  if (!ridingSlotId) {
    const created = await prisma.ridingSlot.create({ data: { scheduleItemId: scheduleItemIds[0] } });
    ridingSlotId = created.id;
  }

  const alreadyLinked = await prisma.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId },
    select: { scheduleItemId: true },
  });
  const linkedIds = new Set(alreadyLinked.map((l) => l.scheduleItemId));
  const missingIds = scheduleItemIds.filter((id) => !linkedIds.has(id));

  if (missingIds.length > 0) {
    await prisma.ridingSlotScheduleItem.createMany({
      data: missingIds.map((scheduleItemId) => ({ ridingSlotId: ridingSlotId!, scheduleItemId })),
    });
  }

  const slot = await prisma.ridingSlot.findUnique({
    where: { id: ridingSlotId },
    include: RIDING_SLOT_INCLUDE,
  });
  if (!slot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  revalidatePath("/admin/weekly-schedule");
  return { success: true, ridingSlot: toRidingSlotRow(slot) };
}

const visibilitySchema = z.object({
  showInstructorToStudents: z.boolean(),
  showArenaToStudents: z.boolean(),
  showSubgroupToStudents: z.boolean(),
});

export type RidingSlotVisibilityInput = z.infer<typeof visibilitySchema>;

// These flags are saved now but have no effect on student-facing display
// yet - that comes in a later stage. Purely a data-save action here.
export async function updateRidingSlotVisibility(
  ridingSlotId: string,
  flags: RidingSlotVisibilityInput
): Promise<RidingSlotActionResult> {
  await requireAdmin();

  const parsed = visibilitySchema.safeParse(flags);
  if (!parsed.success) {
    return { success: false, error: "קלט לא תקין" };
  }

  const existing = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const updated = await prisma.ridingSlot.update({
    where: { id: ridingSlotId },
    data: parsed.data,
    include: RIDING_SLOT_INCLUDE,
  });

  revalidatePath("/admin/weekly-schedule");
  return { success: true, ridingSlot: toRidingSlotRow(updated) };
}

const assignmentInputSchema = z.object({
  id: z.string().trim().optional(),
  ridingSlotId: z.string().min(1),
  groupName: z.string().trim().optional(),
  subgroupNumber: z.coerce.number().int().positive().optional(),
  instructorId: z.string().trim().optional(),
  arena: z.string().trim().optional(),
});

export type RidingSlotAssignmentInput = z.infer<typeof assignmentInputSchema>;

// Create (or edit, when input.id is set) one group/subgroup split of a
// riding slot. Creating without an id upserts on the DB's own unique key
// (ridingSlotId + groupName + subgroupNumber), so re-submitting the same
// split just updates it rather than erroring; editing by id can freely
// change that split's own group/subgroup, with the DB unique constraint
// still guarding against colliding with a different existing row.
export async function upsertRidingSlotAssignment(
  input: RidingSlotAssignmentInput
): Promise<RidingSlotAssignmentActionResult> {
  await requireAdmin();

  const parsed = assignmentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const ridingSlot = await prisma.ridingSlot.findUnique({ where: { id: data.ridingSlotId } });
  if (!ridingSlot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  if (data.instructorId) {
    const instructor = await prisma.instructor.findUnique({ where: { id: data.instructorId } });
    if (!instructor) {
      return { success: false, error: NOT_FOUND_INSTRUCTOR };
    }
  }

  if (data.id) {
    const existingAssignment = await prisma.ridingSlotAssignment.findUnique({
      where: { id: data.id },
    });
    if (!existingAssignment) {
      return { success: false, error: NOT_FOUND_ASSIGNMENT };
    }
  }

  const groupName = data.groupName || null;
  const subgroupNumber = data.subgroupNumber ?? null;
  const instructorId = data.instructorId || null;
  const arena = data.arena || null;

  try {
    let saved;
    if (data.id) {
      saved = await prisma.ridingSlotAssignment.update({
        where: { id: data.id },
        data: { groupName, subgroupNumber, instructorId, arena },
        include: { instructor: true },
      });
    } else {
      // Postgres unique constraints treat NULL as distinct from any other
      // NULL, so the DB-level @@unique([ridingSlotId, groupName,
      // subgroupNumber]) constraint (and Prisma's compound-key upsert
      // shorthand, which requires non-null values for those fields) can't
      // reliably match a "whole slot" (both null) row. findFirst's `where`
      // still filters null fields correctly (translates to IS NULL), so
      // this replicates upsert-by-split manually instead.
      const existingMatch = await prisma.ridingSlotAssignment.findFirst({
        where: { ridingSlotId: data.ridingSlotId, groupName, subgroupNumber },
      });
      saved = existingMatch
        ? await prisma.ridingSlotAssignment.update({
            where: { id: existingMatch.id },
            data: { instructorId, arena },
            include: { instructor: true },
          })
        : await prisma.ridingSlotAssignment.create({
            data: { ridingSlotId: data.ridingSlotId, groupName, subgroupNumber, instructorId, arena },
            include: { instructor: true },
          });
    }

    revalidatePath("/admin/weekly-schedule");
    return { success: true, assignment: toAssignmentRow(saved) };
  } catch {
    return {
      success: false,
      error: "כבר קיים שיוך לאותה קבוצה/תת-קבוצה עבור רכיבה זו",
    };
  }
}

export async function deleteRidingSlotAssignment(assignmentId: string): Promise<ActionResult> {
  await requireAdmin();

  const existing = await prisma.ridingSlotAssignment.findUnique({ where: { id: assignmentId } });
  if (!existing) {
    return { success: false, error: NOT_FOUND_ASSIGNMENT };
  }

  await prisma.ridingSlotAssignment.delete({ where: { id: assignmentId } });

  revalidatePath("/admin/weekly-schedule");
  return { success: true };
}

export interface WeeklyRidingActivity {
  // Full real ScheduleItem id set behind this displayed activity - split of
  // a "+"-joined merged/coalesced id, same recovery used everywhere else.
  scheduleItemIds: string[];
  dateKey: string;
  startTime: string;
  endTime: string;
  title: string;
  groupName: string | null;
  // Reference-only, from the original ScheduleItem(s) - never written to.
  instructorName: string | null;
  location: string | null;
  isLikelyRiding: boolean;
  ridingSlot: RidingSlotRow | null;
}

export interface WeeklyRidingDay {
  dateKey: string;
  activities: WeeklyRidingActivity[];
}

// Read-only overview of every displayed activity across a whole week,
// classified exactly like the admin already sees it. buildScheduleSlots is
// run once PER DAY (never across the whole week's mixed-date items) since
// it compares startTime/endTime as plain strings - mixing dates could
// incorrectly merge unrelated activities that happen to share HH:MM times.
export async function getWeeklyRidingOverview(weeklyScheduleId: string): Promise<WeeklyRidingDay[]> {
  await requireAdmin();

  const week = await prisma.weeklySchedule.findUnique({
    where: { id: weeklyScheduleId },
    include: { items: { orderBy: [{ date: "asc" }, { startTime: "asc" }] } },
  });
  if (!week) return [];

  const byDate = new Map<string, typeof week.items>();
  for (const item of week.items) {
    const dk = dateKey(item.date);
    if (!byDate.has(dk)) byDate.set(dk, []);
    byDate.get(dk)!.push(item);
  }

  const days: WeeklyRidingDay[] = [];
  const sortedDateKeys = Array.from(byDate.keys()).sort();

  for (const dk of sortedDateKeys) {
    const dayItems = byDate.get(dk)!;
    const slots = buildScheduleSlots(dayItems);

    // Flatten each display "box" into one activity row: single/merged is
    // one box; pair is two separate boxes (different titles, shown side by
    // side); span is the one long box plus each of the other side's several
    // short boxes.
    const rawActivities: (typeof dayItems)[number][] = [];
    for (const slot of slots) {
      if (slot.kind === "single" || slot.kind === "merged") {
        rawActivities.push(slot.item);
      } else if (slot.kind === "pair") {
        rawActivities.push(slot.items[0], slot.items[1]);
      } else {
        const longSide = slot.groupA.length === 1 ? slot.groupA : slot.groupB;
        const shortSide = slot.groupA.length === 1 ? slot.groupB : slot.groupA;
        rawActivities.push(...longSide, ...shortSide);
      }
    }

    const activities: WeeklyRidingActivity[] = [];
    for (const item of rawActivities) {
      const scheduleItemIds = item.id.split("+");
      const isLikelyRiding =
        item.title.includes("רכיבה") || (item.description ?? "").includes("רכיבה");
      const ridingSlot = await resolveRidingSlotForIds(scheduleItemIds);
      activities.push({
        scheduleItemIds,
        dateKey: dk,
        startTime: item.startTime,
        endTime: item.endTime,
        title: item.title,
        groupName: item.groupName,
        instructorName: item.instructorName,
        location: item.location,
        isLikelyRiding,
        ridingSlot,
      });
    }
    activities.sort(
      (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime)
    );

    days.push({ dateKey: dk, activities });
  }

  return days;
}
