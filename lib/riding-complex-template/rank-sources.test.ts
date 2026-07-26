// RC-B0 - focused unit tests for the pure day-part-aware source ranking core
// (rankSources in ./rank-sources). DB-free and IO-free: it exercises only the
// pure function against explicit descriptors.
//
// Run: npx tsx --test lib/riding-complex-template/rank-sources.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { rankSources } from "./rank-sources";
import type {
  ComplexSourceDayPart,
  DestinationSlotDescriptor,
  SourceCandidateDescriptor,
} from "./types";

const MORNING: ComplexSourceDayPart = "בוקר";
const AFTERNOON: ComplexSourceDayPart = "אחה\"צ";

function makeDestination(
  overrides: Partial<DestinationSlotDescriptor> = {}
): DestinationSlotDescriptor {
  return {
    slotId: "dest",
    anchorDateKey: "2026-07-20",
    resolvedGroup: "A",
    courseOfferingId: "off1",
    dayPart: MORNING,
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<SourceCandidateDescriptor> = {}
): SourceCandidateDescriptor {
  return {
    slotId: "c1",
    anchorDateKey: "2026-07-19",
    startTime: "08:00",
    resolvedGroup: "A",
    blockCount: 1,
    dayPart: MORNING,
    courseOfferingId: "off1",
    ...overrides,
  };
}

const slotIds = (list: readonly SourceCandidateDescriptor[]): string[] =>
  list.map((c) => c.slotId);

// 1. Same-day-part source is recommended.
test("recommends a same-day-part source", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const morning = makeCandidate({ slotId: "morning", anchorDateKey: "2026-07-18", dayPart: MORNING });
  const result = rankSources(destination, [morning]);
  assert.ok(result.recommended);
  assert.equal(result.recommended?.slotId, "morning");
  assert.deepEqual(slotIds(result.compatible), ["morning"]);
});

// 2. A newer other-day-part source is NOT recommended (the older same-day-part
//    one is chosen instead).
test("a newer other-day-part source is not auto-recommended", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const newerAfternoon = makeCandidate({
    slotId: "afternoon-newer",
    anchorDateKey: "2026-07-19",
    startTime: "15:00",
    dayPart: AFTERNOON,
  });
  const olderMorning = makeCandidate({
    slotId: "morning-older",
    anchorDateKey: "2026-07-18",
    startTime: "08:00",
    dayPart: MORNING,
  });
  const result = rankSources(destination, [newerAfternoon, olderMorning]);
  assert.equal(result.recommended?.slotId, "morning-older");
  assert.notEqual(result.recommended?.slotId, "afternoon-newer");
});

// 3. Other-day-part compatible sources still appear in `compatible`.
test("other-day-part compatible sources remain in compatible", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const afternoon = makeCandidate({
    slotId: "afternoon",
    anchorDateKey: "2026-07-19",
    startTime: "15:00",
    dayPart: AFTERNOON,
  });
  const morning = makeCandidate({
    slotId: "morning",
    anchorDateKey: "2026-07-18",
    dayPart: MORNING,
  });
  const result = rankSources(destination, [afternoon, morning]);
  const ids = slotIds(result.compatible);
  assert.ok(ids.includes("afternoon"), "other-day-part source must be selectable manually");
  assert.ok(ids.includes("morning"));
});

// 4. destination.dayPart === "" returns recommended null (but compatible stands).
test('empty destination day-part yields no recommendation', () => {
  const destination = makeDestination({ dayPart: "" });
  const candidate = makeCandidate({ slotId: "c", dayPart: MORNING });
  const result = rankSources(destination, [candidate]);
  assert.equal(result.recommended, null);
  assert.deepEqual(slotIds(result.compatible), ["c"]);
});

// 4b. An absent destination day-part behaves exactly like "".
test("absent destination day-part yields no recommendation", () => {
  const destination = makeDestination();
  delete (destination as { dayPart?: ComplexSourceDayPart }).dayPart;
  const candidate = makeCandidate({ slotId: "c", dayPart: MORNING });
  const result = rankSources(destination, [candidate]);
  assert.equal(result.recommended, null);
  assert.deepEqual(slotIds(result.compatible), ["c"]);
});

