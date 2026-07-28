// P-MATERIALS M3B-0 - DB-free CONTRACT/source test for the admin authorization
// gate and the architectural containment added to the material-added
// notification fan-out.
//
// WHY THIS SLICE EXISTS
//
// lib/actions/notifications.ts carries "use server", so every async export in it
// is compiled into a publicly dispatchable Server Action endpoint - reachable by
// a direct POST, not only through the UI, and even though no Client Component
// imports createMaterialAddedNotifications (its action id is registered in the
// build's server-reference-manifest all the same). Page-level /admin gating is
// NOT its authorization boundary: the proxy performs a deliberately optimistic,
// database-free session check, so a REVOKED admin still holding a valid session
// token would otherwise reach the fan-out and push attacker-chosen text to every
// active instructor. M3B will widen this path to trainees, so the gate lands
// first.
//
// THREE PROTECTIONS, PINNED HERE:
//   1. EXPLICIT AUTHORIZATION - `await requireAdmin()` is the FIRST awaited
//      operation of the exported boundary, from the canonical shared helper,
//      failing closed, with no client-supplied admin identity and no role/name
//      inference. An unauthorized direct invocation performs zero Prisma reads
//      and zero Prisma writes.
//   2. ARCHITECTURAL CONTAINMENT - the fan-out IO lives in
//      lib/course/capabilities/material-notification-fanout.ts, which holds NO
//      "use server" directive and therefore mints no public endpoint of its own.
//      P-MATERIALS M3B adds one more such module, the recipient IO shell
//      lib/course/capabilities/material-notification-trainee-recipients.ts, held
//      to the same containment rules (tests 10/10b).
//   3. THE PERSISTED MATERIAL IS AUTHORITATIVE (P-MATERIALS M3B) - requireAdmin()
//      fixed WHO may call the boundary, but `title` and `visibility` still
//      arrived as caller parameters, so an authorized-but-forged direct POST
//      could still select the audience and dictate the delivered text. The
//      fan-out now re-reads the persisted CourseMaterial ONCE by id and drives
//      BOTH branches from it: an unknown or hidden material notifies nobody, the
//      instructor gate reads the persisted visibility, and every `body` is the
//      persisted title (tests 11, 12, 12b).
//
// HISTORY - tests 10 and 12 previously asserted that the pure recipient core was
// UNWIRED and that NO trainee fan-out existed. Those were M2B/M3B-0 statements
// about work not yet done, carrying the standing instruction that the slice which
// legitimately does it must update them in the SAME reviewed change. M3B is that
// slice: both were INVERTED to pin the shape of the new wiring (exactly one
// approved shell; a trainee branch that cannot widen), never relaxed or deleted.
//
// A behavioural test of a Server Action would require mocking Prisma, the auth
// session and next/cache; the repo's established pattern for wiring/authorization
// invariants is a source-level contract test (see
// lib/actions/admin-write-guards-a1.contract.test.ts, whose structure this file
// follows). The fan-out's PAYLOAD invariants stay where they already live, in
// lib/actions/materials-writer-audience-contract.test.ts.
//
// Run: npx tsx --test lib/actions/material-notification-auth.contract.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Strip block and line comments so every invariant below is checked against real
// CODE only, never the (deliberately prose-y) contract comments - which
// legitimately name requireAdmin, prisma, "use server" and the M3A core. None of
// the inspected modules contains `//` inside a string or regex literal (verified:
// zero occurrences of "://" in all four), so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readRaw(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function readCode(relativePath: string): string {
  return stripComments(readRaw(relativePath));
}

const NOTIFICATIONS_RAW = readRaw("./notifications.ts");
const NOTIFICATIONS = readCode("./notifications.ts");
const FANOUT_RAW = readRaw("../course/capabilities/material-notification-fanout.ts");
const FANOUT = readCode("../course/capabilities/material-notification-fanout.ts");
const MATERIALS = readCode("./materials.ts");
const ROUTE = readCode("../../app/api/admin/materials/upload/route.ts");

const BOUNDARY = "createMaterialAddedNotifications";
const INTERNAL = "fanOutMaterialAddedNotifications";
const GUARD = "await requireAdmin()";

