/**
 * EX-PAIR-BE-MVP — tests for the instructed-trainee/examinee PAIRING binding
 * (lib/actions/exam-pairing-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-pairing-write-io.test.ts
 *
 * TWO KINDS OF PROOF, AND WHY.
 *
 * 1. STRUCTURAL. The module under test declares `import "server-only"`, which is
 *    exactly the guarantee this slice wants — and which makes the module
 *    UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 *    unimportable from any client bundle). Its authorization import chain would
 *    also construct a database client. So the same approach the committed exam
 *    read-contract and write-binding suites take is used here: this suite reads
 *    the module's SOURCE and asserts on its structure — which statements exist,
 *    on which client, with which `where` conditions, with which payload, and
 *    which dependency name each binding is wired to.
 *
 * 2. RUNTIME. The BEHAVIOUR — the order, the pairing rules, the no-op rule and
 *    the stale-write refusal — belongs to the pure core, and is exercised here at
 *    runtime with fakes standing in for the Prisma statements and the admin
 *    boundary, bound EXACTLY as the module binds them. The structural half is
 *    what proves the module really wires THOSE functions to THOSE dependency
 *    names; the two together are what make the claim, and neither is sufficient
 *    alone.
 *
 *    The two typed error classes (the offering not-found and the lifecycle
 *    denial) are stood in for by local sentinels, because importing the real ones
 *    would pull in the auth chain and a database client; the structural half
 *    asserts that the module classifies each of them by IDENTITY and by nothing
 *    else, which is the property the sentinels reproduce.
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
  setExamInstructedTraineePairingWithDeps,
  type ExamPairingAssignmentFacts,
  type ExamPairingExamineeFacts,
  type ExamPairingWriteCommand,
  type ExamUnpairWriteCommand,
  type SetExamInstructedTraineePairingDeps,
  type SetExamInstructedTraineePairingResult,
} from "../exam/exam-pairing-write-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-pairing-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-pairing-write-io.test.ts");
const CORE_REL = join("lib", "exam", "exam-pairing-write-core.ts");
const CORE_TEST_REL = join("lib", "exam", "exam-pairing-write-core.test.ts");

/** The four files of this slice, in git's own form (forward slashes everywhere). */
const SLICE_FILES = [
  ["lib", "exam", "exam-pairing-write-core.ts"].join("/"),
  ["lib", "exam", "exam-pairing-write-core.test.ts"].join("/"),
  ["lib", "actions", "exam-pairing-write-io.ts"].join("/"),
  ["lib", "actions", "exam-pairing-write-io.test.ts"].join("/"),
].sort();

/**
 * The ONLY tracked files this slice modifies, and every one of them is a GUARD
 * SUITE.
 *
 * Each pins its own slice's working-tree footprint to an exact list, so four
 * brand-new `lib/` files necessarily re-point them. Each was widened by exactly
 * these four NAMED paths — never to a directory and never to a glob — and every
 * one of those suites' caller, Prisma, auth and lifecycle claims is left exactly
 * as it was.
 *
 * Spelled as ASSEMBLED pieces rather than whole: several of them sweep `app/`,
 * `lib/` and `components/` for their own module name and pin the result to an
 * exact caller list, so a file naming one whole would enrol itself in a list it
 * must stay out of.
 *
 * ZERO production files are on this list, which guard 30 re-checks structurally
 * rather than trusting the list to stay honest on its own.
 */
const APPROVED_MODIFIED_GUARDS = [
  ["lib", "actions", "exam-session-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "admin-exam-session-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-instructed-trainee-assignment-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-publication-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-definition-read" + "-io.test.ts"].join("/"),
  ["lib", "exam", "exam-supervisor-write" + "-core.test.ts"].join("/"),
  // ...and the four suites whose "no tracked file was modified" claims the
  // re-point of the publication guard above necessarily widens by one path. Each
  // was widened by that ONE exact `.test.ts` name and nothing else.
  ["lib", "actions", "exam-assignment-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-assignment-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-supervisor-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-supervisor-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-plan-write" + "-io.test.ts"].join("/"),
].sort();

const SOURCE = readFileSync(join(REPO_ROOT, IO_REL), "utf8");

/** Strip comments so the guards assert on CODE, not on explanatory prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const CODE = stripComments(SOURCE);
const SQUASHED = CODE.replace(/\s+/g, " ");
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
  return CODE.slice(start, end + 2).replace(/\s+/g, " ");
}

/** Every exported function signature in the module, in source order. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

/** Every `prisma.x.y` / `tx.x.y` call, in source order. */
const PRISMA_CALLS = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];

