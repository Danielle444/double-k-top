/**
 * EXAM EX-ASG-IO1 — the PURE read shaping behind the two ADMIN assignment reads:
 * the ELIGIBLE-TRAINEE picker, and the STORED-ASSIGNMENT list.
 *
 * PURE by construction: no database client, no transaction, no clock, no
 * randomness, no environment, no auth/session/cookie, no capability, no
 * filesystem, no network, no Next, no `server-only`, no `"use server"`. This
 * module declares NO IMPORTS AT ALL, so its purity is a property of the file
 * rather than a promise about a dependency. Every export is a total,
 * deterministic function of its arguments and never mutates its inputs.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in what TOTAL order are the two lists presented, and what exactly may each
 *    published row contain?
 *  - what does "nothing to show" look like, so an empty answer is a shape rather
 *    than a special case every caller re-invents?
 *  - what is shown for a stored assignment whose trainee link is absent?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of a row, a query, a plan, a course
 *    offering or an actor. Both builders are plain functions over plain data;
 *  - it AUTHORIZES NOTHING and GATES NOTHING. There is no admin check, no
 *    offering boundary and no lifecycle gate here — the IO shell owns all three,
 *    and holding a view built by this module grants NOTHING;
 *  - it FILTERS NOTHING BY ROLE. See the section below: this is a read, and a
 *    reader that silently drops rows is a reader that hides them;
 *  - it JOINS NOTHING. There is no enrolment lookup, no session resolution, no
 *    definition resolution and no capacity, wave, slot, end-time or timetable
 *    computation. Those belong to the derived-schedule cores, not here;
 *  - it INVENTS NO REFUSAL. There is no not-found, denied or invalid code
 *    anywhere: a denial is a THROW the IO shell propagates, and turning one into
 *    an empty list would say "there is nothing here" when the truth is "you may
 *    not see this".
 *
 * ===========================================================================
 * THE TWO LISTS ARE DIFFERENT QUESTIONS, AND THEIR SCOPES DIFFER ON PURPOSE
 * ===========================================================================
 * The ELIGIBLE-TRAINEE list answers "who may I assign RIGHT NOW?". Its rows are
 * produced by the IO shell from CURRENTLY ACTIVE enrolments of CURRENTLY ACTIVE
 * trainees, because offering somebody who has left the course is offering a
 * choice the write path would refuse anyway.
 *
 * The STORED-ASSIGNMENT list answers "who IS assigned?". It is HISTORY, and it
 * must stay readable even after a trainee is deactivated or leaves the offering.
 * Nothing in this module re-checks eligibility on the assignment path — there is
 * no field carrying activity or enrolment for it to check — so a historical row
 * cannot silently vanish from a manager's screen because of a later roster
 * change.
 *
 * ===========================================================================
 * NO ROLE FILTER, EVER
 * ===========================================================================
 * The stored assignment table carries TWO roles. The current write surface
 * creates only examinees, so an `INSTRUCTED_TRAINEE` row is unexpected today —
 * which is exactly why it must be SHOWN rather than hidden. A reader that
 * omitted it would leave a manager looking at a session that silently contains a
 * person their screen never mentioned, and would make the future second-role
 * slice's rows invisible until somebody remembered to widen a filter here.
 *
 * The role is therefore carried VERBATIM and every row is published. Which roles
 * exist at all is the database enum's decision, restated in the published type
 * so a consumer can exhaustively switch on it.
 *
 * ===========================================================================
 * A MISSING TRAINEE IS NAMED, NOT DROPPED AND NOT INVENTED
 * ===========================================================================
 * The stored assignment's trainee reference is NULLABLE. A row whose trainee is
 * absent is still a real, occupied position in a session, so it is KEPT — and
 * given ONE fixed, non-personal Hebrew placeholder, {@link
 * UNASSIGNED_EXAM_TRAINEE_NAME}.
 *
 * The placeholder is a CONSTANT, never a derived or partial value: no id, no
 * fragment of a name and no "unknown #3" counter, because each of those would be
 * a fabricated identity a manager might act on. Dropping the row instead would
 * be worse still — the position would disappear from the list while continuing
 * to occupy the session.
 *
 * ===========================================================================
 * WHAT NEITHER VIEW MAY CARRY
 * ===========================================================================
 * NO `Student.id` appears in the assignment DTO. The list is a display of who is
 * assigned; the id is a handle for acting on a person, the removal path already
 * identifies its target by the ASSIGNMENT id, and an id that is never published
 * cannot be replayed into a write. The eligible-trainee OPTION does carry a
 * `studentId`, because it exists precisely to be submitted back as the create's
 * chosen trainee.
 *
 * And NEITHER view carries: an identity number, a phone number, a parent name, a
 * parent phone, a guardian record, an address, a group, a subgroup, a
 * membership, an enrolment id, an enrolment status, an activity flag, a horse
 * assignment or horse history, a course offering id, a plan id, a timestamp, a
 * grade, a score or an evaluation. None of them is filtered out — none has a
 * field in any type here, so none can arrive.
 *
 * ===========================================================================
 * DETERMINISTIC TOTAL ORDERS, RE-IMPOSED RATHER THAN TRUSTED
 * ===========================================================================
 * The IO shell orders both queries in the database. This module SORTS AGAIN
 * anyway, on a COPY, and its order is the authoritative one:
 *
 *   eligible trainees  — fullName, then studentId
 *   assignments        — sessionId, then orderIndex, then assignmentId
 *
 * Both end in a UNIQUE key, so both are TOTAL: two trainees who share a display
 * name still have a stable relative position, and two assignments that share an
 * order position within one session do too. That last case is REAL rather than
 * theoretical — the committed create binding assigns `orderIndex` from a MAX
 * with no unique constraint behind it, and honestly documents that two
 * concurrent creates may receive the same position — so the id tie-break is what
 * stops the list reshuffling between two identical reads.
 *
 * Text is compared with plain `<` on the raw string. That is EXACT and
 * dependency-free; a locale-aware collation would make the order depend on where
 * the code ran, which is precisely what a deterministic sort must not do. No
 * value is trimmed, case-folded or normalized for the comparison, so nothing is
 * silently treated as equal that is not.
 *
 * ===========================================================================
 * PLAIN, DEEPLY FROZEN JSON
 * ===========================================================================
 * Every published value is a plain object, array, string, number or `null`.
 * Nothing is a `Date`, `Map`, `Set`, `BigInt`, `Error` or class instance, so
 * `JSON.parse(JSON.stringify(view))` deep-equals the view itself and the result
 * crosses a server/client boundary unchanged.
 *
 * The freezing is DEEP: the view, its array and every row in it. A shallow
 * freeze would leave a consumer free to rewrite a trainee's name in place, and a
 * shared frozen empty array is safe precisely because it is immutable.
 */

