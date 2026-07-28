/**
 * RIDING PROGRESS COURSE SCOPE - S3: tests for the PURE backfill planner.
 *
 * Run with: npx tsx --test lib/course/riding-progress-course-backfill-core.test.ts
 * No Prisma, no DB, no clock - the planner takes plain rows and returns a plan.
 *
 * The offering ids here are deliberately FAKE: the planner must behave
 * identically for any id, and the real production target is an operator
 * argument, never a value this code knows.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildRidingProgressCourseBackfillPlan,
  parseRidingProgressBackfillArgs,
  formatRidingProgressBackfillPlan,
  formatRidingProgressBackfillUpdates,
  EXPECTED_LEGACY_TOTAL_ROWS,
  EXPECTED_LEGACY_DATE_KEY,
  type RidingProgressBackfillRowInput,
  type RidingProgressBackfillTargetInput,
} from "./riding-progress-course-backfill-core";

const TARGET_ID = "offering-level-1";
const OTHER_ID = "offering-level-2";

function target(overrides: Partial<RidingProgressBackfillTargetInput> = {}): RidingProgressBackfillTargetInput {
  return {
    id: TARGET_ID,
    level: 1,
    status: "ACTIVE",
    name: "קורס מדריכים – רמה 1",
    activityYearId: "year-1",
    ...overrides,
  };
}

/** n legacy rows, all unscoped and all on the audited date. */
function legacyRows(n = EXPECTED_LEGACY_TOTAL_ROWS): RidingProgressBackfillRowInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `row-${String(i + 1).padStart(2, "0")}`,
    studentId: `student-${String(i + 1).padStart(2, "0")}`,
    dateKey: EXPECTED_LEGACY_DATE_KEY,
    courseOfferingId: null,
  }));
}

const codes = (plan: { refusals: readonly { code: string }[] }) => plan.refusals.map((r) => r.code);

// ---------------------------------------------------------------------------
// The approved dataset
// ---------------------------------------------------------------------------

test("the exact approved 11-row dataset produces a plan of 11 updates", () => {
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), legacyRows());
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.canApply, true);
  assert.equal(plan.totalRowsInspected, 11);
  assert.equal(plan.nullRows, 11);
  assert.equal(plan.alreadyScopedToTarget, 0);
  assert.equal(plan.alreadyScopedToOther, 0);
  assert.equal(plan.updates.length, 11);
  assert.equal(plan.targetCourseOfferingId, TARGET_ID);
  for (const update of plan.updates) {
    assert.equal(update.currentCourseOfferingId, null);
    assert.equal(update.proposedCourseOfferingId, TARGET_ID);
    assert.equal(update.dateKey, EXPECTED_LEGACY_DATE_KEY);
  }
});

test("the target's own id is used, never the caller's separate string instance", () => {
  const requested = String(TARGET_ID);
  const plan = buildRidingProgressCourseBackfillPlan(requested, target(), legacyRows());
  assert.equal(plan.targetCourseOfferingId, target().id);
});

test("ordering is deterministic (ascending row id) regardless of input order", () => {
  const forwards = legacyRows();
  const backwards = [...forwards].reverse();
  const a = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), forwards);
  const b = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), backwards);
  assert.deepEqual(a.updates, b.updates);
  assert.deepEqual(
    a.updates.map((u) => u.id),
    [...a.updates.map((u) => u.id)].sort(),
  );
});

test("the input rows are never mutated", () => {
  const rows = [...legacyRows()].reverse();
  const before = JSON.stringify(rows);
  buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), rows);
  assert.equal(JSON.stringify(rows), before);
});

// ---------------------------------------------------------------------------
// Dataset-shape refusals
// ---------------------------------------------------------------------------

test("zero rows refuses", () => {
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), []);
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("UNEXPECTED_TOTAL_ROW_COUNT"));
  assert.deepEqual(plan.updates, []);
});

test("10 or 12 rows refuses - the audited dataset must be exactly 11", () => {
  for (const n of [10, 12]) {
    const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), legacyRows(n));
    assert.equal(plan.canApply, false, `${n} rows must refuse`);
    assert.ok(codes(plan).includes("UNEXPECTED_TOTAL_ROW_COUNT"));
    assert.deepEqual(plan.updates, [], "a refused plan proposes no write");
  }
});

test("an unexpected date refuses and plans nothing", () => {
  const rows = legacyRows();
  const mutated = rows.map((r, i) => (i === 3 ? { ...r, dateKey: "2026-07-18" } : r));
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), mutated);
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("UNEXPECTED_ROW_DATE"));
  assert.deepEqual(plan.updates, []);
});

test("a duplicate row id refuses", () => {
  const rows = legacyRows();
  const dup = [...rows.slice(0, 10), { ...rows[0] }];
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), dup);
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("DUPLICATE_ROW_ID"));
});