/** `git`'s own output, one trimmed line per entry. */
function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// ===========================================================================
// The runtime harness — the module's dependency bundle, reproduced with fakes
// ===========================================================================

/** The id the caller REQUESTS. Deliberately different from the verified one. */
const REQUESTED_OFFERING_ID = "requested-offering-id";
/** The id the admin boundary VERIFIES and returns. */
const VERIFIED_OFFERING_ID = "verified-offering-id";
/** The id the fake plan lookup reports. */
const PLAN_ID = "plan-of-the-verified-offering";
const SESSION_ID = "session-of-the-plan";
const INSTRUCTED_ID = "assignment-instructed";
const EXAMINEE_ID = "assignment-examinee";

class SentinelOfferingNotFound extends Error {}
class SentinelOperationNotPermitted extends Error {}

interface HarnessOptions {
  readonly plan?: { readonly id: string } | null;
  readonly assignments?: Record<string, ExamPairingAssignmentFacts>;
  readonly sessionExaminees?: readonly ExamPairingExamineeFacts[];
  readonly pairSucceeds?: boolean;
  readonly unpairSucceeds?: boolean;
  readonly authThrows?: unknown;
  readonly gateThrows?: unknown;
}

interface Harness {
  readonly deps: SetExamInstructedTraineePairingDeps;
  readonly log: { kind: string; value: string }[];
  readonly pairCalls: ExamPairingWriteCommand[];
  readonly unpairCalls: ExamUnpairWriteCommand[];
}

function instructedFacts(
  overrides: Partial<ExamPairingAssignmentFacts> = {},
): ExamPairingAssignmentFacts {
  return {
    assignmentId: INSTRUCTED_ID,
    sessionId: SESSION_ID,
    role: "INSTRUCTED_TRAINEE",
    pairingIndex: null,
    ...overrides,
  };
}

function examineeFacts(
  overrides: Partial<ExamPairingAssignmentFacts> = {},
): ExamPairingAssignmentFacts {
  return {
    assignmentId: EXAMINEE_ID,
    sessionId: SESSION_ID,
    role: "EXAMINEE",
    pairingIndex: null,
    ...overrides,
  };
}

/**
 * The module's bundle, dependency-for-dependency:
 *   requireCourseContext           -> the admin boundary + exact offering
 *   assertConfigurationAllowed     -> the lifecycle gate
 *   findExamPlanByCourseOfferingId -> the ONE plan read
 *   findAssignmentForPlan          -> the plan-scoped assignment read
 *   findSessionExaminees           -> the session's EXAMINEE rows
 *   pairInstructedTrainee          -> the ONE atomic pairing transaction
 *   unpairInstructedTrainee        -> the ONE conditional unpair statement
 *   isCourseNotFoundError          -> an identity check
 *   isOperationNotAllowedError     -> an identity check
 */
function harness(options: HarnessOptions = {}): Harness {
  const log: { kind: string; value: string }[] = [];
  const pairCalls: ExamPairingWriteCommand[] = [];
  const unpairCalls: ExamUnpairWriteCommand[] = [];
  const assignments = options.assignments ?? {
    [INSTRUCTED_ID]: instructedFacts(),
    [EXAMINEE_ID]: examineeFacts(),
  };

  const deps: SetExamInstructedTraineePairingDeps = {
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
      log.push({ kind: "plan", value: verifiedCourseOfferingId });
      return options.plan === undefined ? { id: PLAN_ID } : options.plan;
    },
    async findAssignmentForPlan(planId, assignmentId) {
      log.push({ kind: "assignment", value: `${planId}:${assignmentId}` });
      return assignments[assignmentId] ?? null;
    },
    async findSessionExaminees(planId, sessionId) {
      log.push({ kind: "examinees", value: `${planId}:${sessionId}` });
      return options.sessionExaminees ?? [{ assignmentId: EXAMINEE_ID, pairingIndex: null }];
    },
    async pairInstructedTrainee(command) {
      log.push({ kind: "pair", value: String(command.pairingIndex) });
      pairCalls.push(command);
      return options.pairSucceeds ?? true;
    },
    async unpairInstructedTrainee(command) {
      log.push({ kind: "unpair", value: command.instructedAssignmentId });
      unpairCalls.push(command);
      return options.unpairSucceeds ?? true;
    },
    isCourseNotFoundError: (error) => error instanceof SentinelOfferingNotFound,
    isOperationNotAllowedError: (error) => error instanceof SentinelOperationNotPermitted,
  };

  return { deps, log, pairCalls, unpairCalls };
}

