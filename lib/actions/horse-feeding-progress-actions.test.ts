/**
 * FEEDING-BOARD Stage 4 - tests for the wired feeding progress / visibility
 * server surface.
 *
 * Two kinds of evidence, and the file is explicit about which is which:
 *
 *  PRIMARY (behavioural, DB-free): the persistence semantics live in the
 *  dependency-injected mutators of ./horse-feeding-progress-io, so every write
 *  rule - what PENDING/HAY_DONE/COMPLETE do, what a completeOnly horse records,
 *  what hiding clears - is exercised against plain fakes with no database. The
 *  authorization gates are re-exercised end-to-end by composing the real Stage 3
 *  orchestration with those same fakes, proving no denied path reaches a mutator.
 *
 *  SECONDARY (source contract): ./horse-feeding is a "use server" module that
 *  transitively imports Prisma and next/*, so it cannot be imported here. Its
 *  Server Action boundary - requireAdmin first, no requireAdmin injected as a
 *  resolver, no exported Prisma mutator, no instructor visibility action, the
 *  reader composing through the pure core - is asserted against its source, the
 *  same convention horse-feeding-auth.test.ts already uses for wiring.
 *
 * NO PRODUCTION WRITE occurs anywhere in this file: nothing here imports the
 * Prisma client or opens a connection.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/horse-feeding-progress-actions.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  INVALID_HORSE_NAME_ERROR,
  INVALID_TARGET_STATE_ERROR,
  clearAllFeedingProgressWithDeps,
  markFeedingProgressWithDeps,
  planFeedingProgressWrite,
  setHorseFeedingVisibilityWithDeps,
  type FeedingMealContentRow,
  type FeedingProgressRow,
  type FeedingProgressWriteData,
  type FeedingVisibilityRow,
  type MarkFeedingProgressDeps,
} from "./horse-feeding-progress-io";
import {
  ADMIN_REQUIRED_ERROR,
  INSTRUCTOR_REQUIRED_ERROR,
  NO_FEEDING_PERMISSION_ERROR,
  clearAllHorseFeedingProgressAsInstructorWithDeps,
  markHorseFeedingProgressAsAdminWithDeps,
  markHorseFeedingProgressAsInstructorWithDeps,
  setHorseFeedingVisibilityAsAdminWithDeps,
} from "./horse-feeding-progress-auth";
// The canonical state union lives in the pure Stage 2 core; the auth module
// consumes it as a type-only import rather than re-exporting it.
import type { FeedingProgressState } from "@/lib/feeding/feeding-board-core";

// --- fakes ------------------------------------------------------------------

const NOW = new Date("2026-07-28T06:30:00.000Z");
const EARLIER = new Date("2026-07-28T05:00:00.000Z");

const HAY_AND_CONCENTRATE: FeedingMealContentRow[] = [
  { hayType: "ערב-דגן", concentrateType: "שיבולת שועל", concentrateAmount: "1/4", notes: null },
];
const HAY_ONLY: FeedingMealContentRow[] = [
  { hayType: "ערב-דגן", concentrateType: null, concentrateAmount: null, notes: "אחרי רכיבה" },
];
const NO_MEALS: FeedingMealContentRow[] = [];

interface MarkFake {
  deps: MarkFeedingProgressDeps;
  upserts: { horseName: string; data: FeedingProgressWriteData }[];
  deletes: string[];
  mealLookups: string[];
}

function markFake(options: {
  meals?: FeedingMealContentRow[];
  existing?: FeedingProgressRow | null;
} = {}): MarkFake {
  const upserts: MarkFake["upserts"] = [];
  const deletes: string[] = [];
  const mealLookups: string[] = [];
  return {
    upserts,
    deletes,
    mealLookups,
    deps: {
      now: () => NOW,
      findMealContent: async (horseName) => {
        mealLookups.push(horseName);
        return options.meals ?? HAY_AND_CONCENTRATE;
      },
      findProgress: async () => options.existing ?? null,
      upsertProgress: async (horseName, data) => {
        upserts.push({ horseName, data });
        return { horseName, ...data };
      },
      deleteProgress: async (horseName) => {
        deletes.push(horseName);
        return 1;
      },
    },
  };
}

/** A mark mutator that fails the test if the write layer is ever reached. */
async function forbiddenMark(): Promise<never> {
  throw new Error("mutator must not be reached on denial");
}

