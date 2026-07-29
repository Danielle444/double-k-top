/**
 * EXAM EX-C1 — executable tests for the PURE exam label maps
 * (exam-kind-labels.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-kind-labels.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 *
 * SCOPE OF PROOF: every enum value has a non-empty Hebrew label; the maps are
 * exhaustive against the canonical enum lists; the locked "חניך מודרך" label;
 * THEORY and DEMO_RIDER are absent; the lookup fails closed; and (EX-S3.5) the
 * retired phase label map is GONE, with no phase identity label anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as labels from "./exam-kind-labels";
import {
  EXAM_KIND_LABELS,
  EXAM_BEGINNER_FORMAT_LABELS,
  EXAM_ASSIGNMENT_ROLE_LABELS,
  examKindLabel,
} from "./exam-kind-labels";
import {
  EXAM_KINDS,
  EXAM_BEGINNER_FORMATS,
  EXAM_ASSIGNMENT_ROLES,
} from "./exam-domain-core";

/** Hebrew letters, so an English enum token can never leak into the UI. */
const HEBREW = /[֐-׿]/;

test("every ExamKind has a non-empty Hebrew label and the map is exhaustive", () => {
  assert.deepEqual(Object.keys(EXAM_KIND_LABELS).sort(), [...EXAM_KINDS].sort());
  for (const kind of EXAM_KINDS) {
    const label = EXAM_KIND_LABELS[kind];
    assert.ok(label.trim().length > 0, `${kind} has an empty label`);
    assert.ok(HEBREW.test(label), `${kind} is not Hebrew`);
  }
});

test("every ExamBeginnerFormat and role has a Hebrew label", () => {
  assert.deepEqual(
    Object.keys(EXAM_BEGINNER_FORMAT_LABELS).sort(),
    [...EXAM_BEGINNER_FORMATS].sort(),
  );
  assert.deepEqual(
    Object.keys(EXAM_ASSIGNMENT_ROLE_LABELS).sort(),
    [...EXAM_ASSIGNMENT_ROLES].sort(),
  );
  const all = [
    ...Object.values(EXAM_BEGINNER_FORMAT_LABELS),
    ...Object.values(EXAM_ASSIGNMENT_ROLE_LABELS),
  ];
  for (const label of all) {
    assert.ok(label.trim().length > 0);
    assert.ok(HEBREW.test(label), label);
  }
});

test('INSTRUCTED_TRAINEE is exactly the locked label "חניך מודרך"', () => {
  assert.equal(EXAM_ASSIGNMENT_ROLE_LABELS.INSTRUCTED_TRAINEE, "חניך מודרך");
  assert.equal(EXAM_ASSIGNMENT_ROLE_LABELS.EXAMINEE, "נבחן");
});

test("THEORY and DEMO_RIDER do not exist in any label map", () => {
  const keys = [
    ...Object.keys(EXAM_KIND_LABELS),
    ...Object.keys(EXAM_BEGINNER_FORMAT_LABELS),
    ...Object.keys(EXAM_ASSIGNMENT_ROLE_LABELS),
  ];
  assert.ok(!keys.includes("THEORY"));
  assert.ok(!keys.includes("DEMO_RIDER"));
  assert.equal(Object.keys(EXAM_ASSIGNMENT_ROLE_LABELS).length, 2);
});

// --- EX-S3.5: the retired phase label map -----------------------------------

test("EXAM_PHASE_LABELS is GONE from the module's export surface", () => {
  const exported = Object.keys(labels);
  assert.equal(exported.includes("EXAM_PHASE_LABELS"), false);
  // Nothing phase-shaped survives under a different name either.
  for (const name of exported) {
    assert.ok(!/PHASE/i.test(name), `a phase export survived: ${name}`);
  }
  assert.deepEqual(exported.sort(), [
    "EXAM_ASSIGNMENT_ROLE_LABELS",
    "EXAM_BEGINNER_FORMAT_LABELS",
    "EXAM_KIND_LABELS",
    "examKindLabel",
  ]);
});

test('no label map exposes "ממשק" or "רכיבה" as an exam identity', () => {
  // ExamDefinition.name is the only visible exam name. "ממשק ורכיבה" survives
  // as the INTERFACE_RIDING *kind* label; the standalone phase names must not.
  const values = [
    ...Object.values(EXAM_KIND_LABELS),
    ...Object.values(EXAM_BEGINNER_FORMAT_LABELS),
    ...Object.values(EXAM_ASSIGNMENT_ROLE_LABELS),
  ];
  assert.equal(values.includes("ממשק"), false);
  assert.equal(values.includes("רכיבה"), false);
  assert.equal(EXAM_KIND_LABELS.INTERFACE_RIDING, "ממשק ורכיבה");
});

test("examKindLabel is total and fails closed on anything out of domain", () => {
  assert.equal(examKindLabel("BEGINNER_INSTRUCTION"), "הדרכת מתחילים");
  for (const bad of ["", "THEORY", "beginner_instruction", "__proto__", "toString", null, 7, {}]) {
    assert.equal(examKindLabel(bad), null, String(bad));
  }
});

test("the label maps are frozen", () => {
  assert.ok(Object.isFrozen(EXAM_KIND_LABELS));
  assert.ok(Object.isFrozen(EXAM_BEGINNER_FORMAT_LABELS));
  assert.ok(Object.isFrozen(EXAM_ASSIGNMENT_ROLE_LABELS));
});
