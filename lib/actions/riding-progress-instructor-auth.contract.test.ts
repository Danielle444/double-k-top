/**
 * AUTH-RPF-1 - non-DB CONTRACT (source-scan) tests locking the server-resolved
 * instructor identity for the riding-progress journal.
 *
 * WHY SOURCE-SCAN: the actions under test are "use server" modules that
 * transitively import next/headers (via the Actor DAL) and Prisma, so they
 * cannot be imported or executed in a unit test. What must be pinned is
 * structural and is exactly what a regression would break: that no action takes
 * an actor id, that every one of them resolves the actor from the session, that
 * both gates fail closed, that attribution comes from the server actor, and that
 * the single client call site sends no instructor id. The one genuinely pure
 * predicate in the chain (canAccessTraineeProgress) IS executed below.
 *
 * Mirrors prisma/*.contract.test.ts and riding-history-course-identity.contract.test.ts.
 * Run with:
 *   npx tsx --test lib/actions/riding-progress-instructor-auth.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { canAccessTraineeProgress } from "../trainee-progress-permissions";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const INSTRUCTOR_ACTIONS_REL = "lib/actions/student-riding-progress-feedback-instructor.ts";
const CLIENT_REL = "app/instructor/InstructorTraineeProgressSection.tsx";
const ADMIN_ACTIONS_REL = "lib/actions/student-riding-progress-feedback.ts";

const ACTIONS = read(INSTRUCTOR_ACTIONS_REL);
const CLIENT = read(CLIENT_REL);
const ADMIN = read(ADMIN_ACTIONS_REL);

/** Executable body with block and line comments stripped. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const CODE = stripComments(ACTIONS);
const CLIENT_CODE = stripComments(CLIENT);

/** The four exported instructor actions for this journal. */
const ACTION_NAMES = [
  "listStudentRidingProgressFeedbackForInstructor",
  "listStudentRidingProgressFeedbackForInstructorView",
  "createStudentRidingProgressFeedbackAsInstructor",
  "updateStudentRidingProgressFeedbackAsInstructor",
] as const;

// ---------------------------------------------------------------------------
// No action accepts an actor id
// ---------------------------------------------------------------------------

test("NO exported action takes instructorId as a parameter", () => {
  assert.equal(
    /instructorId\s*:\s*string/.test(CODE),
    false,
    "an instructorId parameter would re-open the identity-spoofing hole",
  );
  assert.equal(/\binstructorId\b/.test(CODE), false, "the executable body must not mention instructorId at all");
});

test("every action's first parameter is a SUBJECT, never an actor", () => {
  for (const name of ACTION_NAMES) {
    const signature = CODE.slice(CODE.indexOf(`export async function ${name}(`));
    const params = signature.slice(signature.indexOf("(") + 1, signature.indexOf(")"));
    assert.equal(/instructorId/.test(params), false, `${name} must not take an actor id`);
    assert.match(
      params,
      /^\s*(studentId\?*:\s*string|id:\s*string)/,
      `${name}'s first parameter must be the subject student id or the row id`,
    );
  }
});

