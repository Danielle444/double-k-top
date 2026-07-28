/**
 * RIDING PROGRESS COURSE SCOPE - S4: non-DB CONTRACT (source-scan) tests locking
 * the course-scoped writers, readers and UI.
 *
 * WHY SOURCE-SCAN: the writers are "use server" modules that transitively import
 * next/headers and Prisma, and the UI is a client component - none can be
 * imported or executed in a unit test. All the DECISIONS they make already have
 * executable coverage in the pure cores (riding-progress-course-scope-core.test.ts
 * for eligibility/validation, riding-progress-journal-view-core.test.ts for the
 * projection/chip/filter). What must be pinned HERE is the WIRING: that the
 * writers actually call the core, that create writes a non-null course, that
 * update cannot carry one, that both readers project identically, and that the
 * UI renders the picker/chip/filter and the exact average label.
 *
 * Run with:
 *   npx tsx --test lib/actions/riding-progress-course-scope.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const ADMIN_REL = "lib/actions/student-riding-progress-feedback.ts";
const INSTRUCTOR_REL = "lib/actions/student-riding-progress-feedback-instructor.ts";
/**
 * The shared DTO/select/mapper live OUTSIDE the two "use server" action modules:
 * a "use server" file may only export async functions, so a select constant and a
 * synchronous mapper cannot live there (Turbopack fails the build outright).
 */
const MAPPER_REL = "lib/actions/riding-progress-row-mapper.ts";
const SCOPE_REL = "lib/course/riding-progress-course-scope.ts";
const SECTION_REL = "lib/components/RidingProgressFeedbackSection.tsx";
const DETAIL_REL = "lib/components/TraineeProgressDetail.tsx";
const ADMIN_CLIENT_REL = "app/admin/trainee-progress/TraineeProgressClient.tsx";
const INSTRUCTOR_CLIENT_REL = "app/instructor/InstructorTraineeProgressSection.tsx";

const ADMIN = read(ADMIN_REL);
const INSTRUCTOR = read(INSTRUCTOR_REL);
const MAPPER = read(MAPPER_REL);
const SCOPE = read(SCOPE_REL);
const SECTION = read(SECTION_REL);
const DETAIL = read(DETAIL_REL);
const ADMIN_CLIENT = read(ADMIN_CLIENT_REL);
const INSTRUCTOR_CLIENT = read(INSTRUCTOR_CLIENT_REL);

const ADMIN_CODE = stripComments(ADMIN);
const INSTRUCTOR_CODE = stripComments(INSTRUCTOR);
const SCOPE_CODE = stripComments(SCOPE);
const SECTION_CODE = stripComments(SECTION);
const DETAIL_CODE = stripComments(DETAIL);

