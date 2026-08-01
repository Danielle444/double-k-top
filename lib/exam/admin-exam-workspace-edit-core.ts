/**
 * EXAM EX-ADMIN-WORKSPACE-UX — the PURE decisions behind the two operations the
 * admin exam workspace needs and the committed exam backend does not yet own:
 *
 *   1. EDIT one already-stored EXAMINEE assignment — its horse, its instruction
 *      topic and its discipline;
 *   2. MOVE one already-stored EXAMINEE one position up or down within its own
 *      exam session.
 *
 * Everything else the workspace does is served by a committed writer and is NOT
 * restated here: creating an examinee, creating an instructed trainee, removing
 * an assignment of either role, pairing an instructed trainee with an examinee,
 * and publishing or unpublishing the plan all keep their existing owners. This
 * module adds the two missing verbs and no third.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. This module has NO
 * IMPORTS AT ALL, so its purity is a property of the file rather than a promise
 * about a dependency. Every export is a total, deterministic function of its
 * arguments and never mutates its inputs.
 *
 * ===========================================================================
 * WHAT THE EDIT MAY CHANGE — AND WHAT IT STRUCTURALLY CANNOT
 * ===========================================================================
 * An edit submission carries EXACTLY four fields:
 *
 *     assignmentId, horseName, instructionTopic, discipline
 *
 * The three that are actually WRITTEN are the last three. `assignmentId` names
 * the target and is never itself written.
 *
 * Absent — not filtered out, but UNREPRESENTABLE, because no type in this file
 * has a field for them:
 *
 *     sessionId          — the row already belongs to a session, and moving a
 *                          person between sessions is a different operation
 *     studentId          — WHO the assignment is for is fixed at creation; a
 *                          different person is a removal plus a create
 *     role               — an examinee cannot be turned into an instructed
 *                          trainee, or the reverse, by an edit
 *     orderIndex         — ordering is the SECOND operation below, and it never
 *                          travels on an edit submission
 *     pairingIndex       — the committed pairing backend owns every allocation,
 *                          reuse and ambiguity decision, and has no parameter
 *                          through which a client-chosen index could arrive
 *     planId,
 *     courseOfferingId   — both are derived server-side from the authorization
 *                          boundary's verified id
 *     sourcePracticeRole,
 *     notes              — this surface writes neither
 *
 * The HORSE is REQUIRED and non-blank, exactly as the committed create input
 * core requires it: an edit that could blank a horse would be a way to reach a
 * state the create path refuses to produce.
 *
 * The TOPIC and the DISCIPLINE are OPTIONAL HERE and become `null` when blank.
 * Whether a particular exam DEMANDS them is a property of its `ExamDefinition`,
 * which this module cannot see — so the requirement is enforced by the
 * orchestration below, on the definition the SERVER resolved, and never on a
 * flag a submission could carry.
 *
 * ===========================================================================
 * THE MOVE IS A WHOLE-SESSION RENUMBERING, NEVER A TWO-ROW SWAP
 * ===========================================================================
 * The committed create binding documents that two concurrent creates on one
 * session may share an `orderIndex`, and the committed reader's total order is
 * therefore `(orderIndex, assignmentId)` rather than `orderIndex` alone. A move
 * implemented as "swap the two `orderIndex` values" would be silently wrong on
 * exactly those duplicated rows: swapping two equal numbers changes nothing,
 * and the manager would click and see no movement.
 *
 * So the decision this module produces is the session's COMPLETE new order — a
 * permutation of EVERY assignment id the session holds, in the sequence they
 * should end up in — and the write layer assigns `0..n-1` from it. That
 * normalizes duplicated indexes as a side effect, which is the same strategy the
 * committed definition reorder already uses.
 *
 * The rows a caller hands in are the session's rows IN THE COMMITTED READER'S
 * ORDER. This module does NOT sort them: it cannot, because it is not given
 * `orderIndex` at all. Ordering is the reader's answer, and re-deriving it here
 * from a second source would be a second opinion nobody asked for.
 *
 * ONLY AN EXAMINEE MOVES. An instructed trainee has no independent position in
 * the timetable — it is examined alongside the ONE examinee it is paired with,
 * which is the committed pairing backend's business — so asking to move one is a
 * refusal rather than a no-op. Its row still keeps its place in the permutation:
 * the swap exchanges the target examinee with the NEXT EXAMINEE in the chosen
 * direction, and every other row stays exactly where it was.
 *
 * ===========================================================================
 * NO BOUNDS, NO COERCION, NO CASE FOLDING
 * ===========================================================================
 * There is NO maximum length for any field: no such bound is approved, and an
 * unapproved ceiling would silently reject a legitimate horse name or a long
 * instruction topic.
 *
 * Nothing is coerced. A number, a boolean, an array, a plain object, a file-like
 * upload value and a function are all REFUSED rather than stringified — there is
 * no `String(...)` anywhere in this file, because one would happily store
 * `"[object Object]"` as a horse name.
 *
 * Every accepted string is preserved BYTE-FOR-BYTE except for `trim()`. There is
 * no `normalize()`, no `toLowerCase()` and no locale-aware comparison anywhere,
 * so Hebrew and every other script survive unchanged, and every opaque id keeps
 * its exact case.
 */

