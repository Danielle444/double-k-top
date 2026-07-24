/**
 * LEVEL 2 SCHEDULE SLICE S1A - wiring + ordering contract tests for the
 * COURSE-SCOPED trainee schedule read path.
 *
 * lib/actions/student-schedule.ts and lib/actions/weekly-schedule.ts are
 * "use server" modules that transitively import Prisma and next/cache, so they
 * cannot be imported into a plain `tsx --test` process the way a pure DI
 * orchestration can. The BEHAVIOUR of every gate is therefore tested against the
 * pure core in lib/course/course-scoped-week-options-core.test.ts; this file uses
 * the repository's established SOURCE-CONTRACT pattern (same convention as
 * schedule-writer-auth.contract.test.ts and
 * contacts.instructor-directory.test.ts's signature assertions) to prove that the
 * real actions are wired to that core, in the right order, with no client course
 * context and no Level 1 fallback.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/actions/student-schedule.course-scope.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const studentScheduleSrc = readSource("./student-schedule.ts");
const weeklyScheduleSrc = readSource("./weekly-schedule.ts");
const studentClientSrc = readSource("../../app/student/StudentClient.tsx");
const scheduleSectionSrc = readSource("../../app/student/ScheduleSection.tsx");

/**
 * Extract a single function's source: from its `export async function NAME(`
 * signature up to its OWN closing brace at column 0.
 *
 * Deliberately tighter than the `next top-level export` window used by
 * schedule-writer-auth.contract.test.ts: that window also swallows any trailing
 * comment block belonging to the NEXT declaration, which would make a token
 * assertion on one function silently read the neighbouring documentation.
 */
function functionSource(src: string, name: string): string {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const end = src.indexOf("\n}", start + sigMarker.length);
  assert.notEqual(end, -1, `unterminated function body for ${name}`);
  return src.slice(start, end + 2);
}

/** The declared parameter list of `export async function NAME(...)`. */
function parameterList(src: string, name: string): string[] {
  const sigMarker = `export async function ${name}(`;
  const start = src.indexOf(sigMarker);
  assert.notEqual(start, -1, `expected to find ${name} in source`);
  const open = start + sigMarker.length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  assert.notEqual(close, -1, `unbalanced parameter list for ${name}`);
  const raw = src.slice(open + 1, close);
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Index of `needle` in `body`, asserted present. */
function requiredIndex(body: string, needle: string, label: string): number {
  const i = body.indexOf(needle);
  assert.notEqual(i, -1, `${label}: expected to find \`${needle}\``);
  return i;
}

// ===========================================================================
// getScheduleForStudent - the first four parameters are unchanged; the fifth is
// an OPTIONAL course REQUEST.
//
// SUPERSEDED BY L2-DUAL: this section previously asserted "exactly four
// parameters" and "no parameter may name a course", i.e. a trainee could never
// state which course they meant. That is deliberately reversed for SCHEDULE and
// CONTACTS only. The replacement contract asserted here is that the new parameter
// is OPTIONAL (so every existing four-argument call keeps working), that it is a
// course request and NOT an identity, and that it is re-resolved server-side
// against the trainee's own ACTIVE enrollments before anything is read. The
// behaviour of that re-resolution is proved DB-free in
// lib/course/trainee-course-selection-core.test.ts.
// ===========================================================================

test("getScheduleForStudent keeps its four original parameters, in order", () => {
  const params = parameterList(studentScheduleSrc, "getScheduleForStudent");
  assert.equal(params.length, 5, `expected 5 parameters, got: ${JSON.stringify(params)}`);
  assert.ok(params[0].startsWith("studentId"));
  assert.ok(params[1].startsWith("weeklyScheduleId"));
  assert.ok(params[2].startsWith("dayKey"));
  assert.ok(params[3].startsWith("groupFilter"));
});

test("the fifth parameter is an OPTIONAL course request - four-argument callers still work", () => {
  const params = parameterList(studentScheduleSrc, "getScheduleForStudent");
  assert.match(
    params[4],
    /^requestedCourseOfferingId\?: string \| null$/,
    "the course request must be optional, so omitting it stays the single-course path",
  );
});

test("no parameter of getScheduleForStudent can name an ACTOR", () => {
  // Course context became statable; IDENTITY did not. studentId is a pre-existing
  // legacy display-filter value that authorizes nothing (the session is the sole
  // identity source), and no new actor parameter may appear beside it.
  for (const param of parameterList(studentScheduleSrc, "getScheduleForStudent").slice(1)) {
    assert.ok(
      !/traineeId|instructorId|identityNumber|actor/i.test(param),
      `parameter "${param}" must not accept a client-supplied identity`,
    );
  }
});

// ===========================================================================
// getScheduleForStudent - server-derived course context, no legacy resolver.
// ===========================================================================

test("student-schedule.ts wires BOTH trainee resolvers and never resolveCurrentCourseOffering", () => {
  // SUPERSEDED BY L2-DUAL: this file now legitimately imports two resolvers, and
  // they must stay distinct. The SELECTION resolver serves the course-switchable
  // schedule read; the committed no-argument resolver still serves the DUTIES
  // deps in the same file, which keep failing closed for a dual-enrolled trainee.
  assert.match(
    studentScheduleSrc,
    /import\s*\{[^}]*\bresolveTraineeCourseOffering\b[^}]*\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/,
    "must still import the committed no-argument trainee resolver (for duties)",
  );
  assert.match(
    studentScheduleSrc,
    /import\s*\{[^}]*\bresolveTraineeSelectedCourseOffering\b[^}]*\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/,
    "must import the selection resolver (for the schedule read)",
  );
  assert.ok(
    !studentScheduleSrc.includes("resolveCurrentCourseOffering"),
    "the migrated trainee read path must never use the legacy singleton resolver",
  );
});

