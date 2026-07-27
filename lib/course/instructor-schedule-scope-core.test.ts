/**
 * LEVEL 2 SCHEDULE SLICE S2A - focused tests for the PURE course-scoped
 * INSTRUCTOR schedule core (./instructor-schedule-scope-core).
 *
 * Everything here runs against plain fakes: no Next.js cookies, no live Prisma,
 * no React. They lock the S2A contract:
 *  - identity is ALWAYS the injected session boundary and is the FIRST awaited
 *    operation; no instructor id is accepted anywhere;
 *  - the requested offering is re-validated and only the RESOLVED id reaches a
 *    query;
 *  - SCHEDULE must be positively ENABLED for that exact resolved offering;
 *  - every week query carries courseOfferingId, the by-id read uses a COMPOSITE
 *    where, and the today read is offering-scoped before it is date-scoped;
 *  - instructors still see UNPUBLISHED weeks (no isPublished predicate anywhere);
 *  - every authorization denial yields the SAME empty result, while real defects
 *    propagate;
 *  - the "mine"/meal filter behaviour is unchanged by the move out of
 *    lib/actions/instructor-schedule.ts.
 *
 * IUS-1 EXTENSION: three additive projection fields (week-level isPublished
 * stamped per item, a verbatim combinedParticipation tri-state, and the
 * server-resolved courseLevel) are proven to reach the view WITHOUT touching
 * any filter, predicate or gate. Every S2A assertion above still runs unchanged.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/instructor-schedule-scope-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  INSTRUCTOR_SCHEDULE_CAPABILITY_KEY,
  INSTRUCTOR_WEEK_OPTION_SELECT,
  buildInstructorTodayWeekQuery,
  buildInstructorWeekOptionsQuery,
  buildInstructorWeekReadQuery,
  emptyInstructorScheduleResult,
  emptyInstructorWeekSelection,
  isInstructorMatch,
  isInstructorScheduleCapabilityEnabled,
  isInstructorScheduleDenial,
  isMealItem,
  loadInstructorScheduleWithDeps,
  loadInstructorTodayScheduleWithDeps,
  loadInstructorWeekSelectionWithDeps,
  normalizeHebrewName,
  toInstructorScheduleResult,
  toInstructorWeekOptions,
  type InstructorScheduleReadDeps,
  type InstructorTodayScheduleDeps,
  type InstructorWeekSelectionDeps,
  type InstructorWeekWithItemsRow,
} from "./instructor-schedule-scope-core";
import {
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  MissingInstructorCourseOfferingIdError,
} from "./actor-course-offering-core";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import { isTraineeScheduleCapabilityEnabled } from "./course-scoped-week-options-core";
import { CAPABILITY_KEYS, type CapabilityKey } from "./capabilities/capability-keys";
import type { EffectiveCapabilityStatus } from "./capabilities/effective-capability-core";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

/** The DB-backed levels the fake resolver reports for the two ids above. */
const L1_LEVEL = 1;
const L2_LEVEL = 2;

const INSTRUCTOR = { firstName: "דנה", fullName: "דנה כהן" };

/**
 * The fake offering resolver. Mirrors the real binding's shape - it returns the
 * RESOLVED row's id AND its DB-backed level, never a level derived from a name
 * or from the requested string's shape.
 */
function resolvedOffering(id: string): { id: string; level: number } {
  return { id, level: id === L2 ? L2_LEVEL : L1_LEVEL };
}

function allCapabilities(
  status: EffectiveCapabilityStatus,
): Record<CapabilityKey, EffectiveCapabilityStatus> {
  return Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, status])) as Record<
    CapabilityKey,
    EffectiveCapabilityStatus
  >;
}

/** Records the order in which the injected boundaries were touched. */
function tracer() {
  const calls: string[] = [];
  return { calls, note: (label: string) => calls.push(label) };
}

