"use server";

import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getCurrentInstructor } from "@/lib/auth/actor";
import { parseDateKey, todayDateKey } from "@/lib/dates";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import type { ActionResult } from "@/lib/actions/students";
import type { AttendanceStatusValue } from "@/lib/actions/attendance";
import {
  loadInstructorHorseFeedingOverviewWithDeps,
  upsertInstructorHorseFeedingMealsWithDeps,
} from "@/lib/actions/horse-feeding-auth";
import {
  buildFeedingBoard,
  type FeedingBoardProgressView,
  type FeedingBoardRow,
  type FeedingBoardStatusOption,
  type FeedingProgressState,
  type FeedingStatusControlMode,
} from "@/lib/feeding/feeding-board-core";
import {
  clearAllHorseFeedingProgressAsAdminWithDeps,
  clearAllHorseFeedingProgressAsInstructorWithDeps,
  markHorseFeedingProgressAsAdminWithDeps,
  markHorseFeedingProgressAsInstructorWithDeps,
  setHorseFeedingVisibilityAsAdminWithDeps,
  type FeedingAdminActor,
  type FeedingProgressMarkRequest,
  type HorseFeedingVisibilityRequest,
} from "@/lib/actions/horse-feeding-progress-auth";
import {
  clearAllFeedingProgressWithDeps,
  markFeedingProgressWithDeps,
  setHorseFeedingVisibilityWithDeps,
  type ClearFeedingProgressDeps,
  type FeedingProgressRow,
  type FeedingVisibilityRow,
  type MarkFeedingProgressDeps,
  type SetHorseFeedingVisibilityDeps,
} from "@/lib/actions/horse-feeding-progress-io";

// Still no separate Horse table (see HorseFeedingMeal's own schema comment) -
// horseName is the natural key everywhere here too, matched against whatever
// name string a student currently has via getHorseDisplayInfo.

export interface HorseFeedingMealView {
  hayType: string | null;
  concentrateType: string | null;
  concentrateAmount: string | null;
  notes: string | null;
}

export interface HorseFeedingOverviewRow {
  horseName: string;
  morning: HorseFeedingMealView | null;
  evening: HorseFeedingMealView | null;
  // Null means "no lunch for this horse" - distinct from a lunch row that
  // exists but happens to have every field empty.
  lunch: HorseFeedingMealView | null;
  updatedByName: string | null;
  updatedAt: string | null;
  // The one active student currently matched to this horse name, if any -
  // read-only, resolved the same way getHorseDisplayInfo already does
  // everywhere else. If a horse name is ever shared by more than one active
  // student, only the first match is shown here (not expected in current
  // data - every assignedHorseName is unique today).
  responsibleStudent: {
    id: string;
    fullName: string;
    groupName: string | null;
    subgroupNumber: number | null;
  } | null;
  // Today's attendance for that student, if matched - never written from
  // this screen, and never used to infer anything about feeding itself.
  attendanceStatus: AttendanceStatusValue | null;
  attendanceArrivalTime: string | null;
  attendanceDepartureTime: string | null;
  attendanceNotes: string | null;

  // FEEDING-BOARD Stage 4 - ADDITIVE fields composed by the pure Stage 2 core
  // (lib/feeding/feeding-board-core). Every field above is unchanged, so the
  // current HorseFeedingSection keeps working untouched; these are extra data
  // the future board UI consumes. Both readers below return ACTIVE rows only,
  // so isHidden is false on every row they yield - it is carried anyway so the
  // admin-only hidden-row reader shares one single row type.
  isHidden: boolean;
  hasHayContent: boolean;
  hasConcentrateContent: boolean;
  statusControlMode: FeedingStatusControlMode;
  // Audit stamps of the current round for this horse, or null when unmarked.
  progress: FeedingBoardProgressView | null;
  // The STORED state ("PENDING" when there is no row at all).
  progressState: FeedingProgressState;
  // What a control should show as selected - differs from progressState only
  // for a stale HAY_DONE on a horse with no concentrate content, which displays
  // as PENDING rather than being over-claimed as COMPLETE.
  displayProgressState: FeedingProgressState;
  isDisplayStateNormalized: boolean;
  statusOptions: readonly FeedingBoardStatusOption[];
}

