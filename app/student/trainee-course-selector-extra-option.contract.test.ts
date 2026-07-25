/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U1 (UI CORRECTION): contract tests for
 * TraineeCourseSelector's optional trailing pseudo-option pill (extraOption),
 * added so the schedule tab can show ONE row - [ Level 1 ] [ Level 2 ]
 * [ הלו״ז שלי ] - instead of the real course pills plus a separate toggle.
 *
 * SOURCE-CONTRACT, consistent with every other trainee-schedule test in this
 * directory (see schedule-card-info-details.contract.test.ts) - kept for
 * convention consistency even though this particular file only type-imports
 * from a "use server" module.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-course-selector-extra-option.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./TraineeCourseSelector.tsx");

test("extraOption is optional and shaped as label/isActive/onSelect - never a CourseOffering id", () => {
  const propsStart = SRC.indexOf("interface TraineeCourseSelectorProps");
  const propsEnd = SRC.indexOf("\n}", propsStart);
  const propsBlock = SRC.slice(propsStart, propsEnd);
  assert.match(propsBlock, /extraOption\?:\s*\{\s*label:\s*string;\s*isActive:\s*boolean;\s*onSelect:\s*\(\)\s*=>\s*void;\s*\}/);
});

test("the component still returns null for a single-/zero-course trainee, regardless of extraOption", () => {
  assert.match(SRC, /if \(options\.length <= 1\) return null;/);
  const earlyReturnIdx = SRC.indexOf("if (options.length <= 1) return null;");
  const extraOptionUseIdx = SRC.indexOf("{extraOption &&");
  assert.ok(earlyReturnIdx < extraOptionUseIdx, "the early return must precede any extraOption rendering");
});

test("the pseudo-option pill renders inside the SAME flex row as the real course pills - one selector row, not two", () => {
  const rowStart = SRC.indexOf('<div className="flex flex-wrap gap-2">');
  assert.notEqual(rowStart, -1);
  const rowEnd = SRC.lastIndexOf("</div>");
  const row = SRC.slice(rowStart, rowEnd);
  assert.ok(row.includes("{options.map((option) =>"), "expected the real course pills inside the row");
  assert.ok(row.includes("{extraOption && ("), "expected the pseudo-pill inside the SAME row, not a separate block/row");
});

test("the pseudo-pill's highlight/selection is driven ONLY by extraOption.isActive/onSelect - never selectedId/onSelect", () => {
  const pillStart = SRC.indexOf("{extraOption && (");
  const pillEnd = SRC.indexOf(")}", pillStart) + 2;
  const pill = SRC.slice(pillStart, pillEnd);
  assert.ok(pill.includes("aria-pressed={extraOption.isActive}"));
  assert.ok(pill.includes("onClick={extraOption.onSelect}"));
  assert.ok(pill.includes("{extraOption.label}"));
  assert.ok(!/selectedId|onSelect\(option\.id\)/.test(pill), "the pseudo-pill must never read selectedId or call the real onSelect(id) path");
});

test("no CourseOffering id or Prisma/DB concept is referenced anywhere near extraOption - it is a pure UI toggle", () => {
  const pillStart = SRC.indexOf("{extraOption && (");
  const pillEnd = SRC.indexOf(")}", pillStart) + 2;
  const pill = SRC.slice(pillStart, pillEnd);
  assert.ok(!/courseOfferingId|CourseOffering|prisma/i.test(pill));
});