/** The body of one function, from its declaration to the next top-level export. */
function functionBody(code: string, declaration: string): string {
  const start = code.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} must exist`);
  const rest = code.slice(start + declaration.length);
  const next = rest.indexOf("\nexport ");
  return rest.slice(0, next === -1 ? rest.length : next);
}

// ---------------------------------------------------------------------------
// CREATE resolves the course through the committed S1 core
// ---------------------------------------------------------------------------

test("the S1 core is REUSED, never re-implemented", () => {
  assert.match(
    SCOPE_CODE,
    /from "\.\/riding-progress-course-scope-core"/,
    "the IO binding must delegate to the pure core",
  );
  assert.match(SCOPE_CODE, /buildRidingProgressCourseChoice\(/);
  assert.match(SCOPE_CODE, /resolveRidingProgressCourseOfferingIdForCreate\(/);
  // No second eligibility definition anywhere in the S4 surface.
  for (const [rel, code] of [
    [SCOPE_REL, SCOPE_CODE],
    [ADMIN_REL, ADMIN_CODE],
    [INSTRUCTOR_REL, INSTRUCTOR_CODE],
  ] as const) {
    assert.equal(
      /enrollmentStatus\s*!==\s*"ACTIVE"/.test(code),
      false,
      `${rel} must not re-implement the eligibility predicate`,
    );
  }
});

test("the eligible-offering query is scoped to the SUBJECT trainee only", () => {
  assert.match(SCOPE_CODE, /prisma\.courseEnrollment\.findMany\(/);
  assert.match(SCOPE_CODE, /studentId,/);
  assert.match(SCOPE_CODE, /status: "ACTIVE"/);
  assert.match(SCOPE_CODE, /courseOffering: \{ status: "ACTIVE" \}/);
  // The requested id must never reach the query.
  const query = SCOPE_CODE.slice(SCOPE_CODE.indexOf("findMany("), SCOPE_CODE.indexOf("return rows.map"));
  assert.equal(/requestedCourseOfferingId/.test(query), false, "a requested id is never a query key");
  // No actor identity in the query.
  for (const forbidden of ["instructorId", "getCurrentInstructor", "requireAdmin", "cookie"]) {
    assert.equal(SCOPE_CODE.includes(forbidden), false, `eligibility must not consult ${forbidden}`);
  }
});

test("BOTH create paths resolve the course and write it non-null", () => {
  for (const [rel, code, declaration] of [
    [ADMIN_REL, ADMIN_CODE, "export async function createStudentRidingProgressFeedbackAsAdmin("],
    [
      INSTRUCTOR_REL,
      INSTRUCTOR_CODE,
      "export async function createStudentRidingProgressFeedbackAsInstructor(",
    ],
  ] as const) {
    const body = functionBody(code, declaration);
    assert.match(body, /await resolveRidingProgressCourseForCreate\(studentId, input\.courseOfferingId\)/, rel);
    assert.match(body, /if \(!course\.ok\)/, `${rel} must refuse an unresolved course`);
    assert.match(body, /ridingProgressCourseRefusalMessage\(course\.reason\)/, rel);
    assert.match(body, /courseOfferingId: course\.courseOfferingId/, `${rel} must persist the resolved id`);
    // The refusal must precede the write.
    assert.ok(
      body.indexOf("if (!course.ok)") < body.indexOf("studentRidingProgressFeedback.create"),
      `${rel} must refuse BEFORE creating`,
    );
  }
});

test("no create path can write a null course", () => {
  for (const code of [ADMIN_CODE, INSTRUCTOR_CODE]) {
    assert.equal(/courseOfferingId: null/.test(code), false);
    assert.equal(/courseOfferingId: undefined/.test(code), false);
  }
});

// ---------------------------------------------------------------------------
// UPDATE immutability
// ---------------------------------------------------------------------------

test("the UPDATE payload type carries NO course field", () => {
  const start = MAPPER.indexOf("export interface StudentRidingProgressFeedbackInput {");
  assert.ok(start >= 0, "the update payload type must exist");
  const updateInput = MAPPER.slice(start, MAPPER.indexOf("}", start));
  assert.equal(/courseOfferingId/.test(updateInput), false, "update input must not accept a course");
  // The CREATE payload is a separate, wider type.
  assert.match(
    MAPPER,
    /export interface StudentRidingProgressFeedbackCreateInput extends StudentRidingProgressFeedbackInput \{\s*courseOfferingId\?: string \| null;/,
  );
});

test("BOTH update paths never write courseOfferingId", () => {
  for (const [rel, code, declaration] of [
    [ADMIN_REL, ADMIN_CODE, "export async function updateStudentRidingProgressFeedbackAsAdmin("],
    [
      INSTRUCTOR_REL,
      INSTRUCTOR_CODE,
      "export async function updateStudentRidingProgressFeedbackAsInstructor(",
    ],
  ] as const) {
    const body = functionBody(code, declaration);
    assert.equal(/courseOfferingId/.test(body), false, `${rel} update must not touch the course`);
    assert.equal(
      /resolveRidingProgressCourseForCreate/.test(body),
      false,
      `${rel} update must not resolve a course`,
    );
    assert.match(body, /studentRidingProgressFeedback\.update\(/, rel);
  }
});

test("no re-file / move-course surface exists anywhere in the slice", () => {
  for (const code of [ADMIN, INSTRUCTOR, SCOPE, SECTION, DETAIL]) {
    for (const forbidden of ["ForUpdate", "Refile", "ReFile", "changeCourse", "moveCourse", "reassignCourse"]) {
      assert.equal(code.includes(forbidden), false, `no ${forbidden} surface may exist`);
    }
  }
});

// ---------------------------------------------------------------------------
// Readers project identical course identity
// ---------------------------------------------------------------------------

test("a single shared projection + select is used by BOTH audiences", () => {
  assert.match(MAPPER, /export const RIDING_PROGRESS_COURSE_SELECT = \{/);
  assert.match(MAPPER, /courseOffering: \{ select: \{ id: true, name: true, level: true \} \}/);
  assert.match(MAPPER, /export function toRidingProgressRow\(/);
  assert.match(
    stripComments(MAPPER),
    /courseOffering: buildRidingProgressCourseProjection\(row\.courseOffering\)/,
  );
  // BOTH action modules import the one mapper rather than defining their own.
  for (const [rel, code] of [
    [ADMIN_REL, ADMIN_CODE],
    [INSTRUCTOR_REL, INSTRUCTOR_CODE],
  ] as const) {
    assert.match(code, /from "@\/lib\/actions\/riding-progress-row-mapper"/, rel);
    assert.match(code, /const toRow = toRidingProgressRow;/, rel);
    assert.equal(/function toRow\(row: \{/.test(code), false, `${rel}: no duplicated mapper`);
  }
});

test("the shared mapper module is NOT a Server Action module", () => {
  // A "use server" file may only export async functions; the select constant and
  // the synchronous mapper would fail the build there. This is why they live in
  // their own module, and why the action files re-export the types with a
  // from-clause rather than a bare local type re-export.
  assert.equal(/^\s*["']use server["']/m.test(MAPPER), false);
  assert.match(
    ADMIN,
    /export type \{[\s\S]*?\} from "@\/lib\/actions\/riding-progress-row-mapper";/,
    "types must be re-exported with a from-clause",
  );
});

test("EVERY riding-progress findMany projects the course relation", () => {
  for (const [rel, code] of [
    [ADMIN_REL, ADMIN_CODE],
    [INSTRUCTOR_REL, INSTRUCTOR_CODE],
  ] as const) {
    const reads = [...code.matchAll(/prisma\.studentRidingProgressFeedback\.findMany\(\{([\s\S]*?)\}\);/g)];
    assert.ok(reads.length > 0, `${rel} must have at least one read`);
    for (const [, body] of reads) {
      assert.match(body, /include: RIDING_PROGRESS_COURSE_SELECT/, `${rel}: every read must project the course`);
    }
  }
});

test("the row DTO exposes the course projection or null", () => {
  assert.match(MAPPER, /courseOffering: RidingProgressCourseProjection \| null;/);
});

test("no reader substitutes a fallback course for a null relation", () => {
  for (const code of [ADMIN_CODE, INSTRUCTOR_CODE]) {
    assert.equal(/courseOffering \?\?/.test(code), false, "no ?? fallback on the relation");
    assert.equal(/\|\| *LEVEL_1/.test(code), false);
  }
});

// ---------------------------------------------------------------------------
// Course-choice menu readers
// ---------------------------------------------------------------------------

test("both audiences expose a course-choice reader gated by their own auth", () => {
  const admin = functionBody(ADMIN_CODE, "export async function getRidingProgressCourseChoiceForAdmin(");
  assert.match(admin, /await requireAdmin\(\)/);
  assert.match(admin, /getRidingProgressCourseChoiceForSubject\(studentId\)/);

  const instructor = functionBody(
    INSTRUCTOR_CODE,
    "export async function getRidingProgressCourseChoiceForInstructor(",
  );
  assert.match(instructor, /await requireActingInstructorForRidingProgressWrite\(\)/);
  assert.match(instructor, /if \(!instructor\) return null;/);
  assert.match(instructor, /getRidingProgressCourseChoiceForSubject\(studentId\)/);
});

// ---------------------------------------------------------------------------
// AUTH-RPF-1 remains intact
// ---------------------------------------------------------------------------

test("AUTH-RPF-1 intact - no instructorId returns to any action or call site", () => {
  assert.equal(/instructorId/.test(INSTRUCTOR_CODE), false, "no client-supplied actor id may return");
  assert.match(INSTRUCTOR_CODE, /import \{ getCurrentInstructor \} from "@\/lib\/auth\/actor";/);
  for (const key of [
    "listRidingProgress",
    "createRidingProgress",
    "updateRidingProgress",
    "getRidingProgressCourseChoice",
  ]) {
    const line = stripComments(INSTRUCTOR_CLIENT).split("\n").find((l) => l.includes(`${key}:`));
    assert.ok(line, `${key} must be wired`);
    assert.equal(/instructorId/.test(line), false, `${key} must not send instructorId`);
  }
});

test("attribution still comes from the server actor", () => {
  const body = functionBody(
    INSTRUCTOR_CODE,
    "export async function createStudentRidingProgressFeedbackAsInstructor(",
  );
  assert.match(body, /createdByInstructorId: instructor\.id/);
  assert.match(body, /createdByName: instructor\.fullName/);
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

test("the create form shows a REQUIRED picker only when a choice exists", () => {
  assert.match(SECTION_CODE, /courseChoice\?\.kind === "choose"/);
  assert.match(SECTION_CODE, /const mustChooseCourse = courseChoice\?\.kind === "choose"/);
  assert.match(SECTION_CODE, /const isCourseMissing = mustChooseCourse && values\.courseOfferingId === ""/);
  assert.match(SECTION_CODE, /disabled=\{pending \|\| isCourseMissing\}/, "submit is blocked until chosen");
  assert.match(SECTION_CODE, /<option value="">בחר\/י קורס<\/option>/, "no default selection");
});

test("a single-course trainee sees context, not a picker", () => {
  assert.match(SECTION_CODE, /courseChoice\?\.kind === "auto"/);
  assert.match(SECTION_CODE, /courseChoice\.option\.label/);
});

test("a zero-course trainee cannot add at all", () => {
  assert.match(SECTION_CODE, /const isBlockedByNoCourse = courseChoice\?\.kind === "none"/);
  assert.match(SECTION_CODE, /const canAddNow = canAdd && courseChoice != null && !isBlockedByNoCourse/);
  assert.match(SECTION_CODE, /לא נמצא קורס פעיל לחניך\/ה זה\/זו/);
});

test("the EDIT form has NO editable course selector", () => {
  const editUsage = SECTION_CODE.slice(SECTION_CODE.indexOf('submitLabel="עדכון"'));
  assert.equal(/courseChoice=/.test(editUsage.slice(0, 400)), false, "edit must not receive a choice");
  assert.match(SECTION_CODE, /editingRow=\{row\}/);
  assert.match(SECTION_CODE, /לא ניתן לשנות שיוך קורס/);
  // Exactly one course <select> exists, and it belongs to the create branch.
  assert.equal((SECTION_CODE.match(/values\.courseOfferingId\}/g) ?? []).length, 1);
});

test("every row card renders a course chip", () => {
  assert.match(SECTION_CODE, /function CourseChip\(/);
  assert.match(SECTION_CODE, /ridingProgressCourseChipLabel\(row\.courseOffering\)/);
  assert.match(SECTION_CODE, /<CourseChip row=\{row\} \/>/);
});

test("the filter is rendered from the shared options and defaults to ALL", () => {
  assert.match(SECTION_CODE, /RIDING_PROGRESS_COURSE_FILTER_OPTIONS\.map/);
  assert.match(SECTION_CODE, /useState<RidingProgressCourseFilter>\(\s*RIDING_PROGRESS_DEFAULT_COURSE_FILTER/);
  assert.match(SECTION_CODE, /filterRidingProgressRowsByCourse\(rows, courseFilter\)/);
  assert.match(SECTION_CODE, /visibleRows\.map\(\(row\)/, "the filter drives what renders");
});

test("the FILTER never feeds the combined average", () => {
  // The average is computed in the parent from every loaded row; the filtered
  // array exists only inside the list component.
  assert.equal(/visibleRows/.test(DETAIL_CODE), false, "the parent never sees the filtered set");
  assert.match(
    DETAIL_CODE,
    /averageRatingFromHalfPoints\(ridingProgressRows\.map\(\(r\) => r\.ratingHalfPoints\)\)/,
    "the average reads ALL loaded rows",
  );
});

test("the average carries exactly the locked combined label", () => {
  assert.match(DETAIL_CODE, /subtitle=\{RIDING_PROGRESS_COMBINED_AVERAGE_LABEL\}/);
  assert.equal(
    read("lib/course/riding-progress-journal-view-core.ts").includes("ממוצע משולב לכל הקורסים"),
    true,
  );
});

test("no per-course average was introduced in S4", () => {
  for (const forbidden of ["perCourseAverage", "averageByCourse", "level1Average", "courseAverages"]) {
    assert.equal(DETAIL.includes(forbidden), false, `${forbidden} is out of scope for S4`);
  }
});

test("the combined timeline chips the riding-progress rows too", () => {
  assert.match(DETAIL_CODE, /courseLabel: ridingProgressCourseChipLabel\(row\.courseOffering\)/);
});

test("the course choice is loaded per SUBJECT trainee, never from route or cookie", () => {
  assert.match(DETAIL_CODE, /dataSource\.getRidingProgressCourseChoice/);
  assert.match(DETAIL_CODE, /courseChoice=\{ridingProgressCourseChoice\}/);
  for (const forbidden of ["searchParams", "useParams", "document.cookie", "localStorage"]) {
    assert.equal(DETAIL_CODE.includes(forbidden), false, `the choice must not come from ${forbidden}`);
  }
});

test("both call sites wire the subject-scoped choice reader", () => {
  assert.match(stripComments(ADMIN_CLIENT), /getRidingProgressCourseChoice: getRidingProgressCourseChoiceForAdmin/);
  assert.match(
    stripComments(INSTRUCTOR_CLIENT),
    /getRidingProgressCourseChoice: getRidingProgressCourseChoiceForInstructor/,
  );
});

// ---------------------------------------------------------------------------
// Scope containment
// ---------------------------------------------------------------------------

test("no production offering id is hardcoded anywhere in the S4 surface", () => {
  for (const [rel, src] of [
    [ADMIN_REL, ADMIN],
    [INSTRUCTOR_REL, INSTRUCTOR],
    [SCOPE_REL, SCOPE],
    [SECTION_REL, SECTION],
    ["lib/course/riding-progress-journal-view-core.ts", read("lib/course/riding-progress-journal-view-core.ts")],
  ] as const) {
    assert.doesNotMatch(src, /\bc[a-z0-9]{24}\b/, `${rel} must hardcode no offering id`);
    assert.equal(/temporary-level2-compatibility/.test(src), false, `${rel}: no compatibility module`);
  }
});

test("the S3 backfill planner and runner are NOT imported by runtime code", () => {
  for (const code of [ADMIN, INSTRUCTOR, SCOPE, SECTION, DETAIL, ADMIN_CLIENT, INSTRUCTOR_CLIENT]) {
    assert.equal(/riding-progress-course-backfill-core/.test(code), false);
    assert.equal(/backfill-riding-progress-course-offering/.test(code), false);
  }
});

test("no course is inferred from date, group, title, name or a selected course context", () => {
  const createAdmin = functionBody(ADMIN_CODE, "export async function createStudentRidingProgressFeedbackAsAdmin(");
  const createInstructor = functionBody(
    INSTRUCTOR_CODE,
    "export async function createStudentRidingProgressFeedbackAsInstructor(",
  );
  for (const body of [createAdmin, createInstructor, SCOPE_CODE]) {
    for (const forbidden of ["groupName", "subgroup", "resolveCurrentCourseOffering", "adminCourse", "cookie"]) {
      assert.equal(body.includes(forbidden), false, `course must not be derived from ${forbidden}`);
    }
  }
  // The resolver receives the requested id and the subject id ONLY - no date.
  assert.equal(
    /resolveRidingProgressCourseForCreate\([^)]*date/.test(ADMIN_CODE + INSTRUCTOR_CODE),
    false,
    "the entry's date must never reach course resolution",
  );
});

test("the S1 core was NOT modified by S4", () => {
  const core = read("lib/course/riding-progress-course-scope-core.ts");
  assert.match(core, /export function resolveRidingProgressCourseOfferingIdForCreate\(/);
  assert.match(core, /export function buildRidingProgressCourseChoice\(/);
  assert.equal(/prisma/.test(stripComments(core)), false, "the S1 core must stay pure");
});

test("S4 touches no sibling journal", () => {
  for (const rel of [
    "lib/actions/student-lunge-progress-feedback.ts",
    "lib/actions/student-presentation-progress-feedback.ts",
    "lib/actions/student-lunge-progress-feedback-instructor.ts",
    "lib/actions/student-presentation-progress-feedback-instructor.ts",
  ]) {
    const src = read(rel);
    assert.equal(/courseOfferingId/.test(src), false, `${rel} must remain course-blind in S4`);
  }
});

test("the server scope binding is not a Server Action module", () => {
  assert.equal(/^\s*["']use server["']/m.test(SCOPE), false, "it must be imported, never directly callable");
});

test("only the riding-progress journal imports the S4 scope binding", () => {
  const files: string[] = [];
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
      if (/\.(ts|tsx)$/.test(entry)) files.push(full);
    }
  };
  for (const root of ["app", "lib", "components", "scripts"]) walk(path.join(REPO_ROOT, root));

  const importers = files
    .map((file) => ({
      rel: path.relative(REPO_ROOT, file).replace(/\\/g, "/"),
      src: readFileSync(file, "utf8"),
    }))
    .filter((f) => f.rel !== SCOPE_REL && !f.rel.endsWith(".test.ts"))
    .filter((f) => /(?:from|import)\s*["'][^"']*riding-progress-course-scope["']/.test(f.src))
    .map((f) => f.rel)
    .sort();

  assert.deepEqual(importers, [ADMIN_REL, INSTRUCTOR_REL].sort());
});
