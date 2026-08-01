/**
 * EXAM EX-ADMIN-WORKSPACE-UX (BLOCKER-1) — the ADMIN-ONLY narrowing that turns
 * the committed exam plan payload into the wave view the admin workspace
 * renders, keyed by ASSIGNMENT ID.
 *
 * ===========================================================================
 * THIS MODULE COMPUTES NO TIME. IT ONLY GROUPS TIMES SOMEBODY ELSE DERIVED.
 * ===========================================================================
 * Every clock value published here is COPIED VERBATIM from the payload the
 * committed read pipeline produced — which is `loadExamPlan` ->
 * `composeStoredExamBlocks` -> the committed block timetable core, the exact
 * same chain the instructor DTO and the trainee day are built from. There is no
 * multiplication, no addition, no wave index, no duration, no parallel capacity
 * and no `HH:MM` parsing or formatting anywhere in this file, and none may be
 * added: a second derivation would be a second source of truth, and the whole
 * point of this narrowing is that there is exactly one.
 *
 * What it DOES do is one thing the timetable's per-participant slots do not
 * express on their own: it puts the participants who share a derived personal
 * START back together into the WAVE they were dealt into. That is a grouping by
 * an already-derived value — a string comparison — and never a recomputation.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no Next, no `server-only`, no
 * `"use server"`. The module has NO IMPORTS AT ALL, so its purity is a property
 * of the file rather than a promise about a dependency, and its input shapes are
 * STRUCTURAL — it can be exercised on plain objects, and it cannot drag the
 * payload's own type graph into a caller.
 *
 * ===========================================================================
 * WHY IT EXISTS AT ALL, GIVEN THE ADMIN DTO ALREADY DOES MOST OF THIS
 * ===========================================================================
 * The committed operational DTO already publishes each participant's derived
 * personal start and end. It deliberately does NOT publish the ASSIGNMENT ID —
 * that DTO is SHARED with the instructor reading, which has no write surface and
 * therefore no business holding a write target.
 *
 * The admin workspace does have one: its cards submit an assignment id to the
 * edit, move and removal endpoints. Correlating the DTO's rows back to those ids
 * by array POSITION would work only for as long as two independently-ordered
 * lists happen to agree, and an off-by-one there would silently show one
 * trainee's time on another's card. So this narrowing keeps the id it was given
 * and publishes an id-keyed view — and the SHARED DTO is left exactly as it is.
 *
 * Nothing else is added. No `studentId`, no `pairingIndex`, no `orderIndex`, no
 * horse, topic, discipline, name or pairing travels through here: those reach
 * the workspace from the committed admin assignment reader it already uses. This
 * module answers one question — WHEN is each assignment examined, and who shares
 * that moment — and no other.
 *
 * ===========================================================================
 * AN UNRESOLVED BLOCK KEEPS ITS PEOPLE
 * ===========================================================================
 * A block whose timetable did not resolve has no exact time for anybody. That is
 * published as `resolved: false` with NO waves and every examinee listed in
 * `untimedExamineeAssignmentIds`, so the surface can still show the whole roster
 * and say plainly that the times are unavailable. It is never an empty block and
 * never a fabricated time — the same posture the committed adapter takes when it
 * keeps such a block with `null` personal times throughout.
 */

// ===========================================================================
// Input — the payload's own shapes, structurally
// ===========================================================================

/**
 * ONE assignment of one stored block, exactly as the committed adapter's
 * operational detail publishes it.
 *
 * The four fields this narrowing reads and no fifth. `personalStartTime` and
 * `personalEndTime` are the timetable core's OWN values, already zero-padded
 * `HH:MM` or `null`; they are carried through untouched.
 */
export interface AdminExamWaveAssignmentInput {
  readonly assignmentId: string | null;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  readonly personalStartTime: string | null;
  readonly personalEndTime: string | null;
}

/** ONE stored block, as the payload's session row and operational detail give it. */
export interface AdminExamWaveBlockInput {
  readonly sessionId: string;
  /** The timetable core's own derived block end, or `null`. Never recomputed. */
  readonly derivedBlockEndTime: string | null;
  /** The committed projection's own status token. `"OK"` means resolved. */
  readonly timetableStatus: string | null;
  readonly assignments: readonly AdminExamWaveAssignmentInput[];
}

// ===========================================================================
// Output
// ===========================================================================

