/**
 * EXAM EX-C1 — narrow STRUCTURAL tests over the Prisma schema text and the
 * generated migration SQL.
 *
 * DB-FREE: this suite reads two files from disk and asserts on their TEXT. It
 * opens NO database connection, requires no Prisma client, and executes no SQL.
 * It exists because the approved exam contract (which columns are nullable,
 * which FK is SetNull vs Restrict vs Cascade, which indexes serve which view)
 * is a schema-level promise that no runtime test can make.
 *
 * Run with: npx tsx --test lib/exam/exam-schema-structure.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
const MIGRATION_DIR = "20260729120000_add_exam_plan_tree";
const MIGRATION = readFileSync(
  join(REPO_ROOT, "prisma", "migrations", MIGRATION_DIR, "migration.sql"),
  "utf8",
);

const EXAM_MODELS = [
  "ExamPlan",
  "ExamSession",
  "ExamAssignment",
  "ExamBeginnerChild",
  "ExamSessionSupervisor",
] as const;

const EXAM_ENUMS = [
  "ExamKind",
  "ExamPhase",
  "ExamBeginnerFormat",
  "ExamAssignmentRole",
] as const;

/** The body text of one `model X { … }` / `enum X { … }` block. */
function block(kind: "model" | "enum", name: string): string {
  const start = SCHEMA.indexOf(`${kind} ${name} {`);
  assert.notEqual(start, -1, `${kind} ${name} not found in schema.prisma`);
  const end = SCHEMA.indexOf("\n}", start);
  assert.notEqual(end, -1, `${kind} ${name} block is unterminated`);
  return SCHEMA.slice(start, end);
}

// --- model / enum inventory -------------------------------------------------

test("exactly five exam models exist, and no parent Exam entity", () => {
  const declared = [...SCHEMA.matchAll(/^model\s+(Exam\w*)\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...EXAM_MODELS].sort());
  assert.equal(declared.length, 5);

  // "לפי מבחן" groups by ExamSession.kind - it must NOT have introduced a
  // parent entity between ExamPlan and ExamSession.
  assert.equal(SCHEMA.includes("model Exam {"), false);
  assert.equal(SCHEMA.includes("model ExamDefinition {"), false);
  assert.equal(SCHEMA.includes("model ExamType {"), false);
});

test("exactly four exam enums exist with the approved values", () => {
  const declared = [...SCHEMA.matchAll(/^enum\s+(Exam\w*)\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...EXAM_ENUMS].sort());

  const kinds = block("enum", "ExamKind");
  for (const v of [
    "INTERFACE_RIDING",
    "LUNGE_NO_RIDER",
    "ADVANCED_INSTRUCTION",
    "BEGINNER_INSTRUCTION",
  ]) {
    assert.ok(kinds.includes(v), `ExamKind is missing ${v}`);
  }
  for (const v of ["INTERFACE", "RIDING"]) {
    assert.ok(block("enum", "ExamPhase").includes(v));
  }
  for (const v of ["LUNGE", "BEGINNER_PRIVATE", "BEGINNER_GROUP"]) {
    assert.ok(block("enum", "ExamBeginnerFormat").includes(v));
  }
  const roles = block("enum", "ExamAssignmentRole");
  assert.ok(roles.includes("EXAMINEE"));
  assert.ok(roles.includes("INSTRUCTED_TRAINEE"));
});

test("THEORY and DEMO_RIDER appear nowhere in the exam schema or migration", () => {
  for (const forbidden of ["THEORY", "DEMO_RIDER"]) {
    assert.equal(
      block("enum", "ExamKind").includes(forbidden),
      false,
      `${forbidden} must not exist`,
    );
    assert.equal(block("enum", "ExamAssignmentRole").includes(forbidden), false);
    assert.equal(MIGRATION.includes(forbidden), false, `${forbidden} leaked into the migration`);
  }
});

// --- fields, nullability, relations -----------------------------------------

test("ExamPlan is one-per-CourseOffering and Restrict-protected", () => {
  const plan = block("model", "ExamPlan");
  assert.match(plan, /courseOfferingId\s+String\s+@unique/);
  assert.match(plan, /publishedAt\s+DateTime\?/);
  assert.match(plan, /courseOffering\s+CourseOffering\s+@relation\([^)]*onDelete:\s*Restrict/);
  assert.ok(plan.includes('@@map("exam_plans")'));
});

