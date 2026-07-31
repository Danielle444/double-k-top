/**
 * EX-ROLE-SCHEDULE-REDESIGN — tests for the shared operational schedule
 * renderer.
 *
 * These are REAL RENDER TESTS, not source scans, following the committed
 * precedent of lib/components/HorseFeedingStatusControl.test.tsx. The renderer
 * is a leaf presentational component whose ONLY import is the pure sibling view
 * core — it reaches no Prisma, no next/*, no "use server" module and no exam
 * read-pipeline module — so it can be rendered with react-dom/server inside a
 * plain `tsx --test` process. The markup asserted below is the markup a browser
 * receives.
 *
 * A handful of STRUCTURAL claims are asserted against the source text too, for
 * the properties that are about what the file CANNOT do rather than what it
 * renders: that it duplicates no pairing or timetable calculation, that it
 * cannot reach a block time to fall back on, that it compares no name, and that
 * no identifier or contact field is even representable in its props.
 *
 * The grouping and nesting RULES themselves live in the pure core and are proven
 * beside it, in lib/components/exam-schedule-view-core.test.ts. What this suite
 * proves is what a reader actually sees.
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
const INSTRUCTED_LIST_LABEL = "חניכים מודרכים";
const UNPAIRED_TRAINEE_LABEL = "חניך/ה מודרך/ת ללא שיוך";

/**
 * The EXACT markup of a participant unit, and of the role chip inside one.
 *
 * They are asserted as literal class strings on purpose: the product rule is
 * about MARKUP, not about wording. Counting them is how this suite proves that
 * an instructed trainee — paired or unpaired — never receives the card an
 * examinee receives, rather than merely receiving different text inside one.
 */
const UNIT_MARKUP = '<div class="rounded-xl border border-border bg-background p-3">';
const ROLE_CHIP_MARKUP = '<p class="text-xs font-semibold text-muted-foreground">';

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
    pairedParticipantNames: ["יעל לוי"],
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
// 1. The examinee unit — and no independent instructed-trainee card
// ===========================================================================

test("1. an examinee and the trainee they teach render as ONE unit", () => {
  const html = render([examinee(), instructed()]);
  assert.ok(html.includes("דנה כהן"), "the examinee is missing");
  assert.ok(html.includes("יעל לוי"), "the instructed trainee is missing");
  // The trainee's name sits INSIDE the examinee's unit: it appears after the
  // examinee's name and before that unit's closing markup.
  assert.ok(
    html.indexOf("דנה כהן") < html.indexOf("יעל לוי"),
    "the trainee is not nested under the examinee",
  );
});

test("1b. the instructed trainee gets NO independent card and NO role label of their own", () => {
  const html = render([examinee(), instructed()]);
  // Exactly ONE participant is presented as a person in their own right, and it
  // is the examinee. The nested trainee is a name under a label, not a card.
  assert.equal(count(html, EXAMINEE_ROLE_LABEL), 1);
  assert.equal(
    count(html, INSTRUCTED_ROLE_LABEL),
    0,
    "a paired instructed trainee was given a card of their own",
  );
  assert.ok(html.includes(INSTRUCTED_LIST_LABEL), "the nesting label is missing");
});

test("1c. the trainee appears exactly ONCE, not once nested and once beside", () => {
  const html = render([examinee(), instructed()]);
  assert.equal(count(html, "יעל לוי"), 1, "the trainee is rendered twice");
});

test("1d. reversing the contract order changes nothing about the nesting", () => {
  // The nesting is driven by each row's own RESOLVED pairing, never by adjacency.
  const html = render([instructed(), examinee()]);
  assert.equal(count(html, "יעל לוי"), 1);
  assert.equal(count(html, INSTRUCTED_ROLE_LABEL), 0);
  assert.ok(html.includes("דנה כהן"));
});

test("1e. an examinee teaching several trainees shows each as its own element", () => {
  const html = render([examinee({ pairedParticipantNames: ["יעל לוי", "נועה ברק", "רון גל"] })]);
  for (const name of ["יעל לוי", "נועה ברק", "רון גל"]) {
    assert.ok(
      new RegExp(`<span[^>]*>[^<]*${name}`).test(html),
      `${name} is not rendered as its own element`,
    );
  }
  // ...and the renderer never builds one joined string out of them.
  assert.equal(SOURCE_CODE.includes(".join("), false, "the renderer joins the names");
});

