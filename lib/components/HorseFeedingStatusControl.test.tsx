/**
 * FEEDING-BOARD Stage 5A - tests for the per-horse feeding status control.
 *
 * These are REAL RENDER TESTS, not source scans. HorseFeedingStatusControl is a
 * leaf presentational component: its only import is an erased `import type` from
 * the pure Stage 2 core, so it pulls in no Prisma, no next/*, and no "use server"
 * module and can be rendered with react-dom/server inside a plain `tsx --test`
 * process. The markup asserted below is therefore the markup a browser receives.
 *
 * The two interaction rules (a read-only viewer cannot write; a second tap during
 * an in-flight write cannot queue a duplicate) are proven on BOTH levels:
 *  - behaviourally, against the exported pure guard `canSubmitFeedingStatusChange`,
 *    which is the single condition the click handler evaluates; and
 *  - structurally, by asserting the rendered buttons carry the `disabled`
 *    attribute, so the browser cannot dispatch the click in the first place.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/HorseFeedingStatusControl.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  HorseFeedingStatusControl,
  canSubmitFeedingStatusChange,
  resolveFeedingStatusControlOptions,
  shouldApplyFeedingMarkResult,
} from "./HorseFeedingStatusControl";
import type { FeedingProgressState } from "@/lib/feeding/feeding-board-core";

const HORSE = "רקיע";

function render(overrides: {
  statusControlMode: "hayAndConcentrate" | "completeOnly";
  displayProgressState: FeedingProgressState;
  disabled?: boolean;
  isSaving?: boolean;
}): string {
  return renderToStaticMarkup(
    <HorseFeedingStatusControl
      horseName={HORSE}
      statusControlMode={overrides.statusControlMode}
      displayProgressState={overrides.displayProgressState}
      disabled={overrides.disabled ?? false}
      isSaving={overrides.isSaving ?? false}
      onChange={() => {
        throw new Error("onChange must not fire during render");
      }}
    />
  );
}

/** The rendered option buttons, one markup chunk each. */
function optionButtons(html: string): string[] {
  return html
    .split("<button")
    .slice(1)
    .map((chunk) => `<button${chunk.slice(0, chunk.indexOf("</button>"))}`);
}

// ===========================================================================
// 1-3. OPTION SETS PER MODE
// ===========================================================================

test("1. hayAndConcentrate renders exactly three states", () => {
  const html = render({ statusControlMode: "hayAndConcentrate", displayProgressState: "PENDING" });
  const buttons = optionButtons(html);

  assert.equal(buttons.length, 3);
  assert.ok(html.includes("לא סומן"));
  assert.ok(html.includes("חציר הושלם"));
  assert.ok(html.includes("חציר + מזון מרוכז"));

  assert.deepEqual(
    resolveFeedingStatusControlOptions("hayAndConcentrate").map((o) => o.state),
    ["PENDING", "HAY_DONE", "COMPLETE"]
  );
});

test("2. completeOnly renders exactly two states", () => {
  const html = render({ statusControlMode: "completeOnly", displayProgressState: "PENDING" });
  const buttons = optionButtons(html);

  assert.equal(buttons.length, 2);
  assert.ok(html.includes("לא סומן"));
  assert.ok(html.includes("הושלם"));

  assert.deepEqual(
    resolveFeedingStatusControlOptions("completeOnly").map((o) => o.state),
    ["PENDING", "COMPLETE"]
  );
});

test("3. completeOnly never renders HAY_DONE, in markup or in the option set", () => {
  const html = render({ statusControlMode: "completeOnly", displayProgressState: "COMPLETE" });

  assert.ok(!html.includes("חציר הושלם"), "the half-step label must not appear");
  assert.ok(!html.includes("◐"), "the half-step glyph must not appear");
  assert.ok(
    !resolveFeedingStatusControlOptions("completeOnly").some((o) => o.state === "HAY_DONE"),
    "HAY_DONE is not a selectable state for a horse with no concentrate content"
  );
});

// ===========================================================================
// 4-5. SELECTION IS EXPOSED TO ASSISTIVE TECHNOLOGY
// ===========================================================================

