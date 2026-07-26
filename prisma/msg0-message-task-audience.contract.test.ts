/**
 * MSG0 - focused STRUCTURAL contract test for the additive course-scoped
 * message/task audience layer.
 *
 * DB-FREE by construction: it reads schema.prisma and the MSG0 migration.sql as
 * TEXT and asserts their shape. A structural test is the right (and only
 * meaningful) test for MSG0 because MSG0 adds NO runtime logic - the table is
 * created empty and unwired, so there is no behaviour to exercise. What must be
 * pinned instead is exactly the set of properties that a careless later edit (or
 * a `prisma migrate` re-generate that drops the hand-written objects) could
 * silently break: the enum members, the table mapping, the required
 * labelSnapshot, the delete behaviours, the four inverse relations, the three
 * partial unique indexes, the kind-shape CHECK, the additive-only nature of the
 * migration, PostgreSQL identifier limits, and the unwired invariant.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test prisma/msg0-message-task-audience.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readRepoFile(relativeToRepoRoot: string): string {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  return readFileSync(`${repoRoot}${relativeToRepoRoot}`, "utf8");
}

const SCHEMA = readRepoFile("prisma/schema.prisma");
const MIGRATION = readRepoFile(
  "prisma/migrations/20260726120000_add_message_task_audience/migration.sql",
);
// The follow-up corrective migration that makes TRAINEE uniqueness offering-scoped.
// The final audience-uniqueness contract is the NET of these two migrations, so the
// tests below reason over the chain, not the MSG0 file alone.
const CORRECTIVE_MIGRATION = readRepoFile(
  "prisma/migrations/20260726140000_fix_message_task_audience_trainee_unique/migration.sql",
);

// ---------------------------------------------------------------------------
// schema.prisma - enum
// ---------------------------------------------------------------------------

test("enum MessageAudienceSegmentKind contains exactly COURSE, GROUP, TRAINEE", () => {
  const match = SCHEMA.match(/enum\s+MessageAudienceSegmentKind\s*\{([^}]*)\}/);
  assert.ok(match, "enum MessageAudienceSegmentKind must be declared");
  const members = match[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0);
  assert.deepEqual(members, ["COURSE", "GROUP", "TRAINEE"]);
});

// ---------------------------------------------------------------------------
// schema.prisma - model MessageTaskAudience
// ---------------------------------------------------------------------------

function modelBlock(name: string): string {
  const match = SCHEMA.match(new RegExp(`\\nmodel\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} must be declared`);
  return match[1];
}

test("model MessageTaskAudience maps to message_task_audiences", () => {
  const body = modelBlock("MessageTaskAudience");
  assert.match(body, /@@map\("message_task_audiences"\)/);
});

test("labelSnapshot is a required (non-null) String", () => {
  const body = modelBlock("MessageTaskAudience");
  // Required = `String` with no trailing `?`.
  assert.match(body, /\n\s*labelSnapshot\s+String(?!\?)\b/);
});

test("courseOfferingId is required; courseGroupId and studentId are nullable", () => {
  const body = modelBlock("MessageTaskAudience");
  assert.match(body, /\n\s*courseOfferingId\s+String(?!\?)\b/);
  assert.match(body, /\n\s*courseGroupId\s+String\?/);
  assert.match(body, /\n\s*studentId\s+String\?/);
});

test("MessageTaskAudience has no updatedAt (audience is immutable after send)", () => {
  const body = modelBlock("MessageTaskAudience");
  assert.equal(/\bupdatedAt\b/.test(body), false);
});

test("the messageTask edge is onDelete: Cascade", () => {
  const body = modelBlock("MessageTaskAudience");
  assert.match(
    body,
    /messageTask\s+MessageTask\s+@relation\(fields:\s*\[messageTaskId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
});

test("the offering, group, and student edges are onDelete: Restrict", () => {
  const body = modelBlock("MessageTaskAudience");
  assert.match(
    body,
    /courseOffering\s+CourseOffering\s+@relation\(fields:\s*\[courseOfferingId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
  assert.match(
    body,
    /courseGroup\s+CourseGroup\?\s+@relation\(fields:\s*\[courseGroupId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
  assert.match(
    body,
    /student\s+Student\?\s+@relation\(fields:\s*\[studentId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
});

// ---------------------------------------------------------------------------
// schema.prisma - four additive inverse relations
// ---------------------------------------------------------------------------

test("exactly four inverse relations to MessageTaskAudience exist", () => {
  const occurrences = [...SCHEMA.matchAll(/MessageTaskAudience\[\]/g)].length;
  assert.equal(occurrences, 4);
});

test("each owning model declares its MessageTaskAudience back-relation", () => {
  // MessageTask uses the field name `audiences`; the other three use
  // `messageTaskAudiences` (MessageTask already owns a plural `audiences`).
  assert.match(modelBlock("MessageTask"), /\n\s*audiences\s+MessageTaskAudience\[\]/);
  assert.match(modelBlock("CourseOffering"), /\n\s*messageTaskAudiences\s+MessageTaskAudience\[\]/);
  assert.match(modelBlock("CourseGroup"), /\n\s*messageTaskAudiences\s+MessageTaskAudience\[\]/);
  assert.match(modelBlock("Student"), /\n\s*messageTaskAudiences\s+MessageTaskAudience\[\]/);
});

// ---------------------------------------------------------------------------
// schema.prisma - existing tables untouched
// ---------------------------------------------------------------------------

test("legacy MessageTask.audience and groupName columns remain unchanged", () => {
  const body = modelBlock("MessageTask");
  assert.match(body, /\n\s*audience\s+MessageAudience\b/);
  assert.match(body, /\n\s*groupName\s+String\?/);
});

test("MessageTaskRecipient still declares only its original columns", () => {
  const body = modelBlock("MessageTaskRecipient");
  assert.equal(/MessageTaskAudience/.test(body), false);
  assert.match(body, /@@unique\(\[messageTaskId,\s*studentId\]\)/);
});

// ---------------------------------------------------------------------------
// migration.sql - creates an empty table with the right objects
// ---------------------------------------------------------------------------

test("migration creates the enum type and the table", () => {
  assert.match(
    MIGRATION,
    /CREATE TYPE "MessageAudienceSegmentKind" AS ENUM \('COURSE', 'GROUP', 'TRAINEE'\)/,
  );
  assert.match(MIGRATION, /CREATE TABLE "message_task_audiences"/);
});

test("MSG0 migration declares the COURSE and GROUP partial unique indexes (final, unchanged)", () => {
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_course_unique" ON "message_task_audiences"\("messageTaskId", "courseOfferingId"\) WHERE "kind" = 'COURSE'/,
  );
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_group_unique" ON "message_task_audiences"\("messageTaskId", "courseGroupId"\) WHERE "kind" = 'GROUP'/,
  );
});

test("MSG0 migration's ORIGINAL TRAINEE index is person-scoped and is later superseded", () => {
  // The MSG0 file is never edited: it still creates the original 2-column index.
  // The corrective migration below drops exactly this and recreates the 3-column
  // form, so the FINAL uniqueness is offering-scoped (proven in the chain test).
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_trainee_unique" ON "message_task_audiences"\("messageTaskId", "studentId"\) WHERE "kind" = 'TRAINEE'/,
  );
});

// ---------------------------------------------------------------------------
// FINAL AUDIENCE-UNIQUENESS CONTRACT - the NET of the MSG0 migration and the
// 20260726140000 corrective migration. Offering context is preserved on every
// audience kind: COURSE by offering, GROUP by group, TRAINEE by offering+student.
// ---------------------------------------------------------------------------

test("the migration chain yields offering-scoped uniqueness for all three audience kinds", () => {
  // COURSE + GROUP come entirely from MSG0 and are never dropped/recreated.
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_course_unique" ON "message_task_audiences"\("messageTaskId", "courseOfferingId"\) WHERE "kind" = 'COURSE'/,
  );
  assert.equal(/message_task_audiences_course_unique/.test(CORRECTIVE_MIGRATION), false);
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_group_unique" ON "message_task_audiences"\("messageTaskId", "courseGroupId"\) WHERE "kind" = 'GROUP'/,
  );
  assert.equal(/message_task_audiences_group_unique/.test(CORRECTIVE_MIGRATION), false);

  // TRAINEE: the corrective migration drops the person-scoped index and recreates
  // it offering-scoped as (messageTaskId, courseOfferingId, studentId).
  assert.match(
    CORRECTIVE_MIGRATION,
    /DROP INDEX "message_task_audiences_trainee_unique";/,
  );
  assert.match(
    CORRECTIVE_MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_trainee_unique" ON "message_task_audiences"\("messageTaskId", "courseOfferingId", "studentId"\) WHERE "kind" = 'TRAINEE'/,
  );
});

test("recipient deduplication stays SEPARATELY owned by MessageTaskRecipient", () => {
  // Recipient uniqueness is messageTaskId+studentId on the recipient table, NOT on
  // the audience table - so multiple offering-scoped TRAINEE audience rows for one
  // dual trainee still materialize exactly one recipient.
  const recipientBody = modelBlock("MessageTaskRecipient");
  assert.match(recipientBody, /@@unique\(\[messageTaskId,\s*studentId\]\)/);
  // Neither audience migration may touch the recipient table in executable SQL.
  // (Comment lines legitimately NAME it - e.g. "adds no column to
  // message_task_recipients" - so strip comments before asserting.)
  const stripComments = (sql: string): string =>
    sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
  assert.equal(/message_task_recipients/.test(stripComments(MIGRATION)), false);
  assert.equal(/message_task_recipients/.test(stripComments(CORRECTIVE_MIGRATION)), false);
});

// ---------------------------------------------------------------------------
// The corrective migration is index-only: no table/enum/column/FK/CHECK/data.
// ---------------------------------------------------------------------------

test("corrective migration drops ONLY the old TRAINEE index and recreates ONLY the corrected one", () => {
  const drops = [...CORRECTIVE_MIGRATION.matchAll(/\bDROP\s+INDEX\s+"([^"]+)"/gi)].map((m) => m[1]);
  assert.deepEqual(drops, ["message_task_audiences_trainee_unique"]);

  const creates = [...CORRECTIVE_MIGRATION.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([^"]+)"/gi)].map(
    (m) => m[1],
  );
  assert.deepEqual(creates, ["message_task_audiences_trainee_unique"]);
});

test("corrective migration modifies no table, enum, column, FK, or CHECK", () => {
  const sql = CORRECTIVE_MIGRATION.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const forbidden: [string, RegExp][] = [
    ["CREATE TABLE", /\bCREATE\s+TABLE\b/i],
    ["ALTER TABLE", /\bALTER\s+TABLE\b/i],
    ["CREATE TYPE", /\bCREATE\s+TYPE\b/i],
    ["a CHECK constraint", /\bCHECK\b/i],
    ["a foreign key", /\bFOREIGN\s+KEY\b/i],
    ["any CONSTRAINT clause", /\bCONSTRAINT\b/i],
    ["a column ADD/DROP", /\b(ADD|DROP)\s+COLUMN\b/i],
  ];
  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(sql), false, `corrective migration must not contain ${label}`);
  }
});

test("corrective migration contains NO data mutation or backfill statement", () => {
  const sql = CORRECTIVE_MIGRATION.split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const forbidden: [string, RegExp][] = [
    ["INSERT INTO", /\bINSERT\s+INTO\b/i],
    ["DELETE FROM", /\bDELETE\s+FROM\b/i],
    ["UPDATE ... SET", /\bUPDATE\s+"[^"]+"\s+SET\b/i],
    ["TRUNCATE", /\bTRUNCATE\b/i],
    ["MERGE INTO", /\bMERGE\s+INTO\b/i],
    ["COPY", /\bCOPY\s+"/i],
  ];
  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(sql), false, `corrective migration must not contain a ${label} statement`);
  }
});

test("every corrective-migration DDL identifier is within PostgreSQL's 63-character limit", () => {
  const tooLong = [...CORRECTIVE_MIGRATION.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((identifier) => identifier.length > 63);
  assert.deepEqual(tooLong, []);
});

test("migration declares the kind-shape CHECK constraint", () => {
  assert.match(MIGRATION, /CONSTRAINT "message_task_audiences_kind_shape_check" CHECK \(/);
});

test("migration declares all four foreign keys with the approved delete behaviour", () => {
  assert.match(
    MIGRATION,
    /"message_task_audiences_messageTaskId_fkey" FOREIGN KEY \("messageTaskId"\) REFERENCES "message_tasks"\("id"\) ON DELETE CASCADE/,
  );
  assert.match(
    MIGRATION,
    /"message_task_audiences_courseOfferingId_fkey" FOREIGN KEY \("courseOfferingId"\) REFERENCES "course_offerings"\("id"\) ON DELETE RESTRICT/,
  );
  assert.match(
    MIGRATION,
    /"message_task_audiences_courseGroupId_fkey" FOREIGN KEY \("courseGroupId"\) REFERENCES "course_groups"\("id"\) ON DELETE RESTRICT/,
  );
  assert.match(
    MIGRATION,
    /"message_task_audiences_studentId_fkey" FOREIGN KEY \("studentId"\) REFERENCES "students"\("id"\) ON DELETE RESTRICT/,
  );
});

test("migration contains NO data mutation or backfill statement", () => {
  // Drop comment lines first, then look for statement-leading mutations. The
  // `ON DELETE`/`ON UPDATE` FK clauses are deliberately NOT matched by these
  // multi-token patterns (they are `ON DELETE CASCADE`, never `DELETE FROM`).
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
    ["DROP", /\bDROP\s+(TABLE|TYPE|INDEX|CONSTRAINT)\b/i],
  ];
  for (const [label, pattern] of forbidden) {
    assert.equal(pattern.test(sql), false, `migration must not contain a ${label} statement`);
  }
});

test("every DDL identifier is within PostgreSQL's 63-character limit", () => {
  const tooLong = [...MIGRATION.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((identifier) => identifier.length > 63);
  assert.deepEqual(tooLong, []);
});

// ---------------------------------------------------------------------------
// The write-unwired invariant - nothing in the app READS OR WRITES the new
// table. Post-MSG1A this is deliberately about ACTUAL Prisma table access, NOT
// textual mentions: MSG1A added read-only audience actions
// (lib/actions/message-audience.ts, lib/course/message-audience-input-core.ts)
// and their contract test, which NAME the model in comments / assertion strings
// while never touching it. Those must not trip this check. The real read/write
// surface is the Prisma client accessor `prisma.messageTaskAudience` (or the raw
// table name in any hand-written SQL), so detect exactly that, after stripping
// comments. MSG2 - which genuinely writes the table - WILL trip this, which is
// the intended, visible signal that the table is being wired for the first time.
// ---------------------------------------------------------------------------

test("no application module READS OR WRITES the message_task_audiences table (MSG1A: read-only names are fine)", () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const skippedDirs = new Set(["node_modules", ".next", ".git", "generated"]);
  const referencers: string[] = [];

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  function walk(dir: string, relative: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skippedDirs.has(entry.name)) continue;
        walk(`${dir}/${entry.name}`, `${relative}${entry.name}/`);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const code = stripComments(readFileSync(`${dir}/${entry.name}`, "utf8")).toLowerCase();
      // Actual read/write surface only: the Prisma client accessor, or the raw
      // table name appearing in code (never in a normal TS module).
      if (/prisma\s*\.\s*messagetaskaudience\b/.test(code) || code.includes("message_task_audiences")) {
        referencers.push(`${relative}${entry.name}`);
      }
    }
  }

  // Deliberately excludes prisma/ (schema + this test legitimately name it).
  for (const top of ["lib", "app", "scripts", "components"]) {
    try {
      walk(`${repoRoot}${top}`, `${top}/`);
    } catch {
      // A top-level directory that does not exist is not a failure.
    }
  }

  assert.deepEqual(
    referencers,
    [],
    `message_task_audiences must stay write-unwired, but is accessed by: ${referencers}`,
  );
});
