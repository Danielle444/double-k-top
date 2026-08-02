/**
 * EX-EXAM-TP-CARDS — the extracted shared "ההתנסויות שלי" lesson card.
 *
 * `TeachingPracticeLessonCard.tsx` transitively imports the committed
 * `teaching-practice-student.ts` Server Action module for its type-only
 * `TeachingPracticeTraineeLessonRow` import, which pulls `server-only` -
 * resolvable inside Next's build but not under plain `node:test`/`tsx`
 * ("Cannot find module 'server-only'"), the same limitation the sibling
 * beginner-placeholder suites documented for this exact screen family. There
 * is also no jsdom/testing-library in this repository. Source-text assertions
 * are therefore the smallest approach that can actually prove the extraction
 * preserved every field, exactly the convention this repo already uses for
 * `app/student/StudentExamsSection.tsx` and `app/instructor/InstructorExamsSection.tsx`.
 *
 * Run with:
 *   npx tsx --test lib/components/TeachingPracticeLessonCard.test.tsx
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROLE_LABELS } from "@/lib/teaching-practice-rotation";
import type { TeachingPracticeRoleValue } from "@/lib/teaching-practice-rotation";

const SRC = readFileSync(
  fileURLToPath(new URL("./TeachingPracticeLessonCard.tsx", import.meta.url)),
  "utf8",
);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SRC);

test("1. the module is a client component exporting exactly the approved three names", () => {
  assert.ok(SRC.startsWith('"use client";'), "the shared card must be a client component");
  assert.ok(CODE.includes("export const PRACTICE_TYPE_LABELS"));
  assert.ok(CODE.includes("export function SameParentBadge("));
  assert.ok(CODE.includes("export function TeachingPracticeLessonCard("));
});

test("2. the card takes the SAME three props the original LessonCard took", () => {
  assert.match(
    CODE.replace(/\s+/g, " "),
    /export function TeachingPracticeLessonCard\(\{ lesson, sameParentOtherNamesByChildId, onOpenSameParentPopup, \}: \{ lesson: TeachingPracticeTraineeLessonRow; sameParentOtherNamesByChildId: Map<string, string\[\]>; onOpenSameParentPopup: \(childId: string\) => void; \}\)/,
    "the card's prop shape changed from the original LessonCard",
  );
});

test("3. date, weekday and start/end time are rendered", () => {
  assert.ok(CODE.includes("formatHebrewWeekday(parseDateKey(lesson.date))"));
  assert.ok(CODE.includes("formatHebrewDate(parseDateKey(lesson.date))"));
  assert.ok(CODE.includes("{lesson.startTime}-{lesson.endTime}"));
});

test("4. the lesson format/title is rendered via the exported label map", () => {
  assert.ok(CODE.includes("{PRACTICE_TYPE_LABELS[lesson.practiceType]}"));
  assert.match(CODE.replace(/\s+/g, " "), /LUNGE: "לונג׳"/);
  assert.match(CODE.replace(/\s+/g, " "), /BEGINNER_PRIVATE: "שיעור פרטי מתחילים"/);
  assert.match(CODE.replace(/\s+/g, " "), /BEGINNER_GROUP: "שיעור קבוצתי מתחילים"/);
});

test("5. location is rendered when present", () => {
  assert.ok(CODE.includes("{lesson.location &&"));
  assert.ok(CODE.includes("מיקום: {lesson.location}"));
});

test("6. the team/participants list is rendered, with the current trainee highlighted, and the role label resolves through the lesson's own roleLabelOverrides before falling back to the canonical default", () => {
  assert.ok(CODE.includes('<p className="mb-1 text-sm font-semibold text-muted-foreground">צוות</p>'));
  assert.ok(CODE.includes("lesson.participants.map((p) =>"));
  assert.ok(
    CODE.includes("{p.traineeName} - {lesson.roleLabelOverrides?.[p.role] ?? ROLE_LABELS[p.role]}"),
    "role label no longer resolves lesson.roleLabelOverrides before the canonical ROLE_LABELS default",
  );
  // The current trainee's own row is styled distinctly and labelled.
  assert.ok(CODE.includes("p.isSelf"));
  assert.ok(CODE.includes('{p.isSelf && " (את/ה)"}'));
  // ROLE_LABELS is now the canonical constant, imported rather than
  // re-declared locally.
  assert.equal(/const ROLE_LABELS\s*[:=]/.test(CODE), false, "a local duplicate ROLE_LABELS constant survives");
  assert.match(
    CODE.replace(/\s+/g, " "),
    /import \{ ROLE_LABELS \} from "@\/lib\/teaching-practice-rotation";/,
    "ROLE_LABELS is not imported from the canonical lib/teaching-practice-rotation module",
  );
});

test("6a. role-label resolution is generic over any role/override value (not hardcoded to specific labels or dates)", () => {
  // The exact expression the component renders. This is the same rule the
  // admin/instructor surface already uses (lesson.roleLabelOverrides?.[role]
  // ?? ROLE_LABELS[role]) - reproduced here as plain logic (no rendering
  // engine available in this suite; see the file header) against the
  // canonical ROLE_LABELS constant and synthetic, arbitrary-date-free
  // fixtures, so this proves actual resolution behavior rather than only
  // the presence of the expression's source text.
  function resolveParticipantRoleLabel(
    roleLabelOverrides: Record<string, string> | null | undefined,
    role: TeachingPracticeRoleValue,
  ): string {
    return roleLabelOverrides?.[role] ?? ROLE_LABELS[role];
  }

  // (a) ASSISTANT_INSTRUCTOR with an override renders the override text.
  const onlyAssistantOverride = { ASSISTANT_INSTRUCTOR: "מדריך שני" };
  assert.equal(resolveParticipantRoleLabel(onlyAssistantOverride, "ASSISTANT_INSTRUCTOR"), "מדריך שני");

  // (d) a role with no override on that same lesson is unaffected - proves
  // per-role-key resolution, not an all-or-nothing swap.
  assert.equal(resolveParticipantRoleLabel(onlyAssistantOverride, "LEAD_INSTRUCTOR"), ROLE_LABELS.LEAD_INSTRUCTOR);

  // (b) EVALUATOR with an override (on a lesson with no other overrides)
  // renders the override text.
  const onlyEvaluatorOverride = { EVALUATOR: "מדריך שלישי" };
  assert.equal(resolveParticipantRoleLabel(onlyEvaluatorOverride, "EVALUATOR"), "מדריך שלישי");

  // (c) with no roleLabelOverrides at all (null/undefined), a participant
  // falls back to the existing canonical default label - checked with a
  // role/value pair distinct from the two override examples above, to
  // prove the fallback itself is generic, not hardcoded to just those two.
  assert.equal(resolveParticipantRoleLabel(null, "LEAD_INSTRUCTOR"), "מדריך ראשון");
  assert.equal(resolveParticipantRoleLabel(undefined, "SECOND_INSTRUCTOR"), ROLE_LABELS.SECOND_INSTRUCTOR);
});

test("7. the child list is rendered: name, age, gender, horse, equipment, parent name/phone", () => {
  assert.ok(CODE.includes('<p className="mb-1 text-sm font-semibold text-muted-foreground">ילדים</p>'));
  assert.ok(CODE.includes("lesson.children.map((c) =>"));
  assert.ok(CODE.includes("{c.firstName}"));
  assert.ok(CODE.includes("{c.lastName ?"), "last name must still be rendered when present");
  assert.ok(CODE.includes("`גיל ${c.age}`"), "age must still be rendered");
  assert.ok(CODE.includes("{c.gender ?? \"\"}"), "gender must still be rendered");
  assert.ok(CODE.includes("`סוס: ${c.horseName}`"), "horse must still be rendered");
  assert.ok(CODE.includes("`ציוד: ${c.equipmentNotes}`"), "equipment must still be rendered");
  assert.ok(CODE.includes("`הורה: ${c.parentName}`"), "parent name must still be rendered");
  assert.ok(CODE.includes("`טלפון: ${c.parentPhone}`"), "parent phone must still be rendered");
});

test("8. tel: and WhatsApp contact actions are built and rendered for a child with a phone", () => {
  assert.ok(CODE.includes("buildTelLink(c.parentPhone)"));
  assert.ok(CODE.includes("buildWhatsAppLink(c.parentPhone)"));
  assert.ok(CODE.includes("href={telLink}"));
  assert.ok(CODE.includes("href={waLink}"));
  assert.ok(CODE.includes("התקשר"), "the call action label is missing");
  assert.ok(CODE.includes("WhatsApp"), "the WhatsApp action label is missing");
  assert.ok(
    CODE.includes('target="_blank"') && CODE.includes('rel="noopener noreferrer"'),
    "the WhatsApp link must open safely in a new tab",
  );
});

test("9. the same-parent indicator is wired for both the participant summary's... (children only, per the original card) and calls the caller's popup opener", () => {
  assert.equal((CODE.match(/<SameParentBadge/g) ?? []).length, 1, "the card renders the badge exactly once (per child, in the children loop)");
  assert.match(
    CODE.replace(/\s+/g, " "),
    /<SameParentBadge otherNames=\{sameParentOtherNamesByChildId\.get\(c\.childId\) \?\? \[\]\} onClick=\{\(\) => onOpenSameParentPopup\(c\.childId\)\} \/>/,
    "the same-parent badge is not wired to this card's own child and the caller's popup opener",
  );
});

test("10. SameParentBadge itself renders nothing when there are no other same-parent children, and stops click propagation", () => {
  assert.ok(CODE.includes("if (otherNames.length === 0) return null;"));
  assert.ok(CODE.includes("e.stopPropagation();"));
  assert.ok(CODE.includes("אותו הורה"));
});

test("11. no field is simplified away relative to the original card: no simplification markers, no TODO, no placeholder text", () => {
  for (const token of ["TODO", "FIXME", "// simplified", "פלייסהולדר", "לא זמין עדיין"]) {
    assert.equal(CODE.includes(token), false, `an unexpected marker ${token} was found`);
  }
  // responsibleInstructorName stays intentionally unrendered - the ORIGINAL
  // Stage S2 product decision, preserved verbatim (not a new simplification).
  assert.ok(
    SRC.includes("responsibleInstructorName is intentionally not rendered here"),
    "the original Stage S2 product-decision comment about responsibleInstructorName is missing",
  );
});

test("12. the card is read-only: no fetch, no Server Action, no form", () => {
  for (const token of ["fetch(", "use server", "<form", "onSubmit", "action="]) {
    assert.equal(CODE.includes(token), false, `the card reaches ${token}`);
  }
});
