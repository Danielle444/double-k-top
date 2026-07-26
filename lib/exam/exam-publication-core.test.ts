/**
 * EXAM X0 — executable tests for the PURE publication-staleness + affected-user
 * preview core (exam-publication-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-publication-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no env.
 *
 * SCOPE OF PROOF: UNPUBLISHED / CURRENT / STALE resolution; a missing
 * publication timestamp is UNPUBLISHED; the affected trainee/instructor id sets
 * are deduped deterministically; and no input is mutated.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  resolvePublicationStatus,
  isPublicationStale,
  computeAffectedUsersPreview,
  type AffectedUsersInput,
} from "./exam-publication-core";

// Caller-supplied epoch-millisecond timestamps (no Date is read in the core).
const T1 = 1_000;
const T2 = 2_000;

// --- publication status ----------------------------------------------------

test("a session never published is UNPUBLISHED", () => {
  assert.equal(resolvePublicationStatus({ updatedAt: T1, individualPublishedAt: null }), "UNPUBLISHED");
  assert.equal(
    resolvePublicationStatus({ updatedAt: T1, individualPublishedAt: undefined }),
    "UNPUBLISHED",
  );
});

test("published and not edited since is CURRENT", () => {
  // updated at or before publish time ⇒ current
  assert.equal(resolvePublicationStatus({ updatedAt: T1, individualPublishedAt: T2 }), "CURRENT");
  assert.equal(resolvePublicationStatus({ updatedAt: T2, individualPublishedAt: T2 }), "CURRENT");
});

test("edited after publication is STALE (updatedAt > individualPublishedAt)", () => {
  assert.equal(resolvePublicationStatus({ updatedAt: T2, individualPublishedAt: T1 }), "STALE");
  assert.equal(isPublicationStale({ updatedAt: T2, individualPublishedAt: T1 }), true);
  assert.equal(isPublicationStale({ updatedAt: T1, individualPublishedAt: T2 }), false);
});

test("a missing publication timestamp is UNPUBLISHED regardless of updatedAt", () => {
  assert.equal(
    resolvePublicationStatus({ updatedAt: 999_999, individualPublishedAt: null }),
    "UNPUBLISHED",
  );
});

test("a published session with a malformed updatedAt fails closed to STALE", () => {
  assert.equal(
    resolvePublicationStatus({ updatedAt: Number.NaN, individualPublishedAt: T1 }),
    "STALE",
  );
});

// --- affected-user preview -------------------------------------------------

test("affected trainee/instructor ids are deduped and deterministically sorted", () => {
  const sessions: AffectedUsersInput[] = [
    { traineeIds: ["t-2", "t-1"], instructorIds: ["i-2"] },
    { traineeIds: ["t-1", "t-3"], instructorIds: ["i-1", "i-2"] },
  ];
  const preview = computeAffectedUsersPreview(sessions);
  assert.deepEqual([...preview.traineeIds], ["t-1", "t-2", "t-3"]);
  assert.deepEqual([...preview.instructorIds], ["i-1", "i-2"]);
});

test("blank/whitespace ids are dropped from the preview", () => {
  const preview = computeAffectedUsersPreview([
    { traineeIds: ["t-1", "", "  "], instructorIds: [] },
  ]);
  assert.deepEqual([...preview.traineeIds], ["t-1"]);
  assert.deepEqual([...preview.instructorIds], []);
});

test("the preview is order-independent across sessions", () => {
  const a = computeAffectedUsersPreview([
    { traineeIds: ["t-1"], instructorIds: ["i-1"] },
    { traineeIds: ["t-2"], instructorIds: ["i-2"] },
  ]);
  const b = computeAffectedUsersPreview([
    { traineeIds: ["t-2"], instructorIds: ["i-2"] },
    { traineeIds: ["t-1"], instructorIds: ["i-1"] },
  ]);
  assert.deepEqual(a, b);
});

test("computeAffectedUsersPreview does not mutate its inputs", () => {
  const sessions: AffectedUsersInput[] = [
    { traineeIds: ["t-2", "t-1"], instructorIds: ["i-1"] },
  ];
  const snapshot = JSON.stringify(sessions);
  computeAffectedUsersPreview(sessions);
  assert.equal(JSON.stringify(sessions), snapshot);
});

test("an empty session list yields empty, frozen preview sets", () => {
  const preview = computeAffectedUsersPreview([]);
  assert.deepEqual([...preview.traineeIds], []);
  assert.deepEqual([...preview.instructorIds], []);
});
