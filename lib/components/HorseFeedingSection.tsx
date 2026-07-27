"use client";

import { FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { ConfirmModal } from "@/lib/components/ConfirmModal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import {
  HorseFeedingStatusControl,
  shouldApplyFeedingMarkResult,
} from "@/lib/components/HorseFeedingStatusControl";
import {
  HIDE_ACTION_LABEL,
  HIDE_CONFIRM_BUTTON,
  HIDE_CONFIRM_TITLE,
  HorseFeedingVisibilityManager,
  RESTORE_CONFIRM_BODY,
  RESTORE_CONFIRM_BUTTON,
  RESTORE_CONFIRM_TITLE,
  buildHideConfirmMessage,
  upsertHiddenBoardRow,
} from "@/lib/components/HorseFeedingVisibilityManager";
import { STATUS_BADGE_CLASS } from "@/lib/attendance-ui";
import { formatHebrewDateTime } from "@/lib/dates";
import {
  getKnownHayTypes,
  getKnownConcentrateTypes,
  getKnownConcentrateAmounts,
  type HorseFeedingClearActionResult,
  type HorseFeedingOverviewRow,
  type HorseFeedingProgressActionResult,
  type HorseFeedingUpsertInput,
  type HorseFeedingVisibilityActionResult,
} from "@/lib/actions/horse-feeding";
import type { FeedingProgressState } from "@/lib/feeding/feeding-board-core";
import type { ActionResult } from "@/lib/actions/students";

// STABLE, SAFE failure text. A caught exception's message is NEVER rendered: a
// Prisma/Next internal string (SQL, a digest, a redirect marker, an id) must not
// reach a tablet on the yard. A Server Action's own ActionResult.error IS shown,
// because those are the fixed, PII-free Hebrew constants Stage 3/4 designed as
// user-facing.
const MARK_FAILED_ERROR = "לא הצלחנו לעדכן את סימון ההאכלה. נסו שוב.";
const CLEAR_FAILED_ERROR = "לא הצלחנו לנקות את הסימונים. נסו שוב.";

const CLEAR_CONFIRM_TITLE = "ניקוי כל הסימונים";
const CLEAR_CONFIRM_BODY =
  "פעולה זו תאפס את סימוני ההאכלה של כל הסוסים ותכין את הלוח לסבב ההאכלה הבא.\n" +
  "הוראות ההאכלה עצמן לא יימחקו.\n" +
  "לא ניתן לשחזר את הסימונים שיימחקו.";
const CLEAR_ALL_LABEL = "נקה את כל הסימונים";
// Shown when a reset is attempted while a per-horse mark is still being saved.
// Advisory only - the generation guard below is what actually keeps the board
// correct, because a mark can begin between this check and the reset landing.
const CLEAR_BLOCKED_BY_MARK_ERROR = "יש להמתין לסיום עדכון ההאכלות לפני ניקוי הסימונים.";

// FEEDING-BOARD Stage 5B - manager visibility. Same rule as above: fixed Hebrew
// text only, never a caught exception's own wording.
const HIDE_FAILED_ERROR = "לא הצלחנו להסתיר את הסוס. נסו שוב.";
const RESTORE_FAILED_ERROR = "לא הצלחנו להחזיר את הסוס לרשימה. נסו שוב.";
const HIDDEN_LOAD_FAILED_ERROR = "לא הצלחנו לטעון את רשימת הסוסים המוסתרים.";
const HIDE_BLOCKED_BY_MARK_ERROR = "יש להמתין לסיום עדכון ההאכלה של הסוס לפני הסתרתו.";
const HIDE_BLOCKED_BY_CLEAR_ERROR = "יש להמתין לסיום ניקוי הסימונים לפני הסתרת סוס.";

// Time-only, device-local. The audit line is a glance ("who did the hay, when"),
// so a full date would be noise - and a raw ISO string is never shown.
function formatMarkTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(date);
}

// Never fabricates: renders only the parts that actually exist, and nothing at
// all when neither an actor nor a time was recorded.
function markSummary(byName: string | null, at: string | null): string | null {
  const time = formatMarkTime(at);
  if (byName && time) return `${byName}, ${time}`;
  return byName ?? time;
}

/**
 * THE WHOLE-CARD COLOUR OF ONE HORSE, derived from exactly one input: the
 * display progress state that the Stage 2 pure core already resolved and the
 * Stage 4 overview DTO carries. PURE and total.
 *
 * NO SECOND STATE MACHINE. It never reads an audit timestamp, an actor name or a
 * meal field, so the card can never disagree with the status control below it -
 * both render the same `displayProgressState` value. It is also the single place
 * the mapping exists, so no render branch can drift from it.
 *
 * PENDING IS TRULY NEUTRAL - the repository's default card surface and border,
 * with no other colour blended in. An unmarked horse therefore looks like every
 * other unmarked horse, so amber/green can only ever mean "this horse's round
 * actually progressed". Group identity is carried by the responsible-student
 * line's own text, not by the card. A completeOnly horse never reaches
 * HAY_DONE, so it moves straight from neutral to green with no extra branch.
 *
 * Repository tokens only - never a hard-coded colour - and colour stays
 * SUPPLEMENTAL: the state is independently stated by the control's label, glyph
 * and aria-checked, all of which survive grayscale and colour-blindness.
 */
const CARD_STATE_CLASS: Readonly<Record<FeedingProgressState, string>> = {
  PENDING: "border-border bg-card",
  HAY_DONE: "border-warning bg-warning-muted",
  COMPLETE: "border-success bg-success-muted",
};

export function resolveHorseFeedingCardStateClass(
  displayProgressState: FeedingProgressState
): string {
  return CARD_STATE_CLASS[displayProgressState];
}

interface MealFormState {
  hayType: string;
  concentrateType: string;
  concentrateAmount: string;
  notes: string;
}

const EMPTY_MEAL: MealFormState = { hayType: "", concentrateType: "", concentrateAmount: "", notes: "" };