test("the DUTIES module keeps the single-course resolver - L2-DUAL did not touch it", () => {
  // The containment guarantee, asserted at the one place both resolvers coexist:
  // duties must never receive the requested course id.
  const dutiesDeps = studentScheduleSrc.slice(
    studentScheduleSrc.indexOf("const TRAINEE_DUTIES_DEPS"),
    studentScheduleSrc.indexOf("export async function getStudentDutiesForRange"),
  );
  assert.ok(dutiesDeps.length > 0, "expected the duties deps declaration");
  assert.match(dutiesDeps, /^\s*resolveTraineeCourseOffering,$/m, "must stay the bare 0-arg dep");
  assert.ok(
    !dutiesDeps.includes("resolveTraineeSelectedCourseOffering"),
    "duties must never accept a requested course",
  );
  assert.ok(
    !parameterList(studentScheduleSrc, "getStudentDutiesForRange").some((p) =>
      /courseOffering/i.test(p),
    ),
    "getStudentDutiesForRange must not gain a course parameter",
  );
});

test("student-schedule.ts has no Level 1 fallback and infers nothing about the course", () => {
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
    "resolveCurrentCourseOffering",
    "current-offering",
    "courseSettings",
    "CourseSettings",
  ]) {
    assert.ok(
      !studentScheduleSrc.includes(forbidden),
      `student-schedule.ts must not reference "${forbidden}"`,
    );
  }
});

