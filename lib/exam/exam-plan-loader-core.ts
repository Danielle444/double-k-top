/**
 * EXAM EX-S5A-3 — PURE exam-plan loader core (dependency injection).
 *
 * PURE by construction: no database client, no generated database type, no DB,
 * no Next, no React, no clock (`Date.now` / `new Date`), no randomness, no env,
 * no auth/session/cookie, no filesystem, no network, no `"use server"`.
 * Deterministic; never mutates its inputs; never throws for malformed runtime
 * input; every returned value is frozen. Every database effect arrives as a
 * NARROW INJECTED FUNCTION (see {@link ExamPlanLoadDeps}), so the whole load
 * order is unit-testable with plain fakes and no database. The thin real
 * bindings live in `lib/actions/exam-read-io.ts`.
 *
 * WHAT THIS ANSWERS (and only this): given ONE server-validated
 * `courseOfferingId`, what is the plan's complete ROLE-NEUTRAL read payload?
 *
 *   - `sessions`         — ONE flat, deterministically ordered array holding the
 *                          stored blocks (EX-S5A-1) and the live beginner rows
 *                          (EX-C2-0) together;
 *   - `storedDetails`    — the sibling stored slot lookup, keyed by `sessionId`;
 *   - `storedAssignmentDetails`
 *                        — the sibling ASSIGNMENT-LEVEL operational lookup
 *                          (role, horse, topic, discipline, personal time and
 *                          resolved pairing), also keyed by `sessionId`;
 *   - `beginnerDetails`  — the sibling live beginner lookup, keyed by the
 *                          synthetic `tp:` session id the committed live adapter
 *                          generated — never one re-derived here;
 *   - `conflictSessions` — the structural conflict INPUT of the stored blocks;
 *   - `sourceDates`      — the plan's explicit Teaching-Practice source dates;
 *   - `diagnostics`      — every fail-closed reason behind all of the above.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 *  - NO ROLE, capability, enrollment or actor logic of any kind. This loader
 *    knows nothing about who is asking; it takes a `courseOfferingId` its caller
 *    has ALREADY validated server-side. Admin / instructor / trainee wrappers,
 *    and the trainee DTO narrowing, are EX-S5A-4.
 *  - NO client-facing shaping of any kind: no DTO, no narrowing, no redaction.
 *    See the INTERNAL-ONLY warning below — this payload is not safe to return.
 *  - NO query shape, no select, no ORM anything — see the deps contract.
 *  - NO timetable, slot, definition, practice-type, synthetic-id or projection
 *    arithmetic. Every derived value comes from a committed core. Re-deriving
 *    one here would create the second source of truth the module exists to
 *    prevent.
 *  - NO conflict DETECTION. This loader assembles the conflict INPUT; running
 *    `detectExamConflicts` is a caller's decision, because which conflicts are
 *    worth surfacing is role-specific.
 *  - NO feedback, rating, grade, score or result — not nulled, not optional:
 *    ABSENT, in this payload and in the narrow selects the IO shell uses, so
 *    nothing of the kind ever leaves the database.
 *
 * ===========================================================================
 * ExamPlanPayload IS INTERNAL-ONLY AND SENSITIVE — NEVER RETURN IT TO A CLIENT
 * ===========================================================================
 * {@link ExamPlanPayload} is the ROLE-NEUTRAL SUPERSET. It deliberately carries
 * more than ANY single viewer may see: every assigned student id (including
 * other people's), every live beginner participant, and the children's names,
 * ages, genders, notes and PARENT CONTACT NUMBERS. It must NEVER be returned
 * from a Server Action, a Server Component, a route handler or an API response,
 * and must never be embedded in props that reach the browser.
 *
 * THE PRIVACY BOUNDARY IS THE EX-S5A-4 SERVER-SIDE, ROLE-SPECIFIC DTO
 * NARROWING, AND NOTHING ELSE. Every public caller must pass this payload
 * through that layer, which decides — per resolved actor — which rows, which
 * details and which fields exist at all in what it returns.
 *
 * NOTHING IN THIS FILE IS THAT BOUNDARY. In particular:
 *
 *  - `readonly`, `ReadonlyMap` and `Object.freeze` protect against ACCIDENTAL
 *    MUTATION and nothing else. They are erased or shallow at runtime, they
 *    perform no authorization, they filter no field, and they neither prevent
 *    nor detect a value crossing a network boundary. A caller may copy, spread,
 *    cast or enumerate any of it freely, and a framework may serialize whatever
 *    it is handed;
 *  - the type of a field is not a permission. `ReadonlyMap` was chosen because a
 *    lookup is the right shape for a sibling detail payload, NOT as a barrier —
 *    reading it as one would be the exact mistake this note exists to prevent;
 *  - the publication options gate CONTENT, not AUDIENCE. `requirePlanPublication`
 *    and `requireLessonPublication` are supplied BY the caller; they prove
 *    nothing about who the caller is.
 *
 * ===========================================================================
 * PLAN-FIRST — A HARD ORDERING CONTRACT
 * ===========================================================================
 * The identity/publication row is fetched FIRST and ALONE:
 *
 *   1. normalize `courseOfferingId`; blank ⇒ empty payload, ZERO dep calls;
 *   2. `fetchPlanByCourseOfferingId` — exactly once;
 *   3. no plan ⇒ empty payload;
 *   4. `requirePlanPublication` and no `publishedAt` ⇒ empty payload;
 *   5. only now: definitions + sessions + source dates (in parallel);
 *   6. Teaching-Practice lessons ONLY when the explicit source-date list is
 *      non-empty.
 *
 * Steps 5–6 are UNREACHABLE until the publication decision has been taken, so an
 * unpublished plan cannot leak content through a fetch that "was already in
 * flight". That is why the publication gate is an option on the loader rather
 * than a filter applied to a payload that has already been assembled.
 *
 * `requirePlanPublication: false` is the ADMIN/INSTRUCTOR reading and is NEVER
 * self-selected: the wrapper that supplies it is the thing that has proven the
 * caller may see unpublished work.
 *
 * ===========================================================================
 * courseOfferingId IS THE ONLY INPUT — planId IS NEVER A PARAMETER
 * ===========================================================================
 * A caller CANNOT supply a plan id: {@link ExamPlanLoadInput} has no such field,
 * so a cross-course read is unrepresentable rather than merely forbidden. Every
 * downstream dependency receives ONLY the `plan.id` that `fetchPlan` itself
 * returned for the caller's offering. A plan id arriving on the input object at
 * runtime is ignored — it addresses nothing.
 *
 * ===========================================================================
 * TEACHING PRACTICE — EXPLICIT DATES, LIVE ROWS
 * ===========================================================================
 * ONLY the plan's stored `ExamTeachingPracticeSourceDate` values select beginner
 * lessons. No date is EVER inferred — not from the offering's own date range,
 * not from its level, name or groups, not from enrollments, and not from the
 * dates the projected sessions happen to fall on. An empty source-date list
 * means the Teaching-Practice dependency is NOT CALLED AT ALL, which is the
 * fail-closed reading of "this plan selected no beginner dates".
 *
 * Beginner rows are a LIVE PROJECTION: nothing is copied, snapshotted,
 * fingerprinted or cached, and this core performs no IO so it cannot write back
 * to Teaching Practice even in principle.
 *
 * STRUCTURAL LIMITATION, STATED PLAINLY. `TeachingPracticeLesson` has NO
 * `courseOfferingId`: a lesson is not course-scoped in the database at all. The
 * ONLY thing binding a lesson to this plan is therefore the plan's own explicit
 * source-date selection, which is exactly why inferring dates would be unsound —
 * an inferred date would silently attach another course's lessons to this plan
 * with nothing in the schema to contradict it. A later slice that needs a
 * stronger binding must add it as data, not as a heuristic here.
 *
 * WHAT THAT MEANS FOR SHIPPING. EX-S5A-3 is UNWIRED INFRASTRUCTURE and may be
 * committed as such: nothing calls it, so it exposes nothing. EX-S5A-4 MUST NOT
 * BE DEPLOYED for two or more offerings whose plans can select the SAME source
 * date without a SEPARATE, REVIEWED CONTAINMENT DECISION first — on that date
 * both plans would read the same lessons, so one course's trainees, children and
 * parent contacts would appear under the other's exam plan. Whether the answer
 * is a schema-level course binding, a per-plan lesson allow-list or a product
 * rule that source dates may not be shared is exactly the decision that review
 * must take; it is NOT settled here, and no code in this slice may be read as
 * having settled it.
 *
 * ===========================================================================
 * LESSON PUBLICATION IS AN OPTION, NOT A ROLE
 * ===========================================================================
 * `requireLessonPublication` excludes unpublished Teaching-Practice lessons
 * BEFORE they are projected, so an excluded lesson contributes no session, no
 * detail and no conflict input — there is nothing to strip afterwards and no
 * filtered remnant anywhere in the payload. It is a loader OPTION: no role enum
 * exists here, and this core never decides which value a caller gets.
 */
