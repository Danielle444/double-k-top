/**
 * SECURITY / LEVEL 2 SLICE L2-M1A: source-level contract tests proving the
 * COURSE_MATERIALS capability is DEFINITION-ONLY and RUNTIME-INERT.
 *
 * The behavioural tests (capability-catalog.test.ts / capability-labels.test.ts)
 * prove the contract's VALUES. These prove the structural property those cannot:
 * that adding the key wired NOTHING. Materials are still served by the
 * unauthenticated reader they were served by before this slice, and the
 * containment slice (L2-M1) that will consume this key has not landed.
 *
 * These assertions are TRIPWIRES, not decoration: when L2-M1 legitimately wires
 * lib/actions/materials.ts, this file must be updated in the SAME reviewed slice
 * that does the wiring - never quietly relaxed beforehand.
 *
 * Structural precedent: lib/course/temporary-level2-compatibility.contract.test.ts.
 * Run with: npx tsx --test lib/course/capabilities/course-materials-capability.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CAPABILITY_KEYS, isCapabilityKey } from "./capability-keys";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const KEY = "COURSE_MATERIALS";

/**
 * Matches the capability key as a WHOLE TOKEN.
 *
 * This distinction is load-bearing, not pedantry: lib/supabase.ts has exported
 * the UNRELATED, PRE-EXISTING storage-bucket constant `COURSE_MATERIALS_BUCKET`
 * since long before this slice, and lib/actions/materials.ts and the admin
 * upload route both import it. A naive substring scan flags all three as
 * "capability consumers" and the tripwires below become permanently red for a
 * reason that has nothing to do with the capability. `\b...\b` cannot match
 * inside `COURSE_MATERIALS_BUCKET` because `_` is a word character, so the two
 * identifiers stay cleanly separable.
 */
const KEY_TOKEN = /\bCOURSE_MATERIALS\b/;

/**
 * The COMPLETE set of files permitted to mention the key at this slice.
 *
 * Two groups, and the distinction is the whole point:
 *
 *  1. THE DEFINITION LAYER - the three definition modules and their focused
 *     tests. This is where the key is allowed to be authored.
 *  2. UNRELATED SUITES WHOSE EXHAUSTIVE FIXTURES THE COMPILER FORCED - four
 *     pre-existing `Record<CapabilityKey, EffectiveCapabilityStatus>` literals
 *     that must list every canonical key or fail to type-check. Each gained
 *     exactly one entry carrying its own fixture's existing default (ENABLED for
 *     the all-enabled contact/schedule fixtures, DISABLED for the containment
 *     core's all-denied fixture). NONE of them is a consumer: no production code
 *     path in those slices reads COURSE_MATERIALS, and no assertion in them
 *     depends on its value.
 *
 * Note what is deliberately ABSENT and must stay absent until the L2-M1 reader
 * slice: lib/actions/materials.ts and lib/actions/notifications.ts.
 */
const APPROVED_KEY_MENTIONS: readonly string[] = [
  // 1. definition layer
  "lib/course/capabilities/capability-catalog.test.ts",
  "lib/course/capabilities/capability-catalog.ts",
  "lib/course/capabilities/capability-keys.ts",
  "lib/course/capabilities/capability-labels.test.ts",
  "lib/course/capabilities/capability-labels.ts",
  "lib/course/capabilities/course-materials-capability.contract.test.ts",
  // 2. compile-forced exhaustive test fixtures (non-consumers)
  "lib/actions/contacts.instructor-directory.test.ts",
  "lib/actions/contacts.student-directory.test.ts",
  "lib/course/course-scoped-week-options-core.test.ts",
  "lib/course/trainee-module-containment-core.test.ts",
];

/** Every source file under the app's own directories. */
function sourceFiles(): string[] {
  const roots = ["app", "lib", "components", "scripts"].map((d) => path.join(REPO_ROOT, d));
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
}

const SOURCES = sourceFiles().map((file) => ({
  file,
  rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
  src: readFileSync(file, "utf8"),
}));

