/**
 * URGENT LEVEL 2 ACCESS - SLICE C0-A: tests for the PURE instructor CONTACT
 * course-options core, plus the DB-free IO orchestration seam (authorization
 * ordering + exact query shape).
 *
 * No Prisma, no DB, no clock, no randomness - every boundary is injected. These
 * lock the C0-A contract:
 *  - the menu contains EXACTLY the allow-listed offerings that actually exist;
 *  - an unknown row is dropped and a missing allowed offering is omitted, never
 *    fabricated or substituted;
 *  - the order is deterministic and carries no selection meaning;
 *  - labels/statuses come from the DB-backed row, composed server-side;
 *  - the actor guard is the FIRST awaited operation;
 *  - the query projects four columns and selects no date and no relation.
 *
 * Run with: npx tsx --test lib/course/instructor-offering-options-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildInstructorContactCourseOptions,
  composeInstructorCourseOptionLabel,
  listInstructorContactCourseOptionsWithDeps,
  type InstructorCourseOfferingOptionRow,
  type InstructorCourseOptionsDeps,
  type InstructorCourseOptionsQuery,
} from "./instructor-offering-options-core";
import { INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS } from "./temporary-level2-compatibility";

const L1 = "cmrqngqhn00017gcndjixzrh0";
const L2 = "cmrxk58vc0000lscnfm54bpze";
const ALLOWED = [L1, L2];

const OPTION_VIEW_KEYS = ["id", "label", "level", "status"].sort();

function row(
  overrides: Partial<InstructorCourseOfferingOptionRow> = {},
): InstructorCourseOfferingOptionRow {
  return {
    id: L1,
    name: "קורס מדריכים",
    level: 1,
    status: "ACTIVE",
    ...overrides,
  };
}

const L1_ROW = row();
const L2_ROW = row({ id: L2, name: "קורס מתקדמים", level: 2, status: "PLANNED" });

function makeDeps(
  overrides: Partial<InstructorCourseOptionsDeps> = {},
): InstructorCourseOptionsDeps {
  return {
    requireActiveInstructor: async () => ({ id: "instructor-1" }),
    allowedOfferingIds: ALLOWED,
    fetchOfferingRows: async () => [L1_ROW, L2_ROW],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Membership: exactly the allow-listed offerings that exist
// ---------------------------------------------------------------------------

test("both verified offerings are returned when both rows are present", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW, L2_ROW], ALLOWED);
  assert.deepEqual(
    options.map((o) => o.id),
    [L1, L2],
  );
});

test("an unknown row is dropped even if the query returned it", () => {
  const options = buildInstructorContactCourseOptions(
    [L1_ROW, row({ id: "some-other-offering", name: "קורס אחר", level: 3 }), L2_ROW],
    ALLOWED,
  );
  assert.deepEqual(
    options.map((o) => o.id),
    [L1, L2],
  );
});

test("a missing allowed offering is OMITTED, not fabricated", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW], ALLOWED);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, L1);
  assert.equal(
    options.some((o) => o.id === L2),
    false,
    "an absent offering must never be invented",
  );
});

test("no rows at all yields an empty menu (nothing selectable, no fallback)", () => {
  assert.deepEqual(buildInstructorContactCourseOptions([], ALLOWED), []);
});

test("an empty allow-list yields an empty menu (fail closed)", () => {
  assert.deepEqual(buildInstructorContactCourseOptions([L1_ROW, L2_ROW], []), []);
});

test("membership is EXACT string equality (no trimming, casing or prefix match)", () => {
  const options = buildInstructorContactCourseOptions(
    [row({ id: ` ${L1} ` }), row({ id: L1.toUpperCase() }), row({ id: L1.slice(0, 10) })],
    ALLOWED,
  );
  assert.deepEqual(options, []);
});

test("a duplicate id does not produce a duplicate option", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW, L1_ROW], ALLOWED);
  assert.deepEqual(
    options.map((o) => o.id),
    [L1],
  );
});

// ---------------------------------------------------------------------------
// Deterministic order (display only)
// ---------------------------------------------------------------------------

test("order is deterministic by level ascending regardless of input order", () => {
  const forwards = buildInstructorContactCourseOptions([L1_ROW, L2_ROW], ALLOWED);
  const backwards = buildInstructorContactCourseOptions([L2_ROW, L1_ROW], ALLOWED);
  assert.deepEqual(
    forwards.map((o) => o.id),
    [L1, L2],
  );
  assert.deepEqual(backwards, forwards, "input order must not affect the result");
});

test("equal levels tie-break on id ascending", () => {
  const a = row({ id: "aaa", level: 2 });
  const b = row({ id: "bbb", level: 2 });
  const options = buildInstructorContactCourseOptions([b, a], ["aaa", "bbb"]);
  assert.deepEqual(
    options.map((o) => o.id),
    ["aaa", "bbb"],
  );
});

test("order does not follow status: a PLANNED lower level still sorts first", () => {
  const planned = row({ id: "planned-1", level: 1, status: "PLANNED" });
  const active = row({ id: "active-2", level: 2, status: "ACTIVE" });
  const options = buildInstructorContactCourseOptions(
    [active, planned],
    ["planned-1", "active-2"],
  );
  assert.deepEqual(
    options.map((o) => o.id),
    ["planned-1", "active-2"],
  );
});

// ---------------------------------------------------------------------------
// Server-composed label + preserved status
// ---------------------------------------------------------------------------

test("the label contains the level and the DB-backed name", () => {
  const options = buildInstructorContactCourseOptions([L2_ROW], ALLOWED);
  assert.equal(options[0].label.includes("2"), true, "label must carry the level");
  assert.equal(
    options[0].label.includes("קורס מתקדמים"),
    true,
    "label must carry the DB-backed name",
  );
  assert.equal(options[0].label, "רמה 2 · קורס מתקדמים");
});

test("the label is composed from the row, never from the id", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW], ALLOWED);
  assert.equal(options[0].label.includes(L1), false);
});

test("a blank name degrades to the level alone (no dangling separator)", () => {
  assert.equal(composeInstructorCourseOptionLabel(2, "   "), "רמה 2");
  assert.equal(composeInstructorCourseOptionLabel(1, "קורס"), "רמה 1 · קורס");
});

test("status is preserved verbatim, including PLANNED and ARCHIVED", () => {
  const options = buildInstructorContactCourseOptions(
    [L1_ROW, L2_ROW, row({ id: "arch", name: "ישן", level: 3, status: "ARCHIVED" })],
    [...ALLOWED, "arch"],
  );
  assert.deepEqual(
    options.map((o) => o.status),
    ["ACTIVE", "PLANNED", "ARCHIVED"],
  );
});

test("a PLANNED offering is a legitimate option (never filtered out)", () => {
  const options = buildInstructorContactCourseOptions([L2_ROW], ALLOWED);
  assert.equal(options.length, 1);
  assert.equal(options[0].status, "PLANNED");
});

test("the option view carries EXACTLY four keys - no selected/default marker", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW, L2_ROW], ALLOWED);
  for (const option of options) {
    assert.deepEqual(Object.keys(option).sort(), OPTION_VIEW_KEYS);
  }
});

test("no option is flagged as selected, default, current or primary", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW, L2_ROW], ALLOWED);
  const serialized = JSON.stringify(options);
  for (const forbidden of ["selected", "default", "isCurrent", "current", "primary"]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `the menu must not imply a ${forbidden} course`,
    );
  }
});

test("no date field ever reaches the option view", () => {
  const options = buildInstructorContactCourseOptions([L1_ROW, L2_ROW], ALLOWED);
  const serialized = JSON.stringify(options);
  for (const forbidden of ["startDate", "endDate", "activityYear"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

// ---------------------------------------------------------------------------
// Orchestration: actor guard first, exact query shape
// ---------------------------------------------------------------------------

test("the actor guard is the FIRST awaited operation", async () => {
  const calls: string[] = [];
  await listInstructorContactCourseOptionsWithDeps(
    makeDeps({
      requireActiveInstructor: async () => {
        calls.push("actor");
        return { id: "instructor-1" };
      },
      fetchOfferingRows: async () => {
        calls.push("fetch");
        return [L1_ROW, L2_ROW];
      },
    }),
  );
  assert.deepEqual(calls, ["actor", "fetch"]);
});

test("an unauthenticated/inactive instructor aborts BEFORE any offering read", async () => {
  let fetched = false;
  await assert.rejects(
    () =>
      listInstructorContactCourseOptionsWithDeps(
        makeDeps({
          requireActiveInstructor: async () => {
            throw new Error("No authenticated instructor");
          },
          fetchOfferingRows: async () => {
            fetched = true;
            return [L1_ROW, L2_ROW];
          },
        }),
      ),
    /No authenticated instructor/,
  );
  assert.equal(fetched, false, "an unauthorized caller must not probe which offerings exist");
});

test("the query filters by the exact allow-listed id set and nothing else", async () => {
  let captured: InstructorCourseOptionsQuery | null = null;
  await listInstructorContactCourseOptionsWithDeps(
    makeDeps({
      fetchOfferingRows: async (query) => {
        captured = query;
        return [L1_ROW, L2_ROW];
      },
    }),
  );
  const query = captured as unknown as InstructorCourseOptionsQuery;
  assert.deepEqual(Object.keys(query).sort(), ["select", "where"]);
  assert.deepEqual(query.where, { id: { in: ALLOWED } });
  assert.deepEqual(Object.keys(query.where).sort(), ["id"], "no status/date/name/year filter");
});

test("the query selects EXACTLY id, name, level and status (no dates, no relations)", async () => {
  let captured: InstructorCourseOptionsQuery | null = null;
  await listInstructorContactCourseOptionsWithDeps(
    makeDeps({
      fetchOfferingRows: async (query) => {
        captured = query;
        return [];
      },
    }),
  );
  const query = captured as unknown as InstructorCourseOptionsQuery;
  assert.deepEqual(Object.keys(query.select).sort(), ["id", "level", "name", "status"]);
  assert.deepEqual(query.select, { id: true, name: true, level: true, status: true });
});

test("the query's id list is a copy - the frozen policy cannot be mutated through it", async () => {
  let captured: InstructorCourseOptionsQuery | null = null;
  await listInstructorContactCourseOptionsWithDeps(
    makeDeps({
      allowedOfferingIds: INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
      fetchOfferingRows: async (query) => {
        captured = query;
        return [];
      },
    }),
  );
  const query = captured as unknown as InstructorCourseOptionsQuery;
  assert.notEqual(
    query.where.id.in,
    INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS,
    "the query must not hand out the policy array itself",
  );
  assert.deepEqual(query.where.id.in, [...INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS]);
});

test("the orchestration binds against the REAL policy ids (both verified offerings)", async () => {
  const options = await listInstructorContactCourseOptionsWithDeps(
    makeDeps({ allowedOfferingIds: INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS }),
  );
  assert.deepEqual(
    options.map((o) => o.id),
    [L1, L2],
  );
  assert.deepEqual([...INSTRUCTOR_ALLOWED_COURSE_OFFERING_IDS], ALLOWED);
});

test("a fetch failure propagates (never a partial or default menu)", async () => {
  await assert.rejects(
    () =>
      listInstructorContactCourseOptionsWithDeps(
        makeDeps({
          fetchOfferingRows: async () => {
            throw new Error("simulated Prisma failure");
          },
        }),
      ),
    /simulated Prisma failure/,
  );
});

// ---------------------------------------------------------------------------
// Structural guards: purity and server-only reach
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Every tracked source file under the app's own directories. */
function sourceFiles(): string[] {
  const roots = ["app", "lib", "components", "scripts"].map((d) => path.join(REPO_ROOT, d));
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "generated" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
  };
  roots.forEach(walk);
  return out;
}

