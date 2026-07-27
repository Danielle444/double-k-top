"use client";

/**
 * FEEDING-BOARD Stage 5B - the MANAGER-ONLY hidden-horses surface, plus the pure
 * vocabulary and list algebra the hide/restore flow shares with the board.
 *
 * PRESENTATIONAL ONLY. It calls no Server Action, performs no IO, holds no state
 * and knows nothing about permissions: the board owns every write and the Stage 4
 * Server Actions (setHorseFeedingVisibilityAsAdmin / getHiddenHorseFeedingRowsForAdmin,
 * both `await requireAdmin()` first) remain the real authorization boundary. This
 * component is only ever rendered by a host that was handed the manager props, and
 * rendering it would still not let anyone hide anything.
 *
 * HIDING IS NOT DELETION, and the wording never suggests otherwise: no trash
 * glyph, no "מחיקה"/"מחק" anywhere, and the confirmation says in as many words
 * that the feeding instructions are kept and the horse can be brought back.
 * HorseFeedingMeal rows are untouched by the whole flow.
 *
 * NO PROGRESS SURFACE. A hidden horse is not part of the operational round, so
 * this list renders no status control, no round audit and no mark affordance -
 * only what a manager needs to recognise the horse and put it back.
 *
 * The pure helpers below are exported so the parts that are easy to get subtly
 * wrong - the PENDING reset a hidden row must show, the replace-don't-duplicate
 * rule and the Hebrew ordering - are unit-testable without a DOM.
 */
import { Button } from "@/lib/components/Button";
import type { HorseFeedingOverviewRow } from "@/lib/actions/horse-feeding";

// --- vocabulary (owned here so board and list can never drift apart) --------

export const HIDE_ACTION_LABEL = "הסתר מרשימת ההאכלה";
export const HIDE_CONFIRM_TITLE = "הסתרת סוס מרשימת ההאכלה";
export const HIDE_CONFIRM_BODY =
  "הסוס יוסר מרשימת ההאכלה שמוצגת למדריכים.\n" +
  "הוראות ההאכלה שלו יישמרו וניתן יהיה להחזיר אותו לרשימה.";
export const HIDE_CONFIRM_BUTTON = "הסתר מהרשימה";

export const RESTORE_ACTION_LABEL = "החזר לרשימת ההאכלה";
export const RESTORE_CONFIRM_TITLE = "החזרת סוס לרשימת ההאכלה";
export const RESTORE_CONFIRM_BODY =
  "הסוס יוצג שוב ברשימת ההאכלה של המדריכים, ללא סימוני האכלה מהסבב הקודם.";
export const RESTORE_CONFIRM_BUTTON = "החזר לרשימה";

export const HIDDEN_SECTION_TITLE = "סוסים מוסתרים";

/**
 * The confirmation text for hiding one horse. A horse that a trainee is
 * currently responsible for gets an extra WARNING line naming that trainee,
 * because removing it from the board changes what that trainee's instructor
 * sees. Nothing beyond the display name is surfaced - no id, no group, no
 * contact detail. PURE.
 */
export function buildHideConfirmMessage(row: {
  responsibleStudent: { fullName: string } | null;
}): string {
  if (!row.responsibleStudent) return HIDE_CONFIRM_BODY;
  return `${HIDE_CONFIRM_BODY}\n\nהסוס משויך כרגע לחניך/ה: ${row.responsibleStudent.fullName}`;
}

/**
 * A COMPACT identification summary - deliberately not the operational card. A
 * manager scanning the hidden list needs to recognise which horse this is, so
 * only meals that actually carry content produce a line, and an entirely
 * content-free horse produces none rather than a row of empty labels. PURE.
 */
export function summarizeFeedingInstructions(row: {
  morning: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null } | null;
  lunch: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null } | null;
  evening: { hayType: string | null; concentrateType: string | null; concentrateAmount: string | null } | null;
}): string[] {
  const meals = [
    ["בוקר", row.morning],
    ["צהריים", row.lunch],
    ["ערב", row.evening],
  ] as const;

  const lines: string[] = [];
  for (const [label, meal] of meals) {
    if (!meal) continue;
    const parts: string[] = [];
    if (meal.hayType) parts.push(`חציר: ${meal.hayType}`);
    if (meal.concentrateType) parts.push(`סוג מזון מרוכז: ${meal.concentrateType}`);
    if (meal.concentrateAmount) parts.push(`כמות מזון מרוכז: ${meal.concentrateAmount}`);
    if (parts.length > 0) lines.push(`${label}: ${parts.join(" · ")}`);
  }
  return lines;
}

