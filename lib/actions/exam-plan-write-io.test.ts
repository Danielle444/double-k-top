/**
 * EXAM PLAN P2 — tests for the ExamPlan CREATE binding
 * (lib/actions/exam-plan-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-plan-write-io.test.ts
 *
 * TWO KINDS OF PROOF, AND WHY.
 *
 * 1. STRUCTURAL. The module under test declares `import "server-only"`, which is
 *    exactly the guarantee this slice wants — and which makes the module
 *    UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 *    unimportable from any client bundle). Its authorization import chain would
 *    also construct a database client. So the same approach the committed exam
 *    read-contract and definition-write suites take is used here: this suite reads
 *    the module's SOURCE and asserts on its structure — which statements exist, on
 *    which client, with which payload, and which dependency name each binding is
 *    wired to.
 *
 * 2. RUNTIME. The BEHAVIOUR — the order, the idempotence, the race translation and
 *    the redirect pass-through — belongs to the committed pure core, and is
 *    exercised here at runtime with fakes standing in for the two Prisma
 *    statements and the admin boundary, bound EXACTLY as the module binds them.
 *    The one classifier that decides Prisma-specific behaviour, the offering
 *    uniqueness conflict, is the REAL committed function, imported and called for
 *    real — so the "which P2002 maps to a re-read" assertions below are not a
 *    restatement of the module's source but a genuine execution of the rule the
 *    module binds.
 *
 *    What the runtime half can and cannot prove is stated plainly: the fakes
 *    reproduce the module's dependency bundle, and the structural half is what
 *    proves the module really wires THOSE functions to THOSE dependency names. The
 *    two together are what make the claim; neither is sufficient alone. The two
 *    typed error classes (the offering not-found and the lifecycle denial) are
 *    stood in for by local sentinels, because importing the real ones would pull in
 *    the auth chain and a database client; the structural half asserts that the
 *    module classifies each of them by IDENTITY and by nothing else, which is the
 *    property the sentinels reproduce.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import {
  createExamPlanWithDeps,
  isExamPlanOfferingConflictError,
  type CreateExamPlanDeps,
  type CreateExamPlanResult,
  type ResolvedExamPlan,
} from "../exam/create-exam-plan-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-plan-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-plan-write-io.test.ts");
const CORE_REL = join("lib", "exam", "create-exam-plan-core.ts");
const CORE_TEST_REL = join("lib", "exam", "create-exam-plan-core.test.ts");

/**
 * P3 — the course-scoped exams route, in git's own form (forward slashes on every
 * platform), and the ONE Server Action module authorized to call this binding.
 *
 * Spelled out as an exact path rather than a directory or a glob on purpose: the
 * point of the caller guard is that a SECOND route, a second Server Action module
 * or any `.tsx` component still fails it.
 */
const P3_ROUTE_DIR = "app/admin/courses/[courseOfferingId]/exams";
const P3_APPROVED_CALLER = `${P3_ROUTE_DIR}/actions.ts`;
/** That route's own contract suite, which NAMES this module in order to pin it. */
const P3_APPROVED_SUITE = `${P3_ROUTE_DIR}/exam-plan-create.contract.test.ts`;