test("1f. an examinee paired with nobody shows no empty nesting label", () => {
  const html = render([examinee({ pairedParticipantNames: [] })]);
  assert.equal(
    html.includes(INSTRUCTED_LIST_LABEL),
    false,
    "a bare label with no trainee behind it was rendered",
  );
  assert.ok(html.includes("דנה כהן"), "the examinee disappeared");
});

test("1g. an UNPAIRED instructed trainee is a compact WARNING LINE, never a card", () => {
  // Nobody nests them, so omitting them would erase a real person — but they are
  // still never presented as a participant in their own right.
  const html = render([instructed({ participantName: "נועה ברק", pairedParticipantNames: [] })]);
  assert.ok(html.includes("נועה ברק"), "an unpaired trainee vanished from the schedule");
  assert.ok(html.includes(UNPAIRED_TRAINEE_LABEL), "the warning label is missing");
  assert.ok(
    html.includes(`${UNPAIRED_TRAINEE_LABEL}: נועה ברק`),
    "the warning does not name the trainee",
  );
  // It is a plain paragraph, not a card: NO unit markup anywhere in the wave.
  assert.equal(count(html, UNIT_MARKUP), 0, "the unpaired trainee was given unit markup");
  // ...and no role chip, no horse/topic/discipline chips, no pairing label.
  assert.equal(count(html, ROLE_CHIP_MARKUP), 0, "the unpaired trainee was given a role chip");
  for (const token of ["סוס", "נושא", "תחום", INSTRUCTED_LIST_LABEL]) {
    assert.equal(html.includes(token), false, `the warning line carries ${token}`);
  }
});

test("1h. an unresolved unpaired trainee still warns, with the neutral name text", () => {
  const html = render([instructed({ participantName: null, pairedParticipantNames: [] })]);
  assert.ok(html.includes(`${UNPAIRED_TRAINEE_LABEL}: ${UNNAMED_PARTICIPANT_TEXT}`));
  assert.equal(count(html, UNIT_MARKUP), 0, "the unpaired trainee was given unit markup");
});

test("1i. several unpaired trainees are several warning LINES, not a second block", () => {
  const html = render([
    examinee({ participantName: "דנה", pairedParticipantNames: ["יעל"] }),
    instructed({ participantName: "יעל", pairedParticipantNames: ["דנה"] }),
    instructed({ participantName: "נועה ברק", pairedParticipantNames: [] }),
    instructed({ participantName: "שירה כץ", pairedParticipantNames: [] }),
  ]);
  // Exactly ONE unit exists in the wave — the examinee's.
  assert.equal(count(html, UNIT_MARKUP), 1, "the unpaired trainees were given units");
  // Each warning is its own line, and they share the wave with that unit rather
  // than forming a grid, a card or a section of their own.
  assert.equal(count(html, `${UNPAIRED_TRAINEE_LABEL}: `), 2);
  assert.ok(html.includes("נועה ברק") && html.includes("שירה כץ"));
  assert.equal(count(html, "grid-cols-1"), 1, "a second grid was created for the warnings");
});

// ===========================================================================
// 1j–1k. THE PRODUCT RULE, stated once for each state
// ===========================================================================

test("1j. PAIRED: no independent instructed-trainee card exists", () => {
  const html = render([examinee(), instructed()]);
  // One participant unit, and it is the examinee's.
  assert.equal(count(html, UNIT_MARKUP), 1);
  assert.equal(count(html, EXAMINEE_ROLE_LABEL), 1);
  assert.equal(count(html, ROLE_CHIP_MARKUP), 1, "a second participant role chip exists");
  // The trainee is a NAME inside that unit, and appears nowhere else.
  assert.equal(count(html, "יעל לוי"), 1);
  assert.equal(html.includes(UNPAIRED_TRAINEE_LABEL), false, "a paired trainee was warned about");
});

