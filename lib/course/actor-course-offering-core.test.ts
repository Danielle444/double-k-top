/**
 * URGENT LEVEL 2 ACCESS - SLICE L2-0: tests for the PURE actor-aware course
 * offering decision core (trainee + instructor), plus the DB-free IO
 * orchestration seams (query shape, fail-closed wiring).
 *
 * Run with: npx tsx --test lib/course/actor-course-offering-core.test.ts
 * No Prisma, no DB, no clock, no randomness (all boundaries are injected).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveTraineeCourseOfferingFromRows,
  authorizeInstructorCourseOfferingId,
  assertInstructorCourseOfferingExists,
  NoTraineeCourseOfferingError,
  AmbiguousTraineeCourseOfferingError,
  MissingInstructorCourseOfferingIdError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  resolveTraineeCourseOfferingWithDeps,
  resolveInstructorCourseOfferingWithDeps,
  type TraineeEnrollmentOfferingRow,
  type TraineeEnrollmentQuery,
} from "./actor-course-offering-core";
import { IncompleteCourseOfferingError, type CourseOfferingRow } from "./current-offering-core";
import {
  INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
  isInstructorAllowedCourseOfferingId,
  LEVEL_1_COURSE_OFFERING_ID,
  LEVEL_2_COURSE_OFFERING_ID,
} from "./temporary-level2-compatibility";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";

function offering(id: string, overrides: Partial<CourseOfferingRow> = {}): CourseOfferingRow {
  return {
    id,
    activityYearId: "year-1",
    name: "קורס",
    level: 1,
    startDate: new Date("2026-07-05T00:00:00.000Z"),
    endDate: new Date("2026-07-31T00:00:00.000Z"),
    status: "ACTIVE",
    ...overrides,
  };
}

function enrollment(
  overrides: Partial<TraineeEnrollmentOfferingRow> = {},
): TraineeEnrollmentOfferingRow {
  return {
    enrollmentId: "enr-1",
    enrollmentStatus: "ACTIVE",
    offering: offering(L1),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Trainee resolver - pure decision
// ---------------------------------------------------------------------------

test("trainee: exactly one ACTIVE enrollment into an ACTIVE offering resolves", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [enrollment()]);
  assert.equal(result.id, L1);
  assert.equal(result.status, "ACTIVE");
});

test("trainee: a Level 2 enrollment resolves to the Level 2 offering (no Level 1 bias)", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [
    enrollment({ offering: offering(L2, { level: 2 }) }),
  ]);
  assert.equal(result.id, L2);
  assert.equal(result.level, 2);
});

test("trainee: zero rows fails closed", () => {
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", []),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: PLANNED-only offering fails closed (never falls back to Level 1)", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L2, { level: 2, status: "PLANNED" }) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: ARCHIVED offering fails closed", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L1, { status: "ARCHIVED" }) }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: INACTIVE enrollment fails closed even when the offering is ACTIVE", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ enrollmentStatus: "INACTIVE" }),
      ]),
    NoTraineeCourseOfferingError,
  );
});

test("trainee: an INACTIVE enrollment never breaks a tie for an ACTIVE one", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", [
    enrollment({ enrollmentId: "enr-dead", enrollmentStatus: "INACTIVE", offering: offering(L2, { level: 2 }) }),
    enrollment({ enrollmentId: "enr-live", offering: offering(L1) }),
  ]);
  assert.equal(result.id, L1);
});

test("trainee: two eligible enrollments fail closed with both offering ids", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ enrollmentId: "enr-1", offering: offering(L1) }),
        enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }),
      ]),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousTraineeCourseOfferingError);
      assert.deepEqual(err.offeringIds, [L1, L2]);
      assert.equal(err.studentId, "stu-1");
      return true;
    },
  );
});

test("trainee: isPrimary is not consulted - the row type carries no such field", () => {
  // Defence-in-depth against a future "just use isPrimary" tie-break: the
  // decision core cannot see isPrimary even if the query selected it, so two
  // eligible enrollments still fail closed when one is marked primary.
  const rows = [
    { ...enrollment({ enrollmentId: "enr-1", offering: offering(L1) }), isPrimary: true },
    { ...enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }), isPrimary: false },
  ] as unknown as TraineeEnrollmentOfferingRow[];
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", rows),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("trainee: no group/subgroup mirror participates - the row type carries no such field", () => {
  const rows = [
    {
      ...enrollment({ enrollmentId: "enr-1", offering: offering(L1) }),
      groupName: "א",
      subgroupNumber: 1,
    },
    {
      ...enrollment({ enrollmentId: "enr-2", offering: offering(L2, { level: 2 }) }),
      groupName: "ב",
      subgroupNumber: 2,
    },
  ] as unknown as TraineeEnrollmentOfferingRow[];
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", rows),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("trainee: the single eligible offering must have concrete dates", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows("stu-1", [
        enrollment({ offering: offering(L1, { startDate: null }) }),
      ]),
    IncompleteCourseOfferingError,
  );
});

// ---------------------------------------------------------------------------
// Trainee resolver - IO orchestration (DB-free)
// ---------------------------------------------------------------------------

test("trainee resolver queries ONLY the session student's ACTIVE enrollments into ACTIVE offerings", async () => {
  const queries: TraineeEnrollmentQuery[] = [];
  const result = await resolveTraineeCourseOfferingWithDeps({
    requireTraineeId: async () => "stu-session",
    fetchTraineeEnrollmentRows: async (query) => {
      queries.push(query);
      return [enrollment()];
    },
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0], {
    take: 3,
    where: {
      studentId: "stu-session",
      status: "ACTIVE",
      courseOffering: { status: "ACTIVE" },
    },
  });
  assert.equal(result.id, L1);
});

test("trainee resolver takes the student id from the session, never from a caller argument", async () => {
  // The public wrapper has no parameters at all; the DI seam proves the id is
  // supplied by the session-reading dep.
  assert.equal(resolveTraineeCourseOfferingWithDeps.length, 1);
  let asked = false;
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => {
        asked = true;
        return "stu-session";
      },
      fetchTraineeEnrollmentRows: async () => [],
    }),
    NoTraineeCourseOfferingError,
  );
  assert.equal(asked, true);
});

test("trainee resolver propagates an unauthenticated session failure (fails closed)", async () => {
  class FakeUnauthenticated extends Error {}
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => {
        throw new FakeUnauthenticated("no trainee");
      },
      fetchTraineeEnrollmentRows: async () => {
        throw new Error("must not be reached");
      },
    }),
    FakeUnauthenticated,
  );
});

// ---------------------------------------------------------------------------
// Instructor resolver - explicit-id authorization (pure)
//
// The instructor model is REQUESTED context, not derived context: there is no
// instructor-id allow-list, no per-instructor offering assignment, and no
// instructor id in the policy at all.
// ---------------------------------------------------------------------------

/** A fake policy over an arbitrary allowed-offering set. */
function policy(allowedOfferingIds: readonly string[]) {
  const set = new Set(allowedOfferingIds);
  return { isAllowedOfferingId: (id: string) => set.has(id) };
}

