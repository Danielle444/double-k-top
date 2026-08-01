/**
 * EX-BEGINNER-EXAM-UI — REAL RENDER TESTS for the shared compact beginner
 * presentation.
 *
 * The component's only import is the PURE sibling view core, so it renders with
 * react-dom/server in a plain `tsx --test` process. NO DATABASE, NO NETWORK, NO
 * SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/ExamBeginnerRows.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { ExamBeginnerRows } from "./ExamBeginnerRows";
import type {
  ExamBeginnerChildView,
  ExamBeginnerDetailView,
} from "./exam-schedule-view-core";

const SOURCE = readFileSync(
  fileURLToPath(new URL("./ExamBeginnerRows.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const SOURCE_CODE = stripComments(SOURCE);

function child(overrides: Partial<ExamBeginnerChildView> = {}): ExamBeginnerChildView {
  return {
    childKey: "c0",
    fullName: "נועם ברק",
    age: 7,
    gender: "בן",
    childNotes: "מתחיל להרגיש בנוח",
    parentName: "רונית ברק",
    parentPhone: "050-1234567",
    horseName: "רקיע",
    equipmentNotes: "קסדה קטנה",
    isAbsent: false,
    ...overrides,
  };
}

function detail(overrides: Partial<ExamBeginnerDetailView> = {}): ExamBeginnerDetailView {
  return {
    beginnerFormat: "BEGINNER_GROUP",
    groupName: "קבוצה א",
    location: "אולם",
    responsibleInstructorName: "שירה כהן",
    participantNames: ["דנה כהן", "יעל לוי"],
    participantCount: 2,
    children: [child()],
    ...overrides,
  };
}

function render(
  props: {
    detail?: ExamBeginnerDetailView | null;
    showOperationalDetail?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    <ExamBeginnerRows
      detail={props.detail === undefined ? detail() : props.detail}
      showOperationalDetail={props.showOperationalDetail}
    />,
  );
}

// ===========================================================================
// 1. The source is stated, and the row is unmistakably a beginner row
// ===========================================================================

test("1. the Teaching-Practice beginner source is named on every beginner row", () => {
  assert.ok(render().includes("התנסות מתחילים"), "the source is not stated");
});

test("1b. the beginner FORMAT is shown, in Hebrew", () => {
  assert.ok(render().includes("מתחילים קבוצתי"));
  assert.ok(render({ detail: detail({ beginnerFormat: "LUNGE" }) }).includes("לונג"));
  assert.ok(
    render({ detail: detail({ beginnerFormat: "BEGINNER_PRIVATE" }) }).includes("מתחילים פרטני"),
  );
});

test("1c. an unrecognised format still renders the row, and never a wrong label", () => {
  const html = render({
    detail: detail({ beginnerFormat: "SOMETHING_NEW" as ExamBeginnerDetailView["beginnerFormat"] }),
  });
  assert.ok(html.includes("התנסות מתחילים"), "an unknown format hid the row");
  for (const label of ["לונג", "מתחילים פרטני", "מתחילים קבוצתי"]) {
    assert.equal(html.includes(label), false, `an unknown format was labelled ${label}`);
  }
});

// ===========================================================================
// 2. NO fake advanced roles
// ===========================================================================

test("2. the lesson's people are PARTICIPANTS — never examinees, never instructed trainees", () => {
  const html = render();
  assert.ok(html.includes("מתאמנים"), "the participants have no label");
  assert.ok(html.includes("דנה כהן") && html.includes("יעל לוי"), "a participant is missing");
  for (const roleLabel of ["נבחן", "נבחנים", "חניך מודרך", "חניכים מודרכים", "חניכים מדריכים"]) {
    assert.equal(html.includes(roleLabel), false, `a beginner row was given the role ${roleLabel}`);
  }
  // ...and the two advanced role tokens are not even representable here.
  for (const token of ["EXAMINEE", "INSTRUCTED_TRAINEE", "examineeNames", "instructedTraineeNames"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer names ${token}`);
  }
});

test("2b. the AUTHORITATIVE count stands in when a name could not be resolved", () => {
  const html = render({ detail: detail({ participantNames: [], participantCount: 3 }) });
  assert.ok(html.includes("מתאמנים"), "the participant line vanished with the names");
  assert.ok(html.includes("3"), "the authoritative count is not shown");
});

test("2c. a lesson with NO participants gets no participant line at all", () => {
  const html = render({ detail: detail({ participantNames: [], participantCount: 0 }) });
  assert.equal(html.includes("מתאמנים"), false, "an empty participant heading was printed");
});

// ===========================================================================
// 3. The committed child / parent visibility decision is preserved
// ===========================================================================

test("3. every carried child value is shown, contact detail included", () => {
  const html = render();
  for (const value of [
    "נועם ברק",
    "7",
    "בן",
    "רקיע",
    "קסדה קטנה",
    "מתחיל להרגיש בנוח",
    "רונית ברק",
    "050-1234567",
  ]) {
    assert.ok(html.includes(value), `the child value ${value} was hidden`);
  }
});

test("3b. the parent phone is rendered VERBATIM — never masked, reformatted or linkified", () => {
  const html = render({ detail: detail({ children: [child({ parentPhone: "+972 (50) 123-4567" })] }) });
  assert.ok(html.includes("+972 (50) 123-4567"), "the phone was rewritten");
  for (const token of ["tel:", "wa.me", "whatsapp", "href=", "<a "]) {
    assert.equal(html.includes(token), false, `the phone became a ${token} target`);
  }
  for (const token of ["replace(", "normalize", "slice(", "***"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer rewrites a value with ${token}`);
  }
});

test("3c. an ABSENT child is marked, and never dropped from the lesson", () => {
  const html = render({ detail: detail({ children: [child({ isAbsent: true })] }) });
  assert.ok(html.includes("נועם ברק"), "an absent child disappeared");
  assert.ok(html.includes("לא נוכח/ת"), "an absent child is not marked");
});

test("3d. an absent value renders NO line rather than an empty placeholder", () => {
  const html = render({
    detail: detail({
      children: [
        child({
          age: null,
          gender: null,
          childNotes: null,
          parentName: null,
          parentPhone: null,
          horseName: null,
          equipmentNotes: null,
        }),
      ],
    }),
  });
  assert.ok(html.includes("נועם ברק"), "the child disappeared with its optional values");
  for (const label of ["סוס", "ציוד", "הורה", "טלפון"]) {
    assert.equal(html.includes(label), false, `${label} was printed with no value behind it`);
  }
  assert.equal(html.includes("—"), false, "an em-dash placeholder was invented");
});

test("3e. the group and the responsible instructor are shown when carried", () => {
  const html = render();
  assert.ok(html.includes("קבוצה א"), "the group name was dropped");
  assert.ok(html.includes("שירה כהן"), "the responsible instructor was dropped");
  const bare = render({ detail: detail({ groupName: null, responsibleInstructorName: null }) });
  assert.ok(bare.includes("התנסות מתחילים"), "the row vanished with its optional values");
});

// ===========================================================================
// 4. Date and time are printed ONCE — by the card, not here
// ===========================================================================

test("4. no date and no time is rendered by the beginner detail", () => {
  const html = render();
  assert.equal(/\d{2}:\d{2}/.test(html), false, "a time was printed a second time");
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(html), false, "a raw date token was printed");
  // ...and none is even reachable: the detail type carries neither.
  for (const token of ["startTime", "endTime", "displayEndTime", "row.date", "formatHebrewDate"]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer reaches ${token}`);
  }
});

// ===========================================================================
// 5. Operational detail is behind an explicit opt-in
// ===========================================================================

test("5. lesson notes and lesson publication state are shown to the operational view", () => {
  const html = render({
    detail: detail({ notes: "להביא אוכף קטן", isPublished: true, practiceType: "BEGINNER_GROUP" }),
    showOperationalDetail: true,
  });
  assert.ok(html.includes("להביא אוכף קטן"), "the lesson notes were dropped");
  assert.ok(html.includes("שיעור מפורסם"), "the lesson publication state was dropped");
});

test("5b. a DRAFT lesson says so rather than reading as a final one", () => {
  const html = render({
    detail: detail({ isPublished: false }),
    showOperationalDetail: true,
  });
  assert.ok(html.includes("שיעור בטיוטה"));
  assert.equal(html.includes("שיעור מפורסם"), false);
});

test("5c. WITHOUT the opt-in, no operational value can appear", () => {
  // The trainee contract does not carry these at all; the flag is the SECOND
  // independent reason a trainee can never be shown them.
  const html = render({
    detail: detail({ notes: "להביא אוכף קטן", isPublished: false, practiceType: "BEGINNER_GROUP" }),
  });
  assert.equal(html.includes("להביא אוכף קטן"), false, "lesson notes leaked to a trainee");
  assert.equal(html.includes("שיעור בטיוטה"), false, "lesson publication state leaked to a trainee");
  assert.equal(html.includes("שיעור מפורסם"), false, "lesson publication state leaked to a trainee");
});

test("5d. a trainee row that carries no operational field renders fine", () => {
  const html = render({ detail: detail() });
  assert.ok(html.includes("התנסות מתחילים"));
  assert.equal(html.includes("undefined"), false, "an absent optional field reached the DOM");
});

// ===========================================================================
// 6. Empty and absent data is safe
// ===========================================================================

test("6. NO detail renders nothing at all", () => {
  assert.equal(render({ detail: null }), "", "a null detail rendered something");
  assert.equal(
    renderToStaticMarkup(<ExamBeginnerRows detail={undefined} />),
    "",
    "an undefined detail rendered something",
  );
});

test("6b. an empty children list prints no children heading and never throws", () => {
  const html = render({ detail: detail({ children: [] }) });
  assert.ok(html.includes("התנסות מתחילים"), "the row vanished with its children");
  assert.equal(html.includes("ילדים"), false, "an empty children heading was printed");
});

test("6c. malformed collections and counts never throw", () => {
  const broken = {
    beginnerFormat: "LUNGE",
    groupName: null,
    location: null,
    responsibleInstructorName: null,
    participantNames: null,
    participantCount: null,
    children: null,
  } as unknown as ExamBeginnerDetailView;
  const html = renderToStaticMarkup(<ExamBeginnerRows detail={broken} />);
  assert.ok(html.includes("התנסות מתחילים"), "a malformed detail lost its row");
  assert.equal(html.includes("NaN"), false, "a malformed count reached the DOM");
});

// ===========================================================================
// 7. READ-ONLY, and it asks for nothing
// ===========================================================================

test("7. there is no form, no control and no write of any kind", () => {
  for (const token of [
    "<form",
    "<input",
    "<button",
    "<select",
    "<textarea",
    "onSubmit",
    "onClick",
    "useActionState",
    "useTransition",
    "FormData",
    "action=",
    "teaching-practice",
    "TeachingPractice",
    "-write-",
    "createLesson",
    "updateLesson",
    "deleteLesson",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer adds ${token}`);
  }
});

test("7b. it issues no request, holds no state and names no server module", () => {
  const specifiers = [...SOURCE_CODE.matchAll(/from\s+"([^"]+)"/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(specifiers)], ["./exam-schedule-view-core"]);
  for (const token of [
    "useState",
    "useEffect",
    "useRef",
    "use server",
    "prisma",
    "fetch(",
    "exam-role-readers",
    "exam-read-dto",
    "exam-read-scope-core",
    "exam-read-io",
    "getTraineeExamDaySchedule",
    "getInstructorExamSchedule",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer reaches ${token}`);
  }
});

test("7c. no internal id is rendered, and the one key never reaches the DOM", () => {
  const html = render();
  assert.equal(html.includes("ca-1"), false, "a child assignment id was rendered");
  // EX-TRAINEE-ID-CONTAINMENT: `childAssignmentId` is REMOVED from the shared
  // view (it is not even representable), so the renderer cannot name it at all.
  for (const token of [
    "lessonId",
    "sessionId",
    "studentId",
    "traineeId",
    "childId",
    "planId",
    "childAssignmentId",
  ]) {
    assert.equal(SOURCE_CODE.includes(token), false, `the renderer reaches ${token}`);
  }
  // `childKey` — a POSITIONAL display key, not an identifier — is the ONLY React
  // list key, and appears exactly once.
  assert.ok(SOURCE_CODE.includes("key={child.childKey}"), "the list key is missing");
  assert.equal((SOURCE_CODE.match(/childKey/g) ?? []).length, 1);
  assert.equal(SOURCE_CODE.includes("JSON.stringify"), false, "a raw object can be rendered");
});
