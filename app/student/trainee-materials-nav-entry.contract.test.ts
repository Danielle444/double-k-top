/**
 * LEVEL 2 MATERIALS ENTRY POINT - the StudentClient wiring contract.
 *
 * The "חומרי קורס" entry was hidden for a Level-2-only trainee by a hard-coded
 * level allow-list that never read a capability. These tests pin the replacement
 * wiring: the entry is now offered on a SERVER answer
 * (hasAnyActiveEnabledCourseMaterialsOffering), that answer reaches all three
 * trainee navigation surfaces, it is never cached anywhere it could outlive a
 * session, and it can only ever ADD the entry - a Level-1-only or dual trainee's
 * navigation must be untouched even when the request fails.
 *
 * StudentClient.tsx cannot be imported in node:test (it pulls its `server-only`
 * chain - see trainee-nav-visibility.ts), so this asserts the wiring at the
 * source level, the same convention trainee-home-duties-visibility.test.ts uses.
 * The behavioural contract of the unlock rule itself lives in
 * trainee-nav-visibility.test.ts, and the server decision's own contract in
 * lib/actions/trainee-materials-access.contract.test.ts.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-materials-nav-entry.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/** Source with comments removed - assertions must test code, not prose. */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

// ===========================================================================
// The server decision drives the entry
// ===========================================================================

test("StudentClient imports the server unlock action from the dedicated module", () => {
  const code = readCode("./StudentClient.tsx");
  assert.match(
    code,
    /import\s*\{\s*hasAnyActiveEnabledCourseMaterialsOffering\s*\}\s*from\s*"@\/lib\/actions\/trainee-materials-access"/,
    "the unlock must come from the dedicated server action module",
  );
});

test("the materials entry is unlocked ONLY by a resolved `true` from the server", () => {
  const code = readCode("./StudentClient.tsx");
  assert.match(
    code,
    /const serverUnlockedNavIds: readonly MainTabId\[\] =\s*materialsEntryEnabled === true \? \["materials"\] : \[\];/,
    "strict === true: null (unresolved) and false must both unlock nothing",
  );
  // No level / offering-id / course-name inference may decide this entry.
  const derivation = code.slice(code.indexOf("const serverUnlockedNavIds"));
  const untilNextConst = derivation.slice(0, derivation.indexOf("const restrictToLoadingSafe"));
  for (const term of ["level", "isLevel2OnlyTrainee", "selectedCourseOfferingId", "cmr"]) {
    assert.ok(!untilNextConst.includes(term), `the unlock must not be derived from ${term}`);
  }
});

test("the unlock state is React state only - never persisted anywhere it could go stale", () => {
  const code = readCode("./StudentClient.tsx");
  assert.match(
    code,
    /const \[materialsEntryEnabled, setMaterialsEntryEnabled\] = useState<boolean \| null>\(null\);/,
    "the answer starts unresolved (null) on every mount",
  );
  // It must never be written to any persistence surface.
  for (const sink of [
    "localStorage.setItem(\"duty-manager-materials",
    "sessionStorage",
    "document.cookie",
    "createContext",
  ]) {
    assert.ok(!code.includes(sink), `the unlock answer must not be stored in ${sink}`);
  }
  assert.ok(
    !new RegExp(`setItem\\([^)]*materialsEntryEnabled`).test(code),
    "the unlock answer must never be written to storage",
  );
});

// ===========================================================================
// The effect: keyed to the session, reset on switch, fail-additive on error
// ===========================================================================

test("the unlock is fetched in an effect keyed to the session identity, resetting first", () => {
  const code = readCode("./StudentClient.tsx");
  const idx = code.indexOf("hasAnyActiveEnabledCourseMaterialsOffering()");
  assert.ok(idx >= 0, "the action must actually be called");

  const effect = code.slice(code.lastIndexOf("useEffect(", idx), code.indexOf("}, [session?.id]);", idx));
  assert.ok(
    effect.includes("setMaterialsEntryEnabled(null)"),
    "the previous trainee's answer must be cleared BEFORE the new request",
  );
  assert.ok(effect.includes("if (!session) return;"), "no session -> nothing asked, state stays null");
  assert.ok(effect.includes("let cancelled = false;"), "a cancelled flag must guard the async set");
  assert.ok(effect.includes("if (cancelled) return;"), "a stale response must not be applied");
  assert.match(
    code.slice(idx),
    /^[\s\S]{0,600}\}, \[session\?\.id\]\);/,
    "the effect must be keyed to session?.id, so it restarts only on a real trainee switch",
  );
});

