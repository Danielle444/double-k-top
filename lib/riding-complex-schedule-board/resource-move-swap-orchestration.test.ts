// Pure unit tests for the resource Move/Swap UI orchestration (Stage 3C.3c). Run:
//   npx tsx --test lib/riding-complex-schedule-board/resource-move-swap-orchestration.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.
// Proves the dirty-draft guards protect exactly the unrelated fields (and never
// the intended resource), and that the explicit horse-commit gate treats typing
// vs commit vs exact-occupied blur per the interaction contract.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  blankToNull,
  isTraineeProposalDirty,
  isHorseProposalDirty,
  isInstructorProposalDirty,
  shouldProcessHorseCommit,
  type DirtyPairDraft,
  type DirtyPairLoaded,
} from "./resource-move-swap-orchestration";

// A clean loaded pair and the matching clean draft (draft == loaded).
function loadedPair(): DirtyPairLoaded {
  return { trainee1Id: "t1", trainee2Id: "t2", horseName: "Star", note: "hi" };
}
function cleanDraft(): DirtyPairDraft {
  return { trainee1Id: "t1", trainee2Id: "t2", horseName: "Star", note: "hi" };
}

// ---------------------------------------------------------------------------
// blankToNull (SAVE normalization).
// ---------------------------------------------------------------------------

test("blankToNull: '' -> null; non-empty verbatim (no trim); null/undefined -> null", () => {
  assert.equal(blankToNull(""), null);
  assert.equal(blankToNull(null), null);
  assert.equal(blankToNull(undefined), null);
  assert.equal(blankToNull("x"), "x");
  // Deliberately NOT trimmed - matches the payload builders' `field || null`.
  assert.equal(blankToNull("  "), "  ");
});

// ---------------------------------------------------------------------------
// Trainee dirty guard.
// ---------------------------------------------------------------------------

test("trainee dirty: TARGET seat difference is allowed (not dirty)", () => {
  // Target seat 1 differs (would be replaced by the moved trainee); every other
  // field matches -> not dirty.
  const draft = { ...cleanDraft(), trainee1Id: "someoneElse" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), false);
});

test("trainee dirty: OTHER seat difference blocks", () => {
  const draft = { ...cleanDraft(), trainee2Id: "changed" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), true);
  // And symmetrically when the target is seat 2, seat 1 is the "other".
  const draft2 = { ...cleanDraft(), trainee1Id: "changed" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft2, "trainee2"), true);
});

test("trainee dirty: horse difference blocks", () => {
  const draft = { ...cleanDraft(), horseName: "Comet" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), true);
});

test("trainee dirty: note difference blocks", () => {
  const draft = { ...cleanDraft(), note: "changed" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), true);
});

test("trainee dirty: normalized-equivalent horse does NOT falsely block", () => {
  // Whitespace-only variant of the same horse (same case) - horseStore trims both
  // to the identical stored value, so it is not a dirty edit. (A case change,
  // by contrast, IS a real stored-value difference and DOES block - horseStore
  // preserves case - see the next test.)
  const draft = { ...cleanDraft(), horseName: "  Star  " };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), false);
});

test("trainee dirty: a case-only horse change blocks (stored value differs)", () => {
  const draft = { ...cleanDraft(), horseName: "star" };
  assert.equal(isTraineeProposalDirty(loadedPair(), draft, "trainee1"), true);
});

test("trainee dirty: empty other seat matching null loaded does NOT block", () => {
  const loaded = { trainee1Id: "t1", trainee2Id: null, horseName: null, note: null };
  const draft = { trainee1Id: "t1", trainee2Id: "", horseName: "", note: "" };
  assert.equal(isTraineeProposalDirty(loaded, draft, "trainee1"), false);
});

// ---------------------------------------------------------------------------
// Horse dirty guard.
// ---------------------------------------------------------------------------

test("horse dirty: horse (the intended resource) difference is allowed", () => {
  const draft = { ...cleanDraft(), horseName: "Comet" };
  assert.equal(isHorseProposalDirty(loadedPair(), draft), false);
});

test("horse dirty: trainee difference blocks", () => {
  assert.equal(isHorseProposalDirty(loadedPair(), { ...cleanDraft(), trainee1Id: "x" }), true);
  assert.equal(isHorseProposalDirty(loadedPair(), { ...cleanDraft(), trainee2Id: "x" }), true);
});

test("horse dirty: note difference blocks", () => {
  assert.equal(isHorseProposalDirty(loadedPair(), { ...cleanDraft(), note: "x" }), true);
});

test("horse dirty: clean draft (only horse typed) is not dirty", () => {
  const loaded = { trainee1Id: "t1", trainee2Id: null, horseName: null, note: null };
  const draft = { trainee1Id: "t1", trainee2Id: "", horseName: "Comet", note: "" };
  assert.equal(isHorseProposalDirty(loaded, draft), false);
});

// ---------------------------------------------------------------------------
// Instructor dirty guard.
// ---------------------------------------------------------------------------

test("instructor dirty: instructor (the intended resource) has no bearing; arena clean -> not dirty", () => {
  assert.equal(isInstructorProposalDirty("Arena 1", "Arena 1"), false);
  assert.equal(isInstructorProposalDirty(null, ""), false);
});

test("instructor dirty: arena difference blocks", () => {
  assert.equal(isInstructorProposalDirty("Arena 1", "Arena 2"), true);
  assert.equal(isInstructorProposalDirty(null, "Arena 2"), true);
  assert.equal(isInstructorProposalDirty("Arena 1", ""), true);
});

