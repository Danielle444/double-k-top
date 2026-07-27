/**
 * FEEDING-BOARD Stage 3 - focused behavioural tests for the feeding progress /
 * visibility authorization orchestration (lib/actions/horse-feeding-progress-auth.ts).
 *
 * These exercise the dependency-injected orchestration with plain fakes, so no
 * Next.js cookies and no live Prisma are needed. They lock the Stage 3 contract:
 *  - marking and clearing are allowed for an admin OR an instructor holding
 *    canEditHorseFeeding, and for nobody else;
 *  - hiding/restoring a horse is ADMIN-ONLY and has no instructor entry point at
 *    all - not even a private one;
 *  - a missing actor, an explicitly inactive actor, and a THROWN resolver all
 *    fail closed to the same stable, PII-free error, and the mutator is never
 *    invoked on any of them;
 *  - authorship is always server-derived (admin name, else admin email;
 *    instructor fullName) and no public request type has an actor field a caller
 *    could populate;
 *  - on success the mutator runs exactly once and its result is returned
 *    unchanged.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/horse-feeding-progress-auth.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ADMIN_REQUIRED_ERROR,
  INSTRUCTOR_REQUIRED_ERROR,
  NO_FEEDING_PERMISSION_ERROR,
  clearAllHorseFeedingProgressAsAdminWithDeps,
  clearAllHorseFeedingProgressAsInstructorWithDeps,
  markHorseFeedingProgressAsAdminWithDeps,
  markHorseFeedingProgressAsInstructorWithDeps,
  setHorseFeedingVisibilityAsAdminWithDeps,
  type FeedingAdminActor,
  type FeedingInstructorActor,
  type FeedingProgressClearCommand,
  type FeedingProgressMarkCommand,
  type FeedingProgressMarkRequest,
  type HorseFeedingVisibilityCommand,
  type HorseFeedingVisibilityRequest,
} from "./horse-feeding-progress-auth";
import * as progressAuthModule from "./horse-feeding-progress-auth";
import type { ActionResult } from "./students";

// --- fixtures ---------------------------------------------------------------

const MARK_REQUEST: FeedingProgressMarkRequest = { horseName: "רקיע", targetState: "HAY_DONE" };
const HIDE_REQUEST: HorseFeedingVisibilityRequest = { horseName: "רקיע", isHidden: true };
const RESTORE_REQUEST: HorseFeedingVisibilityRequest = { horseName: "רקיע", isHidden: false };

const OK: ActionResult = { success: true };

const ADMIN: FeedingAdminActor = { name: "מנהלת", email: "dk@example.com" };
const EDITOR: FeedingInstructorActor = { canEditHorseFeeding: true, fullName: "דנה" };

/** A mutator that fails the test if it is ever reached. */
function forbiddenMutator(): never {
  throw new Error("mutator must not be reached on denial");
}

/** Records every command it receives so call count and payload can be asserted. */
function recordingMutator<T>() {
  const commands: T[] = [];
  return {
    commands,
    fn: async (command: T): Promise<ActionResult> => {
      commands.push(command);
      return OK;
    },
  };
}

async function throwingResolver(): Promise<never> {
  throw new Error("session infrastructure failure");
}

// ===========================================================================
// A. mark progress as admin
// ===========================================================================

