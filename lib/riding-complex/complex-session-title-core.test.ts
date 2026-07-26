// RC-A0 - focused unit tests for the pure complex-session title core
// (validateComplexSessionTitle / resolveComplexSessionTitle). DB-free, IO-free.
//
// Run: npx tsx --test lib/riding-complex/complex-session-title-core.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPLEX_SESSION_TITLE_MESSAGES,
  resolveComplexSessionTitle,
  validateComplexSessionTitle,
} from "./complex-session-title-core";

const FALLBACK = "תרגול הדרכה";

// --- validation -----------------------------------------------------------

// 1. null normalizes to null.
test("null normalizes to null", () => {
  assert.deepEqual(validateComplexSessionTitle(null), { ok: true, value: null });
});

// 2. undefined normalizes to null.
test("undefined normalizes to null", () => {
  assert.deepEqual(validateComplexSessionTitle(undefined), { ok: true, value: null });
});

// 3. empty string normalizes to null.
test("empty string normalizes to null", () => {
  assert.deepEqual(validateComplexSessionTitle(""), { ok: true, value: null });
});

// 4. whitespace-only string normalizes to null.
test("whitespace-only string normalizes to null", () => {
  assert.deepEqual(validateComplexSessionTitle("   \t  "), { ok: true, value: null });
});

// 5. leading/trailing whitespace is trimmed.
test("leading/trailing whitespace is trimmed", () => {
  assert.deepEqual(validateComplexSessionTitle("  מקצה בוקר  "), { ok: true, value: "מקצה בוקר" });
});

// 6. valid title is preserved after trim.
test("a valid title is preserved", () => {
  assert.deepEqual(validateComplexSessionTitle("רכיבת בוקר"), { ok: true, value: "רכיבת בוקר" });
});

// 7. exactly 60 characters is accepted.
test("exactly 60 characters is accepted", () => {
  const title = "א".repeat(60);
  const result = validateComplexSessionTitle(title);
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : null, title);
});

// 7b. exactly 60 characters after trimming is accepted.
test("60 characters after trimming is accepted", () => {
  const title = "א".repeat(60);
  const result = validateComplexSessionTitle(`  ${title}  `);
  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.value : null, title);
});

// 8. 61 characters returns TITLE_TOO_LONG.
test("61 characters returns TITLE_TOO_LONG", () => {
  const result = validateComplexSessionTitle("א".repeat(61));
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "TITLE_TOO_LONG");
  assert.equal(result.ok ? null : result.message, COMPLEX_SESSION_TITLE_MESSAGES.TITLE_TOO_LONG);
});

// 9. newline returns TITLE_MULTILINE.
test("an embedded newline returns TITLE_MULTILINE", () => {
  const result = validateComplexSessionTitle("שורה\nשנייה");
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.code, "TITLE_MULTILINE");
  assert.equal(result.ok ? null : result.message, COMPLEX_SESSION_TITLE_MESSAGES.TITLE_MULTILINE);
});

// 10. carriage return returns TITLE_MULTILINE.
test("an embedded carriage return returns TITLE_MULTILINE", () => {
  const result = validateComplexSessionTitle("שורה\rשנייה");
  assert.equal(result.ok ? null : result.code, "TITLE_MULTILINE");
});

// 11. CRLF returns TITLE_MULTILINE.
test("an embedded CRLF returns TITLE_MULTILINE", () => {
  const result = validateComplexSessionTitle("שורה\r\nשנייה");
  assert.equal(result.ok ? null : result.code, "TITLE_MULTILINE");
});

// 11b. multiline is reported as multiline even when also overlong.
test("a multiline AND overlong value reports TITLE_MULTILINE", () => {
  const result = validateComplexSessionTitle(`${"א".repeat(70)}\nמ`);
  assert.equal(result.ok ? null : result.code, "TITLE_MULTILINE");
});

// 12. duplicate values are allowed (no uniqueness concept in the core).
test("duplicate values are allowed", () => {
  const a = validateComplexSessionTitle("מקצה בוקר");
  const b = validateComplexSessionTitle("מקצה בוקר");
  assert.deepEqual(a, { ok: true, value: "מקצה בוקר" });
  assert.deepEqual(b, { ok: true, value: "מקצה בוקר" });
});

// --- resolution -----------------------------------------------------------

// 13. LIVE prefers a valid liveTitle over the fallback.
test("LIVE prefers a valid liveTitle over the fallback", () => {
  const title = resolveComplexSessionTitle({
    surface: "LIVE",
    liveTitle: "מקצה בוקר",
    publishedTitleSnapshot: "לא רלוונטי",
    generatedFallback: FALLBACK,
  });
  assert.equal(title, "מקצה בוקר");
});

