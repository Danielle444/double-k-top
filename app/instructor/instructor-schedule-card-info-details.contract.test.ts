/**
 * INSTRUCTOR SCHEDULE CARD INFO DETAILS - contract tests for the compact/grid
 * instructor card's on-demand details dialog.
 *
 * Both instructor schedule surfaces ("אזור מדריכים" home/today card and the
 * schedule tab's week browser) render through the SAME InstructorScheduleCard,
 * always compact (there is no separate desktop/full instructor view - see
 * InstructorScheduleSection's ScheduleTimeGrid call, which always passes
 * compact). The card sits in a fixed-height, duration-proportional grid cell
 * (lib/components/ScheduleTimeGrid.tsx, untouched by this change), so a short
 * session (e.g. "שיחת פתיחה" with a configured location) previously either
 * clipped its location/instructor line or lost it entirely, worse on desktop
 * (--slot-px:32px) than mobile (44px). Location, session note (item.description)
 * and instructorName are already-authorized InstructorScheduleItem fields
 * (lib/course/instructor-schedule-scope-core.ts) - this change only makes sure
 * they never silently disappear, by moving them into an on-demand details
 * dialog (reusing lib/components/Modal.tsx) behind an accessible info button,
 * exactly mirroring the trainee ScheduleCard's already-approved pattern.
 * Riding assignment/horse detail keeps using its own pre-existing, separate
 * interaction (the "צפייה בחניכים" click-through to the riding-students
 * modal) - untouched, not duplicated here.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * InstructorScheduleSection.tsx transitively imports
 * lib/actions/instructor-schedule-course-scoped.ts, a "use server" module
 * (Prisma + next/cache), so it cannot be imported into a plain `tsx --test`
 * process. This uses the repository's established SOURCE-CONTRACT pattern
 * (see app/student/schedule-card-info-details.contract.test.ts).
 *
 * Run with:
 *   npx tsx --test app/instructor/instructor-schedule-card-info-details.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SECTION = readSource("./InstructorScheduleSection.tsx");

function cardComponentSource(): string {
  const start = SECTION.indexOf("function InstructorScheduleCard(");
  const end = SECTION.indexOf("export function InstructorScheduleSection(");
  assert.notEqual(start, -1, "expected the InstructorScheduleCard component");
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

// ---------------------------------------------------------------------------
// Reuses the app's existing Modal - no new UI library, no bespoke dialog.
// ---------------------------------------------------------------------------

test("the instructor card reuses the shared Modal component", () => {
  assert.match(SECTION, /import\s*\{\s*Modal\s*\}\s*from\s*"@\/lib\/components\/Modal";/);
  assert.ok(SECTION.includes("<Modal"), "expected the shared Modal to be rendered");
});

// ---------------------------------------------------------------------------
// Deterministic compact-card trigger rule - no DOM/height measurement.
// ---------------------------------------------------------------------------

test("hasSecondaryDetails is a deterministic boolean over already-authorized fields, not DOM/height measurement", () => {
  const card = cardComponentSource();
  assert.ok(
    card.includes("Boolean(location) || Boolean(note) || Boolean(item.instructorName)"),
    "expected a pure boolean rule over location/note/instructorName",
  );
  assert.ok(!/getBoundingClientRect|ResizeObserver|scrollHeight|offsetHeight/.test(SECTION), "must not use fragile DOM measurement");
});

test("a short card with a configured location exposes it: either inline (non-compact) or via the info control (compact)", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("{location && <p"), "location must still be derived and rendered, never silently dropped");
  assert.ok(card.includes("מיקום: {location}"));
  assert.ok(card.includes("{compact && hasSecondaryDetails && ("), "compact cards gate the info control on hasSecondaryDetails");
});

test("the info button renders only when compact AND a secondary detail exists - not for a card with only the essentials", () => {
  const card = cardComponentSource();
  const btnGateIdx = card.indexOf("{compact && hasSecondaryDetails && (\n          <button");
  assert.notEqual(btnGateIdx, -1, "expected the info button gated on both compact and hasSecondaryDetails");
  assert.ok(card.includes('aria-label="מידע נוסף על הסשן"'));
});

test("desktop and mobile share the exact same card/gating logic - no separate desktop branch that silently drops location", () => {
  // The component takes no viewport/breakpoint prop; --slot-px is the only
  // thing that varies by breakpoint (in ScheduleTimeGrid, untouched), so the
  // info-button rule applies identically regardless of screen size.
  const card = cardComponentSource();
  assert.equal((card.match(/aria-label="מידע נוסף על הסשן"/g) ?? []).length, 1);
  assert.ok(!/window\.innerWidth|matchMedia/.test(card), "must not branch on viewport size in JS");
});

// ---------------------------------------------------------------------------
// Long Hebrew text must not overflow outside the card.
// ---------------------------------------------------------------------------

test("the title clamps in compact mode so a long title cannot overflow the fixed-height cell", () => {
  const card = cardComponentSource();
  assert.ok(card.includes('compact ? "line-clamp-2 text-base" : "text-lg"'));
});

// ---------------------------------------------------------------------------
// The details dialog contains note and riding/instructor details.
// ---------------------------------------------------------------------------

test("detailsContent includes location, session note, and instructor name - the same authorized InstructorScheduleItem fields", () => {
  const card = cardComponentSource();
  const start = card.indexOf("const detailsContent = (");
  const end = card.indexOf("return (", start);
  assert.notEqual(start, -1);
  const details = card.slice(start, end);
  assert.ok(details.includes("מיקום: {location}"));
  assert.ok(details.includes("הערה: "), "expected the session note (item.description) to be shown - previously never rendered anywhere");
  assert.ok(details.includes("מדריך/ה: {item.instructorName}"));
});

test("detailsContent is declared once and reused (inline for a hypothetical non-compact caller, inside the dialog for compact) - never duplicated", () => {
  const card = cardComponentSource();
  const occurrences = card.match(/const detailsContent = \(/g) ?? [];
  assert.equal(occurrences.length, 1);
  assert.ok(card.includes("{!compact && detailsContent}"));
  assert.ok(card.includes(">{detailsContent}</div>"));
});

test("session note now reaches item.description via .trim(), previously never rendered in this component", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("item.description?.trim() || null"));
});

// ---------------------------------------------------------------------------
// Riding assignment/horse detail keeps its own existing, separate path -
// never duplicated into the new dialog.
// ---------------------------------------------------------------------------

test("the existing riding-students click-through affordance is untouched and not folded into the details dialog", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("צפייה בחניכים ›"), "the existing affordance must still render");
  const start = card.indexOf("const detailsContent = (");
  const end = card.indexOf("return (", start);
  const details = card.slice(start, end);
  assert.ok(!details.includes("ridingActivity"), "the details dialog must not duplicate riding-slot data - that has its own modal");
});

// ---------------------------------------------------------------------------
// Accessibility, and no propagation into the card's own click-to-open-riding
// behaviour.
// ---------------------------------------------------------------------------

test("the info control is a real, keyboard-accessible button with the required Hebrew aria-label", () => {
  const card = cardComponentSource();
  const btnStart = card.indexOf("<button");
  assert.notEqual(btnStart, -1);
  const btnEnd = card.indexOf("</button>", btnStart);
  const btn = card.slice(btnStart, btnEnd);
  assert.ok(btn.includes('type="button"'));
  assert.ok(btn.includes('aria-label="מידע נוסף על הסשן"'));
});

test("the info button stops propagation on both click and keydown, so it never triggers the card's own riding-modal click handler", () => {
  const card = cardComponentSource();
  const btnStart = card.indexOf("<button");
  const btnEnd = card.indexOf("</button>", btnStart);
  const btn = card.slice(btnStart, btnEnd);
  assert.ok(btn.includes("e.stopPropagation()"), "expected stopPropagation in the onClick handler");
  assert.ok(btn.includes("onKeyDown={(e) => e.stopPropagation()}"), "expected stopPropagation on keydown too, since the outer clickable card also listens for Enter/Space");
});

test("the dialog has clear close behaviour via the shared Modal's onClose contract", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("onClose={() => setShowDetails(false)}"));
});

// ---------------------------------------------------------------------------
// Existing instructor filters/riding behaviour untouched.
// ---------------------------------------------------------------------------

test("the mine/all filter and course-scoped readers are untouched", () => {
  assert.ok(SECTION.includes('setScheduleFilter("mine")'));
  assert.ok(SECTION.includes('setScheduleFilter("all")'));
  assert.match(SECTION, /getCourseScopedScheduleForInstructor\(/);
  assert.match(SECTION, /getTodayScheduleForInstructor\(/);
});

test("clickability still comes only from a resolved riding activity + ridingSlot + handler, never from title text", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("const clickable = Boolean(ridingActivity && ridingActivity.ridingSlot && onOpenRidingActivity);"));
});

// ---------------------------------------------------------------------------
// Student schedule implementation is unchanged by this instructor-only fix.
// ---------------------------------------------------------------------------

test("app/student/ScheduleSection.tsx is not referenced by the instructor schedule section", () => {
  assert.ok(!SECTION.includes("app/student"), "the instructor fix must not import from or couple to the student schedule component");
});