test("1k. UNPAIRED: no independent instructed-trainee card exists either", () => {
  const html = render([
    examinee({ participantName: "דנה", pairedParticipantNames: [] }),
    instructed({ participantName: "נועה ברק", pairedParticipantNames: [] }),
  ]);
  // Still exactly ONE unit, and it is still the examinee's.
  assert.equal(count(html, UNIT_MARKUP), 1);
  assert.equal(count(html, ROLE_CHIP_MARKUP), 1, "the unpaired trainee was given a role chip");
  assert.ok(html.includes("דנה"), "the examinee disappeared");
  assert.ok(html.includes(`${UNPAIRED_TRAINEE_LABEL}: נועה ברק`), "the warning is missing");
});

test("1l. a wave of ONLY unpaired trainees renders warnings and no unit grid at all", () => {
  const html = render([
    instructed({ participantName: "נועה ברק", pairedParticipantNames: [] }),
    instructed({ participantName: "שירה כץ", pairedParticipantNames: [] }),
  ]);
  assert.equal(count(html, UNIT_MARKUP), 0, "a unit was rendered with no examinee");
  assert.equal(count(html, "grid-cols-1"), 0, "an empty unit grid was rendered");
  assert.equal(count(html, `${UNPAIRED_TRAINEE_LABEL}: `), 2);
  // The wave still states its own time exactly once.
  assert.equal(count(html, "09:00 - 09:20"), 1);
});

// ===========================================================================
// 2. Waves — the time appears once, parallel examinees sit together
// ===========================================================================

test("2. the wave time is rendered EXACTLY ONCE for two parallel examinees", () => {
  const html = render([
    examinee({ participantName: "דנה", pairedParticipantNames: ["יעל"] }),
    instructed({ participantName: "יעל", pairedParticipantNames: ["דנה"] }),
    examinee({ participantName: "רון", pairedParticipantNames: ["גל"] }),
    instructed({ participantName: "גל", pairedParticipantNames: ["רון"] }),
  ]);
  assert.equal(count(html, "09:00 - 09:20"), 1, "the wave time is repeated per examinee");
  // Both examinees are inside that one wave.
  assert.ok(html.includes("דנה") && html.includes("רון"));
});

test("2b. no unit prints a time of its own", () => {
  const html = render([examinee({ participantName: "דנה" }), examinee({ participantName: "רון" })]);
  // The ONLY clock values in the whole markup are the wave's own two ends —
  // two examinees, one window, two times, not four.
  assert.deepEqual(html.match(/\d{2}:\d{2}/g) ?? [], ["09:00", "09:20"]);
});

test("2c. two different windows render two waves, each with its own single time", () => {
  const html = render([
    examinee({ participantName: "מוקדמת", personalStartTime: "09:00", personalEndTime: "09:20" }),
    examinee({ participantName: "מאוחרת", personalStartTime: "10:00", personalEndTime: "10:20" }),
  ]);
  assert.equal(count(html, "09:00 - 09:20"), 1);
  assert.equal(count(html, "10:00 - 10:20"), 1);
  assert.ok(html.indexOf("מוקדמת") < html.indexOf("מאוחרת"), "the waves were reordered");
});

test("2d. the wave order is the contract's order, never sorted by time or name", () => {
  const html = render([
    examinee({ participantName: "תמר", personalStartTime: "14:00", personalEndTime: "14:20" }),
    examinee({ participantName: "אבי", personalStartTime: "08:00", personalEndTime: "08:20" }),
  ]);
  assert.ok(html.indexOf("14:00") < html.indexOf("08:00"), "the renderer sorted the waves");
  assert.equal(SOURCE_CODE.includes(".sort("), false, "the renderer sorts");
});

// ===========================================================================
// 3. Times are printed, never invented
// ===========================================================================

test("3. a complete window renders as start - end", () => {
  const html = render([examinee({ personalStartTime: "09:00", personalEndTime: "09:20" })]);
  assert.ok(html.includes("09:00 - 09:20"), "the window is not rendered");
  assert.equal(html.includes(NO_PERSONAL_TIME_TEXT), false);
});

test("3b. a missing START shows the neutral notice and no time at all", () => {
  const html = render([examinee({ personalStartTime: null })]);
  assert.ok(html.includes(NO_PERSONAL_TIME_TEXT));
  assert.equal(/\d{2}:\d{2}/.test(html), false, "a time was rendered from somewhere");
});