function mealToForm(
  meal: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null; notes: string | null } | null
): MealFormState {
  if (!meal) return EMPTY_MEAL;
  return {
    hayType: meal.hayType ?? "",
    concentrateType: meal.concentrateType ?? "",
    concentrateAmount: meal.concentrateAmount ?? "",
    notes: meal.notes ?? "",
  };
}

// One meal's compact display line - omits fields that are empty rather than
// showing "-", and only renders at all when at least one field is set. The
// concentrate fields are always labeled "...מזון מרוכז" so they can never be
// mistaken for a hay amount (hay itself has no separate quantity field).
function MealSummaryLine({ label, meal }: { label: string; meal: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null; notes: string | null } | null }) {
  if (!meal) return null;
  const parts: string[] = [];
  if (meal.hayType) parts.push(`חציר: ${meal.hayType}`);
  if (meal.concentrateType) parts.push(`סוג מזון מרוכז: ${meal.concentrateType}`);
  if (meal.concentrateAmount) parts.push(`כמות מזון מרוכז: ${meal.concentrateAmount}`);
  return (
    <div className="text-sm">
      <span className="font-semibold text-card-foreground">{label}: </span>
      <span className="text-muted-foreground">{parts.length > 0 ? parts.join(" · ") : "אין פרטים"}</span>
      {meal.notes && <p className="mt-0.5 text-xs text-muted-foreground">הערות: {meal.notes}</p>}
    </div>
  );
}

/**
 * FEEDING-BOARD Stage 5A: the four progress props are OPTIONAL and default to
 * off, so a host that has not been wired yet renders exactly the pre-Stage-5A
 * board (status controls disabled, no clear button). Each permission arrives as
 * an explicit boolean from its host - it is never inferred from a role, a name,
 * a URL or any other client state - and it only decides what the UI OFFERS. The
 * injected Server Actions re-derive the actor from the signed session and remain
 * the true authorization boundary.
 */
