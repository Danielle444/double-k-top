/**
 * Pure tests for the student riding-session presentation decision
 * (resolveStudentRidingPresentation in app/student/student-riding-presentation.ts).
 * These pin down Fix 1: a complex-mode riding slot is shown to trainees as
 * "תרגול הדרכה" and never with the generic assignment coach/arena box;
 * ordinary (non-complex) riding is unchanged; complexity is taken only from
 * the typed isComplex flag, never from the title text or publication state.
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test app/student/student-riding-presentation.test.ts
 *
 * Pure: the module under test imports only the pure getStudentScheduleTitle
 * helper (ScheduleItemView is a type-only import, erased at runtime), so this
 * test loads no Client Component, no React, and no Prisma - no DB is
 * instantiated, connected to, or queried. Plain-data fixtures only.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolveStudentRidingPresentation, COMPLEX_RIDING_TITLE } from "./student-riding-presentation";
import type { ScheduleItemView } from "@/lib/actions/student-schedule";

type PresentationInput = Pick<
  ScheduleItemView,
  "isComplex" | "title" | "ridingInfo" | "publishedComplexRidingPlan"
>;

const GENERIC_RIDING_INFO: ScheduleItemView["ridingInfo"] = {
  instructorName: "מאמן/ת",
  arena: "מגרש 1",
  subgroupLabel: null,
};

// Minimal stand-in for a published complex plan - the resolver only checks
// presence (!== null), never reads into it.
const PUBLISHED_PLAN = { blocks: [] } as unknown as NonNullable<
  ScheduleItemView["publishedComplexRidingPlan"]
>;

// 1. complex + published: complex title, generic info suppressed, published
// complex details remain available.
test("complex + published: title תרגול הדרכה, generic riding info hidden, complex plan shown", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null, // data layer already suppresses generic info for complex
    publishedComplexRidingPlan: PUBLISHED_PLAN,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, COMPLEX_RIDING_TITLE);
  assert.equal(p.title, "תרגול הדרכה");
  assert.equal(p.showGenericRidingInfo, false);
  assert.equal(p.showComplexPlan, true);
});

// 2. complex + unpublished: still complex title, generic info suppressed, and
// nothing complex exposed (no publication).
test("complex + unpublished: title תרגול הדרכה, generic riding info hidden, no complex details exposed", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, COMPLEX_RIDING_TITLE);
  assert.equal(p.showGenericRidingInfo, false);
  assert.equal(p.showComplexPlan, false);
});

// Defense in depth: even if a complex item somehow still carried a generic
// ridingInfo, the generic box is never shown for a complex slot.
test("complex slot never shows generic coach/arena even if ridingInfo is present", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
  };
  assert.equal(resolveStudentRidingPresentation(item).showGenericRidingInfo, false);
});

// 3. ordinary riding: unchanged - "רכיבה" title and the generic coach/arena
// box shown exactly as before.
test("ordinary riding: title רכיבה, generic coach/arena shown", () => {
  const item: PresentationInput = {
    isComplex: false,
    title: "רכיבה - מעברים",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.equal(p.showGenericRidingInfo, true);
  assert.equal(p.showComplexPlan, false);
});

// Ordinary riding with no visible fields: title unchanged, no info box.
test("ordinary riding with nothing visible: title רכיבה, no generic info box", () => {
  const item: PresentationInput = {
    isComplex: false,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.equal(p.showGenericRidingInfo, false);
});

// 4. unrelated non-riding item: entirely unchanged existing behavior.
test("unrelated non-riding item: existing title behavior, no riding info, no complex plan", () => {
  const item: PresentationInput = {
    isComplex: false,
    title: "מתודיקה - משוב",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "מתודיקה"); // getStudentScheduleTitle behavior, unchanged
  assert.equal(p.showGenericRidingInfo, false);
  assert.equal(p.showComplexPlan, false);
});

// Complexity comes only from the flag, never the Hebrew title text.
test("complexity comes only from the isComplex flag, never the title text", () => {
  const complexTitledRikiva: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  assert.equal(resolveStudentRidingPresentation(complexTitledRikiva).title, COMPLEX_RIDING_TITLE);

  const nonComplex: PresentationInput = {
    isComplex: false,
    title: "רכיבה - ישיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  assert.notEqual(resolveStudentRidingPresentation(nonComplex).title, COMPLEX_RIDING_TITLE);
  assert.equal(resolveStudentRidingPresentation(nonComplex).title, "רכיבה");
});

// Regression (review case a): complex + published with a stale generic
// ridingInfo still present - the published complex section is shown AND the
// generic box stays hidden, asserted simultaneously on one item.
test("complex + published with stale ridingInfo: showComplexPlan true and showGenericRidingInfo false together", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.showComplexPlan, true);
  assert.equal(p.showGenericRidingInfo, false);
  assert.equal(p.title, COMPLEX_RIDING_TITLE);
});

// Regression (review case b): ordinary riding whose only visible field is the
// subgroup label (no instructor, no arena) still renders the generic info box.
test("ordinary riding with subgroup-label-only ridingInfo: generic info still shown", () => {
  const subgroupOnlyRidingInfo: ScheduleItemView["ridingInfo"] = {
    instructorName: null,
    arena: null,
    subgroupLabel: "תת-קבוצה 1",
  };
  const item: PresentationInput = {
    isComplex: false,
    title: "רכיבה",
    ridingInfo: subgroupOnlyRidingInfo,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.equal(p.showGenericRidingInfo, true);
  assert.equal(p.showComplexPlan, false);
});

// Purity: the resolver is a deterministic pure function - repeated calls give
// equal output and it never mutates its input. (This asserts purity/non-
// mutation only; it does not claim any system-level write guarantee.)
test("resolver is pure: deterministic output and does not mutate its input", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
  };
  const snapshot = JSON.parse(JSON.stringify(item));
  const a = resolveStudentRidingPresentation(item);
  const b = resolveStudentRidingPresentation(item);
  assert.deepEqual(a, b);
  assert.deepEqual(item, snapshot);
});
