/**
 * INSTRUCTOR SCHEDULE DEFAULTS - SLICE IUS-2E: SOURCE-CONTRACT tests for the
 * permission-based default sub-view and the automatic Level 1 course selection.
 *
 * The four components involved transitively import "use server" modules (Prisma +
 * next/headers), so they cannot be imported into a plain `tsx --test` process.
 * This uses the repository's established SOURCE-CONTRACT pattern to assert:
 *
 *  - the default mode is derived from the SERVER-owned canEditRidingNotes prop,
 *    synchronously, in both surfaces, using the SAME expression;
 *  - nothing re-writes the mode after mount, so a manual toggle is never undone;
 *  - the automatic course selection is latched and null-guarded, so a manual
 *    course pick is never undone;
 *  - the flag comes from the Actor DAL with no extra query and no client id, and
 *    the localStorage-backed session copy is not used for it;
 *  - the existing riding-note authorization boundaries are untouched;
 *  - the shared course selector's new callback is optional, and the CONTACTS
 *    surface gains no default selection.
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-schedule-default-mode.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips block, line and JSX comments so prose about a rule can't satisfy the rule. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const PAGE = "app/instructor/page.tsx";
const CLIENT = "app/instructor/InstructorClient.tsx";
const WEEKLY = "app/instructor/InstructorCourseScopedScheduleSection.tsx";
const TODAY = "app/instructor/InstructorTodayScheduleCard.tsx";
const SELECTOR = "app/instructor/InstructorScheduleCourseSelector.tsx";
const CONTACTS = "app/instructor/InstructorCourseScopedContactsSection.tsx";
const CORE = "lib/course/instructor-default-schedule-offering-core.ts";

/** Collapses runs of whitespace so an assertion is not hostage to formatting. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// (7)(8) The conditional default, synchronous, identical in both surfaces.
// ---------------------------------------------------------------------------

const CONDITIONAL_DEFAULT = 'canEditRidingNotes ? "unified" : "byCourse"';

test("the weekly schedule tab initializes its sub-view from canEditRidingNotes", () => {
  const body = flat(code(WEEKLY));
  assert.ok(
    body.includes(
      `const [subView, setSubView] = useState<ScheduleSubView>( ${CONDITIONAL_DEFAULT}, );`,
    ),
    "expected a lazy, synchronous conditional initializer for subView",
  );
});

test("the Today card initializes its mode from canEditRidingNotes", () => {
  const body = flat(code(TODAY));
  assert.ok(
    body.includes(
      `const [todayMode, setTodayMode] = useState<TodayScheduleMode>( ${CONDITIONAL_DEFAULT}, );`,
    ),
    "expected a lazy, synchronous conditional initializer for todayMode",
  );
});

test("weekly and Today use the SAME permission expression - identical meaning", () => {
  // The two surfaces are independent by design, but the PERMISSION must mean
  // exactly the same thing on both, so the expression is compared literally.
  assert.ok(flat(code(WEEKLY)).includes(CONDITIONAL_DEFAULT));
  assert.ok(flat(code(TODAY)).includes(CONDITIONAL_DEFAULT));
});

test("both surfaces receive the permission as a declared boolean prop", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = code(file);
    assert.match(body, /canEditRidingNotes,/, `${file} must destructure the prop`);
    assert.match(body, /canEditRidingNotes: boolean;/, `${file} must type the prop`);
  }
});

// ---------------------------------------------------------------------------
// (9) No effect ever re-writes the mode -> a manual toggle is never overridden.
// ---------------------------------------------------------------------------

test("no useEffect in either surface writes the mode", () => {
  const weekly = code(WEEKLY);
  assert.equal(
    weekly.includes("useEffect("),
    false,
    "the weekly surface needs no effect at all",
  );

  const today = code(TODAY);
  // The Today card keeps exactly one pre-existing effect (range reporting).
  const starts = [...today.matchAll(/useEffect\(/g)].map((m) => m.index!);
  assert.equal(starts.length, 1, "the Today card must keep exactly one effect");
  // Bound the effect body at its own dependency-array terminator so the JSX
  // below (which legitimately calls setTodayMode from the toggle buttons) is
  // not scanned as if it were inside the effect.
  const body = today.slice(starts[0], today.indexOf("}, [", starts[0]));
  assert.equal(body.includes("setTodayMode"), false, "no effect may write todayMode");
  assert.equal(
    body.includes("setSelectedOfferingId"),
    false,
    "no effect may write the course selection either",
  );
});

test("the mode setters are called only by the toggle buttons", () => {
  // Two onClick handlers per surface, and nowhere else.
  assert.equal((code(WEEKLY).match(/setSubView\(/g) ?? []).length, 2);
  assert.equal((code(TODAY).match(/setTodayMode\(/g) ?? []).length, 2);
  for (const file of [WEEKLY, TODAY]) {
    const setter = file === WEEKLY ? "setSubView" : "setTodayMode";
    for (const call of code(file).split(`${setter}(`).slice(1)) {
      assert.ok(
        /^"(unified|byCourse)"\)/.test(call),
        `every ${setter} call must be a direct toggle to a literal mode`,
      );
    }
  }
});

test("both sub-views remain reachable for every instructor - neither is removed", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = source(file);
    assert.ok(body.includes('הלו&quot;ז המשולב שלי'), `${file} must keep the unified option`);
    assert.ok(body.includes("לפי קורס"), `${file} must keep the per-course option`);
    // The permission must never gate which buttons render.
    assert.equal(
      /canEditRidingNotes\s*&&/.test(code(file)),
      false,
      `${file} must not conditionally render anything on the permission`,
    );
  }
});

// ---------------------------------------------------------------------------
// (10) The automatic course selection is latched AND null-guarded.
// ---------------------------------------------------------------------------

test("each surface latches the automatic selection with a ref and a null guard", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = flat(code(file));
    assert.ok(
      body.includes("const autoSelectedRef = useRef(false);"),
      `${file} must hold the latch in a ref, not in state`,
    );
    assert.ok(
      body.includes("if (autoSelectedRef.current) return; autoSelectedRef.current = true;"),
      `${file} must return early once the latch has fired`,
    );
    assert.ok(
      body.includes(
        "setSelectedOfferingId((prev) => prev ?? pickInstructorDefaultOfferingId(options));",
      ),
      `${file} must keep an existing manual selection via the prev ?? guard`,
    );
  }
});

test("setSelectedOfferingId is written from exactly two places per surface", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = code(file);
    // Exactly three mentions: the useState declaration, the selector's
    // onSelectOffering wiring (a manual pick), and the guarded one-shot handler.
    assert.equal(
      (body.match(/setSelectedOfferingId/g) ?? []).length,
      3,
      `${file} must not reference the selection setter anywhere else`,
    );
    // ...and exactly ONE direct invocation, which is the guarded handler.
    const invocations = body.match(/setSelectedOfferingId\(/g) ?? [];
    assert.equal(invocations.length, 1, `${file} must invoke the setter exactly once`);
    assert.match(body, /onSelectOffering=\{setSelectedOfferingId\}/);
    assert.match(body, /onOptionsLoaded=\{handleOptionsLoaded\}/);
  }
});

test("the handler is useCallback-stable so the selector never re-fetches", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = flat(code(file));
    assert.ok(
      body.includes("const handleOptionsLoaded = useCallback("),
      `${file} must memoise the callback`,
    );
    assert.ok(body.includes("}, []);"), `${file}'s callback must have empty deps`);
  }
});

test("the default is computed by the shared PURE core, not inline", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = code(file);
    assert.match(
      body,
      /import \{ pickInstructorDefaultOfferingId \} from "@\/lib\/course\/instructor-default-schedule-offering-core";/,
      `${file} must use the shared core`,
    );
    // No level/label reasoning may be re-implemented in the component.
    assert.equal(/\.level/.test(body), false, `${file} must not inspect option.level itself`);
    assert.equal(/\.label/.test(body), false, `${file} must not inspect option.label`);
    assert.equal(/options\[0\]/.test(body), false, `${file} must not pick by array position`);
  }
});

// ---------------------------------------------------------------------------
// (11) The flag is server-derived, with no extra query and no client id.
// ---------------------------------------------------------------------------

test("page.tsx derives the flag from the Actor DAL result, after the gate", () => {
  const body = code(PAGE);
  const gate = body.indexOf("const actor = await getCurrentInstructor();");
  const derive = body.indexOf("const canEditRidingNotes = actor?.canEditRidingNotes === true;");
  assert.notEqual(gate, -1, "the existing actor gate must remain");
  assert.notEqual(derive, -1, "expected the exact canonical derivation");
  assert.ok(gate < derive, "the flag must be derived AFTER the actor gate");
  assert.match(body, /canEditRidingNotes=\{canEditRidingNotes\}/, "it must be passed down");
});

test("page.tsx adds no instructor query for the flag", () => {
  const body = code(PAGE);
  assert.equal(
    (body.match(/prisma\.instructor\./g) ?? []).length,
    1,
    "only the pre-existing active-instructor roster query may remain",
  );
  assert.match(body, /prisma\.instructor\.findMany/);
  assert.equal(
    /prisma\.instructor\.findUnique/.test(body),
    false,
    "no per-actor instructor re-read may be introduced",
  );
});

test("the client shell forwards the server flag to both surfaces", () => {
  const body = code(CLIENT);
  assert.match(body, /canEditRidingNotes: boolean;/, "the prop must be typed");
  assert.equal(
    (body.match(/canEditRidingNotes=\{canEditRidingNotes\}/g) ?? []).length,
    2,
    "exactly the two schedule surfaces receive it",
  );
});

test("the localStorage-backed session copy is left completely untouched", () => {
  const body = code(CLIENT);
  // The pre-existing StoredSession usages keep their `session.` prefix; the new
  // prop is a separate expression and never replaces one of them.
  assert.ok(
    (body.match(/session\??\.canEditRidingNotes/g) ?? []).length >= 4,
    "the existing session-based render gating must survive verbatim",
  );
  assert.match(body, /getInstructorProfile/, "the existing profile refresh is unchanged");
});

// ---------------------------------------------------------------------------
// (12) The schedule surfaces trust no client identity.
// ---------------------------------------------------------------------------

test("neither schedule surface touches client identity or persistence", () => {
  for (const file of [WEEKLY, TODAY, SELECTOR, CORE]) {
    const body = code(file);
    for (const forbidden of [
      "getInstructorProfile",
      "session.canEditRidingNotes",
      "STORAGE_KEY",
      "localStorage",
      "instructorId",
      "document.cookie",
    ]) {
      assert.equal(
        body.includes(forbidden),
        false,
        `${file} must not reference ${forbidden}`,
      );
    }
  }
});

test("the default mode and course selection are still not persisted anywhere", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = code(file);
    assert.equal(/createContext|useContext/.test(body), false, `${file} must add no context`);
    assert.equal(/sessionStorage/.test(body), false, `${file} must add no storage`);
  }
});

// ---------------------------------------------------------------------------
// (13)(14) Authorization is untouched; the permission is only READ.
// ---------------------------------------------------------------------------

test("the riding-note write gates are byte-for-byte unchanged", () => {
  assert.match(
    code("lib/actions/riding-slots-write-auth.ts"),
    /if \(!instructor \|\| !instructor\.canEditRidingNotes\) \{/,
    "the riding-lesson-note write gate must remain",
  );
  assert.match(
    code("lib/actions/riding-slot-complex-auth.ts"),
    /if \(!actor \|\| actor\.canEditRidingNotes !== true\) \{/,
    "the complex-plan write gate must remain",
  );
  assert.match(
    code("lib/auth/actor.ts"),
    /canEditRidingNotes: true,/,
    "the Actor DAL projection must remain",
  );
});

test("the schedule surfaces only READ the flag - no second permission derivation", () => {
  for (const file of [WEEKLY, TODAY]) {
    const body = code(file);
    assert.equal(
      /canEditRidingNotes\s*=[^=]/.test(body),
      false,
      `${file} must never assign or re-derive the permission`,
    );
    assert.equal(
      /prisma|findUnique|isActive/.test(body),
      false,
      `${file} must not re-read an instructor row`,
    );
  }
});

// ---------------------------------------------------------------------------
// (15) The shared selector stays a menu; contacts is untouched.
// ---------------------------------------------------------------------------

test("the selector's new callback is optional and fires only on success", () => {
  const body = code(SELECTOR);
  assert.match(
    body,
    /onOptionsLoaded\?: \(options: InstructorCourseOptionView\[\]\) => void;/,
    "the callback must be optional",
  );
  const flatBody = flat(body);
  assert.ok(
    flatBody.includes("setOptions(result); onOptionsLoadedRef.current?.(result);"),
    "it must fire after a successful load, from the success branch",
  );
  const catchBranch = flatBody.slice(flatBody.indexOf(".catch("));
  assert.equal(
    catchBranch.includes("onOptionsLoaded"),
    false,
    "a failed load must never invoke the callback",
  );
});

test("the selector still issues exactly one options request per mount", () => {
  const flatBody = flat(code(SELECTOR));
  assert.equal(
    (flatBody.match(/listInstructorContactCourseOptions\(\)/g) ?? []).length,
    1,
    "one request only",
  );
  assert.ok(
    flatBody.includes("return () => { cancelled = true; }; }, []);"),
    "the load effect must keep an empty dependency array",
  );
});

test("the selector itself still selects nothing", () => {
  const body = code(SELECTOR);
  // onSelectOffering is invoked only from a user click.
  const calls = body.split("onSelectOffering(").slice(1);
  assert.equal(calls.length, 1, "exactly one call site");
  assert.match(body, /onClick=\{\(\) => onSelectOffering\(option\.id\)\}/);
  assert.equal(
    body.includes("pickInstructorDefaultOfferingId"),
    false,
    "the default policy must not live in the shared menu",
  );
});

test("the CONTACTS surface gains no default selection", () => {
  const body = code(CONTACTS);
  assert.equal(
    body.includes("InstructorScheduleCourseSelector"),
    false,
    "contacts keeps its own separate selector",
  );
  assert.equal(
    body.includes("pickInstructorDefaultOfferingId"),
    false,
    "contacts must keep the original no-default rule",
  );
  assert.equal(
    body.includes("canEditRidingNotes"),
    false,
    "contacts must not consume the riding-notes permission",
  );
});

// ---------------------------------------------------------------------------
// The two surfaces stay independent (pre-existing invariant, re-locked here).
// ---------------------------------------------------------------------------

test("weekly and Today keep separate selection and latch state", () => {
  const client = code(CLIENT);
  assert.equal(
    /selectedOfferingId|courseOfferingId|autoSelectedRef/.test(client),
    false,
    "no selection or latch state may be lifted into the shell",
  );
  for (const file of [WEEKLY, TODAY]) {
    assert.match(code(file), /const \[selectedOfferingId, setSelectedOfferingId\] = useState<string \| null>\(null\);/);
  }
});