const BOTH = policy([L1, L2]);

test("the temporary policy allows exactly the two verified offerings", () => {
  assert.equal(LEVEL_1_COURSE_OFFERING_ID, L1);
  assert.equal(LEVEL_2_COURSE_OFFERING_ID, L2);
  assert.deepEqual([...INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS], [L1, L2]);
  assert.equal(isInstructorAllowedCourseOfferingId(L1), true);
  assert.equal(isInstructorAllowedCourseOfferingId(L2), true);
});

test("the temporary policy is identical for every instructor (not keyed by instructor)", () => {
  // isInstructorAllowedCourseOfferingId takes ONLY an offering id: there is no
  // parameter through which an instructor's identity could vary the answer.
  assert.equal(isInstructorAllowedCourseOfferingId.length, 1);
});

test("the allowed-offering list cannot be widened at runtime", () => {
  assert.throws(() => {
    (INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS as string[]).push("offer-smuggled");
  });
  assert.equal(isInstructorAllowedCourseOfferingId("offer-smuggled"), false);
});

test("instructor: an explicitly requested Level 1 id is authorized unchanged", () => {
  assert.equal(authorizeInstructorCourseOfferingId(L1, BOTH), L1);
});

test("instructor: an explicitly requested Level 2 id is authorized unchanged", () => {
  assert.equal(authorizeInstructorCourseOfferingId(L2, BOTH), L2);
});

