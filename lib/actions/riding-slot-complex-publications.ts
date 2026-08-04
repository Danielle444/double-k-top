"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
// RS-SEC-1I-CP-RD - the canonical signed-session instructor resolver + the pure,
// dependency-injected read boundary the instructor publication-status reader now
// routes through. The client-supplied instructorId argument is gone; identity
// comes only from the signed session (getCurrentInstructor), same convention as
// riding-slot-complex-read-auth.ts. Publish/unpublish below are UNCHANGED.
import { getCurrentInstructor } from "@/lib/auth/actor";
import { loadComplexPublicationStatusForInstructorWithDeps } from "@/lib/actions/riding-slot-complex-read-auth";
import type { ActionResult } from "@/lib/actions/students";
// RC-A2 - the committed pure title core, used to normalize the live plan.title
// into the frozen publication snapshot at publish time. The generated fallback
// ("תרגול הדרכה") is a READER concern and is never resolved or persisted here.
import { validateComplexSessionTitle } from "@/lib/riding-complex/complex-session-title-core";
// RIDING-COMPLEX-PUBLICATION-TIMEOUT-FIX - pure flatten of the live block ->
// station -> pair tree into batched write inputs, replacing the previous
// per-row create loop (see publishComplexRidingPlanInternal below).
import { flattenComplexPlanForPublication } from "@/lib/riding-complex/complex-plan-publication-tree";

const NOT_FOUND_COMPLEX_PLAN = "תכנון הרכיבה המורכבת לא נמצא. ייתכן שטרם נוצר - נסי לרענן את העמוד.";
const NO_BLOCKS = "לא ניתן לפרסם תכנון ללא טווחי שעות - יש להוסיף לפחות טווח שעות אחד לפני הפרסום.";
const NO_PERMISSION = "אין הרשאה לפרסם תכנון רכיבה מורכבת לחניכים";

// ---------- Actor plumbing ----------
//
// Duplicated (not imported) from the private, identically-shaped
// ComplexPlanActor/adminActor/instructorActor/actorWriteFields in
// riding-slot-complex.ts - same small-local-helper convention already
// established by resolveRidingSlotScheduleMeta in
// riding-slot-horse-publications.ts, rather than exporting those private
// symbols out of riding-slot-complex.ts for one extra call site.
interface ComplexPublicationActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

function adminPublicationActor(admin: { email: string; name: string | null }): ComplexPublicationActor {
  return {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  };
}

function instructorPublicationActor(instructor: { id: string; fullName: string }): ComplexPublicationActor {
  return { instructorId: instructor.id, adminEmail: null, adminName: null, displayName: instructor.fullName };
}

function publicationActorWriteFields(actor: ComplexPublicationActor) {
  return {
    updatedByInstructorId: actor.instructorId,
    updatedByAdminEmail: actor.adminEmail,
    updatedByAdminName: actor.adminName,
    updatedByName: actor.displayName,
  };
}

// ---------- Status (read-only) ----------

export type ComplexRidingPlanPublicationStatusLabel = "UNPUBLISHED" | "CURRENT" | "STALE";

