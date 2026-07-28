/**
 * RIDING PROGRESS COURSE SCOPE - SLICE S1 tests for the PURE write-time
 * course-scope core, plus the source-scan containment guarantees (purity, no
 * course inference, no update/re-file resolver, no runtime importer yet).
 *
 * Run with: npx tsx --test lib/course/riding-progress-course-scope-core.test.ts
 * No Prisma, no DB, no clock, no randomness - the core takes already-fetched
 * rows and returns a decision.
 *
 * The offering ids used here are deliberately FAKE ("offering-l1"/"offering-l2"):
 * this core must behave identically for any ids, and no real production offering
 * id belongs in a decision that must never be keyed by one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildRidingProgressCourseChoice,
  buildRidingProgressCourseOptions,
  composeRidingProgressCourseOptionLabel,
  resolveRidingProgressCourseOfferingIdForCreate,
  ridingProgressCourseRefusalMessage,
  RIDING_PROGRESS_COURSE_REFUSAL_MESSAGES,
} from "./riding-progress-course-scope-core";
import type { TraineeEnrollmentOfferingRow } from "./actor-course-offering-core";
import type { CourseOfferingRow } from "./current-offering-core";

const L1 = "offering-l1";
const L2 = "offering-l2";
const OUTSIDE = "offering-not-mine";

function offering(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: id === L2 ? "קורס מדריכים – רמה 2" : "קורס מדריכים – רמה 1",
    level: id === L2 ? 2 : 1,
    startDate: null,
    endDate: null,
    status: "ACTIVE",
    ...overrides,
  };
}

function enrollment(
  id: string,
  overrides: Partial<TraineeEnrollmentOfferingRow> = {},
  offeringOverrides: Partial<CourseOfferingRow> = {},
): TraineeEnrollmentOfferingRow {
  return {
    enrollmentId: `enr-${id}`,
    enrollmentStatus: "ACTIVE",
    offering: offering(id, offeringOverrides),
    ...overrides,
  };
}

const SINGLE: TraineeEnrollmentOfferingRow[] = [enrollment(L1)];
const DUAL: TraineeEnrollmentOfferingRow[] = [enrollment(L1), enrollment(L2)];

// ---------------------------------------------------------------------------
// Case 1 - zero valid offerings -> none / blocked
// ---------------------------------------------------------------------------

test("zero eligible offerings yields kind 'none'", () => {
  assert.deepEqual(buildRidingProgressCourseChoice([]), { kind: "none" });
  assert.deepEqual(buildRidingProgressCourseOptions([]), []);
});

test("zero eligible offerings refuses a create, scoped or unscoped", () => {
  for (const requested of [undefined, null, L1]) {
    const result = resolveRidingProgressCourseOfferingIdForCreate(requested, []);
    assert.deepEqual(result, { ok: false, reason: "NO_ELIGIBLE_COURSE" });
  }
});

test("a refusal never carries a course offering id", () => {
  const result = resolveRidingProgressCourseOfferingIdForCreate(L1, []);
  assert.equal(result.ok, false);
  assert.ok(!("courseOfferingId" in result), "a refused create must not leak an id");
});

// ---------------------------------------------------------------------------
// Case 2 - exactly one valid offering -> auto-selected server-side
// ---------------------------------------------------------------------------

test("exactly one eligible offering yields kind 'auto' with that option", () => {
  const choice = buildRidingProgressCourseChoice(SINGLE);
  assert.equal(choice.kind, "auto");
  assert.equal(choice.kind === "auto" ? choice.option.id : null, L1);
  assert.equal(choice.kind === "auto" ? choice.option.level : null, 1);
});

test("one eligible offering auto-selects when no course is stated", () => {
  for (const requested of [undefined, null]) {
    assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(requested, SINGLE), {
      ok: true,
      courseOfferingId: L1,
    });
  }
});

test("one eligible offering still validates an explicitly stated course", () => {
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L1, SINGLE), {
    ok: true,
    courseOfferingId: L1,
  });
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L2, SINGLE), {
    ok: false,
    reason: "COURSE_NOT_ELIGIBLE",
  });
});

// ---------------------------------------------------------------------------
// Case 3 - two or more valid offerings -> explicit choice required
// ---------------------------------------------------------------------------

test("two eligible offerings yield kind 'choose' with both options", () => {
  const choice = buildRidingProgressCourseChoice(DUAL);
  assert.equal(choice.kind, "choose");
  assert.deepEqual(choice.kind === "choose" ? choice.options.map((o) => o.id) : [], [L1, L2]);
});

test("a dual-enrolled trainee refuses a create with no course stated - the server never picks", () => {
  for (const requested of [undefined, null]) {
    assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(requested, DUAL), {
      ok: false,
      reason: "COURSE_CHOICE_REQUIRED",
    });
  }
});

test("a dual-enrolled trainee can file under either stated course", () => {
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L1, DUAL), {
    ok: true,
    courseOfferingId: L1,
  });
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L2, DUAL), {
    ok: true,
    courseOfferingId: L2,
  });
});

// ---------------------------------------------------------------------------
// Case 4 - exact submitted-id validation
// ---------------------------------------------------------------------------

test("a stated course outside the trainee's eligible set is refused", () => {
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(OUTSIDE, DUAL), {
    ok: false,
    reason: "COURSE_NOT_ELIGIBLE",
  });
});

test("matching is exact - no trimming, case folding or prefix matching", () => {
  const near = [` ${L1}`, `${L1} `, L1.toUpperCase(), L1.slice(0, -1), `${L1}x`, ""];
  for (const requested of near) {
    assert.deepEqual(
      resolveRidingProgressCourseOfferingIdForCreate(requested, DUAL),
      { ok: false, reason: "COURSE_NOT_ELIGIBLE" },
      `"${requested}" must not match`,
    );
  }
});

test("a non-string stated value counts as STATED and is refused, never treated as omitted", () => {
  const malformed = [0, 1, {}, [], true, false, NaN];
  for (const requested of malformed) {
    assert.deepEqual(
      resolveRidingProgressCourseOfferingIdForCreate(requested as unknown as string, DUAL),
      { ok: false, reason: "COURSE_NOT_ELIGIBLE" },
      `${String(requested)} must be refused, not auto-resolved`,
    );
  }
});

test("the accepted id is the server's own matched copy, not the caller's string", () => {
  const requested = String(L2);
  const result = resolveRidingProgressCourseOfferingIdForCreate(requested, DUAL);
  assert.equal(result.ok, true);
  const accepted = result.ok ? result.courseOfferingId : null;
  assert.equal(accepted, DUAL[1].offering.id);
  assert.equal(accepted, buildRidingProgressCourseOptions(DUAL)[1].id);
});

// ---------------------------------------------------------------------------
// Case 5 - duplicate enrollment rows for the same offering are deduped
// ---------------------------------------------------------------------------

test("two ACTIVE enrollments into the SAME offering is one course, and auto-selects", () => {
  const rows = [
    enrollment(L1, { enrollmentId: "enr-a" }),
    enrollment(L1, { enrollmentId: "enr-b" }),
  ];
  assert.deepEqual(buildRidingProgressCourseOptions(rows).map((o) => o.id), [L1]);
  assert.equal(buildRidingProgressCourseChoice(rows).kind, "auto");
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(undefined, rows), {
    ok: true,
    courseOfferingId: L1,
  });
});

test("duplicates across two distinct offerings still yield exactly two options", () => {
  const rows = [
    enrollment(L2, { enrollmentId: "enr-a" }),
    enrollment(L1, { enrollmentId: "enr-b" }),
    enrollment(L2, { enrollmentId: "enr-c" }),
    enrollment(L1, { enrollmentId: "enr-d" }),
  ];
  assert.deepEqual(buildRidingProgressCourseOptions(rows).map((o) => o.id), [L1, L2]);
});

// ---------------------------------------------------------------------------
// Case 6 - inactive enrollment / non-ACTIVE offering are never options
// ---------------------------------------------------------------------------

test("an INACTIVE enrollment is never an option", () => {
  const rows = [enrollment(L1), enrollment(L2, { enrollmentStatus: "INACTIVE" })];
  assert.deepEqual(buildRidingProgressCourseOptions(rows).map((o) => o.id), [L1]);
  assert.equal(buildRidingProgressCourseChoice(rows).kind, "auto");
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L2, rows), {
    ok: false,
    reason: "COURSE_NOT_ELIGIBLE",
  });
});

test("a PLANNED or ARCHIVED offering is never an option", () => {
  for (const status of ["PLANNED", "ARCHIVED"] as const) {
    const rows = [enrollment(L1), enrollment(L2, {}, { status })];
    assert.deepEqual(
      buildRidingProgressCourseOptions(rows).map((o) => o.id),
      [L1],
      `${status} offering must be excluded`,
    );
    assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(L2, rows), {
      ok: false,
      reason: "COURSE_NOT_ELIGIBLE",
    });
  }
});

test("only INACTIVE enrollments, or only non-ACTIVE offerings, collapse to 'none'", () => {
  assert.equal(
    buildRidingProgressCourseChoice([enrollment(L1, { enrollmentStatus: "INACTIVE" })]).kind,
    "none",
  );
  assert.equal(buildRidingProgressCourseChoice([enrollment(L1, {}, { status: "PLANNED" })]).kind, "none");
  assert.equal(buildRidingProgressCourseChoice([enrollment(L1, {}, { status: "ARCHIVED" })]).kind, "none");
});

// ---------------------------------------------------------------------------
// No inference from date / group / title / level name / id constant
// ---------------------------------------------------------------------------

test("offering start/end dates do not influence any decision", () => {
  const dated = [
    enrollment(L1, {}, { startDate: new Date("2026-07-05"), endDate: new Date("2026-07-31") }),
    enrollment(L2, {}, { startDate: new Date("2026-07-26"), endDate: new Date("2026-08-13") }),
  ];
  // Same outcome as the date-free DUAL fixture: a dual trainee must choose,
  // whatever the windows say - the feedback date can never pick a course.
  assert.deepEqual(
    buildRidingProgressCourseOptions(dated).map((o) => o.id),
    buildRidingProgressCourseOptions(DUAL).map((o) => o.id),
  );
  assert.deepEqual(resolveRidingProgressCourseOfferingIdForCreate(undefined, dated), {
    ok: false,
    reason: "COURSE_CHOICE_REQUIRED",
  });
});

test("the offering name never determines level, identity or eligibility", () => {
  const misleading = [enrollment(L1, {}, { name: "רמה 2 (שם מטעה)" })];
  const options = buildRidingProgressCourseOptions(misleading);
  assert.equal(options[0].id, L1);
  assert.equal(options[0].level, 1, "level comes from the DB column, never from the name");
});

test("the decision functions accept no date, group, title, actor or cookie argument", () => {
  assert.equal(buildRidingProgressCourseOptions.length, 1);
  assert.equal(buildRidingProgressCourseChoice.length, 1);
  assert.equal(resolveRidingProgressCourseOfferingIdForCreate.length, 2);
});

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

test("ordering is level ascending then id ascending, independent of input order", () => {
  const forwards = buildRidingProgressCourseOptions([enrollment(L1), enrollment(L2)]);
  const backwards = buildRidingProgressCourseOptions([enrollment(L2), enrollment(L1)]);
  assert.deepEqual(forwards, backwards);
  assert.deepEqual(forwards.map((o) => o.level), [1, 2]);
});

test("repeated calls on the same rows are identical - no memo, no state", () => {
  assert.deepEqual(buildRidingProgressCourseChoice(DUAL), buildRidingProgressCourseChoice(DUAL));
  assert.deepEqual(
    resolveRidingProgressCourseOfferingIdForCreate(L2, DUAL),
    resolveRidingProgressCourseOfferingIdForCreate(L2, DUAL),
  );
});

test("the core never mutates the rows it is given", () => {
  const rows = [enrollment(L2), enrollment(L1)];
  const before = JSON.stringify(rows);
  buildRidingProgressCourseChoice(rows);
  resolveRidingProgressCourseOfferingIdForCreate(L1, rows);
  assert.equal(JSON.stringify(rows), before);
});

// ---------------------------------------------------------------------------
// Labels and refusal messages
// ---------------------------------------------------------------------------

test("the option label is composed from the DB level and name", () => {
  assert.equal(composeRidingProgressCourseOptionLabel(1, "קורס א"), "רמה 1 · קורס א");
  assert.equal(composeRidingProgressCourseOptionLabel(2, ""), "רמה 2");
  assert.equal(composeRidingProgressCourseOptionLabel(2, "   "), "רמה 2");
  assert.equal(composeRidingProgressCourseOptionLabel(3, " קורס ג "), "רמה 3 · קורס ג");
});

test("every refusal reason has a distinct, non-empty Hebrew message", () => {
  const reasons = ["NO_ELIGIBLE_COURSE", "COURSE_CHOICE_REQUIRED", "COURSE_NOT_ELIGIBLE"] as const;
  const messages = reasons.map((r) => ridingProgressCourseRefusalMessage(r));
  for (const message of messages) {
    assert.ok(message.trim().length > 0);
    assert.match(message, /[֐-׿]/, "messages are Hebrew");
  }
  assert.equal(new Set(messages).size, reasons.length, "messages must be distinguishable");
  assert.deepEqual(Object.keys(RIDING_PROGRESS_COURSE_REFUSAL_MESSAGES).sort(), [...reasons].sort());
});

test("no refusal message names a course level - a denial must not imply which course", () => {
  for (const message of Object.values(RIDING_PROGRESS_COURSE_REFUSAL_MESSAGES)) {
    assert.doesNotMatch(message, /רמה \d/);
  }
});

// ---------------------------------------------------------------------------
// Source-scan containment
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CORE_REL = "lib/course/riding-progress-course-scope-core";
const CORE_SRC = readFileSync(path.join(REPO_ROOT, `${CORE_REL}.ts`), "utf8");
/** The executable body, with block and line comments stripped. */
const CORE_CODE = CORE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the core is pure - no DB, session, clock, randomness or env in its body", () => {
  for (const forbidden of [
    "prisma",
    "next/headers",
    "cookies(",
    "@/lib/auth",
    "Date.now",
    "new Date",
    "Math.random",
    "process.env",
    "fetch(",
    "await ",
  ]) {
    assert.ok(!CORE_CODE.includes(forbidden), `pure core must not reference ${forbidden}`);
  }
});

