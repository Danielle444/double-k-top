/**
 * MULTI-COURSE (staged-trainee activation guard, Slice G2) - DB-free CONTRACT /
 * source tests for the authoritative activation guard inside setStudentActive.
 *
 * WHY SOURCE-CONTRACT AND NOT RUNTIME DI: lib/actions/students.ts is a "use server"
 * module that imports the Prisma client, next/cache and the admin guard at module
 * scope. Importing it in a unit test would open a real database client, and making
 * it runtime-injectable would mean restructuring committed production code well
 * outside this slice. So this file follows the repository's established
 * *.contract.test.ts pattern (see the N2A/N2B and riding-complex contract tests):
 * it statically inspects the action's source, with comments stripped, so every
 * invariant is asserted against real CODE and never against prose.
 *
 * The behavioral half of the guard - Rule C itself - is already covered by the
 * committed pure unit tests in lib/course/staged-trainee-activation-core.test.ts.
 * What this file proves is the WIRING: authorization order, the exact narrow read,
 * the mapping into the core, that a blocked activation cannot reach
 * prisma.student.update or revalidatePath, that a failed guard read fails closed,
 * and that deactivation performs no guard read at all.
 *
 * Run: npx tsx --test lib/actions/student-activation-guard.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isStagedTraineeActivationBlocked,
  STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
} from "@/lib/course/staged-trainee-activation-core";

// Strip block and line comments so invariants are checked against real CODE only.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readRaw(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function read(relative: string): string {
  return stripComments(readRaw(relative));
}

/** Count non-overlapping occurrences of a literal needle. */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Return the source of the block that starts at the first `{` at or after
 * `fromIndex`, brace-matched to its closing `}` (inclusive). The guarded region
 * contains no string/template literal holding a brace, so a plain depth counter is
 * exact here.
 */
function blockAt(src: string, fromIndex: number): string {
  const open = src.indexOf("{", fromIndex);
  assert.ok(open > -1, "an opening brace must follow");
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error("unbalanced braces");
}

const studentsSrc = read("./students.ts");
const coreSrc = read("../course/staged-trainee-activation-core.ts");

// setStudentActive is the last export in the file; slice from its declaration to
// end of file so every ordering assertion is scoped to its body only.
const actionStart = studentsSrc.indexOf("export async function setStudentActive");
assert.ok(actionStart > -1, "setStudentActive must be exported");
const actionSrc = studentsSrc.slice(actionStart);

// The activation-only guard region: everything inside `if (isActive === true) { ... }`.
const guardIfIndex = actionSrc.indexOf("if (isActive === true)");
assert.ok(guardIfIndex > -1, "the guard must be gated on an explicit isActive === true");
const guardBlock = blockAt(actionSrc, guardIfIndex);
const afterGuard = actionSrc.slice(guardIfIndex + guardBlock.length);

// ---------------------------------------------------------------------------
// 1-3. Authorization order
// ---------------------------------------------------------------------------

test("G2/1: requireAdmin is the FIRST awaited operation in setStudentActive", () => {
  const firstAwait = actionSrc.indexOf("await ");
  assert.ok(firstAwait > -1, "the action must await something");
  assert.ok(
    actionSrc.slice(firstAwait).startsWith("await requireAdmin()"),
    "the first await must be requireAdmin()",
  );
});

test("G2/2: requireAdmin precedes the guard read (courseEnrollment.findMany)", () => {
  const admin = actionSrc.indexOf("requireAdmin(");
  const read = actionSrc.indexOf("prisma.courseEnrollment.findMany(");
  assert.ok(admin > -1 && read > -1);
  assert.ok(admin < read, "requireAdmin must precede any CourseEnrollment read");
});

test("G2/3: requireAdmin precedes student.update, the classifier and revalidation", () => {
  const admin = actionSrc.indexOf("requireAdmin(");
  for (const later of [
    "prisma.student.update(",
    "isStagedTraineeActivationBlocked(",
    "revalidatePath(",
    "return { success: true }",
  ]) {
    const idx = actionSrc.indexOf(later);
    assert.ok(idx > -1, `${later} must exist`);
    assert.ok(admin < idx, `requireAdmin must precede ${later}`);
  }
});