const SOURCE = readFileSync(join(REPO_ROOT, IO_REL), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Keep ONLY the comments, for the "is this documented?" assertions. */
function commentsOf(source: string): string {
  return [
    ...(source.match(/\/\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/^\s*\/\/.*$/gm) ?? []),
  ].join("\n");
}

const CODE = stripComments(SOURCE);
const COMMENTS = commentsOf(SOURCE);
const CORE_CODE = stripComments(readFileSync(join(REPO_ROOT, CORE_REL), "utf8"));

/**
 * One top-level function's body, from its declaration to the closing brace in
 * column 0 — so an "inside this helper" assertion means what it says.
 */
function bodyOf(name: string): string {
  const start = CODE.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is missing`);
  const end = CODE.indexOf("\n}", start);
  assert.ok(end > start, `${name} is unbalanced`);
  return CODE.slice(start, end + 2);
}

/**
 * The balanced argument list of ONE call expression, whitespace-collapsed — so the
 * "the payload is EXACTLY this and nothing more" assertions can be anchored.
 */
function callArguments(needle: string): string {
  const at = CODE.indexOf(needle);
  assert.ok(at > 0, `${needle} is missing`);
  const from = at + needle.length - 1;
  let depth = 0;
  for (let i = from; i < CODE.length; i += 1) {
    if (CODE[i] === "(") depth += 1;
    else if (CODE[i] === ")") {
      depth -= 1;
      if (depth === 0) return CODE.slice(from, i + 1).replace(/\s+/g, " ");
    }
  }
  throw new Error(`${needle} is unbalanced`);
}

/** Every exported function signature in the module, in source order. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

function signature(name: string): { name: string; params: string; returns: string } {
  const found = SIGNATURES.find((entry) => entry.name === name);
  assert.ok(found, `${name} is not exported`);
  return found;
}

/** Every `prisma.x.y` / `tx.x.y` call, in source order. */
const PRISMA_CALLS = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];

// ===========================================================================
// The runtime harness — the module's dependency bundle, reproduced with fakes
// ===========================================================================

/** The id the caller REQUESTS. Deliberately different from the verified one. */
const REQUESTED_OFFERING_ID = "requested-offering-id";
/** The id the admin boundary VERIFIES and returns. */
const VERIFIED_OFFERING_ID = "verified-offering-id";
/** The id the fake create assigns. */
const NEW_PLAN_ID = "plan-created-by-this-call";

/**
 * Stand-ins for the project's typed offering not-found and the committed policy's
 * typed lifecycle denial. The module classifies each by IDENTITY
 * (`error instanceof X`) and by nothing else — asserted structurally at 5 and 6 —
 * so a local class reproduces exactly the property under test without importing
 * the auth chain or a database client.
 */
class SentinelOfferingNotFound extends Error {}
class SentinelOperationNotPermitted extends Error {}

interface HarnessOptions {
  /** Results the plan lookup returns, in call order: pre-check, then re-read. */
  readonly findResults?: readonly (ResolvedExamPlan | null)[];
  readonly authThrows?: unknown;
  readonly gateThrows?: unknown;
  readonly createThrows?: unknown;
}

interface Harness {
  readonly deps: CreateExamPlanDeps;
  /** Every dependency call, in the order it happened. */
  readonly log: { kind: string; value: string }[];
  readonly findCalls: string[];
  readonly createCalls: string[];
}

/**
 * The module's bundle, dependency-for-dependency:
 *   requireCourseContext                -> the admin boundary + exact offering
 *   assertConfigurationAllowed          -> the lifecycle gate
 *   findExamPlanByCourseOfferingId      -> the ONE read
 *   createExamPlanForCourseOffering     -> the ONE write
 *   isCourseNotFoundError               -> an identity check
 *   isOperationNotAllowedError          -> an identity check
 *   isPlanCourseOfferingUniqueConflict  -> the REAL committed classifier
 */
function harness(options: HarnessOptions = {}): Harness {
  const log: { kind: string; value: string }[] = [];
  const findCalls: string[] = [];
  const createCalls: string[] = [];
  const findResults = [...(options.findResults ?? [null])];

  const deps: CreateExamPlanDeps = {
    async requireCourseContext(requestedCourseOfferingId) {
      log.push({ kind: "auth", value: requestedCourseOfferingId });
      if ("authThrows" in options) throw options.authThrows;
      return { courseOfferingId: VERIFIED_OFFERING_ID, status: "ACTIVE" };
    },
    assertConfigurationAllowed(status) {
      log.push({ kind: "gate", value: status });
      if ("gateThrows" in options) throw options.gateThrows;
    },
    async findExamPlanByCourseOfferingId(verifiedCourseOfferingId) {
      log.push({ kind: "find", value: verifiedCourseOfferingId });
      findCalls.push(verifiedCourseOfferingId);
      assert.ok(findResults.length > 0, "the plan lookup was called more times than expected");
      return findResults.shift() ?? null;
    },
    async createExamPlanForCourseOffering(verifiedCourseOfferingId) {
      log.push({ kind: "create", value: verifiedCourseOfferingId });
      createCalls.push(verifiedCourseOfferingId);
      if ("createThrows" in options) throw options.createThrows;
      return { id: NEW_PLAN_ID };
    },
    isCourseNotFoundError: (error) => error instanceof SentinelOfferingNotFound,
    isOperationNotAllowedError: (error) => error instanceof SentinelOperationNotPermitted,
    // The real one, exactly as the module binds it.
    isPlanCourseOfferingUniqueConflict: isExamPlanOfferingConflictError,
  };

  return { deps, log, findCalls, createCalls };
}

function run(h: Harness): Promise<CreateExamPlanResult> {
  return createExamPlanWithDeps(REQUESTED_OFFERING_ID, h.deps);
}

/** A unique-constraint violation, in the shape the database driver reports. */
function uniqueViolation(target: unknown): unknown {
  return { code: "P" + "2002", meta: { target } };
}

/** A framework redirect: a `digest`, and deliberately NO error code. */
function frameworkRedirect(): Error {
  const error = new Error("NEXT_" + "REDIRECT");
  (error as Error & { digest: string }).digest = "NEXT_" + "REDIRECT;replace;/login;307;";
  return error;
}

// ===========================================================================
// 1–4. Module kind and the public signature
// ===========================================================================

test("1. the module imports server-only as its FIRST statement", () => {
  const serverOnly = new RegExp('import\\s+"server' + '-only";');
  assert.ok(serverOnly.test(CODE), "the module is not server-only");
  const firstStatement = CODE.split("\n").find((line) => line.trim().length > 0);
  assert.ok(firstStatement);
  assert.ok(serverOnly.test(firstStatement), `the first statement is: ${firstStatement}`);
});

test("2. the module is NOT a Server Action module and declares no route handler", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  for (const token of [
    "export const",
    "export default",
    "export class",
    "GET",
    "POST",
    "NextRequest",
    "NextResponse",
    "revalidatePath",
    "revalidateTag",
    "redirect(",
    "notFound(",
    "cookies(",
    "headers(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports EXACTLY ONE function, with the exact public signature", () => {
  assert.deepEqual(SIGNATURES.map((entry) => entry.name), ["createExamPlan"]);
  assert.ok(/export async function createExamPlan\(/.test(SOURCE));

  const create = signature("createExamPlan");
  assert.equal(create.params, "courseOfferingId: string,");
  assert.equal(create.returns, "Promise<CreateExamPlanResult>");

  // The result TYPE is the core's, re-exported rather than redeclared, so the two
  // can never describe different outcomes.
  assert.equal(
    (SOURCE.match(/export type \{ CreateExamPlanResult \} from/g) ?? []).length,
    1,
  );
  assert.equal(CODE.includes("interface CreateExamPlanResult"), false);
  assert.equal(CODE.includes("type CreateExamPlanResult ="), false);
});

test("4. the public function accepts NOTHING but a requested offering id", () => {
  const params = signature("createExamPlan").params;
  for (const forbidden of [
    "planId",
    "plan",
    "publishedAt",
    "published",
    "created",
    "sourceDate",
    "definition",
    "session",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "expectedUpdatedAt",
    "rawInput",
    "tx",
    "prisma",
    "deps",
    "Date",
  ]) {
    assert.equal(params.includes(forbidden), false, `createExamPlan accepts ${forbidden}`);
  }
  // Exactly one parameter, and it is a plain string.
  assert.equal(params.split(":").length - 1, 1, `the signature is: ${params}`);
});

// ===========================================================================
// 5–8. Authorization and the lifecycle gate — bound once, and FIRST
// ===========================================================================

test("5. the admin boundary is bound exactly once, on the REQUESTED id", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.equal((CODE.match(/requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /await requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  // Only the offering's id and status are carried forward.
  const boundary = bodyOf("requireCourseContext");
  assert.ok(/courseOfferingId: context\.id\b/.test(boundary), `the boundary is: ${boundary}`);
  assert.ok(/status: context\.status\b/.test(boundary), `the boundary is: ${boundary}`);
  for (const forbidden of ["context.name", "context.level", "context.startDate", "context.endDate"]) {
    assert.equal(boundary.includes(forbidden), false, `the context leaks ${forbidden}`);
  }
  // The typed not-found is classified by IDENTITY, and nothing is caught broadly.
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  assert.equal((CODE.match(/catch\s*\(/g) ?? []).length, 0, "the binding catches");
  assert.equal((CODE.match(/try\s*\{/g) ?? []).length, 0, "the binding has a try block");
});

test("6. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/"SCHEDULE_DRAFT_CONFIGURATION"/g) ?? []).length, 1);
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"SCHEDULE_DRAFT_CONFIGURATION"/.test(CODE),
    "the gate does not use the approved operation",
  );
  // The denial is classified by IDENTITY.
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
  // No other lifecycle operation is referenced.
  for (const other of [
    "OFFERING_STRUCTURE_UPDATE",
    "OFFERING_METADATA_UPDATE",
    "SCHEDULE_PUBLICATION",
    "ENROLLMENT_MANAGEMENT",
    "TEACHING_PRACTICE_OPERATION",
    "DESTRUCTIVE_MAINTENANCE",
    "EXAM_CONFIGURATION",
  ]) {
    assert.equal(CODE.includes(other), false, `the module also references ${other}`);
  }
  // The temporary reuse is documented, as is the possible dedicated operation.
  assert.ok(/lifecycle/i.test(COMMENTS), "the lifecycle reuse is undocumented");
  assert.ok(/exam-configuration/i.test(COMMENTS), "the future dedicated operation is undocumented");
});

test("7. the module consults NO capability of any kind", () => {
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    '"SCHEDULE"',
    "'SCHEDULE'",
    "CapabilityKey",
    "capability",
    "Capability",
    "getEffectiveCapabilities",
    "capability-keys",
    "offering-capabilities",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
  // ...and says so, so the absence reads as a decision rather than an omission.
  assert.ok(/EXAMS capability/i.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

test("8. the module imports no instructor or trainee actor helper", () => {
  for (const token of [
    "requireCurrentInstructor",
    "requireCurrentTrainee",
    "getCurrentInstructor",
    "getCurrentTrainee",
    "resolveInstructorCourseOffering",
    "resolveTraineeCourseOffering",
    "lib/auth/actor",
    "instructorId",
    "studentId",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

// ===========================================================================
// 9–14. The Prisma surface
// ===========================================================================

test("9. the module's ENTIRE Prisma surface is one findUnique and one create", () => {
  assert.deepEqual(PRISMA_CALLS, ["prisma.examPlan.findUnique", "prisma.examPlan.create"]);
  // No other model is reached at all.
  const models = CODE.match(/prisma\.(\w+)\./g) ?? [];
  assert.deepEqual([...new Set(models)], ["prisma.examPlan."]);
});

test("10. no Prisma statement lives outside the two named binding helpers", () => {
  // Every `prisma.` occurrence is inside one of the two helpers, so no statement
  // can run before the core has called the admin boundary.
  const inHelpers =
    (bodyOf("findExamPlanByCourseOfferingId").match(/\bprisma\./g) ?? []).length +
    (bodyOf("createExamPlanForCourseOffering").match(/\bprisma\./g) ?? []).length;
  assert.equal((CODE.match(/\bprisma\./g) ?? []).length, inHelpers);
  // The public function itself touches no client and awaits nothing but the core.
  const publicBody = bodyOf("createExamPlan");
  assert.equal(publicBody.includes("prisma"), false, "the public function touches the client");
  assert.ok(/return createExamPlanWithDeps\(courseOfferingId, \{/.test(publicBody));
  // Both helpers take the VERIFIED id as their only parameter.
  for (const helper of ["findExamPlanByCourseOfferingId", "createExamPlanForCourseOffering"]) {
    assert.ok(
      new RegExp(`function ${helper}\\(\\s*verifiedCourseOfferingId: string,\\s*\\)`).test(CODE),
      `${helper} does not take exactly the verified id`,
    );
  }
});

test("11. the plan lookup is by the VERIFIED offering id and selects ONLY id", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  assert.match(
    callArguments("prisma.examPlan.findUnique("),
    /^\(\s*\{\s*where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId,?\s*\},\s*select:\s*\{\s*id:\s*true,?\s*\},?\s*\}\s*\)$/,
    `the lookup is: ${callArguments("prisma.examPlan.findUnique(")}`,
  );
  // Named explicitly, because each of these would be a decision the create must
  // not be able to make.
  const query = bodyOf("findExamPlanByCourseOfferingId");
  for (const forbidden of [
    "publishedAt",
    "sourceDates",
    "sessions",
    "definitions",
    "courseOffering:",
    "createdAt",
    "updatedAt",
    "include",
  ]) {
    assert.equal(query.includes(forbidden), false, `the plan query selects ${forbidden}`);
  }
});

test("12. the create writes ONLY courseOfferingId and selects ONLY id", () => {
  assert.equal((CODE.match(/examPlan\.create\(/g) ?? []).length, 1);
  assert.match(
    callArguments("prisma.examPlan.create("),
    /^\(\s*\{\s*data:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId,?\s*\},\s*select:\s*\{\s*id:\s*true,?\s*\},?\s*\}\s*\)$/,
    `the create is: ${callArguments("prisma.examPlan.create(")}`,
  );
  // The anchored match above already excludes every other column; these name the
  // ones that would be actively harmful, so a future edit fails loudly.
  const writer = bodyOf("createExamPlanForCourseOffering");
  for (const forbidden of [
    "publishedAt",
    "sourceDate",
    "definitions",
    "sessions",
    "connect",
    "create:",
    "createMany",
    "include",
    "Date",
  ]) {
    assert.equal(writer.includes(forbidden), false, `the create writes ${forbidden}`);
  }
});

test("13. there is NO upsert, update, updateMany, delete, transaction or raw SQL", () => {
  for (const token of [
    "upsert",
    "update(",
    "updateMany",
    "updateManyAndReturn",
    "delete(",
    "deleteMany",
    "createMany",
    "$transaction",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "$connect",
    "$disconnect",
    "$extends",
    "sql`",
    "isolationLevel",
    "Serializable",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // The only write of any kind is the plan create.
  const writes =
    /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  assert.deepEqual([...CODE.matchAll(writes)].map((match) => `${match[1]}.${match[2]}`), [
    "examPlan.create",
  ]);
  // The absence of a transaction is a decision, and is stated as one.
  assert.ok(/unique index/i.test(COMMENTS), "the index-as-protection reasoning is undocumented");
});

