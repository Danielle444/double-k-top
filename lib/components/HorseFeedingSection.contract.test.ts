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
const ADMIN_HOST_PATH = "app/admin/horses/HorsesClient.tsx";
const INSTRUCTOR_HOST_PATH = "app/instructor/InstructorHorsesSection.tsx";

const SECTION = code(SECTION_PATH);
const CONTROL = code(CONTROL_PATH);
const ADMIN_HOST = code(ADMIN_HOST_PATH);
const INSTRUCTOR_HOST = code(INSTRUCTOR_HOST_PATH);

const STAGE_5A_FILES: readonly (readonly [string, string])[] = [
  [SECTION_PATH, SECTION],
  [CONTROL_PATH, CONTROL],
  [ADMIN_HOST_PATH, ADMIN_HOST],
  [INSTRUCTOR_HOST_PATH, INSTRUCTOR_HOST],
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
    /disabled=\{!canMarkProgress \|\| !onMarkProgress\}/,
    "the control must be shown (status is still information) but inert"
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
// 15-16. STAGE 5A ADDS NO HIDE/RESTORE SURFACE
// ===========================================================================

test("15. no hide/restore UI is introduced anywhere in Stage 5A", () => {
  for (const [path, fileCode] of STAGE_5A_FILES) {
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
    ]) {
      assert.ok(!fileCode.includes(forbidden), `${path} must not reference ${forbidden}`);
    }
  }
  assert.ok(!SECTION.includes("הסתרת סוס"));
  assert.ok(!SECTION.includes("שחזור סוס"));
  // The only horse-feeding actions either host imports are the four wired ones.
  for (const [path, fileCode] of [
    [ADMIN_HOST_PATH, ADMIN_HOST],
    [INSTRUCTOR_HOST_PATH, INSTRUCTOR_HOST],
  ] as const) {
    const importBlock = fileCode.slice(
      fileCode.indexOf('from "@/lib/actions/horses"'),
      fileCode.indexOf('} from "@/lib/actions/horse-feeding";')
    );
    assert.ok(!importBlock.includes("Visibility"), `${path} must not import a visibility action`);
    assert.ok(!importBlock.includes("Hidden"), `${path} must not import the hidden-row reader`);
  }
});

test("16. the admin-only hidden-row reader is never called", () => {
  for (const [path, fileCode] of STAGE_5A_FILES) {
    assert.ok(
      !fileCode.includes("getHiddenHorseFeedingRowsForAdmin"),
      `${path} must not call the hidden-row reader`
    );
  }
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
  for (const [path, fileCode] of STAGE_5A_FILES) {
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
  for (const [path, fileCode] of STAGE_5A_FILES) {
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
  for (const [path, fileCode] of STAGE_5A_FILES) {
    for (const forbidden of [
      "hasConcentrateContent",
      "hasHayContent",
      "resolveFeedingStatusControlMode",
      "buildFeedingBoard",
      "concentrateType",
    ]) {
      if (path === SECTION_PATH && forbidden === "concentrateType") continue; // the edit form legitimately owns this input
      assert.ok(!fileCode.includes(forbidden), `${path} must not re-derive ${forbidden}`);
    }
  }
});

test("38b. Stage 5A changes no Server Action, no Prisma access and no auth module", () => {
  for (const [path, fileCode] of STAGE_5A_FILES) {
    assert.ok(!/["']use server["']/.test(fileCode), `${path} must not declare a Server Action module`);
    assert.ok(!fileCode.includes("@/lib/prisma"), `${path} must not reach Prisma`);
    assert.ok(!fileCode.includes("prisma."), `${path} must not query the database`);
    assert.ok(!fileCode.includes("@/lib/auth/"), `${path} must not import an auth module`);
    assert.ok(!fileCode.includes("requireAdmin"), `${path} must not re-implement an authorization gate`);
    assert.ok(!fileCode.includes("getCurrentInstructor"), `${path} must not resolve an actor client-side`);
  }
  // Every Stage 5A file is a client component - none can become an endpoint.
  for (const [path, fileCode] of STAGE_5A_FILES) {
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