import type {
  StoredExamAdapterIssue,
  StoredExamBlockComposition,
  StoredExamBlockOperationalDetail,
  StoredExamDefinitionRow,
  StoredExamSessionRow,
} from "./exam-stored-adapter-core";
import {
  buildStoredExamBlockDetailLookup,
  buildStoredExamBlockOperationalLookup,
  composeStoredExamBlocks,
} from "./exam-stored-adapter-core";
import type {
  TeachingPracticeExamLessonRow,
  TeachingPracticeSourceAdapterIssue,
} from "./exam-tp-source-adapter-core";
import { adaptTeachingPracticeExamSources } from "./exam-tp-source-adapter-core";
import type {
  BeginnerDetail,
  LiveBeginnerLessonSource,
  LiveBeginnerRejection,
} from "./exam-live-beginner-adapter-core";
import { projectLiveBeginnerRows } from "./exam-live-beginner-adapter-core";
import type { ProjectionSession } from "./exam-schedule-projection-core";
import type { StoredExamBlockDetail } from "./exam-trainee-view-core";
import type { ConflictSession } from "./exam-conflict-core";
import type { ExamTimetableIssue, ExamTimetableWarning } from "./exam-block-timetable-core";
import type { ExamDefinitionIssue } from "./exam-definition-validation-core";