test("14. there is no retry, no loop and no second write path", () => {
  for (const token of ["retry", "Retry", "attempt", "backoff", "maxWait", "timeout", "Promise.all"]) {
    assert.equal(CODE.includes(token), false, `the module configures ${token}`);
  }
  for (const helper of [
    "requireCourseContext",
    "findExamPlanByCourseOfferingId",
    "createExamPlanForCourseOffering",
    "createExamPlan",
  ]) {
    const body = bodyOf(helper);
    for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", ".reduce("]) {
      assert.equal(body.includes(loop), false, `${helper} contains ${loop}`);
    }
  }
  // No lazy-plan helper by any other name, and no ensure/get-or-create surface.
  for (const token of ["ensurePlan", "ensureExamPlan", "upsertPlan", "getOrCreate"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

// ===========================================================================
// 15–17. Nothing else is written, imported or decided here
// ===========================================================================

test("15. no publication, source date, definition or session is written", () => {
  for (const token of [
    "publishedAt",
    "publish",
    "unpublish",
    "sourceDate",
    "SourceDate",
    "examTeachingPracticeSourceDate",
    "examDefinition",
    "examSession",
    "examAssignment",
    "examSessionBreak",
    "examBlockBreak",
    "teachingPractice",
    "courseOffering.",
    "courseEnrollment",
    "student.",
    "instructor.",
  ]) {
    assert.equal(CODE.includes(token), false, `the module touches ${token}`);
  }
  // ...and the header states that a new plan is empty and unpublished.
  assert.ok(/unpublished/i.test(COMMENTS), "the unpublished invariant is undocumented");
});

test("16. no notification, message or push surface is imported", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/exam/create-exam-plan-core",
    "@/lib/prisma",
  ]);
  for (const token of [
    "notification",
    "Notification",
    "web-push",
    "webpush",
    "sendMessage",
    "push-",
    "materials",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

test("17. the binding decides nothing: every outcome comes from the pure core", () => {
  // No outcome code, no ordering decision, no idempotence rule of its own.
  for (const token of [
    "offering_not_found",
    "operation_not_allowed",
    "plan_conflict",
    "already_exists",
    "plan_not_found",
    "invalid_input",
    "stale_write",
    "unexpected",
    "ok: false",
    "ok: true",
    "created: true",
    "created: false",
    "Object.freeze",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
  // The seven dependencies are bound by name, and NOTHING else is.
  const publicBody = bodyOf("createExamPlan");
  const bound = [...publicBody.matchAll(/^\s{4}(\w+)[,:]/gm)].map(([, name]) => name).sort();
  assert.deepEqual(bound, [
    "assertConfigurationAllowed",
    "createExamPlanForCourseOffering",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isPlanCourseOfferingUniqueConflict",
    "requireCourseContext",
  ]);
  // The uniqueness classifier is the COMMITTED pure one, bound rather than
  // re-implemented next to Prisma.
  assert.ok(
    CODE.includes("isPlanCourseOfferingUniqueConflict: isExamPlanOfferingConflictError"),
    "the module does not bind the committed conflict classifier",
  );
  assert.equal(CODE.includes("P" + "2002"), false, "the binding re-implements P2002 detection");
  assert.equal(CODE.includes("P" + "2003"), false, "the binding inspects P2003");
  assert.equal(CODE.includes("P" + "2025"), false, "the binding inspects P2025");
  assert.equal(CODE.includes("NEXT_" + "REDIRECT"), false, "the binding inspects redirects");
  // The committed core really exports what is bound.
  assert.ok(CORE_CODE.includes("export async function createExamPlanWithDeps("));
  assert.ok(CORE_CODE.includes("export function isExamPlanOfferingConflictError("));
});

// ===========================================================================
// 18–20. RUNTIME — authorization and the gate happen BEFORE any Prisma access
// ===========================================================================

test("18. the admin boundary runs BEFORE the plan lookup and before the create", async () => {
  const h = harness({ findResults: [null] });
  await run(h);
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate", "find", "create"]);
  assert.equal(h.log[0].value, REQUESTED_OFFERING_ID, "the boundary got the wrong id");
  // ...and the committed core is what enforces that order: its first awaited
  // dependency is the boundary, textually ahead of both Prisma dependencies.
  const authAt = CORE_CODE.indexOf("deps.requireCourseContext(");
  const gateAt = CORE_CODE.indexOf("deps.assertConfigurationAllowed(");
  const findAt = CORE_CODE.indexOf("deps.findExamPlanByCourseOfferingId(");
  const createAt = CORE_CODE.indexOf("deps.createExamPlanForCourseOffering(");
  assert.ok(authAt > 0 && gateAt > authAt && findAt > gateAt && createAt > findAt);
});

test("19. an unauthorized/unknown offering causes ZERO Prisma access", async () => {
  const h = harness({ authThrows: new SentinelOfferingNotFound() });
  assert.deepEqual(await run(h), { ok: false, code: "offering_not_found" });
  assert.deepEqual(h.findCalls, [], "the plan was looked up anyway");
  assert.deepEqual(h.createCalls, [], "a plan was created anyway");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth"]);
});

test("20. the lifecycle gate runs BEFORE the plan lookup, and a denial reads nothing", async () => {
  const h = harness({ gateThrows: new SentinelOperationNotPermitted() });
  assert.deepEqual(await run(h), { ok: false, code: "operation_not_allowed" });
  assert.deepEqual(h.findCalls, [], "an ARCHIVED offering was still queried");
  assert.deepEqual(h.createCalls, [], "an ARCHIVED offering still got a plan");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate"]);
});

// ===========================================================================
// 21–23. RUNTIME — the verified id, and the two idempotence paths
// ===========================================================================

test("21. the VERIFIED offering id is what reaches the find, the create and the re-read", async () => {
  const h = harness({
    findResults: [null, { id: "winner-plan-id" }],
    createThrows: uniqueViolation(["courseOfferingId"]),
  });
  await run(h);
  assert.deepEqual(h.findCalls, [VERIFIED_OFFERING_ID, VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.createCalls, [VERIFIED_OFFERING_ID]);
  // The REQUESTED id reached the boundary and nothing else.
  const sawRequested = h.log.filter((entry) => entry.value === REQUESTED_OFFERING_ID);
  assert.deepEqual(sawRequested.map((entry) => entry.kind), ["auth"]);
});

test("22. an EXISTING plan is a success with ZERO create calls", async () => {
  const h = harness({ findResults: [{ id: "already-there-plan-id" }] });
  const result = await run(h);
  assert.deepEqual(result, { ok: true, planId: "already-there-plan-id", created: false });
  assert.deepEqual(h.createCalls, [], "an existing plan was written to");
  assert.deepEqual(h.findCalls, [VERIFIED_OFFERING_ID], "the plan was read twice");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate", "find"]);
});

test("23. a MISSING plan is created EXACTLY once", async () => {
  const h = harness({ findResults: [null] });
  const result = await run(h);
  assert.deepEqual(result, { ok: true, planId: NEW_PLAN_ID, created: true });
  assert.equal(h.createCalls.length, 1);
  assert.equal(h.findCalls.length, 1);
});

// ===========================================================================
// 24–28. RUNTIME — the uniqueness conflict, through the REAL classifier
// ===========================================================================

test("24. the committed classifier recognizes the offering conflict, in both target forms", () => {
  assert.equal(isExamPlanOfferingConflictError(uniqueViolation(["courseOfferingId"])), true);
  assert.equal(
    isExamPlanOfferingConflictError(uniqueViolation("exam_plans_courseOfferingId_key")),
    true,
  );
  // The documented fallback: unreadable metadata is attributed to this conflict,
  // which is safe because the re-read — not this predicate — decides the outcome.
  assert.equal(isExamPlanOfferingConflictError({ code: "P" + "2002" }), true);
  // ...and rejects everything else, including a framework redirect.
  assert.equal(isExamPlanOfferingConflictError(uniqueViolation(["id"])), false);
  assert.equal(isExamPlanOfferingConflictError(uniqueViolation(["name"])), false);
  assert.equal(isExamPlanOfferingConflictError({ code: "P" + "2003" }), false);
  assert.equal(isExamPlanOfferingConflictError(frameworkRedirect()), false);
  assert.equal(isExamPlanOfferingConflictError(null), false);
  assert.equal(isExamPlanOfferingConflictError("P" + "2002"), false);
});

test("25. the offering conflict re-reads and reports the winner, without retrying", async () => {
  for (const target of [["courseOfferingId"], "exam_plans_courseOfferingId_key"] as const) {
    const h = harness({
      findResults: [null, { id: "winner-plan-id" }],
      createThrows: uniqueViolation(target),
    });
    const result = await run(h);
    assert.deepEqual(result, { ok: true, planId: "winner-plan-id", created: false });
    assert.equal(h.createCalls.length, 1, "the create was retried");
    assert.equal(h.findCalls.length, 2, "the winner was not re-read exactly once");
    assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate", "find", "create", "find"]);
  }
});

test("26. an UNRELATED unique violation propagates, with no re-read", async () => {
  const boom = uniqueViolation(["id"]);
  const h = harness({ findResults: [null], createThrows: boom });
  await assert.rejects(
    () => run(h),
    (error: unknown) => {
      assert.equal(error, boom, "the error identity was not preserved");
      return true;
    },
  );
  assert.equal(h.createCalls.length, 1);
  assert.equal(h.findCalls.length, 1, "an unrelated failure triggered a re-read");
});

test("27. an unexpected Prisma failure propagates unchanged", async () => {
  for (const boom of [
    { code: "P" + "2003" },
    { code: "P" + "1001", meta: { target: ["courseOfferingId"] } },
    new Error("connection reset"),
  ]) {
    const h = harness({ findResults: [null], createThrows: boom });
    await assert.rejects(
      () => run(h),
      (error: unknown) => {
        assert.equal(error, boom, "the error identity was not preserved");
        return true;
      },
    );
    assert.equal(h.findCalls.length, 1, "an unexpected failure triggered a re-read");
  }
});

test("28. a conflict whose re-read finds nothing is the honest plan_conflict refusal", async () => {
  const h = harness({
    findResults: [null, null],
    createThrows: uniqueViolation(["courseOfferingId"]),
  });
  assert.deepEqual(await run(h), { ok: false, code: "plan_conflict" });
  assert.equal(h.createCalls.length, 1, "the create was retried after the empty re-read");
  assert.equal(h.findCalls.length, 2);
});

// ===========================================================================
// 29–30. RUNTIME — the redirect, and the shape of what is returned
// ===========================================================================

test("29. a framework redirect propagates UNTOUCHED from the admin boundary", async () => {
  const redirect = frameworkRedirect();
  const h = harness({ authThrows: redirect });
  await assert.rejects(
    () => run(h),
    (error: unknown) => {
      assert.equal(error, redirect, "the redirect identity was not preserved");
      assert.equal((error as { digest?: string }).digest?.startsWith("NEXT_" + "REDIRECT"), true);
      return true;
    },
  );
  // Nothing was read, nothing was written, and no refusal was invented.
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth"]);
  // A redirect thrown by the GATE propagates the same way.
  const gateRedirect = frameworkRedirect();
  const gated = harness({ gateThrows: gateRedirect });
  await assert.rejects(() => run(gated), (error: unknown) => error === gateRedirect);
  assert.deepEqual(gated.findCalls, []);
  assert.deepEqual(gated.createCalls, []);
});

test("30. the returned result is frozen, JSON-safe, and carries no offering or Date", async () => {
  const created = await run(harness({ findResults: [null] }));
  const existing = await run(harness({ findResults: [{ id: "already-there-plan-id" }] }));
  const refused = await run(
    harness({ findResults: [null, null], createThrows: uniqueViolation(["courseOfferingId"]) }),
  );

  for (const result of [created, existing, refused]) {
    assert.ok(Object.isFrozen(result), "the result is mutable");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, "the result is not JSON-safe");
    const serialized = JSON.stringify(result);
    for (const leak of [VERIFIED_OFFERING_ID, REQUESTED_OFFERING_ID, "ACTIVE", "publishedAt"]) {
      assert.equal(serialized.includes(leak), false, `the result leaks ${leak}`);
    }
  }
  assert.deepEqual(Object.keys(created).sort(), ["created", "ok", "planId"]);
  assert.deepEqual(Object.keys(refused).sort(), ["code", "ok"]);
});

// ===========================================================================
// 31–33. Containment — two new files, nothing modified, nothing wired
// ===========================================================================

test("31. the slice's lib/actions files are EXACTLY the approved pair", () => {
  for (const rel of [IO_REL, IO_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  const slice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-plan"))
    .sort();
  assert.deepEqual(slice, ["exam-plan-write-io.test.ts", "exam-plan-write-io.ts"]);

  // The committed P1 pair is still exactly a pair: this slice added no core.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("create-exam-plan-core"))
    .sort();
  assert.deepEqual(examSlice, [
    "create-exam-plan-core.test.ts",
    "create-exam-plan-core.ts",
  ]);

  // No route, page, Server Action module or UI file was created for the slice.
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-plan-actions.ts"),
    join("lib", "actions", "exams.ts"),
    join("lib", "actions", "exam-write.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("32. the slice MODIFIED only guard suites and the ONE approved P3 page", () => {
  // Compared against HEAD, so it stays green once the change is committed and fires
  // if any further existing file is edited. Scoped to the trees this slice could
  // plausibly have touched.
  //
  // P2 -> P3 TRANSITION. While P2 was the binding alone, the single expected
  // modification was the committed P1 SUITE, whose containment claims P2 made
  // obsolete. P3 wires the binding to a manager-facing button, which makes the
  // "no caller at all" claim obsolete in turn and edits the exams PAGE to render
  // the affordance. Those guards are re-pointed to EXACT paths rather than
  // relaxed — the pure core and this binding are still byte-identical to HEAD.
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "HEAD", "--", "lib", "prisma", "app", "scripts"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `git diff failed: ${result.stderr ?? ""}`);
  const modified = (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // These paths are TOLERATED, not required: before a slice is committed the diff
  // holds them, afterwards it is empty, and a later fix puts one back — all three
  // states are correct. What must never differ is PRODUCTION code other than the
  // single approved page, which is what this guard exists for.
  // EX-SES-UI-1 adds the four route/`lib` suites its own wiring slice amends. The
  // approved PRODUCTION file is still exactly one — `${P3_ROUTE_DIR}/page.tsx`,
  // already tolerated here since P3 — and the two assertions below still name the
  // pure core and this binding as files that may never differ.
  //
  // The session paths are ASSEMBLED, not spelled: the session reader's committed
  // guard pins its caller list to EXACTLY that page, and the session write
  // binding's guard pins its own to EXACTLY one Server Action, so a suite naming
  // either module whole would become an extra entry in a list it must stay out of.
  const TOLERATED = [
    ["lib", "exam", "create-exam-plan-core.test.ts"].join("/"),
    ["lib", "actions", "exam-plan-write-io.test.ts"].join("/"),
    `${P3_ROUTE_DIR}/exam-definitions-page.contract.test.ts`,
    `${P3_ROUTE_DIR}/exam-plan-create.contract.test.ts`,
    `${P3_ROUTE_DIR}/page.tsx`,
    `${P3_ROUTE_DIR}/exam-definition-create.contract.test.ts`,
    `${P3_ROUTE_DIR}/exam-session-create.contract.test.ts`,
    ["lib", "actions", "admin-exam-session-read" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-session-write" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-definition-read" + "-io.test.ts"].join("/"),
    // EX-SES-UI-2 adds ONE further tolerated PRODUCTION file — the route's shared
    // Server Action module, which gains the approved session EDIT and REMOVAL
    // endpoints. It adds no `lib/` module of any kind, and its two new client forms
    // and contract suite are ADDITIONS, which this modifications-only diff
    // correctly does not report.
    `${P3_ROUTE_DIR}/actions.ts`,
    // EX-ASG-UI1 adds FOUR further tolerated paths, every one of them a GUARD
    // SUITE — so the approved-production list below is unchanged at two. Its own
    // four new route files are ADDITIONS, which this modifications-only diff
    // correctly does not report. The two assignment guard paths are ASSEMBLED for
    // the sharpest reason of all: both pinned their caller lists at EXACTLY ZERO
    // before that slice.
    `${P3_ROUTE_DIR}/exam-session-edit-delete.contract.test.ts`,
    ["lib", "actions", "exam-assignment-read" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-assignment-write" + "-io.test.ts"].join("/"),
    ["lib", "exam", "exam-supervisor-write" + "-core.test.ts"].join("/"),
    // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
    // travels in the same working tree. It adds the ASSIGNMENT contract suite to
    // the modified set (that suite's route file set and export list learn about
    // the eighth endpoint) and the committed instructed-trainee write guard,
    // whose caller list it re-points from zero to exactly one Server Action
    // module. Its own three new route files are ADDITIONS. Nothing here changes
    // which module this guard is about: no reader gained a caller, no writer was
    // edited, and no schema, migration, auth, capability or policy file is named.
    `${P3_ROUTE_DIR}/exam-assignment-ui.contract.test.ts`,
    `${P3_ROUTE_DIR}/exam-instructed-trainee-assignment-ui.contract.test.ts`,
    // EX-PUB-UI-MVP — the approved slice that wires the committed exam-plan
    // PUBLICATION backend to this same route. It travels in the same working tree,
    // adds ONE new contract suite, and re-points that backend's own footprint and
    // caller guards, so both paths join this list BY NAME. Nothing it does touches
    // this module: no schema, no migration, no auth, no capability, and no `lib/`
    // production file of any kind.
    //
    // The `lib/` entry is ASSEMBLED from pieces: that suite sweeps every source
    // file for the publication binding's module name and pins the result to
    // EXACTLY ONE production caller, so a path written whole here would enrol this
    // suite in the very list it exists to keep narrow.
    `${P3_ROUTE_DIR}/exam-publication-ui.contract.test.ts`,
    "lib/actions/" + "exam-publication-write" + "-io.test.ts",
    ["lib", "actions", "exam-instructed-trainee-assignment-write" + "-io.test.ts"].join("/"),
    // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
    // same working tree. It publishes two stored columns the assignment READ pair
    // already reached, so that pair's two PRODUCTION modules and its pure core's
    // suite join this list, together with the two supervisor footprint guards
    // whose "nothing was modified" claims it re-points. The two production entries
    // are the reason the approved-production list below grows from two to four.
    ["lib", "exam", "admin-exam-assignment-read" + "-core.ts"].join("/"),
    ["lib", "exam", "admin-exam-assignment-read" + "-core.test.ts"].join("/"),
    ["lib", "actions", "exam-assignment-read" + "-io.ts"].join("/"),
    ["lib", "actions", "exam-supervisor-read" + "-io.test.ts"].join("/"),
    ["lib", "actions", "exam-supervisor-write" + "-io.test.ts"].join("/"),
    // EX-ASG-LTD2-B2 - the approved DETAILED examinee assignment UI wiring, which
    // travels in the same working tree. It switches the route's ONE existing create
    // endpoint to the committed detailed writer, which brings that route's examinee
    // create form and its route-local assignment message table into the modified set,
    // plus the detailed writer's own committed guard, whose caller list it re-points
    // from zero to exactly one Server Action module. The last path is ASSEMBLED,
    // because that guard sweeps `app/`, `lib/` and `components/` for its own module
    // name. Nothing here changes which module THIS guard is about: no new route file,
    // Server Action, query key or component exists, no `lib/` production module is
    // edited, and no schema, migration, auth, session, capability or policy file
    // appears.
    `${P3_ROUTE_DIR}/CreateExamAssignmentForm.tsx`,
    `${P3_ROUTE_DIR}/exam-assignment-messages.ts`,
    ["lib", "actions", "detailed-exam-assignment-write" + "-io.test.ts"].join("/"),
  ];
  // RE-POINTED by EX-SES-UI-2 from ONE approved production file to TWO, and AGAIN
  // by EX-ASG-LTD2-B1 to FOUR — the assignment READ pair it must edit to publish
  // two more stored columns. All four are named EXACTLY: a fifth production file
  // still cannot enter this list unnoticed, every other tolerated path is still a
  // guard suite, and THIS binding and its pure core are re-asserted
  // byte-identical below.
  const TOLERATED_PRODUCTION = [
    // RE-POINTED by EX-ASG-LTD2-B2: the examinee create FORM and the route-local
    // assignment MESSAGE TABLE are production files of that same one route, and the
    // detailed-writer wiring edits both. Each is named EXACTLY - no directory, no
    // prefix, no glob - so a further production file still fails here.
    `${P3_ROUTE_DIR}/CreateExamAssignmentForm.tsx`,
    `${P3_ROUTE_DIR}/exam-assignment-messages.ts`,
    `${P3_ROUTE_DIR}/page.tsx`,
    `${P3_ROUTE_DIR}/actions.ts`,
    ["lib", "exam", "admin-exam-assignment-read" + "-core.ts"].join("/"),
    ["lib", "actions", "exam-assignment-read" + "-io.ts"].join("/"),
  ];
  for (const path of TOLERATED) {
    assert.ok(
      path.endsWith(".test.ts") || TOLERATED_PRODUCTION.includes(path),
      `${path} is neither a suite nor an approved production file`,
    );
  }
  const unexpected = modified.filter((path) => !TOLERATED.includes(path));
  assert.deepEqual(
    unexpected,
    [],
    `the slice modified production code: ${unexpected.join(", ")}`,
  );
  // Named explicitly: the pure core and this binding are byte-identical to HEAD.
  for (const production of [
    ["lib", "exam", "create-exam-plan-core.ts"].join("/"),
    ["lib", "actions", "exam-plan-write-io.ts"].join("/"),
  ]) {
    assert.equal(modified.includes(production), false, `${production} was modified`);
  }

  // In particular the committed pure core and the course policy are untouched.
  assert.ok(CORE_CODE.includes("export async function createExamPlanWithDeps("));
  const policy = readFileSync(
    join(REPO_ROOT, "lib", "course", "operation-policy-core.ts"),
    "utf8",
  );
  assert.equal(/EXAM/.test(policy), false, "the course policy gained an exam operation");
  assert.ok(policy.includes("SCHEDULE_DRAFT_CONFIGURATION"));
});

test("33. EXACTLY ONE app Server Action calls this writer, and nothing else does", () => {
  // P2 -> P3 TRANSITION. This guard previously asserted the caller list was EMPTY.
  // P3 gives the binding its first and only public caller, so the list is now
  // pinned to that ONE exact path instead of being dropped or widened to the route
  // directory: a second Server Action module, a `.tsx` component, another
  // lib/actions module, a script or any other route still fails this test.
  //
  // The committed P1 guard suite is excluded: it NAMES this module's path in its
  // own re-pointed containment assertions, which is the opposite of calling it —
  // it imports nothing from here and invokes nothing here.
  const own = new Set([
    join(REPO_ROOT, IO_REL),
    join(REPO_ROOT, IO_TEST_REL),
    join(REPO_ROOT, CORE_TEST_REL),
  ]);
  const MODULE_SPECIFIER = "exam-plan-write-io";
  const PUBLIC_CALL = new RegExp("\\bcreate" + "ExamPlan\\s*\\(");
  const callers: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      if (full.includes(`${sep}generated${sep}`)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (own.has(full)) continue;
      const source = stripComments(readFileSync(full, "utf8"));
      if (source.includes(MODULE_SPECIFIER) || PUBLIC_CALL.test(source)) {
        callers.push(full.slice(REPO_ROOT.length + 1));
      }
    }
  }
  for (const root of ["app", "lib", "components", "scripts"]) {
    const dir = join(REPO_ROOT, root);
    if (existsSync(dir)) walk(dir);
  }

  // The complete caller set, as git spells the paths: the ONE approved Server
  // Action. That route's own contract suite is permitted to NAME this module, but
  // only if it does so — it currently uses split literals and so does not appear.
  const normalized = callers.map((path) => path.split(sep).join("/")).sort();
  const unapproved = normalized.filter(
    (path) => path !== P3_APPROVED_CALLER && path !== P3_APPROVED_SUITE,
  );
  assert.deepEqual(unapproved, [], `an unapproved caller exists: ${unapproved.join(", ")}`);

  // Exactly ONE shipped module may reach this writer — a test suite may describe
  // it, but only this Server Action may expose it to a user.
  const production = normalized.filter((path) => !/\.test\.tsx?$/.test(path));
  assert.deepEqual(production, [P3_APPROVED_CALLER]);

  // ...and that caller is a Server Action module, never a component.
  assert.equal(P3_APPROVED_CALLER.endsWith(".tsx"), false);
  assert.equal(
    normalized.some((path) => path.endsWith(".tsx")),
    false,
    "a UI component reaches the writer",
  );
});

test("34. this suite opens no database and reads no environment", () => {
  // Split literals: a guard suite necessarily names the tokens it forbids.
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    "DATABASE" + "_URL",
    "process" + ".env",
    "Prisma" + "Client",
    "create" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  // It never imports a database client: its only imports are node builtins and
  // the committed PURE core. (The module's own import list is asserted at 16,
  // which legitimately NAMES the client module it binds.)
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "../exam/create-exam-plan-core",
    "node:assert/strict",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:test",
  ]);
  // The committed pair really exists, and the core is DB-free.
  for (const rel of [CORE_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
  }
  for (const specifier of [["@/lib", "prisma"].join("/"), ["@prisma", "client"].join("/")]) {
    assert.equal(CORE_CODE.includes(specifier), false, `the pure core imports ${specifier}`);
  }
});
