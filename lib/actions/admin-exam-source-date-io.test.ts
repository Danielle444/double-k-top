/**
 * EXAM EX-ADMIN-SRCDATE — tests for the source-date replacement binding
 * (lib/actions/admin-exam-source-date-io.ts).
 *
 * Run with: npx tsx lib/actions/admin-exam-source-date-io.test.ts
 *
 * STRUCTURAL BY NECESSITY. The module under test declares `import "server-only"`,
 * which is exactly the guarantee this slice wants — and which makes it
 * UNIMPORTABLE under bare `tsx` outside the Next build. Its authorization import
 * chain would also construct a database client. So this suite takes the approach
 * every committed exam write-binding suite in this directory takes: it reads the
 * module's SOURCE and asserts on its structure — which statements exist, on which
 * client, with which payload, and which dependency name each binding is wired to.
 *
 * The BEHAVIOUR — the order, the containment level, the all-or-nothing
 * validation, the duplicate collapse, the empty selection and the no-op rule —
 * belongs to the pure core and is exercised at runtime by that core's own suite.
 * The structural half here is what proves this module really wires THOSE
 * functions to THOSE dependency names; the two together make the claim.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const IO_REL = join("lib", "actions", "admin-exam-source-date-io.ts");

const RAW = readFileSync(join(REPO_ROOT, IO_REL), "utf8");

/** Strip comments, so every guard sweeps CODE and never the prose beside it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CODE = stripComments(RAW);

/** The body of one named function declaration, brace-balanced. */
function bodyOf(name: string): string {
  const start = CODE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is not declared`);
  const open = CODE.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < CODE.length; index += 1) {
    if (CODE[index] === "{") depth += 1;
    else if (CODE[index] === "}") {
      depth -= 1;
      if (depth === 0) return CODE.slice(open, index + 1);
    }
  }
  assert.fail(`${name} is unbalanced`);
}

// ===========================================================================
// 1. The module's own declaration
// ===========================================================================

test("1. the module is SERVER-ONLY and is NOT a Server Action module", () => {
  const first = RAW.split("\n").find((line) => line.trim().length > 0 && !line.startsWith("/*"));
  assert.ok(CODE.includes('import "server-only";'), "the server-only guard is missing");
  assert.equal(CODE.includes('"use server"'), false, "the module is a Server Action module");
  assert.equal(CODE.includes('"use client"'), false);
  assert.ok(typeof first === "string");
});

test("2. it exports EXACTLY the one write operation and the one display predicate", () => {
  const exported = [...CODE.matchAll(/export (?:async )?function (\w+)\(/g)].map(
    ([, name]) => name,
  );
  assert.deepEqual(exported.sort(), [
    "examBeginnerDatesSupportedForLevel",
    "replaceExamSourceDates",
  ]);
  // No second write, no delete-all, no create-plan and no beginner import arm.
  for (const forbidden of [
    "deleteExamSourceDates",
    "addExamSourceDate",
    "importBeginnerExams",
    "createExamPlan",
    "syncTeachingPractice",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module exposes ${forbidden}`);
  }
});

// ===========================================================================
// 2. The trust boundary
// ===========================================================================

test("3. the admin boundary is the committed one, and the RAW id is never used again", () => {
  const body = bodyOf("requireCourseContext");
  assert.ok(body.includes("await requireAdminCourseOffering(requestedCourseOfferingId)"));
  // Every fact carried forward comes off the VERIFIED context object.
  assert.ok(body.includes("courseOfferingId: context.id"));
  assert.ok(body.includes("status: context.status"));
  assert.ok(body.includes("courseLevel: context.level"));
  // ...and nothing else about the offering leaks into the pure core.
  for (const forbidden of ["context.name", "activityYear", "enrollment", "groups"]) {
    assert.equal(body.includes(forbidden), false, `${forbidden} crosses the boundary`);
  }
  // The requested id is used ONCE, to be verified.
  assert.equal(
    (body.match(/requestedCourseOfferingId/g) ?? []).length,
    1,
    "the raw requested id is used more than once",
  );
});