test("3c. a missing END shows the neutral notice and no half window", () => {
  const html = render([examinee({ personalEndTime: null })]);
  assert.ok(html.includes(NO_PERSONAL_TIME_TEXT));
  assert.equal(/\d{2}:\d{2}/.test(html), false, "a half-known window was rendered");
});

test("3d. two rows with no window are never merged into one 'wave'", () => {
  // An ABSENT time is not a time two people can be said to share.
  const html = render([
    examinee({ participantName: "א", personalStartTime: null, personalEndTime: null }),
    examinee({ participantName: "ב", personalStartTime: null, personalEndTime: null }),
  ]);
  assert.equal(count(html, NO_PERSONAL_TIME_TEXT), 2);
});

test("3e. no block time can be substituted, because none is representable", () => {
  for (const token of [
    "startTime:",
    "endTime:",
    "displayEndTime",
    "derivedBlockEndTime",
    "blockStart",
    "blockEnd",
    "DEFAULT_DURATION",
    "addMinutes",
    "durationMinutes",
    "parseInt",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer names ${token}`);
  }
  for (const fallback of [
    "personalStartTime ??",
    "personalEndTime ??",
    "startTime ||",
    "endTime ||",
  ]) {
    assert.equal(SOURCE_CODE.includes(fallback), false, `the renderer invents a time: ${fallback}`);
  }
});

// ===========================================================================
// 4. Horse, topic and discipline
// ===========================================================================

test("4. the examinee unit carries the horse, the topic and the discipline", () => {
  const html = render([
    examinee({ horseName: "רקיע", instructionTopic: "עבודה על מעגל", discipline: "אילוף" }),
  ]);
  assert.ok(html.includes("סוס") && html.includes("רקיע"), "the horse is missing");
  assert.ok(html.includes("נושא") && html.includes("עבודה על מעגל"), "the topic is missing");
  assert.ok(html.includes("תחום") && html.includes("אילוף"), "the discipline is missing");
});

test("4b. a missing value is omitted, never stubbed with a placeholder", () => {
  const html = render([examinee({ horseName: null, instructionTopic: null, discipline: null })]);
  assert.equal(html.includes("סוס"), false, "an empty horse label was rendered");
  assert.equal(html.includes("נושא"), false, "an empty topic label was rendered");
  assert.equal(html.includes("תחום"), false, "an empty discipline label was rendered");
  for (const placeholder of ["לא הוגדר", "—"]) {
    assert.equal(html.includes(placeholder), false, `a ${placeholder} placeholder was rendered`);
  }
});

test("4c. a blank-but-present value is treated as absent", () => {
  const html = render([examinee({ horseName: "   " })]);
  assert.equal(html.includes("סוס"), false, "a whitespace-only horse was labelled");
});

// ===========================================================================
// 5. Missing names, empty collections and beginner blocks
// ===========================================================================

test("5. an unresolved participant name falls back to neutral text", () => {
  const html = render([examinee({ participantName: null })]);
  assert.ok(html.includes(UNNAMED_PARTICIPANT_TEXT), "the safe fallback is missing");
  assert.ok(html.includes("רקיע") && html.includes("09:00 - 09:20"), "the unit lost its detail");
});

test("5b. an EMPTY collection renders nothing at all", () => {
  assert.equal(render([]), "", "an empty block produced markup");
});

test("5c. an empty collection produces no 'nobody is here' claim", () => {
  const html = render([]);
  for (const token of ["אין", "ריק", "0"]) {
    assert.equal(html.includes(token), false, `the empty state claims ${token}`);
  }
});

test("5d. a block holding only a paired trainee renders no empty wave heading", () => {
  // Their unit is elsewhere; a lone time heading here would read as a wave with
  // nobody in it.
  assert.equal(render([instructed()]), "");
});

// ===========================================================================
// 6. Privacy — no identifier and no contact detail is representable
// ===========================================================================

test("6. no internal id, contact detail or grade is named anywhere in the renderer", () => {
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
  assert.equal(/\{\.\.\./.test(SOURCE_CODE), false, "the renderer spreads an object into markup");
});

test("6b. a fully populated wave renders ONLY the approved display values", () => {
  const html = render([examinee(), instructed()]);
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
// 7. No business calculation, and no identity by name, in the UI
// ===========================================================================

test("7. the renderer imports ONLY the pure sibling core", () => {
  // The core is import-free, IO-free and proven beside itself; through it this
  // file still cannot reach an exam core, a read-pipeline module, Prisma, a
  // Server Action or a clock. That is why this suite can render at all.
  const specifiers = [...SOURCE_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(specifiers)], ["./exam-schedule-view-core"]);
  assert.equal(/\brequire\s*\(/.test(SOURCE_CODE), false, "no runtime require()");
  assert.equal(/\bimport\s*\(/.test(SOURCE_CODE), false, "no dynamic import()");
  for (const token of [
    "exam-read-dto",
    "exam-read-scope-core",
    "exam-role-readers",
    "exam-read-io",
    "exam-block-timetable",
    "exam-stored-adapter",
    "exam-conflict-core",
    "resolvePairing",
    "computePairing",
    "prisma",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer reaches ${token}`);
  }
});

