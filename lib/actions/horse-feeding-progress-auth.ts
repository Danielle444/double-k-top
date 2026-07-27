/**
 * FEEDING-BOARD Stage 3 - PURE, dependency-injected authorization orchestration
 * for the feeding-round progress board and for manager horse visibility.
 *
 * Like ./horse-feeding-auth, ./attendance-read-auth and ./attendance-write-auth,
 * this is deliberately NOT a "use server" module: it is a plain server-side
 * library, so nothing here is registered as a Server Action and none of it is
 * reachable from a browser. It carries the testable orchestration - resolve the
 * trusted actor, decide, then delegate - that the public server actions of a
 * later stage will import and wire to real dependencies (the canonical actor DAL
 * getCurrentInstructor, the admin resolver, and the Prisma mutators).
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies /
 * next-cache / generated-client import: every impure capability (the actor
 * resolvers and the mutators) is passed in through the *Deps interfaces. The
 * only edges to other modules are erased `import type`s, so they create no
 * runtime import and pull in neither Next.js nor Prisma.
 *
 * SECURITY CONTRACT (the three distinct trust tiers this module enforces):
 *
 *  1. MARK feeding progress  - admin OR an instructor holding canEditHorseFeeding.
 *  2. CLEAR the whole board  - admin OR an instructor holding canEditHorseFeeding
 *                              (locked product decision: a round reset must not
 *                              require the manager to be physically present).
 *  3. HIDE / RESTORE a horse - ADMIN ONLY. There is deliberately NO instructor
 *                              entry point in this module, not even a private
 *                              one: canEditHorseFeeding governs feeding data and
 *                              round marks, never which horses exist on the
 *                              board. An instructor cannot reach visibility by
 *                              any path, so there is nothing to bypass.
 *
 * Identity ALWAYS comes from the injected server-side resolver, never from a
 * caller. That is enforced structurally, not merely by convention: the public
 * request types below (FeedingProgressMarkRequest / HorseFeedingVisibilityRequest)
 * carry NO actor id, name or email field, while the mutator command types carry
 * the authorship name the orchestration derived. It is a TYPE ERROR for a caller
 * to supply an actor name, and the mutator can only ever receive a
 * server-derived one.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: a THROWN actor resolution (session/infra
 * failure - a missing/weak SESSION_SECRET, a Prisma error inside the resolver) is
 * caught around the actor resolution ONLY and treated exactly like a missing
 * actor: the same stable authorization error is returned and the mutator is never
 * invoked. The catch is scoped strictly to the resolution so a genuine mutator
 * error still propagates unchanged, and no internal session/reason-code detail is
 * ever surfaced.
 *
 * ADMIN RESOLVER SHAPE (a note for the wiring stage): `resolveCurrentAdmin` is
 * typed to RETURN NULL for a non-admin. The existing `requireAdmin()` helper does
 * not do that - it `redirect()`s, which Next.js implements by THROWING. Injecting
 * requireAdmin directly here would still fail closed (the throw is caught and
 * becomes a denial), but the redirect would be swallowed and the user would see
 * an error instead of the login page. The wiring stage must therefore inject a
 * null-returning admin resolver, or call requireAdmin() OUTSIDE this
 * orchestration; the catch here is a backstop, not the intended mechanism.
 */
import type { FeedingProgressState } from "@/lib/feeding/feeding-board-core";
import type { ActionResult } from "./students";

// --- stable, PII-free error contract ----------------------------------------
//
// Three distinguishable failures, so a UI can tell "log in again" from "you may
// look but not mark". Every message is a fixed constant: no email, no id, no
// horse name, no resolver reason code, no stack detail ever reaches a caller.

/** Tier 3 denial: the action is manager/admin-only. */
export const ADMIN_REQUIRED_ERROR = "נדרשת הרשאת מנהל";

/** No trustworthy instructor session (missing / invalid / inactive / wrong audience). */
export const INSTRUCTOR_REQUIRED_ERROR = "נדרשת התחברות כמדריך/ה";

/**
 * A known instructor without the feeding-edit permission. Identical wording to
 * the pre-existing ./horse-feeding-auth rejection, so the UI-visible error for
 * "you lack canEditHorseFeeding" stays one single string across the feature.
 */
export const NO_FEEDING_PERMISSION_ERROR = "אין הרשאה לערוך האכלות";

// --- actor shapes consumed by this module -----------------------------------

/**
 * The admin fields this module consumes: the display-name pair only. Mirrors
 * CurrentAdmin. `isActive` is optional and is a DEFENCE-IN-DEPTH backstop: the
 * real admin resolver already rejects an inactive admin before returning, so the
 * field is normally absent - and `undefined` therefore must NOT be read as
 * inactive. Only an explicit `false` is a denial.
 */
