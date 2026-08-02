/**
 * EX-ROLE-SCHEDULE-REDESIGN — tests for the viewer's OWN operational detail in
 * the compact personal exam view.
 *
 * REAL RENDER TESTS, following the committed precedent of
 * lib/components/ExamAssignmentRows.test.tsx: the component's only import is the
 * pure sibling view core, so it pulls in no Prisma, no next/*, no "use server"
 * module and no exam read-pipeline module, and renders with react-dom/server in
 * a plain `tsx --test` process.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamPersonalAssignmentDetail.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamPersonalAssignmentDetail } from "./ExamPersonalAssignmentDetail";
import type {
  ExamAssignmentRowView,
  TraineeExamAssignmentRowView,
} from "./exam-schedule-view-core";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamPersonalAssignmentDetail.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

const EXAMINEE_COUNTERPART_LABEL = "חניכים מודרכים";
const TRAINEE_COUNTERPART_LABEL = "נבחן/ת שמדריך/ה אותך";

function examinee(overrides: Partial<ExamAssignmentRowView> = {}): ExamAssignmentRowView {
  return {
    participantName: "דנה כהן",
    role: "EXAMINEE",
    horseName: "רקיע",
    instructionTopic: "עבודה על מעגל",
    discipline: "אילוף",
    personalStartTime: "09:00",
    personalEndTime: "09:20",
    pairedParticipantNames: ["יעל לוי"],
    ...overrides,
  };
}

function instructed(overrides: Partial<ExamAssignmentRowView> = {}): ExamAssignmentRowView {
  return {
    participantName: "יעל לוי",
    role: "INSTRUCTED_TRAINEE",
    horseName: null,
    instructionTopic: "עבודה על מעגל",
    discipline: "אילוף",
    personalStartTime: "09:00",
    personalEndTime: "09:20",
    pairedParticipantNames: ["דנה כהן"],
    ...overrides,
  };
}

/**
 * The same row as the TRAINEE contract carries it: with the SERVER's own answer
 * attached. `isSelf` is the only thing that ever decides which row is the
 * viewer's, so every fixture states it explicitly.
 */
function self(
  row: ExamAssignmentRowView,
  isSelf: boolean,
): TraineeExamAssignmentRowView {
  return { ...row, isSelf };
}

function render(assignments: readonly TraineeExamAssignmentRowView[]): string {
  return renderToStaticMarkup(<ExamPersonalAssignmentDetail assignments={assignments} />);
}

// ===========================================================================
// 1. The viewer as an EXAMINEE — their horse, and the trainee they teach
// ===========================================================================

test("1. an examinee sees their own horse, topic, discipline and instructed trainee", () => {
  const html = render([self(examinee(), true), self(instructed(), false)]);
  assert.ok(html.includes("סוס") && html.includes("רקיע"), "the horse is missing");
  assert.ok(html.includes("נושא") && html.includes("עבודה על מעגל"), "the topic is missing");
  assert.ok(html.includes("תחום") && html.includes("אילוף"), "the discipline is missing");
  assert.ok(html.includes(EXAMINEE_COUNTERPART_LABEL), "the counterpart label is missing");
  assert.ok(html.includes("יעל לוי"), "the instructed trainee is missing");
});

// ===========================================================================
// 2. The viewer as an INSTRUCTED TRAINEE — the examinee teaching them
// ===========================================================================

test("2. an instructed trainee sees the examinee teaching them, with the right wording", () => {
  const html = render([self(examinee(), false), self(instructed(), true)]);
  assert.ok(html.includes(TRAINEE_COUNTERPART_LABEL), "the counterpart label is missing");
  assert.ok(html.includes("דנה כהן"), "the examinee is missing");
  // It is the OTHER side of the same lesson, not the examinee's own heading.
  assert.equal(html.includes(EXAMINEE_COUNTERPART_LABEL), false, "the wrong side was labelled");
});

test("2b. an instructed trainee shows no horse, because their row carries none", () => {
  const html = render([self(examinee(), false), self(instructed(), true)]);
  assert.equal(html.includes("סוס"), false, "an empty horse label was rendered");
  assert.equal(html.includes("רקיע"), false, "the examinee's horse leaked onto the trainee");
});

// ===========================================================================
// 3. TWO PARALLEL EXAMINEES — the case the old heuristic could not answer
// ===========================================================================