test("instructor: EVERY active instructor may address both offerings", () => {
  // Same policy object, no instructor input anywhere: both ids authorize for
  // any caller that passed the audience gate.
  assert.equal(authorizeInstructorCourseOfferingId(L1, BOTH), L1);
  assert.equal(authorizeInstructorCourseOfferingId(L2, BOTH), L2);
});

test("instructor: a missing/blank courseOfferingId fails closed (never inferred)", () => {
  assert.throws(
    () => authorizeInstructorCourseOfferingId("", BOTH),
    MissingInstructorCourseOfferingIdError,
  );
  assert.throws(
    () => authorizeInstructorCourseOfferingId(undefined as unknown as string, BOTH),
    MissingInstructorCourseOfferingIdError,
  );
  assert.throws(
    () => authorizeInstructorCourseOfferingId(null as unknown as string, BOTH),
    MissingInstructorCourseOfferingIdError,
  );
});

test("instructor: an offering outside the policy is refused, not substituted", () => {
  assert.throws(
    () => authorizeInstructorCourseOfferingId("offer-unknown", BOTH),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingNotAllowedError);
      assert.equal(err.offeringId, "offer-unknown");
      return true;
    },
  );
});

test("instructor: authorization is by EXACT id - no trimming, casing or prefix matching", () => {
  for (const bad of [` ${L1}`, `${L1} `, L1.toUpperCase(), `${L1}x`, L1.slice(0, -1)]) {
    assert.throws(
      () => authorizeInstructorCourseOfferingId(bad, BOTH),
      InstructorCourseOfferingNotAllowedError,
      `must refuse ${JSON.stringify(bad)}`,
    );
  }
});

test("instructor: no name / identity number / date / level / offering-name input exists", () => {
  // The only inputs are the requested id and an id-keyed predicate, so an
  // identity-number- or name-shaped value is simply a disallowed id.
  for (const bad of ["123456789", "דנה כהן", "2026-07-24", "2", "רמה 2"]) {
    assert.throws(
      () => authorizeInstructorCourseOfferingId(bad, BOTH),
      InstructorCourseOfferingNotAllowedError,
    );
  }
});

test("instructor: a missing offering row fails closed", () => {
  assert.throws(
    () => assertInstructorCourseOfferingExists(L2, null),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingUnavailableError);
      assert.equal(err.reason, "missing");
      assert.equal(err.offeringId, L2);
      return true;
    },
  );
});

test("instructor: a row whose id differs from the requested one fails closed", () => {
  assert.throws(
    () => assertInstructorCourseOfferingExists(L2, offering(L1)),
    (err: unknown) => {
      assert.ok(err instanceof InstructorCourseOfferingUnavailableError);
      assert.equal(err.reason, "id-mismatch");
      return true;
    },
  );
});

test("instructor: an existing ACTIVE offering resolves to the by-id view", () => {
  const result = assertInstructorCourseOfferingExists(L1, offering(L1));
  assert.equal(result.id, L1);
  assert.equal(result.status, "ACTIVE");
});

test("instructor: a PLANNED offering still resolves (Level 2 is NOT made ACTIVE)", () => {
  // The decision change explicitly keeps Level 2 out of ACTIVE status, so an
  // ACTIVE gate here would deny the very access being launched. Status is
  // returned to the caller for its own per-reader policy instead.
  const result = assertInstructorCourseOfferingExists(
    L2,
    offering(L2, { level: 2, status: "PLANNED" }),
  );
  assert.equal(result.id, L2);
  assert.equal(result.status, "PLANNED");
});