/**
 * ONE wave: the moment, and the examinees examined at it.
 *
 * The time belongs to the WAVE. A consumer that printed it per examinee would be
 * repeating one clock value inside every card of a parallel pair, which is
 * exactly what the workspace exists to stop doing.
 */
export interface AdminExamWave {
  /** VERBATIM from the timetable's slot. Never assembled here. */
  readonly startTime: string;
  /** VERBATIM from the timetable's slot, or `null` when it produced none. */
  readonly endTime: string | null;
  /** EXAMINEE assignment ids, in the committed adapter's own order. */
  readonly examineeAssignmentIds: readonly string[];
}

/** The derived timetable of ONE block, as the admin workspace renders it. */
export interface AdminExamBlockWaveView {
  readonly sessionId: string;
  /** `true` exactly when the committed projection reported `"OK"`. */
  readonly resolved: boolean;
  /** The timetable core's own block end, or `null`. */
  readonly derivedBlockEndTime: string | null;
  readonly waves: readonly AdminExamWave[];
  /**
   * EXAMINEE assignment ids the timetable produced no personal start for, in the
   * committed order. An unresolved block puts every examinee here; a resolved
   * one normally puts none.
   */
  readonly untimedExamineeAssignmentIds: readonly string[];
}

/** Every block of one plan, looked up by stored `sessionId`. */
export interface AdminExamWaveView {
  readonly blocks: ReadonlyMap<string, AdminExamBlockWaveView>;
}

const NO_WAVES: readonly AdminExamWave[] = Object.freeze([]);
const NO_IDS: readonly string[] = Object.freeze([]);

/** The one token the committed projection uses for a resolved timetable. */
const TIMETABLE_OK = "OK";

/** The one role a wave is dealt from. An instructed trainee holds no slot. */
const ROLE_EXAMINEE = "EXAMINEE";

/** A non-empty, trimmed identifier; otherwise absent. */
function isPresentId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A usable derived clock value, or `null`.
 *
 * This is a PRESENCE test and not a format check: the value came from the
 * committed timetable core, which is the authority on its own shape, and
 * re-validating it here would be a second opinion about a format this module
 * does not own. A blank is treated as absent so a caller never renders an empty
 * run of spaces where a time should be.
 */
function timeOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * Narrow ONE block.
 *
 * The waves are built by walking the assignments in the ORDER THEY ARRIVE — the
 * committed adapter's own `(orderIndex, assignmentId)` order — and grouping the
 * EXAMINEE rows that carry the SAME derived personal start. First appearance
 * decides wave order, so the sequence a manager sees is the sequence the
 * timetable produced.
 *
 * Grouping by VALUE rather than by adjacency is deliberate: it produces the same
 * answer for a contiguous run and stays correct if a future ordering rule ever
 * interleaves two waves, without this module needing to know that it did.
 *
 * An instructed trainee is never dealt into a wave. It is examined alongside the
 * ONE examinee it is paired with, and the pairing is the committed backend's
 * business — so it holds no slot of its own here, exactly as the timetable core
 * holds none for it.
 */
function narrowBlock(block: AdminExamWaveBlockInput): AdminExamBlockWaveView {
  const resolved = block.timetableStatus === TIMETABLE_OK;
  const order: string[] = [];
  const byStart = new Map<string, { endTime: string | null; ids: string[] }>();
  const untimed: string[] = [];

  const rows = Array.isArray(block.assignments) ? block.assignments : [];
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    if (row.role !== ROLE_EXAMINEE) continue;
    if (!isPresentId(row.assignmentId)) continue;

    const startTime = timeOrNull(row.personalStartTime);
    if (startTime === null) {
      untimed.push(row.assignmentId);
      continue;
    }

    const existing = byStart.get(startTime);
    if (existing === undefined) {
      order.push(startTime);
      byStart.set(startTime, {
        endTime: timeOrNull(row.personalEndTime),
        ids: [row.assignmentId],
      });
      continue;
    }
    existing.ids.push(row.assignmentId);
  }

  return Object.freeze({
    sessionId: block.sessionId,
    resolved,
    derivedBlockEndTime: timeOrNull(block.derivedBlockEndTime),
    waves:
      order.length === 0
        ? NO_WAVES
        : Object.freeze(
            order.map((startTime) => {
              const wave = byStart.get(startTime) as { endTime: string | null; ids: string[] };
              return Object.freeze({
                startTime,
                endTime: wave.endTime,
                examineeAssignmentIds: Object.freeze([...wave.ids]),
              });
            }),
          ),
    untimedExamineeAssignmentIds:
      untimed.length === 0 ? NO_IDS : Object.freeze([...untimed]),
  });
}