test("ExamSession carries every approved field with the right nullability", () => {
  const s = block("model", "ExamSession");
  // Required.
  assert.match(s, /\n\s+planId\s+String\n/);
  assert.match(s, /\n\s+kind\s+ExamKind\n/);
  assert.match(s, /\n\s+date\s+DateTime\s+@db\.Date/);
  assert.match(s, /\n\s+startTime\s+String\n/);
  assert.match(s, /\n\s+endTime\s+String\n/);
  assert.match(s, /\n\s+orderIndex\s+Int\n/);
  // Kind-specific, all nullable.
  assert.match(s, /\n\s+phase\s+ExamPhase\?/);
  assert.match(s, /\n\s+beginnerFormat\s+ExamBeginnerFormat\?/);
  assert.match(s, /\n\s+interfaceSessionId\s+String\?/);
  assert.match(s, /\n\s+sourceTeachingPracticeLessonId\s+String\?/);
  assert.match(s, /\n\s+copiedAt\s+DateTime\?/);
  assert.match(s, /\n\s+roleLabelOverrides\s+Json\?/);
  assert.match(s, /\n\s+individualPublishedAt\s+DateTime\?/);
  assert.match(s, /\n\s+arena\s+String\?/);
  // ONE place field only - no duplicate `location` column.
  assert.equal(/\n\s+location\s+String/.test(s), false, "ExamSession must not have `location`");
});

test("ExamAssignment.studentId is NULLABLE and carries the instruction fields", () => {
  const a = block("model", "ExamAssignment");
  // Nullable from day one so the external-candidate upgrade stays additive.
  assert.match(a, /\n\s+studentId\s+String\?/);
  assert.match(a, /\n\s+role\s+ExamAssignmentRole\n/);
  assert.match(a, /\n\s+horseName\s+String\?/);
  assert.match(a, /\n\s+instructionTopic\s+String\?/);
  assert.match(a, /\n\s+pairingIndex\s+Int\?/);
  // A STRING snapshot, never the live Teaching-Practice enum.
  assert.match(a, /\n\s+sourcePracticeRole\s+String\?/);
  assert.equal(
    /sourcePracticeRole\s+TeachingPracticeRole/.test(a),
    false,
    "sourcePracticeRole must not be typed to the live TP enum",
  );
});

test("ExamBeginnerChild snapshots contact + operational detail, without signed forms", () => {
  const c = block("model", "ExamBeginnerChild");
  for (const field of [
    "fullName",
    "age",
    "gender",
    "notes",
    "parentName",
    "parentPhone",
    "horseName",
    "equipmentNotes",
    "isAbsent",
    "sourceChildId",
    "sourceChildAssignmentId",
    "orderIndex",
  ]) {
    assert.ok(new RegExp(`\\n\\s+${field}\\s+`).test(c), `ExamBeginnerChild is missing ${field}`);
  }
  assert.match(c, /\n\s+fullName\s+String\n/); // required
  assert.match(c, /\n\s+parentName\s+String\?/); // stored, runtime-gated later
  assert.match(c, /\n\s+parentPhone\s+String\?/);
  // Signed forms are deliberately NOT copied.
  assert.equal(/signedForm/i.test(c), false, "signed forms must not be snapshotted");
});

test("ExamSessionSupervisor is the per-session instructor relationship", () => {
  const s = block("model", "ExamSessionSupervisor");
  assert.match(s, /\n\s+instructorId\s+String\n/);
  assert.match(s, /instructor\s+Instructor\s+@relation\([^)]*onDelete:\s*Restrict/);
});

test("no new Instructor permission column was added for exam PII", () => {
  const instructor = block("model", "Instructor");
  assert.equal(/canViewExam|canManageExam|canSeeExamParent|examPermission/i.test(instructor), false);
  // Only the back-relation may mention exams.
  const examLines = instructor.split("\n").filter((l) => /exam/i.test(l));
  for (const line of examLines) {
    assert.ok(
      line.includes("ExamSessionSupervisor[]") || line.trim().startsWith("//"),
      `unexpected exam field on Instructor: ${line.trim()}`,
    );
  }
});

// --- onDelete behaviour -----------------------------------------------------

test("provenance FKs use SetNull so a deleted TP row cannot corrupt an exam", () => {
  assert.match(
    block("model", "ExamSession"),
    /sourceLesson\s+TeachingPracticeLesson\?\s+@relation\([^)]*onDelete:\s*SetNull/,
  );
  assert.match(
    block("model", "ExamBeginnerChild"),
    /sourceChild\s+TeachingPracticeChild\?\s+@relation\([^)]*onDelete:\s*SetNull/,
  );
  assert.ok(MIGRATION.includes('"exam_sessions_sourceTeachingPracticeLessonId_fkey"'));
  assert.ok(MIGRATION.includes('"exam_beginner_children_sourceChildId_fkey"'));
  for (const fk of [
    "exam_sessions_sourceTeachingPracticeLessonId_fkey",
    "exam_beginner_children_sourceChildId_fkey",
  ]) {
    const line = MIGRATION.split("\n").find((l) => l.includes(fk));
    assert.ok(line?.includes("ON DELETE SET NULL"), `${fk} must be ON DELETE SET NULL`);
  }
});