// Shared by the admin and instructor read actions - view is unrestricted for
// both (matches the same "any instructor can view" convention already used
// by horse assignments, riding slots, etc.); only writing is gated.
//
// FEEDING-BOARD Stage 4: the union, the visibility split, the progress default,
// the content/control-mode derivation and the Hebrew ordering all live in the
// PURE core (lib/feeding/feeding-board-core) and are deliberately NOT
// reimplemented here - this function only issues the bounded queries, hands the
// four sources over, and re-attaches the attendance-derived operational fields
// the core has no business knowing about.
async function buildHorseFeedingBoardView(): Promise<{
  active: HorseFeedingOverviewRow[];
  hidden: HorseFeedingOverviewRow[];
}> {
  const [students, meals, visibility, progress] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: {
        id: true,
        fullName: true,
        groupName: true,
        subgroupNumber: true,
        hasPrivateHorse: true,
        privateHorseName: true,
        assignedHorseName: true,
      },
    }),
    prisma.horseFeedingMeal.findMany(),
    prisma.horseFeedingVisibility.findMany(),
    prisma.horseFeedingProgress.findMany(),
  ]);

  // Horse-name resolution stays exactly as before (getHorseDisplayInfo); the
  // core owns de-duplication from here, and resolves a name claimed by more than
  // one active student deterministically rather than by query order (not
  // expected in current data - every assignedHorseName is unique today).
  const studentHorses = students.flatMap((s) => {
    const horseName = getHorseDisplayInfo(s).horseName;
    if (!horseName) return [];
    return [
      {
        horseName,
        responsibleStudent: {
          id: s.id,
          fullName: s.fullName,
          groupName: s.groupName,
          subgroupNumber: s.subgroupNumber,
        },
      },
    ];
  });

  const board = buildFeedingBoard({
    studentHorses,
    meals: meals.map((m) => ({
      horseName: m.horseName,
      mealType: m.mealType,
      hayType: m.hayType,
      concentrateType: m.concentrateType,
      concentrateAmount: m.concentrateAmount,
      notes: m.notes,
      updatedByName: m.updatedByName,
      updatedAt: m.updatedAt.toISOString(),
    })),
    visibility: visibility.map((v) => ({ horseName: v.horseName, isHidden: v.isHidden })),
    progress: progress.map((p) => ({
      horseName: p.horseName,
      state: p.state,
      hayMarkedAt: p.hayMarkedAt ? p.hayMarkedAt.toISOString() : null,
      hayMarkedByName: p.hayMarkedByName,
      concentrateMarkedAt: p.concentrateMarkedAt ? p.concentrateMarkedAt.toISOString() : null,
      concentrateMarkedByName: p.concentrateMarkedByName,
    })),
  });

  const linkedStudentIds = Array.from(
    new Set(
      [...board.activeRows, ...board.hiddenRows]
        .map((row) => row.responsibleStudent?.id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const attendanceRecords =
    linkedStudentIds.length > 0
      ? await prisma.studentAttendance.findMany({
          where: { date: parseDateKey(todayDateKey()), studentId: { in: linkedStudentIds } },
        })
      : [];
  const attendanceByStudentId = new Map(attendanceRecords.map((a) => [a.studentId, a]));

  // The core's rows are frozen; spreading produces the mutable DTO the existing
  // clients already consume, with the attendance fields re-attached unchanged.
  const toOverviewRow = (row: FeedingBoardRow): HorseFeedingOverviewRow => {
    const attendance = row.responsibleStudent
      ? attendanceByStudentId.get(row.responsibleStudent.id)
      : undefined;
    return {
      ...row,
      responsibleStudent: row.responsibleStudent
        ? { ...row.responsibleStudent }
        : null,
      attendanceStatus: attendance?.status ?? null,
      attendanceArrivalTime: attendance?.arrivalTime ?? null,
      attendanceDepartureTime: attendance?.departureTime ?? null,
      attendanceNotes: attendance?.notes ?? null,
    };
  };

  return {
    active: board.activeRows.map(toOverviewRow),
    hidden: board.hiddenRows.map(toOverviewRow),
  };
}

// Active rows only - the shape both existing readers have always returned. With
// the visibility table empty (its state at migration time) this is the exact
// same set of horses as before, so nothing changes for either screen until a
// manager actually hides a horse.
async function buildHorseFeedingOverview(): Promise<HorseFeedingOverviewRow[]> {
  return (await buildHorseFeedingBoardView()).active;
}

export async function getHorseFeedingOverviewForAdmin(): Promise<HorseFeedingOverviewRow[]> {
  await requireAdmin();
  return buildHorseFeedingOverview();
}

// MANAGER-ONLY. Hidden horses are not part of the operational board and are
// never exposed to the instructor reader - this separate admin-gated action is
// the only way to see them, so a manager can find and restore one. Same row
// shape as the active reader (isHidden is true on every row here).
export async function getHiddenHorseFeedingRowsForAdmin(): Promise<HorseFeedingOverviewRow[]> {
  await requireAdmin();
  return (await buildHorseFeedingBoardView()).hidden;
}

// HF-SEC-1RW: the instructor overview read is now gated on a trustworthy
// server-derived instructor actor via the canonical Actor DAL
// (getCurrentInstructor) - it accepts NO client actor identity and no longer
// relies on the parent page having authenticated the caller. A missing/invalid/
// inactive/wrong-audience/subject-mismatched session yields a null actor and this
// fails closed to [] (the same fail-closed convention as
// getAttendanceTrackingForInstructor), so an unauthenticated caller or a
// trainee/wrong-role actor receives nothing and buildHorseFeedingOverview is
// never invoked. Viewing is intentionally NOT gated on canEditHorseFeeding (that
// flag gates editing only - see the *AsInstructor write action) so every active
// instructor keeps the committed "any instructor may view" behaviour, and the
// returned DTO - including its attendance-derived operational fields - is
// unchanged for a valid active instructor. NO ATTENDANCE capability / offering
// gating is applied to the internal attendance-derived business-rule read. The
// pure gate + delegation lives in ./horse-feeding-auth so it is unit-testable
// without a session or a database. getHorseFeedingOverviewForAdmin below keeps
// its own separate requireAdmin boundary and is not routed through here.
export async function getHorseFeedingOverviewForInstructor(): Promise<HorseFeedingOverviewRow[]> {
  return loadInstructorHorseFeedingOverviewWithDeps({
    getCurrentInstructor,
    buildOverview: buildHorseFeedingOverview,
  });
}

// Suggestions for the hay-type/concentrate-type inputs - never a closed
// list, just whatever has actually been typed and saved before. The
// admin/instructor form always still accepts free text beyond these.
export async function getKnownHayTypes(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { hayType: { not: null } },
    select: { hayType: true },
    distinct: ["hayType"],
  });
  return rows
    .map((r) => r.hayType!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

export async function getKnownConcentrateTypes(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { concentrateType: { not: null } },
    select: { concentrateType: true },
    distinct: ["concentrateType"],
  });
  return rows
    .map((r) => r.concentrateType!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

// Same idea as getKnownHayTypes/getKnownConcentrateTypes - concentrateAmount
// stays free text (never numeric), so this is just distinct previously-saved
// values for suggestions, never a closed list.
export async function getKnownConcentrateAmounts(): Promise<string[]> {
  const rows = await prisma.horseFeedingMeal.findMany({
    where: { concentrateAmount: { not: null } },
    select: { concentrateAmount: true },
    distinct: ["concentrateAmount"],
  });
  return rows
    .map((r) => r.concentrateAmount!)
    .filter((v) => v.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "he"));
}

// Union of "horses currently claimed by an active student" and "horses with
// feeding data already entered" - the same set buildHorseFeedingOverview
// resolves internally, exported on its own so other riding features (e.g.
// riding lesson note horse autocomplete) can reuse this exact set of known
// horse names without a separate Horse table.
export async function getKnownHorseNames(): Promise<string[]> {
  const [students, meals] = await Promise.all([
    prisma.student.findMany({
      where: { isActive: true },
      select: { hasPrivateHorse: true, privateHorseName: true, assignedHorseName: true },
    }),
    prisma.horseFeedingMeal.findMany({ select: { horseName: true } }),
  ]);

  const names = new Set<string>();
  for (const s of students) {
    const name = getHorseDisplayInfo(s).horseName;
    if (name) names.add(name);
  }
  for (const m of meals) {
    const name = m.horseName.trim();
    if (name) names.add(name);
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b, "he"));
}