test("fixture: the source walk actually found the files it claims to police", () => {
  // Without this, an empty/failed walk would make every tripwire below pass
  // vacuously. The materials reader must be among the scanned files.
  assert.ok(SOURCES.length > 200, `implausibly few sources scanned: ${SOURCES.length}`);
  assert.ok(
    SOURCES.some((s) => s.rel === "lib/actions/materials.ts"),
    "the materials action must be inside the scanned set",
  );
});

test("COURSE_MATERIALS is canonical", () => {
  assert.ok(isCapabilityKey(KEY));
  assert.equal(CAPABILITY_KEYS.filter((k) => k === KEY).length, 1);
});

test("the storage-bucket constant is a DIFFERENT identifier and stays untouched", () => {
  // Guards the distinction the scanner relies on: if the bucket constant were
  // ever renamed to the bare key, every tripwire below would silently widen.
  const supabase = readFileSync(path.join(REPO_ROOT, "lib/supabase.ts"), "utf8");
  assert.ok(supabase.includes("COURSE_MATERIALS_BUCKET"), "bucket constant must still exist");
  assert.ok(!KEY_TOKEN.test(supabase), "lib/supabase.ts must not use the bare capability key");
});

test("the allow-list itself can never bless a runtime materials consumer", () => {
  // Guards the guard: relaxing the tripwire by quietly adding the reader to the
  // allow-list must fail here, and no production (non-test) module outside the
  // capability definition layer may be listed at all.
  for (const forbidden of ["lib/actions/materials.ts", "lib/actions/notifications.ts"]) {
    assert.ok(
      !APPROVED_KEY_MENTIONS.includes(forbidden),
      `${forbidden} must not be an approved mention in a definition-only slice`,
    );
  }
  const productionEntries = APPROVED_KEY_MENTIONS.filter(
    (rel) => !rel.endsWith(".test.ts") && !rel.startsWith("lib/course/capabilities/capability-"),
  );
  assert.deepEqual(productionEntries, [], "no production consumer may be approved");
});

test("the key is mentioned ONLY by the approved definition modules and their tests", () => {
  const mentions = SOURCES.filter((s) => KEY_TOKEN.test(s.src))
    .map((s) => s.rel)
    .sort();
  // EXACT equality, never a subset: an unapproved consumer fails, and so does a
  // stale entry left behind after a file stops mentioning the key.
  assert.deepEqual(
    mentions,
    [...APPROVED_KEY_MENTIONS].sort(),
    "COURSE_MATERIALS must not escape the capability definition layer in this slice",
  );
});

test("the materials action is not capability-wired by this slice", () => {
  const src = readFileSync(path.join(REPO_ROOT, "lib/actions/materials.ts"), "utf8");
  assert.ok(!KEY_TOKEN.test(src), "materials.ts must not reference COURSE_MATERIALS yet");
  for (const forbidden of [
    "capability-keys",
    "capability-catalog",
    "offering-capabilities",
    "getEffectiveCapabilities",
    "trainee-module-containment-core",
    "actor-course-offering",
  ]) {
    assert.ok(
      !src.includes(forbidden),
      `materials.ts must not consume ${forbidden} in a definition-only slice`,
    );
  }
});

test("no runtime module consumes the key through a capability check", () => {
  // A capability CHECK is what actually changes behaviour. No production module
  // outside the definition layer may pair the key with a status comparison, a
  // capability map read, or the containment gate.
  const offenders = SOURCES.filter(
    (s) =>
      KEY_TOKEN.test(s.src) &&
      !s.rel.endsWith(".test.ts") &&
      !s.rel.startsWith("lib/course/capabilities/capability-"),
  ).map((s) => s.rel);
  assert.deepEqual(offenders, [], "no runtime consumer may exist in a definition-only slice");
});

test("the notification path remains untouched by this slice", () => {
  const src = readFileSync(path.join(REPO_ROOT, "lib/actions/notifications.ts"), "utf8");
  assert.ok(!KEY_TOKEN.test(src));
});