test("instructor: an undated offering resolves with null dates (never invented)", () => {
  const result = assertInstructorCourseOfferingExists(
    L2,
    offering(L2, { level: 2, status: "PLANNED", startDate: null, endDate: null }),
  );
  assert.equal(result.startDate, null);
  assert.equal(result.endDate, null);
});

test("instructor: an ARCHIVED offering is still identity-resolvable, not silently swapped", () => {
  const result = assertInstructorCourseOfferingExists(L1, offering(L1, { status: "ARCHIVED" }));
  assert.equal(result.id, L1);
  assert.equal(result.status, "ARCHIVED");
});

// ---------------------------------------------------------------------------
// Instructor resolver - IO orchestration (DB-free)
// ---------------------------------------------------------------------------

function instructorDeps(overrides: Partial<Parameters<typeof resolveInstructorCourseOfferingWithDeps>[1]> = {}) {
  return {
    requireActiveInstructor: async () => ({ id: "ins-1" }),
    isAllowedOfferingId: (id: string) => id === L1 || id === L2,
    fetchOfferingById: async (id: string) => offering(id),
    ...overrides,
  };
}

test("instructor resolver fetches exactly the requested offering id and returns it", async () => {
  const asked: string[] = [];
  const result = await resolveInstructorCourseOfferingWithDeps(
    L2,
    instructorDeps({
      fetchOfferingById: async (id: string) => {
        asked.push(id);
        return offering(id, { level: 2, status: "PLANNED" });
      },
    }),
  );
  assert.deepEqual(asked, [L2]);
  assert.equal(result.id, L2);
});

test("instructor resolver serves BOTH offerings to the SAME instructor", async () => {
  const deps = instructorDeps();
  const l1 = await resolveInstructorCourseOfferingWithDeps(L1, deps);
  const l2 = await resolveInstructorCourseOfferingWithDeps(L2, deps);
  assert.equal(l1.id, L1);
  assert.equal(l2.id, L2);
});

test("instructor resolver refuses a disallowed offering WITHOUT any DB lookup", async () => {
  let fetched = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      "offer-unknown",
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          fetched = true;
          return offering(id);
        },
      }),
    ),
    InstructorCourseOfferingNotAllowedError,
  );
  assert.equal(fetched, false, "a disallowed id must never reach the database");
});

test("instructor resolver refuses a missing courseOfferingId WITHOUT any DB lookup", async () => {
  let fetched = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      "",
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          fetched = true;
          return offering(id);
        },
      }),
    ),
    MissingInstructorCourseOfferingIdError,
  );
  assert.equal(fetched, false);
});

test("instructor resolver does NOT probe or substitute the other offering when the requested one is missing", async () => {
  const asked: string[] = [];
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      L2,
      instructorDeps({
        fetchOfferingById: async (id: string) => {
          asked.push(id);
          return null;
        },
      }),
    ),
    InstructorCourseOfferingUnavailableError,
  );
  assert.deepEqual(asked, [L2], "exactly one lookup - no fallback probe of Level 1");
});

test("instructor resolver gates on the ACTIVE-instructor check BEFORE anything else", async () => {
  class FakeUnauthenticated extends Error {}
  let authorized = false;
  await assert.rejects(
    resolveInstructorCourseOfferingWithDeps(
      L1,
      instructorDeps({
        requireActiveInstructor: async () => {
          throw new FakeUnauthenticated("no active instructor");
        },
        isAllowedOfferingId: () => {
          authorized = true;
          return true;
        },
        fetchOfferingById: async () => {
          throw new Error("must not be reached");
        },
      }),
    ),
    FakeUnauthenticated,
  );
  assert.equal(authorized, false, "an inactive/absent instructor is rejected first");
});