// ===========================================================================
// Loader issue codes + Hebrew messages
// ===========================================================================

/**
 * Stable, non-PII LOADER issue codes. The code STRINGS are the contract and must
 * not be renamed once consumed downstream.
 *
 * These describe defects THIS LOADER observes while binding injected rows to the
 * committed adapters. They deliberately do NOT duplicate the codes the adapters
 * own: stored-row defects stay `EX-ADP-*`, Teaching-Practice source defects stay
 * `EX-TP-ADP-*`, timetable failures stay `EX-CALC-*` and definition conformance
 * stays `EX-DEF-*`. A code exists here only for a state no committed core can
 * see.
 */
export type ExamPlanLoaderIssueCode =
  /** The caller supplied no legible `courseOfferingId`; nothing was fetched. */
  | "EX-LOAD-COURSE-OFFERING-ID-REQUIRED"
  /** The identity row carried no legible plan id, so nothing can be keyed to it. */
  | "EX-LOAD-PLAN-ID-INVALID"
  /** A source-date row is not a `YYYY-MM-DD` token; it selects no lessons. */
  | "EX-LOAD-SOURCE-DATE-INVALID"
  /** Two live beginner rows claim ONE synthetic session id; identity is undecidable. */
  | "EX-LOAD-BEGINNER-SESSION-DUPLICATE"
  /** A live row's detail and its session disagree about the session id. */
  | "EX-LOAD-BEGINNER-DETAIL-CONFLICT";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<ExamPlanLoaderIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 */
export const EXAM_PLAN_LOADER_MESSAGES: Readonly<
  Record<ExamPlanLoaderIssueCode, string>
> = Object.freeze({
  "EX-LOAD-COURSE-OFFERING-ID-REQUIRED":
    "לא התקבל מזהה מחזור קורס — לא ניתן לטעון תוכנית בחינות",
  "EX-LOAD-PLAN-ID-INVALID":
    "למזהה תוכנית הבחינות אין ערך תקין — לא ניתן לטעון את תוכן התוכנית",
  "EX-LOAD-SOURCE-DATE-INVALID":
    "תאריך מקור התנסות בתוכנית הבחינות אינו תקין — התאריך אינו נכלל",
  "EX-LOAD-BEGINNER-SESSION-DUPLICATE":
    "אותו מזהה שורת בחינת מתחילים הופיע יותר מפעם אחת — השורות אינן נכללות",
  "EX-LOAD-BEGINNER-DETAIL-CONFLICT":
    "פרטי שורת בחינת מתחילים אינם תואמים למזהה השורה — השורה אינה נכללת",
});

/**
 * One loader issue.
 *
 * Carries ONLY stable identifiers, and never a student id, a trainee name, a
 * child name, a parent name, a phone number, a horse name, a note or a title —
 * the same rule every committed exam core holds itself to. Note in particular
 * that `EX-LOAD-SOURCE-DATE-INVALID` does NOT echo the rejected value back.
 */
export interface ExamPlanLoaderIssue {
  readonly code: ExamPlanLoaderIssueCode;
  readonly message: string;
  readonly sessionId: string | null;
  readonly lessonId: string | null;
}

// ===========================================================================
// Input — PLAIN, transport-neutral rows
// ===========================================================================

/**
 * The plan's IDENTITY AND PUBLICATION row — the first and, for an unpublished
 * plan under a publication requirement, the ONLY thing ever read.
 *
 * `publishedAt` / `updatedAt` are comparable epoch MILLISECONDS (the IO shell
 * converts once), matching the committed publication-core convention. This core
 * accepts no `Date` and constructs none. `updatedAt` is accepted so the row
 * contract is complete for the later slices and is deliberately NOT projected —
 * nothing in this payload is cache-keyed or staleness-compared.
 */