// 14. LIVE ignores publishedTitleSnapshot entirely.
test("LIVE ignores publishedTitleSnapshot", () => {
  const title = resolveComplexSessionTitle({
    surface: "LIVE",
    liveTitle: null,
    publishedTitleSnapshot: "מ-snapshot",
    generatedFallback: FALLBACK,
  });
  assert.notEqual(title, "מ-snapshot");
  assert.equal(title, FALLBACK);
});

// 15. PUBLISHED prefers a valid publishedTitleSnapshot over the fallback.
test("PUBLISHED prefers a valid publishedTitleSnapshot over the fallback", () => {
  const title = resolveComplexSessionTitle({
    surface: "PUBLISHED",
    liveTitle: "חי",
    publishedTitleSnapshot: "מקצה שפורסם",
    generatedFallback: FALLBACK,
  });
  assert.equal(title, "מקצה שפורסם");
});

// 16. PUBLISHED does not fall back to liveTitle.
test("PUBLISHED never falls back to the live title", () => {
  const title = resolveComplexSessionTitle({
    surface: "PUBLISHED",
    liveTitle: "חי",
    publishedTitleSnapshot: null,
    generatedFallback: FALLBACK,
  });
  assert.notEqual(title, "חי");
  assert.equal(title, FALLBACK);
});

// 17. empty live title falls back to generatedFallback.
test("an empty live title falls back to the generated fallback", () => {
  const title = resolveComplexSessionTitle({
    surface: "LIVE",
    liveTitle: "   ",
    generatedFallback: FALLBACK,
  });
  assert.equal(title, FALLBACK);
});

// 18. empty snapshot falls back to generatedFallback.
test("an empty snapshot falls back to the generated fallback", () => {
  const title = resolveComplexSessionTitle({
    surface: "PUBLISHED",
    publishedTitleSnapshot: "",
    generatedFallback: FALLBACK,
  });
  assert.equal(title, FALLBACK);
});

// 19. malformed stored live title falls back safely (no throw, no leak).
test("a malformed stored live title falls back safely", () => {
  const overlong = resolveComplexSessionTitle({
    surface: "LIVE",
    liveTitle: "א".repeat(200),
    generatedFallback: FALLBACK,
  });
  assert.equal(overlong, FALLBACK);
  const multiline = resolveComplexSessionTitle({
    surface: "LIVE",
    liveTitle: "שורה\nשנייה",
    generatedFallback: FALLBACK,
  });
  assert.equal(multiline, FALLBACK);
});

// 20. malformed stored snapshot falls back safely.
test("a malformed stored snapshot falls back safely", () => {
  const crlf = resolveComplexSessionTitle({
    surface: "PUBLISHED",
    publishedTitleSnapshot: "שורה\r\nשנייה",
    generatedFallback: FALLBACK,
  });
  assert.equal(crlf, FALLBACK);
  const overlong = resolveComplexSessionTitle({
    surface: "PUBLISHED",
    publishedTitleSnapshot: "ב".repeat(120),
    generatedFallback: FALLBACK,
  });
  assert.equal(overlong, FALLBACK);
});

// --- purity ---------------------------------------------------------------

// 21. inputs are not mutated.
test("inputs are not mutated", () => {
  const params = Object.freeze({
    surface: "LIVE" as const,
    liveTitle: "  מקצה בוקר  ",
    publishedTitleSnapshot: "snap",
    generatedFallback: FALLBACK,
  });
  const snapshot = JSON.stringify(params);
  assert.doesNotThrow(() => resolveComplexSessionTitle(params));
  assert.equal(JSON.stringify(params), snapshot);
  // A validated string is never mutated (strings are immutable, verified by value).
  const raw = "  שם  ";
  validateComplexSessionTitle(raw);
  assert.equal(raw, "  שם  ");
});

// 22. result objects are frozen where applicable.
test("validation result objects are frozen", () => {
  assert.ok(Object.isFrozen(validateComplexSessionTitle(null)));
  assert.ok(Object.isFrozen(validateComplexSessionTitle("valid")));
  assert.ok(Object.isFrozen(validateComplexSessionTitle("א".repeat(61))));
  assert.ok(Object.isFrozen(validateComplexSessionTitle("a\nb")));
  assert.ok(Object.isFrozen(COMPLEX_SESSION_TITLE_MESSAGES));
});
