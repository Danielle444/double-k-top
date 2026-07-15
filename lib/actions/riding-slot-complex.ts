"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { dateKey } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions/students";
import { getKnownRidingHorseNames } from "@/lib/actions/riding-slots";
// RIDING-PAIRS P4a - reuses the exact same horse/responsible-instructor
// resolution the simple horse list already uses, instead of a separate,
// reduced candidate shape. One-way dependency only (riding-slot-horses.ts
// imports nothing from this file) - see buildHorseCandidates's own comment.
import { buildHorseCandidates, type RidingHorseCandidate } from "@/lib/actions/riding-slot-horses";

const NOT_FOUND_RIDING_SLOT = 'ניהול הרכיבה לא נמצא. נסי לרענן את העמוד.';
const NOT_FOUND_COMPLEX_PLAN = "תכנון הרכיבה המורכבת לא נמצא. ייתכן שטרם נוצר - נסי לרענן את העמוד.";
const NOT_FOUND_BLOCK = "הבלוק לא נמצא בתכנון רכיבה זה. ייתכן שנמחק - נסי לרענן את העמוד.";
const NOT_FOUND_STATION = "התחנה לא נמצאה בבלוק זה. ייתכן שנמחקה - נסי לרענן את העמוד.";
const NO_PERMISSION = "אין הרשאה לערוך תכנון רכיבה מורכבת";
const SIMPLE_LIST_EXISTS = "לא ניתן ליצור תכנון רכיבה מורכבת - קיימת כבר רשימת סוסים רגילה עבור רכיבה זו";
const INVALID_TIME = "פורמט שעה לא תקין (HH:MM)";
const END_BEFORE_START = "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
const OVERLAP_WARNING = "קיים טווח שעות נוסף שחופף לטווח זה";
const SAME_TRAINEE_TWICE_IN_PAIR = "לא ניתן לבחור את אותו/ה חניכ/ה פעמיים באותו זוג";
const PAIR_MISSING_TRAINEE1 = "יש לבחור חניכ/ה ראשונ/ה לכל זוג שמכיל פרטים (סוס, הערה או חניכ/ה שני/ה)";
const LOCK_TIMEOUT = "המערכת עמוסה כרגע - נסי שוב בעוד רגע";
const DUPLICATE_TRAINEE_IN_BLOCK = "אותו/ה חניכ/ה נבחר/ה יותר מפעם אחת באותו טווח שעות";
const DUPLICATE_HORSE_IN_BLOCK = "אותו שם סוס נבחר יותר מפעם אחת באותו טווח שעות";
const DUPLICATE_INSTRUCTOR_IN_BLOCK = "אותו/ה מדריכ/ה משובצ/ת ליותר מתחנה אחת באותו טווח שעות";
const INVALID_INSTRUCTOR = "אחד או יותר מהמדריכים/ות שנבחרו אינם/ן פעילים/ות או לא נמצאו";
const INVALID_TRAINEE = "אחד או יותר מהחניכים שנבחרו אינם/ן פעילים/ות או לא נמצאו";
const INVALID_BLOCK_ORDER = "רשימת סדר הבלוקים אינה תואמת את הבלוקים הקיימים בתכנון זה";
const INVALID_STATION_ORDER = "רשימת סדר התחנות אינה תואמת את התחנות הקיימות בבלוק זה";

// ---------- Shared read model ----------

// RIDING-PAIRS P4a - type alias to RidingHorseCandidate (lib/actions/riding-slot-horses.ts),
// which already carries exactly the fields needed here (horseName/
// horseNameDisplay/responsibleInstructorNames on top of the original
// studentId/studentName/groupName/subgroupNumber) - kept as its own named
// alias rather than importing RidingHorseCandidate directly everywhere, so
// every existing downstream reference to RidingSlotComplexTraineeCandidate
// (types, prop names) keeps working unchanged.
export type RidingSlotComplexTraineeCandidate = RidingHorseCandidate;

export interface RidingSlotComplexPairRow {
  id: string;
  trainee1Id: string | null;
  trainee1Name: string | null;
  trainee2Id: string | null;
  trainee2Name: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
}

// RIDING-PAIRS P5b - one coach/arena station within a block. instructor is
// resolved live (not a snapshot), same convention as trainee1Name/
// trainee2Name on RidingSlotComplexPairRow - null-safe if the Instructor row
// is later deleted (the FK is onDelete: SetNull, so instructorId and this
// resolved object go null together, the station itself is never affected).
export interface RidingSlotComplexStationRow {
  id: string;
  instructorId: string | null;
  instructor: { id: string; fullName: string } | null;
  arena: string | null;
  sortOrder: number;
  pairs: RidingSlotComplexPairRow[];
}

// RIDING-PAIRS P5b - a block is now a pure time range; arena/instructor(s)/
// pairs all moved to RidingSlotComplexStationRow, one level deeper.
export interface RidingSlotComplexBlockRow {
  id: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: RidingSlotComplexStationRow[];
}

export interface RidingSlotComplexPlanRow {
  id: string;
  ridingSlotId: string;
  updatedAt: string;
  updatedByName: string;
  blocks: RidingSlotComplexBlockRow[];
}

export interface RidingSlotComplexScheduleMeta {
  dateKey: string;
  startTime: string;
  endTime: string;
  activityTitle: string;
}

