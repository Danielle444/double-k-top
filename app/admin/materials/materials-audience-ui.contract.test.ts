/**
 * P-MATERIALS M2D - STRUCTURAL contract test for the admin materials UI wiring.
 *
 * The repo has no React test runner; the established pattern (see
 * trainee-course-materials-containment.test.ts) is source assertion over the
 * wired file. This pins the course-selection wiring: the mandatory "קורסים"
 * picker, the block-on-empty validation, the exact create/edit payloads, the
 * repeated-`courseOfferingIds` FormData contract (agreeing with the upload
 * route), the audience label chips + zero-audience warning, and the capability
 * note - without changing any observable behaviour that a snapshot would pin.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test app/admin/materials/materials-audience-ui.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const CLIENT = readSource("./MaterialsClient.tsx");
const PAGE = readSource("./page.tsx");
const ROUTE = readSource("../../api/admin/materials/upload/route.ts");

// ===========================================================================
// The page wires the picker options into the client
// ===========================================================================

test("the page loads offering options and passes them to the client", () => {
  assert.ok(PAGE.includes("getMaterialOfferingOptions"), "page fetches picker options");
  assert.ok(/offeringOptions=\{offeringOptions\}/.test(PAGE), "options are passed to MaterialsClient");
});

// ===========================================================================
// The "קורסים" picker + exact FormData field agree with the M2B upload route
// ===========================================================================

test("the picker section is labelled קורסים and uses the exact writer field name", () => {
  assert.ok(CLIENT.includes('<p className="font-medium text-card-foreground">קורסים</p>'), "section label");
  assert.ok(
    /const OFFERING_IDS_FIELD = "courseOfferingIds";/.test(CLIENT),
    "the FormData field name must be the literal the writer reads",
  );
  // Agreement: the upload route reads exactly this repeated field.
  assert.ok(
    ROUTE.includes('formData.getAll("courseOfferingIds")'),
    "the upload route must read the same repeated field the UI appends",
  );
});

// 5 / 16 - capability note surfaced for a not-enabled selectable offering
test("a not-yet-enabled offering shows the capability note", () => {
  assert.ok(
    CLIENT.includes('const CAPABILITY_DISABLED_NOTE = "חניכים לא יראו את החומר עד שהיכולת תופעל";'),
    "the exact capability note string must exist",
  );
  assert.ok(
    /!option\.materialsCapabilityEnabled &&[\s\S]*?\{CAPABILITY_DISABLED_NOTE\}/.test(CLIENT),
    "the note renders only when the offering's capability is not enabled",
  );
});

// ===========================================================================
// Validation - block submit on empty selection (client-side, both paths)
// ===========================================================================

test("empty selection blocks LINK and FILE create before any write", () => {
  const start = CLIENT.indexOf("function handleCreateSubmit");
  const end = CLIENT.indexOf("function cancelCreate");
  const body = CLIENT.slice(start, end);
  assert.ok(body.includes("[...new Set(selectedOfferingIds)]"), "create dedups the selection");
  assert.ok(
    /if \(offeringIds\.length === 0\) \{\s*setCreateOfferingError\(true\);\s*return;\s*\}/.test(body),
    "an empty selection blocks the create (both LINK and FILE) before staging/performing",
  );
  // The guard precedes both the LINK and FILE payload construction.
  const guard = body.indexOf("offeringIds.length === 0");
  assert.ok(guard >= 0 && guard < body.indexOf('createType === "LINK"'), "guard runs before the LINK branch");
  assert.ok(guard < body.indexOf("new FormData(e.currentTarget)"), "guard runs before the FILE branch");
});

test("empty selection blocks edit before any write", () => {
  const start = CLIENT.indexOf("function handleEditSubmit");
  const end = CLIENT.indexOf("function handleToggleActive");
  const body = CLIENT.slice(start, end);
  assert.ok(body.includes("[...new Set(editSelectedOfferingIds)]"), "edit dedups the selection");
  assert.ok(
    /if \(offeringIds\.length === 0\) \{\s*setEditOfferingError\(true\);\s*return;\s*\}/.test(body),
    "an empty selection blocks the edit before either write path",
  );
});

test("the inline empty-selection error string is the exact required wording", () => {
  assert.ok(CLIENT.includes('const NO_OFFERING_SELECTED_ERROR = "יש לבחור לפחות קורס אחד";'));
  assert.ok(/showError &&[\s\S]*?\{NO_OFFERING_SELECTED_ERROR\}/.test(CLIENT), "inline error rendered on failure");
});

// ===========================================================================
// Payloads - LINK create, update, and repeated FILE fields
// ===========================================================================

test("LINK create sends courseOfferingIds", () => {
  const body = CLIENT.slice(CLIENT.indexOf("function handleCreateSubmit"), CLIENT.indexOf("function cancelCreate"));
  assert.ok(/courseOfferingIds: offeringIds,/.test(body), "the LINK create input carries the ids");
});

test("update sends the COMPLETE desired offering set", () => {
  const body = CLIENT.slice(CLIENT.indexOf("function handleEditSubmit"), CLIENT.indexOf("function handleToggleActive"));
  assert.ok(/updateMaterial\(materialId, \{[\s\S]*?courseOfferingIds: offeringIds,[\s\S]*?\}\)/.test(body));
});

test("FILE create and FILE edit append repeated courseOfferingIds fields, no duplicates, no names", () => {
  // create path
  const createBody = CLIENT.slice(
    CLIENT.indexOf("function handleCreateSubmit"),
    CLIENT.indexOf("function cancelCreate"),
  );
  assert.ok(
    /for \(const id of offeringIds\) \{\s*formData\.append\(OFFERING_IDS_FIELD, id\);\s*\}/.test(createBody),
    "FILE create appends each id as a repeated field",
  );
  // edit path
  const editBody = CLIENT.slice(
    CLIENT.indexOf("function handleEditSubmit"),
    CLIENT.indexOf("function handleToggleActive"),
  );
  assert.ok(
    /for \(const id of offeringIds\) \{\s*formData\.append\(OFFERING_IDS_FIELD, id\);\s*\}/.test(editBody),
    "FILE edit appends each id as a repeated field",
  );
  // Ids come from a de-duplicated set, and it is ids (not names) that are appended.
  assert.ok(createBody.includes("[...new Set(selectedOfferingIds)]"));
  assert.ok(editBody.includes("[...new Set(editSelectedOfferingIds)]"));
});

// ===========================================================================
// Edit pre-selection from existing audience
// ===========================================================================

test("edit initializes the selection from the material's existing audience ids", () => {
  assert.ok(
    /setEditSelectedOfferingIds\(\[\.\.\.material\.audienceOfferingIds\]\)/.test(CLIENT),
    "opening the editor pre-checks the material's current offerings (legacy L1 materials open with L1 checked)",
  );
});

// ===========================================================================
// Card rendering - labels + zero-audience warning
// ===========================================================================

test("the material card renders assigned course labels and the zero-audience warning", () => {
  assert.ok(CLIENT.includes('const NO_AUDIENCE_LABEL = "לא משויך לאף קורס";'), "warning string present");
  assert.ok(
    /m\.audienceOfferings\.length === 0 \?[\s\S]*?\{NO_AUDIENCE_LABEL\}/.test(CLIENT),
    "zero audience rows -> the warning chip",
  );
  assert.ok(
    /m\.audienceOfferings\.map\(\(offering\) =>[\s\S]*?\{offering\.label\}/.test(CLIENT),
    "assigned offerings -> label chips",
  );
});

// ===========================================================================
// Existing UI behaviour remains wired (not a broad redesign)
// ===========================================================================

test("the existing FILE/LINK tabs, visibility selector and active toggle remain wired", () => {
  assert.ok(/name="createType"/.test(CLIENT), "FILE/LINK type radios preserved");
  assert.ok(/name="visibility"/.test(CLIENT), "create visibility selector preserved");
  assert.ok(/name="editVisibility"/.test(CLIENT), "edit visibility selector preserved");
  assert.ok(CLIENT.includes("function handleToggleActive"), "active/inactive toggle preserved");
  assert.ok(CLIENT.includes("stagedFileFormDataRef"), "the staged live-form FILE flow is preserved");
});