// ===========================================================================
// MARKING (9-17) - primary behavioural evidence
// ===========================================================================

test("9. PENDING deletes the row and is idempotent (no upsert, no error when absent)", async () => {
  const fake = markFake();
  const first = await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "PENDING",
    markedByName: "דנה",
  });
  const second = await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "PENDING",
    markedByName: "דנה",
  });

  assert.deepEqual(first.result, { success: true });
  assert.deepEqual(second.result, { success: true });
  assert.equal(first.progress, null);
  assert.equal(second.progress, null);
  assert.deepEqual(fake.deletes, ["רקיע", "רקיע"]);
  assert.equal(fake.upserts.length, 0, "PENDING must never write a row");
});

test("10. HAY_DONE records the hay audit and CLEARS the concentrate audit", async () => {
  const fake = markFake({
    existing: {
      horseName: "רקיע",
      state: "COMPLETE",
      hayMarkedAt: EARLIER,
      hayMarkedByName: "מישהו",
      concentrateMarkedAt: EARLIER,
      concentrateMarkedByName: "מישהו",
    },
  });

  const outcome = await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "HAY_DONE",
    markedByName: "דנה",
  });

  assert.deepEqual(fake.upserts[0].data, {
    state: "HAY_DONE",
    hayMarkedAt: NOW,
    hayMarkedByName: "דנה",
    concentrateMarkedAt: null,
    concentrateMarkedByName: null,
  });
  assert.equal(outcome.progress?.state, "HAY_DONE");
});

test("11. COMPLETE with concentrate PRESERVES an existing hay audit and sets concentrate", async () => {
  const fake = markFake({
    meals: HAY_AND_CONCENTRATE,
    existing: {
      horseName: "רקיע",
      state: "HAY_DONE",
      hayMarkedAt: EARLIER,
      hayMarkedByName: "יעל",
      concentrateMarkedAt: null,
      concentrateMarkedByName: null,
    },
  });

  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.deepEqual(fake.upserts[0].data, {
    state: "COMPLETE",
    hayMarkedAt: EARLIER,
    hayMarkedByName: "יעל",
    concentrateMarkedAt: NOW,
    concentrateMarkedByName: "דנה",
  });
});

test("12. COMPLETE with concentrate and NO prior hay sets both audits to this actor", async () => {
  const fake = markFake({ meals: HAY_AND_CONCENTRATE, existing: null });

  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.deepEqual(fake.upserts[0].data, {
    state: "COMPLETE",
    hayMarkedAt: NOW,
    hayMarkedByName: "דנה",
    concentrateMarkedAt: NOW,
    concentrateMarkedByName: "דנה",
  });
});

test("12b. an existing row whose hay audit is null still gets one on COMPLETE", async () => {
  const fake = markFake({
    meals: HAY_AND_CONCENTRATE,
    existing: {
      horseName: "רקיע",
      state: "HAY_DONE",
      hayMarkedAt: null,
      hayMarkedByName: null,
      concentrateMarkedAt: null,
      concentrateMarkedByName: null,
    },
  });

  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.equal(fake.upserts[0].data.hayMarkedAt, NOW);
  assert.equal(fake.upserts[0].data.hayMarkedByName, "דנה");
});

test("13. COMPLETE for a completeOnly horse never records that concentrate was given", async () => {
  for (const meals of [HAY_ONLY, NO_MEALS]) {
    const fake = markFake({ meals, existing: null });

    await markFeedingProgressWithDeps(fake.deps, {
      horseName: "רקיע",
      targetState: "COMPLETE",
      markedByName: "דנה",
    });

    assert.deepEqual(fake.upserts[0].data, {
      state: "COMPLETE",
      hayMarkedAt: NOW,
      hayMarkedByName: "דנה",
      concentrateMarkedAt: null,
      concentrateMarkedByName: null,
    });
  }
});