/** Real import/require of a module specifier - not a mention inside a comment. */
function importsModule(src: string, moduleName: string): boolean {
  return new RegExp(`(?:from|import|require\\()\\s*["'][^"']*${moduleName}["']`).test(src);
}

const SOURCES = sourceFiles().map((file) => ({
  rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
  src: readFileSync(file, "utf8"),
}));

test("no client component imports the temporary compatibility module", () => {
  const offenders = SOURCES.filter(
    (s) =>
      /^\s*["']use client["']/m.test(s.src) &&
      importsModule(s.src, "temporary-level2-compatibility"),
  ).map((s) => s.rel);
  assert.deepEqual(offenders, [], "the temporary policy is server-only");
});

/**
 * The COMPLETE set of modules approved to consume the options SERVER ACTION
 * (@/lib/actions/instructor-course-options). Exact allow-list, not a floor: an
 * unapproved module that starts importing the action, and a listed module that
 * stops, must BOTH fail.
 *
 * Ownership of each entry:
 *  - app/instructor/InstructorCourseScopedContactsSection.tsx - the instructor
 *    contacts course selector, SLICE C0-B. This is the ONLY surface allowed to
 *    ask which courses an instructor may address; any other consumer is a new
 *    course-context surface and needs its own review.
 *
 * Kept sorted so the comparison is deterministic regardless of walk order.
 */
const APPROVED_OPTIONS_ACTION_CONSUMERS: readonly string[] = [
  "app/instructor/InstructorCourseScopedContactsSection.tsx",
  // SLICE S2A: the instructor SCHEDULE course selector, shared by the schedule
  // tab and the today card. It consumes only the options MENU (which grants no
  // module and no row); both schedule surfaces re-validate the chosen id
  // server-side through resolveInstructorCourseOffering + a positive SCHEDULE
  // capability check before any week or item is read. Its selection is
  // screen-local and is deliberately NOT shared with the contacts selector above.
  "app/instructor/InstructorScheduleCourseSelector.tsx",
];

/**
 * The subset of the above that is a CLIENT component. Tracked separately (rather
 * than reusing the list above) so that approving a future SERVER-side consumer
 * cannot silently also approve a new client-side one: the two lists are asserted
 * independently below, and a module in the wrong column fails.
 */
const APPROVED_OPTIONS_ACTION_CLIENT_CONSUMERS: readonly string[] = [
  "app/instructor/InstructorCourseScopedContactsSection.tsx",
  // SLICE S2A - approved in the CLIENT column too: it is a "use client"
  // component that calls the server action directly (the intended way to invoke
  // it). It does not, and must not, import the pure core.
  "app/instructor/InstructorScheduleCourseSelector.tsx",
];

// The two rules below were ONE combined assertion until slice C0-B. They are
// split because they are genuinely different rules with different verdicts:
// reaching the PURE CORE from a client is always wrong (it is server-side
// decision logic), whereas calling the SERVER ACTION from a client is the normal,
// intended way to invoke it - so that one is an allow-list, not a prohibition.
// Collapsing them again would either forbid the approved wiring or silently
// legalise a client-side import of the core.

test("no client component imports the PURE options core", () => {
  const offenders = SOURCES.filter(
    (s) =>
      /^\s*["']use client["']/m.test(s.src) &&
      importsModule(s.src, "instructor-offering-options-core"),
  ).map((s) => s.rel);
  assert.deepEqual(
    offenders,
    [],
    "the pure core is server-side only - a client must call the server action instead",
  );
});

test("only the approved client component imports the options SERVER ACTION", () => {
  const clientConsumers = SOURCES.filter(
    (s) =>
      /^\s*["']use client["']/m.test(s.src) && importsModule(s.src, "instructor-course-options"),
  )
    .map((s) => s.rel)
    .sort();
  assert.deepEqual(clientConsumers, [...APPROVED_OPTIONS_ACTION_CLIENT_CONSUMERS].sort());
});

test("the pure core imports nothing at runtime (policy, Prisma and session all injected)", () => {
  const corePath = fileURLToPath(new URL("./instructor-offering-options-core.ts", import.meta.url));
  const src = readFileSync(corePath, "utf8");
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[^\n]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.deepEqual([...valueImports, ...bareImports], []);
});

test("only the approved production modules consume the options server action", () => {
  // Replaces the original "C0-A is un-wired: nothing imports the options action
  // yet" assertion, which was a TEMPORAL tripwire: its own message named slice
  // C0-B as the one allowed to wire the selector, and C0-B has now done so. It
  // becomes an exact approved-consumer allow-list rather than being deleted, so
  // the reach of the options action stays under review.
  //
  // The two exclusions are structural, NOT convenience: the action module
  // obviously references its own name, and test files are not production call
  // sites. No production source file is filtered out to make this pass - every
  // one that imports the action must be listed above.
  const consumers = SOURCES.filter(
    (s) =>
      importsModule(s.src, "instructor-course-options") &&
      !s.rel.startsWith("lib/actions/instructor-course-options") &&
      !s.rel.endsWith(".test.ts") &&
      !s.rel.endsWith(".test.tsx"),
  )
    .map((s) => s.rel)
    .sort();
  assert.deepEqual(
    consumers,
    [...APPROVED_OPTIONS_ACTION_CONSUMERS].sort(),
    "every options-action consumer must be explicitly approved and listed",
  );
});