test("instructor resolver returns only offering fields - never policy membership", async () => {
  const result = await resolveInstructorCourseOfferingWithDeps(L2, instructorDeps());
  assert.deepEqual(Object.keys(result).sort(), [
    "activityYearId",
    "endDate",
    "id",
    "level",
    "name",
    "startDate",
    "status",
  ]);
});

// ===========================================================================
// TEMPORARY dual-enrollment compatibility exception (launch-scoped)
//
// The exception exists so a trainee enrolled in BOTH launch offerings keeps the
// Level 1 modules that are NOT course-selectable. Every test below is about one
// property: it applies to the EXACT known pair and to NOTHING else.
//
// It is exercised through an INJECTED pair, because the pure core holds no
// offering id of its own. The real constants are used here so these tests bind
// to the ids production actually ships (see the binding contract test below).
// ===========================================================================

/** The launch pair exactly as the real IO binding injects it. */
const LAUNCH_PAIR = {
  level1OfferingId: LEVEL_1_COURSE_OFFERING_ID,
  level2OfferingId: LEVEL_2_COURSE_OFFERING_ID,
} as const;

const THIRD = "cmthirdofferingxxxxxxxxxx";

/** The canonical dual-enrolled trainee: ACTIVE in both ACTIVE launch offerings. */
function dualRows(): TraineeEnrollmentOfferingRow[] {
  return [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1, { level: 1 }) }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2, { level: 2 }) }),
  ];
}

test("exception: the exact {L1, L2} pair resolves to the Level 1 offering", () => {
  const result = resolveTraineeCourseOfferingFromRows("stu-1", dualRows(), LAUNCH_PAIR);
  assert.equal(result.id, L1);
});

test("exception: row order does not change the outcome", () => {
  const forward = resolveTraineeCourseOfferingFromRows("stu-1", dualRows(), LAUNCH_PAIR);
  const reversed = resolveTraineeCourseOfferingFromRows(
    "stu-1",
    [...dualRows()].reverse(),
    LAUNCH_PAIR,
  );
  assert.equal(forward.id, L1);
  assert.equal(reversed.id, L1);
  assert.deepEqual(reversed, forward);
});

test("exception: the resolved offering carries the ELIGIBLE ROW's own metadata", () => {
  // Proof the result comes from the trainee's already-loaded enrollment row and
  // not from the configured constant: every field asserted below is fixture data
  // that only the row could supply. A constant-derived id could not carry them.
  const rows = [
    enrollment({
      enrollmentId: "enr-l1",
      offering: offering(L1, {
        level: 1,
        name: "מחזור אביב",
        activityYearId: "year-2026",
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-09-30T00:00:00.000Z"),
      }),
    }),
    enrollment({ enrollmentId: "enr-l2", offering: offering(L2, { level: 2 }) }),
  ];
  const result = resolveTraineeCourseOfferingFromRows("stu-1", rows, LAUNCH_PAIR);
  assert.equal(result.id, L1);
  assert.equal(result.name, "מחזור אביב");
  assert.equal(result.activityYearId, "year-2026");
  assert.equal(result.level, 1);
  assert.deepEqual(result.startDate, new Date("2026-03-01T00:00:00.000Z"));
  assert.deepEqual(result.endDate, new Date("2026-09-30T00:00:00.000Z"));
});

test("exception: a trainee NOT enrolled in Level 1 can never be resolved to Level 1", () => {
  // The strongest non-authority proof: the injected pair still names L1, but no
  // eligible row IS L1, so L1 is unreachable and the state stays ambiguous.
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows(
        "stu-1",
        [
          enrollment({ enrollmentId: "enr-a", offering: offering(L2, { level: 2 }) }),
          enrollment({ enrollmentId: "enr-b", offering: offering(THIRD, { level: 3 }) }),
        ],
        LAUNCH_PAIR,
      ),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousTraineeCourseOfferingError);
      assert.ok(!err.offeringIds.includes(L1), "the configured Level 1 id must not appear");
      return true;
    },
  );
});

