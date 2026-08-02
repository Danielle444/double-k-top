/**
 * EX-EXAM-TP-CARDS — the trainee exam screen's real Teaching-Practice cards.
 *
 * StudentExamsSection.tsx cannot be rendered in node:test (no DOM/testing-
 * library in this project, and its data comes from `use server` modules that
 * pull `server-only`), so this checks the wiring at the source level, the
 * established convention for this screen family. The pure merge/filter logic
 * behind it is exercised with REAL calls in trainee-exam-self-view-core.test.ts.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-exam-teaching-practice-cards.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SRC = readSource("./StudentExamsSection.tsx");
const CODE = stripComments(SRC);
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// ===========================================================================
// 4. listMyTeachingPracticeLessonsForTrainee is called exactly once
// ===========================================================================

test("4. listMyTeachingPracticeLessonsForTrainee is imported and called EXACTLY once", () => {
  assert.ok(
    CODE.includes('import { listMyTeachingPracticeLessonsForTrainee } from "@/lib/actions/teaching-practice-student";'),
    "the reader is not imported as a value import",
  );
  const calls = CODE.match(/listMyTeachingPracticeLessonsForTrainee\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ['listMyTeachingPracticeLessonsForTrainee("")'], "the reader must be called exactly once");
});

test("4b. the load is a single mount-only effect - no per-date, no re-fetch on mode/date-tab change", () => {
  const callIndex = CODE.indexOf('listMyTeachingPracticeLessonsForTrainee("")');
  assert.notEqual(callIndex, -1);
  // The nearest enclosing effect closes with an EMPTY dependency array.
  const afterCall = CODE.slice(callIndex, callIndex + 400);
  assert.match(afterCall, /\}, \[\]\);/, "the Teaching-Practice load effect does not have an empty dependency array");
  // It is its OWN effect, independent of `mode`/`navDate`/the exam-schedule
  // load. Scoped to the EFFECT itself (`afterCall`), not the whole file -
  // `[myTeachingPracticeLessons]` legitimately appears elsewhere as a
  // `useMemo` dependency (the same-parent badge map and popup rows, which
  // must recompute when the load resolves - see tests 17-21 below), which is
  // not a re-fetch and must not be banned file-wide.
  for (const token of ["[mode]", "[navDate]", "[activeDate]", "[myTeachingPracticeLessons]"]) {
    assert.equal(afterCall.includes(token), false, `the Teaching-Practice load effect depends on ${token}`);
  }
  // The load effect itself is untouched by the same-parent state added
  // alongside it.
  assert.equal(afterCall.includes("samePopupChildId"), false, "the load effect now depends on popup state");
});

// ===========================================================================
// 5. Only participant-scoped published lessons appear as CARDS (trust the
//    reused reader; assert this screen adds no override/widening of its
//    own). `listPublishedTeachingPracticeTracksForTrainee` is a DELIBERATE,
//    approved exception - see EX-EXAM-TP-SAME-PARENT-TRACKS: it feeds the
//    same-parent POPUP only, never a card, and never the roster-wide
//    lessons reader.
// ===========================================================================

test("5. no publication, capability or participant override is introduced for the real cards", () => {
  for (const token of [
    "includeUnpublished",
    "includeDraft",
    "skipCapability",
    "bypassParticipant",
    "allLessons",
    "listPublishedTeachingPracticeLessonsForTrainee",
  ]) {
    assert.equal(CODE.includes(token), false, `the screen widens the Teaching-Practice read via ${token}`);
  }
  // The roster-wide LESSONS reader ("כל ההתנסויות") is still never imported -
  // only the roster-wide TRACKS reader is (for the popup, see tests 20-21).
  assert.equal(
    CODE.includes("listPublishedTeachingPracticeLessonsForTrainee"),
    false,
    "the roster-wide lessons reader was introduced",
  );
  // Three import statements from this module now: the trainee-scoped
  // lessons reader (value), the roster-wide tracks reader (value, popup-only),
  // and the type-only import.
  assert.equal(
    (CODE.match(/from\s+"@\/lib\/actions\/teaching-practice-student"/g) ?? []).length,
    3,
  );
  assert.ok(
    CODE.includes('import { listMyTeachingPracticeLessonsForTrainee } from "@/lib/actions/teaching-practice-student";'),
  );
  assert.ok(
    CODE.includes(
      'import { listPublishedTeachingPracticeTracksForTrainee } from "@/lib/actions/teaching-practice-student";',
    ),
  );
});

// ===========================================================================
// 6. Identity is never matched by display name
// ===========================================================================

test("6. no display-name comparison is used anywhere in the real-card wiring", () => {
  for (const token of [
    "fullName ===",
    "traineeName ===",
    ".includes(fullName",
    ".includes(traineeName",
    "session.fullName",
    "===  lesson.responsibleInstructorName",
  ]) {
    assert.equal(CODE.includes(token), false, `identity is matched by ${token}`);
  }
  // This screen has no student id, no name, and no viewer identity of its own
  // to compare with - identity is entirely the reused reader's job.
  for (const token of ["studentId ===", "traineeId ===", "session.id"]) {
    assert.equal(CODE.includes(token), false, `the screen introduces its own identity comparison via ${token}`);
  }
});

// ===========================================================================
// 9–10. Real cards appear ONLY in "לו״ז שלי", never in "לפי תאריך"
// ===========================================================================

test('9. the real card is rendered inside the "לו״ז שלי" (mode === "self") branch', () => {
  const selfStart = CODE.indexOf('mode === "self" &&');
  const dateStart = CODE.search(/mode === "date" &&\s+groups\.map\(/);
  assert.ok(selfStart >= 0 && dateStart > selfStart, "the two view branches could not be located");
  const selfBranch = CODE.slice(selfStart, dateStart);
  assert.ok(
    selfBranch.includes("<TeachingPracticeLessonCard"),
    "the real card is not rendered inside the self view",
  );
});

test('10. no real card is rendered inside "לפי תאריך" - it shows no Teaching-Practice detail of any kind', () => {
  const dateStart = CODE.search(/mode === "date" &&\s+groups\.map\(/);
  assert.notEqual(dateStart, -1);
  const dateBranch = CODE.slice(dateStart);
  assert.equal(
    dateBranch.includes("TeachingPracticeLessonCard"),
    false,
    "the real card leaked into לפי תאריך",
  );
  // ...and the OLD live re-projection detail is not rendered there either - only the dead routing branch remains (unreachable, since filteredRows already excludes beginner rows).
  assert.equal(
    (dateBranch.match(/<ExamBeginnerRows/g) ?? []).length,
    1,
    "לפי תאריך's beginner-routing branch changed shape",
  );
});

test("10b. exactly ONE TeachingPracticeLessonCard render site exists in the whole file", () => {
  assert.equal((CODE.match(/<TeachingPracticeLessonCard/g) ?? []).length, 1);
});

// ===========================================================================
// 11. The temporary trainee placeholders are FULLY removed
// ===========================================================================

test("11. every FUNCTIONAL trace of the temporary trainee placeholder is gone", () => {
  // Checked against CODE (comments stripped): the historical tag
  // "EX-C2-0-SUSPEND-UI" is expected to remain in PROSE, explaining that it
  // was removed (see the file header) - that is documentation, not a trace of
  // the implementation, so it is deliberately not in this list.
  for (const token of [
    "BeginnerPlaceholderCard",
    "BEGINNER_PLACEHOLDER_DATE_A",
    "BEGINNER_PLACEHOLDER_DATE_B",
    "groupName",
    "הדרכות מתחילים",
    "קבוצה א",
    "קבוצה ב",
  ]) {
    assert.equal(CODE.includes(token), false, `a functional trace of the temporary placeholder survives: ${token}`);
  }
  // The section takes no props at all any more.
  assert.ok(CODE.includes("export function StudentExamsSection() {"));
});

test("11b. StudentClient.tsx no longer passes a groupName prop to the exams screen", () => {
  const client = readSource("./StudentClient.tsx");
  assert.ok(client.includes("<StudentExamsSection />"), "StudentClient must mount the exams screen with no props");
  assert.equal(client.includes("StudentExamsSection groupName"), false);
});

// ===========================================================================
// 12. Advanced exam rows remain unchanged
// ===========================================================================

test("12. the advanced exam row's rendered fields and renderer are unchanged", () => {
  for (const fragment of [
    "row.definitionName",
    "row.startTime",
    "row.displayEndTime",
    "row.arena ?? row.location",
    "row.selfLabel",
    "row.selfStartTime",
    "row.selfEndTime",
    "<ExamPersonalAssignmentDetail assignments={row.assignments} />",
  ]) {
    assert.ok(CODE.includes(fragment), `the advanced row dropped ${fragment}`);
  }
  assert.equal((CODE.match(/<ExamPersonalAssignmentDetail/g) ?? []).length, 1);
  // "לפי תאריך" advanced rendering (ExamAssignmentRows + PeopleLine summary) is untouched.
  assert.ok(CODE.includes("<ExamAssignmentRows assignments={row.assignments} />"));
  assert.equal((CODE.match(/<ExamAssignmentRows/g) ?? []).length, 1);
});

// ===========================================================================
// 13. Date navigation remains unchanged
// ===========================================================================

test("13. date sub-tab navigation is unchanged", () => {
  assert.ok(CODE.includes("const [navDate, setNavDate] = useState<string | null>(null);"));
  assert.ok(
    CODE.includes("navDate !== null && dates.includes(navDate) ? navDate : earliestExamDate(dates)"),
  );
  assert.ok(CODE.includes("<ExamDateTabs dates={dates} selectedDate={activeDate} onSelectDate={setNavDate} />"));
  assert.equal((CODE.match(/<ExamDateTabs\s/g) ?? []).length, 1);
});

// ===========================================================================
// 14 (partial - screen-level half; the pure-logic half is real-tested in
//     trainee-exam-self-view-core.test.ts). A denied/Level-2-only trainee's
//     empty lesson list renders no cards - already guaranteed by the pure
//     filter (tested directly), and here we confirm the screen never treats
//     an empty/denied load as an error state of its own.
// ===========================================================================

test("14. a denied/empty Teaching-Practice load fails closed to no cards, never a second error state", () => {
  assert.match(CODE, /\.catch\(\(\) => \{\s*if \(cancelled\) return;\s*setMyTeachingPracticeLessons\(\[\]\);/);
  // There is still exactly ONE `failed` flag and ONE ERROR_TEXT on this screen.
  assert.equal((CODE.match(/setFailed\(true\)/g) ?? []).length, 1);
  assert.equal((CODE.match(/ERROR_TEXT/g) ?? []).length, 2); // declaration + the one render site
});

// ===========================================================================
// 15. No internal database identifier is NEWLY exposed
// ===========================================================================

test("15. the only field read from a real lesson is .id, used solely as the React list key", () => {
  const uses = Array.from(new Set(CODE.match(/entry\.lesson\.\w+/g) ?? []));
  assert.deepEqual(uses, ["entry.lesson.id"]);
  assert.ok(CODE.includes("key={`practice:${entry.lesson.id}`}"));
  // The whole lesson object is handed over verbatim - never destructured or
  // spread into this file.
  for (const token of ["...entry.lesson", "{...lesson}", "JSON.stringify(entry.lesson"]) {
    assert.equal(CODE.includes(token), false, `the screen unpacks entry.lesson via ${token}`);
  }
});

// ===========================================================================
// 16. Instructor placeholder behavior is completely untouched
// ===========================================================================

test("16. no instructor file was touched by this trainee-only change", () => {
  const diff = spawnSync("git", ["diff", "--name-only", "HEAD", "--", "app/instructor"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(diff.status, 0, "git diff failed");
  assert.equal(
    (diff.stdout ?? "").trim(),
    "",
    "this trainee-only slice must not touch any instructor file - the instructor placeholder must stay exactly as it is",
  );
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "--", "app/instructor"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(untracked.status, 0, "git ls-files failed");
  assert.equal((untracked.stdout ?? "").trim(), "", "a new untracked instructor file appeared");
});

test("16b. the instructor placeholder implementation and its own test suite still exist, unchanged", () => {
  const instructorSection = readSource("../instructor/InstructorExamsSection.tsx");
  for (const token of [
    "BeginnerPlaceholderCard",
    "BEGINNER_PLACEHOLDER_DATE_A",
    "BEGINNER_PLACEHOLDER_DATE_B",
    "הדרכות מתחילים — קבוצה א",
    "הדרכות מתחילים — קבוצה ב",
  ]) {
    assert.ok(instructorSection.includes(token), `the instructor placeholder lost ${token}`);
  }
});

// ===========================================================================
// EX-EXAM-TP-SAME-PARENT — the real same-parent badge/popup, wired for real
// ===========================================================================

test("17. the card receives a REAL, non-empty-capable same-parent map - never the old empty placeholder", () => {
  assert.equal(CODE.includes("EMPTY_SAME_PARENT_MAP"), false, "the empty-map placeholder survives");
  assert.equal(CODE.includes("NOOP_OPEN_SAME_PARENT_POPUP"), false, "the no-op callback placeholder survives");
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<TeachingPracticeLessonCard key=\{`practice:\$\{entry\.lesson\.id\}`\} lesson=\{entry\.lesson\} sameParentOtherNamesByChildId=\{examSameParentOtherNamesByChildId\} onOpenSameParentPopup=\{handleOpenSameParentPopup\} \/>/,
    "the card is not wired to the real same-parent map and opener",
  );
});

test("17b. the map is built from buildSameParentOtherNamesByChildId, keyed by real childId, from the FULL loaded lesson result", () => {
  assert.ok(CODE.includes('from "@/lib/teaching-practice-same-parent"'));
  assert.ok(CODE.includes("buildSameParentOtherNamesByChildId("));
  assert.ok(CODE.includes("const examSameParentOtherNamesByChildId = useMemo(() => {"));
  assert.match(
    CODE.replace(/\s+/g, " "),
    /for \(const lesson of myTeachingPracticeLessons \?\? \[\]\) \{/,
    "the badge map is not built from the full myTeachingPracticeLessons result",
  );
  // NOT the date-narrowed subset shown as cards.
  assert.equal(
    /for \(const lesson of beginnerLessonsForSelfView/.test(CODE),
    false,
    "the badge map must be built from the FULL lesson result, not the exam-day-filtered subset",
  );
  assert.ok(CODE.includes("id: c.childId,"), "the map key is not the real childId");
  for (const token of ["fullName ===", "displayName ===", ".includes(displayName"]) {
    assert.equal(CODE.includes(token), false, `identity is matched by ${token} instead of childId`);
  }
});

test("18. clicking the same-parent indication opens the popup - handleOpenSameParentPopup sets the popup's target child", () => {
  const start = CODE.indexOf("function handleOpenSameParentPopup(childId: string) {");
  assert.notEqual(start, -1, "handleOpenSameParentPopup is missing");
  const end = CODE.indexOf("function handleCloseSameParentPopup() {", start);
  assert.ok(end > start);
  const body = CODE.slice(start, end).replace(/\s+/g, " ");
  assert.match(body, /setSamePopupChildId\(childId\);/, "handleOpenSameParentPopup does not set samePopupChildId");
  assert.ok(CODE.includes("const [samePopupChildId, setSamePopupChildId] = useState<string | null>(null);"));
});

test("19. closing the popup works - handleCloseSameParentPopup clears the popup's target child", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /function handleCloseSameParentPopup\(\) \{ setSamePopupChildId\(null\); \}/,
    "handleCloseSameParentPopup does not clear samePopupChildId",
  );
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<TeachingPracticeSameParentPopup open=\{samePopupChildId !== null\} onClose=\{handleCloseSameParentPopup\} rows=\{samePopupRows\} \/>/,
    "the popup is not wired to the close handler",
  );
  assert.equal((CODE.match(/<TeachingPracticeSameParentPopup/g) ?? []).length, 1);
});

test("20. the popup rows reuse the SAME shared, pure row-builder with the REAL tracks - not re-implemented, and not hard-wired to []", () => {
  assert.ok(CODE.includes('from "@/lib/components/TeachingPracticeSameParentPopup"'));
  assert.match(
    CODE.replace(/\s+/g, " "),
    /const samePopupRows = useMemo\(\(\) => \{ if \(!samePopupChildId\) return null; if \(tracks === null\) return null; return buildSameParentPopupRows\(samePopupChildId, myTeachingPracticeLessons \?\? \[\], tracks\); \}, \[samePopupChildId, myTeachingPracticeLessons, tracks\]\);/,
    "samePopupRows does not delegate to the shared buildSameParentPopupRows with the real tracks state",
  );
  assert.equal(CODE.includes("buildSameParentPopupRows(samePopupChildId, myTeachingPracticeLessons ?? [], []);"), false, "tracks is hard-wired to an empty array");
  // No re-implementation of the row-matching loop.
  for (const token of ["targetKey", "buildParentKey("]) {
    assert.equal(CODE.includes(token), false, `the row-matching logic (${token}) was re-implemented inline`);
  }
});

test("21. tracks is loaded through the SAME existing authorized reader, LAZILY and exactly ONCE (cached, never per-click, never per-date)", () => {
  assert.ok(
    CODE.includes(
      'import { listPublishedTeachingPracticeTracksForTrainee } from "@/lib/actions/teaching-practice-student";',
    ),
    "the tracks reader is not imported",
  );
  const calls = CODE.match(/listPublishedTeachingPracticeTracksForTrainee\([^)]*\)/g) ?? [];
  assert.deepEqual(calls, ['listPublishedTeachingPracticeTracksForTrainee("")'], "the tracks reader must be called exactly once in source (one call site)");
  // The ONE call site is guarded so a second click never re-fetches.
  const openStart = CODE.indexOf("function handleOpenSameParentPopup(childId: string) {");
  const openEnd = CODE.indexOf("function handleCloseSameParentPopup() {", openStart);
  const openBody = CODE.slice(openStart, openEnd);
  assert.match(openBody.replace(/\s+/g, " "), /if \(tracks === null\) \{/, "the tracks load is not guarded against re-fetching on a later click");
  assert.ok(openBody.includes("listPublishedTeachingPracticeTracksForTrainee("), "the tracks load does not happen inside the open handler");
  // Never depends on `mode`, `navDate` or any date-navigation state - a
  // date-tab change can never trigger it.
  for (const token of ["[mode]", "[navDate]", "[activeDate]"]) {
    assert.equal(openBody.includes(token), false, `the tracks load depends on ${token}`);
  }
  // Still exactly the SAME two mount-only effects for the exam schedule and
  // the lessons load - tracks is loaded from the CLICK handler, not a third
  // effect.
  assert.equal((CODE.match(/useEffect\(/g) ?? []).length, 2, "a third mount-time effect was added for tracks");
  // The roster-wide LESSONS reader stays banned - only the tracks reader is
  // the approved exception.
  assert.equal(
    CODE.includes("listPublishedTeachingPracticeLessonsForTrainee"),
    false,
    "the roster-wide lessons reader was introduced",
  );
});
