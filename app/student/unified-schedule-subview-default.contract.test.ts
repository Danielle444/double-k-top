/**
 * UNIFIED TRAINEE SCHEDULE - DEFAULT SUB-VIEW: contract tests for making
 * "הלו״ז שלי" the default schedule view for dual-enrolled trainees, in
 * app/student/StudentClient.tsx.
 *
 * Locked contract:
 *  - A dual-enrolled trainee (2+ eligible courses) opens on "הלו״ז שלי" the
 *    FIRST time this signed-in trainee's course options are known for the
 *    current mounted session (resolveDefaultScheduleSubView).
 *  - A single-course trainee is unaffected: it always resolves to "course".
 *  - Once applied for a trainee, it is never re-forced back to "unified" on
 *    a later rerender/refetch - a manual "לפי קורס"/course pick, or a manual
 *    return to "הלו״ז שלי", survives ordinary rerenders and date/week
 *    navigation untouched.
 *  - If dual eligibility later drops below two while "הלו״ז שלי" is active,
 *    it safely falls back to "course".
 *  - A genuine trainee switch (a NEW session.id, not a background profile
 *    refresh of the same trainee) resets the once-per-trainee tracking and
 *    the stale course options, so the next trainee never inherits the
 *    previous trainee's sub-view.
 *  - Home ("today") and the schedule tab share the SAME scheduleSubView
 *    state - this default therefore applies to both surfaces at once, which
 *    is the existing, intentional sharing (see
 *    unified-schedule-subview.contract.test.ts), not something this change
 *    introduces or should split.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * StudentClient.tsx cannot be imported here - it transitively pulls in
 * "server-only" (see trainee-client-course-selection.contract.test.ts for the
 * same constraint) - so this locks the behaviour by asserting the
 * component's SOURCE, the sanctioned pattern for this component.
 *
 * Run with:
 *   npx tsx --test app/student/unified-schedule-subview-default.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./StudentClient.tsx");

/** Isolate exactly the resolveDefaultScheduleSubView function body (brace-matched, immune to whatever follows it in the file). */
function defaultingHelperBody(): string {
  const start = SRC.indexOf("export function resolveDefaultScheduleSubView(");
  assert.notEqual(start, -1, "expected the resolveDefaultScheduleSubView helper");
  const bodyOpen = SRC.indexOf("{", start);
  assert.notEqual(bodyOpen, -1, "expected the function's opening brace");
  let depth = 0;
  for (let i = bodyOpen; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  assert.fail("expected a matching closing brace for resolveDefaultScheduleSubView");
}

/** Isolate the course-options effect (reset + fetch, keyed on session?.id). */
function optionsEffectBody(): string {
  const start = SRC.indexOf("listTraineeCourseOptions()");
  assert.notEqual(start, -1, "expected the listTraineeCourseOptions load");
  const end = SRC.indexOf("resolveDefaultScheduleSubView(alreadyDefaulted", start);
  assert.ok(end > start, "expected the defaulting effect after the options effect");
  return SRC.slice(SRC.lastIndexOf("useEffect(() => {\n    if (!session) return;\n    let cancelled = false;", start), end);
}

/** Isolate the defaulting effect (applies resolveDefaultScheduleSubView). */
function defaultingEffectBody(): string {
  const markerIdx = SRC.indexOf(
    "const alreadyDefaulted = defaultedUnifiedForTraineeIdRef.current === session.id;",
  );
  assert.notEqual(markerIdx, -1, "expected the defaulting effect");
  const start = SRC.lastIndexOf("useEffect(() => {", markerIdx);
  assert.notEqual(start, -1, "expected the enclosing useEffect");
  const end = SRC.indexOf("}, [session, courseOptions]);", markerIdx);
  assert.ok(end > start, "expected the defaulting effect's dependency array");
  return SRC.slice(start, end + "}, [session, courseOptions]);".length);
}

// ---------------------------------------------------------------------------
// resolveDefaultScheduleSubView - the pure decision, covering every required
// transition from the task.
// ---------------------------------------------------------------------------

test("dual eligibility (2+) with no prior default yields \"unified\" - dual trainee defaults to unified", () => {
  const body = defaultingHelperBody();
  assert.match(body, /const dual = eligibleCourseOptionsCount >= 2;/);
  assert.match(
    body,
    /if \(!alreadyDefaultedForCurrentTrainee\) return dual \? "unified" : "course";/,
    "expected the first-time-for-this-trainee branch to pick \"unified\" when dual, \"course\" otherwise",
  );
});

test("single-course (< 2) with no prior default yields \"course\" - single-course trainee keeps its existing default", () => {
  // Same line as above covers both halves of the ternary; assert the dual
  // threshold is exactly >= 2 (never > 2, never including 1).
  const body = defaultingHelperBody();
  assert.match(body, /eligibleCourseOptionsCount >= 2/);
  assert.ok(!/eligibleCourseOptionsCount > 2/.test(body));
  assert.ok(!/eligibleCourseOptionsCount >= 1/.test(body));
});

test("once already defaulted for this trainee, a manual course-view choice is never re-forced to unified", () => {
  const body = defaultingHelperBody();
  // The only branch reachable once alreadyDefaultedForCurrentTrainee is true
  // that can CHANGE the sub-view is the dual-eligibility-dropped fallback;
  // every other case returns currentSubView verbatim.
  assert.match(body, /if \(!dual && currentSubView === "unified"\) return "course";/);
  assert.match(body, /return currentSubView;\s*\}\s*$/);
});

