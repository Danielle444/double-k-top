/**
 * SECURITY / LEVEL 2 SLICES L2-M1A + L2-M1C: source-level contract tests
 * confining the COURSE_MATERIALS capability to its definition layer plus the
 * ONE approved runtime consumer.
 *
 * The behavioural tests (capability-catalog.test.ts / capability-labels.test.ts)
 * prove the contract's VALUES. These prove the structural property those cannot:
 * exactly WHERE the key is allowed to appear and what the one wired module must
 * do with it.
 *
 * HISTORY - this file was authored by L2-M1A, when the key was definition-only
 * and RUNTIME-INERT, with the explicit instruction that "when L2-M1 legitimately
 * wires lib/actions/materials.ts, this file must be updated in the SAME reviewed
 * slice that does the wiring - never quietly relaxed beforehand". L2-M1C is that
 * slice: the tripwires below were not relaxed but INVERTED. `materials.ts` moved
 * from "must not reference the key" to "must reference it through the trainee
 * containment gate, before any Prisma read", the runtime-consumer set went from
 * empty to EXACTLY that one file, and every other tripwire (notifications.ts,
 * the bucket-constant distinction, exact-equality mention list) is unchanged.
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

/** The ONE production module approved to enforce this capability (L2-M1C). */
const APPROVED_RUNTIME_CONSUMER = "lib/actions/materials.ts";

/**
 * The COMPLETE set of files permitted to mention the key.
 *
 * Three groups, and the distinction is the whole point:
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
 *  3. THE L2-M1C ENFORCEMENT LAYER - the single trainee-facing reader that gates
 *     on the key, plus that slice's own focused containment test.
 *
 * Note what is deliberately ABSENT and must stay absent:
 * lib/actions/notifications.ts (the material fan-out is out of scope for L2-M1C)
 * and every other production module.
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
  // 3. L2-M1C enforcement layer
  APPROVED_RUNTIME_CONSUMER,
  "lib/actions/trainee-course-materials-containment.test.ts",
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

test("the allow-list blesses EXACTLY ONE runtime materials consumer", () => {
  // Guards the guard: widening the tripwire by quietly adding a second
  // production module to the allow-list must fail here. The trainee reader is
  // the only production file outside the capability definition layer that may
  // be listed, and the notification fan-out must stay off the list entirely.
  assert.ok(
    !APPROVED_KEY_MENTIONS.includes("lib/actions/notifications.ts"),
    "lib/actions/notifications.ts is out of scope for L2-M1C",
  );
  const productionEntries = APPROVED_KEY_MENTIONS.filter(
    (rel) => !rel.endsWith(".test.ts") && !rel.startsWith("lib/course/capabilities/capability-"),
  );
  assert.deepEqual(
    productionEntries,
    [APPROVED_RUNTIME_CONSUMER],
    "only the trainee materials reader may enforce this capability",
  );
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

test("the materials action IS capability-wired, through the committed gate", () => {
  const src = readFileSync(path.join(REPO_ROOT, APPROVED_RUNTIME_CONSUMER), "utf8");
  assert.ok(KEY_TOKEN.test(src), "materials.ts must reference COURSE_MATERIALS");
  // The wiring must be the committed containment stack, not a bespoke check.
  for (const required of [
    "offering-capabilities",
    "getEffectiveCapabilities",
    "trainee-module-containment-core",
    "actor-course-offering",
    "requireCurrentTrainee",
  ]) {
    assert.ok(src.includes(required), `materials.ts must consume ${required}`);
  }
  assert.ok(
    /const TRAINEE_COURSE_MATERIALS_CAPABILITY_KEY: CapabilityKey = "COURSE_MATERIALS";/.test(src),
    "the key must be the canonical literal, typed as CapabilityKey",
  );
});

test("EXACTLY ONE runtime module consumes the key through a capability check", () => {
  // A capability CHECK is what actually changes behaviour. Outside the
  // definition layer, only the approved trainee reader may pair the key with a
  // status comparison, a capability map read, or the containment gate.
  const consumers = SOURCES.filter(
    (s) =>
      KEY_TOKEN.test(s.src) &&
      !s.rel.endsWith(".test.ts") &&
      !s.rel.startsWith("lib/course/capabilities/capability-"),
  )
    .map((s) => s.rel)
    .sort();
  assert.deepEqual(
    consumers,
    [APPROVED_RUNTIME_CONSUMER],
    "no runtime consumer beyond the approved trainee materials reader may exist",
  );
});

test("the notification path remains untouched by this slice", () => {
  const src = readFileSync(path.join(REPO_ROOT, "lib/actions/notifications.ts"), "utf8");
  assert.ok(!KEY_TOKEN.test(src));
});
