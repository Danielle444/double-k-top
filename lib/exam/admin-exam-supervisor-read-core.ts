/**
 * EXAM EX-SUP-IO1 — the PURE read shaping behind the two ADMIN supervisor reads:
 * the ELIGIBLE-INSTRUCTOR picker, and the STORED-SUPERVISOR list.
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
 *  - what is shown for a stored supervisor whose instructor name is unreadable?
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it PERFORMS NO IO and knows nothing of a row, a query, a plan, a session, a
 *    course offering or an actor. Both builders are plain functions over plain
 *    data;
 *  - it AUTHORIZES NOTHING and GATES NOTHING. There is no admin check, no
 *    offering boundary and no lifecycle gate here — the IO shell owns all three,
 *    and holding a view built by this module grants NOTHING;
 *  - it DECIDES NO ELIGIBILITY. WHO may supervise is answered entirely by the
 *    query the IO shell runs; this module neither re-checks nor re-filters it;
 *  - it ORDERS NOTHING IN THE DOMAIN SENSE. The supervisors of a session are an
 *    unordered SET with no position column, so there is no stored sequence to
 *    publish, preserve or renumber. The total order below is a DISPLAY order and
 *    nothing more;
 *  - it MODELS NO ROLE, TIER OR RESPONSIBILITY. A stored supervisor row is the
 *    pair and its own key; there is no field here for a kind, a tier, a primary
 *    marker or a responsibility marker, so none can arrive;
 *  - it CARRIES NO EVALUATION OF ANY KIND. The Exams area models none at all,
 *    and no type in this file has a field for one;
 *  - it INVENTS NO REFUSAL. There is no not-found, denied or invalid code
 *    anywhere: a denial is a THROW the IO shell propagates, and turning one into
 *    an empty list would say "there is nothing here" when the truth is "you may
 *    not see this".
 *
 * ===========================================================================
 * THE TWO LISTS ARE DIFFERENT QUESTIONS, AND THEIR SCOPES DIFFER ON PURPOSE
 * ===========================================================================
 * The ELIGIBLE-INSTRUCTOR list answers "who may I record RIGHT NOW?". Its rows
 * are produced by the IO shell from CURRENTLY ACTIVE instructors, because
 * offering somebody the write path would refuse is offering a dead choice.
 *
 * The STORED-SUPERVISOR list answers "who IS recorded?". It is HISTORY, and it
 * must stay readable even after an instructor is deactivated. Nothing in this
 * module re-checks eligibility on the stored path — there is no field carrying
 * activity for it to check — so a historical row cannot silently vanish from a
 * manager's screen because of a later staffing change.
 *
 * ===========================================================================
 * AN UNREADABLE NAME IS NAMED, NOT DROPPED AND NOT INVENTED
 * ===========================================================================
 * The stored supervisor's instructor relation is REQUIRED in the schema, so a
 * row without a readable name should not occur. The defence is kept anyway: a
 * non-string, `null`, `undefined`, an empty string and a whitespace-only string
 * all resolve to ONE fixed, non-personal Hebrew placeholder,
 * {@link UNNAMED_EXAM_SUPERVISOR_NAME}.
 *
 * A blank line in a staffing list is indistinguishable from a rendering defect,
 * and the placeholder says plainly what is true. It is a CONSTANT, never a
 * derived or partial value: no id, no fragment of a name and no "unknown #2"
 * counter, because each of those would be a fabricated identity a manager might
 * act on. Dropping the row instead would be worse still — the person would
 * disappear from the list while continuing to be recorded on the session.
 *
 * ===========================================================================
 * WHAT NEITHER VIEW MAY CARRY
 * ===========================================================================
 * NO `Instructor.id` appears in the STORED supervisor DTO. The list is a display
 * of who is recorded; the id is a handle for acting on a person, the removal
 * path already identifies its target by the SUPERVISOR id, and an id that is
 * never published cannot be replayed into a write. The eligible-instructor
 * OPTION does carry an `instructorId`, because it exists precisely to be
 * submitted back as the create's chosen instructor.
 *
 * And NEITHER view carries: an identity number, a phone number, an email
 * address, an address, an activity flag, any `canXxx` permission column, a
 * course offering id, a plan id or a timestamp. None of them is filtered out —
 * none has a field in any type here, so none can arrive.
 *
 * ===========================================================================
 * DUPLICATE DISPLAY NAMES ARE TWO PEOPLE
 * ===========================================================================
 * Nothing here deduplicates, merges or collapses rows. Two instructors may
 * legitimately share a full name, and two stored rows may legitimately show the
 * same name on different sessions. Collapsing either would hide a real person
 * from a manager and make one of them unreachable.
 *
 * ===========================================================================
 * DETERMINISTIC TOTAL ORDERS, RE-IMPOSED RATHER THAN TRUSTED
 * ===========================================================================
 * The IO shell orders both queries in the database. This module SORTS AGAIN
 * anyway, on a COPY, and its order is the authoritative one:
 *
 *   eligible instructors — fullName, then instructorId
 *   stored supervisors   — sessionId, then instructorName, then supervisorId
 *
 * Both end in a UNIQUE key, so both are TOTAL: two instructors who share a
 * display name still have a stable relative position, and so do two stored rows
 * on one session.
 *
 * The stored order compares the RESOLVED display name — the same string the row
 * publishes — so what a reader sees sorted is what a reader sees. With the
 * required relation the resolved name is simply the stored one; only the
 * defensive placeholder case could differ, and sorting on a value the row does
 * not show would look like a defect.
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
 * Every published value is a plain object, array or string. Nothing is a `Date`,
 * `Map`, `Set`, `BigInt`, `Error` or class instance, and no property is
 * present-but-`undefined`, so `JSON.parse(JSON.stringify(view))` deep-equals the
 * view itself and the result crosses a server/client boundary unchanged.
 *
 * The freezing is DEEP: the view, its array and every row in it. A shallow
 * freeze would leave a consumer free to rewrite an instructor's name in place,
 * and a shared frozen empty array is safe precisely because it is immutable.
 */

