/**
 * LEVEL 2 DEFAULT HORSE - DB-free tests for the pure core.
 *
 * Run: npx tsx --test lib/course/level2-default-horse-core.test.ts
 * No Prisma, no DB: raw roster rows + explicit horse/active-offering maps are fed
 * to the pure builder and to the single editability authority, proving the dual-
 * enrollment guard, the resolved default-horse shape, one-row-per-trainee, and
 * deterministic ordering — without a live database. The empty/whitespace->null
 * contract the write action relies on is re-confirmed through normalizeHorse.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLevel2DefaultHorseRows,
  isDefaultHorseEditable,
  type BuildLevel2DefaultHorseRowsInput,
  type Level2HorseTriple,
  type Level2RosterEnrollmentRow,
} from "./level2-default-horse-core";
import { normalizeHorse } from "@/lib/trainee-history/normalize-horse";

const L2 = "offering-level-2";
const L1 = "offering-level-1";

function enrollment(
  studentId: string,
  fullName: string,
  subgroupLabel: string | null,
): Level2RosterEnrollmentRow {
  return { studentId, fullName, subgroupLabel, membershipState: "OK" };
}

// --- isDefaultHorseEditable: the single dual-enrollment authority ------------

test("editable iff the ACTIVE-offering set is EXACTLY this offering", () => {
  assert.equal(isDefaultHorseEditable(new Set([L2]), L2), true); // Level-2-only
  assert.equal(isDefaultHorseEditable(new Set([L1, L2]), L2), false); // dual
  assert.equal(isDefaultHorseEditable(new Set([L1]), L2), false); // not enrolled here
  assert.equal(isDefaultHorseEditable(new Set<string>(), L2), false); // none
  assert.equal(isDefaultHorseEditable(undefined, L2), false); // unknown
  assert.equal(isDefaultHorseEditable(new Set([L2]), ""), false); // no offering id
});

// --- buildLevel2DefaultHorseRows ---------------------------------------------

function baseInput(): BuildLevel2DefaultHorseRowsInput {
  const horseByStudentId = new Map<string, Level2HorseTriple>([
    // Level-2-only trainee: a course (assigned) horse.
    ["s-avi", { hasPrivateHorse: false, privateHorseName: null, assignedHorseName: "רוח" }],
    // Dual trainee: their inherited Level 1 private horse.
    ["s-ben", { hasPrivateHorse: true, privateHorseName: "ברק", assignedHorseName: null }],
  ]);
  const activeOfferingIdsByStudentId = new Map<string, Set<string>>([
    ["s-avi", new Set([L2])],
    ["s-ben", new Set([L1, L2])],
    ["s-gil", new Set([L2])],
  ]);
  return {
    enrollments: [
      enrollment("s-ben", "בן", "ג / 2"),
      enrollment("s-avi", "אבי", "ג / 1"),
      enrollment("s-gil", "גיל", "ג / 3"), // no horse-map entry -> "none"
    ],
    thisOfferingId: L2,
    horseByStudentId,
    activeOfferingIdsByStudentId,
  };
}

test("Level-2-only trainee is editable with correct group/subgroup and resolved horse", () => {
  const rows = buildLevel2DefaultHorseRows(baseInput());
  const avi = rows.find((r) => r.studentId === "s-avi");
  assert.ok(avi);
  assert.equal(avi.editable, true);
  assert.equal(avi.subgroupLabel, "ג / 1");
  assert.equal(avi.horseBadgeType, "assigned");
  assert.equal(avi.horseNameDisplay, "רוח");
});

test("dual trainee appears once, read-only, showing the inherited horse", () => {
  const rows = buildLevel2DefaultHorseRows(baseInput());
  const bens = rows.filter((r) => r.studentId === "s-ben");
  assert.equal(bens.length, 1); // exactly once
  assert.equal(bens[0].editable, false); // read-only
  assert.equal(bens[0].horseBadgeType, "private");
  assert.equal(bens[0].horseNameDisplay, "ברק"); // inherited L1 default
});

test("a trainee with no horse record resolves to the 'none' default and stays editable when L2-only", () => {
  const rows = buildLevel2DefaultHorseRows(baseInput());
  const gil = rows.find((r) => r.studentId === "s-gil");
  assert.ok(gil);
  assert.equal(gil.editable, true);
  assert.equal(gil.horseBadgeType, "none");
  assert.equal(gil.horseNameDisplay, "לא שובץ סוס");
});

test("every enrollment appears exactly once and order is deterministic (Hebrew name asc)", () => {
  const rows = buildLevel2DefaultHorseRows(baseInput());
  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((r) => r.fullName),
    ["אבי", "בן", "גיל"],
  );
});

test("the core never mutates its input", () => {
  const input = baseInput();
  const before = input.enrollments.map((e) => e.studentId).join(",");
  buildLevel2DefaultHorseRows(input);
  assert.equal(input.enrollments.map((e) => e.studentId).join(","), before);
});

// --- empty/whitespace -> null, the contract the write action depends on ------

test("empty/whitespace horse name normalizes to null (write-action contract)", () => {
  const assigned = normalizeHorse({
    assignedHorseName: "   ",
    hasPrivateHorse: false,
    privateHorseName: null,
  });
  assert.equal(assigned.ok, true);
  assert.equal(assigned.ok && assigned.value.assignedHorseName, null);

  const priv = normalizeHorse({
    assignedHorseName: null,
    hasPrivateHorse: true,
    privateHorseName: "  ",
  });
  assert.equal(priv.ok, true);
  assert.equal(priv.ok && priv.value.privateHorseName, null);
  assert.equal(priv.ok && priv.value.hasPrivateHorse, true);
});
