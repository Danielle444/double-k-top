/**
 * EX-TRN-MULTI-SLOT-DETAIL — tests for the viewer's OWN operational detail in
 * the compact personal exam view: ONE NESTED CARD per personal assignment.
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
  TraineeExamPersonalSlotView,
} from "./exam-schedule-view-core";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamPersonalAssignmentDetail.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

const EXAMINEE_ROLE_TITLE = "נבחן/ת";
const INSTRUCTED_TRAINEE_ROLE_TITLE = "חניך/ה מודרך/ת";
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
 * The same row as the TRAINEE contract carries it: with the SERVER's own
 * answer and correlation token attached. `isSelf` and `assignmentKey` are the
 * only things that ever decide which row is which assignment's, so every
 * fixture states them explicitly.
 */
function self(
  row: ExamAssignmentRowView,
  isSelf: boolean,
  assignmentKey: string | null,
): TraineeExamAssignmentRowView {
  return { ...row, isSelf, assignmentKey };
}

/** ONE personal slot, as the trainee DTO carries it. */
function slot(overrides: Partial<TraineeExamPersonalSlotView> = {}): TraineeExamPersonalSlotView {
  return {
    assignmentKey: "k1",
    role: "EXAMINEE",
    startTime: "09:00",
    endTime: "09:20",
    ...overrides,
  };
}

function render(
  personalSlots: readonly TraineeExamPersonalSlotView[],
  assignments: readonly TraineeExamAssignmentRowView[],
): string {
  return renderToStaticMarkup(
    <ExamPersonalAssignmentDetail personalSlots={personalSlots} assignments={assignments} />,
  );
}

// ===========================================================================
// 1. The viewer as an EXAMINEE — their horse, and the trainee they teach
// ===========================================================================

test("1. an examinee sees their own horse, topic, discipline and instructed trainee", () => {
  const html = render(
    [slot({ assignmentKey: "k1", role: "EXAMINEE" })],
    [self(examinee(), true, "k1"), self(instructed(), false, null)],
  );
  assert.ok(html.includes(EXAMINEE_ROLE_TITLE), "the role title is missing");
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
  const html = render(
    [slot({ assignmentKey: "k1", role: "INSTRUCTED_TRAINEE" })],
    [self(examinee(), false, null), self(instructed(), true, "k1")],
  );
  assert.ok(html.includes(INSTRUCTED_TRAINEE_ROLE_TITLE), "the role title is missing");
  assert.ok(html.includes(TRAINEE_COUNTERPART_LABEL), "the counterpart label is missing");
  assert.ok(html.includes("דנה כהן"), "the examinee is missing");
  // It is the OTHER side of the same lesson, not the examinee's own heading.
  assert.equal(html.includes(EXAMINEE_COUNTERPART_LABEL), false, "the wrong side was labelled");
});

test("2b. an instructed trainee shows no horse, because their row carries none", () => {
  const html = render(
    [slot({ assignmentKey: "k1", role: "INSTRUCTED_TRAINEE" })],
    [self(examinee(), false, null), self(instructed(), true, "k1")],
  );
  assert.equal(html.includes("סוס"), false, "an empty horse label was rendered");
  assert.equal(html.includes("רקיע"), false, "the examinee's horse leaked onto the trainee");
});

// ===========================================================================
// 3. MULTIPLE PERSONAL ASSIGNMENTS — one nested card each, never merged
// ===========================================================================

test("3. a trainee with THREE personal assignments receives THREE nested cards", () => {
  // The exact reported production shape: 1 EXAMINEE slot + 2 INSTRUCTED_TRAINEE
  // slots in one session.
  const html = render(
    [
      slot({ assignmentKey: "kA", role: "EXAMINEE", startTime: "08:00", endTime: "08:15" }),
      slot({ assignmentKey: "kB", role: "INSTRUCTED_TRAINEE", startTime: "08:15", endTime: "08:30" }),
      slot({ assignmentKey: "kC", role: "INSTRUCTED_TRAINEE", startTime: "08:30", endTime: "08:45" }),
    ],
    [
      self(
        examinee({ horseName: "סוסה-A", instructionTopic: "topic-A", discipline: "disc-A" }),
        true,
        "kA",
      ),
      self(
        instructed({ instructionTopic: "topic-B", discipline: "disc-B", pairedParticipantNames: ["examinee-B"] }),
        true,
        "kB",
      ),
      self(
        instructed({ instructionTopic: "topic-C", discipline: "disc-C", pairedParticipantNames: ["examinee-C"] }),
        true,
        "kC",
      ),
    ],
  );
  assert.equal((html.match(/rounded-xl/g) ?? []).length, 3, "three nested cards were not rendered");
  for (const value of ["סוסה-A", "topic-A", "disc-A", "topic-B", "disc-B", "topic-C", "disc-C"]) {
    assert.ok(html.includes(value), `${value} is missing from the rendered output`);
  }
});

