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
//    updates or deletes any row. No publication model is read or written. No
//    course-offering resolution and no Student-identity fallback are used.
//
// The pure eligibility/ordering/sanitization decisions are made by the
// committed pure core (resolveAnchor / selectPreviousSource / copyPlanForTemplate);
// the Prisma queries below only prefilter conservatively for performance.

import { Prisma } from "@/app/generated/prisma/client";
import { dateKey, parseDateKey } from "@/lib/dates";
import { resolveAnchor } from "@/lib/riding-complex-template/resolve-anchor";
import { selectPreviousSource } from "@/lib/riding-complex-template/select-source";
import { copyPlanForTemplate } from "@/lib/riding-complex-template/copy-plan";
import type {
  DestinationPlanCreate,
  DestinationSlotDescriptor,
  LinkedScheduleItemDescriptor,
  SourceCandidateDescriptor,
  SourcePlanTree,
} from "@/lib/riding-complex-template/types";

// The minimal schedule-item projection the anchor resolver needs, plus the id
// (never any group beyond groupName, no title/description/instructorName/etc).
const SCHEDULE_ITEM_SELECT = {
  scheduleItem: { select: { id: true, date: true, startTime: true, groupName: true } },
} as const;

type LinkedScheduleItemRow = {
  scheduleItem: { id: string; date: Date; startTime: string; groupName: string | null };
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

  const destination: DestinationSlotDescriptor = {
    slotId: destinationRidingSlotId,
    anchorDateKey: destinationAnchor.anchorDateKey,
    resolvedGroup: destinationAnchor.resolvedGroup,
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
    candidates.push({
      slotId: plan.ridingSlotId,
      anchorDateKey: candidateAnchor.anchorDateKey,
      startTime: candidateAnchor.startTime.value,
      resolvedGroup: candidateAnchor.resolvedGroup,
      blockCount: plan._count.blocks,
    });
  }

  // 3) Final deterministic selection (strictly earlier, exact same group,
  //    >= 1 block, most-recent-then-latest-start-then-largest-slotId).
  const chosen = selectPreviousSource(destination, candidates);
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
