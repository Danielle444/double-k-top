// RIDING-COMPLEX-SCHEDULE-BOARD (Stage 3A - Move/Swap core) - pure, DB-free.
//
// The dormant, deterministic, NON-MUTATING heart of "move or swap a resource
// inside one already-loaded complex riding plan". It receives:
//   1. one already-loaded complex-plan tree (blocks -> stations -> pairs); and
//   2. one closed Move/Swap intent command;
// and returns EITHER a proposed complete final plan state OR a stable, non-PII
// failure decision (a reason code - never a Hebrew/user-facing string, never a
// raw id or name).
//
// This module performs NO Prisma/DB/action/auth/React/env/cookie/clock/random/
// revalidation work. Its ONLY dependency is TypeScript's structural types. It is
// DORMANT: no runtime code imports it in this stage; Stage 3B will wire it into
// a server action that loads the plan, calls this core, and - on { ok: true } -
// performs the targeted writes and increments the persisted plan version exactly
// once (see `requiresVersionIncrement`).
//
// SCOPE (committed product decisions):
//  - Operations act only WITHIN one RidingSlotComplexPlan. Source and
//    destination may be in the same station, different stations of one block, or
//    stations of different blocks of the SAME plan. Cross-plan / cross-ridingSlot
//    movement is not representable here (there is a single input plan): any
//    reference to something outside this plan simply fails as STALE_REFERENCE.
//    Cross-plan support, if ever approved, will add its own explicit contract.
//  - Uniqueness is BLOCK-scoped: trainee, horse, and instructor uniqueness are
//    each enforced within one block only. Overlapping-but-distinct blocks are NOT
//    cross-validated in this stage.
//
// FIELD SEMANTICS:
//  - Trainee move/swap changes only trainee positions; horse and note stay on the
//    pair card. Whole-pair move/swap carries trainee1 + trainee2 + horseName +
//    note together. Horse move/swap changes only horseName. Instructor move/swap
//    changes only station.instructorId; arena stays on its station. No
//    publication/snapshot data is part of this core, and it neither publishes nor
//    unpublishes anything.
//
// HORSE IDENTITY: horseName is a nullable plain string, never a stable Horse id.
// The source horse is located ONLY by the stable source/destination PAIR id -
// never by name. horseName travels as the exact value stored on that pair,
// re-normalized on write (trim; whitespace-only -> null; case preserved). Final
// horse uniqueness within a block is case-insensitive and trim-normalized, the
// SAME contract saveComplexStationInternal enforces (pair.horseName.trim()
// .toLowerCase()).
//
// CONCURRENCY: the input plan carries `version`; every command carries
// `expectedVersion`. A mismatch fails with STALE_PLAN. The pure result never
// increments or persists version; on success it carries `requiresVersionIncrement
// : true` so Stage 3B bumps the persisted version exactly once. `nextPlan.version`
// is left equal to the input version (the pre-increment value that was read); no
// committed version is fabricated in the pure tree.
//
// STAGE 3B WRITE-SCOPE CONTRACT (how a persisting caller must consume a success):
//  - `nextPlan` is the proposed final IN-MEMORY state, nothing more.
//  - `nextPlan.version` intentionally remains the pre-write persisted version.
//    Stage 3B must re-compare `expectedVersion` against the freshly read row and
//    then increment the persisted plan version EXACTLY ONCE in the same
//    transaction. It must NOT persist `nextPlan.version` verbatim as the new
//    version - doing so would silently drop the bump.
//  - `affected` is a WRITE-SCOPE HINT, not a complete row-update list:
//      * field-only trainee/horse operations may update the affected PAIR ids;
//      * instructor operations update the affected STATION ids;
//      * MOVE_PAIR / SWAP_PAIRS may change a moved pair's stationId AND sortOrder
//        AND the sortOrder of its SIBLING pairs in both the source and
//        destination stations.
//  - Therefore for pair move/swap, `affected.stationIds` is AUTHORITATIVE: Stage
//    3B must reproduce every pair placement and order from `nextPlan` for those
//    stations. It must NEVER assume `affected.pairIds` alone enumerates every row
//    whose sortOrder changed - reindexed siblings are NOT listed there.
//  - Stable pair ids are PRESERVED; a pair move does not require delete/recreate
//    merely because today's ordinary full-replace station writer does so. The
//    eventual Stage-3B transaction is free to choose safe TARGETED updates for
//    every pair in the affected stations.
//
// PURITY / DETERMINISM: the input plan, the command, and all their nested arrays
// and objects are only READ. The result is built by FULL DEEP COPY - `nextPlan`
// shares no object reference with the input, so even untouched blocks are fresh,
// deep-equal copies (documented reference policy). Same input + command always
// yields a deep-equal output. No Date, clock, localeCompare, environment, random,
// database, auth, cookie, or global state. Unknown op/shape and malformed arrays/
// rows/prototype-polluting keys FAIL CLOSED with a reason code; ordinary
// malformed input never throws.