// ===========================================================================
// 1. The EDIT input
// ===========================================================================

/**
 * Every input diagnostic the edit can produce.
 *
 * Two codes for two REQUIRED fields, and deliberately none for the topic or the
 * discipline: those are optional AT THIS LAYER, and the definition-aware refusal
 * that may still reject a blank one is an orchestration outcome rather than an
 * input diagnostic — it depends on a row this module never sees.
 */
export type ExamAssignmentEditInputIssueCode =
  | "EX-ASG-ED-ASSIGNMENT-REQUIRED"
  | "EX-ASG-ED-HORSE-REQUIRED";

/**
 * The message table. Stable Hebrew, one message per code, and deliberately
 * NON-ECHOING: no message contains a placeholder, a submitted value, a field
 * path, an id or a count, so a diagnostic can never reflect what the client sent
 * back to the client.
 */
export const EXAM_ASSIGNMENT_EDIT_INPUT_MESSAGES: Readonly<
  Record<ExamAssignmentEditInputIssueCode, string>
> = Object.freeze({
  "EX-ASG-ED-ASSIGNMENT-REQUIRED": "בקשת העריכה אינה תקינה",
  "EX-ASG-ED-HORSE-REQUIRED": "חובה לציין סוס עבור הנבחן",
});

/** One diagnostic. Carries ONLY a stable code and its message. */
export interface ExamAssignmentEditInputIssue {
  readonly code: ExamAssignmentEditInputIssueCode;
  readonly message: string;
}

/** Build one frozen diagnostic from its code. */
export function makeExamAssignmentEditInputIssue(
  code: ExamAssignmentEditInputIssueCode,
): ExamAssignmentEditInputIssue {
  return Object.freeze({ code, message: EXAM_ASSIGNMENT_EDIT_INPUT_MESSAGES[code] });
}

/**
 * The normalized EDIT payload.
 *
 * `horseName` is always a non-blank string. `instructionTopic` and `discipline`
 * are the trimmed value or `null` — never `undefined`, never `""` — so the write
 * layer has one unambiguous shape to store and a blank submission clears the
 * column rather than leaving whitespace in it.
 */
export interface NormalizedExamAssignmentEdit {
  readonly assignmentId: string;
  readonly horseName: string;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
}

/** A discriminated, JSON-safe result. */
export type ExamAssignmentEditInputResult =
  | { readonly ok: true; readonly value: NormalizedExamAssignmentEdit }
  | {
      readonly ok: false;
      readonly issues: readonly ExamAssignmentEditInputIssue[];
    };

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if the client had sent them would
 * turn prototype members into submitted data.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * Normalize a REQUIRED text value: trim a string, or fail with `null`.
 *
 * `null` means "unusable" for every one of: absent, `null`, `undefined`, a
 * non-string of ANY type, and a string that is empty or whitespace-only.
 */
