/**
 * FEEDING-BOARD Stage 5B - tests for the manager-only hidden-horses surface.
 *
 * These are REAL RENDER TESTS plus REAL UNIT TESTS, not source scans. The
 * component's only runtime import is the shared Button, and its row type arrives
 * through an erased `import type`, so it pulls in no Prisma, no next/*, and no
 * "use server" module and can be rendered with react-dom/server inside a plain
 * `tsx --test` process. The markup asserted below is the markup a browser
 * receives, and the list algebra asserted below is the code the board runs.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/HorseFeedingVisibilityManager.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HIDE_CONFIRM_BODY,
  HorseFeedingVisibilityManager,
  RESTORE_ACTION_LABEL,
  buildHideConfirmMessage,
  compareHorseNamesHe,
  filterHiddenBoardRows,
  summarizeFeedingInstructions,
  toHiddenBoardRow,
  upsertHiddenBoardRow,
} from "./HorseFeedingVisibilityManager";
import type { HorseFeedingOverviewRow } from "@/lib/actions/horse-feeding";

function makeRow(overrides: Partial<HorseFeedingOverviewRow> = {}): HorseFeedingOverviewRow {
  return {
    horseName: "רקיע",
    morning: { hayType: "שחת", concentrateType: null, concentrateAmount: null, notes: null },
    lunch: null,
    evening: { hayType: null, concentrateType: null, concentrateAmount: null, notes: null },
    updatedByName: "מנהלת",
    updatedAt: "2026-07-20T06:00:00.000Z",
    responsibleStudent: null,
    attendanceStatus: null,
    attendanceArrivalTime: null,
    attendanceDepartureTime: null,
    attendanceNotes: null,
    isHidden: false,
    hasHayContent: true,
    hasConcentrateContent: false,
    statusControlMode: "completeOnly",
    progress: {
      hayMarkedAt: "2026-07-20T05:30:00.000Z",
      hayMarkedByName: "דנה",
      concentrateMarkedAt: null,
      concentrateMarkedByName: null,
    },
    progressState: "COMPLETE",
    displayProgressState: "COMPLETE",
    isDisplayStateNormalized: false,
    statusOptions: [],
    ...overrides,
  };
}

function render(props: {
  isOpen?: boolean;
  rows?: readonly HorseFeedingOverviewRow[] | null;
  isLoading?: boolean;
  loadError?: string | null;
  search?: string;
  restoringHorseName?: string | null;
}): string {
  return renderToStaticMarkup(
    <HorseFeedingVisibilityManager
      isOpen={props.isOpen ?? false}
      onToggle={() => {
        throw new Error("onToggle must not fire during render");
      }}
      rows={props.rows === undefined ? null : props.rows}
      isLoading={props.isLoading ?? false}
      loadError={props.loadError ?? null}
      search={props.search ?? ""}
      onSearchChange={() => {
        throw new Error("onSearchChange must not fire during render");
      }}
      restoringHorseName={props.restoringHorseName ?? null}
      onRestore={() => {
        throw new Error("onRestore must not fire during render");
      }}
    />
  );
}

// ===========================================================================
// 60-63. THE PURE LIST ALGEBRA THE BOARD RUNS
// ===========================================================================

test("60. a hidden row always shows PENDING with no audit, and preserves everything else", () => {
  const active = makeRow({ horseName: "סופה" });
  const hidden = toHiddenBoardRow(active);

  // Hiding clears that horse's progress server-side, so carrying the pre-hide
  // mark across would display a completion the database no longer holds.
  assert.equal(hidden.progressState, "PENDING");
  assert.equal(hidden.displayProgressState, "PENDING");
  assert.equal(hidden.isDisplayStateNormalized, false);
  assert.equal(hidden.progress, null);
  assert.equal(hidden.isHidden, true);

  // Nothing else is rewritten, and nothing is invented.
  assert.equal(hidden.horseName, "סופה");
  assert.deepEqual(hidden.morning, active.morning);
  assert.deepEqual(hidden.evening, active.evening);
  assert.equal(hidden.updatedByName, active.updatedByName);
  assert.equal(hidden.responsibleStudent, active.responsibleStudent);

  // The input is untouched - the active list is not mutated by hiding.
  assert.equal(active.progressState, "COMPLETE");
  assert.notEqual(active.progress, null);
  assert.equal(active.isHidden, false);
});

test("61. upsert replaces an existing hidden entry and keeps the Hebrew ordering", () => {
  const existing = [makeRow({ horseName: "אביב" }), makeRow({ horseName: "רקיע" })].map(
    toHiddenBoardRow
  );

  const withNew = upsertHiddenBoardRow(existing, makeRow({ horseName: "גלים" }));
  assert.deepEqual(
    withNew.map((row) => row.horseName),
    ["אביב", "גלים", "רקיע"]
  );

  // A horse hidden, restored and hidden again must still occupy ONE row.
  const again = upsertHiddenBoardRow(withNew, makeRow({ horseName: "גלים", updatedByName: "אחר" }));
  assert.equal(again.filter((row) => row.horseName === "גלים").length, 1);
  assert.equal(again.find((row) => row.horseName === "גלים")?.updatedByName, "אחר");
  // ...and it is re-normalised to PENDING like any other newly hidden horse.
  assert.equal(again.find((row) => row.horseName === "גלים")?.progressState, "PENDING");

  // The input array is never mutated.
  assert.equal(existing.length, 2);
});

test("62. hidden search matches horse names only, case-insensitively", () => {
  const rows = [makeRow({ horseName: "Luna" }), makeRow({ horseName: "רקיע" })];

  assert.equal(filterHiddenBoardRows(rows, "").length, 2);
  assert.equal(filterHiddenBoardRows(rows, "   ").length, 2);
  assert.deepEqual(
    filterHiddenBoardRows(rows, "lun").map((row) => row.horseName),
    ["Luna"]
  );
  assert.deepEqual(
    filterHiddenBoardRows(rows, "רקי").map((row) => row.horseName),
    ["רקיע"]
  );
  assert.equal(filterHiddenBoardRows(rows, "שחת").length, 0, "meal content is not searched");
  assert.equal(compareHorseNamesHe("אביב", "אביב"), 0);
});

test("63. the confirmation explains that this is not deletion, and warns about a trainee", () => {
  const plain = buildHideConfirmMessage({ responsibleStudent: null });
  assert.equal(plain, HIDE_CONFIRM_BODY);
  assert.ok(plain.includes("הוראות ההאכלה שלו יישמרו וניתן יהיה להחזיר אותו לרשימה."));

  const withStudent = buildHideConfirmMessage({ responsibleStudent: { fullName: "נועה" } });
  assert.ok(withStudent.startsWith(HIDE_CONFIRM_BODY), "the base wording is never replaced");
  assert.ok(withStudent.includes("הסוס משויך כרגע לחניך/ה: נועה"));

  // Deletion wording is forbidden in every branch - hiding keeps the data.
  for (const message of [plain, withStudent]) {
    for (const forbidden of ["מחיקה", "למחוק", "יימחק", "🗑"]) {
      assert.ok(!message.includes(forbidden), `hiding must not read as deletion (${forbidden})`);
    }
  }
});

test("63b. the identification summary lists only meals that carry content", () => {
  assert.deepEqual(
    summarizeFeedingInstructions({
      morning: { hayType: "שחת", concentrateType: null, concentrateAmount: null },
      lunch: null,
      evening: { hayType: null, concentrateType: "שיבולת", concentrateAmount: "1/4" },
    }),
    ["בוקר: חציר: שחת", "ערב: סוג מזון מרוכז: שיבולת · כמות מזון מרוכז: 1/4"]
  );

  // A content-free horse produces no line rather than a row of empty labels.
  assert.deepEqual(
    summarizeFeedingInstructions({
      morning: { hayType: null, concentrateType: null, concentrateAmount: null },
      lunch: null,
      evening: null,
    }),
    []
  );
});

// ===========================================================================
// 64-69. THE RENDERED MANAGER SURFACE
// ===========================================================================

test("64. the section is COLLAPSED by default and announces that state", () => {
  const html = render({ isOpen: false, rows: [makeRow({ horseName: "רקיע" })] });

  assert.ok(html.includes('aria-expanded="false"'), "a real disclosure button, not a div");
  assert.ok(html.includes("סוסים מוסתרים"));
  // Collapsed means the rows are genuinely absent from the markup.
  assert.ok(!html.includes("רקיע"), "a collapsed section must not render its rows");
  assert.ok(!html.includes(RESTORE_ACTION_LABEL), "nor its restore actions");
});

test("65. expanding flips aria-expanded and reveals the rows", () => {
  const html = render({ isOpen: true, rows: [makeRow({ horseName: "רקיע" })] });

  assert.ok(html.includes('aria-expanded="true"'));
  assert.ok(html.includes("רקיע"));
  assert.ok(html.includes(RESTORE_ACTION_LABEL));
  // The count is a fact once loaded.
  assert.ok(html.includes("(1)"));
});

test("66. a hidden horse NEVER gets a progress control or a round audit", () => {
  const html = render({
    isOpen: true,
    rows: [
      makeRow({
        horseName: "רקיע",
        progress: {
          hayMarkedAt: "2026-07-20T05:30:00.000Z",
          hayMarkedByName: "דנה",
          concentrateMarkedAt: null,
          concentrateMarkedByName: null,
        },
      }),
    ],
  });

  for (const forbidden of [
    'role="radiogroup"',
    'role="radio"',
    "aria-checked",
    "לא סומן",
    "חציר הושלם",
    "חציר + מזון מרוכז",
    "הושלם",
    "דנה",
  ]) {
    assert.ok(!html.includes(forbidden), `a hidden horse must not expose ${forbidden}`);
  }
  // Instructions ARE shown read-only, so a manager can identify the horse.
  assert.ok(html.includes("חציר: שחת"));
});

test("67. loading, empty, search-empty and error states are all distinct", () => {
  assert.ok(render({ isOpen: true, isLoading: true }).includes("טוען..."));

  const empty = render({ isOpen: true, rows: [] });
  assert.ok(empty.includes("אין סוסים מוסתרים"));
  assert.ok(!empty.includes("התואמים את החיפוש"));

  const noMatch = render({ isOpen: true, rows: [makeRow({ horseName: "רקיע" })], search: "zzz" });
  assert.ok(noMatch.includes("אין סוסים מוסתרים התואמים את החיפוש"));

  const failed = render({ isOpen: true, loadError: "לא הצלחנו לטעון את רשימת הסוסים המוסתרים." });
  assert.ok(failed.includes("לא הצלחנו לטעון את רשימת הסוסים המוסתרים."));

  // Never loaded is not the same as loaded-and-empty.
  const never = render({ isOpen: true, rows: null });
  assert.ok(!never.includes("אין סוסים מוסתרים"), "an unloaded list must not claim to be empty");
  assert.ok(!never.includes("(0)"), "and must not show a count it does not have");
});

test("68. restore is an explicit, named, finger-sized action per horse", () => {
  const html = render({ isOpen: true, rows: [makeRow({ horseName: "רקיע" })] });
  const button = html
    .split("<button")
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("</button>")))
    .find((chunk) => chunk.includes(RESTORE_ACTION_LABEL));

  assert.ok(html.includes(`aria-label="${RESTORE_ACTION_LABEL} - רקיע"`), "the horse is named");
  assert.ok(button, "the restore button must be rendered");
  assert.ok(button.includes("min-h-11"), "adequate tap target");
  // Status is text, never colour alone.
  assert.ok(html.includes("מוסתר מרשימת ההאכלה"));
  // No icon-only or deletion-flavoured affordance anywhere.
  for (const forbidden of ["🗑", "מחיקה", "למחוק", "מחק"]) {
    assert.ok(!html.includes(forbidden), `${forbidden} must not appear in a visibility surface`);
  }
});

test("69. every restore is inert while one restore is already in flight", () => {
  const html = render({
    isOpen: true,
    rows: [makeRow({ horseName: "אביב" }), makeRow({ horseName: "רקיע" })],
    restoringHorseName: "אביב",
  });

  const buttons = html
    .split("<button")
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf("</button>")))
    .filter((chunk) => chunk.includes(RESTORE_ACTION_LABEL) || chunk.includes("מחזיר..."));

  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.ok(button.includes("disabled"), "no second restore may be dispatched");
  }
  assert.ok(html.includes("מחזיר..."), "the in-flight horse says so in text");
});