function run(
  h: Harness,
  instructedId: unknown,
  examineeId: unknown,
): Promise<SetExamInstructedTraineePairingResult> {
  return setExamInstructedTraineePairingWithDeps(
    REQUESTED_OFFERING_ID,
    instructedId,
    examineeId,
    h.deps,
  );
}

function frameworkRedirect(): Error {
  const error = new Error("NEXT_" + "REDIRECT");
  (error as Error & { digest: string }).digest = "NEXT_" + "REDIRECT;replace;/login;307;";
  return error;
}

// ===========================================================================
// 1–5. Module kind and the public signature
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
    "export default",
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
    "FormData",
    "formData",
  ]) {
    assert.equal(CODE.includes(token), false, `the module references ${token}`);
  }
});

test("3. EXACTLY ONE function is exported, and it is the pairing entry point", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["setExamInstructedTraineePairing"],
  );
});

test("4. the public signature takes THREE ids and nothing else", () => {
  const entry = SIGNATURES[0];
  assert.equal(
    entry.params,
    "courseOfferingId: string, instructedTraineeAssignmentId: string, examineeAssignmentId: string | null,",
  );
  assert.equal(entry.returns, "Promise<SetExamInstructedTraineePairingResult>");
});

test("5. NO caller can supply a pairing index — the parameter does not exist", () => {
  // Not "ignored": absent from the signature, and absent from every type this
  // module hands the pure core.
  for (const forbidden of [
    "pairingIndex:",
    "sessionId:",
    "planId:",
    "studentId:",
    "actorId:",
    "adminId:",
    "orderIndex",
    "now:",
    "timestamp",
  ]) {
    assert.equal(
      SIGNATURES[0].params.includes(forbidden),
      false,
      `the public signature accepts ${forbidden}`,
    );
  }
  // And the WHOLE module never names the position column at all: `orderIndex` is
  // not the pairing label, is never read, and is never written.
  assert.equal(CODE.includes("orderIndex"), false, "the module names orderIndex");
});

// ===========================================================================
// 6–9. The imports and the wiring
// ===========================================================================