test("7a1. the shared renderer is role-blind: it never reads the trainee-only isSelf", () => {
  // `isSelf` is on the TRAINEE assignment contract only. This renderer is mounted
  // by the instructor screen too, whose rows do not carry it — so reading it here
  // would make the instructor's rendering depend on a field its contract lacks.
  assert.equal(SOURCE_CODE.includes("isSelf"), false, "the shared renderer reads isSelf");
  for (const token of ["selfRole", "selfLabel", "myRows", "viewerStudentId"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the shared renderer names ${token}`);
  }
});

test("7a2. INSTRUCTOR rendering is unchanged by the trainee marker", () => {
  // The same rows, once as the instructor contract carries them and once as the
  // trainee contract does — with `isSelf` attached, in both values. The markup
  // must be byte-identical: the extra field changes nothing that is rendered.
  const rows = [examinee({ participantName: "דנה" }), instructed({ participantName: "יעל לוי" })];
  const instructorHtml = render(rows);
  const traineeHtml = render(
    rows.map((row, index) => ({ ...row, isSelf: index === 0 })) as typeof rows,
  );
  assert.equal(traineeHtml, instructorHtml, "the trainee marker changed the shared rendering");
  const noneSelf = render(rows.map((row) => ({ ...row, isSelf: false })) as typeof rows);
  assert.equal(noneSelf, instructorHtml, "an unmarked trainee row rendered differently");
});

test("7b. no display name is compared, anywhere, for any purpose", () => {
  for (const token of [
    "participantName ===",
    "participantName ==",
    ".includes(row.participantName",
    "localeCompare",
    "viewerName",
    "myName",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer matches by ${token}`);
  }
});

test("7c. the derived singular pairing field is not read at all", () => {
  assert.equal(
    /pairedParticipantName\b(?!s)/.test(SOURCE_CODE),
    false,
    "the renderer reads the derived singular pairing field",
  );
});

test("7d. the renderer is read-only: no state, no handler, no form control", () => {
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
// 8. The approved Hebrew labels are exactly these
// ===========================================================================

test("8. the approved Hebrew labels are present, verbatim", () => {
  for (const label of [
    `EXAMINEE: "${EXAMINEE_ROLE_LABEL}"`,
    `INSTRUCTED_TRAINEE: "${INSTRUCTED_ROLE_LABEL}"`,
    `const INSTRUCTED_TRAINEE_LABEL = "${INSTRUCTED_LIST_LABEL}"`,
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
// 9. Mobile-safe layout: stacked on a phone, two columns on a desktop
// ===========================================================================

test("9. parallel units stack on mobile and sit side by side from `sm` up", () => {
  const html = render([examinee({ participantName: "דנה" }), examinee({ participantName: "רון" })]);
  assert.ok(html.includes("grid-cols-1"), "the units do not stack on a phone");
  assert.ok(html.includes("sm:grid-cols-2"), "the units never reach two columns");
});

test("9b. nothing is fixed-width, and nothing can overflow sideways", () => {
  for (const token of ["<table", "<thead", "<tbody", "<tr", "<td", "overflow-x", "min-w-["]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the layout uses ${token}`);
  }
  assert.ok(SOURCE_CODE.includes("flex-wrap"), "the detail row does not wrap");
  assert.ok(SOURCE_CODE.includes("flex-col"), "the waves are not stacked");
});
