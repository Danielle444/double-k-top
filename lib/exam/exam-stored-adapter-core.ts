/**
 * EXAM EX-S5A-1 — PURE stored-block adapter core.
 *
 * PURE by construction: no Prisma, no generated Prisma type, no DB, no Next, no
 * React, no clock (`Date.now` / `new Date`), no randomness, no env, no
 * auth/session/cookie, no filesystem, no network, no `"use server"`.
 * Deterministic; never mutates its inputs; never throws for malformed runtime
 * input; every returned value is frozen.
 *
 * WHAT THIS ANSWERS (and only this): given the PLAIN SCALAR rows of one exam
 * plan's stored `ExamDefinition` / `ExamSession` / `ExamAssignment` /
 * `ExamSessionBreak` records, what are the runtime contracts the later readers
 * need?
 *
 *   - `ProjectionSession`        — the compact row the three view cores consume;
 *   - `StoredExamBlockDetail`    — the SIBLING personal-slot lookup the trainee
 *                                  view core consumes, keyed by `sessionId`;
 *   - `ConflictSession`          — the structural input the conflict core
 *                                  consumes;
 *   - the timetable / definition / adapter DIAGNOSTICS behind all three.
 *
 * ONE PASS, ONE TIMETABLE. All four are produced from a SINGLE
 * `computeExamBlockTimetable` call per block, precisely so the projection row,
 * the personal slots and the conflict input cannot drift apart. Computing them
 * in separate passes would allow a block to claim `OK` in one payload and
 * `UNRESOLVED` in another; do not split them.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 *  - NO database access, and no query shape. Loading the rows is EX-S5A-3.
 *  - NO role, publication, capability or course-scoping logic. That is EX-S5A-4;
 *    this core knows nothing about who is asking.
 *  - NO live Teaching-Practice beginner rows. Those are EX-S5A-2, and they are
 *    a LIVE PROJECTION that never passes through the timetable calculator at
 *    all (see exam-live-beginner-adapter-core.ts).
 *  - NO timetable arithmetic. Every derived time comes from
 *    `computeExamBlockTimetable` / `resolveInstructedTraineeSlots`, which are
 *    already committed and tested. Re-deriving a wave here would create the
 *    second source of truth the whole module exists to prevent.
 *  - NO change to `ProjectionSession`. It is NOT widened with slots, personal
 *    times, assignment ids, supervisors, a title, notes, `isSelf` or the
 *    definition's `orderIndex`. Anything a view needs beyond the compact row
 *    travels in a SIBLING payload — that is the committed EX-S4B/EX-S4D shape.
 *
 * ===========================================================================
 * DEPRECATED FIELDS ARE NOT IN THE INPUT CONTRACT AT ALL
 * ===========================================================================
 * `ExamSession.kind`, `phase`, `interfaceSessionId`, `beginnerFormat`,
 * `capacity`, `sourceTeachingPracticeLessonId`, `copiedAt`,
 * `roleLabelOverrides` and `ExamAssignment.sourcePracticeRole` are RETAINED IN
 * THE DATABASE but unwritten, and they are deliberately ABSENT from
 * {@link StoredExamSessionRow} / {@link StoredExamAssignmentRow}. A column that
 * cannot be expressed in the input contract cannot be misread by this adapter,
 * which is a stronger guarantee than a rule someone must remember. `kind`,
 * `durationMinutes` and `parallelCapacity` come from the `ExamDefinition` and
 * from nowhere else.
 *
 * ===========================================================================
 * FAIL CLOSED
 * ===========================================================================
 * A session that cannot be identified, or whose definition is missing,
 * duplicated or not storable, produces NO `ProjectionSession` — and is reported
 * as a top-level {@link StoredExamAdapterIssue}. A session is never silently
 * dropped, and a missing definition is never substituted by a kind label, a
 * title or a guessed default. Nothing is ever resolved by name or by array
 * position.
 */
import type {
  ProjectionSession,
  ProjectionTimetableStatus,
} from "./exam-schedule-projection-core";
import type {
  StoredExamAssignmentSlot,
  StoredExamBlockDetail,
} from "./exam-trainee-view-core";
import type {
  ConflictAssignment,
  ConflictAssignmentSlot,
  ConflictSession,
} from "./exam-conflict-core";
import type {
  ExamBlockTimetable,
  ExamTimetableIssue,
  ExamTimetableSlot,
  ExamTimetableWarning,
  TimetableBreak,
  TimetableExaminee,
  TimetableInstructedTrainee,
  TimetablePairedExaminee,
} from "./exam-block-timetable-core";
import {
  computeExamBlockTimetable,
  resolveInstructedTraineeSlots,
} from "./exam-block-timetable-core";
import type {
  ExamAssignmentConformanceInput,
  ExamDefinitionInput,
  ExamDefinitionIssue,
} from "./exam-definition-validation-core";
import {
  validateAssignmentsAgainstDefinition,
  validateExamDefinition,
} from "./exam-definition-validation-core";
import type { ExamAssignmentRole, ExamKind } from "./exam-domain-core";
import {
  isExamAssignmentRole,
  isStorableExamKind,
  resolveParticipant,
} from "./exam-domain-core";

