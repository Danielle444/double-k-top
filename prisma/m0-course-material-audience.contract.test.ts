/**
 * P-MATERIALS M0 - focused STRUCTURAL contract test for the additive
 * course-scoped material audience layer.
 *
 * DB-FREE by construction: it reads schema.prisma and the M0 migration.sql as
 * TEXT and asserts their shape. A structural test is the right (and only
 * meaningful) test for M0 because M0 adds NO runtime logic - the table is
 * created empty and unwired, so there is no behaviour to exercise. What must be
 * pinned instead is exactly the set of properties that a careless later edit (or
 * a `prisma migrate` re-generate) could silently break: the model shape, the
 * table mapping, the composite unique + secondary index, the delete behaviours,
 * the two inverse relations, the additive-only nature of the migration,
 * PostgreSQL identifier limits, and the unwired invariant.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test prisma/m0-course-material-audience.contract.test.ts
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
  "prisma/migrations/20260726130000_add_course_material_audience/migration.sql",
);

// ---------------------------------------------------------------------------
// schema.prisma - model CourseMaterialAudience
// ---------------------------------------------------------------------------

function modelBlock(name: string): string {
  const match = SCHEMA.match(new RegExp(`\\nmodel\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} must be declared`);
  return match[1];
}

test("model CourseMaterialAudience maps to course_material_audiences", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.match(body, /@@map\("course_material_audiences"\)/);
});

test("CourseMaterialAudience has exactly the approved scalar fields", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.match(body, /\n\s*id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(body, /\n\s*materialId\s+String(?!\?)\b/);
  assert.match(body, /\n\s*courseOfferingId\s+String(?!\?)\b/);
  assert.match(body, /\n\s*createdAt\s+DateTime\s+@default\(now\(\)\)/);
});

test("CourseMaterialAudience has no updatedAt (audience rows are immutable)", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.equal(/\bupdatedAt\b/.test(body), false);
});

test("CourseMaterialAudience declares the composite unique and offering index", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.match(body, /@@unique\(\[materialId,\s*courseOfferingId\]\)/);
  assert.match(body, /@@index\(\[courseOfferingId\]\)/);
});

test("the material edge is onDelete: Cascade", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.match(
    body,
    /material\s+CourseMaterial\s+@relation\(fields:\s*\[materialId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/,
  );
});

test("the offering edge is onDelete: Restrict", () => {
  const body = modelBlock("CourseMaterialAudience");
  assert.match(
    body,
    /courseOffering\s+CourseOffering\s+@relation\(fields:\s*\[courseOfferingId\],\s*references:\s*\[id\],\s*onDelete:\s*Restrict\)/,
  );
});

// ---------------------------------------------------------------------------
// schema.prisma - exactly two additive inverse relations
// ---------------------------------------------------------------------------

test("exactly two inverse relations to CourseMaterialAudience exist", () => {
  const occurrences = [...SCHEMA.matchAll(/CourseMaterialAudience\[\]/g)].length;
  assert.equal(occurrences, 2);
});

test("each owning model declares its CourseMaterialAudience back-relation", () => {
  // CourseMaterial uses the field name `audiences`; CourseOffering uses
  // `materialAudiences` (it already owns a `messageTaskAudiences` relation, so a
  // distinct, material-specific name is required).
  assert.match(modelBlock("CourseMaterial"), /\n\s*audiences\s+CourseMaterialAudience\[\]/);
  assert.match(
    modelBlock("CourseOffering"),
    /\n\s*materialAudiences\s+CourseMaterialAudience\[\]/,
  );
});

// ---------------------------------------------------------------------------
// schema.prisma - existing table untouched (no column added to CourseMaterial)
// ---------------------------------------------------------------------------

test("CourseMaterial gains only the back-relation and no scalar column", () => {
  const body = modelBlock("CourseMaterial");
  // The original scalar columns remain exactly as before...
  assert.match(body, /\n\s*visibility\s+CourseMaterialVisibility\b/);
  assert.match(body, /\n\s*isActive\s+Boolean\b/);
  // ...and NO courseOfferingId / offering scalar was added to the material row.
  assert.equal(/\n\s*courseOfferingId\b/.test(body), false);
});

// ---------------------------------------------------------------------------
// migration.sql - creates an empty table with the right objects
// ---------------------------------------------------------------------------

test("migration creates the table and adds no enum", () => {
  assert.match(MIGRATION, /CREATE TABLE "course_material_audiences"/);
  assert.equal(/CREATE TYPE\b/.test(MIGRATION), false);
});

test("migration declares the composite unique index and the offering index", () => {
  assert.match(
    MIGRATION,
    /CREATE UNIQUE INDEX "course_material_audiences_materialId_courseOfferingId_key" ON "course_material_audiences"\("materialId", "courseOfferingId"\)/,
  );
  assert.match(
    MIGRATION,
    /CREATE INDEX "course_material_audiences_courseOfferingId_idx" ON "course_material_audiences"\("courseOfferingId"\)/,
  );
});

test("migration declares both foreign keys with the approved delete behaviour", () => {
  assert.match(
    MIGRATION,
    /"course_material_audiences_materialId_fkey" FOREIGN KEY \("materialId"\) REFERENCES "course_materials"\("id"\) ON DELETE CASCADE/,
  );
  assert.match(
    MIGRATION,
    /"course_material_audiences_courseOfferingId_fkey" FOREIGN KEY \("courseOfferingId"\) REFERENCES "course_offerings"\("id"\) ON DELETE RESTRICT/,
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
    ["ALTER existing course_materials", /\bALTER\s+TABLE\s+"course_materials"\b/i],
    ["ALTER existing course_offerings", /\bALTER\s+TABLE\s+"course_offerings"\b/i],
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
// Wiring confinement (updated M0 -> M2B) - the audience table's Prisma access is
// confined to the single approved M2B write module.
//
// In M0 this asserted the table was ENTIRELY unwired. P-MATERIALS M2B wires it,
// but deliberately in ONE place: the shared server write module
// lib/course/material-audience-write.ts, which owns the offering authorization
// and the audience create/reconcile Prisma bindings for BOTH write paths. The
// materials server action and the FILE upload route CONSUME that module and
// never touch prisma.courseMaterialAudience directly, so this test still proves
// no OTHER application module reads or writes the table - the M0 safety intent is
// preserved, only narrowed to the one sanctioned wiring point.
// ---------------------------------------------------------------------------

/** The only application file allowed to reference the audience table directly. */
const ALLOWED_AUDIENCE_WIRING = new Set(["lib/course/material-audience-write.ts"]);

test("audience-table Prisma access is confined to the approved M2B write module", () => {
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
      if (
        source.includes("coursematerialaudience") ||
        source.includes("course_material_audiences")
      ) {
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

  const unexpected = referencers.filter((file) => !ALLOWED_AUDIENCE_WIRING.has(file));
  assert.deepEqual(
    unexpected,
    [],
    `Only ${[...ALLOWED_AUDIENCE_WIRING].join(", ")} may reference the audience table, ` +
      `but it is also referenced by: ${unexpected}`,
  );
  // Positive pin: the sanctioned wiring point must actually be the referencer, so
  // this test cannot silently pass if the wiring is later moved or removed.
  assert.ok(
    referencers.includes("lib/course/material-audience-write.ts"),
    "the M2B write module must be the audience-table wiring point",
  );
});
