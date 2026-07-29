/**
 * EXAM X0 — executable tests for the PURE exam-domain core
 * (exam-domain-core.ts).
 *
 * Run with: npx tsx --test lib/exam/exam-domain-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env,
 * no Teaching-Practice access.
 *
 * SCOPE OF PROOF: valid kinds; the participant XOR rule; instructed ≠
 * examinee; the EX-S3.5 RETIREMENT of the phase & interface-link model; the
 * normalized beginner-session shape; one ExamPlan per CourseOffering; and
 * external-candidate soft-archive (non-mutating).
 */
import test from "node:test";
import assert from "node:assert/strict";

import * as domain from "./exam-domain-core";
import {
  isExamKind,
  isExamAssignmentRole,
  isExamBeginnerFormat,
  EXAM_KINDS,
  EXAM_BEGINNER_FORMATS,
  EXAM_DOMAIN_MESSAGES,
  RESERVED_EXAM_DOMAIN_ISSUE_CODES,
  resolveParticipant,
  participantKey,
  validateAssignmentParticipant,
  validateExamSessionShape,
  validateBeginnerSessionShape,
  validateExamPlanUniqueness,
  archiveExternalCandidate,
  STORED_EXAM_KINDS,
  isStorableExamKind,
  validateStoredExamSession,
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

test("EX-S3.5: the phase enum surface is GONE from the domain core", () => {
  // No ExamPhase union, no EXAM_PHASES list, no isExamPhase guard: a "valid"
  // phase is no longer a question the active domain asks.
  for (const gone of ["EXAM_PHASES", "isExamPhase", "ExamPhase"]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(domain, gone),
      false,
      `${gone} must not be exported any more`,
    );
  }
  for (const name of Object.keys(domain)) {
    assert.ok(!/PHASE|Phase/.test(name), `a phase export survived: ${name}`);
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

// --- session shape: the EX-S3.5 retired phase & link fields ----------------

function shape(over: Partial<ExamSessionShapeInput>): ExamSessionShapeInput {
  return {
    kind: "LUNGE_NO_RIDER",
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 0,
    ...over,
  };
}

test("EX-S3.5: INTERFACE_RIDING with NO phase and NO link is valid", () => {
  const withNulls = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: null, interfaceSessionId: null }),
  );
  assert.equal(withNulls.ok, true, JSON.stringify(withNulls.issues));

  // Omitting the deprecated fields entirely is the same thing.
  const omitted = validateExamSessionShape({
    kind: "INTERFACE_RIDING",
    embeddedAssignmentCount: 1,
    examineeCount: 1,
  });
  assert.equal(omitted.ok, true, JSON.stringify(omitted.issues));
});

test("EX-S3.5: NO kind requires a phase — EX-DOM-PHASE-REQUIRED is never emitted", () => {
  for (const kind of EXAM_KINDS) {
    const r = validateExamSessionShape(
      shape({
        kind,
        phase: null,
        // Keep every unrelated beginner rule satisfied so only phase is in play.
        embeddedAssignmentCount: 1,
        beginnerFormat: kind === "BEGINNER_INSTRUCTION" ? "LUNGE" : null,
      }),
    );
    assert.equal(
      r.issues.some((i) => i.code === "EX-DOM-PHASE-REQUIRED"),
      false,
      `${kind} still demands a phase`,
    );
  }
});

test("EX-S3.5: ANY present phase is rejected as deprecated, on EVERY kind", () => {
  // The two retired tokens and arbitrary junk are all treated identically:
  // there is no "valid" phase left to distinguish, so nothing is EX-DOM-INVALID-PHASE.
  for (const kind of EXAM_KINDS) {
    for (const phase of ["INTERFACE", "RIDING", "SIDEWAYS", ""]) {
      const r = validateExamSessionShape(
        shape({
          kind,
          phase,
          embeddedAssignmentCount: 1,
          beginnerFormat: kind === "BEGINNER_INSTRUCTION" ? "LUNGE" : null,
        }),
      );
      assert.equal(r.ok, false, `${kind}/${phase} was accepted`);
      assert.ok(
        r.issues.some((i) => i.code === "EX-DOM-PHASE-FORBIDDEN"),
        `${kind}/${phase} did not report EX-DOM-PHASE-FORBIDDEN`,
      );
      assert.equal(
        r.issues.some((i) => i.code === "EX-DOM-INVALID-PHASE"),
        false,
        `${kind}/${phase} re-emitted the retired EX-DOM-INVALID-PHASE`,
      );
    }
  }
});

