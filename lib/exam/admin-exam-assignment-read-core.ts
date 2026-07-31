/**
 * EXAM EX-ASG-IO1 + EXAM EX-PAIR-UI-MVP — the PURE read shaping behind the two
 * ADMIN assignment reads: the ELIGIBLE-TRAINEE picker, and the STORED-ASSIGNMENT
 * list.
 *
 * PURE by construction: no database client, no transaction, no clock, no
 * randomness, no environment, no auth/session/cookie, no capability, no
 * filesystem, no network, no Next, no `server-only`, no `"use server"`. Every
 * export is a total, deterministic function of its arguments and never mutates
 * its inputs.
 *
 * EX-PAIR-UI-MVP narrows the "NO IMPORTS AT ALL" property this module used to
 * hold to EXACTLY ONE import, and to one that cannot cost it any of the above:
 * the committed, equally pure SIBLING core that owns the pairing rule. Restating
 * that rule here instead would give the manager's screen a second, drifting copy
 * of the decision the operational readers already make — which is precisely the
 * failure mode "one rule, one place" exists to prevent. Everything the purity
 * guards below actually protect is asserted unchanged.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in what TOTAL order are the two lists presented, and what exactly may each
 *    published row contain?
 *  - what does "nothing to show" look like, so an empty answer is a shape rather
 *    than a special case every caller re-invents?
 *  - what is shown for a stored assignment whose trainee link is absent?
 *  - WHICH EXAMINEE, if any, is each instructed trainee currently paired with —
 *    answered by the committed pairing rule and never by array position?
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
 *
 * ===========================================================================
 * EX-PAIR-UI-MVP — THE PAIRING IS RESOLVED, AND THE INDEX IS NOT PUBLISHED
 * ===========================================================================
 * The stored INPUT row now carries `pairingIndex`, because deciding who is
 * paired with whom is impossible without it. The PUBLISHED row does NOT, and
 * must never: the index is an internal allocation label, it means nothing to a
 * manager, and a surface that received it would be free to invent a pairing from
 * it. What is published instead is the ANSWER — the paired examinee's assignment
 * id, and that examinee's display name — for INSTRUCTED_TRAINEE rows and for no
 * other role.
 *
 * The answer comes from the committed sibling pairing rule, applied ONE SESSION
 * AT A TIME, so an examinee of another session can never be resolved as a
 * partner. That rule already fails closed exactly where this surface must:
 *
 *   - an index shared by two examinees of the session identifies neither;
 *   - an index matching no examinee of the session resolves to nothing, EVEN in
 *     a session holding exactly one examinee — a stated-but-unmatched pairing is
 *     a fault to be surfaced, not an invitation to guess;
 *   - NO stated index resolves to nothing UNLESS the session holds exactly one
 *     examinee, which is the single unambiguous fallback.
 *
 * This module adds ONE fail-closed condition of its own on top, deliberately
 * rather than trusting the caller: a resolved id is published only if it belongs
 * to a row THIS LIST holds, that row is an EXAMINEE, and it is in the SAME
 * session. Nothing is ever resolved by name, by order position or by array
 * index, and a row of any other role publishes `null` for both fields.
 */

// ===========================================================================
// The one import: the committed pairing rule, shared rather than restated
// ===========================================================================
import { resolveExamPairings } from "./exam-block-timetable-core";

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
 * `pairingIndex` is EX-PAIR-UI-MVP's one addition, and it is an INPUT ONLY. It
 * is the internal allocation label the pairing rule reads, it is consumed here,
 * and it appears in NO published type in this module — see the header.
 *
 * Note what still has NO field and therefore cannot arrive: `Student.id`, the
 * identity number, the phone, any parent or guardian detail, the group, the
 * source practice role, the notes, `planId`, `courseOfferingId`, `createdAt` and
 * `updatedAt`.
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
  readonly pairingIndex: number | null;
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
 * `pairedExamineeAssignmentId` and `pairedExamineeName` are EX-PAIR-UI-MVP's two
 * additions. Both are `null` on every EXAMINEE row and on every instructed
 * trainee whose pairing does not resolve UNAMBIGUOUSLY — see the header for the
 * exact conditions. The id is published because the admin pairing control must
 * be able to pre-select the CURRENT partner without deriving it from array
 * position; the name is published so that control can say who that is without a
 * second lookup. The `pairingIndex` behind them is NOT published.
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
  readonly pairedExamineeAssignmentId: string | null;
  readonly pairedExamineeName: string | null;
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

// ===========================================================================
// EX-PAIR-UI-MVP — the pairing answer
// ===========================================================================

/** The two published pairing fields of ONE row, resolved together. */
interface ResolvedPairing {
  readonly pairedExamineeAssignmentId: string | null;
  readonly pairedExamineeName: string | null;
}

/**
 * The ONE frozen "no partner" answer.
 *
 * Shared rather than rebuilt per row, and it is what EVERY row starts from: an
 * examinee, an unrecognized role, an unresolved pairing and a resolved id that
 * names no row of this list all end here. Nothing is ever guessed.
 */
const NO_PAIRING: ResolvedPairing = Object.freeze({
  pairedExamineeAssignmentId: null,
  pairedExamineeName: null,
});

/** One row, reduced to what the committed pairing rule is entitled to see. */
interface PairingCandidate {
  readonly assignmentId: string;
  readonly pairingIndex: number | null;
}

