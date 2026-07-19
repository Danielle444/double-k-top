// Fix 3, Stage 2 - DB-free CONTRACT/source test for the complex-plan template
// wiring. Runs no Prisma and opens no DB: it statically inspects the source of
// the two write-path modules and asserts the invariants the approved product
// contract requires. This guards against a future refactor silently breaking
// the transaction scoping or the all-or-nothing / read-only-source guarantees.
//
// Run: npx tsx --test lib/actions/riding-complex-template-create.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so the invariants below are checked against
// real CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name buildHorseCandidates, prisma, publication, etc. Neither
// source file contains `//` inside a string or regex literal, so this naive
// strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const actionSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-slot-complex.ts", import.meta.url)), "utf8")
);
const lookupSrc = stripComments(
  readFileSync(fileURLToPath(new URL("./riding-complex-template-lookup.ts", import.meta.url)), "utf8")
);

// The createComplexPlanInternal function body only (never the other, unrelated
// save/delete/reorder functions in the same file, which DO touch version/etc).
function createRegion(): string {
  const start = actionSrc.indexOf("async function createComplexPlanInternal");
  const end = actionSrc.indexOf("export async function createRidingSlotComplexPlanAsAdmin");
  assert.ok(start > -1, "createComplexPlanInternal not found");
  assert.ok(end > start, "createComplexPlanInternal end marker not found");
  return actionSrc.slice(start, end);
}

// The tail from the transaction callback opener onward (excludes the
// `prisma.$transaction(` opener itself, which necessarily contains `prisma.`).
function txCallbackTail(region: string): string {
  const idx = region.indexOf("async (tx) =>");
  assert.ok(idx > -1, "tx callback opener not found");
  return region.slice(idx);
}

test("template wiring occurs only AFTER the fresh plan create, on the genuine-create branch", () => {
  const region = createRegion();
  const existingReturn = region.indexOf("if (existingPlan) return { ok: true");
  const planCreate = region.indexOf("ridingSlotComplexPlan.create(");
  const resolveTemplate = region.indexOf("resolveTemplateForNewPlan(");
  assert.ok(existingReturn > -1, "existing-plan early return not found");
  assert.ok(planCreate > -1, "plan create not found");
  assert.ok(resolveTemplate > -1, "resolveTemplateForNewPlan call not found");
  // Early return precedes plan create precedes template resolve.
  assert.ok(existingReturn < planCreate, "existing-plan return must precede plan create");
  assert.ok(planCreate < resolveTemplate, "template must be resolved only after the fresh plan create");
});

test("the existing-plan (idempotent) path performs no copy", () => {
  const region = createRegion();
  // The early return sits before BOTH the plan create and the template resolve,
  // so the existing-plan branch can never reach either.
  const existingReturn = region.indexOf("if (existingPlan) return { ok: true");
  const resolveTemplate = region.indexOf("resolveTemplateForNewPlan(");
  assert.ok(existingReturn > -1 && resolveTemplate > -1);
  assert.ok(existingReturn < resolveTemplate);
});

test("destination writes follow plan -> block -> station -> pair", () => {
  const region = createRegion();
  const plan = region.indexOf("ridingSlotComplexPlan.create(");
  const block = region.indexOf("ridingSlotComplexBlock.create(");
  const station = region.indexOf("ridingSlotComplexStation.create(");
  const pair = region.indexOf("ridingSlotComplexPair.createMany(");
  assert.ok(plan > -1 && block > -1 && station > -1 && pair > -1, "expected all four destination writes");
  assert.ok(plan < block, "plan create must precede block create");
  assert.ok(block < station, "block create must precede station create");
  assert.ok(station < pair, "station create must precede pair create");
});

test("no publication model is referenced by the create path or the lookup helper", () => {
  // Model accessors / type names are PascalCase 'Publication'; the contract
  // prose deliberately uses lowercase 'publication', so this matches only real
  // references. (Other functions in the action file legitimately touch the
  // publication version counter - hence scoping to the create region.)
  assert.ok(!/Publication/.test(createRegion()), "create path must not reference a publication model/type");
  assert.ok(!/Publication/.test(lookupSrc), "lookup helper must not reference a publication model/type");
});

test("the lookup helper never mutates any (source) row and never upserts", () => {
  for (const forbidden of [".update(", ".updateMany(", ".delete(", ".deleteMany(", ".upsert("]) {
    assert.ok(!lookupSrc.includes(forbidden), `lookup helper must not call ${forbidden}`);
  }
});

test("the create path issues no update/delete/upsert (source stays read-only)", () => {
  const region = createRegion();
  for (const forbidden of [".update(", ".updateMany(", ".delete(", ".deleteMany(", ".upsert("]) {
    assert.ok(!region.includes(forbidden), `create path must not call ${forbidden}`);
  }
});

test("copyPlanForTemplate is the only payload sanitizer", () => {
  assert.ok(lookupSrc.includes("copyPlanForTemplate("), "lookup helper must call copyPlanForTemplate");
  // The action never sanitizes itself - it only maps already-sanitized fields.
  assert.ok(!actionSrc.includes("copyPlanForTemplate"), "the action must delegate sanitization to the helper");
});

test("neither module imports resolveCurrentCourseOffering", () => {
  assert.ok(!lookupSrc.includes("resolveCurrentCourseOffering"), "lookup helper must not use resolveCurrentCourseOffering");
  assert.ok(!actionSrc.includes("resolveCurrentCourseOffering"), "action must not use resolveCurrentCourseOffering");
});

test("the lookup helper issues no global-prisma query (tx-only, no @/lib/prisma import)", () => {
  assert.ok(!/from ["']@\/lib\/prisma["']/.test(lookupSrc), "lookup helper must not import the global prisma client");
  // Lowercase `prisma.` = the global client accessor; `Prisma.` (the type
  // namespace) and `tx.` (the injected client) are fine.
  assert.ok(!/\bprisma\./.test(lookupSrc), "lookup helper must not use the global prisma client");
});

test("no global-prisma helper is invoked from inside the tx callback", () => {
  const region = createRegion();
  const tail = txCallbackTail(region);
  // The roster read via the global-prisma helper must happen BEFORE the tx.
  const buildCall = region.indexOf("buildHorseCandidates(");
  const txOpen = region.indexOf("prisma.$transaction");
  assert.ok(buildCall > -1, "buildHorseCandidates pre-read not found");
  assert.ok(txOpen > -1, "prisma.$transaction not found");
  assert.ok(buildCall < txOpen, "buildHorseCandidates must be read before the transaction opens");
  // Inside/after the callback: no global prisma client and no global-prisma helper.
  assert.ok(!/\bprisma\./.test(tail), "no global prisma client may be used inside the tx callback");
  assert.ok(!tail.includes("buildHorseCandidates"), "buildHorseCandidates must never be called inside the tx callback");
});