function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize an OPTIONAL text value: the trimmed string, or `null`.
 *
 * A non-string is `null` rather than a refusal, which is the honest reading of
 * an optional field: nothing usable was supplied, so nothing is stored. The
 * definition-aware requirement — when a `null` here is actually unacceptable —
 * is applied by the orchestration below and never by this helper.
 */
function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Normalize and validate a RAW examinee EDIT submission.
 *
 * EVERY applicable issue is reported, not only the first, and the issue ORDER is
 * FIXED — assignmentId, then horseName — so a form can render diagnostics in a
 * stable sequence and a test can assert on it.
 *
 * This function grants NOTHING. A successful result means only "these values are
 * well-formed". Whether the assignment exists under the acting course's plan,
 * whether it is an EXAMINEE, and whether its exam demands a topic or a
 * discipline are ALL questions for the orchestration below.
 *
 * Never throws. Never mutates `rawInput`.
 */
export function normalizeExamAssignmentEditInput(
  rawInput: unknown,
): ExamAssignmentEditInputResult {
  const issues: ExamAssignmentEditInputIssue[] = [];

  const assignmentId = normalizeRequiredText(readField(rawInput, "assignmentId"));
  if (assignmentId === null) {
    issues.push(makeExamAssignmentEditInputIssue("EX-ASG-ED-ASSIGNMENT-REQUIRED"));
  }

  const horseName = normalizeRequiredText(readField(rawInput, "horseName"));
  if (horseName === null) {
    issues.push(makeExamAssignmentEditInputIssue("EX-ASG-ED-HORSE-REQUIRED"));
  }

  const instructionTopic = normalizeOptionalText(readField(rawInput, "instructionTopic"));
  const discipline = normalizeOptionalText(readField(rawInput, "discipline"));

  if (issues.length > 0) {
    return Object.freeze({ ok: false as const, issues: Object.freeze([...issues]) });
  }

  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      assignmentId: assignmentId as string,
      horseName: horseName as string,
      instructionTopic,
      discipline,
    }),
  });
}

// ===========================================================================
// 2. The MOVE decision
// ===========================================================================

/** The two directions a manager may move an examinee, and no third. */
export type ExamAssignmentMoveDirection = "UP" | "DOWN";

/**
 * Recognize a submitted direction, closed in both directions.
 *
 * Exported so the write layer can refuse an unusable direction before any query
 * runs, without restating the two literals.
 */
export function isExamAssignmentMoveDirection(
  value: unknown,
): value is ExamAssignmentMoveDirection {
  return value === "UP" || value === "DOWN";
}

/**
 * One row of the session, as the committed reader already ordered it.
 *
 * Deliberately NARROW: an id and a role. No name, no horse, no topic, no
 * discipline, no `orderIndex` and no pairing — a permutation needs identity and
 * eligibility, and nothing else. In particular NOT taking `orderIndex` is what
 * makes it impossible for this module to invent an order of its own.
 */
export interface MovableExamAssignmentRow {
  readonly assignmentId: string;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
}

/** Why a move cannot be decided. */
export type ExamAssignmentMoveRefusalCode =
  | "assignment_not_found"
  | "role_not_movable";

/**
 * The decision.
 *
 * `AT_EDGE` is a SUCCESS and not a refusal: the manager asked to move the first
 * examinee up, or the last one down, and the honest answer is that the order is
 * already what they asked for. The write layer issues no statement for it, so a
 * click at the edge costs one read and writes nothing.
 */
export type ExamAssignmentMoveDecision =
  | { readonly ok: true; readonly moved: false }
  | { readonly ok: true; readonly moved: true; readonly orderedAssignmentIds: readonly string[] }
  | { readonly ok: false; readonly code: ExamAssignmentMoveRefusalCode };