test("a malformed row refuses", () => {
  const rows = legacyRows();
  const bad = [...rows.slice(0, 10), { ...rows[10], studentId: "" }];
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), bad);
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("MALFORMED_ROW"));
});

// ---------------------------------------------------------------------------
// Already-scoped handling and idempotency
// ---------------------------------------------------------------------------

test("rows already scoped to the target are SKIPPED, never rewritten", () => {
  const rows = legacyRows().map((r, i) => (i < 4 ? { ...r, courseOfferingId: TARGET_ID } : r));
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), rows);
  assert.equal(plan.canApply, true);
  assert.equal(plan.alreadyScopedToTarget, 4);
  assert.equal(plan.nullRows, 7);
  assert.equal(plan.updates.length, 7);
  assert.equal(
    plan.updates.some((u) => rows.slice(0, 4).some((r) => r.id === u.id)),
    false,
    "an already-scoped row must never appear in the update list",
  );
});

test("IDEMPOTENT: a fully applied dataset plans 0 updates and still canApply", () => {
  const rows = legacyRows().map((r) => ({ ...r, courseOfferingId: TARGET_ID }));
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), rows);
  assert.equal(plan.canApply, true);
  assert.equal(plan.nullRows, 0);
  assert.equal(plan.alreadyScopedToTarget, 11);
  assert.equal(plan.updates.length, 0);
});

test("a row scoped to a DIFFERENT offering refuses the whole plan", () => {
  const rows = legacyRows().map((r, i) => (i === 2 ? { ...r, courseOfferingId: OTHER_ID } : r));
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), rows);
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("ROW_SCOPED_TO_OTHER_OFFERING"));
  assert.equal(plan.alreadyScopedToOther, 1);
  assert.deepEqual(plan.updates, [], "no row is written when any row is mis-scoped");
});

test("a partially applied dataset (mixed NULL + target) is still safely applicable", () => {
  const rows = legacyRows().map((r, i) => (i < 6 ? { ...r, courseOfferingId: TARGET_ID } : r));
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), rows);
  assert.equal(plan.canApply, true);
  assert.equal(plan.updates.length, 5);
  assert.equal(plan.nullRows + plan.alreadyScopedToTarget, EXPECTED_LEGACY_TOTAL_ROWS);
});

// ---------------------------------------------------------------------------
// Target validation
// ---------------------------------------------------------------------------

test("a missing target offering refuses", () => {
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, null, legacyRows());
  assert.equal(plan.canApply, false);
  assert.deepEqual(codes(plan), ["TARGET_NOT_FOUND"]);
  assert.equal(plan.targetCourseOfferingId, null);
  assert.deepEqual(plan.updates, []);
});

test("a wrong-level target refuses (this alone excludes the Level 2 offering)", () => {
  const plan = buildRidingProgressCourseBackfillPlan(OTHER_ID, target({ id: OTHER_ID, level: 2 }), legacyRows());
  assert.equal(plan.canApply, false);
  assert.ok(codes(plan).includes("TARGET_WRONG_LEVEL"));
  assert.deepEqual(plan.updates, []);
});

test("a non-ACTIVE target refuses", () => {
  for (const status of ["PLANNED", "ARCHIVED"]) {
    const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target({ status }), legacyRows());
    assert.equal(plan.canApply, false, `${status} must refuse`);
    assert.ok(codes(plan).includes("TARGET_NOT_ACTIVE"));
  }
});

test("a malformed or empty target id refuses", () => {
  for (const bad of ["", "   "]) {
    const plan = buildRidingProgressCourseBackfillPlan(bad, target(), legacyRows());
    assert.equal(plan.canApply, false);
    assert.deepEqual(codes(plan), ["TARGET_ID_MALFORMED"]);
  }
});

test("a fetched offering whose id differs from the requested id refuses", () => {
  const plan = buildRidingProgressCourseBackfillPlan("some-other-request", target(), legacyRows());
  assert.equal(plan.canApply, false);
  assert.deepEqual(codes(plan), ["TARGET_ID_MISMATCH"]);
  assert.deepEqual(plan.updates, []);
});

test("the offering NAME is evidence only - it never selects or validates the target", () => {
  const renamed = buildRidingProgressCourseBackfillPlan(TARGET_ID, target({ name: "שם אחר לגמרי" }), legacyRows());
  assert.equal(renamed.canApply, true);
  assert.equal(renamed.updates.length, 11);
  assert.equal(renamed.targetEvidence?.name, "שם אחר לגמרי");
  // A perfectly-named offering with the wrong level is still refused.
  const wrongLevel = buildRidingProgressCourseBackfillPlan(
    TARGET_ID,
    target({ level: 2, name: "קורס מדריכים – רמה 1" }),
    legacyRows(),
  );
  assert.equal(wrongLevel.canApply, false);
});

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