test("6. the import list is EXACTLY the five modules this binding needs", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    ["@/app", "generated", "prisma", "client"].join("/"),
    ["@/lib", "course", "admin-course-context"].join("/"),
    ["@/lib", "course", "operation-policy-core"].join("/"),
    ["@/lib", "exam", "exam-pairing-write-core"].join("/"),
    ["@/lib", "prisma"].join("/"),
  ]);
  // No notification, push, message, capability, session, cookie or auth-config
  // module is reachable from here.
  for (const forbidden of [
    "notification",
    "push",
    "web-push",
    "capabilit",
    "next-auth",
    "cookies",
    "middleware",
    "supa" + "base",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module imports ${forbidden}`);
  }
});

test("7. the entry point delegates to the pure core and adds no logic of its own", () => {
  const body = bodyOf("setExamInstructedTraineePairing");
  assert.ok(body.includes("return setExamInstructedTraineePairingWithDeps("));
  // The three arguments are forwarded verbatim, in order.
  assert.ok(
    body.includes(
      "courseOfferingId, instructedTraineeAssignmentId, examineeAssignmentId, {",
    ),
  );
  // No decision is taken here: no branch, no comparison, no index arithmetic.
  for (const token of ["if (", "else", "??", "Math.", "+ 1", "sort(", "filter("]) {
    assert.equal(body.includes(token), false, `the entry point contains ${token}`);
  }
});

test("8. the dependency bundle names EXACTLY the nine bindings", () => {
  const body = bodyOf("setExamInstructedTraineePairing");
  const bundle = body.slice(body.indexOf("{", body.indexOf("WithDeps(")));
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findAssignmentForPlan",
    "findSessionExaminees",
    "pairInstructedTrainee",
    "unpairInstructedTrainee",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]) {
    assert.ok(bundle.includes(dependency), `${dependency} is not wired`);
  }
  // Nothing else is handed over: no clock, no notifier, no capability resolver,
  // no transaction handle, no delete and no create.
  for (const dependency of ["now", "sendNotification", "resolveCapability", "createAssignment", "deleteAssignment"]) {
    assert.equal(bundle.includes(`${dependency},`), false, `${dependency} is wired`);
  }
});

test("9. both typed errors are classified BY IDENTITY, and nothing else is caught", () => {
  assert.ok(bodyOf("isCourseNotFoundError").includes("error instanceof CourseOfferingNotFoundError"));
  assert.ok(
    bodyOf("isOperationNotAllowedError").includes("error instanceof CourseOperationNotPermittedError"),
  );
  // Neither classifier reads a code, a message, a digest or any metadata, so a
  // framework redirect can never be laundered into a refusal.
  for (const name of ["isCourseNotFoundError", "isOperationNotAllowedError"]) {
    for (const token of ["code", "message", "digest", "meta", "includes("]) {
      assert.equal(bodyOf(name).includes(token), false, `${name} inspects ${token}`);
    }
  }
  // The module contains exactly ONE catch, and it recognizes only its own
  // private sentinel.
  assert.equal((CODE.match(/catch \(/g) ?? []).length, 1);
  assert.ok(CODE.includes("if (error instanceof ExamPairingConditionFailed)"));
  assert.ok(CODE.includes("throw error;"), "an unrecognized error is not re-thrown");
  // The sentinel is module-private: nothing outside this file can construct or
  // throw one.
  assert.equal(CODE.includes("export class"), false);
  assert.ok(CODE.includes("class ExamPairingConditionFailed extends Error {}"));
});

// ===========================================================================
// 10–13. The lifecycle gate and the trust boundary
// ===========================================================================

test("10. the boundary is the admin course-context resolver, and only it", () => {
  assert.ok(bodyOf("requireCourseContext").includes("await requireAdminCourseOffering(requestedCourseOfferingId)"));
  // Exactly two fields are carried forward.
  assert.ok(
    bodyOf("requireCourseContext").includes(
      "return { courseOfferingId: context.id, status: context.status };",
    ),
  );
  for (const token of ["requireInstructor", "requireStudent", "requireTrainee", "getActor"]) {
    assert.equal(CODE.includes(token), false, `the module reaches for ${token}`);
  }
});

test("11. the lifecycle gate is the committed draft-configuration operation", () => {
  const body = bodyOf("assertConfigurationAllowed");
  assert.ok(body.includes("assertCourseOperationAllowed("));
  assert.ok(body.includes('"SCHEDULE_DRAFT_CONFIGURATION"'));
  // The policy is CONSULTED, never copied: no status list of this module's own.
  for (const status of ["PLANNED", "ACTIVE", "ARCHIVED"]) {
    assert.equal(CODE.includes(`"${status}"`), false, `the module hardcodes ${status}`);
  }
});

test("12. the two role literals appear ONLY as conditions, never as payload", () => {
  assert.ok(CODE.includes('const ROLE_INSTRUCTED_TRAINEE = "INSTRUCTED_TRAINEE";'));
  assert.ok(CODE.includes('const ROLE_EXAMINEE = "EXAMINEE";'));
  // Every use of either constant sits in a `where` clause. `role:` never appears
  // inside a `data:` payload — asserted exactly by guard 17.
  const roleUses = SQUASHED.match(/role: ROLE_\w+/g) ?? [];
  assert.deepEqual(
    roleUses,
    [
      // the examinee-list read
      "role: ROLE_EXAMINEE",
      // the pairing transaction: rival check, allocation, reuse check...
      "role: ROLE_EXAMINEE",
      "role: ROLE_EXAMINEE",
      "role: ROLE_EXAMINEE",
      // ...and the instructed row it writes
      "role: ROLE_INSTRUCTED_TRAINEE",
      // the unpair statement
      "role: ROLE_INSTRUCTED_TRAINEE",
    ],
    `unexpected role conditions: ${roleUses.join(", ")}`,
  );
});

test("13. no exam query runs before the admin boundary and the gate", () => {
  // Every Prisma statement lives inside a helper the pure core may only reach
  // AFTER it has resolved the course context and passed the gate; the entry
  // point itself issues none.
  const entry = bodyOf("setExamInstructedTraineePairing");
  assert.equal(entry.includes("prisma."), false, "the entry point queries directly");
  for (const helper of [
    "findExamPlanByCourseOfferingId",
    "findAssignmentForPlan",
    "findSessionExaminees",
    "pairInstructedTrainee",
    "unpairInstructedTrainee",
  ]) {
    assert.ok(CODE.includes(`function ${helper}(`), `${helper} is missing`);
  }
});

// ===========================================================================
// 14–20. The Prisma surface
// ===========================================================================

test("14. the Prisma statements are EXACTLY these, in this order", () => {
  assert.deepEqual(PRISMA_CALLS, [
    "prisma.examPlan.findUnique",
    "prisma.examAssignment.findFirst",
    "prisma.examAssignment.findMany",
    "prisma.$transaction",
    "tx.examAssignment.count",
    "tx.examAssignment.updateMany",
    "tx.examAssignment.count",
    "tx.examAssignment.updateMany",
    "prisma.examAssignment.updateMany",
  ]);
  // No create, no upsert, no delete, and no raw escape hatch of any kind.
  for (const forbidden of [
    ".create(",
    ".createMany(",
    ".upsert(",
    ".delete(",
    ".deleteMany(",
    "$executeRaw",
    "$queryRaw",
    "$executeRawUnsafe",
    "$queryRawUnsafe",
    "Prisma.sql",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module uses ${forbidden}`);
  }
  // ...and no other model is touched at all.
  for (const model of [
    "examSession.",
    "examDefinition.",
    "examSessionSupervisor.",
    "examSessionBreak.",
    "examBeginnerChild.",
    "student.",
    "courseEnrollment.",
    "courseOffering.",
    "teachingPractice",
  ]) {
    assert.equal(CODE.includes(model), false, `the module touches ${model}`);
  }
});

