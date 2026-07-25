/**
 * UNIFIED TRAINEE SCHEDULE - SLICE U1: contract tests for the "הלו״ז שלי"
 * client component (app/student/UnifiedScheduleSection.tsx).
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * UnifiedScheduleSection.tsx imports lib/actions/unified-trainee-schedule.ts,
 * a "use server" module that transitively pulls in Prisma/next/headers, so it
 * cannot be imported into a plain `tsx --test` process. This uses the
 * repository's established SOURCE-CONTRACT pattern (same as
 * schedule-card-info-details.contract.test.ts).
 *
 * The pure eligibility/merge/tag/sort/overlap logic itself is proven DB-free,
 * with real execution, in lib/course/unified-trainee-schedule-core.test.ts -
 * this file proves only the CLIENT wiring: no client-supplied offering id, no
 * ScheduleTimeGrid, ScheduleCard reuse (not duplication), the four required
 * states, and the always-visible source/overlap badges.
 *
 * Run with:
 *   npx tsx --test app/student/UnifiedScheduleSection.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SRC = readSource("./UnifiedScheduleSection.tsx");

// ---------------------------------------------------------------------------
// No client-supplied offering id / student id / dual flag reaches the reader.
// ---------------------------------------------------------------------------

test("calls getUnifiedScheduleForTrainee with exactly one argument: dayKey", () => {
  assert.ok(
    SRC.includes("getUnifiedScheduleForTrainee(dayKey)\n      .then((result) => {"),
    "expected the reader called with only dayKey, immediately chained with .then",
  );
  // The only other appearance is the import statement and the file's own
  // header-comment explanation - never a second call site with extra args.
  const codeCalls = SRC.match(/getUnifiedScheduleForTrainee\([a-zA-Z, ]*\)/g) ?? [];
  for (const call of codeCalls) {
    assert.ok(
      call === "getUnifiedScheduleForTrainee(dayKey)",
      `unexpected call form: ${call}`,
    );
  }
});

test("the component takes only studentId and dayKey as props - no courseOfferingId or dual flag", () => {
  const propsStart = SRC.indexOf("export function UnifiedScheduleSection({");
  assert.notEqual(propsStart, -1);
  const propsEnd = SRC.indexOf("}) {", propsStart);
  const propsBlock = SRC.slice(propsStart, propsEnd);
  assert.ok(propsBlock.includes("studentId"));
  assert.ok(propsBlock.includes("dayKey"));
  assert.ok(!/courseOffering|dual/i.test(propsBlock), "no course offering id or dual flag may be accepted as a prop");
});

// ---------------------------------------------------------------------------
// Reuse, never duplication: ScheduleCard + isItemActiveNow imported from the
// existing ScheduleSection.tsx, never re-declared; ScheduleTimeGrid unused.
// ---------------------------------------------------------------------------

test("imports ScheduleCard and isItemActiveNow from the existing ScheduleSection.tsx", () => {
  assert.match(
    SRC,
    /import\s*\{\s*ScheduleCard,\s*isItemActiveNow\s*\}\s*from\s*"\.\/ScheduleSection";/,
  );
  assert.ok(!/function ScheduleCard/.test(SRC), "must not redeclare ScheduleCard");
  assert.ok(!/function isItemActiveNow/.test(SRC), "must not redeclare isItemActiveNow");
});

test("never imports or renders ScheduleTimeGrid - a chronological stacked list only", () => {
  assert.ok(!SRC.includes('"@/lib/components/ScheduleTimeGrid"'), "must not import ScheduleTimeGrid");
  assert.ok(!/<ScheduleTimeGrid/.test(SRC), "must not render ScheduleTimeGrid");
});

test("does not reimplement placeholder filtering or sorting - relies on the pure core via the reader", () => {
  assert.ok(
    !SRC.includes("isCombinedParticipationPlaceholder"),
    "placeholder exclusion is already guaranteed server-side (mergeUnifiedScheduleSources) - must not be re-checked/re-filtered here",
  );
  assert.ok(!/\.sort\(/.test(SRC), "chronological order is already guaranteed by the pure core - must not re-sort client-side");
});

// ---------------------------------------------------------------------------
// Required states: loading, empty day, expected access failure (denied),
// unexpected error - each with a distinct Hebrew message, never a silent
// fallback to a single course.
// ---------------------------------------------------------------------------

test("renders a loading state while dayKey is unresolved or the request is in flight", () => {
  assert.ok(SRC.includes('!dayKey || state.status === "loading"'));
  assert.ok(SRC.includes(">טוען...<"));
});

test("renders a distinct expected-access-failure state when the server reports eligible: false", () => {
  assert.ok(SRC.includes('if (!result.eligible)'));
  assert.ok(SRC.includes('setState({ status: "denied" })'));
  assert.match(SRC, /const UNIFIED_SCHEDULE_DENIED_MESSAGE = "[^"]+";/);
});

test("renders a distinct unexpected-error state on a rejected request, never a raw error", () => {
  assert.ok(SRC.includes(".catch(() => {"));
  assert.ok(SRC.includes('setState({ status: "error" })'));
  assert.match(SRC, /const UNIFIED_SCHEDULE_LOAD_ERROR_MESSAGE = "[^"]+";/);
  assert.ok(!/error\.message/.test(SRC), "no raw server error message may be rendered");
});

test("renders a distinct empty-day state when eligible but zero items", () => {
  assert.ok(SRC.includes("state.items.length === 0"));
  assert.ok(SRC.includes(">אין פריטים להצגה<"));
});

test("the four states are mutually exclusive branches of one ternary chain, never independent booleans that could overlap", () => {
  const branchCount = (SRC.match(/\) : (state\.status === "|state\.items\.length === 0)/g) ?? []).length;
  assert.ok(branchCount >= 3, "expected a single chained ternary covering denied/error/empty");
});

// ---------------------------------------------------------------------------
// Always-visible source-course badge + minimal overlap badge, via the SAME
// extraBadges slot ScheduleCard already exposes - never a second card render
// path, never hidden behind the compact-only details dialog.
// ---------------------------------------------------------------------------

test("every item shows its source course via ScheduleCard's extraBadges slot, not the compact-only details dialog", () => {
  const cardCallStart = SRC.indexOf("<ScheduleCard");
  assert.notEqual(cardCallStart, -1);
  const cardCallEnd = SRC.indexOf("/>\n          ))}", cardCallStart);
  assert.ok(cardCallEnd > cardCallStart);
  const call = SRC.slice(cardCallStart, cardCallEnd);
  assert.ok(call.includes("extraBadges={"), "expected the extraBadges prop to carry the source/overlap badges");
  assert.ok(call.includes("item.sourceCourseLabel"), "expected the always-visible course badge");
  assert.ok(
    !/\scompact(\s|=|\/|$)/.test(call.replace(/\{\/\*[\s\S]*?\*\/\}/g, "")),
    "the unified list is a plain stacked list, never the compact/grid card variant - no compact prop passed",
  );
});

test("the overlap badge is gated on overlappingSourceCourseOfferingIds.length > 0 and never hides either item", () => {
  assert.ok(SRC.includes("item.overlappingSourceCourseOfferingIds.length > 0"));
  assert.ok(SRC.includes("חפיפה בלו"), "expected the minimal Hebrew overlap badge wording");
  assert.ok(!/overlappingSourceCourseOfferingIds[\s\S]{0,80}(hide|filter|remove)/i.test(SRC), "must never hide/filter an overlapping item");
});

test("items are rendered by mapping the loaded list directly - no merge/dedup by title or time", () => {
  assert.ok(SRC.includes("state.items.map((item) =>"));
  assert.ok(!/title.*===.*title|startTime.*===.*startTime/.test(SRC), "must not merge items by matching title/time");
});
