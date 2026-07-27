/**
 * FEEDING-BOARD Stage 2 - PURE composition core for the horse feeding board.
 *
 * PURE: no Prisma, no generated client, no DB, no clock, no randomness, no
 * auth/session/cookies, no env, no network, no logging, no React, no Next.
 * This module has ZERO imports on purpose - every input type it consumes is
 * declared here as a small readonly interface, so nothing about the shape of a
 * database row, a Server Action, or a React component can leak in. It performs
 * NO runtime side effects at import time.
 *
 * WHAT IT DOES: composes one board row per horse from the four independent
 * sources the later reader will supply - active-student horse assignments,
 * HorseFeedingMeal rows, HorseFeedingVisibility rows and HorseFeedingProgress
 * rows - and splits them into activeRows / hiddenRows.
 *
 * WHAT IT DOES NOT DO (deliberate scope boundaries):
 *  - it does NOT resolve a student's horse name (getHorseDisplayInfo stays the
 *    caller's job, exactly as today) - `studentHorses` arrives pre-resolved;
 *  - it does NOT touch the known-horse-name / riding autocomplete set: hiding a
 *    horse here has no effect on getKnownHorseNames or on riding-note
 *    suggestions, by locked product decision;
 *  - it does NOT read attendance - the attendance-derived operational fields on
 *    the existing overview DTO are composed by the caller, unchanged;
 *  - it does NOT require the two new tables to exist. Both new sources are
 *    plain arrays, and an EMPTY array is the correct, fully-supported input:
 *    every horse is then visible and PENDING, which is exactly the board's
 *    behaviour before the migration is applied.
 *
 * FAIL-SAFE DIRECTION (the rule every default below follows): when information
 * is missing, malformed or contradictory, this core errs towards SHOWING a
 * horse and towards NOT claiming it has been fed. Over-showing costs a glance;
 * under-showing means an unfed horse, and a false "complete" means a hungry
 * horse. There is no input this core can receive that hides a horse it is not
 * explicitly told to hide, or that reports feeding progress nobody recorded.
 */

// --- state / mode vocabulary ------------------------------------------------

/**
 * The STORED feeding-round state machine, mirroring the committed
 * HorseFeedingProgressState enum as a local string union (never imported from
 * the generated client, so this module stays DB-free). This is the only stored
 * state machine: the per-horse control mode below changes which options a UI
 * offers, never what is persisted.
 */
export type FeedingProgressState = "PENDING" | "HAY_DONE" | "COMPLETE";

/** Mirrors the committed HorseMealType enum, again as a local union. */
export type FeedingMealType = "MORNING" | "LUNCH" | "EVENING";

/**
 * Which status control a horse should render:
 *  - "hayAndConcentrate": the horse has usable concentrate content, so the
 *    three-step PENDING -> HAY_DONE -> COMPLETE control applies;
 *  - "completeOnly": the horse has no usable concentrate content (hay-only,
 *    content-free meal rows, or no meal row at all), so a two-option
 *    PENDING/COMPLETE control applies and HAY_DONE is not offered.
 */
export type FeedingStatusControlMode = "hayAndConcentrate" | "completeOnly";

// --- input types (owned here; no Prisma model is referenced) ----------------

/** Read-only display fields for the one trainee currently matched to a horse. */
export interface FeedingBoardResponsibleStudent {
  readonly id: string;
  readonly fullName: string;
  readonly groupName: string | null;
  readonly subgroupNumber: number | null;
}

/**
 * A horse reached through an active student's assignment. `horseName` is
 * already resolved by the caller (getHorseDisplayInfo). `responsibleStudent` is
 * optional: a horse may enter the board from this source with no display fields
 * attached.
 */
export interface FeedingBoardStudentHorseInput {
  readonly horseName: string;
  readonly responsibleStudent?: FeedingBoardResponsibleStudent | null;
}

/**
 * One HorseFeedingMeal row. `updatedByName`/`updatedAt` are carried because the
 * existing board DTO surfaces "last updated by / at" per horse.
 *
 * `updatedAt` is an ISO-8601 string (NOT a Date): this core must not touch the
 * clock or construct dates, and ISO-8601 UTC strings compare correctly with
 * plain string comparison, which is all "pick the most recently updated meal"
 * needs. `null` is treated as the oldest possible value.
 */
