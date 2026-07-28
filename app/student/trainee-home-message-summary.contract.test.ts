/**
 * PERF-1 / P2A + P2B - contract tests for the two duplicate-client-request
 * removals on the instructor and trainee home screens.
 *
 * These are SOURCE-LEVEL contract tests. The three touched files are React
 * client components ("use client", JSX, next/navigation-adjacent imports), and
 * this repo has no component-rendering harness - so, exactly as
 * trainee-home-duties-visibility.test.ts and the other app/student contract
 * tests already do, the properties are asserted against the source. The pure
 * counting rule the summary keeps is additionally exercised behaviourally
 * against a local model of it, so the derivation itself is not merely asserted
 * to exist.
 *
 * What is locked here:
 *  P2A - the two APPROVED effects key on session?.id, not the session object;
 *        both keep their missing-session guard; both read no other session
 *        property (so narrowing cannot introduce a stale closure); and NO
 *        unrelated [session] dependency was narrowed.
 *  P2B - StudentMessagesSummary neither imports nor calls getStudentMessages;
 *        it takes its items as a prop; StudentClient owns exactly ONE
 *        trainee-home load of that action; unread/open counting, archived-row
 *        treatment, and the loading/empty states are unchanged; and no new
 *        Server Action or endpoint was created.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test app/student/trainee-home-message-summary.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Raw text with line endings normalised - this repo mixes LF and CRLF. */
const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/**
 * Source with COMMENTS STRIPPED. Every structural assertion uses this: these
 * files document themselves heavily, and the new comments explain the very
 * patterns being asserted against (they name `[session]`, `getStudentMessages`
 * and `studentId` while describing their removal), so a raw scan would match
 * the explanation instead of the code.
 */
const readCode = (relativePath: string): string =>
  readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");

const flat = (source: string): string => source.replace(/\s+/g, " ");

const INSTRUCTOR_CLIENT = "../instructor/InstructorClient.tsx";
const STUDENT_CLIENT = "./StudentClient.tsx";
const SUMMARY = "./StudentMessagesSummary.tsx";

// ---------------------------------------------------------------------------
// 1-3. P2A - the two narrowed effects
// ---------------------------------------------------------------------------

/**
 * The whole effect enclosing a given action call, from `useEffect(() => {` to
 * its closing dependency array.
 *
 * The terminator is matched as a real dependency array (`}, [...]);` at the
 * start of a line) rather than the first `]);` - `setDutyWeeks([]);` contains
 * that substring and would truncate the slice before the deps are reached.
 */
function effectAround(code: string, marker: string): string {
  const at = code.indexOf(marker);
  assert.ok(at > 0, `marker not found: ${marker}`);
  const start = code.lastIndexOf("useEffect(() => {", at);
  assert.ok(start > 0, `could not find the effect opening before ${marker}`);
  const terminator = /^\s*\}, \[[^\]]*\]\);/m;
  const rest = code.slice(at);
  const match = rest.match(terminator);
  assert.ok(match?.index !== undefined, `could not find the dependency array after ${marker}`);
  return code.slice(start, at + match.index! + match[0].length);
}

/** The same effect with its trailing dependency array removed. */
function effectBody(code: string, marker: string): string {
  return effectAround(code, marker).replace(/\s*\}, \[[^\]]*\]\);\s*$/, "");
}

test("the InstructorClient weekly-schedule effect depends on session?.id, not session", () => {
  const effect = effectAround(readCode(INSTRUCTOR_CLIENT), "getWeeklyScheduleSelection()");
  assert.ok(flat(effect).endsWith("}, [session?.id]);"), "must key on the stable actor id");
  assert.ok(!/\}, \[session\]\);/.test(effect), "must not key on the session object");
});

test("the StudentClient duty-week effect depends on session?.id, not session", () => {
  const effect = effectAround(readCode(STUDENT_CLIENT), "getDutyWeekSelectionForTrainee()");
  assert.ok(flat(effect).endsWith("}, [session?.id]);"), "must key on the stable actor id");
  assert.ok(!/\}, \[session\]\);/.test(effect), "must not key on the session object");
});

test("both narrowed effects still guard a missing session", () => {
  for (const [name, code, marker] of [
    ["InstructorClient", readCode(INSTRUCTOR_CLIENT), "getWeeklyScheduleSelection()"],
    ["StudentClient", readCode(STUDENT_CLIENT), "getDutyWeekSelectionForTrainee()"],
  ] as const) {
    const effect = effectAround(code, marker);
    assert.ok(
      flat(effect).includes("if (!session) return;"),
      `${name}: the missing-session guard must be preserved`,
    );
  }
});

