/**
 * EX-C2-0-SUSPEND-UI — NEW, focused tests for the TEMPORARY trainee-screen
 * beginner-row suspension and its two static placeholder cards.
 *
 * This is deliberately NOT a repurposing of
 * `lib/actions/trainee-exam-schedule.contract.test.ts` (that golden-file suite
 * is left untouched).
 *
 * IT READS SOURCE TEXT ONLY, and imports nothing from
 * `app/student/StudentExamsSection.tsx`, on purpose and for the same reason the
 * committed golden-file suite for this exact screen does the same
 * (`lib/actions/trainee-exam-schedule.contract.test.ts` — see its own
 * "IT LIVES UNDER lib/ DELIBERATELY" note): that file transitively imports the
 * committed Server Action module, which imports `server-only` — a package Next
 * resolves specially but plain `node:test`/`tsx` cannot (`Cannot find module
 * 'server-only'`), confirmed by hand before writing this file. There is also no
 * jsdom/testing-library in this repository (only `react-dom` for
 * `renderToStaticMarkup`, as used by `lib/components/ExamBeginnerRows.test.tsx`
 * and its siblings), and `useEffect` never runs under `renderToStaticMarkup` —
 * so even if the import worked, a static render could not exercise the
 * fetched/"loaded" state the placeholders and the beginner-row suspension
 * depend on. Introducing jsdom/testing-library to work around either limit
 * would be a new test framework, which AGENTS.md forbids for a small scoped
 * task. Source-text assertions are therefore the smallest approach that can
 * actually prove the wiring, and they mirror this repo's own established
 * pattern for this exact file.
 *
 * Run with:
 *   npx tsx --test lib/components/StudentExamsSectionBeginnerPlaceholder.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SECTION = readFileSync(
  fileURLToPath(new URL("../../app/student/StudentExamsSection.tsx", import.meta.url)),
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
  // No data fetching, no fake row, no fake assignment, no self/role marker: the
  // component's own body names none of those. Sliced up to the next top-level
  // declaration (the exported section function) rather than by brace-matching,
  // because the file uses CRLF line endings and the destructured prop object's
  // own closing brace would otherwise end the slice too early.
  const bodyStart = SECTION_CODE.indexOf("function BeginnerPlaceholderCard(");
  const bodyEnd = SECTION_CODE.indexOf(
    "export function StudentExamsSection({ groupName }: { groupName: string | null }) {",
    bodyStart,
  );
  assert.ok(bodyEnd > bodyStart, "the placeholder card's body could not be located");
  const body = SECTION_CODE.slice(bodyStart, bodyEnd);
  for (const token of [
    "fetch(",
    "prisma",
    "use server",
    "getTraineeExamSchedule",
    "assignments",
    "selfRole",
    "isSelf",
    "row.",
    "studentId",
    "instructorId",
  ]) {
    assert.equal(body.includes(token), false, `the placeholder card body reaches ${token}`);
  }
});

test("2. the placeholder card reuses the existing outer card style", () => {
  const bodyStart = SECTION_CODE.indexOf("function BeginnerPlaceholderCard(");
  const bodyEnd = SECTION_CODE.indexOf(
    "export function StudentExamsSection({ groupName }: { groupName: string | null }) {",
    bodyStart,
  );
  assert.ok(bodyEnd > bodyStart, "the placeholder card's body could not be located");
  const body = SECTION_CODE.slice(bodyStart, bodyEnd);
  assert.ok(
    body.includes('className="rounded-2xl border border-border bg-card p-4 shadow-sm"'),
    "the placeholder card does not reuse the approved outer card class",
  );
  // Three lines and nothing else: a title, a date/weekday line and a time line.
  assert.equal((body.match(/<p className=/g) ?? []).length, 3, "the card gained or lost a line");
});

// ===========================================================================
// 2. Dynamic BEGINNER rows are excluded before either view can render them
// ===========================================================================

test("3. the date-view row pipeline excludes live BEGINNER rows before grouping", () => {
  const flat = SECTION_CODE.replace(/\s+/g, " ");
  assert.match(
    flat,
    /const filteredRows = filterExamRows\(allRows, \{ definitionName: null, date: activeDate, \}\)\.filter\(\(entry\) => !isBeginnerExamRow\(entry\)\);/,
    "the date view's filteredRows no longer excludes beginner rows before grouping",
  );
  // The pinned golden-file substring `filterExamRows(allRows, {` (used by
  // `lib/actions/trainee-exam-schedule.contract.test.ts`) is still present
  // verbatim, so this exclusion is additive and does not disturb that pin.
  assert.ok(SECTION_CODE.includes("filterExamRows(allRows, {"));
});

test("4. the beginner exclusion uses a non-\"row\" parameter, so no THIRD isBeginnerExamRow(row) literal was added", () => {
  // The golden-file suite pins exactly TWO occurrences each of
  // `{isBeginnerExamRow(row) ? (` and `isBeginnerExamRow(row) || row.selfRole
  // === null`. Both counts must be untouched by this addition.
  assert.equal((SECTION_CODE.match(/\{isBeginnerExamRow\(row\) \? \(/g) ?? []).length, 2);
  assert.equal(
    (SECTION_CODE.match(/isBeginnerExamRow\(row\) \|\| row\.selfRole === null/g) ?? []).length,
    2,
  );
  assert.ok(SECTION_CODE.includes("!isBeginnerExamRow(entry)"), "no non-row exclusion predicate found");
  assert.equal(SECTION_CODE.includes("isBeginnerExamRow(entry) ?"), false);
});

test("5. the self view bails out of a live BEGINNER row before any render branch", () => {
  assert.match(
    SECTION_CODE.replace(/\s+/g, " "),
    /myRows\.map\(\(row\) => \{ if \(isBeginnerExamRow\(row\)\) return null; /,
    "the self view no longer bails out of a beginner row before rendering it",
  );
});

test("6. the existing dead beginner-routing branches are UNTOUCHED", () => {
  // Re-asserting the golden-file suite's own two pinned shapes: this suite's
  // subject is that they still exist, byte-identical, as dead code now that no
  // beginner row can reach them.
  assert.equal(
    (SECTION_CODE.match(/\{isBeginnerExamRow\(row\) \? \(/g) ?? []).length,
    2,
    "a beginner-routing branch was added or removed",
  );
  assert.equal(
    (SECTION_CODE.match(/<ExamBeginnerRows detail=\{row\.beginner\}[^>]*\/>/g) ?? []).length,
    2,
    "the shared beginner renderer hand-off changed",
  );
});

// ===========================================================================
// 3. The two placeholders are wired to the right views, with the right text
// ===========================================================================

test('7. both placeholders are reachable from the self ("לו״ז שלי") view, each gated on the trainee\'s OWN groupName', () => {
  const flat = SECTION_CODE.replace(/\s+/g, " ");
  assert.match(
    flat,
    /mode === "self" && \(\s*<>[\s\S]*groupName === "א"[\s\S]*הדרכות מתחילים — קבוצה א[\s\S]*groupName === "ב"[\s\S]*הדרכות מתחילים — קבוצה ב[\s\S]*<\/>\s*\)/,
    "the self view does not gate each placeholder on the trainee's own groupName",
  );
});

test('7b. neither self-view placeholder is unconditional — each requires its OWN group value', () => {
  assert.ok(
    SECTION_CODE.includes('{groupName === "א" && ('),
    "group A placeholder is not gated on groupName",
  );
  assert.ok(
    SECTION_CODE.includes('{groupName === "ב" && ('),
    "group B placeholder is not gated on groupName",
  );
});

test("7c. group filtering never compares a display name (fullName, selected.fullName, etc.)", () => {
  for (const forbidden of ["fullName", "displayName", ".name ==="]) {
    assert.equal(
      SECTION_CODE.includes(forbidden),
      false,
      `group filtering must not reference ${forbidden}`,
    );
  }
});

test('8. each placeholder in "לפי תאריך" is gated on its OWN fixed date AND the trainee\'s OWN groupName, not the other\'s', () => {
  const flat = SECTION_CODE.replace(/\s+/g, " ");
  assert.match(
    flat,
    /mode === "date" &&\s*activeDate === BEGINNER_PLACEHOLDER_DATE_A &&\s*groupName === "א" &&/,
    "placeholder A is not gated on the date view + its fixed date + groupName === א",
  );
  assert.match(
    flat,
    /mode === "date" &&\s*activeDate === BEGINNER_PLACEHOLDER_DATE_B &&\s*groupName === "ב" &&/,
    "placeholder B is not gated on the date view + its fixed date + groupName === ב",
  );
  assert.ok(SECTION_CODE.includes('const BEGINNER_PLACEHOLDER_DATE_A = "2026-08-02";'));
  assert.ok(SECTION_CODE.includes('const BEGINNER_PLACEHOLDER_DATE_B = "2026-08-03";'));
});

test("9. the approved exact text of both placeholders appears exactly once per view", () => {
  for (const text of [
    "הדרכות מתחילים — קבוצה א",
    "יום ראשון, 2.8.2026",
    "הדרכות מתחילים — קבוצה ב",
    "יום שני, 3.8.2026",
  ]) {
    assert.equal(
      (SECTION_CODE.match(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
      2,
      `${text} does not appear exactly twice (once per view)`,
    );
  }
  // The shared 16:00–19:30 window appears once per placeholder use-site: twice
  // in the unconditional self-view block, and once each in the two date-view
  // blocks — four call sites in total.
  assert.equal((SECTION_CODE.match(/16:00–19:30/g) ?? []).length, 4);
});

// ===========================================================================
// 4. Unchanged behaviour: advanced rows, date tabs, and no hardcoded union
// ===========================================================================

test("10. the advanced/STORED rendering pipeline is unchanged", () => {
  assert.ok(SECTION_CODE.includes("<ExamAssignmentRows assignments={row.assignments} />"));
  assert.ok(SECTION_CODE.includes("<ExamPersonalAssignmentDetail assignments={row.assignments} />"));
});

test("11. the date sub-tabs are still derived from the REAL, unfiltered contract dates (no hardcoded union)", () => {
  // Deliberate, accepted design decision: NO hardcoded date union in this file.
  // `dates` stays exactly `listExamDates(allRows)` — the golden-file's own
  // pinned literal (`lib/actions/trainee-exam-schedule.contract.test.ts` test
  // 14p) — so the two placeholder dates keep appearing in the tab list only
  // because live BEGINNER rows currently exist on them upstream. If that
  // upstream data ever stops carrying rows on 2026-08-02 / 2026-08-03, the date
  // tab itself would stop being offered; accepted because this suppression is
  // explicitly temporary, not a permanent removal.
  assert.ok(SECTION_CODE.includes("const dates = listExamDates(allRows);"));
  assert.ok(SECTION_CODE.includes("<ExamDateTabs dates={dates} selectedDate={activeDate}"));
});