// Slice one exported function's body out of a source file by brace matching, so
// a following declaration can never be folded into the body under test.
//
// The parameter list is skipped by PAREN matching first. Several functions here
// are declared `(params: { materialId: string; ... })`, so the first `{` after
// the signature is the inline TYPE LITERAL, not the body - taking it would slice
// the parameter type and make every body assertion below silently vacuous.
function fnBody(src: string, name: string): string {
  const sig = src.indexOf(`export async function ${name}(`);
  assert.ok(sig >= 0, `export async function ${name}( must exist`);

  const parenOpen = src.indexOf("(", sig);
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < src.length; i += 1) {
    if (src[i] === "(") parenDepth += 1;
    else if (src[i] === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenClose = i;
        break;
      }
    }
  }
  assert.ok(parenClose > -1, `${name} must have a closing parameter list`);

  const open = src.indexOf("{", parenClose);
  assert.ok(open >= 0, `${name} must have a body`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

// ===========================================================================
// 1-6. EXPLICIT AUTHORIZATION on the exported Server Action boundary
// ===========================================================================

test("1. the boundary is still an exported async function in the 'use server' module", () => {
  assert.match(NOTIFICATIONS, /^"use server";/, "notifications.ts must still be a Server Action module");
  assert.ok(
    NOTIFICATIONS.includes(`export async function ${BOUNDARY}(`),
    `${BOUNDARY} must remain an exported async function`,
  );
  // Signature byte-identical: the authorized admin call sites keep working and
  // no parameter was added, removed or retyped by this security slice.
  assert.match(
    NOTIFICATIONS,
    new RegExp(
      `export async function ${BOUNDARY}\\(params: \\{\\s*` +
        `materialId: string;\\s*title: string;\\s*visibility: CourseMaterialVisibilityValue;\\s*` +
        `\\}\\): Promise<void>`,
    ),
    "the public signature must be unchanged",
  );
});

test("2. await requireAdmin() is the FIRST awaited operation of the boundary", () => {
  const body = fnBody(NOTIFICATIONS, BOUNDARY);
  const guardIdx = body.indexOf(GUARD);
  assert.ok(guardIdx > -1, `${BOUNDARY} must call ${GUARD}`);
  const firstAwait = body.indexOf("await ");
  assert.equal(
    firstAwait,
    guardIdx,
    `the first awaited operation must be ${GUARD}, not something at index ${firstAwait}`,
  );
});

test("3. the guard is called exactly once and always awaited", () => {
  const body = fnBody(NOTIFICATIONS, BOUNDARY);
  assert.equal(
    body.split("requireAdmin(").length - 1,
    1,
    "exactly one guard call - no duplicated or partial gating",
  );
  assert.ok(
    !/(?<!await\s)requireAdmin\(\)/.test(body.replace(/await\s+requireAdmin\(\)/g, "")),
    "requireAdmin() must always be awaited, never fire-and-forget",
  );
});

test("4. an unauthorized caller reaches NO read, NO write and NO fan-out", () => {
  const body = fnBody(NOTIFICATIONS, BOUNDARY);
  const prefix = body.slice(0, body.indexOf(GUARD));
  for (const marker of [
    "prisma.",
    ".findMany(",
    ".findUnique(",
    ".createMany(",
    ".create(",
    ".update(",
    INTERNAL,
    "await ",
  ]) {
    assert.ok(
      !prefix.includes(marker),
      `"${marker}" must not appear before ${GUARD} (found in: ${prefix.trim()})`,
    );
  }
});

test("5. the guard is the canonical shared helper, not a local session/cookie/role check", () => {
  assert.ok(
    NOTIFICATIONS_RAW.includes('import { requireAdmin } from "@/lib/auth/require-admin";'),
    "must import requireAdmin from the canonical helper",
  );
  for (const marker of ["getServerSession", "next-auth", "adminEmail", "cookies("]) {
    assert.ok(!NOTIFICATIONS.includes(marker), `notifications.ts must not reimplement auth ("${marker}")`);
  }
  assert.ok(
    !/from\s+"@\/auth"/.test(NOTIFICATIONS) && !/from\s+"next\/headers"/.test(NOTIFICATIONS),
    "notifications.ts must not reach into the auth/session/cookie layer directly",
  );
});

test("6. no client-supplied admin identity and no role/name inference", () => {
  const body = fnBody(NOTIFICATIONS, BOUNDARY);
  const signature = NOTIFICATIONS.slice(
    NOTIFICATIONS.indexOf(`export async function ${BOUNDARY}(`),
    NOTIFICATIONS.indexOf("{", NOTIFICATIONS.indexOf(`export async function ${BOUNDARY}(`)),
  );
  for (const forbidden of ["adminId", "adminEmail", "actorId", "actor", "isAdmin", "role", "email"]) {
    assert.ok(
      !signature.includes(forbidden),
      `the params type must not accept "${forbidden}" - authority is server-derived only`,
    );
  }
  // Authority comes from requireAdmin() alone: nothing in the body compares a
  // name, email or role string to decide whether the caller may proceed.
  assert.ok(!/if\s*\(/.test(body), "the boundary must contain no conditional authorization logic");
});

// ===========================================================================
// 7-10. ARCHITECTURAL CONTAINMENT of the internal fan-out module
// ===========================================================================

test("7. the internal module carries NO 'use server' DIRECTIVE", () => {
  // A directive, not a mention: the module's own docstring legitimately explains
  // why it holds no directive, so a bare substring check would false-positive.
  assert.ok(
    !/^\s*["']use server["']\s*;?\s*$/m.test(FANOUT_RAW),
    "material-notification-fanout.ts must not declare 'use server'",
  );
  // Nor an inline per-function directive.
  assert.ok(!/["']use server["']/.test(FANOUT), "no inline 'use server' directive may appear in code");
  assert.ok(
    FANOUT.includes(`export async function ${INTERNAL}(`),
    `${INTERNAL} must be an exported async helper`,
  );
});

test("8. the internal module is a lib module and re-exports no Server Action", () => {
  const url = new URL("../course/capabilities/material-notification-fanout.ts", import.meta.url).pathname;
  assert.ok(url.includes("/lib/course/capabilities/"), "must live under lib/, never under app/");
  // A value re-export from a "use server" module would republish an endpoint
  // through this module. The only permitted edge to lib/actions is type-only.
  assert.ok(!/export\s*\*\s*from/.test(FANOUT), "no star re-export");
  assert.ok(!/export\s*\{[^}]*\}\s*from/.test(FANOUT), "no named re-export");
  // `[^;]*?` (not `[\s\S]*?`) so one import statement can never span into the
  // next: with a cross-statement wildcard the `(?!type\b)` lookahead is defeated
  // by any preceding value import and a genuine type-only edge reads as a value.
  const actionImports = [...FANOUT.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s*["'](@\/lib\/actions\/[^"']+)["']/gm)];
  assert.deepEqual(
    actionImports.map((m) => m[1]),
    [],
    "the internal module must not take a VALUE import from a 'use server' module",
  );
});

test("9. authorization is NOT duplicated inside the internal module", () => {
  for (const marker of ["requireAdmin", "getServerSession", "next-auth", "adminEmail", "cookies("]) {
    assert.ok(!FANOUT.includes(marker), `the fan-out must not perform its own auth ("${marker}")`);
  }
  assert.ok(
    !/from\s+"@\/auth"/.test(FANOUT) && !/from\s+"next\/headers"/.test(FANOUT),
    "the fan-out must not reach into the auth/session/cookie layer",
  );
});

test("10. the M3A recipient core is wired through EXACTLY ONE approved shell", () => {
  // M3B - INVERTED, NOT RELAXED. Through M3B-0 this asserted the pure recipient
  // core was entirely unwired. M3B is the slice that legitimately wires it, so
  // the tripwire now proves the SHAPE of that wiring instead of its absence:
  // exactly one IO shell may import the core, and neither the fan-out nor the
  // Server Action boundary may reach it any other way. A second importer - the
  // real risk, since it would be a second recipient-resolution path free to
  // drift - still fails here.
  //
  // Assembled from parts so this test file never itself contains the literal
  // module specifier, the capability key, or the audience-table identifiers -
  // each of which is policed by an exact-equality tripwire elsewhere.
  const CORE_MODULE = ["material-notification", "recipient-core"].join("-");
  const importMatcher = new RegExp(`from\\s*["'][^"']*${CORE_MODULE}["']`);
  assert.ok(!importMatcher.test(FANOUT_RAW), "the fan-out must reach the core only through the shell");
  assert.ok(!importMatcher.test(NOTIFICATIONS_RAW), "the boundary must not import the recipient core");

  // The one approved shell, and the fan-out's single edge to it.
  const SHELL_MODULE = ["material-notification", "trainee-recipients"].join("-");
  assert.ok(
    new RegExp(`from\\s*["'][^"']*${SHELL_MODULE}["']`).test(FANOUT_RAW),
    "the fan-out must delegate recipient resolution to the approved shell",
  );
  const shellRaw = readRaw(`../course/capabilities/${SHELL_MODULE}.ts`);
  assert.ok(importMatcher.test(shellRaw), "the approved shell must be the core's importer");

  // The capability key and the audience identifiers stay OUT of the fan-out:
  // both belong to the shell, which is where the scoping decision lives.
  const CAPABILITY_KEY = ["COURSE", "MATERIALS"].join("_");
  assert.ok(
    !new RegExp(`\\b${CAPABILITY_KEY}\\b`).test(FANOUT_RAW),
    "the fan-out enforces no capability itself - the key must not appear",
  );
  const AUDIENCE_MODEL = ["course", "material", "audience"].join("");
  const AUDIENCE_TABLE = ["course", "material", "audiences"].join("_");
  for (const [label, raw] of [
    ["fan-out", FANOUT_RAW],
    ["shell", shellRaw],
  ] as const) {
    const lowered = raw.toLowerCase();
    assert.ok(
      !lowered.includes(`prisma.${AUDIENCE_MODEL}`),
      `the ${label} must not access the audience model's Prisma delegate`,
    );
    assert.ok(!lowered.includes(AUDIENCE_TABLE), `the ${label} must not reference the audience table`);
  }
});

test("10b. the approved shell mints no endpoint and performs no authorization", () => {
  const SHELL_MODULE = ["material-notification", "trainee-recipients"].join("-");
  const shellRaw = readRaw(`../course/capabilities/${SHELL_MODULE}.ts`);
  const shellCode = stripComments(shellRaw);

  // Same containment the fan-out itself is held to (tests 7-9): the shell is a
  // lib module with no "use server" directive, so wiring the trainee branch
  // minted no new publicly dispatchable endpoint.
  assert.ok(
    !/^\s*["']use server["']\s*;?\s*$/m.test(shellRaw),
    "the shell must not declare 'use server'",
  );
  assert.ok(!/["']use server["']/.test(shellCode), "no inline 'use server' directive in code");
  for (const marker of ["requireAdmin", "getServerSession", "next-auth", "adminEmail", "cookies("]) {
    assert.ok(!shellCode.includes(marker), `the shell must not perform its own auth ("${marker}")`);
  }
  assert.ok(!/export\s*\*\s*from/.test(shellCode), "no star re-export");
  const actionImports = [
    ...shellCode.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s*["'](@\/lib\/actions\/[^"']+)["']/gm),
  ];
  assert.deepEqual(
    actionImports.map((m) => m[1]),
    [],
    "the shell must not take a VALUE import from a 'use server' module",
  );
});

// ===========================================================================
// 11-13. Behaviour preserved: the boundary delegates, the fan-out is unchanged
// ===========================================================================

test("11. the instructor RECIPIENT QUERY is unchanged; only its gate and body moved to the persisted row", () => {
  // M3B - the instructor recipient POPULATION RULE (every currently-active
  // instructor) is preserved exactly. What changed is mandated by the
  // authoritative-material correction: the branch is now gated on the PERSISTED
  // visibility and its body carries the PERSISTED title, so a forged caller
  // parameter can no longer select this audience or dictate its text.
  const body = fnBody(FANOUT, INTERNAL);
  for (const required of [
    'const notificationTitle = "נוסף חומר קורס חדש";',
    'material.visibility === "INSTRUCTORS" || material.visibility === "BOTH"',
    "prisma.instructor.findMany",
    "where: { isActive: true }",
    "prisma.notification.createMany",
    'type: "MATERIAL_ADDED" as const',
    'recipientRole: "INSTRUCTOR" as const',
    "instructorId: i.id",
    "relatedId: material.materialId",
    "title: notificationTitle",
    "body: material.title",
  ]) {
    assert.ok(body.includes(required), `the fan-out must preserve: ${required}`);
  }
  assert.ok(body.includes("instructors.length > 0"), "the empty-recipient short-circuit is preserved");

  // The caller's parameters must no longer drive ANY notification decision.
  for (const forbidden of ["params.visibility", "params.title"]) {
    assert.ok(
      !body.includes(forbidden),
      `${forbidden} must not be authoritative - the persisted row is`,
    );
  }
});

test("12. the trainee fan-out exists, is delegated, and widens through nothing", () => {
  // M3B - INVERTED, NOT DELETED. Through M3B-0 this asserted no trainee fan-out
  // existed at all (the branch was suppressed because the pre-M2B version was a
  // global query that leaked material titles across courses). M3B restores it
  // course-scoped, so the tripwire now proves the restored branch cannot widen:
  // no global student query, no client-supplied recipient list, and recipients
  // that arrive already resolved from the approved shell.
  const body = fnBody(FANOUT, INTERNAL);

  assert.ok(body.includes('recipientRole: "STUDENT" as const'), "the trainee branch must exist");
  assert.ok(
    body.includes("material.traineeRecipientIds"),
    "recipients must come from the authoritative snapshot",
  );
  assert.ok(body.includes("body: material.title"), "the trainee body is the PERSISTED title");
  assert.ok(
    body.includes("relatedId: material.materialId"),
    "the trainee relatedId is the PERSISTED material id",
  );

  // The widening vectors, each explicitly closed.
  assert.ok(!body.includes("prisma.student.findMany"), "no global student fan-out may return");
  assert.ok(!body.includes("prisma.courseEnrollment"), "the fan-out resolves no roster itself");
  assert.ok(!body.includes("params.title"), "no forged title reaches a trainee");
  assert.ok(!body.includes("params.visibility"), "no forged visibility selects the trainee audience");
  for (const forbidden of ["recipientIds:", "studentIds", "groupName", "subgroupNumber"]) {
    assert.ok(!body.includes(forbidden), `no client recipient list / scope inference (${forbidden})`);
  }

  // The Server Action boundary still creates nothing of its own.
  const boundary = fnBody(NOTIFICATIONS, BOUNDARY);
  assert.ok(!boundary.includes('recipientRole: "STUDENT"'), "boundary: no STUDENT notification");
  assert.ok(!boundary.includes("prisma."), "boundary: still no Prisma IO");
});

test("12b. the persisted material is re-read ONCE and refuses the whole fan-out when absent", () => {
  const body = fnBody(FANOUT, INTERNAL);

  // Exactly one authoritative read, shared by both branches.
  assert.equal(
    body.split("loadMaterialNotificationSnapshot(").length - 1,
    1,
    "the material must be read exactly once - never once per branch",
  );
  const read = body.indexOf("loadMaterialNotificationSnapshot(");
  const nullGuard = body.indexOf("if (material === null) return;");
  const activeGuard = body.indexOf("if (material.isActive !== true) return;");
  const firstWrite = body.indexOf("prisma.notification.createMany");

  assert.ok(read > -1, "the fan-out must re-read the persisted material");
  assert.ok(nullGuard > read, "an unknown material id must refuse the fan-out");
  assert.ok(activeGuard > nullGuard, "a hidden material must refuse the fan-out");
  assert.ok(
    firstWrite > activeGuard,
    "no notification of ANY kind may be written before both persisted guards",
  );
  // Fail-closed direction: the guards return, they do not fall back to params.
  assert.ok(
    !/material === null[\s\S]{0,120}params\./.test(body),
    "a missing material must not fall back to the caller's parameters",
  );
});

test("13. the boundary performs NO Prisma IO of its own - it authorizes and delegates", () => {
  const body = fnBody(NOTIFICATIONS, BOUNDARY);
  assert.ok(!body.includes("prisma."), "the wrapper must not touch Prisma directly");
  assert.ok(body.includes(`await ${INTERNAL}(params)`), "the wrapper must delegate to the internal fan-out");
  const guardIdx = body.indexOf(GUARD);
  const delegateIdx = body.indexOf(`await ${INTERNAL}(`);
  assert.ok(delegateIdx > guardIdx, "delegation must happen strictly after the guard");
});

// ===========================================================================
// 14-16. Caller wiring: both admin paths still authorize before any side effect
// ===========================================================================

test("14. createLinkMaterial still calls the GUARDED boundary, after the commit", () => {
  const body = fnBody(MATERIALS, "createLinkMaterial");
  assert.ok(body.includes("await requireAdmin();"), "its own pre-write admin gate must remain");
  const audiences = body.indexOf("applyMaterialAudiences(tx,");
  const notify = body.indexOf(BOUNDARY);
  assert.ok(notify > audiences, "the Server Action notifies through the boundary only after the tx body");
  assert.ok(
    !body.includes(INTERNAL),
    "the Server Action must NOT bypass the guarded boundary by calling the internal fan-out",
  );
});

test("15. the upload route calls the INTERNAL fan-out, after its admin check and after commit", () => {
  const adminCheck = ROUTE.indexOf("prisma.adminEmail.findUnique");
  const tx = ROUTE.indexOf("prisma.$transaction");
  const guard = ROUTE.indexOf("if (!existing) {");
  const notify = ROUTE.indexOf(`await ${INTERNAL}({`);
  assert.ok(adminCheck > -1, "the route's admin lookup must remain");
  assert.ok(notify > -1, "the route must call the internal fan-out");
  assert.ok(notify > adminCheck, "authorization precedes the fan-out");
  assert.ok(notify > tx, "the fan-out runs only after the material has committed");
  assert.ok(notify > guard, "the fan-out stays inside the brand-new-material branch");
  assert.ok(
    !ROUTE.includes(BOUNDARY),
    "the fetch()-invoked route must not call the redirecting Server Action boundary",
  );
});

test("16. the upload route keeps its JSON 401/403 contract and adds no redirecting guard", () => {
  assert.ok(ROUTE.includes("prisma.adminEmail.findUnique"), "route admin lookup preserved");
  assert.ok(ROUTE.includes("!adminEmail.isActive"), "inactive admin still rejected");
  assert.match(ROUTE, /error: "נדרשת התחברות" \}, \{ status: 401 \}/, "401 JSON preserved");
  assert.match(ROUTE, /error: "אין הרשאה לפעולה זו" \}, \{ status: 403 \}/, "403 JSON preserved");
  assert.ok(!ROUTE.includes("requireAdmin"), "the route must not gain a redirect-throwing guard");
  assert.ok(!ROUTE.includes("redirect("), "the route must never redirect - its client parses JSON");
  // The admin check still precedes every side effect on this path.
  const adminCheck = ROUTE.indexOf("prisma.adminEmail.findUnique");
  for (const sideEffect of [".upload(storagePath", "prisma.$transaction", "formData()"]) {
    assert.ok(
      ROUTE.indexOf(sideEffect) > adminCheck,
      `"${sideEffect}" must not run before the route's admin check`,
    );
  }
});

// ===========================================================================
// 17-18. No new endpoint was minted; no unrelated export changed
// ===========================================================================

test("17. the exported surface of the 'use server' module is exactly as before", () => {
  const exported = [...NOTIFICATIONS.matchAll(/export\s+(?:async\s+function|function|interface|const)\s+(\w+)/g)]
    .map((m) => m[1])
    .sort();
  // EXACT equality: a new async export in this module would mint a NEW public
  // Server Action endpoint, which is precisely the exposure class M3B-0 closes.
  assert.deepEqual(exported, [
    "NotificationRow",
    BOUNDARY,
    "getNotificationsForInstructor",
    "getNotificationsForStudent",
    "hasUnreadNotificationsForInstructor",
    "hasUnreadNotificationsForStudent",
    "markNotificationReadAsInstructor",
    "markNotificationReadAsStudent",
    "syncAttendanceMarkedNotification",
  ].sort());
});

test("18. the self-scoped trainee/instructor exports did NOT gain an admin gate", () => {
  // Admin-gating these would break /student and /instructor: they are recipient
  // self-reads whose authority is the SERVER-DERIVED actor, not an admin.
  const SELF_SCOPED = [
    "getNotificationsForStudent",
    "getNotificationsForInstructor",
    "hasUnreadNotificationsForStudent",
    "hasUnreadNotificationsForInstructor",
    "markNotificationReadAsStudent",
    "markNotificationReadAsInstructor",
  ];
  for (const name of SELF_SCOPED) {
    const body = fnBody(NOTIFICATIONS, name);
    assert.ok(!body.includes("requireAdmin"), `${name} must NOT be admin-gated`);
    assert.ok(
      body.includes("getCurrentTrainee()") || body.includes("getCurrentInstructor()"),
      `${name} must still derive its actor from the session`,
    );
  }
  // The attendance sync is deliberately OUT OF SCOPE for M3B-0 (it carries the
  // same exposure class and is recorded as a separate security backlog item);
  // this slice must not have altered it in either direction.
  const attendance = fnBody(NOTIFICATIONS, "syncAttendanceMarkedNotification");
  assert.ok(!attendance.includes("requireAdmin"), "syncAttendanceMarkedNotification is untouched by M3B-0");
  assert.ok(attendance.includes('type: "ATTENDANCE_MARKED"'), "its behaviour is unchanged");
});
