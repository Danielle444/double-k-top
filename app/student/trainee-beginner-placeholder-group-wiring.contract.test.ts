/**
 * A3 — the trainee "מבחנים" screen's static beginner Teaching-Practice
 * placeholders must be scoped to the trainee's OWN group ("א"/"ב"), using the
 * value already carried on the signed-in trainee's session
 * (`StoredSession.groupName` - the same "א"/"ב"/null the schedule/Teaching-
 * Practice surfaces already key off, see `lib/trainee-history/normalize-group.ts`).
 * No new database read is introduced: StudentClient.tsx already holds this
 * value in `session.groupName` and this slice only threads it down as a prop.
 *
 * The component-internal gating (which card renders for which groupName, in
 * both "לו״ז שלי" and "לפי תאריך") is covered by
 * lib/components/StudentExamsSectionBeginnerPlaceholder.test.tsx. This file
 * covers the OTHER half of the contract: that the value handed to the
 * component really is the trainee's own already-loaded session field, not a
 * new fetch and not a hardcoded/guessed value.
 *
 * Neither StudentClient.tsx nor StudentExamsSection.tsx can be imported in
 * node:test (server-only chain), so this checks the wiring at the source
 * level, the same established convention as the sibling contract tests.
 *
 * Run with:
 *   npx tsx --test app/student/trainee-beginner-placeholder-group-wiring.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const CLIENT = readSource("./StudentClient.tsx");
const SECTION = readSource("./StudentExamsSection.tsx");

test("1. the exams tab passes the trainee's OWN already-loaded session groupName - no new prop invented, no id", () => {
  assert.ok(
    CLIENT.includes('{activeTab === "exams" && <StudentExamsSection groupName={session.groupName} />}'),
    "StudentClient must pass session.groupName straight through to StudentExamsSection",
  );
});

test("2. StoredSession already carries groupName - this slice reuses it rather than adding a fetch", () => {
  const start = CLIENT.indexOf("interface StoredSession");
  assert.notEqual(start, -1);
  const block = CLIENT.slice(start, CLIENT.indexOf("}", start));
  assert.ok(block.includes("groupName: string | null;"), "StoredSession.groupName must already exist");
  // No new Server Action / fetch call was added to source the group value.
  assert.equal(
    /getTraineeGroup|getStudentGroup|fetchGroupName/.test(CLIENT),
    false,
    "no new group-fetching call may be introduced - the existing session field must be reused",
  );
});

test("3. StudentExamsSection's groupName prop type matches the session field's type exactly", () => {
  assert.ok(
    SECTION.includes(
      "export function StudentExamsSection({ groupName }: { groupName: string | null }) {",
    ),
    "the prop type must match StoredSession.groupName (string | null)",
  );
});

test("4. group filtering compares only the canonical group codes, never a display name or free text", () => {
  for (const forbidden of ["fullName", "displayName", "groupLabel", ".includes(fullName"]) {
    assert.equal(SECTION.includes(forbidden), false, `must not reference ${forbidden}`);
  }
  assert.ok(SECTION.includes('groupName === "א"'));
  assert.ok(SECTION.includes('groupName === "ב"'));
});