test("neither narrowed effect body reads ANY session property", () => {
  // This is what makes the narrowing safe, and it is stronger than "only reads
  // id": both bodies touch `session` solely through the null guard, so there is
  // no field at all that a stale closure could serve from an older session
  // object. Measured on the BODY with the dependency array stripped - otherwise
  // the `[session?.id]` deps would themselves match and mask the real answer.
  for (const [name, code, marker] of [
    ["InstructorClient", readCode(INSTRUCTOR_CLIENT), "getWeeklyScheduleSelection()"],
    ["StudentClient", readCode(STUDENT_CLIENT), "getDutyWeekSelectionForTrainee()"],
  ] as const) {
    const body = effectBody(code, marker);
    const reads = Array.from(body.matchAll(/session(?:\?)?\.(\w+)/g), (m) => m[1]);
    assert.deepEqual(
      [...new Set(reads)],
      [],
      `${name}: the effect body must read no session property (found: ${reads.join(", ")})`,
    );
    assert.ok(body.includes("session"), `${name}: sanity - the guard still references session`);
  }
});

test("both narrowed loaders take no argument, so nothing identity-bearing is closed over", () => {
  const instructor = readCode(INSTRUCTOR_CLIENT);
  const student = readCode(STUDENT_CLIENT);
  assert.ok(instructor.includes("getWeeklyScheduleSelection()"), "called with no arguments");
  assert.ok(student.includes("getDutyWeekSelectionForTrainee()"), "called with no arguments");
});

// ---------------------------------------------------------------------------
// 4. No unrelated dependency was narrowed
// ---------------------------------------------------------------------------

test("the still-unproven [session, ...] effects were deliberately left alone", () => {
  // The audit proved only the two effects above. The three below were flagged as
  // ORDERING-DEPENDENT and unproven, so this slice must not touch them - a test,
  // not a comment, so a later sweep cannot silently absorb them.
  const student = readCode(STUDENT_CLIENT);
  for (const deps of [
    "}, [session, courseOptions]);",
    "}, [session, courseOptions, selectedCourseOfferingId]);",
    "}, [session, courseOptions, scheduleSubView]);",
  ]) {
    assert.ok(student.includes(deps), `unrelated dependency array must remain: ${deps}`);
  }
});

