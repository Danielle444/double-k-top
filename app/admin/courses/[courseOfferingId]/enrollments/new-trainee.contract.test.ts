/**
 * MULTI-COURSE (new-trainee slice N2A) - DB-free CONTRACT/source tests for the
 * new-trainee admin server action and its stable Hebrew error map. Runs no Prisma
 * and opens no DB: it imports the pure error-message map for a totality check, and
 * statically inspects the source of createTraineeIntoOfferingAction to assert the
 * approved safety invariants (authorization order, route-id trust, five-field
 * whitelist, no cookie/header/singleton/offering-name identity, delegation-only,
 * no direct write / no activation, distinct redirect keys). This guards against a
 * future refactor silently breaking the slice-N2A contract.
 *
 * All source assertions are scoped to the createTraineeIntoOfferingAction body
 * (the last export in actions.ts), so the sibling enrollExistingTraineeAction never
 * leaks into a match.
 *
 * SLICE N2B extends this file with the UI contract for the new-trainee form and its
 * enrollments-page wiring: the route-bound .bind(context.id) offering (no hidden
 * field, no fallback resolver), the exactly-five-field form whitelist, the
 * PLANNED-only render gate, the exact inactive-staging warning, the absence of ANY
 * activation affordance, the pending/disabled submit contract, the stable-code error
 * banner (never the raw query value), and the preservation of the committed
 * existing-trainee enrollment flow, its error/enrolled banners, and the
 * offering-scoped enrollment verification list.
 *
 * Run: npx tsx --test "app/admin/courses/[courseOfferingId]/enrollments/new-trainee.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NEW_TRAINEE_ERROR_MESSAGES,
  newTraineeErrorMessage,
} from "./new-trainee-error-messages";

// Strip block and line comments so invariants are checked against real CODE only,
// never the (deliberately prose-y) contract comments.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function readRaw(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

function read(relative: string): string {
  return stripComments(readRaw(relative));
}

const actionSrc = read("./actions.ts");
const errorMapSrc = read("./new-trainee-error-messages.ts");
const pageSrc = read("./page.tsx");
const formSrc = read("./NewTraineeForm.tsx");
const enrollFormSrc = read("./EnrollExistingTraineeForm.tsx");

/** The EXACT inactive-staging warning the manager must see before submitting. */
const INACTIVE_WARNING =
  "החניך יתווסף לקורס במצב הכנה (לא פעיל) ולא יוכל להתחבר למערכת עד להפעלה בשלב מאוחר יותר.";

/** The EXACT post-creation success banner (inactive + cannot log in). */
const CREATED_BANNER =
  "החניך נוצר במצב הכנה (לא פעיל) ונרשם לקורס. הוא אינו יכול להתחבר עד להפעלה.";

// The new action is the last export; slice from its declaration to end of file so
// every ordering/field assertion is scoped to its body only.
const newActionStart = actionSrc.indexOf(
  "export async function createTraineeIntoOfferingAction",
);
assert.ok(newActionStart > -1, "createTraineeIntoOfferingAction must be exported");
const newActionSrc = actionSrc.slice(newActionStart);

// The exact stable N1 error surface (kept in lock-step with
// CreateTraineeIntoOfferingErrorCode). A drift here fails the totality test.
const N1_ERROR_CODES = [
  "invalid_input",
  "offering_not_found",
  "operation_not_allowed",
  "offering_start_date_missing",
  "invalid_group",
  "duplicate_identity",
  "unexpected",
] as const;

// ---------------------------------------------------------------------------
// Authorization order
// ---------------------------------------------------------------------------

test("action calls requireAdmin", () => {
  assert.ok(newActionSrc.includes("requireAdmin("), "requireAdmin must be called");
});

test("requireAdmin runs BEFORE the first formData.get", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const firstGet = newActionSrc.indexOf("formData.get(");
  assert.ok(admin > -1 && firstGet > -1);
  assert.ok(admin < firstGet, "requireAdmin must precede any formData read");
});

test("requireAdmin runs BEFORE createTraineeIntoOffering", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const create = newActionSrc.indexOf("createTraineeIntoOffering(");
  assert.ok(admin > -1 && create > -1);
  assert.ok(admin < create, "requireAdmin must precede the N1 mutation");
});