// ---------------------------------------------------------------------------
// Public input tree (narrowest readonly plain-data shapes).
//
// Deliberately excludes every forbidden field: no names, feedback, publication,
// audit timestamps, actor data, CourseOffering, students, candidate lists, or UI
// fields. Blocks are ordered by array position; the operation preserves that
// order and never reorders blocks or stations. Only pair membership/order within
// AFFECTED stations is regenerated (see `requiresVersionIncrement` note above).
// ---------------------------------------------------------------------------

/** One trainee pair within a station (stable id + the movable content fields). */
export interface ComplexPlanPairInput {
  readonly id: string;
  readonly trainee1Id: string | null;
  readonly trainee2Id: string | null;
  readonly horseName: string | null;
  readonly note: string | null;
  readonly sortOrder: number;
}

/** One coach/arena station within a block (stable id + instructor + arena). */
export interface ComplexPlanStationInput {
  readonly id: string;
  readonly instructorId: string | null;
  readonly arena: string | null;
  readonly sortOrder: number;
  readonly pairs: readonly ComplexPlanPairInput[];
}

/** One time block within a plan (stable id + ordered stations). */
export interface ComplexPlanBlockInput {
  readonly id: string;
  readonly stations: readonly ComplexPlanStationInput[];
}

/** The whole loaded complex plan: stable id, concurrency `version`, blocks. */
export interface ComplexPlanInput {
  readonly id: string;
  readonly version: number;
  readonly blocks: readonly ComplexPlanBlockInput[];
}

// ---------------------------------------------------------------------------
// Closed command union (the intent to apply). Property names refined only for
// consistency; no arbitrary client-built snapshots or replacement ids are
// accepted - every reference is a stable existing block/station/pair id.
// ---------------------------------------------------------------------------

/** A single trainee position: which pair, which of the two seats. */
export interface TraineeSlotRef {
  readonly pairId: string;
  readonly slot: "trainee1" | "trainee2";
}

export type ComplexPlanMoveSwapCommand =
  | {
      readonly op: "MOVE_TRAINEE";
      readonly expectedVersion: number;
      readonly source: TraineeSlotRef;
      readonly destination: TraineeSlotRef;
    }
  | {
      readonly op: "SWAP_TRAINEES";
      readonly expectedVersion: number;
      readonly a: TraineeSlotRef;
      readonly b: TraineeSlotRef;
    }
  | {
      readonly op: "MOVE_PAIR";
      readonly expectedVersion: number;
      readonly sourcePairId: string;
      readonly destinationStationId: string;
    }
  | {
      readonly op: "SWAP_PAIRS";
      readonly expectedVersion: number;
      readonly aPairId: string;
      readonly bPairId: string;
    }
  | {
      readonly op: "MOVE_HORSE";
      readonly expectedVersion: number;
      readonly sourcePairId: string;
      readonly destinationPairId: string;
    }
  | {
      readonly op: "SWAP_HORSES";
      readonly expectedVersion: number;
      readonly aPairId: string;
      readonly bPairId: string;
    }
  | {
      readonly op: "MOVE_INSTRUCTOR";
      readonly expectedVersion: number;
      readonly sourceStationId: string;
      readonly destinationStationId: string;
    }
  | {
      readonly op: "SWAP_INSTRUCTORS";
      readonly expectedVersion: number;
      readonly aStationId: string;
      readonly bStationId: string;
    };

/** The tag of the operation, echoed back on every result when safely known. */
export type ComplexPlanMoveSwapOperation = ComplexPlanMoveSwapCommand["op"];

// ---------------------------------------------------------------------------
// Output contract (discriminated union). Failures carry ONLY a stable reason
// code (no ids, names, or PII); success carries the proposed full final state
// plus the affected ids Stage 3B needs for targeted writes.
// ---------------------------------------------------------------------------

/**
 * Stable, non-PII failure reason codes. Opaque identifiers safe to log; the
 * caller maps them to a user-facing message.
 *
 *  - INVALID_COMMAND ............ command shape/op/field is missing or malformed.
 *  - MALFORMED_PLAN ............. the input tree is structurally invalid: a bad
 *      type, a non-integer sortOrder/version, a duplicate block/station/pair id,
 *      or a malformed row (the "INVALID_SORT_ORDER / malformed-tree" bucket).
 *  - STALE_PLAN ................. expectedVersion !== plan.version.
 *  - STALE_REFERENCE ........... a referenced pair/station id is not in the plan
 *      (this is also how any out-of-plan reference surfaces).
 *  - DESTINATION_OCCUPIED ...... the destination slot/pair/station already holds
 *      the resource being moved into it (a move never overwrites).
 *  - NOTHING_TO_MOVE ........... the source slot/pair/station has no resource to
 *      move (empty trainee slot, blank horse, or no instructor).
 *  - NO_CHANGE ................. a swap whose two sides are equal (or both empty).
 *  - SAME_POSITION ............. a trainee move/swap onto the exact same pair+slot.
 *  - SAME_STATION ............. a pair/instructor move onto the pair's/station's
 *      own station.
 *  - SAME_PAIR ................. a pair/horse operation whose two ends are one pair
 *      (including a useless within-pair trainee move).
 *  - INVALID_PAIR_POSITION ..... a final pair would hold trainee2 without
 *      trainee1 (e.g. filling seat 2 of a pair whose seat 1 is empty).
 *  - DUPLICATE_TRAINEE_IN_BLOCK  a trainee would appear twice in one block.
 *  - DUPLICATE_HORSE_IN_BLOCK ... a normalized horse name would appear twice.
 *  - DUPLICATE_INSTRUCTOR_IN_BLOCK an instructor would staff two stations.
 *  - SAME_TRAINEE_TWICE_IN_PAIR  a single pair would hold the same trainee twice.
 */
