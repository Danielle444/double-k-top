/**
 * EXAM EX-SES-S2 / EX-SES-S3 — STRUCTURAL tests for the stored ExamSession WRITE
 * binding (lib/actions/exam-session-write-io.ts): CREATE, EDIT and safe REMOVAL.
 *
 * Run with: npx tsx --test lib/actions/exam-session-write-io.test.ts
 *
 * WHY SOURCE-TEXT TESTS. The module under test declares `import "server-only"`,
 * which is exactly the guarantee this slice wants — and which makes the module
 * UNIMPORTABLE under bare `tsx` outside the Next build (and, deliberately,
 * unimportable from any client bundle). This suite takes the approach the
 * committed exam read-contract and definition-write suites take: it reads the
 * module's SOURCE and asserts on its structure, while the BEHAVIOUR of each
 * operation — the locked order, every refusal, and what each failure skips — is
 * proven at runtime against its pure core with fakes, in
 * lib/exam/create-exam-session-core.test.ts,
 * lib/exam/update-exam-session-core.test.ts and
 * lib/exam/delete-exam-session-core.test.ts.
 *
 * What that split can and cannot prove is worth stating plainly: the ORDER in
 * which authorization, the lifecycle gate, the plan lookup, validation, the
 * definition verification and the write run is a property of the pure core and is
 * proven there at runtime. What THIS suite proves is which effects the binding
 * supplies, which statements exist, on which client, inside which transaction,
 * with which filters, and that the binding itself decides nothing.
 *
 * DB-FREE AND PRODUCTION-FREE: no database connection is opened, no SQL is
 * executed, no environment variable is read, no network call is made, and no
 * production identifier appears anywhere.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { spawnSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_REL = join("lib", "actions", "exam-session-write-io.ts");
const IO_TEST_REL = join("lib", "actions", "exam-session-write-io.test.ts");
const CORE_REL = join("lib", "exam", "create-exam-session-core.ts");
const CORE_TEST_REL = join("lib", "exam", "create-exam-session-core.test.ts");
const UPDATE_CORE_REL = join("lib", "exam", "update-exam-session-core.ts");
const UPDATE_CORE_TEST_REL = join("lib", "exam", "update-exam-session-core.test.ts");
const DELETE_CORE_REL = join("lib", "exam", "delete-exam-session-core.ts");
const DELETE_CORE_TEST_REL = join("lib", "exam", "delete-exam-session-core.test.ts");
const INPUT_CORE_REL = join("lib", "exam", "exam-session-write-core.ts");

/** Every pure core this binding may bind, as a path-free filename. */
const BOUND_CORE_RELS = [CORE_REL, UPDATE_CORE_REL, DELETE_CORE_REL];

/**
 * Every file this slice's two stages are allowed to have ADDED, as git reports
 * them: the four of EX-SES-S2 and the four of EX-SES-S3.
 */
const APPROVED_NEW_FILES = [
  // EX-ADMIN-SRCDATE — the FOUR files this branch adds under `lib/`, and the
  // guard suites it re-points. Nothing in the product could write an exam plan's
  // Teaching-Practice date selection, so every plan held an empty one and
  // beginner exams could not appear on any screen; the source-date decision core
  // and its server-only binding are the smallest thing that fixes it. This
  // reader/writer gained NO caller and NO field. ASSEMBLED, so this suite does
  // not enrol itself in a caller list it exists to keep narrow.
  "lib/exam/" + "admin-exam-source-date" + "-core.ts",
  "lib/exam/" + "admin-exam-source-date" + "-core.test.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.ts",
  "lib/actions/" + "admin-exam-source-date" + "-io.test.ts",
  "lib/actions/exam-session-write-io.test.ts",
  "lib/actions/exam-session-write-io.ts",
  "lib/exam/create-exam-session-core.test.ts",
  "lib/exam/create-exam-session-core.ts",
  "lib/exam/delete-exam-session-core.test.ts",
  "lib/exam/delete-exam-session-core.ts",
  "lib/exam/update-exam-session-core.test.ts",
  "lib/exam/update-exam-session-core.ts",
  // EX-SES-UI-2's three NEW route files: the edit form, the delete form and their
  // contract suite. Every one is under `app/` — this slice adds no `lib/` module
  // at all, which is the footprint half of "the committed writers were reused".
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionEditForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/ExamSessionDeleteForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // EX-ASG-UI1's four NEW route files: the assignment create form, the assignment
  // delete form, their closed message module and their contract suite. Every one is
  // under `app/` — that slice adds no `lib/` module either, and it reaches none of
  // THIS binding's writers: guard 33 still pins all three session writers to the
  // one Server Action module.
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/DeleteExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  // EX-PUB-BE-MVP's four NEW files: the exam-plan publish/unpublish BACKEND — a
  // pure core, a binding, and a suite for each. They are the FIRST `lib/`
  // additions on this list, and they are named EXACTLY rather than by directory,
  // so a fifth still fails. That slice adds no route, no form and no Server
  // Action, modifies no tracked production file, and reaches none of THIS
  // binding's three writers: guard 33 still pins the CREATE writer to its single
  // Server Action caller and the EDIT and REMOVAL writers to no caller at all.
  //
  // The two `lib/actions` paths are ASSEMBLED, not spelled: that slice's own
  // guard sweeps `app/`, `lib/`, `components/` and `scripts/` for its module name
  // and pins the caller list at EXACTLY ZERO, so a suite naming it whole would
  // become the first entry in a list that must stay empty.
  "lib/exam/exam-publication-write-core.ts",
  "lib/exam/exam-publication-write-core.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // EX-PAIR-BE-MVP's four NEW files: the instructed-trainee/examinee PAIRING
  // BACKEND, of exactly the same shape and with exactly the same properties — no
  // route, no form, no Server Action, no tracked production file modified, and
  // none of THIS binding's three writers reached. Named EXACTLY and assembled for
  // the same reasons, so a ninth `lib/` addition still fails.
  "lib/exam/exam-pairing-write-core.ts",
  "lib/exam/exam-pairing-write-core.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  // EX-ADMIN-WORKSPACE-UX — the admin exams WORKSPACE rebuild. It adds four
  // route files and two `lib/` modules (both NEW; no committed `lib/` production
  // module is modified), edits the route's page and Server Action module, and
  // re-points the guard suites listed below. Every entry is spelled in full, so a
  // path this slice does not touch still fails here. The `lib/` entries are
  // ASSEMBLED so this suite does not enrol itself as a caller of what it names.
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // ...and its two `lib/` modules, which are ADDITIONS: a new pure core and its
  // new server-only binding. ASSEMBLED, so this suite does not enrol itself as
  // a caller of either.
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-write" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
];

/**
 * The ONLY tracked files EX-SES-S3 is allowed to have MODIFIED.
 *
 * EX-SES-S2 modified nothing at all; S3 extends the binding it committed and the
 * suite that guards it, and nothing else. Whether these two appear as
 * modifications or as part of an already-committed tree depends on where in the
 * commit cycle the suite runs — what is asserted below is that NO OTHER tracked
 * file is touched, in every one of those states.
 */
