/**
 * The contract of the admin exam assignments scroll fix.
 *
 * Saving or editing an assignment card on the admin exam assignments
 * workspace (app/admin/courses/[courseOfferingId]/exams) is a
 * `<form action={...}>` whose Server Action ends in `redirect()` back to the
 * same route. Next.js's default is to scroll to the top of the page on that
 * navigation whenever the top of the page is out of the viewport — exactly
 * the case for a manager scrolled deep into the assignments list. This
 * component fixes that: it captures the scroll offset right before any form
 * on the route submits, and restores it once the redirected render lands,
 * instead of letting the browser land back at the top.
 *
 * REAL RENDER (the component takes no props and its only imports are
 * `react` and `next/navigation`, so it renders with react-dom/server in a
 * plain `tsx --test` process) PLUS SOURCE CONTRACT assertions for the
 * submit-capture and restore behavior, which needs a live DOM `document`
 * this project's test harness does not provide.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamAssignmentsScrollRestore.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamAssignmentsScrollRestore } from "./ExamAssignmentsScrollRestore";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamAssignmentsScrollRestore.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);

const LAYOUT_SOURCE = readFileSync(join(REPO_ROOT, "app", "admin", "layout.tsx"), "utf8");

// ===========================================================================
// 1. It renders nothing
// ===========================================================================

test("1. the component renders no markup of its own", () => {
  assert.equal(renderToStaticMarkup(<ExamAssignmentsScrollRestore />), "");
});

// ===========================================================================
// 2. It captures the real scroll offset, not a fixed position
// ===========================================================================

test("2. it records window.scrollY on every form submit, in the capture phase", () => {
  assert.ok(
    CODE.includes('document.addEventListener("submit", handleSubmit, true)'),
    "it does not listen for submit in the capture phase on document",
  );
  assert.ok(
    CODE.includes("pendingScrollY = window.scrollY"),
    "it does not capture the real scroll offset",
  );
});

// ===========================================================================
// 3. It restores the captured offset, and never hardcodes the top
// ===========================================================================

test("3. it restores scroll to the captured offset, never to (0, 0)", () => {
  assert.ok(
    /window\.scrollTo\(0,\s*y\)/.test(CODE),
    "it does not restore to the captured offset",
  );
  for (const topLiteral of ["scrollTo(0, 0)", "scrollTo(0,0)"]) {
    assert.equal(CODE.includes(topLiteral), false, `it hardcodes a scroll to the top via ${topLiteral}`);
  }
});

// ===========================================================================
// 4. No storage API, no other route affected
// ===========================================================================

test("4. it uses no storage API, only an in-memory value", () => {
  for (const forbidden of ["sessionStorage", "localStorage"]) {
    assert.equal(CODE.includes(forbidden), false, `it reaches ${forbidden}`);
  }
  assert.ok(CODE.includes("let pendingScrollY: number | null = null;"));
});

test("5. it only acts on the exam assignments route", () => {
  assert.ok(
    CODE.includes("/^\\/admin\\/courses\\/[^/]+\\/exams(?:\\/|$)/"),
    "the route guard regex is missing or was changed",
  );
  assert.ok(CODE.includes("if (!onRoute) return;"));
  assert.ok(CODE.includes("if (!onRoute || pendingScrollY === null) return;"));
});

// ===========================================================================
// 6. It is wired into the admin layout, exactly once, and stays inert markup
// ===========================================================================

test("6. the admin layout mounts it exactly once", () => {
  assert.ok(
    LAYOUT_SOURCE.includes(
      'import { ExamAssignmentsScrollRestore } from "@/lib/components/ExamAssignmentsScrollRestore";',
    ),
    "the admin layout does not import the fix",
  );
  assert.equal(
    (LAYOUT_SOURCE.match(/<ExamAssignmentsScrollRestore \/>/g) ?? []).length,
    1,
    "the admin layout must render it exactly once",
  );
});
