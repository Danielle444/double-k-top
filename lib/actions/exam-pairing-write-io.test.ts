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
  type ExamPairingInstructedTraineeFacts,
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
  // EX-PAIR-UI-MVP's own guard suite, which the wiring re-pointed.
  ["lib", "exam", "admin-exam-assignment-read" + "-core.test.ts"].join("/"),
  // NARROWED by EX-PAIR-1TO1. EX-PAIR-UI-MVP additionally listed FIVE production
  // paths here — the route's Server Action module and page, the admin assignment
  // read core and its binding — because its own edits to them were still
  // uncommitted when this list was written. They are COMMITTED now, so a working
  // tree that modifies them is no longer the wiring slice in progress but an
  // unapproved edit, and admitting them would let this slice silently touch the
  // UI it must not touch. Guard 30 asserts positively that `app/` and
  // `components/` are byte-identical to HEAD.
  //
  // THIS suite and the other three files of the pairing backend are likewise not
  // listed: they are EX-PAIR-1TO1's own footprint, admitted at guard 30 through
  // `SLICE_FILES` and split there into production and suite explicitly.
  ...[
    "exam-assignment-ui",
    "exam-definition-create",
    "exam-definitions-page",
    "exam-instructed-trainee-assignment-ui",
    "exam-plan-create",
    "exam-publication-ui",
    "exam-session-create",
    "exam-session-edit-delete",
  ].map((name) =>
    ["app", "admin", "courses", "[courseOfferingId]", "exams", `${name}.contract.test.ts`].join(
      "/",
    ),
  ),
].sort();

/**
 * The ONE production module this backend is reachable from, and its slice's own
 * new contract suite.
 *
 * ASSEMBLED like everything else here. Together with the list above these are
 * the only paths the scoped trees may hold.
 */