test("external identity FKs use Restrict; Cascade stays inside the exam tree", () => {
  const restrictFks: Record<string, string> = {
    exam_plans_courseOfferingId_fkey: "course_offerings",
    exam_sessions_planId_fkey: "exam_plans",
    exam_sessions_interfaceSessionId_fkey: "exam_sessions",
    exam_assignments_studentId_fkey: "students",
    exam_session_supervisors_instructorId_fkey: "instructors",
  };
  for (const [fk, target] of Object.entries(restrictFks)) {
    const line = MIGRATION.split("\n").find((l) => l.includes(`"${fk}"`));
    assert.ok(line, `${fk} missing from the migration`);
    assert.ok(line.includes(`"${target}"`), `${fk} must reference ${target}`);
    assert.ok(line.includes("ON DELETE RESTRICT"), `${fk} must be ON DELETE RESTRICT`);
  }

  // Every CASCADE in this migration must be an exam child pointing at
  // exam_sessions - never at a Student, Instructor, CourseOffering or TP row.
  const cascades = MIGRATION.split("\n").filter((l) => l.includes("ON DELETE CASCADE"));
  assert.equal(cascades.length, 3);
  for (const line of cascades) {
    assert.ok(line.includes('REFERENCES "exam_sessions"'), `unexpected cascade: ${line}`);
    assert.ok(
      /ALTER TABLE "exam_(assignments|beginner_children|session_supervisors)"/.test(line),
      `unexpected cascade source: ${line}`,
    );
  }
});

// --- indexes and unique constraints ----------------------------------------

test("the two view-serving composite indexes exist", () => {
  const s = block("model", "ExamSession");
  // "by date": WHERE planId AND date ORDER BY startTime, orderIndex, id
  assert.ok(s.includes("@@index([planId, date, orderIndex])"));
  // "by exam type" + the general schedule's GROUP BY kind
  assert.ok(s.includes("@@index([planId, kind, date, orderIndex])"));
  assert.ok(
    MIGRATION.includes('CREATE INDEX "exam_sessions_planId_date_orderIndex_idx"'),
  );
  assert.ok(
    MIGRATION.includes('CREATE INDEX "exam_sessions_planId_kind_date_orderIndex_idx"'),
  );
});

test("every approved unique constraint exists, including the copy idempotency key", () => {
  assert.ok(
    block("model", "ExamSession").includes(
      "@@unique([planId, sourceTeachingPracticeLessonId])",
    ),
  );
  assert.ok(block("model", "ExamAssignment").includes("@@unique([sessionId, studentId])"));
  assert.ok(
    block("model", "ExamBeginnerChild").includes(
      "@@unique([sessionId, sourceChildAssignmentId])",
    ),
  );
  assert.ok(
    block("model", "ExamSessionSupervisor").includes("@@unique([sessionId, instructorId])"),
  );

  for (const idx of [
    "exam_plans_courseOfferingId_key",
    "exam_sessions_planId_sourceTeachingPracticeLessonId_key",
    "exam_assignments_sessionId_studentId_key",
    "exam_beginner_children_sessionId_sourceChildAssignmentId_key",
    "exam_session_supervisors_sessionId_instructorId_key",
  ]) {
    assert.ok(
      MIGRATION.includes(`CREATE UNIQUE INDEX "${idx}"`),
      `missing unique index ${idx}`,
    );
  }
});

// --- migration safety -------------------------------------------------------

test("the migration creates ONLY the approved exam tables and enums", () => {
  const tables = [...MIGRATION.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...tables].sort(), [
    "exam_assignments",
    "exam_beginner_children",
    "exam_plans",
    "exam_session_supervisors",
    "exam_sessions",
  ]);
  const types = [...MIGRATION.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...types].sort(), [...EXAM_ENUMS].sort());
});

