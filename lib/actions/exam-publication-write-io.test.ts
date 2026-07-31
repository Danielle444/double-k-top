/**
 * EX-PUB-BE-MVP — tests for the ExamPlan publish/unpublish binding
 * (lib/actions/exam-publication-write-io.ts).
 *
 * Run with: npx tsx --test lib/actions/exam-publication-write-io.test.ts
 *
 * TWO KINDS OF PROOF, AND WHY.
 *
 * 1. STRUCTURAL. The module under test declares `import "server-only"`, which is
 *    exactly the guarantee this slice wants — and which makes the module
 *    UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 *    unimportable from any client bundle). Its authorization import chain would
 *    also construct a database client. So the same approach the committed exam
 *    read-contract and write-binding suites take is used here: this suite reads
 *    the module's SOURCE and asserts on its structure — which statements exist, on
 *    which client, with which payload, and which dependency name each binding is
 *    wired to.
 *
 * 2. RUNTIME. The BEHAVIOUR — the order, the no-op rule and the stale-write
 *    refusal — belongs to the pure core, and is exercised here at runtime with
 *    fakes standing in for the two Prisma statements, the clock and the admin
 *    boundary, bound EXACTLY as the module binds them. The structural half is what
 *    proves the module really wires THOSE functions to THOSE dependency names; the
 *    two together are what make the claim, and neither is sufficient alone.
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
  setExamPlanPublicationWithDeps,
  type ExamPlanPublicationRow,
  type SetExamPlanPublicationDeps,
  type SetExamPlanPublicationResult,
} from "../exam/exam-publication-write-core";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-publication-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-publication-write-io.test.ts");
const CORE_REL = join("lib", "exam", "exam-publication-write-core.ts");
const CORE_TEST_REL = join("lib", "exam", "exam-publication-write-core.test.ts");

/** The four files of this slice, in git's own form (forward slashes everywhere). */
const SLICE_FILES = [
  ["lib", "exam", "exam-publication-write-core.ts"].join("/"),
  ["lib", "exam", "exam-publication-write-core.test.ts"].join("/"),
  ["lib", "actions", "exam-publication-write-io.ts"].join("/"),
  ["lib", "actions", "exam-publication-write-io.test.ts"].join("/"),
].sort();

/**
 * The ONLY tracked files this slice modifies, and every one of them is a GUARD
 * SUITE.
 *
 * Each of these four pins its own slice's working-tree footprint to an exact list,
 * so four brand-new `lib/` files necessarily re-point them. Each was widened by
 * exactly these four NAMED paths — never to a directory and never to a glob — and
 * every one of those suites' caller, Prisma, auth and lifecycle claims is left
 * exactly as it was.
 *
 * Spelled as ASSEMBLED pieces rather than whole: every one of them sweeps `app/`,
 * `lib/` and `components/` for its own module name and pins the result to an exact
 * caller list, so a file naming one whole would enrol itself in a list it must
 * stay out of.
 *
 * ZERO production files are on this list, which guard 26 re-checks structurally
 * rather than trusting the list to stay honest on its own.
 */