export interface FeedingBoardMealInput {
  readonly horseName: string;
  readonly mealType: FeedingMealType;
  readonly hayType: string | null;
  readonly concentrateType: string | null;
  readonly concentrateAmount: string | null;
  readonly notes: string | null;
  readonly updatedByName: string | null;
  readonly updatedAt: string | null;
}

/** One HorseFeedingVisibility row. A horse with NO row here is VISIBLE. */
export interface FeedingBoardVisibilityInput {
  readonly horseName: string;
  readonly isHidden: boolean;
}

/**
 * One HorseFeedingProgress row. A horse with NO row here is PENDING.
 *
 * `state` is typed as the union, but is still validated at runtime: TypeScript
 * cannot protect against a value that has drifted in the database (a stale row
 * written by an older deploy, a manual edit, a future enum member). An
 * unrecognised value is treated as PENDING - never as any form of completion.
 * Timestamps are ISO-8601 strings, passed through verbatim; this core never
 * invents a timestamp or an actor name.
 */
export interface FeedingBoardProgressInput {
  readonly horseName: string;
  readonly state: FeedingProgressState;
  readonly hayMarkedAt: string | null;
  readonly hayMarkedByName: string | null;
  readonly concentrateMarkedAt: string | null;
  readonly concentrateMarkedByName: string | null;
}

/** The four independent sources, each safely empty. */
export interface FeedingBoardInput {
  readonly studentHorses: readonly FeedingBoardStudentHorseInput[];
  readonly meals: readonly FeedingBoardMealInput[];
  readonly visibility: readonly FeedingBoardVisibilityInput[];
  readonly progress: readonly FeedingBoardProgressInput[];
}

// --- output types -----------------------------------------------------------

/** One meal's instruction fields, copied (never the input object itself). */
export interface FeedingBoardMealView {
  readonly hayType: string | null;
  readonly concentrateType: string | null;
  readonly concentrateAmount: string | null;
  readonly notes: string | null;
}

/** The per-step audit trail of the current round, copied verbatim. */
export interface FeedingBoardProgressView {
  readonly hayMarkedAt: string | null;
  readonly hayMarkedByName: string | null;
  readonly concentrateMarkedAt: string | null;
  readonly concentrateMarkedByName: string | null;
}

/**
 * One selectable status option. Carries a text label AND a glyph so a UI can
 * satisfy the "never communicate status by colour alone" rule without inventing
 * its own wording; colour, if any, is the UI's own reinforcement. No JSX and no
 * CSS class ever appears here.
 */
export interface FeedingBoardStatusOption {
  readonly state: FeedingProgressState;
  readonly label: string;
  readonly glyph: string;
  readonly isCurrent: boolean;
}

export interface FeedingBoardRow {
  /** Trimmed horse name - the identity of this row (see IDENTITY below). */
  readonly horseName: string;
  readonly morning: FeedingBoardMealView | null;
  readonly lunch: FeedingBoardMealView | null;
  readonly evening: FeedingBoardMealView | null;
  /** Authorship of the most recently updated meal row, or null. */
  readonly updatedByName: string | null;
  readonly updatedAt: string | null;
  readonly responsibleStudent: FeedingBoardResponsibleStudent | null;
  readonly isHidden: boolean;
  readonly hasHayContent: boolean;
  readonly hasConcentrateContent: boolean;
  readonly statusControlMode: FeedingStatusControlMode;
  /** Audit stamps of the stored progress row, or null when there is none. */
  readonly progress: FeedingBoardProgressView | null;
  /** The STORED state (PENDING when no row / unrecognised value). */
  readonly progressState: FeedingProgressState;
  /** The state a control should show as selected - see NORMALISATION below. */
  readonly displayProgressState: FeedingProgressState;
  /** True exactly when displayProgressState had to differ from progressState. */
  readonly isDisplayStateNormalized: boolean;
  readonly statusOptions: readonly FeedingBoardStatusOption[];
}

export interface FeedingBoard {
  readonly activeRows: readonly FeedingBoardRow[];
  readonly hiddenRows: readonly FeedingBoardRow[];
}