test("dual eligibility dropping below two while unified forces course view", () => {
  const body = defaultingHelperBody();
  assert.match(body, /if \(!dual && currentSubView === "unified"\) return "course";/);
});

test("dual eligibility dropping below two while ALREADY on course view is a no-op (stays course)", () => {
  // Covered by the same fallback branch requiring currentSubView === "unified";
  // when currentSubView is "course" already, the function falls through to
  // `return currentSubView` unchanged - assert no separate/looser branch exists.
  const body = defaultingHelperBody();
  const conditionals = body.match(/if \([^)]*\)/g) ?? [];
  assert.equal(conditionals.length, 2, "expected exactly the first-time and the dropped-eligibility branches");
});

// ---------------------------------------------------------------------------
// The defaulting effect: fires only off [session, courseOptions], guarded on
// courseOptions !== null, so it never fires on every render, and never on
// date/week navigation or a manual course pick (which touch unrelated state).
// ---------------------------------------------------------------------------

test("the defaulting effect is guarded on courseOptions !== null and depends only on [session, courseOptions]", () => {
  const body = defaultingEffectBody();
  assert.match(body, /if \(!session \|\| courseOptions === null\) return;/);
  assert.ok(body.trim().endsWith("}, [session, courseOptions]);"));
});

test("the defaulting effect's dependency array excludes selectedCourseOfferingId, weeks, selectedWeekId and dayFilter", () => {
  // A manual Level 1/2 pick, or a date/week change, must never retrigger this
  // effect and re-decide the default.
  const body = defaultingEffectBody();
  const depArrayLine = body.slice(body.lastIndexOf("}, ["));
  assert.ok(!/selectedCourseOfferingId|weeks|selectedWeekId|dayFilter/.test(depArrayLine));
});

test("the defaulting effect marks the trainee as defaulted BEFORE deciding, using session.id as the key", () => {
  const body = defaultingEffectBody();
  assert.match(
    body,
    /const alreadyDefaulted = defaultedUnifiedForTraineeIdRef\.current === session\.id;/,
  );
  assert.match(body, /defaultedUnifiedForTraineeIdRef\.current = session\.id;/);
});

test("the defaulting effect delegates the decision to the pure helper, never inlining the branch logic", () => {
  const body = defaultingEffectBody();
  assert.match(
    body,
    /resolveDefaultScheduleSubView\(alreadyDefaulted, courseOptions\.length, prev\)/,
  );
});

// ---------------------------------------------------------------------------
// Trainee switch: a NEW session.id resets the tracking and the stale course
// options before any default is (re-)decided, so the next trainee never
// inherits the previous trainee's sub-view or option count.
// ---------------------------------------------------------------------------

test("the options-fetch effect (keyed on session?.id) resets the default tracking, sub-view and course options before fetching", () => {
  const body = optionsEffectBody();
  const resetIdx = body.indexOf("defaultedUnifiedForTraineeIdRef.current = null;");
  const subViewIdx = body.indexOf('setScheduleSubView("course");');
  const optionsIdx = body.indexOf("setCourseOptions(null);");
  const fetchIdx = body.indexOf("listTraineeCourseOptions()");
  assert.notEqual(resetIdx, -1, "expected the ref reset");
  assert.notEqual(subViewIdx, -1, "expected the sub-view reset");
  assert.notEqual(optionsIdx, -1, "expected the course-options reset to null");
  assert.ok(
    resetIdx < fetchIdx && subViewIdx < fetchIdx && optionsIdx < fetchIdx,
    "the reset must happen BEFORE the fetch is dispatched, not after",
  );
});

test("the options-fetch effect depends only on session?.id, not the whole session object - a background profile refresh of the SAME trainee must not reset the sub-view", () => {
  assert.match(
    SRC,
    /defaultedUnifiedForTraineeIdRef\.current = null;[\s\S]*?\}, \[session\?\.id\]\);/,
    "expected the reset to live inside the session?.id-keyed effect",
  );
});

// ---------------------------------------------------------------------------
// Home and schedule share ONE scheduleSubView state (unchanged, intentional -
// see unified-schedule-subview.contract.test.ts) - the new default therefore
// applies uniformly to both surfaces with no second/conflicting state.
// ---------------------------------------------------------------------------

test("scheduleSubView is declared exactly once - home and the schedule tab share one state, never two", () => {
  const declarations = SRC.match(/const \[scheduleSubView, setScheduleSubView\] = useState/g) ?? [];
  assert.equal(declarations.length, 1, "expected exactly one scheduleSubView state for both surfaces");
});

test("no second defaulting/tracking state was introduced (defaultedUnifiedForTraineeIdRef is the only new piece of state)", () => {
  const refDeclarations = SRC.match(/const defaultedUnifiedForTraineeIdRef = useRef/g) ?? [];
  assert.equal(refDeclarations.length, 1);
  // It is a ref, not state - it must never appear in a useState call.
  assert.ok(!/useState.*defaultedUnifiedForTraineeIdRef/.test(SRC));
});

// ---------------------------------------------------------------------------
// No fake offering id: the defaulting logic never references a
// CourseOffering id, and never writes selectedCourseOfferingId.
// ---------------------------------------------------------------------------

test("the defaulting effect never writes selectedCourseOfferingId - the real course selection is untouched by the default", () => {
  const body = defaultingEffectBody();
  assert.ok(!body.includes("setSelectedCourseOfferingId"));
});

test("the trainee-switch reset never invents or forwards a fake offering id", () => {
  const body = optionsEffectBody();
  assert.ok(!/["']c[a-z0-9]{24,}["']/.test(body), "no hardcoded cuid offering id");
});
