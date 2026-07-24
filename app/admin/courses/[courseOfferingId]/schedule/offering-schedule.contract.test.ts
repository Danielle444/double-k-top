/**
 * MULTI-COURSE Schedule Slice W-S2B - DB-free CONTRACT/source tests for the
 * offering-scoped weekly-schedule route (page, server action, client).
 *
 * Runs no Prisma and opens no DB. It statically inspects the source of the three
 * route modules (plus the course dashboard page, plus a repo-wide sweep) to lock
 * the approved safety invariants: the offering is server-bound and never
 * client-controlled, the listing is exactly-offering-scoped, the re-import target
 * can only be a week this page supplied, the excluded schedule features are not
 * importable from this route, and the committed W-S2A writer has exactly one
 * consumer.
 *
 * Run: npx tsx --test "app/admin/courses/[courseOfferingId]/schedule/offering-schedule.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. None of these files contain
// `//` inside a string or regex literal, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readRaw(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function read(relative: string): string {
  return stripComments(readRaw(relative));
}

const actionSrc = read("./actions.ts");
const pageSrc = read("./page.tsx");
const clientSrc = read("./OfferingScheduleClient.tsx");
const dashboardSrc = read("../page.tsx");

const routeSources: readonly (readonly [string, string])[] = [
  ["actions.ts", actionSrc],
  ["page.tsx", pageSrc],
  ["OfferingScheduleClient.tsx", clientSrc],
];

// ---------------------------------------------------------------------------
// Server action: authorization order + server-bound offering
// ---------------------------------------------------------------------------

test("the action's leading argument is the SERVER-BOUND courseOfferingId", () => {
  assert.ok(
    /saveOfferingWeeklyScheduleAction\(\s*courseOfferingId: string/.test(actionSrc),
    "courseOfferingId must be the bound leading parameter",
  );
  assert.ok(
    pageSrc.includes("saveOfferingWeeklyScheduleAction.bind(null, context.id)"),
    "the page must bind the VALIDATED context id into the action",
  );
});

test("requireAdmin() is the FIRST awaited operation in the action", () => {
  const gate = actionSrc.indexOf("await requireAdmin()");
  assert.notEqual(gate, -1, "the action must call await requireAdmin()");
  assert.equal(
    actionSrc.indexOf("await "),
    gate,
    "nothing may be awaited before the admin gate",
  );
});

test("the action re-validates the exact offering, then calls the W-S2A writer", () => {
  const gate = actionSrc.indexOf("await requireAdmin()");
  const offering = actionSrc.indexOf("requireAdminCourseOffering(courseOfferingId)");
  const writer = actionSrc.indexOf("commitOfferingWeeklySchedule(");
  assert.ok(offering > -1, "requireAdminCourseOffering(courseOfferingId) not found");
  assert.ok(writer > -1, "commitOfferingWeeklySchedule( not found");
  assert.ok(gate < offering, "requireAdmin() must precede the offering resolution");
  assert.ok(offering < writer, "the offering must be resolved before the writer runs");
  assert.ok(
    actionSrc.includes("CourseOfferingNotFoundError"),
    "an invalid offering must fail closed with a stable code",
  );
});

test("the offering id never comes from FormData, a query string, or a cookie", () => {
  for (const [label, src] of routeSources) {
    assert.ok(
      !src.includes('formData.get("courseOfferingId")'),
      `${label}: the offering id must not be read from formData`,
    );
    assert.ok(
      !src.includes('name="courseOfferingId"'),
      `${label}: there must be no courseOfferingId form field / hidden input`,
    );
    assert.ok(
      !src.includes("searchParams"),
      `${label}: the offering must not be taken from a query string`,
    );
  }
});

test("no current-offering resolver and no course cookie is used as authorization", () => {
  for (const [label, src] of routeSources) {
    for (const forbidden of [
      "resolveCurrentCourseOffering",
      "resolveTraineeCourseOffering",
      "current-offering",
      "admin-course-cookie",
      "cookies(",
      "next/headers",
    ]) {
      assert.ok(!src.includes(forbidden), `${label}: must not reference ${forbidden}`);
    }
  }
});

test("the action revalidates ONLY the course-scoped schedule path", () => {
  assert.ok(
    actionSrc.includes("/schedule`)"),
    "must revalidate the course-scoped schedule path built from the bound id",
  );
  for (const forbidden of [
    'revalidatePath("/admin/weekly-schedule")',
    'revalidatePath("/student")',
    'revalidatePath("/instructor")',
    'revalidatePath("/")',
  ]) {
    assert.ok(!actionSrc.includes(forbidden), `must not perform ${forbidden}`);
  }
});

test("the action imports no Prisma client (no direct write surface)", () => {
  assert.ok(!actionSrc.includes("@/lib/prisma"), "the action must not import prisma");
  assert.ok(!actionSrc.includes("prisma."), "the action must not access prisma directly");
});

// ---------------------------------------------------------------------------
// Page: route validation + exactly-offering-scoped listing
// ---------------------------------------------------------------------------

test("the page validates the exact route offering via requireAdminCourseOffering", () => {
  assert.ok(pageSrc.includes("requireAdminCourseOffering(courseOfferingId)"));
  assert.ok(pageSrc.includes("CourseOfferingNotFoundError"), "must fail closed on not-found");
  assert.ok(pageSrc.includes("notFound()"), "a typed not-found must render notFound()");
});

test("the page gates the READ with the pure HISTORICAL_READ policy", () => {
  assert.ok(pageSrc.includes('assertCourseOperationAllowed(context.status, "HISTORICAL_READ")'));
});

test("the listing query requires the EXACT validated courseOfferingId", () => {
  assert.ok(
    pageSrc.includes("where: { courseOfferingId: context.id }"),
    "the week query must filter on the validated context id",
  );
  // Never the raw route param, and never a NULL-scoped / unfiltered listing.
  assert.ok(
    !pageSrc.includes("courseOfferingId: courseOfferingId"),
    "the query must not use the raw route param",
  );
  for (const forbidden of [
    "courseOfferingId: null",
    "courseOfferingId: { in:",
    "OR:",
    "findMany({\n    orderBy",
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `listing must not use ${forbidden}`);
  }
  // Exactly one weeklySchedule query on this page, and it is the scoped one.
  assert.equal(
    pageSrc.split("prisma.weeklySchedule").length - 1,
    1,
    "there must be exactly one weeklySchedule query",
  );
  assert.ok(
    pageSrc.includes('orderBy: [{ startDate: "asc" }'),
    "weeks must be ordered by startDate",
  );
});

test("the page reads no other model (no duty / day-plan / student query)", () => {
  for (const forbidden of [
    "prisma.dutyAssignment",
    "prisma.courseDayPlan",
    "prisma.student",
    "prisma.scheduleItem",
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not query ${forbidden}`);
  }
});

test("the mutation affordance is gated on SCHEDULE_DRAFT_CONFIGURATION", () => {
  assert.ok(pageSrc.includes('"SCHEDULE_DRAFT_CONFIGURATION"'));
  assert.ok(pageSrc.includes("evaluateCourseOperationPolicy"));
  assert.ok(pageSrc.includes("canDraft"), "the visible affordance must follow the policy");
});

// ---------------------------------------------------------------------------
// Re-import: the target can only be a week this scoped page supplied
// ---------------------------------------------------------------------------

test("the re-import target is only ever a week from the scoped page, or null", () => {
  const args = Array.from(clientSrc.matchAll(/openUpload\(([^)]*)\)/g)).map((m) => m[1].trim());
  assert.ok(args.length >= 3, "expected the definition plus both call sites");
  const allowed = new Set(["target: OfferingWeekView | null", "null", "week"]);
  for (const arg of args) {
    assert.ok(allowed.has(arg), `openUpload must not be called with ${JSON.stringify(arg)}`);
  }
  // The target state has exactly one writer - openUpload itself.
  assert.equal(
    clientSrc.split("setUploadTarget(").length - 1,
    1,
    "uploadTarget must have exactly one assignment site",
  );
  // And the submitted week id is exactly that target's id.
  assert.ok(
    clientSrc.includes("weeklyScheduleId: uploadTarget?.id"),
    "the submitted week id must come from the selected target only",
  );
});

test("there is no free-text week-id input anywhere in the route", () => {
  for (const [label, src] of routeSources) {
    assert.ok(
      !src.includes('name="weeklyScheduleId"'),
      `${label}: there must be no weeklyScheduleId form field`,
    );
  }
});

test("the client has no offering field and no offering selector", () => {
  for (const forbidden of ["courseOfferingId", "offeringId", "CourseOfferingSelector"]) {
    assert.ok(!clientSrc.includes(forbidden), `client must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Excluded features are not importable from this route
// ---------------------------------------------------------------------------

test("no publication / delete / day-plan / duty-generation action is imported", () => {
  const forbidden = [
    // publication
    "setWeeklySchedulePublished",
    "setPublishStatus",
    "isPublished",
    "SCHEDULE_PUBLICATION",
    // delete
    "deleteWeeklySchedule",
    // day plan
    "suggestDayPlanFromSchedule",
    "confirmDayPlanSuggestions",
    "setCourseDayPlan",
    "DayPlanSuggestion",
    "course-day-plan",
    // duty generation
    "runGenerateSchedule",
    "GenerateMode",
    "@/lib/scheduler",
    "dutyAssignment",
    // riding configuration
    "riding",
  ];
  for (const [label, src] of routeSources) {
    for (const token of forbidden) {
      assert.ok(!src.includes(token), `${label}: must not reference ${token}`);
    }
  }
});

test("the Level 1 global writer and its client are never imported", () => {
  for (const [label, src] of routeSources) {
    assert.ok(!src.includes("WeeklyScheduleClient"), `${label}: must not import the Level 1 client`);
    assert.ok(!src.includes("commitWeeklySchedule"), `${label}: must not call the Level 1 writer`);
    assert.ok(
      !src.includes("/admin/weekly-schedule"),
      `${label}: must not reference the Level 1 route`,
    );
  }
});

test("the ONLY thing imported from the Level 1 action module is the Excel parser", () => {
  const match = clientSrc.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/actions\/weekly-schedule"/);
  assert.ok(match, "the client must import the Excel parser from the Level 1 action module");
  const names = match[1]
    .split(",")
    .map((n) => n.replace(/^\s*type\s+/, "").trim())
    .filter(Boolean);
  assert.deepEqual(
    names.sort(),
    ["ScheduleImportItem", "parseWeeklyScheduleExcel"].sort(),
    "only the parser and its item type may be imported",
  );
  for (const [label, src] of routeSources) {
    if (label === "OfferingScheduleClient.tsx") continue;
    assert.ok(
      !src.includes("@/lib/actions/weekly-schedule"),
      `${label}: must not import the Level 1 action module`,
    );
  }
});

// ---------------------------------------------------------------------------
// The committed W-S2A writer has exactly ONE consumer
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
// This test file names the writer specifier in its own assertions, so it is not a
// consumer and is excluded from the sweep below.
const SELF_PATH = fileURLToPath(import.meta.url).replace(/\\/g, "/");
const SCANNED_DIRS = ["app", "lib", "prisma", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "generated", ".git"]);

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
}

test("only this route imports the committed W-S2A offering-scoped writer", () => {
  const files: string[] = [];
  for (const dir of SCANNED_DIRS) walk(join(REPO_ROOT, dir), files);
  assert.ok(files.length > 100, "the repo sweep must actually have found source files");

  const consumers = files
    .filter((file) => {
      // Skip the writer slice itself (its own module, core and tests).
      const normalized = file.replace(/\\/g, "/");
      if (normalized === SELF_PATH) return false;
      return !normalized.includes("lib/course/offering-weekly-schedule-writer");
    })
    .filter((file) =>
      readFileSync(file, "utf8").includes('"@/lib/course/offering-weekly-schedule-writer"'),
    )
    .map((file) => file.replace(/\\/g, "/").slice(REPO_ROOT.replace(/\\/g, "/").length));

  assert.deepEqual(
    consumers.sort(),
    ["app/admin/courses/[courseOfferingId]/schedule/actions.ts"],
    "the W-S2A writer must have exactly one consumer: this route's action",
  );
});

// ---------------------------------------------------------------------------
// Dashboard link
// ---------------------------------------------------------------------------

test("the course dashboard links to the EXACT course-scoped schedule route", () => {
  assert.ok(
    dashboardSrc.includes(
      "const scheduleHref = `/admin/courses/${encodeURIComponent(context.id)}/schedule`",
    ),
    "the dashboard href must be built from the validated context id",
  );
  assert.ok(dashboardSrc.includes("href={scheduleHref}"), "the link must use that href");
  assert.ok(
    !dashboardSrc.includes("/admin/weekly-schedule"),
    "the dashboard must not link to the Level 1 route",
  );
});
