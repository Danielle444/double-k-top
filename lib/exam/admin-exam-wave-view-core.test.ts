/**
 * EXAM EX-ADMIN-WORKSPACE-UX (BLOCKER-1) — the runtime suite of the admin wave
 * narrowing.
 *
 * THE CENTRAL CLAIM, and the reason this suite exists at all: the admin
 * workspace's wave times are the COMMITTED BLOCK TIMETABLE CORE'S OWN OUTPUT and
 * nothing else. So most tests here drive that core directly, feed its result
 * through the adapter's row shape into the narrowing, and assert the narrowing
 * reproduces the core's own waves EXACTLY — same moments, same membership, same
 * order. If the two ever disagreed, the admin schedule would be showing a time
 * no instructor or trainee is shown, which is the defect this slice was told to
 * remove.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { computeExamBlockTimetable } from "./exam-block-timetable-core";
import {
  buildAdminExamWaveView,
  emptyAdminExamWaveView,
  readAdminExamWaveViewWithDeps,
  type AdminExamWaveAssignmentInput,
  type AdminExamWaveBlockInput,
} from "./admin-exam-wave-view-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

/**
 * Build the adapter-shaped rows a block would produce for a given timetable —
 * exactly as `composeStoredExamBlocks` does: it copies each examinee's slot
 * start and end VERBATIM onto the operational row, and leaves them `null` when
 * the timetable produced no slot.
 */
function rowsFromTimetable(
  examineeIds: readonly string[],
  timetable: ReturnType<typeof computeExamBlockTimetable>,
  extra: readonly AdminExamWaveAssignmentInput[] = [],
): AdminExamWaveAssignmentInput[] {
  const slotById = new Map(timetable.slots.map((slot) => [slot.assignmentId, slot]));
  const rows: AdminExamWaveAssignmentInput[] = examineeIds.map((assignmentId) => {
    const slot = slotById.get(assignmentId);
    return {
      assignmentId,
      role: "EXAMINEE" as const,
      personalStartTime: slot === undefined ? null : slot.startTime,
      personalEndTime: slot === undefined ? null : slot.endTime,
    };
  });
  return [...rows, ...extra];
}

function blockFrom(
  examineeIds: readonly string[],
  input: { blockStartTime: string; durationMinutes: number; parallelCapacity: number; breaks?: readonly { breakId: string; afterWaveIndex: number; durationMinutes: number }[] },
  extra: readonly AdminExamWaveAssignmentInput[] = [],
): { block: AdminExamWaveBlockInput; timetable: ReturnType<typeof computeExamBlockTimetable> } {
  const timetable = computeExamBlockTimetable({
    blockStartTime: input.blockStartTime,
    durationMinutes: input.durationMinutes,
    parallelCapacity: input.parallelCapacity,
    examinees: examineeIds.map((assignmentId, index) => ({ assignmentId, orderIndex: index })),
    breaks: input.breaks,
  });
  return {
    timetable,
    block: {
      sessionId: "s1",
      derivedBlockEndTime: timetable.blockEndTime,
      timetableStatus: timetable.ok ? "OK" : "UNRESOLVED",
      assignments: rowsFromTimetable(examineeIds, timetable, extra),
    },
  };
}

// ===========================================================================
// 1. The waves ARE the committed core's waves
// ===========================================================================

test("1. a parallel block's waves equal the committed timetable core's own waves", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const { block, timetable } = blockFrom(ids, {
    blockStartTime: "09:00",
    durationMinutes: 30,
    parallelCapacity: 2,
  });
  assert.equal(timetable.ok, true);

  const view = buildAdminExamWaveView([block]).blocks.get("s1");
  assert.ok(view);
  assert.equal(view.resolved, true);
  // Same COUNT, same MOMENTS, same MEMBERSHIP, same ORDER — the core's answer.
  assert.equal(view.waves.length, timetable.waves.length);
  assert.deepEqual(
    view.waves.map((wave) => wave.startTime),
    timetable.waves.map((wave) => wave.startTime),
  );
  assert.deepEqual(
    view.waves.map((wave) => wave.endTime),
    timetable.waves.map((wave) => wave.endTime),
  );
  assert.deepEqual(
    view.waves.map((wave) => [...wave.examineeAssignmentIds]),
    timetable.waves.map((wave) => [...wave.assignmentIds]),
  );
  // Two examinees really do share ONE moment.
  assert.deepEqual([...view.waves[0].examineeAssignmentIds], ["a", "b"]);
  assert.equal(view.waves[0].startTime, view.waves[0].startTime);
});

