// RS-SEC-1I-CP - SUPPLEMENTARY per-wrapper regression (source-text) proving that
// every one of the ten instructor-facing complex riding-plan writers has been
// bound to the signed session and NO LONGER accepts a client-supplied acting
// instructorId. The PRIMARY security evidence is the behavioral test
// riding-slot-complex-auth.test.ts; this file locks the structural cutover per
// wrapper so a future refactor cannot silently re-introduce a client actor id.
//
// For each of the ten public instructor wrappers it asserts:
//   - the public signature contains NO instructorId parameter;
//   - the wrapper routes through the shared boundary runComplexPlanInstructorWrite;
//   - the wrapper resolves identity via getCurrentInstructor;
//   - the wrapper does NOT re-read an Instructor by a client id
//     (prisma.instructor.findUnique is gone from the wrapper).
// And for the call sites:
//   - the editor's nine routing branches call the instructor action WITHOUT
//     passing actor.instructorId;
//   - the create call site passes only ridingSlotId;
//   - the EXCLUDED reader/publish/unpublish branches still pass actor.instructorId
//     (proving the change was correctly scoped and did not over-reach).
//
// Run: npx tsx --test lib/actions/riding-slot-complex-instructor-binding.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const read = (rel: string) => stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8"));

const complexSrc = read("./riding-slot-complex.ts");
const moveSwapSrc = read("./riding-slot-complex-move-swap.ts");
const editorSrc = read("../components/RidingComplexPlanEditor.tsx");
const sectionSrc = read("../../app/instructor/InstructorRidingSlotsSection.tsx");

// Slice [export async function <name>( ... , next export async function) - i.e.
// exactly one wrapper's declaration + body.
function wrapperRegion(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start > -1, `wrapper not found: ${name}`);
  const next = src.indexOf("export async function ", start + 1);
  return src.slice(start, next > start ? next : undefined);
}

// The signature is everything up to the first ")" after the name (no scoped
// writer has a nested paren in its parameter list).
function signature(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  const end = src.indexOf(")", start);
  return src.slice(start, end + 1);
}

const INSTRUCTOR_WRAPPERS: { src: string; name: string }[] = [
  { src: complexSrc, name: "createRidingSlotComplexPlanAsInstructor" },
  { src: complexSrc, name: "saveRidingSlotComplexBlockAsInstructor" },
  { src: complexSrc, name: "saveRidingSlotComplexStationAsInstructor" },
  { src: complexSrc, name: "deleteRidingSlotComplexStationAsInstructor" },
  { src: complexSrc, name: "reorderRidingSlotComplexStationsAsInstructor" },
  { src: complexSrc, name: "deleteRidingSlotComplexBlockAsInstructor" },
  { src: complexSrc, name: "duplicateRidingSlotComplexBlockAsInstructor" },
  { src: complexSrc, name: "reorderRidingSlotComplexBlocksAsInstructor" },
  { src: complexSrc, name: "deleteRidingSlotComplexPlanAsInstructor" },
  { src: moveSwapSrc, name: "applyComplexPlanMoveSwapAsInstructor" },
];

test("all ten scoped instructor wrappers exist and are counted", () => {
  assert.equal(INSTRUCTOR_WRAPPERS.length, 10, "exactly ten instructor writers are in scope");
  for (const w of INSTRUCTOR_WRAPPERS) {
    assert.ok(w.src.includes(`export async function ${w.name}(`), `${w.name}: wrapper must exist`);
  }
});

test("no scoped instructor wrapper accepts an acting instructorId parameter", () => {
  for (const w of INSTRUCTOR_WRAPPERS) {
    const sig = signature(w.src, w.name);
    assert.ok(!/instructorId/.test(sig), `${w.name}: public signature must not accept instructorId (got: ${sig})`);
  }
});

test("every scoped instructor wrapper routes through the shared signed-session boundary", () => {
  for (const w of INSTRUCTOR_WRAPPERS) {
    const body = wrapperRegion(w.src, w.name);
    assert.ok(body.includes("runComplexPlanInstructorWrite("), `${w.name}: must delegate to runComplexPlanInstructorWrite`);
    assert.ok(body.includes("getCurrentInstructor"), `${w.name}: must resolve identity via getCurrentInstructor`);
  }
});

test("no scoped instructor wrapper re-reads an Instructor by a client-supplied id", () => {
  for (const w of INSTRUCTOR_WRAPPERS) {
    const body = wrapperRegion(w.src, w.name);
    assert.ok(
      !body.includes("prisma.instructor.findUnique("),
      `${w.name}: must not re-read Instructor by id (identity comes from the signed session)`,
    );
  }
});

// Both boundary modules import the canonical resolver + the shared gate.
test("both action modules import the canonical resolver and the shared boundary", () => {
  for (const [label, src] of [["riding-slot-complex", complexSrc], ["move-swap", moveSwapSrc]] as const) {
    assert.ok(/getCurrentInstructor/.test(src), `${label}: must import getCurrentInstructor`);
    assert.ok(/runComplexPlanInstructorWrite/.test(src), `${label}: must import the shared boundary`);
  }
});

// ---- Call sites ------------------------------------------------------------