test("13b. a stale concentrate audit is cleared, not carried forward, once concentrate is gone", async () => {
  const fake = markFake({
    meals: HAY_ONLY,
    existing: {
      horseName: "רקיע",
      state: "COMPLETE",
      hayMarkedAt: EARLIER,
      hayMarkedByName: "יעל",
      concentrateMarkedAt: EARLIER,
      concentrateMarkedByName: "יעל",
    },
  });

  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.equal(fake.upserts[0].data.concentrateMarkedAt, null);
  assert.equal(fake.upserts[0].data.concentrateMarkedByName, null);
  assert.equal(fake.upserts[0].data.hayMarkedAt, EARLIER, "the hay credit is still preserved");
});

test("13c. whitespace-only concentrate content is not usable content (Stage 2 rule reused)", async () => {
  const fake = markFake({
    meals: [{ hayType: "ערב-דגן", concentrateType: "  ", concentrateAmount: "\t", notes: null }],
  });

  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.equal(fake.upserts[0].data.concentrateMarkedAt, null);
});

test("14. a malformed target state is refused and can never become COMPLETE", async () => {
  for (const bad of ["COMPLETED", "complete", "", null, undefined, 3, { state: "COMPLETE" }]) {
    const fake = markFake();
    const outcome = await markFeedingProgressWithDeps(fake.deps, {
      horseName: "רקיע",
      targetState: bad as unknown as FeedingProgressState,
      markedByName: "דנה",
    });

    assert.deepEqual(outcome.result, { success: false, error: INVALID_TARGET_STATE_ERROR });
    assert.equal(outcome.progress, null);
    assert.equal(fake.upserts.length, 0, `${String(bad)} must not write`);
    assert.equal(fake.deletes.length, 0, `${String(bad)} must not delete`);
  }
});

test("15. a blank / non-string horse name never reads and never writes", async () => {
  for (const bad of ["", "   ", "\t\n", null, undefined, 42]) {
    const fake = markFake();
    const outcome = await markFeedingProgressWithDeps(fake.deps, {
      horseName: bad as unknown as string,
      targetState: "COMPLETE",
      markedByName: "דנה",
    });

    assert.deepEqual(outcome.result, { success: false, error: INVALID_HORSE_NAME_ERROR });
    assert.equal(fake.upserts.length, 0);
    assert.equal(fake.deletes.length, 0);
    assert.equal(fake.mealLookups.length, 0, "a rejected name must not even be read");
  }
});

test("15b. the horse name is trimmed before it is written", async () => {
  const fake = markFake();
  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "  רקיע  ",
    targetState: "HAY_DONE",
    markedByName: "דנה",
  });

  assert.equal(fake.upserts[0].horseName, "רקיע");
});

test("15c. neither validation error echoes the caller-supplied value", () => {
  for (const error of [INVALID_HORSE_NAME_ERROR, INVALID_TARGET_STATE_ERROR]) {
    assert.ok(error.trim().length > 0);
    assert.ok(!/@|prisma|sql|select |insert |stack/i.test(error), error);
  }
  // Describes the KIND of problem only - no caller string is reflected back.
  assert.equal(INVALID_HORSE_NAME_ERROR, "שם סוס לא תקין");
  assert.equal(INVALID_TARGET_STATE_ERROR, "סטטוס האכלה לא תקין");
});

test("16. a successful mark returns the authoritative saved row", async () => {
  const fake = markFake({ meals: HAY_AND_CONCENTRATE });
  const outcome = await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.deepEqual(outcome.result, { success: true });
  assert.deepEqual(outcome.progress, {
    horseName: "רקיע",
    state: "COMPLETE",
    hayMarkedAt: NOW,
    hayMarkedByName: "דנה",
    concentrateMarkedAt: NOW,
    concentrateMarkedByName: "דנה",
  });
});

