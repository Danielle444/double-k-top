/**
 * MULTI-COURSE (dormant foundation, Slice 5) - executable tests for the PURE
 * CourseOffering group-hierarchy core.
 *
 * Run with: npx tsx --test lib/course/course-group-tree-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCourseGroupTree,
  type CourseGroupTreeRow,
} from "./course-group-tree-core";

function row(over: Partial<CourseGroupTreeRow> = {}): CourseGroupTreeRow {
  return {
    id: "g1",
    name: "A",
    parentGroupId: null,
    ...over,
  };
}

/** A subgroup row pointing at a parent by id. */
function child(id: string, name: string, parentGroupId: string): CourseGroupTreeRow {
  return { id, name, parentGroupId };
}

// --- A. cardinality ----------------------------------------------------------

test("empty input yields empty top-level and empty anomalies", () => {
  assert.deepEqual(buildCourseGroupTree([]), { topLevel: [], anomalies: [] });
});

test("a single top-level group with no children", () => {
  const view = buildCourseGroupTree([row({ id: "t1", name: "א" })]);
  assert.deepEqual(view, {
    topLevel: [{ id: "t1", name: "א", subgroups: [] }],
    anomalies: [],
  });
});

test("multiple top-level groups are all present", () => {
  const view = buildCourseGroupTree([
    row({ id: "t1", name: "א" }),
    row({ id: "t2", name: "ב" }),
  ]);
  assert.equal(view.topLevel.length, 2);
  assert.deepEqual(view.anomalies, []);
});

// --- B. child placement ------------------------------------------------------

test("children are attached to their correct parent", () => {
  const view = buildCourseGroupTree([
    row({ id: "t1", name: "א" }),
    row({ id: "t2", name: "ב" }),
    child("c1", "1", "t1"),
    child("c2", "2", "t1"),
    child("c3", "1", "t2"),
  ]);
  const t1 = view.topLevel.find((n) => n.id === "t1");
  const t2 = view.topLevel.find((n) => n.id === "t2");
  assert.deepEqual(
    t1?.subgroups.map((s) => s.id),
    ["c1", "c2"],
  );
  assert.deepEqual(
    t2?.subgroups.map((s) => s.id),
    ["c3"],
  );
  assert.deepEqual(view.anomalies, []);
});

// --- C. deterministic ordering ----------------------------------------------

test("top-level groups are ordered by name then id, independent of input order", () => {
  const rows = [
    row({ id: "z", name: "ג" }),
    row({ id: "a", name: "א" }),
    row({ id: "m", name: "ב" }),
  ];
  const forward = buildCourseGroupTree(rows).topLevel.map((n) => n.name);
  const reversed = buildCourseGroupTree([...rows].reverse()).topLevel.map((n) => n.name);
  assert.deepEqual(forward, ["א", "ב", "ג"]);
  assert.deepEqual(reversed, ["א", "ב", "ג"]);
});

test("equal names fall back to a stable id tie-break", () => {
  const view = buildCourseGroupTree([
    row({ id: "b", name: "same" }),
    row({ id: "a", name: "same" }),
  ]);
  assert.deepEqual(
    view.topLevel.map((n) => n.id),
    ["a", "b"],
  );
});

test("subgroups are ordered by name then id, independent of input order", () => {
  const rows = [
    row({ id: "t1", name: "א" }),
    child("c3", "3", "t1"),
    child("c1", "1", "t1"),
    child("c2", "2", "t1"),
  ];
  const subs = buildCourseGroupTree(rows).topLevel[0].subgroups.map((s) => s.name);
  assert.deepEqual(subs, ["1", "2", "3"]);
});

// --- D. anomalies (surfaced, never silently dropped, never fabricated) -------

test("an orphaned parent id is reported, not dropped, and no parent is fabricated", () => {
  const view = buildCourseGroupTree([child("c1", "1", "missing")]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "c1", parentGroupId: "missing", reason: "ORPHANED_PARENT" },
  ]);
});

test("a row referencing itself is reported as SELF_REFERENCE, not treated as its own child", () => {
  const view = buildCourseGroupTree([{ id: "s1", name: "loop", parentGroupId: "s1" }]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "s1", parentGroupId: "s1", reason: "SELF_REFERENCE" },
  ]);
});

test("a child of a subgroup (over-deep) is reported as NON_TOPLEVEL_PARENT", () => {
  const view = buildCourseGroupTree([
    row({ id: "t1", name: "א" }),
    child("c1", "1", "t1"),
    child("g1", "deep", "c1"),
  ]);
  assert.deepEqual(
    view.topLevel.map((n) => n.id),
    ["t1"],
  );
  assert.deepEqual(
    view.topLevel[0].subgroups.map((s) => s.id),
    ["c1"],
  );
  assert.deepEqual(view.anomalies, [
    { id: "g1", parentGroupId: "c1", reason: "NON_TOPLEVEL_PARENT" },
  ]);
});