const APPROVED_CALLERS = [
  ["app", "admin", "courses", "[courseOfferingId]", "exams", "actions.ts"].join("/"),
];
const PAIRING_UI_SUITE = [
  "app",
  "admin",
  "courses",
  "[courseOfferingId]",
  "exams",
  "exam-pairing-ui.contract.test.ts",
].join("/");

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
  readonly sessionInstructedTrainees?: readonly ExamPairingInstructedTraineeFacts[];
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
 *   findSessionInstructedTrainees  -> the session's INSTRUCTED_TRAINEE rows
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
    async findSessionInstructedTrainees(planId, sessionId) {
      log.push({ kind: "instructed", value: `${planId}:${sessionId}` });
      return (
        options.sessionInstructedTrainees ?? [
          { assignmentId: INSTRUCTED_ID, pairingIndex: null },
        ]
      );
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

test("8. the dependency bundle names EXACTLY the ten bindings", () => {
  const body = bodyOf("setExamInstructedTraineePairing");
  const bundle = body.slice(body.indexOf("{", body.indexOf("WithDeps(")));
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findAssignmentForPlan",
    "findSessionExaminees",
    // EX-PAIR-1TO1's ONE new binding: a READ, and the only thing this slice adds
    // to the boundary. No new write, no new classifier, no new effect.
    "findSessionInstructedTrainees",
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
      // EX-PAIR-1TO1's instructed-trainee list read, scoped identically
      "role: ROLE_INSTRUCTED_TRAINEE",
      // the pairing transaction: the rival-examinee check...
      "role: ROLE_EXAMINEE",
      // ...the examinee row it claims...
      "role: ROLE_EXAMINEE",
      // ...EX-PAIR-1TO1's in-transaction claimant check...
      "role: ROLE_INSTRUCTED_TRAINEE",
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
    // EX-PAIR-1TO1's ONE new read: the session's instructed-trainee rows.
    "prisma.examAssignment.findMany",
    "prisma.$transaction",
    // ...and inside the transaction: the rival-examinee check, the ONE statement
    // that claims (and locks) the examinee row on both paths, EX-PAIR-1TO1's
    // claimant check, and the instructed row.
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

  // EX-PAIR-1TO1's read is the MIRROR IMAGE, statement for statement: the same
  // plan relation, the same session, the same two columns, and the role as a
  // CONDITION rather than a filter applied afterwards.
  const instructed = bodyOf("findSessionInstructedTrainees");
  assert.ok(
    instructed.includes(
      "where: { sessionId, role: ROLE_INSTRUCTED_TRAINEE, session: { planId } },",
    ),
  );
  assert.ok(instructed.includes("select: { id: true, pairingIndex: true },"));
  for (const column of ["studentId", "horseName", "instructionTopic", "discipline", "notes", "student:"]) {
    assert.equal(instructed.includes(column), false, `the one-to-one read selects ${column}`);
  }
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

test("18. the pairing write is ONE transaction with FOUR conditions, in this order", () => {
  const body = bodyOf("pairInstructedTrainee");
  assert.ok(body.includes("await prisma.$transaction(async (tx) =>"));
  // 1. no rival examinee may hold the chosen index...
  assert.ok(body.includes("id: { not: command.examineeAssignmentId },"));
  assert.ok(body.includes("pairingIndex: command.pairingIndex,"));
  // 2. ...the examinee row is CLAIMED by an UPDATE on BOTH paths — written to
  //    the commanded index while it still holds exactly the expected one, which
  //    is `null` on the allocation path. ONE statement, not a branch: the reuse
  //    case writes the value it already holds, and exists for its ROW LOCK.
  assert.ok(body.includes("const claimed = await tx.examAssignment.updateMany({"));
  assert.ok(body.includes("pairingIndex: command.expectedExamineePairingIndex,"));
  assert.ok(body.includes("if (claimed.count !== 1) {"));
  // There is no longer a branch here at all, so the two paths cannot drift.
  assert.equal(
    body.includes("if (command.expectedExamineePairingIndex === null) {"),
    false,
    "the examinee claim still branches",
  );
  // 3. ...EX-PAIR-1TO1: no OTHER instructed trainee may hold that index, and the
  //    check is issued AFTER the lock, which is what makes it a fresh read.
  const claimIndex = body.indexOf("const claimed =");
  const claimantIndex = body.indexOf("const claimants =");
  assert.ok(claimantIndex > claimIndex, "the claimant check runs before the lock");
  assert.ok(body.includes("role: ROLE_INSTRUCTED_TRAINEE, pairingIndex: command.pairingIndex, id: { not: command.instructedAssignmentId },"));
  assert.ok(body.includes("if (claimants !== 0) {"));
  // 4. ...and the instructed row is conditional on the index it still holds.
  assert.ok(body.includes("pairingIndex: command.expectedInstructedPairingIndex,"));
  const writtenIndex = body.indexOf("const written =");
  assert.ok(writtenIndex > claimantIndex, "the instructed row is written too early");
  // Every condition failure ABORTS the transaction, so a half-written pair
  // cannot survive; nothing returns a flag from inside the callback.
  assert.equal((body.match(/throw new ExamPairingConditionFailed\(\);/g) ?? []).length, 4);
  // Every row is scoped by the plan relation and the session inside the
  // statements themselves.
  assert.equal((body.match(/session: \{ planId: command\.planId \},/g) ?? []).length, 4);
  assert.equal((body.match(/sessionId: command\.sessionId,/g) ?? []).length, 4);
});

test("18b. the examinee row is the LOCK, and nothing weaker stands in for it", () => {
  const body = bodyOf("pairInstructedTrainee");
  // The one-to-one rule is serialized by a ROW LOCK on the shared examinee row,
  // taken by an ordinary conditional update — NOT by an isolation level, a raw
  // `FOR UPDATE`, an advisory lock or a retry loop, none of which this slice may
  // introduce, and NOT by a bare `count` on the examinee, which takes no lock.
  for (const forbidden of [
    "isolationLevel",
    "Serializable",
    "SERIALIZABLE",
    "FOR UPDATE",
    "advisory",
    "$executeRaw",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module uses ${forbidden}`);
  }
  assert.equal(body.includes("const held ="), false, "the examinee is only counted");
  // The claim is an UPDATE on the examinee row, in the same transaction, before
  // the claimant count.
  assert.match(body, /const claimed = await tx\.examAssignment\.updateMany\(\{ where: \{ id: command\.examineeAssignmentId,/);
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
  // Each write reports a count, and each count is compared to exactly one row:
  // the examinee claim, the instructed row, and the unpair.
  assert.equal((CODE.match(/\.count !== 1/g) ?? []).length, 2);
  assert.equal((CODE.match(/cleared\.count === 1/g) ?? []).length, 1);
  // ...and each read-only condition is compared to zero.
  assert.equal((CODE.match(/rivals !== 0/g) ?? []).length, 1);
  assert.equal((CODE.match(/claimants !== 0/g) ?? []).length, 1);
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
    // EX-PAIR-1TO1's read, scoped by the SAME server-resolved plan and the SAME
    // derived session, and issued before the decision and before any write.
    { kind: "instructed", value: `${PLAN_ID}:${SESSION_ID}` },
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

test("25b. EX-PAIR-1TO1 — a SECOND trainee on one examinee is refused with no write", async () => {
  const h = harness({
    assignments: {
      [INSTRUCTED_ID]: instructedFacts(),
      [EXAMINEE_ID]: examineeFacts({ pairingIndex: 2 }),
    },
    sessionExaminees: [{ assignmentId: EXAMINEE_ID, pairingIndex: 2 }],
    sessionInstructedTrainees: [
      { assignmentId: "another-instructed", pairingIndex: 2 },
      { assignmentId: INSTRUCTED_ID, pairingIndex: null },
    ],
  });

  assert.deepEqual(await run(h, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: false,
    code: "examinee_already_paired",
  });
  // The refusal is reached BEFORE any write dependency is called at all.
  assert.deepEqual(h.pairCalls, []);
  assert.deepEqual(h.unpairCalls, []);
  assert.equal(h.log.some((entry) => entry.kind === "pair" || entry.kind === "unpair"), false);
});

test("25c. EX-PAIR-1TO1 — the SWITCH A -> B is one command that carries both ends", async () => {
  // The trainee holds examinee A's index 1 and moves to examinee B's index 2,
  // which nobody claims. ONE command: the expected-current predicate names A's
  // index and the payload names B's, so the release and the claim are the same
  // conditional write.
  const free = harness({
    assignments: {
      [INSTRUCTED_ID]: instructedFacts({ pairingIndex: 1 }),
      [EXAMINEE_ID]: examineeFacts({ pairingIndex: 2 }),
    },
    sessionExaminees: [
      { assignmentId: "examinee-a", pairingIndex: 1 },
      { assignmentId: EXAMINEE_ID, pairingIndex: 2 },
    ],
    sessionInstructedTrainees: [{ assignmentId: INSTRUCTED_ID, pairingIndex: 1 }],
  });

  assert.deepEqual(await run(free, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: true,
    status: "PAIRED",
    pairingIndex: 2,
  });
  assert.equal(free.pairCalls.length, 1);
  assert.equal(free.pairCalls[0].expectedInstructedPairingIndex, 1);
  assert.equal(free.pairCalls[0].pairingIndex, 2);
  assert.deepEqual(free.unpairCalls, []);

  // ...and when B is OCCUPIED the switch is refused, so A is provably still the
  // trainee's pairing: no write dependency ran.
  const occupied = harness({
    assignments: {
      [INSTRUCTED_ID]: instructedFacts({ pairingIndex: 1 }),
      [EXAMINEE_ID]: examineeFacts({ pairingIndex: 2 }),
    },
    sessionExaminees: [
      { assignmentId: "examinee-a", pairingIndex: 1 },
      { assignmentId: EXAMINEE_ID, pairingIndex: 2 },
    ],
    sessionInstructedTrainees: [
      { assignmentId: INSTRUCTED_ID, pairingIndex: 1 },
      { assignmentId: "another-instructed", pairingIndex: 2 },
    ],
  });

  assert.deepEqual(await run(occupied, INSTRUCTED_ID, EXAMINEE_ID), {
    ok: false,
    code: "examinee_already_paired",
  });
  assert.deepEqual(occupied.pairCalls, []);
  assert.deepEqual(occupied.unpairCalls, []);
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
  // Neither list was even read: an unpair needs no allocation, no ambiguity
  // check and no one-to-one check.
  assert.equal(h.log.some((entry) => entry.kind === "examinees"), false);
  assert.equal(h.log.some((entry) => entry.kind === "instructed"), false);
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
  // RE-POINTED by EX-PAIR-1TO1 by exactly one term: this slice edits the pairing
  // backend ITSELF, so its own four files are modifications rather than
  // additions. Nothing else is admitted, and the exact split between production
  // and suite is re-asserted below rather than trusted to this union.
  const approvedModified = [...APPROVED_MODIFIED_GUARDS, ...SLICE_FILES];
  const unapproved = modified.filter((path) => !approvedModified.includes(path));
  assert.deepEqual(unapproved, [], `the slice modified: ${unapproved.join(", ")}`);
  // RE-POINTED AGAIN by EX-PAIR-1TO1, and narrowed rather than widened.
  //
  // History, so the shrinking list is not mistaken for a weakened claim. The
  // original slice added four files and touched no production code. EX-PAIR-UI-MVP
  // then WIRED the backend, which necessarily edited four production files, and
  // this guard was re-pointed to that exact set while those edits were still
  // uncommitted. They are committed now — a clean tree modifies NOTHING — so the
  // set this guard may see is once again decided by the slice in progress, and
  // the slice in progress is EX-PAIR-1TO1.
  //
  // EX-PAIR-1TO1 edits the pairing BACKEND ITSELF and nothing else: the pure
  // decision core, where the one-to-one rule is decided, and its Prisma binding,
  // where that rule becomes a transaction condition. It adds no file, no route,
  // no component, no Server Action and no message. It deliberately does NOT edit
  // the route's page: the new refusal code renders no banner there, which is
  // recorded as a follow-up rather than fixed by a UI edit this slice is not
  // scoped for.
  //
  // What this guard has always protected is unchanged and is what the list
  // proves: no schema, no migration, no policy core, no auth module, no session
  // module, no capability catalog, no unrelated writer, no route and no page. A
  // THIRD production file, of any kind, still fails here.
  const APPROVED_PRODUCTION = [
    ["lib", "exam", "exam-pairing-write" + "-core.ts"].join("/"),
    ["lib", "actions", "exam-pairing-write" + "-io.ts"].join("/"),
  ].sort();
  for (const path of APPROVED_MODIFIED_GUARDS) {
    assert.ok(
      path.endsWith(".test.ts") || APPROVED_PRODUCTION.includes(path),
      `${path} is neither a guard suite nor an approved production file`,
    );
  }
  const production = modified.filter((path) => !path.endsWith(".test.ts")).sort();
  const unapprovedProduction = production.filter((path) => !APPROVED_PRODUCTION.includes(path));
  assert.deepEqual(
    unapprovedProduction,
    [],
    `production code was modified: ${unapprovedProduction.join(", ")}`,
  );
  // The UI TREES ARE UNTOUCHED, which is this slice's own explicit constraint and
  // is asserted POSITIVELY rather than left to the list above: not one admin,
  // instructor or trainee file changed, in the working tree, the index or a
  // commit against HEAD.
  const uiTouched = gitLines([
    "diff",
    "--name-only",
    "HEAD",
    "--",
    "app",
    "components",
  ]);
  assert.deepEqual(uiTouched, [], `a UI file changed: ${uiTouched.join(", ")}`);
  // ...and the backend's OWN suites are the only test files this slice re-points,
  // because the rule it adds is a claim those two suites make and no other.
  const suites = modified.filter((path) => path.endsWith(".test.ts")).sort();
  assert.deepEqual(
    suites.filter((path) => !SLICE_FILES.includes(path)),
    [],
    `a foreign guard suite was re-pointed: ${suites.join(", ")}`,
  );
});

test("31. no UI tree another writer owns was touched, and the footprint is exact", () => {
  // RE-POINTED by EX-PAIR-UI-MVP, and NARROWED rather than dropped. `app/admin`
  // leaves the untouched-tree list because the approved pairing UI lives in ONE
  // route inside it — and every path it may hold is named exactly, below. The two
  // trees this slice must never reach, the INSTRUCTOR and TRAINEE ones, stay
  // pinned at completely unchanged.
  for (const tree of [
    ["app", "instructor"].join("/"),
    ["app", "student"].join("/"),
  ]) {
    assert.deepEqual(gitLines(["status", "--porcelain", "--", tree]), [], `${tree} changed`);
  }
  // ...and every `app/admin` entry belongs to the ONE approved exams route.
  const adminTouched = gitLines(["status", "--porcelain", "--", ["app", "admin"].join("/")]).map(
    (line) => line.replace(/^\S{1,2}\s+/, ""),
  );
  const routePrefix = ["app", "admin", "courses", "[courseOfferingId]", "exams"].join("/") + "/";
  for (const path of adminTouched) {
    assert.ok(path.startsWith(routePrefix), `an admin file outside the exams route changed: ${path}`);
  }
  // Across the scoped trees — worktree, index and untracked together — the ONLY
  // entries are this slice's four new files, the guard suites and production
  // files its footprint re-points, and the pairing UI's own new contract suite.
  // A SUBSET check, so it holds while the slice is dirty, staged and committed
  // alike; what it forbids is any path outside that exact set.
  const approved = [...SLICE_FILES, ...APPROVED_MODIFIED_GUARDS, PAIRING_UI_SUITE];
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

test("32. EXACTLY the approved Server Action module reaches this backend", () => {
  // EX-PAIR-UI-MVP TRANSITION. This guard asserted the caller list was EMPTY,
  // which was the correct claim while the backend was committed but deliberately
  // unwired. Wiring it is exactly what makes that claim obsolete, so the guard is
  // RE-POINTED to an equally exact POSITIVE claim rather than deleted or weakened
  // to "some caller exists": the ONE course-scoped admin exams Server Action
  // module, and nothing else anywhere under `app/`, `lib/`, `components/` or
  // `scripts/`.
  //
  // A SECOND caller — an instructor route, a trainee route, a component, a
  // script, another action module — still fails here, which is the whole point:
  // this backend carries an admin boundary and a course-lifecycle gate, and every
  // new caller is a new decision about who may re-pair an exam.
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
  assert.deepEqual(
    normalized,
    [...APPROVED_CALLERS].sort(),
    `an unapproved caller exists: ${normalized.join(", ")}`,
  );
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