export function HorseFeedingSection({
  canEdit,
  canMarkProgress = false,
  canClearProgress = false,
  canManageVisibility = false,
  fetchOverview,
  fetchHiddenOverview,
  onSave,
  onMarkProgress,
  onClearAllProgress,
  onSetVisibility,
}: {
  canEdit: boolean;
  canMarkProgress?: boolean;
  canClearProgress?: boolean;
  /**
   * Stage 5B: may this screen OFFER hide/restore. Manager surface only; the
   * admin-gated Server Actions decide whether it actually happens.
   */
  canManageVisibility?: boolean;
  fetchOverview: () => Promise<HorseFeedingOverviewRow[]>;
  /** Manager-only reader. Absent for the instructor host, so no hidden row is ever fetched there. */
  fetchHiddenOverview?: () => Promise<readonly HorseFeedingOverviewRow[]>;
  onSave: (input: HorseFeedingUpsertInput) => Promise<ActionResult>;
  onMarkProgress?: (input: {
    horseName: string;
    targetState: FeedingProgressState;
  }) => Promise<HorseFeedingProgressActionResult>;
  onClearAllProgress?: () => Promise<HorseFeedingClearActionResult>;
  onSetVisibility?: (input: {
    horseName: string;
    isHidden: boolean;
  }) => Promise<HorseFeedingVisibilityActionResult>;
}) {
  const [rows, setRows] = useState<HorseFeedingOverviewRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [knownHayTypes, setKnownHayTypes] = useState<string[]>([]);
  const [knownConcentrateTypes, setKnownConcentrateTypes] = useState<string[]>([]);
  const [knownConcentrateAmounts, setKnownConcentrateAmounts] = useState<string[]>([]);

  const [modalRow, setModalRow] = useState<HorseFeedingOverviewRow | "new" | null>(null);
  const [horseName, setHorseName] = useState("");
  const [morning, setMorning] = useState<MealFormState>(EMPTY_MEAL);
  const [evening, setEvening] = useState<MealFormState>(EMPTY_MEAL);
  const [hasLunch, setHasLunch] = useState(false);
  const [lunch, setLunch] = useState<MealFormState>(EMPTY_MEAL);
  // "shared": morning/evening use one combined concentrateType+concentrateAmount
  // section (the common case). "separate": each keeps its own, used
  // automatically when existing saved values differ so nothing is silently
  // merged/lost, or manually via the toggle link below. Lunch never
  // participates in this - it always keeps its own independent concentrate
  // fields, since it's an optional extra meal that may differ on purpose.
  const [concentrateMode, setConcentrateMode] = useState<"shared" | "separate">("shared");
  const [sharedConcentrateType, setSharedConcentrateType] = useState("");
  const [sharedConcentrateAmount, setSharedConcentrateAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // --- Stage 5A: round progress -------------------------------------------
  // Horses with a mark currently in flight. Kept in a ref as well as in state so
  // the guard is synchronous (a second tap in the same tick still sees it) and so
  // the visibility listener can read it without re-subscribing.
  const [savingHorses, setSavingHorses] = useState<string[]>([]);
  const savingRef = useRef<string[]>([]);
  const [progressError, setProgressError] = useState<string | null>(null);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const clearingRef = useRef(false);
  // CLEAR EPOCH. Incremented on every successful reset. A mark records the
  // generation it started in and its late result is discarded when they differ,
  // so a request that was already in flight when the board was cleared can never
  // patch a horse back to a pre-clear state. A ref, not state: it must be exact
  // at the moment an async result lands, not at the last render.
  const clearGenerationRef = useRef(0);
  // PER-HORSE EPOCH, the same idea scoped to one horse: bumped whenever a horse
  // LEAVES or RE-ENTERS the active board (hide/restore), because hiding clears
  // that horse's progress server-side and a restore refetches it. A mark that was
  // already in flight describes a round the horse is no longer in, so its result
  // must not be applied even after a refetch puts the row back.
  const horseGenerationRef = useRef<Record<string, number>>({});

  // --- Stage 5B: manager visibility ---------------------------------------
  // Hidden rows live in their OWN list. They are never merged into `rows` and
  // never filtered out of it, so there is no code path on which a host without
  // the manager props could render one.
  const [hiddenRows, setHiddenRows] = useState<HorseFeedingOverviewRow[] | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [hiddenLoading, setHiddenLoading] = useState(false);
  const [hiddenError, setHiddenError] = useState<string | null>(null);
  const [hiddenSearch, setHiddenSearch] = useState("");
  const hiddenLoadingRef = useRef(false);
  const hiddenLoadedRef = useRef(false);
  const [visibilityBusyHorse, setVisibilityBusyHorse] = useState<string | null>(null);
  const visibilityBusyRef = useRef<string | null>(null);
  const [hideTarget, setHideTarget] = useState<HorseFeedingOverviewRow | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<HorseFeedingOverviewRow | null>(null);
  const [visibilityError, setVisibilityError] = useState<string | null>(null);
  const [visibilityMessage, setVisibilityMessage] = useState<string | null>(null);

  // Every manager affordance requires its own prop to be present - a flag alone
  // never reveals a control whose action was not wired.
  const canHideHorses = canManageVisibility && Boolean(onSetVisibility);
  const canBrowseHiddenHorses = canHideHorses && Boolean(fetchHiddenOverview);

  function horseMarkGeneration(horseName: string): number {
    return horseGenerationRef.current[horseName] ?? 0;
  }

  function invalidateHorseMarks(horseName: string) {
    horseGenerationRef.current = {
      ...horseGenerationRef.current,
      [horseName]: horseMarkGeneration(horseName) + 1,
    };
  }
  // Guards a background refresh: never while a load is already running, never
  // while the instruction modal holds unsaved edits, never mid-mark.
  const loadingRef = useRef(false);
  // Exactly one follow-up refresh may be queued behind an in-flight load, so a
  // refresh requested by a write is never silently dropped by the duplicate-load
  // guard. See requestAuthoritativeRefresh.
  const queuedLoadRef = useRef(false);
  const queuedHiddenLoadRef = useRef(false);
  const modalOpenRef = useRef(false);

  function beginSaving(horseName: string) {
    savingRef.current = [...savingRef.current, horseName];
    setSavingHorses(savingRef.current);
  }

  function endSaving(horseName: string) {
    savingRef.current = savingRef.current.filter((name) => name !== horseName);
    setSavingHorses(savingRef.current);
  }

  // `silent` is the background (visibility) refresh: it must never blank the
  // board or raise a banner just because the tab woke up on a bad connection.
  function load(options?: { silent?: boolean }) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!options?.silent) setLoadError(null);
    fetchOverview()
      .then(setRows)
      .catch(() => {
        if (options?.silent) return;
        setRows([]);
        setLoadError("שגיאה בטעינת רשימת ההאכלות. נסו לרענן.");
      })
      .finally(() => {
        loadingRef.current = false;
        // A refresh requested WHILE this one was running could not be served by
        // it (that request may have started before the write), so exactly one
        // follow-up runs now. The duplicate-load guard above is untouched.
        if (queuedLoadRef.current) {
          queuedLoadRef.current = false;
          load();
        }
      });
  }

  // MANAGER-ONLY, and gated on the props themselves: an instructor host supplies
  // no reader, so this can never issue a request there. A silent refresh only
  // refreshes a list that was already opened once - it never fetches hidden rows
  // on its own initiative.
  function loadHidden(options?: { silent?: boolean }) {
    if (!canManageVisibility || !fetchHiddenOverview) return;
    if (options?.silent && !hiddenLoadedRef.current) return;
    if (hiddenLoadingRef.current) return;
    hiddenLoadingRef.current = true;
    if (!options?.silent) {
      setHiddenError(null);
      setHiddenLoading(true);
    }
    fetchHiddenOverview()
      .then((rows) => {
        hiddenLoadedRef.current = true;
        setHiddenRows([...rows]);
      })
      .catch(() => {
        if (options?.silent) return;
        setHiddenError(HIDDEN_LOAD_FAILED_ERROR);
      })
      .finally(() => {
        hiddenLoadingRef.current = false;
        setHiddenLoading(false);
        if (queuedHiddenLoadRef.current) {
          queuedHiddenLoadRef.current = false;
          loadHidden();
        }
      });
  }

  /**
   * An authoritative refresh of BOTH lists after a write that changed which list
   * a horse belongs to. A load that is already in flight may have been issued
   * before that write, so its response cannot be trusted to include it: in that
   * case one follow-up is queued and runs as soon as the current one settles.
   * The board is never blanked and no page reload is involved.
   */
  function requestAuthoritativeRefresh() {
    if (loadingRef.current) queuedLoadRef.current = true;
    else load();

    if (!canManageVisibility || !fetchHiddenOverview) return;
    if (hiddenLoadingRef.current) queuedHiddenLoadRef.current = true;
    else loadHidden();
  }

  function toggleHiddenSection() {
    const next = !hiddenOpen;
    setHiddenOpen(next);
    // Lazy: nothing is fetched until a manager actually asks to see the list.
    if (next && hiddenRows === null) loadHidden();
  }

  function loadKnownValues() {
    if (!canEdit) return;
    getKnownHayTypes().then(setKnownHayTypes);
    getKnownConcentrateTypes().then(setKnownConcentrateTypes);
    getKnownConcentrateAmounts().then(setKnownConcentrateAmounts);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadKnownValues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  useEffect(() => {
    modalOpenRef.current = modalRow !== null;
  }, [modalRow]);

  // MULTI-DEVICE: the board is shared, so a tablet that was asleep while someone
  // else marked a horse would otherwise show a stale round. This refreshes ONCE
  // when the tab becomes visible again - no polling, no interval, no Realtime, no
  // page reload. It is skipped while the instruction modal is open (unsaved edits
  // must survive) and while a mark is in flight (a refetch would race it), and
  // the listener is removed on unmount.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return;
      if (modalOpenRef.current) return;
      if (savingRef.current.length > 0) return;
      // Stage 5B: a reset or a hide/restore in flight owns the lists until it
      // settles - a refetch here could land either side of it.
      if (clearingRef.current) return;
      if (visibilityBusyRef.current !== null) return;
      load({ silent: true });
      loadHidden({ silent: true });
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Applies a progress change to exactly one row; every other row is returned
  // untouched, and no meal/attendance/student field is ever rewritten here.
  function patchProgress(
    horseName: string,
    patch: Pick<
      HorseFeedingOverviewRow,
      "progressState" | "displayProgressState" | "isDisplayStateNormalized" | "progress"
    >
  ) {
    setRows((prev) =>
      prev
        ? prev.map((row) => (row.horseName === horseName ? { ...row, ...patch } : row))
        : prev
    );
  }

  function handleMarkProgress(row: HorseFeedingOverviewRow, targetState: FeedingProgressState) {
    if (!canMarkProgress || !onMarkProgress) return;
    // One write per horse at a time. Another horse may still be marked in
    // parallel - a feeding round is worked through quickly on a tablet.
    if (savingRef.current.includes(row.horseName)) return;

    const horseName = row.horseName;
    // Captured BEFORE dispatch, so a clear that succeeds while this request is
    // in flight makes every branch below stale.
    const startedGeneration = clearGenerationRef.current;
    const startedHorseGeneration = horseMarkGeneration(row.horseName);
    const snapshot = {
      progressState: row.progressState,
      displayProgressState: row.displayProgressState,
      isDisplayStateNormalized: row.isDisplayStateNormalized,
      progress: row.progress,
    };

    setProgressError(null);
    setClearMessage(null);
    beginSaving(horseName);
    // OPTIMISTIC. The control only ever offers states that are valid for THIS
    // row's mode, so the target is directly displayable and no display-state
    // normalisation is re-derived here (that rule stays in the pure core).
    patchProgress(horseName, {
      progressState: targetState,
      displayProgressState: targetState,
      isDisplayStateNormalized: false,
      // Resetting one horse drops its audit immediately, so "לא סומן" is never
      // shown above a line still claiming who fed it. Any other target keeps the
      // existing stamps until the server's authoritative ones arrive - guessing
      // an actor or a time here would be fabricating audit data.
      progress: targetState === "PENDING" ? null : snapshot.progress,
    });

    void (async () => {
      try {
        const result = await onMarkProgress({ horseName, targetState });
        // STALE-RESULT GUARD (success AND denial). The board was cleared while
        // this request was in flight, so neither the authoritative row nor the
        // rollback snapshot describes the current round any more: both would
        // re-display a pre-clear mark. Discard SILENTLY - no patch, no banner -
        // and leave the post-clear PENDING the board already shows. The write
        // itself is not undone; only its outdated local effect is dropped.
        if (
          !shouldApplyFeedingMarkResult({
            startedGeneration,
            currentGeneration: clearGenerationRef.current,
          })
        ) {
          return;
        }
        // Same rule, scoped to this horse: it was hidden (progress cleared
        // server-side) or restored while the request was in flight, so this
        // result describes a round it is no longer part of. Discarded silently.
        if (
          !shouldApplyFeedingMarkResult({
            startedGeneration: startedHorseGeneration,
            currentGeneration: horseMarkGeneration(horseName),
          })
        ) {
          return;
        }
        if (!result.success) {
          patchProgress(horseName, snapshot);
          setProgressError(result.error ?? MARK_FAILED_ERROR);
          return;
        }
        // AUTHORITATIVE: the saved row replaces the optimistic guess, including
        // the audit stamps the server derived. `progress: null` means PENDING.
        const saved = result.progress ?? null;
        patchProgress(horseName, {
          progressState: saved ? saved.state : "PENDING",
          displayProgressState: saved ? saved.state : "PENDING",
          isDisplayStateNormalized: false,
          progress: saved
            ? {
                hayMarkedAt: saved.hayMarkedAt,
                hayMarkedByName: saved.hayMarkedByName,
                concentrateMarkedAt: saved.concentrateMarkedAt,
                concentrateMarkedByName: saved.concentrateMarkedByName,
              }
            : null,
        });
      } catch {
        // Same guard on the thrown path: rolling back to the snapshot after a
        // clear would restore a pre-clear mark, and a failure banner for a
        // request the board has already superseded is noise.
        if (
          !shouldApplyFeedingMarkResult({
            startedGeneration,
            currentGeneration: clearGenerationRef.current,
          })
        ) {
          return;
        }
        // Same rule, scoped to this horse: it was hidden (progress cleared
        // server-side) or restored while the request was in flight, so this
        // result describes a round it is no longer part of. Discarded silently.
        if (
          !shouldApplyFeedingMarkResult({
            startedGeneration: startedHorseGeneration,
            currentGeneration: horseMarkGeneration(horseName),
          })
        ) {
          return;
        }
        // Deliberately swallows the exception VALUE - only the stable text.
        patchProgress(horseName, snapshot);
        setProgressError(MARK_FAILED_ERROR);
      } finally {
        // ALWAYS released, including on a discarded stale result, so the
        // per-horse lock can never outlive its request.
        endSaving(horseName);
      }
    })();
  }

  function handleClearAllProgress() {
    if (!canClearProgress || !onClearAllProgress) return;
    if (clearingRef.current) return;
    // HARDENING (not the safety net): refuse to start a reset while a mark is
    // still saving, so the common case never even creates a stale request. The
    // dialog closes so the notice is actually visible behind it.
    if (savingRef.current.length > 0) {
      setClearOpen(false);
      setProgressError(CLEAR_BLOCKED_BY_MARK_ERROR);
      return;
    }
    clearingRef.current = true;
    setIsClearing(true);
    setProgressError(null);
    setClearMessage(null);

    void (async () => {
      try {
        const result = await onClearAllProgress();
        if (!result.success) {
          setProgressError(result.error ?? CLEAR_FAILED_ERROR);
          return;
        }
        // EPOCH BUMP FIRST, in the same synchronous step as the reset: every
        // mark that started before this point is now stale and will be
        // discarded when it resolves. A mark started after it carries the new
        // generation and behaves normally.
        clearGenerationRef.current += 1;
        // Only the four progress fields are reset - meal instructions, the
        // responsible student and the attendance fields are carried through.
        setRows((prev) =>
          prev
            ? prev.map(
                (row): HorseFeedingOverviewRow => ({
                  ...row,
                  progressState: "PENDING",
                  displayProgressState: "PENDING",
                  isDisplayStateNormalized: false,
                  progress: null,
                })
              )
            : prev
        );
        setClearMessage(
          typeof result.clearedCount === "number"
            ? `הסימונים נוקו (${result.clearedCount} סוסים). הלוח מוכן לסבב ההאכלה הבא.`
            : "הסימונים נוקו. הלוח מוכן לסבב ההאכלה הבא."
        );
      } catch {
        setProgressError(CLEAR_FAILED_ERROR);
      } finally {
        clearingRef.current = false;
        setIsClearing(false);
        setClearOpen(false);
      }
    })();
  }

  // --- Stage 5B: hide / restore -------------------------------------------
  // Both flows stage a target row and confirm through the shared ConfirmModal;
  // opening a dialog writes nothing, and cancelling writes nothing.

  function requestHideHorse(row: HorseFeedingOverviewRow) {
    if (!canHideHorses) return;
    setVisibilityError(null);
    setVisibilityMessage(null);
    setHideTarget(row);
  }

  function requestRestoreHorse(row: HorseFeedingOverviewRow) {
    if (!canHideHorses) return;
    setVisibilityError(null);
    setVisibilityMessage(null);
    setRestoreTarget(row);
  }

  function handleConfirmHideHorse() {
    if (!canManageVisibility || !onSetVisibility) return;
    const target = hideTarget;
    if (!target) return;
    // ONE visibility write at a time, synchronously guarded: a second confirm in
    // the same tick cannot queue a duplicate, and hide/restore cannot interleave.
    if (visibilityBusyRef.current !== null) return;
    // Never hide a horse whose mark is still being saved, and never during a
    // reset - both would settle against a board this write is about to change.
    if (savingRef.current.includes(target.horseName)) {
      setHideTarget(null);
      setVisibilityError(HIDE_BLOCKED_BY_MARK_ERROR);
      return;
    }
    if (clearingRef.current) {
      setHideTarget(null);
      setVisibilityError(HIDE_BLOCKED_BY_CLEAR_ERROR);
      return;
    }

    const horseName = target.horseName;
    visibilityBusyRef.current = horseName;
    setVisibilityBusyHorse(horseName);
    setVisibilityError(null);
    setVisibilityMessage(null);

    void (async () => {
      try {
        const result = await onSetVisibility({ horseName, isHidden: true });
        if (!result.success) {
          // Neither list is touched on a denial.
          setVisibilityError(result.error ?? HIDE_FAILED_ERROR);
          return;
        }
        // The server removed this horse's round progress in the same
        // transaction, so any mark still in flight for it is now stale.
        invalidateHorseMarks(horseName);
        setRows((prev) => (prev ? prev.filter((row) => row.horseName !== horseName) : prev));
        // Only when the hidden list has actually been loaded - otherwise the
        // first real fetch is the authoritative source and nothing is guessed.
        setHiddenRows((prev) => (prev === null ? prev : upsertHiddenBoardRow(prev, target)));
        setVisibilityMessage(`${horseName} הוסתר מרשימת ההאכלה. הוראות ההאכלה נשמרו.`);
      } catch {
        setVisibilityError(HIDE_FAILED_ERROR);
      } finally {
        visibilityBusyRef.current = null;
        setVisibilityBusyHorse(null);
        setHideTarget(null);
      }
    })();
  }

  function handleConfirmRestoreHorse() {
    if (!canManageVisibility || !onSetVisibility) return;
    const target = restoreTarget;
    if (!target) return;
    if (visibilityBusyRef.current !== null) return;

    const horseName = target.horseName;
    visibilityBusyRef.current = horseName;
    setVisibilityBusyHorse(horseName);
    setVisibilityError(null);
    setVisibilityMessage(null);

    void (async () => {
      try {
        const result = await onSetVisibility({ horseName, isHidden: false });
        if (!result.success) {
          setVisibilityError(result.error ?? RESTORE_FAILED_ERROR);
          return;
        }
        invalidateHorseMarks(horseName);
        setHiddenRows((prev) =>
          prev === null ? prev : prev.filter((row) => row.horseName !== horseName)
        );
        // AUTHORITATIVE REFETCH of both lists rather than reconstruction: the
        // attendance, responsible-student and ordering fields belong to the
        // reader, and a restored horse must come back exactly as the server
        // composes it (with no progress row, hence PENDING). Queued if a load is
        // already running, so it can never be dropped.
        requestAuthoritativeRefresh();
        setVisibilityMessage(`${horseName} הוחזר לרשימת ההאכלה.`);
      } catch {
        setVisibilityError(RESTORE_FAILED_ERROR);
      } finally {
        visibilityBusyRef.current = null;
        setVisibilityBusyHorse(null);
        setRestoreTarget(null);
      }
    })();
  }

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.horseName.toLowerCase().includes(q));
  }, [rows, search]);

  function openEdit(row: HorseFeedingOverviewRow) {
    setError(null);
    setModalRow(row);
    setHorseName(row.horseName);
    setMorning(mealToForm(row.morning));
    setEvening(mealToForm(row.evening));
    setHasLunch(row.lunch !== null);
    setLunch(mealToForm(row.lunch));

    const morningType = row.morning?.concentrateType ?? "";
    const eveningType = row.evening?.concentrateType ?? "";
    const morningAmount = row.morning?.concentrateAmount ?? "";
    const eveningAmount = row.evening?.concentrateAmount ?? "";
    if (morningType === eveningType && morningAmount === eveningAmount) {
      setConcentrateMode("shared");
      setSharedConcentrateType(morningType);
      setSharedConcentrateAmount(morningAmount);
    } else {
      // Existing morning/evening concentrate type/amount differ - never
      // silently merge them, show both separately until someone explicitly
      // chooses to share.
      setConcentrateMode("separate");
      setSharedConcentrateType("");
      setSharedConcentrateAmount("");
    }
  }

  function openNew() {
    setError(null);
    setModalRow("new");
    setHorseName("");
    setMorning(EMPTY_MEAL);
    setEvening(EMPTY_MEAL);
    setHasLunch(false);
    setLunch(EMPTY_MEAL);
    setConcentrateMode("shared");
    setSharedConcentrateType("");
    setSharedConcentrateAmount("");
  }

  function toggleConcentrateMode() {
    if (concentrateMode === "shared") {
      setMorning((v) => ({ ...v, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }));
      setEvening((v) => ({ ...v, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }));
      setConcentrateMode("separate");
    } else {
      setSharedConcentrateType(morning.concentrateType);
      setSharedConcentrateAmount(morning.concentrateAmount);
      setConcentrateMode("shared");
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const morningToSave =
      concentrateMode === "shared"
        ? { ...morning, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }
        : morning;
    const eveningToSave =
      concentrateMode === "shared"
        ? { ...evening, concentrateType: sharedConcentrateType, concentrateAmount: sharedConcentrateAmount }
        : evening;
    startTransition(async () => {
      const result = await onSave({
        horseName,
        morning: morningToSave,
        evening: eveningToSave,
        hasLunch,
        lunch,
      });
      if (!result.success) {
        setError(result.error ?? "אירעה שגיאה");
        return;
      }
      setModalRow(null);
      load();
      // A newly-typed hay/concentrate type only becomes a suggestion for the
      // *next* horse once this refetches - without it, knownHayTypes stayed
      // frozen at whatever existed when the section first mounted.
      loadKnownValues();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!canEdit && (
        <p className="text-xs text-muted-foreground">תצוגה בלבד - אין הרשאת עריכת האכלות</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="חיפוש לפי שם סוס..."
          className="flex-1 rounded-lg border border-border px-3 py-2 text-sm"
        />
        {canEdit && (
          <Button onClick={openNew} className="!px-3 !py-2 !text-sm">
            + הוספת סוס
          </Button>
        )}
        {canClearProgress && onClearAllProgress && (
          // Secondary and last on the row: resetting the whole board is a
          // deliberate end-of-round action, never the default one. It is also
          // unavailable while a mark is saving - with the reason stated, so a
          // disabled button is never unexplained.
          <>
            <Button
              variant="secondary"
              className="!px-3 !py-2 !text-sm"
              disabled={isClearing || savingHorses.length > 0}
              onClick={() => {
                setProgressError(null);
                setClearMessage(null);
                setClearOpen(true);
              }}
            >
              {CLEAR_ALL_LABEL}
            </Button>
            {savingHorses.length > 0 && (
              <span className="text-xs text-muted-foreground">{CLEAR_BLOCKED_BY_MARK_ERROR}</span>
            )}
          </>
        )}
      </div>

      {loadError && <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>}
      {progressError && (
        <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{progressError}</p>
      )}
      {clearMessage && (
        <p className="rounded-lg bg-success-muted p-3 text-sm text-success">{clearMessage}</p>
      )}
      {visibilityError && (
        <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{visibilityError}</p>
      )}
      {visibilityMessage && (
        <p className="rounded-lg bg-success-muted p-3 text-sm text-success">{visibilityMessage}</p>
      )}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">טוען...</p>
      ) : filteredRows.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {rows.length === 0 ? "עדיין לא הוזנו הוראות האכלה" : "אין סוסים התואמים את החיפוש"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filteredRows.map((row) => (
            <div
              key={row.horseName}
              // The card follows the CURRENT round and nothing else: neutral
              // while nothing is marked, amber once hay is done, green once the
              // horse is complete. Presentation only - the card gains no click
              // target and no role.
              className={`rounded-xl border-2 p-3 ${resolveHorseFeedingCardStateClass(row.displayProgressState)}`}
            >
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <p className="text-base font-bold text-card-foreground">{row.horseName}</p>
                <div className="flex flex-wrap items-center gap-1">
                  {canEdit && (
                    <Button
                      variant="ghost"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => openEdit(row)}
                    >
                      עריכה
                    </Button>
                  )}
                  {canHideHorses && (
                    // Manager-only, worded as REMOVAL FROM A LIST and never as
                    // deletion: no trash glyph, no icon-only affordance, and the
                    // full sentence is the accessible name.
                    <Button
                      variant="secondary"
                      className="min-h-11 !px-3 !py-2 !text-xs"
                      aria-label={`${HIDE_ACTION_LABEL} - ${row.horseName}`}
                      disabled={visibilityBusyHorse !== null}
                      onClick={() => requestHideHorse(row)}
                    >
                      {HIDE_ACTION_LABEL}
                    </Button>
                  )}
                </div>
              </div>

              {row.responsibleStudent && (
                <p className="mb-1 text-xs text-muted-foreground">
                  חניך/ה אחראי/ת: {row.responsibleStudent.fullName}
                  {row.responsibleStudent.groupName ? ` · קבוצה ${row.responsibleStudent.groupName}` : ""}
                  {row.responsibleStudent.subgroupNumber != null
                    ? ` / תת-קבוצה ${row.responsibleStudent.subgroupNumber}`
                    : ""}
                </p>
              )}

              {row.attendanceStatus === "ABSENT" && (
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.ABSENT}`}
                >
                  נעדר/ת היום
                </span>
              )}
              {row.attendanceStatus === "PARTIAL" && (
                <span
                  className={`mb-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS.PARTIAL}`}
                >
                  נוכחות חלקית
                  {(row.attendanceArrivalTime || row.attendanceDepartureTime) && (
                    <>
                      {" "}
                      · {row.attendanceArrivalTime && `הגעה: ${row.attendanceArrivalTime}`}
                      {row.attendanceArrivalTime && row.attendanceDepartureTime && " · "}
                      {row.attendanceDepartureTime && `יציאה: ${row.attendanceDepartureTime}`}
                    </>
                  )}
                </span>
              )}
              {row.attendanceNotes && (
                <p className="mb-1 text-xs text-card-foreground">הערת נוכחות: {row.attendanceNotes}</p>
              )}

              <div className="flex flex-col gap-1 rounded-lg bg-card p-2">
                <MealSummaryLine label="בוקר" meal={row.morning} />
                {row.lunch && <MealSummaryLine label="צהריים" meal={row.lunch} />}
                <MealSummaryLine label="ערב" meal={row.evening} />
              </div>

              <div className="mt-2 flex flex-col gap-1">
                <HorseFeedingStatusControl
                  horseName={row.horseName}
                  statusControlMode={row.statusControlMode}
                  displayProgressState={row.displayProgressState}
                  disabled={!canMarkProgress || !onMarkProgress || visibilityBusyHorse === row.horseName}
                  isSaving={savingHorses.includes(row.horseName)}
                  onChange={(targetState) => handleMarkProgress(row, targetState)}
                />
                {row.progress && (
                  <MarkAuditLines
                    hay={markSummary(row.progress.hayMarkedByName, row.progress.hayMarkedAt)}
                    concentrate={markSummary(
                      row.progress.concentrateMarkedByName,
                      row.progress.concentrateMarkedAt
                    )}
                  />
                )}
              </div>

              {(row.updatedByName || row.updatedAt) && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {row.updatedByName && `עודכן על ידי: ${row.updatedByName}`}
                  {row.updatedByName && row.updatedAt && " · "}
                  {row.updatedAt && `עודכן בתאריך: ${formatHebrewDateTime(new Date(row.updatedAt))}`}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {canBrowseHiddenHorses && (
        // A separate manager tool BELOW the operational board - never merged
        // into it, and rendered only when both manager props were supplied.
        <HorseFeedingVisibilityManager
          isOpen={hiddenOpen}
          onToggle={toggleHiddenSection}
          rows={hiddenRows}
          isLoading={hiddenLoading}
          loadError={hiddenError}
          search={hiddenSearch}
          onSearchChange={setHiddenSearch}
          restoringHorseName={visibilityBusyHorse}
          onRestore={requestRestoreHorse}
        />
      )}

      {canEdit && (
        <Modal
          size="wide"
          open={modalRow !== null}
          title={modalRow === "new" ? "הוספת סוס - האכלה" : `עריכת האכלה - ${horseName}`}
          onClose={() => setModalRow(null)}
        >
          <form
            onSubmit={handleSubmit}
            className="flex max-h-[70vh] max-w-full min-w-0 flex-col gap-3 overflow-y-auto overflow-x-hidden ps-1"
          >
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              שם הסוס
              <input
                value={horseName}
                onChange={(e) => setHorseName(e.target.value)}
                disabled={modalRow !== "new"}
                required
                className="w-full rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-60"
              />
            </label>

            <HayFields
              title="חציר - בוקר"
              hayType={morning.hayType}
              notes={morning.notes}
              onHayTypeChange={(v) => setMorning((m) => ({ ...m, hayType: v }))}
              onNotesChange={(v) => setMorning((m) => ({ ...m, notes: v }))}
              knownHayTypes={knownHayTypes}
            />
            <HayFields
              title="חציר - ערב"
              hayType={evening.hayType}
              notes={evening.notes}
              onHayTypeChange={(v) => setEvening((m) => ({ ...m, hayType: v }))}
              onNotesChange={(v) => setEvening((m) => ({ ...m, notes: v }))}
              knownHayTypes={knownHayTypes}
            />

            <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm font-semibold text-card-foreground">מזון מרוכז - בוקר וערב</p>
                <button
                  type="button"
                  onClick={toggleConcentrateMode}
                  className="shrink-0 text-xs text-muted-foreground underline decoration-dotted"
                >
                  {concentrateMode === "shared" ? "הגדרת ערכים נפרדים לבוקר ולערב" : "מיזוג לערך משותף"}
                </button>
              </div>
              {concentrateMode === "shared" ? (
                <ConcentrateFields
                  concentrateType={sharedConcentrateType}
                  concentrateAmount={sharedConcentrateAmount}
                  onTypeChange={setSharedConcentrateType}
                  onAmountChange={setSharedConcentrateAmount}
                  knownConcentrateTypes={knownConcentrateTypes}
                  knownConcentrateAmounts={knownConcentrateAmounts}
                />
              ) : (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    הערכים לבוקר ולערב שונים כרגע - ניתן לערוך כל אחד בנפרד.
                  </p>
                  <div className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
                    <ConcentrateFields
                      title="בוקר"
                      concentrateType={morning.concentrateType}
                      concentrateAmount={morning.concentrateAmount}
                      onTypeChange={(v) => setMorning((m) => ({ ...m, concentrateType: v }))}
                      onAmountChange={(v) => setMorning((m) => ({ ...m, concentrateAmount: v }))}
                      knownConcentrateTypes={knownConcentrateTypes}
                      knownConcentrateAmounts={knownConcentrateAmounts}
                    />
                    <ConcentrateFields
                      title="ערב"
                      concentrateType={evening.concentrateType}
                      concentrateAmount={evening.concentrateAmount}
                      onTypeChange={(v) => setEvening((m) => ({ ...m, concentrateType: v }))}
                      onAmountChange={(v) => setEvening((m) => ({ ...m, concentrateAmount: v }))}
                      knownConcentrateTypes={knownConcentrateTypes}
                      knownConcentrateAmounts={knownConcentrateAmounts}
                    />
                  </div>
                </>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-card-foreground">
              <input
                type="checkbox"
                checked={hasLunch}
                onChange={(e) => setHasLunch(e.target.checked)}
              />
              יש ארוחת צהריים
            </label>
            {hasLunch && (
              <MealFormFields
                title="צהריים"
                value={lunch}
                onChange={setLunch}
                knownHayTypes={knownHayTypes}
                knownConcentrateTypes={knownConcentrateTypes}
                knownConcentrateAmounts={knownConcentrateAmounts}
              />
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setModalRow(null)}>
                ביטול
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "שומר..." : "שמירה"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {canClearProgress && onClearAllProgress && (
        // A real modal, never window.confirm: cancel is the secondary action and
        // is also what the ✕ and the backdrop resolve to, and `isPending`
        // disables confirming while the reset is in flight.
        <ConfirmModal
          open={clearOpen}
          title={CLEAR_CONFIRM_TITLE}
          message={CLEAR_CONFIRM_BODY}
          confirmLabel={CLEAR_ALL_LABEL}
          cancelLabel="ביטול"
          isPending={isClearing}
          onConfirm={handleClearAllProgress}
          onCancel={() => {
            if (isClearing) return;
            setClearOpen(false);
          }}
        />
      )}

      {canHideHorses && (
        // HIDE confirmation. The body states that instructions are kept and that
        // the horse can be brought back, and a horse a trainee is responsible for
        // adds a warning line naming them.
        <ConfirmModal
          open={hideTarget !== null}
          title={HIDE_CONFIRM_TITLE}
          message={hideTarget ? buildHideConfirmMessage(hideTarget) : ""}
          confirmLabel={HIDE_CONFIRM_BUTTON}
          cancelLabel="ביטול"
          isPending={visibilityBusyHorse !== null}
          onConfirm={handleConfirmHideHorse}
          onCancel={() => {
            if (visibilityBusyHorse !== null) return;
            setHideTarget(null);
          }}
        />
      )}

      {canHideHorses && (
        // RESTORE confirmation - lighter wording, but still an explicit,
        // deliberate second action rather than a one-tap change.
        <ConfirmModal
          open={restoreTarget !== null}
          title={RESTORE_CONFIRM_TITLE}
          message={
            restoreTarget
              ? `${RESTORE_CONFIRM_BODY}\n\n${restoreTarget.horseName}`
              : RESTORE_CONFIRM_BODY
          }
          confirmLabel={RESTORE_CONFIRM_BUTTON}
          cancelLabel="ביטול"
          isPending={visibilityBusyHorse !== null}
          onConfirm={handleConfirmRestoreHorse}
          onCancel={() => {
            if (visibilityBusyHorse !== null) return;
            setRestoreTarget(null);
          }}
        />
      )}
    </div>
  );
}

// The per-step audit of the CURRENT round, shown only when something was
// actually recorded. Times are device-local and short; no ISO string, no id, no
// invented value.
function MarkAuditLines({ hay, concentrate }: { hay: string | null; concentrate: string | null }) {
  if (!hay && !concentrate) return null;
  return (
    <div className="text-[11px] text-muted-foreground">
      {hay && <p>חציר: {hay}</p>}
      {concentrate && <p>מזון מרוכז: {concentrate}</p>}
    </div>
  );
}

// Hay + general notes for one main meal (morning/evening). Concentrate feed
// lives in its own shared/separate section below, not inside this block.
function HayFields({
  title,
  hayType,
  notes,
  onHayTypeChange,
  onNotesChange,
  knownHayTypes,
}: {
  title: string;
  hayType: string;
  notes: string;
  onHayTypeChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  knownHayTypes: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
      <p className="text-sm font-semibold text-card-foreground">{title}</p>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        חציר
        <SuggestInput
          value={hayType}
          onChange={onHayTypeChange}
          suggestions={knownHayTypes}
          placeholder="לדוגמה: ערב-דגן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        הערות (אופציונלי)
        <input
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}

// Concentrate feed type + amount, used either once (shared mode) or twice
// (separate mode, with a title per meal). Both fields stay optional free
// text - concentrateType never a closed list, concentrateAmount never numeric.
function ConcentrateFields({
  title,
  concentrateType,
  concentrateAmount,
  onTypeChange,
  onAmountChange,
  knownConcentrateTypes,
  knownConcentrateAmounts,
}: {
  title?: string;
  concentrateType: string;
  concentrateAmount: string;
  onTypeChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  knownConcentrateTypes: string[];
  knownConcentrateAmounts: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title && <p className="text-xs font-semibold text-card-foreground">{title}</p>}
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        סוג/הערות מזון מרוכז (אופציונלי)
        <SuggestInput value={concentrateType} onChange={onTypeChange} suggestions={knownConcentrateTypes} />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        כמות מזון מרוכז (אופציונלי, טקסט חופשי)
        <SuggestInput
          value={concentrateAmount}
          onChange={onAmountChange}
          suggestions={knownConcentrateAmounts}
          placeholder="לדוגמה: 1/4, חופן"
        />
      </label>
    </div>
  );
}

// Only used for lunch now - the one optional extra meal that always keeps
// its own independent hay + concentrate fields together, since it may
// differ from the main meals on purpose.
function MealFormFields({
  title,
  value,
  onChange,
  knownHayTypes,
  knownConcentrateTypes,
  knownConcentrateAmounts,
}: {
  title: string;
  value: MealFormState;
  onChange: (value: MealFormState) => void;
  knownHayTypes: string[];
  knownConcentrateTypes: string[];
  knownConcentrateAmounts: string[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
      <p className="text-sm font-semibold text-card-foreground">{title}</p>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        חציר
        <SuggestInput
          value={value.hayType}
          onChange={(v) => onChange({ ...value, hayType: v })}
          suggestions={knownHayTypes}
          placeholder="לדוגמה: ערב-דגן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        סוג/הערות מזון מרוכז (אופציונלי)
        <SuggestInput
          value={value.concentrateType}
          onChange={(v) => onChange({ ...value, concentrateType: v })}
          suggestions={knownConcentrateTypes}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        כמות מזון מרוכז (אופציונלי, טקסט חופשי)
        <SuggestInput
          value={value.concentrateAmount}
          onChange={(v) => onChange({ ...value, concentrateAmount: v })}
          suggestions={knownConcentrateAmounts}
          placeholder="לדוגמה: 1/4, חופן"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        הערות (אופציונלי)
        <input
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      </label>
    </div>
  );
}
