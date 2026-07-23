/**
 * ACTIVE-RENAME - executable tests for the PURE rename validation core.
 *
 * Run with: npx tsx --test lib/course/rename-offering-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness. Also transitively exercises
 * the shared validateOfferingName rule reused from create-offering-core.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRenameOfferingInput,
  type RawRenameOfferingInput,
} from "./rename-offering-core";

const OLD_NAME = "קורס מדריכים ומאמנים – רמה 1";
const NEW_NAME = "קורס מדריכים קיץ – רמה 1";

function input(overrides: Partial<RawRenameOfferingInput> = {}): RawRenameOfferingInput {
  return {
    courseOfferingId: "offering-1",
    expectedCurrentName: OLD_NAME,
    name: NEW_NAME,
    ...overrides,
  };
}

test("accepts the exact production target rename", () => {
  const result = validateRenameOfferingInput(input());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.courseOfferingId, "offering-1");
  assert.equal(result.value.expectedCurrentName, OLD_NAME);
  assert.equal(result.value.name, NEW_NAME);
  assert.equal(result.value.isNoOp, false);
});

test("trims a valid Hebrew new name and the boundary fields", () => {
  const result = validateRenameOfferingInput(
    input({
      courseOfferingId: "  offering-1  ",
      expectedCurrentName: `  ${OLD_NAME}  `,
      name: `   ${NEW_NAME}   `,
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.courseOfferingId, "offering-1");
  assert.equal(result.value.expectedCurrentName, OLD_NAME);
  assert.equal(result.value.name, NEW_NAME);
});

test("rejects an empty new name as name_required", () => {
  const result = validateRenameOfferingInput(input({ name: "" }));
  assert.deepEqual(result, { ok: false, error: "name_required" });
});

test("rejects a whitespace-only new name as name_required", () => {
  const result = validateRenameOfferingInput(input({ name: "    " }));
  assert.deepEqual(result, { ok: false, error: "name_required" });
});

test("rejects a non-string new name as name_required", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const result = validateRenameOfferingInput(input({ name: bad }));
    assert.deepEqual(result, { ok: false, error: "name_required" });
  }
});

test("requires a courseOfferingId (checked first, before name)", () => {
  for (const bad of ["", "   ", null, undefined, 7]) {
    const result = validateRenameOfferingInput(
      input({ courseOfferingId: bad, name: "" }),
    );
    // offering id is validated before the (also-invalid) name.
    assert.deepEqual(result, { ok: false, error: "offering_id_required" });
  }
});

test("requires an expectedCurrentName (checked before name)", () => {
  for (const bad of ["", "   ", null, undefined, 7]) {
    const result = validateRenameOfferingInput(
      input({ expectedCurrentName: bad, name: "" }),
    );
    assert.deepEqual(result, { ok: false, error: "expected_name_required" });
  }
});

test("identifies a same-name change as a no-op", () => {
  const result = validateRenameOfferingInput(input({ name: OLD_NAME }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.isNoOp, true);
  assert.equal(result.value.name, OLD_NAME);
});

test("treats a whitespace-only difference as a no-op after trimming", () => {
  const result = validateRenameOfferingInput(
    input({ name: `  ${OLD_NAME}  `, expectedCurrentName: OLD_NAME }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.isNoOp, true);
});

test("imposes no maximum-length bound (parity with creation)", () => {
  // create-offering-core.ts imposes only trim + non-empty (no max length); the
  // rename must not add a stricter divergent bound.
  const longName = "א".repeat(500);
  const result = validateRenameOfferingInput(input({ name: longName }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, longName);
});