// RIDING-PAIRS P5b - now describes one STATION's completeness (a station has
// exactly one instructor, not a list - noInstructor is singular, renamed
// from the old block-level noInstructors).
export interface RidingSlotComplexSaveWarnings {
  noInstructor: boolean;
  noArena: boolean;
  zeroPairs: boolean;
  pairsMissingTrainee2: number;
  pairsMissingHorse: number;
}

export interface RidingSlotComplexPlanForEditing {
  ridingSlotId: string;
  plan: RidingSlotComplexPlanRow;
  scheduleMeta: RidingSlotComplexScheduleMeta | null;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  hasSimpleHorseList: boolean;
  canEdit: boolean;
}

export interface RidingSlotComplexPlanActionResult extends ActionResult {
  plan?: RidingSlotComplexPlanRow;
  // Station-save warnings only (see RidingSlotComplexSaveWarnings) - never
  // set by a block save, which uses overlapWarning below instead.
  warnings?: RidingSlotComplexSaveWarnings;
  newBlockId?: string;
  // Block-save only - a non-blocking notice that the saved time range
  // overlaps another block already in this plan (see saveComplexBlockInternal).
  // Never an error; the save still succeeds.
  overlapWarning?: string;
}

interface ComplexPlanActor {
  instructorId: string | null;
  adminEmail: string | null;
  adminName: string | null;
  displayName: string;
}

// Small mechanical helpers only - not a broader refactor. Every
// *AsAdmin/*AsInstructor wrapper below builds the same two actor shapes and
// every *Internal function derives the same write-fields shape from an
// actor; these three helpers just remove that repetition without touching
// any behavior.
function adminActor(admin: { email: string; name: string | null }): ComplexPlanActor {
  return {
    instructorId: null,
    adminEmail: admin.email,
    adminName: admin.name ?? null,
    displayName: admin.name ?? admin.email,
  };
}

function instructorActor(instructor: { id: string; fullName: string }): ComplexPlanActor {
  return { instructorId: instructor.id, adminEmail: null, adminName: null, displayName: instructor.fullName };
}

function actorWriteFields(actor: ComplexPlanActor) {
  return {
    updatedByInstructorId: actor.instructorId,
    updatedByAdminEmail: actor.adminEmail,
    updatedByAdminName: actor.adminName,
    updatedByName: actor.displayName,
  };
}

// Duplicated (not imported) from the private, identically-shaped
// resolveRidingSlotScheduleMeta helper in riding-slot-horse-publications.ts -
// same small-local-helper convention already established there rather than
// exporting it for reuse across features.
async function resolveComplexScheduleMeta(ridingSlotId: string): Promise<RidingSlotComplexScheduleMeta | null> {
  const links = await prisma.ridingSlotScheduleItem.findMany({
    where: { ridingSlotId },
    include: { scheduleItem: true },
  });
  if (links.length === 0) return null;

  const scheduleItems = links
    .map((link) => link.scheduleItem)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const first = scheduleItems[0];
  const last = scheduleItems[scheduleItems.length - 1];

  return {
    dateKey: dateKey(first.date),
    startTime: first.startTime,
    endTime: last.endTime,
    activityTitle: first.title,
  };
}

type PairWithRelations = {
  id: string;
  trainee1Id: string | null;
  trainee2Id: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
  trainee1: { id: string; fullName: string } | null;
  trainee2: { id: string; fullName: string } | null;
};

type StationWithRelations = {
  id: string;
  instructorId: string | null;
  arena: string | null;
  sortOrder: number;
  instructor: { id: string; fullName: string } | null;
  pairs: PairWithRelations[];
};

type BlockWithRelations = {
  id: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  stations: StationWithRelations[];
};

type PlanWithRelations = {
  id: string;
  ridingSlotId: string;
  updatedAt: Date;
  updatedByName: string;
  blocks: BlockWithRelations[];
};

const COMPLEX_PLAN_INCLUDE = {
  blocks: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: {
      stations: {
        orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
        include: {
          instructor: { select: { id: true, fullName: true } },
          pairs: {
            orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
            include: {
              trainee1: { select: { id: true, fullName: true } },
              trainee2: { select: { id: true, fullName: true } },
            },
          },
        },
      },
    },
  },
};

function toPairRow(p: PairWithRelations): RidingSlotComplexPairRow {
  return {
    id: p.id,
    trainee1Id: p.trainee1Id,
    trainee1Name: p.trainee1?.fullName ?? null,
    trainee2Id: p.trainee2Id,
    trainee2Name: p.trainee2?.fullName ?? null,
    horseName: p.horseName,
    note: p.note,
    sortOrder: p.sortOrder,
  };
}

function toStationRow(s: StationWithRelations): RidingSlotComplexStationRow {
  return {
    id: s.id,
    instructorId: s.instructorId,
    instructor: s.instructor,
    arena: s.arena,
    sortOrder: s.sortOrder,
    pairs: s.pairs.map(toPairRow),
  };
}

function toBlockRow(b: BlockWithRelations): RidingSlotComplexBlockRow {
  return {
    id: b.id,
    startTime: b.startTime,
    endTime: b.endTime,
    sortOrder: b.sortOrder,
    stations: b.stations.map(toStationRow),
  };
}