test("exception: {L1, unknown} stays ambiguous", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows(
        "stu-1",
        [
          enrollment({ enrollmentId: "enr-1", offering: offering(L1) }),
          enrollment({ enrollmentId: "enr-2", offering: offering(THIRD, { level: 3 }) }),
        ],
        LAUNCH_PAIR,
      ),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("exception: {L2, unknown} stays ambiguous", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows(
        "stu-1",
        [
          enrollment({ enrollmentId: "enr-1", offering: offering(L2, { level: 2 }) }),
          enrollment({ enrollmentId: "enr-2", offering: offering(THIRD, { level: 3 }) }),
        ],
        LAUNCH_PAIR,
      ),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("exception: the known pair PLUS a third eligible offering stays ambiguous", () => {
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows(
        "stu-1",
        [
          ...dualRows(),
          enrollment({ enrollmentId: "enr-3", offering: offering(THIRD, { level: 3 }) }),
        ],
        LAUNCH_PAIR,
      ),
    (err: unknown) => {
      assert.ok(err instanceof AmbiguousTraineeCourseOfferingError);
      assert.deepEqual(err.offeringIds, [L1, L2, THIRD]);
      return true;
    },
  );
});

test("exception: two ACTIVE enrollments into the SAME offering are not the pair", () => {
  // Duplicates must never be mistaken for the two-offering state, in either
  // direction, and must never be silently de-duplicated into a resolution.
  for (const id of [L1, L2]) {
    assert.throws(
      () =>
        resolveTraineeCourseOfferingFromRows(
          "stu-1",
          [
            enrollment({ enrollmentId: "enr-a", offering: offering(id) }),
            enrollment({ enrollmentId: "enr-b", offering: offering(id) }),
          ],
          LAUNCH_PAIR,
        ),
      AmbiguousTraineeCourseOfferingError,
      `duplicate ${id} rows must stay ambiguous`,
    );
  }
});

test("exception: an INACTIVE Level 2 enrollment is filtered by eligibility, not by the exception", () => {
  // Eligibility runs FIRST, so this is an ordinary single-row resolution: it
  // resolves identically with the pair injected and with it omitted.
  const rows = [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({
      enrollmentId: "enr-l2",
      enrollmentStatus: "INACTIVE",
      offering: offering(L2, { level: 2 }),
    }),
  ];
  assert.equal(resolveTraineeCourseOfferingFromRows("stu-1", rows, LAUNCH_PAIR).id, L1);
  assert.equal(resolveTraineeCourseOfferingFromRows("stu-1", rows).id, L1);
});

test("exception: a PLANNED Level 2 offering is filtered by eligibility, not by the exception", () => {
  const rows = [
    enrollment({ enrollmentId: "enr-l1", offering: offering(L1) }),
    enrollment({
      enrollmentId: "enr-l2",
      offering: offering(L2, { level: 2, status: "PLANNED" }),
    }),
  ];
  assert.equal(resolveTraineeCourseOfferingFromRows("stu-1", rows, LAUNCH_PAIR).id, L1);
  assert.equal(resolveTraineeCourseOfferingFromRows("stu-1", rows).id, L1);
});

test("exception: a Level-1-only trainee is unchanged", () => {
  const rows = [enrollment({ offering: offering(L1) })];
  const withPair = resolveTraineeCourseOfferingFromRows("stu-1", rows, LAUNCH_PAIR);
  assert.deepEqual(withPair, resolveTraineeCourseOfferingFromRows("stu-1", rows));
  assert.equal(withPair.id, L1);
});

test("exception: a Level-2-only trainee still resolves to Level 2 (never rewritten)", () => {
  const rows = [enrollment({ offering: offering(L2, { level: 2 }) })];
  const withPair = resolveTraineeCourseOfferingFromRows("stu-1", rows, LAUNCH_PAIR);
  assert.deepEqual(withPair, resolveTraineeCourseOfferingFromRows("stu-1", rows));
  assert.equal(withPair.id, L2);
  assert.equal(withPair.level, 2);
});

test("exception: a trainee with NO eligible enrollment still fails closed", () => {
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", [], LAUNCH_PAIR),
    NoTraineeCourseOfferingError,
  );
  assert.throws(
    () =>
      resolveTraineeCourseOfferingFromRows(
        "stu-1",
        [enrollment({ enrollmentStatus: "INACTIVE" })],
        LAUNCH_PAIR,
      ),
    NoTraineeCourseOfferingError,
  );
});

