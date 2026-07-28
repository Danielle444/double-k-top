/**
 * EXAM EX-C2-0 — STRUCTURAL guard: no feedback, ratings or grades in the exam
 * slice.
 *
 * DB-FREE: this suite reads files from disk and asserts on their TEXT. It opens
 * no database connection and executes no SQL.
 *
 * WHY THIS EXISTS. The Exams area displays SCHEDULING AND OPERATIONAL
 * information only; exam grades and exam feedback are a separate future
 * feature. The live beginner projection reads Teaching Practice, and the
 * general-purpose Teaching-Practice reader (`LESSON_DETAIL_INCLUDE`) selects
 * `TeachingPracticeFeedback` unconditionally and then NULLS it in its mapper
 * when `canViewFeedback` is false. Fetch-then-strip is fine there; it is NOT
 * acceptable here, because the locked rule is "do not SELECT, map, return or
 * render". The exam readers must therefore use their own narrow select that
 * never mentions feedback at all — nothing to strip ever leaves the database.
 *
 * This guard makes that durable against a well-meaning future edit that reuses
 * the wide reader "because it already exists".
 *
 * SCOPED TO EXACT IDENTIFIERS, deliberately not to the word "feedback": the
 * exam cores legitimately contain PROSE forbidding feedback (this file most of
 * all), and one suite asserts on an unrelated `riding_progress_feedback`
 * migration directory name. A word-level check would fail on both and would
 * have to be deleted the first time it fired — a guard nobody trusts is worse
 * than no guard.
 *
 * Run with: npx tsx --test lib/exam/exam-no-feedback-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const EXAM_DIR = join(REPO_ROOT, "lib", "exam");

/**
 * The exact identifiers that must never appear in the exam slice.
 *
 * `TeachingPracticeFeedback` — the Prisma model / its TypeScript type;
 * `ratingHalfPoints`         — the only rating column in this database;
 * `canViewFeedback`          — the fetch-then-strip visibility flag whose mere
 *                              presence would prove a wide reader was reused.
 */
const FORBIDDEN_IDENTIFIERS = [
  "TeachingPracticeFeedback",
  "ratingHalfPoints",
  "canViewFeedback",
] as const;

function examSliceFiles(): { name: string; source: string }[] {
  return readdirSync(EXAM_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    // Exclude THIS suite: it necessarily names the identifiers it forbids.
    .filter((f) => f !== "exam-no-feedback-guard.test.ts")
    .map((name) => ({ name, source: readFileSync(join(EXAM_DIR, name), "utf8") }));
}

test("no file in lib/exam references a feedback, rating or grade identifier", () => {
  const files = examSliceFiles();
  assert.ok(files.length >= 8, `sanity: expected the exam slice, found ${files.length} files`);

  const offenders: string[] = [];
  for (const { name, source } of files) {
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      if (source.includes(identifier)) offenders.push(`${name} -> ${identifier}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `the Exams module must not touch feedback/ratings/grades; found: ${offenders.join(", ")}`,
  );
});

test("the guard is scoped to identifiers, not to ordinary prose", () => {
  // Proof that the check above is meaningful rather than vacuously true: the
  // exam slice DOES contain the word "feedback" in prose (rules forbidding it,
  // and an unrelated migration directory name), and that is intentionally fine.
  const files = examSliceFiles();
  const withProse = files.filter((f) => /feedback/i.test(f.source));
  assert.ok(
    withProse.length > 0,
    "sanity: the exam slice should still discuss feedback in prose",
  );

  // ...yet none of them names a forbidden identifier.
  for (const { name, source } of withProse) {
    for (const identifier of FORBIDDEN_IDENTIFIERS) {
      assert.equal(source.includes(identifier), false, `${name} names ${identifier}`);
    }
  }
});

test("the live beginner adapter models no feedback, rating or grade field", () => {
  const source = readFileSync(join(EXAM_DIR, "exam-live-beginner-adapter-core.ts"), "utf8");

  // Field-position matches only ("  someField:" / "someField?:"), so the prose
  // explaining WHY these are absent does not trip the check.
  const FIELD_LIKE = [
    /\bfeedback\s*\??\s*:/i,
    /\brating\w*\s*\??\s*:/i,
    /\bgrade\w*\s*\??\s*:/i,
    /\bscore\w*\s*\??\s*:/i,
    /\bresult\w*\s*\??\s*:/i,
  ];
  for (const pattern of FIELD_LIKE) {
    assert.equal(
      pattern.test(source),
      false,
      `the adapter must declare no field matching ${pattern}`,
    );
  }
});

test("the exam slice imports no Teaching-Practice runtime module", () => {
  // The adapter consumes PLAIN already-read data. It must not reach into the
  // Teaching-Practice actions (which is where the wide, feedback-selecting
  // reader lives) or into Prisma.
  const offenders: string[] = [];
  for (const { name, source } of examSliceFiles()) {
    for (const forbidden of [
      "lib/actions/teaching-practice",
      "@/lib/prisma",
      "@prisma/client",
      "LESSON_DETAIL_INCLUDE",
    ]) {
      if (source.includes(forbidden)) offenders.push(`${name} -> ${forbidden}`);
    }
  }
  assert.deepEqual(offenders, [], `the exam cores must stay pure; found: ${offenders.join(", ")}`);
});
