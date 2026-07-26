// Fix 3, Stage 2 - transaction-scoped lookup that turns "a genuinely new
// complex plan is being created for this slot" into an OPTIONAL sanitized
// template payload (or null when no template applies).
//
// This module is the READ/SELECT/SANITIZE half of the template wiring; the
// WRITE half (creating the fresh destination blocks/stations/pairs under the
// new plan id) lives in lib/actions/riding-slot-complex.ts because it needs the
// just-created plan id.
//
// TRANSACTION SAFETY (deliberate, load-bearing):
//  - Every DB access here goes through the injected `tx`
//    (Prisma.TransactionClient). This module imports NO global `prisma` client,
//    so it can never issue a query that escapes the caller's interactive
//    transaction (and its advisory lock).
//  - It is NOT a server action ("use server" is deliberately absent) - it is an
//    internal helper imported by the create action, never a callable endpoint.
//  - The source plan and its schedule items are READ ONLY; nothing here ever
//    updates or deletes any row. No publication model is read or written.
//  - Offering identity IS resolved here (RC-B2b), but ONLY structurally from the
//    linked WeeklySchedule.courseOfferingId of each schedule item - never from
//    the session/actor/resolveCurrentCourseOffering and never with a
//    Student-identity fallback.
//
// The pure eligibility/ordering/sanitization decisions are made by the
// committed pure core (resolveAnchor / resolveOffering / rankSources /
// copyPlanForTemplate); the Prisma queries below only prefilter conservatively
// for performance. RC-B2b replaced the old chronological selectPreviousSource
// with rankSources so the automatic path recommends ONLY a same-offering,
// same-group, strictly-earlier, SAME-day-part source (morning -> morning,
// afternoon -> afternoon) - never yesterday's afternoon into today's morning.

import { Prisma } from "@/app/generated/prisma/client";
import { dateKey, getDayPartLabel, parseDateKey } from "@/lib/dates";
import { resolveAnchor } from "@/lib/riding-complex-template/resolve-anchor";
import { rankSources } from "@/lib/riding-complex-template/rank-sources";
import { resolveOffering } from "@/lib/riding-complex-template/resolve-offering";
import { copyPlanForTemplate } from "@/lib/riding-complex-template/copy-plan";
import type {
  ComplexSourceDayPart,
  DestinationPlanCreate,
  DestinationSlotDescriptor,
  LinkedScheduleItemDescriptor,
  SourceCandidateDescriptor,
  SourcePlanTree,
} from "@/lib/riding-complex-template/types";

// The minimal schedule-item projection the anchor resolver needs, plus the id
// and the linked WeeklySchedule.courseOfferingId (never any group beyond
// groupName, no title/description/instructorName/etc). RC-B2b - the offering is
// read via the existing RidingSlot -> RidingSlotScheduleItem -> ScheduleItem ->
// WeeklySchedule.courseOfferingId relation; it is nullable and a null is a real
// legacy identity, never coerced to a level.
const SCHEDULE_ITEM_SELECT = {
  scheduleItem: {
    select: {
      id: true,
      date: true,
      startTime: true,
      groupName: true,
      weeklySchedule: { select: { courseOfferingId: true } },
    },
  },
} as const;

type LinkedScheduleItemRow = {
  scheduleItem: {
    id: string;
    date: Date;
    startTime: string;
    groupName: string | null;
    weeklySchedule: { courseOfferingId: string | null };
  };
};

// Map raw linked-schedule-item rows to the pure anchor descriptors. dateKey()
// (the existing UTC date-only conversion) is applied only here, at the Prisma
// boundary; the pure core receives canonical YYYY-MM-DD strings and never sees
// a Date. No current-clock/timezone inference and no groupName normalization.
function toDescriptors(links: readonly LinkedScheduleItemRow[]): LinkedScheduleItemDescriptor[] {
  return links.map((link) => ({
    id: link.scheduleItem.id,
    dateKey: dateKey(link.scheduleItem.date),
    startTime: link.scheduleItem.startTime,
    groupName: link.scheduleItem.groupName,
  }));
}

