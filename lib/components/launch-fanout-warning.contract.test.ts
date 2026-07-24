/**
 * LAUNCH-WARNING - focused contract tests for the temporary Level 2 launch
 * warning (accidental-send warning only, NOT course-scoped containment).
 *
 * Two halves, both DB-free, storage-free and DOM-free (no React renderer is
 * introduced - per AGENTS.md this slice adds no test framework):
 *
 *  1. BEHAVIOURAL - the shared text module is imported directly and its strings
 *     and labels are asserted character-for-character against the approved copy.
 *     A single source of truth for the wording only helps if something proves it
 *     never drifts.
 *
 *  2. STRUCTURAL - source assertions over the three wired client components (and
 *     the untouched server writers). A behavioural test over the text module
 *     cannot prove that each screen actually routes its create through the
 *     confirmation, that the Server Action moved OUT of the submit handler, that
 *     the edit/replace paths were left alone, that the FILE multipart body is
 *     still captured synchronously, or that no server writer imports the warning.
 *     These pin the wiring itself.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/components/launch-fanout-warning.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  FANOUT_WARNING_CANCEL_LABEL,
  MATERIAL_FANOUT_WARNING_CONFIRM_LABEL,
  MATERIAL_FANOUT_WARNING_TEXT,
  MESSAGE_FANOUT_WARNING_CONFIRM_LABEL,
  MESSAGE_FANOUT_WARNING_TEXT,
} from "@/lib/course/launch-fanout-warning-text";

// ---------------------------------------------------------------------------
// Source helpers (same convention as the other *.contract.test.ts files)
// ---------------------------------------------------------------------------

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed, so the structural assertions test
 * what the code DOES, not what its (deliberately verbose) LAUNCH-WARNING comments
 * are allowed to mention - those comments name createMessageTask, handleSubmit,
 * the server files, etc., and naming them in prose must not be mistaken for
 * using them.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Body of a plain (non-exported) `function NAME(...) { ... }`, brace-matched. */
