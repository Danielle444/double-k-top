/**
 * FEEDING-BOARD Stage 2 - DB-free behavioural tests for the pure feeding board
 * composition core (lib/feeding/feeding-board-core.ts).
 *
 * No Prisma, no session, no Next.js, no database: the core takes four plain
 * arrays, so every case here is expressed as literal fixtures. These lock the
 * Stage 2 contract:
 *  - one row per horse, unioned from active-student assignments and meal rows;
 *  - a missing visibility row means VISIBLE and a missing progress row means
 *    PENDING - and no malformed, conflicting or absent input can hide a horse
 *    that was not explicitly hidden, or report a horse as fed;
 *  - hidden horses live only in hiddenRows, keep their meal data, and never
 *    leak their stale progress into the active board;
 *  - the control mode is derived from concentrate content only, and a stored
 *    HAY_DONE on a two-option horse displays as PENDING without being mutated;
 *  - output is deterministic under input reordering, deeply frozen, and the
 *    inputs are neither mutated nor frozen.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/feeding/feeding-board-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildFeedingBoard,
  hasConcentrateContent,
  hasHayContent,
  resolveFeedingStatusControlMode,
  type FeedingBoardInput,
  type FeedingBoardMealInput,
  type FeedingBoardProgressInput,
  type FeedingBoardResponsibleStudent,
  type FeedingBoardStudentHorseInput,
  type FeedingMealType,
  type FeedingProgressState,
} from "./feeding-board-core";

// --- fixtures ---------------------------------------------------------------

function emptyInput(): FeedingBoardInput {
  return { studentHorses: [], meals: [], visibility: [], progress: [] };
}

function meal(
  horseName: string,
  mealType: FeedingMealType,
  overrides: Partial<FeedingBoardMealInput> = {},
): FeedingBoardMealInput {
  return {
    horseName,
    mealType,
    hayType: null,
    concentrateType: null,
    concentrateAmount: null,
    notes: null,
    updatedByName: null,
    updatedAt: null,
    ...overrides,
  };
}

function student(
  horseName: string,
  responsibleStudent: FeedingBoardResponsibleStudent | null = null,
): FeedingBoardStudentHorseInput {
  return { horseName, responsibleStudent };
}

function progressRow(
  horseName: string,
  state: FeedingProgressState,
  overrides: Partial<FeedingBoardProgressInput> = {},
): FeedingBoardProgressInput {
  return {
    horseName,
    state,
    hayMarkedAt: null,
    hayMarkedByName: null,
    concentrateMarkedAt: null,
    concentrateMarkedByName: null,
    ...overrides,
  };
}

const NOA: FeedingBoardResponsibleStudent = {
  id: "stu-1",
  fullName: "נועה",
  groupName: "א",
  subgroupNumber: 2,
};

// A horse with real hay + concentrate content, the common production shape.
function fedHorseMeals(horseName: string): FeedingBoardMealInput[] {
  return [
    meal(horseName, "MORNING", {
      hayType: "ערב-דגן",
      concentrateType: "שיבולת שועל",
      concentrateAmount: "1/4",
      updatedByName: "דנה",
      updatedAt: "2026-07-20T06:00:00.000Z",
    }),
    meal(horseName, "EVENING", {
      hayType: "ערב-דגן",
      concentrateType: "שיבולת שועל",
      concentrateAmount: "1/4",
      updatedByName: "דנה",
      updatedAt: "2026-07-20T06:00:00.000Z",
    }),
  ];
}

// --- 1-4: horse-source union ------------------------------------------------

test("1. a horse reached only through an active student appears exactly once", () => {
  const board = buildFeedingBoard({ ...emptyInput(), studentHorses: [student("רקיע", NOA)] });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].horseName, "רקיע");
  assert.equal(board.activeRows[0].morning, null);
  assert.equal(board.activeRows[0].evening, null);
});

test("2. a horse reached only through meal rows appears exactly once", () => {
  const board = buildFeedingBoard({ ...emptyInput(), meals: fedHorseMeals("ביילס") });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].horseName, "ביילס");
  assert.equal(board.activeRows[0].responsibleStudent, null);
});

test("3. a horse present in BOTH sources still produces exactly one row", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].horseName, "רקיע");
  assert.equal(board.activeRows[0].responsibleStudent?.fullName, "נועה");
  assert.equal(board.activeRows[0].morning?.hayType, "ערב-דגן");
});

test("4. several meal rows for one horse are grouped into one row by meal type", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [
      meal("רקיע", "MORNING", { hayType: "בוקר-חציר" }),
      meal("רקיע", "LUNCH", { hayType: "צהריים-חציר" }),
      meal("רקיע", "EVENING", { hayType: "ערב-חציר" }),
    ],
  });

  assert.equal(board.activeRows.length, 1);
  const row = board.activeRows[0];
  assert.equal(row.morning?.hayType, "בוקר-חציר");
  assert.equal(row.lunch?.hayType, "צהריים-חציר");
  assert.equal(row.evening?.hayType, "ערב-חציר");
});

test("4b. the most recently updated meal supplies the row's updatedBy/updatedAt", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [
      meal("רקיע", "MORNING", { updatedByName: "ישן", updatedAt: "2026-07-01T05:00:00.000Z" }),
      meal("רקיע", "EVENING", { updatedByName: "חדש", updatedAt: "2026-07-20T05:00:00.000Z" }),
    ],
  });

  assert.equal(board.activeRows[0].updatedByName, "חדש");
  assert.equal(board.activeRows[0].updatedAt, "2026-07-20T05:00:00.000Z");
});

// --- 5-8: visibility --------------------------------------------------------

test("5. a horse with NO visibility row is visible", () => {
  const board = buildFeedingBoard({ ...emptyInput(), studentHorses: [student("רקיע")] });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.hiddenRows.length, 0);
  assert.equal(board.activeRows[0].isHidden, false);
});

test("6. isHidden false keeps a horse in activeRows", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע")],
    visibility: [{ horseName: "רקיע", isHidden: false }],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.hiddenRows.length, 0);
});

test("7. isHidden true places the horse in hiddenRows ONLY", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
    visibility: [{ horseName: "רקיע", isHidden: true }],
  });

  assert.equal(board.activeRows.length, 0);
  assert.equal(board.hiddenRows.length, 1);
  assert.equal(board.hiddenRows[0].isHidden, true);
});

test("8. a hidden student-only horse with no meal row stays discoverable in hiddenRows", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA)],
    visibility: [{ horseName: "רקיע", isHidden: true }],
  });

  assert.equal(board.hiddenRows.length, 1);
  assert.equal(board.hiddenRows[0].horseName, "רקיע");
  assert.equal(board.hiddenRows[0].morning, null);
  assert.equal(board.hiddenRows[0].responsibleStudent?.fullName, "נועה");
});

test("8b. contradictory duplicate visibility rows resolve to VISIBLE, never hidden", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע")],
    visibility: [
      { horseName: "רקיע", isHidden: true },
      { horseName: "רקיע", isHidden: false },
    ],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.hiddenRows.length, 0);
});

test("8c. a non-boolean isHidden value never hides a horse", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע")],
    visibility: [{ horseName: "רקיע", isHidden: "true" as unknown as boolean }],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.hiddenRows.length, 0);
});

test("8d. a visibility row for a horse in neither source creates no row", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    visibility: [{ horseName: "רוח-רפאים", isHidden: true }],
  });

  assert.equal(board.activeRows.length, 0);
  assert.equal(board.hiddenRows.length, 0);
});

// --- 9-11: progress ---------------------------------------------------------

test("9. a horse with NO progress row is PENDING with no invented audit data", () => {
  const board = buildFeedingBoard({ ...emptyInput(), studentHorses: [student("רקיע")] });

  assert.equal(board.activeRows[0].progressState, "PENDING");
  assert.equal(board.activeRows[0].displayProgressState, "PENDING");
  assert.equal(board.activeRows[0].progress, null);
});

test("10. an unrecognised stored progress state degrades to PENDING, never to complete", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: fedHorseMeals("רקיע"),
    progress: [progressRow("רקיע", "FED_EVERYTHING" as unknown as FeedingProgressState)],
  });

  const row = board.activeRows[0];
  assert.equal(row.progressState, "PENDING");
  assert.equal(row.displayProgressState, "PENDING");
  assert.notEqual(row.progressState, "COMPLETE");
});

test("10b. contradictory duplicate progress rows resolve to the LEAST advanced state", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: fedHorseMeals("רקיע"),
    progress: [progressRow("רקיע", "COMPLETE"), progressRow("רקיע", "HAY_DONE")],
  });

  assert.equal(board.activeRows[0].progressState, "HAY_DONE");
});

test("11. a hidden horse's stale progress never leaks into activeRows", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע"), student("ביילס")],
    meals: fedHorseMeals("רקיע"),
    visibility: [{ horseName: "רקיע", isHidden: true }],
    progress: [
      progressRow("רקיע", "COMPLETE", {
        hayMarkedAt: "2026-07-20T06:10:00.000Z",
        hayMarkedByName: "דנה",
      }),
    ],
  });

  assert.deepEqual(
    board.activeRows.map((row) => row.horseName),
    ["ביילס"],
  );
  assert.equal(board.activeRows[0].progressState, "PENDING");
  // Retained in hiddenRows for manager inspection - documented decision.
  assert.equal(board.hiddenRows[0].progressState, "COMPLETE");
  assert.equal(board.hiddenRows[0].progress?.hayMarkedByName, "דנה");
});

test("11b. progress timestamps and actor names are passed through verbatim", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: fedHorseMeals("רקיע"),
    progress: [
      progressRow("רקיע", "COMPLETE", {
        hayMarkedAt: "2026-07-20T06:10:00.000Z",
        hayMarkedByName: "דנה",
        concentrateMarkedAt: "2026-07-20T06:20:00.000Z",
        concentrateMarkedByName: "יואב",
      }),
    ],
  });

  assert.deepEqual(board.activeRows[0].progress, {
    hayMarkedAt: "2026-07-20T06:10:00.000Z",
    hayMarkedByName: "דנה",
    concentrateMarkedAt: "2026-07-20T06:20:00.000Z",
    concentrateMarkedByName: "יואב",
  });
});

// --- 12-16: content detection and control mode ------------------------------

test("12. hay + concentrate content yields the hayAndConcentrate control", () => {
  const board = buildFeedingBoard({ ...emptyInput(), meals: fedHorseMeals("רקיע") });
  const row = board.activeRows[0];

  assert.equal(row.hasHayContent, true);
  assert.equal(row.hasConcentrateContent, true);
  assert.equal(row.statusControlMode, "hayAndConcentrate");
  assert.deepEqual(
    row.statusOptions.map((option) => option.state),
    ["PENDING", "HAY_DONE", "COMPLETE"],
  );
});

test("13. a hay-only horse yields the completeOnly control", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [meal("רקיע", "MORNING", { hayType: "ערב-דגן" })],
  });
  const row = board.activeRows[0];

  assert.equal(row.hasHayContent, true);
  assert.equal(row.hasConcentrateContent, false);
  assert.equal(row.statusControlMode, "completeOnly");
  assert.deepEqual(
    row.statusOptions.map((option) => option.state),
    ["PENDING", "COMPLETE"],
  );
});

test("14. a horse with no meal row at all yields the completeOnly control", () => {
  const board = buildFeedingBoard({ ...emptyInput(), studentHorses: [student("רקיע")] });
  const row = board.activeRows[0];

  assert.equal(row.hasHayContent, false);
  assert.equal(row.hasConcentrateContent, false);
  assert.equal(row.statusControlMode, "completeOnly");
});

test("15. content-free meal rows yield the completeOnly control and do not crash", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [meal("ארבל", "MORNING"), meal("ארבל", "EVENING")],
  });
  const row = board.activeRows[0];

  assert.equal(row.horseName, "ארבל");
  assert.equal(row.hasHayContent, false);
  assert.equal(row.statusControlMode, "completeOnly");
});

test("15b. notes alone are never treated as hay or concentrate content", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [meal("ארבל", "MORNING", { notes: "להאכיל אחרי הרכיבה" })],
  });
  const row = board.activeRows[0];

  assert.equal(row.hasHayContent, false);
  assert.equal(row.hasConcentrateContent, false);
  assert.equal(row.statusControlMode, "completeOnly");
  assert.equal(row.morning?.notes, "להאכיל אחרי הרכיבה");
});

test("16. whitespace-only hay/concentrate values do not count as content", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [
      meal("ארבל", "MORNING", { hayType: "   ", concentrateType: "\t", concentrateAmount: "\n " }),
    ],
  });
  const row = board.activeRows[0];

  assert.equal(row.hasHayContent, false);
  assert.equal(row.hasConcentrateContent, false);
  assert.equal(row.statusControlMode, "completeOnly");
});

test("16b. the exported content helpers behave standalone", () => {
  assert.equal(hasHayContent([null]), false);
  assert.equal(
    hasHayContent([{ hayType: "ערב-דגן", concentrateType: null, concentrateAmount: null, notes: null }]),
    true,
  );
  assert.equal(
    hasConcentrateContent([
      { hayType: null, concentrateType: null, concentrateAmount: "חופן", notes: null },
    ]),
    true,
  );
  assert.equal(resolveFeedingStatusControlMode([null, null, null]), "completeOnly");
});

// --- presentation of a stored HAY_DONE on a completeOnly horse --------------

test("stored HAY_DONE on a completeOnly horse displays as PENDING and is not mutated", () => {
  const input: FeedingBoardInput = {
    ...emptyInput(),
    meals: [meal("רקיע", "MORNING", { hayType: "ערב-דגן" })],
    progress: [
      progressRow("רקיע", "HAY_DONE", {
        hayMarkedAt: "2026-07-20T06:10:00.000Z",
        hayMarkedByName: "דנה",
      }),
    ],
  };
  const row = buildFeedingBoard(input).activeRows[0];

  assert.equal(row.statusControlMode, "completeOnly");
  // Stored value is reported unchanged...
  assert.equal(row.progressState, "HAY_DONE");
  // ...while the control shows the fail-safe option, never COMPLETE.
  assert.equal(row.displayProgressState, "PENDING");
  assert.equal(row.isDisplayStateNormalized, true);
  assert.notEqual(row.displayProgressState, "COMPLETE");
  // The unavailable option is not offered, and PENDING is the selected one.
  assert.deepEqual(
    row.statusOptions.map((option) => option.state),
    ["PENDING", "COMPLETE"],
  );
  assert.deepEqual(
    row.statusOptions.filter((option) => option.isCurrent).map((option) => option.state),
    ["PENDING"],
  );
  // The stored audit stamps survive the normalisation untouched.
  assert.equal(row.progress?.hayMarkedByName, "דנה");
  assert.equal(input.progress[0].state, "HAY_DONE");
});

test("HAY_DONE on a hayAndConcentrate horse is NOT normalised", () => {
  const row = buildFeedingBoard({
    ...emptyInput(),
    meals: fedHorseMeals("רקיע"),
    progress: [progressRow("רקיע", "HAY_DONE")],
  }).activeRows[0];

  assert.equal(row.progressState, "HAY_DONE");
  assert.equal(row.displayProgressState, "HAY_DONE");
  assert.equal(row.isDisplayStateNormalized, false);
});

test("every status option carries a non-empty text label and glyph (never colour alone)", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [...fedHorseMeals("רקיע"), meal("ארבל", "MORNING", { hayType: "ערב-דגן" })],
  });

  for (const row of board.activeRows) {
    for (const option of row.statusOptions) {
      assert.ok(option.label.trim().length > 0, `empty label for ${option.state}`);
      assert.ok(option.glyph.trim().length > 0, `empty glyph for ${option.state}`);
    }
    assert.equal(row.statusOptions.filter((option) => option.isCurrent).length, 1);
  }
});

// --- 17-18: sorting ---------------------------------------------------------

test("17. activeRows keep the Hebrew horse-name ordering", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע"), student("אביב"), student("גל"), student("בר")],
  });

  assert.deepEqual(
    board.activeRows.map((row) => row.horseName),
    ["אביב", "בר", "גל", "רקיע"],
  );
});

test("18. hiddenRows are sorted independently of activeRows", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע"), student("אביב"), student("גל"), student("בר")],
    visibility: [
      { horseName: "רקיע", isHidden: true },
      { horseName: "אביב", isHidden: true },
    ],
  });

  assert.deepEqual(
    board.activeRows.map((row) => row.horseName),
    ["בר", "גל"],
  );
  assert.deepEqual(
    board.hiddenRows.map((row) => row.horseName),
    ["אביב", "רקיע"],
  );
});

// --- 19-22: purity, immutability, determinism -------------------------------

test("19. inputs are neither mutated nor frozen", () => {
  const input: FeedingBoardInput = {
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
    visibility: [{ horseName: "רקיע", isHidden: false }],
    progress: [progressRow("רקיע", "HAY_DONE")],
  };
  const before = JSON.parse(JSON.stringify(input));

  buildFeedingBoard(input);

  assert.deepEqual(JSON.parse(JSON.stringify(input)), before);
  assert.equal(Object.isFrozen(input.meals), false);
  assert.equal(Object.isFrozen(input.meals[0]), false);
  assert.equal(Object.isFrozen(input.studentHorses[0]), false);
  assert.equal(Object.isFrozen(input.progress[0]), false);
});

test("20. the returned board, its arrays, its rows and their nested objects are frozen", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
    progress: [progressRow("רקיע", "COMPLETE")],
  });
  const row = board.activeRows[0];

  assert.equal(Object.isFrozen(board), true);
  assert.equal(Object.isFrozen(board.activeRows), true);
  assert.equal(Object.isFrozen(board.hiddenRows), true);
  assert.equal(Object.isFrozen(row), true);
  assert.equal(Object.isFrozen(row.statusOptions), true);
  assert.equal(Object.isFrozen(row.statusOptions[0]), true);
  assert.equal(Object.isFrozen(row.morning), true);
  assert.equal(Object.isFrozen(row.progress), true);
  assert.equal(Object.isFrozen(row.responsibleStudent), true);
});

test("21. output is identical when every input array is reordered", () => {
  const input: FeedingBoardInput = {
    studentHorses: [student("רקיע", NOA), student("אביב"), student("ביילס")],
    meals: [
      ...fedHorseMeals("רקיע"),
      meal("ביילס", "MORNING", { hayType: "ערב-דגן", updatedAt: "2026-07-02T05:00:00.000Z" }),
      meal("ביילס", "LUNCH", { notes: "מעט", updatedAt: "2026-07-03T05:00:00.000Z" }),
    ],
    visibility: [{ horseName: "אביב", isHidden: true }],
    progress: [progressRow("רקיע", "HAY_DONE"), progressRow("ביילס", "COMPLETE")],
  };

  const forward = buildFeedingBoard(input);
  const reversed = buildFeedingBoard({
    studentHorses: [...input.studentHorses].reverse(),
    meals: [...input.meals].reverse(),
    visibility: [...input.visibility].reverse(),
    progress: [...input.progress].reverse(),
  });

  assert.deepEqual(reversed, forward);
});

test("22. duplicate source rows never duplicate a horse", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA), student("רקיע", NOA), student("רקיע")],
    meals: [
      meal("רקיע", "MORNING", { hayType: "ישן", updatedAt: "2026-07-01T05:00:00.000Z" }),
      meal("רקיע", "MORNING", { hayType: "חדש", updatedAt: "2026-07-20T05:00:00.000Z" }),
    ],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].morning?.hayType, "חדש");
});

test("22b. names differing only by surrounding whitespace are one horse", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [student("  רקיע  ")],
    meals: [meal("רקיע", "MORNING", { hayType: "ערב-דגן" })],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].horseName, "רקיע");
  assert.equal(board.activeRows[0].hasHayContent, true);
});

test("22c. blank / non-string horse names are skipped consistently and never throw", () => {
  const board = buildFeedingBoard({
    studentHorses: [student(""), student("   "), student(null as unknown as string), student("רקיע")],
    meals: [meal("", "MORNING", { hayType: "x" }), meal("  ", "EVENING")],
    visibility: [{ horseName: "", isHidden: true }],
    progress: [progressRow("   ", "COMPLETE")],
  });

  assert.deepEqual(
    board.activeRows.map((row) => row.horseName),
    ["רקיע"],
  );
  assert.equal(board.hiddenRows.length, 0);
  assert.equal(board.activeRows[0].progressState, "PENDING");
});

test("22d. an unrecognised meal type is skipped without dropping the horse", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    meals: [
      meal("רקיע", "BRUNCH" as unknown as FeedingMealType, { hayType: "ערב-דגן" }),
      meal("רקיע", "EVENING", { hayType: "ערב-דגן" }),
    ],
  });

  assert.equal(board.activeRows.length, 1);
  assert.equal(board.activeRows[0].morning, null);
  assert.equal(board.activeRows[0].evening?.hayType, "ערב-דגן");
});

// --- 23-24: data preservation ----------------------------------------------

test("23. responsible-student display fields are preserved and normalised", () => {
  const board = buildFeedingBoard({
    ...emptyInput(),
    studentHorses: [
      student("רקיע", NOA),
      student("ביילס", { id: "stu-2", fullName: "יעל", groupName: null, subgroupNumber: null }),
    ],
  });
  const rakia = board.activeRows.find((row) => row.horseName === "רקיע");
  const bales = board.activeRows.find((row) => row.horseName === "ביילס");

  assert.deepEqual(rakia?.responsibleStudent, {
    id: "stu-1",
    fullName: "נועה",
    groupName: "א",
    subgroupNumber: 2,
  });
  assert.deepEqual(bales?.responsibleStudent, {
    id: "stu-2",
    fullName: "יעל",
    groupName: null,
    subgroupNumber: null,
  });
});

test("24. meal data stays attached across hide and restore composition", () => {
  const base: FeedingBoardInput = {
    ...emptyInput(),
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
  };

  const hidden = buildFeedingBoard({ ...base, visibility: [{ horseName: "רקיע", isHidden: true }] });
  const restored = buildFeedingBoard({ ...base, visibility: [{ horseName: "רקיע", isHidden: false }] });

  assert.equal(hidden.hiddenRows[0].morning?.hayType, "ערב-דגן");
  assert.equal(hidden.hiddenRows[0].evening?.concentrateAmount, "1/4");
  assert.equal(hidden.hiddenRows[0].responsibleStudent?.fullName, "נועה");

  assert.deepEqual(restored.activeRows[0].morning, hidden.hiddenRows[0].morning);
  assert.deepEqual(restored.activeRows[0].evening, hidden.hiddenRows[0].evening);
  assert.equal(restored.activeRows[0].isHidden, false);
});

// --- 25-27: source-level purity contract ------------------------------------

const CORE_SOURCE_PATH = fileURLToPath(new URL("./feeding-board-core.ts", import.meta.url));
const CORE_SOURCE = readFileSync(CORE_SOURCE_PATH, "utf8");

// Comments legitimately NAME the things the code must not depend on (Prisma,
// getKnownHorseNames, the new tables), so the token scans below run against the
// executable source only.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE_CODE = stripComments(CORE_SOURCE);

test("25. the core declares no runtime import and no forbidden runtime capability", () => {
  assert.ok(!/^\s*import\s/m.test(CORE_CODE), "core must have no import statement at all");
  assert.ok(!/\brequire\s*\(/.test(CORE_CODE), "core must not use require()");
  assert.ok(!/"use server"|'use server'/.test(CORE_CODE), "core must not be a Server Action module");
  assert.ok(!/\bnew Date\b/.test(CORE_CODE), "core must not construct dates");
  assert.ok(!/\bDate\.now\b/.test(CORE_CODE), "core must not read the clock");
  assert.ok(!/\bMath\.random\b/.test(CORE_CODE), "core must not use randomness");
  assert.ok(!/\bprocess\.env\b/.test(CORE_CODE), "core must not read the environment");
});

test("25b. the core references no Prisma, Next.js, React, action or auth module", () => {
  for (const token of [
    "prisma",
    "@prisma/client",
    "app/generated",
    "next/",
    "react",
    "lib/actions",
    "lib/auth",
    "cookies",
    "getCurrentInstructor",
    "requireAdmin",
  ]) {
    assert.ok(
      !CORE_CODE.toLowerCase().includes(token.toLowerCase()),
      `core must not reference ${token}`,
    );
  }
});

test("26. the core neither filters nor references the known-horse-name autocomplete set", () => {
  for (const token of ["getKnownHorseNames", "getKnownRidingHorseNames", "sessionHorseName"]) {
    assert.ok(!CORE_CODE.includes(token), `core must not reference ${token}`);
  }
});

test("27. the core works with empty sources, so it needs no new table to exist", () => {
  const board = buildFeedingBoard(emptyInput());

  assert.deepEqual(board.activeRows, []);
  assert.deepEqual(board.hiddenRows, []);

  // The pre-migration shape: real meals and students, both new sources empty.
  const preMigration = buildFeedingBoard({
    studentHorses: [student("רקיע", NOA)],
    meals: fedHorseMeals("רקיע"),
    visibility: [],
    progress: [],
  });

  assert.equal(preMigration.activeRows.length, 1);
  assert.equal(preMigration.activeRows[0].isHidden, false);
  assert.equal(preMigration.activeRows[0].progressState, "PENDING");
  assert.equal(preMigration.hiddenRows.length, 0);
  // No table name reaches the core - it only ever sees plain arrays.
  assert.ok(!CORE_CODE.includes("horse_feeding_"), "core must not name a database table");
});