// ===========================================================================
// Adapter issue codes + Hebrew messages
// ===========================================================================

/**
 * Stable, non-PII adapter issue codes. The code STRINGS are the contract and
 * must not be renamed once consumed downstream.
 *
 * These describe defects THIS ADAPTER observes while binding stored rows to the
 * committed cores. They deliberately do NOT duplicate the codes the cores own:
 * timetable failures stay `EX-CALC-*`, definition-conformance failures stay
 * `EX-DEF-*`, and grouping failures stay `EX-GRP-*`.
 */
export type StoredExamAdapterIssueCode =
  /** A session row carries no legible id, so nothing can be keyed to it. */
  | "EX-ADP-SESSION-ID-REQUIRED"
  /** No definition in the supplied set matches the session's `definitionId`. */
  | "EX-ADP-DEFINITION-MISSING"
  /** The same definition id arrived more than once; identity is undecidable. */
  | "EX-ADP-DEFINITION-DUPLICATE"
  /** The definition's kind is not one a stored exam session may carry. */
  | "EX-ADP-DEFINITION-KIND-NOT-STORABLE"
  /** An assignment carries a role token that is not a legal role. */
  | "EX-ADP-ROLE-INVALID"
  /** An assignment carries no legible id, so no slot can be matched to it. */
  | "EX-ADP-ASSIGNMENT-ID-REQUIRED";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<StoredExamAdapterIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 */
export const STORED_EXAM_ADAPTER_MESSAGES: Readonly<
  Record<StoredExamAdapterIssueCode, string>
> = Object.freeze({
  "EX-ADP-SESSION-ID-REQUIRED":
    "למפגש בחינה שמור חסר מזהה — לא ניתן להציג אותו",
  "EX-ADP-DEFINITION-MISSING":
    "לא נמצאה הגדרת בחינה למפגש — לא ניתן להציג אותו תחת שם משוער",
  "EX-ADP-DEFINITION-DUPLICATE":
    "אותו מזהה הגדרת בחינה הופיע יותר מפעם אחת — לא ניתן לקבוע את הגדרת הבחינה",
  "EX-ADP-DEFINITION-KIND-NOT-STORABLE":
    "סוג הבחינה של ההגדרה אינו סוג שניתן לשמור כמפגש בחינה",
  "EX-ADP-ROLE-INVALID":
    "תפקיד המשובץ במפגש הבחינה אינו תקין — השיבוץ אינו נכלל",
  "EX-ADP-ASSIGNMENT-ID-REQUIRED":
    "לשיבוץ במפגש הבחינה חסר מזהה — לא ניתן לשייך לו שעה אישית",
});

/**
 * One adapter issue.
 *
 * Carries ONLY stable identifiers, and never a student id, a student name, a
 * horse name, a title, a note, a discipline or a topic. An issue list is a
 * diagnostic channel, never a PII channel — the same rule the trainee-view and
 * grouping cores already hold themselves to.
 *
 * `sessionId` is `null` only for a PLAN-LEVEL issue (a duplicated definition id
 * in the supplied definition set, which is wrong independently of any session).
 */
export interface StoredExamAdapterIssue {
  readonly code: StoredExamAdapterIssueCode;
  readonly message: string;
  readonly sessionId: string | null;
  readonly definitionId: string | null;
  readonly assignmentId: string | null;
}

// ===========================================================================
// Input — PRISMA-NEUTRAL scalar rows
// ===========================================================================

/**
 * One `ExamDefinition` row.
 *
 * `kind` is typed as a plain `string` RUNTIME TOKEN rather than `ExamKind`: the
 * value arrives from a database enum column, and this adapter is the boundary
 * that proves it is storable before anything downstream may assume it. Typing it
 * as `ExamKind` here would move that proof to a cast at the call site.
 *
 * `orderIndex` is accepted so the row contract matches what a later reader
 * loads, and is deliberately NOT projected — `projectByExamDefinition` orders
 * groups by (kind, label, definitionId), and `ProjectionSession` must not gain a
 * `definitionOrderIndex`.
 */
