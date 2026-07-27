/**
 * FEEDING-BOARD Stage 5A - SOURCE-CONTRACT tests for the feeding board and its
 * two hosts.
 *
 * WHY THIS IS A CONTRACT TEST AND NOT A RENDER TEST. Unlike its leaf status
 * control (which IS render-tested in ./HorseFeedingStatusControl.test.tsx),
 * HorseFeedingSection imports "@/lib/actions/horse-feeding" for the suggestion
 * readers - a "use server" module that transitively pulls in Prisma and
 * next/headers - so it cannot be imported into a plain `tsx --test` process, and
 * neither can either host. This uses the repository's established
 * SOURCE-CONTRACT pattern (same technique as ./ScheduleTimeGrid.contract.test.ts
 * and app/instructor/unified-instructor-schedule-subview.contract.test.ts).
 *
 * READ THIS HONESTLY: the assertions below prove STRUCTURE, not runtime
 * behaviour. They lock the wiring, the permission plumbing, the guards, the
 * rollback branches and the absence of forbidden paths; they cannot execute a
 * click. The behavioural evidence for the write rules themselves lives one layer
 * down, in lib/actions/horse-feeding-progress-actions.test.ts (persistence) and
 * lib/actions/horse-feeding-progress-auth.test.ts (authorization), which run
 * against injected fakes.
 *
 * NO DATABASE, NO NETWORK, NO SERVER ACTION is touched by this file.
 *
 * Run with:
 *   npx tsx --test lib/components/HorseFeedingSection.contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** Strips block, line and JSX comments so prose about a rule can't satisfy it. */