export interface ExamPlanIdentityRow {
  readonly id: string;
  /** Epoch ms, or `null` when the plan has never been published. */
  readonly publishedAt: number | null;
  /** Epoch ms. Accepted, not projected. */
  readonly updatedAt: number;
}

/**
 * One `ExamTeachingPracticeSourceDate` row. It holds a DATE AND NOTHING ELSE —
 * the table itself stores no lesson, participant, child, contact, time or note
 * data, and this contract must never grow one.
 */
export interface ExamPlanSourceDateRow {
  /** Opaque calendar day, `YYYY-MM-DD`. Never a `Date`. */
  readonly date: string;
}

/**
 * The load options.
 *
 * NOT a role, and never derived from one. Both booleans are REQUIRED so a caller
 * must state its intent; at runtime each is read fail-closed (anything that is
 * not literally `false` requires the gate), so a malformed or partially-built
 * options object can only ever be MORE restrictive.
 */
export interface ExamPlanLoadOptions {
  /**
   * When true, an unpublished plan yields the uniform empty payload and NO
   * content dependency is called at all.
   */
  readonly requirePlanPublication: boolean;
  /**
   * When true, an unpublished Teaching-Practice lesson is excluded BEFORE
   * projection, so it contributes no session and no detail. When false, both
   * published and unpublished live rows are carried (they remain distinguishable
   * by `BeginnerDetail.isPublished`).
   */
  readonly requireLessonPublication: boolean;
  /**
   * The viewing trainee's authoritative `Student.id`, resolved by the CALLER
   * from the signed server session — never from a client value and never by
   * name. `null` marks nobody. It is passed to the committed live adapter as the
   * viewer input it already expects, and is used for nothing else here.
   */
  readonly viewerStudentId: string | null;
}

/**
 * The load input. There is deliberately NO `planId` field — see the trust
 * boundary note in the file header.
 */
export interface ExamPlanLoadInput {
  /** A `CourseOffering.id` the CALLER has already validated server-side. */
  readonly courseOfferingId: string;
  readonly options: ExamPlanLoadOptions;
}

/**
 * The injected read dependencies.
 *
 * Each is called AT MOST ONCE per load, never inside a per-session or per-lesson
 * loop, and every content dependency receives ONLY the plan id that
 * `fetchPlanByCourseOfferingId` returned. `fetchTeachingPracticeLessonsByDates`
 * receives EXACTLY the normalized explicit source-date list and is not called at
 * all when that list is empty.
 *
 * The row types are the committed adapter contracts verbatim; nothing is
 * re-declared here that a committed core already owns.
 */
export interface ExamPlanLoadDeps {
  readonly fetchPlanByCourseOfferingId: (
    courseOfferingId: string,
  ) => Promise<ExamPlanIdentityRow | null>;
  readonly fetchDefinitionsByPlanId: (
    planId: string,
  ) => Promise<readonly StoredExamDefinitionRow[]>;
  readonly fetchSessionsByPlanId: (
    planId: string,
  ) => Promise<readonly StoredExamSessionRow[]>;
  readonly fetchSourceDatesByPlanId: (
    planId: string,
  ) => Promise<readonly ExamPlanSourceDateRow[]>;
  readonly fetchTeachingPracticeLessonsByDates: (
    dates: readonly string[],
  ) => Promise<readonly TeachingPracticeExamLessonRow[]>;
}

// ===========================================================================
// Output
// ===========================================================================

/**
 * The per-block diagnostics of ONE stored block that WAS projected.
 *
 * An entry exists only when the block actually has something to report, so an
 * ordinary plan carries an EMPTY array here rather than one silent entry per
 * block. The issues of a session that produced NO block live in
 * {@link ExamReadDiagnostics.storedAdapterIssues} instead, exactly as the
 * committed stored adapter divides them — nothing is reported twice.
 */
export interface StoredExamBlockDiagnostic {
  readonly sessionId: string;
  readonly definitionId: string | null;
  readonly timetableIssues: readonly ExamTimetableIssue[];
  readonly timetableWarnings: readonly ExamTimetableWarning[];
  readonly definitionIssues: readonly ExamDefinitionIssue[];
  readonly adapterIssues: readonly StoredExamAdapterIssue[];
}

/**
 * Every fail-closed reason behind the payload, reusing the committed issue
 * shapes AS-IS. Purely diagnostic: nothing here gates anything, and nothing here
 * carries PII.
 *
 * Grouping and trainee-view diagnostics are ABSENT by design — this loader
 * computes neither projection, so it has none to report.
 */