export interface StoredExamDefinitionRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly durationMinutes: number;
  readonly parallelCapacity: number;
  readonly requiresInstructedTrainee: boolean;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly orderIndex: number;
}

/**
 * One `ExamAssignment` row.
 *
 * `studentId` is nullable from day one: an assignment may legitimately be a
 * RESERVED, not-yet-bound place in the block. `role` is a plain `string` runtime
 * token for the same reason `StoredExamDefinitionRow.kind` is.
 *
 * `sourcePracticeRole` is deliberately ABSENT — it is deprecated and unwritten.
 */
export interface StoredExamAssignmentRow {
  readonly id: string;
  readonly studentId: string | null;
  readonly role: string;
  readonly orderIndex: number;
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly pairingIndex: number | null;
  readonly notes: string | null;
}

/** One `ExamSessionBreak` row. Positional only — it carries no calculated time. */
export interface StoredExamBreakRow {
  readonly id: string;
  readonly afterWaveIndex: number;
  readonly durationMinutes: number;
  readonly label: string | null;
}

/**
 * One `ExamSession` row plus its bounded children.
 *
 * `date` is an ALREADY-NORMALIZED `YYYY-MM-DD` token. This adapter accepts no
 * `Date`, constructs no `Date`, and performs no timezone or calendar
 * arithmetic — the loader converts once (via `dateKey`) and this core compares
 * opaque strings, exactly as every other exam core does.
 *
 * `individualPublishedAt` / `updatedAt` are comparable epoch MILLISECONDS (the
 * loader converts `Date` → number), matching the committed
 * `exam-publication-core` contract. They are accepted so the row contract is
 * complete for the later slices and are NOT read here: publication is EX-S5A-4.
 *
 * `title` and `notes` are likewise accepted and NOT projected — `title` is an
 * occurrence subtitle and `ProjectionSession` has no field for either.
 *
 * Every deprecated column (`kind`, `phase`, `interfaceSessionId`,
 * `beginnerFormat`, `capacity`, `sourceTeachingPracticeLessonId`, `copiedAt`,
 * `roleLabelOverrides`) is ABSENT by design; see the file header.
 */
export interface StoredExamSessionRow {
  readonly id: string;
  readonly definitionId: string;
  /** Opaque calendar day, `YYYY-MM-DD`. Never a `Date`. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly orderIndex: number;
  readonly arena: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  /** Epoch ms, or null when never individually published. Accepted, not read. */
  readonly individualPublishedAt: number | null;
  /** Epoch ms. Accepted, not read. */
  readonly updatedAt: number;
  readonly assignments: readonly StoredExamAssignmentRow[];
  readonly breaks: readonly StoredExamBreakRow[];
  readonly supervisorInstructorIds: readonly string[];
}

// ===========================================================================
// Output
// ===========================================================================

/**
 * Everything one stored block yields, produced in one pass.
 *
 * `detail` is `null` EXACTLY when the timetable did not resolve: an unresolved
 * block has no exact personal time for anybody, and the trainee view core hides
 * such a row outright rather than falling back to the block interval.
 */
export interface StoredExamBlockComposition {
  readonly session: ProjectionSession;
  /** `null` iff `session.timetableStatus === "UNRESOLVED"`. */
  readonly detail: StoredExamBlockDetail | null;
  readonly conflictSession: ConflictSession;
  readonly timetableIssues: readonly ExamTimetableIssue[];
  readonly timetableWarnings: readonly ExamTimetableWarning[];
  /** `EX-DEF-*` diagnostics. Purely informational — they gate nothing. */
  readonly definitionIssues: readonly ExamDefinitionIssue[];
  /** Adapter diagnostics scoped to THIS block (never to an excluded session). */
  readonly adapterIssues: readonly StoredExamAdapterIssue[];
}

/**
 * The total result.
 *
 * `issues` holds ONLY the issues of sessions (or of the definition set) that
 * produced NO block; a projected block's own diagnostics live on the block, so
 * nothing is reported twice.
 */
