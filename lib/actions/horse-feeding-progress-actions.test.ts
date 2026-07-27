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
  FEEDING_HORSE_LOCK_NAMESPACE,
  HIDDEN_HORSE_MARK_ERROR,
  INVALID_HORSE_NAME_ERROR,
  INVALID_TARGET_STATE_ERROR,
  clearAllFeedingProgressWithDeps,
  feedingHorseLockKey,
  markFeedingProgressWithDeps,
  planFeedingProgressWrite,
  setHorseFeedingVisibilityWithDeps,
  type FeedingMealContentRow,
  type FeedingProgressRow,
  type FeedingProgressWriteData,
  type FeedingVisibilityRow,
  type MarkFeedingProgressDeps,
  type SetHorseFeedingVisibilityDeps,
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
  /** Every lock key this fake was asked to take, in order. */
  lockKeys: string[];
  /** Ordered trace of the transaction's statements, for ordering assertions. */
  trace: string[];
  transactions: () => number;
}

function markFake(options: {
  meals?: FeedingMealContentRow[];
  existing?: FeedingProgressRow | null;
  /** undefined = no visibility row at all (the normal, visible case). */
  hidden?: boolean;
  failUpsert?: boolean;
} = {}): MarkFake {
  const upserts: MarkFake["upserts"] = [];
  const deletes: string[] = [];
  const mealLookups: string[] = [];
  const lockKeys: string[] = [];
  const trace: string[] = [];
  let transactions = 0;
  return {
    upserts,
    deletes,
    mealLookups,
    lockKeys,
    trace,
    transactions: () => transactions,
    deps: {
      now: () => NOW,
      runInTransaction: async (run) => {
        transactions++;
        return run({
          acquireHorseLock: async (lockKey) => {
            lockKeys.push(lockKey);
            trace.push("lock");
          },
          findVisibility: async () => {
            trace.push("visibility");
            return options.hidden === undefined ? null : { isHidden: options.hidden };
          },
          findMealContent: async (horseName) => {
            mealLookups.push(horseName);
            trace.push("meals");
            return options.meals ?? HAY_AND_CONCENTRATE;
          },
          findProgress: async () => options.existing ?? null,
          upsertProgress: async (horseName, data) => {
            if (options.failUpsert) throw new Error("transaction failed");
            upserts.push({ horseName, data });
            trace.push("upsert");
            return { horseName, ...data };
          },
          deleteProgress: async (horseName) => {
            deletes.push(horseName);
            trace.push("delete");
            return 1;
          },
        });
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
  const failing: MarkFeedingProgressDeps = markFake({ failUpsert: true }).deps;

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
  calls: { horseName: string; isHidden: boolean; updatedByName: string }[];
  /** Horses whose progress the visibility transaction deleted. */
  deletes: string[];
  lockKeys: string[];
  trace: string[];
  /** The transaction op names this fake was handed - nothing meal-related. */
  ops: string[];
  deps: Parameters<typeof setHorseFeedingVisibilityWithDeps>[0];
}

function visibilityFake(): VisibilityFake {
  const calls: VisibilityFake["calls"] = [];
  const deletes: string[] = [];
  const lockKeys: string[] = [];
  const trace: string[] = [];
  const ops: string[] = [];
  return {
    calls,
    deletes,
    lockKeys,
    trace,
    ops,
    deps: {
      runInTransaction: async (run) => {
        const tx = {
          acquireHorseLock: async (lockKey: string) => {
            lockKeys.push(lockKey);
            trace.push("lock");
          },
          upsertVisibility: async (input: {
            horseName: string;
            isHidden: boolean;
            updatedByName: string;
          }) => {
            calls.push(input);
            trace.push("upsertVisibility");
            const row: FeedingVisibilityRow = {
              horseName: input.horseName,
              isHidden: input.isHidden,
              updatedByName: input.updatedByName,
              updatedAt: NOW,
            };
            return row;
          },
          deleteProgress: async (horseName: string) => {
            deletes.push(horseName);
            trace.push("deleteProgress");
            return 1;
          },
        };
        ops.push(...Object.keys(tx));
        return run(tx);
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
  assert.deepEqual(fake.calls, [{ horseName: "רקיע", isHidden: true, updatedByName: "מנהלת" }]);
  // Both effects happen inside the one transaction, after the one lock.
  assert.deepEqual(fake.deletes, ["רקיע"], "hiding clears that horse's round progress");
  assert.deepEqual(fake.trace, ["lock", "upsertVisibility", "deleteProgress"]);
  assert.equal(outcome.visibility?.isHidden, true);
});

test("25+26. restoring sets isHidden false and creates NO progress row", async () => {
  const fake = visibilityFake();
  const outcome = await setHorseFeedingVisibilityWithDeps(fake.deps, {
    horseName: "רקיע",
    isHidden: false,
    updatedByName: "מנהלת",
  });

  assert.deepEqual(fake.calls, [{ horseName: "רקיע", isHidden: false, updatedByName: "מנהלת" }]);
  assert.deepEqual(fake.deletes, [], "restoring deletes nothing...");
  assert.deepEqual(fake.trace, ["lock", "upsertVisibility"], "...and creates no progress row");
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

test("27. the visibility path has no meal dependency at all, so it cannot delete instructions", async () => {
  const fake = visibilityFake();
  await setHorseFeedingVisibilityWithDeps(fake.deps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });

  assert.deepEqual(Object.keys(fake.deps), ["runInTransaction"]);
  // The transaction is handed exactly three effects - none of them meal-related.
  assert.deepEqual(fake.ops, ["acquireHorseLock", "upsertVisibility", "deleteProgress"]);
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
  // Hide: ONE interactive transaction supplying the lock, the visibility upsert
  // and the progress delete - every statement issued on the transaction client,
  // so nothing escapes to the global client and outside the lock.
  assert.match(visibilityPort, /prisma\.\$transaction\(\(tx\) =>/);
  assert.match(visibilityPort, /acquireHorseLock: acquireHorseLockIn\(tx\)/);
  assert.match(visibilityPort, /tx\.horseFeedingVisibility\.upsert/);
  assert.match(visibilityPort, /tx\.horseFeedingProgress\.deleteMany\(\{ where: \{ horseName \} \}\)/);
  assert.ok(
    !/\bprisma\.horseFeeding/.test(visibilityPort),
    "no global-client statement may run inside the visibility transaction",
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

// ===========================================================================
// 41-59. FEEDING-BOARD Stage 5B FIX - MARK vs HIDE ARE SERIALIZED PER HORSE
//
// The invariant: no completed sequence of these actions may leave a horse with
// isHidden = true AND a HorseFeedingProgress row, because a later restore would
// then surface a stale mark instead of PENDING.
//
// These are BEHAVIOURAL tests. The fake below is a real keyed mutex plus a real
// in-memory store, so the two operations genuinely contend: the second one to
// ask for the lock does not proceed until the first transaction has ended. Both
// commit orders are exercised and the final state is asserted from the store,
// not from call counts.
// ===========================================================================

/** Transaction-scoped mutual exclusion, keyed exactly like the database lock. */
class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();
  readonly acquisitions: string[] = [];

  async acquire(key: string): Promise<() => void> {
    this.acquisitions.push(key);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tails.get(key) ?? Promise.resolve();
    this.tails.set(
      key,
      previous.then(() => held),
    );
    await previous;
    return release;
  }
}

interface FeedingStore {
  hidden: Map<string, boolean>;
  progress: Map<string, FeedingProgressRow>;
  meals: FeedingMealContentRow[];
}

function emptyStore(): FeedingStore {
  return { hidden: new Map(), progress: new Map(), meals: HAY_AND_CONCENTRATE };
}

/**
 * One shared world: both mutators run against the same store and the same lock,
 * exactly as they do against one database.
 *
 * `pause` lets a test hold a transaction open after it has taken the lock, so
 * the other operation is provably made to wait rather than merely being called
 * second.
 */
function sharedWorld(store: FeedingStore) {
  const mutex = new KeyedMutex();
  const trace: string[] = [];
  let markPause: Promise<void> | null = null;
  let markMealPause: Promise<void> | null = null;
  let visibilityPause: Promise<void> | null = null;

  const markDeps: MarkFeedingProgressDeps = {
    now: () => NOW,
    runInTransaction: async (run) => {
      let release: (() => void) | null = null;
      try {
        return await run({
          acquireHorseLock: async (lockKey) => {
            release = await mutex.acquire(lockKey);
            trace.push("mark:lock");
            if (markPause) await markPause;
          },
          findVisibility: async (horseName) => {
            trace.push("mark:visibility");
            const isHidden = store.hidden.get(horseName);
            return isHidden === undefined ? null : { isHidden };
          },
          findMealContent: async () => {
            // The exact historical race point: the mark has already decided the
            // horse is visible and is about to write.
            if (markMealPause) await markMealPause;
            return store.meals;
          },
          findProgress: async (horseName) => store.progress.get(horseName) ?? null,
          upsertProgress: async (horseName, data) => {
            trace.push("mark:upsert");
            const row: FeedingProgressRow = { horseName, ...data };
            store.progress.set(horseName, row);
            return row;
          },
          deleteProgress: async (horseName) => {
            trace.push("mark:delete");
            return store.progress.delete(horseName) ? 1 : 0;
          },
        });
      } finally {
        // Transaction-scoped: the lock is released when the transaction ends,
        // never before, and never left held on the failure path either.
        if (release) (release as () => void)();
      }
    },
  };

  const visibilityDeps: SetHorseFeedingVisibilityDeps = {
    runInTransaction: async (run) => {
      let release: (() => void) | null = null;
      try {
        return await run({
          acquireHorseLock: async (lockKey) => {
            release = await mutex.acquire(lockKey);
            trace.push("visibility:lock");
            if (visibilityPause) await visibilityPause;
          },
          upsertVisibility: async ({ horseName, isHidden, updatedByName }) => {
            trace.push("visibility:upsert");
            store.hidden.set(horseName, isHidden);
            return { horseName, isHidden, updatedByName, updatedAt: NOW };
          },
          deleteProgress: async (horseName) => {
            trace.push("visibility:delete");
            return store.progress.delete(horseName) ? 1 : 0;
          },
        });
      } finally {
        if (release) (release as () => void)();
      }
    },
  };

  return {
    markDeps,
    visibilityDeps,
    trace,
    lockAcquisitions: mutex.acquisitions,
    holdMark: () => {
      let open!: () => void;
      markPause = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        markPause = null;
        open();
      };
    },
    holdMarkAfterVisibilityRead: () => {
      let open!: () => void;
      markMealPause = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        markMealPause = null;
        open();
      };
    },
    holdVisibility: () => {
      let open!: () => void;
      visibilityPause = new Promise<void>((resolve) => {
        open = resolve;
      });
      return () => {
        visibilityPause = null;
        open();
      };
    },
  };
}

const HIDDEN_INVARIANT = (store: FeedingStore, horseName: string) => {
  const hidden = store.hidden.get(horseName) === true;
  const hasProgress = store.progress.has(horseName);
  assert.ok(!(hidden && hasProgress), "a hidden horse must never carry progress");
  return { hidden, hasProgress };
};

test("41. mark and hide contend on the SAME key for the same normalized horse", async () => {
  const mark = markFake();
  const hide = visibilityFake();

  await markFeedingProgressWithDeps(mark.deps, {
    horseName: "  רקיע  ",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });
  await setHorseFeedingVisibilityWithDeps(hide.deps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });

  assert.deepEqual(mark.lockKeys, [feedingHorseLockKey("רקיע")]);
  assert.deepEqual(hide.lockKeys, [feedingHorseLockKey("רקיע")]);
  assert.equal(mark.lockKeys[0], hide.lockKeys[0], "one horse, one lock key");
  // The key is derived from the TRIMMED name, so "  רקיע  " and "רקיע" are the
  // same horse to the lock as well as to the writes.
  assert.equal(feedingHorseLockKey("רקיע"), `${FEEDING_HORSE_LOCK_NAMESPACE}רקיע`);
});

test("42. unrelated horses take DIFFERENT keys, so they are never serialized together", () => {
  assert.notEqual(feedingHorseLockKey("רקיע"), feedingHorseLockKey("סופה"));
  assert.notEqual(feedingHorseLockKey("Luna"), feedingHorseLockKey("luna"));
  // The namespace keeps a horse name from colliding with the riding-slot locks
  // that already share PostgreSQL's single advisory-lock space.
  assert.ok(feedingHorseLockKey("x").startsWith(FEEDING_HORSE_LOCK_NAMESPACE));
  assert.notEqual(feedingHorseLockKey("x"), "x");
});

test("43. the lock is taken BEFORE visibility is read, and before any other statement", async () => {
  const fake = markFake();
  await markFeedingProgressWithDeps(fake.deps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });

  assert.equal(fake.trace[0], "lock", "the lock is the first statement in the transaction");
  assert.equal(fake.trace[1], "visibility", "and the visibility read follows it");
  assert.equal(fake.transactions(), 1, "exactly one transaction per mark");

  const hide = visibilityFake();
  await setHorseFeedingVisibilityWithDeps(hide.deps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });
  assert.equal(hide.trace[0], "lock");
});

test("44. a visible horse may still be marked exactly as before", async () => {
  for (const hidden of [undefined, false]) {
    const fake = markFake({ hidden });
    const outcome = await markFeedingProgressWithDeps(fake.deps, {
      horseName: "רקיע",
      targetState: "COMPLETE",
      markedByName: "דנה",
    });

    assert.deepEqual(outcome.result, { success: true });
    assert.equal(fake.upserts.length, 1);
    assert.equal(outcome.progress?.state, "COMPLETE");
  }
});

test("45+46. marking a hidden horse writes NOTHING and returns the fixed safe error", async () => {
  for (const targetState of ["PENDING", "HAY_DONE", "COMPLETE"] as const) {
    const fake = markFake({ hidden: true });
    const outcome = await markFeedingProgressWithDeps(fake.deps, {
      horseName: "רקיע",
      targetState,
      markedByName: "דנה",
    });

    assert.deepEqual(outcome.result, { success: false, error: HIDDEN_HORSE_MARK_ERROR });
    assert.equal(outcome.progress, null);
    assert.equal(fake.upserts.length, 0, `${targetState} must not write on a hidden horse`);
    assert.equal(fake.deletes.length, 0, `${targetState} must not delete on a hidden horse`);
    assert.equal(fake.mealLookups.length, 0, "and must not even read the meals");
    assert.deepEqual(fake.trace, ["lock", "visibility"], "it stops right after the check");
  }

  // The refusal is a BUSINESS failure with a stable, PII-free Hebrew message -
  // never an authorization error and never a leaked internal detail.
  assert.equal(HIDDEN_HORSE_MARK_ERROR, "לא ניתן לסמן סוס שמוסתר מרשימת ההאכלה");
  assert.notEqual(HIDDEN_HORSE_MARK_ERROR, ADMIN_REQUIRED_ERROR);
  assert.notEqual(HIDDEN_HORSE_MARK_ERROR, INSTRUCTOR_REQUIRED_ERROR);
  assert.notEqual(HIDDEN_HORSE_MARK_ERROR, NO_FEEDING_PERMISSION_ERROR);
  assert.ok(!/@|prisma|sql|select |insert |stack|רקיע/i.test(HIDDEN_HORSE_MARK_ERROR));
});

test("47. MARK FIRST, hide second: hide waits for the lock, final state is hidden + no progress", async () => {
  const store = emptyStore();
  const world = sharedWorld(store);
  const release = world.holdMark();

  // The mark takes the lock and is held mid-transaction.
  const markDone = markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });
  await Promise.resolve();

  // The hide now asks for the SAME lock and must not proceed.
  let hideEntered = false;
  const hideDone = setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  }).then((outcome) => {
    hideEntered = true;
    return outcome;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hideEntered, false, "hide must be blocked while the mark holds the lock");
  assert.ok(
    !world.trace.includes("visibility:upsert"),
    "no visibility statement may run inside the mark's lock window",
  );

  release();
  const [markOutcome] = await Promise.all([markDone, hideDone]);

  assert.equal(markOutcome.result.success, true, "the mark itself succeeded");
  // ...and the hide that followed removed the row it had written.
  const state = HIDDEN_INVARIANT(store, "רקיע");
  assert.deepEqual(state, { hidden: true, hasProgress: false });
  assert.deepEqual(world.trace, [
    "mark:lock",
    "mark:visibility",
    "mark:upsert",
    "visibility:lock",
    "visibility:upsert",
    "visibility:delete",
  ]);
});

test("47b. THE ORIGINAL BLOCKER: a mark past its visibility check still blocks the hide", async () => {
  // Without the lock this is the exact sequence that broke the invariant: the
  // mark reads "visible", the hide commits and deletes, and the mark then
  // re-creates the row - leaving a hidden horse carrying progress. (Verified: the
  // same interleaving against a no-op lock does reproduce hidden + progress.)
  const store = emptyStore();
  const world = sharedWorld(store);
  const release = world.holdMarkAfterVisibilityRead();

  const markDone = markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    world.trace,
    ["mark:lock", "mark:visibility"],
    "the mark is past its visibility read and still holds the lock",
  );

  let hideEntered = false;
  const hideDone = setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  }).then((outcome) => {
    hideEntered = true;
    return outcome;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hideEntered, false, "the hide cannot commit inside the mark's window");

  release();
  await Promise.all([markDone, hideDone]);

  // The mark's write happened FIRST and the hide then removed it, which is the
  // only safe resolution of this order.
  assert.deepEqual(HIDDEN_INVARIANT(store, "רקיע"), { hidden: true, hasProgress: false });
  assert.ok(
    world.trace.indexOf("mark:upsert") < world.trace.indexOf("visibility:delete"),
    "the delete must come after the write it has to clean up",
  );
});