test("the course context is resolved INDEPENDENTLY inside getScheduleForStudent", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  assert.match(
    body,
    /authorizeTraineeWeekReadWithDeps\(\s*weeklyScheduleId\s*,\s*\{/,
    "the gate must be invoked with the requested week id",
  );
  // SUPERSEDED BY L2-DUAL: the injected dep used to be the bare 0-arg resolver.
  // It is now a bound 0-arg CLOSURE over the requested id. The shared gate core is
  // therefore unchanged - it still receives a zero-argument function and cannot be
  // handed a client value - while the request is re-resolved inside the closure.
  assert.match(
    body,
    /resolveTraineeCourseOffering:\s*\(\)\s*=>\s*\n?\s*resolveTraineeSelectedCourseOffering\(requestedCourseOfferingId\)/,
    "the selection resolver must be injected, closed over the requested id",
  );
  assert.match(body, /getEffectiveCapabilities,/, "the real capability reader must be injected");
});

test("the requested course id is never used as a query key or a week filter", () => {
  const signatureAndBody = functionSource(studentScheduleSrc, "getScheduleForStudent");
  // Excludes the parameter declaration itself - the first `{` opens the body.
  const body = signatureAndBody.slice(signatureAndBody.indexOf("{"));
  // Inside the body it may appear EXACTLY once, as the argument to the resolver.
  // Anywhere else (a where clause, a comparison, a returned field) would make the
  // raw client value authoritative.
  const uses = body.match(/requestedCourseOfferingId/g) ?? [];
  assert.equal(uses.length, 1, "the raw request must reach nothing but the resolver");
  assert.ok(
    !/where:[\s\S]{0,200}requestedCourseOfferingId/.test(body),
    "the requested id must never enter a Prisma where clause",
  );
});

// ===========================================================================
// getScheduleForStudent - authorization strictly precedes every content read.
// ===========================================================================

test("the authorization gate precedes the ScheduleItem query and the publication reader", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");

  const gate = requiredIndex(body, "await authorizeTraineeWeekReadWithDeps(", "getScheduleForStudent");
  const guard = requiredIndex(
    body,
    "if (!authorization.authorized) return emptyStudentScheduleResult();",
    "getScheduleForStudent",
  );
  const items = requiredIndex(body, "prisma.scheduleItem.findMany(", "getScheduleForStudent");
  const publications = requiredIndex(
    body,
    "getPublishedComplexRidingPlansForStudentInternal(",
    "getScheduleForStudent",
  );

  assert.ok(gate < guard, "the deny-guard must follow the gate call");
  assert.ok(
    guard < items,
    "no ScheduleItem may be queried before the authorization guard returns",
  );
  assert.ok(
    guard < publications,
    "the nested publication reader must never run before the authorization guard",
  );
});