// ---------------------------------------------------------------------------
// Determinism / non-mutation.
// ---------------------------------------------------------------------------

test("dirty guards are non-mutating and deterministic", () => {
  const loaded = Object.freeze(loadedPair());
  const draft = Object.freeze({ ...cleanDraft(), horseName: "Comet" });
  const a = isTraineeProposalDirty(loaded, draft, "trainee1");
  const b = isTraineeProposalDirty(loaded, draft, "trainee1");
  assert.equal(a, b);
  // Frozen inputs never throw (no mutation attempted).
  assert.equal(isHorseProposalDirty(loaded, draft), false);
});

// ---------------------------------------------------------------------------
// Explicit horse-commit gate.
// ---------------------------------------------------------------------------

const OCCUPIED = new Set<string>(["star", "comet"]);

test("horse commit: quick / suggestion / enter are always explicit commits", () => {
  for (const source of ["quick", "suggestion", "enter"] as const) {
    // Even a free/arbitrary value is processed for these gestures.
    assert.equal(shouldProcessHorseCommit({ source, value: "Nimbus", occupiedHorseKeys: OCCUPIED }), true);
    assert.equal(shouldProcessHorseCommit({ source, value: "", occupiedHorseKeys: OCCUPIED }), true);
  }
});

test("horse commit: blur processes ONLY an exact occupied match", () => {
  // Exact occupied horse (case/whitespace-insensitive) -> commit.
  assert.equal(shouldProcessHorseCommit({ source: "blur", value: "  STAR ", occupiedHorseKeys: OCCUPIED }), true);
  // Free / not-occupied value -> no commit (stays local).
  assert.equal(shouldProcessHorseCommit({ source: "blur", value: "Nimbus", occupiedHorseKeys: OCCUPIED }), false);
  // Blank -> no commit.
  assert.equal(shouldProcessHorseCommit({ source: "blur", value: "   ", occupiedHorseKeys: OCCUPIED }), false);
  // Partial match is not exact -> no commit.
  assert.equal(shouldProcessHorseCommit({ source: "blur", value: "sta", occupiedHorseKeys: OCCUPIED }), false);
});

test("horse commit: empty occupied set means blur never commits", () => {
  assert.equal(
    shouldProcessHorseCommit({ source: "blur", value: "Star", occupiedHorseKeys: new Set() }),
    false
  );
});

// ---------------------------------------------------------------------------
// DB-free STATIC source-contract assertions for the two pre-commit corrections.
// These read the component/input source as TEXT (no React runtime, no framework)
// and assert structural invariants that the pure gesture classifier alone cannot
// prove - namely component EVENT-ORDERING and consumer preservation. They avoid
// line numbers, matching on stable code substrings instead.
// ---------------------------------------------------------------------------

const SUGGEST_INPUT_SRC = readFileSync(new URL("../components/SuggestInput.tsx", import.meta.url), "utf8");
const EDITOR_SRC = readFileSync(new URL("../components/RidingComplexPlanEditor.tsx", import.meta.url), "utf8");

test("Correction 1: SuggestInput Enter preventDefault is GATED by onCommit", () => {
  // The Enter handler must test onCommit before doing anything special.
  assert.match(SUGGEST_INPUT_SRC, /e\.key === "Enter" && onCommit/);
  // And must NOT contain an UNGATED Enter branch (which would preventDefault for
  // every consumer, breaking implicit form submit-on-Enter).
  assert.doesNotMatch(SUGGEST_INPUT_SRC, /if\s*\(\s*e\.key === "Enter"\s*\)/);
  // Blur stays an optional no-op for consumers without onCommit.
  assert.match(SUGGEST_INPUT_SRC, /onBlur=\{\(\) => onCommit\?\.\(value, "blur"\)\}/);
});

test("Correction 2: every proposal-open assigns the ref TRUE before setState", () => {
  const OPEN = "setMoveSwapProposal(vm)";
  const CLAIM = "moveSwapProposalOpenRef.current = true";
  // There are three open sites (trainee / horse / instructor).
  const openCount = EDITOR_SRC.split(OPEN).length - 1;
  assert.equal(openCount, 3);
  assert.equal(EDITOR_SRC.split(CLAIM).length - 1, 3);
  // Each setMoveSwapProposal(vm) is immediately preceded (within a short window)
  // by the synchronous ref claim - the static ordering proof the review requires.
  let from = 0;
  for (let i = 0; i < openCount; i += 1) {
    const idx = EDITOR_SRC.indexOf(OPEN, from);
    assert.ok(idx > 0, "open site present");
    const before = EDITOR_SRC.slice(Math.max(0, idx - 200), idx);
    assert.ok(before.includes(CLAIM), "ref claimed before setMoveSwapProposal(vm)");
    from = idx + OPEN.length;
  }
});

test("Correction 2: clearing centralizes ref=false + state=null; no stray null-clear", () => {
  // The single clear helper releases the ref BEFORE nulling the state.
  const body = EDITOR_SRC.slice(EDITOR_SRC.indexOf("function clearMoveSwapProposal()"));
  const clearBody = body.slice(0, body.indexOf("}") + 1);
  assert.match(clearBody, /moveSwapProposalOpenRef\.current = false/);
  assert.match(clearBody, /setMoveSwapProposal\(null\)/);
  // The ONLY setMoveSwapProposal(null) in the whole component lives in that helper
  // - so no deliberate clear path can leave the ref claimed.
  assert.equal(EDITOR_SRC.split("setMoveSwapProposal(null)").length - 1, 1);
});
