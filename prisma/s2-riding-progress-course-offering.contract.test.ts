/**
 * RIDING PROGRESS COURSE SCOPE - S2: focused STRUCTURAL contract test for the
 * additive course scoping of StudentRidingProgressFeedback.
 *
 * DB-FREE by construction: it reads schema.prisma and the S2 migration.sql as
 * TEXT and asserts their shape. A structural test is the right (and only
 * meaningful) test for S2 because S2 adds NO runtime logic - the column is added
 * NULL on every existing row and no writer, reader or component touches it yet,
 * so there is no behaviour to exercise. What must be pinned instead is exactly
 * the set of properties a careless later edit (or a `prisma migrate` re-generate)
 * could silently break: nullability, the FK target and its delete behaviour, both
 * new indexes AND the retained original one, the ABSENCE of a unique constraint /
 * default / hardcoded offering id, the additive-only nature of the migration, and
 * the fact that no pre-existing field was dropped.
 *
 * Mirrors the conventions of prisma/m0-course-material-audience.contract.test.ts.
 * Run with:
 *   npx tsx --test prisma/s2-riding-progress-course-offering.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readRepoFile(relativeToRepoRoot: string): string {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  return readFileSync(`${repoRoot}${relativeToRepoRoot}`, "utf8");
}

const SCHEMA = readRepoFile("prisma/schema.prisma");
const MIGRATION = readRepoFile(
  "prisma/migrations/20260728120000_add_riding_progress_feedback_course_offering/migration.sql",
);

const TABLE = "student_riding_progress_feedback";

function modelBlock(name: string): string {
  const match = SCHEMA.match(new RegExp(`\\nmodel\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} must be declared`);
  return match[1];
}

/** The model body with comment lines stripped - for "is it really declared" checks. */
function codeOf(body: string): string {
  return body
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

const FEEDBACK = modelBlock("StudentRidingProgressFeedback");
const FEEDBACK_CODE = codeOf(FEEDBACK);

// ---------------------------------------------------------------------------
// 1 - the new column is nullable
// ---------------------------------------------------------------------------

test("courseOfferingId is declared and NULLABLE", () => {
  assert.match(FEEDBACK_CODE, /\n\s*courseOfferingId\s+String\?/);
  assert.equal(
    /\n\s*courseOfferingId\s+String(?!\?)\s/.test(FEEDBACK_CODE),
    false,
    "courseOfferingId must never become required",
  );
});

test("the migration adds the column as nullable TEXT and never sets NOT NULL", () => {
  assert.match(MIGRATION, new RegExp(`ALTER TABLE "${TABLE}" ADD COLUMN\\s+"courseOfferingId" TEXT;`));
  assert.equal(/NOT\s+NULL/i.test(MIGRATION), false);
  assert.equal(/ALTER\s+COLUMN/i.test(MIGRATION), false);
});

// ---------------------------------------------------------------------------
// 2 + 3 - the relation exists and is onDelete: Restrict
// ---------------------------------------------------------------------------

test("the CourseOffering relation exists and is optional", () => {
  assert.match(
    FEEDBACK_CODE,
    /\n\s*courseOffering\s+CourseOffering\?\s+@relation\(fields:\s*\[courseOfferingId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
});

test("the offering edge is onDelete: Restrict in schema AND migration", () => {
  assert.match(FEEDBACK_CODE, /onDelete:\s*Restrict/);
  assert.equal(
    /courseOfferingId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade/.test(FEEDBACK_CODE),
    false,
    "the offering edge must never cascade",
  );
  assert.match(
    MIGRATION,
    new RegExp(
      `"${TABLE}_courseOfferingId_fkey" FOREIGN KEY \\("courseOfferingId"\\) REFERENCES "course_offerings"\\("id"\\) ON DELETE RESTRICT ON UPDATE CASCADE`,
    ),
  );
});

// ---------------------------------------------------------------------------
// 4 + 5 - both new indexes exist, and the original studentId index remains
// ---------------------------------------------------------------------------

test("both required indexes are declared in the schema", () => {
  assert.match(FEEDBACK_CODE, /@@index\(\[courseOfferingId\]\)/);
  assert.match(FEEDBACK_CODE, /@@index\(\[studentId,\s*courseOfferingId\]\)/);
});

test("the pre-existing indexes are RETAINED, not replaced", () => {
  assert.match(FEEDBACK_CODE, /@@index\(\[studentId\]\)/);
  assert.match(FEEDBACK_CODE, /@@index\(\[createdByInstructorId\]\)/);
  assert.match(FEEDBACK_CODE, /@@map\("student_riding_progress_feedback"\)/);
});

test("the migration creates exactly the two new indexes and drops none", () => {
  assert.match(
    MIGRATION,
    new RegExp(`CREATE INDEX "${TABLE}_courseOfferingId_idx" ON "${TABLE}"\\("courseOfferingId"\\);`),
  );
  assert.match(
    MIGRATION,
    new RegExp(
      `CREATE INDEX "${TABLE}_studentId_courseOfferingId_idx" ON "${TABLE}"\\("studentId", "courseOfferingId"\\);`,
    ),
  );
  assert.equal(/DROP\s+INDEX/i.test(MIGRATION), false, "no existing index may be dropped");
});

test("every DDL identifier is within PostgreSQL's 63-character limit", () => {
  const tooLong = [...MIGRATION.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((identifier) => identifier.length > 63);
  assert.deepEqual(tooLong, []);
});

// ---------------------------------------------------------------------------
// 6 - no unique constraint includes courseOfferingId
// ---------------------------------------------------------------------------

test("NO unique constraint touches courseOfferingId - repeat entries stay valid", () => {
  assert.equal(/@@unique/.test(FEEDBACK_CODE), false, "the journal has no composite unique");
  assert.equal(
    /courseOfferingId\s+String\?\s*@unique/.test(FEEDBACK_CODE),
    false,
    "the column itself must not be unique",
  );
  assert.equal(
    /CREATE\s+UNIQUE\s+INDEX/i.test(MIGRATION),
    false,
    "the migration must create no unique index",
  );
});

// ---------------------------------------------------------------------------
// 7 - no default
// ---------------------------------------------------------------------------

test("courseOfferingId has NO schema default and the migration sets none", () => {
  const line = FEEDBACK_CODE.split("\n").find((l) => /^\s*courseOfferingId\s/.test(l));
  assert.ok(line, "the courseOfferingId field line must exist");
  assert.equal(/@default/.test(line), false, "a default would fabricate a course");
  assert.equal(/\bDEFAULT\b/i.test(MIGRATION), false);
});

// ---------------------------------------------------------------------------
// 8 - no hardcoded offering id anywhere
// ---------------------------------------------------------------------------

test("neither the model nor the migration hardcodes a CourseOffering id", () => {
  const cuid = /\bc[a-z0-9]{24}\b/;
  assert.doesNotMatch(FEEDBACK, cuid, "no offering id literal in the model (comments included)");
  assert.doesNotMatch(MIGRATION, cuid, "no offering id literal in the migration");
  assert.equal(/LEVEL_1|LEVEL_2/.test(FEEDBACK), false);
});

// ---------------------------------------------------------------------------
// 9 + 12 - additive only: no row-data write, exact statement inventory
// ---------------------------------------------------------------------------

test("migration contains NO data mutation or backfill statement", () => {
  const sql = MIGRATION.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const forbidden: [string, RegExp][] = [
    ["INSERT INTO", /\bINSERT\s+INTO\b/i],
    ["DELETE FROM", /\bDELETE\s+FROM\b/i],
    ["UPDATE ... SET", /\bUPDATE\s+"[^"]+"\s+SET\b/i],
    ["TRUNCATE", /\bTRUNCATE\b/i],
    ["MERGE INTO", /\bMERGE\s+INTO\b/i],
    ["COPY", /\bCOPY\s+"/i],
    ["DROP TABLE/COLUMN/INDEX/CONSTRAINT", /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|TYPE)\b/i],
    ["CREATE TABLE", /\bCREATE\s+TABLE\b/i],
    ["CREATE TYPE", /\bCREATE\s+TYPE\b/i],
  ];
  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(sql), false, `migration must not contain a ${label} statement`);
  }
});

test("migration has EXACTLY one ADD COLUMN, two CREATE INDEX and one FK - four statements", () => {
  const count = (pattern: RegExp) => (MIGRATION.match(pattern) ?? []).length;
  assert.equal(count(/\bADD COLUMN\b/g), 1);
  assert.equal(count(/\bCREATE INDEX\b/g), 2);
  assert.equal(count(/\bADD CONSTRAINT\b/g), 1);
  assert.equal(count(/\bFOREIGN KEY\b/g), 1);

  const statements = MIGRATION.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^--/.test(s.split("\n").pop() ?? ""));
  assert.equal(statements.length, 4, "exactly four DDL statements");
});

test("migration touches ONLY the riding-progress table", () => {
  const altered = [...MIGRATION.matchAll(/ALTER\s+TABLE\s+"([^"]+)"/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)], [TABLE]);
  const indexed = [...MIGRATION.matchAll(/CREATE\s+INDEX\s+"[^"]+"\s+ON\s+"([^"]+)"/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(indexed)], [TABLE]);
  // course_offerings is only ever REFERENCED, never altered.
  assert.equal(/ALTER\s+TABLE\s+"course_offerings"/i.test(MIGRATION), false);
  assert.match(MIGRATION, /REFERENCES "course_offerings"\("id"\)/);
});

// ---------------------------------------------------------------------------
// 10 - no pre-existing field was removed
// ---------------------------------------------------------------------------

test("every pre-S2 field of StudentRidingProgressFeedback is still declared", () => {
  const preExisting = [
    "id",
    "studentId",
    "date",
    "ratingHalfPoints",
    "feedback",
    "horseName",
    "topic",
    "createdByName",
    "updatedByName",
    "createdAt",
    "updatedAt",
    "createdByInstructorId",
    "updatedByInstructorId",
  ];
  for (const field of preExisting) {
    assert.match(
      FEEDBACK_CODE,
      new RegExp(`\\n\\s*${field}\\s+\\S`),
      `pre-existing field ${field} must not be removed`,
    );
  }
});

test("the pre-existing relations are unchanged", () => {
  assert.match(
    FEEDBACK_CODE,
    /\n\s*student\s+Student\s+@relation\(fields:\s*\[studentId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
  assert.match(FEEDBACK_CODE, /createdByInstructor\s+Instructor\?\s+@relation\("RidingProgressFeedbackCreatedBy"/);
  assert.match(FEEDBACK_CODE, /updatedByInstructor\s+Instructor\?\s+@relation\("RidingProgressFeedbackUpdatedBy"/);
});

// ---------------------------------------------------------------------------
// 11 - the CourseOffering back-relation exists
// ---------------------------------------------------------------------------

test("CourseOffering declares the ridingProgressFeedback back-relation", () => {
  assert.match(
    codeOf(modelBlock("CourseOffering")),
    /\n\s*ridingProgressFeedback\s+StudentRidingProgressFeedback\[\]/,
  );
});

test("S2 adds exactly ONE inverse relation and removes none", () => {
  // Four owners in total: Student and the two Instructor authorship edges are
  // pre-existing; CourseOffering is the only one S2 introduces. Pinning the
  // owners (not just the count) means a later edit cannot swap one for another.
  assert.equal([...SCHEMA.matchAll(/StudentRidingProgressFeedback\[\]/g)].length, 4);
  assert.match(codeOf(modelBlock("Student")), /\n\s*ridingProgressFeedback\s+StudentRidingProgressFeedback\[\]/);
  assert.match(
    codeOf(modelBlock("Instructor")),
    /\n\s*ridingProgressFeedbackCreated\s+StudentRidingProgressFeedback\[\]\s+@relation\("RidingProgressFeedbackCreatedBy"\)/,
  );
  assert.match(
    codeOf(modelBlock("Instructor")),
    /\n\s*ridingProgressFeedbackUpdated\s+StudentRidingProgressFeedback\[\]\s+@relation\("RidingProgressFeedbackUpdatedBy"\)/,
  );
  assert.match(
    codeOf(modelBlock("CourseOffering")),
    /\n\s*ridingProgressFeedback\s+StudentRidingProgressFeedback\[\]/,
  );
});

test("CourseOffering keeps every pre-existing back-relation", () => {
  const body = codeOf(modelBlock("CourseOffering"));
  for (const relation of [
    /\n\s*enrollments\s+CourseEnrollment\[\]/,
    /\n\s*groups\s+CourseGroup\[\]/,
    /\n\s*capabilities\s+CourseOfferingCapability\[\]/,
    /\n\s*weeklySchedules\s+WeeklySchedule\[\]/,
    /\n\s*messageTaskAudiences\s+MessageTaskAudience\[\]/,
    /\n\s*materialAudiences\s+CourseMaterialAudience\[\]/,
  ]) {
    assert.match(body, relation);
  }
});
