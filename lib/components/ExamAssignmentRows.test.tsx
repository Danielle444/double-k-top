/**
 * EX-ROLE-OP-UI-MVP — tests for the shared operational assignment renderer.
 *
 * These are REAL RENDER TESTS, not source scans, following the committed
 * precedent of lib/components/HorseFeedingStatusControl.test.tsx.
 * ExamAssignmentRows is a leaf presentational component with NO imports at all —
 * it declares its own prop contract rather than reaching into the exam read
 * pipeline — so it pulls in no Prisma, no next/*, no "use server" module and no
 * exam core, and can be rendered with react-dom/server inside a plain
 * `tsx --test` process. The markup asserted below is the markup a browser
 * receives.
 *
 * A handful of STRUCTURAL claims are asserted against the source text too, for
 * the properties that are about what the file CANNOT do rather than what it
 * renders: that it duplicates no pairing or timetable calculation, that it
 * cannot reach a block time to fall back on, and that no identifier or contact
 * field is even representable in its props.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamAssignmentRows.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamAssignmentRows, type ExamAssignmentRowView } from "./ExamAssignmentRows";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamAssignmentRows.tsx", import.meta.url)),
  "utf8",
);

/** CODE only — the header legitimately NAMES the fields it refuses to carry. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

const EXAMINEE_ROLE_LABEL = "נבחן/ת";
const INSTRUCTED_ROLE_LABEL = "חניך/ה מודרך/ת";
const NO_PERSONAL_TIME_TEXT = "שעה אישית טרם נקבעה";
const UNNAMED_PARTICIPANT_TEXT = "שם לא זמין";
const INSTRUCTING_LABEL = "מדריך/ה את";
const INSTRUCTED_LIST_LABEL = "חניכים מודרכים";

/** A fully populated examinee row; every test overrides only what it is about. */
function examinee(overrides: Partial<ExamAssignmentRowView> = {}): ExamAssignmentRowView {
  return {
    participantName: "דנה כהן",
    role: "EXAMINEE",
    horseName: "רקיע",
    instructionTopic: "עבודה על מעגל",
    discipline: "אילוף",
    personalStartTime: "09:00",
    personalEndTime: "09:20",
    pairedParticipantNames: [],
    ...overrides,
  };
}

/** A fully populated instructed-trainee row, with no horse of its own. */
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

function render(assignments: readonly ExamAssignmentRowView[]): string {
  return renderToStaticMarkup(<ExamAssignmentRows assignments={assignments} />);
}

