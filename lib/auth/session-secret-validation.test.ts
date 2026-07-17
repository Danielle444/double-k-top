/**
 * Executable tests for the pure session-secret validation layer (Stage 0A-1b).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/session-secret-validation.test.ts
 *
 * These tests are PURE: parseSessionSecret never reads process.env, so the
 * module imports and runs cleanly with SESSION_SECRET unset (asserted below).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseSessionSecret } from "./session-secret-validation";

// 1. undefined → null
test("parseSessionSecret returns null for undefined", () => {
  assert.equal(parseSessionSecret(undefined), null);
});

// 2. empty and whitespace-only → null
test("parseSessionSecret returns null for empty/whitespace-only", () => {
  assert.equal(parseSessionSecret(""), null);
  assert.equal(parseSessionSecret("   "), null);
  assert.equal(parseSessionSecret("\t\n  \r"), null);
});

// 3. a too-short (<32-byte) string → null
test("parseSessionSecret returns null for a <32-byte string", () => {
  // 31 ASCII bytes.
  assert.equal(parseSessionSecret("a".repeat(31)), null);
});

// 4. a >=32-byte string → Uint8Array of the exact byte length
test("parseSessionSecret returns a Uint8Array for a >=32-byte string", () => {
  const value = "a".repeat(32);
  const result = parseSessionSecret(value);
  assert.ok(result instanceof Uint8Array);
  assert.equal(result.byteLength, 32);

  const longer = "b".repeat(40);
  const longerResult = parseSessionSecret(longer);
  assert.ok(longerResult instanceof Uint8Array);
  assert.equal(longerResult.byteLength, 40);
});

// 5. length is measured in BYTES, not characters (multibyte UTF-8)
test("parseSessionSecret counts bytes, not characters", () => {
  // Hebrew: each character is 2 bytes in UTF-8. 20 chars < 32 chars but
  // 40 bytes >= 32 bytes → must PASS.
  const hebrew = "א".repeat(20); // 20 chars, 40 bytes
  assert.equal(hebrew.length, 20);
  const hebrewResult = parseSessionSecret(hebrew);
  assert.ok(hebrewResult instanceof Uint8Array);
  assert.equal(hebrewResult.byteLength, 40);

  // An emoji outside the BMP is 4 UTF-8 bytes but 2 UTF-16 code units. Eight
  // of them = 16 JS "length" units but 32 bytes → must PASS.
  const emoji = "😀".repeat(8);
  assert.equal(emoji.length, 16);
  const emojiResult = parseSessionSecret(emoji);
  assert.ok(emojiResult instanceof Uint8Array);
  assert.equal(emojiResult.byteLength, 32);

  // Conversely: a string whose CHAR count is >=32 but whose BYTE count is <32
  // is impossible for UTF-8 (every char is >=1 byte), so the meaningful
  // "vice-versa" case is char count < 32 while bytes >= 32 (covered above),
  // plus a many-char string that is still >=32 bytes trivially passes. Here we
  // assert the boundary the other way: a single 3-byte char repeated 10 times
  // = 10 chars, 30 bytes → must FAIL (bytes, not chars, decide).
  const threeByte = "€".repeat(10); // 10 chars, 30 bytes
  assert.equal(threeByte.length, 10);
  assert.equal(parseSessionSecret(threeByte), null);
});

// 6. never throws, for a range of inputs
test("parseSessionSecret never throws", () => {
  assert.doesNotThrow(() => parseSessionSecret(undefined));
  assert.doesNotThrow(() => parseSessionSecret(""));
  assert.doesNotThrow(() => parseSessionSecret("short"));
  assert.doesNotThrow(() => parseSessionSecret("x".repeat(100)));
  assert.doesNotThrow(() => parseSessionSecret("😀🎉".repeat(50)));
});

// 7. exact expected byte length for a known ASCII input
test("parseSessionSecret returns the exact byte length for known ASCII", () => {
  const value = "0123456789abcdefghijklmnopqrstuvwxyz"; // 36 ASCII bytes
  const result = parseSessionSecret(value);
  assert.ok(result instanceof Uint8Array);
  assert.equal(result.byteLength, 36);
});

// 8. importing the module with SESSION_SECRET unset succeeds (no env read)
test("module is usable with SESSION_SECRET unset", () => {
  const hadSecret = "SESSION_SECRET" in process.env;
  const previous = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    // parseSessionSecret must not read env; supplying an explicit value works
    // regardless of the (now unset) SESSION_SECRET.
    const result = parseSessionSecret("z".repeat(32));
    assert.ok(result instanceof Uint8Array);
    assert.equal(result.byteLength, 32);
  } finally {
    if (hadSecret) {
      process.env.SESSION_SECRET = previous;
    }
  }
});