// RC-B2b - the offering-id of every linked schedule item, for resolveOffering.
// The offering comes ONLY from the linked WeeklySchedule (never the session /
// actor / resolveCurrentCourseOffering), so this stays a pure structural read.
function toOfferingIds(links: readonly LinkedScheduleItemRow[]): (string | null)[] {
  return links.map((link) => link.scheduleItem.weeklySchedule.courseOfferingId);
}

// RC-B2b - narrow getDayPartLabel's `string` return to the descriptor day-part
// union. getDayPartLabel already yields only "בוקר" / "אחה\"צ" / ""; anything
// else (defensively) collapses to "" so it can never anchor an auto-recommendation.
function toDayPart(value: string): ComplexSourceDayPart {
  return value === "בוקר" || value === "אחה\"צ" ? value : "";
}

/**
 * Resolve the optional template payload for a freshly-created complex plan.
 *
 * Returns a sanitized {@link DestinationPlanCreate} to copy under the new plan,
 * or `null` when no template applies (ineligible destination anchor, no
 * eligible earlier same-group source, or a source that vanished/emptied between
 * selection and read). Never throws for an ordinary "no template possible"
 * case, and never mutates any source row.
 *
 * `destinationRosterTraineeIds` MUST already be the in-transaction-validated
 * active roster (see the caller): this helper only consumes it.
 */