test("EX-S3.5: ANY present interfaceSessionId is rejected — no RIDING exception", () => {
  for (const kind of EXAM_KINDS) {
    const r = validateExamSessionShape(
      shape({
        kind,
        interfaceSessionId: "other-session",
        embeddedAssignmentCount: 1,
        beginnerFormat: kind === "BEGINNER_INSTRUCTION" ? "LUNGE" : null,
      }),
    );
    assert.equal(r.ok, false, `${kind} accepted a link`);
    assert.ok(r.issues.some((i) => i.code === "EX-DOM-LINK-FORBIDDEN"), kind);
  }

  // The formerly-blessed combination — INTERFACE_RIDING in the RIDING phase
  // carrying a link to its interface partner — is now doubly rejected.
  const retiredPair = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "RIDING", interfaceSessionId: "if-1" }),
  );
  assert.equal(retiredPair.ok, false);
  assert.deepEqual(
    retiredPair.issues.map((i) => i.code).sort(),
    ["EX-DOM-LINK-FORBIDDEN", "EX-DOM-PHASE-FORBIDDEN"],
  );
});

test("EX-S3.5: there is no special RIDING-vs-INTERFACE case left anywhere", () => {
  // Whatever the phase token, the outcome is byte-identical: the value is not
  // inspected, only its presence.
  const asInterface = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "INTERFACE", embeddedAssignmentCount: 1 }),
  );
  const asRiding = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "RIDING", embeddedAssignmentCount: 1 }),
  );
  const asJunk = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", phase: "whatever", embeddedAssignmentCount: 1 }),
  );
  assert.deepEqual(asInterface, asRiding);
  assert.deepEqual(asInterface, asJunk);
});

test("the retired issue codes are RESERVED and emitted by nothing", () => {
  assert.deepEqual(
    [...RESERVED_EXAM_DOMAIN_ISSUE_CODES].sort(),
    ["EX-DOM-INVALID-PHASE", "EX-DOM-PHASE-REQUIRED"],
  );
  assert.equal(Object.isFrozen(RESERVED_EXAM_DOMAIN_ISSUE_CODES), true);

  // The strings survive in the stable contract...
  for (const code of RESERVED_EXAM_DOMAIN_ISSUE_CODES) {
    assert.ok(code in EXAM_DOMAIN_MESSAGES, `${code} lost its reserved slot`);
  }

  // ...but a broad matrix of shapes never produces either of them.
  const phases = [null, undefined, "INTERFACE", "RIDING", "SIDEWAYS", ""];
  const links = [null, undefined, "if-1", ""];
  for (const kind of EXAM_KINDS) {
    for (const phase of phases) {
      for (const interfaceSessionId of links) {
        const r = validateExamSessionShape(
          shape({ kind, phase, interfaceSessionId, embeddedAssignmentCount: 1 }),
        );
        for (const retired of RESERVED_EXAM_DOMAIN_ISSUE_CODES) {
          assert.equal(
            r.issues.some((i) => i.code === retired),
            false,
            `${kind}/${String(phase)}/${String(interfaceSessionId)} re-emitted ${retired}`,
          );
        }
      }
    }
  }
});

test("an invalid kind short-circuits to EX-DOM-INVALID-KIND", () => {
  const r = validateExamSessionShape(
    shape({ kind: "NOPE" as ExamSessionShapeInput["kind"] }),
  );
  assert.equal(r.ok, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].code, "EX-DOM-INVALID-KIND");
});