test("3. two parallel examinees: the VIEWER's own horse, topic and discipline are shown", () => {
  // Identical role and identical exact personal window on both rows. The removed
  // `selfRole` + personal-time heuristic gave up here and rendered nothing; the
  // server's `isSelf` names the right row, so the detail is now shown correctly.
  const html = render([
    self(
      examinee({
        participantName: "דנה",
        horseName: "רקיע",
        instructionTopic: "עבודה על מעגל",
        discipline: "אילוף",
        pairedParticipantNames: ["יעל לוי"],
      }),
      false,
    ),
    self(
      examinee({
        participantName: "רון",
        horseName: "סופה",
        instructionTopic: "קפיצה",
        discipline: "ראווה",
        pairedParticipantNames: ["נועה ברק"],
      }),
      true,
    ),
  ]);
  assert.ok(html.includes("סופה"), "the viewer's own horse is missing");
  assert.ok(html.includes("קפיצה") && html.includes("ראווה"), "the viewer's own lesson is missing");
  // ...and NOTHING of the parallel rider's.
  assert.equal(html.includes("רקיע"), false, "the other rider's horse was shown");
  assert.equal(html.includes("אילוף"), false, "the other rider's discipline was shown");
});

test("3b. two parallel examinees: the correct COUNTERPART is shown", () => {
  const html = render([
    self(examinee({ participantName: "דנה", pairedParticipantNames: ["יעל לוי"] }), false),
    self(examinee({ participantName: "רון", pairedParticipantNames: ["נועה ברק"] }), true),
  ]);
  assert.ok(html.includes(EXAMINEE_COUNTERPART_LABEL), "the counterpart label is missing");
  assert.ok(html.includes("נועה ברק"), "the viewer's own instructed trainee is missing");
  assert.equal(html.includes("יעל לוי"), false, "the other examinee's trainee was shown");
});

// ===========================================================================
// 3c-3e. Fail-closed at both ends
// ===========================================================================

test("3c. ZERO rows marked isSelf renders nothing", () => {
  const html = render([
    self(examinee({ participantName: "דנה", horseName: "רקיע" }), false),
    self(instructed({ participantName: "יעל" }), false),
  ]);
  assert.equal(html, "", "a detail was rendered for a viewer the server did not name");
  assert.equal(render([]), "", "an empty block produced markup");
});

test("3d. MORE THAN ONE row marked isSelf renders a detail block for EACH one — none dropped", () => {
  // EX-ASG-MULTIPLICITY: a trainee legitimately holds several assignments in one
  // block. Both must render; neither is picked arbitrarily over the other.
  const html = render([
    self(examinee({ participantName: "דנה", horseName: "רקיע", discipline: "אילוף" }), true),
    self(
      instructed({ participantName: "רון", instructionTopic: "קפיצה", discipline: "ראווה" }),
      true,
    ),
  ]);
  assert.ok(html.includes("רקיע"), "the EXAMINEE slot's horse is missing");
  assert.ok(html.includes("ראווה"), "the INSTRUCTED_TRAINEE slot's discipline is missing");
  assert.ok(html.includes(EXAMINEE_COUNTERPART_LABEL), "the EXAMINEE slot's counterpart label is missing");
  assert.ok(html.includes(TRAINEE_COUNTERPART_LABEL), "the INSTRUCTED_TRAINEE slot's counterpart label is missing");
});

test("3e. a marked row with no detail at all renders nothing rather than empty labels", () => {
  const html = render([
    self(
      examinee({
        horseName: null,
        instructionTopic: null,
        discipline: null,
        pairedParticipantNames: [],
      }),
      true,
    ),
  ]);
  for (const label of ["סוס", "נושא", "תחום", EXAMINEE_COUNTERPART_LABEL]) {
    assert.equal(html.includes(label), false, `an empty ${label} label was rendered`);
  }
});

// ===========================================================================
// 4. It is COMPACT: only the viewer, never the whole block
// ===========================================================================

test("4. nobody else's row reaches the personal detail", () => {
  const html = render([
    self(examinee({ participantName: "דנה", horseName: "רקיע" }), true),
    self(instructed({ participantName: "יעל" }), false),
    self(
      examinee({
        participantName: "רון",
        horseName: "סופה",
        personalStartTime: "10:00",
        personalEndTime: "10:20",
        pairedParticipantNames: ["נועה ברק"],
      }),
      false,
    ),
    self(
      instructed({
        participantName: "נועה ברק",
        personalStartTime: "10:00",
        personalEndTime: "10:20",
        pairedParticipantNames: ["רון"],
      }),
      false,
    ),
  ]);
  assert.ok(html.includes("רקיע"), "the viewer's own horse is missing");
  for (const other of ["רון", "סופה", "נועה ברק"]) {
    assert.equal(html.includes(other), false, `${other} appeared in the PERSONAL view`);
  }
});

