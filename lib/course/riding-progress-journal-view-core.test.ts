/**
 * RIDING PROGRESS COURSE SCOPE - S4 tests for the PURE journal view core: the
 * row course projection, the chip label (including the legacy/unscoped case) and
 * the local course filter.
 *
 * Run with: npx tsx --test lib/course/riding-progress-journal-view-core.test.ts
 * No Prisma, no DB, no clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRidingProgressCourseProjection,
  filterRidingProgressRowsByCourse,
  matchesRidingProgressCourseFilter,
  ridingProgressCourseChipLabel,
  RIDING_PROGRESS_COMBINED_AVERAGE_LABEL,
  RIDING_PROGRESS_COURSE_FILTER_OPTIONS,
  RIDING_PROGRESS_DEFAULT_COURSE_FILTER,
  RIDING_PROGRESS_UNSCOPED_COURSE_LABEL,
  type RidingProgressCourseFilter,
} from "./riding-progress-journal-view-core";

const L1 = { id: "offering-l1", name: "קורס מדריכים – רמה 1", level: 1 };
const L2 = { id: "offering-l2", name: "קורס מדריכים – רמה 2", level: 2 };

const row = (offering: typeof L1 | null) => ({
  courseOffering: buildRidingProgressCourseProjection(offering),
});

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

test("a scoped offering projects id, level, name and a level-derived label", () => {
  const projection = buildRidingProgressCourseProjection(L1);
  assert.deepEqual(projection, {
    id: "offering-l1",
    level: 1,
    name: "קורס מדריכים – רמה 1",
    label: "רמה 1",
  });
  assert.equal(buildRidingProgressCourseProjection(L2)?.label, "רמה 2");
});

test("a null/undefined offering projects to null - never a fabricated course", () => {
  assert.equal(buildRidingProgressCourseProjection(null), null);
  assert.equal(buildRidingProgressCourseProjection(undefined), null);
});

test("a partial or malformed offering projects to null rather than a half identity", () => {
  assert.equal(buildRidingProgressCourseProjection({ ...L1, id: "" }), null);
  assert.equal(buildRidingProgressCourseProjection({ ...L1, level: 1.5 }), null);
  assert.equal(
    buildRidingProgressCourseProjection({ ...L1, level: undefined as unknown as number }),
    null,
  );
});

test("the label is derived from LEVEL, never parsed from the offering name", () => {
  const misleading = buildRidingProgressCourseProjection({ ...L1, name: "רמה 2 (שם מטעה)" });
  assert.equal(misleading?.label, "רמה 1");
  assert.equal(misleading?.level, 1);
});

test("an unusual future level still labels consistently", () => {
  assert.equal(buildRidingProgressCourseProjection({ ...L1, level: 3 })?.label, "רמה 3");
});

// ---------------------------------------------------------------------------
// Chip label
// ---------------------------------------------------------------------------

test("the chip shows the course label for a scoped row", () => {
  assert.equal(ridingProgressCourseChipLabel(buildRidingProgressCourseProjection(L1)), "רמה 1");
  assert.equal(ridingProgressCourseChipLabel(buildRidingProgressCourseProjection(L2)), "רמה 2");
});

test("the LEGACY chip is exactly ללא שיוך קורס and never a level", () => {
  assert.equal(ridingProgressCourseChipLabel(null), "ללא שיוך קורס");
  assert.equal(ridingProgressCourseChipLabel(undefined), "ללא שיוך קורס");
  assert.equal(ridingProgressCourseChipLabel(null), RIDING_PROGRESS_UNSCOPED_COURSE_LABEL);
  assert.notEqual(ridingProgressCourseChipLabel(null), "רמה 1");
  assert.notEqual(ridingProgressCourseChipLabel(null), "רמה 2");
});

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

test("the filter offers exactly the four required options, in order", () => {
  assert.deepEqual(
    RIDING_PROGRESS_COURSE_FILTER_OPTIONS.map((o) => o.value),
    ["ALL", "LEVEL_1", "LEVEL_2", "UNSCOPED"],
  );
  assert.deepEqual(
    RIDING_PROGRESS_COURSE_FILTER_OPTIONS.map((o) => o.label),
    ["הכול", "רמה 1", "רמה 2", "ללא שיוך קורס"],
  );
});

test("the default filter is ALL", () => {
  assert.equal(RIDING_PROGRESS_DEFAULT_COURSE_FILTER, "ALL");
});

test("each filter selects exactly the intended rows", () => {
  const rows = [row(L1), row(L2), row(null), row(L1)];
  const ids = (filter: RidingProgressCourseFilter) =>
    filterRidingProgressRowsByCourse(rows, filter).map((r) => r.courseOffering?.level ?? "null");

  assert.deepEqual(ids("ALL"), [1, 2, "null", 1]);
  assert.deepEqual(ids("LEVEL_1"), [1, 1]);
  assert.deepEqual(ids("LEVEL_2"), [2]);
  assert.deepEqual(ids("UNSCOPED"), ["null"]);
});

test("the legacy filter shows unscoped rows and ONLY unscoped rows", () => {
  const rows = [row(L1), row(null), row(L2)];
  const legacy = filterRidingProgressRowsByCourse(rows, "UNSCOPED");
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].courseOffering, null);
});

test("a level filter never matches an unscoped row", () => {
  assert.equal(matchesRidingProgressCourseFilter(row(null), "LEVEL_1"), false);
  assert.equal(matchesRidingProgressCourseFilter(row(null), "LEVEL_2"), false);
  assert.equal(matchesRidingProgressCourseFilter(row(null), "ALL"), true);
});

test("an unknown filter value fails closed to no match", () => {
  assert.equal(
    matchesRidingProgressCourseFilter(row(L1), "NOPE" as unknown as RidingProgressCourseFilter),
    false,
  );
});

test("filtering never mutates or reorders the input", () => {
  const rows = [row(L2), row(null), row(L1)];
  const before = JSON.stringify(rows);
  filterRidingProgressRowsByCourse(rows, "LEVEL_1");
  filterRidingProgressRowsByCourse(rows, "ALL");
  assert.equal(JSON.stringify(rows), before);
  assert.deepEqual(filterRidingProgressRowsByCourse(rows, "ALL"), rows, "ALL preserves order exactly");
});

test("filtering by NAME is impossible - the predicate reads level and null-ness only", () => {
  // Two offerings sharing a level but with different names filter identically.
  const renamed = row({ ...L1, name: "שם אחר לגמרי" });
  assert.equal(matchesRidingProgressCourseFilter(renamed, "LEVEL_1"), true);
  assert.equal(matchesRidingProgressCourseFilter(renamed, "LEVEL_2"), false);
});

// ---------------------------------------------------------------------------
// Average label
// ---------------------------------------------------------------------------

test("the combined-average label is exactly the locked wording", () => {
  assert.equal(RIDING_PROGRESS_COMBINED_AVERAGE_LABEL, "ממוצע משולב לכל הקורסים");
});