test("the subject student id is still accepted where the action is about a trainee", () => {
  assert.match(CODE, /listStudentRidingProgressFeedbackForInstructorView\(\s*studentId: string/);
  assert.match(CODE, /createStudentRidingProgressFeedbackAsInstructor\(\s*studentId: string/);
  assert.match(CODE, /where: \{ studentId \}/, "the subject still scopes the read");
});

// ---------------------------------------------------------------------------
// Every action resolves the actor server-side, and fails closed
// ---------------------------------------------------------------------------

test("identity comes from the canonical Actor DAL", () => {
  assert.match(CODE, /import \{ getCurrentInstructor \} from "@\/lib\/auth\/actor";/);
  // The old client-id-trusting helper is gone entirely.
  assert.equal(/requireInstructorWithRidingNotesPermission/.test(ACTIONS), false);
  assert.equal(/requireInstructorWithTraineeProgressAccess/.test(ACTIONS), false);
  assert.equal(
    /prisma\.instructor\.findUnique/.test(CODE),
    false,
    "an instructor must never be looked up by a caller-supplied id again",
  );
});

test("both gates call getCurrentInstructor and fail closed on a null actor", () => {
  for (const gate of [
    "requireActingInstructorForRidingProgressWrite",
    "requireActingInstructorForTraineeProgressView",
  ]) {
    const body = CODE.slice(CODE.indexOf(`async function ${gate}(`));
    const gateBody = body.slice(0, body.indexOf("\n}"));
    assert.match(gateBody, /await getCurrentInstructor\(\)/, `${gate} must resolve the session actor`);
    assert.match(gateBody, /if \(!actor/, `${gate} must reject a null actor`);
    assert.match(gateBody, /return null;/, `${gate} must fail closed`);
  }
});

test("the WRITE gate additionally requires canEditRidingNotes", () => {
  const body = CODE.slice(CODE.indexOf("async function requireActingInstructorForRidingProgressWrite("));
  assert.match(body.slice(0, body.indexOf("\n}")), /!actor\.canEditRidingNotes/);
});

test("the VIEW gate keeps the wider OR permission via the shared pure predicate", () => {
  assert.match(CODE, /import \{ canAccessTraineeProgress \} from "@\/lib\/trainee-progress-permissions";/);
  const body = CODE.slice(CODE.indexOf("async function requireActingInstructorForTraineeProgressView("));
  assert.match(body.slice(0, body.indexOf("\n}")), /!canAccessTraineeProgress\(actor\)/);
});

test("every exported action gates on a server-resolved actor before touching Prisma", () => {
  for (const name of ACTION_NAMES) {
    const start = CODE.indexOf(`export async function ${name}(`);
    const next = ACTION_NAMES.map((n) => CODE.indexOf(`export async function ${n}(`))
      .filter((i) => i > start)
      .sort((a, b) => a - b)[0];
    const body = CODE.slice(start, next === undefined ? CODE.length : next);
    const gateAt = body.search(/await requireActingInstructorFor/);
    const prismaAt = body.search(/await prisma\./);
    assert.ok(gateAt >= 0, `${name} must resolve the acting instructor`);
    assert.ok(
      prismaAt < 0 || gateAt < prismaAt,
      `${name} must gate BEFORE any Prisma call`,
    );
    assert.match(body, /if \(!instructor\)/, `${name} must fail closed on a null actor`);
  }
});

test("EXECUTABLE: the view predicate is fail-closed for an actor with neither permission", () => {
  assert.equal(canAccessTraineeProgress({ canEditRidingNotes: false, canEditTeachingPracticeFeedback: false }), false);
  assert.equal(canAccessTraineeProgress({ canEditRidingNotes: true, canEditTeachingPracticeFeedback: false }), true);
  assert.equal(canAccessTraineeProgress({ canEditRidingNotes: false, canEditTeachingPracticeFeedback: true }), true);
});

// ---------------------------------------------------------------------------
// Attribution and ownership use the SERVER actor
// ---------------------------------------------------------------------------

test("create attributes authorship to the server-resolved actor", () => {
  const body = CODE.slice(CODE.indexOf("export async function createStudentRidingProgressFeedbackAsInstructor("));
  assert.match(body, /createdByName: instructor\.fullName/);
  assert.match(body, /updatedByName: instructor\.fullName/);
  assert.match(body, /createdByInstructorId: instructor\.id/);
  assert.match(body, /updatedByInstructorId: instructor\.id/);
});

test("update attributes and checks ownership against the server-resolved actor", () => {
  const body = CODE.slice(CODE.indexOf("export async function updateStudentRidingProgressFeedbackAsInstructor("));
  assert.match(body, /existing\.createdByInstructorId !== instructor\.id/);
  assert.match(body, /updatedByName: instructor\.fullName/);
  assert.match(body, /updatedByInstructorId: instructor\.id/);
  // Original authorship is still preserved on edit.
  assert.equal(/createdByInstructorId: /.test(body.slice(body.indexOf("data: {"))), false);
});

test("own-rows listing scopes by the server actor id, not a caller-supplied id", () => {
  const body = CODE.slice(CODE.indexOf("export async function listStudentRidingProgressFeedbackForInstructor("));
  assert.match(body, /createdByInstructorId: instructor\.id/);
});

test("no instructor DELETE action exists - deletion stays manager-only, unchanged", () => {
  assert.equal(/deleteStudentRidingProgressFeedbackAsInstructor/.test(ACTIONS), false);
  assert.equal(/prisma\.studentRidingProgressFeedback\.delete/.test(CODE), false);
});

// ---------------------------------------------------------------------------
// The client sends no actor identity
// ---------------------------------------------------------------------------

test("the client call site passes NO instructor id to the riding-progress actions", () => {
  for (const key of ["listRidingProgress", "createRidingProgress", "updateRidingProgress"]) {
    const line = CLIENT_CODE.split("\n").find((l) => l.includes(`${key}:`));
    assert.ok(line, `${key} must still be wired`);
    assert.equal(/instructorId/.test(line), false, `${key} must not send instructorId`);
  }
});

test("the client never smuggles an actor id through a field, param or storage", () => {
  for (const forbidden of [
    "localStorage",
    "sessionStorage",
    "searchParams",
    'name="instructorId"',
    'type="hidden"',
  ]) {
    assert.equal(CLIENT_CODE.includes(forbidden), false, `the client must not use ${forbidden}`);
  }
});

test("the instructorId prop still legitimately serves the OUT-OF-SCOPE actions", () => {
  // The prop is NOT removed: the sibling journals, general notes, riding history
  // and Teaching Practice actions in this same component still require it. It no
  // longer reaches any riding-progress action, which is the whole point.
  assert.match(CLIENT_CODE, /listStudentGeneralNotesForInstructor\(instructorId/);
  assert.match(CLIENT_CODE, /listStudentLungeProgressFeedbackForInstructorView\(instructorId/);
});

// ---------------------------------------------------------------------------
// Scope containment
// ---------------------------------------------------------------------------

test("NO course-scoping is wired by this slice", () => {
  assert.equal(/courseOfferingId/.test(CODE), false, "S4 owns course scoping, not this slice");
  assert.equal(/riding-progress-course-scope-core/.test(ACTIONS), false);
  assert.equal(/riding-progress-course-backfill-core/.test(ACTIONS), false);
});

test("the ADMIN riding-progress actions are untouched by this slice", () => {
  assert.match(ADMIN, /import \{ requireAdmin \} from "@\/lib\/auth\/require-admin";/);
  assert.equal(/getCurrentInstructor/.test(ADMIN), false, "admin auth must stay requireAdmin-based");
  for (const name of [
    "listStudentRidingProgressFeedbackForAdmin",
    "createStudentRidingProgressFeedbackAsAdmin",
    "updateStudentRidingProgressFeedbackAsAdmin",
    "deleteStudentRidingProgressFeedbackAsAdmin",
  ]) {
    assert.ok(ADMIN.includes(`export async function ${name}(`), `${name} must still exist unchanged`);
  }
});

test("the SIBLING instructor journals are not touched by this slice", () => {
  // They still take a client-supplied instructorId - the identical weakness,
  // deliberately left for a separate slice. This test documents that and will
  // fail loudly if someone quietly changes them here instead.
  for (const rel of [
    "lib/actions/student-lunge-progress-feedback-instructor.ts",
    "lib/actions/student-presentation-progress-feedback-instructor.ts",
  ]) {
    const src = stripComments(read(rel));
    assert.match(src, /instructorId: string/, `${rel} is out of scope and must be unchanged`);
    assert.equal(/getCurrentInstructor/.test(src), false, `${rel} must not be migrated in this slice`);
  }
});