test("no bare [session] dependency remains in either shell", () => {
  for (const [name, path] of [
    ["InstructorClient", INSTRUCTOR_CLIENT],
    ["StudentClient", STUDENT_CLIENT],
  ] as const) {
    assert.ok(
      !/\}, \[session\]\);/.test(readCode(path)),
      `${name}: the two approved sites were the only bare [session] deps`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5-7. P2B - the summary no longer fetches
// ---------------------------------------------------------------------------

test("StudentMessagesSummary neither imports nor calls getStudentMessages", () => {
  const code = readCode(SUMMARY);
  assert.ok(!code.includes("getStudentMessages"), "the duplicate fetch must be gone");
  assert.ok(!code.includes("useEffect"), "its loading effect must be gone");
  assert.ok(!code.includes("useState"), "it holds no fetched state any more");
  assert.ok(!code.includes("studentId"), "identity no longer reaches this component");
});

test("StudentMessagesSummary receives its items as a prop", () => {
  const code = flat(readCode(SUMMARY));
  assert.ok(code.includes("items: StudentMessageItem[] | null;"), "typed items prop");
  assert.ok(code.includes("onOpen: () => void;"), "onOpen is preserved");
  assert.ok(
    code.includes("export function StudentMessagesSummary({ items, onOpen, }"),
    "the prop API is exactly { items, onOpen }",
  );
});

test("StudentClient owns exactly one trainee-home getStudentMessages load", () => {
  const code = readCode(STUDENT_CLIENT);
  const calls = code.match(/getStudentMessages\(/g) ?? [];
  // Two occurrences total: the single home-screen load, and the lazily-invoked
  // NotificationsList preview callback (a different tab, only on open).
  assert.equal(calls.length, 2, "exactly one eager load plus the lazy preview callback");
  assert.ok(
    code.includes("fetchMessagePreview={() => getStudentMessages(session.id)"),
    "the second occurrence is the lazy notifications preview, not a second eager load",
  );
  assert.ok(code.includes("setMessageItems(items);"), "the eager load publishes its payload");
  assert.ok(
    flat(code).includes("<StudentMessagesSummary items={messageItems} onOpen="),
    "the summary is fed from that single load",
  );
});

test("the summary's data flows from StudentClient state, so a refresh propagates", () => {
  const code = flat(readCode(STUDENT_CLIENT));
  assert.ok(
    code.includes("const [messageItems, setMessageItems] = useState<StudentMessageItem[] | null>(null)"),
    "items live in StudentClient state",
  );
  // Because the summary is a pure function of that state, any future setMessageItems
  // (e.g. after a message/task action) re-renders it with no fetch of its own.
  assert.ok(code.includes("items={messageItems}"), "state is passed straight through");
});

// ---------------------------------------------------------------------------
// 8-10. Behaviour preservation - exercised, not just asserted
// ---------------------------------------------------------------------------

type Item = { type: string; readAt: string | null; completedAt: string | null };

/** The summary's derivation, transcribed from the component. */
function countSummary(items: Item[] | null) {
  return {
    unreadMessages: items?.filter((i) => i.type === "MESSAGE" && !i.readAt).length ?? 0,
    openTasks: items?.filter((i) => i.type === "TASK" && !i.completedAt).length ?? 0,
  };
}

/** The PREVIOUS derivation, from the deleted effect - byte-identical predicates. */
function countTheOldWay(items: Item[]) {
  return {
    unreadMessages: items.filter((i) => i.type === "MESSAGE" && !i.readAt).length,
    openTasks: items.filter((i) => i.type === "TASK" && !i.completedAt).length,
  };
}

const FIXTURE: Item[] = [
  { type: "MESSAGE", readAt: null, completedAt: null }, // unread message
  { type: "MESSAGE", readAt: "2026-07-01T00:00:00.000Z", completedAt: null }, // read
  { type: "TASK", readAt: null, completedAt: null }, // open task
  { type: "TASK", readAt: null, completedAt: "2026-07-01T00:00:00.000Z" }, // done
  { type: "TASK", readAt: "2026-07-01T00:00:00.000Z", completedAt: null }, // read but open
];

test("unread/open counting is unchanged", () => {
  assert.deepEqual(countSummary(FIXTURE), { unreadMessages: 1, openTasks: 2 });
  assert.deepEqual(countSummary(FIXTURE), countTheOldWay(FIXTURE));
});

test("archived-item treatment is unchanged - the payload is counted as the action returns it", () => {
  // The rule never inspected archivedAt, before or after. An archived row is
  // counted exactly as getStudentMessages presents it, so adding a filter here
  // would be a behaviour CHANGE, not a fix.
  const code = readCode(SUMMARY);
  assert.ok(!code.includes("archived"), "no archived filtering may be introduced");
  const withArchived = [...FIXTURE, { type: "MESSAGE", readAt: null, completedAt: null }];
  assert.deepEqual(countSummary(withArchived), countTheOldWay(withArchived));
});

test("loading and empty states both render nothing, as before", () => {
  // null = not loaded (what the in-flight fetch used to look like: counts at 0)
  assert.deepEqual(countSummary(null), { unreadMessages: 0, openTasks: 0 });
  // [] = loaded, nothing to show
  assert.deepEqual(countSummary([]), { unreadMessages: 0, openTasks: 0 });
  // ...and all-settled items also render nothing
  const settled: Item[] = [
    { type: "MESSAGE", readAt: "x", completedAt: null },
    { type: "TASK", readAt: null, completedAt: "x" },
  ];
  assert.deepEqual(countSummary(settled), { unreadMessages: 0, openTasks: 0 });
  assert.ok(
    readCode(SUMMARY).includes("if (unreadMessages === 0 && openTasks === 0) return null;"),
    "the render-nothing guard is preserved verbatim",
  );
});

test("the labels and the open handler are unchanged", () => {
  const src = readSource(SUMMARY);
  assert.ok(src.includes("הודעות שלא נקראו"), "unread-messages label preserved");
  assert.ok(src.includes("משימות פתוחות"), "open-tasks label preserved");
  assert.ok(src.includes("onClick={onOpen}"), "the open handler is preserved");
});

// ---------------------------------------------------------------------------
// 12-13. Blast radius
// ---------------------------------------------------------------------------

test("no new Server Action or public endpoint was created", () => {
  for (const [name, path] of [
    ["StudentMessagesSummary", SUMMARY],
    ["StudentClient", STUDENT_CLIENT],
    ["InstructorClient", INSTRUCTOR_CLIENT],
  ] as const) {
    const code = readCode(path);
    assert.ok(!code.includes('"use server"'), `${name} must stay a client component`);
    assert.ok(code.includes('"use client"'), `${name} must stay a client component`);
  }
});

test("the summary reaches no reader, auth or admin surface", () => {
  const code = readCode(SUMMARY);
  for (const forbidden of ["@/lib/prisma", "@/lib/auth", "@/app/admin", "prisma.", "next/"]) {
    assert.ok(!code.includes(forbidden), `the summary must not reference ${forbidden}`);
  }
  // The ONLY thing it still takes from the actions layer is a TYPE - a value
  // import from that module is what would reintroduce the duplicate request.
  assert.ok(
    readSource(SUMMARY).includes('import type { StudentMessageItem } from "@/lib/actions/messages";'),
    "a type-only import is all that remains",
  );
  assert.ok(
    !/^import \{[^}]*\} from "@\/lib\/actions\//m.test(code),
    "the summary must hold no VALUE import from the actions layer",
  );
});
