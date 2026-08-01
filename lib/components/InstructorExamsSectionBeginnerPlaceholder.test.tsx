/**
 * EX-C2-0-SUSPEND-UI — NEW, focused tests for the TEMPORARY instructor-screen
 * beginner-row suspension and its two static placeholder cards.
 *
 * This is deliberately NOT a repurposing of
 * `lib/actions/instructor-exam-schedule.contract.test.ts` (that golden-file
 * suite is left untouched).
 *
 * IT READS SOURCE TEXT ONLY, and imports nothing from
 * `app/instructor/InstructorExamsSection.tsx`, for the same reason given in
 * `lib/components/StudentExamsSectionBeginnerPlaceholder.test.tsx`: that file
 * transitively imports the committed Server Action module, which imports
 * `server-only` — resolvable inside Next's build but not under plain
 * `node:test`/`tsx` (`Cannot find module 'server-only'`, confirmed by hand).
 * There is also no jsdom/testing-library in this repository, and `useEffect`
 * never runs under `renderToStaticMarkup`, so even a working import could not
 * exercise the fetched/"loaded" state these behaviours depend on.
 * Source-text assertions are the smallest approach that can actually prove
 * the wiring, mirroring this repo's own established pattern for this exact
 * file.
 *
 * Run with:
 *   npx tsx --test lib/components/InstructorExamsSectionBeginnerPlaceholder.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SECTION = readFileSync(
  fileURLToPath(new URL("../../app/instructor/InstructorExamsSection.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SECTION_CODE = stripComments(SECTION);

// ===========================================================================
// 1. The placeholder card itself: approved text, approved style, pure props
// ===========================================================================

test("1. the placeholder card component takes only three plain string props", () => {
  assert.match(
    SECTION_CODE.replace(/\s+/g, " "),
    /function BeginnerPlaceholderCard\(\{ title, dateLabel, timeLabel, \}: \{ title: string; dateLabel: string; timeLabel: string; \}\)/,
    "the placeholder card's prop shape changed or gained a field",
  );
  const bodyStart = SECTION_CODE.indexOf("function BeginnerPlaceholderCard(");
  const bodyEnd = SECTION_CODE.indexOf("const GENERAL_VIEW_LABEL", bodyStart);
  assert.ok(bodyEnd > bodyStart, "the placeholder card's body could not be located");
  const body = SECTION_CODE.slice(bodyStart, bodyEnd);
  for (const token of [
    "fetch(",
    "prisma",
    "use server",
    "getInstructorExamSchedule",
    "assignments",
    "isSelf",
    "row.",
    "sessionId",
    "studentId",
    "instructorId",
  ]) {
    assert.equal(body.includes(token), false, `the placeholder card body reaches ${token}`);
  }
});

test("2. the placeholder card reuses the existing outer card style", () => {
  const bodyStart = SECTION_CODE.indexOf("function BeginnerPlaceholderCard(");
  const bodyEnd = SECTION_CODE.indexOf("const GENERAL_VIEW_LABEL", bodyStart);
  assert.ok(bodyEnd > bodyStart, "the placeholder card's body could not be located");
  const body = SECTION_CODE.slice(bodyStart, bodyEnd);
  assert.ok(
    body.includes('className="rounded-2xl border border-border bg-card p-4 shadow-sm"'),
    "the placeholder card does not reuse the approved outer card class",
  );
  assert.equal((body.match(/<p className=/g) ?? []).length, 3, "the card gained or lost a line");
});

// ===========================================================================
// 2. Dynamic BEGINNER rows are excluded before rendering, in every nav mode
// ===========================================================================

test("3. the visible-row pipeline excludes live BEGINNER rows in ALL nav modes (general/type/date)", () => {
  const flat = SECTION_CODE.replace(/\s+/g, " ");
  assert.match(
    flat,
    /const visibleRows = filterExamRows\(allRows, \{ definitionName: navMode === "type" \? navDefinitionName : null, date: navMode === "date" \? navDate : null, \}\)\.filter\(\(entry\) => !isBeginnerExamRow\(entry\)\);/,
    "visibleRows no longer excludes beginner rows for every nav mode",
  );
  // The pinned golden-file substring `filterExamRows(allRows, {` (used by
  // `lib/actions/instructor-exam-schedule.contract.test.ts`) is still present
  // verbatim, so this exclusion is additive.
  assert.ok(SECTION_CODE.includes("filterExamRows(allRows, {"));
  // Exactly one `filterExamRows(` call and one grouping call remain — the
  // golden-file suite's own pinned counts (test 10h) — proving the exclusion
  // was chained onto the existing single narrowing rather than adding a
  // second, disagreeing one.
  assert.equal((SECTION_CODE.match(/filterExamRows\(/g) ?? []).length, 1);
});

test('4. the exclusion uses a non-"row" parameter, so no THIRD isBeginnerExamRow(row) literal was added', () => {
  assert.equal(
    (SECTION_CODE.match(/\{!isBeginnerExamRow\(row\) && row\.assignments\.length === 0 && \(/g) ?? [])
      .length,
    1,
  );
  assert.equal((SECTION_CODE.match(/\{isBeginnerExamRow\(row\) \? \(/g) ?? []).length, 1);
  assert.ok(SECTION_CODE.includes("!isBeginnerExamRow(entry)"), "no non-row exclusion predicate found");
  assert.equal(SECTION_CODE.includes("isBeginnerExamRow(entry) ?"), false);
});

test("5. the existing dead beginner-routing branch is UNTOUCHED", () => {
  assert.ok(
    SECTION_CODE.includes(
      "<ExamBeginnerRows detail={row.beginner} showOperationalDetail />",
    ),
    "the shared beginner renderer hand-off changed",
  );
  assert.ok(
    SECTION_CODE.includes("<ExamAssignmentRows assignments={row.assignments} />"),
    "the advanced renderer hand-off changed",
  );
});

// ===========================================================================
// 3. The two placeholders are wired to the right views, with the right text
// ===========================================================================

test('6. neither placeholder renders in the general ("לו״ז כללי") view', () => {
  // Corrected requirement: each placeholder must appear ONLY in its own exact
  // date/time position in the "by date" view. The general/"all" view must not
  // name either placeholder date or text at all.
  assert.equal(
    /navMode === "all"[^;]*BEGINNER_PLACEHOLDER/.test(SECTION_CODE.replace(/\s+/g, " ")),
    false,
    "a placeholder leaked into the general view",
  );
});

test('7. each placeholder in "by date" is gated on its OWN fixed date, not the other\'s', () => {
  assert.ok(
    SECTION_CODE.includes('navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_A && ('),
    "placeholder A is not gated on the date view + its fixed date",
  );
  assert.ok(
    SECTION_CODE.includes('navMode === "date" && navDate === BEGINNER_PLACEHOLDER_DATE_B && ('),
    "placeholder B is not gated on the date view + its fixed date",
  );
  assert.ok(SECTION_CODE.includes('const BEGINNER_PLACEHOLDER_DATE_A = "2026-08-02";'));
  assert.ok(SECTION_CODE.includes('const BEGINNER_PLACEHOLDER_DATE_B = "2026-08-03";'));
});

test('8. neither placeholder renders in the "by exam type" view', () => {
  // The only gates that mention either placeholder date are the general-view
  // unconditional block and the two "date" mode + exact-date blocks. Nothing
  // gated on `navMode === "type"` names either placeholder.
  assert.equal(
    /navMode === "type"[^;]*BEGINNER_PLACEHOLDER/.test(SECTION_CODE.replace(/\s+/g, " ")),
    false,
    "a placeholder leaked into the by-exam-type view",
  );
});

test("9. the approved exact text of both placeholders appears exactly once, only at their date-view use-site", () => {
  for (const text of [
    "הדרכות מתחילים — קבוצה א",
    "יום ראשון, 2.8.2026",
    "הדרכות מתחילים — קבוצה ב",
    "יום שני, 3.8.2026",
  ]) {
    assert.equal(
      (SECTION_CODE.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
      1,
      `${text} does not appear exactly once (date view only, no general-view duplicate)`,
    );
  }
  // The shared 16:00–19:30 window appears once per placeholder — one call
  // site each, both gated in the "by date" view only.
  assert.equal((SECTION_CODE.match(/16:00–19:30/g) ?? []).length, 2);
});

// ===========================================================================
// 4. Unchanged behaviour: advanced rows, date/type tabs, hasPlan, no union
// ===========================================================================

test("10. hasPlan is still computed from the RAW, unfiltered rows", () => {
  // Deliberately unchanged: `allRows` is never filtered in place (only the
  // narrowed `visibleRows` excludes beginner rows), so the existing "does a
  // schedule exist at all" check is untouched by this suspension.
  assert.ok(SECTION_CODE.includes("const allRows = view === null ? [] : view.rows;"));
  assert.ok(
    SECTION_CODE.includes("view.planId !== null") && SECTION_CODE.includes("allRows.length > 0"),
  );
});

test("11. the date/type tab lists are still derived from the REAL, unfiltered contract rows (no hardcoded union)", () => {
  // Deliberate, accepted design decision (symmetric with the trainee screen):
  // NO hardcoded date union. `dates`/`definitionNames` stay exactly
  // `listExamDates(allRows)` / `listExamDefinitionNames(allRows)`, so the two
  // placeholder dates keep appearing in the "by date" tab list only because
  // live BEGINNER rows currently exist on them upstream. Accepted because this
  // suppression is explicitly temporary, not a permanent removal.
  assert.ok(SECTION_CODE.includes("listExamDates(allRows)"));
  assert.ok(SECTION_CODE.includes("listExamDefinitionNames(allRows)"));
});