// 5. Different courseOfferingId is excluded.
test("a different offering is excluded", () => {
  const destination = makeDestination({ courseOfferingId: "off1" });
  const other = makeCandidate({ slotId: "other", courseOfferingId: "off2" });
  const result = rankSources(destination, [other]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});

// 6. null courseOfferingId matches null only.
test("null offering matches null offering", () => {
  const destination = makeDestination({ courseOfferingId: null });
  const legacy = makeCandidate({ slotId: "legacy", courseOfferingId: null });
  const result = rankSources(destination, [legacy]);
  assert.equal(result.recommended?.slotId, "legacy");
  assert.deepEqual(slotIds(result.compatible), ["legacy"]);
});

// 7. null versus non-null offering is excluded (both directions).
test("null vs non-null offering is excluded in both directions", () => {
  const nullDest = makeDestination({ courseOfferingId: null });
  const realCandidate = makeCandidate({ slotId: "real", courseOfferingId: "off1" });
  const r1 = rankSources(nullDest, [realCandidate]);
  assert.equal(r1.recommended, null);
  assert.deepEqual(r1.compatible, []);

  const realDest = makeDestination({ courseOfferingId: "off1" });
  const nullCandidate = makeCandidate({ slotId: "legacy", courseOfferingId: null });
  const r2 = rankSources(realDest, [nullCandidate]);
  assert.equal(r2.recommended, null);
  assert.deepEqual(r2.compatible, []);
});

// 8. Different group is excluded.
test("a different group is excluded", () => {
  const destination = makeDestination({ resolvedGroup: "A" });
  const otherGroup = makeCandidate({ slotId: "b", resolvedGroup: "B" });
  const result = rankSources(destination, [otherGroup]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});

// 9. The destination slot itself is excluded.
test("the same slot as the destination is excluded", () => {
  const destination = makeDestination({ slotId: "same" });
  const self = makeCandidate({ slotId: "same", anchorDateKey: "2026-07-18" });
  const result = rankSources(destination, [self]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});

// 10. Same-day and future candidates are excluded.
test("same-date and future candidates are excluded", () => {
  const destination = makeDestination({ anchorDateKey: "2026-07-20" });
  const sameDay = makeCandidate({ slotId: "same-day", anchorDateKey: "2026-07-20" });
  const future = makeCandidate({ slotId: "future", anchorDateKey: "2026-07-21" });
  const result = rankSources(destination, [sameDay, future]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});

// 11. A candidate without blocks (blockCount < 1) is excluded.
test("a candidate with no blocks is excluded", () => {
  const destination = makeDestination();
  const empty = makeCandidate({ slotId: "empty", blockCount: 0 });
  const result = rankSources(destination, [empty]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});

// 12. Tie-break: date, then start time, then slotId.
test("tie-break is date, then start time, then slotId", () => {
  const destination = makeDestination({ dayPart: MORNING, anchorDateKey: "2026-07-20" });
  const sameDateTimeLowerSlot = makeCandidate({
    slotId: "s1",
    anchorDateKey: "2026-07-19",
    startTime: "09:00",
  });
  const sameDateTimeHigherSlot = makeCandidate({
    slotId: "s2",
    anchorDateKey: "2026-07-19",
    startTime: "09:00",
  });
  const sameDateEarlierTime = makeCandidate({
    slotId: "s9",
    anchorDateKey: "2026-07-19",
    startTime: "08:00",
  });
  const olderDate = makeCandidate({
    slotId: "s5",
    anchorDateKey: "2026-07-17",
    startTime: "10:00",
  });
  const result = rankSources(destination, [
    sameDateEarlierTime,
    olderDate,
    sameDateTimeLowerSlot,
    sameDateTimeHigherSlot,
  ]);
  // Best-first: newest date wins; within it latest time; within that largest slotId.
  assert.deepEqual(slotIds(result.compatible), ["s2", "s1", "s9", "s5"]);
  assert.equal(result.recommended?.slotId, "s2");
});

// 13. Input ordering does not change the output.
test("output is independent of input order", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const a = makeCandidate({ slotId: "a", anchorDateKey: "2026-07-19", startTime: "09:00" });
  const b = makeCandidate({ slotId: "b", anchorDateKey: "2026-07-18", startTime: "08:00" });
  const c = makeCandidate({
    slotId: "c",
    anchorDateKey: "2026-07-19",
    startTime: "15:00",
    dayPart: AFTERNOON,
  });
  const r1 = rankSources(destination, [a, b, c]);
  const r2 = rankSources(destination, [c, b, a]);
  const r3 = rankSources(destination, [b, a, c]);
  assert.deepEqual(slotIds(r1.compatible), slotIds(r2.compatible));
  assert.deepEqual(slotIds(r1.compatible), slotIds(r3.compatible));
  assert.equal(r1.recommended?.slotId, r2.recommended?.slotId);
  assert.equal(r1.recommended?.slotId, r3.recommended?.slotId);
});

// 14. Inputs are not mutated (including when passed deeply frozen).
test("inputs are never mutated", () => {
  const destination = makeDestination();
  const candidates = [
    makeCandidate({ slotId: "a", anchorDateKey: "2026-07-19" }),
    makeCandidate({ slotId: "b", anchorDateKey: "2026-07-18" }),
  ];
  const snapshot = JSON.stringify(candidates);
  const inputArray = candidates.slice();
  rankSources(destination, candidates);
  // The array and its elements are unchanged.
  assert.equal(JSON.stringify(candidates), snapshot);
  assert.deepEqual(candidates, inputArray);

  // Deeply frozen inputs must not cause a throw (proves no mutation attempt).
  const frozenDestination = Object.freeze(makeDestination());
  const frozenCandidates = Object.freeze([
    Object.freeze(makeCandidate({ slotId: "x", anchorDateKey: "2026-07-19" })),
    Object.freeze(makeCandidate({ slotId: "y", anchorDateKey: "2026-07-18" })),
  ]);
  assert.doesNotThrow(() => rankSources(frozenDestination, frozenCandidates));
});

// 15. Malformed candidates are ignored without throwing.
test("malformed candidates are ignored without throwing", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const good = makeCandidate({ slotId: "good", anchorDateKey: "2026-07-18", dayPart: MORNING });
  const malformed: SourceCandidateDescriptor[] = [
    null as unknown as SourceCandidateDescriptor,
    undefined as unknown as SourceCandidateDescriptor,
    {} as unknown as SourceCandidateDescriptor,
    makeCandidate({ slotId: "", anchorDateKey: "2026-07-18" }), // empty slotId
    makeCandidate({ slotId: "bad-date", anchorDateKey: "2026-13-40" }), // impossible date
    makeCandidate({ slotId: "no-blocks", blockCount: 0 }), // no blocks
    makeCandidate({ slotId: "bad-blocks", blockCount: 1.5 }), // non-integer blocks
    { ...makeCandidate({ slotId: "bad-daypart" }), dayPart: "x" as ComplexSourceDayPart }, // bad day-part
    (() => {
      const c = makeCandidate({ slotId: "no-offering" });
      delete (c as { courseOfferingId?: string | null }).courseOfferingId; // absent offering
      return c;
    })(),
    good,
  ];
  let result: ReturnType<typeof rankSources> | undefined;
  assert.doesNotThrow(() => {
    result = rankSources(destination, malformed);
  });
  assert.ok(result);
  assert.deepEqual(slotIds(result!.compatible), ["good"]);
  assert.equal(result!.recommended?.slotId, "good");
});

// Extra: the result object, its compatible array, and each candidate are frozen
// and never alias the caller's input objects.
test("result is frozen and does not alias inputs", () => {
  const destination = makeDestination({ dayPart: MORNING });
  const input = makeCandidate({ slotId: "c", anchorDateKey: "2026-07-18", dayPart: MORNING });
  const result = rankSources(destination, [input]);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.compatible));
  assert.ok(Object.isFrozen(result.compatible[0]));
  assert.ok(result.recommended && Object.isFrozen(result.recommended));
  assert.notEqual(result.compatible[0], input, "must be a fresh copy, not the input object");
});

// Extra: a non-array candidates argument yields an empty result, not a throw.
test("a non-array candidates argument yields an empty result", () => {
  const destination = makeDestination();
  const result = rankSources(destination, undefined as unknown as SourceCandidateDescriptor[]);
  assert.equal(result.recommended, null);
  assert.deepEqual(result.compatible, []);
});