export type ComplexPlanMoveSwapReason =
  | "INVALID_COMMAND"
  | "MALFORMED_PLAN"
  | "STALE_PLAN"
  | "STALE_REFERENCE"
  | "DESTINATION_OCCUPIED"
  | "NOTHING_TO_MOVE"
  | "NO_CHANGE"
  | "SAME_POSITION"
  | "SAME_STATION"
  | "SAME_PAIR"
  | "INVALID_PAIR_POSITION"
  | "DUPLICATE_TRAINEE_IN_BLOCK"
  | "DUPLICATE_HORSE_IN_BLOCK"
  | "DUPLICATE_INSTRUCTOR_IN_BLOCK"
  | "SAME_TRAINEE_TWICE_IN_PAIR";

/** The block/station/pair ids the operation changed, for Stage 3B's targeted
 *  writes. De-duplicated, in deterministic first-seen order. */
export interface ComplexPlanMoveSwapAffected {
  readonly blockIds: readonly string[];
  readonly stationIds: readonly string[];
  readonly pairIds: readonly string[];
}

export interface ComplexPlanMoveSwapSuccess {
  readonly ok: true;
  readonly operation: ComplexPlanMoveSwapOperation;
  /** The proposed complete final plan state (fresh deep copy, deep-frozen). */
  readonly nextPlan: ComplexPlanInput;
  readonly affected: ComplexPlanMoveSwapAffected;
  /** Always true: Stage 3B increments the persisted version exactly once. */
  readonly requiresVersionIncrement: true;
}

export interface ComplexPlanMoveSwapFailure {
  readonly ok: false;
  /** The op when safely known; null only when the op itself was unrecognizable. */
  readonly operation: ComplexPlanMoveSwapOperation | null;
  readonly reason: ComplexPlanMoveSwapReason;
}

export type ComplexPlanMoveSwapResult =
  | ComplexPlanMoveSwapSuccess
  | ComplexPlanMoveSwapFailure;

// ---------------------------------------------------------------------------
// Internal mutable working tree (built by full deep copy from validated input).
// Only this local copy is ever mutated; the input is never touched.
// ---------------------------------------------------------------------------

interface WorkPair {
  id: string;
  trainee1Id: string | null;
  trainee2Id: string | null;
  horseName: string | null;
  note: string | null;
  sortOrder: number;
}

interface WorkStation {
  id: string;
  instructorId: string | null;
  arena: string | null;
  sortOrder: number;
  pairs: WorkPair[];
}

interface WorkBlock {
  id: string;
  stations: WorkStation[];
}

interface WorkPlan {
  id: string;
  version: number;
  blocks: WorkBlock[];
}

interface PairLocation {
  block: WorkBlock;
  station: WorkStation;
  pair: WorkPair;
}

interface StationLocation {
  block: WorkBlock;
  station: WorkStation;
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

const KNOWN_OPS: ReadonlySet<string> = new Set([
  "MOVE_TRAINEE",
  "SWAP_TRAINEES",
  "MOVE_PAIR",
  "SWAP_PAIRS",
  "MOVE_HORSE",
  "SWAP_HORSES",
  "MOVE_INSTRUCTOR",
  "SWAP_INSTRUCTORS",
]);

/** A plain (non-array) object, narrowed to a string-keyed record. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** A required, non-empty string id (rejects "", non-strings). */
function readId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A nullable content string: null/undefined -> null, string -> itself, else
 *  reject (a number/object where a string was expected is malformed). */
function readNullableString(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "string") return { ok: true, value };
  return { ok: false };
}