// ===========================================================================
// The fixed placeholder
// ===========================================================================

/**
 * The ONE name shown for a stored assignment whose trainee reference is absent.
 *
 * Exported so a caller — and this slice's own suite — can name the exact string
 * rather than re-spelling Hebrew text and hoping it matches. It is deliberately
 * NOT a personal identifier of any kind.
 */
export const UNASSIGNED_EXAM_TRAINEE_NAME = "ללא חניך משויך";

// ===========================================================================
// The eligible-trainee list
// ===========================================================================

/**
 * One eligible trainee, as the IO shell reads them.
 *
 * TWO fields. There is no identity number, no phone, no parent contact, no
 * group, no membership, no horse, no enrolment id, no enrolment status and no
 * activity flag — the enrolment and activity conditions are a WHERE clause in
 * the IO shell, not data this module inspects, so a value it cannot see is a
 * value it cannot leak.
 */
export interface StoredEligibleExamTraineeRow {
  readonly studentId: string;
  readonly fullName: string;
}

/**
 * ONE option in the create form's trainee picker.
 *
 * The id IS published here, and only here: this option exists to be submitted
 * back as the chosen trainee, and the write path verifies it again under the
 * server-verified offering before it reaches a row.
 */
export interface EligibleExamTraineeOption {
  readonly studentId: string;
  readonly fullName: string;
}

/**
 * The whole picker.
 *
 * A single named field rather than a bare array, so a caller that renders it
 * cannot confuse it with the assignment list, and so a later addition to this
 * view is not a breaking change to everyone destructuring it.
 */
export interface EligibleExamTraineeListView {
  readonly trainees: readonly EligibleExamTraineeOption[];
}

// ===========================================================================
// The stored-assignment list
// ===========================================================================

/**
 * One stored assignment, as the IO shell reads it.
 *
 * `traineeName` is NULLABLE here and NOT null in the published DTO: the absent
 * link is resolved to the fixed placeholder exactly once, in this module, so no
 * consumer has to decide what to render for it.
 *
 * `instructionTopic` and `discipline` are the two DETAIL values the detailed
 * create writer stores on an examinee's row. They are read here because a
 * manager looking at a session must be able to see what was actually stored —
 * a value that exists but is never displayed is indistinguishable from one that
 * was never written, and this list is the only surface that shows the row at all.
 *
 * Note what still has NO field and therefore cannot arrive: `Student.id`, the
 * identity number, the phone, any parent or guardian detail, the group, the
 * pairing index, the source practice role, the notes, `planId`,
 * `courseOfferingId`, `createdAt` and `updatedAt`.
 */