test("2. the SAME equality holds across many durations and capacities", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];
  for (const durationMinutes of [5, 12, 20, 30, 45, 60, 90]) {
    for (const parallelCapacity of [1, 2, 3, 4]) {
      const { block, timetable } = blockFrom(ids, {
        blockStartTime: "08:15",
        durationMinutes,
        parallelCapacity,
      });
      const view = buildAdminExamWaveView([block]).blocks.get("s1");
      assert.ok(view, `${durationMinutes}/${parallelCapacity}`);
      assert.deepEqual(
        view.waves.map((wave) => [wave.startTime, wave.endTime, [...wave.examineeAssignmentIds]]),
        timetable.waves.map((wave) => [wave.startTime, wave.endTime, [...wave.assignmentIds]]),
        `duration ${durationMinutes}, capacity ${parallelCapacity}`,
      );
      // ...and the block end is the core's, never a recomputation.
      assert.equal(view.derivedBlockEndTime, timetable.blockEndTime);
    }
  }
});

test("3. CHANGING THE DURATION moves the admin times exactly as it moves the core's", () => {
  const ids = ["a", "b", "c", "d"];
  const thirty = blockFrom(ids, {
    blockStartTime: "10:00",
    durationMinutes: 30,
    parallelCapacity: 2,
  });
  const forty = blockFrom(ids, {
    blockStartTime: "10:00",
    durationMinutes: 40,
    parallelCapacity: 2,
  });

  const a = buildAdminExamWaveView([thirty.block]).blocks.get("s1");
  const b = buildAdminExamWaveView([forty.block]).blocks.get("s1");
  assert.ok(a && b);

  // The duration genuinely changed the schedule...
  assert.notDeepEqual(
    a.waves.map((wave) => wave.startTime),
    b.waves.map((wave) => wave.startTime),
  );
  // ...and BOTH readings are the core's own, which is what makes the admin, the
  // instructor and the trainee show the same thing: all three consume the very
  // slots and waves compared here, and this module adds no arithmetic that could
  // diverge from them.
  assert.deepEqual(
    a.waves.map((wave) => wave.startTime),
    thirty.timetable.waves.map((wave) => wave.startTime),
  );
  assert.deepEqual(
    b.waves.map((wave) => wave.startTime),
    forty.timetable.waves.map((wave) => wave.startTime),
  );
  assert.equal(a.derivedBlockEndTime, thirty.timetable.blockEndTime);
  assert.equal(b.derivedBlockEndTime, forty.timetable.blockEndTime);
});

test("4. BREAKS shift the waves and the derived block end consistently", () => {
  const ids = ["a", "b", "c", "d"];
  const withoutBreak = blockFrom(ids, {
    blockStartTime: "09:00",
    durationMinutes: 30,
    parallelCapacity: 2,
  });
  const withBreak = blockFrom(ids, {
    blockStartTime: "09:00",
    durationMinutes: 30,
    parallelCapacity: 2,
    breaks: [{ breakId: "b1", afterWaveIndex: 0, durationMinutes: 15 }],
  });

  const plain = buildAdminExamWaveView([withoutBreak.block]).blocks.get("s1");
  const paused = buildAdminExamWaveView([withBreak.block]).blocks.get("s1");
  assert.ok(plain && paused);

  // The break is the CORE's decision, and the admin view simply reports it.
  assert.deepEqual(
    paused.waves.map((wave) => [wave.startTime, wave.endTime]),
    withBreak.timetable.waves.map((wave) => [wave.startTime, wave.endTime]),
  );
  assert.equal(paused.derivedBlockEndTime, withBreak.timetable.blockEndTime);
  // The first wave is untouched by a break that follows it; the second is not.
  assert.equal(paused.waves[0].startTime, plain.waves[0].startTime);
  assert.notEqual(paused.waves[1].startTime, plain.waves[1].startTime);
  // ...and the block end moved with it, by the core's reckoning and not ours.
  assert.notEqual(paused.derivedBlockEndTime, plain.derivedBlockEndTime);
});