/** True for a present (non-empty) resource id (trainee or instructor). */
function isPresentId(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The stored form of a horse name: trimmed, whitespace-only -> null, case
 *  preserved. The single normalization applied to every horse WRITE. */
function horseStore(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The case-insensitive uniqueness key for a horse name (trim + lower). Matches
 *  saveComplexStationInternal's pair.horseName.trim().toLowerCase(). */
function horseKey(value: string | null): string | null {
  const stored = horseStore(value);
  return stored === null ? null : stored.toLowerCase();
}

/** De-duplicate ids preserving first-seen order (deterministic). */
function uniqueInOrder(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Command validation. Returns a clean, typed command or an INVALID_COMMAND
// failure. `operation` is the op string when the op key is recognizable (so the
// failure can echo it), else null.
// ---------------------------------------------------------------------------

type CommandValidation =
  | { ok: true; command: ComplexPlanMoveSwapCommand }
  | { ok: false; operation: ComplexPlanMoveSwapOperation | null; reason: "INVALID_COMMAND" };

function invalidCommand(
  operation: ComplexPlanMoveSwapOperation | null
): CommandValidation {
  return { ok: false, operation, reason: "INVALID_COMMAND" };
}

function readTraineeSlotRef(value: unknown): TraineeSlotRef | null {
  const record = asRecord(value);
  if (!record) return null;
  const pairId = readId(record.pairId);
  const slot = record.slot;
  if (pairId === null) return null;
  if (slot !== "trainee1" && slot !== "trainee2") return null;
  return { pairId, slot };
}

function validateCommand(command: unknown): CommandValidation {
  const record = asRecord(command);
  if (!record) return invalidCommand(null);

  const op = record.op;
  if (typeof op !== "string" || !KNOWN_OPS.has(op)) return invalidCommand(null);
  const operation = op as ComplexPlanMoveSwapOperation;

  const expectedVersion = record.expectedVersion;
  if (!Number.isInteger(expectedVersion)) return invalidCommand(operation);
  const version = expectedVersion as number;

  switch (operation) {
    case "MOVE_TRAINEE": {
      const source = readTraineeSlotRef(record.source);
      const destination = readTraineeSlotRef(record.destination);
      if (!source || !destination) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, source, destination } };
    }
    case "SWAP_TRAINEES": {
      const a = readTraineeSlotRef(record.a);
      const b = readTraineeSlotRef(record.b);
      if (!a || !b) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, a, b } };
    }
    case "MOVE_PAIR": {
      const sourcePairId = readId(record.sourcePairId);
      const destinationStationId = readId(record.destinationStationId);
      if (!sourcePairId || !destinationStationId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, sourcePairId, destinationStationId } };
    }
    case "SWAP_PAIRS": {
      const aPairId = readId(record.aPairId);
      const bPairId = readId(record.bPairId);
      if (!aPairId || !bPairId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, aPairId, bPairId } };
    }
    case "MOVE_HORSE": {
      const sourcePairId = readId(record.sourcePairId);
      const destinationPairId = readId(record.destinationPairId);
      if (!sourcePairId || !destinationPairId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, sourcePairId, destinationPairId } };
    }
    case "SWAP_HORSES": {
      const aPairId = readId(record.aPairId);
      const bPairId = readId(record.bPairId);
      if (!aPairId || !bPairId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, aPairId, bPairId } };
    }
    case "MOVE_INSTRUCTOR": {
      const sourceStationId = readId(record.sourceStationId);
      const destinationStationId = readId(record.destinationStationId);
      if (!sourceStationId || !destinationStationId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, sourceStationId, destinationStationId } };
    }
    case "SWAP_INSTRUCTORS": {
      const aStationId = readId(record.aStationId);
      const bStationId = readId(record.bStationId);
      if (!aStationId || !bStationId) return invalidCommand(operation);
      return { ok: true, command: { op: operation, expectedVersion: version, aStationId, bStationId } };
    }
    default:
      return invalidCommand(null);
  }
}

// ---------------------------------------------------------------------------
// Plan validation + full deep copy into the mutable working tree. Fails closed
// (MALFORMED_PLAN) on any bad type, non-integer sortOrder/version, duplicate
// block/station/pair id, or malformed row. Only allow-listed keys are copied, so
// prototype-polluting or extra keys never propagate into the output.
// ---------------------------------------------------------------------------

type PlanValidation =
  | { ok: true; plan: WorkPlan }
  | { ok: false; reason: "MALFORMED_PLAN" };

const MALFORMED: PlanValidation = { ok: false, reason: "MALFORMED_PLAN" };