export interface StoredExamAdapterResult {
  readonly blocks: readonly StoredExamBlockComposition[];
  readonly issues: readonly StoredExamAdapterIssue[];
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * The one role compared against. `INSTRUCTED_TRAINEE` is deliberately NOT
 * declared as a second constant: the role union has exactly two members and
 * `isExamAssignmentRole` has already proven membership, so "not EXAMINEE" is
 * exhaustive. A second constant would suggest a third case exists.
 */
const ROLE_EXAMINEE: ExamAssignmentRole = "EXAMINEE";

const STATUS_OK: ProjectionTimetableStatus = "OK";
const STATUS_UNRESOLVED: ProjectionTimetableStatus = "UNRESOLVED";

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpNum(a: number, b: number): number {
  return a - b;
}

/** A non-empty, trimmed string; otherwise absent. */
function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent/blank. Whitespace is never identity. */
function normalizedId(v: unknown): string | null {
  return isPresent(v) ? v.trim() : null;
}

/**
 * A total order over a possibly-malformed `orderIndex`.
 *
 * A non-finite index sorts LAST rather than producing `NaN` from a subtraction
 * (which a comparator reads as "equal" and which makes the sort depend on the
 * engine's insertion order). The assignment id is the final deterministic
 * tiebreak, so the order is stable whatever the data.
 *
 * This orders the ADAPTER's OWN OUTPUT arrays only. It is never applied to the
 * examinee list handed to the timetable core — see {@link composeStoredBlock}.
 */
function compareByOrderIndexThenId(
  a: StoredExamAssignmentRow,
  b: StoredExamAssignmentRow,
): number {
  const aOrder = Number.isFinite(a.orderIndex) ? a.orderIndex : Number.POSITIVE_INFINITY;
  const bOrder = Number.isFinite(b.orderIndex) ? b.orderIndex : Number.POSITIVE_INFINITY;
  if (aOrder !== bOrder) return aOrder < bOrder ? -1 : 1;
  return cmp(typeof a.id === "string" ? a.id : "", typeof b.id === "string" ? b.id : "");
}

/** The locked block order: `date`, `startTime`, `orderIndex`, `sessionId`. */
function compareBlocks(
  a: StoredExamBlockComposition,
  b: StoredExamBlockComposition,
): number {
  return (
    cmp(a.session.date, b.session.date) ||
    cmp(a.session.startTime, b.session.startTime) ||
    cmpNum(a.session.orderIndex, b.session.orderIndex) ||
    cmp(a.session.sessionId, b.session.sessionId)
  );
}

/** Issue order: `sessionId`, then code, then definition id, then assignment id. */
function compareIssues(a: StoredExamAdapterIssue, b: StoredExamAdapterIssue): number {
  return (
    cmp(a.sessionId ?? "", b.sessionId ?? "") ||
    cmp(a.code, b.code) ||
    cmp(a.definitionId ?? "", b.definitionId ?? "") ||
    cmp(a.assignmentId ?? "", b.assignmentId ?? "")
  );
}

function makeIssue(
  code: StoredExamAdapterIssueCode,
  parts: {
    readonly sessionId?: string | null;
    readonly definitionId?: string | null;
    readonly assignmentId?: string | null;
  } = {},
): StoredExamAdapterIssue {
  return Object.freeze({
    code,
    message: STORED_EXAM_ADAPTER_MESSAGES[code],
    sessionId: parts.sessionId ?? null,
    definitionId: parts.definitionId ?? null,
    assignmentId: parts.assignmentId ?? null,
  });
}

/** One assignment whose role token has been PROVEN to be a legal role. */
interface ResolvedAssignment {
  readonly row: StoredExamAssignmentRow;
  readonly assignmentId: string | null;
  readonly studentId: string | null;
  readonly role: ExamAssignmentRole;
}

/** The definition set indexed by id, plus the ids that arrived more than once. */
interface DefinitionIndex {
  readonly byId: ReadonlyMap<string, StoredExamDefinitionRow>;
  readonly duplicated: ReadonlySet<string>;
}

/**
 * Index the definitions by id and record every id that arrived MORE THAN ONCE.
 *
 * A duplicated id identifies no single definition, so it is recorded as
 * ambiguous and resolves NOTHING — the first row is not silently preferred. A
 * definition with no legible id addresses nothing and is skipped; a session
 * pointing at it simply finds no match and reports `EX-ADP-DEFINITION-MISSING`.
 */
function indexDefinitions(
  definitions: readonly StoredExamDefinitionRow[],
): DefinitionIndex {
  const byId = new Map<string, StoredExamDefinitionRow>();
  const duplicated = new Set<string>();
  const list = Array.isArray(definitions) ? definitions : [];
  for (const definition of list) {
    if (definition === null || typeof definition !== "object") continue;
    const id = normalizedId(definition.id);
    if (id === null) continue;
    if (byId.has(id)) {
      duplicated.add(id);
      continue;
    }
    byId.set(id, definition);
  }
  return { byId, duplicated };
}

// ===========================================================================
// One block
// ===========================================================================

/**
 * Compose ONE stored block from its row, its already-resolved definition and its
 * PROVEN-storable kind.
 *
 * ORDER OF OPERATIONS (a hard contract, asserted by test):
 *   1. classify the assignments (role validation — never a coercion);
 *   2. `validateExamDefinition` + `validateAssignmentsAgainstDefinition`
 *      (DIAGNOSTIC ONLY — neither may change `timetableStatus` or hide a row);
 *   3. `computeExamBlockTimetable`, called EXACTLY ONCE;
 *   4. `resolveInstructedTraineeSlots` over that same timetable;
 *   5. build the projection row, the detail lookup entry and the conflict input
 *      from those results and from nothing else.
 */
function composeStoredBlock(
  row: StoredExamSessionRow,
  sessionId: string,
  definition: StoredExamDefinitionRow,
  definitionKind: ExamKind,
): StoredExamBlockComposition {
  const adapterIssues: StoredExamAdapterIssue[] = [];
  const definitionId = normalizedId(definition.id) ?? "";

  // --- 1. assignments: role validation, never coercion ---------------------
  // An unknown role token is REPORTED and EXCLUDED. It is never defaulted to
  // EXAMINEE: guessing would silently hand somebody a lane, a horse requirement
  // and a personal time they were never assigned.
  const rawAssignments = Array.isArray(row.assignments) ? row.assignments : [];
  const resolved: ResolvedAssignment[] = [];
  for (const assignment of rawAssignments) {
    if (assignment === null || typeof assignment !== "object") continue;
    const assignmentId = normalizedId(assignment.id);
    if (assignmentId === null) {
      // Diagnostic only. The declaration still stands; what it cannot do is
      // carry a personal slot, because the assignment id is the ONLY key a
      // derived slot is matched by.
      adapterIssues.push(
        makeIssue("EX-ADP-ASSIGNMENT-ID-REQUIRED", { sessionId, definitionId }),
      );
    }
    if (!isExamAssignmentRole(assignment.role)) {
      adapterIssues.push(
        makeIssue("EX-ADP-ROLE-INVALID", { sessionId, definitionId, assignmentId }),
      );
      continue;
    }
    resolved.push({
      row: assignment,
      assignmentId,
      studentId: normalizedId(assignment.studentId),
      role: assignment.role,
    });
  }

  // The adapter's OWN deterministic order for every array it emits. The
  // timetable core is deliberately NOT fed from this copy — see step 3.
  const ordered = [...resolved].sort((a, b) =>
    compareByOrderIndexThenId(a.row, b.row),
  );

  // --- 2. definition diagnostics -------------------------------------------
  const definitionInput: ExamDefinitionInput = {
    name: definition.name,
    kind: definitionKind,
    durationMinutes: definition.durationMinutes,
    parallelCapacity: definition.parallelCapacity,
    requiresInstructedTrainee: definition.requiresInstructedTrainee,
    requiresLessonTopic: definition.requiresLessonTopic,
    requiresDiscipline: definition.requiresDiscipline,
  };
  const conformanceInput: ExamAssignmentConformanceInput[] = ordered.map((a) => ({
    assignmentId: a.assignmentId ?? "",
    role: a.role,
    studentId: a.studentId,
    horseName: a.row.horseName,
    instructionTopic: a.row.instructionTopic,
    discipline: a.row.discipline,
    pairingIndex: a.row.pairingIndex,
  }));
  // Horse / topic / discipline / instructed-trainee conformance is a DIAGNOSTIC
  // channel for the admin surface. It deliberately does NOT feed the timetable
  // and cannot make a block UNRESOLVED: a block missing a horse is still a real,
  // scheduled block that trainees must be able to see the time of.
  const definitionIssues: ExamDefinitionIssue[] = [
    ...validateExamDefinition(definitionInput).issues,
    ...validateAssignmentsAgainstDefinition(definitionInput, conformanceInput).issues,
  ];

  // --- 3. the timetable, computed exactly once -----------------------------
  // The examinee list is passed in INPUT ORDER. `computeExamBlockTimetable`
  // owns the (orderIndex, assignmentId) sort, and pre-sorting here would make
  // that committed contract untestable through this adapter — a regression in
  // the core's own ordering would be masked by ours.
  const examinees: TimetableExaminee[] = [];
  const instructed: TimetableInstructedTrainee[] = [];
  const pairedExaminees: TimetablePairedExaminee[] = [];
  for (const a of resolved) {
    if (a.role === ROLE_EXAMINEE) {
      examinees.push({
        assignmentId: a.assignmentId ?? "",
        orderIndex: a.row.orderIndex,
      });
      pairedExaminees.push({
        assignmentId: a.assignmentId ?? "",
        pairingIndex: a.row.pairingIndex,
      });
    } else {
      instructed.push({
        assignmentId: a.assignmentId ?? "",
        pairingIndex: a.row.pairingIndex,
      });
    }
  }

  const rawBreaks = Array.isArray(row.breaks) ? row.breaks : [];
  const breaks: TimetableBreak[] = rawBreaks
    .filter((b) => b !== null && typeof b === "object")
    .map((b) => ({
      breakId: typeof b.id === "string" ? b.id : "",
      afterWaveIndex: b.afterWaveIndex,
      durationMinutes: b.durationMinutes,
    }));

  const timetable: ExamBlockTimetable = computeExamBlockTimetable({
    blockStartTime: row.startTime,
    // The definition is the ONLY source of both. `ExamSession.capacity` is
    // deprecated and is not even part of the input contract.
    durationMinutes: definition.durationMinutes,
    parallelCapacity: definition.parallelCapacity,
    examinees,
    breaks,
  });

  // --- 4. inherited instructed-trainee slots -------------------------------
  // An instructed trainee never consumes a lane and never appears in
  // `waves[].assignmentIds`; it INHERITS the paired examinee's exact interval.
  // An unmatched, absent or ambiguous pairing resolves to NOTHING — no slot is
  // invented, and the participant declaration below still stands so the trainee
  // view core can surface the contradiction fail-closed.
  const inherited: readonly ExamTimetableSlot[] = resolveInstructedTraineeSlots(
    timetable,
    pairedExaminees,
    instructed,
  );

  // --- 5. the derived-slot index -------------------------------------------
  // Examinee slots come from the timetable; instructed-trainee slots come ONLY
  // from the inheritance resolver. Nothing else may produce a personal time:
  // not the block start/end, not `blockEndTime`, not an array position, not a
  // name match. First writer wins, so the lookup stays deterministic even if a
  // malformed row repeats an assignment id.
  const slotByAssignmentId = new Map<string, ExamTimetableSlot>();
  for (const slot of timetable.slots) {
    if (!slotByAssignmentId.has(slot.assignmentId)) {
      slotByAssignmentId.set(slot.assignmentId, slot);
    }
  }
  for (const slot of inherited) {
    if (!slotByAssignmentId.has(slot.assignmentId)) {
      slotByAssignmentId.set(slot.assignmentId, slot);
    }
  }

  const timetableStatus = timetable.ok ? STATUS_OK : STATUS_UNRESOLVED;

  // --- 5a. participant id arrays -------------------------------------------
  // Built from the adapter's own ordered copy, so shuffling the input rows
  // cannot change the output. Blank ids are dropped so a malformed row cannot
  // poison the distinct-count aggregates; DUPLICATES ARE PRESERVED, because
  // deduplicating here would hide exactly the state the trainee view core
  // reports as EX-TRN-DUPLICATE-STUDENT-SLOT.
  const examineeStudentIds: string[] = [];
  const instructedTraineeStudentIds: string[] = [];
  for (const a of ordered) {
    if (a.studentId === null) continue;
    if (a.role === ROLE_EXAMINEE) examineeStudentIds.push(a.studentId);
    else instructedTraineeStudentIds.push(a.studentId);
  }

  // --- 5b. the projection row ----------------------------------------------
  const session: ProjectionSession = Object.freeze({
    sessionId,
    // From the DEFINITION, never from the deprecated `ExamSession.kind`.
    kind: definitionKind,
    // A stored block is never a beginner row, so it never carries a format.
    beginnerFormat: null,
    date: row.date,
    startTime: row.startTime,
    // `ExamSession.endTime` is nullable while `ProjectionSession.endTime` is a
    // required string. `""` is SAFE HERE AND ONLY HERE: every stored row below
    // declares `timetableStatus` explicitly as OK or UNRESOLVED, and the
    // projection core's `effectiveEndTime` reads the row's own `endTime` for
    // NEITHER state (OK reads `derivedBlockEndTime`; UNRESOLVED reads nothing).
    // It is therefore never rendered, never summed and never a fallback — it is
    // an unreachable placeholder, not a substituted time.
    endTime: row.endTime ?? "",
    orderIndex: row.orderIndex,
    examineeStudentIds: Object.freeze(examineeStudentIds),
    instructedTraineeStudentIds: Object.freeze(instructedTraineeStudentIds),
    // A stored session never embeds beginner children: `ExamBeginnerChild` is
    // retained empty and unwritten, and is not part of the input contract.
    beginnerChildCount: 0,
    definitionId,
    definitionName: definition.name,
    // Present only for a resolved timetable, and taken ONLY from the timetable.
    // A zero-examinee block legitimately resolves OK with a `null` block end.
    derivedBlockEndTime: timetable.ok ? timetable.blockEndTime : null,
    timetableStatus,
  });

  // --- 5c. the sibling personal-slot detail --------------------------------
  // `null` for an UNRESOLVED block: there is no exact personal time for anybody
  // in it, and the block interval is NOT a fallback.
  let detail: StoredExamBlockDetail | null = null;
  if (timetable.ok) {
    const slots: StoredExamAssignmentSlot[] = [];
    for (const a of ordered) {
      if (a.assignmentId === null) continue;
      const slot = slotByAssignmentId.get(a.assignmentId);
      if (slot === undefined) continue;
      slots.push(
        Object.freeze({
          assignmentId: a.assignmentId,
          // A reserved, not-yet-bound place keeps `null` here and therefore
          // matches no viewer, while still occupying its lane.
          studentId: a.studentId,
          role: a.role,
          startTime: slot.startTime,
          endTime: slot.endTime,
        }),
      );
    }
    detail = Object.freeze({
      source: "STORED" as const,
      sessionId,
      slots: Object.freeze(slots),
    });
  }

  // --- 5d. the conflict input ----------------------------------------------
  // Built in the SAME pass from the SAME timetable, so it cannot disagree with
  // the projection row about session identity, definition identity or status.
  const conflictAssignments: ConflictAssignment[] = [];
  for (const a of ordered) {
    // A conflict is about a PERSON. A reserved place with no student identifies
    // nobody, so it takes part in no clash — while still holding its lane in
    // the timetable above.
    const participant = resolveParticipant({ internalStudentId: a.studentId });
    if (participant === null) continue;
    conflictAssignments.push(
      Object.freeze({
        role: a.role,
        participant,
        assignmentId: a.assignmentId,
        // Assignment-level horse — the definition-aware input. The legacy
        // session-level `horseIds` fallback stays empty, exactly as the conflict
        // core's contract prescribes for a definition-aware caller.
        horse: a.row.horseName,
        pairingIndex: a.row.pairingIndex,
      }),
    );
  }

  const conflictSlots: ConflictAssignmentSlot[] = [];
  for (const a of ordered) {
    if (a.assignmentId === null) continue;
    const slot = slotByAssignmentId.get(a.assignmentId);
    if (slot === undefined) continue;
    conflictSlots.push(
      Object.freeze({
        assignmentId: slot.assignmentId,
        startTime: slot.startTime,
        endTime: slot.endTime,
      }),
    );
  }

  // THE WHOLE-BLOCK interval, which is a different question from a PERSONAL
  // time. The conflict core explicitly falls back to it when a block's timetable
  // is unresolved ("the conservative whole-block fallback applies"), so a block
  // with no derived end must still offer the only end it has — its stored one —
  // or an unresolved block would silently take part in NO time conflict at all,
  // which is the opposite of failing closed. This is never used as, and never
  // reaches, a personal slot. With neither end available the interval is
  // structurally invalid and the conflict core rejects it on its own terms.
  const blockEnd =
    timetable.ok && timetable.blockEndTime !== null
      ? timetable.blockEndTime
      : (row.endTime ?? "");

  const conflictSession: ConflictSession = Object.freeze({
    sessionId,
    interval: Object.freeze({
      date: row.date,
      start: row.startTime,
      end: blockEnd,
    }),
    assignments: Object.freeze(conflictAssignments),
    supervisorIds: Object.freeze(
      (Array.isArray(row.supervisorInstructorIds) ? row.supervisorInstructorIds : [])
        .map((id) => normalizedId(id))
        .filter((id): id is string => id !== null),
    ),
    // No examiner-set concept exists in the schema, so there is nothing to
    // resolve one from and nothing may be invented.
    examinerSetId: null,
    // LEGACY session-level horses stay EMPTY: this is a definition-aware caller
    // and every horse travels on its own assignment above.
    horseIds: Object.freeze([] as string[]),
    arenaId: row.arena,
    // LEGACY declared capacity. Consulted by EX-WRN-05 only when `definitionId`
    // is absent, which it never is here — the definition's `parallelCapacity`
    // produces additional WAVES rather than an overflow, so a capacity warning
    // would be meaningless.
    capacity: null,
    // EX-WRN-07 warns about a missing supervisor AND a missing examiner set.
    // The schema can express no examiner set at all, so enabling it would emit a
    // permanent, unfixable warning on every single block — a warning nobody can
    // act on is worse than no warning. Revisit only if an examiner-set concept
    // is ever added.
    expectsStaffing: false,
    definitionId,
    source: "STORED" as const,
    slots: Object.freeze(conflictSlots),
    timetableStatus,
    // Beginner-only; a stored block has no Teaching-Practice instructor.
    responsibleInstructorId: null,
  });

  adapterIssues.sort(compareIssues);

  return Object.freeze({
    session,
    detail,
    conflictSession,
    timetableIssues: timetable.issues,
    timetableWarnings: timetable.warnings,
    definitionIssues: Object.freeze(definitionIssues),
    adapterIssues: Object.freeze(adapterIssues),
  });
}

// ===========================================================================
// The adapter
// ===========================================================================

/**
 * Adapt stored exam rows into the committed runtime contracts.
 *
 * TOTAL: it throws for no input, accepts a non-array for either argument, and
 * always returns both a block list and an issue list. It never mutates its
 * inputs; every returned object and array is frozen.
 *
 * A session is EXCLUDED — with an observable top-level issue, never silently —
 * when it has no legible id, when its `definitionId` matches no supplied
 * definition, when that id was supplied more than once, or when the resolved
 * definition's kind is not one a stored exam session may carry (which is what
 * keeps a forbidden stored BEGINNER_INSTRUCTION row from ever being projected).
 *
 * Blocks are returned in the locked order `date`, `startTime`, `orderIndex`,
 * `sessionId`, so the result never depends on the order the rows were loaded in.
 */
export function composeStoredExamBlocks(
  sessions: readonly StoredExamSessionRow[],
  definitions: readonly StoredExamDefinitionRow[],
): StoredExamAdapterResult {
  const blocks: StoredExamBlockComposition[] = [];
  const issues: StoredExamAdapterIssue[] = [];

  const index = indexDefinitions(definitions);

  // A duplicated definition id is wrong independently of any session, so it is
  // reported once at plan level even when nothing references it.
  for (const duplicateId of [...index.duplicated].sort(cmp)) {
    issues.push(
      makeIssue("EX-ADP-DEFINITION-DUPLICATE", { definitionId: duplicateId }),
    );
  }

  const sessionList = Array.isArray(sessions) ? sessions : [];
  for (const row of sessionList) {
    if (row === null || typeof row !== "object") continue;

    const requestedDefinitionId = normalizedId(row.definitionId);

    const sessionId = normalizedId(row.id);
    if (sessionId === null) {
      issues.push(
        makeIssue("EX-ADP-SESSION-ID-REQUIRED", {
          definitionId: requestedDefinitionId,
        }),
      );
      continue;
    }

    // A duplicated id identifies no single definition. The first row is NOT
    // silently preferred — the session is excluded.
    if (requestedDefinitionId !== null && index.duplicated.has(requestedDefinitionId)) {
      issues.push(
        makeIssue("EX-ADP-DEFINITION-DUPLICATE", {
          sessionId,
          definitionId: requestedDefinitionId,
        }),
      );
      continue;
    }

    const definition =
      requestedDefinitionId === null ? undefined : index.byId.get(requestedDefinitionId);
    if (definition === undefined) {
      issues.push(
        makeIssue("EX-ADP-DEFINITION-MISSING", {
          sessionId,
          definitionId: requestedDefinitionId,
        }),
      );
      continue;
    }

    // The kind is PROVEN storable here, so nothing downstream needs a cast and a
    // forbidden stored BEGINNER_INSTRUCTION block can never reach a projection.
    if (!isStorableExamKind(definition.kind)) {
      issues.push(
        makeIssue("EX-ADP-DEFINITION-KIND-NOT-STORABLE", {
          sessionId,
          definitionId: requestedDefinitionId,
        }),
      );
      continue;
    }

    blocks.push(composeStoredBlock(row, sessionId, definition, definition.kind));
  }

  blocks.sort(compareBlocks);
  issues.sort(compareIssues);

  return Object.freeze({
    blocks: Object.freeze(blocks),
    issues: Object.freeze(issues),
  });
}

/**
 * Build the sibling lookup `exam-trainee-view-core` consumes, keyed by stored
 * `sessionId`.
 *
 * An UNRESOLVED block contributes NO entry: the trainee view core hides such a
 * row before it ever consults the map, and an empty entry would look like a
 * block that genuinely holds nobody. A live beginner row must never appear here
 * at all — its presence is itself a contradiction the trainee core reports.
 */
export function buildStoredExamBlockDetailLookup(
  blocks: readonly StoredExamBlockComposition[],
): ReadonlyMap<string, StoredExamBlockDetail> {
  const lookup = new Map<string, StoredExamBlockDetail>();
  const list = Array.isArray(blocks) ? blocks : [];
  for (const block of list) {
    if (block === null || typeof block !== "object") continue;
    if (block.detail === null) continue;
    lookup.set(block.detail.sessionId, block.detail);
  }
  return lookup;
}