test("dry-run is the default - apply requires the exact --apply literal", () => {
  assert.equal(parseRidingProgressBackfillArgs([`--offering-id=${TARGET_ID}`]).apply, false);
  assert.equal(parseRidingProgressBackfillArgs([`--offering-id=${TARGET_ID}`, "--apply"]).apply, true);
});

test("--offering-id is required in BOTH modes", () => {
  assert.ok(parseRidingProgressBackfillArgs([]).errors.length > 0);
  assert.ok(parseRidingProgressBackfillArgs(["--apply"]).errors.length > 0);
  assert.deepEqual(parseRidingProgressBackfillArgs([`--offering-id=${TARGET_ID}`]).errors, []);
});

test("an empty --offering-id value is an error, never a silent null", () => {
  const parsed = parseRidingProgressBackfillArgs(["--offering-id="]);
  assert.equal(parsed.offeringId, null);
  assert.ok(parsed.errors.length > 0);
});

test("an unrecognized argument is a hard error - no silently-dropped guard", () => {
  for (const arg of ["--force", "--yes", "--skip-checks", "-a", "apply"]) {
    const parsed = parseRidingProgressBackfillArgs([`--offering-id=${TARGET_ID}`, arg]);
    assert.ok(parsed.errors.length > 0, `${arg} must be rejected`);
  }
});

test("there is NO force / bypass / confirm-skip flag in the parser", () => {
  const parsed = parseRidingProgressBackfillArgs([`--offering-id=${TARGET_ID}`, "--force"]);
  assert.ok(parsed.errors.some((e) => e.includes("Unrecognized")));
});

// ---------------------------------------------------------------------------
// Output formatting - evidence without PII
// ---------------------------------------------------------------------------

test("formatted output carries ids and dates, and no trainee-identifying text", () => {
  const plan = buildRidingProgressCourseBackfillPlan(TARGET_ID, target(), legacyRows());
  const text = [...formatRidingProgressBackfillPlan(plan), ...formatRidingProgressBackfillUpdates(plan)].join("\n");
  assert.match(text, /Rows selected for update:11/);
  assert.match(text, new RegExp(EXPECTED_LEGACY_DATE_KEY));
  assert.match(text, /current NULL -> offering-level-1/);
  for (const forbidden of ["fullName", "phone", "identityNumber", "email", "parent"]) {
    assert.ok(!text.includes(forbidden), `output must not carry ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Source-scan containment
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CORE_REL = "lib/course/riding-progress-course-backfill-core";
const CORE_SRC = readFileSync(path.join(REPO_ROOT, `${CORE_REL}.ts`), "utf8");
const CORE_CODE = CORE_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the planner is pure - no DB, clock, env, randomness or argv read", () => {
  for (const forbidden of [
    "prisma",
    "PrismaClient",
    "next/headers",
    "process.env",
    "process.argv",
    "Date.now",
    "new Date",
    "Math.random",
    "fetch(",
    "await ",
  ]) {
    assert.ok(!CORE_CODE.includes(forbidden), `pure planner must not reference ${forbidden}`);
  }
});

test("the planner hardcodes NO production offering id", () => {
  assert.doesNotMatch(CORE_SRC, /\bc[a-z0-9]{24}\b/, "no cuid-shaped offering id anywhere, comments included");
  assert.ok(!CORE_SRC.includes("temporary-level2-compatibility"));
});

test("the planner performs no current-enrollment, group, title or name inference", () => {
  for (const forbidden of ["CourseEnrollment", "enrollment", "groupName", "subgroup", "topic", "title"]) {
    assert.ok(!CORE_CODE.includes(forbidden), `planner must not consult ${forbidden}`);
  }
  // The date is used ONLY as an equality guard against the audited constant -
  // never to choose between courses.
  assert.ok(CORE_CODE.includes("EXPECTED_LEGACY_DATE_KEY"));
  assert.ok(!/dateKey\s*[<>]/.test(CORE_CODE), "no date comparison/window logic");
});

test("S3 is unwired - no runtime module imports the planner", () => {
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
  for (const root of ["app", "lib", "components", "prisma"]) walk(path.join(REPO_ROOT, root));

  const importers = files
    .map((file) => ({
      rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
      src: readFileSync(file, "utf8"),
    }))
    .filter((f) => !f.rel.startsWith(CORE_REL))
    .filter((f) =>
      /(?:from|import|require\()\s*["'][^"']*riding-progress-course-backfill-core["']/.test(f.src),
    )
    .map((f) => f.rel);

  assert.deepEqual(importers, [], "only the scripts/ runner may consume the planner");
});