function validateAndBuildPlan(plan: unknown): PlanValidation {
  const planRecord = asRecord(plan);
  if (!planRecord) return MALFORMED;

  const planId = readId(planRecord.id);
  if (planId === null) return MALFORMED;
  if (!Number.isInteger(planRecord.version)) return MALFORMED;
  if (!Array.isArray(planRecord.blocks)) return MALFORMED;

  // Ids must be unique within their kind across the WHOLE tree - a duplicate is
  // an ambiguous reference target and fails closed.
  const blockIds = new Set<string>();
  const stationIds = new Set<string>();
  const pairIds = new Set<string>();

  const blocks: WorkBlock[] = [];
  for (const rawBlock of planRecord.blocks) {
    const blockRecord = asRecord(rawBlock);
    if (!blockRecord) return MALFORMED;
    const blockId = readId(blockRecord.id);
    if (blockId === null || blockIds.has(blockId)) return MALFORMED;
    blockIds.add(blockId);
    if (!Array.isArray(blockRecord.stations)) return MALFORMED;

    const stations: WorkStation[] = [];
    for (const rawStation of blockRecord.stations) {
      const stationRecord = asRecord(rawStation);
      if (!stationRecord) return MALFORMED;
      const stationId = readId(stationRecord.id);
      if (stationId === null || stationIds.has(stationId)) return MALFORMED;
      stationIds.add(stationId);
      const instructor = readNullableString(stationRecord.instructorId);
      if (!instructor.ok) return MALFORMED;
      const arena = readNullableString(stationRecord.arena);
      if (!arena.ok) return MALFORMED;
      if (!Number.isInteger(stationRecord.sortOrder)) return MALFORMED;
      if (!Array.isArray(stationRecord.pairs)) return MALFORMED;

      const pairs: WorkPair[] = [];
      for (const rawPair of stationRecord.pairs) {
        const pairRecord = asRecord(rawPair);
        if (!pairRecord) return MALFORMED;
        const pairId = readId(pairRecord.id);
        if (pairId === null || pairIds.has(pairId)) return MALFORMED;
        pairIds.add(pairId);
        const t1 = readNullableString(pairRecord.trainee1Id);
        if (!t1.ok) return MALFORMED;
        const t2 = readNullableString(pairRecord.trainee2Id);
        if (!t2.ok) return MALFORMED;
        const horse = readNullableString(pairRecord.horseName);
        if (!horse.ok) return MALFORMED;
        const note = readNullableString(pairRecord.note);
        if (!note.ok) return MALFORMED;
        if (!Number.isInteger(pairRecord.sortOrder)) return MALFORMED;

        pairs.push({
          id: pairId,
          trainee1Id: t1.value,
          trainee2Id: t2.value,
          horseName: horse.value,
          note: note.value,
          sortOrder: pairRecord.sortOrder as number,
        });
      }

      stations.push({
        id: stationId,
        instructorId: instructor.value,
        arena: arena.value,
        sortOrder: stationRecord.sortOrder as number,
        pairs,
      });
    }

    blocks.push({ id: blockId, stations });
  }

  return { ok: true, plan: { id: planId, version: planRecord.version as number, blocks } };
}

// ---------------------------------------------------------------------------
// Location indexes over the (unique-id, validated) working tree.
// ---------------------------------------------------------------------------

function indexPairs(plan: WorkPlan): Map<string, PairLocation> {
  const map = new Map<string, PairLocation>();
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        map.set(pair.id, { block, station, pair });
      }
    }
  }
  return map;
}