function code(relativePath: string): string {
  return source(relativePath)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const SECTION_PATH = "lib/components/HorseFeedingSection.tsx";
const CONTROL_PATH = "lib/components/HorseFeedingStatusControl.tsx";
const MANAGER_PATH = "lib/components/HorseFeedingVisibilityManager.tsx";
const ADMIN_HOST_PATH = "app/admin/horses/HorsesClient.tsx";
const INSTRUCTOR_HOST_PATH = "app/instructor/InstructorHorsesSection.tsx";

const SECTION = code(SECTION_PATH);
const CONTROL = code(CONTROL_PATH);
const MANAGER = code(MANAGER_PATH);
const ADMIN_HOST = code(ADMIN_HOST_PATH);
const INSTRUCTOR_HOST = code(INSTRUCTOR_HOST_PATH);

const FEEDING_UI_FILES: readonly (readonly [string, string])[] = [
  [SECTION_PATH, SECTION],
  [CONTROL_PATH, CONTROL],
  [MANAGER_PATH, MANAGER],
  [ADMIN_HOST_PATH, ADMIN_HOST],
  [INSTRUCTOR_HOST_PATH, INSTRUCTOR_HOST],
];

/**
 * Stage 5B moved hide/restore from "forbidden everywhere" to "manager surface
 * only". These are the files that must still contain NO trace of it: the
 * instructor host (which must never reach it) and the leaf status control.
 */
const NO_VISIBILITY_FILES: readonly (readonly [string, string])[] = [
  [INSTRUCTOR_HOST_PATH, INSTRUCTOR_HOST],
  [CONTROL_PATH, CONTROL],
];

/** The body of a named top-level function, up to its column-0 closing brace. */
function functionBody(fileCode: string, name: string): string {
  const start = fileCode.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected a function ${name}`);
  const end = fileCode.indexOf("\n  }", start);
  assert.notEqual(end, -1, `expected a closing brace for ${name}`);
  return fileCode.slice(start, end);
}

// ===========================================================================
// 10-12. HOST WIRING AND WHERE PERMISSION COMES FROM
// ===========================================================================

test("10. the admin host wires the ADMIN mark and clear actions", () => {
  assert.match(ADMIN_HOST, /onMarkProgress=\{markHorseFeedingProgressAsAdmin\}/);
  assert.match(ADMIN_HOST, /onClearAllProgress=\{clearAllHorseFeedingProgressAsAdmin\}/);
  assert.match(ADMIN_HOST, /markHorseFeedingProgressAsAdmin,/, "must be imported, not constructed");
  assert.match(ADMIN_HOST, /clearAllHorseFeedingProgressAsAdmin,/);

  // A manager may always mark and reset; both flags are literal `true`.
  assert.match(ADMIN_HOST, /^\s*canMarkProgress$/m);
  assert.match(ADMIN_HOST, /^\s*canClearProgress$/m);
});

test("11. the instructor host wires the INSTRUCTOR mark and clear actions", () => {
  assert.match(INSTRUCTOR_HOST, /onMarkProgress=\{markHorseFeedingProgressAsInstructor\}/);
  assert.match(INSTRUCTOR_HOST, /onClearAllProgress=\{clearAllHorseFeedingProgressAsInstructor\}/);
});

test("11b. neither host can reach the other tier's actions", () => {
  assert.ok(
    !/AsInstructor/.test(ADMIN_HOST.slice(ADMIN_HOST.indexOf("horse-feeding"))),
    "the admin screen must not import an instructor feeding action"
  );
  assert.ok(
    !/markHorseFeedingProgressAsAdmin|clearAllHorseFeedingProgressAsAdmin|getHorseFeedingOverviewForAdmin/.test(
      INSTRUCTOR_HOST
    ),
    "the instructor screen must not import an admin feeding action"
  );
});

test("12. instructor permission comes from canEditFeeding, never from role/name/state", () => {
  assert.match(INSTRUCTOR_HOST, /canMarkProgress=\{canEditFeeding\}/);
  assert.match(INSTRUCTOR_HOST, /canClearProgress=\{canEditFeeding\}/);

  // canEditFeeding is a prop handed down, not derived on the client.
  assert.match(INSTRUCTOR_HOST, /canEditFeeding:\s*boolean/);
  for (const forbidden of [
    "canMarkProgress={true}",
    "canClearProgress={true}",
    'role === "admin"',
    "isAdmin",
  ]) {
    assert.ok(
      !INSTRUCTOR_HOST.includes(forbidden),
      `instructor permission must not be inferred (${forbidden})`
    );
  }
});

// ===========================================================================
// 13-14 + 30. A READ-ONLY USER CANNOT MARK AND CANNOT CLEAR
// ===========================================================================

test("13. a read-only user's status control is rendered but disabled", () => {
  assert.match(
    SECTION,
    /disabled=\{!canMarkProgress \|\| !onMarkProgress \|\| visibilityBusyHorse === row\.horseName\}/,
    "the control must be shown (status is still information) but inert - for a read-only viewer, and also while this horse is being hidden or restored"
  );
  // ...and the handler refuses regardless of what the UI rendered.
  assert.match(
    functionBody(SECTION, "handleMarkProgress"),
    /if \(!canMarkProgress \|\| !onMarkProgress\) return;/
  );
});

test("14+30. a read-only user gets no clear button, no modal and no handler", () => {
  // Both the trigger and the confirmation dialog are behind the same flag.
  assert.equal(
    (SECTION.match(/canClearProgress && onClearAllProgress/g) ?? []).length,
    2,
    "exactly the clear button and the confirm modal are gated"
  );
  assert.match(
    functionBody(SECTION, "handleClearAllProgress"),
    /if \(!canClearProgress \|\| !onClearAllProgress\) return;/
  );
  // Both default to OFF, so an un-wired host cannot accidentally expose them.
  assert.match(SECTION, /canMarkProgress = false/);
  assert.match(SECTION, /canClearProgress = false/);
});

test("13b. the existing read-only wording is unchanged", () => {
  assert.ok(SECTION.includes("תצוגה בלבד - אין הרשאת עריכת האכלות"));
});

// ===========================================================================
// 15-16. HIDE/RESTORE IS A MANAGER SURFACE - AND REACHES NOWHERE ELSE
//
// Stage 5A forbade these identifiers everywhere. Stage 5B introduces them, so
// the prohibition now applies exactly where it still must hold: the instructor
// host and the leaf status control. The admin-only assertions moved to 70-73.
// ===========================================================================

test("15. the instructor surface has no hide/restore anything", () => {
  for (const [path, fileCode] of NO_VISIBILITY_FILES) {
    // Horse-visibility identifiers ONLY. Two deliberate near-misses are NOT
    // matched here because they are unrelated to hiding a horse: the Page
    // Visibility API used by the refresh (document.visibilityState /
    // "visibilitychange"), and the Hebrew stem "לשחזר" in the clear-all
    // confirmation, which is about progress marks, not about a horse's presence
    // on the board.
    for (const forbidden of [
      "setHorseFeedingVisibilityAsAdmin",
      "HorseFeedingVisibility",
      "isHidden",
      "hiddenRows",
      "HorseFeedingVisibilityRequest",
      "canManageVisibility",
      "fetchHiddenOverview",
      "onSetVisibility",
      "הסתר",
      "החזר",
    ]) {
      assert.ok(!fileCode.includes(forbidden), `${path} must not reference ${forbidden}`);
    }
  }
  // The instructor host still imports exactly its own four feeding actions.
  const importBlock = INSTRUCTOR_HOST.slice(
    INSTRUCTOR_HOST.indexOf('from "@/lib/actions/horses"'),
    INSTRUCTOR_HOST.indexOf('} from "@/lib/actions/horse-feeding";')
  );
  assert.ok(!importBlock.includes("Visibility"), "no visibility action may be imported there");
  assert.ok(!importBlock.includes("Hidden"), "nor the hidden-row reader");
});

test("16. the admin-only hidden-row reader is unreachable from the instructor screen", () => {
  for (const [path, fileCode] of NO_VISIBILITY_FILES) {
    assert.ok(
      !fileCode.includes("getHiddenHorseFeedingRowsForAdmin"),
      `${path} must not call the hidden-row reader`
    );
  }
  // ...and the board only ever reaches it through the injected prop, never by
  // importing the action itself.
  assert.ok(!SECTION.includes("getHiddenHorseFeedingRowsForAdmin"));
  assert.ok(!SECTION.includes("setHorseFeedingVisibilityAsAdmin"));
  assert.ok(!MANAGER.includes("getHiddenHorseFeedingRowsForAdmin"));
  assert.ok(!MANAGER.includes("setHorseFeedingVisibilityAsAdmin"));
});

// ===========================================================================
// 17-22. MARK INTERACTION
// ===========================================================================

test("17. the mark request carries ONLY horseName + targetState", () => {
  assert.match(SECTION, /onMarkProgress\(\{ horseName, targetState \}\)/);

  // The prop type itself admits no third field - an actor name/id/permission is
  // not merely unused here, it is unrepresentable.
  const propType = SECTION.slice(
    SECTION.indexOf("onMarkProgress?: (input: {"),
    SECTION.indexOf("}) => Promise<HorseFeedingProgressActionResult>")
  );
  assert.match(propType, /horseName: string;/);
  assert.match(propType, /targetState: FeedingProgressState;/);
  for (const forbidden of ["instructorId", "adminId", "actorId", "markedByName", "email", "canEdit"]) {
    assert.ok(!propType.includes(forbidden), `${forbidden} must not be part of the request`);
  }
});

test("18. a mark patches only the matching row", () => {
  assert.match(
    functionBody(SECTION, "patchProgress"),
    /row\.horseName === horseName \? \{ \.\.\.row, \.\.\.patch \} : row/,
    "every other row must be returned by identity"
  );
});

test("19. the authoritative saved row replaces the optimistic guess", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  assert.match(body, /const saved = result\.progress \?\? null;/);
  assert.match(body, /progressState: saved \? saved\.state : "PENDING"/);
  assert.match(body, /displayProgressState: saved \? saved\.state : "PENDING"/);
  // The server's own audit stamps are adopted, never locally invented.
  for (const field of [
    "hayMarkedAt: saved.hayMarkedAt",
    "hayMarkedByName: saved.hayMarkedByName",
    "concentrateMarkedAt: saved.concentrateMarkedAt",
    "concentrateMarkedByName: saved.concentrateMarkedByName",
  ]) {
    assert.ok(body.includes(field), `the saved row must supply ${field}`);
  }
});

test("20. a failed mark restores the exact prior state on BOTH failure paths", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // The snapshot is taken before the optimistic patch...
  assert.ok(
    body.indexOf("const snapshot = {") < body.indexOf("patchProgress(horseName, {"),
    "the rollback snapshot must be captured before the optimistic write"
  );
  for (const field of [
    "progressState: row.progressState",
    "displayProgressState: row.displayProgressState",
    "isDisplayStateNormalized: row.isDisplayStateNormalized",
    "progress: row.progress",
  ]) {
    assert.ok(body.includes(field), `the snapshot must capture ${field}`);
  }
  // ...and restored both when the action denies and when it throws.
  assert.equal(
    (body.match(/patchProgress\(horseName, snapshot\);/g) ?? []).length,
    2,
    "rollback must cover the !success branch AND the catch branch"
  );
});

test("21. a duplicate tap while this horse is saving produces no second call", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // Synchronous ref guard - a second tap in the same tick still sees it.
  assert.match(body, /if \(savingRef\.current\.includes\(row\.horseName\)\) return;/);
  assert.ok(
    body.indexOf("savingRef.current.includes") < body.indexOf("onMarkProgress({"),
    "the guard must precede the action call"
  );
  // The control is additionally inert while its own row is saving.
  assert.match(SECTION, /isSaving=\{savingHorses\.includes\(row\.horseName\)\}/);
  assert.match(SECTION, /finally \{\s*endSaving\(horseName\);/, "the guard is always released");
});

test("22+40. no raw exception text can ever be rendered", () => {
  // A binding-less `catch {}` cannot even name the thrown value. (`.catch(` on a
  // promise is a different construct and is deliberately not matched here.)
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    assert.ok(
      !/(^|[^.\w])catch\s*\(/.test(fileCode),
      `${path} must use a binding-less catch so the exception value is unreachable`
    );
    for (const leak of [".message", ".stack", "JSON.stringify(e", "String(err", "console.error"]) {
      assert.ok(!fileCode.includes(leak), `${path} must not surface ${leak}`);
    }
  }

  // Both failure paths fall back to a fixed Hebrew constant.
  assert.match(SECTION, /const MARK_FAILED_ERROR = "לא הצלחנו לעדכן את סימון ההאכלה\. נסו שוב\.";/);
  assert.match(SECTION, /const CLEAR_FAILED_ERROR = "לא הצלחנו לנקות את הסימונים\. נסו שוב\.";/);
  assert.match(SECTION, /setProgressError\(result\.error \?\? MARK_FAILED_ERROR\)/);
  assert.match(SECTION, /setProgressError\(result\.error \?\? CLEAR_FAILED_ERROR\)/);
});

// ===========================================================================
// 23-29. CLEAR-ALL
// ===========================================================================

test("23. clearing requires a real confirmation modal, never window.confirm", () => {
  assert.match(SECTION, /<ConfirmModal/);
  assert.match(SECTION, /title=\{CLEAR_CONFIRM_TITLE\}/);
  assert.match(SECTION, /message=\{CLEAR_CONFIRM_BODY\}/);
  assert.ok(!SECTION.includes("window.confirm"), "a native confirm is not acceptable");
  assert.ok(!SECTION.includes("window.alert"));

  // The exact approved wording, including the irreversibility sentence.
  assert.ok(SECTION.includes('const CLEAR_CONFIRM_TITLE = "ניקוי כל הסימונים"'));
  assert.ok(SECTION.includes("פעולה זו תאפס את סימוני ההאכלה של כל הסוסים ותכין את הלוח לסבב ההאכלה הבא."));
  assert.ok(SECTION.includes("הוראות ההאכלה עצמן לא יימחקו."));
  assert.ok(SECTION.includes("לא ניתן לשחזר את הסימונים שיימחקו."));
  assert.ok(SECTION.includes('const CLEAR_ALL_LABEL = "נקה את כל הסימונים"'));
  assert.match(SECTION, /cancelLabel="ביטול"/);
});

test("23b. the clear trigger is a secondary action, not the primary one", () => {
  const trigger = SECTION.slice(
    SECTION.indexOf("canClearProgress && onClearAllProgress"),
    SECTION.indexOf("{CLEAR_ALL_LABEL}")
  );
  assert.match(trigger, /variant="secondary"/, "resetting the board must not look like the default action");
});

test("24. cancelling performs no action at all", () => {
  const modal = SECTION.slice(SECTION.indexOf("<ConfirmModal"), SECTION.indexOf("/>", SECTION.indexOf("<ConfirmModal")));

  assert.match(modal, /onCancel=\{\(\) => \{[\s\S]*setClearOpen\(false\);[\s\S]*\}\}/);
  const onCancel = modal.slice(modal.indexOf("onCancel="));
  assert.ok(
    !onCancel.includes("handleClearAllProgress"),
    "cancel must not reach the clear handler by any path"
  );
});

test("25. confirming invokes the clear action exactly once", () => {
  assert.match(SECTION, /onConfirm=\{handleClearAllProgress\}/);
  assert.equal(
    (SECTION.match(/onClearAllProgress\(\)/g) ?? []).length,
    1,
    "the clear action is called from exactly one place"
  );
});

test("26+27. a successful clear resets every loaded row to PENDING and touches no meal data", () => {
  const body = functionBody(SECTION, "handleClearAllProgress");
  // NOTE: setClearMessage(null) is also called early, before the action runs -
  // so the success branch ends at its LAST occurrence, not its first.
  const successBranch = body.slice(
    body.indexOf("setRows((prev) =>"),
    body.lastIndexOf("setClearMessage(")
  );
  assert.ok(successBranch.length > 0, "expected a reset branch");

  assert.match(successBranch, /\.\.\.row,/, "every other field is carried through unchanged");
  assert.match(successBranch, /progressState: "PENDING"/);
  assert.match(successBranch, /displayProgressState: "PENDING"/);
  assert.match(successBranch, /progress: null/);

  // 27: no instruction / student / attendance field is rewritten by the reset.
  for (const untouched of [
    "morning",
    "evening",
    "lunch",
    "responsibleStudent",
    "attendanceStatus",
    "updatedByName",
  ]) {
    assert.ok(!successBranch.includes(untouched), `clearing must not rewrite ${untouched}`);
  }
});

test("28. a failed clear leaves every status unchanged", () => {
  const body = functionBody(SECTION, "handleClearAllProgress");
  const failureBranch = body.slice(
    body.indexOf("if (!result.success)"),
    body.indexOf("setRows((prev) =>")
  );

  assert.match(failureBranch, /setProgressError\(/);
  assert.ok(!failureBranch.includes("setRows"), "a denial must not rewrite any row");
  assert.match(failureBranch, /return;/, "and must not fall through to the reset");
});

test("29. duplicate confirmation is prevented on both layers", () => {
  const body = functionBody(SECTION, "handleClearAllProgress");

  assert.match(body, /if \(clearingRef\.current\) return;/, "synchronous re-entry guard");
  assert.ok(
    body.indexOf("clearingRef.current") < body.indexOf("onClearAllProgress()"),
    "the guard must precede the action call"
  );
  assert.match(SECTION, /isPending=\{isClearing\}/, "the confirm button is disabled while in flight");
  assert.match(body, /finally \{\s*clearingRef\.current = false;/, "the guard is always released");
});

// ===========================================================================
// 31-34. REFRESH ON RETURN TO THE TAB
// ===========================================================================

test("31+32. the refresh runs only when the tab actually becomes visible", () => {
  assert.match(SECTION, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);

  const handler = functionBody(SECTION, "handleVisibilityChange");
  assert.match(
    handler,
    /if \(document\.visibilityState !== "visible"\) return;/,
    "a hide event must not refresh"
  );
  assert.match(handler, /load\(\{ silent: true \}\)/);
  // ...and it never discards work in progress.
  assert.match(handler, /if \(modalOpenRef\.current\) return;/);
  assert.match(handler, /if \(savingRef\.current\.length > 0\) return;/);
});

test("31b. a background refresh cannot blank the board or steal modal edits", () => {
  const load = functionBody(SECTION, "load");

  assert.match(load, /if \(loadingRef\.current\) return;/, "no duplicate simultaneous loads");
  assert.match(load, /if \(options\?\.silent\) return;/, "a silent failure must not wipe rows");
  assert.match(load, /\.finally\(\(\) => \{\s*loadingRef\.current = false;/, "the guard is always released");
  // The instruction modal keeps its own form state; `load` only ever sets rows.
  assert.ok(!load.includes("setModalRow"), "a refresh must not close or reset the edit modal");
  assert.ok(!load.includes("setHorseName"));
});

test("33. the visibility listener is removed on unmount", () => {
  assert.match(
    SECTION,
    /return \(\) => document\.removeEventListener\("visibilitychange", handleVisibilityChange\);/
  );
});

test("34. no polling, no interval, no Realtime, no reload was introduced", () => {
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    for (const forbidden of [
      "setInterval",
      "setTimeout",
      "supabase",
      "Realtime",
      "realtime",
      "EventSource",
      "WebSocket",
      "location.reload",
      "router.refresh",
      "revalidatePath",
    ]) {
      assert.ok(!fileCode.includes(forbidden), `${path} must not use ${forbidden}`);
    }
  }
});

// ===========================================================================
// 35-39. REGRESSION - THE PRE-STAGE-5A BOARD IS INTACT
// ===========================================================================

test("35. the existing feeding-instruction editing surface is untouched", () => {
  for (const kept of [
    "function openEdit(",
    "function openNew(",
    "function handleSubmit(",
    "onSave(",
    "+ הוספת סוס",
    "עריכה",
    "HayFields",
    "ConcentrateFields",
    "MealFormFields",
    "toggleConcentrateMode",
  ]) {
    assert.ok(SECTION.includes(kept), `the edit surface lost ${kept}`);
  }
  // Both hosts still pass their own instruction writer.
  assert.match(ADMIN_HOST, /onSave=\{upsertHorseFeedingMealsAsAdmin\}/);
  assert.match(INSTRUCTOR_HOST, /onSave=\{saveFeeding\}/);
});

test("36. search/filtering is unchanged", () => {
  const filter = SECTION.slice(SECTION.indexOf("const filteredRows"), SECTION.indexOf("function openEdit"));

  assert.match(filter, /rows\.filter\(\(r\) => r\.horseName\.toLowerCase\(\)\.includes\(q\)\)/);
  assert.ok(SECTION.includes('placeholder="חיפוש לפי שם סוס..."'));
});

test("37. every pre-existing overview field is still consumed", () => {
  for (const field of [
    "row.morning",
    "row.lunch",
    "row.evening",
    "row.responsibleStudent",
    "row.attendanceStatus",
    "row.attendanceArrivalTime",
    "row.attendanceDepartureTime",
    "row.attendanceNotes",
    "row.updatedByName",
    "row.updatedAt",
  ]) {
    assert.ok(SECTION.includes(field), `the board stopped rendering ${field}`);
  }
  // ...and the Stage 4 additive fields are consumed from the DTO, not re-derived.
  assert.match(SECTION, /statusControlMode=\{row\.statusControlMode\}/);
  assert.match(SECTION, /displayProgressState=\{row\.displayProgressState\}/);
});

test("29b+38. no status-mode or display-state derivation is duplicated on the client", () => {
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    for (const forbidden of [
      "hasConcentrateContent",
      "hasHayContent",
      "resolveFeedingStatusControlMode",
      "buildFeedingBoard",
      "concentrateType",
    ]) {
      // Rendering a meal FIELD is not deriving a control MODE: the edit form
      // owns this input, and the hidden list shows it read-only to identify a
      // horse. The four real derivation entry points stay forbidden everywhere.
      if (forbidden === "concentrateType" && (path === SECTION_PATH || path === MANAGER_PATH)) {
        continue;
      }
      assert.ok(!fileCode.includes(forbidden), `${path} must not re-derive ${forbidden}`);
    }
  }
});

test("38b. Stage 5A changes no Server Action, no Prisma access and no auth module", () => {
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    assert.ok(!/["']use server["']/.test(fileCode), `${path} must not declare a Server Action module`);
    assert.ok(!fileCode.includes("@/lib/prisma"), `${path} must not reach Prisma`);
    assert.ok(!fileCode.includes("prisma."), `${path} must not query the database`);
    assert.ok(!fileCode.includes("@/lib/auth/"), `${path} must not import an auth module`);
    assert.ok(!fileCode.includes("requireAdmin"), `${path} must not re-implement an authorization gate`);
    assert.ok(!fileCode.includes("getCurrentInstructor"), `${path} must not resolve an actor client-side`);
  }
  // Every Stage 5A file is a client component - none can become an endpoint.
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    assert.match(fileCode, /^"use client";/, `${path} must stay a client component`);
  }
});

// ===========================================================================
// 45-53. A MARK THAT OUTLIVED A CLEAR-ALL CANNOT PATCH THE BOARD
//
// The behavioural rule itself (equality of generations) is proven against the
// real exported helper in ./HorseFeedingStatusControl.test.tsx. What is locked
// here is that the board actually USES it, on every one of the three async
// result paths, and that the counter advances before the reset lands.
// ===========================================================================

/** The guard, as it appears on each async result path. */
const STALE_GUARD =
  /!shouldApplyFeedingMarkResult\(\{\s*startedGeneration,\s*currentGeneration: clearGenerationRef\.current,\s*\}\)\s*\)\s*\{\s*return;\s*\}/g;

test("45. the board owns a clear-generation counter, held in a ref", () => {
  assert.match(SECTION, /const clearGenerationRef = useRef\(0\);/);
  // A ref, not state: an async result must read the value that is current NOW,
  // not the one captured by the render it was dispatched from.
  assert.ok(
    !/useState[^\n]*clearGeneration/i.test(SECTION),
    "the generation must not be render state"
  );
});

test("46. a mark captures its generation before it awaits the action", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  assert.match(body, /const startedGeneration = clearGenerationRef\.current;/);
  assert.ok(
    body.indexOf("const startedGeneration = clearGenerationRef.current;") <
      body.indexOf("await onMarkProgress("),
    "the generation must be recorded before dispatch, not after the result arrives"
  );
});

test("47. the successful and the denied result are both guarded before they patch", () => {
  const body = functionBody(SECTION, "handleMarkProgress");
  const guard = body.search(STALE_GUARD);

  assert.notEqual(guard, -1, "the success path must carry the stale-result guard");
  assert.ok(guard < body.indexOf("if (!result.success)"), "the denial rollback is behind the guard");
  assert.ok(
    guard < body.indexOf("const saved = result.progress"),
    "the authoritative patch is behind the guard"
  );
  assert.ok(guard > body.indexOf("await onMarkProgress("), "and it is evaluated after the await");
});

test("48. the thrown-failure rollback is guarded too", () => {
  const body = functionBody(SECTION, "handleMarkProgress");
  const guards = body.match(STALE_GUARD) ?? [];

  assert.equal(guards.length, 2, "exactly the resolved path and the catch path are guarded");

  const catchAt = body.indexOf("} catch {");
  const catchGuard = body.slice(catchAt).search(STALE_GUARD) + catchAt;
  assert.ok(catchAt !== -1);
  assert.ok(
    catchGuard < body.lastIndexOf("patchProgress(horseName, snapshot);"),
    "the catch must not restore the snapshot before checking the generation"
  );
});

test("49. a discarded stale result patches nothing and raises no banner", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // Everything between the guard and the first branch it protects is a bare
  // return: no patch, no error text, no message state.
  const guardAt = body.search(STALE_GUARD);
  const discarded = body.slice(guardAt, body.indexOf("if (!result.success)"));
  assert.match(discarded, /return;/);
  for (const forbidden of ["patchProgress", "setProgressError", "setClearMessage", "setRows"]) {
    assert.ok(!discarded.includes(forbidden), `a discarded result must not call ${forbidden}`);
  }
});

test("50. the per-horse lock is released even when the result is discarded", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // endSaving lives in `finally`, which runs on the guard's early return too.
  assert.match(body, /finally \{\s*endSaving\(horseName\);/);
  assert.equal(
    (body.match(/endSaving\(/g) ?? []).length,
    1,
    "there is exactly one release point, and it is unconditional"
  );
});

test("51. a successful clear advances the generation BEFORE it resets the rows", () => {
  const body = functionBody(SECTION, "handleClearAllProgress");

  assert.match(body, /clearGenerationRef\.current \+= 1;/);
  assert.ok(
    body.indexOf("clearGenerationRef.current += 1;") > body.indexOf("if (!result.success)"),
    "a FAILED clear must not advance the generation - nothing was reset"
  );
  assert.ok(
    body.indexOf("clearGenerationRef.current += 1;") < body.indexOf("setRows((prev) =>"),
    "the counter must advance before the local reset, never after it"
  );
});

test("52. a clear cannot be started while a mark is in flight", () => {
  const body = functionBody(SECTION, "handleClearAllProgress");

  assert.match(body, /if \(savingRef\.current\.length > 0\) \{/, "the handler refuses");
  assert.ok(
    body.indexOf("savingRef.current.length > 0") < body.indexOf("onClearAllProgress()"),
    "the refusal must precede the action call"
  );
  // The trigger is disabled for the same reason, with the reason stated.
  assert.match(SECTION, /disabled=\{isClearing \|\| savingHorses\.length > 0\}/);
  assert.ok(
    SECTION.includes('const CLEAR_BLOCKED_BY_MARK_ERROR = "יש להמתין לסיום עדכון ההאכלות לפני ניקוי הסימונים.";')
  );
  assert.match(body, /setProgressError\(CLEAR_BLOCKED_BY_MARK_ERROR\)/);
});

test("53. the comparison is the shared pure helper, never re-implemented inline", () => {
  assert.match(
    SECTION,
    /import \{\s*HorseFeedingStatusControl,\s*shouldApplyFeedingMarkResult,\s*\} from "@\/lib\/components\/HorseFeedingStatusControl";/
  );
  assert.match(CONTROL, /export function shouldApplyFeedingMarkResult\(input: \{/);
  assert.match(CONTROL, /return input\.startedGeneration === input\.currentGeneration;/);
  // No hand-rolled equality test on the counter anywhere in the board.
  assert.ok(
    !/startedGeneration\s*(===|!==|==|!=)/.test(SECTION),
    "the board must not compare generations itself"
  );
  // The helper stays pure: the control file imports nothing but erased types.
  assert.ok(!CONTROL.includes("useRef") && !CONTROL.includes("useState"));
});

test("39. the audit line shows local times only - never a raw ISO string or an id", () => {
  const audit = functionBody(SECTION, "formatMarkTime");

  assert.match(audit, /Number\.isNaN\(date\.getTime\(\)\)/, "an unparseable stamp renders nothing");
  assert.match(audit, /hour: "2-digit", minute: "2-digit"/);
  // Nothing is fabricated when a stamp or an actor is missing.
  assert.match(functionBody(SECTION, "markSummary"), /return byName \?\? time;/);
  assert.ok(!SECTION.includes("toISOString"), "no ISO string is ever rendered");
});

// ===========================================================================
// 70-84. FEEDING-BOARD Stage 5B - MANAGER HIDE / RESTORE
//
// The rendered hidden-list behaviour (collapsed by default, aria-expanded, the
// four list states, no progress control, tap targets) and the pure list algebra
// (PENDING reset, replace-don't-duplicate, Hebrew ordering, confirm wording) are
// proven for real in ./HorseFeedingVisibilityManager.test.tsx. What is locked
// here is the WIRING and the GUARDS that only exist inside the board.
// ===========================================================================

test("70. the admin host wires the hidden reader and the visibility action", () => {
  assert.match(ADMIN_HOST, /fetchHiddenOverview=\{getHiddenHorseFeedingRowsForAdmin\}/);
  assert.match(ADMIN_HOST, /onSetVisibility=\{setHorseFeedingVisibilityAsAdmin\}/);
  assert.match(ADMIN_HOST, /getHiddenHorseFeedingRowsForAdmin,/, "imported, not constructed");
  assert.match(ADMIN_HOST, /setHorseFeedingVisibilityAsAdmin,/);
  // A manager may always manage visibility; the flag is a literal.
  assert.match(ADMIN_HOST, /^\s*canManageVisibility$/m);
  assert.ok(!ADMIN_HOST.includes("canManageVisibility={true}"));
});

test("71. the instructor host gains nothing at all from Stage 5B", () => {
  for (const forbidden of [
    "canManageVisibility",
    "fetchHiddenOverview",
    "onSetVisibility",
    "getHiddenHorseFeedingRowsForAdmin",
    "setHorseFeedingVisibilityAsAdmin",
    "HorseFeedingVisibilityManager",
  ]) {
    assert.ok(
      !INSTRUCTOR_HOST.includes(forbidden),
      `the instructor host must not reference ${forbidden}`
    );
  }
  // Its feeding props are exactly the Stage 5A set - no manager prop was added.
  const props =
    INSTRUCTOR_HOST.match(
      /^\s+(canEdit|canMarkProgress|canClearProgress|fetchOverview|onSave|onMarkProgress|onClearAllProgress)=/gm
    ) ?? [];
  assert.equal(props.length, 7);
});

test("72. every manager affordance requires BOTH its flag and its action", () => {
  // The flag alone never reveals a control whose action was not wired.
  assert.match(SECTION, /const canHideHorses = canManageVisibility && Boolean\(onSetVisibility\);/);
  assert.match(
    SECTION,
    /const canBrowseHiddenHorses = canHideHorses && Boolean\(fetchHiddenOverview\);/
  );
  // Default OFF, so an un-wired host renders exactly the pre-5B board.
  assert.match(SECTION, /canManageVisibility = false/);
  // The hide button and both confirm dialogs are gated, as is the hidden list.
  assert.ok((SECTION.match(/\{canHideHorses && \(/g) ?? []).length >= 3);
  assert.match(SECTION, /\{canBrowseHiddenHorses && \(/);
  // Both handlers re-check, whatever the UI rendered.
  assert.match(
    functionBody(SECTION, "handleConfirmHideHorse"),
    /if \(!canManageVisibility \|\| !onSetVisibility\) return;/
  );
  assert.match(
    functionBody(SECTION, "handleConfirmRestoreHorse"),
    /if \(!canManageVisibility \|\| !onSetVisibility\) return;/
  );
});

test("73. manager permission is never inferred on the client", () => {
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    for (const forbidden of [
      "isAdmin",
      "session?.user",
      "window.location",
      "usePathname",
      "useSearchParams",
      "document.cookie",
    ]) {
      assert.ok(!fileCode.includes(forbidden), `${path} must not infer a manager from ${forbidden}`);
    }
  }
});

test("74. hide asks for an explicit isHidden: true, and only after a confirmation", () => {
  assert.match(SECTION, /onSetVisibility\(\{ horseName, isHidden: true \}\)/);
  // Opening the dialog only stages a target - it writes nothing.
  const request = functionBody(SECTION, "requestHideHorse");
  assert.match(request, /setHideTarget\(row\);/);
  assert.ok(!request.includes("onSetVisibility"), "opening the dialog must not write");
  // The confirmation is the shared ConfirmModal, with the approved wording.
  assert.match(SECTION, /open=\{hideTarget !== null\}/);
  assert.match(SECTION, /title=\{HIDE_CONFIRM_TITLE\}/);
  assert.match(SECTION, /message=\{hideTarget \? buildHideConfirmMessage\(hideTarget\) : ""\}/);
  assert.match(SECTION, /confirmLabel=\{HIDE_CONFIRM_BUTTON\}/);
  assert.match(SECTION, /onConfirm=\{handleConfirmHideHorse\}/);
  assert.ok(!SECTION.includes("window.confirm"));
});

test("75. a successful hide moves exactly one horse and resets its progress", () => {
  const body = functionBody(SECTION, "handleConfirmHideHorse");
  const success = body.slice(body.indexOf("invalidateHorseMarks(horseName);"));

  // Only the matching active row is dropped; every other row is kept by identity.
  assert.match(
    success,
    /setRows\(\(prev\) => \(prev \? prev\.filter\(\(row\) => row\.horseName !== horseName\) : prev\)\);/
  );
  // The hidden list gets its row through the pure helper, which is what forces
  // PENDING with no audit - no progress state is reconstructed here.
  assert.match(
    success,
    /setHiddenRows\(\(prev\) => \(prev === null \? prev : upsertHiddenBoardRow\(prev, target\)\)\);/
  );
  // Nothing else about the row is rewritten by hiding.
  for (const untouched of ["morning", "evening", "lunch", "attendanceStatus", "responsibleStudent"]) {
    assert.ok(!success.includes(untouched), `hiding must not rewrite ${untouched}`);
  }
});

test("76. a failed hide changes neither list", () => {
  const body = functionBody(SECTION, "handleConfirmHideHorse");
  const failure = body.slice(
    body.indexOf("if (!result.success)"),
    body.indexOf("invalidateHorseMarks")
  );

  assert.match(failure, /setVisibilityError\(result\.error \?\? HIDE_FAILED_ERROR\)/);
  assert.match(failure, /return;/);
  for (const forbidden of ["setRows", "setHiddenRows"]) {
    assert.ok(!failure.includes(forbidden), `a denial must not touch ${forbidden}`);
  }
});

test("77. hide is refused while that horse is marking, while clearing, and twice over", () => {
  const body = functionBody(SECTION, "handleConfirmHideHorse");

  assert.match(body, /if \(visibilityBusyRef\.current !== null\) return;/, "re-entry guard");
  assert.match(body, /if \(savingRef\.current\.includes\(target\.horseName\)\) \{/);
  assert.match(body, /setVisibilityError\(HIDE_BLOCKED_BY_MARK_ERROR\)/);
  assert.match(body, /if \(clearingRef\.current\) \{/);
  assert.match(body, /setVisibilityError\(HIDE_BLOCKED_BY_CLEAR_ERROR\)/);
  for (const guard of [
    "visibilityBusyRef.current !== null",
    "savingRef.current.includes(target.horseName)",
    "clearingRef.current",
  ]) {
    assert.ok(
      body.indexOf(guard) < body.indexOf("onSetVisibility("),
      `${guard} must precede the write`
    );
  }
  // The trigger is inert while any visibility write is in flight.
  assert.match(SECTION, /disabled=\{visibilityBusyHorse !== null\}/);
  assert.match(body, /finally \{[\s\S]*?visibilityBusyRef\.current = null;/, "lock always released");
});

test("78. hidden rows are fetched only for a wired manager, lazily, into their own list", () => {
  const load = functionBody(SECTION, "loadHidden");

  assert.match(load, /if \(!canManageVisibility \|\| !fetchHiddenOverview\) return;/);
  assert.match(load, /if \(hiddenLoadingRef\.current\) return;/, "no duplicate simultaneous loads");
  assert.match(load, /if \(options\?\.silent && !hiddenLoadedRef\.current\) return;/);
  assert.match(load, /setHiddenError\(HIDDEN_LOAD_FAILED_ERROR\)/);
  assert.match(load, /if \(options\?\.silent\) return;/, "a silent failure must not raise a banner");

  // Lazy: nothing is fetched until the section is actually opened.
  const toggle = functionBody(SECTION, "toggleHiddenSection");
  assert.match(toggle, /if \(next && hiddenRows === null\) loadHidden\(\);/);
  assert.match(
    SECTION,
    /const \[hiddenOpen, setHiddenOpen\] = useState\(false\);/,
    "collapsed by default"
  );

  // TWO SEPARATE LISTS. The active list is never filtered by isHidden, and the
  // hidden list is never merged into it.
  assert.match(
    SECTION,
    /const \[hiddenRows, setHiddenRows\] = useState<HorseFeedingOverviewRow\[\] \| null>\(null\);/
  );
  assert.ok(!SECTION.includes("row.isHidden"), "the board must not filter one list by isHidden");
  assert.ok(!SECTION.includes("...hiddenRows"), "the two lists are never concatenated");
});

test("79. the hidden list is a separate surface with its own search and no progress UI", () => {
  // Exactly one status control, rendered in the ACTIVE list only.
  assert.equal(
    (SECTION.match(/<HorseFeedingStatusControl/g) ?? []).length,
    1,
    "a hidden horse must never get a mark control"
  );
  assert.ok(
    SECTION.indexOf("<HorseFeedingStatusControl") <
      SECTION.indexOf("<HorseFeedingVisibilityManager"),
    "the status control belongs to the active board above the manager tool"
  );
  // Its own independent search state, which the active filter never sees.
  assert.match(SECTION, /const \[hiddenSearch, setHiddenSearch\] = useState\(""\);/);
  assert.match(SECTION, /search=\{hiddenSearch\}/);
  assert.match(SECTION, /onSearchChange=\{setHiddenSearch\}/);
  const activeFilter = SECTION.slice(
    SECTION.indexOf("const filteredRows"),
    SECTION.indexOf("function openEdit")
  );
  assert.ok(activeFilter.includes("search"), "the active board still filters on its own search");
  assert.ok(
    !activeFilter.includes("hiddenSearch"),
    "the hidden search must not narrow the operational board"
  );
  // Loading / error / rows / in-flight state are all handed to the manager.
  for (const wired of [
    "isOpen={hiddenOpen}",
    "onToggle={toggleHiddenSection}",
    "rows={hiddenRows}",
    "isLoading={hiddenLoading}",
    "loadError={hiddenError}",
    "restoringHorseName={visibilityBusyHorse}",
    "onRestore={requestRestoreHorse}",
  ]) {
    assert.ok(SECTION.includes(wired), `the hidden section is missing ${wired}`);
  }
});

test("80. restore asks for an explicit isHidden: false and refetches both lists", () => {
  assert.match(SECTION, /onSetVisibility\(\{ horseName, isHidden: false \}\)/);
  // Still an explicit second action, not a one-tap change.
  const request = functionBody(SECTION, "requestRestoreHorse");
  assert.match(request, /setRestoreTarget\(row\);/);
  assert.ok(!request.includes("onSetVisibility"), "opening the dialog must not write");
  assert.match(SECTION, /open=\{restoreTarget !== null\}/);
  assert.match(SECTION, /onConfirm=\{handleConfirmRestoreHorse\}/);

  const body = functionBody(SECTION, "handleConfirmRestoreHorse");
  const success = body.slice(body.indexOf("invalidateHorseMarks(horseName);"));
  // AUTHORITATIVE: both lists are refetched, never reconstructed - so a restored
  // horse returns with the reader's own ordering, attendance and (absent)
  // progress rather than a locally invented row.
  assert.match(success, /requestAuthoritativeRefresh\(\);/);
  for (const forbidden of [
    "progressState:",
    "displayProgressState:",
    "progress:",
    "toHiddenBoardRow",
  ]) {
    assert.ok(!success.includes(forbidden), `restore must not reconstruct ${forbidden}`);
  }
});

test("81. restore is refused twice over and leaves both lists alone on failure", () => {
  const body = functionBody(SECTION, "handleConfirmRestoreHorse");

  assert.match(body, /if \(visibilityBusyRef\.current !== null\) return;/);
  assert.ok(
    body.indexOf("visibilityBusyRef.current !== null") < body.indexOf("onSetVisibility("),
    "the guard must precede the write"
  );
  const failure = body.slice(
    body.indexOf("if (!result.success)"),
    body.indexOf("invalidateHorseMarks")
  );
  assert.match(failure, /setVisibilityError\(result\.error \?\? RESTORE_FAILED_ERROR\)/);
  for (const forbidden of ["setRows", "setHiddenRows", "load()"]) {
    assert.ok(!failure.includes(forbidden), `a denial must not touch ${forbidden}`);
  }
  assert.match(body, /finally \{[\s\S]*?visibilityBusyRef\.current = null;/);
});

test("82. a hide or restore invalidates that horse's in-flight mark, per horse", () => {
  const mark = functionBody(SECTION, "handleMarkProgress");

  // The mark records the horse's epoch before dispatch...
  assert.match(mark, /const startedHorseGeneration = horseMarkGeneration\(row\.horseName\);/);
  assert.ok(
    mark.indexOf("const startedHorseGeneration") < mark.indexOf("await onMarkProgress("),
    "the horse epoch must be captured before dispatch"
  );
  // ...and both async result paths check it, exactly like the clear epoch.
  const perHorseGuard =
    /!shouldApplyFeedingMarkResult\(\{\s*startedGeneration: startedHorseGeneration,\s*currentGeneration: horseMarkGeneration\(horseName\),\s*\}\)\s*\)\s*\{\s*return;\s*\}/g;
  assert.equal((mark.match(perHorseGuard) ?? []).length, 2, "resolved path AND catch path");
  const firstGuard = mark.search(perHorseGuard);
  assert.ok(firstGuard < mark.indexOf("if (!result.success)"));
  assert.ok(firstGuard < mark.indexOf("const saved = result.progress"));

  // Both visibility flows bump it - hide because the server cleared that horse's
  // progress, restore because the row comes back from a refetch.
  assert.match(functionBody(SECTION, "handleConfirmHideHorse"), /invalidateHorseMarks\(horseName\);/);
  assert.match(
    functionBody(SECTION, "handleConfirmRestoreHorse"),
    /invalidateHorseMarks\(horseName\);/
  );
  assert.match(
    functionBody(SECTION, "invalidateHorseMarks"),
    /\[horseName\]: horseMarkGeneration\(horseName\) \+ 1,/
  );
  // The board-wide clear epoch is untouched by Stage 5B.
  assert.match(SECTION, /const clearGenerationRef = useRef\(0\);/);
  assert.match(functionBody(SECTION, "handleClearAllProgress"), /clearGenerationRef\.current \+= 1;/);
});

test("83. the background refresh stands aside for every kind of write", () => {
  const handler = functionBody(SECTION, "handleVisibilityChange");

  assert.match(handler, /if \(document\.visibilityState !== "visible"\) return;/);
  assert.match(handler, /if \(modalOpenRef\.current\) return;/);
  assert.match(handler, /if \(savingRef\.current\.length > 0\) return;/);
  assert.match(handler, /if \(clearingRef\.current\) return;/);
  assert.match(handler, /if \(visibilityBusyRef\.current !== null\) return;/);
  // Both lists refresh, silently, and only then.
  assert.match(handler, /load\(\{ silent: true \}\);/);
  assert.match(handler, /loadHidden\(\{ silent: true \}\);/);
  for (const guard of ["visibilityBusyRef.current", "clearingRef.current", "savingRef.current"]) {
    assert.ok(handler.indexOf(guard) < handler.indexOf("load({ silent: true })"));
  }
});

test("84. Stage 5B adds no raw-error path and no deletion vocabulary", () => {
  // Fixed Hebrew fallbacks only.
  assert.match(SECTION, /const HIDE_FAILED_ERROR = "לא הצלחנו להסתיר את הסוס\. נסו שוב\.";/);
  assert.match(SECTION, /const RESTORE_FAILED_ERROR = "לא הצלחנו להחזיר את הסוס לרשימה\. נסו שוב\.";/);
  assert.match(
    SECTION,
    /const HIDDEN_LOAD_FAILED_ERROR = "לא הצלחנו לטעון את רשימת הסוסים המוסתרים\.";/
  );

  // HIDING IS NOT DELETION - no delete wording, no trash glyph, in any feeding UI
  // file. ("יימחקו" in the clear-all copy is about progress marks, so only
  // horse-deletion stems are matched here.)
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    for (const forbidden of ["🗑", "מחיקת סוס", "למחוק את הסוס", "deleteHorse", "removeHorse"]) {
      assert.ok(!fileCode.includes(forbidden), `${path} must not read as deletion (${forbidden})`);
    }
    // Hiding must not touch the known-horse-name suggestion set either.
    assert.ok(!fileCode.includes("getKnownHorseNames"), `${path} must not filter horse suggestions`);
  }
});

test("85. a post-restore refresh can never be swallowed by the duplicate-load guard", () => {
  const refresh = functionBody(SECTION, "requestAuthoritativeRefresh");

  // If a load is already running it may predate the write, so a follow-up is
  // QUEUED rather than dropped; otherwise it runs immediately.
  assert.match(refresh, /if \(loadingRef\.current\) queuedLoadRef\.current = true;\s*else load\(\);/);
  assert.match(
    refresh,
    /if \(hiddenLoadingRef\.current\) queuedHiddenLoadRef\.current = true;\s*else loadHidden\(\);/
  );
  // The hidden half stays manager-gated.
  assert.match(refresh, /if \(!canManageVisibility \|\| !fetchHiddenOverview\) return;/);

  // The queue drains in each loader's finally - and the duplicate-load guard
  // itself is untouched, so ordinary concurrent loads are still collapsed.
  const load = functionBody(SECTION, "load");
  assert.match(load, /if \(loadingRef\.current\) return;/, "the guard must NOT be removed");
  assert.match(
    load,
    /loadingRef\.current = false;\s*if \(queuedLoadRef\.current\) \{\s*queuedLoadRef\.current = false;\s*load\(\);/
  );
  const loadHidden = functionBody(SECTION, "loadHidden");
  assert.match(loadHidden, /if \(hiddenLoadingRef\.current\) return;/);
  assert.match(
    loadHidden,
    /hiddenLoadingRef\.current = false;\s*setHiddenLoading\(false\);\s*if \(queuedHiddenLoadRef\.current\) \{\s*queuedHiddenLoadRef\.current = false;\s*loadHidden\(\);/
  );
  // Exactly one queued follow-up per loader - the flag is cleared before the
  // re-run, so this cannot become a loop.
  assert.equal((SECTION.match(/queuedLoadRef\.current = false;/g) ?? []).length, 1);
  assert.equal((SECTION.match(/queuedHiddenLoadRef\.current = false;/g) ?? []).length, 1);
  // Still no page reload and no unsaved-edit hazard.
  assert.ok(!SECTION.includes("location.reload"));
  assert.ok(!SECTION.includes("router.refresh"));
  assert.ok(!refresh.includes("setModalRow"), "a refresh must not disturb an open edit modal");
});

// ===========================================================================
// 90-98. THE WHOLE CARD FOLLOWS THE DISPLAYED FEEDING PROGRESS STATE
//
// One pure lookup table over `displayProgressState` decides the card's
// background/border, and exactly one render site consumes it. Everything below
// locks that single source of truth, the neutral PENDING case, and the fact that
// colour was added WITHOUT removing any text, glyph, aria state or affordance.
// ===========================================================================

/** The pure mapping, isolated from the component that consumes it. */
const CARD_STATE_HELPER = SECTION.slice(
  SECTION.indexOf("const CARD_STATE_CLASS"),
  SECTION.indexOf("interface MealFormState")
);

/** The opening tag of ONE active-board horse card, up to its first child. */
const ACTIVE_CARD_TAG = SECTION.slice(
  SECTION.indexOf("{filteredRows.map((row) => ("),
  SECTION.indexOf('<p className="text-base font-bold text-card-foreground">{row.horseName}</p>')
);

test("90. the card state is ONE exhaustive table: neutral / amber / green", () => {
  assert.ok(CARD_STATE_HELPER.length > 0, "expected the card-state table");
  assert.match(
    CARD_STATE_HELPER,
    /const CARD_STATE_CLASS: Readonly<Record<FeedingProgressState, string>> = \{/,
    "the table must be total over FeedingProgressState, so no state can be unmapped"
  );
  // PENDING is TRULY NEUTRAL: the repository's default card surface and border,
  // with no other colour blended in, so amber/green can only ever mean the round
  // actually progressed.
  assert.match(CARD_STATE_HELPER, /^ {2}PENDING: "border-border bg-card",$/m);
  assert.match(CARD_STATE_HELPER, /^ {2}HAY_DONE: "border-warning bg-warning-muted",$/m);
  assert.match(CARD_STATE_HELPER, /^ {2}COMPLETE: "border-success bg-success-muted",$/m);
  // Exactly three entries - no fourth, undeclared card appearance.
  assert.equal((CARD_STATE_HELPER.match(/^ {2}(PENDING|HAY_DONE|COMPLETE): /gm) ?? []).length, 3);

  assert.match(
    CARD_STATE_HELPER,
    /export function resolveHorseFeedingCardStateClass\(\s*displayProgressState: FeedingProgressState\s*\): string \{\s*return CARD_STATE_CLASS\[displayProgressState\];\s*\}/,
    "the helper must be a pure total lookup, nothing more"
  );
});

test("91. the card reuses the SAME repository tokens as the status control", () => {
  // Not a new palette: HAY_DONE/COMPLETE reuse the exact warning/success tokens
  // the selected status buttons already use, so card and button agree visually.
  assert.match(CONTROL, /HAY_DONE: "border-warning bg-warning-muted text-warning"/);
  assert.match(CONTROL, /COMPLETE: "border-success bg-success-muted text-success"/);
  // No hard-coded colour anywhere in the feeding UI.
  for (const [path, fileCode] of FEEDING_UI_FILES) {
    assert.ok(!/#[0-9a-fA-F]{3}\b/.test(fileCode), `${path} must not hard-code a hex colour`);
    assert.ok(!/rgba?\(/.test(fileCode), `${path} must not hard-code an rgb colour`);
    assert.ok(!/\bstyle=\{\{/.test(fileCode), `${path} must not inline a style object`);
  }
});

test("92. the mapping reads displayProgressState and nothing else", () => {
  // The DTO field the Stage 2 pure core already resolved is the only input.
  assert.match(ACTIVE_CARD_TAG, /resolveHorseFeedingCardStateClass\(row\.displayProgressState\)/);
  // No audit timestamp, no actor name, no meal content, no clock, no second
  // state machine - the card cannot drift from the control below it.
  for (const forbidden of [
    "MarkedAt",
    "MarkedByName",
    "row.progress",
    "isDisplayStateNormalized",
    "statusControlMode",
    "morning",
    "evening",
    "Date",
    "useState",
    "useMemo",
  ]) {
    assert.ok(
      !CARD_STATE_HELPER.includes(forbidden),
      `the card mapping must not inspect ${forbidden}`
    );
  }
});

test("93. exactly one render site decides a card's colour", () => {
  // Definition + a single call: the mapping is never repeated in a branch.
  assert.equal(
    (SECTION.match(/resolveHorseFeedingCardStateClass\(/g) ?? []).length,
    2,
    "the helper is defined once and called from exactly one place"
  );
  assert.match(
    ACTIVE_CARD_TAG,
    /className=\{`rounded-xl border-2 p-3 \$\{resolveHorseFeedingCardStateClass\(row\.displayProgressState\)\}`\}/,
    "the feeding-state background is derived from displayProgressState ALONE"
  );
  // NO FALLBACK, and no other colour source: an unmarked horse is neutral, never
  // tinted by its group - so the card colour has exactly one meaning.
  assert.ok(
    !ACTIVE_CARD_TAG.includes("getScheduleGroupColorClass"),
    "the active card must not fall back to the group colour"
  );
  assert.ok(
    !SECTION.includes("getScheduleGroupColorClass"),
    "the group-colour helper must not reach the feeding board at all"
  );
  assert.ok(
    !SECTION.includes("@/lib/schedule-group-colors"),
    "and its module must no longer be imported"
  );
  // The tag itself carries no colour literal - it all comes from the helper.
  assert.ok(!ACTIVE_CARD_TAG.includes("bg-"), "no background class may be written inline");
  assert.ok(
    !/border-(warning|success|danger|muted|border)/.test(ACTIVE_CARD_TAG),
    "no border colour may be written inline"
  );
});

test("93b. group identity is still shown, as text, exactly as before", () => {
  // Losing the card tint must not lose the information: the responsible-student
  // line still names the trainee, their group and their subgroup, unchanged.
  assert.match(SECTION, /חניך\/ה אחראי\/ת: \{row\.responsibleStudent\.fullName\}/);
  assert.match(
    SECTION,
    /\{row\.responsibleStudent\.groupName \? ` · קבוצה \$\{row\.responsibleStudent\.groupName\}` : ""\}/
  );
  assert.match(
    SECTION,
    /\{row\.responsibleStudent\.subgroupNumber != null\s*\? ` \/ תת-קבוצה \$\{row\.responsibleStudent\.subgroupNumber\}`\s*: ""\}/
  );
  // The attendance badges keep their own independent colours and wording.
  assert.match(SECTION, /STATUS_BADGE_CLASS\.ABSENT/);
  assert.match(SECTION, /STATUS_BADGE_CLASS\.PARTIAL/);
  assert.ok(SECTION.includes("נעדר/ת היום"));
  assert.ok(SECTION.includes("נוכחות חלקית"));
});

test("94. the optimistic patch drives the card, and rollback restores it", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // The card's ONLY input is a field the existing optimistic patch already
  // writes, so the background flips on tap with no extra state.
  assert.match(
    SECTION,
    /"progressState" \| "displayProgressState" \| "isDisplayStateNormalized" \| "progress"/,
    "displayProgressState stays part of the per-row progress patch"
  );
  assert.ok(
    body.indexOf("displayProgressState: targetState") < body.indexOf("await onMarkProgress("),
    "the display state must be patched optimistically, before the action resolves"
  );
  // ...and the existing rollback snapshot carries it, so a denial or a throw
  // returns the card to the exact colour it had.
  assert.ok(body.includes("displayProgressState: row.displayProgressState"));
  assert.ok(
    body.indexOf("const snapshot = {") < body.indexOf("patchProgress(horseName, {"),
    "the snapshot precedes the optimistic write"
  );
  assert.equal(
    (body.match(/patchProgress\(horseName, snapshot\);/g) ?? []).length,
    2,
    "both failure paths restore the previous background"
  );
  // A reset returns every card to neutral through the same single field.
  assert.match(
    functionBody(SECTION, "handleClearAllProgress"),
    /displayProgressState: "PENDING"/
  );
  // No parallel colour state was introduced anywhere.
  assert.ok(!SECTION.includes("cardState"), "the card colour must not become React state");
  assert.ok(!SECTION.includes("setCard"));
});

test("95. completeOnly needs no special case: PENDING neutral, COMPLETE green", () => {
  // The table is keyed by state alone, so a hay-only horse reaches COMPLETE and
  // gets the same green - and can never reach the amber HAY_DONE entry, because
  // the control does not offer that option in this mode.
  assert.ok(!CARD_STATE_HELPER.includes("completeOnly"));
  assert.ok(!CARD_STATE_HELPER.includes("mode"));
  assert.match(
    CONTROL,
    /const COMPLETE_ONLY_OPTIONS: readonly FeedingStatusControlOption\[\] = Object\.freeze\(\[\s*PENDING_OPTION,\s*COMPLETE_ONLY_OPTION,\s*\]\);/,
    "completeOnly still offers exactly PENDING and COMPLETE"
  );
  assert.match(
    CONTROL,
    /return mode === "hayAndConcentrate" \? HAY_AND_CONCENTRATE_OPTIONS : COMPLETE_ONLY_OPTIONS;/
  );
});

test("96. hidden-horse manager cards are not coloured as progress cards", () => {
  assert.ok(
    MANAGER.includes('<div key={row.horseName} className="rounded-xl border border-border bg-card p-3">'),
    "the hidden list keeps its own plain card"
  );
  assert.ok(!MANAGER.includes("resolveHorseFeedingCardStateClass"));
  assert.ok(!MANAGER.includes("CARD_STATE_CLASS"));
  for (const tint of ["bg-warning-muted", "bg-success-muted", "border-warning", "border-success"]) {
    assert.ok(!MANAGER.includes(tint), `a hidden horse must not be tinted with ${tint}`);
  }
});

test("97. colour is supplemental, and the card gained no affordance", () => {
  // The card is decoration only: no click target, no role, no focus stop.
  for (const forbidden of ["onClick", "onKeyDown", "role=", "tabIndex", "cursor-pointer", "<button"]) {
    assert.ok(!ACTIVE_CARD_TAG.includes(forbidden), `the card must not become ${forbidden}`);
  }
  // The status is still readable without colour: label, glyph and aria-checked
  // all survive, and the board still feeds the control the same field.
  assert.match(CONTROL, /aria-checked=\{isSelected\}/);
  assert.match(CONTROL, /<span aria-hidden="true">\{option\.glyph\}<\/span>/);
  assert.match(CONTROL, /<span>\{option\.label\}<\/span>/);
  assert.match(CONTROL, /aria-label=\{`\$\{option\.label\} - \$\{horseName\}`\}/);
  assert.match(CONTROL, /role="radiogroup"/);
  assert.match(SECTION, /displayProgressState=\{row\.displayProgressState\}/);
  // The audit lines and the read-only notice are untouched.
  assert.ok(SECTION.includes("<MarkAuditLines"));
  assert.ok(SECTION.includes("תצוגה בלבד - אין הרשאת עריכת האכלות"));
});

test("98. the card colour changes nothing outside the board component", () => {
  // Neither host knows about it, and no new import was needed: the state comes
  // from the DTO type that was already imported.
  for (const [path, fileCode] of [
    [ADMIN_HOST_PATH, ADMIN_HOST],
    [INSTRUCTOR_HOST_PATH, INSTRUCTOR_HOST],
  ] as const) {
    assert.ok(
      !fileCode.includes("resolveHorseFeedingCardStateClass"),
      `${path} must not reference the card mapping`
    );
  }
  assert.match(
    SECTION,
    /import type \{ FeedingProgressState \} from "@\/lib\/feeding\/feeding-board-core";/,
    "the state type is still a TYPE-only import - no runtime module was added"
  );
  // The card colour needs no runtime dependency at all: the three classes are
  // repository tokens and the state type is erased at build time.
  assert.ok(
    !SECTION.includes('from "@/lib/schedule-group-colors"'),
    "the group-colour module is no longer a dependency of the feeding board"
  );
});

test("86. the hidden-horse mark refusal is surfaced as an ordinary action failure", () => {
  const body = functionBody(SECTION, "handleMarkProgress");

  // The server's own stable Hebrew reason is shown as-is; the board neither
  // re-words it nor treats it as an auth failure, and the optimistic patch is
  // rolled back like any other denial.
  assert.match(body, /setProgressError\(result\.error \?\? MARK_FAILED_ERROR\)/);
  assert.ok(
    !SECTION.includes("מוסתר מרשימת ההאכלה") || SECTION.includes("CLEAR_BLOCKED_BY_MARK_ERROR"),
    "the board must not hard-code the server's hidden-horse wording"
  );
  assert.ok(
    !SECTION.includes("HIDDEN_HORSE_MARK_ERROR"),
    "the denial text belongs to the server layer, not to the client"
  );
});