export interface ExamReadDiagnostics {
  /** `EX-ADP-*` for the definition set and for EXCLUDED stored sessions. */
  readonly storedAdapterIssues: readonly StoredExamAdapterIssue[];
  /** Per-PROJECTED-block timetable / definition / adapter diagnostics. */
  readonly storedBlockDiagnostics: readonly StoredExamBlockDiagnostic[];
  /** `EX-TP-ADP-*` from the Teaching-Practice source adapter. */
  readonly teachingPracticeSourceIssues: readonly TeachingPracticeSourceAdapterIssue[];
  /** Rows the committed live beginner adapter refused to project. */
  readonly beginnerRejections: readonly LiveBeginnerRejection[];
  /** `EX-LOAD-*` — states no committed core can see. */
  readonly loaderIssues: readonly ExamPlanLoaderIssue[];
}

/**
 * The INTERNAL, ROLE-NEUTRAL payload of one exam plan.
 *
 * SENSITIVE AND INTERNAL-ONLY. It is the SUPERSET every viewer's payload is
 * narrowed FROM — it carries other people's student ids and the beginner rows'
 * child and parent-contact detail. It must never be returned to a browser: the
 * only privacy boundary is the EX-S5A-4 server-side, role-specific DTO
 * narrowing. The `readonly` / `ReadonlyMap` / frozen shapes below are MUTATION
 * protection only; see the INTERNAL-ONLY warning in the file header.
 *
 * `sessions` merges stored blocks and live beginner rows into ONE flat array,
 * ordered `date`, `startTime`, `orderIndex`, `sessionId` — the committed
 * projection order — so the result never depends on the order the rows were
 * loaded in. The two DETAIL lookups stay SIBLINGS keyed by `sessionId`: nothing
 * is merged onto `ProjectionSession`, which is unchanged by this slice.
 *
 * `planId` and `publishedAt` are `null` for EVERY empty outcome, including an
 * unpublished plan under a publication requirement — so the payload does not
 * even disclose that a plan exists.
 */
export interface ExamPlanPayload {
  readonly planId: string | null;
  /** Epoch ms, or `null`. */
  readonly publishedAt: number | null;
  readonly sessions: readonly ProjectionSession[];
  /** Stored `sessionId` → its slot detail. Live rows never appear here. */
  readonly storedDetails: ReadonlyMap<string, StoredExamBlockDetail>;
  /**
   * Stored `sessionId` → its ASSIGNMENT-LEVEL operational detail: who is in the
   * block, in which role, on which horse, on which topic and discipline, at
   * which exact personal time, paired with whom.
   *
   * A SECOND SIBLING, not a widening of `storedDetails`: that one answers "what
   * is the viewer's own slot" for the trainee view core and is ABSENT for an
   * unresolved block, while this one answers "what is the whole operational
   * picture of this block" and is PRESENT for an unresolved block with `null`
   * personal times throughout. Live rows never appear in either.
   *
   * SENSITIVE like the rest of this payload: it carries other people's student
   * ids. The DTO narrowing resolves them into display names and drops the ids.
   */
  readonly storedAssignmentDetails: ReadonlyMap<string, StoredExamBlockOperationalDetail>;
  /** Synthetic `tp:` session id → its live detail. Stored rows never appear here. */
  readonly beginnerDetails: ReadonlyMap<string, BeginnerDetail>;
  /**
   * The conflict INPUT of the STORED blocks only. Binding live beginner rows
   * into the conflict input is a later explicit slice — see the note on
   * {@link loadExamPlan}.
   */
  readonly conflictSessions: readonly ConflictSession[];
  /** The plan's explicit source dates, normalized: deduped and ascending. */
  readonly sourceDates: readonly string[];
  readonly diagnostics: ExamReadDiagnostics;
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * A `YYYY-MM-DD` SHAPE check. Not a calendar check — no `Date` is constructed.
 * The sibling exam cores each keep this same private constant; a shared export
 * would mean editing a committed file.
 */
const DATE_TOKEN = /^\d{4}-\d{2}-\d{2}$/;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A non-empty, trimmed identifier; otherwise absent. */
function isPresentId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent/blank. Whitespace is never identity. */
function idOrNull(v: unknown): string | null {
  return isPresentId(v) ? v.trim() : null;
}

/** Build a frozen loader issue, binding its canonical Hebrew message. */
function loaderIssue(
  code: ExamPlanLoaderIssueCode,
  sessionId: string | null = null,
  lessonId: string | null = null,
): ExamPlanLoaderIssue {
  return Object.freeze({
    code,
    message: EXAM_PLAN_LOADER_MESSAGES[code],
    sessionId,
    lessonId,
  });
}

/**
 * Order loader issues on a total, content-only key and drop exact duplicates.
 *
 * Two issues that compare equal here are BYTE-IDENTICAL (the message is a pure
 * function of the code), so collapsing them loses no information — it only keeps
 * forty malformed source-date rows from producing forty identical lines.
 */
function normalizeLoaderIssues(
  issues: readonly ExamPlanLoaderIssue[],
): readonly ExamPlanLoaderIssue[] {
  const ordered = [...issues].sort(
    (a, b) =>
      cmp(a.code, b.code) ||
      cmp(a.sessionId ?? "", b.sessionId ?? "") ||
      cmp(a.lessonId ?? "", b.lessonId ?? ""),
  );
  const out: ExamPlanLoaderIssue[] = [];
  for (const issue of ordered) {
    const previous = out[out.length - 1];
    if (
      previous !== undefined &&
      previous.code === issue.code &&
      previous.sessionId === issue.sessionId &&
      previous.lessonId === issue.lessonId
    ) {
      continue;
    }
    out.push(issue);
  }
  return Object.freeze(out);
}

/**
 * The locked merged-session order: `date`, `startTime`, `orderIndex`,
 * `sessionId` — the committed projection order, applied to stored and live rows
 * alike because neither is privileged over the other.
 *
 * A non-finite `orderIndex` sorts LAST rather than producing `NaN` from a
 * subtraction (which a comparator reads as "equal", making the result depend on
 * the engine's insertion order). `sessionId` is unique, so the order is total.
 */
function compareSessions(a: ProjectionSession, b: ProjectionSession): number {
  const aOrder = Number.isFinite(a.orderIndex) ? a.orderIndex : Number.POSITIVE_INFINITY;
  const bOrder = Number.isFinite(b.orderIndex) ? b.orderIndex : Number.POSITIVE_INFINITY;
  return (
    cmp(a.date, b.date) ||
    cmp(a.startTime, b.startTime) ||
    (aOrder === bOrder ? 0 : aOrder < bOrder ? -1 : 1) ||
    cmp(a.sessionId, b.sessionId)
  );
}

/** True iff a projected block has anything at all to report. */
function hasBlockDiagnostics(block: StoredExamBlockComposition): boolean {
  return (
    block.timetableIssues.length > 0 ||
    block.timetableWarnings.length > 0 ||
    block.definitionIssues.length > 0 ||
    block.adapterIssues.length > 0
  );
}

/**
 * Normalize the explicit source-date rows FAIL CLOSED.
 *
 * Only an exact `YYYY-MM-DD` token survives: the value is trimmed, an illegible
 * one is DROPPED and reported, the survivors are deduplicated and sorted
 * ascending. Nothing is parsed into a `Date`, nothing is inferred, and no date
 * is ever ADDED — not from the projected sessions, not from an offering range.
 */
function normalizeSourceDates(rows: readonly ExamPlanSourceDateRow[]): {
  readonly dates: readonly string[];
  readonly invalidCount: number;
} {
  const seen = new Set<string>();
  let invalidCount = 0;
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    if (row === null || typeof row !== "object") {
      invalidCount += 1;
      continue;
    }
    const raw = typeof row.date === "string" ? row.date.trim() : "";
    if (!DATE_TOKEN.test(raw)) {
      invalidCount += 1;
      continue;
    }
    seen.add(raw);
  }
  return { dates: Object.freeze([...seen].sort(cmp)), invalidCount };
}

