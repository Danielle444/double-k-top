/**
 * HF-SEC-1RW - PURE, dependency-injected orchestration that binds the instructor
 * horse-feeding READ and WRITE paths to the server-derived actor identity.
 *
 * Like ./attendance-read-auth and ./attendance-write-auth, this is deliberately
 * NOT a "use server" module: it is a plain server-side library, so nothing here
 * is registered as a Server Action. It carries the testable orchestration (the
 * session-actor gate + the canEditHorseFeeding check + delegation to the
 * already-built reader/mutator) that the public server actions in ./horse-feeding
 * import and wire to real dependencies (the canonical actor DAL
 * getCurrentInstructor + the existing Prisma reads/upsert). Same
 * split-of-concerns convention as the attendance auth modules.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies / next-
 * cache import: every impure capability (the session actor resolver, the
 * overview reader, the meal mutator) is passed in via the *Deps interfaces. The
 * only edges back to ./horse-feeding and ./students are erased `import type`s, so
 * the type-only edge creates no runtime circular import and pulls in neither
 * next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - getHorseFeedingOverviewForInstructor previously had NO authentication at
 *    all: any caller (including unauthenticated) received the full roster joined
 *    to today's attendance-derived absence information.
 *  - upsertHorseFeedingMealsAsInstructor previously trusted a CLIENT-SUPPLIED
 *    instructorId: it re-read the instructor row by that id and evaluated
 *    canEditHorseFeeding on it, so a caller could submit ANOTHER instructor's id
 *    to borrow that instructor's edit permission, and the persisted authorship
 *    (updatedByName) was that borrowed instructor's name.
 * Both now derive identity ONLY from the injected server-side actor resolver
 * (getCurrentInstructor), never from a client-supplied id. There is no
 * instructorId parameter on either path. A missing/invalid/inactive/wrong-
 * audience/subject-mismatched session yields a null actor (the resolver returns
 * null in every such case): the read fails closed to [] and the write is
 * rejected WITHOUT invoking the mutator. Authorship is taken from the server-
 * derived actor's fullName, never from client input.
 *
 * FAIL-CLOSED ON RESOLVER REJECTION: per the HF-SEC-1RW contract, a THROWN actor
 * resolution (session/infra failure - e.g. a missing/weak SESSION_SECRET or a
 * Prisma error inside getCurrentInstructor) is caught around the actor resolution
 * ONLY and treated exactly like a null actor: the read returns [] and the write
 * returns the permission error, never touching the reader/mutator. The catch is
 * scoped strictly to the actor resolution so a genuine reader/mutator error still
 * propagates unchanged (preserving current overview-load and upsert behaviour),
 * and no internal session/reason-code detail is surfaced.
 *
 * This stage protects WHO the instructor is and, for the write, whether that
 * instructor holds the existing canEditHorseFeeding permission. It intentionally
 * introduces NO capability/offering gating (per HF-SEC-1RW scope): the internal
 * attendance-derived feeding read stays an operational business rule and is not
 * governed by the ATTENDANCE capability.
 */
import type { HorseFeedingOverviewRow, HorseFeedingUpsertInput } from "./horse-feeding";
import type { ActionResult } from "./students";

// Shared rejection contract - identical wording to the pre-existing instructor
// write action so the UI-visible error is unchanged.
const NO_PERMISSION_ERROR = "אין הרשאה לערוך האכלות";

// --- instructor horse-feeding overview read ---------------------------------

/**
 * Injectable dependencies for {@link loadInstructorHorseFeedingOverviewWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / inactive / wrong-audience / subject-mismatched
 * session); `buildOverview` is the existing reader that produces the overview DTO
 * (including the attendance-derived operational fields).
 */
export interface InstructorHorseFeedingReadDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  buildOverview: () => Promise<HorseFeedingOverviewRow[]>;
}

/**
 * Gate the instructor horse-feeding overview read on a trustworthy server-derived
 * instructor actor, THEN delegate to the unchanged overview reader.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor. A
 * null actor (unauthenticated / invalid / inactive / wrong-audience / subject-
 * mismatched) - or a THROWN actor resolution (caught around the resolver only) -
 * fails closed to [] and the reader is NEVER invoked, revealing nothing (the same
 * fail-closed read convention as getAttendanceTrackingForInstructor /
 * getStudentContacts). The instructor read boundary is intentionally
 * identity-only: viewing horse-feeding does NOT require canEditHorseFeeding (that
 * flag gates editing only), matching the committed "any instructor may view"
 * product policy. For a valid active instructor the returned DTO - including the
 * attendance-derived feeding information - is exactly as before; a genuine
 * buildOverview() error still propagates unchanged (it is outside the catch).
 */
export async function loadInstructorHorseFeedingOverviewWithDeps(
  deps: InstructorHorseFeedingReadDeps,
): Promise<HorseFeedingOverviewRow[]> {
  let instructor: { id: string } | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return [];
  }
  if (!instructor) {
    return [];
  }
  return deps.buildOverview();
}

// --- instructor horse-feeding meal upsert -----------------------------------

/** Actor fields the upsert path consumes: the edit permission + authorship name. */
export interface InstructorHorseFeedingWriteActor {
  canEditHorseFeeding: boolean;
  fullName: string;
}

/**
 * Injectable dependencies for {@link upsertInstructorHorseFeedingMealsWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver;
 * `upsertMeals` is the existing validate-then-persist mutator, which receives the
 * server-derived authorship name and returns the unchanged action result.
 */
export interface InstructorHorseFeedingUpsertDeps {
  getCurrentInstructor: () => Promise<InstructorHorseFeedingWriteActor | null>;
  upsertMeals: (
    input: HorseFeedingUpsertInput,
    updatedByName: string,
  ) => Promise<ActionResult>;
}

/**
 * Gate an instructor horse-feeding meal upsert on a trustworthy server-derived
 * actor that holds canEditHorseFeeding, THEN delegate to the unchanged mutator.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor or
 * borrow another instructor's permission. A null actor (unauthenticated /
 * invalid / inactive / wrong-audience / subject-mismatched) OR an actor whose
 * canEditHorseFeeding is false is rejected with the unchanged permission error
 * and the mutator is NEVER invoked - so no DB write and no payload-validation
 * side effects occur on rejection (the denial happens strictly before the
 * mutation dependency). A THROWN actor resolution (session/infra failure) is
 * caught around the resolver ONLY and fails closed to the same permission error
 * without invoking the mutator; a genuine upsertMeals() error still propagates
 * unchanged (it is outside the catch). For an authorized actor the mutator runs
 * exactly as before - it performs the existing HorseFeedingUpsertInput validation
 * and the upsert/delete transaction - and authorship (updatedByName) is the
 * actor's own fullName, never a client value.
 */
export async function upsertInstructorHorseFeedingMealsWithDeps(
  deps: InstructorHorseFeedingUpsertDeps,
  input: HorseFeedingUpsertInput,
): Promise<ActionResult> {
  let instructor: InstructorHorseFeedingWriteActor | null;
  try {
    instructor = await deps.getCurrentInstructor();
  } catch {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  if (!instructor || !instructor.canEditHorseFeeding) {
    return { success: false, error: NO_PERMISSION_ERROR };
  }
  return deps.upsertMeals(input, instructor.fullName);
}
