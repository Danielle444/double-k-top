/**
 * SOURCE-CONTRACT tests for the presentation-feedback autocorrect fix.
 *
 * WHY A CONTRACT TEST AND NOT A RENDER TEST. The only exported renderable in
 * PresentationProgressFeedbackSection.tsx is PresentationProgressFeedbackList,
 * and the entry form that owns these three fields is mounted only after client
 * state changes (isAdding / editingId), which a `renderToStaticMarkup` pass
 * cannot reach. So this file uses the repository's established SOURCE-CONTRACT
 * pattern (same technique as ./HorseFeedingSection.contract.test.ts and
 * ./ScheduleTimeGrid.contract.test.ts) to lock the rendered attributes and,
 * just as importantly, the absence of everything that was NOT asked for.
 *
 * READ THIS HONESTLY: the assertions below prove STRUCTURE, not runtime
 * behaviour. They prove which attributes the three presentation free-text
 * fields carry, that the save path around them is byte-for-byte the same shape
 * it was, and that the change did not leak into any other surface.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/PresentationProgressFeedbackSection.autocorrect.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips block, line and JSX comments so prose about a rule can't satisfy it. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const PRESENTATION_PATH = "lib/components/PresentationProgressFeedbackSection.tsx";
const RIDING_PATH = "lib/components/RidingProgressFeedbackSection.tsx";
const LUNGE_PATH = "lib/components/LungeProgressFeedbackSection.tsx";

const PRESENTATION = code(PRESENTATION_PATH);

/** The JSX element opening tag that binds `value={values.<field>}`. */
function fieldTag(fileCode: string, field: string): string {
  const anchor = fileCode.indexOf(`value={values.${field}}`);
  assert.notEqual(anchor, -1, `expected a field bound to values.${field}`);
  const start = fileCode.lastIndexOf("<", anchor);
  const end = fileCode.indexOf("/>", anchor);
  assert.ok(start !== -1 && end !== -1, `expected a self-closing tag for values.${field}`);
  return fileCode.slice(start, end + 2);
}

// ---------------------------------------------------------------------------
// 1. The presentation free-text fields carry autoCorrect="off"
// ---------------------------------------------------------------------------

test("the presentation feedback textarea has autoCorrect=off", () => {
  const tag = fieldTag(PRESENTATION, "feedback");
  assert.match(tag, /^<textarea\b/, "the משוב field must still be a <textarea>");
  assert.match(tag, /autoCorrect="off"/);
});

test("the presentation topic and type free-text inputs have autoCorrect=off", () => {
  for (const field of ["topic", "presentationType"]) {
    const tag = fieldTag(PRESENTATION, field);
    assert.match(tag, /^<input\b/, `values.${field} must still be an <input>`);
    assert.match(tag, /type="text"/, `values.${field} must still be type="text"`);
    assert.match(tag, /autoCorrect="off"/, `values.${field} is missing autoCorrect="off"`);
  }
});

test("autoCorrect is applied exactly three times, only to the free-text fields", () => {
  const occurrences = PRESENTATION.match(/autoCorrect/g) ?? [];
  assert.equal(occurrences.length, 3);
  // The date picker is not free text and must not have been touched.
  assert.doesNotMatch(fieldTag(PRESENTATION, "date"), /autoCorrect/);
  assert.match(fieldTag(PRESENTATION, "date"), /type="date"/);
});

test("autoCorrect is spelled with the exact React casing and the off value", () => {
  // A lowercase `autocorrect` would be passed through as an unknown DOM
  // attribute and warn in React; any value other than "off" is not the fix.
  assert.doesNotMatch(PRESENTATION, /autocorrect/);
  assert.equal((PRESENTATION.match(/autoCorrect="off"/g) ?? []).length, 3);
});

// ---------------------------------------------------------------------------
// 2 & 3. Nothing else about keyboard/text behaviour was added or changed
// ---------------------------------------------------------------------------

test("no spellCheck attribute exists anywhere in the presentation section", () => {
  assert.doesNotMatch(PRESENTATION, /spellCheck/i);
});

test("no autoCapitalize attribute exists anywhere in the presentation section", () => {
  assert.doesNotMatch(PRESENTATION, /autoCapitalize/i);
});

test("no autoComplete, inputMode, dir or lang attribute was introduced", () => {
  for (const forbidden of [/autoComplete/i, /inputMode/i, /\bdir=/, /\blang=/]) {
    assert.doesNotMatch(PRESENTATION, forbidden, `unexpected ${forbidden} in the presentation section`);
  }
});

// ---------------------------------------------------------------------------
// 4. Save / autosave behaviour is unchanged
// ---------------------------------------------------------------------------

