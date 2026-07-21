import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  filterChildren,
  matchesChildSearch,
  type ChildSearchable,
} from "./teaching-practice-child-search";

// A small registry with Hebrew names, a Latin name, mixed phone formats, and
// rows missing parent fields, so each test can isolate one matching rule.
function registry(): ChildSearchable[] {
  return [
    { fullName: "דוד כהן", parentName: "רון כהן", parentPhone: "050-1234567" },
    { fullName: "מעיין לוי", parentName: "שירה לוי", parentPhone: "(052) 765.4321" },
    { fullName: "Noa Adams", parentName: "Dana Adams", parentPhone: "054 111 2222" },
    { fullName: "יונתן בר", parentName: null, parentPhone: null },
  ];
}

test("empty query returns all children in the original order", () => {
  const source = registry();
  const result = filterChildren(source, "");
  assert.deepEqual(
    result.map((c) => c.fullName),
    ["דוד כהן", "מעיין לוי", "Noa Adams", "יונתן בר"],
  );
});

test("whitespace-only query returns all children", () => {
  const source = registry();
  const result = filterChildren(source, "   \t  ");
  assert.equal(result.length, source.length);
});

test("partial Hebrew child-name match", () => {
  const result = filterChildren(registry(), "כה");
  assert.deepEqual(
    result.map((c) => c.fullName),
    ["דוד כהן"],
  );
});

test("case-insensitive Latin match", () => {
  const result = filterChildren(registry(), "NOA");
  assert.deepEqual(
    result.map((c) => c.fullName),
    ["Noa Adams"],
  );
});

test("parent-name match", () => {
  const result = filterChildren(registry(), "שירה");
  assert.deepEqual(
    result.map((c) => c.fullName),
    ["מעיין לוי"],
  );
});

test("parent-phone match despite spaces, hyphens, parentheses and dots", () => {
  // Query formatted differently from the stored value, both directions.
  assert.deepEqual(
    filterChildren(registry(), "0501234567").map((c) => c.fullName),
    ["דוד כהן"],
  );
  assert.deepEqual(
    filterChildren(registry(), "052-765-4321").map((c) => c.fullName),
    ["מעיין לוי"],
  );
  assert.deepEqual(
    filterChildren(registry(), "(054) 111.2222").map((c) => c.fullName),
    ["Noa Adams"],
  );
});

test("leading/trailing and consecutive query spaces are normalized", () => {
  const result = filterChildren(registry(), "  דוד   כהן  ");
  assert.deepEqual(
    result.map((c) => c.fullName),
    ["דוד כהן"],
  );
});

test("null parent fields do not throw and simply do not match those fields", () => {
  const rows = registry();
  // A query that only a parent field could satisfy must skip the null row
  // without error, while a child-name query still finds it.
  assert.doesNotThrow(() => filterChildren(rows, "0501234567"));
  assert.deepEqual(
    filterChildren(rows, "יונתן").map((c) => c.fullName),
    ["יונתן בר"],
  );
});

test("no match returns an empty list", () => {
  assert.deepEqual(filterChildren(registry(), "אין-כזה-שם"), []);
});

test("notes, age, gender and horse name never produce a match", () => {
  // Rows carrying extra fields that must be ignored by the search.
  const rows = [
    {
      fullName: "טל אבן",
      parentName: "אבי אבן",
      parentPhone: "0500000000",
      notes: "UNIQUENOTE",
      age: 12,
      gender: "MALE",
      defaultHorseName: "UNIQUEHORSE",
    },
  ];
  assert.deepEqual(filterChildren(rows, "UNIQUENOTE"), []);
  assert.deepEqual(filterChildren(rows, "12"), []);
  assert.deepEqual(filterChildren(rows, "MALE"), []);
  assert.deepEqual(filterChildren(rows, "UNIQUEHORSE"), []);
});

test("the input array is not mutated", () => {
  const source = registry();
  const snapshot = source.map((c) => c.fullName);
  filterChildren(source, "כהן");
  filterChildren(source, "");
  assert.deepEqual(
    source.map((c) => c.fullName),
    snapshot,
  );
  assert.equal(source.length, 4);
});

test("empty-query result is a copy, not the same reference", () => {
  const source = registry();
  const result = filterChildren(source, "");
  assert.notEqual(result, source);
});

test("matchesChildSearch: empty query matches, unrelated query does not", () => {
  const child: ChildSearchable = {
    fullName: "דוד כהן",
    parentName: "רון כהן",
    parentPhone: "050-1234567",
  };
  assert.equal(matchesChildSearch(child, ""), true);
  assert.equal(matchesChildSearch(child, "מעיין"), false);
});

// ---------------------------------------------------------------------------
// Source-contract checks over the one component that wires the search in.
// These assert meaningful behavioral wiring (which list is rendered, which
// handlers clear the query, which states are preserved) without a brittle
// full-component render or broad string-count snapshot.
// ---------------------------------------------------------------------------
const COMPONENT_SOURCE = readFileSync(
  fileURLToPath(new URL("./components/TeachingPracticeManager.tsx", import.meta.url)),
  "utf8",
);

// Extracts the text of a `function <name>(...) { ... }` block by matching
// braces from the opening `{` of its body, so the slice stops exactly at the
// function's own closing brace (robust regardless of what follows it).
function componentFunctionBody(name: string): string {
  const decl = COMPONENT_SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(decl, -1, `expected to find function ${name}`);
  const open = COMPONENT_SOURCE.indexOf("{", decl);
  assert.notEqual(open, -1, `expected an opening brace for function ${name}`);
  let depth = 0;
  for (let i = open; i < COMPONENT_SOURCE.length; i++) {
    const ch = COMPONENT_SOURCE[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return COMPONENT_SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces for function ${name}`);
}

test("contract: registry list renders the filtered children, not the raw list", () => {
  assert.ok(
    COMPONENT_SOURCE.includes("{filteredChildren.map((child) => ("),
    "expected the registry list to map filteredChildren",
  );
  assert.ok(
    !COMPONENT_SOURCE.includes("{children.map((child) => ("),
    "the registry list must not map the raw children array",
  );
});

test("contract: original-empty and filtered-no-results are distinct preserved states", () => {
  assert.ok(COMPONENT_SOURCE.includes("טרם נוספו ילדים."), "original empty-registry state preserved");
  assert.ok(
    COMPONENT_SOURCE.includes("לא נמצאו ילדים התואמים לחיפוש."),
    "distinct filtered-no-results state present",
  );
});

test("contract: filtered feedback is exposed via an aria-live region", () => {
  assert.ok(COMPONENT_SOURCE.includes('aria-live="polite"'));
});

test("contract: the clear control and its accessible name exist", () => {
  assert.ok(COMPONENT_SOURCE.includes('aria-label="נקה חיפוש"'));
});

test("contract: successful child creation clears the search query", () => {
  assert.ok(
    componentFunctionBody("handleCreateChild").includes('setChildSearch("")'),
    "handleCreateChild must clear the search",
  );
});

test("contract: edit, activation/deactivation and import do not clear the search", () => {
  assert.ok(
    !componentFunctionBody("handleSaveChild").includes("setChildSearch"),
    "editing must not touch the search query",
  );
  assert.ok(
    !componentFunctionBody("handleToggleChildActive").includes("setChildSearch"),
    "activation/deactivation must not touch the search query",
  );
  assert.ok(
    !componentFunctionBody("handleCommitChildImport").includes("setChildSearch"),
    "import must not touch the search query",
  );
});
