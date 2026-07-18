/**
 * MULTI-COURSE W5B0 - PURE cardinality core for the TEMPORARY singleton
 * current-offering resolver.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env. It
 * accepts already-fetched CourseOffering rows and either returns a stable view
 * model or throws a typed error, so the whole cardinality contract is
 * unit-testable without a database (see current-offering.test.ts).
 *
 * This is a TEMPORARY resolver. It selects the current offering purely by the
 * invariant "there is exactly one CourseOffering". It deliberately does NOT
 * select by a hardcoded Hebrew name/year, by status, or via CourseSettings, and
 * it never returns the first of several. The moment a second offering exists it
 * throws AmbiguousCourseOfferingError - which is exactly the point at which a
 * real offering selector must replace this resolver.
 */
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";

/** The stable view model returned to callers (never a raw Prisma object). */
export interface CurrentCourseOffering {
  id: string;
  activityYearId: string;
  name: string;
  level: number;
  startDate: Date;
  endDate: Date;
  status: CourseOfferingStatus;
}

/**
 * The subset of CourseOffering columns the resolver core inspects. startDate/
 * endDate are nullable in the schema (@db.Date optional); the core treats a
 * missing date as a data error (IncompleteCourseOfferingError) rather than
 * inventing one, since the view model requires concrete course dates.
 */
export interface CourseOfferingRow {
  id: string;
  activityYearId: string;
  name: string;
  level: number;
  startDate: Date | null;
  endDate: Date | null;
  status: CourseOfferingStatus;
}

/** Zero offerings exist - there is no current course to resolve. */
export class NoCurrentCourseOfferingError extends Error {
  constructor() {
    super("No CourseOffering exists; cannot resolve the current course offering.");
    this.name = "NoCurrentCourseOfferingError";
  }
}

/**
 * Two or more offerings exist - the single-offering invariant no longer holds,
 * so this temporary resolver refuses to choose. Carries the safe offering ids
 * (public cuids, never PII) for diagnostics.
 */
export class AmbiguousCourseOfferingError extends Error {
  readonly offeringIds: string[];
  constructor(offeringIds: string[]) {
    super(
      `Ambiguous current CourseOffering: ${offeringIds.length} offerings exist ` +
        `(ids: ${offeringIds.join(", ")}). The single-offering resolver refuses to ` +
        `choose one - a real offering selector is required before multiple offerings go live.`,
    );
    this.name = "AmbiguousCourseOfferingError";
    this.offeringIds = offeringIds;
  }
}

/**
 * Exactly one offering exists but it is missing a start/end date. The current-
 * offering view requires concrete dates and never invents them, so this fails
 * clearly rather than coercing a null into a fabricated Date.
 */
export class IncompleteCourseOfferingError extends Error {
  readonly offeringId: string;
  constructor(offeringId: string) {
    super(
      `CourseOffering ${offeringId} is missing a startDate/endDate; the current-` +
        `offering view requires concrete course dates and never invents them.`,
    );
    this.name = "IncompleteCourseOfferingError";
    this.offeringId = offeringId;
  }
}

/**
 * The pure cardinality decision. The caller fetches AT MOST TWO rows (take: 2),
 * so "two or more" is detectable without counting the whole table; passing more
 * than two rows here is still treated as ambiguous. Never returns the first of
 * several; never defaults to an arbitrary row.
 */
export function resolveCurrentCourseOfferingFromRows(
  rows: readonly CourseOfferingRow[],
): CurrentCourseOffering {
  if (rows.length === 0) {
    throw new NoCurrentCourseOfferingError();
  }
  if (rows.length > 1) {
    throw new AmbiguousCourseOfferingError(rows.map((r) => r.id));
  }
  const row = rows[0];
  if (row.startDate === null || row.endDate === null) {
    throw new IncompleteCourseOfferingError(row.id);
  }
  return {
    id: row.id,
    activityYearId: row.activityYearId,
    name: row.name,
    level: row.level,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
  };
}