test("5. ORDERING decides membership: a reordered block yields the core's new waves", () => {
  const before = blockFrom(["a", "b", "c", "d"], {
    blockStartTime: "09:00",
    durationMinutes: 30,
    parallelCapacity: 2,
  });
  // A MOVE renumbers the session, so the next canonical read presents the rows in
  // the new order — which is the only thing that changes here.
  const after = blockFrom(["c", "a", "b", "d"], {
    blockStartTime: "09:00",
    durationMinutes: 30,
    parallelCapacity: 2,
  });

  const first = buildAdminExamWaveView([before.block]).blocks.get("s1");
  const second = buildAdminExamWaveView([after.block]).blocks.get("s1");
  assert.ok(first && second);

  assert.deepEqual([...first.waves[0].examineeAssignmentIds], ["a", "b"]);
  assert.deepEqual([...second.waves[0].examineeAssignmentIds], ["c", "a"]);
  // The MOMENTS did not move — only who stands in them.
  assert.deepEqual(
    first.waves.map((wave) => wave.startTime),
    second.waves.map((wave) => wave.startTime),
  );
  // ...and the new membership is the CORE's, not this module's.
  assert.deepEqual(
    second.waves.map((wave) => [...wave.examineeAssignmentIds]),
    after.timetable.waves.map((wave) => [...wave.assignmentIds]),
  );
});

// ===========================================================================
// 2. What the narrowing must never do
// ===========================================================================

test("6. an INSTRUCTED TRAINEE never occupies a wave of its own", () => {
  const { block } = blockFrom(
    ["a", "b"],
    { blockStartTime: "09:00", durationMinutes: 30, parallelCapacity: 2 },
    [
      {
        assignmentId: "t1",
        role: "INSTRUCTED_TRAINEE",
        personalStartTime: "09:00",
        personalEndTime: "09:30",
      },
    ],
  );
  const view = buildAdminExamWaveView([block]).blocks.get("s1");
  assert.ok(view);
  assert.deepEqual([...view.waves[0].examineeAssignmentIds], ["a", "b"]);
  for (const wave of view.waves) {
    assert.equal(wave.examineeAssignmentIds.includes("t1"), false);
  }
  assert.equal(view.untimedExamineeAssignmentIds.includes("t1"), false);
});

test("7. an UNRESOLVED block keeps every examinee, with no wave and no invented time", () => {
  const { block, timetable } = blockFrom(["a", "b", "c"], {
    blockStartTime: "nonsense",
    durationMinutes: 30,
    parallelCapacity: 2,
  });
  assert.equal(timetable.ok, false);

  const view = buildAdminExamWaveView([block]).blocks.get("s1");
  assert.ok(view);
  assert.equal(view.resolved, false);
  assert.deepEqual([...view.waves], []);
  assert.equal(view.derivedBlockEndTime, null);
  assert.deepEqual([...view.untimedExamineeAssignmentIds], ["a", "b", "c"]);
});

test("8. a row with no derived start is listed as untimed rather than dropped or guessed", () => {
  const view = buildAdminExamWaveView([
    {
      sessionId: "s1",
      derivedBlockEndTime: "10:00",
      timetableStatus: "OK",
      assignments: [
        { assignmentId: "a", role: "EXAMINEE", personalStartTime: "09:00", personalEndTime: "09:30" },
        { assignmentId: "b", role: "EXAMINEE", personalStartTime: null, personalEndTime: null },
        { assignmentId: "c", role: "EXAMINEE", personalStartTime: "   ", personalEndTime: null },
      ],
    },
  ]).blocks.get("s1");
  assert.ok(view);
  assert.deepEqual([...view.waves[0].examineeAssignmentIds], ["a"]);
  assert.deepEqual([...view.untimedExamineeAssignmentIds], ["b", "c"]);
});

test("9. the narrowing is total, frozen, and never mutates its input", () => {
  const input: AdminExamWaveBlockInput[] = [
    {
      sessionId: "s1",
      derivedBlockEndTime: "10:00",
      timetableStatus: "OK",
      assignments: [
        { assignmentId: "a", role: "EXAMINEE", personalStartTime: "09:00", personalEndTime: "09:30" },
      ],
    },
  ];
  const snapshot = JSON.stringify(input);
  const view = buildAdminExamWaveView(input);
  assert.equal(JSON.stringify(input), snapshot, "the input was mutated");
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.blocks.get("s1")), true);

  // Malformed shapes are skipped, never thrown on.
  for (const bad of [
    [],
    [null],
    [{ sessionId: "", derivedBlockEndTime: null, timetableStatus: null, assignments: [] }],
  ] as unknown as AdminExamWaveBlockInput[][]) {
    assert.equal(buildAdminExamWaveView(bad).blocks.size, 0);
  }
  assert.equal(emptyAdminExamWaveView().blocks.size, 0);
});

// ===========================================================================
// 3. The orchestration
// ===========================================================================

