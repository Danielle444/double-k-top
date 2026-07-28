/**
 * EXAM EX-C2-0 — tests for the PURE practice-type → beginner-format mapping.
 *
 * DB-FREE: no Prisma, no database, no network, no filesystem, no clock.
 *
 * Run with: npx tsx --test lib/exam/exam-beginner-format-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  PRACTICE_TYPE_FORMAT_MAP,
  mapPracticeTypeToBeginnerFormat,
} from "./exam-beginner-format-core";
import { mapPracticeTypeToBeginnerFormat as reExported } from "./exam-beginner-copy-core";

// ---------------------------------------------------------------------------
// The three approved mappings
// ---------------------------------------------------------------------------

test("maps LUNGE to LUNGE", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("LUNGE"), "LUNGE");
});

test("maps BEGINNER_PRIVATE to BEGINNER_PRIVATE", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("BEGINNER_PRIVATE"), "BEGINNER_PRIVATE");
});

test("maps BEGINNER_GROUP to BEGINNER_GROUP", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("BEGINNER_GROUP"), "BEGINNER_GROUP");
});

test("maps exactly the three production TeachingPracticeType values", () => {
  // Verified against production: TeachingPracticeType has exactly these three
  // labels. A fourth would map to null until added here deliberately.
  assert.deepEqual(Object.keys(PRACTICE_TYPE_FORMAT_MAP).sort(), [
    "BEGINNER_GROUP",
    "BEGINNER_PRIVATE",
    "LUNGE",
  ]);
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

test("unknown token yields null, never a default format", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("ADVANCED_GROUP"), null);
  assert.equal(mapPracticeTypeToBeginnerFormat(""), null);
  assert.equal(mapPracticeTypeToBeginnerFormat("lunge"), null, "matching is case-sensitive");
  assert.equal(mapPracticeTypeToBeginnerFormat(" LUNGE "), null, "no trimming/coercion");
});

test("non-string inputs yield null", () => {
  for (const value of [null, undefined, 0, 1, true, false, {}, [], Symbol("LUNGE")]) {
    assert.equal(mapPracticeTypeToBeginnerFormat(value), null);
  }
});

test("__proto__ yields null", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("__proto__"), null);
});

test("constructor yields null", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("constructor"), null);
});

test("toString yields null", () => {
  assert.equal(mapPracticeTypeToBeginnerFormat("toString"), null);
});

test("every inherited Object.prototype key yields null", () => {
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    assert.equal(
      mapPracticeTypeToBeginnerFormat(key),
      null,
      `inherited key ${key} must not map to a format`,
    );
  }
});

// ---------------------------------------------------------------------------
// Immutability
// ---------------------------------------------------------------------------

test("the mapping table is frozen and cannot be extended", () => {
  assert.equal(Object.isFrozen(PRACTICE_TYPE_FORMAT_MAP), true);

  const mutable = PRACTICE_TYPE_FORMAT_MAP as Record<string, string>;
  assert.throws(() => {
    "use strict";
    mutable.NEW_TYPE = "LUNGE";
  });
  assert.throws(() => {
    "use strict";
    mutable.LUNGE = "BEGINNER_GROUP";
  });

  assert.equal(mapPracticeTypeToBeginnerFormat("NEW_TYPE"), null);
  assert.equal(mapPracticeTypeToBeginnerFormat("LUNGE"), "LUNGE");
});

// ---------------------------------------------------------------------------
// The retirement is behaviour-neutral
// ---------------------------------------------------------------------------

test("the deprecated copy planner re-exports the identical function", () => {
  assert.equal(reExported, mapPracticeTypeToBeginnerFormat);
  assert.equal(reExported("BEGINNER_GROUP"), "BEGINNER_GROUP");
  assert.equal(reExported("__proto__"), null);
});