export interface StoredAdminExamAssignmentRow {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  readonly traineeName: string | null;
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly orderIndex: number;
}

/**
 * ONE published assignment line.
 *
 * `traineeName` is always a non-empty string — either the stored name, carried
 * VERBATIM, or the fixed placeholder. `horseName` stays nullable because a horse
 * is genuinely optional on the stored row for roles this slice does not write,
 * and inventing a horse name would be worse than showing none.
 *
 * `instructionTopic` and `discipline` are nullable for the same honest reason and
 * are NEVER given a placeholder here: a historical row that is missing a value the
 * exam actually demanded is a real gap, and this module publishes the gap as
 * `null` rather than papering over it with fixed text. What a consumer says about
 * that `null` — nothing at all, or an explicit diagnostic — is the consumer's
 * decision, made against the DEFINITION's requirements, which this module cannot
 * see and deliberately does not join.
 *
 * There is deliberately no `studentId`, and no field for anything the header's
 * exclusion list names.
 */
export interface AdminExamAssignmentRow {
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly role: "EXAMINEE" | "INSTRUCTED_TRAINEE";
  readonly traineeName: string;
  readonly horseName: string | null;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
  readonly orderIndex: number;
}

/** The whole assignment list, for the same reason the picker is wrapped. */
export interface AdminExamAssignmentListView {
  readonly assignments: readonly AdminExamAssignmentRow[];
}

// ===========================================================================
// The shared empty views
// ===========================================================================

/**
 * The two shared frozen empty arrays. Handing out ONE immutable empty array is
 * safe precisely because nothing can append to it, and it means an empty answer
 * is the SAME shape every time rather than a fresh object per call.
 */
const NO_TRAINEES: readonly EligibleExamTraineeOption[] = Object.freeze([]);
const NO_ASSIGNMENTS: readonly AdminExamAssignmentRow[] = Object.freeze([]);

/**
 * The picker of a course offering with nobody eligible.
 *
 * This is an honest ABSENCE, never a refusal: an authorized admin looking at an
 * offering whose roster is empty gets this, and so does one whose trainees have
 * all been deactivated.
 */
export function emptyEligibleExamTraineeListView(): EligibleExamTraineeListView {
  return Object.freeze({ trainees: NO_TRAINEES });
}

/**
 * The assignment list of a course offering with no exam plan, or with a plan
 * nobody is assigned under. Both are the same honest absence.
 */
export function emptyAdminExamAssignmentListView(): AdminExamAssignmentListView {
  return Object.freeze({ assignments: NO_ASSIGNMENTS });
}

// ===========================================================================
// Narrow normalization — only for the JSON and sorting promises
// ===========================================================================

/**
 * Lexicographic compare on the RAW string.
 *
 * No locale, no collator, no case folding and no trimming: the comparison must
 * produce the same order on every machine, and a locale-aware one would not.
 */
function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * A position that is safe to serialize and safe to SORT BY.
 *
 * A non-integer becomes `0`; comparing `NaN` is what silently produces a
 * different order on every read while looking like it works.
 */
function toOrderIndex(value: number): number {
  return Number.isInteger(value) ? value : 0;
}

/**
 * Text carried VERBATIM, with a missing value collapsed to `null`.
 *
 * No trim, no case fold, no substitution: what the manager typed is what the
 * manager sees. The ONLY transformation is that `undefined` becomes `null`,
 * because `undefined` is not JSON and would vanish from a serialized payload
 * instead of round-tripping as "no value".
 */
