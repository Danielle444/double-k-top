/**
 * IUS-2E: DB-free unit tests for the instructor per-course schedule surfaces'
 * automatic default-offering selection.
 *
 * Pure by construction - this imports only the core, which touches no Prisma, no
 * React, no clock and no session, so the whole contract runs without a database.
 *
 * Run with:
 *   npx tsx --test lib/course/instructor-default-schedule-offering-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSTRUCTOR_DEFAULT_OFFERING_LEVEL,
  pickInstructorDefaultOfferingId,
} from "./instructor-default-schedule-offering-core";

// ---------------------------------------------------------------------------
// (1) Level 1 is preferred, using the server-returned level field.
// ---------------------------------------------------------------------------

test("picks the Level 1 option out of a Level 1 + Level 2 menu", () => {
  assert.equal(
    pickInstructorDefaultOfferingId([
      { id: "offering-l1", level: 1 },
      { id: "offering-l2", level: 2 },
    ]),
    "offering-l1",
  );
});

test("picks Level 1 regardless of its position in the list", () => {
  assert.equal(
    pickInstructorDefaultOfferingId([
      { id: "offering-l2", level: 2 },
      { id: "offering-l1", level: 1 },
    ]),
    "offering-l1",
  );
});

test("the preferred level constant is 1", () => {
  assert.equal(INSTRUCTOR_DEFAULT_OFFERING_LEVEL, 1);
});

// ---------------------------------------------------------------------------
// (2) Multiple Level 1 options -> deterministic lowest id, order-independent.
// ---------------------------------------------------------------------------

test("two Level 1 options -> the lowest id wins", () => {
  assert.equal(
    pickInstructorDefaultOfferingId([
      { id: "bbb", level: 1 },
      { id: "aaa", level: 1 },
    ]),
    "aaa",
  );
});

test("the same result under reversed input order (order-independent)", () => {
  const forward = [
    { id: "ccc", level: 1 },
    { id: "aaa", level: 1 },
    { id: "bbb", level: 1 },
  ];
  const reversed = [...forward].reverse();
  assert.equal(pickInstructorDefaultOfferingId(forward), "aaa");
  assert.equal(pickInstructorDefaultOfferingId(reversed), "aaa");
  assert.equal(
    pickInstructorDefaultOfferingId(forward),
    pickInstructorDefaultOfferingId(reversed),
  );
});

test("a lower-id Level 2 option never beats a Level 1 option", () => {
  // Level wins first; the id tie-break applies only WITHIN the chosen pool.
  assert.equal(
    pickInstructorDefaultOfferingId([
      { id: "aaa", level: 2 },
      { id: "zzz", level: 1 },
    ]),
    "zzz",
  );
});

// ---------------------------------------------------------------------------
// (3) No Level 1 available -> the lowest id among all eligible options.
// ---------------------------------------------------------------------------

test("only a Level 2 option -> that option's id", () => {
  assert.equal(pickInstructorDefaultOfferingId([{ id: "offering-l2", level: 2 }]), "offering-l2");
});

test("no Level 1 at all -> the lowest id among every eligible option", () => {
  assert.equal(
    pickInstructorDefaultOfferingId([
      { id: "zzz", level: 3 },
      { id: "mmm", level: 2 },
      { id: "qqq", level: 2 },
    ]),
    "mmm",
  );
});

// ---------------------------------------------------------------------------
// (4) Empty menu -> null (a legitimate outcome, never a fabricated offering).
// ---------------------------------------------------------------------------

test("an empty option list -> null", () => {
  assert.equal(pickInstructorDefaultOfferingId([]), null);
});

// ---------------------------------------------------------------------------
// (5) The decision keys on option.level ONLY - never on a label or a name.
// ---------------------------------------------------------------------------

test("an option LABELLED Level 1 but carrying level: 2 is NOT selected", () => {
  // The server composes labels like "רמה 1 · <name>". If the core ever parsed a
  // label instead of reading the DB-backed level, this case would return the
  // mislabelled id. It must return the genuinely level-1 option instead.
  const options = [
    { id: "mislabelled", level: 2, label: "רמה 1 · קורס מתחילים" },
    { id: "genuine-l1", level: 1, label: "רמה 2 · קורס מתקדמים" },
  ];
  assert.equal(pickInstructorDefaultOfferingId(options), "genuine-l1");
});

test("a name/label-only menu with no level 1 still falls back by id, not by label", () => {
  const options = [
    { id: "zzz", level: 2, label: "רמה 1" },
    { id: "aaa", level: 2, label: "רמה 2" },
  ];
  assert.equal(pickInstructorDefaultOfferingId(options), "aaa");
});

// ---------------------------------------------------------------------------
// (6) No hardcoded offering id, and no impurity, in the module itself.
// ---------------------------------------------------------------------------

test("the core module hardcodes no offering id and stays pure", () => {
  const source = readFileSync(
    join(import.meta.dirname, "instructor-default-schedule-offering-core.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  const body = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  // A cuid/uuid-shaped literal would be a hardcoded offering id.
  assert.equal(
    /["'][a-z0-9]{20,}["']/i.test(body),
    false,
    "no id-shaped string literal may appear in the core",
  );
  // Purity + no label/name inference.
  for (const forbidden of ["prisma", "label", "name", "next/headers", "Date", "Math.random", "process.env"]) {
    assert.equal(
      body.includes(forbidden),
      false,
      `the core must not reference ${forbidden}`,
    );
  }
  assert.equal(/^import /m.test(body), false, "the core must import nothing at runtime");
});

// ---------------------------------------------------------------------------
// Non-mutation.
// ---------------------------------------------------------------------------

test("neither the input array nor its option objects are mutated", () => {
  const options = [
    { id: "bbb", level: 2 },
    { id: "aaa", level: 1 },
  ];
  const snapshot = JSON.stringify(options);
  pickInstructorDefaultOfferingId(options);
  assert.equal(JSON.stringify(options), snapshot);
  assert.equal(options.length, 2);
});
