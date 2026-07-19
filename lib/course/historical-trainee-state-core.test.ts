/**
 * Executable regression tests for the PURE historical group/horse resolver
 * (W6D3-HOTFIX). No Prisma, no DB. Run with:
 *   npx tsx --test lib/course/historical-trainee-state-core.test.ts
 *
 * Encodes the exact reported production case: a trainee historically in group
 * א1 riding בילי, changed TODAY to group ב5 riding קאי. Past records must keep
 * א1 / בילי; only today-forward is ב5 / קאי. There is no Student-mirror input to
 * these functions at all, so a current-mirror fallback is structurally impossible.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { RawMembership } from "./enrollment-view";
import {
  resolveHistoricalGroup,
  resolveHistoricalHorse,
  type HorseIntervalRow,
} from "./historical-trainee-state-core";

const D = (key: string) => new Date(`${key}T00:00:00.000Z`);
const TODAY = D("2026-07-19");
const BEFORE = D("2026-07-10");

function membership(
  from: string,
  to: string | null,
  groupName: string,
  parentName: string | null,
): RawMembership {
  return {
    effectiveFrom: D(from),
    effectiveTo: to === null ? null : D(to),
    courseGroup: {
      name: groupName,
      parentGroupId: parentName === null ? null : "parent-id",
      parentGroup: parentName === null ? null : { name: parentName },
    },
  };
}

// Old א1 closed at today; new ב5 opens today (exactly how the group writer records it).
const GROUP_HISTORY: RawMembership[] = [
  membership("2026-01-01", "2026-07-19", "1", "א"),
  membership("2026-07-19", null, "5", "ב"),
];

// Old בילי closed at today; new קאי opens today.
const horse = (from: string, to: string | null, name: string): HorseIntervalRow => ({
  effectiveFrom: D(from),
  effectiveTo: to === null ? null : D(to),
  hasPrivateHorse: false,
  privateHorseName: null,
  assignedHorseName: name,
});
const HORSE_HISTORY: HorseIntervalRow[] = [
  horse("2026-01-01", "2026-07-19", "בילי"),
  horse("2026-07-19", null, "קאי"),
];

// --- H.1 / H.3 / H.5: historical date keeps the OLD group; no mirror fallback ---

test("group before the change resolves to א1 (duty/feedback before change)", () => {
  const result = resolveHistoricalGroup(GROUP_HISTORY, BEFORE);
  assert.deepEqual(result, { ok: true, value: { groupName: "א", subgroupNumber: 1 } });
});

test("horse before the change resolves to בילי (feedback before change)", () => {
  const result = resolveHistoricalHorse(HORSE_HISTORY, BEFORE);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.value.assignedHorseName, "בילי");
});

// --- H.2 / H.4 / H.7: on/after the change is the NEW group; half-open boundary ---

test("group ON the change date is ב5 — effectiveTo belongs to the NEW interval", () => {
  const result = resolveHistoricalGroup(GROUP_HISTORY, TODAY);
  assert.deepEqual(result, { ok: true, value: { groupName: "ב", subgroupNumber: 5 } });
});

test("horse ON the change date is קאי — half-open boundary", () => {
  const result = resolveHistoricalHorse(HORSE_HISTORY, TODAY);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.value.assignedHorseName, "קאי");
});

test("the day BEFORE the change still resolves to the old interval (boundary − 1)", () => {
  assert.deepEqual(resolveHistoricalGroup(GROUP_HISTORY, D("2026-07-18")), {
    ok: true,
    value: { groupName: "א", subgroupNumber: 1 },
  });
});

// --- H.6: missing history never fabricates the current value ---

test("a date before any interval fails closed — never fabricates a current group", () => {
  assert.deepEqual(resolveHistoricalGroup(GROUP_HISTORY, D("2025-01-01")), {
    ok: false,
    kind: "NO_COVERING_MEMBERSHIP",
  });
});

test("a date before any horse interval fails closed — never fabricates a current horse", () => {
  assert.deepEqual(resolveHistoricalHorse(HORSE_HISTORY, D("2025-01-01")), {
    ok: false,
    kind: "NO_COVERING_INTERVAL",
  });
});

// --- fail-closed on ambiguous / malformed data ---

test("multiple covering memberships fail closed", () => {
  const overlapping: RawMembership[] = [
    membership("2026-01-01", null, "1", "א"),
    membership("2026-02-01", null, "5", "ב"),
  ];
  assert.deepEqual(resolveHistoricalGroup(overlapping, BEFORE), {
    ok: false,
    kind: "MULTIPLE_COVERING_MEMBERSHIPS",
  });
});

test("multiple covering horse intervals fail closed", () => {
  const overlapping: HorseIntervalRow[] = [
    horse("2026-01-01", null, "בילי"),
    horse("2026-02-01", null, "קאי"),
  ];
  assert.deepEqual(resolveHistoricalHorse(overlapping, BEFORE), {
    ok: false,
    kind: "MULTIPLE_COVERING_INTERVALS",
  });
});

test("malformed subgroup name fails closed (no relabel)", () => {
  const bad: RawMembership[] = [membership("2026-01-01", null, "abc", "א")];
  assert.deepEqual(resolveHistoricalGroup(bad, BEFORE), {
    ok: false,
    kind: "MALFORMED_SUBGROUP",
  });
});

test("missing parent group fails closed", () => {
  const orphan: RawMembership[] = [
    {
      effectiveFrom: D("2026-01-01"),
      effectiveTo: null,
      courseGroup: { name: "1", parentGroupId: "parent-id", parentGroup: null },
    },
  ];
  assert.deepEqual(resolveHistoricalGroup(orphan, BEFORE), {
    ok: false,
    kind: "MISSING_PARENT_GROUP",
  });
});

test("a top-level covering membership (no parent) maps to its own name, subgroup null", () => {
  const topLevel: RawMembership[] = [membership("2026-01-01", null, "א", null)];
  assert.deepEqual(resolveHistoricalGroup(topLevel, BEFORE), {
    ok: true,
    value: { groupName: "א", subgroupNumber: null },
  });
});