test("1. admin mark: a missing admin is rejected and the mutator is never called", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsAdminWithDeps(
    { resolveCurrentAdmin: async () => null, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("2. admin mark: a THROWN resolver fails closed to the same error, no mutation", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsAdminWithDeps(
    { resolveCurrentAdmin: throwingResolver, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0, "a thrown resolution must not reach the mutator");
});

test("2b. admin mark: an explicitly inactive admin is rejected", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsAdminWithDeps(
    {
      resolveCurrentAdmin: async () => ({ ...ADMIN, isActive: false }),
      markProgress: mutator.fn,
    },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("3. admin mark: a valid admin reaches the mutator exactly once", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsAdminWithDeps(
    { resolveCurrentAdmin: async () => ADMIN, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, OK);
  assert.equal(mutator.commands.length, 1);
});

test("4. admin mark: the admin's name is preferred as authorship", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  await markHorseFeedingProgressAsAdminWithDeps(
    { resolveCurrentAdmin: async () => ADMIN, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.equal(mutator.commands[0].markedByName, "מנהלת");
});

test("5. admin mark: the email is the fallback when the name is missing or blank", async () => {
  for (const name of [null, "", "   "]) {
    const mutator = recordingMutator<FeedingProgressMarkCommand>();
    await markHorseFeedingProgressAsAdminWithDeps(
      {
        resolveCurrentAdmin: async () => ({ name, email: "dk@example.com" }),
        markProgress: mutator.fn,
      },
      MARK_REQUEST,
    );

    assert.equal(mutator.commands[0].markedByName, "dk@example.com", `name=${JSON.stringify(name)}`);
  }
});

// ===========================================================================
// B. mark progress as instructor
// ===========================================================================

test("6. instructor mark: a missing actor is rejected and never mutates", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    { getCurrentInstructor: async () => null, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: INSTRUCTOR_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("7. instructor mark: a THROWN resolver fails closed, no mutation", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    { getCurrentInstructor: throwingResolver, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: INSTRUCTOR_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("8. instructor mark: canEditHorseFeeding false is rejected with the permission error", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    {
      getCurrentInstructor: async () => ({ canEditHorseFeeding: false, fullName: "בלי הרשאה" }),
      markProgress: mutator.fn,
    },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: NO_FEEDING_PERMISSION_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("8b. instructor mark: a non-boolean permission value never authorizes", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    {
      getCurrentInstructor: async () =>
        ({ canEditHorseFeeding: "true", fullName: "מתחזה" } as unknown as FeedingInstructorActor),
      markProgress: mutator.fn,
    },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: NO_FEEDING_PERMISSION_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("9. instructor mark: an explicitly inactive instructor is rejected even with the permission", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    {
      getCurrentInstructor: async () => ({ ...EDITOR, isActive: false }),
      markProgress: mutator.fn,
    },
    MARK_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: INSTRUCTOR_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("10. instructor mark: a valid feeding editor reaches the mutator exactly once", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  const result = await markHorseFeedingProgressAsInstructorWithDeps(
    { getCurrentInstructor: async () => EDITOR, markProgress: mutator.fn },
    MARK_REQUEST,
  );

  assert.deepEqual(result, OK);
  assert.equal(mutator.commands.length, 1);
});

test("11. instructor mark: authorship is the resolved fullName, never a caller value", async () => {
  const mutator = recordingMutator<FeedingProgressMarkCommand>();
  // A caller attempting to smuggle authorship: the extra field is not part of
  // FeedingProgressMarkRequest, and the derived name must win regardless.
  const spoofed = {
    ...MARK_REQUEST,
    markedByName: "מנהלת",
    fullName: "מנהלת",
  } as unknown as FeedingProgressMarkRequest;

  await markHorseFeedingProgressAsInstructorWithDeps(
    { getCurrentInstructor: async () => EDITOR, markProgress: mutator.fn },
    spoofed,
  );

  assert.equal(mutator.commands[0].markedByName, "דנה");
  assert.deepEqual(Object.keys(mutator.commands[0]).sort(), [
    "horseName",
    "markedByName",
    "targetState",
  ]);
});

// ===========================================================================
// C + D. clear the whole board
// ===========================================================================

test("12. admin clear: missing actor, inactive actor and thrown resolver all fail closed", async () => {
  const resolvers: (() => Promise<FeedingAdminActor | null>)[] = [
    async () => null,
    async () => ({ ...ADMIN, isActive: false }),
    throwingResolver,
  ];

  for (const resolveCurrentAdmin of resolvers) {
    const mutator = recordingMutator<FeedingProgressClearCommand>();
    const result = await clearAllHorseFeedingProgressAsAdminWithDeps({
      resolveCurrentAdmin,
      clearAllProgress: mutator.fn,
    });

    assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
    assert.equal(mutator.commands.length, 0);
  }
});

test("12b. admin clear: a valid admin clears once, with derived authorship", async () => {
  const mutator = recordingMutator<FeedingProgressClearCommand>();
  const result = await clearAllHorseFeedingProgressAsAdminWithDeps({
    resolveCurrentAdmin: async () => ADMIN,
    clearAllProgress: mutator.fn,
  });

  assert.deepEqual(result, OK);
  assert.equal(mutator.commands.length, 1);
  assert.deepEqual(mutator.commands[0], { clearedByName: "מנהלת" });
});

test("13. instructor clear: identity and permission are enforced exactly as for marking", async () => {
  const cases: {
    actor: FeedingInstructorActor | null;
    error: string;
  }[] = [
    { actor: null, error: INSTRUCTOR_REQUIRED_ERROR },
    { actor: { ...EDITOR, isActive: false }, error: INSTRUCTOR_REQUIRED_ERROR },
    { actor: { canEditHorseFeeding: false, fullName: "בלי הרשאה" }, error: NO_FEEDING_PERMISSION_ERROR },
  ];

  for (const { actor, error } of cases) {
    const mutator = recordingMutator<FeedingProgressClearCommand>();
    const result = await clearAllHorseFeedingProgressAsInstructorWithDeps({
      getCurrentInstructor: async () => actor,
      clearAllProgress: mutator.fn,
    });

    assert.deepEqual(result, { success: false, error });
    assert.equal(mutator.commands.length, 0);
  }

  const thrown = recordingMutator<FeedingProgressClearCommand>();
  assert.deepEqual(
    await clearAllHorseFeedingProgressAsInstructorWithDeps({
      getCurrentInstructor: throwingResolver,
      clearAllProgress: thrown.fn,
    }),
    { success: false, error: INSTRUCTOR_REQUIRED_ERROR },
  );
  assert.equal(thrown.commands.length, 0);
});

test("13b. instructor clear: a valid feeding editor clears once, with derived authorship", async () => {
  const mutator = recordingMutator<FeedingProgressClearCommand>();
  const result = await clearAllHorseFeedingProgressAsInstructorWithDeps({
    getCurrentInstructor: async () => EDITOR,
    clearAllProgress: mutator.fn,
  });

  assert.deepEqual(result, OK);
  assert.equal(mutator.commands.length, 1);
  assert.deepEqual(mutator.commands[0], { clearedByName: "דנה" });
});

// ===========================================================================
// E. hide / restore (ADMIN ONLY)
// ===========================================================================

test("14. visibility: a valid admin hides once, with derived authorship", async () => {
  const mutator = recordingMutator<HorseFeedingVisibilityCommand>();
  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    { resolveCurrentAdmin: async () => ADMIN, setVisibility: mutator.fn },
    HIDE_REQUEST,
  );

  assert.deepEqual(result, OK);
  assert.equal(mutator.commands.length, 1);
  assert.deepEqual(mutator.commands[0], {
    horseName: "רקיע",
    isHidden: true,
    updatedByName: "מנהלת",
  });
});

test("15. visibility: a missing admin is rejected and never mutates", async () => {
  const mutator = recordingMutator<HorseFeedingVisibilityCommand>();
  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    { resolveCurrentAdmin: async () => null, setVisibility: mutator.fn },
    HIDE_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("16. visibility: a THROWN admin resolver fails closed, no mutation", async () => {
  const mutator = recordingMutator<HorseFeedingVisibilityCommand>();
  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    { resolveCurrentAdmin: throwingResolver, setVisibility: mutator.fn },
    HIDE_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("16b. visibility: an explicitly inactive admin is rejected", async () => {
  const mutator = recordingMutator<HorseFeedingVisibilityCommand>();
  const result = await setHorseFeedingVisibilityAsAdminWithDeps(
    {
      resolveCurrentAdmin: async () => ({ ...ADMIN, isActive: false }),
      setVisibility: mutator.fn,
    },
    HIDE_REQUEST,
  );

  assert.deepEqual(result, { success: false, error: ADMIN_REQUIRED_ERROR });
  assert.equal(mutator.commands.length, 0);
});

test("17. no instructor-callable visibility helper is exported", () => {
  const visibilityExports = Object.keys(progressAuthModule).filter((name) =>
    /visibility/i.test(name),
  );

  assert.deepEqual(visibilityExports, ["setHorseFeedingVisibilityAsAdminWithDeps"]);

  for (const name of Object.keys(progressAuthModule)) {
    assert.ok(
      !(/visibility/i.test(name) && /instructor/i.test(name)),
      `an instructor visibility export must not exist: ${name}`,
    );
  }

  // The source itself must contain no instructor visibility path at all - not
  // even a private one an later stage could accidentally export.
  assert.ok(
    !/[Ii]nstructor[A-Za-z]*[Vv]isibility|[Vv]isibility[A-Za-z]*[Ii]nstructor/.test(CORE_CODE),
    "no instructor visibility function may exist, public or private",
  );
  assert.ok(
    !/canEditHorseFeeding/.test(splitVisibilitySection(CORE_CODE)),
    "the visibility entry point must not consult canEditHorseFeeding",
  );
});

test("21. visibility: isHidden false is the RESTORE path and uses the same admin gate", async () => {
  const mutator = recordingMutator<HorseFeedingVisibilityCommand>();
  const allowed = await setHorseFeedingVisibilityAsAdminWithDeps(
    { resolveCurrentAdmin: async () => ADMIN, setVisibility: mutator.fn },
    RESTORE_REQUEST,
  );

  assert.deepEqual(allowed, OK);
  assert.equal(mutator.commands[0].isHidden, false);

  // Restore is never less protected than hide.
  const denied = recordingMutator<HorseFeedingVisibilityCommand>();
  assert.deepEqual(
    await setHorseFeedingVisibilityAsAdminWithDeps(
      { resolveCurrentAdmin: async () => null, setVisibility: denied.fn },
      RESTORE_REQUEST,
    ),
    { success: false, error: ADMIN_REQUIRED_ERROR },
  );
  assert.equal(denied.commands.length, 0);
});

// ===========================================================================
// Cross-cutting contract
// ===========================================================================

test("18. every rejected path leaves the mutator untouched (ordering proof)", async () => {
  // The mutators here THROW if reached: any denial that returned a result rather
  // than surfacing that throw proves authorization completed first.
  const badAdmins: (() => Promise<FeedingAdminActor | null>)[] = [
    async () => null,
    async () => ({ ...ADMIN, isActive: false }),
    throwingResolver,
  ];
  const badInstructors: (() => Promise<FeedingInstructorActor | null>)[] = [
    async () => null,
    async () => ({ ...EDITOR, isActive: false }),
    async () => ({ canEditHorseFeeding: false, fullName: "x" }),
    throwingResolver,
  ];

  for (const resolveCurrentAdmin of badAdmins) {
    assert.equal(
      (
        await markHorseFeedingProgressAsAdminWithDeps(
          { resolveCurrentAdmin, markProgress: forbiddenMutator },
          MARK_REQUEST,
        )
      ).success,
      false,
    );
    assert.equal(
      (
        await clearAllHorseFeedingProgressAsAdminWithDeps({
          resolveCurrentAdmin,
          clearAllProgress: forbiddenMutator,
        })
      ).success,
      false,
    );
    assert.equal(
      (
        await setHorseFeedingVisibilityAsAdminWithDeps(
          { resolveCurrentAdmin, setVisibility: forbiddenMutator },
          HIDE_REQUEST,
        )
      ).success,
      false,
    );
  }

  for (const getCurrentInstructor of badInstructors) {
    assert.equal(
      (
        await markHorseFeedingProgressAsInstructorWithDeps(
          { getCurrentInstructor, markProgress: forbiddenMutator },
          MARK_REQUEST,
        )
      ).success,
      false,
    );
    assert.equal(
      (
        await clearAllHorseFeedingProgressAsInstructorWithDeps({
          getCurrentInstructor,
          clearAllProgress: forbiddenMutator,
        })
      ).success,
      false,
    );
  }
});

test("19. an authorized call returns the mutator's result unchanged, including failures", async () => {
  const failure: ActionResult = { success: false, error: "transaction failed" };
  const result = await markHorseFeedingProgressAsAdminWithDeps(
    { resolveCurrentAdmin: async () => ADMIN, markProgress: async () => failure },
    MARK_REQUEST,
  );

  assert.equal(result, failure, "the mutator result object is returned by reference");
});

test("19b. a genuine mutator error propagates (authorization does not swallow it)", async () => {
  await assert.rejects(
    () =>
      markHorseFeedingProgressAsInstructorWithDeps(
        {
          getCurrentInstructor: async () => EDITOR,
          markProgress: async () => {
            throw new Error("transaction failed");
          },
        },
        MARK_REQUEST,
      ),
    /transaction failed/,
  );
});

test("20. the requested target state and horse name pass through unchanged", async () => {
  for (const targetState of ["PENDING", "HAY_DONE", "COMPLETE"] as const) {
    const mutator = recordingMutator<FeedingProgressMarkCommand>();
    await markHorseFeedingProgressAsInstructorWithDeps(
      { getCurrentInstructor: async () => EDITOR, markProgress: mutator.fn },
      { horseName: "בר כוכבא", targetState },
    );

    assert.equal(mutator.commands[0].targetState, targetState);
    assert.equal(mutator.commands[0].horseName, "בר כוכבא");
  }
});

test("22. no public orchestration accepts an actor id / name / email parameter", () => {
  // Arity guard (secondary evidence): each entry point takes its deps object plus
  // at most one request payload - there is no positional actor slot anywhere.
  assert.equal(markHorseFeedingProgressAsAdminWithDeps.length, 2);
  assert.equal(markHorseFeedingProgressAsInstructorWithDeps.length, 2);
  assert.equal(clearAllHorseFeedingProgressAsAdminWithDeps.length, 1);
  assert.equal(clearAllHorseFeedingProgressAsInstructorWithDeps.length, 1);
  assert.equal(setHorseFeedingVisibilityAsAdminWithDeps.length, 2);

  // Primary evidence: the request types themselves have no identity field, so a
  // caller cannot express one. (The spoofing attempt in test 11 proves the
  // runtime behaviour; this locks the declared shape.)
  const requestTypes = CORE_SOURCE.match(
    /export interface (?:FeedingProgressMarkRequest|HorseFeedingVisibilityRequest) \{[\s\S]*?\n\}/g,
  );
  assert.equal(requestTypes?.length, 2, "both request interfaces must exist");
  for (const declaration of requestTypes ?? []) {
    for (const forbidden of ["markedByName", "updatedByName", "clearedByName", "email", "Id:", "fullName"]) {
      assert.ok(
        !declaration.includes(forbidden),
        `a client request type must not carry ${forbidden}`,
      );
    }
  }
});

test("24. the fail-closed errors are stable, distinct and PII-free", () => {
  const errors = [ADMIN_REQUIRED_ERROR, INSTRUCTOR_REQUIRED_ERROR, NO_FEEDING_PERMISSION_ERROR];

  assert.equal(new Set(errors).size, 3, "the three tiers must be distinguishable");
  for (const error of errors) {
    assert.ok(error.trim().length > 0);
    assert.ok(!/@|\bid\b|prisma|session|secret|cookie|token|stack|error:/i.test(error), error);
  }
  // Identical wording to the pre-existing feeding permission rejection, so the
  // UI shows one single string for "you lack canEditHorseFeeding".
  assert.equal(NO_FEEDING_PERMISSION_ERROR, "אין הרשאה לערוך האכלות");
});

test("25. a thrown resolver never reaches the mutator, for every entry point", async () => {
  // Same ordering proof as test 18, isolated to the infra-failure case: the
  // mutator throws if reached, so returning a denial result proves the catch is
  // scoped to resolution and that resolution happens first.
  assert.equal(
    (
      await markHorseFeedingProgressAsAdminWithDeps(
        { resolveCurrentAdmin: throwingResolver, markProgress: forbiddenMutator },
        MARK_REQUEST,
      )
    ).error,
    ADMIN_REQUIRED_ERROR,
  );
  assert.equal(
    (
      await markHorseFeedingProgressAsInstructorWithDeps(
        { getCurrentInstructor: throwingResolver, markProgress: forbiddenMutator },
        MARK_REQUEST,
      )
    ).error,
    INSTRUCTOR_REQUIRED_ERROR,
  );
  assert.equal(
    (
      await setHorseFeedingVisibilityAsAdminWithDeps(
        { resolveCurrentAdmin: throwingResolver, setVisibility: forbiddenMutator },
        HIDE_REQUEST,
      )
    ).error,
    ADMIN_REQUIRED_ERROR,
  );
});

// ===========================================================================
// 23. Source-level purity contract
//
// Same convention as horse-feeding-auth.test.ts: the behavioural DI tests above
// are the primary proof; these source checks confirm the module stays a plain,
// unreachable-from-the-browser library. Comments legitimately NAME the things
// the code must not depend on, so token scans run on the executable source only.
// ===========================================================================

const CORE_SOURCE = readFileSync(
  fileURLToPath(new URL("./horse-feeding-progress-auth.ts", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CORE_CODE = stripComments(CORE_SOURCE);

/** The visibility entry point's body, for the "no permission check" assertion. */
function splitVisibilitySection(code: string): string {
  const start = code.indexOf("export async function setHorseFeedingVisibilityAsAdminWithDeps");
  return start === -1 ? "" : code.slice(start);
}

test("23. the module is a pure orchestration (no use-server / prisma / next / auth)", () => {
  assert.ok(
    !/^\s*["']use server["']\s*;?\s*$/m.test(CORE_SOURCE),
    "must not be a Server Action module",
  );
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(CORE_CODE), "must not import prisma");
  assert.ok(!/@prisma\/client|app\/generated/.test(CORE_CODE), "must not import generated Prisma types");
  assert.ok(!/from ["']next\//.test(CORE_CODE), "must not import any next/* module");
  assert.ok(!/from ["']@\/auth["']|@\/lib\/auth\/session|next\/headers|cookies\(/.test(CORE_CODE),
    "must not import auth / session / cookies");
  assert.ok(!/\brequire\s*\(/.test(CORE_CODE), "must not use require()");
  assert.ok(!/\bprisma\./.test(CORE_CODE), "must not perform a Prisma query");
});

test("23b. every import in the module is type-only (erased at runtime)", () => {
  const imports = CORE_CODE.match(/^\s*import\s[^;]*;/gm) ?? [];

  assert.ok(imports.length > 0, "expected the type-only imports to be present");
  for (const statement of imports) {
    assert.match(statement, /^\s*import type\s/, `runtime import found: ${statement.trim()}`);
  }
});

test("23c. the module performs no clock, randomness or environment access", () => {
  assert.ok(!/\bnew Date\b|\bDate\.now\b/.test(CORE_CODE), "must not read the clock");
  assert.ok(!/\bMath\.random\b/.test(CORE_CODE), "must not use randomness");
  assert.ok(!/\bprocess\.env\b/.test(CORE_CODE), "must not read the environment");
});

test("23d. the catch blocks are scoped to actor resolution only", () => {
  // Each of the two authorize* helpers holds exactly one try/catch, and both
  // wrap a resolver call - never a mutator call. A mutator invoked inside a try
  // would silently convert a real write failure into an authorization denial.
  const tryBlocks = CORE_CODE.match(/try\s*\{[\s\S]*?\}\s*catch/g) ?? [];

  assert.equal(tryBlocks.length, 2, "exactly two resolution catches are expected");
  for (const block of tryBlocks) {
    assert.match(block, /await resolve\(\)/, "a catch must wrap only the resolver call");
    assert.ok(
      !/markProgress|clearAllProgress|setVisibility/.test(block),
      "a mutator must never be called inside a try/catch",
    );
  }
});
