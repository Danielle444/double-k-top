// Pure unit tests for the proposal view model + action-result mapper (Stage
// 3C.1). Run:
//   npx tsx --test lib/riding-complex-schedule-board/proposal-view-model.test.ts
//
// Pure and DB-free: no Prisma, server actions, React, network, clock, or random.

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProposalViewModel,
  decideProposalActionResult,
  type ProposalActionResultInput,
  type ProposalInput,
} from "./proposal-view-model";

// Distinctive internal ids so a leak into display copy is unmistakable.
const MOVE: ProposalInput = {
  kind: "move",
  command: {
    op: "MOVE_TRAINEE",
    expectedVersion: 4242,
    source: { pairId: "PAIR_SRC_ZZZ", slot: "trainee1" },
    destination: { pairId: "PAIR_DST_QQQ", slot: "trainee1" },
  },
};

const SWAP: ProposalInput = {
  kind: "swap",
  command: {
    op: "SWAP_TRAINEES",
    expectedVersion: 9191,
    a: { pairId: "PAIR_A_XXX", slot: "trainee1" },
    b: { pairId: "PAIR_B_YYY", slot: "trainee2" },
  },
};

const STABLE_NOTE = "הסוסים וההערות נשארים עם הזוגים ואינם עוברים עם החניכים.";

test("move: structured before/after with position labels; pipe-free; stable note", () => {
  const vm = buildProposalViewModel(MOVE, {
    candidateTraineeName: "דנה",
    sourcePositionLabel: "זוג עם רון",
    destinationPositionLabel: "זוג עם יוסי",
  });
  assert.equal(vm.kind, "move");
  assert.equal(vm.title, "העברת חניך/ה");
  assert.equal(vm.sections.beforeHeading, "לפני ההעברה");
  assert.equal(vm.sections.afterHeading, "אחרי ההעברה");
  // Before: the trainee at their CURRENT position (heading = name, detail = pos).
  assert.deepEqual(vm.sections.beforeRows, [{ heading: "דנה", detail: "זוג עם רון" }]);
  // After: "השיבוץ של {name}" -> destination position.
  assert.deepEqual(vm.sections.afterRows, [{ heading: "השיבוץ של דנה", detail: "זוג עם יוסי" }]);
  assert.equal(vm.sections.stableNote, STABLE_NOTE);
  assert.equal(vm.confirmLabel, "אישור העברה");
  assert.equal(vm.cancelLabel, "ביטול");
  // No dense pipe copy anywhere.
  assert.ok(!vm.before.includes("|") && !vm.after.includes("|"));
});

test("swap: two DISTINCT before placements and REVERSED after placements; pipe-free", () => {
  const vm = buildProposalViewModel(SWAP, {
    candidateTraineeName: "דנה",
    occupantTraineeName: "מיה",
    sourcePositionLabel: "זוג עם רון",
    destinationPositionLabel: "זוג עם יוסי",
  });
  assert.equal(vm.kind, "swap");
  assert.equal(vm.title, "החלפת חניכים");
  // Before: דנה at source, מיה at destination - two distinct placements.
  assert.deepEqual(vm.sections.beforeRows, [
    { heading: "דנה", detail: "זוג עם רון" },
    { heading: "מיה", detail: "זוג עם יוסי" },
  ]);
  // After: they exchange - דנה takes destination, מיה takes source.
  assert.deepEqual(vm.sections.afterRows, [
    { heading: "השיבוץ של דנה", detail: "זוג עם יוסי" },
    { heading: "השיבוץ של מיה", detail: "זוג עם רון" },
  ]);
  assert.equal(vm.sections.stableNote, STABLE_NOTE);
  assert.equal(vm.confirmLabel, "אישור החלפה");
  assert.equal(vm.cancelLabel, "ביטול");
  // The name is the heading; the position is the detail - never confused.
  assert.notEqual(vm.sections.beforeRows[0].heading, vm.sections.beforeRows[0].detail);
  // No pipe-delimited dense copy.
  for (const s of [vm.before, vm.after]) assert.ok(!s.includes("|"), s);
});

test("generic safe fallback labels when a display name/position is absent", () => {
  const move = buildProposalViewModel(MOVE, {});
  assert.equal(move.sections.beforeRows[0].heading, "חניכ/ה");
  assert.equal(move.sections.beforeRows[0].detail, "הזוג הנוכחי");
  assert.equal(move.sections.afterRows[0].detail, "הזוג הנבחר");

  const swap = buildProposalViewModel(SWAP, {
    candidateTraineeName: "   ", // whitespace-only -> fallback
    occupantTraineeName: null,
  });
  assert.equal(swap.sections.beforeRows[0].heading, "חניכ/ה");
  assert.equal(swap.sections.beforeRows[1].heading, "חניכ/ה אחר/ת");
});

