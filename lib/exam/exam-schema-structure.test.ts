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

/** The five models introduced by EX-C1. EX-C2-0 must not alter any of them. */
const EXAM_C1_MODELS = [
  "ExamPlan",
  "ExamSession",
  "ExamAssignment",
  "ExamBeginnerChild",
  "ExamSessionSupervisor",
] as const;

/**
 * EX-C2-0 adds one model (the live-projection source-date table); EX-S3 adds two
 * more (the canonical definition and the positional break).
 */
const EXAM_MODELS = [
  ...EXAM_C1_MODELS,
  "ExamTeachingPracticeSourceDate",
  "ExamDefinition",
  "ExamSessionBreak",
] as const;

// EX-C2-0 — the additive source-date migration, generated OFFLINE by a
// schema-to-schema diff (never against a database).
const SOURCE_DATE_MIGRATION_DIR = "20260729140000_add_exam_teaching_practice_source_date";
const SOURCE_DATE_MIGRATION = readFileSync(
  join(REPO_ROOT, "prisma", "migrations", SOURCE_DATE_MIGRATION_DIR, "migration.sql"),
  "utf8",
);

// EX-S3 — the additive definition/break migration, likewise generated OFFLINE by
// a schema-to-schema diff against HEAD's schema. It is the FIRST exam migration
// to touch an already-created exam table, so its safety assertions below are
// stricter than the two before it rather than looser.
const S3_MIGRATION_DIR = "20260730120000_add_exam_definition_and_breaks";
const S3_MIGRATION = readFileSync(
  join(REPO_ROOT, "prisma", "migrations", S3_MIGRATION_DIR, "migration.sql"),
  "utf8",
);

// EX-ASG-MULTIPLICITY — the index-only migration that narrows the assignment
// uniqueness key from ROLE-BLIND to EXAMINEE-ONLY. Hand-written, because the
// stable schema.prisma DSL has no WHERE-qualified `@@unique`.
const MULTIPLICITY_MIGRATION_DIR = "20260802120000_scope_exam_assignment_unique_to_examinee";
const MULTIPLICITY_MIGRATION = readFileSync(
  join(REPO_ROOT, "prisma", "migrations", MULTIPLICITY_MIGRATION_DIR, "migration.sql"),
  "utf8",
);

/** The hand-chosen, stable name of the replacement partial unique index. */
const EXAMINEE_UNIQUE_INDEX = "exam_assignments_examinee_session_student_key";

/** The role-blind index it replaces, created by EX-C1 and dropped by this stage. */
const ROLE_BLIND_UNIQUE_INDEX = "exam_assignments_sessionId_studentId_key";

/**
 * The EXACT `CREATE UNIQUE INDEX` statement the migration must carry, matched as
 * one whole statement rather than as loose fragments — a predicate that drifted
 * to another role, another column pair or another table would still satisfy a
 * substring check on the index name alone.
 */
const EXAMINEE_UNIQUE_STATEMENT =
  `CREATE UNIQUE INDEX "${EXAMINEE_UNIQUE_INDEX}" ON "exam_assignments"` +
  `("sessionId", "studentId") WHERE "role" = 'EXAMINEE';`;

/**
 * The partial key, re-expressed as the PREDICATE it denotes, so the multiplicity
 * rules below are asserted as behaviour rather than as prose.
 *
 * Two rows collide iff BOTH are EXAMINEE rows of the same session naming the same
 * non-null student. Postgres treats every NULL as distinct, which is why a null
 * `studentId` never collides — unchanged from the old blanket key.
 */
function collidesUnderExamineeKey(
  a: { sessionId: string; studentId: string | null; role: string },
  b: { sessionId: string; studentId: string | null; role: string },
): boolean {
  if (a.role !== "EXAMINEE" || b.role !== "EXAMINEE") return false;
  if (a.studentId === null || b.studentId === null) return false;
  return a.sessionId === b.sessionId && a.studentId === b.studentId;
}

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