function indexStations(plan: WorkPlan): Map<string, StationLocation> {
  const map = new Map<string, StationLocation>();
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      map.set(station.id, { block, station });
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Mutation primitives on the working tree.
// ---------------------------------------------------------------------------

function getSlot(pair: WorkPair, slot: "trainee1" | "trainee2"): string | null {
  return slot === "trainee1" ? pair.trainee1Id : pair.trainee2Id;
}

function setSlot(pair: WorkPair, slot: "trainee1" | "trainee2", value: string | null): void {
  if (slot === "trainee1") pair.trainee1Id = value;
  else pair.trainee2Id = value;
}

/** After a move CLEARS trainee1 while trainee2 remains, promote trainee2 into
 *  trainee1 and clear trainee2 (product decision 5). No-op otherwise. */
function promote(pair: WorkPair): void {
  if (!isPresentId(pair.trainee1Id) && isPresentId(pair.trainee2Id)) {
    pair.trainee1Id = pair.trainee2Id;
    pair.trainee2Id = null;
  }
}

/** Regenerate contiguous pair sortOrder (0..n-1) for a station, in array order.
 *  Applied ONLY to stations whose pair membership/order the operation changed. */
function reindexStation(station: WorkStation): void {
  station.pairs.forEach((pair, index) => {
    pair.sortOrder = index;
  });
}

// ---------------------------------------------------------------------------
// Final-state validation (per AFFECTED block only). Untouched blocks are never
// re-validated, so pre-existing legacy data in an unrelated block never blocks a
// valid operation; an affected block that would end up violating an invariant
// (including a pre-existing violation among its untouched rows) fails closed.
//
// Priority (deterministic): pair-level invariants in tree order
// (SAME_TRAINEE_TWICE_IN_PAIR, then INVALID_PAIR_POSITION), then block-level
// duplicates (trainee, then horse, then instructor).
// ---------------------------------------------------------------------------

function validateBlock(block: WorkBlock): ComplexPlanMoveSwapReason | null {
  const traineeCounts = new Map<string, number>();
  const horseCounts = new Map<string, number>();
  const instructorCounts = new Map<string, number>();

  for (const station of block.stations) {
    if (isPresentId(station.instructorId)) {
      instructorCounts.set(station.instructorId, (instructorCounts.get(station.instructorId) ?? 0) + 1);
    }
    for (const pair of station.pairs) {
      const t1 = isPresentId(pair.trainee1Id) ? pair.trainee1Id : null;
      const t2 = isPresentId(pair.trainee2Id) ? pair.trainee2Id : null;
      if (t1 !== null && t2 !== null && t1 === t2) return "SAME_TRAINEE_TWICE_IN_PAIR";
      if (t1 === null && t2 !== null) return "INVALID_PAIR_POSITION";
      if (t1 !== null) traineeCounts.set(t1, (traineeCounts.get(t1) ?? 0) + 1);
      if (t2 !== null) traineeCounts.set(t2, (traineeCounts.get(t2) ?? 0) + 1);
      const hk = horseKey(pair.horseName);
      if (hk !== null) horseCounts.set(hk, (horseCounts.get(hk) ?? 0) + 1);
    }
  }

  for (const count of traineeCounts.values()) {
    if (count > 1) return "DUPLICATE_TRAINEE_IN_BLOCK";
  }
  for (const count of horseCounts.values()) {
    if (count > 1) return "DUPLICATE_HORSE_IN_BLOCK";
  }
  for (const count of instructorCounts.values()) {
    if (count > 1) return "DUPLICATE_INSTRUCTOR_IN_BLOCK";
  }
  return null;
}

function validateAffectedBlocks(
  plan: WorkPlan,
  blockIds: readonly string[]
): ComplexPlanMoveSwapReason | null {
  const targets = new Set(blockIds);
  // Iterate in plan order for deterministic reason selection across blocks.
  for (const block of plan.blocks) {
    if (!targets.has(block.id)) continue;
    const reason = validateBlock(block);
    if (reason !== null) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Deep freeze the final tree so the returned nextPlan cannot be mutated by a
// caller (defence-in-depth; the tree is already a fresh deep copy).
// ---------------------------------------------------------------------------

function freezePlan(plan: WorkPlan): ComplexPlanInput {
  for (const block of plan.blocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        Object.freeze(pair);
      }
      Object.freeze(station.pairs);
      Object.freeze(station);
    }
    Object.freeze(block.stations);
    Object.freeze(block);
  }
  Object.freeze(plan.blocks);
  return Object.freeze(plan) as ComplexPlanInput;
}

// ---------------------------------------------------------------------------
// Result assembly.
// ---------------------------------------------------------------------------

// Every failure is built here so the whole failure object is frozen at the one
// result-construction boundary (operation may be null only when the op itself
// was unrecognizable).
function fail(
  operation: ComplexPlanMoveSwapOperation | null,
  reason: ComplexPlanMoveSwapReason
): ComplexPlanMoveSwapFailure {
  return Object.freeze({ ok: false, operation, reason });
}

/** Run final-state validation on the affected blocks, then either fail closed or
 *  return the FULLY FROZEN success result: `nextPlan` is deeply frozen, the
 *  `affected` arrays and object are frozen, and the success wrapper itself is
 *  frozen, so a caller can never mutate any part of the returned decision.
 *  `nextPlan.version` is left unchanged (Stage 3B owns the persisted bump). */
function finalize(
  operation: ComplexPlanMoveSwapOperation,
  plan: WorkPlan,
  blockIds: readonly string[],
  stationIds: readonly string[],
  pairIds: readonly string[]
): ComplexPlanMoveSwapResult {
  const reason = validateAffectedBlocks(plan, blockIds);
  if (reason !== null) return fail(operation, reason);
  const affected: ComplexPlanMoveSwapAffected = Object.freeze({
    blockIds: Object.freeze(uniqueInOrder(blockIds)),
    stationIds: Object.freeze(uniqueInOrder(stationIds)),
    pairIds: Object.freeze(uniqueInOrder(pairIds)),
  });
  return Object.freeze({
    ok: true,
    operation,
    nextPlan: freezePlan(plan),
    affected,
    requiresVersionIncrement: true,
  });
}

// ---------------------------------------------------------------------------
// Per-operation handlers. Each resolves references (STALE_REFERENCE), enforces
// its guards, mutates the working tree, then delegates to finalize().
// ---------------------------------------------------------------------------

function applyMoveTrainee(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_TRAINEE" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  const src = pairs.get(command.source.pairId);
  const dst = pairs.get(command.destination.pairId);
  if (!src || !dst) return fail(op, "STALE_REFERENCE");

  if (command.source.pairId === command.destination.pairId) {
    // Same exact seat is a no-op; two seats of one pair is useless (moving then
    // auto-promoting collapses back) - both fail closed.
    return command.source.slot === command.destination.slot
      ? fail(op, "SAME_POSITION")
      : fail(op, "SAME_PAIR");
  }

  const traineeValue = getSlot(src.pair, command.source.slot);
  if (!isPresentId(traineeValue)) return fail(op, "NOTHING_TO_MOVE");
  if (isPresentId(getSlot(dst.pair, command.destination.slot))) return fail(op, "DESTINATION_OCCUPIED");
  // Filling seat 2 of a pair whose seat 1 is empty would leave trainee2 without
  // trainee1 - reject up front with a precise reason.
  if (command.destination.slot === "trainee2" && !isPresentId(dst.pair.trainee1Id)) {
    return fail(op, "INVALID_PAIR_POSITION");
  }

  setSlot(src.pair, command.source.slot, null);
  setSlot(dst.pair, command.destination.slot, traineeValue);
  promote(src.pair);

  return finalize(
    op,
    plan,
    [src.block.id, dst.block.id],
    [src.station.id, dst.station.id],
    [src.pair.id, dst.pair.id]
  );
}

function applySwapTrainees(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_TRAINEES" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  const a = pairs.get(command.a.pairId);
  const b = pairs.get(command.b.pairId);
  if (!a || !b) return fail(op, "STALE_REFERENCE");

  if (command.a.pairId === command.b.pairId && command.a.slot === command.b.slot) {
    return fail(op, "SAME_POSITION");
  }

  const aValue = getSlot(a.pair, command.a.slot);
  const bValue = getSlot(b.pair, command.b.slot);
  if (!isPresentId(aValue) || !isPresentId(bValue)) return fail(op, "NOTHING_TO_MOVE");
  if (aValue === bValue) return fail(op, "NO_CHANGE");

  setSlot(a.pair, command.a.slot, bValue);
  setSlot(b.pair, command.b.slot, aValue);

  return finalize(
    op,
    plan,
    [a.block.id, b.block.id],
    [a.station.id, b.station.id],
    [a.pair.id, b.pair.id]
  );
}

function applyMovePair(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  stations: Map<string, StationLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_PAIR" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  const src = pairs.get(command.sourcePairId);
  const dst = stations.get(command.destinationStationId);
  if (!src || !dst) return fail(op, "STALE_REFERENCE");
  if (src.station.id === command.destinationStationId) return fail(op, "SAME_STATION");

  const index = src.station.pairs.findIndex((p) => p.id === src.pair.id);
  src.station.pairs.splice(index, 1);
  dst.station.pairs.push(src.pair);
  reindexStation(src.station);
  reindexStation(dst.station);

  return finalize(
    op,
    plan,
    [src.block.id, dst.block.id],
    [src.station.id, dst.station.id],
    [src.pair.id]
  );
}

function applySwapPairs(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_PAIRS" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  if (command.aPairId === command.bPairId) return fail(op, "SAME_PAIR");
  const a = pairs.get(command.aPairId);
  const b = pairs.get(command.bPairId);
  if (!a || !b) return fail(op, "STALE_REFERENCE");

  const aIndex = a.station.pairs.findIndex((p) => p.id === a.pair.id);
  const bIndex = b.station.pairs.findIndex((p) => p.id === b.pair.id);
  // Exchange placement: each pair object occupies the other's previous slot.
  // Works whether the two pairs share a station (index swap) or not.
  a.station.pairs[aIndex] = b.pair;
  b.station.pairs[bIndex] = a.pair;
  reindexStation(a.station);
  if (b.station !== a.station) reindexStation(b.station);

  return finalize(
    op,
    plan,
    [a.block.id, b.block.id],
    [a.station.id, b.station.id],
    [a.pair.id, b.pair.id]
  );
}

function applyMoveHorse(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_HORSE" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  if (command.sourcePairId === command.destinationPairId) return fail(op, "SAME_PAIR");
  const src = pairs.get(command.sourcePairId);
  const dst = pairs.get(command.destinationPairId);
  if (!src || !dst) return fail(op, "STALE_REFERENCE");

  const sourceHorse = horseStore(src.pair.horseName);
  if (sourceHorse === null) return fail(op, "NOTHING_TO_MOVE");
  if (horseStore(dst.pair.horseName) !== null) return fail(op, "DESTINATION_OCCUPIED");

  dst.pair.horseName = sourceHorse;
  src.pair.horseName = null;

  return finalize(
    op,
    plan,
    [src.block.id, dst.block.id],
    [src.station.id, dst.station.id],
    [src.pair.id, dst.pair.id]
  );
}

function applySwapHorses(
  plan: WorkPlan,
  pairs: Map<string, PairLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_HORSES" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  if (command.aPairId === command.bPairId) return fail(op, "SAME_PAIR");
  const a = pairs.get(command.aPairId);
  const b = pairs.get(command.bPairId);
  if (!a || !b) return fail(op, "STALE_REFERENCE");

  const aHorse = horseStore(a.pair.horseName);
  const bHorse = horseStore(b.pair.horseName);
  // Both empty, or the same normalized name -> nothing changes. A one-sided swap
  // (exactly one present) IS a valid exchange - it is NOT normalized to
  // MOVE_HORSE; the present name moves and the other side becomes null.
  if (aHorse === null && bHorse === null) return fail(op, "NO_CHANGE");
  if (aHorse !== null && bHorse !== null && aHorse.toLowerCase() === bHorse.toLowerCase()) {
    return fail(op, "NO_CHANGE");
  }

  a.pair.horseName = bHorse;
  b.pair.horseName = aHorse;

  return finalize(
    op,
    plan,
    [a.block.id, b.block.id],
    [a.station.id, b.station.id],
    [a.pair.id, b.pair.id]
  );
}

function applyMoveInstructor(
  plan: WorkPlan,
  stations: Map<string, StationLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "MOVE_INSTRUCTOR" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  if (command.sourceStationId === command.destinationStationId) return fail(op, "SAME_STATION");
  const src = stations.get(command.sourceStationId);
  const dst = stations.get(command.destinationStationId);
  if (!src || !dst) return fail(op, "STALE_REFERENCE");

  const instructor = src.station.instructorId;
  if (!isPresentId(instructor)) return fail(op, "NOTHING_TO_MOVE");
  if (isPresentId(dst.station.instructorId)) return fail(op, "DESTINATION_OCCUPIED");

  dst.station.instructorId = instructor;
  src.station.instructorId = null;

  return finalize(op, plan, [src.block.id, dst.block.id], [src.station.id, dst.station.id], []);
}

function applySwapInstructors(
  plan: WorkPlan,
  stations: Map<string, StationLocation>,
  command: Extract<ComplexPlanMoveSwapCommand, { op: "SWAP_INSTRUCTORS" }>
): ComplexPlanMoveSwapResult {
  const op = command.op;
  if (command.aStationId === command.bStationId) return fail(op, "SAME_STATION");
  const a = stations.get(command.aStationId);
  const b = stations.get(command.bStationId);
  if (!a || !b) return fail(op, "STALE_REFERENCE");

  const aInstructor = isPresentId(a.station.instructorId) ? a.station.instructorId : null;
  const bInstructor = isPresentId(b.station.instructorId) ? b.station.instructorId : null;
  // Both empty, or the same instructor -> nothing changes. A one-sided swap
  // (exactly one present) IS a valid exchange - NOT normalized to
  // MOVE_INSTRUCTOR; the present instructor moves and the other side becomes null.
  if (aInstructor === null && bInstructor === null) return fail(op, "NO_CHANGE");
  if (aInstructor !== null && bInstructor !== null && aInstructor === bInstructor) {
    return fail(op, "NO_CHANGE");
  }

  a.station.instructorId = bInstructor;
  b.station.instructorId = aInstructor;

  return finalize(op, plan, [a.block.id, b.block.id], [a.station.id, b.station.id], []);
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Apply one Move/Swap command to one already-loaded complex plan tree, returning
 * either a proposed complete final plan state (`ok: true`) or a stable, non-PII
 * failure decision (`ok: false`). Pure, deterministic, and non-mutating: the
 * input plan and command are only read; `nextPlan` is a fresh, deep-frozen deep
 * copy. Never throws for ordinary malformed input - it fails closed with a
 * reason code instead.
 */
export function applyComplexPlanMoveSwap(
  plan: ComplexPlanInput,
  command: ComplexPlanMoveSwapCommand
): ComplexPlanMoveSwapResult {
  try {
    const commandCheck = validateCommand(command);
    if (!commandCheck.ok) {
      return fail(commandCheck.operation, commandCheck.reason);
    }
    const validCommand = commandCheck.command;

    const planCheck = validateAndBuildPlan(plan);
    if (!planCheck.ok) {
      return fail(validCommand.op, planCheck.reason);
    }
    const workPlan = planCheck.plan;

    if (workPlan.version !== validCommand.expectedVersion) {
      return fail(validCommand.op, "STALE_PLAN");
    }

    const pairIndex = indexPairs(workPlan);
    const stationIndex = indexStations(workPlan);

    switch (validCommand.op) {
      case "MOVE_TRAINEE":
        return applyMoveTrainee(workPlan, pairIndex, validCommand);
      case "SWAP_TRAINEES":
        return applySwapTrainees(workPlan, pairIndex, validCommand);
      case "MOVE_PAIR":
        return applyMovePair(workPlan, pairIndex, stationIndex, validCommand);
      case "SWAP_PAIRS":
        return applySwapPairs(workPlan, pairIndex, validCommand);
      case "MOVE_HORSE":
        return applyMoveHorse(workPlan, pairIndex, validCommand);
      case "SWAP_HORSES":
        return applySwapHorses(workPlan, pairIndex, validCommand);
      case "MOVE_INSTRUCTOR":
        return applyMoveInstructor(workPlan, stationIndex, validCommand);
      case "SWAP_INSTRUCTORS":
        return applySwapInstructors(workPlan, stationIndex, validCommand);
      default:
        // Exhaustive above; a genuinely unknown op was already rejected as
        // INVALID_COMMAND. This is an unreachable belt-and-suspenders guard.
        return fail(null, "INVALID_COMMAND");
    }
  } catch {
    // Fail closed on any unexpected internal error (e.g. a hostile getter that
    // throws) - the core never throws for ordinary malformed input.
    return fail(null, "MALFORMED_PLAN");
  }
}