test("4. the lifecycle gate is the WRITE gate on the VERIFIED status", () => {
  const body = bodyOf("assertConfigurationAllowed");
  assert.ok(body.includes('"SCHEDULE_DRAFT_CONFIGURATION"'));
  assert.equal(body.includes("HISTORICAL_READ"), false, "the read gate was used");
  assert.equal(CODE.includes("evaluateCourseOperationPolicy"), false, "the gate is only asked");
});

test("5. exactly two typed failures are classified, by identity", () => {
  assert.ok(bodyOf("isCourseNotFoundError").includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(
    bodyOf("isOperationNotAllowedError").includes(
      "error instanceof CourseOperationNotPermittedError",
    ),
  );
  // Nothing else is caught, so a defect is never laundered into a form error.
  assert.equal((CODE.match(/instanceof/g) ?? []).length, 2);
  assert.equal(CODE.includes("catch"), false, "the binding swallows an error itself");
});

test("6. the level rule is DELEGATED to the committed predicate, never restated", () => {
  assert.ok(
    bodyOf("examBeginnerDatesSupportedForLevel").includes(
      "isBeginnerSourceCourseLevel(courseLevel)",
    ),
  );
  assert.equal(/courseLevel\s*===\s*1/.test(CODE), false, "the level rule is restated");
  assert.equal(CODE.includes("level === 1"), false, "the level rule is restated");
});

// ===========================================================================
// 3. The Prisma statements
// ===========================================================================

test("7. the plan lookup is a point lookup that selects the id only", () => {
  const body = bodyOf("findPlanIdByCourseOfferingId");
  assert.ok(body.includes("prisma.examPlan.findUnique("));
  assert.ok(body.includes("where: { courseOfferingId }"));
  assert.ok(body.includes("select: { id: true }"));
  for (const forbidden of ["publishedAt", "definitions", "sessions", "include", "create"]) {
    assert.equal(body.includes(forbidden), false, `the lookup reaches ${forbidden}`);
  }
});

test("8. the stored selection is read by plan, ascending, date column only", () => {
  const body = bodyOf("findStoredSourceDates");
  assert.ok(body.includes("prisma.examTeachingPracticeSourceDate.findMany("));
  assert.ok(body.includes("where: { planId }"));
  assert.ok(body.includes("select: { date: true }"));
  assert.ok(body.includes('orderBy: { date: "asc" }'));
});

test("9. the practice probe is a CLOSED question over an explicit list", () => {
  const body = bodyOf("findPracticeDates");
  assert.ok(body.includes("prisma.teachingPracticeLesson.findMany("));
  // An explicit `IN` over the caller's own tokens — never an open enumeration.
  assert.ok(body.includes("where: { date: { in: dates.map("));
  assert.ok(body.includes("select: { date: true }"));
  // The DATE COLUMN AND NOTHING ELSE: no Teaching-Practice content is readable.
  for (const forbidden of [
    "participants",
    "children",
    "childAssignments",
    "responsibleInstructor",
    "startTime",
    "endTime",
    "groupName",
    "location",
    "notes",
    "practiceType",
    "isPublished",
    "horse",
    "parent",
    "phone",
    "id: true",
  ]) {
    assert.equal(body.includes(forbidden), false, `the probe reads ${forbidden}`);
  }
});

test("10. NO Teaching-Practice row is ever written, copied or duplicated", () => {
  for (const forbidden of [
    "teachingPracticeLesson.create",
    "teachingPracticeLesson.update",
    "teachingPracticeLesson.delete",
    "teachingPracticeLesson.upsert",
    "teachingPracticeParticipant",
    "teachingPracticeChild",
    "teachingPracticeTrack",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the binding reaches ${forbidden}`);
  }
  // The ONLY Teaching-Practice statement in the module is the read probe.
  assert.equal((CODE.match(/prisma\.teachingPracticeLesson\./g) ?? []).length, 1);
});

test("11. the replacement is ONE transaction holding a delete and an insert", () => {
  const body = bodyOf("replaceSourceDates");
  assert.ok(body.includes("prisma.$transaction(["), "the replacement is not atomic");
  assert.ok(body.includes("prisma.examTeachingPracticeSourceDate.deleteMany({ where: { planId } })"));
  assert.ok(body.includes("prisma.examTeachingPracticeSourceDate.createMany("));
  assert.ok(body.includes("skipDuplicates: true"));
  // The transaction is the ONLY place either statement appears, so no code path
  // can delete without inserting or insert without deleting.
  assert.equal((CODE.match(/\.deleteMany\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/\.createMany\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/\$transaction/g) ?? []).length, 1);
  // Both statements are scoped by the LOOKED-UP plan id and by nothing off the wire.
  assert.equal(body.includes("courseOfferingId"), false);
});

test("12. NO raw SQL, and no other model is written", () => {
  for (const forbidden of [
    "$queryRaw",
    "$executeRaw",
    "$queryRawUnsafe",
    "$executeRawUnsafe",
    "examSession.",
    "examDefinition.",
    "examAssignment.",
    "student.update",
    "courseOffering.update",
    "examPlan.update",
    "examPlan.create",
    "examPlan.delete",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the binding reaches ${forbidden}`);
  }
});

test("13. no clock, no randomness, no environment and no network", () => {
  for (const forbidden of [
    "Date.now",
    "new Date(",
    "Math.random",
    "process.env",
    "fetch(",
    "revalidatePath",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the binding reaches ${forbidden}`);
  }
});

test("14. the two `@db.Date` boundaries are the ONLY date conversions", () => {
  // A `Date` is produced only by the committed helpers, at the IO edge, so no
  // `Date` ever crosses into the pure core and no timezone shift is possible.
  assert.ok(CODE.includes('import { dateKey, parseDateKey } from "@/lib/dates";'));
  assert.ok(bodyOf("requireCourseContext").includes("dateKey(context.startDate)"));
  assert.ok(bodyOf("requireCourseContext").includes("dateKey(context.endDate)"));
  assert.ok(bodyOf("findPracticeDates").includes("parseDateKey(value)"));
  assert.ok(bodyOf("replaceSourceDates").includes("parseDateKey(value)"));
});

// ===========================================================================
// 4. The wiring
// ===========================================================================

test("15. the public operation binds every effect to its own dependency name", () => {
  const body = bodyOf("replaceExamSourceDates");
  assert.ok(body.includes("replaceExamSourceDatesWithDeps(courseOfferingId, submitted, {"));
  for (const dependency of [
    "requireCourseContext,",
    "assertConfigurationAllowed,",
    "findPlanIdByCourseOfferingId,",
    "findStoredSourceDates,",
    "findPracticeDates,",
    "replaceSourceDates,",
    "isCourseNotFoundError,",
    "isOperationNotAllowedError,",
  ]) {
    assert.ok(body.includes(dependency), `${dependency} is not wired`);
  }
  // The binding adds NO decision of its own on top of the core's result.
  assert.equal(body.includes("if ("), false, "the binding takes a decision");
  assert.equal(body.includes("ok:"), false, "the binding builds its own result");
});

test("16. the caller may supply date tokens and NOTHING else", () => {
  const signature = CODE.slice(
    CODE.indexOf("export async function replaceExamSourceDates("),
  ).split(")")[0];
  assert.ok(signature.includes("courseOfferingId: string"));
  assert.ok(signature.includes("submitted: readonly unknown[]"));
  for (const forbidden of ["planId", "lessonId", "practiceId", "studentId", "actorId", "adminId"]) {
    assert.equal(signature.includes(forbidden), false, `the caller may supply ${forbidden}`);
  }
});

test("17. every import is accounted for, and no unapproved module is reached", () => {
  const imports = [...CODE.matchAll(/from\s+"([^"]+)";/g)].map(([, from]) => from);
  assert.deepEqual([...new Set(imports)].sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/dates",
    "@/lib/exam/admin-exam-source-date-core",
    "@/lib/exam/exam-beginner-course-scope-core",
    "@/lib/prisma",
  ]);
  // In particular it reaches no notification, no push, no instructor or trainee
  // surface, and no Teaching-Practice module.
  for (const forbidden of [
    "notification",
    "push",
    "app/instructor",
    "app/student",
    "teaching-practice",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the binding reaches ${forbidden}`);
  }
});