// --- beginner / native normalized-shape ------------------------------------

// EX-C1 INVERSION: snapshot/copy semantics replaced reference/derive. A copied
// beginner session MUST embed its copied participants and MUST carry a format.
test("a copied beginner session with format + embedded participants is valid", () => {
  const r = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 3,
    beginnerFormat: "BEGINNER_GROUP",
    copyProvenancePresent: true,
    beginnerChildCount: 2,
    examineeCount: 3,
  });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("a beginner session embedding NO participants is invalid (EX-C1 inversion)", () => {
  const r = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 0,
    beginnerFormat: "LUNGE",
  });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-BEGINNER-HAS-PARTICIPANTS"));
});

test("a beginner session without a format is invalid (EX-DOM-FORMAT-REQUIRED)", () => {
  const missing = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
  });
  assert.ok(missing.issues.some((i) => i.code === "EX-DOM-FORMAT-REQUIRED"));

  // An out-of-domain format value fails closed the same way.
  const invalid = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
    beginnerFormat: "SOMETHING" as never,
  });
  assert.ok(invalid.issues.some((i) => i.code === "EX-DOM-FORMAT-REQUIRED"));
});

test("a non-beginner kind may not carry a format (EX-DOM-FORMAT-FORBIDDEN)", () => {
  const r = validateExamSessionShape(
    shape({ kind: "LUNGE_NO_RIDER", beginnerFormat: "LUNGE" }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-FORMAT-FORBIDDEN"));
});

test("copy provenance is beginner-only (EX-DOM-COPY-SOURCE-FORBIDDEN)", () => {
  const r = validateExamSessionShape(
    shape({ kind: "ADVANCED_INSTRUCTION", copyProvenancePresent: true }),
  );
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-COPY-SOURCE-FORBIDDEN"));

  // The same provenance on a beginner session is fine.
  const beginner = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 1,
    beginnerFormat: "LUNGE",
    copyProvenancePresent: true,
  });
  assert.equal(beginner.ok, true, JSON.stringify(beginner.issues));
});

test("embedded children are beginner-only (EX-DOM-CHILDREN-FORBIDDEN)", () => {
  const r = validateExamSessionShape(
    shape({ kind: "INTERFACE_RIDING", beginnerChildCount: 1 }),
  );
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-CHILDREN-FORBIDDEN"));
});

test("instructed trainees are advanced-instruction-only (EX-DOM-INSTRUCTED-FORBIDDEN)", () => {
  const lunge = validateExamSessionShape(
    shape({ kind: "LUNGE_NO_RIDER", embeddedAssignmentCount: 2, instructedTraineeCount: 1 }),
  );
  assert.ok(lunge.issues.some((i) => i.code === "EX-DOM-INSTRUCTED-FORBIDDEN"));

  // A copied beginner session never carries an instructed trainee either.
  const beginner = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
    beginnerFormat: "BEGINNER_GROUP",
    instructedTraineeCount: 1,
  });
  assert.ok(beginner.issues.some((i) => i.code === "EX-DOM-INSTRUCTED-FORBIDDEN"));
});

test("instruction topics are advanced-instruction-only (EX-DOM-TOPIC-FORBIDDEN)", () => {
  const r = validateExamSessionShape(
    shape({ kind: "LUNGE_NO_RIDER", embeddedAssignmentCount: 1, instructionTopicCount: 1 }),
  );
  assert.ok(r.issues.some((i) => i.code === "EX-DOM-TOPIC-FORBIDDEN"));
});