test("exactly eight exam models exist, and no catch-all Exam entity", () => {
  const declared = [...SCHEMA.matchAll(/^model\s+(Exam\w*)\s*\{/gm)].map((m) => m[1]);
  assert.deepEqual([...declared].sort(), [...EXAM_MODELS].sort());
  // Five EX-C1 + one EX-C2-0 source-date + two EX-S3 (definition, break).
  assert.equal(declared.length, 8);
  assert.equal(EXAM_C1_MODELS.length, 5);

  // EX-S3 INVERTS the old EX-C1 rule. "לפי מבחן" no longer groups by
  // ExamSession.kind: ExamDefinition is now the canonical grouping identity and
  // MUST exist.
  assert.ok(
    SCHEMA.includes("model ExamDefinition {"),
    "ExamDefinition is the canonical exam identity and must exist",
  );

  // These two remain forbidden: a catch-all `Exam` and a second, competing
  // type entity would each reintroduce an identity rival to ExamDefinition.
  assert.equal(SCHEMA.includes("model Exam {"), false);
  assert.equal(SCHEMA.includes("model ExamType {"), false);
});

test("no slot, wave, timetable or calculated-time model exists", () => {
  // THE load-bearing invariant of the whole module: per-trainee start/end times,
  // wave boundaries and block end times are DERIVED on every read and are never
  // persisted. Asserted structurally rather than left to prose, because a
  // "performance" table is exactly the well-meaning future edit that would
  // silently create the second source of truth this design exists to prevent.
  const declared = [...SCHEMA.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);
  for (const name of declared) {
    assert.equal(
      /^Exam.*(Slot|Wave|Timetable|Schedule|Calculated|Derived|Computed)/.test(name),
      false,
      `${name} looks like a persisted derived-time table; derived times are never stored`,
    );
  }
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
  assert.match(s, /\n\s+definitionId\s+String\n/);
  assert.match(s, /\n\s+date\s+DateTime\s+@db\.Date/);
  assert.match(s, /\n\s+startTime\s+String\n/);
  assert.match(s, /\n\s+orderIndex\s+Int\n/);
  // EX-S3 — kind is now NULLABLE and unwritten: ExamDefinition.kind is the only
  // active stored source of behavioural kind.
  assert.match(s, /\n\s+kind\s+ExamKind\?/);
  // EX-S3 — endTime is now NULLABLE and superseded by the DERIVED block end.
  assert.match(s, /\n\s+endTime\s+String\?/);
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
  // EX-S3 — the manager's explicit EXAMINEE WAVE ORDERING. The default makes
  // the column total on every row from introduction, and the assignment id
  // remains the deterministic final tie-break.
  assert.match(a, /\n\s+orderIndex\s+Int\s+@default\(0\)/);
  // EX-S3 — optional free text ("ענף"). No Discipline enum, no Discipline table.
  assert.match(a, /\n\s+discipline\s+String\?/);
  assert.equal(
    /enum\s+Discipline\s*\{/.test(SCHEMA) || /model\s+Discipline\s*\{/.test(SCHEMA),
    false,
    "discipline is free text: no Discipline enum or table may be introduced",
  );
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

test("the view-serving composite indexes exist", () => {
  const s = block("model", "ExamSession");
  // "by date": WHERE planId AND date ORDER BY startTime, orderIndex, id
  assert.ok(s.includes("@@index([planId, date, orderIndex])"));
  // EX-C1's kind-grouped index. DEAD after EX-S3 but RETAINED, not dropped:
  // dropping is destructive DDL and buys nothing on a table of dozens of rows.
  assert.ok(s.includes("@@index([planId, kind, date, orderIndex])"));
  // EX-S3 — the ACTIVE "by exam type" index, now keyed on the definition.
  assert.ok(s.includes("@@index([planId, definitionId, date, orderIndex])"));
  assert.ok(
    MIGRATION.includes('CREATE INDEX "exam_sessions_planId_date_orderIndex_idx"'),
  );
  assert.ok(
    MIGRATION.includes('CREATE INDEX "exam_sessions_planId_kind_date_orderIndex_idx"'),
  );
  assert.ok(
    S3_MIGRATION.includes(
      'CREATE INDEX "exam_sessions_planId_definitionId_date_orderIndex_idx"',
    ),
  );
  // EX-S3 — the ordered examinee fetch feeding the derived wave calculation.
  assert.ok(block("model", "ExamAssignment").includes("@@index([sessionId, orderIndex])"));
  assert.ok(
    S3_MIGRATION.includes('CREATE INDEX "exam_assignments_sessionId_orderIndex_idx"'),
  );
});

test("every approved unique constraint exists, including the copy idempotency key", () => {
  assert.ok(
    block("model", "ExamSession").includes(
      "@@unique([planId, sourceTeachingPracticeLessonId])",
    ),
  );
  // EX-ASG-MULTIPLICITY — ExamAssignment's `@@unique([sessionId, studentId])` is
  // deliberately ABSENT from the DSL now. It was replaced by an EXAMINEE-scoped
  // PARTIAL unique index that schema.prisma cannot express; the dedicated block
  // of tests further down owns that claim in full.
  assert.equal(
    block("model", "ExamAssignment").includes("@@unique([sessionId, studentId])"),
    false,
    "the role-blind assignment unique key is back in the DSL",
  );
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
    // The creating migration is HISTORY and stays byte-identical: it really did
    // create the role-blind key. The LATER migration is what drops it.
    "exam_assignments_sessionId_studentId_key",
    "exam_beginner_children_sessionId_sourceChildAssignmentId_key",
    "exam_session_supervisors_sessionId_instructorId_key",
  ]) {
    assert.ok(
      MIGRATION.includes(`CREATE UNIQUE INDEX "${idx}"`),
      `missing unique index ${idx}`,
    );
  }

  // EX-S3 uniques.
  const def = block("model", "ExamDefinition");
  // The visible exam name must be unambiguous within its plan: the name IS the
  // group label, so a duplicate would render as one group the manager cannot
  // tell apart.
  assert.ok(def.includes("@@unique([planId, name])"));
  // NOT redundant with @id — this is the composite-FK reference target.
  assert.ok(def.includes("@@unique([planId, id])"));
  assert.ok(
    block("model", "ExamSessionBreak").includes("@@unique([sessionId, afterWaveIndex])"),
  );
  for (const idx of [
    "exam_definitions_planId_name_key",
    "exam_definitions_planId_id_key",
    "exam_session_breaks_sessionId_afterWaveIndex_key",
  ]) {
    assert.ok(
      S3_MIGRATION.includes(`CREATE UNIQUE INDEX "${idx}"`),
      `missing unique index ${idx}`,
    );
  }
});

// --- EX-ASG-MULTIPLICITY: the role-scoped assignment uniqueness key ----------
//
// These tests are TEXT-level proofs over schema.prisma and the migration SQL,
// exactly like the rest of this suite. They open no database and execute no SQL,
// so what they prove is that the authored constraint SAYS the right thing —
// applying it and observing PostgreSQL enforce it is a deployment step, not a
// test step.

test("EX-ASG-MULTIPLICITY: the role-blind unique key is dropped, once, by name", () => {
  assert.ok(
    MULTIPLICITY_MIGRATION.includes(`DROP INDEX "${ROLE_BLIND_UNIQUE_INDEX}";`),
    "the old role-blind key is not dropped",
  );
  // Exactly ONE drop, and it names that index. A second drop would be reaching
  // for a constraint this stage never approved touching.
  const drops = [...MULTIPLICITY_MIGRATION.matchAll(/^\s*DROP\s+INDEX\s+"([^"]+)"/gim)].map(
    (m) => m[1],
  );
  assert.deepEqual(drops, [ROLE_BLIND_UNIQUE_INDEX]);
});

test("EX-ASG-MULTIPLICITY: exactly one partial unique index replaces it, verbatim", () => {
  assert.ok(
    MULTIPLICITY_MIGRATION.includes(EXAMINEE_UNIQUE_STATEMENT),
    "the EXAMINEE-scoped partial unique index statement is missing or altered",
  );
  // ONE create, and it is that one. The index name is HAND-CHOSEN rather than
  // left to Postgres, so it stays stable for the P2002 classifiers to match.
  const creates = [
    ...MULTIPLICITY_MIGRATION.matchAll(/^\s*CREATE\s+UNIQUE\s+INDEX\s+"([^"]+)"/gim),
  ].map((m) => m[1]);
  assert.deepEqual(creates, [EXAMINEE_UNIQUE_INDEX]);
  // The predicate is present and is a ROLE predicate — not a status, not a date,
  // not a nullability test.
  assert.match(MULTIPLICITY_MIGRATION, /WHERE "role" = 'EXAMINEE'/);
});

test("EX-ASG-MULTIPLICITY: the migration is index-only and touches no other table", () => {
  // No DML of any kind: this stage must never read, rewrite or delete a row.
  for (const [label, pattern] of [
    ["INSERT", /^\s*INSERT\s+INTO\b/im],
    ["UPDATE", /^\s*UPDATE\s+"/im],
    ["DELETE", /^\s*DELETE\s+FROM\b/im],
    ["DROP TABLE", /^\s*DROP\s+TABLE\b/im],
    ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
    ["ALTER TABLE", /^\s*ALTER\s+TABLE\b/im],
    ["CREATE TABLE", /^\s*CREATE\s+TABLE\b/im],
    ["CREATE TYPE", /^\s*CREATE\s+TYPE\b/im],
    ["TRUNCATE", /^\s*TRUNCATE\b/im],
  ] as const) {
    assert.equal(
      pattern.test(MULTIPLICITY_MIGRATION),
      false,
      `the migration carries a ${label} statement`,
    );
  }
  // Every table it names is the assignment table.
  const tables = [...MULTIPLICITY_MIGRATION.matchAll(/\bON\s+"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tables)], ["exam_assignments"]);
});

test("EX-ASG-MULTIPLICITY: no unrelated assignment index or constraint is weakened", () => {
  const model = block("model", "ExamAssignment");
  // The two ordinary indexes are untouched, in the DSL and in the SQL.
  assert.ok(model.includes("@@index([studentId])"));
  assert.ok(model.includes("@@index([sessionId, orderIndex])"));
  // They may be NAMED in the migration's prose (it says explicitly which objects
  // it leaves alone), but no STATEMENT may touch them. Comments are stripped
  // first so the documentation cannot satisfy — or trip — this check.
  const statements = MULTIPLICITY_MIGRATION.split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  for (const survivor of [
    "exam_assignments_studentId_idx",
    "exam_assignments_sessionId_orderIndex_idx",
    "exam_assignments_pkey",
    "exam_assignments_sessionId_fkey",
    "exam_assignments_studentId_fkey",
  ]) {
    assert.equal(
      statements.includes(survivor),
      false,
      `a statement in the migration touches ${survivor}`,
    );
  }
  // The relations and their delete behaviour are exactly as before.
  assert.match(model, /session\s+ExamSession\s+@relation\([^)]*onDelete: Cascade\)/);
  assert.match(model, /student\s+Student\?\s+@relation\([^)]*onDelete: Restrict\)/);
});

test("EX-ASG-MULTIPLICITY: a trainee may be EXAMINEE and INSTRUCTED_TRAINEE in one session", () => {
  const examinee = { sessionId: "s1", studentId: "stu1", role: "EXAMINEE" };
  const instructed = { sessionId: "s1", studentId: "stu1", role: "INSTRUCTED_TRAINEE" };
  assert.equal(
    collidesUnderExamineeKey(examinee, instructed),
    false,
    "the same trainee as examinee + instructed trainee is still blocked",
  );
});

test("EX-ASG-MULTIPLICITY: a trainee may be INSTRUCTED_TRAINEE of several examinees at once", () => {
  // Two instructed-trainee rows for one person in one session — one per examinee
  // they accompany. Distinguished by pairingIndex, which the key never reads.
  const first = { sessionId: "s1", studentId: "stu1", role: "INSTRUCTED_TRAINEE" };
  const second = { sessionId: "s1", studentId: "stu1", role: "INSTRUCTED_TRAINEE" };
  assert.equal(collidesUnderExamineeKey(first, second), false);
});

test("EX-ASG-MULTIPLICITY: TWO EXAMINEE rows for one trainee in one session stay blocked", () => {
  const first = { sessionId: "s1", studentId: "stu1", role: "EXAMINEE" };
  const second = { sessionId: "s1", studentId: "stu1", role: "EXAMINEE" };
  assert.equal(
    collidesUnderExamineeKey(first, second),
    true,
    "the one invariant that must NOT regress has regressed",
  );
  // ...and it is scoped: another session, or another trainee, is not a collision.
  assert.equal(
    collidesUnderExamineeKey(first, { ...second, sessionId: "s2" }),
    false,
  );
  assert.equal(
    collidesUnderExamineeKey(first, { ...second, studentId: "stu2" }),
    false,
  );
  // NULL studentId is unconstrained, as it was under the old blanket key.
  assert.equal(
    collidesUnderExamineeKey(
      { sessionId: "s1", studentId: null, role: "EXAMINEE" },
      { sessionId: "s1", studentId: null, role: "EXAMINEE" },
    ),
    false,
  );
});

test("EX-ASG-MULTIPLICITY: the partial index is documented, not silently dropped", () => {
  const model = block("model", "ExamAssignment");
  // schema.prisma must POINT AT the migration, so the next reader of the model
  // learns the constraint exists rather than concluding there is none.
  assert.ok(model.includes(MULTIPLICITY_MIGRATION_DIR), "the model does not cite the migration");
  assert.ok(model.includes(EXAMINEE_UNIQUE_INDEX), "the model does not name the index");
  // ...and the migration must say it is hand-written and must be preserved,
  // the same warning the three existing partial indexes carry.
  assert.match(MULTIPLICITY_MIGRATION, /PRESERVED BY HAND/i);
});

test("EX-ASG-MULTIPLICITY: every P2002 classifier names the NEW index and not the old", () => {
  // Each module name is SPLIT, exactly as the exam guard suites split theirs:
  // those suites detect "who reaches this binding" by searching for the module
  // name as a contiguous substring, and a whole literal here would enrol this
  // structural suite in their caller allow-lists.
  for (const rel of [
    join("lib", "actions", "exam-assignment-write" + "-io.ts"),
    join("lib", "actions", "exam-instructed-trainee-assignment-write" + "-io.ts"),
    join("lib", "actions", "detailed-exam-assignment-write" + "-io.ts"),
  ]) {
    const code = readFileSync(join(REPO_ROOT, rel), "utf8");
    assert.ok(code.includes(`"${EXAMINEE_UNIQUE_INDEX}"`), `${rel} does not name the new index`);
    assert.equal(
      code.includes(`"${ROLE_BLIND_UNIQUE_INDEX}"`),
      false,
      `${rel} still matches the DROPPED index name`,
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
    "exam-beginner-format-core",
    "exam-live-beginner-adapter-core",
    "exam-beginner-copy-core",
    "exam-schedule-projection-core",
    "exam-kind-labels",
    "exam-domain-core",
    "exam-conflict-core",
    "exam-overlap-core",
    "exam-publication-core",
    // EX-S3.5: exam-interface-riding-core is DELETED, so it is no longer listed
    // here; a dedicated test below proves nothing anywhere still references it.
    // EX-C2 / EX-S3 — still unwired. S3 adds schema only: no reader, writer,
    // action, route or UI may import any exam core until the S5 binding slice.
    "exam-block-timetable-core",
    "exam-definition-validation-core",
    "exam-no-feedback-guard",
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

// ===========================================================================
// EX-C2-0 ג€” ExamTeachingPracticeSourceDate: the ONLY stored beginner fact
// ===========================================================================

test("ExamTeachingPracticeSourceDate declares exactly the five approved fields", () => {
  const model = block("model", "ExamTeachingPracticeSourceDate");

  assert.match(model, /\bid\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(model, /\bplanId\s+String\b/);
  assert.match(model, /\bdate\s+DateTime\s+@db\.Date\b/);
  assert.match(model, /\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(model, /\bupdatedAt\s+DateTime\s+@updatedAt\b/);

  // Exactly five scalar fields ג€” nothing operational leaked in.
  const scalars = [
    ...model.matchAll(/^\s{2}(\w+)\s+(String|DateTime|Int|Boolean|Json)\b/gm),
  ].map((m) => m[1]);
  assert.deepEqual(scalars.sort(), ["createdAt", "date", "id", "planId", "updatedAt"]);
});

test("ExamTeachingPracticeSourceDate duplicates NO Teaching-Practice data", () => {
  const model = block("model", "ExamTeachingPracticeSourceDate");
  // The whole point of the live-projection design: this table stores a pointer,
  // never a copy of lesson/participant/child/contact/horse detail.
  for (const forbidden of [
    "lessonId",
    "practiceType",
    "startTime",
    "endTime",
    "arena",
    "parentName",
    "parentPhone",
    "horseName",
    "equipmentNotes",
    "isAbsent",
    "childId",
    "traineeId",
    "instructorId",
    "roleLabelOverrides",
    "beginnerFormat",
    "copiedAt",
    "fingerprint",
    "syncedAt",
  ]) {
    assert.equal(
      model.includes(forbidden),
      false,
      `ExamTeachingPracticeSourceDate must not carry ${forbidden}`,
    );
  }
});

test("ExamTeachingPracticeSourceDate has all required fields non-nullable", () => {
  const model = block("model", "ExamTeachingPracticeSourceDate");
  // No `?` anywhere in the field block: every column is required.
  const optionals = [...model.matchAll(/^\s{2}(\w+)\s+\w+\?/gm)].map((m) => m[1]);
  assert.deepEqual(optionals, []);
});

test("ExamTeachingPracticeSourceDate is unique per (plan, date) and maps correctly", () => {
  const model = block("model", "ExamTeachingPracticeSourceDate");
  assert.match(model, /@@unique\(\[planId,\s*date\]\)/);
  assert.match(model, /@@map\("exam_teaching_practice_source_dates"\)/);
});

test("ExamTeachingPracticeSourceDate cascades from its plan", () => {
  const model = block("model", "ExamTeachingPracticeSourceDate");
  assert.match(
    model,
    /plan\s+ExamPlan\s+@relation\(fields:\s*\[planId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
});

test("ExamPlan carries the sourceDates back-relation", () => {
  const model = block("model", "ExamPlan");
  assert.match(model, /sourceDates\s+ExamTeachingPracticeSourceDate\[\]/);
});

// --- the additive migration -------------------------------------------------

test("the EX-C2-0 migration contains ONLY the approved additive DDL", () => {
  const statements = SOURCE_DATE_MIGRATION.split(";")
    .map((s) => s.trim())
    .filter(
      (s) => s.length > 0 && !s.split("\n").every((line) => line.trim().startsWith("--")),
    );

  assert.equal(statements.length, 3, `expected 3 statements, got:\n${statements.join("\n--\n")}`);

  const [createTable, createIndex, addForeignKey] = statements;
  assert.match(createTable, /CREATE TABLE "exam_teaching_practice_source_dates"/);
  assert.match(
    createIndex,
    /CREATE UNIQUE INDEX "exam_teaching_practice_source_dates_planId_date_key" ON "exam_teaching_practice_source_dates"\("planId", "date"\)/,
  );
  assert.match(
    addForeignKey,
    /ALTER TABLE "exam_teaching_practice_source_dates" ADD CONSTRAINT "exam_teaching_practice_source_dates_planId_fkey" FOREIGN KEY \("planId"\) REFERENCES "exam_plans"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE/,
  );
});

test("the EX-C2-0 migration alters, drops and writes NOTHING", () => {
  // The single ALTER TABLE is the FK add on the brand-new table itself; no
  // pre-existing object may be touched, and no data statement may appear.
  const alters = [...SOURCE_DATE_MIGRATION.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(alters, ["exam_teaching_practice_source_dates"]);

  // Anchored to STATEMENT starts, not substrings: `ON UPDATE CASCADE` is a
  // legitimate part of the FK clause and must not read as a data statement.
  const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
    ["INSERT", /^\s*INSERT\s/im],
    ["UPDATE", /^\s*UPDATE\s/im],
    ["DELETE", /^\s*DELETE\s/im],
    ["TRUNCATE", /^\s*TRUNCATE\s/im],
    ["DROP", /\bDROP\b/i],
    ["ALTER COLUMN", /\bALTER\s+COLUMN\b/i],
    ["ALTER TYPE", /\bALTER\s+TYPE\b/i],
    ["CREATE TYPE", /\bCREATE\s+TYPE\b/i],
  ];
  for (const [label, pattern] of FORBIDDEN) {
    assert.equal(
      pattern.test(SOURCE_DATE_MIGRATION),
      false,
      `the migration must not contain ${label}`,
    );
  }

  // The ON UPDATE / ON DELETE actions themselves are required and present.
  assert.match(SOURCE_DATE_MIGRATION, /ON DELETE CASCADE ON UPDATE CASCADE/);
});

test("the EX-C2-0 migration never touches the five EX-C1 tables", () => {
  for (const table of [
    "exam_plans",
    "exam_sessions",
    "exam_assignments",
    "exam_beginner_children",
    "exam_session_supervisors",
  ]) {
    const mentions = [...SOURCE_DATE_MIGRATION.matchAll(new RegExp(`"${table}"`, "g"))].length;
    if (table === "exam_plans") {
      // exam_plans may appear ONLY as the FK reference target.
      assert.equal(mentions, 1, "exam_plans may appear only as the FK REFERENCES target");
      assert.match(SOURCE_DATE_MIGRATION, /REFERENCES "exam_plans"\("id"\)/);
    } else {
      assert.equal(mentions, 0, `${table} must not appear in the EX-C2-0 migration`);
    }
  }
});

test("the five EX-C1 tables and four enums are structurally unchanged", () => {
  // Re-assert the EX-C1 migration text verbatim: EX-C2-0 is additive only, so
  // the already-applied migration file must not have been edited after the fact.
  for (const table of [
    "exam_plans",
    "exam_sessions",
    "exam_assignments",
    "exam_beginner_children",
    "exam_session_supervisors",
  ]) {
    assert.ok(
      MIGRATION.includes(`CREATE TABLE "${table}"`),
      `${table} must still be created by the EX-C1 migration`,
    );
    assert.equal(
      SOURCE_DATE_MIGRATION.includes(`CREATE TABLE "${table}"`),
      false,
      `${table} must not be recreated by EX-C2-0`,
    );
  }

  const ENUM_VALUES: readonly (readonly [string, string])[] = [
    [
      "ExamKind",
      "'INTERFACE_RIDING', 'LUNGE_NO_RIDER', 'ADVANCED_INSTRUCTION', 'BEGINNER_INSTRUCTION'",
    ],
    ["ExamPhase", "'INTERFACE', 'RIDING'"],
    ["ExamBeginnerFormat", "'LUNGE', 'BEGINNER_PRIVATE', 'BEGINNER_GROUP'"],
    ["ExamAssignmentRole", "'EXAMINEE', 'INSTRUCTED_TRAINEE'"],
  ];
  for (const [enumName, values] of ENUM_VALUES) {
    assert.ok(
      MIGRATION.includes(`CREATE TYPE "${enumName}" AS ENUM (${values})`),
      `${enumName} must keep its exact EX-C1 values`,
    );
    assert.equal(
      SOURCE_DATE_MIGRATION.includes(enumName),
      false,
      `${enumName} must not be touched by EX-C2-0`,
    );
  }

  // THEORY / DEMO_RIDER were never introduced and must stay absent from the
  // enum VALUES (the surrounding prose says so deliberately) and from both
  // migrations.
  for (const forbidden of ["THEORY", "DEMO_RIDER"]) {
    assert.equal(block("enum", "ExamKind").includes(forbidden), false);
    assert.equal(block("enum", "ExamAssignmentRole").includes(forbidden), false);
    assert.equal(SOURCE_DATE_MIGRATION.includes(forbidden), false);
  }
});

// --- the deprecated snapshot surface is retained, not dropped ---------------

test("the EX-C1 snapshot models are retained and documented as deprecated", () => {
  // Retaining an empty table is deliberate: dropping it would cost an
  // irreversible production DDL operation and buy nothing.
  for (const model of EXAM_C1_MODELS) {
    assert.ok(SCHEMA.includes(`model ${model} {`), `${model} must still exist`);
  }

  // The deprecation notices live in the comment block ABOVE each model, which
  // `block()` deliberately excludes - so assert on the schema text directly.
  assert.ok(
    SCHEMA.includes("DEPRECATED (EX-C2-0) - RETAINED EMPTY, NEVER WRITTEN, NEVER READ."),
    "ExamBeginnerChild must be documented as deprecated and retained empty",
  );
  assert.ok(
    SCHEMA.includes("A STORED BEGINNER_INSTRUCTION ROW IS FORBIDDEN"),
    "ExamSession must document that a stored beginner row is forbidden",
  );
  assert.ok(
    SCHEMA.includes("DEPRECATED AND UNWRITTEN"),
    "the superseded beginner columns must be marked deprecated and unwritten",
  );

  // The abandoned trainee/supervisor visibility rule must be gone.
  assert.equal(
    SCHEMA.includes("must NEVER receive either field"),
    false,
    "the abandoned trainee parent-contact prohibition must not survive",
  );
  assert.equal(
    SCHEMA.includes("ONLY when they are an ExamSessionSupervisor"),
    false,
    "the abandoned supervisor contact gate must not survive",
  );
});

// ===========================================================================
// EX-S3 — ExamDefinition: the canonical identity of a stored exam
// ===========================================================================

test("ExamDefinition declares exactly the approved fields with the right nullability", () => {
  const def = block("model", "ExamDefinition");

  assert.match(def, /\bid\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(def, /\n\s+planId\s+String\n/);
  assert.match(def, /\n\s+name\s+String\n/);
  assert.match(def, /\n\s+kind\s+ExamKind\n/);
  assert.match(def, /\n\s+durationMinutes\s+Int\n/);
  assert.match(def, /\n\s+parallelCapacity\s+Int\n/);
  assert.match(def, /\n\s+requiresInstructedTrainee\s+Boolean\s+@default\(false\)/);
  assert.match(def, /\n\s+requiresLessonTopic\s+Boolean\s+@default\(false\)/);
  assert.match(def, /\n\s+requiresDiscipline\s+Boolean\s+@default\(false\)/);
  assert.match(def, /\n\s+orderIndex\s+Int\n/);
  assert.match(def, /\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(def, /\bupdatedAt\s+DateTime\s+@updatedAt\b/);

  // Every column is REQUIRED: a definition with a missing duration or capacity
  // could not produce a timetable, so there is no meaningful partial definition.
  const optionals = [...def.matchAll(/^\s{2}(\w+)\s+\w+\?/gm)].map((m) => m[1]);
  assert.deepEqual(optionals, []);

  // Exactly twelve scalars — nothing operational or derived leaked in.
  const scalars = [
    ...def.matchAll(/^\s{2}(\w+)\s+(String|DateTime|Int|Boolean|Json|ExamKind)\b/gm),
  ].map((m) => m[1]);
  assert.deepEqual(scalars.sort(), [
    "createdAt",
    "durationMinutes",
    "id",
    "kind",
    "name",
    "orderIndex",
    "parallelCapacity",
    "planId",
    "requiresDiscipline",
    "requiresInstructedTrainee",
    "requiresLessonTopic",
    "updatedAt",
  ]);

  // A definition is a CONFIGURATION, never an occurrence: it carries no date,
  // no clock time, no arena and no phase. Matched at FIELD POSITION, not as a
  // raw substring — `updatedAt` legitimately contains "date".
  for (const forbidden of ["date", "startTime", "endTime", "arena", "phase", "capacity"]) {
    assert.equal(
      new RegExp(`^\\s{2}${forbidden}\\s+`, "m").test(def),
      false,
      `ExamDefinition must not carry a ${forbidden} field`,
    );
  }
});

test("ExamDefinition is plan-scoped and Restrict-protected, with no global library", () => {
  const def = block("model", "ExamDefinition");
  assert.match(
    def,
    /plan\s+ExamPlan\s+@relation\(fields:\s*\[planId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
  assert.match(def, /sessions\s+ExamSession\[\]/);
  assert.ok(def.includes('@@map("exam_definitions")'));
  assert.ok(def.includes("@@index([planId, kind])"));

  // Plan-scoped means planId is NOT nullable: there is no global/shared
  // definition library, and no definition may float free of a plan.
  assert.equal(/planId\s+String\?/.test(def), false);

  const line = S3_MIGRATION.split("\n").find((l) =>
    l.includes('"exam_definitions_planId_fkey"'),
  );
  assert.ok(line, "the definition -> plan FK is missing from the migration");
  assert.ok(line.includes('REFERENCES "exam_plans"("id")'));
  assert.ok(line.includes("ON DELETE RESTRICT"));
});

test("ExamPlan carries the definitions back-relation", () => {
  assert.match(block("model", "ExamPlan"), /definitions\s+ExamDefinition\[\]/);
});

test("ExamSession.definitionId is REQUIRED — a definition-less block is unrepresentable", () => {
  const s = block("model", "ExamSession");
  // Required, NOT nullable: D6 locked that a persisted block always has its
  // canonical definition. A draft may exist unsaved in the UI, never as a row.
  assert.match(s, /\n\s+definitionId\s+String\n/);
  assert.equal(
    /definitionId\s+String\?/.test(s),
    false,
    "definitionId must be REQUIRED — no persisted definition-less draft block",
  );
  assert.ok(S3_MIGRATION.includes('ADD COLUMN     "definitionId" TEXT NOT NULL'));
});

test("the session -> definition FK is COMPOSITE, making a cross-plan link unrepresentable", () => {
  const s = block("model", "ExamSession");
  // planId appears on BOTH sides of the reference, so a session in plan A
  // referencing a definition in plan B cannot be stored at all — the guarantee
  // is structural, not a rule someone must remember to write.
  assert.match(
    s,
    /definition\s+ExamDefinition\s+@relation\(fields:\s*\[planId,\s*definitionId\],\s*references:\s*\[planId,\s*id\],\s*onDelete:\s*Restrict\)/,
  );
  // The direct plan relation is RETAINED alongside it (prisma validate accepts
  // the shared planId), because it carries the ExamPlan.sessions back-relation.
  assert.match(
    s,
    /plan\s+ExamPlan\s+@relation\(fields:\s*\[planId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );

  const line = S3_MIGRATION.split("\n").find((l) =>
    l.includes('"exam_sessions_planId_definitionId_fkey"'),
  );
  assert.ok(line, "the composite session -> definition FK is missing");
  assert.ok(
    line.includes('FOREIGN KEY ("planId", "definitionId")'),
    "the FK must be composite on (planId, definitionId)",
  );
  assert.ok(
    line.includes('REFERENCES "exam_definitions"("planId", "id")'),
    "the FK must reference the composite (planId, id) target",
  );
  // Restrict: a definition still in use by any block cannot be deleted, so a
  // dangling definitionId is impossible rather than a state to render.
  assert.ok(line.includes("ON DELETE RESTRICT"));
});

// ===========================================================================
// EX-S3 — ExamSessionBreak: positional input, never calculated time
// ===========================================================================

test("ExamSessionBreak declares exactly the approved positional fields", () => {
  const b = block("model", "ExamSessionBreak");

  assert.match(b, /\bid\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(b, /\n\s+sessionId\s+String\n/);
  assert.match(b, /\n\s+afterWaveIndex\s+Int\n/);
  assert.match(b, /\n\s+durationMinutes\s+Int\n/);
  assert.match(b, /\n\s+label\s+String\?/);
  assert.match(b, /\bcreatedAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(b, /\bupdatedAt\s+DateTime\s+@updatedAt\b/);

  const scalars = [
    ...b.matchAll(/^\s{2}(\w+)\s+(String|DateTime|Int|Boolean|Json)\b/gm),
  ].map((m) => m[1]);
  assert.deepEqual(scalars.sort(), [
    "afterWaveIndex",
    "createdAt",
    "durationMinutes",
    "id",
    "label",
    "sessionId",
    "updatedAt",
  ]);

  assert.ok(b.includes('@@map("exam_session_breaks")'));
});

test("ExamSessionBreak stores NO calculated time", () => {
  const b = block("model", "ExamSessionBreak");
  // A break is a POSITION and a DURATION. Wave starts/ends, per-trainee slots
  // and the block end are derived on every read by exam-block-timetable-core.
  // Persisting any of them would be the second source of truth.
  // Matched at FIELD POSITION so the check cannot pass by accident, and so
  // `afterWaveIndex` is not mistaken for a stored `waveIndex` result.
  for (const forbidden of [
    "startTime",
    "endTime",
    "waveIndex",
    "offset",
    "offsetMinutes",
    "slot",
    "slotIndex",
    "computedAt",
    "calculatedAt",
    "derivedAt",
    "blockEndTime",
  ]) {
    assert.equal(
      new RegExp(`^\\s{2}${forbidden}\\s+`, "m").test(b),
      false,
      `ExamSessionBreak must not carry a ${forbidden} field — derived times are never stored`,
    );
  }
  // `afterWaveIndex` is a POSITION, deliberately distinct from a stored
  // `waveIndex` result: it says where the break sits, not when a wave runs.
  assert.ok(b.includes("afterWaveIndex"));
});

test("ExamSessionBreak is unique per (session, afterWaveIndex) and cascades from its block", () => {
  const b = block("model", "ExamSessionBreak");
  // Without this, two breaks could share an index and silently SUM — the exact
  // state exam-block-timetable-core notes it must stay total against.
  assert.ok(b.includes("@@unique([sessionId, afterWaveIndex])"));
  assert.match(
    b,
    /session\s+ExamSession\s+@relation\(fields:\s*\[sessionId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
  assert.match(block("model", "ExamSession"), /breaks\s+ExamSessionBreak\[\]/);

  const line = S3_MIGRATION.split("\n").find((l) =>
    l.includes('"exam_session_breaks_sessionId_fkey"'),
  );
  assert.ok(line, "the break -> session FK is missing");
  assert.ok(line.includes('REFERENCES "exam_sessions"("id")'));
  assert.ok(line.includes("ON DELETE CASCADE"));
});

test("EX-S3 introduced no stored individual start/end time anywhere", () => {
  // The migration may add exactly three columns, and none of them is a time.
  const added = [...S3_MIGRATION.matchAll(/ADD COLUMN\s+"(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...added].sort(), ["definitionId", "discipline", "orderIndex"]);
  for (const column of added) {
    assert.equal(
      /(startTime|endTime|slotStart|slotEnd|waveStart|waveEnd|blockEnd)/i.test(column),
      false,
      `${column} looks like a persisted derived time`,
    );
  }
  // And neither new table declares one.
  for (const model of ["ExamDefinition", "ExamSessionBreak"]) {
    const body = block("model", model);
    assert.equal(/\n\s+startTime\s+/.test(body), false, `${model} must not store startTime`);
    assert.equal(/\n\s+endTime\s+/.test(body), false, `${model} must not store endTime`);
  }
});

// ===========================================================================
// EX-S3 — the additive migration
// ===========================================================================

test("the EX-S3 migration is ADDITIVE: no drop, no enum change, no data statement", () => {
  const FORBIDDEN_STATEMENTS: readonly [string, RegExp][] = [
    ["INSERT", /^\s*INSERT\s+INTO\b/im],
    ["UPDATE", /^\s*UPDATE\s+"/im],
    ["DELETE", /^\s*DELETE\s+FROM\b/im],
    ["TRUNCATE", /^\s*TRUNCATE\b/im],
    ["DROP TABLE", /^\s*DROP\s+TABLE\b/im],
    ["DROP COLUMN", /\bDROP\s+COLUMN\b/i],
    ["DROP INDEX", /^\s*DROP\s+INDEX\b/im],
    ["DROP CONSTRAINT", /\bDROP\s+CONSTRAINT\b/i],
    ["ALTER TYPE", /^\s*ALTER\s+TYPE\b/im],
    ["CREATE TYPE", /^\s*CREATE\s+TYPE\b/im],
    ["COPY", /^\s*COPY\s+"/im],
  ];
  for (const [label, pattern] of FORBIDDEN_STATEMENTS) {
    assert.equal(
      pattern.test(S3_MIGRATION),
      false,
      `the EX-S3 migration must not contain a ${label} statement`,
    );
  }

  // The ONE new statement class this slice introduces. DROP NOT NULL WIDENS the
  // accepted value set, so it is non-destructive — unlike SET NOT NULL, which
  // would narrow it and is banned outright.
  assert.match(S3_MIGRATION, /ALTER COLUMN "kind" DROP NOT NULL/);
  assert.match(S3_MIGRATION, /ALTER COLUMN "endTime" DROP NOT NULL/);
  assert.equal(
    /\bSET\s+NOT\s+NULL\b/i.test(S3_MIGRATION),
    false,
    "SET NOT NULL on an existing column would be a narrowing change",
  );

  // Zero enum churn: no exam enum is created, altered or even named.
  for (const enumName of EXAM_ENUMS) {
    assert.equal(
      new RegExp(`(CREATE|ALTER)\\s+TYPE\\s+"${enumName}"`).test(S3_MIGRATION),
      false,
      `${enumName} must not be created or altered by EX-S3`,
    );
  }
});

test("the EX-S3 migration matches the approved statement inventory exactly", () => {
  const count = (re: RegExp): number => [...S3_MIGRATION.matchAll(re)].length;

  assert.equal(count(/CREATE TABLE "(\w+)"/g), 2);
  assert.equal(count(/ADD COLUMN\s+"\w+"/g), 3);
  assert.equal(count(/ALTER COLUMN "\w+" DROP NOT NULL/g), 2);
  assert.equal(count(/CREATE (UNIQUE )?INDEX "\w+"/g), 6);
  assert.equal(count(/ADD CONSTRAINT "\w+" FOREIGN KEY/g), 3);
  assert.equal(count(/CREATE TYPE "\w+"/g), 0);

  const tables = [...S3_MIGRATION.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...tables].sort(), ["exam_definitions", "exam_session_breaks"]);

  // Only exam tables are altered — EX-S3 touches nothing outside the module.
  for (const m of S3_MIGRATION.matchAll(/ALTER TABLE "(\w+)"/g)) {
    assert.ok(m[1].startsWith("exam_"), `EX-S3 alters a non-exam table: ${m[1]}`);
  }
  // Exactly the two pre-existing exam tables approved for alteration.
  const altered = new Set(
    [...S3_MIGRATION.matchAll(/ALTER TABLE "(\w+)" ADD COLUMN/g)].map((m) => m[1]),
  );
  assert.deepEqual([...altered].sort(), ["exam_assignments", "exam_sessions"]);
});

test("the EX-S3 migration sorts after both earlier exam migrations", () => {
  const dirs = readdirSync(join(REPO_ROOT, "prisma", "migrations")).filter((d) =>
    /^\d{14}_/.test(d),
  );
  assert.ok(dirs.includes(S3_MIGRATION_DIR), "the EX-S3 migration directory is missing");
  assert.ok(S3_MIGRATION_DIR > MIGRATION_DIR);
  assert.ok(S3_MIGRATION_DIR > SOURCE_DATE_MIGRATION_DIR);

  // EX-S3 must not have edited either already-applied migration file.
  assert.equal(S3_MIGRATION.includes("exam_teaching_practice_source_dates"), false);
  assert.equal(SOURCE_DATE_MIGRATION.includes("exam_definitions"), false);
  assert.equal(MIGRATION.includes("exam_definitions"), false);
});

test("the EX-S3 deprecated session columns are retained, present and documented", () => {
  const s = block("model", "ExamSession");
  // Retained, never dropped — dropping a column is irreversible production DDL.
  for (const field of ["kind", "phase", "interfaceSessionId", "capacity"]) {
    assert.ok(
      new RegExp(`\\n\\s+${field}\\s+`).test(s),
      `${field} must be RETAINED, not dropped`,
    );
  }
  // The self-relation fields and the ExamPhase enum survive for the same reason.
  assert.match(s, /interfaceSession\s+ExamSession\?/);
  assert.match(s, /ridingSessions\s+ExamSession\[\]/);
  assert.ok(SCHEMA.includes("enum ExamPhase {"), "ExamPhase is retained to avoid DDL");

  // ...and each is documented as deprecated/unwritten in the comment block
  // ABOVE the model, which `block()` deliberately excludes.
  assert.ok(SCHEMA.includes("EX-S3 DEPRECATED AND UNWRITTEN"));
  assert.ok(SCHEMA.includes("There is NO"));
  assert.ok(
    SCHEMA.includes("persistent interface/riding link"),
    "the abandoned interface/riding link must be documented as gone",
  );
  // title is an occurrence subtitle only — never identity, never a group key.
  assert.ok(SCHEMA.includes("OPTIONAL PER-OCCURRENCE SUBTITLE"));
  // The EX-C2-0 beginner rules are untouched by EX-S3.
  assert.ok(SCHEMA.includes("A STORED BEGINNER_INSTRUCTION ROW IS FORBIDDEN"));
});

// ===========================================================================
// EX-S3.5 — the phase / interface-riding RUNTIME model is retired
// ===========================================================================

/** Every non-test TypeScript source in lib/exam, as [filename, source]. */
function activeExamCores(): readonly (readonly [string, string])[] {
  return readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => [f, readFileSync(join(REPO_ROOT, "lib", "exam", f), "utf8")] as const);
}

test("exam-interface-riding-core is DELETED and referenced by nothing", () => {
  const examDir = readdirSync(join(REPO_ROOT, "lib", "exam"));
  assert.equal(examDir.includes("exam-interface-riding-core.ts"), false);
  assert.equal(examDir.includes("exam-interface-riding-core.test.ts"), false);

  // Nothing anywhere in the repo's own source imports or names it — including
  // lib/exam itself, which the EX-C1 containment test deliberately excludes.
  const offenders: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (full.includes("generated") || full.includes("node_modules")) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry.name)) {
        // This suite necessarily names the module it forbids.
        if (entry.name === "exam-schema-structure.test.ts") continue;
        if (readFileSync(full, "utf8").includes("exam-interface-riding-core")) {
          offenders.push(full);
        }
      }
    }
  }
  for (const root of ["app", "lib", "components", "scripts"]) {
    try {
      walk(join(REPO_ROOT, root));
    } catch {
      // An absent optional root is not a failure.
    }
  }
  assert.deepEqual(offenders, [], `the retired core is still referenced: ${offenders.join(", ")}`);
});

test("the retired interface/riding symbols exist nowhere in the exam module", () => {
  const RETIRED = [
    "validateInterfaceRidingPair",
    "seedRidingFromInterface",
    "InterfaceSeedSource",
    "InterfaceSeedOptions",
    "RidingSeedResult",
    "PairSessionRef",
    "EXAM_INTERFACE_RIDING_MESSAGES",
    "EX-IR-",
  ];
  for (const [file, source] of activeExamCores()) {
    for (const symbol of RETIRED) {
      assert.equal(source.includes(symbol), false, `${file} still carries ${symbol}`);
    }
  }
});

test("no active pure core REQUIRES a phase or branches on a phase value", () => {
  // The retired codes may appear as reserved strings in the domain core's type
  // union / message table, but never as an EMITTED issue.
  const EMISSION = /issue\(\s*["'](EX-DOM-PHASE-REQUIRED|EX-DOM-INVALID-PHASE)["']\s*\)/;
  // Any comparison of a phase-ish value against a retired phase token.
  const BRANCH = [
    /[Pp]hase\s*[!=]==?\s*["'](INTERFACE|RIDING)["']/,
    // The reversed form, allowing a dotted path (`"RIDING" === session.phase`).
    /["'](INTERFACE|RIDING)["']\s*[!=]==?\s*[\w.]*[Pp]hase/,
    /case\s+["'](INTERFACE|RIDING)["']/,
  ];
  for (const [file, source] of activeExamCores()) {
    assert.equal(EMISSION.test(source), false, `${file} still emits a retired phase issue`);
    for (const pattern of BRANCH) {
      assert.equal(
        pattern.test(source),
        false,
        `${file} still branches on a retired phase value (${pattern})`,
      );
    }
  }
});

test("no active pure core establishes an interface/riding link", () => {
  // interfaceSessionId may be READ as a deprecated input to be rejected, but no
  // core may assign one, so the retired linkage cannot be re-established.
  const ASSIGNMENT = /interfaceSessionId\s*:\s*(?!string|null|undefined|readonly)/;
  for (const [file, source] of activeExamCores()) {
    for (const line of source.split("\n")) {
      // Type declarations (`interfaceSessionId?: string | null`) are fine.
      if (/interfaceSessionId\s*\??\s*:\s*(string|unknown)/.test(line)) continue;
      assert.equal(
        ASSIGNMENT.test(line),
        false,
        `${file} appears to construct an interface link: ${line.trim()}`,
      );
    }
  }
});

test("the deprecated phase columns stay in the schema, unwritten and documented", () => {
  // EX-S3.5 is a pure-core cleanup: the schema and the migrations are untouched,
  // so the retired columns must still be declared exactly as EX-S3 left them.
  const s = block("model", "ExamSession");
  assert.match(s, /\n\s+phase\s+ExamPhase\?/);
  assert.match(s, /\n\s+interfaceSessionId\s+String\?/);
  assert.ok(SCHEMA.includes("enum ExamPhase {"));
  assert.ok(SCHEMA.includes("EX-S3 DEPRECATED AND UNWRITTEN"));
  assert.ok(SCHEMA.includes("persistent interface/riding link"));
  assert.ok(SCHEMA.includes("interface-to-riding copy"));
});
