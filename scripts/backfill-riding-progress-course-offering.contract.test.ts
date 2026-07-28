/**
 * RIDING PROGRESS COURSE SCOPE - S3: non-DB CONTRACT (source-scan) tests for the
 * guarded backfill runner.
 *
 * The runner has top-level execution (it connects and reads), so it must NEVER be
 * imported by a test. These tests read its SOURCE as text and pin the properties
 * that make a production write safe: dry-run default, required explicit target,
 * no hardcoded offering id, no force flag, a single transaction, stale-write
 * protection on every UPDATE, an affected-row equality check that rolls back, and
 * exactly one written column on exactly one table.
 *
 * Run with:
 *   npx tsx --test scripts/backfill-riding-progress-course-offering.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT_REL = "scripts/backfill-riding-progress-course-offering.ts";
const SRC = readFileSync(path.join(REPO_ROOT, SCRIPT_REL), "utf8");
/** Executable body with block and line comments stripped. */
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// Guards on the CLI surface
// ---------------------------------------------------------------------------

test("the runner delegates ALL decisions to the pure planner", () => {
  assert.match(
    CODE,
    /from "\.\.\/lib\/course\/riding-progress-course-backfill-core"/,
    "business rules must not be re-implemented in the script",
  );
  assert.match(CODE, /buildRidingProgressCourseBackfillPlan\(/);
  assert.match(CODE, /parseRidingProgressBackfillArgs\(process\.argv\.slice\(2\)\)/);
});

test("APPLY requires the explicit --apply flag - dry run is the default branch", () => {
  assert.match(CODE, /if\s*\(!args\.apply\)/, "the no-apply branch must return before any write");
  assert.match(CODE, /NO DATA WAS MODIFIED/);
});

test("the target offering id is always an operator argument, never hardcoded", () => {
  assert.doesNotMatch(SRC, /\bc[a-z0-9]{24}\b/, "no cuid-shaped offering id, comments included");
  assert.ok(!SRC.includes("temporary-level2-compatibility"));
  assert.ok(!/LEVEL_1_COURSE_OFFERING_ID|LEVEL_2_COURSE_OFFERING_ID/.test(SRC));
  // The script never parses flags itself - it delegates to the tested pure
  // parser, and the id it uses is whatever that parser returned.
  assert.match(CODE, /const offeringId = args\.offeringId as string/);
  assert.match(CODE, /readPlan\(prisma, offeringId\)/);
  // The usage documentation must still tell the operator the flag is required.
  assert.match(SRC, /--offering-id=<id>/);
});

test("there is NO force, yes or confirmation-bypass flag in the executable body", () => {
  // Scanned against the comment-stripped body on purpose: the header comment
  // legitimately DOCUMENTS that these flags do not exist, and that sentence must
  // not be what makes this test pass or fail. The pure parser's own test proves
  // "--force" is rejected as an unrecognized argument.
  for (const forbidden of ["--force", "--yes", "--skip", "--no-verify", "--confirm"]) {
    assert.ok(!CODE.includes(forbidden), `${forbidden} must not be accepted`);
  }
});

test("apply is refused unless the plan is clean", () => {
  assert.match(CODE, /if\s*\(!plan\.canApply\)/);
  assert.match(CODE, /REFUSED/);
});

// ---------------------------------------------------------------------------
// Write-path safety
// ---------------------------------------------------------------------------

test("all writes happen inside ONE transaction", () => {
  assert.match(CODE, /prisma\.\$transaction\(async \(tx\) =>/);
  assert.equal((CODE.match(/\$transaction/g) ?? []).length, 1, "exactly one transaction");
});

test("the plan is RECOMPUTED inside the transaction from freshly read rows", () => {
  const tx = CODE.slice(CODE.indexOf("$transaction"));
  assert.match(tx, /const fresh = await readPlan\(/);
  assert.match(tx, /if\s*\(!fresh\.canApply\)/);
  assert.match(tx, /fresh\.updates\.length !== plan\.updates\.length/);
});

test("every UPDATE carries stale-write protection", () => {
  assert.match(CODE, /UPDATE "student_riding_progress_feedback"/);
  assert.match(CODE, /AND "courseOfferingId" IS NULL/);
  const updates = (CODE.match(/UPDATE "student_riding_progress_feedback"/g) ?? []).length;
  const guards = (CODE.match(/AND "courseOfferingId" IS NULL/g) ?? []).length;
  assert.equal(updates, guards, "every UPDATE must be guarded");
  assert.equal(updates, 1, "exactly one UPDATE statement exists");
});

test("an affected-row mismatch throws, rolling the transaction back", () => {
  assert.match(CODE, /if\s*\(affected !== fresh\.updates\.length\)/);
  const idx = CODE.indexOf("affected !== fresh.updates.length");
  assert.match(CODE.slice(idx, idx + 300), /throw new Error/);
  assert.match(CODE, /Rolling back/);
});

test("the write touches exactly one column on exactly one table", () => {
  const tables = [...CODE.matchAll(/UPDATE\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ["student_riding_progress_feedback"]);
  const setColumns = [...CODE.matchAll(/SET\s+"([^"]+)"\s*=/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(setColumns)], ["courseOfferingId"]);
});

test("the write never creates, deletes or truncates", () => {
  for (const [label, pattern] of [
    ["INSERT", /\bINSERT\s+INTO\b/i],
    ["DELETE", /\bDELETE\s+FROM\b/i],
    ["TRUNCATE", /\bTRUNCATE\b/i],
    ["DROP", /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i],
    ["deleteMany", /\bdeleteMany\b/],
    ["createMany", /\bcreateMany\b/],
    ["upsert", /\bupsert\b/],
  ] as [string, RegExp][]) {
    assert.equal(pattern.test(CODE), false, `the runner must not ${label}`);
  }
});

test("updatedAt is deliberately NOT bumped - raw SQL, not the Prisma model writer", () => {
  assert.match(CODE, /\$executeRaw/);
  assert.ok(!/studentRidingProgressFeedback\.update\b/.test(CODE));
  assert.ok(!/studentRidingProgressFeedback\.updateMany\b/.test(CODE));
  assert.ok(!CODE.includes("updatedAt"), "the backfill must not write updatedAt");
});

// ---------------------------------------------------------------------------
// The dry-run path performs no write at all
// ---------------------------------------------------------------------------

test("the DRY-RUN path contains no write call", () => {
  // From the start of main() to the apply guard: the read+report path a dry run
  // actually executes. Sliced from main (not from the file head) so the
  // `type Db = Pick<PrismaClient, ... "$executeRaw">` declaration - a type, not a
  // call - is not mistaken for a write.
  const mainStart = CODE.indexOf("async function main");
  const applyGuard = CODE.indexOf("if (!args.apply)");
  assert.ok(mainStart >= 0 && applyGuard > mainStart, "main() and the apply guard must both exist");
  const dryRun = CODE.slice(mainStart, applyGuard);
  for (const forbidden of ["$executeRaw", "$transaction", "$executeRawUnsafe", ".update(", ".updateMany("]) {
    assert.ok(!dryRun.includes(forbidden), `the dry-run path must not contain ${forbidden}`);
  }
  // And the dry run must terminate before reaching any write.
  assert.match(CODE.slice(applyGuard, applyGuard + 400), /return;/);
});

test("the read helper issues SELECTs only", () => {
  const read = CODE.slice(CODE.indexOf("async function readPlan"), CODE.indexOf("async function main"));
  assert.match(read, /findUnique\(/);
  assert.match(read, /findMany\(/);
  for (const forbidden of ["$executeRaw", ".update(", ".updateMany(", ".create(", ".delete("]) {
    assert.ok(!read.includes(forbidden), `readPlan must not contain ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Output hygiene
// ---------------------------------------------------------------------------

test("the runner never prints a connection string or secret", () => {
  assert.ok(!/console\.log\([^)]*DATABASE_URL/.test(CODE), "never log the raw URL");
  assert.match(CODE, /identifyDbTarget\(process\.env\.DATABASE_URL\)/, "the masked target helper is used");
  for (const forbidden of ["fullName", "identityNumber", "phone", "parentEmail", "AUTH_SECRET"]) {
    assert.ok(!CODE.includes(forbidden), `must not surface ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Containment
// ---------------------------------------------------------------------------

test("no runtime module imports the backfill runner", () => {
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
  for (const root of ["app", "lib", "components", "prisma", "scripts"]) walk(path.join(REPO_ROOT, root));

  const importers = files
    .map((file) => ({
      rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
      src: readFileSync(file, "utf8"),
    }))
    .filter((f) => f.rel !== SCRIPT_REL && !f.rel.endsWith(".contract.test.ts"))
    .filter((f) =>
      /(?:from|import|require\()\s*["'][^"']*backfill-riding-progress-course-offering["']/.test(f.src),
    )
    .map((f) => f.rel);

  assert.deepEqual(importers, [], "the runner is an entrypoint, never a library");
});
