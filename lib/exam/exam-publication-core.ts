/**
 * EXAM X0 — PURE publication-staleness + affected-user preview core.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * IO. It NEVER reads the wall clock — both `updatedAt` and `individualPublishedAt`
 * are caller-supplied comparable epoch-millisecond numbers (the caller converts
 * `Date` → number). Deterministic; never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - the publication status of one `ExamSession`: UNPUBLISHED / CURRENT / STALE.
 *    General publication lives on the `ExamPlan`; INDIVIDUAL publication lives on
 *    the `ExamSession`. A session is:
 *      UNPUBLISHED — no `individualPublishedAt` timestamp;
 *      STALE       — `updatedAt > individualPublishedAt` (edited after publish);
 *      CURRENT     — otherwise (published and not edited since).
 *    Phase 1 keeps LIVE rows with booleans/timestamps only — NO snapshot or
 *    version history.
 *  - the affected-user PREVIEW set: the deterministically deduped, sorted set of
 *    internal trainee ids and instructor ids affected by (re)publishing a set of
 *    sessions, for an edit-after-publication confirmation. External candidates
 *    have NO login and are therefore never part of the preview set.
 *
 * It does NOT send notifications, does NOT persist publication, and touches no
 * schema/DB/UI.
 */

// ===========================================================================
// Publication status
// ===========================================================================

export type ExamPublicationStatus = "UNPUBLISHED" | "CURRENT" | "STALE";

/** The publication timestamps of one session. Values are epoch milliseconds. */
export interface PublicationTimestamps {
  /** Last content modification (epoch ms). */
  readonly updatedAt: number;
  /** Individual publication time (epoch ms), or null/undefined if never
   * published. */
  readonly individualPublishedAt: number | null | undefined;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Resolve the publication status of one session. Pure and total.
 *
 *  - a missing (`null`/`undefined`/non-finite) `individualPublishedAt` ⇒
 *    UNPUBLISHED;
 *  - `updatedAt > individualPublishedAt` ⇒ STALE;
 *  - otherwise ⇒ CURRENT.
 *
 * Fail-closed on a malformed `updatedAt`: if the session is published but its
 * `updatedAt` is not a finite number, the status is STALE (it cannot be proven
 * current, so it is surfaced for review rather than silently trusted).
 */
export function resolvePublicationStatus(
  timestamps: PublicationTimestamps,
): ExamPublicationStatus {
  const published = timestamps.individualPublishedAt;
  if (!isFiniteNumber(published)) return "UNPUBLISHED";
  if (!isFiniteNumber(timestamps.updatedAt)) return "STALE";
  return timestamps.updatedAt > published ? "STALE" : "CURRENT";
}

/** Convenience predicate: is the session stale (published then edited)? */
export function isPublicationStale(timestamps: PublicationTimestamps): boolean {
  return resolvePublicationStatus(timestamps) === "STALE";
}

// ===========================================================================
// Affected-user preview set
// ===========================================================================

/** The affected users contributed by one session. */
export interface AffectedUsersInput {
  /** Internal trainee (Student) ids affected by this session. */
  readonly traineeIds: readonly string[];
  /** Instructor (supervisor/examiner) ids affected by this session. */
  readonly instructorIds: readonly string[];
}

/** The deduped, sorted affected-user preview set. */
export interface AffectedUsersPreview {
  readonly traineeIds: readonly string[];
  readonly instructorIds: readonly string[];
}

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Collect, trim, dedupe, and sort ids from a list of id arrays. */
function collect(idArrays: readonly (readonly string[])[]): readonly string[] {
  const set = new Set<string>();
  for (const arr of idArrays) {
    for (const id of arr) {
      if (isPresent(id)) set.add(id.trim());
    }
  }
  return Object.freeze([...set].sort());
}

/**
 * Compute the affected-user preview set across a set of sessions being
 * (re)published. Trainee and instructor ids are UNIONED, deduped, and sorted
 * deterministically. The inputs are never mutated. External candidates have no
 * login and are intentionally not represented in the input, so they never appear
 * in the preview.
 */
export function computeAffectedUsersPreview(
  sessions: readonly AffectedUsersInput[],
): AffectedUsersPreview {
  return Object.freeze({
    traineeIds: collect(sessions.map((s) => s.traineeIds)),
    instructorIds: collect(sessions.map((s) => s.instructorIds)),
  });
}