/** How many times `needle` occurs in `haystack`. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ===========================================================================
// 1. The collection is rendered — every row, in the contract's own order
// ===========================================================================

test("1. every assignment row in the collection is rendered", () => {
  const html = render([
    examinee({ participantName: "ראשונה" }),
    instructed({ participantName: "שנייה" }),
    examinee({ participantName: "שלישית" }),
  ]);
  for (const name of ["ראשונה", "שנייה", "שלישית"]) {
    assert.ok(html.includes(name), `${name} is not rendered`);
  }
});

test("1b. rows are rendered in the contract's order, never re-sorted", () => {
  // Deliberately NOT alphabetical: the contract order IS the operational order,
  // so a renderer that sorted by name would reorder a real schedule.
  const html = render([
    examinee({ participantName: "תמר" }),
    examinee({ participantName: "אבי" }),
    examinee({ participantName: "מיכל" }),
  ]);
  assert.ok(
    html.indexOf("תמר") < html.indexOf("אבי") && html.indexOf("אבי") < html.indexOf("מיכל"),
    "the renderer reordered the rows",
  );
  assert.equal(SOURCE_CODE.includes(".sort("), false, "the renderer sorts the rows");
});

// ===========================================================================
// 2. Hebrew role labels
// ===========================================================================

test("2. an examinee row carries the approved Hebrew role label", () => {
  assert.ok(render([examinee()]).includes(EXAMINEE_ROLE_LABEL));
});

test("2b. an instructed-trainee row carries the approved Hebrew role label", () => {
  assert.ok(render([instructed()]).includes(INSTRUCTED_ROLE_LABEL));
});

test("2c. each row shows its OWN role, not the first row's", () => {
  const html = render([examinee(), instructed()]);
  assert.equal(count(html, EXAMINEE_ROLE_LABEL), 1);
  // The instructed label CONTAINS no substring of the examinee one, so the two
  // counts are independent.
  assert.equal(count(html, INSTRUCTED_ROLE_LABEL), 1);
});

// ===========================================================================
// 3. Personal start/end time — and never a block-time fallback
// ===========================================================================

test("3. a complete personal window renders as start - end", () => {
  const html = render([examinee({ personalStartTime: "09:00", personalEndTime: "09:20" })]);
  assert.ok(html.includes("09:00 - 09:20"), "the personal window is not rendered");
  assert.equal(html.includes(NO_PERSONAL_TIME_TEXT), false);
});

test("4. a missing personal START shows the neutral notice and no time", () => {
  const html = render([examinee({ personalStartTime: null })]);
  assert.ok(html.includes(NO_PERSONAL_TIME_TEXT));
  assert.equal(/\d{2}:\d{2}/.test(html), false, "a time was rendered from somewhere");
});

test("4b. a missing personal END shows the neutral notice and no half window", () => {
  // A bare "09:00" or "09:00 -" would read as a decided time, so the whole line
  // is demoted rather than shown half-known.
  const html = render([examinee({ personalEndTime: null })]);
  assert.ok(html.includes(NO_PERSONAL_TIME_TEXT));
  assert.equal(/\d{2}:\d{2}/.test(html), false, "a half-known window was rendered");
});

test("4c. both ends missing shows the neutral notice exactly once per row", () => {
  const html = render([
    examinee({ personalStartTime: null, personalEndTime: null }),
    instructed({ personalStartTime: null, personalEndTime: null }),
  ]);
  assert.equal(count(html, NO_PERSONAL_TIME_TEXT), 2);
});

test("5. no block time can be substituted, because none is representable", () => {
  // The prop contract is an EXPLICIT field list. There is no block start, block
  // end, display end or duration in it, so a fallback to one is not something
  // this renderer could express even by accident.
  const contract = SOURCE_CODE.slice(
    SOURCE_CODE.indexOf("export interface ExamAssignmentRowView"),
    SOURCE_CODE.indexOf("const ROLE_LABELS"),
  );
  const fields = [...contract.matchAll(/readonly (\w+):/g)].map(([, name]) => name).sort();
  assert.deepEqual(fields, [
    "discipline",
    "horseName",
    "instructionTopic",
    "pairedParticipantNames",
    "participantName",
    "personalEndTime",
    "personalStartTime",
    "role",
  ]);
  for (const token of [
    "startTime",
    "endTime",
    "displayEndTime",
    "derivedBlockEndTime",
    "blockStart",
    "blockEnd",
    "DEFAULT_DURATION",
    "addMinutes",
    "durationMinutes",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer names ${token}`);
  }
  // And neither personal value is ever defaulted from anything.
  for (const fallback of [
    "personalStartTime ??",
    "personalEndTime ??",
    "personalStartTime ||",
    "personalEndTime ||",
  ]) {
    assert.equal(SOURCE_CODE.includes(fallback), false, `the renderer invents a time: ${fallback}`);
  }
});

// ===========================================================================
// 6–7. Horse, topic and discipline
// ===========================================================================

test("6. an examinee's horse is displayed with its Hebrew label", () => {
  const html = render([examinee({ horseName: "רקיע" })]);
  assert.ok(html.includes("סוס"), "the horse label is missing");
  assert.ok(html.includes("רקיע"), "the horse name is missing");
});

test("6b. an instructed-trainee row shows no horse and no empty horse label", () => {
  // The lesson horse belongs to the examinee row; a null here is an absence, not
  // a blank to be labelled.
  const html = render([instructed({ horseName: null })]);
  assert.equal(html.includes("סוס"), false, "an empty horse label was rendered");
});

test("7. the instruction topic and the discipline are displayed with their labels", () => {
  const html = render([examinee({ instructionTopic: "עבודה על מעגל", discipline: "אילוף" })]);
  assert.ok(html.includes("נושא"), "the topic label is missing");
  assert.ok(html.includes("עבודה על מעגל"), "the topic is missing");
  assert.ok(html.includes("תחום"), "the discipline label is missing");
  assert.ok(html.includes("אילוף"), "the discipline is missing");
});

test("7b. an instructed trainee shows the topic and discipline inherited upstream", () => {
  // They arrive already inherited from the resolved examinee — this renderer
  // copies nothing between rows, it just displays what each row carries.
  const html = render([instructed({ instructionTopic: "קפיצה", discipline: "ראווה" })]);
  assert.ok(html.includes("קפיצה") && html.includes("ראווה"));
});

test("7c. a missing topic or discipline is omitted, not stubbed", () => {
  const html = render([examinee({ instructionTopic: null, discipline: null, horseName: null })]);
  assert.equal(html.includes("נושא"), false, "an empty topic label was rendered");
  assert.equal(html.includes("תחום"), false, "an empty discipline label was rendered");
  // No wall of placeholders anywhere in the file.
  for (const placeholder of ["לא הוגדר", "לא זמין:", "—"]) {
    assert.equal(html.includes(placeholder), false, `a ${placeholder} placeholder was rendered`);
  }
});

test("7d. a blank-but-present value is treated as absent", () => {
  const html = render([examinee({ horseName: "   " })]);
  assert.equal(html.includes("סוס"), false, "a whitespace-only horse was labelled");
});

// ===========================================================================
// 8–10. Pairing
// ===========================================================================

test("8. an instructed trainee shows the examinee they instruct", () => {
  const html = render([instructed({ pairedParticipantNames: ["דנה כהן"] })]);
  assert.ok(html.includes(INSTRUCTING_LABEL), "the instructing label is missing");
  assert.ok(html.includes("דנה כהן"), "the paired examinee is missing");
});

test("9. an examinee shows the instructed trainees paired with them", () => {
  const html = render([examinee({ pairedParticipantNames: ["יעל לוי"] })]);
  assert.ok(html.includes(INSTRUCTED_LIST_LABEL), "the paired-trainees label is missing");
  assert.ok(html.includes("יעל לוי"), "the paired trainee is missing");
});

test("10. several paired names are rendered individually, not as one joined string", () => {
  const html = render([examinee({ pairedParticipantNames: ["יעל לוי", "נועה ברק", "רון גל"] })]);
  for (const name of ["יעל לוי", "נועה ברק", "רון גל"]) {
    assert.ok(html.includes(name), `${name} is missing`);
  }
  // Each name sits in its OWN element, so a consumer never has to split a joined
  // string back apart.
  for (const name of ["יעל לוי", "נועה ברק", "רון גל"]) {
    assert.ok(
      new RegExp(`<span[^>]*>[^<]*${name}`).test(html),
      `${name} is not rendered as its own element`,
    );
  }
  // ...and the renderer never builds one out of them either.
  assert.equal(SOURCE_CODE.includes(".join("), false, "the renderer joins the paired names");
});

test("10b. an empty pairing renders NO label at all", () => {
  const examineeHtml = render([examinee({ pairedParticipantNames: [] })]);
  assert.equal(examineeHtml.includes(INSTRUCTED_LIST_LABEL), false, "an empty label was rendered");
  const instructedHtml = render([instructed({ pairedParticipantNames: [] })]);
  assert.equal(instructedHtml.includes(INSTRUCTING_LABEL), false, "an empty label was rendered");
});

test("10c. no partner is invented when the contract carries none", () => {
  // The unresolved / ambiguous case: the row keeps its horse, topic and time and
  // simply says nothing about a partner.
  const html = render([instructed({ pairedParticipantNames: [], instructionTopic: null })]);
  assert.equal(html.includes(INSTRUCTING_LABEL), false);
  assert.ok(html.includes(INSTRUCTED_ROLE_LABEL), "the row itself disappeared");
  assert.ok(html.includes("יעל לוי"), "the participant disappeared");
});

test("10d. the singular convenience field is not read at all", () => {
  // `pairedParticipantName` is DERIVED from the list upstream. Reading both would
  // let this file express a pairing the read layer did not.
  assert.equal(
    /pairedParticipantName\b(?!s)/.test(SOURCE_CODE),
    false,
    "the renderer reads the derived singular pairing field",
  );
});

// ===========================================================================
// 11–12. Missing names and empty collections
// ===========================================================================

test("11. an unresolved participant name falls back to neutral text", () => {
  const html = render([examinee({ participantName: null })]);
  assert.ok(html.includes(UNNAMED_PARTICIPANT_TEXT), "the safe fallback is missing");
  // The row survives with everything else it carries.
  assert.ok(html.includes("רקיע") && html.includes("09:00 - 09:20"));
});

test("12. an EMPTY assignment collection renders nothing at all", () => {
  assert.equal(render([]), "", "an empty block produced markup");
});

test("12b. an empty collection produces no 'nobody is here' claim", () => {
  const html = render([]);
  for (const token of ["אין", "ריק", "0"]) {
    assert.equal(html.includes(token), false, `the empty state claims ${token}`);
  }
});

// ===========================================================================
// 13. Privacy — no identifier and no contact detail is representable
// ===========================================================================

test("13. no internal id, contact detail or note is named anywhere in the renderer", () => {
  for (const token of [
    "assignmentId",
    "studentId",
    "sessionId",
    "definitionId",
    "lessonId",
    "planId",
    "courseOfferingId",
    "pairingIndex",
    "nationalId",
    "identityNumber",
    "parentName",
    "parentPhone",
    "phone",
    "email",
    "notes",
    "childNotes",
    "grade",
    "rating",
    "feedback",
    "JSON.stringify",
    "Object.entries",
    "Object.keys",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer names ${token}`);
  }
  // No spread of an unknown object into the markup, so an upstream field cannot
  // start appearing on screen by itself.
  assert.equal(/\{\.\.\./.test(SOURCE_CODE), false, "the renderer spreads an object into markup");
});

test("13b. a fully populated row renders ONLY the approved display values", () => {
  const html = render([
    examinee({ pairedParticipantNames: ["יעל לוי"] }),
    instructed(),
  ]);
  // VISIBLE TEXT only — the styling class names legitimately carry digits, and
  // they are attributes, not something a reader ever sees.
  const text = html.replace(/<[^>]*>/g, " ");
  const digitRuns = text.match(/\d+/g) ?? [];
  assert.deepEqual(
    [...new Set(digitRuns)].sort(),
    ["00", "09", "20"],
    `an unexpected numeric value was rendered: ${digitRuns.join(", ")}`,
  );
});

// ===========================================================================
// 14. No business calculation is duplicated in the UI
// ===========================================================================

test("14. the renderer imports nothing and duplicates no pairing or timetable rule", () => {
  // ZERO imports: it cannot reach an exam core, a read-pipeline module, Prisma,
  // a Server Action or a clock. That is why it is testable here at all.
  assert.deepEqual(SOURCE_CODE.match(/^\s*import\b.*$/gm), null, "the renderer gained an import");
  assert.equal(/\brequire\s*\(/.test(SOURCE_CODE), false, "no runtime require()");
  assert.equal(/\bimport\s*\(/.test(SOURCE_CODE), false, "no dynamic import()");

  for (const token of [
    "exam-read-dto",
    "exam-read-scope-core",
    "exam-role-readers",
    "exam-block-timetable",
    "exam-stored-adapter",
    "exam-conflict-core",
    "resolvePairing",
    "computePairing",
    "Date",
    "prisma",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer reaches ${token}`);
  }
  // No arithmetic on the times it is handed: they are printed, not computed.
  assert.equal(
    /personal(Start|End)Time\s*[-+*/]/.test(SOURCE_CODE),
    false,
    "the renderer performs time arithmetic",
  );
  assert.equal(SOURCE_CODE.includes("parseInt"), false, "the renderer parses a time");
});