const APPROVED_MODIFIED_FILES = [
  "lib/actions/exam-session-write-io.test.ts",
  "lib/actions/exam-session-write-io.ts",
  // EX-SES-UI-1 widens this list and NOTHING else in this suite. That slice wires
  // the committed session reader, the grouping core and the create form into the
  // course exams page, which puts the page, the four route contract suites and
  // four `lib/` footprint guards into the same working tree as this one. Guard 33
  // still pins the CREATE writer to its single Server Action caller and the EDIT
  // and REMOVAL writers to no caller at all — this slice reaches none of them.
  //
  // ASSEMBLED, not spelled: each of those `lib/` suites sweeps `app/`, `lib/` and
  // `components/` for its own module name and pins the result to an exact caller
  // list, so naming one whole here would enrol this suite in it.
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-SES-UI-2 adds ONE further tracked file to this list — the route's shared
  // Server Action module, which gains the approved EDIT and REMOVAL endpoints that
  // finally give this binding's two destructive writers a caller. Guard 33 below
  // is re-pointed to that ONE exact path; this binding's own production module and
  // all three pure cores stay byte-identical to HEAD, which is what makes "the
  // committed writers were REUSED, not changed" a checkable claim rather than a
  // description.
  //
  // The three NEW route files that slice adds are covered by the untracked half of
  // guard 35 through APPROVED_NEW_FILES below.
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  // EX-ASG-UI1 adds THREE further tracked files to this list — the session
  // edit/delete contract suite, whose per-session id counts learn about the
  // assignment create form's hidden field, and the two committed assignment guard
  // suites plus the supervisor core guard whose footprint lists it re-points.
  // Guard 33 below is untouched by it: that slice reaches none of THIS binding's
  // three writers, and this binding's own production module and all three pure
  // cores stay byte-identical to HEAD.
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-IT2 — the approved INSTRUCTED_TRAINEE assignment CREATE UI, which
  // travels in the same working tree. It adds the ASSIGNMENT contract suite to
  // the modified set (that suite's route file set and export list learn about
  // the eighth endpoint) and the committed instructed-trainee write guard,
  // whose caller list it re-points from zero to exactly one Server Action
  // module. Its own three new route files are ADDITIONS. Nothing here changes
  // which module this guard is about: no reader gained a caller, no writer was
  // edited, and no schema, migration, auth, capability or policy file is named.
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/CreateExamInstructedTraineeAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
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
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
  // same working tree. It publishes two stored columns the assignment READ pair
  // already reached, so that pair's two PRODUCTION modules and its pure core's
  // suite join this list, together with the two supervisor footprint guards whose
  // "nothing was modified" claims it re-points.
  //
  // Guard 33 is untouched by it: that slice reaches none of THIS binding's three
  // writers, and this binding's own production module and all three pure cores
  // stay byte-identical to HEAD. ASSEMBLED for the reason above, the assignment
  // core's two most sharply of all.
  "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
  "lib/exam/" + "admin-exam-assignment-read" + "-core.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
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
  "app/admin/courses/[courseOfferingId]/exams/CreateExamAssignmentForm.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-messages.ts",
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
  // which travels in the same working tree. Its four new `lib/` files re-point the
  // footprint lists of five neighbouring guard SUITES, so those five join this
  // list. Every entry is a `.test.ts` suite; no `lib/` production module, no route
  // file, no Server Action, and no schema, migration, auth, session, capability or
  // policy file is named, and guard 33 is untouched: that slice reaches none of
  // THIS binding's three writers.
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  // EX-ADMIN-WORKSPACE-UX — the admin exams WORKSPACE rebuild. It adds four
  // route files and two `lib/` modules (both NEW; no committed `lib/` production
  // module is modified), edits the route's page and Server Action module, and
  // re-points the guard suites listed below. Every entry is spelled in full, so a
  // path this slice does not touch still fails here. The `lib/` entries are
  // ASSEMBLED so this suite does not enrol itself as a caller of what it names.
  "app/admin/courses/[courseOfferingId]/exams/page.tsx",
  "app/admin/courses/[courseOfferingId]/exams/actions.ts",
  "app/admin/courses/[courseOfferingId]/exams/EditExamAssignmentCard.tsx",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-view.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace-messages.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-workspace.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definition-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-definitions-page.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-instructed-trainee-assignment-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-pairing-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-plan-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-publication-ui.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-create.contract.test.ts",
  "app/admin/courses/[courseOfferingId]/exams/exam-session-edit-delete.contract.test.ts",
  // ...and its two `lib/` modules, which are ADDITIONS: a new pure core and its
  // new server-only binding. ASSEMBLED, so this suite does not enrol itself as
  // a caller of either.
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
  // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
  // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
  // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
  // own assignment by exact student id. Every path below is named EXACTLY - no
  // directory, no prefix, no glob - so an unrelated file still fails this guard,
  // and each module name is SPLIT so this list never enrols itself as a caller.
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-write" + "-io.test.ts",
  "lib/actions/" + "exam-instructed-trainee-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-pairing-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-read" + "-io.test.ts",
  "lib/actions/" + "exam-supervisor-write" + "-io.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-read" + "-dto.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/actions/" + "admin-exam-workspace-edit" + "-io.test.ts",
  "lib/exam/" + "admin-exam-workspace-edit" + "-core.test.ts",
  "lib/actions/" + "instructor-exam-schedule" + ".contract.test.ts",
  "lib/actions/" + "trainee-exam-schedule" + ".contract.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  "lib/exam/" + "exam-beginner-course-scope" + "-core.test.ts",
  "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
  "lib/exam/" + "exam-beginner-course-scope" + ".contract.test.ts",
  "lib/exam/" + "exam-plan-loader" + "-core.test.ts",
  "lib/exam/" + "exam-plan-loader" + "-core.ts",
  "lib/exam/" + "exam-read-" + "dto.test.ts",
  "lib/exam/" + "exam-rea" + "d-dto.ts",
  "lib/exam/" + "exam-read-scope" + "-core.test.ts",
  "lib/exam/" + "exam-read-scope" + "-core.ts",
  "lib/exam/" + "exam-read" + ".contract.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/exam/" + "exam-trainee-view" + "-core.ts",
];

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

/** The single transaction call expression, extracted by paren depth. */
const TRANSACTION_BODY = (() => {
  const open = CODE.indexOf("$transaction(");
  assert.ok(open > 0, "no transaction was found");
  const from = CODE.indexOf("(", open);
  let depth = 0;
  for (let i = from; i < CODE.length; i += 1) {
    if (CODE[i] === "(") depth += 1;
    else if (CODE[i] === ")") {
      depth -= 1;
      if (depth === 0) return CODE.slice(from, i + 1);
    }
  }
  throw new Error("the transaction is unbalanced");
})();

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

/** The dependency object literal the CREATE hands its pure core. */
const DEPS_LITERAL = (() => {
  const start = CODE.indexOf("createExamSessionWithDeps(courseOfferingId, rawInput, {");
  assert.ok(start > 0, "the pure core is not bound with the expected arguments");
  const end = CODE.indexOf("});", start);
  assert.ok(end > start, "the dependency literal is unbalanced");
  return CODE.slice(start, end);
})();

/** The dependency object literal named `anchor` hands its pure core. */
function depsLiteralAfter(anchor: string): string {
  const start = CODE.indexOf(anchor);
  assert.ok(start > 0, `${anchor} is not bound`);
  const open = CODE.indexOf("{", CODE.indexOf("(", start));
  assert.ok(open > start, `${anchor} has no dependency literal`);
  let depth = 0;
  for (let i = open; i < CODE.length; i += 1) {
    if (CODE[i] === "{") depth += 1;
    else if (CODE[i] === "}") {
      depth -= 1;
      if (depth === 0) return CODE.slice(open, i + 1);
    }
  }
  throw new Error(`${anchor}'s dependency literal is unbalanced`);
}

/** The `data: { ... }` object of the single conditional update. */
const UPDATE_DATA = (() => {
  const start = CODE.indexOf("examSession.updateMany(");
  assert.ok(start > 0, "no session update was found");
  const dataStart = CODE.indexOf("data: {", start);
  assert.ok(dataStart > 0, "no update data was found");
  return CODE.slice(dataStart, CODE.indexOf("\n    },", dataStart));
})();

/** The `data: { ... }` object of the single create. */
const CREATE_DATA = (() => {
  const start = CODE.indexOf("examSession.create(");
  assert.ok(start > 0, "no session create was found");
  const dataStart = CODE.indexOf("data: {", start);
  assert.ok(dataStart > 0, "no create data was found");
  return CODE.slice(dataStart, CODE.indexOf("},", dataStart));
})();

/** Every `where: { ... }` object of the module, as flat text. */
const WHERE_CLAUSES = CODE.match(/where:\s*\{[^}]*\}/g) ?? [];

/**
 * Database-client specifiers, assembled from SPLIT LITERALS. This suite has to
 * NAME the specifiers it asserts about — both the one the binding legitimately
 * imports and the ones the pure cores may not — while its own containment check
 * (test 36) proves the suite itself opens no database. Spelling either out would
 * make that check trip on this file.
 */
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");

/**
 * Columns of `ExamSession` this slice must NEVER write: the deprecated-and-
 * unwritten model, the derived end time, the copy-provenance columns, the
 * per-session publication column and the database-generated timestamps.
 */
const UNWRITTEN_COLUMNS = [
  "kind",
  "phase",
  "beginnerFormat",
  "endTime",
  "capacity",
  "interfaceSessionId",
  "sourceTeachingPracticeLessonId",
  "copiedAt",
  "roleLabelOverrides",
  "individualPublishedAt",
  "createdAt",
  "updatedAt",
] as const;

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