test("no raw ids/version/op/slot are reflected into any display string", () => {
  const displayStrings = (input: ProposalInput): string[] => {
    const vm = buildProposalViewModel(input, {
      candidateTraineeName: "דנה",
      occupantTraineeName: "מיה",
      sourcePositionLabel: "זוג עם רון",
      destinationPositionLabel: "זוג עם יוסי",
    });
    return [
      vm.title,
      vm.before,
      vm.after,
      vm.confirmLabel,
      vm.cancelLabel,
      vm.sections.beforeHeading,
      vm.sections.afterHeading,
      vm.sections.stableNote,
      ...vm.sections.beforeRows.flatMap((r) => [r.heading, r.detail]),
      ...vm.sections.afterRows.flatMap((r) => [r.heading, r.detail]),
    ];
  };
  const forbidden = [
    "PAIR_SRC_ZZZ",
    "PAIR_DST_QQQ",
    "PAIR_A_XXX",
    "PAIR_B_YYY",
    "4242",
    "9191",
    "trainee1",
    "trainee2",
    "MOVE_TRAINEE",
    "SWAP_TRAINEES",
  ];
  for (const input of [MOVE, SWAP]) {
    for (const s of displayStrings(input)) {
      for (const token of forbidden) {
        assert.ok(!s.includes(token), `display string leaked "${token}": ${s}`);
      }
    }
  }
});

test("the command is retained verbatim in the non-display field for execution", () => {
  const vm = buildProposalViewModel(MOVE, { candidateTraineeName: "דנה" });
  assert.deepEqual(vm.command, MOVE.command);
});

test("view model (and its sections/rows) is frozen (module convention)", () => {
  assert.equal(Object.isFrozen(buildProposalViewModel(MOVE, {})), true);
  const swap = buildProposalViewModel(SWAP, {});
  assert.equal(Object.isFrozen(swap), true);
  assert.equal(Object.isFrozen(swap.sections), true);
  assert.equal(Object.isFrozen(swap.sections.beforeRows), true);
  assert.equal(Object.isFrozen(swap.sections.beforeRows[0]), true);
});

test("success -> APPLIED: reload plan, close dialog, return to board, no retry", () => {
  const directive = decideProposalActionResult({ success: true });
  assert.deepEqual(directive, {
    outcome: "APPLIED",
    reloadPlan: true,
    closeDialog: true,
    returnToBoard: true,
    keepProposalOpen: false,
    retry: false,
  });
});

test("stale result reloads authoritative plan but never retries", () => {
  for (const reason of ["STALE_PLAN", "STALE_REFERENCE", "PLAN_NOT_FOUND"]) {
    const directive = decideProposalActionResult({ success: false, reason });
    assert.equal(directive.outcome, "STALE_RELOAD");
    assert.equal(directive.reloadPlan, true);
    assert.equal(directive.retry, false);
    assert.equal(directive.keepProposalOpen, false);
  }
});

test("permission/internal/other failure keeps proposal open and never retries", () => {
  for (const reason of ["NOT_AUTHORIZED", "INTERNAL", "LOCK_TIMEOUT", "DESTINATION_OCCUPIED", "INVALID_INPUT"]) {
    const directive = decideProposalActionResult({ success: false, reason });
    assert.deepEqual(directive, {
      outcome: "FAILED",
      reloadPlan: false,
      closeDialog: false,
      returnToBoard: false,
      keepProposalOpen: true,
      retry: false,
    });
  }
});

test("a failure with no reason still fails closed to FAILED (no retry)", () => {
  const directive = decideProposalActionResult({ success: false });
  assert.equal(directive.outcome, "FAILED");
  assert.equal(directive.retry, false);
});

test("a malformed action result fails closed to FAILED without throwing", () => {
  const bad = [null, undefined, {}, { success: "yes" }, 42, "ok"];
  for (const input of bad) {
    assert.doesNotThrow(() => {
      const directive = decideProposalActionResult(input as unknown as ProposalActionResultInput);
      assert.equal(directive.outcome, "FAILED");
      assert.equal(directive.retry, false);
    });
  }
});

test("action-result directive is frozen and never carries retry=true", () => {
  const results: ProposalActionResultInput[] = [
    { success: true },
    { success: false, reason: "STALE_PLAN" },
    { success: false, reason: "NOT_AUTHORIZED" },
  ];
  for (const r of results) {
    const directive = decideProposalActionResult(r);
    assert.equal(Object.isFrozen(directive), true);
    assert.equal(directive.retry, false);
  }
});