test("17. a write-layer failure propagates and is NOT converted into an auth denial", async () => {
  const fake = markFake();
  const failing: MarkFeedingProgressDeps = {
    ...fake.deps,
    upsertProgress: async () => {
      throw new Error("transaction failed");
    },
  };

  await assert.rejects(
    () =>
      markFeedingProgressWithDeps(failing, {
        horseName: "רקיע",
        targetState: "HAY_DONE",
        markedByName: "דנה",
      }),
    /transaction failed/,
  );

  // ...and the same holds through the real Stage 3 gate: an authorized actor's
  // mutator error surfaces as an error, never as ADMIN/PERMISSION denial.
  await assert.rejects(
    () =>
      markHorseFeedingProgressAsInstructorWithDeps(
        {
          getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "דנה" }),
          markProgress: async (command) => (await markFeedingProgressWithDeps(failing, command)).result,
        },
        { horseName: "רקיע", targetState: "HAY_DONE" },
      ),
    /transaction failed/,
  );
});

test("planFeedingProgressWrite is pure and exhaustive over the three states", () => {
  const base = { hasConcentrate: true, existing: null, actorName: "דנה", now: NOW } as const;

  assert.deepEqual(planFeedingProgressWrite({ ...base, targetState: "PENDING" }), { kind: "delete" });
  assert.equal(planFeedingProgressWrite({ ...base, targetState: "HAY_DONE" }).kind, "upsert");
  assert.equal(planFeedingProgressWrite({ ...base, targetState: "COMPLETE" }).kind, "upsert");
});

// ===========================================================================
// AUTH BOUNDARIES (3-5) - the real Stage 3 gates composed with the real fakes
// ===========================================================================

test("3. an invalid admin invokes no write layer at all", async () => {
  for (const resolveCurrentAdmin of [
    async () => null,
    async () => ({ name: "x", email: "x@example.com", isActive: false }),
    async () => {
      throw new Error("session failure");
    },
  ]) {
    const result = await markHorseFeedingProgressAsAdminWithDeps(
      { resolveCurrentAdmin, markProgress: forbiddenMark },
      { horseName: "רקיע", targetState: "COMPLETE" },
    );
    assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  }
});

test("4. an instructor without canEditHorseFeeding invokes no write layer", async () => {
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    {
      getCurrentInstructor: async () => ({ canEditHorseFeeding: false, fullName: "בלי הרשאה" }),
      markProgress: forbiddenMark,
    },
    { horseName: "רקיע", targetState: "COMPLETE" },
  );

  assert.deepEqual(result, { success: false, error: NO_FEEDING_PERMISSION_ERROR });
});

test("5. a missing / inactive / failed instructor session invokes no write layer", async () => {
  for (const getCurrentInstructor of [
    async () => null,
    async () => ({ canEditHorseFeeding: true, fullName: "דנה", isActive: false }),
    async () => {
      throw new Error("session failure");
    },
  ]) {
    const result = await markHorseFeedingProgressAsInstructorWithDeps(
      { getCurrentInstructor, markProgress: forbiddenMark },
      { horseName: "רקיע", targetState: "COMPLETE" },
    );
    assert.deepEqual(result, { success: false, error: INSTRUCTOR_REQUIRED_ERROR });
  }
});

// ===========================================================================
// CLEAR (18-22)
// ===========================================================================

test("18+19. clear removes every row through the transactional dependency", async () => {
  let calls = 0;
  const outcome = await clearAllFeedingProgressWithDeps({
    deleteAllProgressInTransaction: async () => {
      calls++;
      return 17;
    },
  });

  assert.deepEqual(outcome.result, { success: true });
  assert.equal(outcome.deletedCount, 17);
  assert.equal(calls, 1, "exactly one transactional delete");
});

test("18b. clearing an already-empty board succeeds with 0 (idempotent)", async () => {
  const outcome = await clearAllFeedingProgressWithDeps({
    deleteAllProgressInTransaction: async () => 0,
  });

  assert.deepEqual(outcome.result, { success: true });
  assert.equal(outcome.deletedCount, 0);
});