/**
 * Decide the session's COMPLETE new order after moving ONE examinee one step.
 *
 * `rows` are the session's assignments in the committed reader's own order. The
 * target is exchanged with the NEXT EXAMINEE in the chosen direction — not with
 * its immediate neighbour, which may be an instructed trainee that has no
 * position of its own — and every other row keeps its exact place.
 *
 * The result is a permutation of `rows`: same length, same ids, no duplicate and
 * no invention. The write layer assigns `0..n-1` from it, which also normalizes
 * any duplicated `orderIndex` the session was carrying.
 *
 * Never throws, never mutates `rows`, and reads no clock.
 */
export function decideExamAssignmentMove(
  rows: readonly MovableExamAssignmentRow[],
  assignmentId: string,
  direction: ExamAssignmentMoveDirection,
): ExamAssignmentMoveDecision {
  const targetIndex = rows.findIndex((row) => row.assignmentId === assignmentId);
  if (targetIndex === -1) {
    return Object.freeze({ ok: false as const, code: "assignment_not_found" as const });
  }
  if (rows[targetIndex].role !== "EXAMINEE") {
    return Object.freeze({ ok: false as const, code: "role_not_movable" as const });
  }

  const step = direction === "UP" ? -1 : 1;
  let partnerIndex = -1;
  for (let index = targetIndex + step; index >= 0 && index < rows.length; index += step) {
    if (rows[index].role === "EXAMINEE") {
      partnerIndex = index;
      break;
    }
  }

  // No examinee on that side: the target already sits at the edge of the order
  // it can occupy. Reported as an honest no-op rather than as a refusal.
  if (partnerIndex === -1) {
    return Object.freeze({ ok: true as const, moved: false as const });
  }

  const ordered = rows.map((row) => row.assignmentId);
  const carried = ordered[targetIndex];
  ordered[targetIndex] = ordered[partnerIndex];
  ordered[partnerIndex] = carried;

  return Object.freeze({
    ok: true as const,
    moved: true as const,
    orderedAssignmentIds: Object.freeze(ordered),
  });
}

// ===========================================================================
// 3. The orchestrations
// ===========================================================================

/** The authorization boundary's answer: a VERIFIED offering id and its status. */
export interface VerifiedExamWorkspaceCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** The exam plan of that verified offering, resolved server-side. */
export interface ResolvedExamWorkspacePlan {
  readonly id: string;
}

/**
 * ONE stored assignment, as the plan-scoped read returns it.
 *
 * `requiresLessonTopic` and `requiresDiscipline` come from the row's own
 * session's `ExamDefinition` and are resolved by the READ, never submitted:
 * a client has no channel through which it could claim its exam demands less.
 */
export interface ExistingExamAssignmentForEdit {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
}

/** Every refusal the EDIT can produce. */
export type UpdateExamAssignmentDetailsRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "invalid_input"
  | "assignment_not_found"
  | "role_not_editable"
  | "lesson_topic_required"
  | "discipline_required";

/**
 * The EDIT outcome.
 *
 * `changed: false` means the submission matched what was already stored, so NO
 * statement was issued. Distinguishing it is what lets the surface say "nothing
 * changed" instead of claiming a save that never happened.
 */
export type UpdateExamAssignmentDetailsResult =
  | { readonly ok: true; readonly changed: boolean }
  | {
      readonly ok: false;
      readonly code: UpdateExamAssignmentDetailsRefusalCode;
      readonly issues: readonly ExamAssignmentEditInputIssue[];
    };

/** Everything the EDIT orchestration needs from the outside world. */
export interface UpdateExamAssignmentDetailsDeps {
  readonly requireCourseContext: (
    requestedCourseOfferingId: string,
  ) => Promise<VerifiedExamWorkspaceCourseContext>;
  readonly assertConfigurationAllowed: (status: string) => void;
  readonly findExamPlanByCourseOfferingId: (
    verifiedCourseOfferingId: string,
  ) => Promise<ResolvedExamWorkspacePlan | null>;
  readonly findAssignmentForPlan: (
    planId: string,
    assignmentId: string,
  ) => Promise<ExistingExamAssignmentForEdit | null>;
  readonly updateAssignmentDetails: (
    assignmentId: string,
    details: {
      readonly horseName: string;
      readonly instructionTopic: string | null;
      readonly discipline: string | null;
    },
  ) => Promise<void>;
  readonly isCourseNotFoundError: (error: unknown) => boolean;
  readonly isOperationNotAllowedError: (error: unknown) => boolean;
}