function functionBody(src: string, name: string): string {
  const sig = src.indexOf(`function ${name}(`);
  assert.ok(sig >= 0, `function ${name} must exist`);
  const open = src.indexOf("{", sig);
  assert.ok(open >= 0, `function ${name} must have a body`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in function ${name}`);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return count;
    count += 1;
    from = at + needle.length;
  }
}

const TEXT_MODULE = "../course/launch-fanout-warning-text.ts";
const CONFIRM_MODAL = "./ConfirmModal.tsx";
const ADMIN_MESSAGES = "../../app/admin/messages/MessagesClient.tsx";
const INSTRUCTOR_MESSAGES = "../../app/instructor/InstructorMessagesSection.tsx";
const ADMIN_MATERIALS = "../../app/admin/materials/MaterialsClient.tsx";

const SERVER_WRITERS = [
  "../actions/messages.ts",
  "../actions/materials.ts",
  "../actions/notifications.ts",
  "../actions/push.ts",
  "../../app/api/admin/materials/upload/route.ts",
];

// ===========================================================================
// PART 1 - BEHAVIOURAL: exact approved copy
// ===========================================================================

test("message/task warning text is exactly the approved copy", () => {
  assert.equal(
    MESSAGE_FANOUT_WARNING_TEXT,
    "כעת ההודעות והמשימות עדיין נשלחות לכל החניכים הפעילים במערכת, ללא הפרדה מלאה בין הקורסים. ההודעה עלולה להגיע גם לחניכים שאינם שייכים לקורס שאליו התכוונת.",
  );
});

test("material warning text is exactly the approved copy", () => {
  assert.equal(
    MATERIAL_FANOUT_WARNING_TEXT,
    "כעת התראות על חומר חדש עדיין נשלחות לכל החניכים הפעילים במערכת, ללא הפרדה מלאה בין הקורסים. שם החומר עלול להופיע גם לחניכים שאינם שייכים לקורס.",
  );
});

test("warning texts carry no stray line break (single logical sentence)", () => {
  assert.ok(!MESSAGE_FANOUT_WARNING_TEXT.includes("\n"), "message text must be one line");
  assert.ok(!MATERIAL_FANOUT_WARNING_TEXT.includes("\n"), "material text must be one line");
});

test("button labels are exactly the approved labels", () => {
  assert.equal(FANOUT_WARNING_CANCEL_LABEL, "ביטול");
  assert.equal(MESSAGE_FANOUT_WARNING_CONFIRM_LABEL, "שליחה בכל זאת");
  assert.equal(MATERIAL_FANOUT_WARNING_CONFIRM_LABEL, "הוספה בכל זאת");
});

// ===========================================================================
// PART 2 - STRUCTURAL: wiring, exclusions, FormData, persistence, isolation
// ===========================================================================

test("all three screens import the shared text module and render ConfirmModal", () => {
  for (const file of [ADMIN_MESSAGES, INSTRUCTOR_MESSAGES, ADMIN_MATERIALS]) {
    const src = readCode(file);
    assert.ok(
      src.includes('from "@/lib/course/launch-fanout-warning-text"'),
      `${file} must import the shared warning text`,
    );
    assert.ok(src.includes("<ConfirmModal"), `${file} must render ConfirmModal`);
    assert.ok(
      src.includes('from "@/lib/components/ConfirmModal"'),
      `${file} must import ConfirmModal`,
    );
  }
});

test("admin message send is invoked only from the confirm handler, never from submit", () => {
  const src = readCode(ADMIN_MESSAGES);
  assert.equal(countOccurrences(src, "createMessageTask("), 1, "exactly one send call site");
  assert.ok(
    !functionBody(src, "handleSubmit").includes("createMessageTask("),
    "handleSubmit must only stage - it must not send",
  );
  assert.ok(
    functionBody(src, "confirmSend").includes("createMessageTask("),
    "confirmSend must be the sole send call site",
  );
});

test("instructor message send is invoked only from the confirm handler, never from submit", () => {
  const src = readCode(INSTRUCTOR_MESSAGES);
  assert.equal(
    countOccurrences(src, "createMessageTaskAsInstructor("),
    1,
    "exactly one send call site",
  );
  assert.ok(
    !functionBody(src, "handleSubmit").includes("createMessageTaskAsInstructor("),
    "handleSubmit must only stage - it must not send",
  );
  assert.ok(
    functionBody(src, "confirmSend").includes("createMessageTaskAsInstructor("),
    "confirmSend must be the sole send call site",
  );
});

test("both message confirm handlers clear the staged payload before starting the send", () => {
  for (const file of [ADMIN_MESSAGES, INSTRUCTOR_MESSAGES]) {
    const body = functionBody(readCode(file), "confirmSend");
    const clear = body.indexOf("setPendingSend(null)");
    const send = body.indexOf("startTransition");
    assert.ok(clear >= 0, `${file} confirmSend must clear the staged payload`);
    assert.ok(send >= 0, `${file} confirmSend must start a transition`);
    assert.ok(clear < send, `${file} must clear the payload before sending (no double-send)`);
  }
});

test("material create Server Action / upload runs only from the confirm handler for notifying visibilities", () => {
  const src = readCode(ADMIN_MATERIALS);
  const create = functionBody(src, "handleCreateSubmit");

  // The actual writes live in performLinkCreate / performFileCreate, never
  // inline in the submit handler.
  assert.ok(!create.includes("createLinkMaterial("), "handleCreateSubmit must not call createLinkMaterial directly");
  assert.ok(!create.includes("fetch("), "handleCreateSubmit must not upload directly");

  // The notifying path must be gated behind the confirm handler.
  const confirm = functionBody(src, "confirmCreate");
  assert.ok(
    confirm.includes("performLinkCreate(") && confirm.includes("performFileCreate("),
    "confirmCreate must drive both create kinds",
  );
});

test("material FILE multipart body is captured synchronously inside handleCreateSubmit", () => {
  const create = functionBody(readCode(ADMIN_MATERIALS), "handleCreateSubmit");
  assert.ok(
    create.includes("new FormData(e.currentTarget)"),
    "the FILE body must be built from the live form element inside the submit handler",
  );
  // The confirm callback must never reach for e.currentTarget (gone by then).
  const confirm = functionBody(readCode(ADMIN_MATERIALS), "confirmCreate");
  assert.ok(
    !confirm.includes("e.currentTarget") && !confirm.includes("currentTarget"),
    "confirmCreate must not touch e.currentTarget",
  );
  // It drives the upload from the staged ref instead.
  assert.ok(
    confirm.includes("stagedFileFormDataRef.current"),
    "confirmCreate must use the staged FormData ref",
  );
});

test("material confirm handler clears the staged create + FormData before performing", () => {
  const body = functionBody(readCode(ADMIN_MATERIALS), "confirmCreate");
  const clearPending = body.indexOf("setPendingCreate(null)");
  const clearRef = body.indexOf("stagedFileFormDataRef.current = null");
  const perform = Math.min(
    ...["performLinkCreate(", "performFileCreate("]
      .map((n) => body.indexOf(n))
      .filter((i) => i >= 0),
  );
  assert.ok(clearPending >= 0 && clearRef >= 0, "confirmCreate must clear both staged holders");
  assert.ok(clearPending < perform && clearRef < perform, "must clear before performing (no double-add)");
});

test("material cancel clears both staged holders and performs no create", () => {
  const body = functionBody(readCode(ADMIN_MATERIALS), "cancelCreate");
  assert.ok(body.includes("setPendingCreate(null)"), "cancel clears the staged create");
  assert.ok(body.includes("stagedFileFormDataRef.current = null"), "cancel clears the staged FormData");
  assert.ok(!body.includes("performLinkCreate("), "cancel must not create");
  assert.ok(!body.includes("performFileCreate("), "cancel must not upload");
});

test("the material warning condition is exactly STUDENTS or BOTH", () => {
  const src = readCode(ADMIN_MATERIALS);
  const body = functionBody(src, "materialCreateNotifiesStudents");
  assert.ok(body.includes('"STUDENTS"'), "must include STUDENTS");
  assert.ok(body.includes('"BOTH"'), "must include BOTH");
  assert.ok(!body.includes('"INSTRUCTORS"'), "INSTRUCTORS must never satisfy the condition");
});

test("the INSTRUCTORS-only create path stays direct and warning-free", () => {
  const create = functionBody(readCode(ADMIN_MATERIALS), "handleCreateSubmit");
  // When the visibility does not notify, both kinds perform immediately with no
  // staging (no setPendingCreate in the non-notifying branches).
  assert.ok(create.includes("if (!notifiesStudents)"), "must special-case the non-notifying visibility");
  assert.ok(create.includes("performLinkCreate(input)"), "non-notifying LINK creates directly");
  assert.ok(create.includes("performFileCreate(formData)"), "non-notifying FILE uploads directly");
});

test("the edit and file-REPLACE paths are untouched (no warning, own writes intact)", () => {
  const src = readCode(ADMIN_MATERIALS);
  const edit = functionBody(src, "handleEditSubmit");
  // Replace keeps its own synchronous FormData + upload, and edit keeps updateMaterial.
  assert.ok(edit.includes("new FormData()"), "replace path still builds its own FormData");
  assert.ok(edit.includes("fetch("), "replace path still uploads");
  assert.ok(edit.includes("updateMaterial("), "edit path still calls updateMaterial");
  // The warning machinery must not have leaked into edit.
  assert.ok(!edit.includes("setPendingCreate"), "edit must not touch the create warning state");
  assert.ok(!edit.includes("ConfirmModal"), "edit must not open the warning");
});

test("message edit/archive/restore handlers do not open the warning", () => {
  const src = readCode(ADMIN_MESSAGES);
  for (const name of ["handleEditSubmit", "handleConfirmArchive", "handleRestore"]) {
    const body = functionBody(src, name);
    assert.ok(!body.includes("setPendingSend"), `${name} must not stage a warning`);
    assert.ok(!body.includes("createMessageTask("), `${name} must not send`);
  }
});

test("ConfirmModal persists nothing and calls no server action", () => {
  const src = readCode(CONFIRM_MODAL);
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "process.env"]) {
    assert.ok(!src.includes(forbidden), `ConfirmModal must not use ${forbidden}`);
  }
  // It is a dumb wrapper: no Server Action import, no fetch, no Prisma.
  assert.ok(!src.includes("fetch("), "ConfirmModal must not perform IO");
  assert.ok(!src.includes("@/lib/actions/"), "ConfirmModal must not import any Server Action");
});

test("the shared text module persists nothing", () => {
  const src = readCode(TEXT_MODULE);
  for (const forbidden of ["localStorage", "sessionStorage", "document.cookie", "process.env"]) {
    assert.ok(!src.includes(forbidden), `text module must not use ${forbidden}`);
  }
});

test("no server writer imports the warning module (the slice stays UI-only)", () => {
  for (const file of SERVER_WRITERS) {
    const src = readSource(file);
    assert.ok(
      !src.includes("launch-fanout-warning-text"),
      `${file} must not import the launch warning`,
    );
  }
});