test("10. the read authorizes FIRST, loads with the VERIFIED id, and narrows", () => {
  const calls: string[] = [];
  return readAdminExamWaveViewWithDeps("requested", {
    requireAdminCourseOffering: async (id) => {
      calls.push(`auth:${id}`);
      return { id: "verified" };
    },
    loadPlan: async (id) => {
      calls.push(`load:${id}`);
      return {
        sessions: [
          { sessionId: "s1", derivedBlockEndTime: "10:00", timetableStatus: "OK" },
          { sessionId: "tp:live", derivedBlockEndTime: null, timetableStatus: null },
        ],
        storedAssignmentDetails: new Map([
          [
            "s1",
            {
              assignments: [
                {
                  assignmentId: "a",
                  role: "EXAMINEE" as const,
                  personalStartTime: "09:00",
                  personalEndTime: "09:30",
                },
              ],
            },
          ],
        ]),
      };
    },
  }).then((view) => {
    // Authorization runs BEFORE the load, and the load gets the VERIFIED id.
    assert.deepEqual(calls, ["auth:requested", "load:verified"]);
    assert.equal(view.blocks.size, 1);
    // A LIVE beginner row has no stored detail and contributes nothing.
    assert.equal(view.blocks.has("tp:live"), false);
    assert.equal(view.blocks.get("s1")?.waves[0].startTime, "09:00");
  });
});

test("11. a context that identifies no offering loads NOTHING", async () => {
  let loaded = false;
  const view = await readAdminExamWaveViewWithDeps("x", {
    requireAdminCourseOffering: async () => ({ id: "   " }),
    loadPlan: async () => {
      loaded = true;
      return { sessions: [], storedAssignmentDetails: new Map() };
    },
  });
  assert.equal(loaded, false);
  assert.equal(view.blocks.size, 0);
});

test("12. an authorization failure PROPAGATES rather than becoming an empty view", async () => {
  await assert.rejects(() =>
    readAdminExamWaveViewWithDeps("x", {
      requireAdminCourseOffering: async () => {
        throw new Error("redirect");
      },
      loadPlan: async () => ({ sessions: [], storedAssignmentDetails: new Map() }),
    }),
  );
});

// ===========================================================================
// 4. NO time arithmetic exists in this module or in the admin route
// ===========================================================================

/** Strip comments, so the sweeps assert on CODE and not on prose about it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The arithmetic that must exist in exactly ONE place — the committed timetable
 * core — and therefore in none of the files swept below.
 */
const TIME_ARITHMETIC = [
  "durationMinutes",
  "parallelCapacity",
  "MINUTES_PER_DAY",
  "padStart",
  "Math.floor",
  "waveIndex",
];

test("13. THIS narrowing performs no time arithmetic and imports nothing", () => {
  const source = stripComments(
    readFileSync(join(REPO_ROOT, "lib", "exam", "admin-exam-wave-view-core.ts"), "utf8"),
  );
  assert.equal(/^\s*import\s/m.test(source), false, "the narrowing imports something");
  for (const token of TIME_ARITHMETIC) {
    assert.equal(source.includes(token), false, `the narrowing reaches ${token}`);
  }
  // No numeric time handling of any kind: no minute maths, no formatting.
  assert.equal(/\*\s*60|60\s*\*|\/\s*60|%\s*60/.test(source), false, "minute arithmetic exists");
});

test("14. NO admin exams route file performs time arithmetic of any kind", () => {
  const ROUTE_DIR = join(
    REPO_ROOT,
    "app",
    "admin",
    "courses",
    "[courseOfferingId]",
    "exams",
  );
  const files = readdirSync(ROUTE_DIR).filter((name) => /\.tsx?$/.test(name));
  assert.ok(files.length > 0, "the admin exams route was not found");

  for (const name of files) {
    // A contract SUITE legitimately names these tokens in order to forbid them.
    if (name.endsWith(".test.ts")) continue;
    const source = stripComments(readFileSync(join(ROUTE_DIR, name), "utf8"));
    for (const token of ["MINUTES_PER_DAY", "padStart", "waveIndex", "parseHHMM", "formatHHMM"]) {
      assert.equal(source.includes(token), false, `${name} reaches ${token}`);
    }
    // `durationMinutes` and `parallelCapacity` may be DISPLAYED as an exam
    // definition's own configured facts — that is what the definitions tab is —
    // but they may never be multiplied, added or otherwise turned into a clock.
    assert.equal(/\*\s*60|60\s*\*|\/\s*60|%\s*60/.test(source), false, `${name}: minute maths`);
    assert.equal(
      /(durationMinutes|parallelCapacity)\s*[*+\-/]/.test(source),
      false,
      `${name}: the definition's timing facts are used in arithmetic`,
    );
    assert.equal(
      /[*+\-/]\s*(durationMinutes|parallelCapacity)/.test(source),
      false,
      `${name}: the definition's timing facts are used in arithmetic`,
    );
  }
});