test("4+5. exactly the displayed state is aria-checked=true; every other is false", () => {
  for (const [mode, state, expectedChecked] of [
    ["hayAndConcentrate", "PENDING", "לא סומן"],
    ["hayAndConcentrate", "HAY_DONE", "חציר הושלם"],
    ["hayAndConcentrate", "COMPLETE", "חציר + מזון מרוכז"],
    ["completeOnly", "COMPLETE", "הושלם"],
  ] as const) {
    const buttons = optionButtons(render({ statusControlMode: mode, displayProgressState: state }));

    const checked = buttons.filter((b) => b.includes('aria-checked="true"'));
    const unchecked = buttons.filter((b) => b.includes('aria-checked="false"'));

    assert.equal(checked.length, 1, `${mode}/${state}: exactly one option may be checked`);
    assert.equal(checked.length + unchecked.length, buttons.length, "every option declares aria-checked");
    assert.ok(checked[0].includes(expectedChecked), `${mode}/${state}: the wrong option is checked`);
  }
});

test("4b. the group is a radiogroup and every option is a radio", () => {
  const html = render({ statusControlMode: "hayAndConcentrate", displayProgressState: "HAY_DONE" });

  assert.ok(html.includes('role="radiogroup"'));
  assert.equal(optionButtons(html).filter((b) => b.includes('role="radio"')).length, 3);
});

// ===========================================================================
// 6-7. A READ-ONLY VIEWER AND AN IN-FLIGHT WRITE BOTH REFUSE THE TAP
// ===========================================================================

test("6. disabled prevents onChange, and the rendered buttons are not clickable", () => {
  assert.equal(
    canSubmitFeedingStatusChange({
      disabled: true,
      isSaving: false,
      currentState: "PENDING",
      nextState: "COMPLETE",
    }),
    false
  );

  const buttons = optionButtons(
    render({ statusControlMode: "hayAndConcentrate", displayProgressState: "PENDING", disabled: true })
  );
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.ok(button.includes("disabled"), "a read-only viewer's options must be disabled");
  }
});

test("7. isSaving prevents a duplicate onChange while a write is in flight", () => {
  assert.equal(
    canSubmitFeedingStatusChange({
      disabled: false,
      isSaving: true,
      currentState: "PENDING",
      nextState: "COMPLETE",
    }),
    false
  );

  const buttons = optionButtons(
    render({ statusControlMode: "hayAndConcentrate", displayProgressState: "PENDING", isSaving: true })
  );
  for (const button of buttons) {
    assert.ok(button.includes("disabled"), "every option is inert while this horse is saving");
  }
});

test("7b. re-selecting the state already shown is a no-op, so the audit is not re-stamped", () => {
  assert.equal(
    canSubmitFeedingStatusChange({
      disabled: false,
      isSaving: false,
      currentState: "COMPLETE",
      nextState: "COMPLETE",
    }),
    false
  );
});

test("7c. an enabled, idle control DOES allow a change to a different state", () => {
  assert.equal(
    canSubmitFeedingStatusChange({
      disabled: false,
      isSaving: false,
      currentState: "PENDING",
      nextState: "HAY_DONE",
    }),
    true
  );
});

// ===========================================================================
// 8-9. ACCESSIBLE NAMING AND NON-COLOUR STATUS
// ===========================================================================

test("8. the horse name is part of the group label and of every option label", () => {
  const html = render({ statusControlMode: "hayAndConcentrate", displayProgressState: "PENDING" });

  assert.ok(html.includes(`aria-label="סטטוס האכלה - ${HORSE}"`), "the radiogroup names the horse");
  for (const button of optionButtons(html)) {
    assert.match(
      button,
      new RegExp(`aria-label="[^"]*${HORSE}"`),
      "every option's accessible label must name the horse it belongs to"
    );
  }
});