test("14b. the renderer is read-only: no state, no handler, no form control", () => {
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
    "unpublish",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer adds ${token}`);
  }
});

// ===========================================================================
// 15. The approved Hebrew labels are exactly these
// ===========================================================================

test("15. the approved Hebrew labels are present, verbatim", () => {
  for (const label of [
    `EXAMINEE: "${EXAMINEE_ROLE_LABEL}"`,
    `INSTRUCTED_TRAINEE: "${INSTRUCTED_ROLE_LABEL}"`,
    `EXAMINEE: "${INSTRUCTED_LIST_LABEL}"`,
    `INSTRUCTED_TRAINEE: "${INSTRUCTING_LABEL}"`,
    `const UNNAMED_PARTICIPANT_TEXT = "${UNNAMED_PARTICIPANT_TEXT}"`,
    `const NO_PERSONAL_TIME_TEXT = "${NO_PERSONAL_TIME_TEXT}"`,
    'const HORSE_LABEL = "סוס"',
    'const TOPIC_LABEL = "נושא"',
    'const DISCIPLINE_LABEL = "תחום"',
  ]) {
    assert.ok(SOURCE.includes(label), `the approved label is missing or reworded: ${label}`);
  }
});

// ===========================================================================
// 16. Mobile: nothing fixed-width, nothing that can overflow sideways
// ===========================================================================

test("16. the layout is a wrapping column, with no table and no fixed width", () => {
  for (const token of ["<table", "<thead", "<tbody", "<tr", "<td", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the detail row does not wrap");
  assert.ok(SOURCE_CODE.includes("flex-col"), "the rows are not stacked");
});