test("exception: OMITTING the compatibility keeps {L1, L2} ambiguous (opt-in, fail-closed default)", () => {
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", dualRows()),
    AmbiguousTraineeCourseOfferingError,
  );
  assert.throws(
    () => resolveTraineeCourseOfferingFromRows("stu-1", dualRows(), undefined),
    AmbiguousTraineeCourseOfferingError,
  );
});

test("exception: the DI seam applies the pair only when the dep supplies it", async () => {
  const fetchDual = async () => dualRows();
  const resolved = await resolveTraineeCourseOfferingWithDeps({
    requireTraineeId: async () => "stu-session",
    fetchTraineeEnrollmentRows: fetchDual,
    legacyDualEnrollmentCompatibility: LAUNCH_PAIR,
  });
  assert.equal(resolved.id, L1);

  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => "stu-session",
      fetchTraineeEnrollmentRows: fetchDual,
    }),
    AmbiguousTraineeCourseOfferingError,
    "without the dep the resolver must still refuse to choose",
  );
});

test("exception: the compatibility never widens the QUERY (take:3 still exposes a third offering)", async () => {
  const queries: TraineeEnrollmentQuery[] = [];
  await assert.rejects(
    resolveTraineeCourseOfferingWithDeps({
      requireTraineeId: async () => "stu-session",
      fetchTraineeEnrollmentRows: async (query) => {
        queries.push(query);
        return [...dualRows(), enrollment({ enrollmentId: "enr-3", offering: offering(THIRD) })];
      },
      legacyDualEnrollmentCompatibility: LAUNCH_PAIR,
    }),
    AmbiguousTraineeCourseOfferingError,
  );
  assert.deepEqual(queries[0], {
    take: 3,
    where: { studentId: "stu-session", status: "ACTIVE", courseOffering: { status: "ACTIVE" } },
  });
});

// ---------------------------------------------------------------------------
// Source contracts: where the exception may and may not appear
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed, so a forbidden-identifier scan
 * tests what the module DOES, not what its documentation discusses. These cores
 * name isPrimary, cookies and date inference in prose precisely to say they are
 * never used, and that prose must not be mistaken for a use.
 */