const EDITOR_ROUTED = [
  "saveRidingSlotComplexBlockAsInstructor",
  "saveRidingSlotComplexStationAsInstructor",
  "deleteRidingSlotComplexStationAsInstructor",
  "reorderRidingSlotComplexStationsAsInstructor",
  "deleteRidingSlotComplexBlockAsInstructor",
  "duplicateRidingSlotComplexBlockAsInstructor",
  "reorderRidingSlotComplexBlocksAsInstructor",
  "deleteRidingSlotComplexPlanAsInstructor",
  "applyComplexPlanMoveSwapAsInstructor",
];

test("the editor's nine instructor routing branches pass NO acting instructorId", () => {
  for (const name of EDITOR_ROUTED) {
    assert.ok(editorSrc.includes(`${name}(`), `editor must still route ${name}`);
    assert.ok(
      !editorSrc.includes(`${name}(actor.instructorId`),
      `editor branch for ${name} must not pass actor.instructorId`,
    );
  }
});

test("the create call site passes only ridingSlotId (no acting instructorId)", () => {
  assert.ok(sectionSrc.includes("createRidingSlotComplexPlanAsInstructor(ridingSlotId)"), "create must pass only ridingSlotId");
  assert.ok(
    !sectionSrc.includes("createRidingSlotComplexPlanAsInstructor(instructorId"),
    "create call site must not pass a client instructorId",
  );
});

// RS-SEC-1I-CP-RD - the two instructor complex-plan READERS are now bound to the
// signed session too: the editor's instructor branches for both readers pass ONLY
// ridingSlotId (no acting instructorId), matching the writer cutover above.
test("the editor's two instructor reader branches pass NO acting instructorId", () => {
  for (const name of [
    "getRidingSlotComplexPlanForInstructor",
    "getComplexRidingPlanPublicationStatusForInstructor",
  ]) {
    assert.ok(editorSrc.includes(`${name}(`), `editor must still route ${name}`);
    assert.ok(
      !editorSrc.includes(`${name}(actor.instructorId`),
      `editor branch for ${name} must not pass actor.instructorId`,
    );
    assert.ok(
      editorSrc.includes(`${name}(ridingSlotId)`),
      `editor branch for ${name} must pass only ridingSlotId`,
    );
  }
});

// Scoping guard: the EXCLUDED publish/unpublish writers are the SEPARATE future
// stage and remain untouched - they still take actor.instructorId. This proves
// RS-SEC-1I-CP-RD bound only the two readers and did not over-reach into the
// publication-writer stage. RidingComplexPlanEditorActor.instructorId is retained
// precisely because these two branches still consume it.
test("excluded publish/unpublish branches are untouched (still pass actor.instructorId)", () => {
  for (const excluded of [
    "publishComplexRidingPlanAsInstructor(actor.instructorId",
    "unpublishComplexRidingPlanAsInstructor(actor.instructorId",
  ]) {
    assert.ok(editorSrc.includes(excluded), `excluded branch must be unchanged: ${excluded}`);
  }
  // The editor actor type still carries instructorId for those writers.
  assert.ok(
    /type RidingComplexPlanEditorActor =[\s\S]*instructorId: string/.test(editorSrc),
    "RidingComplexPlanEditorActor.instructorId must remain for publish/unpublish",
  );
});

// RS-SEC-1I-CP-RD - the two reader ACTIONS route through the new read boundary and
// no longer re-read an Instructor by a client id (identity comes from the signed
// session). Complements the behavioral evidence in riding-slot-complex-read-auth.test.ts.
test("both reader actions are bound to the signed session via the read boundary", () => {
  const pubSrc = read("./riding-slot-complex-publications.ts");

  // Plan reader (riding-slot-complex.ts) - signature has no instructorId, routes
  // through the read boundary.
  const planSig = signature(complexSrc, "getRidingSlotComplexPlanForInstructor");
  assert.ok(!/instructorId/.test(planSig), `plan reader signature must not accept instructorId (got: ${planSig})`);
  const planBody = wrapperRegion(complexSrc, "getRidingSlotComplexPlanForInstructor");
  assert.ok(
    planBody.includes("loadComplexPlanForInstructorWithDeps"),
    "plan reader must delegate to loadComplexPlanForInstructorWithDeps",
  );
  assert.ok(planBody.includes("getCurrentInstructor"), "plan reader must resolve identity via getCurrentInstructor");
  assert.ok(
    !planBody.includes("prisma.instructor.findUnique("),
    "plan reader must not re-read Instructor by a client id",
  );

  // Status reader (riding-slot-complex-publications.ts) - same guarantees, using
  // the shared slicing helpers (they operate on any source string).
  const statusSig = signature(pubSrc, "getComplexRidingPlanPublicationStatusForInstructor");
  const statusBody = wrapperRegion(pubSrc, "getComplexRidingPlanPublicationStatusForInstructor");
  assert.ok(!/instructorId/.test(statusSig), `status reader signature must not accept instructorId (got: ${statusSig})`);
  assert.ok(
    statusBody.includes("loadComplexPublicationStatusForInstructorWithDeps"),
    "status reader must delegate to loadComplexPublicationStatusForInstructorWithDeps",
  );
  assert.ok(statusBody.includes("getCurrentInstructor"), "status reader must resolve identity via getCurrentInstructor");
  assert.ok(
    !statusBody.includes("prisma.instructor.findUnique("),
    "status reader must not re-read Instructor by a client id",
  );
});