test("15. the plan read is one narrow lookup on the VERIFIED offering id", () => {
  const body = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(body.includes("where: { courseOfferingId: verifiedCourseOfferingId },"));
  assert.ok(body.includes("select: { id: true },"));
  // No publication state, no relations, no timestamps — and no upsert.
  for (const token of ["publishedAt", "sessions", "definitions", "createdAt", "updatedAt"]) {
    assert.equal(body.includes(token), false, `the plan read selects ${token}`);
  }
});

test("16. every assignment read is PLAN-SCOPED inside the statement", () => {
  const assignment = bodyOf("findAssignmentForPlan");
  assert.ok(assignment.includes("prisma.examAssignment.findFirst("));
  assert.ok(assignment.includes("where: { id: assignmentId, session: { planId } },"));
  assert.ok(
    assignment.includes("select: { id: true, sessionId: true, role: true, pairingIndex: true },"),
  );
  // A cross-plan row is unreachable rather than merely rejected: there is no
  // `findUnique` by id anywhere in this module.
  assert.equal(CODE.includes("examAssignment.findUnique"), false);
  // No personal or descriptive column is selected.
  for (const column of ["studentId", "horseName", "instructionTopic", "discipline", "notes", "student:"]) {
    assert.equal(assignment.includes(column), false, `the assignment read selects ${column}`);
  }

  const examinees = bodyOf("findSessionExaminees");
  assert.ok(
    examinees.includes(
      "where: { sessionId, role: ROLE_EXAMINEE, session: { planId } },",
    ),
  );
  assert.ok(examinees.includes("select: { id: true, pairingIndex: true },"));
});

test("17. every write payload names EXACTLY the pairing column", () => {
  const payloads = SQUASHED.match(/data: \{[^}]*\}/g) ?? [];
  assert.deepEqual(payloads, [
    "data: { pairingIndex: command.pairingIndex },",
    "data: { pairingIndex: command.pairingIndex },",
    "data: { pairingIndex: null },",
  ].map((entry) => entry.replace(/,$/, "")));
  // No other column is written anywhere, under any name.
  for (const column of [
    "orderIndex",
    "studentId:",
    "role:  ",
    "horseName",
    "instructionTopic",
    "discipline",
    "notes",
    "sourcePracticeRole",
    "publishedAt",
  ]) {
    for (const payload of payloads) {
      assert.equal(payload.includes(column), false, `a payload writes ${column}`);
    }
  }
});