test("9. status is carried by text and glyph, never by colour alone", () => {
  const html = render({ statusControlMode: "hayAndConcentrate", displayProgressState: "COMPLETE" });
  const buttons = optionButtons(html);

  // Each option renders a glyph AND a visible text label.
  for (const [glyph, label] of [
    ["○", "לא סומן"],
    ["◐", "חציר הושלם"],
    ["✓", "חציר + מזון מרוכז"],
  ] as const) {
    const button = buttons.find((b) => b.includes(label));
    assert.ok(button, `missing option ${label}`);
    assert.ok(button.includes(glyph), `${label} must carry its own glyph`);
  }

  // The glyph is decorative for a screen reader - the text label is the name.
  assert.ok(html.includes('aria-hidden="true"'), "the glyph must not be read out as content");

  // Selection survives grayscale: the selected option is ALSO bold, and it is
  // announced through aria-checked, neither of which depends on hue.
  const selected = buttons.find((b) => b.includes('aria-checked="true"'));
  assert.ok(selected);
  assert.ok(selected.includes("font-bold"), "the selected option must differ in weight, not only hue");
  const unselected = buttons.filter((b) => b.includes('aria-checked="false"'));
  for (const button of unselected) {
    assert.ok(button.includes("font-medium") && !button.includes("font-bold"));
  }
});

test("9b. no hard-coded colour value is used - repository tokens only", () => {
  for (const mode of ["hayAndConcentrate", "completeOnly"] as const) {
    for (const state of ["PENDING", "HAY_DONE", "COMPLETE"] as const) {
      const html = render({ statusControlMode: mode, displayProgressState: state });
      assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(html), "no hex colour may be emitted");
      assert.ok(!/rgba?\(/.test(html), "no literal rgb() colour may be emitted");
    }
  }
});

test("9c. tap targets are large enough for a tablet and the group wraps on narrow screens", () => {
  const html = render({ statusControlMode: "hayAndConcentrate", displayProgressState: "PENDING" });

  assert.ok(html.includes("flex-wrap"), "the option row must wrap rather than overflow");
  for (const button of optionButtons(html)) {
    assert.ok(button.includes("min-h-11"), "each option needs a finger-sized target");
  }
});

// ===========================================================================
// 41-44. A MARK THAT OUTLIVED A CLEAR-ALL IS DISCARDED
//
// The board bumps a generation counter on every successful reset. These four
// cases are the whole rule the async mark handler evaluates before it is allowed
// to touch a row, so the "a horse must never be displayed as fed after the board
// was cleared" guarantee is proven here behaviourally, not by reading source.
// ===========================================================================

test("41. a result from the current generation is applied", () => {
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 0, currentGeneration: 0 }),
    true
  );
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 7, currentGeneration: 7 }),
    true
  );
});

test("42. a result whose generation was overtaken by a clear is discarded", () => {
  // One clear happened while the mark was in flight...
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 0, currentGeneration: 1 }),
    false
  );
  // ...and several clears are no different.
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 2, currentGeneration: 9 }),
    false
  );
  // A mark that started AFTER the clear must not be discarded by an older
  // counter value either - the rule is equality, not "greater than".
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 5, currentGeneration: 4 }),
    false
  );
});

test("43. unusual numeric values still follow exact equality, and NaN fails safe", () => {
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: -3, currentGeneration: -3 }),
    true
  );
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: -3, currentGeneration: -2 }),
    false
  );
  assert.equal(
    shouldApplyFeedingMarkResult({
      startedGeneration: Number.MAX_SAFE_INTEGER,
      currentGeneration: Number.MAX_SAFE_INTEGER,
    }),
    true
  );
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: 0, currentGeneration: -0 }),
    true,
    "0 and -0 are the same generation"
  );
  // NaN is never equal to itself, so an unusable counter DISCARDS the result -
  // the safe direction: the board keeps the state it already shows.
  assert.equal(
    shouldApplyFeedingMarkResult({ startedGeneration: Number.NaN, currentGeneration: Number.NaN }),
    false
  );
});

test("44. the helper is pure - no mutation, no side effect, stable across calls", () => {
  const input = Object.freeze({ startedGeneration: 4, currentGeneration: 5 });

  // A frozen input would throw on any attempted write.
  assert.equal(shouldApplyFeedingMarkResult(input), false);
  assert.equal(shouldApplyFeedingMarkResult(input), false);
  assert.deepEqual(input, { startedGeneration: 4, currentGeneration: 5 });

  // Repeated calls with different arguments never influence one another.
  assert.equal(shouldApplyFeedingMarkResult({ startedGeneration: 1, currentGeneration: 1 }), true);
  assert.equal(shouldApplyFeedingMarkResult(input), false);
});