test("requireAdmin runs BEFORE revalidatePath and redirect", () => {
  const admin = newActionSrc.indexOf("requireAdmin(");
  const reval = newActionSrc.indexOf("revalidatePath(");
  const redir = newActionSrc.indexOf("redirect(");
  assert.ok(admin > -1 && reval > -1 && redir > -1);
  assert.ok(admin < reval, "requireAdmin must precede revalidatePath");
  assert.ok(admin < redir, "requireAdmin must precede redirect");
});

// ---------------------------------------------------------------------------
// Route-bound offering
// ---------------------------------------------------------------------------

test("courseOfferingId is the leading bound parameter", () => {
  assert.ok(
    /createTraineeIntoOfferingAction\(\s*courseOfferingId: string/.test(newActionSrc),
    "courseOfferingId must be the leading parameter",
  );
});

test("the offering id is NEVER read from FormData", () => {
  assert.ok(
    !newActionSrc.includes('formData.get("courseOfferingId")'),
    "offering id must not be read from formData",
  );
});

test("no current-offering resolver / cookie / header / name / level identity", () => {
  for (const forbidden of [
    "resolveCurrentCourseOffering",
    "cookies(",
    "headers(",
    ".level",
    ".name",
  ]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("no production offering / group id is hardcoded anywhere in the action file", () => {
  for (const prodId of [
    "cmrxk58vc0000lscnfm54bpze",
    "cmrxk5qti0001lscnrmebu68r",
    "cmrxk5vb10002lscna61hbnaz",
    "cmrxk5xfh0003lscna0c6v457",
    "cmrxk60lw0004lscn4d2lr9jd",
  ]) {
    assert.ok(!actionSrc.includes(prodId), `must not hardcode production id ${prodId}`);
  }
});

// ---------------------------------------------------------------------------
// FormData whitelist (exactly five approved fields)
// ---------------------------------------------------------------------------

test("the action reads EXACTLY the five approved trainee fields", () => {
  for (const field of ["firstName", "lastName", "identityNumber", "phone", "courseGroupId"]) {
    assert.ok(
      newActionSrc.includes(`formData.get("${field}")`),
      `${field} must be read from the form`,
    );
  }
});

test("no operational / identity-override field is read from the client", () => {
  for (const forbidden of [
    "courseOfferingId",
    "isActive",
    "groupName",
    "subgroupNumber",
    "isPrimary",
    "status",
    "startDate",
    "effectiveFrom",
    "studentId",
    "enrollmentId",
    "password",
  ]) {
    assert.ok(
      !newActionSrc.includes(`formData.get("${forbidden}")`),
      `action must not read ${forbidden} from the client`,
    );
  }
});

// ---------------------------------------------------------------------------
// Delegation and proof of no direct writes / no activation
// ---------------------------------------------------------------------------

test("the action delegates the write to createTraineeIntoOffering and forwards the bound id", () => {
  assert.ok(newActionSrc.includes("createTraineeIntoOffering({"), "must call the N1 service");
  assert.ok(newActionSrc.includes("courseOfferingId,"), "must forward the bound courseOfferingId");
});

test("the action file imports no Prisma client", () => {
  assert.ok(!actionSrc.includes("@/lib/prisma"), "must not import the prisma client");
  assert.ok(!actionSrc.includes("prisma."), "must not reference prisma.*");
});

test("the action performs no direct Student / enrollment / membership write", () => {
  for (const forbidden of [
    "student.create",
    "student.update",
    "courseEnrollment.create",
    "groupMembership.create",
    "createStudent",
  ]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("the action introduces no activation path", () => {
  for (const forbidden of ["setStudentActive", "activate", "isActive"]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

test("the action does not call the existing-trainee enrollment service", () => {
  assert.ok(!newActionSrc.includes("enrollExistingTrainee("), "must not call E1");
});

test("the action references no horse writer", () => {
  for (const forbidden of ["TraineeHorseAssignment", "traineeHorseAssignment", "horse"]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Redirect / revalidation contract (distinct N2 keys)
// ---------------------------------------------------------------------------

test("success revalidates the exact enrollments path and redirects with created=1", () => {
  assert.ok(newActionSrc.includes("revalidatePath(enrollPath)"), "must revalidate the exact path");
  assert.ok(newActionSrc.includes("?created=1"), "success must redirect with created=1");
  assert.ok(newActionSrc.includes("/enrollments`"), "path built from the bound offering id");
});

test("ordinary errors redirect with the newError key", () => {
  assert.ok(newActionSrc.includes("?newError="), "errors redirect with newError=<code>");
});

test("offering_not_found routes to the safe courses list", () => {
  assert.ok(
    newActionSrc.includes('"/admin/courses?error=invalid"'),
    "offering_not_found routes to the courses list",
  );
});

test("the N2 action reuses NEITHER the enrolled NOR the enrollments error key", () => {
  assert.ok(!newActionSrc.includes("enrolled"), "must not reuse the enrolled key");
  assert.ok(
    !newActionSrc.includes("${enrollPath}?error="),
    "must not reuse the error key on the enrollments path",
  );
});

test("no unrelated global revalidation", () => {
  assert.ok(!newActionSrc.includes('revalidatePath("/")'), "must not revalidate unrelated paths");
});

// ---------------------------------------------------------------------------
// Error map (totality + no PII + typed)
// ---------------------------------------------------------------------------

test("NEW_TRAINEE_ERROR_MESSAGES covers EXACTLY the stable N1 error codes", () => {
  assert.deepEqual(Object.keys(NEW_TRAINEE_ERROR_MESSAGES).sort(), [...N1_ERROR_CODES].sort());
});

test("every N1 error code maps to a non-empty Hebrew message", () => {
  for (const code of N1_ERROR_CODES) {
    const message = NEW_TRAINEE_ERROR_MESSAGES[code];
    assert.equal(typeof message, "string");
    assert.ok(message.trim().length > 0, `${code} must have a message`);
  }
});

test("duplicate_identity guides the manager to the existing-trainee flow", () => {
  assert.ok(
    NEW_TRAINEE_ERROR_MESSAGES.duplicate_identity.includes("רישום חניך קיים"),
    "duplicate_identity must point to the existing-trainee enrollment flow",
  );
});

test("no message reflects raw ids, interpolation, or PII field names", () => {
  const serialized = JSON.stringify(NEW_TRAINEE_ERROR_MESSAGES);
  for (const forbidden of [
    "${",
    "studentId",
    "courseGroupId",
    "courseOfferingId",
    "identityNumber",
    "firstName",
    "lastName",
    "phone",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `messages must not include ${forbidden}`);
  }
});

test("the map is typed against CreateTraineeIntoOfferingErrorCode", () => {
  assert.ok(
    errorMapSrc.includes("CreateTraineeIntoOfferingErrorCode"),
    "the Record must be keyed by the N1 error-code type",
  );
});

test("an unknown code falls back to the generic message", () => {
  assert.equal(newTraineeErrorMessage("not_a_real_code"), NEW_TRAINEE_ERROR_MESSAGES.unexpected);
});

// ---------------------------------------------------------------------------
// Scope: N1 remains the only write service
// ---------------------------------------------------------------------------

test("N1 remains the only write service and its locked invariants are intact", () => {
  const n1CoreSrc = readRaw(
    "../../../../../lib/course/create-trainee-into-offering-core.ts",
  );
  assert.ok(n1CoreSrc.includes("isActive: false"), "N1 must still stage inactive");
  assert.ok(n1CoreSrc.includes("groupName: null"), "N1 must still null groupName");
  assert.ok(n1CoreSrc.includes("subgroupNumber: null"), "N1 must still null subgroupNumber");
});

// ===========================================================================
// SLICE N2B - the new-trainee FORM and its page wiring
// ===========================================================================

// ---------------------------------------------------------------------------
// Page wiring
// ---------------------------------------------------------------------------

test("N2B: the new-trainee form component exists", () => {
  const formPath = fileURLToPath(new URL("./NewTraineeForm.tsx", import.meta.url));
  assert.equal(existsSync(formPath), true, "NewTraineeForm.tsx must exist in N2B");
  assert.ok(formSrc.includes('"use client"'), "the form must be a client component");
});

test("N2B: the page imports and renders NewTraineeForm exactly once", () => {
  assert.ok(
    formSrc.includes("export function NewTraineeForm"),
    "NewTraineeForm must be exported",
  );
  assert.ok(
    pageSrc.includes('from "./NewTraineeForm"'),
    "page must import the new-trainee form",
  );
  assert.equal(
    pageSrc.split("<NewTraineeForm").length - 1,
    1,
    "the form must be rendered exactly once",
  );
});

test("N2B: the page imports the committed N2A action", () => {
  assert.ok(
    pageSrc.includes("createTraineeIntoOfferingAction"),
    "page must import the committed action",
  );
  assert.ok(pageSrc.includes('from "./actions"'), "the action must come from ./actions");
});

test("N2B: the action is bound with the validated route context id", () => {
  assert.ok(
    pageSrc.includes("createTraineeIntoOfferingAction.bind(null, context.id)"),
    "the offering must be server-bound from context.id",
  );
  assert.ok(
    pageSrc.includes("requireAdminCourseOffering(courseOfferingId)"),
    "context must still come from the route-bound admin validation",
  );
});

test("N2B: no hidden or FormData courseOfferingId field exists", () => {
  for (const [label, src] of [
    ["page.tsx", pageSrc],
    ["NewTraineeForm.tsx", formSrc],
  ] as const) {
    assert.ok(!src.includes('type="hidden"'), `${label} must render no hidden input`);
    assert.ok(
      !src.includes('name="courseOfferingId"'),
      `${label} must not submit courseOfferingId`,
    );
  }
  assert.ok(
    !formSrc.includes("courseOfferingId"),
    "the form must not reference the offering id at all",
  );
});

test("N2B: the new-trainee form is rendered ONLY for a PLANNED offering", () => {
  assert.ok(
    pageSrc.includes('context.status === "PLANNED"'),
    "the gate must require a PLANNED offering",
  );
  assert.ok(
    pageSrc.includes('evaluateCourseOperationPolicy(context.status, "ENROLLMENT_MANAGEMENT")'),
    "the gate must also require ENROLLMENT_MANAGEMENT",
  );
  const formIdx = pageSrc.indexOf("<NewTraineeForm");
  assert.ok(formIdx > -1);
  const gateIdx = pageSrc.lastIndexOf("canEnroll ? (", formIdx);
  assert.ok(gateIdx > -1, "the form must sit inside a canEnroll-true branch");
  const elseIdx = pageSrc.indexOf("ניתן ליצור חניך חדש רק בקורס במצב");
  assert.ok(elseIdx > formIdx, "a non-PLANNED offering must get a non-interactive explanation");
});

test("N2B: the page uses no fallback / current-offering resolver", () => {
  for (const forbidden of [
    "resolveCurrentCourseOffering",
    "getCurrentCourseOffering",
    "cookies(",
    "findFirst",
    'status: "ACTIVE"',
  ]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
  }
});

test("N2B: the existing-trainee enrollment flow remains intact", () => {
  assert.ok(pageSrc.includes("<EnrollExistingTraineeForm"), "the existing form must remain");
  assert.ok(
    pageSrc.includes("enrollExistingTraineeAction.bind(null, context.id)"),
    "the existing enrollment action must remain bound to context.id",
  );
  assert.ok(
    enrollFormSrc.includes('name="studentId"'),
    "the existing-trainee form must still submit studentId",
  );
});

test("N2B: the enrollment verification list reader is unchanged", () => {
  assert.ok(
    pageSrc.includes("readOfferingEnrollmentsForAdmin(context.id, context.startDate)"),
    "the offering-scoped enrollment reader must be preserved verbatim",
  );
  assert.ok(pageSrc.includes("חניכים רשומים"), "the enrollment list section must remain");
});

test("N2B: the existing error / enrolled query behavior is preserved", () => {
  assert.ok(pageSrc.includes("enrollErrorMessage(error)"), "the E3 error map must still be used");
  assert.ok(
    pageSrc.includes('enrolled ? "החניך נרשם לקורס בהצלחה."'),
    "the E3 enrolled banner must be preserved",
  );
});

test("N2B: the leaf-subgroup reader is reused, not replaced", () => {
  assert.ok(
    pageSrc.includes("getCourseGroupTreeByOfferingId(context.id)"),
    "the committed group-tree reader must be reused",
  );
  assert.ok(pageSrc.includes("toLeafSubgroupOptions("), "leaf flattening must be reused");
  assert.ok(
    pageSrc.includes("subgroups={subgroupOptions}"),
    "only the route offering's leaf options may be passed in",
  );
});

// ---------------------------------------------------------------------------
// Form fields (exactly the five approved inputs)
// ---------------------------------------------------------------------------

test("N2B: the form submits EXACTLY the five approved fields", () => {
  const names = [...formSrc.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...names].sort(),
    ["courseGroupId", "firstName", "identityNumber", "lastName", "phone"],
    "the form must submit exactly the five approved fields",
  );
});

test("N2B: the form carries no isActive / activation input", () => {
  assert.ok(!formSrc.includes("isActive"), "no isActive input or prop may exist");
});

test("N2B: the form carries no course selector", () => {
  for (const forbidden of ["courseOffering", "offeringId", "CourseOfferingSelector"]) {
    assert.ok(!formSrc.includes(forbidden), `the form must not reference ${forbidden}`);
  }
});

test("N2B: the form carries no legacy group mirror input", () => {
  for (const forbidden of ["groupName", "subgroupNumber"]) {
    assert.ok(!formSrc.includes(forbidden), `the form must not reference ${forbidden}`);
  }
});

test("N2B: the form carries no operational enrollment input", () => {
  for (const forbidden of [
    "isPrimary",
    "status",
    "startDate",
    "endDate",
    "effectiveFrom",
    "activationDate",
  ]) {
    assert.ok(!formSrc.includes(forbidden), `the form must not reference ${forbidden}`);
  }
});

test("N2B: the form carries no horse / password / login / identifier input", () => {
  for (const forbidden of [
    "horse",
    "Horse",
    "password",
    "login",
    "studentId",
    "enrollmentId",
  ]) {
    assert.ok(!formSrc.includes(forbidden), `the form must not reference ${forbidden}`);
  }
});

test("N2B: the identity input uses numeric behavior and a digits pattern", () => {
  assert.ok(formSrc.includes('name="identityNumber"'), "identity field must exist");
  assert.ok(formSrc.includes('inputMode="numeric"'), "identity field must be numeric");
  assert.ok(formSrc.includes('pattern="\\d{5,9}"'), "identity field must constrain to digits");
  for (const forbidden of ["fetch(", "lookup", "useEffect"]) {
    assert.ok(!formSrc.includes(forbidden), `no client-side identity lookup (${forbidden})`);
  }
});

test("N2B: first/last name are required text inputs and phone is optional tel", () => {
  assert.ok(/name="firstName"\s+required/.test(formSrc), "firstName must be required");
  assert.ok(/name="lastName"\s+required/.test(formSrc), "lastName must be required");
  assert.ok(/type="tel"\s+name="phone"/.test(formSrc), "phone must be a tel input");
  assert.ok(!/name="phone"\s+required/.test(formSrc), "phone must stay optional");
});

test("N2B: all five required Hebrew labels are rendered", () => {
  for (const label of ["שם פרטי", "שם משפחה", "תעודת זהות", "טלפון (רשות)", "תת־קבוצה"]) {
    assert.ok(formSrc.includes(label), `the label ${label} must be rendered`);
  }
});

test("N2B: the subgroup select is required with an empty default option", () => {
  assert.ok(
    /name="courseGroupId"\s+required/.test(formSrc),
    "the subgroup select must be required",
  );
  assert.ok(formSrc.includes('defaultValue=""'), "the select must default to empty");
  assert.ok(formSrc.includes("בחרו תת־קבוצה…"), "the empty default option must be shown");
});

test("N2B: only the supplied subgroup options are rendered", () => {
  assert.ok(formSrc.includes("subgroups.map("), "options must come from the supplied prop");
  const optionValues = [...formSrc.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(optionValues, [""], "the only literal option value is the empty placeholder");
  assert.ok(formSrc.includes("value={subgroup.id}"), "real options use the supplied ids");
});

test("N2B: no production offering / group id is hardcoded in the UI", () => {
  for (const prodId of [
    "cmrxk58vc0000lscnfm54bpze",
    "cmrxk5qti0001lscnrmebu68r",
    "cmrxk5vb10002lscna61hbnaz",
    "cmrxk5xfh0003lscna0c6v457",
    "cmrxk60lw0004lscn4d2lr9jd",
  ]) {
    assert.ok(!formSrc.includes(prodId), `form must not hardcode ${prodId}`);
    assert.ok(!pageSrc.includes(prodId), `page must not hardcode ${prodId}`);
  }
});

// ---------------------------------------------------------------------------
// Inactive-staging safety
// ---------------------------------------------------------------------------

test("N2B: the exact inactive-staging warning is rendered before the submit button", () => {
  assert.ok(formSrc.includes(INACTIVE_WARNING), "the exact warning text must be rendered");
  const warnIdx = formSrc.indexOf(INACTIVE_WARNING);
  const submitIdx = formSrc.indexOf("<NewTraineeSubmitButton");
  assert.ok(submitIdx > -1, "the submit button must be rendered");
  assert.ok(warnIdx < submitIdx, "the warning must precede the submit button");
});

test("N2B: no activation path exists in the UI", () => {
  for (const [label, src] of [
    ["page.tsx", pageSrc],
    ["NewTraineeForm.tsx", formSrc],
  ] as const) {
    for (const forbidden of [
      "setStudentActive",
      "activate",
      "Activate",
      "activation",
      "הפעלת",
    ]) {
      assert.ok(!src.includes(forbidden), `${label} must not reference ${forbidden}`);
    }
  }
});

test("N2B: the success banner states inactive and cannot-log-in", () => {
  assert.ok(pageSrc.includes(CREATED_BANNER), "the exact created banner must be rendered");
  assert.ok(pageSrc.includes('created === "1"'), "the banner is gated on created=1");
  assert.ok(CREATED_BANNER.includes("לא פעיל"), "the banner must say inactive");
  assert.ok(CREATED_BANNER.includes("אינו יכול להתחבר"), "the banner must say cannot log in");
});

test("N2B: no automatic navigation away from the enrollments page", () => {
  for (const forbidden of ["/admin/students", "redirect(", "router.push", "useRouter"]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not reference ${forbidden}`);
    assert.ok(!formSrc.includes(forbidden), `form must not reference ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Submission behavior
// ---------------------------------------------------------------------------

test("N2B: the form uses useFormStatus for the pending state", () => {
  assert.ok(formSrc.includes('from "react-dom"'), "useFormStatus must come from react-dom");
  assert.ok(formSrc.includes("useFormStatus()"), "useFormStatus must be used");
});

test("N2B: the submit button is disabled while pending", () => {
  assert.ok(formSrc.includes("disabled={pending}"), "the button must be disabled while pending");
  assert.ok(
    formSrc.includes("aria-disabled={pending}"),
    "the disabled state must be announced",
  );
});

test("N2B: the submit labels are יצירת חניך / יוצר…", () => {
  assert.ok(
    formSrc.includes('{pending ? "יוצר…" : "יצירת חניך"}'),
    "default and pending submit text must match the contract",
  );
});

test("N2B: the form posts to the bound server action directly", () => {
  assert.ok(formSrc.includes("<form action={action}"), "the bound action drives the form");
  assert.ok(
    /action:\s*\(formData: FormData\) => void \| Promise<void>/.test(formSrc),
    "the action prop must be narrowly typed",
  );
});

test("N2B: the form performs no custom client fetch / API call", () => {
  for (const forbidden of [
    "fetch(",
    "axios",
    "XMLHttpRequest",
    "/api/",
    "onSubmit",
    "preventDefault",
    "useState",
  ]) {
    assert.ok(!formSrc.includes(forbidden), `the form must not use ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

test("N2B: the page resolves newError through the committed error helper", () => {
  assert.ok(
    pageSrc.includes('from "./new-trainee-error-messages"'),
    "the committed map must be imported",
  );
  assert.ok(
    pageSrc.includes("newTraineeErrorMessage(newError)"),
    "newError must be resolved through the helper",
  );
});

test("N2B: the raw newError query value is never rendered", () => {
  assert.ok(!pageSrc.includes("{newError}"), "the raw code must not be rendered");
  assert.ok(!pageSrc.includes("{created}"), "the raw created flag must not be rendered");
  assert.ok(pageSrc.includes("{newTraineeError}"), "only the resolved message is rendered");
  assert.ok(pageSrc.includes("{newTraineeSuccess}"), "only the fixed banner is rendered");
});

test("N2B: no Hebrew N1 error string is duplicated inside page.tsx", () => {
  for (const message of Object.values(NEW_TRAINEE_ERROR_MESSAGES)) {
    assert.ok(!pageSrc.includes(message), `page must not inline the message: ${message}`);
  }
});

test("N2B: duplicate guidance stays text-only and the existing form stays visible", () => {
  assert.ok(
    NEW_TRAINEE_ERROR_MESSAGES.duplicate_identity.includes("רישום חניך קיים"),
    "duplicate guidance must point at the existing-trainee flow",
  );
  for (const forbidden of ["scrollIntoView", "#enroll", "scrollTo"]) {
    assert.ok(!pageSrc.includes(forbidden), `page must not add ${forbidden}`);
  }
  const enrollFormIdx = pageSrc.indexOf("<EnrollExistingTraineeForm");
  assert.ok(enrollFormIdx > -1);
  const gateIdx = pageSrc.lastIndexOf("canEnroll ? (", enrollFormIdx);
  assert.ok(
    !pageSrc.slice(gateIdx, enrollFormIdx).includes("newError"),
    "the existing form must not be hidden by the new-trainee error state",
  );
});

test("N2B: no PII or identifier is interpolated into the new-trainee banners", () => {
  for (const forbidden of ["${", "firstName", "lastName", "identityNumber", "phone"]) {
    assert.ok(!CREATED_BANNER.includes(forbidden), `banner must not include ${forbidden}`);
    assert.ok(!INACTIVE_WARNING.includes(forbidden), `warning must not include ${forbidden}`);
  }
  const bannerRegion = pageSrc.slice(
    pageSrc.indexOf("const newTraineeError"),
    pageSrc.indexOf("return ("),
  );
  for (const forbidden of ["identityNumber", "firstName", "lastName", "phone", "context.id"]) {
    assert.ok(!bannerRegion.includes(forbidden), `banner derivation must not use ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Scope / regression: N2B touches no committed N1 / N2A production file
// ---------------------------------------------------------------------------

test("N2B: the committed N2A action still matches its locked contract", () => {
  assert.ok(newActionSrc.includes("requireAdmin("), "requireAdmin must remain first");
  assert.ok(newActionSrc.includes("createTraineeIntoOffering({"), "delegation must remain");
  assert.ok(newActionSrc.includes("?created=1"), "the created key must remain");
  assert.ok(newActionSrc.includes("?newError="), "the newError key must remain");
  assert.ok(!actionSrc.includes("prisma."), "the action must still hold no Prisma write");
  for (const forbidden of ["setStudentActive", "activate", "isActive"]) {
    assert.ok(!newActionSrc.includes(forbidden), `action must still not reference ${forbidden}`);
  }
});

test("N2B: the committed N1 service files still hold their locked invariants", () => {
  const n1CoreSrc = readRaw("../../../../../lib/course/create-trainee-into-offering-core.ts");
  const n1IoSrc = readRaw("../../../../../lib/course/create-trainee-into-offering.ts");
  assert.ok(n1CoreSrc.includes("isActive: false"), "N1 must still stage inactive");
  assert.ok(n1CoreSrc.includes("groupName: null"), "N1 must still null groupName");
  assert.ok(n1CoreSrc.includes("subgroupNumber: null"), "N1 must still null subgroupNumber");
  assert.ok(
    n1IoSrc.includes("prisma.$transaction("),
    "N1 must still write inside one interactive transaction",
  );
  assert.ok(
    !n1IoSrc.includes("traineeHorseAssignment"),
    "N1 must still bind no horse writer",
  );
});

test("N2B: the existing-trainee form and its error map are untouched", () => {
  assert.ok(
    enrollFormSrc.includes("export function EnrollExistingTraineeForm"),
    "the existing form export must remain",
  );
  assert.ok(
    enrollFormSrc.includes('{pending ? "רושם…" : "רישום"}'),
    "the existing form's submit labels must remain",
  );
  const enrollMapSrc = read("./enroll-error-messages.ts");
  assert.ok(
    enrollMapSrc.includes("enrollErrorMessage"),
    "the existing enroll error map must remain",
  );
});

test("N2B: the UI files import no Prisma, schema, auth, session or roster module", () => {
  for (const [label, src] of [
    ["page.tsx", pageSrc],
    ["NewTraineeForm.tsx", formSrc],
  ] as const) {
    for (const forbidden of [
      "@/lib/prisma",
      "prisma.",
      "@prisma/client",
      "lib/auth/session",
      "cookies(",
      "createStudent",
      "lib/actions/students",
    ]) {
      assert.ok(!src.includes(forbidden), `${label} must not reference ${forbidden}`);
    }
  }
});
