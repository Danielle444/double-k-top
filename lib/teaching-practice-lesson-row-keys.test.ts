/**
 * TP-STABILITY-1A - the generated Teaching Practice lessons table's React row
 * keys and inline saving-cell keys.
 *
 * The regression this guards: the table's <tr> key used to include
 * row.child?.id (a TeachingPracticeChildAssignment id). That row is saved by
 * deleteMany + createMany, so every horse / equipment / child-name save
 * regenerated the id, changed the key, and made React unmount and remount the
 * whole row subtree - destroying the focused <input>, its uncommitted draft,
 * open SearchableSelect state and the scroll position mid-edit.
 *
 * Tests 1-13 are plain unit tests over the pure key builders. Tests 14-21 are
 * SOURCE-CONTRACT tests (the repository's established pattern - see
 * app/student/schedule-card-info-details.contract.test.ts): TeachingPracticeManager.tsx
 * transitively imports "use server" action modules (Prisma + next/cache), so it
 * cannot be imported into a plain `tsx --test` process, and there is no React
 * renderer in this repository's devDependencies.
 *
 * Run with:
 *   npx tsx --test lib/teaching-practice-lesson-row-keys.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildLessonDisplayRowKey,
  buildLessonInlineCellKey,
  resolveLessonChildCellTarget,
  type LessonInlineCellTarget,
} from "./teaching-practice-lesson-row-keys";

// ---------------------------------------------------------------------------
// 1-5: display row keys
// ---------------------------------------------------------------------------

// The row shape the table actually renders, reduced to the fields the old
// identity-based key read - so "regenerating the ids" below is exactly what a
// child-assignment save does on the server.
interface DisplayRowFixture {
  readonly childAssignmentId: string;
  readonly participantId: string;
}

function rowsBeforeSave(): DisplayRowFixture[] {
  return [
    { childAssignmentId: "cka_before_0", participantId: "part_0" },
    { childAssignmentId: "cka_before_1", participantId: "part_1" },
  ];
}

// Same lesson, same participants, same row count - only the child-assignment
// ids differ, which is precisely what deleteMany + createMany produces.
function rowsAfterSave(): DisplayRowFixture[] {
  return [
    { childAssignmentId: "cka_after_0", participantId: "part_0" },
    { childAssignmentId: "cka_after_1", participantId: "part_1" },
  ];
}

test("1: the row key does not depend on the child-assignment id", () => {
  const before = rowsBeforeSave();
  const after = rowsAfterSave();
  assert.notEqual(before[0].childAssignmentId, after[0].childAssignmentId);

  for (let i = 0; i < before.length; i++) {
    assert.equal(buildLessonDisplayRowKey("lesson_a", i), buildLessonDisplayRowKey("lesson_a", i));
  }
  // Explicitly: no input the builder receives can carry an assignment id.
  assert.equal(buildLessonDisplayRowKey("lesson_a", 0), "lesson_a-row-0");
});

test("2: the same lesson + row index is stable across regenerated assignment ids", () => {
  const keysBefore = rowsBeforeSave().map((_, i) => buildLessonDisplayRowKey("lesson_a", i));
  const keysAfter = rowsAfterSave().map((_, i) => buildLessonDisplayRowKey("lesson_a", i));
  assert.deepEqual(keysAfter, keysBefore);
});

test("3: different row indexes produce different keys", () => {
  assert.notEqual(buildLessonDisplayRowKey("lesson_a", 0), buildLessonDisplayRowKey("lesson_a", 1));
  assert.notEqual(buildLessonDisplayRowKey("lesson_a", 1), buildLessonDisplayRowKey("lesson_a", 2));
});

test("4: different lesson ids produce different keys", () => {
  assert.notEqual(buildLessonDisplayRowKey("lesson_a", 0), buildLessonDisplayRowKey("lesson_b", 0));
  // Several lessons share one <tbody>, so all their row keys must be unique
  // together, not merely unique within a lesson.
  const all = ["lesson_a", "lesson_b", "lesson_c"].flatMap((id) =>
    [0, 1, 2].map((i) => buildLessonDisplayRowKey(id, i))
  );
  assert.equal(new Set(all).size, all.length);
});

test("5: keys are stable across a row-count-preserving refresh", () => {
  const rowCount = 3;
  const first = Array.from({ length: rowCount }, (_, i) => buildLessonDisplayRowKey("lesson_a", i));
  const second = Array.from({ length: rowCount }, (_, i) => buildLessonDisplayRowKey("lesson_a", i));
  assert.deepEqual(second, first);

  // A refresh that genuinely changes the row count adds/removes exactly the
  // trailing rows - the surviving ones keep their identity.
  const grown = Array.from({ length: rowCount + 1 }, (_, i) => buildLessonDisplayRowKey("lesson_a", i));
  assert.deepEqual(grown.slice(0, rowCount), first);
});

// ---------------------------------------------------------------------------
// 6-13: inline saving-cell keys
// ---------------------------------------------------------------------------

test("6: startTime key reproduces the existing literal format", () => {
  assert.equal(buildLessonInlineCellKey("L1", { kind: "startTime" }), "lesson-L1-startTime");
});

test("7: notes key reproduces the existing literal format", () => {
  assert.equal(buildLessonInlineCellKey("L1", { kind: "notes" }), "lesson-L1-notes");
});

test("8: participant key reproduces the existing literal format", () => {
  assert.equal(buildLessonInlineCellKey("L1", { kind: "participant", index: 0 }), "lesson-L1-participant-0");
  assert.equal(buildLessonInlineCellKey("L1", { kind: "participant", index: 2 }), "lesson-L1-participant-2");
});

test("9: child base key reproduces the existing literal format", () => {
  assert.equal(buildLessonInlineCellKey("L1", { kind: "child", index: 0 }), "lesson-L1-child-0");
  assert.equal(buildLessonInlineCellKey("L1", { kind: "child", index: 2 }), "lesson-L1-child-2");
});

test("10: horseName key reproduces the existing literal format", () => {
  assert.equal(
    buildLessonInlineCellKey("L1", { kind: "child", index: 0, field: "horseName" }),
    "lesson-L1-child-0-horseName"
  );
});

test("11: equipmentNotes key reproduces the existing literal format", () => {
  assert.equal(
    buildLessonInlineCellKey("L1", { kind: "child", index: 0, field: "equipmentNotes" }),
    "lesson-L1-child-0-equipmentNotes"
  );
});

test("12: child, horse and equipment keys are distinct for the same row", () => {
  const child = buildLessonInlineCellKey("L1", { kind: "child", index: 1 });
  const horse = buildLessonInlineCellKey("L1", { kind: "child", index: 1, field: "horseName" });
  const equipment = buildLessonInlineCellKey("L1", { kind: "child", index: 1, field: "equipmentNotes" });
  assert.equal(new Set([child, horse, equipment]).size, 3);
});

test("13: no collisions across all supported target kinds for one lesson", () => {
  const targets: LessonInlineCellTarget[] = [
    { kind: "startTime" },
    { kind: "notes" },
    ...[0, 1, 2].map((index) => ({ kind: "participant", index }) as const),
    ...[0, 1, 2].flatMap((index) => [
      { kind: "child", index } as const,
      { kind: "child", index, field: "horseName" } as const,
      { kind: "child", index, field: "equipmentNotes" } as const,
    ]),
  ];
  const keys = targets.map((t) => buildLessonInlineCellKey("L1", t));
  assert.equal(new Set(keys).size, keys.length);
});

test("13b: the child saving-key is resolved from the patch, not from key order", () => {
  // The write side must land on the same key the edited cell reads back.
  assert.equal(
    buildLessonInlineCellKey("L1", resolveLessonChildCellTarget(0, { horseName: "רוני" })),
    buildLessonInlineCellKey("L1", { kind: "child", index: 0, field: "horseName" })
  );
  assert.equal(
    buildLessonInlineCellKey("L1", resolveLessonChildCellTarget(1, { equipmentNotes: "אוכף" })),
    buildLessonInlineCellKey("L1", { kind: "child", index: 1, field: "equipmentNotes" })
  );
  assert.equal(
    buildLessonInlineCellKey("L1", resolveLessonChildCellTarget(2, { childId: "c9" })),
    buildLessonInlineCellKey("L1", { kind: "child", index: 2 })
  );
  // Clearing a field to "" is still an edit OF that field.
  assert.deepEqual(resolveLessonChildCellTarget(0, { horseName: "" }), {
    kind: "child",
    index: 0,
    field: "horseName",
  });
  // An ambiguous combined patch resolves by explicit priority, identically
  // regardless of the order the object literal was built in.
  assert.deepEqual(resolveLessonChildCellTarget(0, { equipmentNotes: "b", horseName: "a" }), {
    kind: "child",
    index: 0,
    field: "horseName",
  });
  assert.deepEqual(resolveLessonChildCellTarget(0, { horseName: "a", equipmentNotes: "b" }), {
    kind: "child",
    index: 0,
    field: "horseName",
  });
  // Nothing recognizable to edit -> the row's own child cell, never a guess.
  assert.deepEqual(resolveLessonChildCellTarget(0, {}), { kind: "child", index: 0 });
});

// ---------------------------------------------------------------------------
// 14-21: source contract over TeachingPracticeManager.tsx
// ---------------------------------------------------------------------------

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const MANAGER = readSource("./components/TeachingPracticeManager.tsx");

// The generated-lessons row component only - so assertions here can never be
// satisfied (or broken) by the fixed-structure/track tables further up the file.
function lessonTableRowSource(): string {
  const start = MANAGER.indexOf("function LessonTableRow({");
  assert.notEqual(start, -1, "LessonTableRow not found");
  const end = MANAGER.indexOf("\nfunction ", start + 1);
  assert.ok(end > start, "end of LessonTableRow not found");
  return MANAGER.slice(start, end);
}

// Every handler asserted below is a plain function nested one level inside the
// TeachingPracticeManager component, so its body ends at the first line that is
// exactly two spaces + "}". Slicing on that (rather than on "the next function
// declaration") keeps each assertion scoped to one handler even when the next
// declaration is preceded by a comment block or a section banner.
// Line comments are dropped so that assertions about which calls a handler
// MAKES are never satisfied by a comment that merely names the call - several
// handlers explain in prose why they no longer call refreshLessons().
function stripLineComments(source: string): string {
  return source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function handlerSource(name: string): string {
  const start = MANAGER.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  const end = MANAGER.indexOf("\n  }\n", start + 1);
  assert.ok(end > start, `end of ${name} not found`);
  return stripLineComments(MANAGER.slice(start, end));
}

test("14: the generated lesson row uses buildLessonDisplayRowKey", () => {
  const row = lessonTableRowSource();
  assert.ok(
    row.includes("key={buildLessonDisplayRowKey(lesson.id, i)}"),
    "the <tr> must be keyed by buildLessonDisplayRowKey(lesson.id, i)"
  );
  assert.ok(MANAGER.includes('from "@/lib/teaching-practice-lesson-row-keys"'), "helpers must be imported");
});

test("15: row.child?.id is no longer part of the generated table row key", () => {
  const row = lessonTableRowSource();
  // The old key was `key={[lesson.id, ...participantId..., row.child?.id ...].join("-")}`.
  // [^\]]* already spans newlines, so no dotAll flag is needed (and the
  // project's TS target predates it).
  assert.ok(!/key=\{\[[^\]]*row\.child/.test(row), "row.child must not appear in any row key");
  assert.ok(!/key=\{\[[^\]]*participantId/.test(row), "participantId must not appear in any row key");
  assert.ok(!row.includes('?? "no-child"'), "the old no-child key fallback must be gone");
  assert.ok(!row.includes('?? "no-participant"'), "the old no-participant key fallback must be gone");
});

test("16: both saving-key writes and reads go through buildLessonInlineCellKey", () => {
  // Reads: no generated-lesson cell may hand-build a key string any more.
  const row = lessonTableRowSource();
  assert.ok(
    !/savingCellKey === `lesson-/.test(row),
    "no cell may compare savingCellKey against a hand-written template literal"
  );
  // 10 inline cells: startTime, participant x2 (trainee + role), and per child
  // slot the child picker + horse + equipment (shared-column and per-row
  // variants), plus lesson notes.
  const readCount = (row.match(/savingCellKey ===\s*buildLessonInlineCellKey\(/g) ?? []).length;
  assert.equal(readCount, 10, "all 10 inline cells must read their key from buildLessonInlineCellKey");

  // Writes: every inline handler must build its cellKey the same way.
  for (const name of [
    "handleInlineUpdateLessonField",
    "handleInlineUpdateLessonNotes",
    "handleInlineUpdateLessonParticipant",
    "handleInlineUpdateLessonChild",
  ]) {
    const handler = handlerSource(name);
    assert.ok(
      /const cellKey = buildLessonInlineCellKey\(/.test(handler),
      `${name} must build its cellKey via buildLessonInlineCellKey`
    );
    assert.ok(
      !/const cellKey = `lesson-/.test(handler),
      `${name} must not hand-write its cellKey template literal`
    );
  }
});

test("17: horse and equipment use distinct field-specific keys", () => {
  const row = lessonTableRowSource();
  for (const field of ["horseName", "equipmentNotes"] as const) {
    assert.ok(
      row.includes(`field: "${field}"`),
      `the ${field} cell must read a field-specific key`
    );
  }
  // And the write side derives the field from the patch rather than always
  // writing the un-suffixed child key (the original mismatch).
  const child = handlerSource("handleInlineUpdateLessonChild");
  assert.ok(
    child.includes("resolveLessonChildCellTarget(changedIndex, patch)"),
    "handleInlineUpdateLessonChild must resolve its key from the patch"
  );
});

test("18: InlineTextEditCell does not replace a focused draft from a prop refresh", () => {
  const start = MANAGER.indexOf("function InlineTextEditCell({");
  assert.notEqual(start, -1, "InlineTextEditCell not found");
  const end = MANAGER.indexOf("\nfunction ", start + 1);
  const cell = MANAGER.slice(start, end);

  assert.ok(cell.includes("const isFocusedRef = useRef(false)"), "a focus flag must exist");
  // The value->draft sync must bail out while focused, before setDraft.
  const sync = cell.slice(cell.indexOf("useEffect(("), cell.indexOf("}, [value]);"));
  assert.ok(sync.includes("if (isFocusedRef.current) return;"), "the sync effect must skip while focused");
  assert.ok(sync.indexOf("isFocusedRef.current") < sync.indexOf("setDraft(value)"), "the guard must precede setDraft");
  assert.ok(cell.includes("isFocusedRef.current = true;"), "onFocus must set the flag");
  assert.ok(cell.includes("isFocusedRef.current = false;"), "onBlur must clear the flag");
  // Commit-on-blur / Enter / Escape semantics stay exactly as they were.
  assert.ok(cell.includes("commit();"), "blur must still commit");
  assert.ok(cell.includes('if (e.key === "Enter")'), "Enter must still commit via blur");
  assert.ok(cell.includes("skipCommitRef.current = true;"), "Escape must still revert without committing");
  // No autosave/debounce was introduced.
  assert.ok(!/setTimeout|debounce/i.test(cell), "no debounce or autosave may be added");
});

test("19: only the two approved handlers lose refreshLessons()", () => {
  for (const name of ["handleInlineUpdateLessonChild", "handleInlineUpdateLessonParticipant"]) {
    assert.ok(!handlerSource(name).includes("refreshLessons()"), `${name} must not call refreshLessons()`);
  }
  for (const name of ["handleInlineUpdateLessonField", "handleInlineUpdateLessonNotes", "handleToggleLessonPublished"]) {
    assert.ok(handlerSource(name).includes("refreshLessons()"), `${name} must still call refreshLessons()`);
  }
  // The expanded-form save path keeps every one of its refreshes.
  const update = handlerSource("handleUpdateLesson");
  assert.equal((update.match(/refreshLessons\(\)/g) ?? []).length, 3, "handleUpdateLesson keeps all 3 refreshLessons");
  // The fixed-structure inline handlers are untouched.
  for (const name of ["handleInlineAssignTrackChild", "handleInlineEditTrackChildField", "handleInlineAssignTrainee"]) {
    assert.ok(handlerSource(name).includes("refreshLessons()"), `${name} must still call refreshLessons()`);
  }
});

test("20: refreshLessonDateDetail remains in both handlers", () => {
  for (const name of ["handleInlineUpdateLessonChild", "handleInlineUpdateLessonParticipant"]) {
    assert.ok(
      handlerSource(name).includes("await refreshLessonDateDetail(selectedLessonDate)"),
      `${name} must still refresh the selected date's detail`
    );
  }
});

test("21: fixed-structure row keys are unchanged", () => {
  // The track tables key rows by the track's own id via row.key (built at
  // `{ key: track.id, ...buildTrackRowData(track) }`) - stable already, and
  // deliberately not touched by this change.
  assert.equal((MANAGER.match(/key=\{row\.key\}/g) ?? []).length, 2, "both track tables keep key={row.key}");
  assert.ok(MANAGER.includes("key: track.id,"), "LUNGE/private track rows keep key: track.id");
  assert.ok(MANAGER.includes("key: groupTrack.id,"), "beginner block rows keep key: groupTrack.id");
  assert.ok(
    !/buildLessonDisplayRowKey\((?!lesson\.id, i\))/.test(MANAGER),
    "buildLessonDisplayRowKey must only ever be called as (lesson.id, i)"
  );
  // The track tables' own saving-key strings are a separate, already-correct
  // scheme and must keep using savingCellKey (not savingLessonCellKey).
  assert.ok(MANAGER.includes("savingCellKey === `${row.track.id}-horseName`"), "track horse key unchanged");
  assert.ok(MANAGER.includes("savingCellKey === `${row.track.id}-equipmentNotes`"), "track equipment key unchanged");
});
