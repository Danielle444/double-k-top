/**
 * EX-EXAM-TP-CARDS — StudentTeachingPracticeSection.tsx after extraction.
 *
 * Proves: (2) the screen now renders "ההתנסויות שלי" through the shared
 * `TeachingPracticeLessonCard` with no local re-implementation and no
 * behavior loss, and (3) the same-parent indicator/popup behavior in THIS
 * screen remains fully wired and functional.
 *
 * StudentTeachingPracticeSection.tsx cannot be imported in node:test (it pulls
 * the committed Server Action module's `server-only` chain), so this checks
 * the wiring at the source level, the established convention for this screen
 * family.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-teaching-practice-shared-card.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const SRC = readSource("./StudentTeachingPracticeSection.tsx");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SRC);

const EXAMS_SRC = readSource("./StudentExamsSection.tsx");
const EXAMS_CODE = stripComments(EXAMS_SRC);

// ===========================================================================
// 2. The screen renders through the shared card, with no local copy
// ===========================================================================

test("2a. the local LessonCard/SameParentBadge/label-map definitions are GONE", () => {
  assert.equal(CODE.includes("function LessonCard("), false, "a local LessonCard definition survives");
  assert.equal(CODE.includes("function SameParentBadge("), false, "a local SameParentBadge definition survives");
  assert.equal(
    /const PRACTICE_TYPE_LABELS\s*[:=]/.test(CODE),
    false,
    "a local PRACTICE_TYPE_LABELS definition survives",
  );
  assert.equal(/const ROLE_LABELS\s*[:=]/.test(CODE), false, "a local ROLE_LABELS definition survives");
});

test("2f. StudentExamsSection.tsx (the exam trainee \"לו\"ז שלי\" view) routes through the SAME shared TeachingPracticeLessonCard, with no separate/duplicate TP role-label resolution logic in either surface file", () => {
  // EX-EXAM-TP-CARDS-ROLE-LABEL - both trainee-facing mount points
  // (StudentTeachingPracticeSection.tsx and StudentExamsSection.tsx) consume
  // the same reader (listMyTeachingPracticeLessonsForTrainee) and must render
  // participant role labels through the exact same shared card, never a
  // second, independently-maintained resolution.
  assert.match(
    EXAMS_CODE.replace(/\s+/g, " "),
    /import \{ TeachingPracticeLessonCard \} from "@\/lib\/components\/TeachingPracticeLessonCard";/,
    "StudentExamsSection.tsx does not import the shared TeachingPracticeLessonCard",
  );
  assert.ok(
    EXAMS_CODE.includes("<TeachingPracticeLessonCard"),
    "StudentExamsSection.tsx does not render the shared TeachingPracticeLessonCard",
  );
  // Neither surface file re-declares its own TP ROLE_LABELS map or resolves
  // a role label inline - that logic lives only inside the shared card.
  for (const [label, code] of [
    ["StudentTeachingPracticeSection.tsx", CODE],
    ["StudentExamsSection.tsx", EXAMS_CODE],
  ] as const) {
    assert.equal(/const ROLE_LABELS\s*[:=]/.test(code), false, `${label} declares a local duplicate ROLE_LABELS map`);
    // Word-boundary check: StudentExamsSection.tsx legitimately has its own,
    // unrelated SELF_ROLE_LABELS map (EXAMINEE/INSTRUCTED_TRAINEE) - only a
    // bare "ROLE_LABELS[" (the TP role map) must be absent, not that longer,
    // differently-named identifier.
    assert.equal(
      /(?<![A-Za-z0-9_])ROLE_LABELS\[/.test(code),
      false,
      `${label} resolves a TP role label inline instead of through the shared card`,
    );
    assert.equal(code.includes("roleLabelOverrides?."), false, `${label} resolves roleLabelOverrides inline instead of through the shared card`);
  }
});

test("2b. the shared card and badge are imported from the extracted module, not re-implemented", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /import \{ SameParentBadge, TeachingPracticeLessonCard \} from "@\/lib\/components\/TeachingPracticeLessonCard";/,
    "the card and badge are not imported from the shared module",
  );
});

test("2b2. the shared popup, GroupBadge and row-builder are imported from the extracted popup module, not re-implemented", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /import \{\s*GroupBadge,\s*buildSameParentPopupRows,\s*TeachingPracticeSameParentPopup,\s*\} from "@\/lib\/components\/TeachingPracticeSameParentPopup";/,
    "GroupBadge/buildSameParentPopupRows/TeachingPracticeSameParentPopup are not imported from the shared popup module",
  );
});

test('2c. "ההתנסויות שלי" renders the shared card, with the SAME three props as before', () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<TeachingPracticeLessonCard key=\{lesson\.id\} lesson=\{lesson\} sameParentOtherNamesByChildId=\{mineSameParentOtherNamesByChildId\} onOpenSameParentPopup=\{handleOpenSameParentPopup\} \/>/,
    "ההתנסויות שלי does not render the shared card with its original props",
  );
  assert.equal((CODE.match(/<TeachingPracticeLessonCard/g) ?? []).length, 1, "the shared card is mounted more than once");
});

test("2d. PRACTICE_TYPE_LABELS is GONE from this file entirely - the popup's practice-type label now lives in the extracted popup module too", () => {
  // EX-EXAM-TP-SAME-PARENT RE-POINT — the whole popup (including its
  // practice-type label line) moved into `TeachingPracticeSameParentPopup`;
  // this screen no longer imports or names PRACTICE_TYPE_LABELS at all.
  assert.equal(CODE.includes("PRACTICE_TYPE_LABELS"), false, "PRACTICE_TYPE_LABELS survives in this file");
});

test("2e. SameParentBadge's OTHER existing use site (ChildNameCell, for the generated/fixed-structure tables) is unchanged", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<SameParentBadge otherNames=\{sameParentOtherNamesByChildId\.get\(child\.childId\) \?\? \[\]\} onClick=\{\(\) => onOpenSameParentPopup\(child\.childId\)\} \/>/,
    "ChildNameCell no longer wires the same-parent badge",
  );
});

// ===========================================================================
// 3. Same-parent popup behavior remains fully functional in THIS screen
// ===========================================================================

test("3a. the same-parent popup state, opener and closer are all still present", () => {
  assert.ok(CODE.includes("const [samePopupChildId, setSamePopupChildId] = useState<string | null>(null);"));
  assert.ok(CODE.includes("function handleOpenSameParentPopup(childId: string) {"));
  assert.ok(CODE.includes("function handleCloseSameParentPopup() {"));
  assert.ok(CODE.includes("setSamePopupChildId(childId);"));
  assert.ok(CODE.includes("setSamePopupChildId(null);"));
});

test("3b. the popup lazily loads BOTH combined sources (allLessons + tracks) on first open, unchanged", () => {
  assert.ok(
    CODE.includes("if (allLessons === null) {") && CODE.includes("if (tracks === null) {"),
    "the popup no longer lazily loads both sources on first open",
  );
  assert.ok(CODE.includes("listPublishedTeachingPracticeLessonsForTrainee(studentId)"));
  assert.ok(CODE.includes("listPublishedTeachingPracticeTracksForTrainee(studentId)"));
});

test("3c. the shared popup component is mounted and wired to the SAME state (Modal itself now lives inside it)", () => {
  assert.equal(CODE.includes('from "@/lib/components/Modal"'), false, "Modal is imported directly - it should live only inside the shared popup module now");
  assert.equal(CODE.includes("<Modal"), false, "a raw <Modal> survives instead of the shared popup component");
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<TeachingPracticeSameParentPopup open=\{samePopupChildId !== null\} onClose=\{handleCloseSameParentPopup\} rows=\{samePopupRows\} \/>/,
    "the shared popup is not wired to samePopupChildId/handleCloseSameParentPopup/samePopupRows",
  );
  assert.equal((CODE.match(/<TeachingPracticeSameParentPopup/g) ?? []).length, 1);
});

test("3f. the row-building logic is the SAME shared, pure function - not re-implemented inline", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /const samePopupRows = useMemo\(\(\) => \{ if \(!samePopupChildId\) return null; if \(allLessons === null \|\| tracks === null\) return null; return buildSameParentPopupRows\(samePopupChildId, allLessons, tracks\); \}, \[samePopupChildId, allLessons, tracks\]\);/,
    "samePopupRows no longer delegates to the shared buildSameParentPopupRows",
  );
  // No re-implementation of the row-matching loop survives inline.
  for (const token of ["targetKey", "buildParentKey("]) {
    assert.equal(CODE.includes(token), false, `the row-matching logic (${token}) was not fully extracted`);
  }
});

test("3d. mineSameParentOtherNamesByChildId (the badge input for ההתנסויות שלי) is still derived from myLessons only, unchanged", () => {
  assert.ok(CODE.includes("const mineSameParentOtherNamesByChildId = useMemo(() => {"));
  assert.match(
    CODE.replace(/\s+/g, " "),
    /for \(const lesson of myLessons \?\? \[\]\) \{/,
    "mineSameParentOtherNamesByChildId no longer derives from myLessons",
  );
});

test("3e. buildSameParentOtherNamesByChildId (the pure detection rule) is still imported and used, not re-implemented", () => {
  assert.ok(CODE.includes('from "@/lib/teaching-practice-same-parent"'));
  assert.ok(CODE.includes("buildSameParentOtherNamesByChildId("));
});