test("G2/3b: the existing admin guard is neither weakened nor made conditional", () => {
  assert.equal(count(actionSrc, "requireAdmin("), 1, "exactly one admin guard call");
  assert.ok(
    /setStudentActive\([\s\S]*?\)\s*:\s*Promise<ActionResult>\s*\{\s*await requireAdmin\(\);/.test(
      actionSrc,
    ),
    "requireAdmin() must be the first statement of the body, unconditionally",
  );
  assert.ok(
    actionSrc.indexOf("requireAdmin(") < guardIfIndex,
    "requireAdmin must precede the isActive branch entirely",
  );
});

// ---------------------------------------------------------------------------
// 4-7. The activation guard read and its wiring into Rule C
// ---------------------------------------------------------------------------

test("G2/4: an activation target performs the narrow enrollment query", () => {
  assert.equal(
    count(actionSrc, "prisma.courseEnrollment.findMany("),
    1,
    "exactly one guard read",
  );
  assert.ok(
    guardBlock.includes("prisma.courseEnrollment.findMany("),
    "the guard read must live inside the isActive === true branch",
  );
});

test("G2/5: the query is scoped by the exact studentId and nothing else", () => {
  assert.ok(
    /findMany\(\{\s*where:\s*\{\s*studentId\s*\}/.test(guardBlock),
    "the where clause must be exactly { studentId }",
  );
  for (const forbidden of ["findFirst", "findUnique", "student.findMany", "take:", "orderBy"]) {
    assert.ok(!guardBlock.includes(forbidden), `the guard read must not use ${forbidden}`);
  }
});

test("G2/6: the query selects ONLY enrollment status and offering status", () => {
  assert.ok(
    /select:\s*\{\s*status:\s*true,\s*courseOffering:\s*\{\s*select:\s*\{\s*status:\s*true,?\s*\}/.test(
      guardBlock,
    ),
    "select must be exactly enrollment.status + courseOffering.status",
  );
  for (const forbidden of [
    "id: true",
    "name: true",
    "level: true",
    "startDate",
    "endDate",
    "isPrimary",
    "student: {",
    "memberships",
    "identityNumber",
    "groupName",
    "subgroupNumber",
    "Horse",
    "horse",
  ]) {
    assert.ok(!guardBlock.includes(forbidden), `the guard read must not select ${forbidden}`);
  }
});

test("G2/7: the mapped rows are what is passed to isStagedTraineeActivationBlocked", () => {
  assert.ok(
    /rows\.map\(\(row\) => \(\{\s*status: row\.status,\s*offeringStatus: row\.courseOffering\.status,\s*\}\)\)/.test(
      guardBlock,
    ),
    "each row must map to exactly { status, offeringStatus }",
  );
  assert.ok(
    guardBlock.includes("isStagedTraineeActivationBlocked(false, enrollments)"),
    "the classifier must receive the inactive-state flag and the mapped rows",
  );
  assert.equal(
    count(actionSrc, "isStagedTraineeActivationBlocked("),
    1,
    "exactly one classification call",
  );
  const mapIdx = guardBlock.indexOf("rows.map(");
  const callIdx = guardBlock.indexOf("isStagedTraineeActivationBlocked(");
  assert.ok(mapIdx < callIdx, "the mapping must precede the classification");
});

test("G2/7b: the current state is server-defined, never taken from the client", () => {
  assert.ok(
    !/isStagedTraineeActivationBlocked\(\s*isActive/.test(guardBlock),
    "the client-supplied target must not be passed as the current state",
  );
  assert.ok(
    guardBlock.includes("isStagedTraineeActivationBlocked(false,"),
    "the transition is evaluated as activation of an inactive account",
  );
});

test("G2/7c: Rule C inputs only - no name/level/group/cookie/offering resolution", () => {
  for (const forbidden of [
    "groupName",
    "subgroupNumber",
    "level",
    "cookies(",
    "headers(",
    "resolveCurrentCourseOffering",
    "courseOfferingId",
    "STAGED_TRAINEE_ROW_LABEL",
    "STAGED_TRAINEE_ACTIVATION_TOOLTIP",
  ]) {
    assert.ok(!actionSrc.includes(forbidden), `setStudentActive must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 8-11. Blocked-activation behavior
// ---------------------------------------------------------------------------

test("G2/8+9: a blocked classification returns success:false with the G1 message", () => {
  assert.ok(
    /if \(isStagedTraineeActivationBlocked\(false, enrollments\)\) \{\s*return \{ success: false, error: STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE \};\s*\}/.test(
      guardBlock,
    ),
    "the blocked branch must return the stable G1 message and nothing else",
  );
  assert.ok(
    studentsSrc.includes("STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE"),
    "the message must be the imported constant, not an inlined copy",
  );
  assert.ok(
    !studentsSrc.includes(STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE),
    "the Hebrew text must not be duplicated as a literal in the action file",
  );
  assert.ok(typeof STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE === "string");
  assert.ok(STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE.trim().length > 0);
});

test("G2/8b: the blocked branch returns and never throws", () => {
  assert.ok(!guardBlock.includes("throw "), "the guard must not throw");
});

test("G2/10: the guard region contains NO Student write at all", () => {
  for (const forbidden of [
    "student.update",
    "student.create",
    "student.upsert",
    "student.delete",
    "$transaction",
    "$executeRaw",
    "courseEnrollment.update",
    "courseEnrollment.create",
    "groupMembership",
  ]) {
    assert.ok(!guardBlock.includes(forbidden), `the guard region must not contain ${forbidden}`);
  }
});

test("G2/11: the guard region performs no revalidation", () => {
  assert.ok(!guardBlock.includes("revalidatePath"), "a blocked activation must not revalidate");
});

test("G2/10b: every Student write and revalidation sits AFTER the guard region", () => {
  assert.equal(count(actionSrc, "prisma.student.update("), 1, "exactly one Student write");
  assert.ok(afterGuard.includes("prisma.student.update("), "the write follows the guard");
  assert.equal(count(actionSrc, "revalidatePath("), 2, "exactly the two existing revalidations");
  assert.equal(count(afterGuard, "revalidatePath("), 2, "both revalidations follow the guard");
  assert.equal(count(actionSrc, "return { success: true }"), 1, "exactly one success return");
  assert.ok(afterGuard.includes("return { success: true }"), "success follows the guard");
});

// ---------------------------------------------------------------------------
// 12-15. Allowed activation
// ---------------------------------------------------------------------------

test("G2/12: an unblocked classification falls through to the existing update", () => {
  assert.equal(
    count(guardBlock, "return "),
    2,
    "the guard returns ONLY on the read-failure and blocked paths; otherwise it falls through",
  );
  assert.ok(
    /prisma\.student\.update\(\{ where: \{ id: studentId \}, data: \{ isActive \} \}\)/.test(
      afterGuard,
    ),
    "the committed update statement must be preserved verbatim",
  );
});

test("G2/13: the update writes ONLY isActive", () => {
  assert.ok(
    /data: \{ isActive \}/.test(afterGuard),
    "data must be the isActive shorthand and nothing else",
  );
  for (const forbidden of [
    "fullName",
    "firstName",
    "lastName",
    "identityNumber",
    "phone",
    "groupName",
    "subgroupNumber",
  ]) {
    assert.ok(!actionSrc.includes(forbidden), `the update must not touch ${forbidden}`);
  }
});

test("G2/14+15: revalidation targets and the success result are unchanged", () => {
  assert.ok(afterGuard.includes('revalidatePath("/admin/students")'), "students path preserved");
  assert.ok(afterGuard.includes('revalidatePath("/admin")'), "admin path preserved");
  assert.ok(!actionSrc.includes('revalidatePath("/")'), "no new global revalidation");
  assert.ok(
    /revalidatePath\("\/admin\/students"\);\s*revalidatePath\("\/admin"\);\s*return \{ success: true \};/.test(
      afterGuard,
    ),
    "the committed tail of the action must be preserved verbatim",
  );
});

// ---------------------------------------------------------------------------
// 16-20. Deactivation
// ---------------------------------------------------------------------------

test("G2/16: isActive === false structurally skips the enrollment read", () => {
  assert.ok(
    guardBlock.includes("prisma.courseEnrollment.findMany("),
    "the only enrollment read is inside the activation-only branch",
  );
  assert.equal(
    count(afterGuard, "courseEnrollment"),
    0,
    "no enrollment access exists on the deactivation path",
  );
  const beforeGuard = actionSrc.slice(0, guardIfIndex);
  assert.equal(
    count(beforeGuard, "courseEnrollment"),
    0,
    "no enrollment access precedes the activation branch",
  );
});

test("G2/17: isActive === false structurally skips the classifier", () => {
  assert.ok(guardBlock.includes("isStagedTraineeActivationBlocked("));
  assert.equal(
    count(afterGuard, "isStagedTraineeActivationBlocked("),
    0,
    "no classification on the deactivation path",
  );
  assert.equal(count(actionSrc.slice(0, guardIfIndex), "isStagedTraineeActivationBlocked("), 0);
});

test("G2/18+19: deactivation still reaches the update and writes isActive:false", () => {
  assert.ok(afterGuard.includes("prisma.student.update("), "the write is outside the branch");
  assert.ok(
    /data: \{ isActive \}/.test(afterGuard),
    "the parameter is written verbatim, so false is written as false",
  );
});

test("G2/20: nothing gates deactivation on enrollment state", () => {
  assert.ok(
    !/isActive === false/.test(actionSrc),
    "there must be no deactivation-side branch to gate",
  );
  assert.equal(count(actionSrc, "if ("), 2, "exactly the activation gate and the blocked check");
});

// ---------------------------------------------------------------------------
// 21-24. Fail-closed guard-read failure
// ---------------------------------------------------------------------------

test("G2/21: a failed guard read cannot fall through to student.update", () => {
  const catchIdx = guardBlock.indexOf("} catch {");
  assert.ok(catchIdx > -1, "the guard read must be wrapped in try/catch");
  const catchBlock = blockAt(guardBlock, catchIdx + 1);
  assert.ok(catchBlock.includes("return {"), "the catch must return, not continue");
  for (const forbidden of ["student.update", "revalidatePath", "success: true"]) {
    assert.ok(!catchBlock.includes(forbidden), `the catch must not reach ${forbidden}`);
  }
});

test("G2/22: a failed guard read returns the stable non-PII generic error", () => {
  assert.ok(
    guardBlock.includes(
      "return { success: false, error: ACTIVATION_GUARD_UNAVAILABLE_MESSAGE };",
    ),
    "the catch must return the dedicated stable message",
  );
  const declaration = studentsSrc.match(
    /const ACTIVATION_GUARD_UNAVAILABLE_MESSAGE\s*=\s*"([^"]+)";/,
  );
  assert.ok(declaration, "the stable message must be a module constant");
  const message = declaration[1];
  assert.ok(message.trim().length > 0, "the message must be non-empty");
  assert.notEqual(
    message,
    STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
    "an unreadable guard must NOT be mislabeled as a verified Rule C block",
  );
});

test("G2/23: no Prisma error value is captured, logged, or returned", () => {
  assert.ok(guardBlock.includes("} catch {"), "the catch must bind no error value");
  for (const forbidden of [
    "catch (",
    "err.",
    "error.message",
    "String(err",
    "JSON.stringify",
    "console.",
    "PrismaClientKnownRequestError",
    ".code",
  ]) {
    assert.ok(!guardBlock.includes(forbidden), `the guard must not surface ${forbidden}`);
  }
});

test("G2/24: the action returns EXACTLY the two approved stable errors, PII-free", () => {
  const errors = [...actionSrc.matchAll(/error:\s*([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(errors)].sort(),
    ["ACTIVATION_GUARD_UNAVAILABLE_MESSAGE", "STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE"],
    "only the two stable constants may be returned as errors",
  );
  assert.ok(!/error:\s*[`"']/.test(actionSrc), "no inline or interpolated error string");
  const declaration = studentsSrc.match(
    /const ACTIVATION_GUARD_UNAVAILABLE_MESSAGE\s*=\s*"([^"]+)";/,
  );
  assert.ok(declaration);
  for (const forbidden of ["${", "studentId", "identityNumber", "PLANNED", "ACTIVE", "Prisma"]) {
    assert.ok(!declaration[1].includes(forbidden), `the message must not include ${forbidden}`);
    assert.ok(
      !STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE.includes(forbidden),
      `the G1 message must not include ${forbidden}`,
    );
  }
  assert.ok(
    !actionSrc.includes("enrollments }") && !/return \{[^}]*enrollments/.test(actionSrc),
    "no enrollment or offering data may be returned",
  );
});

// ---------------------------------------------------------------------------
// 25-30. Scope
// ---------------------------------------------------------------------------

// SCOPE IS PROVEN FROM THE SERVER FILE, NOT FROM THE UI. G2 must show that IT
// did no UI work; it must NOT freeze the UI. The already-approved next slice G3
// will deliberately wire activationBlocked, STAGED_TRAINEE_ROW_LABEL,
// STAGED_TRAINEE_ACTIVATION_TOOLTIP and the G1 core into StudentsClient.tsx, so
// this file deliberately reads NEITHER StudentsClient.tsx, NOR
// app/admin/students/page.tsx, NOR trainee-affiliations-core.ts. Every scope
// assertion below is a property of lib/actions/students.ts alone and stays true
// after G3 ships.

test("G2/25a: the entire G2 production change is contained in lib/actions/students.ts", () => {
  // The guard is inlined in the action: read, mapping, classification and both
  // failure returns all live inside setStudentActive, so no second production
  // module was introduced or edited to make this slice work.
  for (const piece of [
    "prisma.courseEnrollment.findMany(",
    "rows.map(",
    "isStagedTraineeActivationBlocked(false, enrollments)",
    "STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE",
    "ACTIVATION_GUARD_UNAVAILABLE_MESSAGE",
  ]) {
    assert.ok(guardBlock.includes(piece), `the guard must contain ${piece} in-line`);
  }
  // The import surface is exactly the committed set plus the single G1 core.
  const imports = [...studentsSrc.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, [
    "@/lib/auth/require-admin",
    "@/lib/course/create-trainee-enrollment-core",
    "@/lib/course/current-offering",
    "@/lib/course/staged-trainee-activation-core",
    "@/lib/prisma",
    "@/lib/trainee-history/group-change-service",
    "@/lib/trainee-history/israel-date",
    "next/cache",
    "zod",
  ]);
});

test("G2/25b: setStudentActive itself carries the server-side Rule C guard", () => {
  assert.ok(
    actionSrc.includes("isStagedTraineeActivationBlocked("),
    "the classification must run inside the server action",
  );
  assert.ok(
    guardBlock.indexOf("prisma.courseEnrollment.findMany(") <
      guardBlock.indexOf("isStagedTraineeActivationBlocked("),
    "the server reads the lifecycle state itself and then classifies it",
  );
  assert.ok(
    studentsSrc.includes('"use server"'),
    "the guard lives in a server-only module, so it cannot be bypassed client-side",
  );
});

test("G2/25c: lib/actions/students.ts imports no UI component or client module", () => {
  const imports = [...studentsSrc.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  for (const specifier of imports) {
    assert.ok(!specifier.endsWith(".tsx"), `must not import the component ${specifier}`);
    assert.ok(!specifier.startsWith("@/app/"), `must not import from the app tree: ${specifier}`);
    assert.ok(
      !specifier.startsWith("@/components"),
      `must not import a UI component: ${specifier}`,
    );
    assert.ok(
      !["react", "react-dom", "next/link", "next/navigation"].includes(specifier),
      `must not import the client runtime module ${specifier}`,
    );
  }
});

test("G2/25d: students.ts contains no JSX, UI label, tooltip, button or client hook", () => {
  assert.ok(!studentsSrc.includes('"use client"'), "the module must stay server-only");
  // JSX-specific probes only: a TS generic such as Promise<ActionResult> has no
  // closing tag, no self-closing slash and no rendered return.
  assert.ok(!studentsSrc.includes("</"), "no JSX closing tag may appear");
  assert.ok(!studentsSrc.includes("/>"), "no self-closing JSX element may appear");
  assert.ok(!/return\s*\(\s*</.test(studentsSrc), "the module must render nothing");
  assert.ok(
    !/<(div|span|p|button|input|label|form|section|table|tr|td|ul|li)\b/.test(studentsSrc),
    "no HTML element may appear",
  );
  for (const forbidden of [
    "className",
    "aria-",
    "title=",
    "tooltip",
    "Tooltip",
    "<button",
    "onClick",
    "disabled",
    "useState",
    "useEffect",
    "useTransition",
    "useFormStatus",
    "STAGED_TRAINEE_ROW_LABEL",
    "STAGED_TRAINEE_ACTIVATION_TOOLTIP",
  ]) {
    assert.ok(!studentsSrc.includes(forbidden), `students.ts must not contain ${forbidden}`);
  }
});

test("G2/25e: G2 leaves the G1 presentation surface intact and available to G3", () => {
  // Positive scope proof: the row label and tooltip constants a future approved UI
  // slice will consume are still exported by the untouched core, and G2 simply did
  // not consume them. Nothing here forbids that future wiring.
  assert.ok(coreSrc.includes("export const STAGED_TRAINEE_ROW_LABEL"));
  assert.ok(coreSrc.includes("export const STAGED_TRAINEE_ACTIVATION_TOOLTIP"));
});

test("G2/26+28: the action changes no affiliation / read-model / N1 / N2 behavior", () => {
  for (const forbidden of [
    "trainee-affiliations-core",
    "buildTraineeAffiliationRows",
    "buildTraineeAffiliationSummary",
    "enrollment-view",
    "readOfferingEnrollmentsForAdmin",
    "create-trainee-into-offering-core",
    "createTraineeIntoOffering",
    "createTraineeIntoOfferingAction",
  ]) {
    assert.ok(!studentsSrc.includes(forbidden), `students.ts must not reference ${forbidden}`);
  }
  // The only enrollment access G2 adds is a read; no enrollment/membership row is
  // written, so no affiliation read model can shift as a side effect.
  assert.equal(count(studentsSrc, "courseEnrollment."), 1, "exactly one enrollment access");
  assert.ok(studentsSrc.includes("courseEnrollment.findMany("), "and it is a read");
});

test("G2/27: the committed G1 core is unmodified and still holds Rule C", () => {
  assert.ok(coreSrc.includes("export function isStagedTraineeActivationBlocked("));
  assert.ok(coreSrc.includes("export const STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE"));
  assert.ok(coreSrc.includes("export interface ActivationEnrollmentInput"));
  assert.ok(
    coreSrc.includes(
      "return hasActiveEnrollmentInPlannedOffering && !hasActiveEnrollmentInActiveOffering;",
    ),
    "Rule C must be intact",
  );
  assert.ok(!coreSrc.includes("prisma."), "the core must remain DB-free");
  assert.ok(
    coreSrc.includes("import type {"),
    "the core's only Prisma reference must remain the erased type-only import",
  );
  assert.ok(!coreSrc.includes("@/lib/prisma"), "the core must not import the Prisma client");
  // Behavioral spot-check of the committed core through the exact G2 call shape.
  assert.equal(
    isStagedTraineeActivationBlocked(false, [
      { status: "ACTIVE", offeringStatus: "PLANNED" },
    ]),
    true,
  );
  assert.equal(
    isStagedTraineeActivationBlocked(false, [
      { status: "ACTIVE", offeringStatus: "PLANNED" },
      { status: "ACTIVE", offeringStatus: "ACTIVE" },
    ]),
    false,
  );
  assert.equal(isStagedTraineeActivationBlocked(false, []), false);
});

test("G2/29+30: no schema, auth, session, cookie, capability or lifecycle logic added", () => {
  for (const forbidden of [
    "cookies(",
    "headers(",
    "getSession",
    "getCurrentInstructor",
    "lib/auth/session",
    "capabilit",
    "CourseOperation",
    "evaluateCourseOperationPolicy",
    "$executeRaw",
    "$queryRaw",
    "migration",
    "prisma.$transaction((tx) => tx",
  ]) {
    assert.ok(!studentsSrc.includes(forbidden), `students.ts must not reference ${forbidden}`);
  }
  assert.equal(
    count(studentsSrc, 'from "@/lib/auth/require-admin"'),
    1,
    "the admin guard import is unchanged and is the only auth import",
  );
});

test("G2/30b: no audit log, notification or automatic enrollment change was added", () => {
  for (const forbidden of [
    "AuditLog",
    "auditLog",
    "notification",
    "Notification",
    "sendPush",
    "courseEnrollment.update",
    "courseEnrollment.create",
    "courseEnrollment.upsert",
  ]) {
    assert.ok(!studentsSrc.includes(forbidden), `students.ts must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 31-33. Regression
// ---------------------------------------------------------------------------

test("G2/31: the setStudentActive signature is unchanged", () => {
  assert.ok(
    /export async function setStudentActive\(\s*studentId: string,\s*isActive: boolean\s*\): Promise<ActionResult> \{/.test(
      actionSrc,
    ),
    "the two-parameter signature and ActionResult return type must be preserved",
  );
});

test("G2/32: createStudent and updateStudent are unchanged by this slice", () => {
  const createSrc = studentsSrc.slice(
    studentsSrc.indexOf("export async function createStudent"),
    studentsSrc.indexOf("export async function updateStudent"),
  );
  const updateSrc = studentsSrc.slice(
    studentsSrc.indexOf("export async function updateStudent"),
    studentsSrc.indexOf("export async function changeTraineeGroup"),
  );
  assert.ok(createSrc.includes("createTraineeWithEnrollmentSafe("), "W6B flow preserved");
  assert.ok(createSrc.includes("runTraineeCreateInTx"), "W6B transaction preserved");
  assert.ok(updateSrc.includes("studentEditSchema.safeParse("), "W6D3 edit schema preserved");
  assert.ok(
    updateSrc.includes("כבר קיים/ת חניך/ה עם מספר תעודת זהות זה"),
    "the duplicate-identity guard is preserved",
  );
  for (const region of [createSrc, updateSrc]) {
    assert.ok(
      !region.includes("isStagedTraineeActivationBlocked"),
      "the activation guard must not leak into the create/edit flows",
    );
    assert.ok(!region.includes("isActive"), "neither flow may write isActive");
  }
});

test("G2/33: changeTraineeGroup is untouched", () => {
  const groupSrc = studentsSrc.slice(
    studentsSrc.indexOf("export async function changeTraineeGroup"),
    actionStart,
  );
  assert.ok(groupSrc.includes("writeTraineeGroupChange("), "the W6D3 service call is preserved");
  assert.ok(groupSrc.includes("resolveCurrentCourseOffering()"), "server-side offering preserved");
  assert.ok(!groupSrc.includes("isStagedTraineeActivationBlocked"), "no guard leakage");
});