const APPROVED_MODIFIED_GUARDS = [
  ["lib", "actions", "exam-session-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-definition-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "admin-exam-session-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-instructed-trainee-assignment-write" + "-io.test.ts"].join("/"),
  ["lib", "exam", "exam-supervisor-write" + "-core.test.ts"].join("/"),
  // RE-POINTED by EX-PAIR-BE-MVP, the neighbouring PAIRING backend described
  // below: its four `lib/` additions re-point the SAME five suites plus THIS
  // one, so this suite's own path joins the list. It is a `.test.ts` like every
  // other entry, and guard 26 still re-checks that structurally.
  ["lib", "actions", "exam-publication-write" + "-io.test.ts"].join("/"),
  // ...and the five further suites whose own "no tracked file was modified"
  // claims that one re-point widens by a single exact `.test.ts` path.
  ["lib", "actions", "exam-assignment-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-assignment-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-supervisor-write" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-supervisor-read" + "-io.test.ts"].join("/"),
  ["lib", "actions", "exam-plan-write" + "-io.test.ts"].join("/"),
].sort();

/**
 * The neighbouring EX-PAIR-BE-MVP slice's four `lib/` files: the
 * instructed-trainee/examinee pairing pure core, its binding, and a suite for
 * each.
 *
 * Kept SEPARATE from this slice's own four, because `SLICE_FILES` is what guard
 * 26 asserts to be pure ADDITIONS of THIS slice, and that claim must not be
 * diluted by a neighbour's files. Named EXACTLY — no directory and no glob — so a
 * fifth neighbouring addition still fails guard 27.
 *
 * That slice writes ONE ExamAssignment column, `pairingIndex`, adds no caller,
 * no route and no Server Action, and modifies no production file. Its two
 * `lib/actions` paths are ASSEMBLED for the same reason as every path above.
 */
const APPROVED_NEIGHBOUR_ADDITIONS = [
  ["lib", "exam", "exam-pairing-write" + "-core.ts"].join("/"),
  ["lib", "exam", "exam-pairing-write" + "-core.test.ts"].join("/"),
  ["lib", "actions", "exam-pairing-write" + "-io.ts"].join("/"),
  ["lib", "actions", "exam-pairing-write" + "-io.test.ts"].join("/"),
].sort();

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
/** A fixed, obviously synthetic server instant. */
const NOW = 1_700_000_000_000;
/** An earlier instant, standing in for "already published a while ago". */
const EARLIER = 1_600_000_000_000;

class SentinelOfferingNotFound extends Error {}
class SentinelOperationNotPermitted extends Error {}

interface HarnessOptions {
  readonly plan?: ExamPlanPublicationRow | null;
  readonly writeSucceeds?: boolean;
  readonly authThrows?: unknown;
  readonly gateThrows?: unknown;
}

interface WriteCall {
  readonly courseOfferingId: string;
  readonly planId: string;
  readonly expectedPublishedAt: number | null;
  readonly nextPublishedAt: number | null;
}

interface Harness {
  readonly deps: SetExamPlanPublicationDeps;
  readonly log: { kind: string; value: string }[];
  readonly findCalls: string[];
  readonly writeCalls: WriteCall[];
}

/**
 * The module's bundle, dependency-for-dependency:
 *   requireCourseContext                    -> the admin boundary + exact offering
 *   assertConfigurationAllowed              -> the lifecycle gate
 *   now                                     -> the SERVER clock
 *   findPlanPublicationByCourseOfferingId   -> the ONE read
 *   setPublicationIfCurrent                 -> the ONE conditional write
 *   isCourseNotFoundError                   -> an identity check
 *   isOperationNotAllowedError              -> an identity check
 */
function harness(options: HarnessOptions = {}): Harness {
  const log: { kind: string; value: string }[] = [];
  const findCalls: string[] = [];
  const writeCalls: WriteCall[] = [];

  const deps: SetExamPlanPublicationDeps = {
    async requireCourseContext(requestedCourseOfferingId) {
      log.push({ kind: "auth", value: requestedCourseOfferingId });
      if ("authThrows" in options) throw options.authThrows;
      return { courseOfferingId: VERIFIED_OFFERING_ID, status: "ACTIVE" };
    },
    assertConfigurationAllowed(status) {
      log.push({ kind: "gate", value: status });
      if ("gateThrows" in options) throw options.gateThrows;
    },
    now() {
      log.push({ kind: "clock", value: "now" });
      return NOW;
    },
    async findPlanPublicationByCourseOfferingId(verifiedCourseOfferingId) {
      log.push({ kind: "find", value: verifiedCourseOfferingId });
      findCalls.push(verifiedCourseOfferingId);
      return options.plan === undefined ? { id: PLAN_ID, publishedAt: null } : options.plan;
    },
    async setPublicationIfCurrent(
      verifiedCourseOfferingId,
      planId,
      expectedPublishedAt,
      nextPublishedAt,
    ) {
      log.push({ kind: "write", value: planId });
      writeCalls.push({
        courseOfferingId: verifiedCourseOfferingId,
        planId,
        expectedPublishedAt,
        nextPublishedAt,
      });
      return options.writeSucceeds ?? true;
    },
    isCourseNotFoundError: (error) => error instanceof SentinelOfferingNotFound,
    isOperationNotAllowedError: (error) => error instanceof SentinelOperationNotPermitted,
  };

  return { deps, log, findCalls, writeCalls };
}

function run(h: Harness, operation: unknown): Promise<SetExamPlanPublicationResult> {
  return setExamPlanPublicationWithDeps(REQUESTED_OFFERING_ID, operation, h.deps);
}

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
    "FormData",
    "formData",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports EXACTLY ONE function, with the exact public signature", () => {
  assert.deepEqual(SIGNATURES.map((entry) => entry.name), ["setExamPlanPublication"]);
  assert.ok(/export async function setExamPlanPublication\(/.test(SOURCE));

  const publish = signature("setExamPlanPublication");
  assert.equal(
    publish.params,
    "courseOfferingId: string, operation: ExamPublicationOperation,",
  );
  assert.equal(publish.returns, "Promise<SetExamPlanPublicationResult>");

  // The result TYPE is the core's, re-exported rather than redeclared, so the two
  // can never describe different outcomes.
  assert.equal(
    (SOURCE.match(/export type \{[^}]*SetExamPlanPublicationResult[^}]*\} from/g) ?? []).length,
    1,
  );
  assert.equal(CODE.includes("interface SetExamPlanPublicationResult"), false);
  assert.equal(CODE.includes("type SetExamPlanPublicationResult ="), false);
});