test("EX-DOM-PAIRING-REQUIRED fires only for >1 examinee on an instruction exam", () => {
  // One examinee: no pairing needed.
  const single = validateExamSessionShape(
    shape({ kind: "ADVANCED_INSTRUCTION", embeddedAssignmentCount: 2, examineeCount: 1 }),
  );
  assert.equal(single.ok, true, JSON.stringify(single.issues));

  // Two examinees with nothing paired: required.
  const unpaired = validateExamSessionShape(
    shape({ kind: "ADVANCED_INSTRUCTION", embeddedAssignmentCount: 4, examineeCount: 2 }),
  );
  assert.ok(unpaired.issues.some((i) => i.code === "EX-DOM-PAIRING-REQUIRED"));

  // Two examinees with every assignment paired: fine.
  const paired = validateExamSessionShape(
    shape({
      kind: "ADVANCED_INSTRUCTION",
      embeddedAssignmentCount: 4,
      examineeCount: 2,
      pairedAssignmentCount: 4,
    }),
  );
  assert.equal(paired.ok, true, JSON.stringify(paired.issues));
});

test("pairing is NOT required on a copied beginner session with many examinees", () => {
  // A real copied BEGINNER_GROUP lesson holds 3 examinees and no pairingIndex.
  const r = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 3,
    beginnerFormat: "BEGINNER_GROUP",
    examineeCount: 3,
  });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("a native session (e.g. ADVANCED_INSTRUCTION) may embed participants", () => {
  const r = validateExamSessionShape(
    shape({ kind: "ADVANCED_INSTRUCTION", embeddedAssignmentCount: 3 }),
  );
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("every EX-DOM issue code carries a Hebrew message", () => {
  const codes = Object.keys(EXAM_DOMAIN_MESSAGES);
  assert.ok(codes.length >= 16, `expected the amended code set, got ${codes.length}`);
  for (const code of codes) {
    const message = EXAM_DOMAIN_MESSAGES[code as keyof typeof EXAM_DOMAIN_MESSAGES];
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0, `${code} has an empty message`);
    // Hebrew letters only - never a raw English code leaking into the UI.
    assert.ok(/[֐-׿]/.test(message), `${code} is not Hebrew`);
  }
});

test("beginner formats are guarded and fail closed on proto keys", () => {
  assert.deepEqual([...EXAM_BEGINNER_FORMATS].sort(), [
    "BEGINNER_GROUP",
    "BEGINNER_PRIVATE",
    "LUNGE",
  ]);
  for (const f of EXAM_BEGINNER_FORMATS) assert.equal(isExamBeginnerFormat(f), true);
  assert.equal(isExamBeginnerFormat("__proto__"), false);
  assert.equal(isExamBeginnerFormat("toString"), false);
  assert.equal(isExamBeginnerFormat("THEORY"), false);
  assert.equal(isExamBeginnerFormat(null), false);
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

// ===========================================================================
// EX-C2-0 — a STORED BEGINNER_INSTRUCTION session is forbidden
// ===========================================================================

test("STORED_EXAM_KINDS is exactly the three non-beginner kinds", () => {
  assert.deepEqual(
    [...STORED_EXAM_KINDS].sort(),
    ["ADVANCED_INSTRUCTION", "INTERFACE_RIDING", "LUNGE_NO_RIDER"],
  );
  assert.equal(STORED_EXAM_KINDS.includes("BEGINNER_INSTRUCTION"), false);
  assert.equal(Object.isFrozen(STORED_EXAM_KINDS), true);
});

test("isStorableExamKind accepts the three stored kinds and rejects beginner", () => {
  for (const kind of STORED_EXAM_KINDS) assert.equal(isStorableExamKind(kind), true, kind);
  assert.equal(isStorableExamKind("BEGINNER_INSTRUCTION"), false);
});

test("isStorableExamKind fails closed on junk, non-strings and proto keys", () => {
  for (const value of [null, undefined, 0, true, {}, [], "", "nope", "interface_riding"]) {
    assert.equal(isStorableExamKind(value), false);
  }
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    assert.equal(isStorableExamKind(key), false, `inherited key ${key}`);
  }
});

test("validateStoredExamSession rejects BEGINNER_INSTRUCTION with the exact code", () => {
  const result = validateStoredExamSession({
    kind: "BEGINNER_INSTRUCTION",
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 3,
    beginnerFormat: "LUNGE",
    beginnerChildCount: 2,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.issues.map((i) => i.code),
    ["EX-DOM-BEGINNER-SESSION-FORBIDDEN"],
    "the forbidden-kind issue is reported alone, not buried among shape issues",
  );
  assert.equal(
    result.issues[0].message,
    "בחינת מדריך מתחילים נקראת ישירות מהתנסויות מתחילים ואינה נשמרת כמפגש בחינה",
  );
});

test("validateStoredExamSession rejects a beginner session that WOULD have been valid before", () => {
  // Exactly the shape EX-C1's copy design produced and accepted.
  const shape: ExamSessionShapeInput = {
    kind: "BEGINNER_INSTRUCTION",
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
    beginnerFormat: "BEGINNER_GROUP",
    copyProvenancePresent: true,
    beginnerChildCount: 3,
    examineeCount: 2,
  };
  assert.equal(validateExamSessionShape(shape).ok, true, "the old shape rule still passes it");
  assert.equal(validateStoredExamSession(shape).ok, false, "but it may no longer be stored");
});

test("validateStoredExamSession accepts each of the three stored kinds", () => {
  assert.equal(
    validateStoredExamSession({
      // EX-S3.5: a stored INTERFACE_RIDING block carries NO phase. The two
      // exams are told apart by their ExamDefinition, not by a phase column.
      kind: "INTERFACE_RIDING",
      phase: null,
      interfaceSessionId: null,
      embeddedAssignmentCount: 1,
      examineeCount: 1,
    }).ok,
    true,
  );
  assert.equal(
    validateStoredExamSession({
      kind: "LUNGE_NO_RIDER",
      phase: null,
      interfaceSessionId: null,
      embeddedAssignmentCount: 1,
      examineeCount: 1,
    }).ok,
    true,
  );
  assert.equal(
    validateStoredExamSession({
      kind: "ADVANCED_INSTRUCTION",
      phase: null,
      interfaceSessionId: null,
      embeddedAssignmentCount: 2,
      examineeCount: 1,
      instructedTraineeCount: 1,
      instructionTopicCount: 1,
    }).ok,
    true,
  );
});

test("validateStoredExamSession delegates unchanged to validateExamSessionShape", () => {
  // A LUNGE_NO_RIDER carrying a phase is invalid; the delegated result must be
  // byte-identical to calling the shape validator directly.
  const shape: ExamSessionShapeInput = {
    kind: "LUNGE_NO_RIDER",
    phase: "RIDING",
    interfaceSessionId: "other-session",
    embeddedAssignmentCount: 1,
  };
  assert.deepEqual(validateStoredExamSession(shape), validateExamSessionShape(shape));
});

test("the pre-existing beginner validators are NOT weakened", () => {
  // EX-DOM-BEGINNER-HAS-PARTICIPANTS still fires on an empty beginner session.
  const empty = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 0,
    beginnerFormat: "LUNGE",
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.issues.some((i) => i.code === "EX-DOM-BEGINNER-HAS-PARTICIPANTS"), true);

  // EX-DOM-FORMAT-REQUIRED still fires when the format is missing.
  const noFormat = validateBeginnerSessionShape({
    phase: null,
    interfaceSessionId: null,
    embeddedAssignmentCount: 2,
  });
  assert.equal(noFormat.issues.some((i) => i.code === "EX-DOM-FORMAT-REQUIRED"), true);
});

test("every issue code still carries a non-empty Hebrew message", () => {
  const codes = Object.keys(EXAM_DOMAIN_MESSAGES);
  assert.equal(codes.includes("EX-DOM-BEGINNER-SESSION-FORBIDDEN"), true);
  for (const code of codes) {
    const message = EXAM_DOMAIN_MESSAGES[code as keyof typeof EXAM_DOMAIN_MESSAGES];
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0, `${code} has an empty message`);
  }
  assert.equal(Object.isFrozen(EXAM_DOMAIN_MESSAGES), true);
});