/**
 * Narrow EVERY block of one plan into the admin wave view.
 *
 * Total: a missing, malformed or duplicated block is skipped rather than
 * throwing, and a session the payload did not report simply has no entry — the
 * surface then renders its own fixed "times unavailable" text instead of a
 * fabricated one.
 *
 * Never mutates the input. Never reads a clock.
 */
export function buildAdminExamWaveView(
  blocks: readonly AdminExamWaveBlockInput[],
): AdminExamWaveView {
  const out = new Map<string, AdminExamBlockWaveView>();
  const list = Array.isArray(blocks) ? blocks : [];
  for (const block of list) {
    if (block === null || typeof block !== "object") continue;
    if (!isPresentId(block.sessionId)) continue;
    if (out.has(block.sessionId)) continue;
    out.set(block.sessionId, narrowBlock(block));
  }
  return Object.freeze({ blocks: out });
}

/** The frozen empty view — an offering with no plan, or a denied read. */
export function emptyAdminExamWaveView(): AdminExamWaveView {
  return Object.freeze({ blocks: new Map<string, AdminExamBlockWaveView>() });
}

// ===========================================================================
// The orchestration
// ===========================================================================

/** The payload facts this narrowing needs, structurally. */
export interface AdminExamWavePayloadInput {
  readonly sessions: readonly {
    readonly sessionId?: unknown;
    readonly source?: unknown;
    readonly derivedBlockEndTime?: unknown;
    readonly timetableStatus?: unknown;
  }[];
  readonly storedAssignmentDetails: ReadonlyMap<
    string,
    { readonly assignments: readonly AdminExamWaveAssignmentInput[] }
  >;
}

/** Everything the orchestration needs from the outside world. */
export interface ReadAdminExamWaveViewDeps {
  readonly requireAdminCourseOffering: (
    courseOfferingId: string,
  ) => Promise<{ readonly id: string }>;
  readonly loadPlan: (verifiedCourseOfferingId: string) => Promise<AdminExamWavePayloadInput>;
}

/**
 * Read the admin wave view of ONE course offering.
 *
 * ORDER:
 *   1. admin + the EXACT offering, through the existing admin course-context
 *      helper — which runs `requireAdmin()` FIRST, so an unauthenticated caller
 *      is redirected before any offering is looked up;
 *   2. a context that identifies no offering yields the frozen empty view and
 *      NO load, because it cannot scope a single query;
 *   3. the COMMITTED plan load, under the caller's own admin options;
 *   4. this narrowing, and nothing else.
 *
 * Nothing is caught: a typed not-found, a lifecycle denial, an authorization
 * redirect and an infrastructure fault all keep their identity, exactly as every
 * other admin exam read does.
 *
 * Only STORED blocks contribute. A live beginner row has no stored assignment
 * and no operational detail, so it is skipped by construction rather than by a
 * filter somebody could later delete.
 */
export async function readAdminExamWaveViewWithDeps(
  courseOfferingId: string,
  deps: ReadAdminExamWaveViewDeps,
): Promise<AdminExamWaveView> {
  const offering = await deps.requireAdminCourseOffering(courseOfferingId);
  const verifiedId = isPresentId(offering?.id) ? offering.id : null;
  if (verifiedId === null) {
    return emptyAdminExamWaveView();
  }

  const payload = await deps.loadPlan(verifiedId);
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const details = payload?.storedAssignmentDetails;

  const blocks: AdminExamWaveBlockInput[] = [];
  for (const session of sessions) {
    if (session === null || typeof session !== "object") continue;
    if (!isPresentId(session.sessionId)) continue;
    const detail = details?.get(session.sessionId);
    if (detail === undefined) continue;
    blocks.push({
      sessionId: session.sessionId,
      derivedBlockEndTime: timeOrNull(session.derivedBlockEndTime),
      timetableStatus:
        typeof session.timetableStatus === "string" ? session.timetableStatus : null,
      assignments: Array.isArray(detail.assignments) ? detail.assignments : [],
    });
  }

  return buildAdminExamWaveView(blocks);
}