test("21+22. instructor clear is allowed only with canEditHorseFeeding", async () => {
  let cleared = 0;
  const clearAllProgress = async () => {
    const outcome = await clearAllFeedingProgressWithDeps({
      deleteAllProgressInTransaction: async () => {
        cleared++;
        return 3;
      },
    });
    return outcome.result;
  };

  const allowed = await clearAllHorseFeedingProgressAsInstructorWithDeps({
    getCurrentInstructor: async () => ({ canEditHorseFeeding: true, fullName: "דנה" }),
    clearAllProgress,
  });
  assert.deepEqual(allowed, { success: true });
  assert.equal(cleared, 1);

  const denied = await clearAllHorseFeedingProgressAsInstructorWithDeps({
    getCurrentInstructor: async () => ({ canEditHorseFeeding: false, fullName: "בלי הרשאה" }),
    clearAllProgress,
  });
  assert.deepEqual(denied, { success: false, error: NO_FEEDING_PERMISSION_ERROR });
  assert.equal(cleared, 1, "a denied instructor must not clear the board");
});

// ===========================================================================
// VISIBILITY (23-27)
// ===========================================================================

interface VisibilityFake {
  calls: {
    horseName: string;
    isHidden: boolean;
    updatedByName: string;
    clearProgress: boolean;
  }[];
  deps: Parameters<typeof setHorseFeedingVisibilityWithDeps>[0];
}

function visibilityFake(): VisibilityFake {
  const calls: VisibilityFake["calls"] = [];
  return {
    calls,
    deps: {
      applyVisibilityInTransaction: async (input) => {
        calls.push(input);
        const row: FeedingVisibilityRow = {
          horseName: input.horseName,
          isHidden: input.isHidden,
          updatedByName: input.updatedByName,
          updatedAt: NOW,
        };
        return row;
      },
    },
  };
}

test("23+24. hiding sets isHidden true AND clears that horse's progress in one transaction", async () => {
  const fake = visibilityFake();
  const outcome = await setHorseFeedingVisibilityWithDeps(fake.deps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });

  assert.deepEqual(outcome.result, { success: true });
  assert.deepEqual(fake.calls, [
    { horseName: "רקיע", isHidden: true, updatedByName: "מנהלת", clearProgress: true },
  ]);
  assert.equal(outcome.visibility?.isHidden, true);
});

test("25+26. restoring sets isHidden false and creates NO progress row", async () => {
  const fake = visibilityFake();
  const outcome = await setHorseFeedingVisibilityWithDeps(fake.deps, {
    horseName: "רקיע",
    isHidden: false,
    updatedByName: "מנהלת",
  });

  assert.deepEqual(fake.calls, [
    { horseName: "רקיע", isHidden: false, updatedByName: "מנהלת", clearProgress: false },
  ]);
  assert.equal(outcome.visibility?.isHidden, false);
  assert.equal(outcome.visibility?.updatedByName, "מנהלת");
});

test("26b. a blank horse name or non-boolean flag never changes visibility", async () => {
  for (const command of [
    { horseName: "  ", isHidden: true, updatedByName: "מנהלת" },
    { horseName: "רקיע", isHidden: "true" as unknown as boolean, updatedByName: "מנהלת" },
  ]) {
    const fake = visibilityFake();
    const outcome = await setHorseFeedingVisibilityWithDeps(fake.deps, command);

    assert.equal(outcome.result.success, false);
    assert.equal(fake.calls.length, 0);
    assert.equal(outcome.visibility, null);
  }
});

test("27. the visibility path has no meal dependency at all, so it cannot delete instructions", () => {
  const fake = visibilityFake();

  assert.deepEqual(Object.keys(fake.deps), ["applyVisibilityInTransaction"]);
  for (const forbidden of ["horseFeedingMeal", "deleteMeal", "meal"]) {
    assert.ok(
      !IO_CODE.slice(IO_CODE.indexOf("setHorseFeedingVisibilityWithDeps")).includes(forbidden),
      `the visibility mutator must not reference ${forbidden}`,
    );
  }
});

test("28. visibility denies every non-admin actor through the Stage 3 gate", async () => {
  const fake = visibilityFake();
  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    {
      resolveCurrentAdmin: async () => null,
      setVisibility: async (command) =>
        (await setHorseFeedingVisibilityWithDeps(fake.deps, command)).result,
    },
    { horseName: "רקיע", isHidden: true },
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(fake.calls.length, 0);
});

// ===========================================================================
// SOURCE CONTRACT (secondary evidence) on the "use server" module
// ===========================================================================