test("3b. each nested card contains ONLY its own horse/topic/discipline/counterpart", () => {
  const html = render(
    [
      slot({ assignmentKey: "kA", role: "EXAMINEE", startTime: "08:00", endTime: "08:15" }),
      slot({ assignmentKey: "kB", role: "INSTRUCTED_TRAINEE", startTime: "08:15", endTime: "08:30" }),
    ],
    [
      self(
        examinee({
          horseName: "סוסה-A",
          instructionTopic: "topic-A",
          discipline: "disc-A",
          pairedParticipantNames: ["trainee-A"],
        }),
        true,
        "kA",
      ),
      self(
        instructed({
          instructionTopic: "topic-B",
          discipline: "disc-B",
          pairedParticipantNames: ["examinee-B"],
        }),
        true,
        "kB",
      ),
    ],
  );
  const cards = html.split(/(?=<div class="flex flex-col gap-1 rounded-xl)/g).filter((c) => c.includes("rounded-xl"));
  assert.equal(cards.length, 2, "expected exactly two nested card fragments");
  const [cardA, cardB] = cards;
  // Card A carries ONLY its own detail — never card B's.
  assert.ok(cardA.includes("סוסה-A") && cardA.includes("topic-A") && cardA.includes("disc-A"));
  assert.ok(cardA.includes("trainee-A"));
  assert.equal(cardA.includes("topic-B"), false, "assignment B's topic leaked into card A");
  assert.equal(cardA.includes("disc-B"), false, "assignment B's discipline leaked into card A");
  assert.equal(cardA.includes("examinee-B"), false, "assignment B's counterpart leaked into card A");
  // Card B carries ONLY its own detail — never card A's.
  assert.ok(cardB.includes("topic-B") && cardB.includes("disc-B") && cardB.includes("examinee-B"));
  assert.equal(cardB.includes("סוסה-A"), false, "assignment A's horse leaked into card B");
  assert.equal(cardB.includes("topic-A"), false, "assignment A's topic leaked into card B");
  assert.equal(cardB.includes("trainee-A"), false, "assignment A's counterpart leaked into card B");
});

test("3c. TWO assignments sharing the SAME role and the SAME time are still matched to the RIGHT detail", () => {
  // Role and time alone cannot distinguish these — only assignmentKey does.
  const html = render(
    [
      slot({ assignmentKey: "kA", role: "INSTRUCTED_TRAINEE", startTime: "09:00", endTime: "09:20" }),
      slot({ assignmentKey: "kB", role: "INSTRUCTED_TRAINEE", startTime: "09:00", endTime: "09:20" }),
    ],
    [
      self(
        instructed({ discipline: "disc-A", pairedParticipantNames: ["examinee-A"] }),
        true,
        "kA",
      ),
      self(
        instructed({ discipline: "disc-B", pairedParticipantNames: ["examinee-B"] }),
        true,
        "kB",
      ),
    ],
  );
  const cards = html.split(/(?=<div class="flex flex-col gap-1 rounded-xl)/g).filter((c) => c.includes("rounded-xl"));
  assert.equal(cards.length, 2);
  assert.ok(cards[0].includes("disc-A") && cards[0].includes("examinee-A"));
  assert.equal(cards[0].includes("disc-B"), false);
  assert.ok(cards[1].includes("disc-B") && cards[1].includes("examinee-B"));
  assert.equal(cards[1].includes("disc-A"), false);
});

test("3d. a null assignmentKey (the two sibling lookups could not agree) shows the time and role but no guessed detail", () => {
  const html = render(
    [slot({ assignmentKey: null, role: "EXAMINEE" })],
    [self(examinee(), true, "kA")],
  );
  assert.ok(html.includes(EXAMINEE_ROLE_TITLE), "the role title is missing");
  assert.ok(html.includes("09:00") && html.includes("09:20"), "the time is missing");
  for (const value of ["רקיע", "עבודה על מעגל", "אילוף", EXAMINEE_COUNTERPART_LABEL]) {
    assert.equal(html.includes(value), false, `${value} was guessed for an unpaired slot`);
  }
});

test("3e. ZERO personal slots renders nothing", () => {
  const html = render([], [self(examinee(), false, null), self(instructed(), false, null)]);
  assert.equal(html, "", "a detail was rendered for a viewer with no personal slot");
  assert.equal(render([], []), "", "an empty block produced markup");
});

test("3f. a slot with no detail at all renders nothing beyond its own role and time — never empty labels", () => {
  const html = render(
    [slot({ assignmentKey: "kA", role: "EXAMINEE" })],
    [
      self(
        examinee({
          horseName: null,
          instructionTopic: null,
          discipline: null,
          pairedParticipantNames: [],
        }),
        true,
        "kA",
      ),
    ],
  );
  for (const label of ["סוס", "נושא", "תחום", EXAMINEE_COUNTERPART_LABEL]) {
    assert.equal(html.includes(label), false, `an empty ${label} label was rendered`);
  }
});

// ===========================================================================
// 3g. A ONE-ASSIGNMENT session uses the SAME nested-card layout — no legacy shape
// ===========================================================================

test("3g. a trainee with ONE personal assignment still receives ONE nested card", () => {
  const html = render(
    [slot({ assignmentKey: "kA", role: "EXAMINEE" })],
    [self(examinee(), true, "kA")],
  );
  assert.equal((html.match(/rounded-xl/g) ?? []).length, 1);
  assert.ok(html.includes(EXAMINEE_ROLE_TITLE));
  assert.ok(html.includes("רקיע"));
});

// ===========================================================================
// 3h. Chronological order — the component renders in array order, unchanged
// ===========================================================================

test("3h. nested cards render in the SAME order the personal slots arrive — chronological, upstream", () => {
  const html = render(
    [
      slot({ assignmentKey: "kA", role: "EXAMINEE", startTime: "08:00", endTime: "08:15" }),
      slot({ assignmentKey: "kB", role: "INSTRUCTED_TRAINEE", startTime: "08:15", endTime: "08:30" }),
    ],
    [
      self(examinee({ horseName: "first-horse" }), true, "kA"),
      self(instructed({ instructionTopic: "second-topic" }), true, "kB"),
    ],
  );
  assert.ok(
    html.indexOf("first-horse") < html.indexOf("second-topic"),
    "the first slot's card did not render before the second's",
  );
});

// ===========================================================================
// 4. It is COMPACT: only the viewer, never the whole block
// ===========================================================================

test("4. nobody else's row reaches the personal detail", () => {
  const html = render(
    [slot({ assignmentKey: "kA", role: "EXAMINEE" })],
    [
      self(examinee({ participantName: "דנה", horseName: "רקיע" }), true, "kA"),
      self(instructed({ participantName: "יעל" }), false, null),
      self(
        examinee({
          participantName: "רון",
          horseName: "סופה",
          personalStartTime: "10:00",
          personalEndTime: "10:20",
          pairedParticipantNames: ["נועה ברק"],
        }),
        false,
        null,
      ),
      self(
        instructed({
          participantName: "נועה ברק",
          personalStartTime: "10:00",
          personalEndTime: "10:20",
          pairedParticipantNames: ["רון"],
        }),
        false,
        null,
      ),
    ],
  );
  assert.ok(html.includes("רקיע"), "the viewer's own horse is missing");
  for (const other of ["רון", "סופה", "נועה ברק"]) {
    assert.equal(html.includes(other), false, `${other} appeared in the PERSONAL view`);
  }
});

test("4b. it renders no place and no participant summary", () => {
  const html = render(
    [slot({ assignmentKey: "kA", role: "EXAMINEE" })],
    [self(examinee(), true, "kA"), self(instructed(), false, null)],
  );
  for (const token of ["מקום", "שעה אישית"]) {
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
  // The component takes NO viewer identity at all. `personalSlots` and
  // `assignments` are the ONLY props: the arrays already carry the server's
  // answer, so there is nothing left for a caller to select with — and no
  // marker, name or real id it could pass.
  const props = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export function ExamPersonalAssignmentDetail"),
  );
  assert.deepEqual(
    [...props.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort(),
    ["assignments", "personalSlots"],
  );
});

test("5a. the REMOVED heuristic is absent: no role or time selection remains", () => {
  // The old logic matched the viewer by `selfRole` + `personalStartTime` +
  // `personalEndTime`, and later by `isSelf` alone. None of those may be named
  // here any more, in any form.
  for (const token of [
    "selectSelfAssignmentDetail",
    "selectSelfAssignmentRows",
    "ExamSelfMarker",
    "selfRole",
    "selfStartTime",
    "selfEndTime",
    "isSelf ===",
    "personalStartTime",
    "personalEndTime",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the removed heuristic survives: ${token}`);
  }
  // Pairing is ONE call into the pure core, per slot, and the component
  // performs no filtering or indexing of its own to CHOOSE a row.
  assert.ok(
    SOURCE_CODE.includes("selectAssignmentRowForSlot(assignments, slot.assignmentKey)"),
    "the component does not delegate pairing to the pure core",
  );
  for (const token of ["assignments.filter", "assignments.find", "assignments["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the component selects by ${token}`);
  }
});

test("5b. no internal DATABASE id, contact detail or grade is named", () => {
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

test("5c. assignmentKey is used ONLY for pairing and as a React key — never rendered as text", () => {
  // Every fixture in this file uses recognizable key tokens ("kA", "kB", "k1",
  // "k2", ...); none of them may appear in any rendered markup.
  const cases: Array<[readonly TraineeExamPersonalSlotView[], readonly TraineeExamAssignmentRowView[]]> = [
    (
      [
        [slot({ assignmentKey: "k1" })],
        [self(examinee(), true, "k1")],
      ] as const
    ),
    (
      [
        [
          slot({ assignmentKey: "kA", startTime: "08:00", endTime: "08:15" }),
          slot({ assignmentKey: "kB", role: "INSTRUCTED_TRAINEE", startTime: "08:15", endTime: "08:30" }),
        ],
        [
          self(examinee(), true, "kA"),
          self(instructed(), true, "kB"),
        ],
      ] as const
    ),
  ];
  for (const [slots, assignments] of cases) {
    const html = render(slots, assignments);
    for (const key of slots.map((s) => s.assignmentKey).filter((k): k is string => k !== null)) {
      assert.equal(html.includes(key), false, `assignmentKey "${key}" was rendered as text`);
    }
  }
  // The component's OWN source never prints the key as text either — its only
  // uses are the pairing lookup and a `key=` prop.
  assert.equal(
    SOURCE_CODE.includes("{slot.assignmentKey}"),
    false,
    "assignmentKey is interpolated directly into markup",
  );
});

test("5d. it imports ONLY the pure sibling core and is read-only by construction", () => {
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

test("5e. the approved Hebrew labels are present, verbatim", () => {
  for (const label of [
    `EXAMINEE: "${EXAMINEE_ROLE_TITLE}"`,
    `INSTRUCTED_TRAINEE: "${INSTRUCTED_TRAINEE_ROLE_TITLE}"`,
    `EXAMINEE: "${EXAMINEE_COUNTERPART_LABEL}"`,
    `INSTRUCTED_TRAINEE: "${TRAINEE_COUNTERPART_LABEL}"`,
    'const HORSE_LABEL = "סוס"',
    'const TOPIC_LABEL = "נושא"',
    'const DISCIPLINE_LABEL = "תחום"',
  ]) {
    assert.ok(SOURCE.includes(label), `the approved label is missing or reworded: ${label}`);
  }
});

test("5f. the layout wraps and cannot overflow sideways on a phone", () => {
  for (const token of ["<table", "<thead", "<tbody", "<tr", "<td", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the detail row does not wrap");
});