function weekRow(overrides: Partial<InstructorWeekWithItemsRow> = {}): InstructorWeekWithItemsRow {
  return {
    id: "week-1",
    name: "שבוע א",
    // IUS-1 - the week-level publication state. Defaults to an UNPUBLISHED
    // (draft) week on purpose: instructors have always been able to see drafts,
    // so the default fixture must exercise that path rather than hide it.
    isPublished: false,
    items: [
      {
        id: "item-1",
        date: new Date("2026-07-20T00:00:00.000Z"),
        startTime: "09:00",
        endTime: "10:00",
        title: "רכיבה",
        description: null,
        groupName: "א",
        instructorName: "דנה",
        location: "מגרש",
        combinedParticipation: null,
      },
      {
        id: "item-2",
        date: new Date("2026-07-21T00:00:00.000Z"),
        startTime: "12:00",
        endTime: "13:00",
        title: "א. צהריים",
        description: null,
        groupName: null,
        instructorName: "יוסי",
        location: null,
        combinedParticipation: null,
      },
    ],
    ...overrides,
  };
}

/**
 * A week whose three items carry the three distinct combinedParticipation
 * values, so one mapping can prove all of them - including that `false`
 * survives as `false`.
 */
function triStateWeekRow(isPublished: boolean): InstructorWeekWithItemsRow {
  const date = new Date("2026-07-20T00:00:00.000Z");
  const base = {
    date,
    title: "רכיבה",
    description: null,
    groupName: "א",
    instructorName: "דנה",
    location: null,
  };
  return {
    id: "week-tri",
    name: "שבוע משולב",
    isPublished,
    items: [
      { ...base, id: "combined-true", startTime: "09:00", endTime: "10:00", combinedParticipation: true },
      { ...base, id: "combined-false", startTime: "10:00", endTime: "11:00", combinedParticipation: false },
      { ...base, id: "combined-null", startTime: "11:00", endTime: "12:00", combinedParticipation: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// Capability gate
// ---------------------------------------------------------------------------

test("SCHEDULE is the capability key, and only ENABLED authorizes", () => {
  assert.equal(INSTRUCTOR_SCHEDULE_CAPABILITY_KEY, "SCHEDULE");
  assert.equal(isInstructorScheduleCapabilityEnabled(allCapabilities("ENABLED")), true);
  assert.equal(isInstructorScheduleCapabilityEnabled(allCapabilities("READ_ONLY")), false);
  assert.equal(isInstructorScheduleCapabilityEnabled(allCapabilities("DISABLED")), false);
  // Missing row / partial map / absent map all deny rather than throw.
  assert.equal(isInstructorScheduleCapabilityEnabled({}), false);
  assert.equal(isInstructorScheduleCapabilityEnabled(null), false);
  assert.equal(isInstructorScheduleCapabilityEnabled(undefined), false);
  assert.equal(
    isInstructorScheduleCapabilityEnabled({ SCHEDULE: "nonsense" as EffectiveCapabilityStatus }),
    false,
  );
});

test("the instructor predicate is equivalent to the committed trainee one", () => {
  for (const status of ["ENABLED", "READ_ONLY", "DISABLED"] as const) {
    const map = allCapabilities(status);
    assert.equal(
      isInstructorScheduleCapabilityEnabled(map),
      isTraineeScheduleCapabilityEnabled(map),
      `divergence at ${status}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Denial classification
// ---------------------------------------------------------------------------

test("only authorization failures are denials; real defects propagate", () => {
  assert.equal(isInstructorScheduleDenial(new UnauthenticatedActorError("no")), true);
  assert.equal(isInstructorScheduleDenial(new MissingInstructorCourseOfferingIdError()), true);
  assert.equal(isInstructorScheduleDenial(new InstructorCourseOfferingNotAllowedError(L2)), true);
  // A configured-but-missing offering is a real defect, not "no weeks".
  assert.equal(
    isInstructorScheduleDenial(new InstructorCourseOfferingUnavailableError(L2, "missing")),
    false,
  );
  assert.equal(isInstructorScheduleDenial(new Error("prisma exploded")), false);
});

// ---------------------------------------------------------------------------
// Query shapes
// ---------------------------------------------------------------------------

test("the week option query is scoped to ONE offering and has NO isPublished predicate", () => {
  const query = buildInstructorWeekOptionsQuery(L2);
  assert.deepEqual(query, {
    where: { courseOfferingId: L2 },
    orderBy: { startDate: "asc" },
    select: INSTRUCTOR_WEEK_OPTION_SELECT,
  });
  // Instructors must keep seeing unpublished weeks - the pre-existing behaviour.
  assert.equal("isPublished" in query.where, false);
  assert.deepEqual(Object.keys(query.where), ["courseOfferingId"]);
});

test("the by-id week read is a COMPOSITE where (id AND courseOfferingId)", () => {
  const query = buildInstructorWeekReadQuery("week-9", L1);
  assert.deepEqual(query.where, { id: "week-9", courseOfferingId: L1 });
  assert.equal("isPublished" in query.where, false);
});

test("the today week read is offering-scoped before it is date-scoped", () => {
  const query = buildInstructorTodayWeekQuery(L2, "2026-07-24");
  assert.equal(query.where.courseOfferingId, L2);
  assert.deepEqual(query.where.startDate, { lte: new Date("2026-07-24T00:00:00.000Z") });
  assert.deepEqual(query.where.endDate, { gte: new Date("2026-07-24T00:00:00.000Z") });
  assert.equal("isPublished" in query.where, false);
});

test("a blank offering id can never produce a query", () => {
  assert.throws(() => buildInstructorWeekOptionsQuery(""), /server-resolved courseOfferingId/);
  assert.throws(() => buildInstructorWeekReadQuery("week-1", ""), /server-resolved courseOfferingId/);
  assert.throws(() => buildInstructorTodayWeekQuery("", "2026-07-24"), /server-resolved courseOfferingId/);
  assert.throws(() => buildInstructorWeekReadQuery("", L1), /non-empty weeklyScheduleId/);
});

// ---------------------------------------------------------------------------
// Mapping + the moved "mine" filter
// ---------------------------------------------------------------------------

test("week rows map to date-key options in order", () => {
  assert.deepEqual(
    toInstructorWeekOptions([
      {
        id: "w1",
        name: "שבוע א",
        startDate: new Date("2026-07-19T00:00:00.000Z"),
        endDate: new Date("2026-07-25T00:00:00.000Z"),
      },
    ]),
    [{ id: "w1", name: "שבוע א", startDate: "2026-07-19", endDate: "2026-07-25" }],
  );
});

test("the moved 'mine' helpers behave exactly as before", () => {
  assert.equal(normalizeHebrewName('  דנה,   כהן  '), "דנה כהן");
  assert.equal(isInstructorMatch("דנה, יוסי", INSTRUCTOR), true);
  assert.equal(isInstructorMatch("כולם", INSTRUCTOR), true);
  assert.equal(isInstructorMatch("יוסי", INSTRUCTOR), false);
  assert.equal(isInstructorMatch(null, INSTRUCTOR), false);
  assert.equal(isMealItem("א. צהריים"), true);
  assert.equal(isMealItem("ארוחת ערב"), true);
  assert.equal(isMealItem("רכיבה"), false);
});

test("'mine' keeps my lessons and meals; 'all' keeps everything; dayKey narrows", () => {
  const mine = toInstructorScheduleResult(weekRow(), "all", "mine", INSTRUCTOR, L1_LEVEL);
  assert.deepEqual(mine.items.map((i) => i.id), ["item-1", "item-2"]);

  const other = toInstructorScheduleResult(
    weekRow(),
    "all",
    "mine",
    { firstName: "רוני", fullName: "רוני לוי" },
    L1_LEVEL,
  );
  // Not their lesson, but the meal still shows.
  assert.deepEqual(other.items.map((i) => i.id), ["item-2"]);

  const oneDay = toInstructorScheduleResult(weekRow(), "2026-07-20", "all", INSTRUCTOR, L1_LEVEL);
  assert.deepEqual(oneDay.items.map((i) => i.id), ["item-1"]);
  assert.equal(oneDay.weekName, "שבוע א");
  assert.equal(oneDay.hasSchedule, true);
});

// ---------------------------------------------------------------------------
// IUS-1 - additive projection: week isPublished, combinedParticipation, courseLevel
// ---------------------------------------------------------------------------

test("IUS-1: an UNPUBLISHED week stamps isPublished=false onto EVERY returned item", () => {
  const result = toInstructorScheduleResult(
    triStateWeekRow(false),
    "all",
    "all",
    INSTRUCTOR,
    L2_LEVEL,
  );
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((i) => i.isPublished), [false, false, false]);
});

test("IUS-1: a PUBLISHED week stamps isPublished=true onto EVERY returned item", () => {
  const result = toInstructorScheduleResult(
    triStateWeekRow(true),
    "all",
    "all",
    INSTRUCTOR,
    L2_LEVEL,
  );
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map((i) => i.isPublished), [true, true, true]);
});

test("IUS-1: instructors still see an UNPUBLISHED week - isPublished reports, it never filters", () => {
  // The draft week's items are all returned; the field only labels them.
  const draft = toInstructorScheduleResult(triStateWeekRow(false), "all", "all", INSTRUCTOR, L2_LEVEL);
  const live = toInstructorScheduleResult(triStateWeekRow(true), "all", "all", INSTRUCTOR, L2_LEVEL);
  assert.deepEqual(draft.items.map((i) => i.id), live.items.map((i) => i.id));
  assert.equal(draft.hasSchedule, true);
});

test("IUS-1: combinedParticipation passes through verbatim - true, false and null", () => {
  const result = toInstructorScheduleResult(triStateWeekRow(true), "all", "all", INSTRUCTOR, L2_LEVEL);
  const byId = new Map(result.items.map((i) => [i.id, i.combinedParticipation]));
  assert.equal(byId.get("combined-true"), true);
  assert.equal(byId.get("combined-false"), false);
  assert.equal(byId.get("combined-null"), null);
});

test("IUS-1: a `false` combinedParticipation is NEVER coerced to null", () => {
  const result = toInstructorScheduleResult(triStateWeekRow(true), "all", "all", INSTRUCTOR, L2_LEVEL);
  const falsy = result.items.find((i) => i.id === "combined-false");
  assert.ok(falsy, "expected the false-valued item to survive");
  // Strict identity, not truthiness: `false` and `null` are different states and
  // a `||`/`??` collapse would silently turn "explicitly excluded" into "unstated".
  assert.strictEqual(falsy.combinedParticipation, false);
  assert.notStrictEqual(falsy.combinedParticipation, null);
});

test("IUS-1: combinedParticipation never removes an item - all three states survive", () => {
  const result = toInstructorScheduleResult(triStateWeekRow(true), "all", "all", INSTRUCTOR, L2_LEVEL);
  assert.deepEqual(result.items.map((i) => i.id), [
    "combined-true",
    "combined-false",
    "combined-null",
  ]);
});

test("IUS-1: courseLevel is the value the caller resolved, not a derived guess", () => {
  assert.equal(toInstructorScheduleResult(weekRow(), "all", "all", INSTRUCTOR, L1_LEVEL).courseLevel, 1);
  assert.equal(toInstructorScheduleResult(weekRow(), "all", "all", INSTRUCTOR, L2_LEVEL).courseLevel, 2);
});

test("IUS-1: the empty result reports courseLevel 0 (fail-closed unknown level)", () => {
  const empty = emptyInstructorScheduleResult();
  assert.equal(empty.courseLevel, 0);
  // 0 is not a real CourseOffering level, so it can never match the Level-2 gate.
  assert.notEqual(empty.courseLevel, L2_LEVEL);
  assert.deepEqual(empty, { hasSchedule: false, weekName: null, courseLevel: 0, items: [] });
});

test("IUS-1: the item filter reads NEITHER isPublished NOR combinedParticipation", () => {
  // Same week, same filter, two publication states and every tri-state value
  // present: if the predicate consulted either field, these id lists would differ.
  const published = toInstructorScheduleResult(triStateWeekRow(true), "all", "mine", INSTRUCTOR, L2_LEVEL);
  const draft = toInstructorScheduleResult(triStateWeekRow(false), "all", "mine", INSTRUCTOR, L2_LEVEL);
  assert.deepEqual(published.items.map((i) => i.id), draft.items.map((i) => i.id));
  assert.deepEqual(published.items.map((i) => i.id), [
    "combined-true",
    "combined-false",
    "combined-null",
  ]);

  // And the courseLevel itself is inert: it never narrows the list either.
  const asLevel1 = toInstructorScheduleResult(triStateWeekRow(true), "all", "mine", INSTRUCTOR, L1_LEVEL);
  assert.deepEqual(asLevel1.items.map((i) => i.id), published.items.map((i) => i.id));
});

test("IUS-1: the day filter still narrows normally with the new fields present", () => {
  const oneDay = toInstructorScheduleResult(
    triStateWeekRow(true),
    "2026-07-20",
    "all",
    INSTRUCTOR,
    L2_LEVEL,
  );
  assert.equal(oneDay.items.length, 3);
  const otherDay = toInstructorScheduleResult(
    triStateWeekRow(true),
    "2026-07-21",
    "all",
    INSTRUCTOR,
    L2_LEVEL,
  );
  assert.deepEqual(otherDay.items, []);
});

// ---------------------------------------------------------------------------
// Week selection orchestration
// ---------------------------------------------------------------------------

function weekSelectionDeps(
  overrides: Partial<InstructorWeekSelectionDeps> = {},
  trace = tracer(),
): { deps: InstructorWeekSelectionDeps; trace: ReturnType<typeof tracer> } {
  const deps: InstructorWeekSelectionDeps = {
    requireInstructorIdentity: async () => {
      trace.note("identity");
      return INSTRUCTOR;
    },
    resolveInstructorCourseOffering: async (requested) => {
      trace.note(`resolve:${requested}`);
      return resolvedOffering(requested);
    },
    getEffectiveCapabilities: async (id) => {
      trace.note(`capabilities:${id}`);
      return allCapabilities("ENABLED");
    },
    fetchWeekOptionRows: async (query) => {
      trace.note(`fetch:${query.where.courseOfferingId}`);
      return [
        {
          id: "w1",
          name: "שבוע א",
          startDate: new Date("2026-07-19T00:00:00.000Z"),
          endDate: new Date("2026-07-25T00:00:00.000Z"),
        },
      ];
    },
    todayDateKey: () => "2026-07-21",
    ...overrides,
  };
  return { deps, trace };
}

test("week selection: identity FIRST, then resolve, then capability, then a scoped fetch", async () => {
  const { deps, trace } = weekSelectionDeps();
  const result = await loadInstructorWeekSelectionWithDeps(L2, deps);
  assert.deepEqual(trace.calls, ["identity", `resolve:${L2}`, `capabilities:${L2}`, `fetch:${L2}`]);
  assert.equal(result.defaultWeekId, "w1");
});

test("week selection: the RESOLVED id is queried, never the requested string", async () => {
  const { deps, trace } = weekSelectionDeps({
    resolveInstructorCourseOffering: async () => resolvedOffering(L1),
  });
  await loadInstructorWeekSelectionWithDeps(L2, deps);
  assert.ok(trace.calls.includes(`capabilities:${L1}`));
  assert.ok(trace.calls.includes(`fetch:${L1}`));
  assert.equal(trace.calls.some((c) => c === `fetch:${L2}`), false);
});

test("week selection: every authorization denial yields the SAME empty selection", async () => {
  const cases = [
    { label: "anonymous", override: { requireInstructorIdentity: async () => { throw new UnauthenticatedActorError("no"); } } },
    { label: "missing id", override: { resolveInstructorCourseOffering: async () => { throw new MissingInstructorCourseOfferingIdError(); } } },
    { label: "not allowed", override: { resolveInstructorCourseOffering: async () => { throw new InstructorCourseOfferingNotAllowedError("other"); } } },
    { label: "capability READ_ONLY", override: { getEffectiveCapabilities: async () => allCapabilities("READ_ONLY") } },
    { label: "capability missing", override: { getEffectiveCapabilities: async () => ({}) } },
  ];
  for (const { label, override } of cases) {
    const { deps, trace } = weekSelectionDeps(override as Partial<InstructorWeekSelectionDeps>);
    const result = await loadInstructorWeekSelectionWithDeps(L2, deps);
    assert.deepEqual(result, emptyInstructorWeekSelection(), label);
    assert.equal(trace.calls.some((c) => c.startsWith("fetch:")), false, `${label} must not query`);
  }
});

test("week selection: a real defect propagates instead of becoming 'no weeks'", async () => {
  const { deps } = weekSelectionDeps({
    resolveInstructorCourseOffering: async () => {
      throw new InstructorCourseOfferingUnavailableError(L2, "missing");
    },
  });
  await assert.rejects(
    () => loadInstructorWeekSelectionWithDeps(L2, deps),
    InstructorCourseOfferingUnavailableError,
  );
});

// ---------------------------------------------------------------------------
// Week read orchestration
// ---------------------------------------------------------------------------

function scheduleReadDeps(
  overrides: Partial<InstructorScheduleReadDeps> = {},
  trace = tracer(),
): { deps: InstructorScheduleReadDeps; trace: ReturnType<typeof tracer> } {
  const deps: InstructorScheduleReadDeps = {
    requireInstructorIdentity: async () => {
      trace.note("identity");
      return INSTRUCTOR;
    },
    resolveInstructorCourseOffering: async (requested) => {
      trace.note(`resolve:${requested}`);
      return resolvedOffering(requested);
    },
    getEffectiveCapabilities: async () => allCapabilities("ENABLED"),
    fetchWeekWithItems: async (query) => {
      trace.note(`fetch:${query.where.id}@${query.where.courseOfferingId}`);
      return weekRow();
    },
    ...overrides,
  };
  return { deps, trace };
}

test("week read: the composite where carries both the week id and the resolved offering", async () => {
  const { deps, trace } = scheduleReadDeps();
  const result = await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", deps);
  assert.ok(trace.calls.includes(`fetch:week-1@${L2}`));
  assert.equal(result.hasSchedule, true);
});

test("IUS-1 week read: courseLevel comes from the RESOLVED offering, never the requested id", async () => {
  // Request Level 2's id, but have the resolver hand back the Level 1 row - the
  // result must report the RESOLVED row's level, exactly as the queries already
  // use the resolved id rather than the requested string.
  const { deps } = scheduleReadDeps({
    resolveInstructorCourseOffering: async () => resolvedOffering(L1),
  });
  const result = await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", deps);
  assert.equal(result.courseLevel, L1_LEVEL);

  const { deps: level2 } = scheduleReadDeps();
  assert.equal(
    (await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", level2)).courseLevel,
    L2_LEVEL,
  );
});

test("IUS-1 week read: the week's publication state reaches every item through the orchestration", async () => {
  const { deps } = scheduleReadDeps({
    fetchWeekWithItems: async () => triStateWeekRow(true),
  });
  const result = await loadInstructorScheduleWithDeps(L2, "week-tri", "all", "all", deps);
  assert.deepEqual(result.items.map((i) => i.isPublished), [true, true, true]);
  assert.deepEqual(result.items.map((i) => i.combinedParticipation), [true, false, null]);
});

test("IUS-1 today read: courseLevel and the new item fields reach the result", async () => {
  const deps: InstructorTodayScheduleDeps = {
    requireInstructorIdentity: async () => INSTRUCTOR,
    resolveInstructorCourseOffering: async (requested) => resolvedOffering(requested),
    getEffectiveCapabilities: async () => allCapabilities("ENABLED"),
    todayDateKey: () => "2026-07-20",
    fetchTodayWeekWithItems: async () => triStateWeekRow(false),
  };
  const result = await loadInstructorTodayScheduleWithDeps(L2, "all", deps);
  assert.equal(result.courseLevel, L2_LEVEL);
  assert.deepEqual(result.items.map((i) => i.isPublished), [false, false, false]);
  assert.deepEqual(result.items.map((i) => i.combinedParticipation), [true, false, null]);
});

test("IUS-1: every denial still reports the fail-closed courseLevel 0, leaking no level", async () => {
  const { deps: unauthenticated } = scheduleReadDeps({
    requireInstructorIdentity: async () => {
      throw new UnauthenticatedActorError("no");
    },
  });
  assert.equal((await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", unauthenticated)).courseLevel, 0);

  const { deps: noCapability } = scheduleReadDeps({
    getEffectiveCapabilities: async () => allCapabilities("DISABLED"),
  });
  assert.equal((await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", noCapability)).courseLevel, 0);

  const { deps: foreignWeek } = scheduleReadDeps({ fetchWeekWithItems: async () => null });
  assert.equal((await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", foreignWeek)).courseLevel, 0);
});

test("week read: a week the course does not own is indistinguishable from no week", async () => {
  // A composite-where miss is exactly what a cross-course probe produces.
  const { deps } = scheduleReadDeps({ fetchWeekWithItems: async () => null });
  const foreign = await loadInstructorScheduleWithDeps(L2, "week-of-level-1", "all", "all", deps);
  assert.deepEqual(foreign, emptyInstructorScheduleResult());

  const { deps: denied } = scheduleReadDeps({
    getEffectiveCapabilities: async () => allCapabilities("DISABLED"),
  });
  const unauthorized = await loadInstructorScheduleWithDeps(L2, "week-1", "all", "all", denied);
  assert.deepEqual(unauthorized, foreign);
});

test("week read: no week selected issues no request at all", async () => {
  const { deps, trace } = scheduleReadDeps();
  assert.deepEqual(
    await loadInstructorScheduleWithDeps(L2, null, "all", "all", deps),
    emptyInstructorScheduleResult(),
  );
  assert.deepEqual(trace.calls, []);
});

// ---------------------------------------------------------------------------
// Today read orchestration
// ---------------------------------------------------------------------------

test("today read: the clock is read ONLY after identity, offering and capability pass", async () => {
  const trace = tracer();
  const deps: InstructorTodayScheduleDeps = {
    requireInstructorIdentity: async () => {
      trace.note("identity");
      return INSTRUCTOR;
    },
    resolveInstructorCourseOffering: async (requested) => {
      trace.note("resolve");
      return resolvedOffering(requested);
    },
    getEffectiveCapabilities: async () => {
      trace.note("capabilities");
      return allCapabilities("ENABLED");
    },
    todayDateKey: () => {
      trace.note("clock");
      return "2026-07-20";
    },
    fetchTodayWeekWithItems: async (query) => {
      trace.note(`fetch:${query.where.courseOfferingId}`);
      return weekRow();
    },
  };

  const result = await loadInstructorTodayScheduleWithDeps(L2, "all", deps);
  assert.deepEqual(trace.calls, ["identity", "resolve", "capabilities", "clock", `fetch:${L2}`]);
  // ONE clock reading drives both the week lookup and the item narrowing.
  assert.deepEqual(result.items.map((i) => i.id), ["item-1"]);
});

test("today read: an unauthorized caller never even causes a clock read", async () => {
  const trace = tracer();
  const deps: InstructorTodayScheduleDeps = {
    requireInstructorIdentity: async () => {
      throw new UnauthenticatedActorError("no");
    },
    resolveInstructorCourseOffering: async (requested) => resolvedOffering(requested),
    getEffectiveCapabilities: async () => allCapabilities("ENABLED"),
    todayDateKey: () => {
      trace.note("clock");
      return "2026-07-20";
    },
    fetchTodayWeekWithItems: async () => {
      trace.note("fetch");
      return weekRow();
    },
  };
  assert.deepEqual(
    await loadInstructorTodayScheduleWithDeps(L2, "all", deps),
    emptyInstructorScheduleResult(),
  );
  assert.deepEqual(trace.calls, []);
});

test("today read: a course with zero weeks yields the uniform empty result", async () => {
  const deps: InstructorTodayScheduleDeps = {
    requireInstructorIdentity: async () => INSTRUCTOR,
    resolveInstructorCourseOffering: async (requested) => resolvedOffering(requested),
    getEffectiveCapabilities: async () => allCapabilities("ENABLED"),
    todayDateKey: () => "2026-07-20",
    fetchTodayWeekWithItems: async () => null,
  };
  assert.deepEqual(
    await loadInstructorTodayScheduleWithDeps(L2, "all", deps),
    emptyInstructorScheduleResult(),
  );
});

// ---------------------------------------------------------------------------
// No instructor id anywhere
// ---------------------------------------------------------------------------

test("no exported orchestration accepts an instructor id", () => {
  // Arity is the contract: (requested, deps) / (requested, weekId, dayKey, filter, deps)
  // / (requested, filter, deps). None of them has a slot an instructor id could
  // occupy - identity arrives only through the injected session boundary.
  assert.equal(loadInstructorWeekSelectionWithDeps.length, 2);
  assert.equal(loadInstructorScheduleWithDeps.length, 5);
  assert.equal(loadInstructorTodayScheduleWithDeps.length, 3);
});
