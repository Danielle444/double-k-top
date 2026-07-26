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

test("migration declares all three partial unique indexes", () => {
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_course_unique" ON "message_task_audiences"\("messageTaskId", "courseOfferingId"\) WHERE "kind" = 'COURSE'/,
  );
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_group_unique" ON "message_task_audiences"\("messageTaskId", "courseGroupId"\) WHERE "kind" = 'GROUP'/,
  );
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "message_task_audiences_trainee_unique" ON "message_task_audiences"\("messageTaskId", "studentId"\) WHERE "kind" = 'TRAINEE'/,
  );
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
// The unwired invariant - nothing in the app reads or writes the new table
// ---------------------------------------------------------------------------

test("no application module imports, reads, or writes MessageTaskAudience in MSG0", () => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const skippedDirs = new Set(["node_modules", ".next", ".git", "generated"]);
  const referencers: string[] = [];

  function walk(dir: string, relative: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skippedDirs.has(entry.name)) continue;
        walk(`${dir}/${entry.name}`, `${relative}${entry.name}/`);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const source = readFileSync(`${dir}/${entry.name}`, "utf8").toLowerCase();
      if (source.includes("messagetaskaudience") || source.includes("message_task_audiences")) {
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
    `MessageTaskAudience must stay unwired in MSG0, but is referenced by: ${referencers}`,
  );
});