test("each free-text field still writes straight to local state on change", () => {
  const expected: Record<string, RegExp> = {
    feedback: /onChange=\{\(e\) => setValues\(\(v\) => \(\{ \.\.\.v, feedback: e\.target\.value \}\)\)\}/,
    topic: /onChange=\{\(e\) => setValues\(\(v\) => \(\{ \.\.\.v, topic: e\.target\.value \}\)\)\}/,
    presentationType:
      /onChange=\{\(e\) => setValues\(\(v\) => \(\{ \.\.\.v, presentationType: e\.target\.value \}\)\)\}/,
  };
  for (const [field, pattern] of Object.entries(expected)) {
    assert.match(fieldTag(PRESENTATION, field), pattern, `values.${field} onChange changed shape`);
  }
});

test("the fields remain controlled, with no value transformation on input", () => {
  for (const field of ["feedback", "topic", "presentationType"]) {
    const tag = fieldTag(PRESENTATION, field);
    assert.match(tag, new RegExp(`value=\\{values\\.${field}\\}`), `values.${field} is no longer controlled`);
    assert.doesNotMatch(tag, /defaultValue/, `values.${field} must not become uncontrolled`);
  }
});

test("saving is still explicit-submit only - no autosave was introduced", () => {
  // No blur/keyboard-triggered or timer-driven persistence anywhere.
  for (const forbidden of [/onBlur/, /setTimeout/, /setInterval/, /onKeyDown/, /onKeyUp/, /useEffect/, /debounce/i]) {
    assert.doesNotMatch(PRESENTATION, forbidden, `unexpected ${forbidden} - autosave must not exist`);
  }
  // The three write calls, and the submit buttons that trigger them, are intact.
  assert.match(PRESENTATION, /actions\.create\(studentId, presentationProgressFormToInput\(values\)\)/);
  assert.match(PRESENTATION, /actions\.update\(id, presentationProgressFormToInput\(values\)\)/);
  assert.match(PRESENTATION, /actions\.delete\(id\)/);
  assert.match(PRESENTATION, /onClick=\{\(\) => onSubmit\(values\)\}/);
});

test("the submitted payload shape and its content guard are unchanged", () => {
  assert.match(
    PRESENTATION,
    /return \{\s*date: values\.date,\s*feedback: values\.feedback\.trim\(\) \|\| null,\s*topic: values\.topic\.trim\(\) \|\| null,\s*presentationType: values\.presentationType\.trim\(\) \|\| null,\s*categoryScores: values\.categoryScores,\s*\};/
  );
  assert.match(
    PRESENTATION,
    /values\.feedback\.trim\(\) !== "" \|\|\s*values\.topic\.trim\(\) !== "" \|\|\s*values\.presentationType\.trim\(\) !== ""/
  );
});

// ---------------------------------------------------------------------------
// 5. Unrelated fields and forms are untouched
// ---------------------------------------------------------------------------

test("the sibling riding and lunge feedback sections were not modified", () => {
  // Deliberate: there is no shared feedback-textarea component, so this fix is
  // scoped to presentation only. If riding/lunge are ever asked for, that is a
  // separate approved change and this assertion is the thing to update.
  for (const path of [RIDING_PATH, LUNGE_PATH]) {
    assert.doesNotMatch(code(path), /autoCorrect/i, `${path} must not have been touched`);
  }
});

/** Every .ts/.tsx source file under app/ and lib/, excluding test files. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(child);
      }
    }
  };
  walk("app");
  walk("lib");
  return out;
}

test("no other app or lib source file mentions autoCorrect", () => {
  const offenders = sourceFiles().filter(
    (path) => path !== PRESENTATION_PATH && /autoCorrect/i.test(code(path))
  );
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 6. No Server Action, schema, auth or service-worker change
// ---------------------------------------------------------------------------

test("the touched file is still a pure client component with no server surface", () => {
  assert.match(source(PRESENTATION_PATH), /^"use client";/);
  assert.doesNotMatch(PRESENTATION, /"use server"/);
  assert.doesNotMatch(PRESENTATION, /from "@prisma\/client"/);
  assert.doesNotMatch(PRESENTATION, /@\/lib\/(auth|prisma|db)/);
  // Its only cross-module imports are the erased type-only action imports plus
  // the pure date and rubric helpers - unchanged by this fix.
  // [\s\S] rather than the `s` flag so multi-line `import type { ... }` blocks
  // are captured too (the tsconfig target predates the dotAll flag).
  const imports = PRESENTATION.match(/^import[\s\S]*?from "[^"]*";$/gm) ?? [];
  assert.deepEqual(
    imports.filter((line) => line.includes("@/lib/actions/") && !line.startsWith("import type")),
    []
  );
});

test("no schema, server action, auth or service-worker file carries this attribute", () => {
  const guarded = [
    "prisma/schema.prisma",
    "public/sw.js",
    ...readdirSync(join(ROOT, "lib", "actions")).map((name) => `lib/actions/${name}`),
    ...readdirSync(join(ROOT, "lib", "auth"), { recursive: true })
      .map((name) => String(name).split(sep).join(posix.sep))
      .map((name) => `lib/auth/${name}`),
  ];
  for (const path of guarded) {
    if (!/\.(ts|tsx|js|prisma)$/.test(path)) continue;
    assert.doesNotMatch(source(path), /autoCorrect/i, `${path} must not have been touched`);
  }
});