test("48. HIDE FIRST, mark second: the mark waits, then refuses - hidden + no progress", async () => {
  const store = emptyStore();
  const world = sharedWorld(store);
  const release = world.holdVisibility();

  const hideDone = setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });
  await Promise.resolve();

  let markEntered = false;
  const markDone = markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  }).then((outcome) => {
    markEntered = true;
    return outcome;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(markEntered, false, "the mark must be blocked while the hide holds the lock");
  assert.ok(!world.trace.includes("mark:visibility"), "and must not have read visibility yet");

  release();
  const [, markOutcome] = await Promise.all([hideDone, markDone]);

  assert.deepEqual(markOutcome.result, { success: false, error: HIDDEN_HORSE_MARK_ERROR });
  assert.equal(markOutcome.progress, null);
  const state = HIDDEN_INVARIANT(store, "רקיע");
  assert.deepEqual(state, { hidden: true, hasProgress: false });
  assert.ok(!world.trace.includes("mark:upsert"), "the late mark wrote nothing at all");
});

test("49. NO interleaving of these two actions can end at hidden + progress", async () => {
  // Every order, including a pre-existing mark from an earlier round.
  const scenarios: { name: string; run: (w: ReturnType<typeof sharedWorld>) => Promise<unknown> }[] = [
    {
      name: "mark then hide",
      run: async (w) => {
        await markFeedingProgressWithDeps(w.markDeps, {
          horseName: "רקיע",
          targetState: "COMPLETE",
          markedByName: "דנה",
        });
        await setHorseFeedingVisibilityWithDeps(w.visibilityDeps, {
          horseName: "רקיע",
          isHidden: true,
          updatedByName: "מנהלת",
        });
      },
    },
    {
      name: "hide then mark",
      run: async (w) => {
        await setHorseFeedingVisibilityWithDeps(w.visibilityDeps, {
          horseName: "רקיע",
          isHidden: true,
          updatedByName: "מנהלת",
        });
        await markFeedingProgressWithDeps(w.markDeps, {
          horseName: "רקיע",
          targetState: "HAY_DONE",
          markedByName: "דנה",
        });
      },
    },
    {
      name: "concurrent, mark dispatched first",
      run: (w) =>
        Promise.all([
          markFeedingProgressWithDeps(w.markDeps, {
            horseName: "רקיע",
            targetState: "COMPLETE",
            markedByName: "דנה",
          }),
          setHorseFeedingVisibilityWithDeps(w.visibilityDeps, {
            horseName: "רקיע",
            isHidden: true,
            updatedByName: "מנהלת",
          }),
        ]),
    },
    {
      name: "concurrent, hide dispatched first",
      run: (w) =>
        Promise.all([
          setHorseFeedingVisibilityWithDeps(w.visibilityDeps, {
            horseName: "רקיע",
            isHidden: true,
            updatedByName: "מנהלת",
          }),
          markFeedingProgressWithDeps(w.markDeps, {
            horseName: "רקיע",
            targetState: "COMPLETE",
            markedByName: "דנה",
          }),
        ]),
    },
    {
      name: "hide while an older round's progress row exists",
      run: async (w) => {
        await markFeedingProgressWithDeps(w.markDeps, {
          horseName: "רקיע",
          targetState: "HAY_DONE",
          markedByName: "יעל",
        });
        await Promise.all([
          setHorseFeedingVisibilityWithDeps(w.visibilityDeps, {
            horseName: "רקיע",
            isHidden: true,
            updatedByName: "מנהלת",
          }),
          markFeedingProgressWithDeps(w.markDeps, {
            horseName: "רקיע",
            targetState: "COMPLETE",
            markedByName: "דנה",
          }),
        ]);
      },
    },
  ];

  for (const scenario of scenarios) {
    const store = emptyStore();
    await scenario.run(sharedWorld(store));
    const state = HIDDEN_INVARIANT(store, "רקיע");
    assert.equal(state.hidden, true, `${scenario.name}: the horse ends hidden`);
    assert.equal(state.hasProgress, false, `${scenario.name}: with no progress row`);
  }
});