function toPlanRow(p: PlanWithRelations): RidingSlotComplexPlanRow {
  return {
    id: p.id,
    ridingSlotId: p.ridingSlotId,
    updatedAt: p.updatedAt.toISOString(),
    updatedByName: p.updatedByName,
    blocks: p.blocks.map(toBlockRow),
  };
}

async function validateActiveInstructorIds(instructorIds: string[]): Promise<boolean> {
  if (instructorIds.length === 0) return true;
  const found = await prisma.instructor.findMany({ where: { id: { in: instructorIds }, isActive: true } });
  return found.length === instructorIds.length;
}

async function validateActiveTraineeIds(traineeIds: string[]): Promise<boolean> {
  if (traineeIds.length === 0) return true;
  const found = await prisma.student.findMany({ where: { id: { in: traineeIds }, isActive: true } });
  return found.length === traineeIds.length;
}

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

// Builds the full editing shape for an EXISTING complex plan only - callers
// (get/create/save/delete/duplicate/reorder) all re-derive this after their
// own mutation so the caller always gets a fresh, complete snapshot rather
// than a partially-updated local copy. candidates reuse buildHorseCandidates
// (lib/actions/riding-slot-horses.ts) directly - the exact same group/
// subgroup/assignment roster derivation AND horse/responsible-instructor
// resolution the simple horse list already relies on, rather than
// maintaining a second, independently-drifting copy of that logic, per the
// approved "do not default to every active trainee" candidate-scope rule.
async function buildComplexPlanForEditing(
  ridingSlotId: string,
  opts: { canEdit: boolean }
): Promise<RidingSlotComplexPlanForEditing | null> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({
    where: { ridingSlotId },
    include: COMPLEX_PLAN_INCLUDE,
  });
  if (!plan) return null;

  const [scheduleMeta, candidates, knownHorseNames, simpleList] = await Promise.all([
    resolveComplexScheduleMeta(ridingSlotId),
    buildHorseCandidates(ridingSlotId),
    getKnownRidingHorseNames(),
    prisma.ridingSlotHorseList.findUnique({ where: { ridingSlotId }, select: { id: true } }),
  ]);

  return {
    ridingSlotId,
    plan: toPlanRow(plan),
    scheduleMeta,
    candidates,
    knownHorseNames,
    hasSimpleHorseList: Boolean(simpleList),
    canEdit: opts.canEdit,
  };
}

// ---------- Get (read-only, no mutation) ----------

// Returns null both when the RidingSlot doesn't exist AND when it exists but
// has no RidingSlotComplexPlan yet (mode not chosen) - same "collapse
// distinguishable-but-both-empty cases into one null return" convention
// already used by getRidingSlotHorseListForInstructor elsewhere in this
// app, since this function's return type has no separate error channel.
export async function getRidingSlotComplexPlanForAdmin(
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  await requireAdmin();
  return buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
}

// instructorId is checked for existence/isActive only - NOT
// canEditRidingNotes. Viewing has no permission-level gate, matching
// getRidingSlotHorseListForInstructor's identical read convention; canEdit
// is exposed to the caller so a read-only instructor's UI can hide edit
// controls without a second permission check.
export async function getRidingSlotComplexPlanForInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive) return null;
  return buildComplexPlanForEditing(ridingSlotId, { canEdit: instructor.canEditRidingNotes });
}

// ---------- Create plan (mutual-exclusivity gate) ----------
// UNCHANGED from P2/P3a - not touched by the P5 station redesign.

// Shared core of createRidingSlotComplexPlanAsAdmin/AsInstructor. The
// simple-list-exists check and the plan insert happen inside ONE
// transaction, using the same discriminated-transaction-result convention
// (txResult.ok) already used by publishRidingHorseListToInstructorsInternal
// in riding-slot-horse-publications.ts, rather than throwing. This
// transaction and saveRidingSlotHorseListInternal's matching guard
// (lib/actions/riding-slot-horses.ts) take the same Postgres advisory
// transaction lock, keyed by ridingSlotId, as their very first statement -
// see the inline comment below for why a pre-transaction read alone cannot
// close the two-tab race, and why the *_xact_* (transaction-scoped, not
// session-scoped) lock variant is required under Supabase's pgbouncer
// transaction-mode pooling.
async function createComplexPlanInternal(ridingSlotId: string, actor: ComplexPlanActor): Promise<ActionResult> {
  const ridingSlot = await prisma.ridingSlot.findUnique({ where: { id: ridingSlotId } });
  if (!ridingSlot) {
    return { success: false, error: NOT_FOUND_RIDING_SLOT };
  }

  const actorData = actorWriteFields(actor);

  // Waiting on the advisory lock below counts against this transaction's
  // normal interactive-transaction timeout (Prisma default 5000ms) - it is
  // in-body wait time, not connection-acquisition wait time. No custom
  // timeout is added: this transaction's own work is a handful of point
  // reads/writes - the only thing that could make it run long is lock
  // contention, and extending the timeout would just make a genuinely stuck
  // caller wait longer for no benefit. If two callers contend for the same
  // ridingSlotId for more than 5s, Prisma aborts the losing transaction with
  // a P2028 timeout error - caught below and mapped to a clear Hebrew
  // message, same duck-typed error-code check already used for P2002 in
  // lib/actions/weekly-feedback.ts, so no raw Prisma error ever reaches the
  // client.
  let txResult: { ok: boolean };
  try {
    txResult = await prisma.$transaction(async (tx) => {
      // Read Committed (Postgres/Prisma's default) lets two concurrent
      // transactions each read "no simple list yet" before either commits -
      // a plain pre-transaction read cannot prevent that. This advisory lock
      // is not a schema object (no migration needed) and is
      // transaction-scoped (auto-released at commit/rollback), so it is safe
      // to take under a pooled connection and fully serializes any
      // concurrent create-plan / create-simple-list attempt for this exact
      // ridingSlotId - the second caller simply waits for the first's
      // transaction to finish, then re-checks with up-to-date data.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ridingSlotId}))`;

      const existingPlan = await tx.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
      if (existingPlan) return { ok: true as const }; // idempotent - the caller re-reads below regardless

      const simpleList = await tx.ridingSlotHorseList.findUnique({
        where: { ridingSlotId },
        select: { id: true },
      });
      if (simpleList) {
        return { ok: false as const };
      }

      await tx.ridingSlotComplexPlan.create({ data: { ridingSlotId, ...actorData } });
      return { ok: true as const };
    });
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "P2028") {
      return { success: false, error: LOCK_TIMEOUT };
    }
    throw err;
  }

  if (!txResult.ok) {
    return { success: false, error: SIMPLE_LIST_EXISTS };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  return { success: true };
}