test("a rejection resolves to false (no extra unlock) and surfaces no raw error", () => {
  const code = readCode("./StudentClient.tsx");
  const idx = code.indexOf("hasAnyActiveEnabledCourseMaterialsOffering()");
  const effect = code.slice(idx, code.indexOf("}, [session?.id]);", idx));
  assert.match(
    effect,
    /\.catch\(\(\) => \{\s*if \(cancelled\) return;\s*setMaterialsEntryEnabled\(false\);\s*\}\)/,
    "an infrastructure failure must resolve to 'no additional unlock', not to an error banner",
  );
  assert.ok(!/catch\s*\(\s*\w+\s*\)\s*=>/.test(effect), "no error object is captured or displayed");
});

// ===========================================================================
// All three navigation surfaces receive it
// ===========================================================================

test("all three trainee nav surfaces receive the server unlock", () => {
  const code = readCode("./StudentClient.tsx");
  for (const surface of ["STUDENT_MAIN_TABS", "moreMenuSource", "STUDENT_QUICK_ACTIONS"]) {
    assert.ok(
      code.includes(`filterTraineeNavEntries(${surface}, eligibleCourseOptions, serverUnlockedNavIds)`),
      `${surface} must be filtered with the server unlock`,
    );
  }
  // No surface may be left on the old two-argument call.
  const twoArgCalls = [...code.matchAll(/filterTraineeNavEntries\([^)]*\)/g)].map((m) => m[0]);
  for (const call of twoArgCalls) {
    assert.ok(
      call.includes("serverUnlockedNavIds"),
      `every filter call must pass the unlock; found: ${call}`,
    );
  }
  assert.equal(twoArgCalls.length, 3, "exactly the three nav surfaces are filtered");
});

test("the loading-safe path unions the unlock, so the nav grows and never shrinks", () => {
  const code = readCode("./StudentClient.tsx");
  assert.match(
    code,
    /LOADING_SAFE_NAV_IDS\.includes\(entry\.id\) \|\| serverUnlockedNavIds\.includes\(entry\.id\)/,
    "while options load, materials appears only once the server has said true",
  );
  // The constant itself must NOT have gained "materials" - an unresolved answer
  // must keep the entry hidden.
  const constant = code.slice(
    code.indexOf("const LOADING_SAFE_NAV_IDS"),
    code.indexOf("];", code.indexOf("const LOADING_SAFE_NAV_IDS")),
  );
  assert.ok(!constant.includes("materials"), "the loading-safe constant must stay capability-free");
});

// ===========================================================================
// The authoritative content gate and the tab body are untouched
// ===========================================================================

test("the level allow-list still hides every OTHER Level 2 module (scope stayed narrow)", () => {
  const nav = readCode("./trainee-nav-visibility.ts");
  const list = nav.slice(
    nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS"),
    nav.indexOf("];", nav.indexOf("const LEVEL2_ONLY_VISIBLE_NAV_IDS")),
  );
  for (const stillHidden of ["duties", "messages", "materials", "teachingPractice", "weeklyFeedback", "notifications"]) {
    assert.ok(!list.includes(stillHidden), `${stillHidden} must not be added to the level allow-list`);
  }
});

test("the materials tab body and its server reader are unchanged", () => {
  const code = readCode("./StudentClient.tsx");
  assert.ok(
    code.includes('{activeTab === "materials" && <CourseMaterialsSection role="student" />}'),
    "the tab body must be untouched - the unlock changes navigation, not rendering",
  );
  // The client must not have acquired its own materials read.
  assert.ok(!code.includes("getStudentMaterials"), "StudentClient must not read materials itself");
});