// --- labels -----------------------------------------------------------------

const PENDING_LABEL = "לא סומן";
const HAY_DONE_LABEL = "חציר הושלם";
const COMPLETE_WITH_CONCENTRATE_LABEL = "חציר + מזון מרוכז";
const COMPLETE_ONLY_LABEL = "הושלם";

const PENDING_GLYPH = "○";
const HAY_DONE_GLYPH = "◐";
const COMPLETE_GLYPH = "✓";

// --- small pure helpers -----------------------------------------------------

const MEAL_TYPE_ORDER: readonly FeedingMealType[] = ["MORNING", "LUNCH", "EVENING"];

/** Ordering used to resolve contradictory progress rows - see PROGRESS below. */
const PROGRESS_RANK: Readonly<Record<FeedingProgressState, number>> = {
  PENDING: 0,
  HAY_DONE: 1,
  COMPLETE: 2,
};

function isFeedingProgressState(value: unknown): value is FeedingProgressState {
  return value === "PENDING" || value === "HAY_DONE" || value === "COMPLETE";
}

function isFeedingMealType(value: unknown): value is FeedingMealType {
  return value === "MORNING" || value === "LUNCH" || value === "EVENING";
}

/**
 * IDENTITY: a horse is identified by its TRIMMED name. Trimming is applied to
 * every source alike, so a stray trailing space can never split one horse into
 * two rows or orphan its visibility/progress row. Case is deliberately NOT
 * folded: Hebrew has no case, and folding would risk merging two genuinely
 * different Latin-script names.
 *
 * REFUSAL STRATEGY: a non-string, empty or whitespace-only name yields null and
 * that source row is SKIPPED - consistently, in all four sources, and WITHOUT
 * throwing. Throwing would blank the entire operational board for every user
 * because of one bad string, which is strictly worse than dropping a row that
 * cannot identify a horse in the first place. Skipping is also PII-free: no
 * name value is ever placed in an error message, because no error is raised.
 */
function normalizeHorseName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Content counts only when it is a string with at least one non-space char. */
function isUsableContent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True when any of the horse's meals names a hay type.
 *
 * `notes` deliberately does NOT count as hay or concentrate content: a note is
 * an instruction about feeding, not evidence that this horse receives hay or
 * concentrate, and letting it count would silently promote content-free horses
 * into the three-step control.
 */
export function hasHayContent(meals: readonly (FeedingBoardMealView | null)[]): boolean {
  return meals.some((meal) => meal !== null && isUsableContent(meal.hayType));
}

/** True when any meal names a concentrate type OR a concentrate amount. */
export function hasConcentrateContent(meals: readonly (FeedingBoardMealView | null)[]): boolean {
  return meals.some(
    (meal) =>
      meal !== null &&
      (isUsableContent(meal.concentrateType) || isUsableContent(meal.concentrateAmount)),
  );
}

/**
 * Which control a horse gets. Concentrate content is the ONLY input: a horse
 * with usable concentrate content gets the three-step control, everything else
 * (hay-only, content-free meal rows, no meal row at all) gets the two-option
 * control. Presentation only - the stored state machine is unchanged.
 */
export function resolveFeedingStatusControlMode(
  meals: readonly (FeedingBoardMealView | null)[],
): FeedingStatusControlMode {
  return hasConcentrateContent(meals) ? "hayAndConcentrate" : "completeOnly";
}

/**
 * NORMALISATION: a "completeOnly" horse whose STORED state is HAY_DONE (stale
 * data from before its concentrate instructions were removed, or an import) is
 * DISPLAYED as PENDING, never as COMPLETE.
 *
 * HAY_DONE is not an option on that horse's two-option control, so it must map
 * to one of the two that exist. Mapping it to COMPLETE would claim the horse is
 * fully fed on the strength of a half-mark nobody made - the one error class
 * this whole feature exists to prevent. Mapping it to PENDING can at worst
 * cause a horse to be checked twice.
 *
 * The stored value is NEVER mutated: the row still reports
 * progressState: "HAY_DONE", isDisplayStateNormalized: true, and its audit
 * stamps untouched, so nothing is hidden from a manager or from a later write.
 */