/** The frozen empty diagnostics list every non-input refusal carries. */
const NO_ISSUES: readonly ExamAssignmentEditInputIssue[] = Object.freeze([]);

function editRefusal(
  code: UpdateExamAssignmentDetailsRefusalCode,
  issues: readonly ExamAssignmentEditInputIssue[] = NO_ISSUES,
): UpdateExamAssignmentDetailsResult {
  return Object.freeze({ ok: false as const, code, issues });
}

/**
 * Update the three stored detail columns of ONE examinee assignment.
 *
 * ORDER, and every step of it is load-bearing:
 *   1. admin + the EXACT offering, through the injected boundary. Its typed
 *      "that offering does not exist" is classified; its authorization redirect
 *      and every other throw propagate untouched;
 *   2. the course-lifecycle WRITE gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id — never an upsert, because a
 *      read must not bring a plan into existence;
 *   4. the input normalizer. A malformed submission refuses with NO further
 *      query and NO write;
 *   5. ONE PLAN-SCOPED assignment read. A row of another course simply is not
 *      found: the scope is the query, not a comparison somebody could delete;
 *   6. the role check — only an EXAMINEE carries these three columns;
 *   7. the DEFINITION-aware requirement, against what the READ resolved;
 *   8. the no-op check. Identical values write NOTHING;
 *   9. ONE `update` against the id THAT READ RETURNED.
 *
 * Never throws for a modelled outcome. Never mutates its inputs.
 */
export async function updateExamAssignmentDetailsWithDeps(
  requestedCourseOfferingId: string,
  rawInput: unknown,
  deps: UpdateExamAssignmentDetailsDeps,
): Promise<UpdateExamAssignmentDetailsResult> {
  let context: VerifiedExamWorkspaceCourseContext;
  try {
    context = await deps.requireCourseContext(requestedCourseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) return editRefusal("offering_not_found");
    throw error;
  }

  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) return editRefusal("operation_not_allowed");
    throw error;
  }

  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);
  if (plan === null) return editRefusal("plan_not_found");

  const normalized = normalizeExamAssignmentEditInput(rawInput);
  if (!normalized.ok) return editRefusal("invalid_input", normalized.issues);

  const existing = await deps.findAssignmentForPlan(plan.id, normalized.value.assignmentId);
  if (existing === null) return editRefusal("assignment_not_found");
  if (existing.role !== "EXAMINEE") return editRefusal("role_not_editable");

  if (existing.requiresLessonTopic && normalized.value.instructionTopic === null) {
    return editRefusal("lesson_topic_required");
  }
  if (existing.requiresDiscipline && normalized.value.discipline === null) {
    return editRefusal("discipline_required");
  }

  const unchanged =
    existing.horseName === normalized.value.horseName &&
    existing.instructionTopic === normalized.value.instructionTopic &&
    existing.discipline === normalized.value.discipline;
  if (unchanged) {
    return Object.freeze({ ok: true as const, changed: false });
  }

  await deps.updateAssignmentDetails(existing.assignmentId, {
    horseName: normalized.value.horseName,
    instructionTopic: normalized.value.instructionTopic,
    discipline: normalized.value.discipline,
  });

  return Object.freeze({ ok: true as const, changed: true });
}

/** Every refusal the MOVE can produce. */
export type MoveExamAssignmentRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "invalid_input"
  | ExamAssignmentMoveRefusalCode;

