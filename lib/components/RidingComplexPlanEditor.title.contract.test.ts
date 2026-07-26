// RC-A3 - DB-free CONTRACT/source test for the complex-session title editor UI
// wired into RidingComplexPlanEditor.tsx. Renders nothing and opens no DB: it
// statically inspects the component source and asserts the RC-A3 wiring/wording
// invariants. Same convention as the sibling *.contract.test.ts files (a full
// RTL/DOM render harness is not established for this 4700-line component).
//
// Run: npx tsx --test lib/components/RidingComplexPlanEditor.title.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const rawSrc = readFileSync(
  fileURLToPath(new URL("./RidingComplexPlanEditor.tsx", import.meta.url)),
  "utf8"
);
const src = stripComments(rawSrc);

// 3. Exact Hebrew label / helper / placeholder.
test("renders the exact Hebrew label, helper text, and placeholder", () => {
  assert.ok(src.includes("שם הרכיבה המורכבת (יוצג לחניכים)"), "exact label missing");
  assert.ok(src.includes("אפשר להשאיר ריק כדי להציג את שם ברירת המחדל"), "exact helper text missing");
  assert.ok(src.includes("ברירת מחדל: תרגול הדרכה"), "exact placeholder missing");
});

// 1 + 2. Field reads plan.title; null title -> empty input.
test("initializes the draft from plan.title with a null -> empty fallback", () => {
  assert.ok(src.includes('setTitleDraft(result.plan.title ?? "")'), "must initialize draft from loaded plan.title ?? \"\"");
});

// 4. maxLength 60 and X/60 counter.
test("enforces maxLength 60 and shows an X/60 counter", () => {
  assert.ok(src.includes("maxLength={60}"), "input must set maxLength 60");
  assert.ok(src.includes("{titleDraft.length}/60"), "must show the X/60 counter");
});

// 5 + 6. Admin/instructor routing to the RC-A2 title writers.
test("routes the save to the admin/instructor title writers by actor", () => {
  const region = src.slice(src.indexOf("function saveComplexPlanTitle("), src.indexOf("function saveComplexPlanTitle(") + 400);
  assert.ok(region.includes('actor.type === "admin"'), "must branch on actor type");
  assert.ok(region.includes("saveRidingSlotComplexPlanTitleAsAdmin("), "admin branch must call the admin writer");
  assert.ok(region.includes("saveRidingSlotComplexPlanTitleAsInstructor("), "instructor branch must call the instructor writer");
});

// 7. Sends ridingSlotId + expectedVersion + title.
test("sends ridingSlotId, expectedVersion, and title", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("saveComplexPlanTitle(actor, {"), "must call the routed save with an actor");
  assert.ok(handler.includes("ridingSlotId,"), "must send ridingSlotId");
  assert.ok(handler.includes("expectedVersion,"), "must send expectedVersion");
  assert.ok(handler.includes("title: titleDraft"), "must send the raw draft as title (server normalizes)");
  assert.ok(handler.includes("const expectedVersion = plan.version"), "expectedVersion must be the live plan.version");
  // Never a client-supplied actor identity.
  assert.ok(!handler.includes("instructorId"), "handler must not pass a client instructorId");
});

// 8. Unchanged draft does not submit (handler guard + disabled control).
test("does not submit an unchanged draft", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("if (titleDraft === savedTitle) return"), "handler must no-op an unchanged draft");
  assert.ok(src.includes('disabled={isSavingTitle || titleDraft === (plan.title ?? "")}'), "save button must disable when unchanged or saving");
});

// 9. Pending state prevents duplicate save.
test("prevents duplicate submissions while saving", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("if (isSavingTitleRef.current) return"), "must guard against re-entry via the ref");
  assert.ok(handler.includes("isSavingTitleRef.current = true"), "must set the in-flight ref");
  assert.ok(handler.includes("startSaveTitleTransition("), "must run inside its own transition");
});

// 10. Server validation error is displayed.
test("displays the server validation message", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("setTitleError(result.error"), "must surface the server error message");
  assert.ok(src.includes("{titleError &&"), "must render the title error");
});

// 11. staleConflict uses the existing stale-plan reload path.
test("uses the existing stale-plan reload path on a lost update", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("if (result.staleConflict) reloadPlanAfterStaleConflict()"), "must reuse reloadPlanAfterStaleConflict");
});

// 12. Returned normalized title/version refresh local state.
test("refreshes local plan/version and the draft from the returned plan", () => {
  const handler = src.slice(src.indexOf("function handleSaveTitle()"), src.indexOf("function handleSaveTitle()") + 1200);
  assert.ok(handler.includes("refreshPlan(result.plan)"), "must refresh plan/version via the existing pattern");
  assert.ok(handler.includes('setTitleDraft(result.plan.title ?? "")'), "must reflect the server-normalized title");
});

// 13. Existing block/station/pair editor wiring remains.
test("preserves existing block/station/pair save wiring", () => {
  assert.ok(src.includes("saveComplexBlock("), "block save wiring must remain");
  assert.ok(src.includes("saveComplexStation("), "station save wiring must remain");
  assert.ok(src.includes("applyComplexMoveSwap("), "move/swap wiring must remain");
});

// Extra: the title field does not add publication logic or touch titleSnapshot.
test("adds no publication logic and never touches titleSnapshot", () => {
  assert.ok(!src.includes("titleSnapshot"), "the editor must never reference titleSnapshot");
});