export async function createRidingSlotComplexPlanAsAdmin(
  ridingSlotId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  const result = await createComplexPlanInternal(ridingSlotId, adminActor(admin));
  if (!result.success) return result;
  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

// Instructors have no NextAuth session in this app, so isActive/
// canEditRidingNotes are re-read from the DB on every call - never trusted
// from the client. Reuses the exact flag that already gates
// saveRidingSlotHorseListAsInstructor - no new permission introduced.
export async function createRidingSlotComplexPlanAsInstructor(
  instructorId: string,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  const result = await createComplexPlanInternal(ridingSlotId, instructorActor(instructor));
  if (!result.success) return result;
  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

// ---------- Save block (time range only) ----------

const blockSaveInputSchema = z.object({
  ridingSlotId: z.string().min(1),
  blockId: z.string().trim().optional(),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/, INVALID_TIME),
  endTime: z.string().regex(/^\d{1,2}:\d{2}$/, INVALID_TIME),
});

export type RidingSlotComplexBlockSaveInput = z.infer<typeof blockSaveInputSchema>;

// RIDING-PAIRS P5b - a block save now only ever writes startTime/endTime.
// arena/instructor(s)/pairs moved to saveComplexStationInternal below.
// Overlap against every OTHER block in the plan is computed and returned as
// a non-blocking warning (never rejects the save) - see this file's
// OVERLAP_WARNING constant and the approved [start, end) interval-overlap
// rule. All read-only validation runs before the transaction; only the
// actual writes run inside it, kept short and DB-only, same pattern as
// every other save in this file.
async function saveComplexBlockInternal(
  input: RidingSlotComplexBlockSaveInput,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const parsed = blockSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  if (timeToMinutes(data.endTime) <= timeToMinutes(data.startTime)) {
    return { success: false, error: END_BEFORE_START };
  }

  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId: data.ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  if (data.blockId) {
    const existingBlock = await prisma.ridingSlotComplexBlock.findUnique({ where: { id: data.blockId } });
    if (!existingBlock || existingBlock.planId !== plan.id) {
      return { success: false, error: NOT_FOUND_BLOCK };
    }
  }

  // Overlap check against every OTHER block already in this plan - a
  // warning only, never blocks the save (overlapping time blocks may be a
  // deliberate split or an in-progress draft). Excludes the block being
  // edited against itself.
  const otherBlocks = await prisma.ridingSlotComplexBlock.findMany({
    where: { planId: plan.id, ...(data.blockId ? { id: { not: data.blockId } } : {}) },
    select: { startTime: true, endTime: true },
  });
  const newStart = timeToMinutes(data.startTime);
  const newEnd = timeToMinutes(data.endTime);
  const hasOverlap = otherBlocks.some(
    (b) => newStart < timeToMinutes(b.endTime) && newEnd > timeToMinutes(b.startTime)
  );

  const actorData = actorWriteFields(actor);

  // updateMany with a compound (id + planId) where, rather than a plain
  // update-by-id, is the "sufficiently restrictive write condition" for the
  // existing-block path: it can never throw a not-found error, and
  // re-enforces ownership INSIDE the transaction rather than trusting the
  // plain pre-transaction existingBlock read above.
  const txResult = await prisma.$transaction(async (tx) => {
    let blockId = data.blockId;
    let createdBlockId: string | null = null;
    if (blockId) {
      const updated = await tx.ridingSlotComplexBlock.updateMany({
        where: { id: blockId, planId: plan.id },
        data: { startTime: data.startTime, endTime: data.endTime },
      });
      if (updated.count === 0) {
        return { ok: false as const };
      }
    } else {
      const maxSort = await tx.ridingSlotComplexBlock.aggregate({
        where: { planId: plan.id },
        _max: { sortOrder: true },
      });
      const created = await tx.ridingSlotComplexBlock.create({
        data: {
          planId: plan.id,
          startTime: data.startTime,
          endTime: data.endTime,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
      });
      blockId = created.id;
      createdBlockId = created.id;
    }

    // RIDING-COMPLEX-PUBLICATION P7A - version bump is folded into this
    // same actor-metadata update, inside the same transaction as the block
    // write above, so it can never drift out of sync with the mutation it
    // represents (see RidingSlotComplexPlan.version's own schema comment).
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const, createdBlockId };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(data.ridingSlotId, { canEdit: true });
  return {
    success: true,
    plan: editing?.plan,
    overlapWarning: hasOverlap ? OVERLAP_WARNING : undefined,
    newBlockId: txResult.createdBlockId ?? undefined,
  };
}

export async function saveRidingSlotComplexBlockAsAdmin(
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return saveComplexBlockInternal(input, adminActor(admin));
}

export async function saveRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return saveComplexBlockInternal(input, instructorActor(instructor));
}

// ---------- Save station (create or update, full-replace only this station's pairs) ----------

const stationPairInputSchema = z.object({
  trainee1Id: z.string().trim(),
  trainee2Id: z.string().trim().nullish(),
  horseName: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

const stationSaveInputSchema = z.object({
  ridingSlotId: z.string().min(1),
  blockId: z.string().min(1),
  stationId: z.string().trim().optional(),
  instructorId: z.string().trim().nullish(),
  arena: z.string().trim().nullish(),
  pairs: z.array(stationPairInputSchema).optional().default([]),
});

export type RidingSlotComplexPairInput = z.infer<typeof stationPairInputSchema>;
export type RidingSlotComplexStationSaveInput = z.infer<typeof stationSaveInputSchema>;

// Shared core of saveRidingSlotComplexStationAsAdmin/AsInstructor. All
// read-only validation (plan/block/station lookup, active instructor/
// trainee checks, within-submission and cross-station duplicate checks)
// runs BEFORE the transaction - only the actual writes (upsert station,
// full-replace this station's pairs, touch plan actor metadata) run inside
// it, kept short and DB-only, same pattern as every other save in this file.
//
// Cross-station duplicate checks (trainee/instructor/horse) read every
// OTHER station already persisted in this block via a plain pre-transaction
// query, the same established convention this file already uses for
// validateActiveTraineeIds/validateActiveInstructorIds - not moved inside
// the transaction, so it carries the same small, already-accepted residual
// race window those checks have always had (a concurrent save to a
// different station in the same block, landing in the gap between this
// read and the transaction's commit, is not caught here). Ownership itself
// (station belongs to this exact block) IS re-enforced inside the
// transaction via the compound updateMany where-clause below.
async function saveComplexStationInternal(
  input: RidingSlotComplexStationSaveInput,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const parsed = stationSaveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const data = parsed.data;

  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId: data.ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const block = await prisma.ridingSlotComplexBlock.findUnique({ where: { id: data.blockId } });
  if (!block || block.planId !== plan.id) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  if (data.stationId) {
    const existingStation = await prisma.ridingSlotComplexStation.findUnique({ where: { id: data.stationId } });
    if (!existingStation || existingStation.blockId !== block.id) {
      return { success: false, error: NOT_FOUND_STATION };
    }
  }

  const instructorId = data.instructorId || null;
  if (instructorId && !(await validateActiveInstructorIds([instructorId]))) {
    return { success: false, error: INVALID_INSTRUCTOR };
  }

  // Draft-friendly normalization - identical rule set to the original P2
  // block-level save: a completely blank pair placeholder is silently
  // dropped; a pair with meaningful data (trainee2/horse/note) but no
  // trainee1Id is malformed and rejects the whole save.
  const normalizedRaw = data.pairs.map((p) => ({
    trainee1Id: p.trainee1Id || null,
    trainee2Id: p.trainee2Id || null,
    horseName: p.horseName || null,
    note: p.note || null,
  }));

  const hasMalformedPair = normalizedRaw.some(
    (p) => p.trainee1Id === null && (p.trainee2Id !== null || p.horseName !== null || p.note !== null)
  );
  if (hasMalformedPair) {
    return { success: false, error: PAIR_MISSING_TRAINEE1 };
  }

  const normalizedPairs = normalizedRaw.filter(
    (p): p is { trainee1Id: string; trainee2Id: string | null; horseName: string | null; note: string | null } =>
      p.trainee1Id !== null
  );

  for (const pair of normalizedPairs) {
    if (pair.trainee2Id && pair.trainee2Id === pair.trainee1Id) {
      return { success: false, error: SAME_TRAINEE_TWICE_IN_PAIR };
    }
  }

  // Within-submission duplicate checks, scoped to this station's own
  // submitted pairs - the cross-station, block-wide checks happen
  // separately below, against every OTHER already-persisted station.
  const traineeOccurrences = new Map<string, number>();
  for (const pair of normalizedPairs) {
    traineeOccurrences.set(pair.trainee1Id, (traineeOccurrences.get(pair.trainee1Id) ?? 0) + 1);
    if (pair.trainee2Id) {
      traineeOccurrences.set(pair.trainee2Id, (traineeOccurrences.get(pair.trainee2Id) ?? 0) + 1);
    }
  }
  if (Array.from(traineeOccurrences.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_TRAINEE_IN_BLOCK };
  }

  const horseOccurrences = new Map<string, number>();
  for (const pair of normalizedPairs) {
    if (!pair.horseName) continue;
    const key = pair.horseName.toLowerCase();
    horseOccurrences.set(key, (horseOccurrences.get(key) ?? 0) + 1);
  }
  if (Array.from(horseOccurrences.values()).some((count) => count > 1)) {
    return { success: false, error: DUPLICATE_HORSE_IN_BLOCK };
  }

  const allTraineeIds = Array.from(traineeOccurrences.keys());
  if (!(await validateActiveTraineeIds(allTraineeIds))) {
    return { success: false, error: INVALID_TRAINEE };
  }

  // Block-wide cross-station validation: every OTHER station already
  // persisted in this block (excluding the one being saved, if editing an
  // existing one), checked against the submitted replacement data.
  const otherStations = await prisma.ridingSlotComplexStation.findMany({
    where: {
      blockId: block.id,
      ...(data.stationId ? { id: { not: data.stationId } } : {}),
    },
    select: {
      instructorId: true,
      pairs: { select: { trainee1Id: true, trainee2Id: true, horseName: true } },
    },
  });

  if (instructorId && otherStations.some((s) => s.instructorId === instructorId)) {
    return { success: false, error: DUPLICATE_INSTRUCTOR_IN_BLOCK };
  }

  const otherTraineeIds = new Set<string>();
  const otherHorseKeys = new Set<string>();
  for (const station of otherStations) {
    for (const pair of station.pairs) {
      if (pair.trainee1Id) otherTraineeIds.add(pair.trainee1Id);
      if (pair.trainee2Id) otherTraineeIds.add(pair.trainee2Id);
      if (pair.horseName) otherHorseKeys.add(pair.horseName.trim().toLowerCase());
    }
  }
  if (allTraineeIds.some((id) => otherTraineeIds.has(id))) {
    return { success: false, error: DUPLICATE_TRAINEE_IN_BLOCK };
  }
  if (Array.from(horseOccurrences.keys()).some((key) => otherHorseKeys.has(key))) {
    return { success: false, error: DUPLICATE_HORSE_IN_BLOCK };
  }

  const arena = data.arena || null;
  const actorData = actorWriteFields(actor);

  const txResult = await prisma.$transaction(async (tx) => {
    let stationId = data.stationId;
    if (stationId) {
      const updated = await tx.ridingSlotComplexStation.updateMany({
        where: { id: stationId, blockId: block.id },
        data: { instructorId, arena },
      });
      if (updated.count === 0) {
        return { ok: false as const };
      }
    } else {
      const maxSort = await tx.ridingSlotComplexStation.aggregate({
        where: { blockId: block.id },
        _max: { sortOrder: true },
      });
      const created = await tx.ridingSlotComplexStation.create({
        data: {
          blockId: block.id,
          instructorId,
          arena,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
      });
      stationId = created.id;
    }

    // Array order is the canonical pair sortOrder - client-submitted pair
    // ids are deliberately not part of the input shape at all (full-replace
    // semantics make them unnecessary, same convention as
    // RidingSlotHorseListItem's identical delete+recreate save).
    await tx.ridingSlotComplexPair.deleteMany({ where: { stationId } });
    if (normalizedPairs.length > 0) {
      await tx.ridingSlotComplexPair.createMany({
        data: normalizedPairs.map((p, index) => ({
          stationId: stationId!,
          trainee1Id: p.trainee1Id,
          trainee2Id: p.trainee2Id,
          horseName: p.horseName,
          note: p.note,
          sortOrder: index,
        })),
      });
    }

    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_STATION };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const warnings: RidingSlotComplexSaveWarnings = {
    noInstructor: !instructorId,
    noArena: !arena,
    zeroPairs: normalizedPairs.length === 0,
    pairsMissingTrainee2: normalizedPairs.filter((p) => !p.trainee2Id).length,
    pairsMissingHorse: normalizedPairs.filter((p) => !p.horseName).length,
  };

  const editing = await buildComplexPlanForEditing(data.ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan, warnings };
}

export async function saveRidingSlotComplexStationAsAdmin(
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return saveComplexStationInternal(input, adminActor(admin));
}

export async function saveRidingSlotComplexStationAsInstructor(
  instructorId: string,
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return saveComplexStationInternal(input, instructorActor(instructor));
}

// ---------- Delete station ----------

async function deleteComplexStationInternal(
  ridingSlotId: string,
  blockId: string,
  stationId: string,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const block = await prisma.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
  if (!block || block.planId !== plan.id) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  const station = await prisma.ridingSlotComplexStation.findUnique({ where: { id: stationId } });
  if (!station || station.blockId !== block.id) {
    return { success: false, error: NOT_FOUND_STATION };
  }

  const actorData = actorWriteFields(actor);

  // deleteMany with a compound (id + blockId) where - same
  // sufficiently-restrictive-write-condition reasoning used throughout this
  // file: never throws not-found, and re-checks ownership inside the
  // transaction rather than trusting the plain pre-transaction reads above.
  const txResult = await prisma.$transaction(async (tx) => {
    // Cascade (schema onDelete: Cascade) removes this station's pairs -
    // never the parent block.
    const deleted = await tx.ridingSlotComplexStation.deleteMany({ where: { id: stationId, blockId: block.id } });
    if (deleted.count === 0) {
      return { ok: false as const };
    }
    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_STATION };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function deleteRidingSlotComplexStationAsAdmin(
  ridingSlotId: string,
  blockId: string,
  stationId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return deleteComplexStationInternal(ridingSlotId, blockId, stationId, adminActor(admin));
}

export async function deleteRidingSlotComplexStationAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  stationId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return deleteComplexStationInternal(ridingSlotId, blockId, stationId, instructorActor(instructor));
}

// ---------- Reorder stations (within one block) ----------

async function reorderComplexStationsInternal(
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[],
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const block = await prisma.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
  if (!block || block.planId !== plan.id) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  const existingStations = await prisma.ridingSlotComplexStation.findMany({
    where: { blockId: block.id },
    select: { id: true },
  });
  const existingIds = new Set(existingStations.map((s) => s.id));
  const submittedIds = new Set(orderedStationIds);

  if (
    orderedStationIds.length !== existingStations.length ||
    submittedIds.size !== orderedStationIds.length ||
    orderedStationIds.some((id) => !existingIds.has(id))
  ) {
    return { success: false, error: INVALID_STATION_ORDER };
  }

  const actorData = actorWriteFields(actor);

  const txResult = await prisma.$transaction(async (tx) => {
    for (const [index, id] of orderedStationIds.entries()) {
      const updated = await tx.ridingSlotComplexStation.updateMany({
        where: { id, blockId: block.id },
        data: { sortOrder: index },
      });
      if (updated.count === 0) {
        return { ok: false as const };
      }
    }
    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const };
  });

  if (!txResult.ok) {
    return { success: false, error: INVALID_STATION_ORDER };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function reorderRidingSlotComplexStationsAsAdmin(
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return reorderComplexStationsInternal(ridingSlotId, blockId, orderedStationIds, adminActor(admin));
}

export async function reorderRidingSlotComplexStationsAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return reorderComplexStationsInternal(ridingSlotId, blockId, orderedStationIds, instructorActor(instructor));
}

// ---------- Delete block ----------
// UNCHANGED from P2 - a block delete never referenced arena/instructors/
// pairs directly, so nothing here needed to change; the schema's own
// cascade (block -> stations -> pairs) now runs one level deeper than
// before, entirely transparently to this code.

async function deleteComplexBlockInternal(
  ridingSlotId: string,
  blockId: string,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const block = await prisma.ridingSlotComplexBlock.findUnique({ where: { id: blockId } });
  if (!block || block.planId !== plan.id) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  const actorData = actorWriteFields(actor);

  // deleteMany with a compound (id + planId) where - same
  // sufficiently-restrictive-write-condition reasoning as
  // saveComplexBlockInternal's updateMany above: never throws not-found,
  // and re-checks ownership inside the transaction rather than trusting the
  // plain pre-transaction block read above.
  const txResult = await prisma.$transaction(async (tx) => {
    // Cascades (schema onDelete: Cascade) remove this block's stations,
    // which cascade further to their pairs - never the parent plan.
    const deleted = await tx.ridingSlotComplexBlock.deleteMany({ where: { id: blockId, planId: plan.id } });
    if (deleted.count === 0) {
      return { ok: false as const };
    }
    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function deleteRidingSlotComplexBlockAsAdmin(
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return deleteComplexBlockInternal(ridingSlotId, blockId, adminActor(admin));
}

export async function deleteRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return deleteComplexBlockInternal(ridingSlotId, blockId, instructorActor(instructor));
}

// ---------- Duplicate block ----------

// RIDING-PAIRS P5b - now copies startTime/endTime plus every station's
// instructorId+arena (and station ordering) - never any pair, per the
// approved product decision. Cannot violate simple/complex mutual
// exclusivity: it only ever creates a new RidingSlotComplexBlock (and its
// station copies) inside an ALREADY-EXISTING plan, never a new
// RidingSlotComplexPlan row.
async function duplicateComplexBlockInternal(
  ridingSlotId: string,
  blockId: string,
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  // Fast pre-transaction existence check only, to avoid opening a
  // transaction for an obviously-invalid blockId - NOT the source of truth
  // for what gets copied (see below).
  const precheck = await prisma.ridingSlotComplexBlock.findUnique({
    where: { id: blockId },
    select: { planId: true },
  });
  if (!precheck || precheck.planId !== plan.id) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  const actorData = actorWriteFields(actor);

  // The source block (and its stations) is re-read INSIDE the transaction
  // (fresh, not from the precheck above) so the copy always reflects the
  // latest committed state, never a value that could have gone stale in the
  // gap between the precheck and this transaction opening.
  const txResult = await prisma.$transaction(async (tx) => {
    const sourceBlock = await tx.ridingSlotComplexBlock.findUnique({
      where: { id: blockId },
      include: { stations: { orderBy: { sortOrder: "asc" } } },
    });
    if (!sourceBlock || sourceBlock.planId !== plan.id) {
      return { ok: false as const };
    }

    const maxSort = await tx.ridingSlotComplexBlock.aggregate({
      where: { planId: plan.id },
      _max: { sortOrder: true },
    });
    const created = await tx.ridingSlotComplexBlock.create({
      data: {
        planId: plan.id,
        startTime: sourceBlock.startTime,
        endTime: sourceBlock.endTime,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    if (sourceBlock.stations.length > 0) {
      // A copied instructorId may have gone inactive (or, defensively, no
      // longer exist) since the source station was saved. Rather than
      // failing the whole duplication over one now-inactive coach, that one
      // station's copy is created with instructorId null - every other
      // station in the source block still copies normally. This is the
      // approved rule: "create the duplicated station with instructorId
      // null rather than fail the entire duplication."
      const sourceInstructorIds = sourceBlock.stations
        .map((s) => s.instructorId)
        .filter((id): id is string => id !== null);
      const activeInstructorIds =
        sourceInstructorIds.length > 0
          ? new Set(
              (
                await tx.instructor.findMany({
                  where: { id: { in: sourceInstructorIds }, isActive: true },
                  select: { id: true },
                })
              ).map((i) => i.id)
            )
          : new Set<string>();

      await tx.ridingSlotComplexStation.createMany({
        data: sourceBlock.stations.map((s, index) => ({
          blockId: created.id,
          instructorId: s.instructorId && activeInstructorIds.has(s.instructorId) ? s.instructorId : null,
          arena: s.arena,
          sortOrder: index,
        })),
      });
    }

    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const, newBlockId: created.id };
  });

  if (!txResult.ok) {
    return { success: false, error: NOT_FOUND_BLOCK };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan, newBlockId: txResult.newBlockId };
}

export async function duplicateRidingSlotComplexBlockAsAdmin(
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return duplicateComplexBlockInternal(ridingSlotId, blockId, adminActor(admin));
}

export async function duplicateRidingSlotComplexBlockAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return duplicateComplexBlockInternal(ridingSlotId, blockId, instructorActor(instructor));
}

// ---------- Reorder blocks ----------
// UNCHANGED from P2 - never referenced arena/instructors/pairs.

async function reorderComplexBlocksInternal(
  ridingSlotId: string,
  orderedBlockIds: string[],
  actor: ComplexPlanActor
): Promise<RidingSlotComplexPlanActionResult> {
  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  const existingBlocks = await prisma.ridingSlotComplexBlock.findMany({
    where: { planId: plan.id },
    select: { id: true },
  });
  const existingIds = new Set(existingBlocks.map((b) => b.id));
  const submittedIds = new Set(orderedBlockIds);

  if (
    orderedBlockIds.length !== existingBlocks.length ||
    submittedIds.size !== orderedBlockIds.length ||
    orderedBlockIds.some((id) => !existingIds.has(id))
  ) {
    return { success: false, error: INVALID_BLOCK_ORDER };
  }

  const actorData = actorWriteFields(actor);

  // updateMany with a compound (id + planId) where per block, same
  // sufficiently-restrictive-write-condition reasoning as
  // saveComplexBlockInternal/deleteComplexBlockInternal above - if a block
  // was deleted (or, impossibly, reassigned) in the gap between the
  // pre-transaction bijection check and this transaction, count === 0
  // surfaces that instead of a raw not-found error.
  const txResult = await prisma.$transaction(async (tx) => {
    for (const [index, id] of orderedBlockIds.entries()) {
      const updated = await tx.ridingSlotComplexBlock.updateMany({
        where: { id, planId: plan.id },
        data: { sortOrder: index },
      });
      if (updated.count === 0) {
        return { ok: false as const };
      }
    }
    // RIDING-COMPLEX-PUBLICATION P7A - see saveComplexBlockInternal's
    // identical comment.
    await tx.ridingSlotComplexPlan.update({
      where: { id: plan.id },
      data: { ...actorData, version: { increment: 1 } },
    });
    return { ok: true as const };
  });

  if (!txResult.ok) {
    return { success: false, error: INVALID_BLOCK_ORDER };
  }

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");

  const editing = await buildComplexPlanForEditing(ridingSlotId, { canEdit: true });
  return { success: true, plan: editing?.plan };
}

export async function reorderRidingSlotComplexBlocksAsAdmin(
  ridingSlotId: string,
  orderedBlockIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  const admin = await requireAdmin();
  return reorderComplexBlocksInternal(ridingSlotId, orderedBlockIds, adminActor(admin));
}

export async function reorderRidingSlotComplexBlocksAsInstructor(
  instructorId: string,
  ridingSlotId: string,
  orderedBlockIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  const instructor = await prisma.instructor.findUnique({ where: { id: instructorId } });
  if (!instructor || !instructor.isActive || !instructor.canEditRidingNotes) {
    return { success: false, error: NO_PERMISSION };
  }
  return reorderComplexBlocksInternal(ridingSlotId, orderedBlockIds, instructorActor(instructor));
}

// ---------- Delete plan (admin only) ----------
// UNCHANGED from P2.

export async function deleteRidingSlotComplexPlanAsAdmin(ridingSlotId: string): Promise<ActionResult> {
  await requireAdmin();

  const plan = await prisma.ridingSlotComplexPlan.findUnique({ where: { ridingSlotId } });
  if (!plan) {
    return { success: false, error: NOT_FOUND_COMPLEX_PLAN };
  }

  await prisma.ridingSlotComplexPlan.delete({ where: { id: plan.id } });

  revalidatePath("/admin/weekly-schedule");
  revalidatePath("/instructor");
  return { success: true };
}
