/**
 * FEEDING-BOARD Stage 4 - persistence semantics for the feeding round board and
 * for manager horse visibility.
 *
 * Deliberately NOT a "use server" module, for the same reason as
 * ./horse-feeding-auth and ./horse-feeding-progress-auth: everything exported
 * from a "use server" file becomes a publicly callable Server Action, and these
 * are RAW MUTATORS with no authorization of their own. Keeping them here means
 * the only way to reach them is through the authorized Server Actions in
 * ./horse-feeding, which run the Stage 3 gates first. Nothing in this file is
 * reachable from a browser.
 *
 * It imports NO Prisma client and opens no connection: every database effect
 * arrives as a narrow injected function (the *Deps interfaces below), so all of
 * the persistence semantics are unit-testable with plain fakes and no database.
 * ./horse-feeding supplies the real, thin Prisma implementations.
 *
 * DIVISION OF LABOUR:
 *   ./horse-feeding-progress-auth  - WHO may ask (identity + permission)
 *   this module                    - WHAT is written (validation + write plan)
 *   ./horse-feeding                - the Prisma calls and the Server Action surface
 *
 * Authorization runs FIRST and lives entirely in the Stage 3 orchestration; the
 * validation here therefore happens only after a caller has been authorized,
 * matching the existing upsertHorseFeedingMeals convention (payload validation
 * inside the mutator, never before the gate).
 */
import {
  hasConcentrateContent,
  type FeedingBoardMealView,
  type FeedingProgressState,
} from "@/lib/feeding/feeding-board-core";
import type { ActionResult } from "./students";

// --- stable, PII-free validation errors -------------------------------------
//
// Neither message ever echoes the value the caller supplied: a rejected horse
// name or state is described by KIND only, so no caller-controlled string is
// reflected back and no database detail is exposed.

export const INVALID_HORSE_NAME_ERROR = "שם סוס לא תקין";
export const INVALID_TARGET_STATE_ERROR = "סטטוס האכלה לא תקין";

// --- row shapes -------------------------------------------------------------

/** The meal fields needed to decide whether a horse has concentrate content. */
export type FeedingMealContentRow = FeedingBoardMealView;

/** A persisted progress row, as returned to the caller. */
export interface FeedingProgressRow {
  readonly horseName: string;
  readonly state: FeedingProgressState;
  readonly hayMarkedAt: Date | null;
  readonly hayMarkedByName: string | null;
  readonly concentrateMarkedAt: Date | null;
  readonly concentrateMarkedByName: string | null;
}

/** A persisted visibility row, as returned to the caller. */
export interface FeedingVisibilityRow {
  readonly horseName: string;
  readonly isHidden: boolean;
  readonly updatedByName: string | null;
  readonly updatedAt: Date;
}

/** The mutable columns of a progress row. */
export interface FeedingProgressWriteData {
  readonly state: FeedingProgressState;
  readonly hayMarkedAt: Date | null;
  readonly hayMarkedByName: string | null;
  readonly concentrateMarkedAt: Date | null;
  readonly concentrateMarkedByName: string | null;
}

// --- pure validation --------------------------------------------------------

/**
 * Trim and require a non-empty horse name. Same identity rule the Stage 2 core
 * applies when composing the board, so a name written here matches the row it
 * will decorate. Returns null for anything unusable; the caller turns that into
 * INVALID_HORSE_NAME_ERROR without echoing the input.
 */