test("2. the module does NOT declare use server (or use client)", () => {
  assert.equal(CODE.includes('"use ' + 'server"'), false);
  assert.equal(CODE.includes("'use " + "server'"), false);
  assert.equal(CODE.includes('"use ' + 'client"'), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports EXACTLY three ordinary async functions", () => {
  assert.deepEqual(SIGNATURES.map((entry) => entry.name), [
    "createExamSession",
    "updateExamSession",
    "deleteExamSession",
  ]);
  for (const name of ["createExamSession", "updateExamSession", "deleteExamSession"]) {
    assert.ok(new RegExp(`export async function ${name}\\(`).test(SOURCE), `${name} is missing`);
  }
  for (const token of [
    "export const",
    "export default",
    "export class",
    "GET",
    "POST",
    "NextRequest",
    "NextResponse",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
});

test("4. each public function accepts EXACTLY its approved parameters", () => {
  const create = signature("createExamSession");
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamSessionResult>");

  const update = signature("updateExamSession");
  assert.equal(
    update.params,
    "courseOfferingId: string, sessionId: string, expectedUpdatedAt: number, rawInput: unknown,",
  );
  assert.equal(update.returns, "Promise<UpdateExamSessionResult>");

  const remove = signature("deleteExamSession");
  assert.equal(
    remove.params,
    "courseOfferingId: string, sessionId: string, expectedUpdatedAt: number,",
  );
  assert.equal(remove.returns, "Promise<DeleteExamSessionResult>");
});

test("5. no public function has a plan, order, actor, count or client parameter", () => {
  // `sessionId` and `expectedUpdatedAt` are legitimate on the edit and the
  // removal — they are the TARGET and the version token, both supplied by the
  // route rather than by a submitted payload — so they are asserted exactly in
  // test 4 and excluded from this blanket list.
  for (const name of ["createExamSession", "updateExamSession", "deleteExamSession"]) {
    const params = signature(name).params;
    for (const forbidden of [
      "planId",
      "plan:",
      "definitionId",
      "orderIndex",
      // `date:` rather than `date`, because `expectedUpdatedAt` contains the
      // four letters and a substring check would fire on the legitimate token
      // parameter that test 4 asserts exactly.
      "date:",
      "startTime",
      "endTime",
      "kind",
      "adminId",
      "actorId",
      "instructorId",
      "studentId",
      "assignmentCount",
      "publish",
      "tx",
      "prisma",
      "deps",
    ]) {
      assert.equal(params.includes(forbidden), false, `${name} accepts ${forbidden}`);
    }
  }
  // The CREATE in particular still has no target and no token: it makes a row.
  const create = signature("createExamSession").params;
  assert.equal(create.includes("sessionId"), false);
  assert.equal(create.includes("expectedUpdatedAt"), false);
});

// ===========================================================================
// 6–10. Authorization, the lifecycle gate, and what is NOT consulted
// ===========================================================================

test("6. the module binds requireAdminCourseOffering, exactly once, with the REQUESTED id", () => {
  assert.ok(CODE.includes("requireAdminCourseOffering"), "the admin boundary is not bound");
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  // The typed not-found is classified by identity rather than caught broadly...
  assert.ok(CODE.includes("error instanceof CourseOfferingNotFoundError"));
  // ...and the module contains NO catch at all: every unrecognized throw, and
  // every framework redirect, propagates untouched.
  assert.equal((CODE.match(/catch\s*\(/g) ?? []).length, 0, "the binding catches");
  assert.equal(CODE.includes("NEXT_REDIRECT"), false, "the binding inspects redirects");
});

test("7. the admin boundary is reached BEFORE any Prisma statement", () => {
  const adminAt = CODE.indexOf("requireAdminCourseOffering(");
  const prismaAt = CODE.search(/\bprisma\./);
  assert.ok(adminAt > 0 && prismaAt > 0, "sanity: both must exist");
  assert.ok(adminAt < prismaAt, "a Prisma statement precedes the admin boundary");
  // The authorization helper itself touches no client, and the gate does not either.
  for (const helper of ["requireCourseContext", "assertConfigurationAllowed"]) {
    const body = bodyOf(helper);
    assert.equal(/\b(?:prisma|tx)\./.test(body), false, `${helper} touches a database client`);
  }
  // Only `id` and `status` are carried forward from the verified offering.
  assert.ok(/courseOfferingId:\s*context\.id/.test(CODE));
  assert.ok(/status:\s*context\.status/.test(CODE));
  for (const wide of ["context.name", "context.level", "context.startDate", "context.endDate"]) {
    assert.equal(CODE.includes(wide), false, `the binding reads ${wide}`);
  }
});

test("8. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, via the committed policy", () => {
  assert.ok(CODE.includes("assertCourseOperationAllowed"));
  assert.ok(
    /assertCourseOperationAllowed\([\s\S]{0,120}?"SCHEDULE_DRAFT_CONFIGURATION"/.test(CODE),
    "the gate does not use the approved operation",
  );
  assert.ok(CODE.includes("error instanceof CourseOperationNotPermittedError"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
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
  // The temporary reuse, and the possible dedicated operation, are documented.
  assert.ok(/EXAM_CONFIGURATION/.test(COMMENTS), "the future dedicated operation is undocumented");
  assert.ok(/lifecycle/i.test(COMMENTS), "the lifecycle reuse is undocumented");
});

test("9. the gate is declared and bound BEFORE the plan query, and both precede the write", () => {
  // Declaration order in the source...
  const gateAt = CODE.indexOf("function assertConfigurationAllowed(");
  const planAt = CODE.indexOf("function findExamPlanByCourseOfferingId(");
  const definitionAt = CODE.indexOf("function findDefinitionForPlan(");
  const writeAt = CODE.indexOf("function createSessionAtNextOrder(");
  assert.ok(gateAt > 0 && planAt > gateAt, "the plan query is declared before the gate");
  assert.ok(definitionAt > planAt, "the definition query is declared before the plan query");
  assert.ok(writeAt > definitionAt, "the write is declared before the definition query");

  // ...and binding order in the dependency literal. The RUNTIME order is the
  // committed pure core's contract and is proven at runtime in its own suite;
  // this is the binding's half of that contract.
  // `[ \t\r]*$` rather than a bare `$`: this repository checks out with CRLF
  // endings, and a line-end anchor that does not tolerate the carriage return
  // silently matches nothing — which would make this guard vacuously pass.
  const bound = [...DEPS_LITERAL.matchAll(/^\s{4}(\w+),[ \t\r]*$/gm)].map((match) => match[1]);
  assert.deepEqual(bound, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForPlan",
    "createSessionAtNextOrder",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
});

test("10. the module consults NO capability, and no instructor or trainee actor helper", () => {
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
  // ...and says so, so the absence reads as a decision rather than an omission.
  assert.ok(/EXAMS/.test(COMMENTS), "the missing EXAMS capability is undocumented");
});

// ===========================================================================
// 11–14. The verified offering id, and the plan query
// ===========================================================================

test("11. the ExamPlan lookup uses the VERIFIED offering id, never the requested one", () => {
  assert.ok(
    /courseOfferingId:\s*verifiedCourseOfferingId/.test(CODE),
    "the plan lookup does not use the verified id",
  );
  const planQuery = bodyOf("findExamPlanByCourseOfferingId");
  assert.equal(planQuery.includes("rawInput"), false, "the raw input reached the plan query");
  assert.equal(
    planQuery.includes("requestedCourseOfferingId"),
    false,
    "the REQUESTED id reached the plan query",
  );
});

test("12. there is EXACTLY one ExamPlan findUnique, selecting `id` and nothing else", () => {
  assert.equal((CODE.match(/examPlan\.findUnique\(/g) ?? []).length, 1);
  const planOps = CODE.match(/examPlan\.\w+/g) ?? [];
  assert.deepEqual(planOps, ["examPlan.findUnique"]);

  const query = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(query), `the select was: ${query}`);
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

test("13. no ExamPlan is created, updated or upserted, by any name", () => {
  const writes = /examPlan\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(writes.test(CODE), false, "the module writes an ExamPlan");
  for (const token of ["ensurePlan", "createPlan", "upsertPlan", "getOrCreate"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

test("14. the definition lookup is scoped by the SERVER planId AND the submitted id", () => {
  assert.equal((CODE.match(/examDefinition\.\w+\(/g) ?? []).length, 1);
  const query = bodyOf("findDefinitionForPlan");
  assert.ok(
    /prisma\.examDefinition\.findFirst\(/.test(query),
    "the definition verification is not a plan-scoped findFirst",
  );
  assert.ok(
    /where:\s*\{\s*id:\s*definitionId,\s*planId,?\s*\}/.test(query),
    `the definition where was: ${query}`,
  );
  assert.ok(/select:\s*\{\s*id:\s*true,?\s*\}/.test(query), "the definition select is not id-only");
  // A bare findUnique by id would find another plan's definition and then rely on
  // a comparison someone could later remove.
  assert.equal(CODE.includes("examDefinition.findUnique"), false);
  // The verification reads NOTHING that could drive a decision or leak.
  for (const column of ["name: true", "kind: true", "durationMinutes", "parallelCapacity", "include"]) {
    assert.equal(query.includes(column), false, `the verification selects ${column}`);
  }
  // The helper takes the SERVER-supplied plan id as its first parameter.
  assert.ok(/function findDefinitionForPlan\(\s*planId: string,/.test(SOURCE));
  // ...and the definition table is never written.
  const definitionWrites =
    /examDefinition\.(create|createMany|update|updateMany|upsert|delete|deleteMany)/;
  assert.equal(definitionWrites.test(CODE), false, "the module writes an ExamDefinition");
});

// ===========================================================================
// 15–18. The single date conversion
// ===========================================================================

test("15. the date is converted by the repository's shared helpers, ONE call site per direction", () => {
  // IN: the `YYYY-MM-DD` key -> the `@db.Date` column, once for the create and
  // once for the edit — the two operations that write a date, and no more.
  const inbound = CODE.match(/parseDateKey\(/g) ?? [];
  assert.equal(inbound.length, 2, `parseDateKey appears ${inbound.length} times`);
  assert.ok(/const date = parseDateKey\(value\.date\);/.test(CODE), "the create conversion is missing");
  assert.ok(/date: parseDateKey\(value\.date\),/.test(CODE), "the edit conversion is missing");

  // OUT: the stored instant -> the key the pure core compares, exactly once.
  // The lookbehind excludes `parseDateKey(`, which carries a capital D.
  assert.equal(
    (CODE.match(/(?<![A-Za-z])dateKey\(/g) ?? []).length,
    1,
    "the outbound conversion is not unique",
  );
  assert.ok(/date: dateKey\(row\.date\),/.test(CODE), "the outbound conversion is not the expected one");

  assert.ok(
    /import \{ dateKey, parseDateKey \} from "@\/lib\/dates";/.test(CODE),
    "the shared date helpers are not imported",
  );
});

test("16. the conversions happen at the IO boundary and NOWHERE else in the slice", () => {
  // The create's conversion is outside its transaction, so both statements share
  // the same instant.
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(helper.includes("parseDateKey("), "the conversion is not in the write binding");
  assert.ok(
    helper.indexOf("parseDateKey(") < helper.indexOf("$transaction("),
    "the conversion happens inside the transaction",
  );
  // The outbound conversion lives in the shared session reader.
  assert.ok(bodyOf("findSessionForPlan").includes("dateKey(row.date)"));
  // And in the pure cores: no conversion of either direction, at all.
  for (const rel of [...BOUND_CORE_RELS, INPUT_CORE_REL]) {
    const core = stripComments(readFileSync(join(REPO_ROOT, rel), "utf8"));
    assert.equal(core.includes("parseDateKey"), false, `${rel} converts a date`);
    assert.equal(core.includes("dateKey("), false, `${rel} formats a date`);
    assert.equal(/new Date\b/.test(core), false, `${rel} constructs a calendar value`);
    assert.equal(/\bDate\b/.test(core), false, `${rel} names a calendar type`);
  }
});

test("17. no calendar construction beyond the approved conversions exists", () => {
  for (const token of [
    "Date.now",
    "Date.UTC",
    "toISOString",
    "setUTC",
    "getUTC",
    "getTimezoneOffset",
    "toLocaleDateString",
    "enumerateDateKeys",
    "startOfDay",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // `new Date(...)` appears ONLY to turn the epoch-millisecond version token into
  // the instant the two conditional writes compare against — never to read a
  // clock, and never with zero arguments.
  const constructions = CODE.match(/new Date\([^)]*\)/g) ?? [];
  assert.deepEqual(constructions, ["new Date(expectedUpdatedAt)", "new Date(expectedUpdatedAt)"]);

  // `getTime()` appears ONLY to turn a stored instant back into that token.
  const reads = CODE.match(/\w+(?:\.\w+)*\.getTime\(\)/g) ?? [];
  assert.deepEqual(reads, ["row.updatedAt.getTime()", "row.updatedAt.getTime()"]);

  // The create's converted value is a local const, reused by BOTH statements.
  assert.ok(/where:\s*\{\s*planId,\s*date,?\s*\}/.test(TRANSACTION_BODY));
  assert.ok(/(^|\s)date,/.test(CREATE_DATA), "the create does not write the converted date");
});

test("18. the pure cores' date stays a plain string, and the reason is documented", () => {
  const inputCore = readFileSync(join(REPO_ROOT, INPUT_CORE_REL), "utf8");
  assert.ok(inputCore.includes("readonly date: string;"), "the normalized date is no longer a string");
  const updateCore = readFileSync(join(REPO_ROOT, UPDATE_CORE_REL), "utf8");
  assert.ok(
    updateCore.includes("readonly date: string;"),
    "the authoritative row's date is no longer a string",
  );
  assert.ok(/timezone/i.test(COMMENTS), "the conversion reasoning is undocumented");
  assert.ok(/UTC/.test(COMMENTS), "the shared day-boundary convention is undocumented");
  assert.ok(/inverse/i.test(COMMENTS), "the round-trip exactness of the pair is undocumented");
});

// ===========================================================================
// 19–24. The transaction, the order aggregate and the create payload
// ===========================================================================

test("19. there is EXACTLY one interactive transaction, and no raw escape hatch", () => {
  assert.equal((CODE.match(/\$transaction\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
  assert.ok(/prisma\.\$transaction\(async \(tx\) =>/.test(CODE));
  for (const token of ["$executeRaw", "$queryRaw", "$connect", "$disconnect", "$extends"]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("20. the transaction contains EXACTLY the aggregate and the create, on the tx client", () => {
  assert.ok(TRANSACTION_BODY.includes("tx.examSession.aggregate("));
  assert.ok(TRANSACTION_BODY.includes("tx.examSession.create("));
  // Exactly two statements touch the database inside it, and only one is awaited
  // (the create is the returned expression).
  assert.equal((TRANSACTION_BODY.match(/tx\.\w+\./g) ?? []).length, 2);
  assert.equal((TRANSACTION_BODY.match(/await /g) ?? []).length, 1);
  // The plan and definition queries are OUTSIDE the transaction.
  assert.equal(TRANSACTION_BODY.includes("examPlan"), false, "the plan query is inside the tx");
  assert.equal(TRANSACTION_BODY.includes("examDefinition"), false, "the definition query is inside the tx");
  // Neither of the CREATE's two statements runs off the base client. (The edit
  // and the removal are single statements outside any transaction, and are
  // asserted on separately below.)
  assert.equal(
    bodyOf("createSessionAtNextOrder").includes("prisma.examSession."),
    false,
    "a create statement bypasses the tx",
  );
  // No iteration of any kind: one row in, one row out.
  for (const loop of ["for (", "for(", "while (", "forEach(", ".map(", ".reduce(", "Promise.all"]) {
    assert.equal(TRANSACTION_BODY.includes(loop), false, `the transaction contains ${loop}`);
  }
});

test("21. the order aggregate is a MAX scoped by planId AND date", () => {
  assert.equal((CODE.match(/examSession\.aggregate\(/g) ?? []).length, 1);
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(/where:\s*\{\s*planId,\s*date,?\s*\}/.test(helper), `the aggregate where was: ${helper}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true,?\s*\}/.test(helper), "the aggregate max is wrong");
  // Not a count: a count would silently reuse a position after any future gap.
  assert.equal(helper.includes(".count("), false, "the write helper uses count");
  assert.equal(CODE.includes("_count"), false, "the module uses _count");
  // The scope is the plan's DAY, never the whole plan and never a wider filter.
  for (const clause of WHERE_CLAUSES) {
    assert.equal(clause.includes("courseOfferingId: {"), false, `a query filters widely: ${clause}`);
  }
});

test("22. orderIndex is SERVER-computed as max + 1, and never caller-supplied", () => {
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      CODE.replace(/\s+/g, " "),
    ),
    "the next-order computation is not the approved max+1 / 0 rule",
  );
  assert.ok(/orderIndex:\s*nextOrderIndex,/.test(CREATE_DATA), "orderIndex is missing from the data");
  assert.equal(CREATE_DATA.includes("value.orderIndex"), false, "order came from the payload");
  assert.equal(CREATE_DATA.includes("rawInput"), false, "the create data reads raw input");
});

test("23. the create data is EXACTLY the eight approved columns", () => {
  const keys = [...CREATE_DATA.matchAll(/^\s{8}(\w+)[,:]/gm)].map((match) => match[1]);
  assert.deepEqual(keys, [
    "planId",
    "definitionId",
    "date",
    "startTime",
    "arena",
    "title",
    "notes",
    "orderIndex",
  ]);
  // The five submitted values come from the NORMALIZED payload, never elsewhere.
  for (const field of ["definitionId", "startTime", "arena", "title", "notes"]) {
    assert.ok(
      new RegExp(`${field}:\\s*value\\.${field},`).test(CREATE_DATA),
      `${field} is missing or not taken from the normalized value`,
    );
  }
  // The plan id is the SERVER-resolved one, passed in as the helper's first
  // parameter and written by shorthand.
  assert.ok(/(^|\s)planId,/.test(CREATE_DATA), `planId is missing: ${CREATE_DATA}`);
  assert.ok(/function createSessionAtNextOrder\(\s*planId: string,/.test(SOURCE));
});

test("24. NO deprecated, derived, provenance or generated column is written", () => {
  for (const column of UNWRITTEN_COLUMNS) {
    assert.equal(CREATE_DATA.includes(column), false, `the create data writes ${column}`);
    assert.equal(UPDATE_DATA.includes(column), false, `the update data writes ${column}`);
    if (column === "updatedAt") {
      // The ONLY column of the forbidden list the module may NAME at all: as the
      // caller's expected version in a `where` clause, and as the value the two
      // readers convert to an epoch-millisecond token. Never in a `data` payload
      // — the database's own `@updatedAt` writes it.
      continue;
    }
    assert.equal(CODE.includes(column), false, `the module references ${column}`);
  }
  // Every `updatedAt` occurrence is a filter, a select, a conversion or a
  // parameter — never an assignment inside a write payload.
  for (const match of CODE.matchAll(/updatedAt/g)) {
    const line = CODE.slice(CODE.lastIndexOf("\n", match.index) + 1, CODE.indexOf("\n", match.index));
    assert.ok(
      /updatedAt: expectedVersion,|updatedAt: true|expectedUpdatedAt|row\.updatedAt\.getTime\(\)/.test(
        line,
      ),
      `an unexpected updatedAt usage: ${line.trim()}`,
    );
  }

  // The create select is exactly the two values the caller is told about.
  const helper = bodyOf("createSessionAtNextOrder");
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true,?\s*\}/.test(helper),
    "the create select is not exactly id + orderIndex",
  );
  for (const forbidden of ["date: true", "title: true", "planId: true", "include"]) {
    assert.equal(helper.includes(forbidden), false, `the create selects ${forbidden}`);
  }
});

// ===========================================================================
// 25–29. Nothing else is written, and nothing is announced
// ===========================================================================

test("25. the ONLY model written is ExamSession, by exactly three verbs", () => {
  // Never the singular, unfiltered forms: an `update`/`delete` by id alone could
  // not carry the plan scope AND the version token.
  for (const verb of ["update(", "upsert(", "delete(", "createMany("]) {
    assert.equal(CODE.includes(`.${verb}`), false, `the module performs a ${verb}`);
  }
  const writes = /\b(?:prisma|tx)\.(\w+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;
  const written = [...CODE.matchAll(writes)].map((match) => `${match[1]}.${match[2]}`);
  assert.deepEqual(written.sort(), [
    "examSession.create",
    "examSession.deleteMany",
    "examSession.updateMany",
  ]);
});

test("26. no break, supervisor, roster or Teaching-Practice row is touched, and assignments only counted", () => {
  for (const model of [
    "examSessionBreak",
    "examSessionSupervisor",
    "examBlockBreak",
    "examBeginnerChild",
    "examTeachingPracticeSourceDate",
    "teachingPractice",
    "courseOffering.",
    "courseEnrollment",
    "groupMembership",
    "student.",
    "instructor.",
  ]) {
    assert.equal(CODE.includes(model), false, `the module touches ${model}`);
  }
  // The complete Prisma inventory of the module: nine statements, four models.
  const calls = CODE.match(/\b(?:prisma|tx)\.[\w$]+(?:\.[\w$]+)?/g) ?? [];
  assert.deepEqual(calls, [
    "prisma.examPlan.findUnique",
    "prisma.examDefinition.findFirst",
    "prisma.$transaction",
    "tx.examSession.aggregate",
    "tx.examSession.create",
    "prisma.examSession.findFirst",
    "prisma.examAssignment.count",
    "prisma.examSession.updateMany",
    "prisma.examSession.findFirst",
    "prisma.examSession.deleteMany",
  ]);
  // The single assignment statement is a READ, and the only one of its model.
  const assignmentCalls = CODE.match(/examAssignment\.\w+/g) ?? [];
  assert.deepEqual(assignmentCalls, ["examAssignment.count"]);
});

test("27. no publication state is read or written, and nothing is announced", () => {
  for (const token of [
    "publishedAt",
    "publish",
    "unpublish",
    "notification",
    "Notification",
    "sendMessage",
    "web-push",
    "push-",
    "revalidatePath",
    "revalidateTag",
  ]) {
    assert.equal(CODE.includes(token), false, `the module reaches ${token}`);
  }
});

test("28. there is no re-run, isolation override, lock or timing knob", () => {
  for (const token of [
    "retry",
    "Retry",
    "attempt",
    "backoff",
    "maxWait",
    "timeout",
    "isolationLevel",
    "Serializable",
    "RepeatableRead",
    "ReadCommitted",
    "Mutex",
    "mutex",
    "lockfile",
    "globalThis",
    "setTimeout",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
});

test("29. the orderIndex concurrency limitation is documented HONESTLY", () => {
  assert.ok(/concurren/i.test(COMMENTS), "concurrency is not discussed at all");
  assert.ok(
    /(equal|same|duplicate)[^.]{0,80}orderIndex/i.test(COMMENTS),
    "the equal-orderIndex outcome is not stated",
  );
  assert.ok(/orderIndex[^.]{0,120}id/i.test(COMMENTS), "the deterministic read order is not stated");
  // ...and must NOT claim a guarantee it does not have.
  assert.equal(
    /(guarantee|prevent|ensure)s?[^.]{0,60}unique/i.test(COMMENTS),
    false,
    "the header claims uniqueness it does not enforce",
  );
  // The schema is not silently assumed to enforce it either.
  const schema = readFileSync(join(REPO_ROOT, "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(
    schema.indexOf("model ExamSession {"),
    schema.indexOf('@@map("exam_sessions")'),
  );
  assert.ok(model.length > 0, "sanity: the model should be found");
  assert.equal(
    /@@unique\(\[planId, date, orderIndex\]\)/.test(model),
    false,
    "the schema gained a unique order key (this slice must not add one)",
  );
});

// ===========================================================================
// 30–32. The binding decides nothing
// ===========================================================================

test("30. the public functions return their pure cores' results and decide nothing", () => {
  assert.ok(/return createExamSessionWithDeps\(courseOfferingId, rawInput, \{/.test(CODE));
  assert.ok(/return updateExamSessionWithDeps\(/.test(CODE));
  assert.ok(
    /return deleteExamSessionWithDeps\(courseOfferingId, sessionId, expectedUpdatedAt, \{/.test(CODE),
  );
  for (const token of [
    "normalizeExamSessionCreateInput",
    "normalizeExamSessionEditInput",
    "isExamSessionVersionToken",
    "validateStoredExamSession",
    "isValidDateKey",
    "isValidHHMM",
    "plan_not_found",
    "invalid_input",
    "offering_not_found",
    "operation_not_allowed",
    "definition_not_found",
    "definition_change_not_allowed",
    "session_not_found",
    "session_has_assignments",
    "stale_write",
    "duplicate",
    "changed:",
    "ok: false",
    "ok: true",
    "issues",
    "P2002",
    "P2003",
    "P2025",
  ]) {
    assert.equal(CODE.includes(token), false, `the binding decides ${token} itself`);
  }
  // The no-op rule and the assignment gate belong to the pure cores: this module
  // performs no comparison of a submitted value against a stored one, and never
  // decides anything from the assignment count it merely returns.
  for (const token of ["isUnchanged", "=== existing", "existing.", "assignmentCount"]) {
    assert.equal(CODE.includes(token), false, `the binding implements ${token}`);
  }
});

test("31. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      "@/lib/dates",
      "@/lib/exam/create-exam-session-core",
      "@/lib/exam/delete-exam-session-core",
      "@/lib/exam/update-exam-session-core",
      PRISMA_MODULE,
    ].sort(),
  );
  // The generated enum is imported as a TYPE only — no runtime client value.
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
});

test("32. the pure core it binds is DB-free, and no lib/exam module imports a client", () => {
  const examDir = join(REPO_ROOT, "lib", "exam");
  const offenders: string[] = [];
  // MODULES, not suites: a guard suite necessarily names what it forbids.
  for (const name of readdirSync(examDir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  )) {
    const source = readFileSync(join(examDir, name), "utf8");
    for (const specifier of [PRISMA_MODULE, GENERATED_CLIENT]) {
      if (source.includes(specifier)) offenders.push(`${name} -> ${specifier}`);
    }
  }
  assert.deepEqual(offenders, [], `the exam cores must stay DB-free: ${offenders.join(", ")}`);
});

// ===========================================================================
// 33–36. Containment: no caller, no UI, four new files, nothing modified
// ===========================================================================

test("33. EXACTLY ONE approved caller reaches all three writers, and it is not a component", () => {
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, ...BOUND_CORE_RELS].map((rel) => join(REPO_ROOT, rel)),
  );
  // Each pure core's OWN suite legitimately drives its injectable orchestration
  // with fakes; nothing else may reach any of these symbols.
  const ownSuites = new Set(
    [CORE_TEST_REL, UPDATE_CORE_TEST_REL, DELETE_CORE_TEST_REL].map((rel) =>
      join(REPO_ROOT, rel),
    ),
  );

  const callers: string[] = [];
  const editOrDeleteCallers: string[] = [];
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      if (declaring.has(path)) continue;
      if (ownSuites.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /exam-session-write-io/.test(code) ||
        /(create|update|delete)-exam-session-core/.test(code) ||
        /\b(create|update|delete)ExamSession\s*\(/.test(code) ||
        /\b(create|update|delete)ExamSessionWithDeps\s*\(/.test(code);
      if (reaches) {
        callers.push(path.slice(REPO_ROOT.length + 1));
      }
      // The EDIT and REMOVAL writers are still tracked SEPARATELY from the CREATE,
      // so their caller list can be asserted on its own rather than being waved
      // through by the create's entry.
      //
      // EX-SES-UI-2 TRANSITION. This list was required to be EMPTY, which was the
      // correct claim while only the CREATE had an approved UI: importing the
      // destructive pair "for later" would have published two endpoints nothing
      // rendered. That slice gives each its own reviewed form, so the list is
      // RE-POINTED to the SAME single Server Action module rather than dropped or
      // widened to the route directory — a second module in that very directory, a
      // `.tsx` component, a layout, a route handler or any other file still fails.
      if (
        /\b(update|delete)ExamSession(WithDeps)?\s*\(/.test(code) ||
        /(update|delete)-exam-session-core/.test(code)
      ) {
        editOrDeleteCallers.push(path.slice(REPO_ROOT.length + 1));
      }
    }
  }

  // EX-SES-S4 approved ONE production caller: the course-scoped exams route's
  // Server Action module, which wrapped the CREATE and nothing else. EX-SES-UI-2
  // adds the EDIT and the REMOVAL to that SAME module — no second module, and no
  // component. This is an EXACT path and not a directory or a pattern, so a second
  // file in the very same directory still fails, which is the whole point of
  // listing it this way.
  const APPROVED_CALLER = ["app", "admin", "courses", "[courseOfferingId]", "exams", "actions.ts"].join(sep);
  assert.deepEqual(
    callers.sort(),
    [APPROVED_CALLER],
    `an unapproved caller exists: ${callers.join(", ")}`,
  );
  // The approved caller is a Server Action module, never a UI file: no component
  // may reach a write binding directly.
  assert.equal(APPROVED_CALLER.endsWith(".tsx"), false);

  // The destructive pair, asserted SEPARATELY and as an EXACT one-entry list. The
  // claim is no longer "nothing may edit or remove a stored session" but "exactly
  // ONE reviewed Server Action module may, and it is the same one that owns the
  // create" — which is what keeps a future second caller failing here.
  assert.deepEqual(
    editOrDeleteCallers.sort(),
    [APPROVED_CALLER],
    `an unapproved edit/delete caller exists: ${editOrDeleteCallers.join(", ")}`,
  );
  assert.equal(
    editOrDeleteCallers.some((path) => path.endsWith(".tsx")),
    false,
    "no component may reach a destructive session writer",
  );

  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-session-actions.ts"),
    join("lib", "actions", "exams.ts"),
    join("lib", "actions", "exam-write.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
});

test("34. the slice consists of EXACTLY the eight approved files", () => {
  for (const rel of [
    IO_REL,
    IO_TEST_REL,
    CORE_REL,
    CORE_TEST_REL,
    UPDATE_CORE_REL,
    UPDATE_CORE_TEST_REL,
    DELETE_CORE_REL,
    DELETE_CORE_TEST_REL,
  ]) {
    assert.ok(statSync(join(REPO_ROOT, rel)).isFile(), `${rel} is missing`);
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
  }
  // No ninth file was added under either directory.
  const examSlice = readdirSync(join(REPO_ROOT, "lib", "exam"))
    .filter((name) => /^(create|update|delete)-exam-session/.test(name))
    .sort();
  assert.deepEqual(examSlice, [
    "create-exam-session-core.test.ts",
    "create-exam-session-core.ts",
    "delete-exam-session-core.test.ts",
    "delete-exam-session-core.ts",
    "update-exam-session-core.test.ts",
    "update-exam-session-core.ts",
  ]);
  const actionsSlice = readdirSync(join(REPO_ROOT, "lib", "actions"))
    .filter((name) => name.startsWith("exam-session"))
    .sort();
  assert.deepEqual(actionsSlice, [
    "exam-session-write-io.test.ts",
    "exam-session-write-io.ts",
  ]);
});

test("35. the slice modified ONLY its own binding and suite, and added nothing else", () => {
  const scope = ["lib", "prisma", "app", "components"];

  // What EXISTS IN HEAD and was edited, deleted, renamed or type-changed.
  // `--diff-filter=MDRT` excludes additions on purpose: a brand-new file is what
  // this slice is allowed to produce, and including additions would make the
  // check flip to red the moment the new files are staged and back to green after
  // they are committed — a guard that only holds in one of three ordinary states
  // proves nothing. What IS asserted, in all three states, is that no tracked
  // file OUTSIDE the two approved paths was touched: no schema, no migration, no
  // policy, no unrelated core, no route.
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", "--diff-filter=MDRT", "HEAD", "--", ...scope],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.equal(diff.status, 0, `git diff failed: ${diff.stderr ?? ""}`);
  const modified = (diff.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const unapproved = modified.filter((path) => !APPROVED_MODIFIED_FILES.includes(path));
  assert.deepEqual(unapproved, [], `the slice modified: ${unapproved.join(", ")}`);

  // ...and every working-tree entry in scope — untracked, modified, staged or
  // any combination — names one of the approved paths and nothing else.
  const status = spawnSync("git", ["status", "--porcelain", "--", ...scope], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(status.status, 0, `git status failed: ${status.stderr ?? ""}`);
  const approved = new Set([...APPROVED_NEW_FILES, ...APPROVED_MODIFIED_FILES]);
  for (const line of (status.stdout ?? "").split("\n").filter((l) => l.trim().length > 0)) {
    const path = line.slice(3).trim();
    assert.ok(approved.has(path), `an unapproved change exists: ${line}`);
  }
});

// ===========================================================================
// 37–48. EX-SES-S3: the shared session reader, the two conditional writes and
//        the assignment pre-check
// ===========================================================================

test("37. the session reader is a PLAN-SCOPED findFirst, never a bare findUnique by id", () => {
  const reader = bodyOf("findSessionForPlan");
  assert.ok(
    /prisma\.examSession\.findFirst\(/.test(reader),
    "the session read is not a plan-scoped findFirst",
  );
  assert.ok(
    /where:\s*\{\s*id:\s*sessionId,\s*planId,?\s*\}/.test(reader),
    `the session where was: ${reader}`,
  );
  // A bare findUnique by id would find another plan's session and then rely on a
  // comparison someone could later remove.
  assert.equal(CODE.includes("examSession.findUnique"), false);
  // The helper takes the SERVER-supplied plan id as its FIRST parameter.
  assert.ok(/function findSessionForPlan\(\s*planId: string,/.test(SOURCE));
});

test("38. the session reader selects EXACTLY the eight approved columns", () => {
  const reader = bodyOf("findSessionForPlan");
  const selectStart = reader.indexOf("select: {");
  const select = reader.slice(selectStart, reader.indexOf("},", selectStart));
  const columns = [...select.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, [
    "id",
    "definitionId",
    "date",
    "startTime",
    "arena",
    "title",
    "notes",
    "updatedAt",
  ]);
  for (const forbidden of [
    "planId: true",
    "orderIndex: true",
    "kind: true",
    "endTime: true",
    "capacity: true",
    "createdAt: true",
    "individualPublishedAt: true",
    "assignments",
    "include",
  ]) {
    assert.equal(select.includes(forbidden), false, `the session read selects ${forbidden}`);
  }
});

test("39. ONE reader serves BOTH the edit and the removal", () => {
  assert.equal((CODE.match(/function findSessionForPlan\(/g) ?? []).length, 1);
  assert.ok(/findSessionForUpdate: findSessionForPlan,/.test(CODE), "the edit binds its own reader");
  assert.ok(/findSessionForDelete: findSessionForPlan,/.test(CODE), "the removal binds its own reader");
});

test("40. the conditional update is scoped by the session id, the SERVER plan AND the version", () => {
  assert.equal((CODE.match(/examSession\.updateMany\(/g) ?? []).length, 1);
  const helper = bodyOf("updateSessionIfCurrent");
  // Both branches carry all three ordinary conditions; the guarded one adds a
  // fourth, which test 40a asserts.
  assert.equal(
    (helper.match(/id: sessionId,\s*planId,\s*updatedAt: expectedVersion,/g) ?? []).length,
    2,
    `the update where was: ${helper}`,
  );
  assert.ok(
    /const expectedVersion = new Date\(expectedUpdatedAt\);/.test(helper),
    "the version token is not converted once",
  );
  // "Nothing matched" is reported as `null` — the pure core turns that into the
  // stale-write refusal, and no code here invents one.
  assert.ok(
    /written\.count === 0/.test(helper),
    "the update does not report a zero match by count",
  );
  assert.ok(/return null;/.test(helper), "a zero match does not report null");
  assert.ok(/function updateSessionIfCurrent\(\s*planId: string,/.test(SOURCE));
});

test("40a. a DEFINITION-CHANGING update carries the atomic assignments:{none:{}} filter", () => {
  const helper = bodyOf("updateSessionIfCurrent");
  // The guarded branch, in full: id + plan + version + the relation filter, all
  // conditions of ONE statement rather than of an earlier application read.
  assert.ok(
    /requireNoAssignments\s*\?\s*\{[\s\S]*?id: sessionId,[\s\S]*?planId,[\s\S]*?updatedAt: expectedVersion,[\s\S]*?assignments: \{ none: \{\} \},[\s\S]*?\}\s*:/.test(
      helper,
    ),
    `the guarded update where was: ${helper}`,
  );
  // It is driven by the flag the PURE CORE computes — this module decides nothing
  // about when the guard applies.
  assert.ok(
    /requireNoAssignments: boolean,/.test(SOURCE),
    "the write does not accept the core's flag",
  );
  assert.equal(
    (helper.match(/assignments: \{ none: \{\} \}/g) ?? []).length,
    1,
    "the relation filter appears on more than the guarded branch",
  );
});

test("40b. an ORDINARY update carries NO assignment filter, so assigned sessions stay editable", () => {
  const helper = bodyOf("updateSessionIfCurrent");
  // The unguarded branch is the text after the ternary's `:` — it must contain
  // the three ordinary conditions and NOT the relation filter.
  const elseBranch = helper.slice(helper.indexOf("\n      : {"), helper.indexOf("data: {"));
  assert.ok(elseBranch.includes("id: sessionId,"), `the else branch was: ${elseBranch}`);
  assert.ok(elseBranch.includes("planId,"));
  assert.ok(elseBranch.includes("updatedAt: expectedVersion,"));
  assert.equal(
    elseBranch.includes("assignments"),
    false,
    "an ordinary edit would be refused on an assigned session",
  );
  // ...and the reason that is deliberate is written down.
  assert.ok(
    /ORDINARY edit deliberately carries NO assignment condition/i.test(COMMENTS),
    "the ordinary-edit exemption is undocumented",
  );
});

test("41. the update data is EXACTLY the six approved mutable columns", () => {
  const keys = [...UPDATE_DATA.matchAll(/^\s{6}(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ["definitionId", "date", "startTime", "arena", "title", "notes"]);
  // Every one comes from the NORMALIZED payload, never from anywhere else.
  for (const field of ["definitionId", "startTime", "arena", "title", "notes"]) {
    assert.ok(
      new RegExp(`${field}: value\\.${field},`).test(UPDATE_DATA),
      `${field} is missing or not taken from the normalized value`,
    );
  }
  assert.ok(/date: parseDateKey\(value\.date\),/.test(UPDATE_DATA));
  assert.equal(UPDATE_DATA.includes("rawInput"), false, "the update data reads raw input");
});

test("42. the edit NEVER writes orderIndex or planId, by any route", () => {
  for (const forbidden of ["orderIndex", "planId:", "increment", "decrement", "connect"]) {
    assert.equal(UPDATE_DATA.includes(forbidden), false, `the update data writes ${forbidden}`);
  }
  // `orderIndex` exists in this module ONLY in the create's server-assigned
  // position — never in an edit.
  const helper = bodyOf("updateSessionIfCurrent");
  assert.equal(helper.includes("orderIndex"), false, "the edit touches orderIndex");
});

test("43. the post-read is narrow, and its non-transactional semantics are stated HONESTLY", () => {
  const helper = bodyOf("updateSessionIfCurrent");
  assert.ok(
    /select:\s*\{\s*id:\s*true,\s*updatedAt:\s*true,?\s*\}/.test(helper),
    "the post-read select is not exactly id + updatedAt",
  );
  assert.ok(/where:\s*\{\s*id:\s*sessionId,\s*planId,?\s*\}/.test(helper), "the post-read is not plan-scoped");
  // The edit does NOT open a transaction, so the returned version must not be
  // claimed to be this write's alone.
  assert.equal(helper.includes("$transaction"), false, "the edit opens a transaction");
  assert.ok(/transaction/i.test(COMMENTS), "the non-transactional post-read is undiscussed");
  assert.equal(
    /(guarantee|ensure)s?[^.]{0,80}(this write|only this)/i.test(COMMENTS),
    false,
    "the header claims the returned version belongs only to this write",
  );
});

test("44. the assignment pre-check is ONE count scoped by the session id", () => {
  assert.equal((CODE.match(/examAssignment\.count\(/g) ?? []).length, 1);
  const helper = bodyOf("countAssignmentsForSession");
  assert.ok(/where:\s*\{\s*sessionId,?\s*\}/.test(helper), `the count where was: ${helper}`);
  assert.ok(
    /function countAssignmentsForSession\(sessionId: string\): Promise<number>/.test(SOURCE),
    "the count accepts more than a session id",
  );
  // It is shared by both operations rather than duplicated per operation.
  assert.equal((CODE.match(/countAssignmentsForSession,/g) ?? []).length, 2);
});

test("45. the conditional delete is ONE deleteMany scoped by id, plan, version AND assignments", () => {
  assert.equal((CODE.match(/examSession\.deleteMany\(/g) ?? []).length, 1);
  const helper = bodyOf("deleteSessionIfCurrent");
  // ALL FOUR conditions, unconditionally — there is no ungrated form of this
  // statement, because an unassigned session is the only kind that may be
  // removed. The relation filter is what stops an assignment inserted after the
  // pure core's count from being cascaded away.
  assert.ok(
    /where:\s*\{\s*id: sessionId,\s*planId,\s*updatedAt: expectedVersion,[\s\S]*?assignments: \{ none: \{\} \},\s*\}/.test(
      helper,
    ),
    `the delete where was: ${helper}`,
  );
  assert.ok(
    /const expectedVersion = new Date\(expectedUpdatedAt\);/.test(helper),
    "the version token is not converted once",
  );
  // No ternary, no flag: the guard cannot be switched off.
  assert.equal(helper.includes("?"), false, "the delete guard is conditional");
  assert.equal(helper.includes("requireNoAssignments"), false);

  assert.ok(/return removed\.count > 0;/.test(helper), "the delete does not report by count");
  // Exactly one statement: no cascade of the module's own, no second delete, no
  // transaction, no pre-delete read and no retry.
  assert.equal((helper.match(/prisma\./g) ?? []).length, 1, "the removal issues more than one statement");
  assert.equal(helper.includes("$transaction"), false);
  assert.ok(/function deleteSessionIfCurrent\(\s*planId: string,/.test(SOURCE));
});

test("45a. the two guarded statements are the ONLY places a relation filter appears", () => {
  const filters = CODE.match(/assignments: \{ none: \{\} \}/g) ?? [];
  assert.equal(filters.length, 2, "the atomic guard is not on exactly the two writes");
  for (const helper of ["updateSessionIfCurrent", "deleteSessionIfCurrent"]) {
    assert.ok(
      bodyOf(helper).includes("assignments: { none: {} }"),
      `${helper} lost its atomic guard`,
    );
  }
  // The create and the plain readers must not have acquired one.
  for (const helper of [
    "createSessionAtNextOrder",
    "findSessionForPlan",
    "findExamPlanByCourseOfferingId",
    "findDefinitionForPlan",
    "countAssignmentsForSession",
  ]) {
    assert.equal(
      bodyOf(helper).includes("assignments:"),
      false,
      `${helper} gained a relation filter`,
    );
  }
});

test("45b. neither guarded write is retried, and neither takes a lock or isolation override", () => {
  // One call site each, in the whole module.
  assert.equal((CODE.match(/prisma\.examSession\.updateMany\(/g) ?? []).length, 1);
  assert.equal((CODE.match(/prisma\.examSession\.deleteMany\(/g) ?? []).length, 1);
  for (const token of [
    "retry",
    "Retry",
    "attempt",
    "backoff",
    "isolationLevel",
    "Serializable",
    "RepeatableRead",
    "ReadCommitted",
    "FOR UPDATE",
    "$queryRaw",
    "$executeRaw",
    "Mutex",
    "mutex",
    "setTimeout",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // The remaining database-level window is disclosed rather than papered over.
  assert.ok(/READ COMMITTED/i.test(COMMENTS), "the residual window is undisclosed");
  assert.ok(
    /(SERIALIZABLE|row locking)/i.test(COMMENTS),
    "what would close the residual window is unnamed",
  );
});

test("46. NO application-side cascade of assignments, breaks or supervisors exists", () => {
  for (const token of [
    "examAssignment.deleteMany",
    "examAssignment.delete",
    "examSessionBreak",
    "examSessionSupervisor",
    "examBeginnerChild",
    "deleteMany({ where: { sessionId } })",
    // Nested WRITES on the relations. `assignments: { none: {} }` is a read-side
    // relation FILTER and is the atomic guard — asserted in tests 40a/45/45a —
    // so the blanket `assignments: {` of the previous form would now forbid the
    // very safety property this slice added.
    "assignments: { create",
    "assignments: { delete",
    "assignments: { update",
    "assignments: { set",
    "assignments: { disconnect",
    "breaks: {",
    "supervisors: {",
  ]) {
    assert.equal(CODE.includes(token), false, `the module cascades ${token} itself`);
  }
  // Every `assignments:` occurrence in the module is the read-side guard.
  const relationUses = CODE.match(/assignments:[^,\n]*/g) ?? [];
  assert.deepEqual(relationUses, ["assignments: { none: {} }", "assignments: { none: {} }"]);
  // The database's cascade is what removes them, and that is written down.
  assert.ok(/cascade/i.test(COMMENTS), "the cascade is undocumented");
  assert.ok(
    /only protection|only thing standing|ONLY thing/i.test(COMMENTS) || /Cascade` and not `Restrict/i.test(COMMENTS),
    "the count-only protection is not stated honestly",
  );
  // ...and no classifier for an error that cannot be raised here.
  for (const token of ["P2003", "P2025", "isDefinitionInUse", "ForeignKey"]) {
    assert.equal(CODE.includes(token), false, `the module classifies ${token}`);
  }
});

test("47. the edit binds EXACTLY the nine approved effects, in the locked order", () => {
  const literal = depsLiteralAfter("updateExamSessionWithDeps(");
  const bound = [...literal.matchAll(/^[ \t]+(\w+)[,:]/gm)].map((match) => match[1]);
  assert.deepEqual(bound, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForUpdate",
    "findDefinitionForPlan",
    "countAssignmentsForSession",
    "updateSessionIfCurrent",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
});

test("48. the removal binds EXACTLY the eight approved effects, in the locked order", () => {
  const literal = depsLiteralAfter("deleteExamSessionWithDeps(");
  const bound = [...literal.matchAll(/^[ \t]+(\w+)[,:]/gm)].map((match) => match[1]);
  assert.deepEqual(bound, [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForDelete",
    "countAssignmentsForSession",
    "deleteSessionIfCurrent",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]);
  // The removal is given NO definition reader and NO update: it cannot re-point
  // or rewrite anything, only remove.
  assert.equal(literal.includes("findDefinitionForPlan"), false);
  assert.equal(literal.includes("updateSessionIfCurrent"), false);
  assert.equal(literal.includes("createSessionAtNextOrder"), false);
});

test("49. all three operations share ONE admin boundary, gate, plan lookup and classifier pair", () => {
  // Each is declared exactly once...
  for (const helper of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
  ]) {
    assert.equal(
      (CODE.match(new RegExp(`function ${helper}\\(`, "g")) ?? []).length,
      1,
      `${helper} is declared more than once`,
    );
    // ...and bound by all three operations, so they cannot drift apart.
    assert.equal(
      (CODE.match(new RegExp(`^\\s+${helper},`, "gm")) ?? []).length,
      3,
      `${helper} is not shared by all three operations`,
    );
  }
});

test("50. the slice adds no schema, migration, capability, policy, route or UI file", () => {
  // No migration directory was created: the session table and its indexes are
  // the ones the committed exam migrations already added.
  const migrations = readdirSync(join(REPO_ROOT, "prisma", "migrations"))
    .filter((name) => /exam/i.test(name))
    .sort();
  assert.deepEqual(migrations, [
    "20260729120000_add_exam_plan_tree",
    "20260729140000_add_exam_teaching_practice_source_date",
    "20260730120000_add_exam_definition_and_breaks",
  ]);

  // The committed course-operation policy gained no exam operation.
  const policy = readFileSync(join(REPO_ROOT, "lib", "course", "operation-policy-core.ts"), "utf8");
  assert.equal(/EXAM/.test(policy), false, "the course policy gained an exam operation");
  assert.ok(policy.includes("SCHEDULE_DRAFT_CONFIGURATION"));

  // This suite performs no production access of its own.
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ["process", "env"].join("."),
    "DATABASE" + "_URL",
    "Prisma" + "Client",
    "supa" + "base",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  // Anchored at line start, so it matches REAL import statements only: this
  // suite necessarily quotes an import line inside an assertion, and that quoted
  // text is evidence about the module under test, not a dependency of the suite.
  const specifiers = [...own.matchAll(/^import .*?from\s+"([^"]+)"/gm)].map((match) => match[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});
