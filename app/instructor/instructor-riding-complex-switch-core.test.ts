import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildComplexStationSwitchOptions,
  isSameSwitchScope,
  formatTraineeTabLabel,
} from "./RidingStudentsModalController";
import type { RidingSlotComplexPlanForEditing } from "@/lib/actions/riding-slot-complex";
import type { RidingSlotStudentRow } from "@/lib/actions/riding-slots";

// RIDING-COMPLEX-FEEDBACK-TABS - these exercise ONLY the three pure helpers
// exported from RidingStudentsModalController. They deliberately import from
// the component module (not a separate -core file) to honor the approved
// 2-production-file scope for this fix; the helpers themselves touch no React
// state, Prisma, or network, so the assertions below are fully deterministic.

// Minimal builders - the helper reads only these fields; everything else on the
// real DTOs is irrelevant to its decision, so we cast narrow literals.
function row(studentId: string, studentName: string): RidingSlotStudentRow {
  return { studentId, studentName } as unknown as RidingSlotStudentRow;
}

type PairLite = { trainee1Id: string | null; trainee2Id: string | null };
function station(...pairs: PairLite[]) {
  return { pairs };
}
function block(...stations: ReturnType<typeof station>[]) {
  return { stations };
}
function plan(...blocks: ReturnType<typeof block>[]): RidingSlotComplexPlanForEditing {
  return { plan: { blocks } } as unknown as RidingSlotComplexPlanForEditing;
}

const ids = (opts: { studentId: string; label: string }[]) => opts.map((o) => o.studentId);

// A two-block plan: block 1 has two stations under the SAME coach (S1: A,B,C /
// S2: D,E); block 2 has one station (S3: F,G). Roster also holds Z, a simple
// subgroup peer who sits in no station at all.
const twoBlockPlan = plan(
  block(
    station({ trainee1Id: "A", trainee2Id: "B" }, { trainee1Id: "C", trainee2Id: null }),
    station({ trainee1Id: "D", trainee2Id: "E" })
  ),
  block(station({ trainee1Id: "F", trainee2Id: "G" }))
);
const fullRoster = [
  row("A", "אבי כהן"),
  row("B", "בני לוי"),
  row("C", "גדי מזרחי"),
  row("D", "דנה אבידן"),
  row("E", "הדס נעים"),
  row("F", "ותד סעיד"),
  row("G", "זיו רון"),
  row("Z", "זהר פלד"),
];

test("scopes to the exact station containing the opened trainee (points 1)", () => {
  assert.deepEqual(ids(buildComplexStationSwitchOptions(twoBlockPlan, "A", fullRoster)), ["A", "B", "C"]);
  // Opening from the second slot of a pair resolves to the same station.
  assert.deepEqual(ids(buildComplexStationSwitchOptions(twoBlockPlan, "B", fullRoster)), ["A", "B", "C"]);
});

test("another station under the SAME coach is excluded (point 2)", () => {
  const opts = buildComplexStationSwitchOptions(twoBlockPlan, "A", fullRoster);
  assert.ok(!ids(opts).includes("D"));
  assert.ok(!ids(opts).includes("E"));
});

test("another block is excluded (point 3)", () => {
  const opts = buildComplexStationSwitchOptions(twoBlockPlan, "A", fullRoster);
  assert.ok(!ids(opts).includes("F"));
  assert.ok(!ids(opts).includes("G"));
});

test("simple-subgroup peers outside the station are excluded (point 4)", () => {
  const opts = buildComplexStationSwitchOptions(twoBlockPlan, "A", fullRoster);
  assert.ok(!ids(opts).includes("Z"));
});

test("cross-subgroup station-mates present in the roster are returned as openable tabs (point 5)", () => {
  // D/E live in station 2; opening D returns exactly D,E even though they are a
  // different subgroup from A's station - and both resolve to real roster rows.
  const opts = buildComplexStationSwitchOptions(twoBlockPlan, "D", fullRoster);
  assert.deepEqual(ids(opts), ["D", "E"]);
  assert.ok(opts.every((o) => fullRoster.some((r) => r.studentId === o.studentId)));
});