export function normalizeHorseNameInput(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Runtime state validation. TypeScript alone is NOT trusted here: a Server
 * Action's arguments arrive over the wire as deserialized JSON, so the declared
 * union is a compile-time hint about a value this process did not produce.
 * Anything outside the three known members is refused - it can never be coerced
 * into COMPLETE or any other write.
 */
export function isFeedingProgressState(value: unknown): value is FeedingProgressState {
  return value === "PENDING" || value === "HAY_DONE" || value === "COMPLETE";
}

// --- pure write planning ----------------------------------------------------

/**
 * What a mark should do to the database. PENDING is a DELETE because row absence
 * is the canonical "not marked" representation (see the HorseFeedingProgress
 * schema comment) - there is deliberately no stored PENDING row, so reset and
 * never-marked share one single representation.
 */
export type FeedingProgressWritePlan =
  | { readonly kind: "delete" }
  | { readonly kind: "upsert"; readonly data: FeedingProgressWriteData };

/**
 * Compute the write for one mark. PURE - the clock arrives as `now`, and the
 * horse's existing marks arrive as `existing`, so every branch is exhaustively
 * testable.
 *
 *  - PENDING          -> delete the row (idempotent; a missing row is success).
 *  - HAY_DONE         -> hay audit = this actor/now; concentrate audit CLEARED,
 *                        because a horse whose hay was just marked has not been
 *                        given concentrate.
 *  - COMPLETE, horse HAS usable concentrate content
 *                     -> concentrate audit = this actor/now; the hay audit is
 *                        PRESERVED when it already exists (the person who did
 *                        the hay keeps the credit) and otherwise set to this
 *                        actor/now, so a one-tap completion is still attributed.
 *  - COMPLETE, horse has NO usable concentrate content
 *                     -> the hay audit carries the completion (preserved or set
 *                        as above) and the concentrate audit stays NULL. This is
 *                        the important asymmetry: the board must never record
 *                        that concentrate was given to a horse that has none.
 *                        Any stale concentrate audit is cleared rather than
 *                        carried forward, because clearing under-claims and
 *                        keeping it would over-claim.
 */
export function planFeedingProgressWrite(input: {
  readonly targetState: FeedingProgressState;
  readonly hasConcentrate: boolean;
  readonly existing: Pick<FeedingProgressRow, "hayMarkedAt" | "hayMarkedByName"> | null;
  readonly actorName: string;
  readonly now: Date;
}): FeedingProgressWritePlan {
  const { targetState, hasConcentrate, existing, actorName, now } = input;

  if (targetState === "PENDING") return { kind: "delete" };

  if (targetState === "HAY_DONE") {
    return {
      kind: "upsert",
      data: {
        state: "HAY_DONE",
        hayMarkedAt: now,
        hayMarkedByName: actorName,
        concentrateMarkedAt: null,
        concentrateMarkedByName: null,
      },
    };
  }

  const keepsExistingHay = existing?.hayMarkedAt != null;
  const hayMarkedAt = keepsExistingHay ? existing!.hayMarkedAt : now;
  const hayMarkedByName = keepsExistingHay ? existing!.hayMarkedByName : actorName;

  return {
    kind: "upsert",
    data: {
      state: "COMPLETE",
      hayMarkedAt,
      hayMarkedByName,
      concentrateMarkedAt: hasConcentrate ? now : null,
      concentrateMarkedByName: hasConcentrate ? actorName : null,
    },
  };
}

// --- mark progress ----------------------------------------------------------

/**
 * Narrow database effects for one mark. No Prisma type is referenced: each is a
 * plain function ./horse-feeding implements with a single bounded query.
 */
export interface MarkFeedingProgressDeps {
  readonly now: () => Date;
  readonly findMealContent: (horseName: string) => Promise<readonly FeedingMealContentRow[]>;
  readonly findProgress: (horseName: string) => Promise<FeedingProgressRow | null>;
  readonly upsertProgress: (
    horseName: string,
    data: FeedingProgressWriteData,
  ) => Promise<FeedingProgressRow>;
  readonly deleteProgress: (horseName: string) => Promise<number>;
}

/** What the caller learns: the action result plus the authoritative saved row. */
export interface MarkFeedingProgressOutcome {
  readonly result: ActionResult;
  /** The stored row after the write, or null when the horse is now PENDING. */
  readonly progress: FeedingProgressRow | null;
}

/**
 * Persist one explicit target state for one horse.
 *
 * There is deliberately no "advance"/"toggle" entry point: the caller always
 * names the state it wants, so a double click, a retry and two devices sending
 * the same mark all converge on the same row instead of racing a counter
 * forward. Last-write-wins is the accepted policy; the primary key guarantees
 * exactly one row per horse.
 *
 * Validation failures return BEFORE any database call, so a rejected name or
 * state performs no read and no write.
 */
export async function markFeedingProgressWithDeps(
  deps: MarkFeedingProgressDeps,
  command: {
    readonly horseName: string;
    readonly targetState: FeedingProgressState;
    readonly markedByName: string;
  },
): Promise<MarkFeedingProgressOutcome> {
  const horseName = normalizeHorseNameInput(command.horseName);
  if (horseName === null) {
    return { result: { success: false, error: INVALID_HORSE_NAME_ERROR }, progress: null };
  }
  if (!isFeedingProgressState(command.targetState)) {
    return { result: { success: false, error: INVALID_TARGET_STATE_ERROR }, progress: null };
  }

  if (command.targetState === "PENDING") {
    // deleteMany semantics, not delete: a horse that was never marked is not an
    // error, so clearing one horse is idempotent.
    await deps.deleteProgress(horseName);
    return { result: { success: true }, progress: null };
  }

  const [meals, existing] = await Promise.all([
    deps.findMealContent(horseName),
    deps.findProgress(horseName),
  ]);

  const plan = planFeedingProgressWrite({
    targetState: command.targetState,
    hasConcentrate: hasConcentrateContent(meals),
    existing,
    actorName: command.markedByName,
    now: deps.now(),
  });

  // Unreachable for HAY_DONE/COMPLETE - narrowing only.
  if (plan.kind === "delete") {
    await deps.deleteProgress(horseName);
    return { result: { success: true }, progress: null };
  }

  const saved = await deps.upsertProgress(horseName, plan.data);
  return { result: { success: true }, progress: saved };
}

// --- clear the whole board --------------------------------------------------

export interface ClearFeedingProgressDeps {
  /**
   * MUST delete every progress row inside ONE transaction, returning how many
   * rows were removed. The name states the contract the implementation owes:
   * a partially cleared board must never be observable.
   */
  readonly deleteAllProgressInTransaction: () => Promise<number>;
}

export interface ClearFeedingProgressOutcome {
  readonly result: ActionResult;
  readonly deletedCount: number;
}

/**
 * Reset the board for the next round. Global and idempotent by construction:
 * clearing an already-empty board deletes 0 rows and still succeeds. No round
 * history is written anywhere - there is no FeedingRound model and no board
 * metadata table, so the marks are simply gone.
 */
export async function clearAllFeedingProgressWithDeps(
  deps: ClearFeedingProgressDeps,
): Promise<ClearFeedingProgressOutcome> {
  const deletedCount = await deps.deleteAllProgressInTransaction();
  return { result: { success: true }, deletedCount };
}

// --- hide / restore ---------------------------------------------------------

export interface SetHorseFeedingVisibilityDeps {
  /**
   * MUST apply both effects in ONE transaction: upsert the visibility row and,
   * when `clearProgress` is true, delete that horse's progress row. It must
   * NEVER touch HorseFeedingMeal rows or any student horse assignment.
   */
  readonly applyVisibilityInTransaction: (input: {
    readonly horseName: string;
    readonly isHidden: boolean;
    readonly updatedByName: string;
    readonly clearProgress: boolean;
  }) => Promise<FeedingVisibilityRow>;
}

export interface SetHorseFeedingVisibilityOutcome {
  readonly result: ActionResult;
  readonly visibility: FeedingVisibilityRow | null;
}

/**
 * Hide (`isHidden: true`) or RESTORE (`isHidden: false`) one horse.
 *
 * Hiding also clears that horse's round progress in the same transaction, so a
 * horse that is later restored always starts at PENDING and can never come back
 * wearing a mark from a round that ended weeks ago. Restoring clears nothing and
 * CREATES no progress row - absence already means PENDING.
 *
 * Feeding instructions are never deleted by either direction: this module has no
 * meal-deleting dependency at all, so there is no code path through which
 * hiding could remove a HorseFeedingMeal row.
 */
export async function setHorseFeedingVisibilityWithDeps(
  deps: SetHorseFeedingVisibilityDeps,
  command: {
    readonly horseName: string;
    readonly isHidden: boolean;
    readonly updatedByName: string;
  },
): Promise<SetHorseFeedingVisibilityOutcome> {
  const horseName = normalizeHorseNameInput(command.horseName);
  if (horseName === null) {
    return { result: { success: false, error: INVALID_HORSE_NAME_ERROR }, visibility: null };
  }
  if (typeof command.isHidden !== "boolean") {
    // Fail-open on a malformed flag: refuse the write rather than guessing, so
    // an unparseable request can never hide a horse.
    return { result: { success: false, error: INVALID_TARGET_STATE_ERROR }, visibility: null };
  }

  const visibility = await deps.applyVisibilityInTransaction({
    horseName,
    isHidden: command.isHidden,
    updatedByName: command.updatedByName,
    clearProgress: command.isHidden,
  });

  return { result: { success: true }, visibility };
}
