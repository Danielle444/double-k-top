/**
 * EXAM X0 — executable tests for the PURE exam-domain core
 * (exam-domain-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-domain-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no Teaching-Practice access.
 *
 * SCOPE OF PROOF: valid kinds/phases; the participant XOR rule; instructed ≠
 * examinee; the interface/riding phase & link session-shape invariants; the
 * normalized beginner-session shape; one ExamPlan per CourseOffering; and
 * external-candidate soft-archive (non-mutating).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isExamKind,
  isExamPhase,
  isExamAssignmentRole,
  EXAM_KINDS,
  EXAM_PHASES,
  EXAM_DOMAIN_MESSAGES,
  resolveParticipant,
  participantKey,
  validateAssignmentParticipant,
  validateExamSessionShape,
  validateBeginnerSessionShape,
  validateExamPlanUniqueness,
  archiveExternalCandidate,
  type ParticipantRef,
  type ExamSessionShapeInput,
  type ExternalExamCandidate,
} from "./exam-domain-core";

// --- kind / phase guards ---------------------------------------------------

test("valid exam kinds are recognized; invalid values are rejected", () => {
  for (const kind of EXAM_KINDS) assert.equal(isExamKind(kind), true, kind);
  assert.deepEqual(
    [...EXAM_KINDS].sort(),
    ["ADVANCED_INSTRUCTION", "BEGINNER_INSTRUCTION", "INTERFACE_RIDING", "LUNGE_NO_RIDER"],
  );
  for (const bad of ["", "interface_riding", "RIDING", "PASS", null, undefined, 3, {}]) {
    assert.equal(isExamKind(bad), false, String(bad));
  }
});

test("valid exam phases are recognized; invalid values are rejected", () => {
  for (const phase of EXAM_PHASES) assert.equal(isExamPhase(phase), true, phase);
  for (const bad of ["", "interface", "LUNGE", null, undefined, 1]) {
    assert.equal(isExamPhase(bad), false, String(bad));
  }
});

test("assignment-role guard accepts the two roles only", () => {
  assert.equal(isExamAssignmentRole("EXAMINEE"), true);
  assert.equal(isExamAssignmentRole("INSTRUCTED_TRAINEE"), true);
  assert.equal(isExamAssignmentRole("SUPERVISOR"), false);
});

test("guards fail closed on inherited prototype keys", () => {
  for (const evil of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(isExamKind(evil), false, evil);
    assert.equal(isExamPhase(evil), false, evil);
    assert.equal(isExamAssignmentRole(evil), false, evil);
  }
});

// --- participant XOR -------------------------------------------------------

test("XOR: an internal-only assignment resolves to an INTERNAL participant", () => {
  const ref = resolveParticipant({ internalStudentId: "stu-1", externalCandidateId: null });
  assert.deepEqual(ref, { kind: "INTERNAL", studentId: "stu-1" });
  assert.equal(validateAssignmentParticipant({ internalStudentId: "stu-1" }).ok, true);
});

test("XOR: an external-only assignment resolves to an EXTERNAL participant", () => {
  const ref = resolveParticipant({ externalCandidateId: "ext-9" });
  assert.deepEqual(ref, { kind: "EXTERNAL", candidateId: "ext-9" });
  assert.equal(validateAssignmentParticipant({ externalCandidateId: "ext-9" }).ok, true);
});

test("XOR: neither present is invalid (EX-DOM-PARTICIPANT-NEITHER)", () => {
  assert.equal(resolveParticipant({ internalStudentId: null, externalCandidateId: null }), null);
  assert.equal(resolveParticipant({ internalStudentId: "   ", externalCandidateId: "" }), null);
  const r = validateAssignmentParticipant({});
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "EX-DOM-PARTICIPANT-NEITHER");
  assert.equal(r.issues[0].message, EXAM_DOMAIN_MESSAGES["EX-DOM-PARTICIPANT-NEITHER"]);
});

test("XOR: both present is invalid (EX-DOM-PARTICIPANT-BOTH)", () => {
  assert.equal(resolveParticipant({ internalStudentId: "s", externalCandidateId: "e" }), null);
  const r = validateAssignmentParticipant({ internalStudentId: "s", externalCandidateId: "e" });
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "EX-DOM-PARTICIPANT-BOTH");
});

test("participantKey is stable and collision-free across kinds", () => {
  const internal: ParticipantRef = { kind: "INTERNAL", studentId: "7" };
  const external: ParticipantRef = { kind: "EXTERNAL", candidateId: "7" };
  assert.equal(participantKey(internal), "INTERNAL:7");
  assert.equal(participantKey(external), "EXTERNAL:7");
  assert.notEqual(participantKey(internal), participantKey(external));
});

// NOTE: "the instructed trainee cannot equal the examinee" moved out of the
// domain core; it is now the single authoritative conflict code EX-BLK-03 and
// is proven in exam-conflict-core.test.ts.

// --- session shape: interface/riding phase & link invariants ---------------

function shape(over: Partial<ExamSessionShapeInput>): ExamSessionShapeInput {
  return {
    kind: "LUNGE_NO_RIDER",
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 0,
    ...over,
  };
}

test("INTERFACE_RIDING requires a phase (EX-DOM-PHASE-REQUIRED)", () => {
  const r = validateExamSessionShape(shape({ kind: "INTERFACE_RIDING", phase: null }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-PHASE-REQUIRED"));
});

test("a non-INTERFACE_RIDING kind forbids a phase (EX-DOM-PHASE-FORBIDDEN)", () => {
  const r = validateExamSessionShape(shape({ kind: "LUNGE_NO_RIDER", phase: "RIDING" }));
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-PHASE-FORBIDDEN"));
});

test("a valid INTERFACE phase session with no link passes", () => {
  const r = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "INTERFACE", interfaceSessionId: null }),
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("only a RIDING phase may carry an interface link (EX-DOM-LINK-FORBIDDEN)", () => {
  // INTERFACE phase carrying a link is forbidden.
  const iface = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "INTERFACE", interfaceSessionId: "if-1" }),
  );
  assert.ok(iface.issues.some((i) => i.code === "EX-DOM-LINK-FORBIDDEN"));

  // A non-interface-riding kind carrying a link is forbidden.
  const lunge = validateExamSessionShape(shape({ interfaceSessionId: "if-1" }));
  assert.ok(lunge.issues.some((i) => i.code === "EX-DOM-LINK-FORBIDDEN"));

  // RIDING phase WITH a link is allowed.
  const riding = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "RIDING", interfaceSessionId: "if-1" }),
  );
  assert.equal(riding.ok, true, JSON.stringify(riding.issues));
});

test("an invalid kind short-circuits to EX-DOM-INVALID-KIND", () => {
  const r = validateExamSessionShape(
    shape({ kind: "NOPE" as ExamSessionShapeInput["kind"] }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, "EX-DOM-INVALID-KIND");
});

test("an out-of-domain phase value is flagged EX-DOM-INVALID-PHASE", () => {
  const r = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "SIDEWAYS" as never }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-INVALID-PHASE"));
});

// --- beginner / native normalized-shape ------------------------------------

test("normalized beginner session (overlay-only, no embedded participants) is valid", () => {
  const r = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 0,
  });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("a beginner session embedding participants is invalid (derives from TP)", () => {
  const r = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-BEGINNER-HAS-PARTICIPANTS"));
});

test("a native session (e.g. ADVANCED_INSTRUCTION) may embed participants", () => {
  const r = validateExamSessionShape(
    shape({ kind: "ADVANCED_INSTRUCTION", embeddedAssignmentCount: 3 }),
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

// --- one ExamPlan per CourseOffering ---------------------------------------

test("a duplicate offering plan is rejected (EX-DOM-PLAN-DUPLICATE-OFFERING)", () => {
  const existing = [{ planId: "plan-a", courseOfferingId: "off-1" }];
  const r = validateExamPlanUniqueness({ planId: "plan-b", courseOfferingId: "off-1" }, existing);
  assert.equal(r.ok, false);
  assert.equal(r.issues[0].code, "EX-DOM-PLAN-DUPLICATE-OFFERING");
});

test("a plan for a fresh offering is allowed; re-validating the same plan is not a conflict", () => {
  const existing = [{ planId: "plan-a", courseOfferingId: "off-1" }];
  assert.equal(
    validateExamPlanUniqueness({ planId: "plan-b", courseOfferingId: "off-2" }, existing).ok,
    true,
  );
  // The plan already in the list does not conflict with itself.
  assert.equal(
    validateExamPlanUniqueness({ planId: "plan-a", courseOfferingId: "off-1" }, existing).ok,
    true,
  );
});

// --- external candidates: soft archive, no mutation, no Student -------------

test("archiving an external candidate is non-mutating and only flips `archived`", () => {
  const candidate: ExternalExamCandidate = {
    candidateId: "ext-1",
    displayName: "אורח",
    archived: false,
  };
  const archived = archiveExternalCandidate(candidate);
  assert.equal(archived.archived, true);
  assert.equal(archived.candidateId, "ext-1");
  assert.equal(archived.displayName, "אורח");
  // The source is untouched (soft-archive, no destructive mutation).
  assert.equal(candidate.archived, false);
  assert.notEqual(archived, candidate);
});

test("the external-candidate type carries no Student/login field", () => {
  const candidate: ExternalExamCandidate = {
    candidateId: "ext-1",
    displayName: "x",
    archived: false,
  };
  assert.equal(Object.prototype.hasOwnProperty.call(candidate, "studentId"), false);
  assert.deepEqual(Object.keys(candidate).sort(), ["archived", "candidateId", "displayName"]);
});