test("4b. it renders no time, no place, no role heading and no participant summary", () => {
  const html = render([self(examinee(), true), self(instructed(), false)]);
  assert.equal(/\d{2}:\d{2}/.test(html), false, "the compact detail repeats a time");
  for (const token of ["מקום", "נבחן/ת", "חניך/ה מודרך/ת", "שעה אישית"]) {
    assert.equal(html.includes(token), false, `the compact detail repeats ${token}`);
  }
});

// ===========================================================================
// 5. Identity, privacy and read-only construction
// ===========================================================================

test("5. identity is never inferred from a display name", () => {
  for (const token of [
    "participantName ===",
    "participantName ==",
    ".includes(row.participantName",
    "localeCompare",
    "viewerName",
    "myName",
    "selfName",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `identity is matched by ${token}`);
  }
  // The component takes NO viewer identity at all. `assignments` is the ONLY
  // prop: the rows already carry the server's answer, so there is nothing left
  // for a caller to select with — and no marker, name or id it could pass.
  const props = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function ExamPersonalAssignmentDetail"),
  );
  assert.deepEqual(
    [...props.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    ["assignments"],
  );
});

test("5a. the REMOVED heuristic is absent: no role or time selection remains", () => {
  // The old logic matched the viewer by `selfRole` + `personalStartTime` +
  // `personalEndTime`. None of those may be named here any more, in any form.
  for (const token of [
    "selectSelfAssignmentDetail",
    "ExamSelfMarker",
    "selfRole",
    "selfStartTime",
    "selfEndTime",
    "personalStartTime",
    "personalEndTime",
    "startTime",
    "endTime",
    "marker",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the removed heuristic survives: ${token}`);
  }
  // Selection is ONE call into the pure core, and the component performs no
  // filtering, finding or indexing of its own.
  assert.ok(
    SOURCE_CODE.includes("selectSelfAssignmentRows(assignments)"),
    "the component does not delegate selection to the pure core",
  );
  for (const token of ["assignments.filter", "assignments.find", "assignments[", "isSelf ==="]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the component selects by ${token}`);
  }
});

test("5b. no internal id, contact detail or grade is named", () => {
  for (const token of [
    "assignmentId",
    "studentId",
    "sessionId",
    "definitionId",
    "lessonId",
    "planId",
    "courseOfferingId",
    "viewerStudentId",
    "pairingIndex",
    "nationalId",
    "parentName",
    "parentPhone",
    "phone",
    "email",
    "childNotes",
    "grade",
    "rating",
    "feedback",
    "JSON.stringify",
    "Object.entries",
    "Object.keys",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the component names ${token}`);
  }
  assert.equal(/\{\.\.\./.test(SOURCE_CODE), false, "the component spreads an object into markup");
});

test("5c. it imports ONLY the pure sibling core and is read-only by construction", () => {
  const specifiers = [...SOURCE_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(specifiers)], ["./exam-schedule-view-core"]);
  for (const token of [
    "useState",
    "useEffect",
    "useTransition",
    "useActionState",
    "onClick",
    "onChange",
    "onSubmit",
    "<form",
    "<input",
    "<button",
    "<select",
    "<textarea",
    "FormData",
    "use server",
    "isPublished",
    "publishedAt",
    "prisma",
    "exam-read-dto",
    "exam-role-readers",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the component adds ${token}`);
  }
});

test("5d. the approved Hebrew labels are present, verbatim", () => {
  for (const label of [
    `EXAMINEE: "${EXAMINEE_COUNTERPART_LABEL}"`,
    `INSTRUCTED_TRAINEE: "${TRAINEE_COUNTERPART_LABEL}"`,
    'const HORSE_LABEL = "סוס"',
    'const TOPIC_LABEL = "נושא"',
    'const DISCIPLINE_LABEL = "תחום"',
  ]) {
    assert.ok(SOURCE.includes(label), `the approved label is missing or reworded: ${label}`);
  }
});

test("5e. the layout wraps and cannot overflow sideways on a phone", () => {
  for (const token of ["<table", "<thead", "<tbody", "<tr", "<td", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the detail row does not wrap");
});