test("a two-node parent cycle emits no nodes; both rows are NON_TOPLEVEL_PARENT", () => {
  const view = buildCourseGroupTree([
    { id: "a", name: "A", parentGroupId: "b" },
    { id: "b", name: "B", parentGroupId: "a" },
  ]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "a", parentGroupId: "b", reason: "NON_TOPLEVEL_PARENT" },
    { id: "b", parentGroupId: "a", reason: "NON_TOPLEVEL_PARENT" },
  ]);
});

test("a longer parent cycle emits no nodes; every row is NON_TOPLEVEL_PARENT", () => {
  const view = buildCourseGroupTree([
    { id: "a", name: "A", parentGroupId: "b" },
    { id: "b", name: "B", parentGroupId: "c" },
    { id: "c", name: "C", parentGroupId: "a" },
  ]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "a", parentGroupId: "b", reason: "NON_TOPLEVEL_PARENT" },
    { id: "b", parentGroupId: "c", reason: "NON_TOPLEVEL_PARENT" },
    { id: "c", parentGroupId: "a", reason: "NON_TOPLEVEL_PARENT" },
  ]);
});

test("a child of a self-referencing parent is not attached and gets NON_TOPLEVEL_PARENT", () => {
  const view = buildCourseGroupTree([
    { id: "s1", name: "loop", parentGroupId: "s1" },
    child("c1", "1", "s1"),
  ]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "c1", parentGroupId: "s1", reason: "NON_TOPLEVEL_PARENT" },
    { id: "s1", parentGroupId: "s1", reason: "SELF_REFERENCE" },
  ]);
});

test("duplicate ids default safely: first occurrence wins, later ones are DUPLICATE_ID", () => {
  const view = buildCourseGroupTree([
    row({ id: "t1", name: "first" }),
    row({ id: "t1", name: "second" }),
  ]);
  // Only the first occurrence appears in the tree.
  assert.deepEqual(view.topLevel, [{ id: "t1", name: "first", subgroups: [] }]);
  assert.deepEqual(view.anomalies, [
    { id: "t1", parentGroupId: null, reason: "DUPLICATE_ID" },
  ]);
});

test("same id producing DUPLICATE_ID + SELF_REFERENCE orders by ANOMALY_REASON_RANK", () => {
  // First occurrence is the authoritative self-referencing row; the second same-id
  // row is a duplicate. Both anomalies share id "x", so ordering is by reason rank:
  // DUPLICATE_ID (0) before SELF_REFERENCE (1).
  const view = buildCourseGroupTree([
    { id: "x", name: "loop", parentGroupId: "x" },
    { id: "x", name: "again", parentGroupId: null },
  ]);
  assert.deepEqual(view.topLevel, []);
  assert.deepEqual(view.anomalies, [
    { id: "x", parentGroupId: null, reason: "DUPLICATE_ID" },
    { id: "x", parentGroupId: "x", reason: "SELF_REFERENCE" },
  ]);
});

test("anomalies are ordered deterministically by id then reason", () => {
  const view = buildCourseGroupTree([
    child("b", "1", "missing"),
    { id: "a", name: "loop", parentGroupId: "a" },
  ]);
  assert.deepEqual(view.anomalies, [
    { id: "a", parentGroupId: "a", reason: "SELF_REFERENCE" },
    { id: "b", parentGroupId: "missing", reason: "ORPHANED_PARENT" },
  ]);
});

// --- E. purity / shape guarantees -------------------------------------------

test("the input array and its rows are not mutated", () => {
  const rows: CourseGroupTreeRow[] = [
    row({ id: "t2", name: "ב" }),
    row({ id: "t1", name: "א" }),
    child("c1", "1", "t1"),
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  buildCourseGroupTree(rows);
  assert.deepEqual(rows, snapshot);
});

test("output shape carries no Student/enrollment/membership fields", () => {
  const view = buildCourseGroupTree([
    row({ id: "t1", name: "א" }),
    child("c1", "1", "t1"),
  ]);
  const forbidden = /student|enroll|member|phone|identity|subgroupnumber|count|date/i;

  for (const node of view.topLevel) {
    assert.deepEqual(Object.keys(node).sort(), ["id", "name", "subgroups"]);
    for (const key of Object.keys(node)) {
      assert.ok(!forbidden.test(key), `unexpected top-level key: ${key}`);
    }
    for (const sub of node.subgroups) {
      assert.deepEqual(Object.keys(sub).sort(), ["id", "name"]);
      for (const key of Object.keys(sub)) {
        assert.ok(!forbidden.test(key), `unexpected subgroup key: ${key}`);
      }
    }
  }
  for (const anomaly of view.anomalies) {
    assert.deepEqual(Object.keys(anomaly).sort(), ["id", "parentGroupId", "reason"]);
  }
});