/**
 * The uniform EMPTY payload.
 *
 * A FRESH value on every call — never a shared singleton. The arrays are frozen,
 * but a `Map` cannot be made immutable by freezing (a frozen `Map` still accepts
 * `.set`), so sharing one instance across callers would hand every caller a
 * handle on everyone else's payload. Allocating two empty maps is far cheaper
 * than that class of bug.
 *
 * This is the value returned for EVERY ordinary fail-closed state — a blank
 * `courseOfferingId`, no plan, an unusable plan identity, and an unpublished
 * plan under a publication requirement — none of which is an exception.
 */
export function emptyExamPlanPayload(): ExamPlanPayload {
  return buildEmptyPayload([]);
}

/** The empty payload, optionally carrying the loader issues that explain it. */
function buildEmptyPayload(issues: readonly ExamPlanLoaderIssue[]): ExamPlanPayload {
  return Object.freeze({
    planId: null,
    publishedAt: null,
    sessions: Object.freeze([] as ProjectionSession[]),
    storedDetails: new Map<string, StoredExamBlockDetail>() as ReadonlyMap<
      string,
      StoredExamBlockDetail
    >,
    storedAssignmentDetails: new Map<
      string,
      StoredExamBlockOperationalDetail
    >() as ReadonlyMap<string, StoredExamBlockOperationalDetail>,
    beginnerDetails: new Map<string, BeginnerDetail>() as ReadonlyMap<string, BeginnerDetail>,
    conflictSessions: Object.freeze([] as ConflictSession[]),
    sourceDates: Object.freeze([] as string[]),
    diagnostics: Object.freeze({
      storedAdapterIssues: Object.freeze([] as StoredExamAdapterIssue[]),
      storedBlockDiagnostics: Object.freeze([] as StoredExamBlockDiagnostic[]),
      teachingPracticeSourceIssues: Object.freeze(
        [] as TeachingPracticeSourceAdapterIssue[],
      ),
      beginnerRejections: Object.freeze([] as LiveBeginnerRejection[]),
      loaderIssues: normalizeLoaderIssues(issues),
    }),
  });
}