export interface FeedingAdminActor {
  readonly name: string | null;
  readonly email: string;
  readonly isActive?: boolean;
}

/**
 * The instructor fields this module consumes: the feeding-edit permission plus
 * the authorship name. Mirrors the canonical InstructorActor, which deliberately
 * does NOT expose isActive (the DAL returns null for an inactive instructor).
 * The optional flag here is the same defence-in-depth backstop as above.
 */
export interface FeedingInstructorActor {
  readonly canEditHorseFeeding: boolean;
  readonly fullName: string;
  readonly isActive?: boolean;
}

// --- request shapes (client-supplied; carry NO identity) --------------------

/** What a caller may ask for when marking one horse. No actor field exists. */
export interface FeedingProgressMarkRequest {
  readonly horseName: string;
  readonly targetState: FeedingProgressState;
}

/** What a caller may ask for when hiding/restoring one horse. Admin-only path. */
export interface HorseFeedingVisibilityRequest {
  readonly horseName: string;
  readonly isHidden: boolean;
}

// --- command shapes (server-composed; carry the derived authorship) ---------

/**
 * Passed to the mark mutator: the caller's request plus the authorship name this
 * orchestration derived from the trusted actor. `targetState` is forwarded
 * unchanged - the mutator owns validation and persistence, this module owns only
 * "who is allowed to ask".
 */
export interface FeedingProgressMarkCommand {
  readonly horseName: string;
  readonly targetState: FeedingProgressState;
  readonly markedByName: string;
}

/**
 * Passed to the clear mutator.
 *
 * NOTE: the committed schema does NOT persist clear authorship - resetting the
 * board deletes every progress row, so there is nowhere to write this. It is
 * orchestration metadata only, available to the mutator for action-level
 * reporting or future logging, and it must NOT be read as evidence that a
 * "clearedByName" column exists.
 */
export interface FeedingProgressClearCommand {
  readonly clearedByName: string;
}

/** Passed to the visibility mutator. `isHidden: false` is the RESTORE case. */
export interface HorseFeedingVisibilityCommand {
  readonly horseName: string;
  readonly isHidden: boolean;
  readonly updatedByName: string;
}

// --- dependency interfaces --------------------------------------------------

/** Resolvers return null for "no trustworthy actor of this kind". */
type AdminResolver = () => Promise<FeedingAdminActor | null>;
type InstructorResolver = () => Promise<FeedingInstructorActor | null>;

export interface AdminMarkFeedingProgressDeps {
  readonly resolveCurrentAdmin: AdminResolver;
  readonly markProgress: (command: FeedingProgressMarkCommand) => Promise<ActionResult>;
}

export interface InstructorMarkFeedingProgressDeps {
  readonly getCurrentInstructor: InstructorResolver;
  readonly markProgress: (command: FeedingProgressMarkCommand) => Promise<ActionResult>;
}

export interface AdminClearFeedingProgressDeps {
  readonly resolveCurrentAdmin: AdminResolver;
  readonly clearAllProgress: (command: FeedingProgressClearCommand) => Promise<ActionResult>;
}

export interface InstructorClearFeedingProgressDeps {
  readonly getCurrentInstructor: InstructorResolver;
  readonly clearAllProgress: (command: FeedingProgressClearCommand) => Promise<ActionResult>;
}

export interface AdminHorseFeedingVisibilityDeps {
  readonly resolveCurrentAdmin: AdminResolver;
  readonly setVisibility: (command: HorseFeedingVisibilityCommand) => Promise<ActionResult>;
}

// --- shared authorization core ----------------------------------------------

/** Internal decision: either an authorship name, or the error to return. */
type AuthorshipDecision =
  | { readonly authorized: true; readonly authorName: string }
  | { readonly authorized: false; readonly error: string };

function denied(error: string): AuthorshipDecision {
  return { authorized: false, error };
}

/**
 * ADMIN FLOW: resolve -> reject a missing/thrown/explicitly-inactive actor ->
 * derive the authorship name. The name is preferred when it holds any
 * non-whitespace content; otherwise the email is the fallback, matching what the
 * existing admin feeding writer persists (`admin.name ?? admin.email`) while also
 * treating a blank name as absent.
 */
async function authorizeAdmin(resolve: AdminResolver): Promise<AuthorshipDecision> {
  let admin: FeedingAdminActor | null;
  try {
    admin = await resolve();
  } catch {
    return denied(ADMIN_REQUIRED_ERROR);
  }
  if (!admin || admin.isActive === false) return denied(ADMIN_REQUIRED_ERROR);
  const trimmedName = typeof admin.name === "string" ? admin.name.trim() : "";
  return { authorized: true, authorName: trimmedName.length > 0 ? trimmedName : admin.email };
}