// Smallest DTO needed for a future status badge - never exposes snapshot
// internals (no block/station/pair data here at all, see the student read
// action below for that). STALE is only ever produced by this action and
// its two callers below (admin/instructor) - the trainee read action never
// computes or returns a status at all, so STALE can never reach a trainee.
export interface ComplexRidingPlanPublicationStatus {
  ridingSlotId: string;
  status: ComplexRidingPlanPublicationStatusLabel;
  sourceVersion: number | null;
  liveVersion: number | null;
  firstPublishedAt: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

// Shared by both status actions below (admin and instructor alike) - the
// shape of "unpublished/current/stale" is identical regardless of who's
// asking, same convention as buildHorsePublicationStatus in
// riding-slot-horse-publications.ts. liveVersion === null is how a caller
// distinguishes "no plan created yet" from "plan exists, never published"
// (both report status UNPUBLISHED) without a separate boolean field.
async function buildComplexPublicationStatus(ridingSlotId: string): Promise<ComplexRidingPlanPublicationStatus> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId },
    include: { publication: true },
  });

  if (!plan) {
    return {
      ridingSlotId,
      status: "UNPUBLISHED",
      sourceVersion: null,
      liveVersion: null,
      firstPublishedAt: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  const pub = plan.publication;
  if (!pub) {
    return {
      ridingSlotId,
      status: "UNPUBLISHED",
      sourceVersion: null,
      liveVersion: plan.version,
      firstPublishedAt: null,
      updatedAt: null,
      updatedByName: null,
    };
  }

  return {
    ridingSlotId,
    status: pub.sourceVersion === plan.version ? "CURRENT" : "STALE",
    sourceVersion: pub.sourceVersion,
    liveVersion: plan.version,
    firstPublishedAt: pub.firstPublishedAt.toISOString(),
    updatedAt: pub.updatedAt.toISOString(),
    updatedByName: pub.updatedByName,
  };
}

export async function getComplexRidingPlanPublicationStatusForAdmin(
  ridingSlotId: string
): Promise<ComplexRidingPlanPublicationStatus> {
  await requireAdmin();
  return buildComplexPublicationStatus(ridingSlotId);
}

// RS-SEC-1I-CP-RD - identity comes ONLY from the signed session
// (getCurrentInstructor), never a client-supplied instructorId (the parameter is
// gone). Reading status has no permission-level gate beyond being a signed ACTIVE
// instructor - NOT canEditRidingNotes - matching getRidingSlotComplexPlanFor-
// Instructor's read convention; only publishing is gated. The gate + fail-closed-
// to-null orchestration lives in the pure DI boundary
// loadComplexPublicationStatusForInstructorWithDeps: a null/invalid/inactive/
// wrong-audience session (or a thrown resolver) returns null WITHOUT running
// buildComplexPublicationStatus, and a genuine reader error still propagates.
export async function getComplexRidingPlanPublicationStatusForInstructor(
  ridingSlotId: string
): Promise<ComplexRidingPlanPublicationStatus | null> {
  return loadComplexPublicationStatusForInstructorWithDeps(
    { getCurrentInstructor, readStatus: buildComplexPublicationStatus },
    ridingSlotId
  );
}

// ---------- Publish / republish (write) ----------

export interface PublishComplexRidingPlanResult extends ActionResult {
  status?: ComplexRidingPlanPublicationStatus;
}

// Shared core of publishComplexRidingPlanAsAdmin/AsInstructor.
//
// Consistency: the live plan + its full blocks/stations/pairs tree is read
// INSIDE the transaction below, and the publication upsert/snapshot-replace
// uses exactly that read's version/blocks/stations/pairs - never a value
// read before the transaction opened. Same guarantee as
// publishRidingHorseListToInstructorsInternal's identical comment.
//
// Concurrency: the publication upsert is a single atomic
// INSERT ... ON CONFLICT DO UPDATE keyed on the planId unique constraint -
// two concurrent publish calls for the same plan can never both "create"
// and collide (same reasoning as the horse-list publish's own upsert, which
// also needs no advisory lock for this same reason). Beyond that, Postgres
// takes a row lock on the conflicting key for the transaction that reaches
// the upsert first, so a second concurrent publish call simply waits for
// the first transaction to fully commit (upsert + delete + recreate, all of
// it) before it can even start its own upsert - no interleaving of one
// publish's delete+recreate with another's is possible, so no partially
// rebuilt snapshot can ever become visible to a reader.
async function publishComplexRidingPlanInternal(
  ridingSlotId: string,
  actor: ComplexPublicationActor
): Promise<PublishComplexRidingPlanResult> {
  const trimmedId = ridingSlotId?.trim();
  if (!trimmedId) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const actorData = publicationActorWriteFields(actor);

  // RIDING-COMPLEX-PUBLICATION-TIMEOUT-FIX - explicit, narrowly scoped timeout
  // (Prisma's default is 5000ms/2000ms maxWait). This is defense-in-depth ONLY:
  // the actual fix is the batched write below (was O(blocks + 2*stations)
  // sequential round trips, now a constant ~6 regardless of plan size) - see
  // the P2028 audit that diagnosed a Production plan (8 blocks/22 stations/39
  // pairs) exceeding the 5000ms default purely from sequential per-row
  // `create()` calls, not from any single slow query. maxWait/isolationLevel
  // are intentionally left at their defaults - nothing observed motivates
  // changing either.
  const txResult = await prisma.$transaction(
    async (tx) => {
      // The one consistent transactional read this whole publish is built
      // from - plan.version and every block/station/pair below are never
      // re-read or mixed with a value obtained outside this call.
      const plan = await tx.ridingSlotComplexPlan.findUnique({
        where: { ridingSlotId: trimmedId },
        include: {
          blocks: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            include: {
              stations: {
                orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                include: {
                  instructor: { select: { fullName: true } },
                  pairs: {
                    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
                    include: {
                      trainee1: { select: { fullName: true } },
                      trainee2: { select: { fullName: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!plan) {
        return { ok: false as const, error: NOT_FOUND_COMPLEX_PLAN };
      }
      // The one hard blocker beyond "plan exists" - directly mirrors
      // publishRidingHorseListToInstructorsInternal's NOT_FOUND_HORSE_LIST
      // precedent (must have something to publish). Every other
      // incompleteness (station without coach/arena, pair without trainee2/
      // horse, empty station, block with no stations) stays a warning only,
      // exactly as it already is at station-save time - never invented here.
      if (plan.blocks.length === 0) {
        return { ok: false as const, error: NO_BLOCKS };
      }

      // RC-A2 - freeze the CURRENT normalized live title into the snapshot at
      // publish/republish time. plan.title is already read above (findUnique with
      // `include` returns every scalar), re-normalized through the RC-A0 core as
      // defence-in-depth: a null (or legacy-malformed) live title becomes a null
      // snapshot, and the fallback string is NEVER stored. This is the ONLY place
      // titleSnapshot is written, so a later live-title edit (which bumps
      // plan.version and makes the publication STALE) never mutates it until an
      // explicit republish writes the then-current title here.
      const titleValidation = validateComplexSessionTitle(plan.title);
      const titleSnapshot = titleValidation.ok ? titleValidation.value : null;

      const publication = await tx.ridingSlotComplexPublication.upsert({
        where: { planId: plan.id },
        create: {
          planId: plan.id,
          sourceVersion: plan.version,
          titleSnapshot,
          ...actorData,
          // firstPublishedAt intentionally omitted - uses the schema default
          // (now()) on create, and is never listed in `update` below, so an
          // existing value is always left untouched on every republish.
        },
        update: {
          sourceVersion: plan.version,
          titleSnapshot,
          ...actorData,
        },
      });

      // Wholesale delete+recreate of every snapshot child row - same
      // convention as saveComplexStationInternal's pair replace and
      // publishRidingHorseListToInstructorsInternal's item replace. Deleting
      // this publication's blocks is enough: the schema's onDelete: Cascade
      // (publication -> blocks -> stations -> pairs) removes every station/
      // pair snapshot underneath them in the same statement.
      await tx.ridingSlotComplexPublicationBlock.deleteMany({ where: { publicationId: publication.id } });

      // RIDING-COMPLEX-PUBLICATION-TIMEOUT-FIX - BATCHED create, replacing the
      // previous per-block/per-station sequential create loop (that pattern's
      // O(blocks + 2*stations) round trips is exactly what exceeded Prisma's
      // 5000ms default transaction timeout against a real Production plan of
      // 8 blocks/22 stations/39 pairs - P2028). Every publication row's id is
      // `@default(cuid())`, a Prisma CLIENT-side default, so nothing here
      // depends on the DB to hand back an id the app couldn't otherwise know;
      // `createManyAndReturn` is used only so each level's generated id can be
      // correlated (via the stable sourceBlockId/sourceStationId columns this
      // schema already carries) to build the next level's foreign keys - not
      // because the id itself needs the DB. This reduces the write shape to a
      // constant ~3 batched round trips (blocks, stations, pairs) regardless of
      // plan size, instead of one round trip per block and per station.
      const tree = flattenComplexPlanForPublication(plan.blocks);

      const createdBlocks = await tx.ridingSlotComplexPublicationBlock.createManyAndReturn({
        data: tree.blocks.map((b) => ({
          publicationId: publication.id,
          sourceBlockId: b.sourceBlockId,
          startTime: b.startTime,
          endTime: b.endTime,
          sortOrder: b.sortOrder,
        })),
        select: { id: true, sourceBlockId: true },
      });
      const publicationBlockIdBySourceBlockId = new Map(
        createdBlocks.map((b) => [b.sourceBlockId as string, b.id] as const)
      );

      // A block with zero stations is legal (see the NO_BLOCKS comment above) -
      // tree.stations may legitimately be empty, and an empty createMany/
      // createManyAndReturn `data: []` is skipped, same convention the
      // previous code already used for the (per-station) pairs createMany.
      if (tree.stations.length > 0) {
        const createdStations = await tx.ridingSlotComplexPublicationStation.createManyAndReturn({
          data: tree.stations.map((s) => ({
            publicationBlockId: publicationBlockIdBySourceBlockId.get(s.sourceBlockId)!,
            sourceStationId: s.sourceStationId,
            instructorId: s.instructorId,
            instructorNameSnapshot: s.instructorNameSnapshot,
            arena: s.arena,
            sortOrder: s.sortOrder,
          })),
          select: { id: true, sourceStationId: true },
        });
        const publicationStationIdBySourceStationId = new Map(
          createdStations.map((s) => [s.sourceStationId as string, s.id] as const)
        );

        // A station with zero pairs is legal (same "warning, never a publish
        // blocker" rule) - tree.pairs may legitimately be empty.
        if (tree.pairs.length > 0) {
          // note is deliberately never included here - see
          // RidingSlotComplexPublicationPair's own schema comment.
          await tx.ridingSlotComplexPublicationPair.createMany({
            data: tree.pairs.map((p) => ({
              publicationStationId: publicationStationIdBySourceStationId.get(p.sourceStationId)!,
              sourcePairId: p.sourcePairId,
              trainee1Id: p.trainee1Id,
              trainee1NameSnapshot: p.trainee1NameSnapshot,
              trainee2Id: p.trainee2Id,
              trainee2NameSnapshot: p.trainee2NameSnapshot,
              horseName: p.horseName,
              sortOrder: p.sortOrder,
            })),
          });
        }
      }

      return { ok: true as const, publication };
    },
    { timeout: 15_000 }
  );

  if (!txResult.ok) {
    return { success: false, error: txResult.error };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  revalidatePath("/student");

  const pub = txResult.publication;
  return {
    success: true,
    status: {
      ridingSlotId: trimmedId,
      // sourceVersion was just set to the exact live version read above, so
      // the publication is always CURRENT immediately after a successful call.
      status: "CURRENT",
      sourceVersion: pub.sourceVersion,
      liveVersion: pub.sourceVersion,
      firstPublishedAt: pub.firstPublishedAt.toISOString(),
      updatedAt: pub.updatedAt.toISOString(),
      updatedByName: pub.updatedByName,
    },
  };
}

export async function publishComplexRidingPlanAsAdmin(
  ridingSlotId: string
): Promise<PublishComplexRidingPlanResult> {
  const admin = await requireAdmin();
  return publishComplexRidingPlanInternal(ridingSlotId, adminPublicationActor(admin));
}

// Instructors have no NextAuth session in this app, so isActive/
// canEditRidingNotes are re-read from the DB on every call - never trusted
// from the client. Reuses the exact flag that already gates every write in
// riding-slot-complex.ts - no new permission introduced.
export async function publishComplexRidingPlanAsInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<PublishComplexRidingPlanResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return publishComplexRidingPlanInternal(ridingSlotId, instructorPublicationActor(instructor));
}

// ---------- Unpublish (write) ----------

export interface UnpublishComplexRidingPlanResult extends ActionResult {
  // true when there was nothing to unpublish (already unpublished, or the
  // plan doesn't exist) - success stays true either way, matching this
  // action's "friendly, idempotent" requirement rather than surfacing that
  // as an error.
  alreadyUnpublished?: boolean;
}

// Shared core of unpublishComplexRidingPlanAsAdmin/AsInstructor - the single
// validated unpublish mutation, identical to the publish path's internal/thin-
// wrapper split above. The two wrappers differ ONLY in how they authorize the
// caller; once authorized, both remove exactly the same trainee-visible
// publication snapshot here, so the two trust tiers can never drift into two
// different unpublish behaviors.
//
// Only the publication snapshot is removed - the live editable complex plan
// (RidingSlotComplexPlan and its blocks/stations/pairs) is never touched, so
// unpublishing is always a reversible "hide from trainees", never data loss.
async function unpublishComplexRidingPlanInternal(
  ridingSlotId: string
): Promise<UnpublishComplexRidingPlanResult> {
  const trimmedId = ridingSlotId?.trim();
  if (!trimmedId) {
    return { success: true, alreadyUnpublished: true };
  }

  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId: trimmedId },
    select: { id: true },
  });
  if (!plan) {
    return { success: true, alreadyUnpublished: true };
  }

  // deleteMany (not delete-by-id) - never throws not-found, tolerant of a
  // concurrent unpublish already having removed the row, same convention as
  // every deleteMany in riding-slot-complex.ts. Cascade (schema
  // onDelete: Cascade, publication -> blocks -> stations -> pairs) removes
  // every snapshot child row in the same statement; the live plan/blocks/
  // stations/pairs are never touched by this call.
  const deleted = await prisma.ridingSlotComplexPublication.deleteMany({ where: { planId: plan.id } });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  revalidatePath("/student");

  return { success: true, alreadyUnpublished: deleted.count === 0 };
}

export async function unpublishComplexRidingPlanAsAdmin(
  ridingSlotId: string
): Promise<UnpublishComplexRidingPlanResult> {
  await requireAdmin();
  return unpublishComplexRidingPlanInternal(ridingSlotId);
}

// Same server-authoritative capability tier as
// publishComplexRidingPlanAsInstructor (isActive && canEditRidingNotes,
// re-read from the DB on every call - instructors have no NextAuth session, so
// no client flag is ever trusted). Product decision: an authorized instructor
// may unpublish under exactly the requirements that let them publish/republish;
// a read-only or inactive instructor is denied via the same generic NO_PERMISSION
// contract as publish, carrying no id/PII. Both wrappers then run the one shared
// unpublishComplexRidingPlanInternal above, so the admin path and its return
// contract are unchanged.
export async function unpublishComplexRidingPlanAsInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<UnpublishComplexRidingPlanResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return unpublishComplexRidingPlanInternal(ridingSlotId);
}

// ---------- Trainee-scoped read (read-only) ----------
//
// RIDING-COMPLEX-PUBLICATION P7C - product decision changed from "trainee
// sees only their own pair" to "trainee sees the entire published plan for
// the relevant riding slot, with their own name highlighted client-side by
// ID." getPublishedComplexRidingAssignmentsForStudentInternal (the P7A
// own-pair-only shape) is removed entirely rather than kept alongside this -
// it was never wired into any caller (confirmed: no other file referenced
// it), so there is nothing depending on the old shape.

export interface PublishedComplexRidingPlanPairForStudent {
  // Kept only so the client can compare by stable ID to highlight the
  // logged-in trainee and to render the second trainee slot only when
  // present - never used for anything beyond that (no name matching, no
  // click-through target exposed here). null when the snapshot's trainee FK
  // has gone null via onDelete: SetNull (see RidingSlotComplexPublicationPair's
  // own schema comment) - the *Name snapshot fields remain the source of
  // truth for display regardless.
  trainee1Id: string | null;
  trainee1Name: string;
  trainee2Id: string | null;
  trainee2Name: string | null;
  horseName: string | null;
  sortOrder: number;
}

export interface PublishedComplexRidingPlanStationForStudent {
  coachName: string | null;
  arena: string | null;
  sortOrder: number;
  pairs: PublishedComplexRidingPlanPairForStudent[];
}

export interface PublishedComplexRidingPlanBlockForStudent {
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: PublishedComplexRidingPlanStationForStudent[];
}

// Never includes publication id, sourceVersion, updatedBy* fields, source*Id
// traceability columns, pair.note, or any warning/status concept - none of
// that exists anywhere in this return shape, not merely omitted by
// convention.
export interface PublishedComplexRidingPlanForStudent {
  ridingSlotId: string;
  // RC-A4 - the frozen published session title snapshot (RC-A2), or null. The
  // trainee reader resolves the displayed title via the RC-A0 PUBLISHED path
  // (this snapshot, else the caller's generated fallback) - NEVER the live
  // plan.title. A null here means the generated fallback applies.
  titleSnapshot: string | null;
  blocks: PublishedComplexRidingPlanBlockForStudent[];
}

// Batched by ridingSlotIds - suitable for a single call from
// getScheduleForStudent covering every riding-linked item in one week/day
// view, so resolving N riding slots never costs N round trips. Exported (not
// module-private) so lib/actions/student-schedule.ts can call it directly -
// see that file's own integration for how ridingSlotIds is derived (always
// from that student's own server-resolved, already-published-week schedule
// items, never a client-supplied list).
//
// Privacy has two independent layers, since any exported function in a
// "use server" file is directly callable by a client, not merely through
// whatever caller happens to import it - this must be safe to call with an
// attacker-chosen ridingSlotIds array, not just a well-behaved one:
//   1. Re-reads Student.isActive fresh from the DB by studentId on every
//      call - the client-held session's own copy is never trusted, same
//      convention as getRidingHorsePublicationsForStudent.
//   2. The publication query itself additionally requires each riding slot's
//      anchor ScheduleItem to belong to a currently PUBLISHED WeeklySchedule
//      (plan.ridingSlot.scheduleItem.weeklySchedule.isPublished) - the exact
//      same "a stale/tampered id must never leak unpublished content" defense-
//      in-depth check getScheduleForStudent's own week.isPublished guard
//      already performs, applied here so this action can never become a
//      "fetch any complex plan by riding slot id" backdoor around that check.
// Reads ONLY the publication snapshot tables for actual plan content
// (RidingSlotComplexPublication/Block/Station/Pair) - the one touch of
// RidingSlotComplexPlan/RidingSlot/ScheduleItem/WeeklySchedule below is
// exclusively to resolve the join-key/publication-gate above, never to read
// live block/station/pair content or any draft data. Returns an empty map
// uniformly for a nonexistent/inactive student, an empty ridingSlotIds list,
// or riding slots with no (or no publicly-visible) publication - never a
// distinguishable error.
export async function getPublishedComplexRidingPlansForStudentInternal(
  studentId: string,
  ridingSlotIds: string[]
): Promise<Map<string, PublishedComplexRidingPlanForStudent>> {
  if (ridingSlotIds.length === 0) return new Map();

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { isActive: true },
  });
  if (!student || !student.isActive) return new Map();

  const publications = await prisma.ridingSlotComplexPublication.findMany({
    where: {
      plan: {
        ridingSlotId: { in: ridingSlotIds },
        ridingSlot: { scheduleItem: { weeklySchedule: { isPublished: true } } },
      },
    },
    select: {
      plan: { select: { ridingSlotId: true } },
      // RC-A4 - read-only: the published title snapshot for the trainee reader.
      titleSnapshot: true,
      blocks: {
        orderBy: { sortOrder: "asc" },
        select: {
          startTime: true,
          endTime: true,
          sortOrder: true,
          stations: {
            orderBy: { sortOrder: "asc" },
            select: {
              instructorNameSnapshot: true,
              arena: true,
              sortOrder: true,
              pairs: {
                orderBy: { sortOrder: "asc" },
                select: {
                  trainee1Id: true,
                  trainee1NameSnapshot: true,
                  trainee2Id: true,
                  trainee2NameSnapshot: true,
                  horseName: true,
                  sortOrder: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const result = new Map<string, PublishedComplexRidingPlanForStudent>();
  for (const pub of publications) {
    result.set(pub.plan.ridingSlotId, {
      ridingSlotId: pub.plan.ridingSlotId,
      titleSnapshot: pub.titleSnapshot,
      blocks: pub.blocks.map((block) => ({
        startTime: block.startTime,
        endTime: block.endTime,
        sortOrder: block.sortOrder,
        stations: block.stations.map((station) => ({
          coachName: station.instructorNameSnapshot,
          arena: station.arena,
          sortOrder: station.sortOrder,
          pairs: station.pairs.map((pair) => ({
            trainee1Id: pair.trainee1Id,
            // Always populated at publish time in practice (see
            // RidingSlotComplexPublicationPair's own schema comment on why
            // trainee1NameSnapshot is never actually null) - the `?? ""`
            // fallback exists only to keep this field's type honest as a
            // required string without inventing a new placeholder message
            // for a case that should never occur.
            trainee1Name: pair.trainee1NameSnapshot ?? "",
            trainee2Id: pair.trainee2Id,
            trainee2Name: pair.trainee2NameSnapshot,
            horseName: pair.horseName,
            sortOrder: pair.sortOrder,
          })),
        })),
      })),
    });
  }

  return result;
}