test("the core hardcodes no course offering id and no level constant", () => {
  assert.doesNotMatch(CORE_CODE, /\bc[a-z0-9]{24}\b/, "no cuid-shaped offering id literal");
  assert.ok(!CORE_CODE.includes("temporary-level2-compatibility"), "no compatibility-module import");
  assert.ok(!CORE_CODE.includes("LEVEL_1"), "no level-1 constant");
  assert.ok(!CORE_CODE.includes("LEVEL_2"), "no level-2 constant");
});

test("the core derives eligibility from the committed shared definition, not its own copy", () => {
  assert.match(
    CORE_CODE,
    /import \{ eligibleTraineeOfferingsFromRows \} from "\.\/trainee-course-selection-core";/,
    "eligibility must be delegated, never redefined",
  );
  assert.ok(
    !/enrollmentStatus\s*!==\s*"ACTIVE"/.test(CORE_CODE),
    "the core must not re-implement the status predicate",
  );
});

test("COURSE IMMUTABILITY - the core exposes a create resolver and no update/re-file resolver", async () => {
  const core = await import("./riding-progress-course-scope-core");
  const resolvers = Object.keys(core).filter((k) => /^resolve/.test(k));
  assert.deepEqual(resolvers, ["resolveRidingProgressCourseOfferingIdForCreate"]);
  for (const forbidden of ["ForUpdate", "Refile", "ReFile", "changeCourse", "moveCourse"]) {
    assert.ok(!CORE_SRC.includes(forbidden), `no ${forbidden} surface may exist in this release`);
  }
});

test("S1 is unwired - no production module imports the core yet", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ["app", "lib", "components", "scripts", "prisma"]) {
    walk(path.join(REPO_ROOT, root));
  }

  const importers = files
    .map((file) => ({
      rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
      src: readFileSync(file, "utf8"),
    }))
    .filter((f) => f.rel !== `${CORE_REL}.ts` && f.rel !== `${CORE_REL}.test.ts`)
    .filter((f) => /(?:from|import|require\()\s*["'][^"']*riding-progress-course-scope-core["']/.test(f.src))
    .map((f) => f.rel);

  assert.deepEqual(importers, [], "S1 adds no runtime wiring - writers/readers/UI land in S4");
});