/**
 * INSTRUCTOR FLOW: resolve -> reject a missing/thrown/explicitly-inactive actor
 * (INSTRUCTOR_REQUIRED_ERROR) -> reject an instructor without
 * canEditHorseFeeding (NO_FEEDING_PERMISSION_ERROR) -> use the actor's own
 * fullName as authorship. A client name is structurally impossible here: no
 * request type carries one.
 */
async function authorizeFeedingEditor(resolve: InstructorResolver): Promise<AuthorshipDecision> {
  let instructor: FeedingInstructorActor | null;
  try {
    instructor = await resolve();
  } catch {
    return denied(INSTRUCTOR_REQUIRED_ERROR);
  }
  if (!instructor || instructor.isActive === false) return denied(INSTRUCTOR_REQUIRED_ERROR);
  if (instructor.canEditHorseFeeding !== true) return denied(NO_FEEDING_PERMISSION_ERROR);
  return { authorized: true, authorName: instructor.fullName };
}

// --- A. mark progress as admin ----------------------------------------------

/**
 * Mark one horse's feeding progress as an admin.
 *
 * Authorization completes BEFORE the mutator is referenced: on every denial this
 * returns the stable error and `markProgress` is never invoked, so no write and
 * no payload-validation side effect occurs. On success the mutator runs exactly
 * once with the caller's horseName/targetState forwarded unchanged plus the
 * server-derived markedByName, and its result is returned verbatim.
 */
export async function markHorseFeedingProgressAsAdminWithDeps(
  deps: AdminMarkFeedingProgressDeps,
  request: FeedingProgressMarkRequest,
): Promise<ActionResult> {
  const decision = await authorizeAdmin(deps.resolveCurrentAdmin);
  if (!decision.authorized) return { success: false, error: decision.error };
  return deps.markProgress({
    horseName: request.horseName,
    targetState: request.targetState,
    markedByName: decision.authorName,
  });
}

// --- B. mark progress as instructor -----------------------------------------

/**
 * Mark one horse's feeding progress as an instructor holding canEditHorseFeeding.
 * Same ordering guarantee as the admin path; authorship is the actor's fullName.
 */
export async function markHorseFeedingProgressAsInstructorWithDeps(
  deps: InstructorMarkFeedingProgressDeps,
  request: FeedingProgressMarkRequest,
): Promise<ActionResult> {
  const decision = await authorizeFeedingEditor(deps.getCurrentInstructor);
  if (!decision.authorized) return { success: false, error: decision.error };
  return deps.markProgress({
    horseName: request.horseName,
    targetState: request.targetState,
    markedByName: decision.authorName,
  });
}

// --- C. clear the board as admin --------------------------------------------

/**
 * Reset the whole board ("נקה את כל הסימונים") as an admin. Takes no request
 * payload at all - the operation has no per-horse argument, so there is nothing
 * a caller could scope, spoof, or partially apply.
 */
export async function clearAllHorseFeedingProgressAsAdminWithDeps(
  deps: AdminClearFeedingProgressDeps,
): Promise<ActionResult> {
  const decision = await authorizeAdmin(deps.resolveCurrentAdmin);
  if (!decision.authorized) return { success: false, error: decision.error };
  return deps.clearAllProgress({ clearedByName: decision.authorName });
}

// --- D. clear the board as instructor ---------------------------------------

/**
 * Reset the whole board as an instructor holding canEditHorseFeeding - the same
 * trust tier as marking, by locked product decision: the people who run the
 * round are the people who start the next one.
 */
export async function clearAllHorseFeedingProgressAsInstructorWithDeps(
  deps: InstructorClearFeedingProgressDeps,
): Promise<ActionResult> {
  const decision = await authorizeFeedingEditor(deps.getCurrentInstructor);
  if (!decision.authorized) return { success: false, error: decision.error };
  return deps.clearAllProgress({ clearedByName: decision.authorName });
}

// --- E. hide / restore a horse (ADMIN ONLY) ---------------------------------

/**
 * Hide (`isHidden: true`) or RESTORE (`isHidden: false`) a horse on the feeding
 * board. ADMIN ONLY - and there is no instructor counterpart anywhere in this
 * module, by design, so canEditHorseFeeding can never reach this operation.
 *
 * Both directions run through this one entry point and the one admin gate, so
 * restore can never be less protected than hide. The mutator owns the write; this
 * module never deletes anything, and hiding never touches feeding instructions.
 */
export async function setHorseFeedingVisibilityAsAdminWithDeps(
  deps: AdminHorseFeedingVisibilityDeps,
  request: HorseFeedingVisibilityRequest,
): Promise<ActionResult> {
  const decision = await authorizeAdmin(deps.resolveCurrentAdmin);
  if (!decision.authorized) return { success: false, error: decision.error };
  return deps.setVisibility({
    horseName: request.horseName,
    isHidden: request.isHidden,
    updatedByName: decision.authorName,
  });
}