function toOptionalText(value: string | null | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The trainee's display name, or the ONE fixed placeholder.
 *
 * A non-string and an empty string are both treated as "no linked trainee": a
 * blank line in a roster is indistinguishable from a rendering bug, and the
 * placeholder says plainly what is true. The stored name is otherwise carried
 * byte-for-byte.
 */
function toTraineeName(value: string | null | undefined): string {
  if (typeof value !== "string" || value.length === 0) {
    return UNASSIGNED_EXAM_TRAINEE_NAME;
  }
  return value;
}

// ===========================================================================
// The locked total orders
// ===========================================================================

/**
 * The picker's order: DISPLAY NAME, then the trainee id.
 *
 * The name is what a manager scans for, so it leads. The id tie-break is not
 * decoration: two trainees may legitimately share a full name, and without it
 * their relative position would depend on the input order — which would make the
 * two adjacent, identical-looking options swap places between reads and invite
 * the wrong one to be picked.
 */
function byDisplayNameThenId(
  left: StoredEligibleExamTraineeRow,
  right: StoredEligibleExamTraineeRow,
): number {
  const byName = compareText(left.fullName, right.fullName);
  if (byName !== 0) {
    return byName;
  }
  return compareText(left.studentId, right.studentId);
}

/**
 * The assignment order: SESSION, then the manager's position within it, then the
 * assignment id.
 *
 * Grouping by session first is what lets a consumer render the list as sessions
 * without re-sorting. The position is the manager's own arrangement. The id
 * tie-break closes the equal-position case the committed create binding
 * documents, making this a TOTAL order rather than a nearly-total one.
 */
function bySessionThenPositionThenId(
  left: StoredAdminExamAssignmentRow,
  right: StoredAdminExamAssignmentRow,
): number {
  const bySession = compareText(left.sessionId, right.sessionId);
  if (bySession !== 0) {
    return bySession;
  }
  const leftPosition = toOrderIndex(left.orderIndex);
  const rightPosition = toOrderIndex(right.orderIndex);
  if (leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  return compareText(left.assignmentId, right.assignmentId);
}

// ===========================================================================
// The projections
// ===========================================================================

/** One frozen picker option. The name is carried VERBATIM. */
function toTraineeOption(row: StoredEligibleExamTraineeRow): EligibleExamTraineeOption {
  return Object.freeze({
    studentId: row.studentId,
    fullName: row.fullName,
  });
}

/**
 * One frozen assignment line.
 *
 * The role is carried VERBATIM — no mapping table, no default and no fallback —
 * so an unexpected role is reported as itself rather than being relabelled as
 * the one this slice happens to write.
 *
 * The two detail values go through the SAME `toOptionalText` the horse uses, so
 * they are carried byte-for-byte with `undefined` collapsed to `null` and nothing
 * else changed. No role is consulted while shaping them: this module publishes
 * what the row holds, and WHICH roles a surface chooses to show a detail for is
 * that surface's decision, not a silent erasure made here.
 */
function toAssignmentRow(row: StoredAdminExamAssignmentRow): AdminExamAssignmentRow {
  return Object.freeze({
    assignmentId: row.assignmentId,
    sessionId: row.sessionId,
    role: row.role,
    traineeName: toTraineeName(row.traineeName),
    horseName: toOptionalText(row.horseName),
    instructionTopic: toOptionalText(row.instructionTopic),
    discipline: toOptionalText(row.discipline),
    orderIndex: toOrderIndex(row.orderIndex),
  });
}

// ===========================================================================
// The builders
// ===========================================================================

/**
 * Build the create form's trainee picker from the rows the IO shell read.
 *
 * WHO is eligible was decided by the query; this function neither re-checks nor
 * re-filters it. What it owns is the TOTAL ORDER, the narrow published shape and
 * the deep freeze.
 *
 * The input array is COPIED before it is sorted and no input row object is ever
 * published, so a frozen input is accepted and an unfrozen one is left
 * untouched. Duplicate display names are PRESERVED as separate options — two
 * trainees with the same name are two people, and collapsing them would make one
 * of them unassignable.
 *
 * Never throws.
 */
export function buildEligibleExamTraineeListView(
  rows: readonly StoredEligibleExamTraineeRow[],
): EligibleExamTraineeListView {
  if (rows.length === 0) {
    return emptyEligibleExamTraineeListView();
  }
  return Object.freeze({
    trainees: Object.freeze([...rows].sort(byDisplayNameThenId).map(toTraineeOption)),
  });
}

/**
 * Build the stored-assignment list from the rows the IO shell read.
 *
 * EVERY row is published: nothing is filtered by role, by trainee activity, by
 * enrolment or by anything else. A row with no linked trainee keeps its place
 * under the fixed placeholder.
 *
 * The input array is COPIED before it is sorted and no input row object is ever
 * published, so a frozen input is accepted and an unfrozen one is left
 * untouched.
 *
 * Never throws.
 */
export function buildAdminExamAssignmentListView(
  rows: readonly StoredAdminExamAssignmentRow[],
): AdminExamAssignmentListView {
  if (rows.length === 0) {
    return emptyAdminExamAssignmentListView();
  }
  return Object.freeze({
    assignments: Object.freeze(
      [...rows].sort(bySessionThenPositionThenId).map(toAssignmentRow),
    ),
  });
}
