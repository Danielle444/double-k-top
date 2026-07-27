/**
 * Pure tests for the student riding-session presentation decision
 * (resolveStudentRidingPresentation in app/student/student-riding-presentation.ts).
 * These pin down Fix 1: a complex-mode riding slot is never shown with the
 * generic assignment coach/arena box; ordinary (non-complex) riding is
 * unchanged; complexity is taken only from the typed isComplex flag, never from
 * the title text.
 *
 * RCP-1a narrowed the TITLE half of that rule to the publication boundary: the
 * "תרגול הדרכה" override (and any published custom title) applies only once a
 * publication exists. An unpublished complex draft shows the ordinary schedule
 * title, so draft work never changes what trainees see. The generic-info
 * suppression above is unchanged and still keyed on isComplex (RCP-2 deferred).
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
> & {
  // LEVEL 2 COMPLEX-TITLE FIX - optional here (as in the resolver) so a fixture
  // can OMIT it to simulate an absent server flag, which must behave exactly
  // like false (legacy "תרגול הדרכה" override).
  preserveOriginalComplexTitle?: boolean;
};

const GENERIC_RIDING_INFO: ScheduleItemView["ridingInfo"] = {
  instructorName: "מאמן/ת",
  arena: "מגרש 1",
  subgroupLabel: null,
};

// Minimal stand-in for a published complex plan. RC-A4 - the resolver now reads
// `titleSnapshot` (via the RC-A0 PUBLISHED path); this default has a null
// snapshot, so it still resolves to the generated fallback. Helper below builds
// one carrying a specific snapshot.
const PUBLISHED_PLAN = { titleSnapshot: null, blocks: [] } as unknown as NonNullable<
  ScheduleItemView["publishedComplexRidingPlan"]
>;

function publishedPlanWithSnapshot(
  titleSnapshot: string | null
): NonNullable<ScheduleItemView["publishedComplexRidingPlan"]> {
  return { titleSnapshot, blocks: [] } as unknown as NonNullable<
    ScheduleItemView["publishedComplexRidingPlan"]
  >;
}

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

// 2. complex + unpublished: RCP-1a - the ORDINARY schedule title (the complex
// override is PUBLISHED-only), generic info still suppressed, and nothing
// complex exposed (no publication).
test("complex + unpublished: ordinary title, generic riding info hidden, no complex details exposed", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
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

// Complexity comes only from the flag, never the Hebrew title text. RCP-1a -
// re-fixtured onto a PUBLISHED plan (the override is now PUBLISHED-only), with
// BOTH items holding the same publication so that isComplex is the ONLY
// difference between them. A non-complex item never carries a publication in
// practice; it is used here purely as a structural control to prove the flag -
// not the publication and not the title text - selects the override.
test("complexity comes only from the isComplex flag, never the title text (published)", () => {
  const complexTitledRikiva: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
  };
  assert.equal(resolveStudentRidingPresentation(complexTitledRikiva).title, COMPLEX_RIDING_TITLE);

  const nonComplex: PresentationInput = {
    isComplex: false,
    title: "רכיבה - ישיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
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

// ---------------------------------------------------------------------------
// LEVEL 2 COMPLEX-TITLE FIX - preserveOriginalComplexTitle precedence.
//
// The server (getScheduleForStudent) sets preserveOriginalComplexTitle from the
// authorized, server-resolved offering level (Level 2 -> true). These tests pin
// the pure presentation contract only; the level derivation itself is server-
// side and not exercised here.
//   - Level 1 complex (flag false/absent) -> fixed "תרגול הדרכה" override.
//   - Level 2 complex (flag true)          -> original title via getStudentScheduleTitle.
// getStudentScheduleTitle is NOT modified by this fix.
// ---------------------------------------------------------------------------

// Level 1 complex item: the flag is false -> legacy fixed override. RCP-1a -
// re-fixtured onto a PUBLISHED plan with a null snapshot, which is the only
// state in which the generated fallback is now reachable at all.
test("L2 fix: published Level 1 complex (flag false) -> תרגול הדרכה", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot(null),
    preserveOriginalComplexTitle: false,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, COMPLEX_RIDING_TITLE);
  assert.equal(p.title, "תרגול הדרכה");
});

// Level 2 complex item: the flag is true -> original title, run through
// getStudentScheduleTitle (never the fixed override, never the raw title).
test("L2 fix: Level 2 complex (flag true) -> original title via getStudentScheduleTitle", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: true,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
  assert.equal(p.title, "רכיבה");
});

// Level 2 complex item whose title contains the "main - topic" separator is
// shortened by getStudentScheduleTitle exactly like any other trainee title
// (raw unprocessed title is never shown): "רכיבה - ישיבה יציבה" -> "רכיבה".
test("L2 fix: Level 2 complex title with separator is shortened, not shown raw", () => {
  const item: PresentationInput = {
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
    preserveOriginalComplexTitle: true,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, "רכיבה - ישיבה יציבה"); // never the raw title
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
  // Published complex section and generic-info suppression are unaffected by
  // the title flag.
  assert.equal(p.showComplexPlan, true);
  assert.equal(p.showGenericRidingInfo, false);
});

// Non-complex item is unaffected by the flag - Level 1 (flag false).
test("L2 fix: non-complex Level 1 (flag false) unchanged", () => {
  const item: PresentationInput = {
    isComplex: false,
    title: "רכיבה - מעברים",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "רכיבה");
  assert.equal(p.showGenericRidingInfo, true);
});

// Non-complex item is unaffected by the flag - Level 2 (flag true) yields the
// identical result as Level 1: the flag only ever gates the complex override.
test("L2 fix: non-complex Level 2 (flag true) unchanged, identical to Level 1", () => {
  const base = {
    isComplex: false as const,
    title: "רכיבה - מעברים",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
  };
  const l1 = resolveStudentRidingPresentation({ ...base, preserveOriginalComplexTitle: false });
  const l2 = resolveStudentRidingPresentation({ ...base, preserveOriginalComplexTitle: true });
  assert.deepEqual(l1, l2);
  assert.equal(l2.title, "רכיבה");
  assert.equal(l2.showGenericRidingInfo, true);
});

// Placeholder shape (isComplex false, flag false) - as built by
// buildHiddenCombinedParticipationPlaceholders. Placeholders bypass this
// resolver entirely in the UI (ScheduleSection renders them through their own
// branch), but even if routed here the flag is inert and the title is the
// plain getStudentScheduleTitle result - never the complex override.
test("L2 fix: placeholder-shaped item (non-complex, flag false) unchanged", () => {
  const item: PresentationInput = {
    isComplex: false,
    title: "שיבוץ מוסתר",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  };
  const p = resolveStudentRidingPresentation(item);
  assert.equal(p.title, "שיבוץ מוסתר");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
  assert.equal(p.showGenericRidingInfo, false);
  assert.equal(p.showComplexPlan, false);
});

// Missing flag (server field absent) is treated identically to false: a complex
// slot retains the legacy "תרגול הדרכה" override, never opting into
// preservation by accident. This is the `!== true` contract. RCP-1a - asserted
// on a PUBLISHED plan, the only surface on which the override now exists.
test("L2 fix: missing/absent preserve flag on a published complex slot retains תרגול הדרכה", () => {
  const missing: PresentationInput = {
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot(null),
    // preserveOriginalComplexTitle deliberately omitted (undefined)
  };
  assert.equal(resolveStudentRidingPresentation(missing).title, COMPLEX_RIDING_TITLE);

  const explicitFalse: PresentationInput = { ...missing, preserveOriginalComplexTitle: false };
  assert.equal(resolveStudentRidingPresentation(explicitFalse).title, COMPLEX_RIDING_TITLE);
});

// The server flag is the SOLE determinant of the complex-title override: with
// every other field held identical, only preserveOriginalComplexTitle flips the
// title. No title-text, ridingInfo, or publication value substitutes for it -
// so the unified/source metadata (which lives outside this shape) can never
// alter title selection independently of the server-set flag.
test("L2 fix: only the server flag flips the complex title, nothing else", () => {
  const shared = {
    isComplex: true as const,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: PUBLISHED_PLAN,
  };
  const preserved = resolveStudentRidingPresentation({ ...shared, preserveOriginalComplexTitle: true });
  const overridden = resolveStudentRidingPresentation({ ...shared, preserveOriginalComplexTitle: false });
  assert.equal(preserved.title, "רכיבה");
  assert.equal(overridden.title, COMPLEX_RIDING_TITLE);
  assert.notEqual(preserved.title, overridden.title);
  // Everything OTHER than the title is identical regardless of the flag.
  assert.equal(preserved.showGenericRidingInfo, overridden.showGenericRidingInfo);
  assert.equal(preserved.showComplexPlan, overridden.showComplexPlan);
});

// ---------------------------------------------------------------------------
// RC-A4 - published custom title overrides the generated fallback (PUBLISHED
// resolution via the RC-A0 core). A trainee only ever sees a complex session
// when published, so the title source here is titleSnapshot, never live.
// ---------------------------------------------------------------------------

// 1. PUBLISHED custom snapshot overrides the Level 1 "תרגול הדרכה" fallback.
test("RC-A4: published snapshot overrides the Level 1 fallback", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("קפיצות בוקר"),
    preserveOriginalComplexTitle: false,
  });
  assert.equal(p.title, "קפיצות בוקר");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
});

// 2. PUBLISHED null snapshot -> Level 1 fallback.
test("RC-A4: published null snapshot keeps the Level 1 fallback", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot(null),
    preserveOriginalComplexTitle: false,
  });
  assert.equal(p.title, COMPLEX_RIDING_TITLE);
});

// 3. PUBLISHED custom snapshot overrides the preserved Level 2 ScheduleItem title.
test("RC-A4: published snapshot overrides the Level 2 preserved title", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("מקצה מתקדמים"),
    preserveOriginalComplexTitle: true,
  });
  assert.equal(p.title, "מקצה מתקדמים");
});

// 4. PUBLISHED null snapshot -> preserved Level 2 ScheduleItem title fallback.
test("RC-A4: published null snapshot keeps the Level 2 preserved fallback", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot(null),
    preserveOriginalComplexTitle: true,
  });
  assert.equal(p.title, "רכיבה");
});

// 5. UNPUBLISHED complex slot never shows a live title (there is no live-title
//    field on the presentation input at all - PUBLISHED-only). RCP-1a: it now
//    shows the ORDINARY schedule title rather than the generated complex
//    fallback, so no draft state is observable to the trainee at all.
test("RC-A4/RCP-1a: an unpublished complex slot shows the ordinary title (no live title read)", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
});

// 6. A malformed published snapshot (multiline / overlong) falls back safely.
test("RC-A4: a malformed published snapshot falls back safely", () => {
  const multiline = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("שורה\nשנייה"),
    preserveOriginalComplexTitle: false,
  });
  assert.equal(multiline.title, COMPLEX_RIDING_TITLE);
  const overlong = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("א".repeat(61)),
    preserveOriginalComplexTitle: false,
  });
  assert.equal(overlong.title, COMPLEX_RIDING_TITLE);
});

// 7. A non-complex ordinary riding slot is unaffected by RC-A4 (no complex
//    publication resolution path).
test("RC-A4: ordinary riding is unaffected", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: false,
    title: "רכיבה - מעברים",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
  });
  assert.equal(p.title, "רכיבה");
});

// ---------------------------------------------------------------------------
// RCP-1a - THE PUBLICATION BOUNDARY.
//
// A RidingSlotComplexPlan row is created EAGERLY the moment a manager chooses
// complex mode - before any save and before publication - so isComplex alone
// must never change what a trainee sees. These tests pin the locked rule:
//
//   publication === null -> the ordinary schedule title, in EVERY case
//   publication !== null -> the existing published behaviour, byte-identical
//
// The manager's draft title is not merely gated here, it is structurally
// unreachable: the presentation input carries no live-title field at all.
// ---------------------------------------------------------------------------

// 1. THE REGRESSION. Level 1 complex slot with an unpublished draft plan: the
//    trainee sees the ordinary title, never "תרגול הדרכה".
test("RCP-1a: Level 1 complex + unpublished draft -> ordinary title, never תרגול הדרכה", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
});

// 2. The unpublished title is the ordinary trainee title - i.e. shortened by
//    getStudentScheduleTitle exactly like any other item, never the raw
//    ScheduleItem.title and never the complex override.
test("RCP-1a: unpublished draft title is shortened like any ordinary title, never raw", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, "רכיבה - ישיבה יציבה");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
});

// 3. Level 2 is unaffected by RCP-1a: it already resolved to the preserved
//    original title while unpublished, and still does. No regression.
test("RCP-1a: Level 2 complex + unpublished draft -> ordinary title (unchanged)", () => {
  const p = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: true,
  });
  assert.equal(p.title, "רכיבה");
  assert.notEqual(p.title, COMPLEX_RIDING_TITLE);
});

// 4. THE PUBLISH TRANSITION. One identical item; only the publication appears.
//    This is the exact moment the complex title is allowed to become visible.
test("RCP-1a: publishing is the moment the custom title becomes trainee-visible", () => {
  const base = {
    isComplex: true as const,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    preserveOriginalComplexTitle: false,
  };
  const draft = resolveStudentRidingPresentation({ ...base, publishedComplexRidingPlan: null });
  const published = resolveStudentRidingPresentation({
    ...base,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("קפיצות בוקר"),
  });
  assert.equal(draft.title, "רכיבה");
  assert.equal(published.title, "קפיצות בוקר");
  assert.notEqual(draft.title, published.title);
});

// 5. Publishing with the title field left empty (null snapshot) is the ONLY way
//    a trainee ever sees "תרגול הדרכה" - the override is post-publication only.
test("RCP-1a: published with an empty title -> תרגול הדרכה (override is publication-only)", () => {
  const published = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: publishedPlanWithSnapshot(null),
    preserveOriginalComplexTitle: false,
  });
  assert.equal(published.title, COMPLEX_RIDING_TITLE);

  const draft = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.notEqual(draft.title, COMPLEX_RIDING_TITLE);
});

// 6. UNPUBLISH RESTORE. Unpublishing removes the publication row, so the very
//    same item resolves back to its original title with no unpublish-specific
//    logic anywhere - the boundary alone does it.
test("RCP-1a: unpublishing restores the original schedule title", () => {
  const base = {
    isComplex: true as const,
    title: "רכיבה - ישיבה יציבה",
    ridingInfo: null,
    preserveOriginalComplexTitle: false,
  };
  const published = resolveStudentRidingPresentation({
    ...base,
    publishedComplexRidingPlan: publishedPlanWithSnapshot("קפיצות בוקר"),
  });
  const afterUnpublish = resolveStudentRidingPresentation({
    ...base,
    publishedComplexRidingPlan: null,
  });
  assert.equal(published.title, "קפיצות בוקר");
  assert.equal(afterUnpublish.title, "רכיבה");
  assert.notEqual(afterUnpublish.title, COMPLEX_RIDING_TITLE);
});

// 7. NO WIDENING. RCP-1a changes the title only: an unpublished complex slot
//    still exposes no complex plan and still shows no generic coach/arena box,
//    with or without a stale ridingInfo present (RCP-2 is deferred - the
//    generic-info suppression is deliberately untouched).
test("RCP-1a: unpublished states expose no complex plan and no generic riding info", () => {
  const withoutInfo = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: null,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.equal(withoutInfo.showComplexPlan, false);
  assert.equal(withoutInfo.showGenericRidingInfo, false);

  const withStaleInfo = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: false,
  });
  assert.equal(withStaleInfo.showComplexPlan, false);
  assert.equal(withStaleInfo.showGenericRidingInfo, false);

  // Level 2 unpublished behaves identically on both flags.
  const level2 = resolveStudentRidingPresentation({
    isComplex: true,
    title: "רכיבה",
    ridingInfo: GENERIC_RIDING_INFO,
    publishedComplexRidingPlan: null,
    preserveOriginalComplexTitle: true,
  });
  assert.equal(level2.showComplexPlan, false);
  assert.equal(level2.showGenericRidingInfo, false);
});