const mealFieldsSchema = z.object({
  hayType: z.string().trim().optional(),
  concentrateType: z.string().trim().optional(),
  concentrateAmount: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const feedingUpsertSchema = z.object({
  horseName: z.string().trim().min(1, "יש להזין שם סוס"),
  morning: mealFieldsSchema,
  evening: mealFieldsSchema,
  hasLunch: z.boolean(),
  lunch: mealFieldsSchema,
});

export type HorseFeedingUpsertInput = z.infer<typeof feedingUpsertSchema>;

function upsertMealQuery(
  horseName: string,
  mealType: "MORNING" | "LUNCH" | "EVENING",
  fields: z.infer<typeof mealFieldsSchema>,
  updatedByName: string | null
) {
  const data = {
    hayType: fields.hayType?.trim() || null,
    concentrateType: fields.concentrateType?.trim() || null,
    concentrateAmount: fields.concentrateAmount?.trim() || null,
    notes: fields.notes?.trim() || null,
    updatedByName,
  };
  return prisma.horseFeedingMeal.upsert({
    where: { horseName_mealType: { horseName, mealType } },
    create: { horseName, mealType, ...data },
    update: data,
  });
}

// Shared core - MORNING/EVENING always exist per spec ("at minimum
// morning/evening"); LUNCH is created/updated only when hasLunch is true,
// and deleted otherwise, so "no lunch" is represented by the row's absence,
// not by a row with every field blank.
async function upsertHorseFeedingMeals(
  input: HorseFeedingUpsertInput,
  updatedByName: string | null
): Promise<ActionResult> {
  const parsed = feedingUpsertSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }
  const horseName = parsed.data.horseName;

  const ops: Prisma.PrismaPromise<unknown>[] = [
    upsertMealQuery(horseName, "MORNING", parsed.data.morning, updatedByName),
    upsertMealQuery(horseName, "EVENING", parsed.data.evening, updatedByName),
  ];
  if (parsed.data.hasLunch) {
    ops.push(upsertMealQuery(horseName, "LUNCH", parsed.data.lunch, updatedByName));
  } else {
    ops.push(prisma.horseFeedingMeal.deleteMany({ where: { horseName, mealType: "LUNCH" } }));
  }
  await prisma.$transaction(ops);

  revalidatePath("/admin/horses");
  return { success: true };
}

export async function upsertHorseFeedingMealsAsAdmin(
  input: HorseFeedingUpsertInput
): Promise<ActionResult> {
  const admin = await requireAdmin();
  return upsertHorseFeedingMeals(input, admin.name ?? admin.email);
}

// HF-SEC-1RW: the acting instructor is now derived EXCLUSIVELY from the signed
// session via the canonical Actor DAL (getCurrentInstructor) - the public
// signature no longer accepts an instructorId, so a caller can never select the
// permission-bearing row, borrow another instructor's canEditHorseFeeding, or
// choose the persisted updatedByName. getCurrentInstructor returns null for every
// unauthenticated/invalid/inactive/wrong-audience/subject-mismatched case (so the
// active-status check is already enforced by the DAL) and null OR an actor whose
// canEditHorseFeeding is false is rejected with the unchanged Hebrew permission
// error BEFORE the mutation transaction runs (no DB write on denial). Authorship
// (updatedByName) is taken from the server-derived actor's fullName only. The
// pure gate + delegation lives in ./horse-feeding-auth so it is unit-testable
// without a session or a database. UI hiding of edit controls is not relied upon.
export async function upsertHorseFeedingMealsAsInstructor(
  input: HorseFeedingUpsertInput
): Promise<ActionResult> {
  return upsertInstructorHorseFeedingMealsWithDeps(
    {
      getCurrentInstructor,
      upsertMeals: upsertHorseFeedingMeals,
    },
    input
  );
}

// ===========================================================================
// FEEDING-BOARD Stage 4 - round progress + manager visibility.
//
// SERVER ACTION BOUNDARY: everything exported from this "use server" file is a
// public endpoint, so the raw Prisma mutators below are NOT exported - they are
// module-private constants, and the reusable persistence semantics they satisfy
// live in the non-"use server" ./horse-feeding-progress-io. The only exported
// runtime functions in this section are the six authorized async actions.
//
// ADMIN GATE: every admin action calls `await requireAdmin()` as its FIRST
// statement, so no Prisma call can precede it and the normal login redirect is
// preserved. requireAdmin is deliberately NOT passed into the Stage 3
// orchestration as its resolver: it signals failure by throwing a Next.js
// redirect, and the orchestration maps a thrown resolver to a denial message,
// which would swallow that redirect. Instead the already-authorized admin is
// wrapped in a resolver that only returns it and cannot throw or redirect.
//
// INSTRUCTOR GATE: the canonical actor DAL (getCurrentInstructor) is passed
// straight through - it returns null for every unauthenticated / invalid /
// inactive / wrong-audience session and never redirects. The Stage 3
// orchestration enforces canEditHorseFeeding and derives authorship from the
// actor's own fullName. No action accepts an instructor id, name, email or
// permission value.
//
// No revalidatePath here on purpose: both feeding screens fetch this data
// client-side through these actions, so a per-mark path revalidation would
// remount the whole board on every tap without refreshing anything the client
// does not already receive in the action's own result.
// ===========================================================================

/** Serializable progress view returned to the client after a mark. */
export interface HorseFeedingProgressStateView {
  horseName: string;
  state: FeedingProgressState;
  hayMarkedAt: string | null;
  hayMarkedByName: string | null;
  concentrateMarkedAt: string | null;
  concentrateMarkedByName: string | null;
}

/** Mark result: the standard ActionResult plus the authoritative saved row. */
export interface HorseFeedingProgressActionResult extends ActionResult {
  /** The stored row after the write, or null when the horse is now PENDING. */
  progress?: HorseFeedingProgressStateView | null;
}

export interface HorseFeedingClearActionResult extends ActionResult {
  clearedCount?: number;
}

export interface HorseFeedingVisibilityStateView {
  horseName: string;
  isHidden: boolean;
  updatedByName: string | null;
  updatedAt: string;
}

export interface HorseFeedingVisibilityActionResult extends ActionResult {
  visibility?: HorseFeedingVisibilityStateView | null;
}

function toProgressStateView(row: FeedingProgressRow | null): HorseFeedingProgressStateView | null {
  if (!row) return null;
  return {
    horseName: row.horseName,
    state: row.state,
    hayMarkedAt: row.hayMarkedAt ? row.hayMarkedAt.toISOString() : null,
    hayMarkedByName: row.hayMarkedByName,
    concentrateMarkedAt: row.concentrateMarkedAt ? row.concentrateMarkedAt.toISOString() : null,
    concentrateMarkedByName: row.concentrateMarkedByName,
  };
}

function toVisibilityStateView(row: FeedingVisibilityRow | null): HorseFeedingVisibilityStateView | null {
  if (!row) return null;
  return {
    horseName: row.horseName,
    isHidden: row.isHidden,
    updatedByName: row.updatedByName,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// --- module-private Prisma ports (never exported: not Server Actions) -------

const markProgressIo: MarkFeedingProgressDeps = {
  now: () => new Date(),
  findMealContent: (horseName) =>
    prisma.horseFeedingMeal.findMany({
      where: { horseName },
      select: { hayType: true, concentrateType: true, concentrateAmount: true, notes: true },
    }),
  findProgress: (horseName) => prisma.horseFeedingProgress.findUnique({ where: { horseName } }),
  upsertProgress: (horseName, data) =>
    prisma.horseFeedingProgress.upsert({
      where: { horseName },
      create: { horseName, ...data },
      update: data,
    }),
  // deleteMany, not delete: clearing a horse that was never marked is a no-op
  // success rather than a P2025 error, keeping PENDING writes idempotent.
  deleteProgress: async (horseName) =>
    (await prisma.horseFeedingProgress.deleteMany({ where: { horseName } })).count,
};

const clearProgressIo: ClearFeedingProgressDeps = {
  deleteAllProgressInTransaction: async () => {
    const [deleted] = await prisma.$transaction([prisma.horseFeedingProgress.deleteMany({})]);
    return deleted.count;
  },
};

const visibilityIo: SetHorseFeedingVisibilityDeps = {
  applyVisibilityInTransaction: async ({ horseName, isHidden, updatedByName, clearProgress }) => {
    const upsertVisibility = prisma.horseFeedingVisibility.upsert({
      where: { horseName },
      create: { horseName, isHidden, updatedByName },
      update: { isHidden, updatedByName },
    });

    // HIDE: the visibility row and the removal of that horse's round progress
    // commit together, so a restored horse can never reappear still wearing a
    // mark from the round during which it was hidden. HorseFeedingMeal is not
    // referenced in either branch - hiding never deletes feeding instructions.
    if (clearProgress) {
      const [visibility] = await prisma.$transaction([
        upsertVisibility,
        prisma.horseFeedingProgress.deleteMany({ where: { horseName } }),
      ]);
      return visibility;
    }

    // RESTORE: only the visibility row changes. No progress row is created -
    // absence already means PENDING.
    const [visibility] = await prisma.$transaction([upsertVisibility]);
    return visibility;
  },
};

// --- mark progress ----------------------------------------------------------

export async function markHorseFeedingProgressAsAdmin(
  request: FeedingProgressMarkRequest
): Promise<HorseFeedingProgressActionResult> {
  const admin = await requireAdmin();
  const actor: FeedingAdminActor = { name: admin.name, email: admin.email };
  const saved: { row: FeedingProgressRow | null } = { row: null };

  const result = await markHorseFeedingProgressAsAdminWithDeps(
    {
      resolveCurrentAdmin: async () => actor,
      markProgress: async (command) => {
        const outcome = await markFeedingProgressWithDeps(markProgressIo, command);
        saved.row = outcome.progress;
        return outcome.result;
      },
    },
    request
  );

  return result.success ? { ...result, progress: toProgressStateView(saved.row) } : result;
}

export async function markHorseFeedingProgressAsInstructor(
  request: FeedingProgressMarkRequest
): Promise<HorseFeedingProgressActionResult> {
  const saved: { row: FeedingProgressRow | null } = { row: null };

  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    {
      getCurrentInstructor,
      markProgress: async (command) => {
        const outcome = await markFeedingProgressWithDeps(markProgressIo, command);
        saved.row = outcome.progress;
        return outcome.result;
      },
    },
    request
  );

  return result.success ? { ...result, progress: toProgressStateView(saved.row) } : result;
}

// --- clear the whole board --------------------------------------------------

export async function clearAllHorseFeedingProgressAsAdmin(): Promise<HorseFeedingClearActionResult> {
  const admin = await requireAdmin();
  const actor: FeedingAdminActor = { name: admin.name, email: admin.email };
  const cleared: { count: number } = { count: 0 };

  const result = await clearAllHorseFeedingProgressAsAdminWithDeps({
    resolveCurrentAdmin: async () => actor,
    clearAllProgress: async () => {
      const outcome = await clearAllFeedingProgressWithDeps(clearProgressIo);
      cleared.count = outcome.deletedCount;
      return outcome.result;
    },
  });

  return result.success ? { ...result, clearedCount: cleared.count } : result;
}

export async function clearAllHorseFeedingProgressAsInstructor(): Promise<HorseFeedingClearActionResult> {
  const cleared: { count: number } = { count: 0 };

  const result = await clearAllHorseFeedingProgressAsInstructorWithDeps({
    getCurrentInstructor,
    clearAllProgress: async () => {
      const outcome = await clearAllFeedingProgressWithDeps(clearProgressIo);
      cleared.count = outcome.deletedCount;
      return outcome.result;
    },
  });

  return result.success ? { ...result, clearedCount: cleared.count } : result;
}

// --- hide / restore (ADMIN ONLY - there is no instructor counterpart) -------

export async function setHorseFeedingVisibilityAsAdmin(
  request: HorseFeedingVisibilityRequest
): Promise<HorseFeedingVisibilityActionResult> {
  const admin = await requireAdmin();
  const actor: FeedingAdminActor = { name: admin.name, email: admin.email };
  const saved: { row: FeedingVisibilityRow | null } = { row: null };

  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    {
      resolveCurrentAdmin: async () => actor,
      setVisibility: async (command) => {
        const outcome = await setHorseFeedingVisibilityWithDeps(visibilityIo, command);
        saved.row = outcome.visibility;
        return outcome.result;
      },
    },
    request
  );

  return result.success ? { ...result, visibility: toVisibilityStateView(saved.row) } : result;
}