function resolveDisplayProgressState(
  mode: FeedingStatusControlMode,
  storedState: FeedingProgressState,
): FeedingProgressState {
  if (mode === "completeOnly" && storedState === "HAY_DONE") return "PENDING";
  return storedState;
}

function makeStatusOption(
  state: FeedingProgressState,
  label: string,
  glyph: string,
  displayState: FeedingProgressState,
): FeedingBoardStatusOption {
  return Object.freeze({ state, label, glyph, isCurrent: state === displayState });
}

function buildStatusOptions(
  mode: FeedingStatusControlMode,
  displayState: FeedingProgressState,
): readonly FeedingBoardStatusOption[] {
  const options =
    mode === "hayAndConcentrate"
      ? [
          makeStatusOption("PENDING", PENDING_LABEL, PENDING_GLYPH, displayState),
          makeStatusOption("HAY_DONE", HAY_DONE_LABEL, HAY_DONE_GLYPH, displayState),
          makeStatusOption("COMPLETE", COMPLETE_WITH_CONCENTRATE_LABEL, COMPLETE_GLYPH, displayState),
        ]
      : [
          makeStatusOption("PENDING", PENDING_LABEL, PENDING_GLYPH, displayState),
          makeStatusOption("COMPLETE", COMPLETE_ONLY_LABEL, COMPLETE_GLYPH, displayState),
        ];
  return Object.freeze(options);
}

/**
 * SORTING: the existing Hebrew ordering, `localeCompare(other, "he")`, is
 * preserved exactly. Because that collator can report 0 for two strings that
 * are not identical, a code-unit comparison breaks the tie so the output order
 * is total and deterministic rather than dependent on the input array order.
 */