/** The MOVE outcome. `moved: false` means the target was already at the edge. */
export type MoveExamAssignmentResult =
  | { readonly ok: true; readonly moved: boolean }
  | { readonly ok: false; readonly code: MoveExamAssignmentRefusalCode };

/** Everything the MOVE orchestration needs from the outside world. */
export interface MoveExamAssignmentDeps {
  readonly requireCourseContext: (
    requestedCourseOfferingId: string,
  ) => Promise<VerifiedExamWorkspaceCourseContext>;
  readonly assertConfigurationAllowed: (status: string) => void;
  readonly findExamPlanByCourseOfferingId: (
    verifiedCourseOfferingId: string,
  ) => Promise<ResolvedExamWorkspacePlan | null>;
  /** The assignment, ONLY if it belongs to this plan. Carries its session id. */
  readonly findAssignmentSessionForPlan: (
    planId: string,
    assignmentId: string,
  ) => Promise<{ readonly sessionId: string } | null>;
  /** Every row of that session, in the committed reader's own total order. */
  readonly listSessionAssignmentsInOrder: (
    sessionId: string,
  ) => Promise<readonly MovableExamAssignmentRow[]>;
  /** Write `0..n-1` onto the given ids, atomically, in ONE transaction. */
  readonly renumberSessionAssignments: (
    sessionId: string,
    orderedAssignmentIds: readonly string[],
  ) => Promise<void>;
  readonly isCourseNotFoundError: (error: unknown) => boolean;
  readonly isOperationNotAllowedError: (error: unknown) => boolean;
}

function moveRefusal(code: MoveExamAssignmentRefusalCode): MoveExamAssignmentResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Move ONE examinee one position up or down within its own exam session.
 *
 * ORDER:
 *   1. admin + the EXACT offering;
 *   2. the course-lifecycle WRITE gate on the VERIFIED status;
 *   3. ONE plan lookup on the VERIFIED offering id;
 *   4. the two submitted values are checked BEFORE any further query: an
 *      unusable id or an unrecognized direction refuses having read nothing;
 *   5. ONE PLAN-SCOPED read that yields the target's session. A row of another
 *      course is simply not found;
 *   6. ONE session-scoped ordered read of every row that session holds;
 *   7. the pure permutation above;
 *   8. at the edge -> NOTHING is written;
 *   9. otherwise ONE atomic renumbering of that session.
 *
 * The SESSION is never submitted. It is read from the target row, so this
 * operation cannot be talked into renumbering a session the manager did not
 * name — and it can never move a person between sessions, because a permutation
 * of one session's own ids has no way to express that.
 */
export async function moveExamAssignmentWithDeps(
  requestedCourseOfferingId: string,
  rawAssignmentId: unknown,
  rawDirection: unknown,
  deps: MoveExamAssignmentDeps,
): Promise<MoveExamAssignmentResult> {
  let context: VerifiedExamWorkspaceCourseContext;
  try {
    context = await deps.requireCourseContext(requestedCourseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) return moveRefusal("offering_not_found");
    throw error;
  }

  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) return moveRefusal("operation_not_allowed");
    throw error;
  }

  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);
  if (plan === null) return moveRefusal("plan_not_found");

  const assignmentId = normalizeRequiredText(rawAssignmentId);
  if (assignmentId === null) return moveRefusal("invalid_input");
  if (!isExamAssignmentMoveDirection(rawDirection)) return moveRefusal("invalid_input");

  const target = await deps.findAssignmentSessionForPlan(plan.id, assignmentId);
  if (target === null) return moveRefusal("assignment_not_found");

  const rows = await deps.listSessionAssignmentsInOrder(target.sessionId);
  const decision = decideExamAssignmentMove(rows, assignmentId, rawDirection);
  if (!decision.ok) return moveRefusal(decision.code);
  if (!decision.moved) return Object.freeze({ ok: true as const, moved: false });

  await deps.renumberSessionAssignments(target.sessionId, decision.orderedAssignmentIds);
  return Object.freeze({ ok: true as const, moved: true });
}