test("18. the pairing write is ONE transaction with three conditions", () => {
  const body = bodyOf("pairInstructedTrainee");
  assert.ok(body.includes("await prisma.$transaction(async (tx) =>"));
  // 1. no rival examinee may hold the chosen index...
  assert.ok(body.includes("id: { not: command.examineeAssignmentId },"));
  assert.ok(body.includes("pairingIndex: command.pairingIndex,"));
  // 2. ...the examinee row is WRITTEN only when the index is being allocated,
  //    and only while it still holds none...
  assert.ok(body.includes("if (command.expectedExamineePairingIndex === null) {"));
  assert.ok(body.includes("pairingIndex: null,"));
  // ...and merely COUNTED when the index is reused, so a reuse touches one row.
  assert.ok(body.includes("pairingIndex: command.expectedExamineePairingIndex,"));
  // 3. ...and the instructed row is conditional on the index it still holds.
  assert.ok(body.includes("pairingIndex: command.expectedInstructedPairingIndex,"));
  // Every condition failure ABORTS the transaction, so a half-written pair
  // cannot survive; nothing returns a flag from inside the callback.
  assert.equal((body.match(/throw new ExamPairingConditionFailed\(\);/g) ?? []).length, 4);
  // Both rows are scoped by the plan relation and the session inside the
  // statements themselves.
  assert.equal((body.match(/session: \{ planId: command\.planId \},/g) ?? []).length, 4);
  assert.equal((body.match(/sessionId: command\.sessionId,/g) ?? []).length, 4);
});

test("19. the unpair write touches the INSTRUCTED row only", () => {
  const body = bodyOf("unpairInstructedTrainee");
  assert.ok(body.includes("prisma.examAssignment.updateMany("));
  assert.ok(body.includes("id: command.instructedAssignmentId,"));
  assert.ok(body.includes("role: ROLE_INSTRUCTED_TRAINEE,"));
  assert.ok(body.includes("pairingIndex: command.expectedInstructedPairingIndex,"));
  assert.ok(body.includes("session: { planId: command.planId },"));
  assert.ok(body.includes("data: { pairingIndex: null },"));
  assert.ok(body.includes("return cleared.count === 1;"));
  // The examinee is not mentioned at all on this path, so its index provably
  // cannot be cleared by an unpair.
  assert.equal(body.includes("examinee"), false, "the unpair path names the examinee");
  assert.equal(body.includes("Examinee"), false, "the unpair path names the examinee");
  assert.equal(body.includes("$transaction"), false, "the unpair path opens a transaction");
});

test("20. every write is CONDITIONAL, and a failed condition writes nothing", () => {
  // `updateMany` everywhere, never a blind `update` by primary key.
  assert.equal(CODE.includes("examAssignment.update("), false);
  // Each write reports a count, and each count is compared to exactly one row.
  assert.equal((CODE.match(/\.count !== 1/g) ?? []).length, 2);
  assert.equal((CODE.match(/held !== 1/g) ?? []).length, 1);
  assert.equal((CODE.match(/rivals !== 0/g) ?? []).length, 1);
  // No retry loop anywhere: a stale write is reported, never re-attempted.
  for (const token of ["while (", "for (", "retry", "setTimeout", "attempt"]) {
    assert.equal(CODE.includes(token), false, `the module contains ${token}`);
  }
});

// ===========================================================================
// 21–27. Runtime behaviour, bound exactly as the module binds it
// ===========================================================================

test("21. the locked order runs, and the request id never scopes a later step", async () => {
  const h = harness();
  const result = await run(h, INSTRUCTED_ID, EXAMINEE_ID);

  assert.deepEqual(result, { ok: true, status: "PAIRED", pairingIndex: 1 });
  assert.deepEqual(h.log, [
    { kind: "auth", value: REQUESTED_OFFERING_ID },
    { kind: "gate", value: "ACTIVE" },
    { kind: "plan", value: VERIFIED_OFFERING_ID },
    { kind: "assignment", value: `${PLAN_ID}:${INSTRUCTED_ID}` },
    { kind: "assignment", value: `${PLAN_ID}:${EXAMINEE_ID}` },
    { kind: "examinees", value: `${PLAN_ID}:${SESSION_ID}` },
    { kind: "pair", value: "1" },
  ]);
  assert.deepEqual(h.pairCalls, [
    {
      planId: PLAN_ID,
      sessionId: SESSION_ID,
      instructedAssignmentId: INSTRUCTED_ID,
      expectedInstructedPairingIndex: null,
      examineeAssignmentId: EXAMINEE_ID,
      expectedExamineePairingIndex: null,
      pairingIndex: 1,
    },
  ]);
});

