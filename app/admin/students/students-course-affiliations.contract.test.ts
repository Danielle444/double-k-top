/**
 * MULTI-COURSE (course-affiliation display slice A2) - DB-free CONTRACT/source
 * tests for wiring the committed A1 affiliation read model into the GENERAL admin
 * trainees screen and rendering compact course-affiliation badges.
 *
 * Runs no Prisma and opens no DB. It:
 *   - statically inspects app/admin/students/page.tsx to prove the server-page
 *     wiring invariants (requireAdmin FIRST, the A1 reader is the single trainee
 *     list source, the old bare prisma.student.findMany is gone, affiliation is
 *     handed to the client, no affiliation-inference resolver, unrelated reads
 *     preserved, no write/mutation introduced);
 *   - statically inspects app/admin/students/StudentsClient.tsx to prove the badge
 *     contract (renders from the A1 summary only, `רמה N` per visible affiliation,
 *     keyed by courseOfferingId, full name in the tooltip, `ללא קורס` neutral
 *     badge, wrap-capable container, no group-derived badge, no recomputation from
 *     raw courseEnrollments, no affiliation editing control, legacy trainee UI
 *     preserved);
 *   - exercises the committed A1 PURE core so the exact L1 / L2 / dual / no-course
 *     display values the badges render are pinned.
 *
 * ACTIVATION GUARD (slice G3) additionally pins the UI half of the staged-trainee
 * guard on the SAME two files: the reader row's `activationBlocked` is forwarded by
 * the page, the client renders the committed `בהכנה לקורס` label beside (never
 * instead of) the existing status chip, the toggle is disabled in the ACTIVATION
 * direction only, and the server action's ActionResult is finally consumed so a
 * refusal is visible instead of silent. The authoritative refusal itself is G2's
 * and is covered by lib/actions/student-activation-guard.contract.test.ts.
 *
 * Run: npx tsx --test "app/admin/students/students-course-affiliations.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildTraineeAffiliationSummary,
  buildTraineeAffiliationRows,
  NO_COURSE_LABEL,
  type RawAffiliationEnrollment,
} from "@/lib/course/trainee-affiliations-core";
import {
  STAGED_TRAINEE_ROW_LABEL,
  STAGED_TRAINEE_ACTIVATION_TOOLTIP,
} from "@/lib/course/staged-trainee-activation-core";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments. Neither file contains `//`
// inside a string or regex literal, so this naive strip is safe here.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function read(relative: string): string {
  return stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
}

const pageSrc = read("./page.tsx");
const clientSrc = read("./StudentsClient.tsx");

const ENROLLMENT = (
  overrides: Partial<RawAffiliationEnrollment> & {
    courseOffering: RawAffiliationEnrollment["courseOffering"];
  },
): RawAffiliationEnrollment => ({
  id: overrides.id ?? "e1",
  status: overrides.status ?? "ACTIVE",
  isPrimary: overrides.isPrimary ?? false,
  courseOfferingId: overrides.courseOfferingId ?? overrides.courseOffering.id,
  courseOffering: overrides.courseOffering,
});

// ---------------------------------------------------------------------------
// Server page: authorization order + single authoritative reader
// ---------------------------------------------------------------------------

test("page authorizes (requireAdmin) BEFORE loading any trainee data", () => {
  const admin = pageSrc.indexOf("requireAdmin(");
  const reader = pageSrc.indexOf("listStudentsWithCourseAffiliationsForAdmin(");
  assert.ok(admin > -1, "requireAdmin call not found");
  assert.ok(reader > -1, "A1 reader call not found");
  assert.ok(admin < reader, "requireAdmin must precede the trainee-list read");
});

test("page reads the trainee list through the committed A1 reader", () => {
  assert.ok(
    pageSrc.includes("listStudentsWithCourseAffiliationsForAdmin()"),
    "page must call the A1 reader",
  );
});

test("the old bare prisma.student.findMany is no longer the trainee-list source", () => {
  assert.ok(
    !pageSrc.includes("prisma.student.findMany"),
    "page must not read the trainee list via prisma.student.findMany",
  );
});

test("no second Student list query exists on the page", () => {
  const matches = pageSrc.match(/prisma\.student\./g) ?? [];
  assert.equal(matches.length, 0, "there must be no prisma.student.* query left on the page");
  const readerCalls = pageSrc.match(/listStudentsWithCourseAffiliationsForAdmin\(\)/g) ?? [];
  assert.equal(readerCalls.length, 1, "the A1 reader is the single trainee-list read");
});

test("the affiliation summary is passed to StudentsClient", () => {
  assert.ok(pageSrc.includes("affiliation: s.affiliation"), "affiliation must be forwarded to the client");
  assert.ok(pageSrc.includes("<StudentsClient"), "StudentsClient must receive the rows");
});

test("the page introduces NO Student / group / enrollment mutation", () => {
  // Concrete mutation call sites only - never a broad substring, so a legitimate
  // pre-existing import (e.g. the group-change error helper from
  // create-trainee-enrollment-core) is not misread as a write.
  for (const forbidden of [
    "student.update",
    "student.create",
    "student.delete",
    "createStudent(",
    "updateStudent(",
    "changeTraineeGroup(",
    "courseEnrollment.create",
    "courseEnrollment.update",
    "enrollExistingTrainee(",
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
  }
});

test("no current-offering resolver feeds affiliation inference (reader owns identity)", () => {
  // Affiliation identity is owned entirely by the A1 reader: it is called with NO
  // offering/cookie argument, and the badges are handed the reader row's own
  // `s.affiliation`. resolveCurrentCourseOffering is preserved for the pre-existing
  // group-change control ONLY and is called with no argument there too - it never
  // produces the trainee list or its affiliations.
  assert.ok(
    pageSrc.includes("listStudentsWithCourseAffiliationsForAdmin()"),
    "the reader takes no offering/cookie argument",
  );
  assert.ok(pageSrc.includes("affiliation: s.affiliation"), "badges use the reader row's own affiliation");
  // The affiliation forwarded to the client is EXACTLY the reader row's own
  // `s.affiliation`; there is no `affiliation:` assignment sourced from the
  // resolver/cookie/singleton anywhere on the page.
  const affiliationAssignments = pageSrc.match(/affiliation:\s*[^,\n]+/g) ?? [];
  assert.deepEqual(
    affiliationAssignments,
    ["affiliation: s.affiliation"],
    "the only affiliation assignment must be the reader row's own affiliation",
  );
});

test("unrelated existing page reads remain intact (presets, courseSettings, group-change)", () => {
  assert.ok(pageSrc.includes("availabilityRangePreset.findMany"), "presets read preserved");
  assert.ok(pageSrc.includes("courseSettings.findUnique"), "course settings read preserved");
  assert.ok(pageSrc.includes("resolveCurrentCourseOffering"), "group-change resolver preserved");
  assert.ok(pageSrc.includes("buildLeafGroupOptions"), "group-change options preserved");
});

// ---------------------------------------------------------------------------
// Client: badge contract
// ---------------------------------------------------------------------------

test("the client row type carries the affiliation summary", () => {
  assert.ok(clientSrc.includes("affiliation: TraineeAffiliationSummary"), "StudentRow must include affiliation");
  assert.ok(
    clientSrc.includes('import type { TraineeAffiliationSummary } from "@/lib/course/trainee-affiliations"'),
    "affiliation type must come from the A1 reader module",
  );
});

test("the no-course state renders the neutral ללא קורס badge", () => {
  assert.ok(clientSrc.includes("hasNoActiveCourse"), "must branch on hasNoActiveCourse");
  assert.ok(clientSrc.includes("NO_COURSE_LABEL"), "must render the A1 NO_COURSE_LABEL");
  assert.equal(NO_COURSE_LABEL, "ללא קורס");
});

test("each visible affiliation renders a `רמה N` badge from the level", () => {
  assert.ok(clientSrc.includes("visibleAffiliations.map"), "must iterate visibleAffiliations");
  assert.ok(clientSrc.includes("רמה {aff.level}"), "badge text is `רמה` + the offering level");
});

test("the badge key is the courseOfferingId (never level or name)", () => {
  assert.ok(clientSrc.includes("key={aff.courseOfferingId}"), "badge key must be courseOfferingId");
  assert.ok(!clientSrc.includes("key={aff.level}"), "badge key must not be level");
  assert.ok(!clientSrc.includes("key={aff.name}"), "badge key must not be name");
});

test("the full offering name is used in the badge title/tooltip", () => {
  assert.ok(clientSrc.includes("title={aff.name}"), "badge title must be the full offering name");
});

test("badges never derive from groupName/subgroupNumber", () => {
  // The badge component reads only from `affiliation`; the group fields are used
  // solely by the legacy group column, filters, and sorters - never by the badge.
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  assert.ok(badgeBlock.length > 0, "badge component block not found");
  assert.ok(!badgeBlock.includes("groupName"), "badge must not read groupName");
  assert.ok(!badgeBlock.includes("subgroupNumber"), "badge must not read subgroupNumber");
});

test("affiliation is NOT recomputed from raw courseEnrollments in the component", () => {
  assert.ok(!clientSrc.includes("courseEnrollments"), "client must not touch raw courseEnrollments");
  assert.ok(
    !clientSrc.includes("buildTraineeAffiliationSummary"),
    "client must not rebuild the summary - it consumes A1's derived summary",
  );
});

test("the badge container is wrap-capable (responsive, no horizontal overflow)", () => {
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  assert.ok(badgeBlock.includes("flex-wrap"), "badge cluster must wrap");
});

test("no affiliation editing control is added", () => {
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  for (const forbidden of ["onClick", "onChange", "<button", "<select", "<input", "Button"]) {
    assert.ok(!badgeBlock.includes(forbidden), `badge must not include an interactive ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Client: legacy trainee UI preserved
// ---------------------------------------------------------------------------

test("existing masked-identity behavior remains", () => {
  assert.ok(clientSrc.includes("maskIdentityNumber(student.identityNumber)"), "masked identity preserved");
});

test("existing edit / activate / progress controls remain", () => {
  assert.ok(clientSrc.includes("openModal(student)"), "edit control preserved");
  assert.ok(clientSrc.includes("handleToggleActive(student)"), "activation toggle preserved");
  assert.ok(clientSrc.includes("/admin/trainee-progress?studentId="), "progress link preserved");
});

test("existing legacy group / subgroup display remains", () => {
  assert.ok(clientSrc.includes("{student.groupName ?? \"-\"}"), "legacy group column preserved");
  assert.ok(clientSrc.includes("{student.subgroupNumber ?? \"-\"}"), "legacy subgroup column preserved");
});

test("existing group filter behavior is preserved", () => {
  assert.ok(clientSrc.includes("matchesGroupFilter"), "group filter helper preserved");
  assert.ok(clientSrc.includes("handleGroupFilterChange"), "group filter handler preserved");
});

test("the import UI is still present", () => {
  assert.ok(clientSrc.includes("ImportStudentsClient"), "import UI preserved");
});

// ---------------------------------------------------------------------------
// Pure A1 core: the exact display values the badges render (L1 / L2 / dual / none)
// ---------------------------------------------------------------------------

test("one L1 affiliation yields a single `רמה 1` badge value", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ courseOffering: { id: "o1", name: "קורס רמה 1 2026", level: 1, status: "ACTIVE" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 1);
  assert.equal(`רמה ${summary.visibleAffiliations[0].level}`, "רמה 1");
  assert.equal(summary.visibleAffiliations[0].name, "קורס רמה 1 2026");
  assert.equal(summary.hasNoActiveCourse, false);
});

test("one L2 affiliation yields a single `רמה 2` badge value", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ courseOffering: { id: "o2", name: "קורס רמה 2 2026", level: 2, status: "PLANNED" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 1);
  assert.equal(`רמה ${summary.visibleAffiliations[0].level}`, "רמה 2");
});

test("dual affiliation yields BOTH `רמה 1` and `רמה 2` (not an ambiguous count)", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ id: "e1", courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" } }),
    ENROLLMENT({ id: "e2", courseOffering: { id: "o2", name: "רמה 2", level: 2, status: "ACTIVE" } }),
  ]);
  const labels = summary.visibleAffiliations.map((a) => `רמה ${a.level}`);
  assert.deepEqual(labels, ["רמה 1", "רמה 2"]);
  assert.equal(summary.isCombined, true);
});

test("INACTIVE enrollment + ARCHIVED offering are already filtered → no-course", () => {
  const summary = buildTraineeAffiliationSummary([
    ENROLLMENT({ id: "e1", status: "INACTIVE", courseOffering: { id: "o1", name: "רמה 1", level: 1, status: "ACTIVE" } }),
    ENROLLMENT({ id: "e2", status: "ACTIVE", courseOffering: { id: "o2", name: "ארכיון", level: 2, status: "ARCHIVED" } }),
  ]);
  assert.equal(summary.visibleAffiliations.length, 0);
  assert.equal(summary.hasNoActiveCourse, true);
  assert.equal(summary.shortLabel, NO_COURSE_LABEL);
});

// ---------------------------------------------------------------------------
// G3. Activation guard: page wiring
// ---------------------------------------------------------------------------

test("G3: the page forwards the reader row's own activationBlocked", () => {
  assert.ok(
    pageSrc.includes("activationBlocked: s.activationBlocked"),
    "activationBlocked must be projected from the reader row",
  );
  const assignments = pageSrc.match(/activationBlocked:\s*[^,\n]+/g) ?? [];
  assert.deepEqual(
    assignments,
    ["activationBlocked: s.activationBlocked"],
    "the only activationBlocked assignment must be the reader row's own value",
  );
});

test("G3: no second Student query was introduced for the guard", () => {
  assert.equal((pageSrc.match(/prisma\.student\./g) ?? []).length, 0);
  assert.equal(
    (pageSrc.match(/listStudentsWithCourseAffiliationsForAdmin\(\)/g) ?? []).length,
    1,
    "the A1 reader remains the single authoritative trainee-list read",
  );
  assert.ok(
    !pageSrc.includes("courseEnrollment.findMany"),
    "the page must not read enrollments itself - the guard rides the existing read",
  );
});

// ---------------------------------------------------------------------------
// G3. Activation guard: client contract
// ---------------------------------------------------------------------------

test("G3: the client row type carries activationBlocked", () => {
  assert.ok(clientSrc.includes("activationBlocked: boolean"), "StudentRow must carry the flag");
});

test("G3: the committed G1 strings are imported, never re-typed", () => {
  assert.ok(
    clientSrc.includes('from "@/lib/course/staged-trainee-activation-core"'),
    "the label/tooltip must come from the committed G1 core",
  );
  assert.ok(clientSrc.includes("STAGED_TRAINEE_ROW_LABEL"));
  assert.ok(clientSrc.includes("STAGED_TRAINEE_ACTIVATION_TOOLTIP"));
  assert.equal(STAGED_TRAINEE_ROW_LABEL, "בהכנה לקורס");
  assert.ok(!clientSrc.includes("בהכנה לקורס"), "the label must not be duplicated as a literal");
  assert.ok(
    !clientSrc.includes(STAGED_TRAINEE_ACTIVATION_TOOLTIP),
    "the tooltip must not be duplicated as a literal",
  );
});

test("G3: the client never recomputes the policy", () => {
  assert.ok(
    !clientSrc.includes("isStagedTraineeActivationBlocked"),
    "Rule C must not run in the browser - the flag is server-derived",
  );
  assert.ok(
    !clientSrc.includes("STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE"),
    "the rejection text must come from the server result, not a client constant",
  );
});

test("G3: the existing פעיל/ה / לא פעיל/ה status chip is preserved, not replaced", () => {
  assert.ok(
    clientSrc.includes('{student.isActive ? "פעיל/ה" : "לא פעיל/ה"}'),
    "the original status chip expression must remain",
  );
  assert.ok(
    clientSrc.includes("bg-success-muted text-success"),
    "the original active chip styling must remain",
  );
});

test("G3: the בהכנה לקורס label renders ONLY for a blocked inactive trainee", () => {
  assert.ok(
    clientSrc.includes(
      "{!student.isActive && student.activationBlocked && (",
    ),
    "the row label must be gated on !isActive && activationBlocked",
  );
});

test("G3: the tooltip hangs off a non-disabled visible element", () => {
  assert.ok(
    clientSrc.includes("title={STAGED_TRAINEE_ACTIVATION_TOOLTIP}"),
    "the label span must carry the full explanation as its title",
  );
  // The label is rendered as a plain span, so the help text is real visible DOM
  // content and not reachable only through a disabled (unfocusable) control.
  const labelIndex = clientSrc.indexOf("{STAGED_TRAINEE_ROW_LABEL}");
  assert.ok(labelIndex > -1, "the row label must actually be rendered");
  assert.ok(
    clientSrc.lastIndexOf("<span", labelIndex) > clientSrc.lastIndexOf("<Button", labelIndex),
    "the row label must be a span, not button content",
  );
});

test("G3: the toggle is disabled ONLY in the activation direction", () => {
  assert.ok(
    clientSrc.includes(
      "disabled={isPending || (!student.isActive && student.activationBlocked)}",
    ),
    "the exact guarded disabled expression must be present",
  );
  // Every single use of the flag in the client is conjunction-gated on the
  // trainee being INACTIVE, so no code path can ever disable השבתה.
  const allUses = (clientSrc.match(/student\.activationBlocked/g) ?? []).length;
  const guardedUses = (
    clientSrc.match(/!student\.isActive && student\.activationBlocked/g) ?? []
  ).length;
  assert.ok(allUses > 0, "the flag must be used");
  assert.equal(guardedUses, allUses, "every use must be gated on !student.isActive");
});

test("G3: deactivation of an active trainee is never guard-disabled", () => {
  assert.ok(
    clientSrc.includes('{student.isActive ? "השבתה" : "הפעלה"}'),
    "the single two-direction toggle is preserved",
  );
  assert.ok(
    !clientSrc.includes("disabled={isPending || student.activationBlocked}"),
    "the flag must never disable the button unconditionally",
  );
});

test("G3: handleToggleActive consumes the ActionResult", () => {
  assert.ok(
    clientSrc.includes("const result = await setStudentActive(student.id, !student.isActive)"),
    "the result must be read, and the call signature must be unchanged",
  );
  assert.ok(clientSrc.includes("if (!result.success)"), "failure must be branched on");
  assert.ok(
    clientSrc.includes('setActivationError(`${student.fullName}: ${result.error ?? "אירעה שגיאה"}`)'),
    "the server error must be shown verbatim, prefixed with the trainee full name",
  );
});

test("G3: the server rejection is rendered in one banner above the table", () => {
  assert.ok(
    clientSrc.includes("{activationError && <p className=\"text-sm text-danger\">{activationError}</p>}"),
    "one inline danger banner must render the activation error",
  );
  const banner = clientSrc.indexOf("{activationError &&");
  const table = clientSrc.indexOf("<table");
  assert.ok(banner > -1 && table > -1 && banner < table, "the banner must sit above the table");
  assert.equal(
    (clientSrc.match(/\{activationError &&/g) ?? []).length,
    1,
    "exactly one activation-error surface",
  );
});

test("G3: the toggle performs no optimistic isActive mutation", () => {
  const start = clientSrc.indexOf("function handleToggleActive");
  const end = clientSrc.indexOf("function handleSaveAvailability");
  assert.ok(start > -1 && end > start, "handleToggleActive block not found");
  const block = clientSrc.slice(start, end);
  for (const forbidden of ["isActive:", "setGroupOverrides", "router.refresh", "useRouter"]) {
    assert.ok(!block.includes(forbidden), `the toggle must not use ${forbidden}`);
  }
  assert.ok(!clientSrc.includes("useRouter"), "no router refresh is introduced");
});

test("G3: no new modal, route or activation control is introduced", () => {
  assert.equal((clientSrc.match(/<Modal/g) ?? []).length, 1, "still exactly one modal");
  assert.ok(!clientSrc.includes("/admin/students/activate"), "no new activation route");
  assert.equal(
    (clientSrc.match(/setStudentActive\(/g) ?? []).length,
    1,
    "still exactly one activation call site",
  );
});

test("G3: the course badges are untouched by the guard", () => {
  const badgeBlock = clientSrc.slice(
    clientSrc.indexOf("function CourseAffiliationBadges"),
    clientSrc.indexOf("export function StudentsClient"),
  );
  assert.ok(badgeBlock.length > 0, "badge component block not found");
  assert.ok(!badgeBlock.includes("activationBlocked"), "badges must not read the guard flag");
  assert.ok(!badgeBlock.includes("STAGED_TRAINEE"), "badges must not render guard strings");
});

// ---------------------------------------------------------------------------
// G3. The exact flag values the UI branches on (pure core, DB-free)
// ---------------------------------------------------------------------------

const STUDENT = (
  isActive: boolean,
  courseEnrollments: RawAffiliationEnrollment[],
) => ({
  id: "s1",
  firstName: "אבי",
  lastName: "כהן",
  fullName: "אבי כהן",
  groupName: "א",
  subgroupNumber: 1,
  identityNumber: "111",
  phone: null,
  isActive,
  courseEnrollments,
});

test("G3: a staged inactive trainee is blocked and still shows their רמה 2 badge", () => {
  const row = buildTraineeAffiliationRows([
    STUDENT(false, [
      ENROLLMENT({ courseOffering: { id: "o2", name: "קורס רמה 2 2026", level: 2, status: "PLANNED" } }),
    ]),
  ])[0];
  assert.equal(row.activationBlocked, true);
  assert.equal(`רמה ${row.affiliation.visibleAffiliations[0].level}`, "רמה 2");
});

test("G3: a deactivated trainee in the running course is NOT blocked", () => {
  const row = buildTraineeAffiliationRows([
    STUDENT(false, [
      ENROLLMENT({ courseOffering: { id: "o1", name: "קורס רמה 1 2026", level: 1, status: "ACTIVE" } }),
    ]),
  ])[0];
  assert.equal(row.activationBlocked, false);
});

test("G3: an active trainee is never blocked, so השבתה is always available", () => {
  const row = buildTraineeAffiliationRows([
    STUDENT(true, [
      ENROLLMENT({ courseOffering: { id: "o2", name: "קורס רמה 2 2026", level: 2, status: "PLANNED" } }),
    ]),
  ])[0];
  assert.equal(row.activationBlocked, false);
});