// ===========================================================================
// The fixed placeholder
// ===========================================================================

/**
 * The ONE name shown for a stored supervisor whose instructor name is
 * unreadable.
 *
 * Exported so a caller — and this slice's own suite — can name the exact string
 * rather than re-spelling Hebrew text and hoping it matches. It is deliberately
 * NOT a personal identifier of any kind.
 */
export const UNNAMED_EXAM_SUPERVISOR_NAME = "מדריך ללא שם";

// ===========================================================================
// The eligible-instructor list
// ===========================================================================

/**
 * One eligible instructor, as the IO shell reads them.
 *
 * TWO fields. There is no identity number, no phone, no email, no activity flag
 * and no permission column — the activity condition is a WHERE clause in the IO
 * shell, not data this module inspects, so a value it cannot see is a value it
 * cannot leak.
 */
export interface StoredEligibleExamSupervisorRow {
  readonly instructorId: string;
  readonly fullName: string;
}

/**
 * ONE option in the create form's instructor picker.
 *
 * The id IS published here, and only here: this option exists to be submitted
 * back as the chosen instructor, and the write path verifies it again under the
 * server-verified offering before it reaches a row.
 */
export interface EligibleExamSupervisorOption {
  readonly instructorId: string;
  readonly fullName: string;
}

/**
 * The whole picker.
 *
 * A single named field rather than a bare array, so a caller that renders it
 * cannot confuse it with the stored list, and so a later addition to this view
 * is not a breaking change to everyone destructuring it.
 */
export interface EligibleExamSupervisorListView {
  readonly instructors: readonly EligibleExamSupervisorOption[];
}

// ===========================================================================
// The stored-supervisor list
// ===========================================================================

/**
 * One stored supervisor, as the IO shell reads it.
 *
 * `instructorName` is NULLABLE here and NOT null in the published DTO: the
 * unreadable name is resolved to the fixed placeholder exactly once, in this
 * module, so no consumer has to decide what to render for it.
 *
 * Note what has NO field and therefore cannot arrive: `Instructor.id`, the
 * identity number, the phone, the email, the activity flag, every `canXxx`
 * permission column, `planId`, `courseOfferingId` and `createdAt`.
 */
export interface StoredAdminExamSupervisorRow {
  readonly supervisorId: string;
  readonly sessionId: string;
  readonly instructorName: string | null | undefined;
}

/**
 * ONE published supervisor line.
 *
 * `instructorName` is always a non-empty string — either the stored name,
 * carried VERBATIM, or the fixed placeholder.
 *
 * There is deliberately no `instructorId`, and no field for anything the
 * header's exclusion list names.
 */
export interface AdminExamSupervisorRow {
  readonly supervisorId: string;
  readonly sessionId: string;
  readonly instructorName: string;
}

/** The whole stored list, for the same reason the picker is wrapped. */
export interface AdminExamSupervisorListView {
  readonly supervisors: readonly AdminExamSupervisorRow[];
}

// ===========================================================================
// The shared empty views
// ===========================================================================

/**
 * The two shared frozen empty arrays. Handing out ONE immutable empty array is
 * safe precisely because nothing can append to it, and it means an empty answer
 * is the SAME shape every time rather than a fresh object per call.
 */
const NO_INSTRUCTORS: readonly EligibleExamSupervisorOption[] = Object.freeze([]);
const NO_SUPERVISORS: readonly AdminExamSupervisorRow[] = Object.freeze([]);

/**
 * The picker of a course offering with nobody eligible.
 *
 * This is an honest ABSENCE, never a refusal: an authorized admin looking at a
 * database whose instructors have all been deactivated gets this.
 */
export function emptyEligibleExamSupervisorListView(): EligibleExamSupervisorListView {
  return Object.freeze({ instructors: NO_INSTRUCTORS });
}

/**
 * The stored list of a course offering with no exam plan, or with a plan nobody
 * is recorded under. Both are the same honest absence.
 */
