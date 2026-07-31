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
import type { ExamAssignmentRowView, ExamSelfMarker } from "./exam-schedule-view-core";

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

function render(
  assignments: readonly ExamAssignmentRowView[],
  marker: ExamSelfMarker,
): string {
  return renderToStaticMarkup(
    <ExamPersonalAssignmentDetail
      assignments={assignments}
      role={marker.role}
      startTime={marker.startTime}
      endTime={marker.endTime}
    />,
  );
}

// ===========================================================================
// 1. The viewer as an EXAMINEE — their horse, and the trainee they teach
// ===========================================================================

test("1. an examinee sees their own horse, topic, discipline and instructed trainee", () => {
  const html = render([examinee(), instructed()], {
    role: "EXAMINEE",
    startTime: "09:00",
    endTime: "09:20",
  });
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
  const html = render([examinee(), instructed()], {
    role: "INSTRUCTED_TRAINEE",
    startTime: "09:00",
    endTime: "09:20",
  });
  assert.ok(html.includes(TRAINEE_COUNTERPART_LABEL), "the counterpart label is missing");
  assert.ok(html.includes("דנה כהן"), "the examinee is missing");
  // It is the OTHER side of the same lesson, not the examinee's own heading.
  assert.equal(html.includes(EXAMINEE_COUNTERPART_LABEL), false, "the wrong side was labelled");
});

test("2b. an instructed trainee shows no horse, because their row carries none", () => {
  const html = render([examinee(), instructed()], {
    role: "INSTRUCTED_TRAINEE",
    startTime: "09:00",
    endTime: "09:20",
  });
  assert.equal(html.includes("סוס"), false, "an empty horse label was rendered");
  assert.equal(html.includes("רקיע"), false, "the examinee's horse leaked onto the trainee");
});

// ===========================================================================
// 3. Fail-closed: nothing is guessed
// ===========================================================================

test("3. two parallel examinees yield NOTHING rather than someone else's horse", () => {
  // The markers are role + window, which a parallel pair shares. A guess here
  // would tell a rider they are on a horse that is not theirs.
  const html = render(
    [
      examinee({ participantName: "דנה", horseName: "רקיע" }),
      examinee({ participantName: "רון", horseName: "סופה" }),
    ],
    { role: "EXAMINEE", startTime: "09:00", endTime: "09:20" },
  );
  assert.equal(html, "", "an ambiguous match was resolved by guessing");
});

test("3b. an absent marker renders nothing", () => {
  for (const marker of [
    { role: null, startTime: "09:00", endTime: "09:20" },
    { role: "EXAMINEE" as const, startTime: null, endTime: "09:20" },
    { role: "EXAMINEE" as const, startTime: "09:00", endTime: null },
  ]) {
    assert.equal(render([examinee()], marker), "");
  }
});

test("3c. no matching row renders nothing, and no nearest match is invented", () => {
  assert.equal(
    render([examinee({ personalStartTime: "09:00", personalEndTime: "09:20" })], {
      role: "EXAMINEE",
      startTime: "09:05",
      endTime: "09:20",
    }),
    "",
  );
  assert.equal(render([], { role: "EXAMINEE", startTime: "09:00", endTime: "09:20" }), "");
});

test("3d. a matched row with no detail at all renders nothing rather than empty labels", () => {
  const html = render(
    [
      examinee({
        horseName: null,
        instructionTopic: null,
        discipline: null,
        pairedParticipantNames: [],
      }),
    ],
    { role: "EXAMINEE", startTime: "09:00", endTime: "09:20" },
  );
  for (const label of ["סוס", "נושא", "תחום", EXAMINEE_COUNTERPART_LABEL]) {
    assert.equal(html.includes(label), false, `an empty ${label} label was rendered`);
  }
});

// ===========================================================================
// 4. It is COMPACT: only the viewer, never the whole block
// ===========================================================================

test("4. nobody else's row reaches the personal detail", () => {
  const html = render(
    [
      examinee({ participantName: "דנה", horseName: "רקיע" }),
      instructed({ participantName: "יעל" }),
      examinee({
        participantName: "רון",
        horseName: "סופה",
        personalStartTime: "10:00",
        personalEndTime: "10:20",
        pairedParticipantNames: ["נועה ברק"],
      }),
      instructed({
        participantName: "נועה ברק",
        personalStartTime: "10:00",
        personalEndTime: "10:20",
        pairedParticipantNames: ["רון"],
      }),
    ],
    { role: "EXAMINEE", startTime: "09:00", endTime: "09:20" },
  );
  assert.ok(html.includes("רקיע"), "the viewer's own horse is missing");
  for (const other of ["רון", "סופה", "נועה ברק"]) {
    assert.equal(html.includes(other), false, `${other} appeared in the PERSONAL view`);
  }
});

test("4b. it renders no time, no place, no role heading and no participant summary", () => {
  const html = render([examinee(), instructed()], {
    role: "EXAMINEE",
    startTime: "09:00",
    endTime: "09:20",
  });
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
  // The component takes NO name of the viewer: the props are the server-derived
  // markers and the block's rows, and nothing else.
  const props = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function ExamPersonalAssignmentDetail"),
  );
  assert.deepEqual(
    [...props.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    ["assignments", "endTime", "role", "startTime"],
  );
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