// ===========================================================================
// The loader
// ===========================================================================

/**
 * Load ONE exam plan's complete internal payload.
 *
 * TOTAL over its own decisions: it never throws for a missing plan, an
 * unpublished plan, a blank offering id or a malformed row — every one of those
 * is the uniform empty payload plus, where a defect is involved, a diagnostic.
 *
 * IO FAILURES ARE NOT SWALLOWED. A rejected dependency propagates: a database
 * error is not a "plan with no sessions", and quietly rendering an empty exam
 * schedule because a query failed would be indistinguishable from a plan that is
 * genuinely empty. The caller decides how to surface it.
 *
 * BEGINNER CONFLICT BINDING IS NOT THIS SLICE. `conflictSessions` holds the
 * STORED blocks only. The committed live adapter emits a `ProjectionSession` and
 * a `BeginnerDetail` and no conflict input, and no committed helper converts one
 * — inventing a second beginner-conflict adapter here would create exactly the
 * duplicate the module forbids. Binding live rows into the conflict input is a
 * later explicit slice that adds the conversion where it belongs: beside the
 * live adapter.
 */
export async function loadExamPlan(
  input: ExamPlanLoadInput,
  deps: ExamPlanLoadDeps,
): Promise<ExamPlanPayload> {
  const loaderIssues: ExamPlanLoaderIssue[] = [];

  // --- 1. the caller's offering id -----------------------------------------
  const courseOfferingId = idOrNull(input?.courseOfferingId);
  if (courseOfferingId === null) {
    // ZERO dependency calls: with nothing to scope by, there is nothing that
    // could be fetched safely.
    return buildEmptyPayload([loaderIssue("EX-LOAD-COURSE-OFFERING-ID-REQUIRED")]);
  }

  // Fail closed: only an EXPLICIT `false` relaxes a gate, so a partially-built
  // options object can only ever be more restrictive.
  const requirePlanPublication = input.options?.requirePlanPublication !== false;
  const requireLessonPublication = input.options?.requireLessonPublication !== false;
  const viewerTraineeId = idOrNull(input.options?.viewerStudentId);

  // --- 2. THE PLAN, FIRST AND ALONE ----------------------------------------
  const plan = await deps.fetchPlanByCourseOfferingId(courseOfferingId);
  if (plan === null || plan === undefined || typeof plan !== "object") {
    // An offering with no exam plan is an ORDINARY state, not a defect.
    return buildEmptyPayload(loaderIssues);
  }

  const planId = idOrNull(plan.id);
  if (planId === null) {
    // An identity row that identifies nothing cannot scope a single query.
    return buildEmptyPayload([loaderIssue("EX-LOAD-PLAN-ID-INVALID")]);
  }

  // A non-numeric publication stamp fails closed to "never published".
  const publishedAt =
    typeof plan.publishedAt === "number" && Number.isFinite(plan.publishedAt)
      ? plan.publishedAt
      : null;

  // --- 3. the publication gate, BEFORE any content fetch -------------------
  if (requirePlanPublication && publishedAt === null) {
    // The uniform empty payload: it does not even disclose that a plan exists.
    return buildEmptyPayload(loaderIssues);
  }

  // --- 4. content, scoped ONLY by the plan id the plan row returned ---------
  const [definitionRows, sessionRows, sourceDateRows] = await Promise.all([
    deps.fetchDefinitionsByPlanId(planId),
    deps.fetchSessionsByPlanId(planId),
    deps.fetchSourceDatesByPlanId(planId),
  ]);

  const { dates: sourceDates, invalidCount } = normalizeSourceDates(
    Array.isArray(sourceDateRows) ? sourceDateRows : [],
  );
  if (invalidCount > 0) {
    // Reported without echoing the rejected value back.
    loaderIssues.push(loaderIssue("EX-LOAD-SOURCE-DATE-INVALID"));
  }

  // --- 5. Teaching Practice: ONE batched call, ONLY for explicit dates ------
  const lessonRows: readonly TeachingPracticeExamLessonRow[] =
    sourceDates.length === 0
      ? []
      : await deps.fetchTeachingPracticeLessonsByDates(sourceDates);

  // --- 6. stored composition (EX-S5A-1) ------------------------------------
  // UNRESOLVED blocks are deliberately KEPT: admin and instructor readers need
  // them together with their diagnostics, and hiding a row from a trainee is the
  // trainee view core's decision, taken later and for that reader only.
  const stored = composeStoredExamBlocks(
    Array.isArray(sessionRows) ? sessionRows : [],
    Array.isArray(definitionRows) ? definitionRows : [],
  );
  const storedDetails = buildStoredExamBlockDetailLookup(stored.blocks);
  const storedAssignmentDetails = buildStoredExamBlockOperationalLookup(stored.blocks);

  const storedBlockDiagnostics: StoredExamBlockDiagnostic[] = [];
  for (const block of stored.blocks) {
    if (!hasBlockDiagnostics(block)) continue;
    storedBlockDiagnostics.push(
      Object.freeze({
        sessionId: block.session.sessionId,
        definitionId: block.session.definitionId ?? null,
        timetableIssues: block.timetableIssues,
        timetableWarnings: block.timetableWarnings,
        definitionIssues: block.definitionIssues,
        adapterIssues: block.adapterIssues,
      }),
    );
  }
  storedBlockDiagnostics.sort(
    (a, b) => cmp(a.sessionId, b.sessionId) || cmp(a.definitionId ?? "", b.definitionId ?? ""),
  );

  // --- 7. Teaching-Practice composition (EX-S5A-2 → EX-C2-0) ---------------
  const adapted = adaptTeachingPracticeExamSources(
    Array.isArray(lessonRows) ? lessonRows : [],
  );

  // The publication gate runs HERE, on the adapted source rows, BEFORE the
  // projection — so an unpublished lesson produces no session, no detail and no
  // conflict input, and there is nothing to strip afterwards. The adapter's own
  // sibling detail payload is never returned by this loader at all, so a
  // filtered lesson leaves no remnant anywhere.
  const lessonsForProjection: readonly LiveBeginnerLessonSource[] = requireLessonPublication
    ? adapted.lessons.filter((lesson) => lesson.isPublished === true)
    : adapted.lessons;

  const live = projectLiveBeginnerRows({
    lessons: lessonsForProjection,
    viewerTraineeId,
  });

  // --- 8. the beginner detail map, keyed by the COMMITTED synthetic id ------
  // The id is taken from the adapter's own session/detail PAIR — never rebuilt
  // from a lesson id here, which would be a second generator of the same token.
  const liveIdCounts = new Map<string, number>();
  for (const row of live.rows) {
    const id = row.session.sessionId;
    liveIdCounts.set(id, (liveIdCounts.get(id) ?? 0) + 1);
  }

  // A duplicated synthetic id identifies no single row, so NOTHING is projected
  // for it: neither row wins and no detail is overwritten. This mirrors the
  // committed stored adapter's treatment of a duplicated definition id.
  for (const [id, count] of [...liveIdCounts.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    if (count > 1) loaderIssues.push(loaderIssue("EX-LOAD-BEGINNER-SESSION-DUPLICATE", id));
  }

  const beginnerDetails = new Map<string, BeginnerDetail>();
  const liveSessions: ProjectionSession[] = [];
  for (const row of live.rows) {
    const sessionId = row.session.sessionId;
    if ((liveIdCounts.get(sessionId) ?? 0) > 1) continue;
    // A detail that disagrees with its own session about identity cannot be
    // keyed safely in either direction, so the whole row is dropped.
    if (row.detail.sessionId !== sessionId) {
      loaderIssues.push(
        loaderIssue("EX-LOAD-BEGINNER-DETAIL-CONFLICT", sessionId, idOrNull(row.detail.lessonId)),
      );
      continue;
    }
    beginnerDetails.set(sessionId, row.detail);
    liveSessions.push(row.session);
  }

  // --- 9. the merged, deterministically ordered session array --------------
  // Adapter outputs are carried BY IDENTITY: the frozen `ProjectionSession`
  // objects are the committed adapters' own, never re-copied or re-shaped here.
  const sessions = [...stored.blocks.map((block) => block.session), ...liveSessions].sort(
    compareSessions,
  );

  return Object.freeze({
    planId,
    publishedAt,
    sessions: Object.freeze(sessions),
    storedDetails,
    storedAssignmentDetails,
    beginnerDetails: beginnerDetails as ReadonlyMap<string, BeginnerDetail>,
    conflictSessions: Object.freeze(
      stored.blocks.map((block) => block.conflictSession),
    ),
    sourceDates,
    diagnostics: Object.freeze({
      storedAdapterIssues: stored.issues,
      storedBlockDiagnostics: Object.freeze(storedBlockDiagnostics),
      teachingPracticeSourceIssues: adapted.issues,
      beginnerRejections: Object.freeze(
        [...live.rejected].sort((a, b) => cmp(a.lessonId, b.lessonId) || cmp(a.reason, b.reason)),
      ),
      loaderIssues: normalizeLoaderIssues(loaderIssues),
    }),
  });
}