test("50+51. restore creates no progress, and a mark after it succeeds again", async () => {
  const store = emptyStore();
  const world = sharedWorld(store);

  await markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });
  await setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });
  await setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "רקיע",
    isHidden: false,
    updatedByName: "מנהלת",
  });

  // A restored horse starts at PENDING: absence of a row IS pending.
  assert.equal(store.hidden.get("רקיע"), false);
  assert.equal(store.progress.has("רקיע"), false, "restore must not resurrect a progress row");

  const outcome = await markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "HAY_DONE",
    markedByName: "דנה",
  });
  assert.deepEqual(outcome.result, { success: true });
  assert.equal(store.progress.get("רקיע")?.state, "HAY_DONE");
});

test("52. different horses are NOT serialized against each other", async () => {
  const store = emptyStore();
  const world = sharedWorld(store);
  const release = world.holdMark();

  // רקיע holds its own lock...
  const held = markFeedingProgressWithDeps(world.markDeps, {
    horseName: "רקיע",
    targetState: "COMPLETE",
    markedByName: "דנה",
  });
  await Promise.resolve();

  // ...while hiding a DIFFERENT horse completes immediately.
  const other = await setHorseFeedingVisibilityWithDeps(world.visibilityDeps, {
    horseName: "סופה",
    isHidden: true,
    updatedByName: "מנהלת",
  });
  assert.deepEqual(other.result, { success: true }, "an unrelated horse must not wait");
  assert.equal(store.hidden.get("סופה"), true);

  release();
  await held;
  assert.equal(store.progress.get("רקיע")?.state, "COMPLETE");
  assert.deepEqual(world.lockAcquisitions, [
    feedingHorseLockKey("רקיע"),
    feedingHorseLockKey("סופה"),
  ]);
});