export function emptyAdminExamSupervisorListView(): AdminExamSupervisorListView {
  return Object.freeze({ supervisors: NO_SUPERVISORS });
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
 * The instructor's display name, or the ONE fixed placeholder.
 *
 * A non-string, an empty string and a whitespace-only string are all treated as
 * "no readable name". The trim is used ONLY to answer that question — a name
 * that survives it is carried byte-for-byte, untrimmed, so what was stored is
 * what is shown.
 *
 * The schema makes the instructor relation REQUIRED, so this is defensive
 * rather than reachable; it exists so a future relation change, a partial
 * projection or a defective mapper degrades into a visible, honest row instead
 * of a blank one.
 */
function toSupervisorName(value: string | null | undefined): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return UNNAMED_EXAM_SUPERVISOR_NAME;
  }
  return value;
}

// ===========================================================================
// The locked total orders
// ===========================================================================

/**
 * The picker's order: DISPLAY NAME, then the instructor id.
 *
 * The name is what a manager scans for, so it leads. The id tie-break is not
 * decoration: two instructors may legitimately share a full name, and without it
 * their relative position would depend on the input order — which would make the
 * two adjacent, identical-looking options swap places between reads and invite
 * the wrong one to be picked.
 */
function byDisplayNameThenId(
  left: StoredEligibleExamSupervisorRow,
  right: StoredEligibleExamSupervisorRow,
): number {
  const byName = compareText(left.fullName, right.fullName);
  if (byName !== 0) {
    return byName;
  }
  return compareText(left.instructorId, right.instructorId);
}

/**
 * The stored order: SESSION, then the RESOLVED display name, then the supervisor
 * id.
 *
 * Grouping by session first is what lets a consumer render the list as sessions
 * without re-sorting. The name is the only human-meaningful value on the row —
 * there is no stored sequence to honour, because the supervisors of a session
 * are a SET. The id tie-break makes this a TOTAL order rather than a nearly-total
 * one, so two rows sharing a session and a name keep a stable relative position
 * between two identical reads.
 */
function bySessionThenNameThenId(
  left: StoredAdminExamSupervisorRow,
  right: StoredAdminExamSupervisorRow,
): number {
  const bySession = compareText(left.sessionId, right.sessionId);
  if (bySession !== 0) {
    return bySession;
  }
  const byName = compareText(
    toSupervisorName(left.instructorName),
    toSupervisorName(right.instructorName),
  );
  if (byName !== 0) {
    return byName;
  }
  return compareText(left.supervisorId, right.supervisorId);
}

// ===========================================================================
// The projections
// ===========================================================================

/** One frozen picker option. The name is carried VERBATIM. */
function toSupervisorOption(
  row: StoredEligibleExamSupervisorRow,
): EligibleExamSupervisorOption {
  return Object.freeze({
    instructorId: row.instructorId,
    fullName: row.fullName,
  });
}

/**
 * One frozen stored line.
 *
 * THREE keys, and no `instructorId` among them: a published id is a handle for
 * acting on a person, and this list only displays.
 */
function toSupervisorRow(row: StoredAdminExamSupervisorRow): AdminExamSupervisorRow {
  return Object.freeze({
    supervisorId: row.supervisorId,
    sessionId: row.sessionId,
    instructorName: toSupervisorName(row.instructorName),
  });
}

// ===========================================================================
// The builders
// ===========================================================================

/**
 * Build the create form's instructor picker from the rows the IO shell read.
 *
 * WHO is eligible was decided by the query; this function neither re-checks nor
 * re-filters it. What it owns is the TOTAL ORDER, the narrow published shape and
 * the deep freeze.
 *
 * The input array is COPIED before it is sorted and no input row object is ever
 * published, so a frozen input is accepted and an unfrozen one is left
 * untouched. Duplicate display names are PRESERVED as separate options — two
 * instructors with the same name are two people, and collapsing them would make
 * one of them unrecordable.
 *
 * Never throws.
 */
export function buildEligibleExamSupervisorListView(
  rows: readonly StoredEligibleExamSupervisorRow[],
): EligibleExamSupervisorListView {
  if (rows.length === 0) {
    return emptyEligibleExamSupervisorListView();
  }
  return Object.freeze({
    instructors: Object.freeze(
      [...rows].sort(byDisplayNameThenId).map(toSupervisorOption),
    ),
  });
}

/**
 * Build the stored-supervisor list from the rows the IO shell read.
 *
 * EVERY row is published: nothing is filtered by activity, by current
 * eligibility, by course assignment or by anything else. A row whose name cannot
 * be read keeps its place under the fixed placeholder, and duplicate names stay
 * separate rows.
 *
 * The input array is COPIED before it is sorted and no input row object is ever
 * published, so a frozen input is accepted and an unfrozen one is left
 * untouched.
 *
 * Never throws.
 */
export function buildAdminExamSupervisorListView(
  rows: readonly StoredAdminExamSupervisorRow[],
): AdminExamSupervisorListView {
  if (rows.length === 0) {
    return emptyAdminExamSupervisorListView();
  }
  return Object.freeze({
    supervisors: Object.freeze(
      [...rows].sort(bySessionThenNameThenId).map(toSupervisorRow),
    ),
  });
}