test("4. the public function accepts NO timestamp, plan id, actor or client value", () => {
  const params = signature("setExamPlanPublication").params;
  for (const forbidden of [
    "planId",
    "publishedAt",
    "published",
    "now",
    "Date",
    "timestamp",
    "when",
    "at:",
    "sessionId",
    "definitionId",
    "adminId",
    "actorId",
    "instructorId",
    "studentId",
    "expectedUpdatedAt",
    "rawInput",
    "FormData",
    "formData",
    "tx",
    "prisma",
    "deps",
  ]) {
    assert.equal(params.includes(forbidden), false, `the writer accepts ${forbidden}`);
  }
  // Exactly two parameters: the requested offering, and which of the two
  // transitions is wanted.
  assert.equal(params.split(":").length - 1, 2, `the signature is: ${params}`);
  // ...and the operation is the core's two-value union, not a free string.
  assert.ok(params.includes("operation: ExamPublicationOperation"));
});

// ===========================================================================
// 5–9. Authorization, the lifecycle gate, and the server clock
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
  for (const forbidden of [
    "context.name",
    "context.level",
    "context.startDate",
    "context.endDate",
  ]) {
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
  // No other lifecycle operation is referenced in CODE — the header names the
  // publication alternative in prose, deliberately, and that is asserted below.
  for (const other of [
    "OFFERING_STRUCTURE_UPDATE",
    "OFFERING_METADATA_UPDATE",
    "ENROLLMENT_MANAGEMENT",
    "TEACHING_PRACTICE_OPERATION",
    "DESTRUCTIVE_MAINTENANCE",
    "EXAM_CONFIGURATION",
  ]) {
    assert.equal(CODE.includes(other), false, `the module also references ${other}`);
  }
  assert.equal(CODE.includes("SCHEDULE_PUBLICATION"), false, "the gate is not the approved one");
  // The temporary reuse, and the open product question, are both documented so
  // neither reads as an oversight.
  assert.ok(/lifecycle/i.test(COMMENTS), "the lifecycle reuse is undocumented");
  assert.ok(
    COMMENTS.includes("SCHEDULE_" + "PUBLICATION"),
    "the alternative gate is not disclosed",
  );
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

test("9. the publication instant is SERVER-generated, in exactly one place", () => {
  // The clock is read once, inside one named helper, and bound as the core's
  // `now` dependency.
  assert.equal((CODE.match(/Date\.now\(\)/g) ?? []).length, 1, "the clock is read more than once");
  const clock = bodyOf("currentTimeMs");
  assert.ok(/return Date\.now\(\);/.test(clock), `the clock helper is: ${clock}`);
  assert.ok(CODE.includes("now: currentTimeMs"), "the clock is not bound as the core's now");
  // No other time source, and no clock inside either Prisma helper.
  for (const token of ["performance.now", "hrtime", "new Date()", "Date.parse", "toISOString"]) {
    assert.equal(CODE.includes(token), false, `the module also uses ${token}`);
  }
  for (const helper of ["findPlanPublicationByCourseOfferingId", "setPublicationIfCurrent"]) {
    assert.equal(bodyOf(helper).includes("Date.now"), false, `${helper} reads the clock`);
  }
  // The only `new Date(...)` conversions are the two in the conditional write,
  // each converting a number the CORE produced — never a caller value.
  const writer = bodyOf("setPublicationIfCurrent");
  assert.equal((CODE.match(/new Date\(/g) ?? []).length, 2);
  assert.equal((writer.match(/new Date\(/g) ?? []).length, 2);
});

// ===========================================================================
// 10–15. The Prisma surface
// ===========================================================================

test("10. the ENTIRE Prisma surface is one findUnique and one updateMany", () => {
  assert.deepEqual(PRISMA_CALLS, ["prisma.examPlan.findUnique", "prisma.examPlan.updateMany"]);
  // No other model is reached at all.
  const models = CODE.match(/prisma\.(\w+)\./g) ?? [];
  assert.deepEqual([...new Set(models)], ["prisma.examPlan."]);
});

test("11. no Prisma statement lives outside the two named binding helpers", () => {
  const inHelpers =
    (bodyOf("findPlanPublicationByCourseOfferingId").match(/\bprisma\./g) ?? []).length +
    (bodyOf("setPublicationIfCurrent").match(/\bprisma\./g) ?? []).length;
  assert.equal((CODE.match(/\bprisma\./g) ?? []).length, inHelpers);
  // The public function itself touches no client and awaits nothing but the core.
  const publicBody = bodyOf("setExamPlanPublication");
  assert.equal(publicBody.includes("prisma"), false, "the public function touches the client");
  assert.ok(
    /return setExamPlanPublicationWithDeps\(courseOfferingId, operation, \{/.test(publicBody),
  );
});

test("12. the plan read is by the VERIFIED offering id and selects ONLY id + publishedAt", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  assert.match(
    callArguments("prisma.examPlan.findUnique("),
    /^\(\s*\{\s*where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId,?\s*\},\s*select:\s*\{\s*id:\s*true,\s*publishedAt:\s*true,?\s*\},?\s*\}\s*\)$/,
    `the lookup is: ${callArguments("prisma.examPlan.findUnique(")}`,
  );
  // Named explicitly, because each of these would be data this operation has no
  // business reading.
  const query = bodyOf("findPlanPublicationByCourseOfferingId");
  for (const forbidden of [
    "individualPublishedAt",
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

test("13. the write is ONE conditional updateMany, scoped by plan AND offering", () => {
  assert.equal((CODE.match(/examPlan\.updateMany\(/g) ?? []).length, 1);
  assert.match(
    callArguments("prisma.examPlan.updateMany("),
    /^\(\s*\{\s*where:\s*\{\s*id:\s*planId,\s*courseOfferingId:\s*verifiedCourseOfferingId,\s*publishedAt:\s*expected,?\s*\},\s*data:\s*\{\s*publishedAt:\s*next,?\s*\},?\s*\}\s*\)$/,
    `the write is: ${callArguments("prisma.examPlan.updateMany(")}`,
  );
  // The anchored match above already excludes every other column; these name the
  // ones that would be actively harmful, so a future edit fails loudly.
  const writer = bodyOf("setPublicationIfCurrent");
  for (const forbidden of [
    "individualPublishedAt",
    "sourceDate",
    "definitions",
    "sessions",
    "connect",
    "create:",
    "createMany",
    "include",
    "select:",
  ]) {
    assert.equal(writer.includes(forbidden), false, `the write touches ${forbidden}`);
  }
  // The expected-state predicate really is the caller-free pair the core hands
  // over, converted here and nowhere else.
  assert.ok(/const expected = expectedPublishedAt === null \? null : new Date\(/.test(writer));
  assert.ok(/const next = nextPublishedAt === null \? null : new Date\(/.test(writer));
  // ...and a row was changed only when the count says so.
  assert.ok(/return written\.count > 0;/.test(writer));
});

test("14. there is NO upsert, create, delete, transaction or raw SQL", () => {
  for (const token of [
    "upsert",
    "update(",
    "updateManyAndReturn",
    "create(",
    "createMany",
    "delete(",
    "deleteMany",
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
  // The only write of any kind is the conditional publication update.
  const writes =
    /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  assert.deepEqual([...CODE.matchAll(writes)].map((match) => `${match[1]}.${match[2]}`), [
    "examPlan.updateMany",
  ]);
  // Publishing must never bring a plan into existence, and that is stated.
  assert.ok(/publishing must never bring a/i.test(COMMENTS), "the rule is undocumented");
});

test("15. there is no retry, no loop, no second write path and no post-write re-read", () => {
  for (const token of ["retry", "Retry", "attempt", "backoff", "maxWait", "Promise.all"]) {
    assert.equal(CODE.includes(token), false, `the module configures ${token}`);
  }
  for (const helper of [
    "requireCourseContext",
    "currentTimeMs",
    "findPlanPublicationByCourseOfferingId",
    "setPublicationIfCurrent",
    "setExamPlanPublication",
  ]) {
    const body = bodyOf(helper);
    for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", ".reduce("]) {
      assert.equal(body.includes(loop), false, `${helper} contains ${loop}`);
    }
  }
  // The write helper issues exactly ONE statement: no confirmation read follows a
  // successful update.
  const writer = bodyOf("setPublicationIfCurrent");
  assert.equal((writer.match(/await prisma\./g) ?? []).length, 1);
  assert.equal(writer.includes("findUnique"), false, "the write re-reads the row");
  assert.equal(writer.includes("findFirst"), false, "the write re-reads the row");
});

// ===========================================================================
// 16–18. Nothing else is read, written, imported or decided here
// ===========================================================================

test("16. no session, assignment, supervisor, pairing or notification surface is touched", () => {
  for (const token of [
    "individualPublishedAt",
    "examSession",
    "ExamSession",
    "examDefinition",
    "examAssignment",
    "examSessionBreak",
    "examBeginnerChild",
    "supervisor",
    "Supervisor",
    "pairing",
    "Pairing",
    "teachingPractice",
    "courseOffering.",
    "courseEnrollment",
    "student.",
    "instructor.",
    "notification",
    "Notification",
    "web-push",
    "webpush",
    "sendMessage",
    "push-",
    "materials",
  ]) {
    assert.equal(CODE.includes(token), false, `the module touches ${token}`);
  }
  // ...and the header states that the per-session column is out of scope.
  assert.ok(
    COMMENTS.includes("individual" + "PublishedAt"),
    "the per-session column is not disclaimed",
  );
});

test("17. the import list is EXACTLY the five approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "@/app/generated/prisma/client",
    "@/lib/course/admin-course-context",
    "@/lib/course/operation-policy-core",
    "@/lib/exam/exam-publication-write-core",
    "@/lib/prisma",
  ]);
});

test("18. the binding decides nothing: every outcome comes from the pure core", () => {
  for (const token of [
    "offering_not_found",
    "operation_not_allowed",
    "unknown_operation",
    "plan_not_found",
    "stale_write",
    "NO_CHANGE",
    "already",
    "ok: false",
    "ok: true",
    "Object.freeze",
    "P2002",
    "P2025",
    "NEXT_REDIRECT",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
  // The seven dependencies are bound by name, and NOTHING else is.
  const publicBody = bodyOf("setExamPlanPublication");
  const bound = [...publicBody.matchAll(/^\s{4}(\w+)[,:]/gm)].map(([, name]) => name).sort();
  assert.deepEqual(bound, [
    "assertConfigurationAllowed",
    "findPlanPublicationByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "now",
    "requireCourseContext",
    "setPublicationIfCurrent",
  ]);
  // The pure core really exports what is bound.
  assert.ok(CORE_CODE.includes("export async function setExamPlanPublicationWithDeps("));
  assert.ok(CORE_CODE.includes("export function decideExamPlanPublication("));
});

// ===========================================================================
// 19–24. RUNTIME — the bundle, executed against the real pure core
// ===========================================================================

test("19. the admin boundary runs BEFORE the plan read, the clock and the write", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  await run(h, "PUBLISH");
  assert.deepEqual(h.log.map((entry) => entry.kind), ["auth", "gate", "find", "clock", "write"]);
  assert.equal(h.log[0].value, REQUESTED_OFFERING_ID, "the boundary got the wrong id");
  // ...and the pure core is what enforces that order: its first awaited dependency
  // is the boundary, textually ahead of both Prisma dependencies.
  const authAt = CORE_CODE.indexOf("deps.requireCourseContext(");
  const gateAt = CORE_CODE.indexOf("deps.assertConfigurationAllowed(");
  const findAt = CORE_CODE.indexOf("deps.findPlanPublicationByCourseOfferingId(");
  const writeAt = CORE_CODE.indexOf("deps.setPublicationIfCurrent(");
  assert.ok(authAt > 0 && gateAt > authAt && findAt > gateAt && writeAt > findAt);
});

test("20. an unauthorized caller, and a denied lifecycle, cause ZERO Prisma access", async () => {
  const unauthorized = harness({ authThrows: new SentinelOfferingNotFound() });
  assert.deepEqual(await run(unauthorized, "PUBLISH"), {
    ok: false,
    code: "offering_not_found",
  });
  assert.deepEqual(unauthorized.findCalls, [], "the plan was read anyway");
  assert.deepEqual(unauthorized.writeCalls, [], "the plan was written anyway");

  const denied = harness({ gateThrows: new SentinelOperationNotPermitted() });
  assert.deepEqual(await run(denied, "UNPUBLISH"), {
    ok: false,
    code: "operation_not_allowed",
  });
  assert.deepEqual(denied.findCalls, [], "an ARCHIVED offering was still queried");
  assert.deepEqual(denied.writeCalls, [], "an ARCHIVED offering was still changed");
});

test("21. only the plan of the SUPPLIED offering is resolved, and only it is written", async () => {
  const h = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  await run(h, "PUBLISH");
  assert.deepEqual(h.findCalls, [VERIFIED_OFFERING_ID]);
  assert.deepEqual(h.writeCalls, [
    {
      courseOfferingId: VERIFIED_OFFERING_ID,
      planId: PLAN_ID,
      expectedPublishedAt: null,
      nextPublishedAt: NOW,
    },
  ]);
  // The REQUESTED id reached the boundary and nothing else.
  const sawRequested = h.log.filter((entry) => entry.value === REQUESTED_OFFERING_ID);
  assert.deepEqual(sawRequested.map((entry) => entry.kind), ["auth"]);
  // A missing plan is refused rather than created.
  const missing = harness({ plan: null });
  assert.deepEqual(await run(missing, "PUBLISH"), { ok: false, code: "plan_not_found" });
  assert.deepEqual(missing.writeCalls, []);
});

test("22. exactly ONE scoped write when the state changes, in both directions", async () => {
  const publishing = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  assert.deepEqual(await run(publishing, "PUBLISH"), {
    ok: true,
    status: "PUBLISHED",
    publishedAt: NOW,
  });
  assert.equal(publishing.writeCalls.length, 1);

  const clearing = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } });
  assert.deepEqual(await run(clearing, "UNPUBLISH"), {
    ok: true,
    status: "UNPUBLISHED",
    publishedAt: null,
  });
  assert.deepEqual(clearing.writeCalls, [
    {
      courseOfferingId: VERIFIED_OFFERING_ID,
      planId: PLAN_ID,
      expectedPublishedAt: EARLIER,
      nextPublishedAt: null,
    },
  ]);
});

test("23. a true no-op issues NO write, and never moves the stored instant", async () => {
  const republish = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER } });
  assert.deepEqual(await run(republish, "PUBLISH"), {
    ok: true,
    status: "NO_CHANGE",
    publishedAt: EARLIER,
  });
  assert.deepEqual(republish.writeCalls, [], "an already-published plan was re-stamped");

  const reclear = harness({ plan: { id: PLAN_ID, publishedAt: null } });
  assert.deepEqual(await run(reclear, "UNPUBLISH"), {
    ok: true,
    status: "NO_CHANGE",
    publishedAt: null,
  });
  assert.deepEqual(reclear.writeCalls, [], "an unpublished plan was written to");
});

test("24. concurrent state is a stale write, never an overwrite, and a redirect survives", async () => {
  const stale = harness({ plan: { id: PLAN_ID, publishedAt: EARLIER }, writeSucceeds: false });
  assert.deepEqual(await run(stale, "UNPUBLISH"), { ok: false, code: "stale_write" });
  assert.equal(stale.writeCalls.length, 1, "the write was retried over newer data");

  const redirect = frameworkRedirect();
  const redirected = harness({ authThrows: redirect });
  await assert.rejects(
    () => run(redirected, "PUBLISH"),
    (error: unknown) => error === redirect,
  );
  assert.deepEqual(redirected.findCalls, []);
  assert.deepEqual(redirected.writeCalls, []);

  // An unrecognized operation never reaches a statement.
  const bogus = harness();
  assert.deepEqual(await run(bogus, "TOGGLE"), { ok: false, code: "unknown_operation" });
  assert.deepEqual(bogus.findCalls, []);
  assert.deepEqual(bogus.writeCalls, []);
});

// ===========================================================================
// 25–28. Containment — four new files, nothing modified, nothing wired
// ===========================================================================

test("25. the slice's four files exist, and none is a UI file", () => {
  for (const rel of [CORE_REL, CORE_TEST_REL, IO_REL, IO_TEST_REL]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // The slice added EXACTLY these two per directory and no third.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => name.startsWith("exam-publication-write"))
    .sort();
  assert.deepEqual(examSlice, [
    "exam-publication-write-core.test.ts",
    "exam-publication-write-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-publication"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-publication-write-io.test.ts",
    "exam-publication-write-io.ts",
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
    join("lib", "actions", "exam-publication-actions.ts"),
    join("lib", "actions", "exam-publish.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("26. the slice modified ONLY guard suites — not one production file", () => {
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the check
  // flip to red the moment the four new files are staged and back to green after
  // they are committed — a guard that only holds in one of three ordinary states
  // proves nothing. What IS asserted, in all three states, is that no tracked file
  // outside the four named guard suites was touched: no schema, no migration, no
  // policy, no auth module, no unrelated core, no route, no page.
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
  // ...and the approved list cannot quietly grow into a production file: every
  // entry on it is a `.test.ts` suite, checked here rather than assumed.
  for (const path of APPROVED_MODIFIED_GUARDS) {
    assert.ok(path.endsWith(".test.ts"), `${path} is not a guard suite`);
  }
  const production = modified.filter((path) => !path.endsWith(".test.ts"));
  assert.deepEqual(production, [], `production code was modified: ${production.join(", ")}`);
  // The slice's own PRODUCTION files and pure-core suite are ADDITIONS, never
  // modifications — which is what makes "this slice added a backend and changed
  // no behaviour" checkable.
  //
  // NARROWED by EX-PAIR-BE-MVP rather than dropped: THIS suite is excluded,
  // because re-pointing it is exactly the approved change the neighbouring slice
  // makes, and a rule forbidding its own amendment could never be satisfied. The
  // binding, the pure core and the core's suite must still be byte-identical to
  // HEAD, and every other claim in this file is untouched.
  for (const path of SLICE_FILES.filter((entry) => entry !== IO_TEST_REL.split(sep).join("/"))) {
    assert.equal(modified.includes(path), false, `${path} is not an addition`);
  }
});

test("27. no schema, migration, app, instructor or trainee file was touched", () => {
  // Every working-tree entry under `prisma/` — untracked included — is empty, so
  // no schema and no migration changed.
  assert.deepEqual(gitLines(["status", "--porcelain", "--", "prisma"]), []);
  // The three UI trees other writers own are untouched in every state.
  for (const tree of [
    ["app", "admin"].join("/"),
    ["app", "instructor"].join("/"),
    ["app", "student"].join("/"),
  ]) {
    assert.deepEqual(gitLines(["status", "--porcelain", "--", tree]), [], `${tree} changed`);
  }
  // ...and across the scoped trees, worktree, index and untracked together, the
  // ONLY entries are this slice's four new files and the four guard suites its
  // footprint re-points. A SUBSET check, so it holds while the slice is dirty,
  // staged and committed alike; what it forbids is any NINTH path.
  const approved = [
    ...SLICE_FILES,
    ...APPROVED_MODIFIED_GUARDS,
    ...APPROVED_NEIGHBOUR_ADDITIONS,
  ];
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

test("28. this backend has ZERO callers: nothing in the app can reach it yet", () => {
  const own = new Set([
    join(REPO_ROOT, IO_REL),
    join(REPO_ROOT, IO_TEST_REL),
    join(REPO_ROOT, CORE_REL),
    join(REPO_ROOT, CORE_TEST_REL),
  ]);
  const MODULE_SPECIFIER = "exam-publication-write-io";
  // The trailing `(` is what distinguishes the WRITER call from a future Server
  // Action that merely wraps it under a different name.
  const PUBLIC_CALL = new RegExp("\\bset" + "ExamPlanPublication\\s*\\(");
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

test("29. this suite opens no database and reads no environment", () => {
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
  // the PURE core. (The module's own import list is asserted at 17, which
  // legitimately NAMES the client module it binds.)
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(specifiers)].sort(), [
    "../exam/exam-publication-write-core",
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