test("53. an invalid request takes no lock and opens no transaction", async () => {
  for (const command of [
    { horseName: "   ", targetState: "COMPLETE" as const },
    { horseName: "רקיע", targetState: "COMPLETED" as unknown as FeedingProgressState },
  ]) {
    const fake = markFake();
    const outcome = await markFeedingProgressWithDeps(fake.deps, {
      ...command,
      markedByName: "דנה",
    });

    assert.equal(outcome.result.success, false);
    assert.equal(fake.transactions(), 0, "validation precedes the transaction entirely");
    assert.deepEqual(fake.lockKeys, []);
  }

  const hide = visibilityFake();
  await setHorseFeedingVisibilityWithDeps(hide.deps, {
    horseName: "  ",
    isHidden: true,
    updatedByName: "מנהלת",
  });
  assert.deepEqual(hide.lockKeys, [], "a rejected visibility request takes no lock either");
});

// ===========================================================================
// 54-59. SOURCE CONTRACT for the real Prisma implementation of the lock
// ===========================================================================

test("54+55. the real lock is transaction-scoped and PARAMETERIZED, never interpolated", () => {
  const helper = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("function acquireHorseLockIn"),
    ACTIONS_CODE.indexOf("const markProgressIo"),
  );

  // pg_advisory_xact_lock is released automatically at commit/rollback - there is
  // no session-scoped variant anywhere that could leak on a pooled connection.
  assert.match(helper, /tx\.\$executeRaw`SELECT pg_advisory_xact_lock\(hashtext\(\$\{lockKey\}\)\)`/);
  for (const forbidden of [
    "pg_advisory_lock(",
    "pg_advisory_unlock",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
  ]) {
    assert.ok(!ACTIONS_CODE.includes(forbidden), `${forbidden} must not be used`);
  }
  // The only value in the SQL is the derived key, bound by the tagged template;
  // no horse name is ever concatenated into the statement.
  assert.ok(!/pg_advisory_xact_lock\([^`]*horseName/.test(ACTIONS_CODE));
  assert.ok(!/hashtext\('/.test(ACTIONS_CODE), "no literal is spliced into the lock key");
});

test("56. both ports take the lock, through the one shared helper", () => {
  const markPort = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("const markProgressIo"),
    ACTIONS_CODE.indexOf("const clearProgressIo"),
  );
  const visibilityPort = ACTIONS_CODE.slice(
    ACTIONS_CODE.indexOf("const visibilityIo"),
    ACTIONS_CODE.indexOf("export async function markHorseFeedingProgressAsAdmin"),
  );

  for (const port of [markPort, visibilityPort]) {
    assert.match(port, /acquireHorseLock: acquireHorseLockIn\(tx\)/);
    assert.match(port, /prisma\.\$transaction\(\(tx\) =>/);
  }
  // Exactly one place issues the lock statement.
  assert.equal(
    (ACTIONS_CODE.match(/pg_advisory_xact_lock/g) ?? []).length,
    1,
    "only the shared helper takes the lock",
  );
  // Every mark statement runs on the transaction client, never the global one.
  assert.ok(!/\bprisma\.horseFeeding/.test(markPort), "no global-client read/write inside the tx");
  assert.match(markPort, /tx\.horseFeedingVisibility\.findUnique/);
});

test("57. the lock key derivation is shared and is not re-implemented in the action module", () => {
  assert.ok(
    !ACTIONS_CODE.includes("FEEDING_HORSE_LOCK_NAMESPACE"),
    "the action module receives the derived key; it does not build one",
  );
  assert.ok(
    IO_CODE.includes("export function feedingHorseLockKey"),
    "the single derivation lives in the DB-free module",
  );
  // ...and both mutators call it, so they cannot drift apart.
  assert.equal(
    (IO_CODE.match(/feedingHorseLockKey\(horseName\)/g) ?? []).length,
    2,
    "the mark path and the visibility path derive the key identically",
  );
});

test("58. no new Server Action or exported helper appeared on the public surface", () => {
  const exportedFunctions = [...ACTIONS_CODE.matchAll(/export (async )?function (\w+)/g)];

  for (const [, isAsync, name] of exportedFunctions) {
    assert.ok(isAsync, `exported function ${name} must be async`);
  }
  assert.ok(
    !ACTIONS_CODE.includes("export function acquireHorseLockIn"),
    "the lock helper must stay module-private",
  );
  assert.ok(!/^export const /m.test(ACTIONS_CODE));
});

test("59. the authorization order is unchanged - the gate still precedes the lock", () => {
  for (const name of ["markHorseFeedingProgressAsAdmin", "setHorseFeedingVisibilityAsAdmin"]) {
    const body = functionBody(ACTIONS_CODE, name);
    const gate = body.indexOf("requireAdmin()");
    const delegation = body.indexOf("WithDeps(");
    assert.ok(gate !== -1 && gate < delegation, `${name}: requireAdmin still runs first`);
  }
  const instructorMark = functionBody(ACTIONS_CODE, "markHorseFeedingProgressAsInstructor");
  assert.match(instructorMark, /getCurrentInstructor,/);
  assert.ok(!instructorMark.includes("prisma."), "no direct query in the action body");
});