test("pair-then-slot order is stable (point 6)", () => {
  const ordered = plan(
    block(
      station(
        { trainee1Id: "C", trainee2Id: "A" },
        { trainee1Id: "B", trainee2Id: "D" }
      )
    )
  );
  const roster = [row("A", "A a"), row("B", "B b"), row("C", "C c"), row("D", "D d")];
  assert.deepEqual(ids(buildComplexStationSwitchOptions(ordered, "A", roster)), ["C", "A", "B", "D"]);
});

test("duplicate trainee ids within a station are de-duplicated, first position kept (point 7)", () => {
  const dup = plan(
    block(
      station(
        { trainee1Id: "A", trainee2Id: "B" },
        { trainee1Id: "A", trainee2Id: "C" }
      )
    )
  );
  const roster = [row("A", "A a"), row("B", "B b"), row("C", "C c")];
  assert.deepEqual(ids(buildComplexStationSwitchOptions(dup, "A", roster)), ["A", "B", "C"]);
});

test("labels come from the roster row via formatTraineeTabLabel", () => {
  const opts = buildComplexStationSwitchOptions(twoBlockPlan, "A", fullRoster);
  const a = opts.find((o) => o.studentId === "A");
  assert.equal(a?.label, formatTraineeTabLabel("אבי כהן"));
});

test("a station trainee absent from the roster is skipped, never a dead tab (points 5, 12)", () => {
  const ghostPlan = plan(block(station({ trainee1Id: "A", trainee2Id: "GHOST" })));
  const roster = [row("A", "A a")]; // GHOST not loaded (e.g. deactivated)
  assert.deepEqual(ids(buildComplexStationSwitchOptions(ghostPlan, "A", roster)), ["A"]);
});

test("no plan loaded falls back to the current trainee only, hiding the tab bar (point 12)", () => {
  assert.deepEqual(ids(buildComplexStationSwitchOptions(null, "A", fullRoster)), ["A"]);
});

test("opened trainee not found in any station falls back to self only (point 12)", () => {
  assert.deepEqual(ids(buildComplexStationSwitchOptions(twoBlockPlan, "Z", fullRoster)), ["Z"]);
});

test("current trainee missing from the roster yields no tabs (defensive, point 12)", () => {
  assert.deepEqual(buildComplexStationSwitchOptions(twoBlockPlan, "A", []), []);
  assert.deepEqual(buildComplexStationSwitchOptions(null, "A", null), []);
});

// Point 8 - the flat/simple list tab still scopes by simple subgroup, unchanged.
test("isSameSwitchScope keeps its simple-subgroup semantics (point 8)", () => {
  const a1 = row("a1", "x") as RidingSlotStudentRow;
  Object.assign(a1, { groupName: "א", subgroupNumber: 1 });
  const a1b = Object.assign(row("a1b", "y"), { groupName: "א", subgroupNumber: 1 });
  const a2 = Object.assign(row("a2", "z"), { groupName: "א", subgroupNumber: 2 });
  const b1 = Object.assign(row("b1", "w"), { groupName: "ב", subgroupNumber: 1 });
  const noSub = Object.assign(row("ns", "q"), { groupName: "א", subgroupNumber: null });

  assert.equal(isSameSwitchScope(a1, a1b), true); // same group + subgroup
  assert.equal(isSameSwitchScope(a1, a2), false); // same group, different subgroup
  assert.equal(isSameSwitchScope(a1, b1), false); // different group
  assert.equal(isSameSwitchScope(noSub, a2), true); // no subgroup -> whole group
  assert.equal(isSameSwitchScope(noSub, b1), false); // no subgroup, different group
});

test("formatTraineeTabLabel renders first name + last initial", () => {
  assert.equal(formatTraineeTabLabel("אבי כהן"), "אבי כ׳");
  assert.equal(formatTraineeTabLabel("Solo"), "Solo");
});