test("the migration touches no existing table and carries no data statements", () => {
  // Additive only: every ALTER TABLE is an exam table gaining its own FK.
  for (const m of MIGRATION.matchAll(/ALTER TABLE "(\w+)"/g)) {
    assert.ok(m[1].startsWith("exam_"), `migration alters a non-exam table: ${m[1]}`);
  }
  // No DML, no seed data, no destructive DDL. These are matched as STATEMENTS
  // (anchored at a line start), because "ON DELETE CASCADE" / "ON UPDATE
  // CASCADE" are legitimate FK clauses that a naive substring check would flag.
  const FORBIDDEN_STATEMENTS: readonly [string, RegExp][] = [
    ["INSERT", /^\s*INSERT\s+INTO\b/im],
    ["UPDATE", /^\s*UPDATE\s+"/im],
    ["DELETE", /^\s*DELETE\s+FROM\b/im],
    ["TRUNCATE", /^\s*TRUNCATE\b/im],
    ["DROP TABLE", /^\s*DROP\s+TABLE\b/im],
    ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
    ["ALTER TYPE", /^\s*ALTER\s+TYPE\b/im],
    ["COPY", /^\s*COPY\s+"/im],
  ];
  for (const [label, pattern] of FORBIDDEN_STATEMENTS) {
    assert.equal(
      pattern.test(MIGRATION),
      false,
      `migration must not contain a ${label} statement`,
    );
  }
});

test("the migration sorts after the riding-progress migration and leaves it alone", () => {
  const dirs = readdirSync(join(REPO_ROOT, "prisma", "migrations")).filter((d) =>
    /^\d{14}_/.test(d),
  );
  assert.ok(dirs.includes(MIGRATION_DIR), "the exam migration directory is missing");
  const ridingProgress = dirs.find((d) => d.includes("riding_progress_feedback_course_offering"));
  assert.ok(ridingProgress, "the riding-progress migration must still be present");
  assert.ok(
    MIGRATION_DIR > ridingProgress,
    `${MIGRATION_DIR} must sort after ${ridingProgress}`,
  );
  // The exam migration must not touch any riding-progress DATABASE OBJECT.
  // Matched by table/column name, not by the substring "riding" - RIDING and
  // INTERFACE_RIDING are legitimate ExamPhase/ExamKind enum values.
  for (const object of [
    "student_riding_progress_feedback",
    "riding_slots",
    "riding_lesson_notes",
    "weekly_riding_activities",
  ]) {
    assert.equal(
      MIGRATION.includes(object),
      false,
      `the exam migration must not reference ${object}`,
    );
  }
});

test("no production identifier is hardcoded anywhere in the exam slice", () => {
  // The two live CourseOffering ids, and any cuid-shaped literal. Assembled
  // from fragments so THIS file does not itself contain the literal it forbids.
  const prodIds = ["cmrqngqhn0001" + "7gcndjixzrh0", "cmrxk58vc0000" + "lscnfm54bpze"];
  const files = readdirSync(join(REPO_ROOT, "lib", "exam"))
    // Exclude this suite: it necessarily names the ids it is looking for.
    .filter((f) => f.endsWith(".ts") && f !== "exam-schema-structure.test.ts")
    .map((f) => readFileSync(join(REPO_ROOT, "lib", "exam", f), "utf8"));
  for (const source of [...files, SCHEMA, MIGRATION]) {
    for (const id of prodIds) {
      assert.equal(source.includes(id), false, `hardcoded production id ${id}`);
    }
    assert.equal(
      /["']c[a-z0-9]{24}["']/.test(source),
      false,
      "a cuid-shaped literal is hardcoded",
    );
  }
});

// --- containment: nothing runtime consumes EX-C1 yet ------------------------

test("no runtime reader, writer, page or action imports the EX-C1 cores yet", () => {
  const NEW_MODULES = [
    "exam-beginner-copy-core",
    "exam-schedule-projection-core",
    "exam-kind-labels",
    "exam-domain-core",
    "exam-conflict-core",
    "exam-overlap-core",
    "exam-publication-core",
    "exam-interface-riding-core",
  ];
  const offenders: string[] = [];

  function walk(dir: string, skip: (path: string) => boolean): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (skip(full)) continue;
      if (entry.isDirectory()) {
        walk(full, skip);
      } else if (/\.tsx?$/.test(entry.name)) {
        const source = readFileSync(full, "utf8");
        for (const mod of NEW_MODULES) {
          if (source.includes(`lib/exam/${mod}`) || source.includes(`./${mod}`)) {
            offenders.push(`${full} -> ${mod}`);
          }
        }
      }
    }
  }

  // Everything runtime-facing, excluding lib/exam itself (the cores and their
  // own tests are of course allowed to reference each other).
  walk(join(REPO_ROOT, "app"), (p) => p.includes("generated"));
  walk(join(REPO_ROOT, "lib"), (p) => p.includes(join("lib", "exam")));

  assert.deepEqual(
    offenders,
    [],
    `EX-C1 must stay unwired; found: ${offenders.join(", ")}`,
  );
});
