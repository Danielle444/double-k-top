// RC-B2a - focused unit tests for the pure CourseOffering resolver
// (resolveOffering in ./resolve-offering). DB-free and IO-free: it exercises
// only the pure function against explicit already-read offering-id values.
//
// Run: npx tsx --test lib/riding-complex-template/resolve-offering.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { resolveOffering } from "./resolve-offering";

// 1. One non-null offering id resolves.
test("one non-null offering id resolves to that id", () => {
  const result = resolveOffering(["off1"]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.courseOfferingId : undefined, "off1");
});

// 2. Repeated identical non-null id resolves.
test("a repeated identical non-null id resolves to that id", () => {
  const result = resolveOffering(["off1", "off1", "off1"]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.courseOfferingId : undefined, "off1");
});

// 3. One null resolves to null.
test("one null resolves to null", () => {
  const result = resolveOffering([null]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.courseOfferingId : "x", null);
});

// 4. Repeated null resolves to null.
test("repeated null resolves to null", () => {
  const result = resolveOffering([null, null, null]);
  assert.equal(result.status, "RESOLVED");
  assert.equal(result.status === "RESOLVED" ? result.courseOfferingId : "x", null);
});

// 5. Two different non-null ids are ambiguous.
test("two different non-null ids are ambiguous", () => {
  const result = resolveOffering(["off1", "off2"]);
  assert.equal(result.status, "AMBIGUOUS");
  assert.ok(!("courseOfferingId" in result));
});

// 6. Null mixed with a non-null id is ambiguous (both directions).
test("null mixed with a non-null id is ambiguous", () => {
  assert.equal(resolveOffering([null, "off1"]).status, "AMBIGUOUS");
  assert.equal(resolveOffering(["off1", null]).status, "AMBIGUOUS");
});

// 6b. A string "null" is a distinct identity from real null (no coercion).
test('the string "null" never matches real null', () => {
  assert.equal(resolveOffering(["null", null]).status, "AMBIGUOUS");
  const onlyStringNull = resolveOffering(["null", "null"]);
  assert.equal(onlyStringNull.status, "RESOLVED");
  assert.equal(onlyStringNull.status === "RESOLVED" ? onlyStringNull.courseOfferingId : undefined, "null");
});

// 7. Empty collection returns NO_ITEMS (fail-closed).
test("an empty collection returns NO_ITEMS", () => {
  const result = resolveOffering([]);
  assert.equal(result.status, "NO_ITEMS");
});

// 8. Input order does not affect the result.
test("input order does not affect the result", () => {
  assert.equal(resolveOffering(["a", "b"]).status, resolveOffering(["b", "a"]).status);
  assert.equal(resolveOffering([null, "a"]).status, resolveOffering(["a", null]).status);

  const r1 = resolveOffering(["x", "x"]);
  const r2 = resolveOffering(["x", "x"]);
  assert.equal(r1.status, "RESOLVED");
  assert.equal(
    r1.status === "RESOLVED" ? r1.courseOfferingId : undefined,
    r2.status === "RESOLVED" ? r2.courseOfferingId : undefined
  );
});

// 9. Input is not mutated (including a deeply frozen input).
test("input is never mutated", () => {
  const input = ["off1", "off1"];
  const snapshot = JSON.stringify(input);
  resolveOffering(input);
  assert.equal(JSON.stringify(input), snapshot);

  const frozen = Object.freeze(["off1", null]);
  assert.doesNotThrow(() => resolveOffering(frozen));
});

// 10. Output is frozen for every status.
test("output is frozen for every status", () => {
  assert.ok(Object.isFrozen(resolveOffering(["off1"])));
  assert.ok(Object.isFrozen(resolveOffering([null])));
  assert.ok(Object.isFrozen(resolveOffering(["a", "b"])));
  assert.ok(Object.isFrozen(resolveOffering([])));
});

// 11. Malformed input fails safely without throwing.
test("malformed input fails safely without throwing", () => {
  // Non-array inputs -> NO_ITEMS (fail-closed), never a throw.
  for (const bad of [null, undefined, {}, "off1", 42]) {
    let result: ReturnType<typeof resolveOffering> | undefined;
    assert.doesNotThrow(() => {
      result = resolveOffering(bad as unknown as (string | null)[]);
    });
    assert.equal(result?.status, "NO_ITEMS");
  }

  // An array carrying a non-(string|null) value -> AMBIGUOUS (fail-closed).
  for (const messy of [[undefined], [42], [{}], ["off1", 5], [null, {}]]) {
    let result: ReturnType<typeof resolveOffering> | undefined;
    assert.doesNotThrow(() => {
      result = resolveOffering(messy as unknown as (string | null)[]);
    });
    assert.equal(result?.status, "AMBIGUOUS");
  }
});