test("22. an unauthorized caller reaches no exam query at all", async () => {
  const h = harness({ authThrows: new SentinelOfferingNotFound() });
  assert.deepEqual(await run(h, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: false,
    code: "offering_not_found",
  });
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth"]);
});

test("23. a framework redirect propagates untouched", async () => {
  const redirect = frameworkRedirect();
  const h = harness({ authThrows: redirect });
  await assert.rejects(() => run(h, INSTRUCTED_ID, EXAMINEE_ID), (error) => error === redirect);
});

test("24. an ARCHIVED offering is refused before any exam query", async () => {
  const h = harness({ gateThrows: new SentinelOperationNotPermitted() });
  assert.deepEqual(await run(h, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: false,
    code: "operation_not_allowed",
  });
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate"]);
});

test("25. an existing examinee index is reused and the pair is written once", async () => {
  const h = harness({
    assignments: {
      [INSTRUCTED_ID]: instructedFacts(),
      [EXAMINEE_ID]: examineeFacts({ pairingIndex: 2 }),
    },
    sessionExaminees: [
      { assignmentId: EXAMINEE_ID, pairingIndex: 2 },
      { assignmentId: "another-examinee", pairingIndex: 1 },
    ],
  });

  assert.deepEqual(await run(h, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: true,
    status: "PAIRED",
    pairingIndex: 2,
  });
  assert.equal(h.pairCalls.length, 1);
  assert.equal(h.pairCalls[0].expectedExamineePairingIndex, 2);
  assert.deepEqual(h.unpairCalls, []);
});

test("26. an unpair clears the instructed row and never names the examinee", async () => {
  const h = harness({
    assignments: { [INSTRUCTED_ID]: instructedFacts({ pairingIndex: 3 }) },
  });

  assert.deepEqual(await run(h, INSTRUCTED_ID, null), {
    ok: true,
    status: "UNPAIRED",
    pairingIndex: null,
  });
  assert.deepEqual(h.pairCalls, []);
  assert.deepEqual(h.unpairCalls, [
    {
      planId: PLAN_ID,
      sessionId: SESSION_ID,
      instructedAssignmentId: INSTRUCTED_ID,
      expectedInstructedPairingIndex: 3,
    },
  ]);
  // No examinee row was even read.
  assert.equal(h.log.some((entry) => entry.kind === "examinees"), false);
});

test("27. a concurrent change is refused, and nothing is retried", async () => {
  const pairing = harness({ pairSucceeds: false });
  assert.deepEqual(await run(pairing, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: false,
    code: "stale_write",
  });
  assert.equal(pairing.pairCalls.length, 1);

  const unpairing = harness({
    assignments: { [INSTRUCTED_ID]: instructedFacts({ pairingIndex: 1 }) },
    unpairSucceeds: false,
  });
  assert.deepEqual(await run(unpairing, INSTRUCTED_ID, null), {
    ok: false,
    code: "stale_write",
  });
  assert.equal(unpairing.unpairCalls.length, 1);
});

test("28. a no-op issues ZERO write statements", async () => {
  const h = harness({
    assignments: {
      [INSTRUCTED_ID]: instructedFacts({ pairingIndex: 5 }),
      [EXAMINEE_ID]: examineeFacts({ pairingIndex: 5 }),
    },
    sessionExaminees: [{ assignmentId: EXAMINEE_ID, pairingIndex: 5 }],
  });

  assert.deepEqual(await run(h, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: true,
    status: "NO_CHANGE",
    pairingIndex: 5,
  });
  assert.deepEqual(h.pairCalls, []);
  assert.deepEqual(h.unpairCalls, []);
});

// ===========================================================================
// 29–33. Slice shape: schema, footprint, callers
// ===========================================================================

