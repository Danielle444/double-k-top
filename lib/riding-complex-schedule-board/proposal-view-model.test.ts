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

test("move: safe Hebrew before/after copy from supplied labels", () => {
  const vm = buildProposalViewModel(MOVE, {
    candidateTraineeName: "דנה",
    sourceStationLabel: "עמדת רוני",
    destinationStationLabel: "עמדת יוסי",
  });
  assert.equal(vm.kind, "move");
  assert.equal(vm.title, "העברת חניכ/ה");
  assert.ok(vm.before.includes("דנה") && vm.before.includes("עמדת רוני"));
  assert.ok(vm.after.includes("דנה") && vm.after.includes("עמדת יוסי"));
  assert.equal(vm.confirmLabel, "אישור העברה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("swap: safe Hebrew before/after copy naming both trainees", () => {
  const vm = buildProposalViewModel(SWAP, {
    candidateTraineeName: "דנה",
    occupantTraineeName: "מיה",
    sourceStationLabel: "עמדת רוני",
    destinationStationLabel: "עמדת יוסי",
  });
  assert.equal(vm.kind, "swap");
  assert.equal(vm.title, "החלפת חניכים");
  assert.ok(vm.before.includes("דנה") && vm.before.includes("מיה"));
  assert.ok(vm.after.includes("דנה") && vm.after.includes("מיה"));
  // Before: דנה at source, מיה at destination. After: they exchange.
  assert.ok(vm.before.includes("עמדת רוני") && vm.before.includes("עמדת יוסי"));
  assert.ok(vm.after.includes("עמדת רוני") && vm.after.includes("עמדת יוסי"));
  assert.equal(vm.confirmLabel, "אישור החלפה");
  assert.equal(vm.cancelLabel, "ביטול");
});

test("generic safe fallback labels when a display name is absent", () => {
  const move = buildProposalViewModel(MOVE, {});
  assert.ok(move.before.includes("חניכ/ה"));
  assert.ok(move.before.includes("העמדה הנוכחית"));
  assert.ok(move.after.includes("העמדה הנבחרת"));

  const swap = buildProposalViewModel(SWAP, {
    candidateTraineeName: "   ", // whitespace-only -> fallback
    occupantTraineeName: null,
  });
  assert.ok(swap.before.includes("חניכ/ה"));
  assert.ok(swap.before.includes("חניכ/ה אחר/ת"));
});

test("no raw ids (pair ids / version) are reflected into any display string", () => {
  const displayStrings = (input: ProposalInput): string[] => {
    const vm = buildProposalViewModel(input, {
      candidateTraineeName: "דנה",
      occupantTraineeName: "מיה",
      sourceStationLabel: "עמדת רוני",
      destinationStationLabel: "עמדת יוסי",
    });
    return [vm.title, vm.before, vm.after, vm.confirmLabel, vm.cancelLabel];
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

test("view model is frozen (module convention)", () => {
  assert.equal(Object.isFrozen(buildProposalViewModel(MOVE, {})), true);
  assert.equal(Object.isFrozen(buildProposalViewModel(SWAP, {})), true);
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