function bodyAfterHeader(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** From `export ... function NAME` up to the next top-level `export`, or the end. */
function functionSource(src: string, name: string): string {
  const start = src.search(new RegExp(`export (?:async )?function ${name}\\b`));
  assert.ok(start >= 0, `expected to find ${name}`);
  const rest = src.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? rest : rest.slice(0, end);
}

test("the pure core contains NO hardcoded offering id and no compatibility import", () => {
  const body = bodyAfterHeader(readSource("./actor-course-offering-core.ts"));
  for (const forbidden of [
    L1,
    L2,
    "LEVEL_1_COURSE_OFFERING_ID",
    "LEVEL_2_COURSE_OFFERING_ID",
    "temporary-level2-compatibility",
    "courseSettings",
    // The cookie/session READ markers specifically. The word "cookies" itself
    // appears in a denial MESSAGE that exists to say cookies are never consulted.
    "next/headers",
    "cookies(",
    // Likewise a property READ. The bare identifier appears in the ambiguity
    // message, which exists to say isPrimary is deliberately never consulted.
    ".isPrimary",
    // The Prisma CLIENT. The core imports a type-only enum from the generated
    // client, which carries no runtime dependency and issues no query.
    "prisma.",
    "Date.now",
  ]) {
    assert.ok(!body.includes(forbidden), `the pure core must not reference "${forbidden}"`);
  }
});

test("the real ZERO-ARGUMENT binding injects exactly the two known offering ids", () => {
  const src = readSource("./actor-course-offering.ts");
  assert.match(
    src,
    /level1OfferingId:\s*LEVEL_1_COURSE_OFFERING_ID,\s*\n\s*level2OfferingId:\s*LEVEL_2_COURSE_OFFERING_ID,/,
    "the injected pair must be exactly the two verified constants",
  );
  assert.match(
    functionSource(src, "resolveTraineeCourseOffering"),
    /legacyDualEnrollmentCompatibility:\s*TRAINEE_DUAL_ENROLLMENT_COMPATIBILITY,/,
    "the zero-argument resolver must inject the compatibility",
  );
  // No third id, and no id literal spelled out at the binding either.
  assert.deepEqual(
    src.match(/cm[a-z0-9]{20,}/g) ?? [],
    [],
    "offering id literals belong in temporary-level2-compatibility.ts only",
  );
});

test("the EXPLICIT-SELECTION resolvers do not receive the compatibility", () => {
  const src = readSource("./actor-course-offering.ts");
  for (const fn of ["resolveTraineeSelectedCourseOffering", "listTraineeCourseOptions"]) {
    assert.ok(
      !functionSource(src, fn).includes("legacyDualEnrollmentCompatibility"),
      `${fn} must never fall back to Level 1 - it uses explicit selection`,
    );
  }
  // The selection CORE is a separate decision function that does not call the
  // single-course one, so it cannot inherit the exception transitively either.
  const selectionCore = bodyAfterHeader(readSource("./trainee-course-selection-core.ts"));
  assert.ok(
    !selectionCore.includes("resolveTraineeCourseOfferingFromRows"),
    "the selection core must not call the single-course decision function",
  );
  assert.ok(
    !selectionCore.includes("legacyDualEnrollmentCompatibility"),
    "the selection core must not know about the compatibility",
  );
});

test("the schedule and contacts actions still bind EXPLICIT selection, unchanged", () => {
  for (const relative of [
    "../actions/contacts.ts",
    "../actions/weekly-schedule.ts",
    "../actions/student-schedule.ts",
  ]) {
    const src = readSource(relative);
    assert.match(
      src,
      /resolveTraineeSelectedCourseOffering\(requestedCourseOfferingId\)/,
      `${relative} must keep resolving the trainee's REQUESTED course`,
    );
    assert.ok(
      !src.includes("legacyDualEnrollmentCompatibility"),
      `${relative} must not reference the compatibility`,
    );
  }
});

test("exactly the six non-selectable trainee modules inherit the exception", () => {
  // These are the modules that import the ZERO-ARGUMENT resolver and therefore
  // gain the Level 1 compatibility. Any new entry here is a module silently
  // acquiring a Level 1 fallback and must be a deliberate, reviewed decision.
  const inheriting: string[] = [];
  for (const relative of [
    "../actions/completion.ts",
    "../actions/materials.ts",
    "../actions/messages.ts",
    "../actions/student-schedule.ts",
    "../actions/teaching-practice-student.ts",
    "../actions/weekly-feedback.ts",
    "../actions/weekly-schedule.ts",
    "../actions/contacts.ts",
    "../actions/trainee-course-selection.ts",
  ]) {
    const importBlock =
      readSource(relative).match(
        /import\s*\{[\s\S]*?\}\s*from\s*"@\/lib\/course\/actor-course-offering";/,
      )?.[0] ?? "";
    // The dependency PROPERTY shares this name, so match the IMPORTED specifier
    // only - never a plain substring of the whole file.
    if (/(?:\{|,)\s*resolveTraineeCourseOffering\s*(?:,|\})/.test(importBlock)) {
      inheriting.push(relative);
    }
  }
  assert.deepEqual(inheriting.sort(), [
    "../actions/completion.ts",
    "../actions/materials.ts",
    "../actions/messages.ts",
    "../actions/student-schedule.ts",
    "../actions/teaching-practice-student.ts",
    "../actions/weekly-feedback.ts",
  ]);
});