test("29. no schema, migration or seed file changed, and no new module appeared", () => {
  // Every working-tree entry under `prisma/` — untracked included — is empty.
  assert.deepEqual(gitLines(["status", "--porcelain", "--", "prisma"]), []);
  // The slice's own four files exist and nothing else was invented alongside
  // them.
  for (const rel of [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
  }
  for (const file of [
    join("lib", "actions", "exam-pairing.ts"),
    join("lib", "actions", "exam-pairing-actions.ts"),
    join("lib", "exam", "exam-pairing-core.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
  // The committed modules this slice REUSES still exist and were not duplicated.
  for (const rel of [
    join("lib", "exam", "exam-domain-core.ts"),
    join("lib", "course", "admin-course-context.ts"),
    join("lib", "course", "operation-policy-core.ts"),
  ]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
});

test("30. the slice modified ONLY guard suites — not one production file", () => {
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the
  // check flip to red the moment the four new files are staged and back to green
  // after they are committed. What IS asserted, in all three states, is that no
  // tracked file outside the named guard suites was touched: no schema, no
  // migration, no policy, no auth module, no unrelated core, no route, no page.
  const modified = gitLines([
    "diff",
    "--name-only",
    "--diff-filter=MDRT",
    "HEAD",
    "--",
    "lib",
    "prisma",
    "app",
    "components",
    "scripts",
  ]);
  const unapproved = modified.filter((path) => !APPROVED_MODIFIED_GUARDS.includes(path));
  assert.deepEqual(unapproved, [], `the slice modified: ${unapproved.join(", ")}`);
  // ...and the approved list cannot quietly grow into a production file.
  for (const path of APPROVED_MODIFIED_GUARDS) {
    assert.ok(path.endsWith(".test.ts"), `${path} is not a guard suite`);
  }
  const production = modified.filter((path) => !path.endsWith(".test.ts"));
  assert.deepEqual(production, [], `production code was modified: ${production.join(", ")}`);
  // The slice's own four files are ADDITIONS, never modifications.
  for (const path of SLICE_FILES) {
    assert.equal(modified.includes(path), false, `${path} is not an addition`);
  }
});

test("31. no UI tree another writer owns was touched, and the footprint is exact", () => {
  for (const tree of [
    ["app", "admin"].join("/"),
    ["app", "instructor"].join("/"),
    ["app", "student"].join("/"),
  ]) {
    assert.deepEqual(gitLines(["status", "--porcelain", "--", tree]), [], `${tree} changed`);
  }
  // Across the scoped trees — worktree, index and untracked together — the ONLY
  // entries are this slice's four new files and the guard suites its footprint
  // re-points. A SUBSET check, so it holds while the slice is dirty, staged and
  // committed alike; what it forbids is any TENTH path.
  const approved = [...SLICE_FILES, ...APPROVED_MODIFIED_GUARDS];
  const touched = gitLines([
    "status",
    "--porcelain",
    "--",
    "lib",
    "prisma",
    "app",
    "components",
    "scripts",
  ]).map((line) => line.replace(/^\S{1,2}\s+/, ""));
  const unexpected = touched.filter((path) => !approved.includes(path)).sort();
  assert.deepEqual(unexpected, [], `unexpected changes: ${unexpected.join(", ")}`);
});

test("32. this backend has ZERO callers: nothing in the app can reach it yet", () => {
  const own = new Set([
    join(REPO_ROOT, IO_REL),
    join(REPO_ROOT, IO_TEST_REL),
    join(REPO_ROOT, CORE_REL),
    join(REPO_ROOT, CORE_TEST_REL),
  ]);
  const MODULE_SPECIFIER = "exam-pairing-write" + "-io";
  // The trailing `(` is what distinguishes the WRITER call from a future Server
  // Action that merely wraps it under a different name.
  const PUBLIC_CALL = new RegExp("\\bset" + "ExamInstructedTraineePairing\\s*\\(");
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

  const normalized = callers.map((path) => path.split(sep).join("/")).sort();
  assert.deepEqual(normalized, [], `a caller already exists: ${normalized.join(", ")}`);
});

test("33. this suite opens no database and reads no environment", () => {
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
  // the PURE core. (The module's own import list is asserted at 6, which
  // legitimately NAMES the client module it binds.)
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "../exam/exam-pairing-write-core",
    "node:assert/strict",
    "node:child_process",
    "node:fs",
    "node:path",
    "node:test",
  ]);
  // The pure core really is DB-free.
  for (const specifier of [["@/lib", "prisma"].join("/"), ["@prisma", "client"].join("/")]) {
    assert.equal(CORE_CODE.includes(specifier), false, `the pure core imports ${specifier}`);
  }
});
