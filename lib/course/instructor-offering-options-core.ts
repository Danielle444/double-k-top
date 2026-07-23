/**
 * URGENT LEVEL 2 ACCESS - SLICE C0-A: PURE decision core for the INSTRUCTOR
 * CONTACT course-options menu.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie read, and no import of the temporary compatibility module
 * (the allowed-id set is INJECTED). It only filters already-fetched rows against
 * an explicit allow-list, composes a display label, and orders the result
 * deterministically, so the whole contract is unit-testable without a database
 * (see instructor-offering-options-core.test.ts).
 *
 * WHAT THIS IS - AND IS NOT
 * -------------------------
 * This produces a MENU, not an authorization. Appearing in this list means only
 * "an instructor may ASK for this course context". It grants no module, no
 * roster, and no contact row. Every later read must independently re-validate
 * the selected id server-side (resolveInstructorCourseOffering), which is the
 * component that actually authorizes and verifies existence.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - EXACT-ID membership only. A row is kept iff its id is in the injected
 *    allow-list. No name, level, status, date-window, ActivityYear, row-order or
 *    "current offering" reasoning participates in that decision.
 *  - An allowed offering that does not exist in the fetched rows is OMITTED -
 *    never fabricated, never substituted by another offering.
 *  - A fetched row whose id is not allowed is DROPPED (independent defense: the
 *    query is expected to filter too, so a future query edit cannot silently
 *    widen the menu).
 *  - Ordering is DISPLAY-ONLY and carries NO selection meaning. There is no
 *    selected/default/isCurrent field in the output, by design - the caller must
 *    select explicitly, and nothing here implies a default course.
 *  - Status is PASSED THROUGH unchanged (a PLANNED offering is a legitimate
 *    instructor-preparation option and is never filtered out or relabelled).
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";

/**
 * The EXACT CourseOffering columns this core consumes. Deliberately four
 * columns: no startDate/endDate (dates must never influence course context, and
 * the menu has no use for them), no activityYearId, and no relations.
 */
export interface InstructorCourseOfferingOptionRow {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly status: CourseOfferingStatus;
}

/**
 * One selectable option as it is handed to the caller. `label` is composed on
 * the SERVER from the DB-backed name and level, so no client needs to know
 * anything about which courses exist. There is deliberately no selected/default
 * marker and no date field.
 */
export interface InstructorCourseOptionView {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly status: CourseOfferingStatus;
}

/**
 * Compose the Hebrew display label from the DB-backed level and name. The name
 * is used verbatim (only trimmed for the emptiness check); a blank name yields
 * the level alone rather than a dangling separator. This is presentation only -
 * nothing downstream may parse a label back into a course identity.
 */
export function composeInstructorCourseOptionLabel(level: number, name: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed.length === 0 ? `רמה ${level}` : `רמה ${level} · ${trimmed}`;
}

/**
 * Total, deterministic comparator: level ascending, then id ascending. The id
 * tie-breaker is a unique primary key, so the order is fully determined
 * independent of the input order and of sort stability. Returning first here
 * carries NO selection meaning.
 */
function compareInstructorCourseOptions(
  a: InstructorCourseOptionView,
  b: InstructorCourseOptionView,
): number {
  if (a.level !== b.level) {
    return a.level - b.level;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/**
 * Build the instructor course-options menu from already-fetched rows.
 *
 *  - keeps ONLY rows whose id is in `allowedOfferingIds` (exact string equality:
 *    no trimming, no case folding, no prefix matching);
 *  - drops a duplicate id defensively (the first occurrence wins; a duplicate
 *    primary key is impossible, so this only guards a malformed fake/fetcher);
 *  - omits an allowed id that has no corresponding row;
 *  - returns the deterministic display order above.
 *
 * Never throws: an empty result is a legitimate fail-closed outcome (nothing is
 * selectable) and is the caller's to render, not this core's to paper over.
 */
export function buildInstructorContactCourseOptions(
  rows: readonly InstructorCourseOfferingOptionRow[],
  allowedOfferingIds: readonly string[],
): InstructorCourseOptionView[] {
  const allowed = new Set(allowedOfferingIds);
  const seen = new Set<string>();
  const options: InstructorCourseOptionView[] = [];

  for (const row of rows) {
    if (!allowed.has(row.id) || seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    options.push({
      id: row.id,
      label: composeInstructorCourseOptionLabel(row.level, row.name),
      level: row.level,
      status: row.status,
    });
  }

  return options.sort(compareInstructorCourseOptions);
}

// ---------------------------------------------------------------------------
// Dependency-injected orchestration
//
// This lives in the PURE core (not in the IO wrapper) on purpose: it performs no
// IO itself, only sequences injected boundaries. Keeping it here lets the
// DB-free test exercise the EXACT query shape and the authorization ordering
// without importing Prisma or the next/headers-backed Actor DAL.
// ---------------------------------------------------------------------------

/**
 * The exact query the options reader issues: the two allowed ids by explicit
 * id-set, projecting exactly four columns. No date column, no relation, no
 * status/date/name filter - status is read, never used to include or exclude.
 * Its shape is what the DB-free test asserts.
 */
export interface InstructorCourseOptionsQuery {
  readonly where: { readonly id: { readonly in: string[] } };
  readonly select: {
    readonly id: true;
    readonly name: true;
    readonly level: true;
    readonly status: true;
  };
}

/**
 * Injected boundary for the options reader.
 *
 * `requireActiveInstructor` exists purely to enforce "an authenticated ACTIVE
 * instructor is present" - it is expected to THROW otherwise, and its result is
 * intentionally discarded: no part of the menu is keyed by instructor identity
 * (there is no instructor allow-list). Inactive instructors are denied inside
 * this dependency by the existing Actor DAL checks, not by any new logic here.
 */
export interface InstructorCourseOptionsDeps {
  requireActiveInstructor: () => Promise<unknown>;
  allowedOfferingIds: readonly string[];
  fetchOfferingRows: (
    query: InstructorCourseOptionsQuery,
  ) => Promise<readonly InstructorCourseOfferingOptionRow[]>;
}

/**
 * List the course options an authenticated ACTIVE instructor may address.
 *
 * Order is a hard contract: the actor guard is the FIRST awaited operation, so
 * an anonymous, wrong-audience or inactive caller can never probe which
 * offerings exist or learn their names. Only after it resolves is a single
 * id-set query issued.
 */
export async function listInstructorContactCourseOptionsWithDeps(
  deps: InstructorCourseOptionsDeps,
): Promise<InstructorCourseOptionView[]> {
  await deps.requireActiveInstructor();
  const rows = await deps.fetchOfferingRows({
    // A defensive COPY of the injected allow-list: the query object is handed to
    // a foreign fetcher (Prisma, or a test fake), and the policy constant is
    // frozen and must never be reachable for mutation through it.
    where: { id: { in: [...deps.allowedOfferingIds] } },
    select: { id: true, name: true, level: true, status: true },
  });
  return buildInstructorContactCourseOptions(rows, deps.allowedOfferingIds);
}
