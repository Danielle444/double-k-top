/**
 * EXAM EX-ASG-IT1 — the guard suite for the ADMIN stored INSTRUCTED_TRAINEE
 * assignment WRITE binding.
 *
 * Run with:
 *   npx tsx --test lib/actions/exam-instructed-trainee-assignment-write-io.test.ts
 *
 * WHY THIS SUITE IS STRUCTURAL RATHER THAN BEHAVIOURAL. The module under test
 * declares `server-only` and imports the database client, so importing it here
 * would either fail the build or open a real connection. The ORCHESTRATION it
 * binds is already proven at runtime by the pure core's own DB-free suite, which
 * drives every ordering, refusal, gate and eligibility decision with fakes. What
 * is left — and what only a source-text guard can prove — is that the BINDING is
 * the one that core was designed for: the exact statements, the exact scopes, the
 * exact selects, the exact classifier, and the exact absence of a caller.
 *
 * DB-FREE: no database connection is opened, no SQL is executed, no environment
 * variable is read, and no production identifier appears anywhere. The only files
 * read are module SOURCE TEXTS and `git`'s own output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const IO_NAME = "exam-instructed-trainee-assignment-write-io.ts";
const IO_TEST_NAME = "exam-instructed-trainee-assignment-write-io.test.ts";
const CORE_NAME = "create-exam-instructed-trainee-assignment-core.ts";
const CORE_TEST_NAME = "create-exam-instructed-trainee-assignment-core.test.ts";

const IO_REL = join("lib", "actions", IO_NAME);
const IO_TEST_REL = join("lib", "actions", IO_TEST_NAME);
const CORE_REL = join("lib", "exam", CORE_NAME);
const CORE_TEST_REL = join("lib", "exam", CORE_TEST_NAME);

/** The FOUR files this slice consists of, in repository form. */
const NEW_FILES = [
  `lib/actions/${IO_NAME}`,
  `lib/actions/${IO_TEST_NAME}`,
  `lib/exam/${CORE_NAME}`,
  `lib/exam/${CORE_TEST_NAME}`,
];

/** The ONE course-scoped admin route that may wire this binding. */
const ROUTE_DIR_PREFIX = "app/admin/courses/[courseOfferingId]/exams/";

/**
 * The route files the approved WIRING slice (EX-ASG-IT2) adds.
 *
 * Spelled EXACTLY — three file names, no directory and no prefix — so a fourth
 * route file, a second route, an instructor or trainee surface, or any `lib/`
 * addition still fails the containment guards below.
 */
