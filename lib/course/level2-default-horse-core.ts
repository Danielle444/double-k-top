/**
 * LEVEL 2 DEFAULT HORSE - PURE core for the course-scoped default-horse admin
 * roster and the editability (dual-enrollment) decision.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie. It takes already-fetched, offering-scoped enrollment
 * display rows (from the committed E3 reader), each student's ACTIVE-enrollment
 * offering-id set, and each student's raw horse triple, and produces the
 * deterministic display list the admin page renders. The whole contract is
 * unit-testable without a database (see level2-default-horse-core.test.ts).
 *
 * EDITABILITY / DUAL-ENROLLMENT RULE (the one authority, reused by BOTH the read
 * shaping here and the write action's server-side guard): a trainee's default
 * horse is editable in THIS offering IFF the trainee's set of ACTIVE-enrollment
 * offering ids is EXACTLY { thisOfferingId } — i.e. they are actively enrolled
 * here and in NO other offering. Any other ACTIVE enrollment (a dual trainee)
 * makes the default READ-ONLY here: their Student horse is their inherited
 * Level 1 / persistent default and must never be mutated from a Level 2 context.
 * The rule is entirely id-driven — it hardcodes NO CourseOffering id and infers
 * nothing from level/name/date/status ordering.
 *
 * The resolved default horse shown for EVERY row (editable or not) is the
 * trainee's current Student horse via getHorseDisplayInfo — the exact same
 * resolution both riding flows already use as their per-session default (with a
 * per-session RidingLessonNote.sessionHorseName always overriding it downstream).
 */
import {
  getHorseDisplayInfo,
  type HorseBadgeType,
  type HorseInfoInput,
} from "@/lib/horse-info";

/** The raw, canonical horse triple carried per trainee (the three cache fields). */
export type Level2HorseTriple = HorseInfoInput;

/**
 * One offering-scoped enrollment display row, exactly the privacy-narrow shape
 * the committed E3 reader (AdminEnrollmentDisplayRow) already produces. Only the
 * fields this core consumes are declared, so it stays decoupled from Prisma.
 */
export interface Level2RosterEnrollmentRow {
  readonly studentId: string;
  readonly fullName: string;
  /** e.g. "ג / 1"; a top-level target -> the group name; null when unresolved. */
  readonly subgroupLabel: string | null;
  readonly membershipState: "OK" | "NO_CURRENT" | "MULTIPLE" | "UNRESOLVED";
}

/** All inputs the pure builder needs, each already fetched by the IO layer. */
export interface BuildLevel2DefaultHorseRowsInput {
  /** ACTIVE enrollment rows for EXACTLY this offering (already ACTIVE-filtered). */
  readonly enrollments: readonly Level2RosterEnrollmentRow[];
  /** The exact offering id this admin page is scoped to (route-validated). */
  readonly thisOfferingId: string;
  /** studentId -> that student's raw current Student horse triple. */
  readonly horseByStudentId: ReadonlyMap<string, Level2HorseTriple>;
  /**
   * studentId -> the set of DISTINCT offering ids the student is ACTIVELY
   * enrolled in (across ALL offerings, this one included). Drives editability.
   */
  readonly activeOfferingIdsByStudentId: ReadonlyMap<string, ReadonlySet<string>>;
}

/** The display row the admin default-horse table renders. */
export interface Level2DefaultHorseRow {
  readonly studentId: string;
  readonly fullName: string;
  readonly subgroupLabel: string | null;
  readonly membershipState: "OK" | "NO_CURRENT" | "MULTIPLE" | "UNRESOLVED";
  /** True only for a trainee enrolled ACTIVELY in this offering and NO other. */
  readonly editable: boolean;
  /** The resolved current default-horse badge type (private/assigned/none). */
  readonly horseBadgeType: HorseBadgeType;
  /** The resolved current default-horse badge label (Hebrew). */
  readonly horseBadgeLabel: string;
  /** Always-non-empty display string for the resolved default horse. */
  readonly horseNameDisplay: string;
  /** Raw triple, so the client can prefill the edit modal for editable rows. */
  readonly hasPrivateHorse: boolean;
  readonly privateHorseName: string | null;
  readonly assignedHorseName: string | null;
}

/**
 * The single editability authority. Returns true IFF the student's ACTIVE-
 * enrollment offering-id set is EXACTLY { thisOfferingId }: actively enrolled
 * here and nowhere else. A missing set, an empty set, a set lacking this
 * offering, or a set with any additional offering all return false (fail closed).
 */
export function isDefaultHorseEditable(
  activeOfferingIds: ReadonlySet<string> | undefined,
  thisOfferingId: string,
): boolean {
  if (thisOfferingId.length === 0) return false;
  if (!activeOfferingIds) return false;
  if (activeOfferingIds.size !== 1) return false;
  return activeOfferingIds.has(thisOfferingId);
}

/** Deterministic comparator: fullName asc (Hebrew-aware), then studentId asc. */
function compareRow(a: Level2DefaultHorseRow, b: Level2DefaultHorseRow): number {
  const byName = a.fullName.localeCompare(b.fullName, "he");
  if (byName !== 0) return byName;
  if (a.studentId < b.studentId) return -1;
  if (a.studentId > b.studentId) return 1;
  return 0;
}

const EMPTY_HORSE: Level2HorseTriple = {
  hasPrivateHorse: false,
  privateHorseName: null,
  assignedHorseName: null,
};

/**
 * Build the deterministic default-horse display list for ONE offering's ACTIVE
 * enrollments. Each enrollment appears exactly once. The resolved default horse
 * is computed from the Student triple via getHorseDisplayInfo (the same rule the
 * riding flows use); editability is the dual-enrollment rule above. Never mutates
 * its input; the output order is fully deterministic.
 */
export function buildLevel2DefaultHorseRows(
  input: BuildLevel2DefaultHorseRowsInput,
): Level2DefaultHorseRow[] {
  const rows = input.enrollments.map((enrollment): Level2DefaultHorseRow => {
    const triple = input.horseByStudentId.get(enrollment.studentId) ?? EMPTY_HORSE;
    const info = getHorseDisplayInfo(triple);
    const editable = isDefaultHorseEditable(
      input.activeOfferingIdsByStudentId.get(enrollment.studentId),
      input.thisOfferingId,
    );
    return {
      studentId: enrollment.studentId,
      fullName: enrollment.fullName,
      subgroupLabel: enrollment.subgroupLabel,
      membershipState: enrollment.membershipState,
      editable,
      horseBadgeType: info.badgeType,
      horseBadgeLabel: info.badgeLabel,
      horseNameDisplay: info.horseNameDisplay,
      hasPrivateHorse: triple.hasPrivateHorse,
      privateHorseName: triple.privateHorseName,
      assignedHorseName: triple.assignedHorseName,
    };
  });
  rows.sort(compareRow);
  return rows;
}