test("the week header fetch selects only the authorization columns - it never includes items", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  assert.match(
    body,
    /prisma\.weeklySchedule\.findUnique\(\{\s*where:\s*\{\s*id\s*\}\s*,\s*select:\s*TRAINEE_WEEK_META_SELECT\s*\}\)/,
    "the header fetch must use the narrow meta projection",
  );
  // The pre-S1A shape nested the entire item tree onto the week fetch. That
  // nesting is exactly what would load another course's items before any check.
  const headerFetch = body.indexOf("prisma.weeklySchedule.findUnique(");
  const itemsQuery = body.indexOf("prisma.scheduleItem.findMany(");
  assert.ok(headerFetch !== -1 && itemsQuery !== -1);
  assert.ok(
    headerFetch < itemsQuery,
    "the header fetch and the item query must be two separate, ordered reads",
  );
  assert.ok(
    !/findUnique\([\s\S]{0,400}?include:\s*\{\s*items:/.test(body),
    "the week fetch must not include items",
  );
});

test("every denial path returns the same uniform empty result", () => {
  const body = functionSource(studentScheduleSrc, "getScheduleForStudent");
  const returns = body.match(/return emptyStudentScheduleResult\(\);/g) ?? [];
  assert.ok(returns.length >= 2, "unknown student and unauthorized week both return the empty result");
  // No denial constructs a distinguishable payload of its own.
  assert.ok(
    !/return \{ hasSchedule: false/.test(body),
    "denials must go through the single empty-result helper",
  );
  assert.match(
    studentScheduleSrc,
    /function emptyStudentScheduleResult\(\): StudentScheduleResult \{\s*return \{ hasSchedule: false, weekName: null, items: \[\] \};/,
    "the empty result must stay byte-identical to the pre-S1A empty result",
  );
});

test("the pre-existing publication guard is preserved (now inside the shared gate)", () => {
  const coreSrc = readSource("../course/course-scoped-week-options-core.ts");
  assert.match(
    coreSrc,
    /return week\.isPublished === true;/,
    "the trainee final-read predicate must still require a published week",
  );
});

// ===========================================================================
// getWeeklyScheduleSelectionForTrainee - the new, course-scoped week picker.
// ===========================================================================

// SUPERSEDED BY L2-DUAL: this used to assert a zero-parameter picker. It now takes
// the same OPTIONAL course request as the schedule read, so the week list follows
// the selected course. No student id, and still nothing else.
test("getWeeklyScheduleSelectionForTrainee takes only the optional course request", () => {
  assert.deepEqual(parameterList(weeklyScheduleSrc, "getWeeklyScheduleSelectionForTrainee"), [
    "requestedCourseOfferingId?: string | null",
  ]);
});

test("getWeeklyScheduleSelectionForTrainee wires the trainee resolver, capabilities and the pure core", () => {
  const body = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelectionForTrainee");
  assert.match(body, /loadTraineeWeeklyScheduleSelectionWithDeps\(\{/);
  assert.match(
    body,
    /resolveTraineeCourseOffering:\s*\(\)\s*=>\s*\n?\s*resolveTraineeSelectedCourseOffering\(requestedCourseOfferingId\)/,
  );
  assert.match(body, /getEffectiveCapabilities,/);
  assert.match(body, /prisma\.weeklySchedule\.findMany\(query\)/);
  assert.match(body, /todayDateKey,/);
  // No hand-rolled where clause: the query shape comes only from the pure core.
  assert.ok(
    !body.includes("where:"),
    "the action must not build its own where clause - buildTraineeWeekOptionsQuery owns it",
  );
  assert.ok(!body.includes("resolveCurrentCourseOffering"));
});

test("weekly-schedule.ts imports the trainee SELECTION resolver, not the legacy singleton one", () => {
  assert.match(
    weeklyScheduleSrc,
    /import\s*\{\s*resolveTraineeSelectedCourseOffering\s*\}\s*from\s*["']@\/lib\/course\/actor-course-offering["']/,
  );
  assert.ok(!weeklyScheduleSrc.includes("resolveCurrentCourseOffering"));
  for (const forbidden of ["LEVEL_1_COURSE_OFFERING_ID", "temporary-level2-compatibility"]) {
    assert.ok(!weeklyScheduleSrc.includes(forbidden), `no ${forbidden} fallback may appear`);
  }
});

// ===========================================================================
// The legacy readers were NOT re-scoped by this slice.
// ===========================================================================

test("listWeeklyScheduleOptions is untouched: still global, still unfiltered", () => {
  const body = functionSource(weeklyScheduleSrc, "listWeeklyScheduleOptions");
  assert.ok(!body.includes("where:"), "must remain unfiltered (admin surfaces depend on it)");
  assert.ok(!body.includes("courseOfferingId"));
});

test("listPublishedWeeklyScheduleOptions is untouched: still published-only, still global", () => {
  const body = functionSource(weeklyScheduleSrc, "listPublishedWeeklyScheduleOptions");
  assert.match(body, /where: \{ isPublished: true \}/);
  assert.ok(!body.includes("courseOfferingId"));
});

test("the two legacy selection readers still delegate to the legacy list readers", () => {
  const legacy = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelection");
  const legacyStudent = functionSource(weeklyScheduleSrc, "getWeeklyScheduleSelectionForStudent");
  assert.match(legacy, /await listWeeklyScheduleOptions\(\)/);
  assert.match(legacyStudent, /await listPublishedWeeklyScheduleOptions\(\)/);
  for (const body of [legacy, legacyStudent]) {
    assert.ok(!body.includes("courseOfferingId"));
    assert.ok(!body.includes("getEffectiveCapabilities"));
    assert.match(body, /pickDefaultWeekId\(weeks, todayDateKey\(\)\)/);
  }
});

test("pickDefaultWeekId has ONE implementation, imported from the pure core", () => {
  assert.ok(
    !/function pickDefaultWeekId/.test(weeklyScheduleSrc),
    "weekly-schedule.ts must not keep a second, drifting copy",
  );
  assert.ok(
    !/function daysBetweenKeys/.test(weeklyScheduleSrc),
    "its helper moved with it",
  );
  assert.match(
    weeklyScheduleSrc,
    /import \{[\s\S]*?pickDefaultWeekId,[\s\S]*?\} from "@\/lib\/course\/course-scoped-week-options-core"/,
  );
});

// ===========================================================================
// StudentClient - the only UI change is the swapped week-picker call.
// ===========================================================================

test("StudentClient calls getWeeklyScheduleSelectionForTrainee with the selected course", () => {
  assert.match(
    studentClientSrc,
    /import \{ getWeeklyScheduleSelectionForTrainee \} from "@\/lib\/actions\/weekly-schedule"/,
  );
  // SUPERSEDED BY L2-DUAL: previously a literal no-argument call.
  assert.match(
    studentClientSrc,
    /getWeeklyScheduleSelectionForTrainee\(selectedCourseOfferingId\)\.then\(\(sel\) => \{/,
  );
  assert.ok(
    !studentClientSrc.includes("getWeeklyScheduleSelectionForStudent"),
    "the trainee app must no longer use the globally-scoped picker",
  );
});

test("the trainee client's course context is server-supplied and never a constant", () => {
  // SUPERSEDED BY L2-DUAL: the client may now hold a courseOfferingId, but ONLY a
  // value the server handed it. It must never contain a hardcoded offering, and it
  // must never derive one from a level, a name or a date.
  for (const forbidden of [
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
    "cmrqngqhn00017gcndjixzrh0",
    "cmrxk58vc0000lscnfm54bpze",
  ]) {
    assert.ok(
      !studentClientSrc.includes(forbidden),
      `StudentClient must not reference "${forbidden}"`,
    );
  }
  // The only source of options and of the default selection is the server action.
  assert.match(
    studentClientSrc,
    /import \{\s*listTraineeCourseOptions,[\s\S]*?\} from "@\/lib\/actions\/trainee-course-selection"/,
  );
  assert.match(studentClientSrc, /setSelectedCourseOfferingId\(\(previous\) =>/);
});

test("the trainee course selection is never persisted anywhere", () => {
  // React state only. A persisted selection could outlive the session or be edited
  // in devtools and replayed, which is precisely what must stay impossible.
  assert.ok(!/localStorage[^\n]*[Cc]ourse/.test(studentClientSrc));
  assert.ok(!/document\.cookie/.test(studentClientSrc));
  assert.ok(!studentClientSrc.includes("sessionStorage"));
});

test("the existing loading and empty-state behaviour is preserved", () => {
  // Same state assignments from the same result shape...
  assert.match(studentClientSrc, /setWeeks\(sel\.weeks\);/);
  assert.match(studentClientSrc, /setSelectedWeekId\(sel\.defaultWeekId\);/);
  assert.match(
    studentClientSrc,
    /const defaultWeek = sel\.weeks\.find\(\(w\) => w\.id === sel\.defaultWeekId\) \?\? null;/,
  );
  // ...and the `weeks === null` loading branches are untouched.
  assert.ok(
    (studentClientSrc.match(/weeks === null/g) ?? []).length >= 2,
    "the loading branches must be preserved",
  );
});

test("ScheduleSection gained the course prop and nothing else", () => {
  // SUPERSEDED BY L2-DUAL: ScheduleSection previously could not carry a course
  // prop. The three original props are unchanged and the fourth is the requested
  // course, forwarded verbatim as the fifth action argument.
  assert.match(
    scheduleSectionSrc,
    /studentId: string;\s*weeklyScheduleId: string \| null;\s*dayFilter: string \| "all";\s*courseOfferingId: string \| null;/,
  );
  assert.match(
    scheduleSectionSrc,
    /getScheduleForStudent\(studentId, weeklyScheduleId, dayFilter, groupFilter, courseOfferingId\)/,
    "the original four arguments keep their order and meaning",
  );
  // Re-fetching on a course switch is what makes the switch take effect at all.
  assert.match(
    scheduleSectionSrc,
    /\[studentId, weeklyScheduleId, dayFilter, groupFilter, courseOfferingId\]/,
  );
});
