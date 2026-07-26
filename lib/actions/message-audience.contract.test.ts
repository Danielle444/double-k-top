/**
 * MSG1A - STRUCTURAL contract test. Proves the slice is additive and read-only:
 * the legacy send path and composers are byte-identical, and the new audience
 * actions perform no writes / no push / no MessageTaskAudience|Recipient access.
 *
 * Run with:
 *   npx tsx --test lib/actions/message-audience.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../");

function git(args: string[]): { code: number; stdout: string } {
  const res = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: res.status ?? 1, stdout: res.stdout ?? "" };
}

function readRepoFile(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), "utf8");
}

// Strip block comments and full-line // comments so assertions look at CODE only
// (the source files legitimately NAME push / notifications / MessageTaskAudience
// in their header prose to document that they deliberately do NOT use them).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LEGACY_UNTOUCHED_FILES = [
  "lib/actions/messages.ts",
  "app/admin/messages/MessagesClient.tsx",
  "app/instructor/InstructorMessagesSection.tsx",
  "app/admin/messages/page.tsx",
];

const NEW_PRODUCTION_FILES = [
  "lib/course/message-audience-input-core.ts",
  "lib/course/offering-audience-facts.ts",
  "lib/actions/message-audience.ts",
];

// ---------------------------------------------------------------------------
// Additive: this slice adds only NEW files. The ONLY permitted tracked edit is a
// test-hygiene change to the MSG0 contract test (its write-unwired scan was
// narrowed to actual table access so MSG1A's read-only NAMING of the model does
// not false-positive). No production / send-path / composer / page / UI file may
// change - proven both here (allow-list) and by the byte-identical checks below.
// ---------------------------------------------------------------------------

const ALLOWED_TRACKED_EDITS = new Set(["prisma/msg0-message-task-audience.contract.test.ts"]);

test("MSG1A modifies no production/legacy file (only the MSG0 contract test may change)", () => {
  const changed = git(["diff", "--name-only", "HEAD"]).stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const unexpected = changed.filter((f) => !ALLOWED_TRACKED_EDITS.has(f));
  assert.deepEqual(unexpected, [], `unexpected tracked modifications: ${unexpected.join(", ")}`);
});

test("each legacy send/composer file is byte-identical to HEAD", () => {
  for (const file of LEGACY_UNTOUCHED_FILES) {
    const { code } = git(["diff", "--quiet", "HEAD", "--", file]);
    assert.equal(code, 0, `${file} must be byte-identical to HEAD`);
  }
});

test("no .tsx (UI) file is modified by this slice", () => {
  const changed = git(["diff", "--name-only", "HEAD"]).stdout.split("\n").filter(Boolean);
  const tsx = changed.filter((f) => f.endsWith(".tsx"));
  assert.deepEqual(tsx, []);
});

// ---------------------------------------------------------------------------
// Legacy send-action signatures unchanged.
// ---------------------------------------------------------------------------

test("createMessageTask / createMessageTaskAsInstructor signatures are unchanged", () => {
  const source = readRepoFile("lib/actions/messages.ts");
  assert.match(
    source,
    /export async function createMessageTask\(input: CreateMessageTaskInput\): Promise<ActionResult>/,
  );
  assert.match(
    source,
    /export async function createMessageTaskAsInstructor\(\s*instructorId: string,\s*input: CreateMessageTaskInput,?\s*\): Promise<ActionResult>/,
  );
});

// ---------------------------------------------------------------------------
// New audience actions are READ-ONLY: no writes, no push, no audience/recipient
// model access at all.
// ---------------------------------------------------------------------------

test("the audience actions perform no create/update/delete/upsert", () => {
  const source = readRepoFile("lib/actions/message-audience.ts");
  assert.equal(
    /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(source),
    false,
    "message-audience.ts must contain no Prisma write call",
  );
});

test("the audience actions import no push or notification module and send nothing", () => {
  const source = stripComments(readRepoFile("lib/actions/message-audience.ts"));
  // Precise module/function checks only. A bare /push/ would wrongly match the
  // Array.prototype.push calls that build the option lists.
  for (const forbidden of [
    /@\/lib\/actions\/push/,
    /@\/lib\/actions\/notifications/,
    /sendNewMessagePush/,
    /sendNewMessagePushToStudents/,
    /createMaterialAddedNotifications/,
    /createMessageAddedNotifications/,
  ]) {
    assert.equal(forbidden.test(source), false, `message-audience.ts code must not reference ${forbidden}`);
  }
});

test("no new production file reads or writes MessageTaskAudience or MessageTaskRecipient", () => {
  for (const file of NEW_PRODUCTION_FILES) {
    const source = stripComments(readRepoFile(file)).toLowerCase();
    assert.equal(
      source.includes("messagetaskaudience"),
      false,
      `${file} code must not reference MessageTaskAudience in MSG1A`,
    );
    assert.equal(
      source.includes("messagetaskrecipient"),
      false,
      `${file} code must not reference MessageTaskRecipient in MSG1A`,
    );
  }
});

test("no new production file performs a Prisma write", () => {
  for (const file of NEW_PRODUCTION_FILES) {
    const source = readRepoFile(file);
    assert.equal(
      /\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/.test(source),
      false,
      `${file} must contain no Prisma write call`,
    );
  }
});

// ---------------------------------------------------------------------------
// Offering eligibility is capability-driven, never hardcoded by level/id.
// ---------------------------------------------------------------------------

test("offering eligibility is gated on ACTIVE + MESSAGES capability ENABLED, not hardcoded", () => {
  const source = readRepoFile("lib/actions/message-audience.ts");
  assert.match(source, /"MESSAGES"/);
  assert.match(source, /"ENABLED"/);
  assert.match(source, /status !== "ACTIVE"/);
  // No hardcoded level gate and no hardcoded known offering cuid.
  assert.equal(/level\s*===?\s*[12]\b/.test(source), false, "must not hardcode a level gate");
  assert.equal(/cmr[a-z0-9]{10,}/.test(source), false, "must not hardcode an offering id");
});

// ---------------------------------------------------------------------------
// The audience action is server-side, not a UI component.
// ---------------------------------------------------------------------------

test("message-audience.ts is a server action module, not a client component", () => {
  const source = readRepoFile("lib/actions/message-audience.ts");
  assert.match(source, /^"use server";/);
  assert.equal(/"use client"/.test(source), false);
});