/** Remember one EXAMINEE display name UNDER ITS OWN SESSION. */
function rememberExamineeName(
  namesBySession: Map<string, Map<string, string>>,
  sessionId: string,
  assignmentId: string,
  displayName: string,
): void {
  const names = namesBySession.get(sessionId);
  if (names === undefined) {
    namesBySession.set(sessionId, new Map([[assignmentId, displayName]]));
    return;
  }
  names.set(assignmentId, displayName);
}

/** Append one candidate to its session's bucket, creating the bucket once. */
function bucket(
  buckets: Map<string, PairingCandidate[]>,
  sessionId: string,
  candidate: PairingCandidate,
): void {
  const existing = buckets.get(sessionId);
  if (existing === undefined) {
    buckets.set(sessionId, [candidate]);
    return;
  }
  existing.push(candidate);
}

/**
 * WHICH EXAMINEE each instructed trainee is paired with, keyed by the instructed
 * trainee's own assignment id.
 *
 * The decision itself is NOT made here: it is the committed sibling rule, asked
 * ONCE PER SESSION with that session's own examinees and instructed trainees, so
 * an examinee of another session is not merely filtered out — it is never
 * offered to the rule at all. Every fail-closed case the rule owns (a duplicated
 * index, an unmatched index, an absent index in a session with more than one
 * examinee) simply yields no entry here, and a row with no entry publishes
 * {@link NO_PAIRING}.
 *
 * What IS decided here is the one extra condition this list can check and the
 * rule cannot: the resolved partner must be a row of THIS list, an EXAMINEE, and
 * in the SAME session. That is asserted by the NAME LOOKUP, which is nested one
 * map per session rather than flattened onto a composite key — so "the same
 * session" is a property of the structure and needs no separator character that
 * an id is merely assumed never to contain. A miss fails closed rather than
 * publishing an id with no name.
 *
 * Never throws, and never mutates the input rows.
 */
function resolvePairings(
  rows: readonly StoredAdminExamAssignmentRow[],
): ReadonlyMap<string, ResolvedPairing> {
  const examineesBySession = new Map<string, PairingCandidate[]>();
  const instructedBySession = new Map<string, PairingCandidate[]>();
  const examineeNamesBySession = new Map<string, Map<string, string>>();

  for (const row of rows) {
    const candidate: PairingCandidate = {
      assignmentId: row.assignmentId,
      pairingIndex: row.pairingIndex,
    };
    if (row.role === "EXAMINEE") {
      bucket(examineesBySession, row.sessionId, candidate);
      rememberExamineeName(
        examineeNamesBySession,
        row.sessionId,
        row.assignmentId,
        toTraineeName(row.traineeName),
      );
      continue;
    }
    if (row.role === "INSTRUCTED_TRAINEE") {
      bucket(instructedBySession, row.sessionId, candidate);
    }
  }

  const resolved = new Map<string, ResolvedPairing>();
  for (const [sessionId, instructed] of instructedBySession) {
    const examinees = examineesBySession.get(sessionId) ?? [];
    const pairing = resolveExamPairings(examinees, instructed);
    for (const [instructedAssignmentId, examineeAssignmentId] of pairing.examineeOfInstructedTrainee) {
      const name = examineeNamesBySession.get(sessionId)?.get(examineeAssignmentId);
      if (name === undefined) {
        continue;
      }
      resolved.set(
        instructedAssignmentId,
        Object.freeze({
          pairedExamineeAssignmentId: examineeAssignmentId,
          pairedExamineeName: name,
        }),
      );
    }
  }
  return resolved;
}

/**
 * The pairing answer for ONE row.
 *
 * ROLE-GATED, and gated the strict way round: only an `INSTRUCTED_TRAINEE` may
 * carry a partner. An examinee's partners are the trainees pointing AT it, which
 * is a different question with a different cardinality, and answering it in this
 * field would make one row's `pairedExamineeAssignmentId` mean two things.
 */
function pairingOf(
  resolved: ReadonlyMap<string, ResolvedPairing>,
  row: StoredAdminExamAssignmentRow,
): ResolvedPairing {
  if (row.role !== "INSTRUCTED_TRAINEE") {
    return NO_PAIRING;
  }
  return resolved.get(row.assignmentId) ?? NO_PAIRING;
}

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
 *
 * The PAIRING is the one field that is not shaped from this row alone — it is a
 * relationship, so it arrives already resolved from the whole list. `pairingIndex`
 * is READ by that resolution and is deliberately NOT copied here: the published
 * row carries the answer, never the internal label it was derived from.
 */
function toAssignmentRow(
  row: StoredAdminExamAssignmentRow,
  pairing: ResolvedPairing,
): AdminExamAssignmentRow {
  return Object.freeze({
    assignmentId: row.assignmentId,
    sessionId: row.sessionId,
    role: row.role,
    traineeName: toTraineeName(row.traineeName),
    horseName: toOptionalText(row.horseName),
    instructionTopic: toOptionalText(row.instructionTopic),
    discipline: toOptionalText(row.discipline),
    orderIndex: toOrderIndex(row.orderIndex),
    pairedExamineeAssignmentId: pairing.pairedExamineeAssignmentId,
    pairedExamineeName: pairing.pairedExamineeName,
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
  // The pairing is resolved over the WHOLE list first, and over the UNSORTED
  // input: it is a relationship between rows rather than a property of one, and
  // it must not depend on the presentation order this function then imposes.
  const pairings = resolvePairings(rows);
  return Object.freeze({
    assignments: Object.freeze(
      [...rows]
        .sort(bySessionThenPositionThenId)
        .map((row) => toAssignmentRow(row, pairingOf(pairings, row))),
    ),
  });
}