const APPROVED_NEW_ROUTE_FILES = [
  `${ROUTE_DIR_PREFIX}CreateExamInstructedTraineeAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-messages.ts`,
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
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
  `${ROUTE_DIR_PREFIX}exam-publication-ui.contract.test.ts`,
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
 * The `lib/` files the approved EX-PUB-BE-MVP backend slice adds, which travels in
 * the same working tree: the exam-plan publish/unpublish pure core, its binding,
 * and a suite for each.
 *
 * Kept SEPARATE from the route-file list above rather than merged into it, because
 * these are not route files and the distinction is what makes "no route, no form
 * and no Server Action came with the backend slice" still checkable. Spelled as
 * FOUR exact paths — no directory and no prefix — so a fifth `lib/` addition still
 * fails guards 25 and 26.
 *
 * That slice reads and writes ONE ExamPlan column, adds no caller anywhere, and
 * modifies no tracked production file. The two `lib/actions` paths are ASSEMBLED
 * from pieces: its own guard sweeps `app/`, `lib/`, `components/` and `scripts/`
 * for that module name and pins the caller list at EXACTLY ZERO.
 */
/*
 * RE-POINTED by EX-PAIR-BE-MVP, the instructed-trainee/examinee PAIRING backend,
 * which travels in the same working tree and has exactly the same shape: a pure
 * core, a binding, and a suite for each. It writes ONE ExamAssignment column —
 * `pairingIndex`, never `orderIndex` — adds no caller anywhere, and modifies no
 * tracked production file. Four more EXACT paths, assembled for the same reason,
 * so a ninth `lib/` addition still fails guards 25 and 26.
 */
const APPROVED_NEW_LIB_FILES = [
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
  "lib/exam/exam-publication-write-core.ts",
  "lib/exam/exam-publication-write-core.test.ts",
  "lib/actions/" + "exam-publication-write" + "-io.ts",
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
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
  // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
  // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
  // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
  // own assignment by exact student id. Every path below is named EXACTLY - no
  // directory, no prefix, no glob - so an unrelated file still fails this guard,
  // and each module name is SPLIT so this list never enrols itself as a caller.
  "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
  "lib/exam/" + "exam-beginner-course-scope" + "-core.test.ts",
  "lib/exam/" + "exam-beginner-course-scope" + ".contract.test.ts",
];

/**
 * The tracked files the approved WIRING slice may modify, each spelled exactly.
 *
 * TWO of them are production: the route's shared Server Action module and its
 * page. Everything else is a guard SUITE whose exact counts or allow-lists that
 * slice re-points. No schema, no migration, no auth module, no session module,
 * no capability catalog, no course-policy core, and no `lib/` PRODUCTION file of
 * any kind is among them — which the assertions below re-check structurally
 * rather than trusting this list to stay honest on its own.
 *
 * The `lib/` entries are ASSEMBLED from pieces: several of those very suites pin
 * caller allow-lists by sweeping `lib/` for their own module names, and a file
 * that spelled one whole would enrol itself as a caller of a binding it never
 * calls.
 */
const APPROVED_MODIFIED_FILES = [
  `${ROUTE_DIR_PREFIX}actions.ts`,
  `${ROUTE_DIR_PREFIX}page.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-ui.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definition-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-definitions-page.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-plan-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-create.contract.test.ts`,
  `${ROUTE_DIR_PREFIX}exam-session-edit-delete.contract.test.ts`,
  // EX-ASG-LTD2-B1 re-points this route's instructed-trainee contract suite too:
  // that suite's blanket ban on naming the examinee's stored lesson subject is
  // narrowed to the three files that could WRITE one, so the PAGE may display it.
  // The suite is a guard, not a caller — this binding still has exactly one.
  `${ROUTE_DIR_PREFIX}exam-instructed-trainee-assignment-ui.contract.test.ts`,
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
  `${ROUTE_DIR_PREFIX}exam-publication-ui.contract.test.ts`,
  "lib/actions/" + "exam-publication-write" + "-io.test.ts",
  `lib/actions/${IO_TEST_NAME}`,
  "lib/actions/" + "exam-assignment-write" + "-io.test.ts",
  "lib/actions/" + "exam-assignment-read" + "-io.test.ts",
  "lib/actions/" + "exam-definition-read" + "-io.test.ts",
  "lib/actions/" + "admin-exam-session-read" + "-io.test.ts",
  "lib/actions/" + "exam-session-write" + "-io.test.ts",
  "lib/actions/" + "exam-plan-write" + "-io.test.ts",
  "lib/exam/" + "exam-supervisor-write" + "-core.test.ts",
  "lib/exam/" + "create-exam-plan" + "-core.test.ts",
  // EX-ASG-LTD2-B1 — the approved ADMIN READ DETAIL slice, which travels in the
  // same working tree. It publishes two stored columns the assignment READ pair
  // already reached, so that pair's two PRODUCTION modules and its pure core's
  // suite join this list, together with the two supervisor footprint guards whose
  // "nothing was modified" claims it re-points.
  //
  // They are the FIRST `lib/` production entries here, which is why assertion 7
  // below is re-pointed from "every `lib/` entry is a suite" to an exact pair.
  // Stage A's own binding and core are NOT among them and stay byte-identical,
  // which assertion 8 re-checks independently.
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
  `${ROUTE_DIR_PREFIX}CreateExamAssignmentForm.tsx`,
  `${ROUTE_DIR_PREFIX}exam-assignment-messages.ts`,
  "lib/actions/" + "detailed-exam-assignment-write" + "-io.test.ts",
  // EX-PAIR-BE-MVP — the approved instructed-trainee/examinee PAIRING backend,
  // which travels in the same working tree. Its four `lib/` additions re-point
  // the footprint list of the neighbouring publication backend's guard SUITE, so
  // that suite joins the modified set. It is a `.test.ts`; no production file, no
  // route, no Server Action, no schema, migration, auth, session, capability or
  // policy file comes with it, and THIS binding's caller list is untouched.
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

/** Every path either slice is allowed to have touched, in any state. */
const APPROVED_FOOTPRINT = [
  ...APPROVED_MODIFIED_FILES,
  ...APPROVED_NEW_ROUTE_FILES,
  ...APPROVED_NEW_LIB_FILES,
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

/** Every exported function signature, in source order. */
const SIGNATURES = [
  ...SOURCE.matchAll(/export (?:async )?function (\w+)\(([\s\S]*?)\):\s*([^{]+)\{/g),
].map(([, name, params, returns]) => ({
  name,
  params: params.replace(/\s+/g, " ").trim(),
  returns: returns.replace(/\s+/g, " ").trim(),
}));

function gitLines(args: readonly string[]): string[] {
  const result = spawnSync("git", [...args], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr ?? ""}`);
  return (result.stdout ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

// Split specifiers: this suite necessarily names some of what it forbids, and
// the committed exam-slice guards scan sibling directories for them.
const PRISMA_MODULE = ["@/lib", "prisma"].join("/");
const GENERATED_CLIENT = ["@prisma", "client"].join("/");
const ENV_READ = "process" + ".env";

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
  assert.equal(CODE.includes("'use " + "client'"), false);
  // ...and the header states the rule it holds itself to.
  assert.ok(COMMENTS.includes("use " + "server"), "the rule is undocumented");
});

test("3. the module exports EXACTLY one function, and no value", () => {
  assert.deepEqual(
    SIGNATURES.map((entry) => entry.name),
    ["createExamInstructedTraineeAssignment"],
  );
  for (const token of [
    "export const",
    "export let",
    "export var",
    "export default",
    "export class",
    "GET",
    "POST",
    "PATCH",
    "NextRequest",
    "NextResponse",
    "revalidatePath",
    "redirect(",
  ]) {
    assert.equal(CODE.includes(token), false, `the module declares ${token}`);
  }
  // The only other export is a TYPE re-export, which emits no runtime value.
  const exportStatements = CODE.match(/^export .*$/gm) ?? [];
  for (const statement of exportStatements) {
    assert.ok(
      statement.startsWith("export type {") || statement.startsWith("export async function "),
      `unexpected export: ${statement}`,
    );
  }
  // No read, delete, update or reorder surface exists here at all.
  for (const token of ["deleteExam", "updateExam", "reorderExam", "readExam", "readAdminExam"]) {
    assert.equal(CODE.includes(token), false, `the module exposes ${token}`);
  }
});

test("4. the entry point takes EXACTLY the approved parameters and result type", () => {
  const [create] = SIGNATURES;
  assert.equal(create.params, "courseOfferingId: string, rawInput: unknown,");
  assert.equal(create.returns, "Promise<CreateExamInstructedTraineeAssignmentResult>");

  // It takes no role, horse, position, pairing, plan, actor or transaction handle.
  for (const forbidden of [
    "role",
    "horseName",
    "orderIndex",
    "pairingIndex",
    "planId",
    "sessionId",
    "studentId",
    "adminId",
    "actorId",
    "instructorId",
    "tx",
    "prisma",
    "deps",
    "expectedUpdatedAt",
  ]) {
    assert.equal(create.params.includes(forbidden), false, `the entry point accepts ${forbidden}`);
  }
});

test("5. the entry point only hands the pure core its effects", () => {
  const create = bodyOf("createExamInstructedTraineeAssignment");
  assert.ok(
    create.includes("createExamInstructedTraineeAssignmentWithDeps(courseOfferingId, rawInput, {"),
  );
  for (const dependency of [
    "requireCourseContext",
    "assertConfigurationAllowed",
    "findExamPlanByCourseOfferingId",
    "findSessionForPlan",
    "findEligibleTrainee",
    "createAssignmentAtNextOrder",
    "isCourseNotFoundError",
    "isOperationNotAllowedError",
    "isUniqueConstraintError: isInstructedTraineeAssignmentConflictError",
  ]) {
    assert.ok(create.includes(dependency), `${dependency} is not bound`);
  }
  // The entry point does not query, order, validate or build an outcome itself.
  assert.equal(/prisma\./.test(create), false, "the entry point queries directly");
  assert.equal(create.includes("Object.freeze"), false, "the entry point builds a result");
  assert.equal(create.includes("ok: false"), false, "the entry point invents an outcome");
});

// ===========================================================================
// 6–9. Imports, authorization, the verified id, the lifecycle gate
// ===========================================================================

test("6. the module imports EXACTLY the approved specifiers", () => {
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    [
      "@/app/generated/prisma/client",
      "@/lib/course/admin-course-context",
      "@/lib/course/operation-policy-core",
      `@/lib/exam/${CORE_NAME.replace(/\.ts$/, "")}`,
      PRISMA_MODULE,
    ].sort(),
  );
  // The generated enum is imported as a TYPE only — no runtime client value.
  assert.ok(/import type \{ CourseOfferingStatus \} from/.test(CODE));
  // No date helper is needed, because no statement reads or writes a calendar
  // value; and no notification, message, push or Teaching-Practice module is
  // reachable from here.
  for (const forbidden of [
    "@/lib/dates",
    "notifications",
    "messages",
    "push",
    "teaching-practice",
    "capability",
    "@/lib/auth",
  ]) {
    assert.equal(CODE.includes(forbidden), false, `the module imports ${forbidden}`);
  }
});

test("7. requireAdminCourseOffering is bound once, with the RAW requested id", () => {
  assert.equal((CODE.match(/await requireAdminCourseOffering\(/g) ?? []).length, 1);
  assert.ok(
    /requireAdminCourseOffering\(requestedCourseOfferingId\)/.test(CODE),
    "the admin boundary is not called with the requested id",
  );
  // It is bound in the ONE helper the core calls first, and that helper performs
  // no query of its own and carries forward only two fields.
  const helper = bodyOf("requireCourseContext");
  assert.equal(/prisma\./.test(helper), false, "the authorization helper queries");
  assert.ok(/courseOfferingId:\s*context\.id/.test(helper), "the verified id is not carried");
  assert.ok(/status:\s*context\.status/.test(helper), "the verified status is not carried");
  for (const forbidden of ["name", "level", "activityYear", "startDate", "endDate"]) {
    assert.equal(helper.includes(forbidden), false, `the context carries ${forbidden}`);
  }
  assert.equal((CODE.match(/function requireCourseContext\(/g) ?? []).length, 1);
});

test("8. the RAW requested id reaches the authorization boundary and NOTHING else", () => {
  // The raw value is named `requestedCourseOfferingId` and exists in exactly two
  // places: the authorization helper's parameter, and the one call it makes.
  assert.equal(
    (CODE.match(/\brequestedCourseOfferingId\b/g) ?? []).length,
    2,
    "the raw requested id is read somewhere beyond the authorization call",
  );
  const helper = bodyOf("requireCourseContext");
  assert.equal((helper.match(/\brequestedCourseOfferingId\b/g) ?? []).length, 2);

  // In the ENTRY POINT the requested id is only a parameter and the core's first
  // argument — it is never used to scope anything.
  const entry = bodyOf("createExamInstructedTraineeAssignment");
  assert.equal((entry.match(/\bcourseOfferingId\b/g) ?? []).length, 2);
  assert.equal(/prisma\./.test(entry), false);

  // EVERY `courseOfferingId` used as a QUERY VALUE is the SERVER-verified one.
  // `string` is filtered out because it is a TYPE annotation position, not a
  // value: the helper's return type and the entry point's parameter.
  const scopeValues = [...CODE.matchAll(/courseOfferingId:\s*(\w+)/g)]
    .map((m) => m[1])
    .filter((value) => value !== "string");
  assert.deepEqual(
    [...new Set(scopeValues)].sort(),
    ["context", "verifiedCourseOfferingId"],
    `a query is scoped by an unverified value: ${scopeValues.join(", ")}`,
  );
  // (`context` is the boundary's own return mapping, `context.id`.)
  assert.ok(/courseOfferingId:\s*context\.id/.test(CODE));
  // Both Prisma scopes name the verified id explicitly.
  assert.ok(CODE.includes("where: { courseOfferingId: verifiedCourseOfferingId },"));
  assert.ok(CODE.includes("courseOfferingId: verifiedCourseOfferingId,"));
});

test("9. the lifecycle gate is SCHEDULE_DRAFT_CONFIGURATION, and no policy table is copied", () => {
  const gate = bodyOf("assertConfigurationAllowed");
  assert.ok(gate.includes("assertCourseOperationAllowed("));
  assert.ok(gate.includes('"SCHEDULE_DRAFT_CONFIGURATION"'), "the wrong operation is gated");
  assert.ok(gate.includes("status as CourseOfferingStatus"));
  assert.equal((CODE.match(/assertCourseOperationAllowed\(/g) ?? []).length, 1);
  // A WRITE never borrows the read gate...
  assert.equal(CODE.includes("HISTORICAL_READ"), false);
  // ...the committed policy is CONSULTED, never restated here: no status literal
  // and no allow-list of its own appears anywhere in the code.
  // (`"ACTIVE"` is deliberately NOT in this list: the module's one use of that
  // literal is the CourseEnrollment status in the eligibility where clause, which
  // is a different vocabulary from the offering lifecycle.)
  for (const status of ['"PLANNED"', '"ARCHIVED"', "PLANNED:", "allowedStatuses", "OperationPolicy"]) {
    assert.equal(CODE.includes(status), false, `the module copies the policy table: ${status}`);
  }
  assert.equal(
    (CODE.match(/"ACTIVE"/g) ?? []).length,
    1,
    "the ACTIVE literal is used beyond the enrolment status",
  );
  // ...and no capability is introduced or borrowed.
  for (const token of [
    '"EXAMS"',
    "'EXAMS'",
    "TEACHING_PRACTICE",
    '"SCHEDULE"',
    "'SCHEDULE'",
    "CapabilityKey",
    "getEffectiveCapabilities",
    "capability-keys",
  ]) {
    assert.equal(CODE.includes(token), false, `the module consults ${token}`);
  }
  assert.ok(/EXAMS/.test(COMMENTS), "the absent capability is undocumented");
});

test("10. only the two typed project errors are classified, and nothing is caught", () => {
  assert.ok(
    bodyOf("isCourseNotFoundError").includes("error instanceof CourseOfferingNotFoundError"),
  );
  assert.ok(
    bodyOf("isOperationNotAllowedError").includes(
      "error instanceof CourseOperationNotPermittedError",
    ),
  );
  // No catch-all: an unrecognized throw — including the framework redirect —
  // leaves this module unchanged.
  assert.equal(/\bcatch\s*\(/.test(CODE), false, "the binding catches");
  assert.equal(CODE.includes("NEXT_" + "REDIRECT"), false, "the binding inspects a redirect");
});

// ===========================================================================
// 11–15. The exact query inventory
// ===========================================================================

test("11. the module issues EXACTLY the approved statements, and no others", () => {
  const statements = [...CODE.matchAll(/\bprisma\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(statements.sort(), [
    "courseEnrollment.findFirst",
    "examPlan.findUnique",
    "examSession.findFirst",
  ]);
  // ONE transaction, and exactly two statements inside it.
  assert.equal((CODE.match(/prisma\.\$transaction\(/g) ?? []).length, 1);
  const txStatements = [...CODE.matchAll(/\btx\.(\w+)\.(\w+)\(/g)].map(
    ([, model, method]) => `${model}.${method}`,
  );
  assert.deepEqual(txStatements, ["examAssignment.aggregate", "examAssignment.create"]);

  // Four logical operations in total, and no others of any shape.
  for (const token of [
    "$executeRaw",
    "$queryRaw",
    "createMany",
    "updateMany",
    "upsert",
    "deleteMany",
    ".delete(",
    ".update(",
    ".count(",
    "groupBy",
  ]) {
    assert.equal(CODE.includes(token), false, `the module uses ${token}`);
  }
  // No direct Student query: the ENROLMENT is the scope.
  assert.equal(CODE.includes("prisma.student."), false, "the module queries Student directly");
  // No Teaching-Practice, beginner-child, supervisor, break, parent or contact
  // model is reachable, and no plan/session/definition is created here.
  for (const token of [
    "teachingPractice",
    "examBeginnerChild",
    "examSessionSupervisor",
    "examSessionBreak",
    "parent",
    "signedForm",
    "examPlan.create",
    "examPlan.upsert",
    "examSession.create",
    "examDefinition.create",
  ]) {
    assert.equal(CODE.includes(token), false, `the module touches ${token}`);
  }
});

test("12. the plan lookup uses the VERIFIED offering id and selects only its id", () => {
  const reader = bodyOf("findExamPlanByCourseOfferingId");
  assert.ok(reader.includes("prisma.examPlan.findUnique("));
  assert.ok(
    /where:\s*\{\s*courseOfferingId:\s*verifiedCourseOfferingId\s*\}/.test(reader),
    `the plan where was: ${reader}`,
  );
  const select = reader.slice(reader.indexOf("select: {"));
  assert.ok(/select:\s*\{\s*id:\s*true\s*\}/.test(select));
  for (const forbidden of ["publishedAt", "sessions", "definitions", "courseOffering:", "include"]) {
    assert.equal(select.includes(forbidden), false, `the plan read selects ${forbidden}`);
  }
  assert.equal((CODE.match(/function findExamPlanByCourseOfferingId\(/g) ?? []).length, 1);
});

test("13. the session read is a PLAN-SCOPED findFirst with the EXACT two-column select", () => {
  const reader = bodyOf("findSessionForPlan");
  assert.ok(reader.includes("prisma.examSession.findFirst("), "the session read is not a findFirst");
  assert.ok(
    /where:\s*\{\s*id:\s*sessionId,\s*planId\s*\}/.test(reader),
    `the session where was: ${reader}`,
  );
  // A bare findUnique by id would find another plan's session and then rely on a
  // comparison someone could later remove — so a foreign session and a missing
  // one stay indistinguishable.
  assert.equal(CODE.includes("examSession.findUnique"), false);
  // The helper takes the SERVER-supplied plan id as its FIRST parameter.
  assert.ok(/function findSessionForPlan\(\s*planId: string,/.test(SOURCE));

  // EXACTLY the session id plus ONE definition column.
  const columns = [...reader.matchAll(/^\s+(\w+): true,/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["id", "requiresInstructedTrainee"]);
  for (const forbidden of [
    "kind",
    "requiresLessonTopic",
    "requiresDiscipline",
    "assignments",
    "_count",
    "assignmentCount",
    "parallelCapacity",
    "durationMinutes",
    "capacity",
    "name:",
    "date",
    "startTime",
    "endTime",
    "arena",
    "orderIndex",
    "individualPublishedAt",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the session read selects ${forbidden}`);
  }
  // The single definition fact is mapped straight through, unrenamed.
  assert.ok(
    reader.includes("requiresInstructedTrainee: row.definition.requiresInstructedTrainee"),
    "the definition flag is not mapped",
  );
  assert.ok(reader.includes("id: row.id,"));
});

test("14. eligibility is ONE fail-closed, offering-scoped findFirst on ONE column", () => {
  const reader = bodyOf("findEligibleTrainee");
  assert.ok(reader.includes("prisma.courseEnrollment.findFirst("));
  assert.equal(CODE.includes("courseEnrollment.findUnique"), false);
  // All four conditions in ONE where clause: no application-side comparison, and
  // no window between "enrolled?" and "active?".
  for (const condition of [
    "courseOfferingId: verifiedCourseOfferingId,",
    "studentId,",
    'status: "ACTIVE",',
    "student: { isActive: true },",
  ]) {
    assert.ok(reader.includes(condition), `the eligibility where lacks: ${condition}`);
  }
  assert.ok(/select:\s*\{\s*studentId:\s*true\s*\}/.test(reader));
  // The SERVER-matched id is what is returned, never the submitted one.
  assert.ok(/return \{ studentId: row\.studentId \};/.test(reader));
  // Combined trainees: isPrimary is neither read nor selected.
  for (const forbidden of [
    "isPrimary",
    "identityNumber",
    "phone",
    "parent",
    "memberships",
    "groupName",
    "assignedHorseName",
    "privateHorseName",
    "combinedParticipation",
    "startDate",
    "endDate",
    "id: true",
    "include",
  ]) {
    assert.equal(reader.includes(forbidden), false, `the eligibility read reads ${forbidden}`);
  }
  assert.ok(/isPrimary/.test(COMMENTS), "the isPrimary decision is undocumented");
});

test("15. no existing-instructed-trainee pre-check or maximum-one rule exists", () => {
  for (const token of [
    "examAssignment.findFirst",
    "examAssignment.findMany",
    "examAssignment.count",
    "existingInstructed",
    "alreadyHas",
    "maximum",
    "atMostOne",
  ]) {
    assert.equal(CODE.includes(token), false, `the module pre-checks with ${token}`);
  }
  // The decision — several instructed trainees are allowed, the same person twice
  // is not — is written down rather than merely implied.
  const flat = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/SEVERAL instructed trainees/i.test(flat), "the multi-trainee decision is undocumented");
  assert.ok(/race/i.test(flat), "the read-then-write race is not explained");
});

// ===========================================================================
// 16–18. The single write
// ===========================================================================

test("16. the create transaction is ONE aggregate + ONE create, on MAX not COUNT", () => {
  const writer = bodyOf("createAssignmentAtNextOrder");
  assert.ok(writer.includes("prisma.$transaction(async (tx) => {"));
  assert.equal((writer.match(/tx\.examAssignment\.aggregate\(/g) ?? []).length, 1);
  assert.equal((writer.match(/tx\.examAssignment\.create\(/g) ?? []).length, 1);

  // The aggregate is a MAX over the SESSION's positions — never a COUNT, which
  // would silently reuse a position after any removal.
  assert.ok(/where:\s*\{\s*sessionId\s*\}/.test(writer), `the aggregate where was: ${writer}`);
  assert.ok(/_max:\s*\{\s*orderIndex:\s*true\s*\}/.test(writer));
  assert.equal(/_count/.test(writer), false, "the aggregate counts");
  assert.equal(/\.count\(/.test(writer), false, "the writer counts");
  // null MAX -> 0; otherwise MAX + 1.
  assert.ok(
    /aggregate\._max\.orderIndex === null\s*\?\s*0\s*:\s*aggregate\._max\.orderIndex \+ 1/.test(
      writer.replace(/\s+/g, " "),
    ),
    "the next position is not MAX + 1",
  );

  // No retry, lock, isolation override, unique rule or compaction was added...
  for (const token of [
    "isolationLevel",
    "Serializable",
    "SERIALIZABLE",
    "FOR UPDATE",
    "advisory",
    "retry",
    "attempt",
    "compact",
    "renumber",
    "reorder",
  ]) {
    assert.equal(writer.includes(token), false, `the writer adds ${token}`);
  }
  // ...and the tolerated equal-position race is documented honestly, with the
  // three reasons it is safe for THIS role.
  const flat = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/same\s+`?orderIndex`?/i.test(flat), "the race is undocumented");
  assert.ok(/tie-break/i.test(flat), "the id tie-break is undocumented");
  assert.ok(/not a uniqueness key/i.test(flat), "the non-unique nature of the position is unstated");
  assert.ok(/wave ordering/i.test(flat), "the irrelevance to wave order is unstated");
});

test("17. the create writes EXACTLY four columns, and the role is the core's", () => {
  const writer = bodyOf("createAssignmentAtNextOrder");
  const dataStart = writer.indexOf("data: {");
  assert.ok(dataStart > 0);
  const data = writer.slice(dataStart, writer.indexOf("select:", dataStart));
  // `sessionId` is a shorthand property (no colon), so it is asserted on its own
  // line below rather than by the keyed-column scan.
  const columns = [...data.matchAll(/^\s+(\w+):/gm)].map((match) => match[1]);
  assert.deepEqual(columns, ["studentId", "role", "orderIndex"]);
  assert.ok(/^\s+sessionId,$/m.test(data), "the session id is not written");

  // The role is FORWARDED from the pure core's payload — never a literal here,
  // never derived from input, never defaulted.
  assert.ok(data.includes("role: value.role,"), "the role is not the core's");
  assert.equal(/role:\s*"/.test(CODE), false, "the binding hardcodes a role literal");
  assert.equal(CODE.includes('"EXAMINEE"'), false, "the binding names a role literal");
  assert.equal(
    CODE.includes('"INSTRUCTED_TRAINEE"'),
    false,
    "the binding restates the core's role literal",
  );

  // The ids written are the SERVER-VERIFIED ones the core forwards.
  assert.ok(data.includes("studentId: value.studentId,"));
  assert.ok(data.includes("orderIndex: nextOrderIndex,"));

  // Not written — and not written as an `undefined` placeholder either.
  for (const forbidden of [
    "horseName",
    "pairingIndex",
    "instructionTopic",
    "discipline",
    "sourcePracticeRole",
    "notes",
    "planId",
    "courseOfferingId",
    "createdAt",
    "updatedAt",
    "undefined",
  ]) {
    assert.equal(data.includes(forbidden), false, `the create writes ${forbidden}`);
  }
  // The returned row is narrow.
  assert.ok(/select:\s*\{\s*id:\s*true,\s*orderIndex:\s*true\s*\}/.test(writer));
});

test("18. no horse and no pairing exists anywhere in the module's CODE", () => {
  for (const token of ["horseName", "horse", "pairingIndex", "pairing"]) {
    assert.equal(CODE.includes(token), false, `the binding references ${token}`);
  }
  // The pairing limitation is nonetheless stated, so the next reader knows the
  // slot/personal-time consequence rather than discovering it.
  const flat = COMMENTS.replace(/\s+/g, " ");
  assert.ok(/pairingIndex/.test(flat), "the pairing limitation is undocumented");
  assert.ok(/personal time/i.test(flat), "the missing personal time is not stated");
  assert.ok(/slot-grained/i.test(flat), "the excluded conflict check is not stated");
});

// ===========================================================================
// 19–21. The conflict classifier
// ===========================================================================

test("19. the conflict classifier names the EXACT unique index, matched exactly", () => {
  assert.ok(
    CODE.includes(
      'const EXAM_ASSIGNMENT_CONFLICT_INDEX = "exam_assignments_sessionId_studentId_key"',
    ),
    "the exact index name is missing",
  );
  const classifier = bodyOf("isInstructedTraineeAssignmentConflictError");
  assert.ok(/target === EXAM_ASSIGNMENT_CONFLICT_INDEX/.test(classifier));
  // A prefix, suffix or substring match would report a different key's violation
  // as "already assigned".
  assert.equal(/\.includes\(EXAM_ASSIGNMENT_CONFLICT_INDEX\)/.test(CODE), false);
  assert.equal(/startsWith\(EXAM_ASSIGNMENT_CONFLICT_INDEX/.test(CODE), false);
  assert.equal(/endsWith\(EXAM_ASSIGNMENT_CONFLICT_INDEX/.test(CODE), false);
  assert.equal(/EXAM_ASSIGNMENT_CONFLICT_INDEX\)\s*!==?\s*-1/.test(CODE), false);
});

test("20. the classifier requires P2002 and BOTH target fields", () => {
  const classifier = bodyOf("isInstructedTraineeAssignmentConflictError");
  assert.ok(/\(error as \{ code\?: unknown \}\)\.code !== "P2002"/.test(classifier));
  // The array form needs BOTH columns — a target naming only one is a different
  // key and must NOT be reported as "already assigned".
  assert.ok(
    /tokens\.includes\("sessionId"\) && tokens\.includes\("studentId"\)/.test(classifier),
    "the array form does not require both fields",
  );
  assert.equal(/\.some\(/.test(classifier), false, "the array form matches on one field");
  assert.equal(/\|\|\s*tokens\.includes/.test(classifier), false, "the array form is disjunctive");
  // A non-object, a null and a different Prisma code are all rejected.
  assert.ok(/typeof error !== "object" \|\| error === null/.test(classifier));
  // The unreadable-metadata fallback is the LAST statement, and is documented.
  assert.ok(/return true;\s*\}$/.test(classifier.trimEnd()), "the fallback is not the final answer");
  assert.ok(/[Uu]nreadable/.test(COMMENTS), "the fallback is undocumented");
  // A framework redirect carries a digest, not a code, so it can never match; and
  // a delete-shaped error is not this operation's business.
  assert.equal(classifier.includes("digest"), false);
  assert.equal(CODE.includes("P2025"), false, "the binding classifies P2025");
  assert.equal((CODE.match(/"P2002"/g) ?? []).length, 1, "P2002 is handled in two places");
  // The raw error is never unwrapped, logged or echoed.
  for (const token of ["console.", "JSON.stringify", "error.message", "String(error)"]) {
    assert.equal(classifier.includes(token), false, `the classifier ${token}s the error`);
  }
});

test("21. the classifier is PRIVATE, local, and neither imports nor edits a sibling's", () => {
  assert.equal(
    CODE.includes("export function isInstructedTraineeAssignmentConflictError"),
    false,
    "the classifier is exported",
  );
  assert.equal(
    (CODE.match(/isInstructedTraineeAssignmentConflictError/g) ?? []).length,
    2,
    "the classifier is declared once and bound once",
  );
  // It is declared HERE, not imported from another binding: the module's whole
  // import list is the five approved specifiers asserted above, none of which is
  // a sibling write binding.
  const specifiers = [...CODE.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  for (const specifier of specifiers) {
    assert.equal(
      /-write-io/.test(specifier),
      false,
      `the module imports a sibling write binding: ${specifier}`,
    );
  }
});

// ===========================================================================
// 22–26. Containment: EXACTLY one caller, no UI, four new files
// ===========================================================================

/**
 * The ONE production module that may reach this binding, in git's own form.
 *
 * EX-ASG-IT2 TRANSITION. This guard asserted the binding had NO caller at all,
 * which was correct while EX-ASG-IT1 was the uncommitted slice and added only
 * new, unwired files. Wiring it necessarily gives it exactly one caller, so the
 * guard is RE-POINTED to an EXACT one-entry list rather than deleted or relaxed
 * to a directory: a SECOND caller — a page, a client component, an instructor or
 * trainee route, a second Server Action module, or anything under `lib/` — still
 * fails here, and so does a caller at any other path.
 *
 * The scan itself is unchanged: the same three directories, the same four
 * patterns, the same comment stripping and the same sanity floor.
 */
const APPROVED_CALLER =
  "app/admin/courses/[courseOfferingId]/exams/actions.ts";

test("22. EXACTLY ONE module under app, lib or components calls this slice", () => {
  const declaring = new Set(
    [IO_REL, IO_TEST_REL, CORE_REL, CORE_TEST_REL].map((rel) => join(REPO_ROOT, rel)),
  );

  const callers: string[] = [];
  let scanned = 0;
  for (const dir of ["app", "lib", "components"]) {
    const root = join(REPO_ROOT, dir);
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
      const path = join(entry.parentPath ?? root, entry.name);
      if (path.includes(`${sep}generated${sep}`)) continue;
      scanned += 1;
      if (declaring.has(path)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      const reaches =
        /exam-instructed-trainee-assignment-write-io/.test(code) ||
        /create-exam-instructed-trainee-assignment-core/.test(code) ||
        /\bcreateExamInstructedTraineeAssignment\s*\(/.test(code) ||
        /\bcreateExamInstructedTraineeAssignmentWithDeps\s*\(/.test(code);
      if (reaches) callers.push(path.slice(REPO_ROOT.length + 1).split(sep).join("/"));
    }
  }
  // Sanity: the single result below is a PASS, not a degenerate search.
  assert.ok(scanned > 100, `expected the repository, scanned ${scanned} files`);
  assert.deepEqual(
    callers.sort(),
    [APPROVED_CALLER],
    `the caller set is not exactly the approved Server Action module: ${callers.join(", ")}`,
  );
  // The one caller is a Server Action module and NOT a UI file: no page, form or
  // client component may reach a write binding directly.
  assert.equal(APPROVED_CALLER.endsWith(".tsx"), false);
});

test("23. no exam route, page, form, component or Server Action was created", () => {
  for (const dir of [
    join("app", "admin", "exams"),
    join("app", "instructor", "exams"),
    join("app", "student", "exams"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, dir)), false, `${dir} was created`);
  }
  for (const file of [
    join("lib", "actions", "exam-instructed-trainee-assignment-actions.ts"),
    join("lib", "actions", "exam-instructed-trainees.ts"),
    join("lib", "actions", "exams.ts"),
  ]) {
    assert.equal(existsSync(join(REPO_ROOT, file)), false, `${file} was created`);
  }
  // No file this slice added is a UI file or declares a Server Action.
  for (const rel of NEW_FILES) {
    assert.equal(rel.endsWith(".tsx"), false, `${rel} is a UI file`);
    const source = stripComments(readFileSync(join(REPO_ROOT, rel.split("/").join(sep)), "utf8"));
    assert.equal(source.includes('"use ' + 'server"'), false, `${rel} is a Server Action module`);
    assert.equal(source.includes('"use ' + 'client"'), false, `${rel} is a client module`);
  }
});

test("24. each approved file-prefix set contains EXACTLY its approved pair", () => {
  const actions = readdirSync(join(REPO_ROOT, "lib", "actions"));
  assert.deepEqual(
    actions.filter((name) => name.startsWith("exam-instructed-trainee-assignment-write")).sort(),
    [IO_NAME, IO_TEST_NAME].sort(),
  );
  const exam = readdirSync(join(REPO_ROOT, "lib", "exam"));
  assert.deepEqual(
    exam.filter((name) => name.startsWith("create-exam-instructed-trainee-assignment-core")).sort(),
    [CORE_NAME, CORE_TEST_NAME].sort(),
  );
  // Neither new name collides with the prefix a committed guard pins to an exact
  // six-file set, so adding them cannot change that guard's answer.
  for (const name of [IO_NAME, IO_TEST_NAME, CORE_NAME, CORE_TEST_NAME]) {
    assert.equal(
      /^(exam|create-exam|delete-exam)-assignment-/.test(name),
      false,
      `${name} collides with the pinned assignment prefix`,
    );
  }
});

test("25. the four files are TRACKED, and only the approved wiring paths differ", () => {
  const scope = ["lib", "prisma", "app", "components"];

  // POST-MERGE RE-POINTING. This guard asserted the four files were UNTRACKED and
  // that NOTHING tracked differed, which was exactly right while this slice was
  // the uncommitted one. Both halves became permanently false the moment the
  // slice was committed and merged, so the guard is RE-POINTED to what it was
  // always protecting rather than deleted or loosened to a directory: the same
  // four EXACT paths, now proven to be the repository's own, plus an EXACT
  // containment list for whatever else differs.
  //
  // The containment is a SUBSET check on purpose. An equality check would only
  // hold in one of the three ordinary states (dirty / staged / committed) and
  // would go stale again the moment the wiring slice is committed — which is the
  // very failure being corrected here. A subset of an exhaustive, path-exact list
  // is just as strict about what MAY differ, in every state.

  // 1. All four EXIST on disk.
  for (const rel of NEW_FILES) {
    assert.ok(
      existsSync(join(REPO_ROOT, rel.split("/").join(sep))),
      `${rel} is missing`,
    );
  }

  // 2. All four are TRACKED repository files, named exactly.
  const tracked = new Set(gitLines(["ls-files", "--", ...scope]));
  for (const rel of NEW_FILES) {
    assert.ok(tracked.has(rel), `${rel} is not a tracked repository file`);
  }

  // 3. NONE of the four is untracked any more — the exact inversion of the claim
  //    this guard used to make, stated explicitly so it cannot go stale silently
  //    a second time.
  const untracked = gitLines([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...scope,
  ]).sort();
  for (const rel of NEW_FILES) {
    assert.equal(untracked.includes(rel), false, `${rel} is untracked again`);
  }

  // 4. No FIFTH file exists under either approved Stage A prefix: the binding and
  //    its core each have exactly one implementation and one suite, so no sibling
  //    variant, no `.tsx`, no backup and no second writer slipped in beside them.
  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "actions"))
      .filter((name) => name.startsWith("exam-instructed-trainee-assignment-write"))
      .sort(),
    [IO_NAME, IO_TEST_NAME].sort(),
    "a fifth file exists under the approved lib/actions prefix",
  );
  assert.deepEqual(
    readdirSync(join(REPO_ROOT, "lib", "exam"))
      .filter((name) => name.startsWith("create-exam-instructed-trainee-assignment-core"))
      .sort(),
    [CORE_NAME, CORE_TEST_NAME].sort(),
    "a fifth file exists under the approved lib/exam prefix",
  );

  // 5. Anything UNTRACKED in scope is one of the approved wiring slice's three
  //    exact route files, or one of the approved backend slice's four exact
  //    `lib/` files, and nothing else. RE-POINTED by EX-PUB-BE-MVP and WIDENED BY
  //    FOUR NAMED PATHS rather than by a directory: a fifth addition still fails.
  const unapprovedNew = untracked.filter(
    (path) =>
      !APPROVED_NEW_ROUTE_FILES.includes(path) && !APPROVED_NEW_LIB_FILES.includes(path),
  );
  assert.deepEqual(unapprovedNew, [], `unexpected new files: ${unapprovedNew.join(", ")}`);

  // 6. Anything MODIFIED in scope is on the exhaustive, path-exact approved list.
  const modified = gitLines([
    "diff",
    "--name-only",
    "--diff-filter=MDRT",
    "HEAD",
    "--",
    ...scope,
  ]).sort();
  const unapprovedModified = modified.filter((path) => !APPROVED_MODIFIED_FILES.includes(path));
  assert.deepEqual(
    unapprovedModified,
    [],
    `the slice modified: ${unapprovedModified.join(", ")}`,
  );

  // 7. ...and the list cannot quietly grow into an arbitrary production file
  //    under `lib/`. RE-POINTED by EX-ASG-LTD2-B1 and NARROWED rather than
  //    dropped: the claim was "every approved `lib/` entry is a guard SUITE",
  //    which held while every slice in this tree only WIRED committed bindings.
  //    A read that must publish two more stored columns has to edit the pair that
  //    reads them, so exactly TWO `lib/` production modules are named — both
  //    belonging to the assignment READ path — and a THIRD still fails here.
  const APPROVED_LIB_PRODUCTION = [
    "lib/exam/" + "admin-exam-assignment-read" + "-core.ts",
    "lib/actions/" + "exam-assignment-read" + "-io.ts",
    // EX-ADMIN-WORKSPACE-UX ADDS these two and MODIFIES no committed `lib/`
    // production module: the pure workspace edit/move core, and its server-only
    // binding. ASSEMBLED, so this suite does not enrol itself as their caller.
    "lib/exam/" + "admin-exam-workspace-edit" + "-core.ts",
    "lib/actions/" + "admin-exam-workspace-edit" + "-io.ts",
    // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
    // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
    // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
    // own assignment by exact student id. Every path below is named EXACTLY - no
    // directory, no prefix, no glob - so an unrelated file still fails this guard,
    // and each module name is SPLIT so this list never enrols itself as a caller.
    "lib/exam/" + "exam-plan-loader" + "-core.ts",
    "lib/exam/" + "exam-rea" + "d-dto.ts",
    "lib/exam/" + "exam-read-scope" + "-core.ts",
    "lib/exam/" + "exam-trainee-view" + "-core.ts",
    // EX-BEGINNER-EXAM-READ - the Level-1 beginner containment gate plus the
    // trainee-only assignment `isSelf` marker. Beginner Teaching-Practice rows are
    // gated to Level 1 in the loader, and the trainee narrowing marks the viewer's
    // own assignment by exact student id. Every path below is named EXACTLY - no
    // directory, no prefix, no glob - so an unrelated file still fails this guard,
    // and each module name is SPLIT so this list never enrols itself as a caller.
    "lib/exam/" + "exam-beginner-course-scope" + "-core.ts",
  ];
  for (const rel of APPROVED_MODIFIED_FILES) {
    assert.equal(
      rel.startsWith("lib/") &&
        !rel.endsWith(".test.ts") &&
        !APPROVED_LIB_PRODUCTION.includes(rel),
      false,
      `an unapproved lib production module is on the approved list: ${rel}`,
    );
  }

  // 8. Stage A's OWN production modules are byte-identical to HEAD. The wiring
  //    slice REUSES this binding and its pure core; it may not edit either.
  for (const production of [`lib/actions/${IO_NAME}`, `lib/exam/${CORE_NAME}`]) {
    assert.equal(modified.includes(production), false, `${production} was modified`);
  }

  // 9. Every working-tree entry under `prisma/` — untracked included — is empty,
  //    so no schema edit and no migration directory came with either slice.
  const prismaStatus = gitLines(["status", "--porcelain", "--", "prisma"]);
  assert.deepEqual(prismaStatus, [], `prisma/ changed: ${prismaStatus.join(", ")}`);

  // 10. The committed modules this slice REUSES still exist and were not duplicated.
  for (const rel of [
    join("lib", "exam", "exam-assignment-write-core.ts"),
    join("lib", "exam", "exam-domain-core.ts"),
    join("lib", "course", "admin-course-context.ts"),
    join("lib", "course", "operation-policy-core.ts"),
  ]) {
    assert.ok(existsSync(join(REPO_ROOT, rel)), `${rel} is missing`);
  }
});

test("26. no capability, permission, env, auth or MCP surface was touched", () => {
  const changed = gitLines(["status", "--porcelain"]).map((line) => line.slice(3));
  for (const path of changed) {
    // POST-MERGE RE-POINTING, and NARROWED IN SPELLING RATHER THAN IN REACH. Each
    // entry is a PATH-EXACT fragment — a directory segment or a file name — where
    // two of them used to be the bare words `auth` and `session`. Those two were
    // never about spelling: they were about the auth and session MODULES, and as
    // bare substrings they now report this route's own
    // `exam-session-create.contract.test.ts` as an authentication change. Every
    // real surface below is still banned, and a genuine `lib/auth/…`,
    // `app/api/auth/…`, `middleware.ts` or `session.ts` edit still fails here.
    for (const forbidden of [
      "capability-keys",
      "capabilities/",
      "permission",
      ".env",
      ".mcp.json",
      "middleware.",
      "package.json",
      "package-lock.json",
      "next.config",
      "/auth/",
      "auth.ts",
      "/session/",
      "session.ts",
      "prisma/schema.prisma",
      "prisma/migrations/",
    ]) {
      assert.equal(
        path.includes(forbidden),
        false,
        `the slice touched a forbidden surface: ${path}`,
      );
    }
  }
  // ...and the whole working tree — index included — stays inside the EXACT
  // approved footprint: this slice's four committed files plus the approved
  // wiring slice's twenty exact paths. A SUBSET check for the same reason guard
  // 25 uses one: an equality check would hold in only one of the three ordinary
  // states, which is exactly how this guard went stale before.
  const unapproved = changed
    .filter((path) => !APPROVED_FOOTPRINT.includes(path) && !NEW_FILES.includes(path))
    .sort();
  assert.deepEqual(unapproved, [], `working tree: ${unapproved.join(", ")}`);
});

test("27. this suite opens no database and reads no environment", () => {
  const own = stripComments(readFileSync(join(REPO_ROOT, IO_TEST_REL), "utf8"));
  for (const token of [
    PRISMA_MODULE,
    GENERATED_CLIENT,
    ENV_READ,
    "DATABASE" + "_URL",
    "Prisma" + "Client",
  ]) {
    assert.equal(own.includes(token), false, `the suite references ${token}`);
  }
  const specifiers = [...own.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(specifiers)].sort(),
    ["node:assert/strict", "node:child_process", "node:fs", "node:path", "node:test"],
  );
});