/** The existing Hebrew ordering, with a deterministic code-unit tiebreak. */
export function compareHorseNamesHe(a: string, b: string): number {
  const collated = a.localeCompare(b, "he");
  if (collated !== 0) return collated;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The row a just-hidden horse becomes in the hidden list.
 *
 * Hiding CLEARS that horse's round progress in the same server transaction, so
 * the local row must show PENDING with no audit - carrying the pre-hide mark
 * across would display a completion the database no longer holds. Everything
 * else (meals, responsible student, attendance, authorship) is preserved
 * verbatim; nothing is invented. PURE, and it never mutates its input.
 */
export function toHiddenBoardRow(row: HorseFeedingOverviewRow): HorseFeedingOverviewRow {
  return {
    ...row,
    isHidden: true,
    progress: null,
    progressState: "PENDING",
    displayProgressState: "PENDING",
    isDisplayStateNormalized: false,
  };
}

/**
 * Put a newly hidden horse into the hidden list: REPLACE any entry with the same
 * name rather than appending a duplicate (a horse hidden, restored and hidden
 * again must still occupy exactly one row), then re-sort by the board's Hebrew
 * ordering. PURE - a new array is returned and the input is left untouched.
 */
export function upsertHiddenBoardRow(
  rows: readonly HorseFeedingOverviewRow[],
  row: HorseFeedingOverviewRow,
): HorseFeedingOverviewRow[] {
  const next = rows.filter((existing) => existing.horseName !== row.horseName);
  next.push(toHiddenBoardRow(row));
  next.sort((a, b) => compareHorseNamesHe(a.horseName, b.horseName));
  return next;
}

/** Name-only filtering, matching the active board's search rule exactly. */
export function filterHiddenBoardRows(
  rows: readonly HorseFeedingOverviewRow[],
  search: string,
): readonly HorseFeedingOverviewRow[] {
  const query = search.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter((row) => row.horseName.toLowerCase().includes(query));
}

const HIDDEN_SECTION_ID = "horse-feeding-hidden-section";

export interface HorseFeedingVisibilityManagerProps {
  isOpen: boolean;
  onToggle: () => void;
  /** null means "never loaded" - distinct from a loaded, empty list. */
  rows: readonly HorseFeedingOverviewRow[] | null;
  isLoading: boolean;
  loadError: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  /** The horse whose restore is in flight, if any. */
  restoringHorseName: string | null;
  onRestore: (row: HorseFeedingOverviewRow) => void;
}

export function HorseFeedingVisibilityManager({
  isOpen,
  onToggle,
  rows,
  isLoading,
  loadError,
  search,
  onSearchChange,
  restoringHorseName,
  onRestore,
}: HorseFeedingVisibilityManagerProps) {
  const visibleRows = rows === null ? null : filterHiddenBoardRows(rows, search);
  // A count is only shown once it is a fact - never guessed before the first load.
  const countLabel = rows === null ? "" : ` (${rows.length})`;

  return (
    <div className="mt-2 rounded-xl border border-dashed border-border p-3">
      {/* COLLAPSED BY DEFAULT: the manager tool must never compete with the
          operational board. A real button, so it is focusable and announced. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={HIDDEN_SECTION_ID}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-start text-sm font-semibold text-card-foreground hover:bg-muted"
      >
        <span>
          {HIDDEN_SECTION_TITLE}
          {countLabel}
        </span>
        <span aria-hidden="true">{isOpen ? "▲" : "▼"}</span>
      </button>

      <div id={HIDDEN_SECTION_ID} hidden={!isOpen}>
        {isOpen && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              סוסים אלה אינם מוצגים ברשימת ההאכלה של המדריכים. הוראות ההאכלה שלהם נשמרו.
            </p>

            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="חיפוש בסוסים המוסתרים..."
              aria-label="חיפוש בסוסים המוסתרים"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />

            {loadError && (
              <p className="rounded-lg bg-danger-muted p-3 text-sm text-danger">{loadError}</p>
            )}

            {isLoading && <p className="text-sm text-muted-foreground">טוען...</p>}

            {!isLoading && visibleRows !== null && visibleRows.length === 0 && (
              <p className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
                {rows !== null && rows.length === 0
                  ? "אין סוסים מוסתרים"
                  : "אין סוסים מוסתרים התואמים את החיפוש"}
              </p>
            )}

            {visibleRows !== null &&
              visibleRows.map((row) => {
                const isRestoring = restoringHorseName === row.horseName;
                const summary = summarizeFeedingInstructions(row);
                return (
                  <div key={row.horseName} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-card-foreground">{row.horseName}</p>
                      {/* Status as TEXT, never as colour alone. */}
                      <span className="text-[11px] text-muted-foreground">מוסתר מרשימת ההאכלה</span>
                    </div>

                    {row.responsibleStudent && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        חניך/ה אחראי/ת: {row.responsibleStudent.fullName}
                      </p>
                    )}

                    {summary.length > 0 ? (
                      <div className="mt-1 flex flex-col gap-0.5">
                        {summary.map((line) => (
                          <p key={line} className="text-xs text-muted-foreground">
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">אין פרטי האכלה</p>
                    )}

                    <Button
                      variant="secondary"
                      className="mt-2 min-h-11 !px-3 !py-2 !text-sm"
                      aria-label={`${RESTORE_ACTION_LABEL} - ${row.horseName}`}
                      disabled={restoringHorseName !== null}
                      onClick={() => onRestore(row)}
                    >
                      {isRestoring ? "מחזיר..." : RESTORE_ACTION_LABEL}
                    </Button>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}