export async function resolveTemplateForNewPlan(
  tx: Prisma.TransactionClient,
  params: {
    destinationRidingSlotId: string;
    destinationRosterTraineeIds: ReadonlySet<string>;
  }
): Promise<DestinationPlanCreate | null> {
  const { destinationRidingSlotId, destinationRosterTraineeIds } = params;

  // 1) Destination anchor - read ALL linked schedule items (not just one
  //    "anchor" relation) so a merged/ambiguous/mixed-group slot is detected.
  const destinationLinks = await tx.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId: destinationRidingSlotId },
    select: SCHEDULE_ITEM_SELECT,
  });
  const destinationAnchor = resolveAnchor(toDescriptors(destinationLinks));
  if (!destinationAnchor.eligible) {
    // Null/ambiguous/both-groups/invalid destination -> no template (the empty
    // plan the caller already created stands). Never an error.
    return null;
  }

  // RC-B2b - destination offering identity from ALL linked items. NO_ITEMS or
  // AMBIGUOUS (e.g. a merged slot spanning two offerings, or a null mixed with a
  // real id) fails closed to no template - the empty plan the caller created
  // stands. A RESOLVED null is a real identity kept as-is, never coerced to a
  // level.
  const destinationOffering = resolveOffering(toOfferingIds(destinationLinks));
  if (destinationOffering.status !== "RESOLVED") {
    return null;
  }

  const destination: DestinationSlotDescriptor = {
    slotId: destinationRidingSlotId,
    anchorDateKey: destinationAnchor.anchorDateKey,
    resolvedGroup: destinationAnchor.resolvedGroup,
    dayPart: toDayPart(getDayPartLabel(destinationAnchor.startTime.value)),
    courseOfferingId: destinationOffering.courseOfferingId,
  };

  // 2) Candidate prefilter (conservative). Same-group, strictly-earlier-dated
  //    complex plans with at least one block. The `some` on the SAME schedule
  //    item (groupName AND date) can only OVER-include (never drop an eligible
  //    candidate, whose earliest item satisfies both); the pure core makes the
  //    final eligibility/ordering call. Publication state is never queried.
  const candidatePlans = await tx.ridingSlotComplexPlan.findMany({
    where: {
      ridingSlotId: { not: destinationRidingSlotId },
      blocks: { some: {} },
      ridingSlot: {
        scheduleItems: {
          some: {
            scheduleItem: {
              groupName: destinationAnchor.resolvedGroup,
              date: { lt: parseDateKey(destinationAnchor.anchorDateKey) },
            },
          },
        },
      },
    },
    select: {
      ridingSlotId: true,
      _count: { select: { blocks: true } },
      ridingSlot: { select: { scheduleItems: { select: SCHEDULE_ITEM_SELECT } } },
    },
  });

  const candidates: SourceCandidateDescriptor[] = [];
  for (const plan of candidatePlans) {
    // Resolve each candidate's OWN anchor from ALL its linked schedule items;
    // reject any whose full identity is null/ambiguous/mixed-group.
    const candidateAnchor = resolveAnchor(toDescriptors(plan.ridingSlot.scheduleItems));
    if (!candidateAnchor.eligible) {
      continue;
    }
    // RC-B2b - resolve the candidate's OWN offering independently; exclude any
    // NO_ITEMS/AMBIGUOUS candidate. A RESOLVED null offering can only match a
    // RESOLVED null destination (rankSources enforces exact offering equality).
    const candidateOffering = resolveOffering(toOfferingIds(plan.ridingSlot.scheduleItems));
    if (candidateOffering.status !== "RESOLVED") {
      continue;
    }
    candidates.push({
      slotId: plan.ridingSlotId,
      anchorDateKey: candidateAnchor.anchorDateKey,
      startTime: candidateAnchor.startTime.value,
      resolvedGroup: candidateAnchor.resolvedGroup,
      blockCount: plan._count.blocks,
      dayPart: toDayPart(getDayPartLabel(candidateAnchor.startTime.value)),
      courseOfferingId: candidateOffering.courseOfferingId,
    });
  }

  // 3) Day-part-aware, offering-scoped recommendation (RC-B2b). rankSources
  //    keeps only same-offering, same-group, strictly-earlier, >= 1 block
  //    candidates and AUTO-recommends ONLY a same-day-part source (morning ->
  //    morning, afternoon -> afternoon). A null recommendation means no safe
  //    automatic source: return no template rather than fall back to another
  //    day-part or to the old chronological selector.
  const chosen = rankSources(destination, candidates).recommended;
  if (chosen === null) {
    return null;
  }

  // 4) Re-read the FULL source live tree inside this same transaction, selecting
  //    ONLY the Stage-1 allow-list content fields - no ids, no timestamps, no
  //    version/actor, no publication tree, no feedback/attendance/completion.
  //    Parent traversal is purely structural (nested arrays), so not even a
  //    source id is selected.
  const sourcePlan = await tx.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId: chosen.slotId },
    select: {
      blocks: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          startTime: true,
          endTime: true,
          stations: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              instructorId: true,
              arena: true,
              pairs: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                select: { trainee1Id: true, trainee2Id: true, horseName: true, note: true },
              },
            },
          },
        },
      },
    },
  });

  // Source disappeared or became empty between selection and read (it is not
  // under our advisory lock): keep the destination plan empty rather than fail
  // the whole create over an optional template.
  if (!sourcePlan || sourcePlan.blocks.length === 0) {
    return null;
  }

  const sourceTree: SourcePlanTree = {
    blocks: sourcePlan.blocks.map((block) => ({
      startTime: block.startTime,
      endTime: block.endTime,
      stations: block.stations.map((station) => ({
        instructorId: station.instructorId,
        arena: station.arena,
        pairs: station.pairs.map((pair) => ({
          trainee1Id: pair.trainee1Id,
          trainee2Id: pair.trainee2Id,
          horseName: pair.horseName,
          note: pair.note,
        })),
      })),
    })),
  };

  // 5) active instructors, transaction-scoped: a copied instructorId is kept
  //    only if the coach is still active (else nulled by the sanitizer).
  const sourceInstructorIds = Array.from(
    new Set(
      sourceTree.blocks.flatMap((block) =>
        block.stations
          .map((station) => station.instructorId)
          .filter((id): id is string => typeof id === "string")
      )
    )
  );
  const activeInstructorIds =
    sourceInstructorIds.length > 0
      ? new Set(
          (
            await tx.instructor.findMany({
              where: { id: { in: sourceInstructorIds }, isActive: true },
              select: { id: true },
            })
          ).map((instructor) => instructor.id)
        )
      : new Set<string>();

  // 6) The ONLY payload sanitizer. Produces fresh create values with
  //    regenerated sortOrders; no forbidden field can survive by construction.
  return copyPlanForTemplate(sourceTree, activeInstructorIds, destinationRosterTraineeIds);
}