const ACTIONS_SOURCE = readFileSync(
  fileURLToPath(new URL("./horse-feeding.ts", import.meta.url)),
  "utf8",
);
const IO_SOURCE = readFileSync(
  fileURLToPath(new URL("./horse-feeding-progress-io.ts", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIONS_CODE = stripComments(ACTIONS_SOURCE);
const IO_CODE = stripComments(IO_SOURCE);

/** Body of a top-level exported function, up to its column-0 closing brace. */
function functionBody(code: string, name: string): string {
  const start = code.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `expected an exported async function ${name}`);
  const end = code.indexOf("\n}", start);
  assert.notEqual(end, -1, `expected a closing brace for ${name}`);
  return code.slice(start, end);
}

const ADMIN_MUTATIONS = [
  "markHorseFeedingProgressAsAdmin",
  "clearAllHorseFeedingProgressAsAdmin",
  "setHorseFeedingVisibilityAsAdmin",
];
const INSTRUCTOR_MUTATIONS = [
  "markHorseFeedingProgressAsInstructor",
  "clearAllHorseFeedingProgressAsInstructor",
];

test("1. every admin mutation calls requireAdmin before anything else", () => {
  for (const name of ADMIN_MUTATIONS) {
    const body = functionBody(ACTIONS_CODE, name);
    const firstStatement = body
      .slice(body.indexOf("{") + 1)
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    assert.match(firstStatement ?? "", /^const admin = await requireAdmin\(\);$/, name);

    const gate = body.indexOf("requireAdmin()");
    for (const sideEffect of ["prisma.", "WithDeps(", "markProgressIo", "clearProgressIo", "visibilityIo"]) {
      const at = body.indexOf(sideEffect);
      if (at !== -1) {
        assert.ok(at > gate, `${name}: ${sideEffect} must not precede requireAdmin()`);
      }
    }
  }
});

test("2. requireAdmin is never injected as the orchestration's resolver", () => {
  assert.ok(
    !/resolveCurrentAdmin:\s*requireAdmin/.test(ACTIONS_CODE),
    "requireAdmin must not be passed as resolveCurrentAdmin - its redirect would be swallowed",
  );
  for (const name of ADMIN_MUTATIONS) {
    const body = functionBody(ACTIONS_CODE, name);
    assert.match(
      body,
      /resolveCurrentAdmin:\s*async\s*\(\)\s*=>\s*actor/,
      `${name} must inject a non-throwing resolver over the already-authorized admin`,
    );
    assert.ok(!/try\s*\{/.test(body), `${name} must not wrap requireAdmin in try/catch`);
  }
});

test("6+40. no action accepts an actor id / name / email / permission", () => {
  const signatures = ACTIONS_CODE.match(/export async function \w+\([\s\S]*?\)/g) ?? [];

  assert.ok(signatures.length > 0);
  for (const signature of signatures) {
    for (const forbidden of [
      "instructorId",
      "adminId",
      "studentId",
      "actorId",
      "markedByName",
      "updatedByName",
      "clearedByName",
      "email",
      "canEditHorseFeeding",
    ]) {
      assert.ok(!signature.includes(forbidden), `${forbidden} must not be an action parameter`);
    }
  }
});

test("7. no instructor-callable visibility action exists", () => {
  const exported = [...ACTIONS_CODE.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  const visibility = exported.filter((name) => /visibility/i.test(name));

  assert.deepEqual(visibility, ["setHorseFeedingVisibilityAsAdmin"]);
  assert.ok(
    !/[Ii]nstructor[A-Za-z]*[Vv]isibility|[Vv]isibility[A-Za-z]*[Ii]nstructor/.test(ACTIONS_CODE),
    "no instructor visibility path may exist, exported or private",
  );
});

test("8+35+38+39. the Server Action surface is exactly the intended async actions", () => {
  const exportedFunctions = [...ACTIONS_CODE.matchAll(/export (async )?function (\w+)/g)];

  // 35 + 38: every exported function is async; no sync helper is exported.
  for (const [, isAsync, name] of exportedFunctions) {
    assert.ok(isAsync, `exported function ${name} must be async (it is a Server Action)`);
  }

  // 8 + 39: the export list is an exact allow-list - no raw Prisma mutator, no
  // port object, no helper leaks onto the public endpoint surface.
  assert.deepEqual(
    exportedFunctions.map(([, , name]) => name).sort(),
    [
      "clearAllHorseFeedingProgressAsAdmin",
      "clearAllHorseFeedingProgressAsInstructor",
      "getHiddenHorseFeedingRowsForAdmin",
      "getHorseFeedingOverviewForAdmin",
      "getHorseFeedingOverviewForInstructor",
      "getKnownConcentrateAmounts",
      "getKnownConcentrateTypes",
      "getKnownHayTypes",
      "getKnownHorseNames",
      "markHorseFeedingProgressAsAdmin",
      "markHorseFeedingProgressAsInstructor",
      "setHorseFeedingVisibilityAsAdmin",
      "upsertHorseFeedingMealsAsAdmin",
      "upsertHorseFeedingMealsAsInstructor",
    ],
  );

  // No `export const` at all: a const holding a function would also register as
  // a Server Action, which is exactly how a raw Prisma port could leak out.
  assert.ok(!/^export const /m.test(ACTIONS_CODE), "no value const may be exported");
  for (const port of ["markProgressIo", "clearProgressIo", "visibilityIo"]) {
    assert.ok(ACTIONS_CODE.includes(`const ${port}`), `${port} must exist`);
    assert.ok(!ACTIONS_CODE.includes(`export const ${port}`), `${port} must not be exported`);
  }
});

test("36+37. each mutation delegates to its Stage 3 gate", () => {
  for (const name of ADMIN_MUTATIONS) {
    const body = functionBody(ACTIONS_CODE, name);
    assert.match(body, /requireAdmin\(\)/, `${name} needs the admin gate`);
    assert.match(body, /WithDeps\(/, `${name} must delegate to the Stage 3 orchestration`);
  }
  for (const name of INSTRUCTOR_MUTATIONS) {
    const body = functionBody(ACTIONS_CODE, name);
    assert.match(
      body,
      /getCurrentInstructor,/,
      `${name} must resolve the instructor from the signed session`,
    );
    assert.match(body, /WithDeps\(/, `${name} must delegate to the Stage 3 permission gate`);
    assert.ok(!/requireAdmin/.test(body), `${name} must not require admin`);
  }
});

test("18c+24b. the Prisma ports implement their transactional contracts", () => {
  const clearPort = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("const clearProgressIo"),
    ACTIONS_CODE.indexOf("const visibilityIo"),
  );
  assert.match(clearPort, /prisma\.\$transaction\(\[\s*prisma\.horseFeedingProgress\.deleteMany\(\{\}\)/);

  const visibilityPort = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("const visibilityIo"),
    ACTIONS_CODE.indexOf("export async function markHorseFeedingProgressAsAdmin"),
  );
  // Hide: BOTH the visibility upsert and the progress delete inside one call.
  assert.match(
    visibilityPort,
    /\$transaction\(\[\s*upsertVisibility,\s*prisma\.horseFeedingProgress\.deleteMany\(\{ where: \{ horseName \} \}\),?\s*\]\)/,
  );
  // 27: no meal table is touched by either branch.
  assert.ok(
    !visibilityPort.includes("horseFeedingMeal"),
    "the visibility port must never touch feeding instructions",
  );
});

test("10b. feeding instructions are only ever deleted by the pre-existing LUNCH rule", () => {
  const mealDeletes = [...ACTIONS_CODE.matchAll(/horseFeedingMeal\.delete\w*\(([^)]*)\)/g)];

  assert.equal(mealDeletes.length, 1, "exactly one meal deletion may exist");
  assert.match(mealDeletes[0][1], /mealType: "LUNCH"/, "and it is the unchanged hasLunch rule");
});

// --- readers (29-34) --------------------------------------------------------

/** The shared board-view builder's body - the only place composition happens. */
const BOARD_VIEW_BODY = ACTIONS_CODE.slice(
  ACTIONS_CODE.indexOf("async function buildHorseFeedingBoardView"),
  ACTIONS_CODE.indexOf("async function buildHorseFeedingOverview"),
);

test("29. the overview composes through the pure core instead of re-implementing it", () => {
  assert.match(BOARD_VIEW_BODY, /buildFeedingBoard\(\{/, "must call the Stage 2 core");

  // Scoped to the composition site on purpose: `localeCompare` still legitimately
  // appears elsewhere in this file for the unrelated hay/concentrate suggestion
  // lists, which this stage does not touch.
  for (const duplicated of [
    "localeCompare",
    "allHorseNames",
    "studentByHorseName",
    "mealsByHorseName",
    "isHidden === true",
    'mealType === "MORNING"',
  ]) {
    assert.ok(
      !BOARD_VIEW_BODY.includes(duplicated),
      `union/visibility/sorting/grouping logic must not be duplicated here (${duplicated})`,
    );
  }
});

test("30. all four sources are read and handed to the core", () => {
  const body = BOARD_VIEW_BODY;

  for (const query of [
    "prisma.student.findMany",
    "prisma.horseFeedingMeal.findMany",
    "prisma.horseFeedingVisibility.findMany",
    "prisma.horseFeedingProgress.findMany",
  ]) {
    assert.ok(body.includes(query), `missing bounded read: ${query}`);
  }
  // Empty visibility/progress tables are the migration-time state; the core's
  // documented defaults (visible / PENDING) then reproduce today's board.
  assert.match(body, /visibility: visibility\.map/);
  assert.match(body, /progress: progress\.map/);
});

test("31+32. hidden rows are admin-only; both existing readers return active rows", () => {
  assert.match(
    functionBody(ACTIONS_CODE, "getHiddenHorseFeedingRowsForAdmin"),
    /await requireAdmin\(\);[\s\S]*\.hidden/,
    "the hidden reader must be admin-gated",
  );
  assert.match(functionBody(ACTIONS_CODE, "getHorseFeedingOverviewForAdmin"), /requireAdmin\(\)/);

  const shared = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("async function buildHorseFeedingOverview"),
    ACTIONS_CODE.indexOf("export async function getHorseFeedingOverviewForAdmin"),
  );
  assert.match(shared, /\.active;?\s*$/m, "the shared overview must expose active rows only");

  const instructorReader = functionBody(ACTIONS_CODE, "getHorseFeedingOverviewForInstructor");
  assert.match(instructorReader, /loadInstructorHorseFeedingOverviewWithDeps/);
  assert.ok(!instructorReader.includes("hidden"), "the instructor reader must never expose hidden rows");
});

test("33. every overview field the current UI consumes is still declared", () => {
  const dto = ACTIONS_SOURCE.slice(
    ACTIONS_SOURCE.indexOf("export interface HorseFeedingOverviewRow"),
    ACTIONS_SOURCE.indexOf("\n}", ACTIONS_SOURCE.indexOf("export interface HorseFeedingOverviewRow")),
  );

  for (const field of [
    "horseName",
    "morning",
    "evening",
    "lunch",
    "updatedByName",
    "updatedAt",
    "responsibleStudent",
    "attendanceStatus",
    "attendanceArrivalTime",
    "attendanceDepartureTime",
    "attendanceNotes",
  ]) {
    assert.ok(dto.includes(`${field}`), `existing field ${field} must not be removed or renamed`);
  }
  for (const added of ["isHidden", "progressState", "displayProgressState", "statusOptions"]) {
    assert.ok(dto.includes(added), `expected the additive field ${added}`);
  }
});

test("34. getKnownHorseNames is unchanged and unfiltered by visibility", () => {
  const body = functionBody(ACTIONS_CODE, "getKnownHorseNames");

  assert.ok(!body.includes("Visibility"), "known horse names must not be filtered by visibility");
  assert.ok(!body.includes("isHidden"), "known horse names must not be filtered by isHidden");
  assert.match(body, /prisma\.horseFeedingMeal\.findMany\(\{ select: \{ horseName: true \} \}\)/);
});

test("io module is not a Server Action module and holds no Prisma import", () => {
  assert.ok(!/^\s*["']use server["']\s*;?\s*$/m.test(IO_SOURCE));
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(IO_CODE));
  assert.ok(!/\bprisma\./.test(IO_CODE), "the io module must receive effects, not perform them");
});