function compareHorseNames(a: string, b: string): number {
  const collated = a.localeCompare(b, "he");
  if (collated !== 0) return collated;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// --- deterministic conflict resolution --------------------------------------
//
// The database's primary keys and unique constraints already make duplicates
// impossible for visibility, progress and (horseName, mealType). These rules
// exist so the core's output is a pure function of the CONTENT of its inputs
// and never of their ORDER - a caller that reorders its query results, or a
// future caller that unions two queries, must get byte-identical output.

/** Stable, content-derived tiebreaker; never used unless a real tie occurs. */
function contentSignature(values: readonly (string | null)[]): string {
  return values.map((value) => value ?? "").join(" ");
}

/** Prefer the entry carrying student details; then the lowest student id. */
function preferResponsibleStudent(
  existing: FeedingBoardResponsibleStudent | null,
  incoming: FeedingBoardResponsibleStudent | null,
): FeedingBoardResponsibleStudent | null {
  if (existing === null) return incoming;
  if (incoming === null) return existing;
  return existing.id <= incoming.id ? existing : incoming;
}

/** Prefer the most recently updated meal; then the lowest content signature. */
function preferMeal(
  existing: FeedingBoardMealInput,
  incoming: FeedingBoardMealInput,
): FeedingBoardMealInput {
  const existingAt = existing.updatedAt ?? "";
  const incomingAt = incoming.updatedAt ?? "";
  if (existingAt !== incomingAt) return existingAt > incomingAt ? existing : incoming;
  const existingKey = contentSignature([
    existing.hayType,
    existing.concentrateType,
    existing.concentrateAmount,
    existing.notes,
    existing.updatedByName,
  ]);
  const incomingKey = contentSignature([
    incoming.hayType,
    incoming.concentrateType,
    incoming.concentrateAmount,
    incoming.notes,
    incoming.updatedByName,
  ]);
  return existingKey <= incomingKey ? existing : incoming;
}

/** Latest meal wins authorship; ties resolve by canonical meal-type order. */
function preferLatestMeal(
  existing: FeedingBoardMealInput | null,
  incoming: FeedingBoardMealInput,
): FeedingBoardMealInput {
  if (existing === null) return incoming;
  const existingAt = existing.updatedAt ?? "";
  const incomingAt = incoming.updatedAt ?? "";
  if (existingAt !== incomingAt) return incomingAt > existingAt ? incoming : existing;
  return MEAL_TYPE_ORDER.indexOf(incoming.mealType) < MEAL_TYPE_ORDER.indexOf(existing.mealType)
    ? incoming
    : existing;
}

// --- board composition ------------------------------------------------------

function toMealView(meal: FeedingBoardMealInput | undefined): FeedingBoardMealView | null {
  if (!meal) return null;
  return {
    hayType: meal.hayType ?? null,
    concentrateType: meal.concentrateType ?? null,
    concentrateAmount: meal.concentrateAmount ?? null,
    notes: meal.notes ?? null,
  };
}

function copyResponsibleStudent(
  student: FeedingBoardResponsibleStudent | null,
): FeedingBoardResponsibleStudent | null {
  if (student === null) return null;
  return Object.freeze({
    id: student.id,
    fullName: student.fullName,
    groupName: student.groupName ?? null,
    subgroupNumber: student.subgroupNumber ?? null,
  });
}

/**
 * Compose the feeding board.
 *
 * UNION: one row per horse present in `studentHorses` OR `meals` - a horse in
 * both still yields exactly one row. This reproduces the union
 * buildHorseFeedingOverview already computes today, so a horse's instructions
 * never vanish because no active student currently claims that name, and a
 * newly assigned horse appears immediately with no meal row.
 *
 * A visibility or progress row whose horse is in NEITHER source is an ORPHAN
 * (typically left behind when a horse name was renamed or an assignment
 * cleared): it is ignored and creates no row. Those tables decorate the board;
 * they never populate it, so a stale row can never resurrect a horse that no
 * longer exists in the two real sources.
 *
 * Inputs are never mutated and never frozen. Everything this function returns
 * is newly constructed and frozen.
 */
export function buildFeedingBoard(input: FeedingBoardInput): FeedingBoard {
  const studentByHorse = new Map<string, FeedingBoardResponsibleStudent | null>();
  for (const entry of input.studentHorses) {
    const horseName = normalizeHorseName(entry?.horseName);
    if (horseName === null) continue;
    const incoming = entry.responsibleStudent ?? null;
    studentByHorse.set(
      horseName,
      studentByHorse.has(horseName)
        ? preferResponsibleStudent(studentByHorse.get(horseName) ?? null, incoming)
        : incoming,
    );
  }

  const mealsByHorse = new Map<string, Map<FeedingMealType, FeedingBoardMealInput>>();
  for (const meal of input.meals) {
    const horseName = normalizeHorseName(meal?.horseName);
    // An unrecognised mealType is skipped for the same reason a blank name is:
    // it cannot be placed in the morning/lunch/evening view, and dropping one
    // row is safer than failing the whole board.
    if (horseName === null || !isFeedingMealType(meal.mealType)) continue;
    let byType = mealsByHorse.get(horseName);
    if (!byType) {
      byType = new Map<FeedingMealType, FeedingBoardMealInput>();
      mealsByHorse.set(horseName, byType);
    }
    const existing = byType.get(meal.mealType);
    byType.set(meal.mealType, existing ? preferMeal(existing, meal) : meal);
  }

  // VISIBILITY: only an explicit `isHidden === true` hides a horse. A missing
  // row, a row with isHidden false, and any non-boolean value all mean VISIBLE,
  // and on contradictory duplicate rows VISIBLE wins. There is no input that
  // fails closed into hiding.
  const hiddenByHorse = new Map<string, boolean>();
  for (const row of input.visibility) {
    const horseName = normalizeHorseName(row?.horseName);
    if (horseName === null) continue;
    const incomingHidden = row.isHidden === true;
    const existingHidden = hiddenByHorse.get(horseName);
    hiddenByHorse.set(
      horseName,
      existingHidden === undefined ? incomingHidden : existingHidden && incomingHidden,
    );
  }

  // PROGRESS: an unrecognised state degrades to PENDING, and on contradictory
  // duplicate rows the LEAST advanced state wins (PENDING < HAY_DONE <
  // COMPLETE), so no combination of malformed or conflicting input can report a
  // horse as fed. Timestamps and actor names are passed through verbatim.
  const progressByHorse = new Map<string, FeedingBoardProgressInput>();
  for (const row of input.progress) {
    const horseName = normalizeHorseName(row?.horseName);
    if (horseName === null) continue;
    const existing = progressByHorse.get(horseName);
    if (!existing) {
      progressByHorse.set(horseName, row);
      continue;
    }
    const existingRank = PROGRESS_RANK[isFeedingProgressState(existing.state) ? existing.state : "PENDING"];
    const incomingRank = PROGRESS_RANK[isFeedingProgressState(row.state) ? row.state : "PENDING"];
    if (incomingRank !== existingRank) {
      progressByHorse.set(horseName, incomingRank < existingRank ? row : existing);
      continue;
    }
    const existingKey = contentSignature([
      existing.hayMarkedAt,
      existing.hayMarkedByName,
      existing.concentrateMarkedAt,
      existing.concentrateMarkedByName,
    ]);
    const incomingKey = contentSignature([
      row.hayMarkedAt,
      row.hayMarkedByName,
      row.concentrateMarkedAt,
      row.concentrateMarkedByName,
    ]);
    progressByHorse.set(horseName, existingKey <= incomingKey ? existing : row);
  }

  const horseNames = new Set<string>([...studentByHorse.keys(), ...mealsByHorse.keys()]);

  const activeRows: FeedingBoardRow[] = [];
  const hiddenRows: FeedingBoardRow[] = [];

  for (const horseName of horseNames) {
    const byType = mealsByHorse.get(horseName);
    const morning = toMealView(byType?.get("MORNING"));
    const lunch = toMealView(byType?.get("LUNCH"));
    const evening = toMealView(byType?.get("EVENING"));
    const mealViews: readonly (FeedingBoardMealView | null)[] = [morning, lunch, evening];

    let latestMeal: FeedingBoardMealInput | null = null;
    for (const mealType of MEAL_TYPE_ORDER) {
      const meal = byType?.get(mealType);
      if (meal) latestMeal = preferLatestMeal(latestMeal, meal);
    }

    const storedProgress = progressByHorse.get(horseName) ?? null;
    const progressState: FeedingProgressState =
      storedProgress !== null && isFeedingProgressState(storedProgress.state)
        ? storedProgress.state
        : "PENDING";

    const statusControlMode = resolveFeedingStatusControlMode(mealViews);
    const displayProgressState = resolveDisplayProgressState(statusControlMode, progressState);

    const row: FeedingBoardRow = Object.freeze({
      horseName,
      morning: morning === null ? null : Object.freeze(morning),
      lunch: lunch === null ? null : Object.freeze(lunch),
      evening: evening === null ? null : Object.freeze(evening),
      updatedByName: latestMeal?.updatedByName ?? null,
      updatedAt: latestMeal?.updatedAt ?? null,
      responsibleStudent: copyResponsibleStudent(studentByHorse.get(horseName) ?? null),
      isHidden: hiddenByHorse.get(horseName) === true,
      hasHayContent: hasHayContent(mealViews),
      hasConcentrateContent: hasConcentrateContent(mealViews),
      statusControlMode,
      // HIDDEN ROWS KEEP THEIR PROGRESS. A hidden horse is never in activeRows,
      // so stale progress cannot leak into the operational board; keeping it in
      // hiddenRows lets a manager see that a horse was mid-round when it was
      // hidden, and makes the later hide-time deletion of that row verifiable
      // rather than invisible.
      progress:
        storedProgress === null
          ? null
          : Object.freeze({
              hayMarkedAt: storedProgress.hayMarkedAt ?? null,
              hayMarkedByName: storedProgress.hayMarkedByName ?? null,
              concentrateMarkedAt: storedProgress.concentrateMarkedAt ?? null,
              concentrateMarkedByName: storedProgress.concentrateMarkedByName ?? null,
            }),
      progressState,
      displayProgressState,
      isDisplayStateNormalized: displayProgressState !== progressState,
      statusOptions: buildStatusOptions(statusControlMode, displayProgressState),
    });

    if (row.isHidden) hiddenRows.push(row);
    else activeRows.push(row);
  }

  activeRows.sort((a, b) => compareHorseNames(a.horseName, b.horseName));
  hiddenRows.sort((a, b) => compareHorseNames(a.horseName, b.horseName));

  return Object.freeze({
    activeRows: Object.freeze(activeRows),
    hiddenRows: Object.freeze(hiddenRows),
  });
}
