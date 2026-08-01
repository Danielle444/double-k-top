/**
 * EXAM EX-ADMIN-SRCDATE — the PURE decision of ONE source-date REPLACEMENT.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no Next, no
 * `server-only`, no `"use server"`, no auth/session/cookie, no capability, no
 * clock (`Date.now` / `new Date`), no randomness, no env, no filesystem, no
 * network, no `Intl`, no `localeCompare`. Every export is a total, deterministic
 * function of its arguments and never mutates its inputs. The only runtime
 * dependencies are two committed, import-free, `Date`-free primitives.
 *
 * WHAT THIS ANSWERS (and only this): given the raw date tokens a manager
 * submitted, the offering's LEVEL, the offering's own calendar bounds, and the
 * set of dates that ACTUALLY hold Teaching-Practice lessons, which
 * `ExamTeachingPracticeSourceDate` set should the plan end up with — or which
 * closed refusal explains why none may be written?
 *
 * ===========================================================================
 * WHY A SOURCE-DATE SELECTION EXISTS AT ALL
 * ===========================================================================
 * Beginner exams are a LIVE PROJECTION of Teaching Practice. Every beginner row
 * is derived at read time from the current Teaching-Practice rows, so nothing
 * about a lesson, a child, a horse or a parent contact is ever copied into the
 * exam module — and THIS CORE COPIES NONE OF IT EITHER. The one fact that
 * cannot be derived at read time is WHICH Teaching-Practice dates the manager
 * chose to run as exam days, and a date token is the entirety of what this
 * module decides.
 *
 * `TeachingPracticeLesson` carries no course column, so a date alone cannot bind
 * a lesson to one course. The committed containment rule closes that hole — a
 * beginner projection exists ONLY for the one beginner-source course level — and
 * this core REUSES that committed predicate rather than restating it, so a
 * future product change stays a single-line edit in the module that owns it.
 *
 * ===========================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ===========================================================================
 *  - it PERFORMS NO IO. It never sees Prisma, a query, a plan row, an actor or
 *    a request, and it cannot write anything even in principle;
 *  - it AUTHORIZES NOTHING. Holding a decision from this module grants nothing;
 *    the admin boundary, the offering lookup and the lifecycle write gate all
 *    run in the IO binding, before and independently of this;
 *  - it NEVER INFERS A DATE. No course date range is expanded into a list, no
 *    weekday rule is applied, no lesson is discovered and no "all dates" arm
 *    exists. A date reaches the stored set only because the manager submitted
 *    that exact token — which is precisely the product rule the schema comment
 *    on `ExamTeachingPracticeSourceDate` records;
 *  - it MODELS NO TEACHING-PRACTICE CONTENT. The only thing it is told about
 *    Teaching Practice is an opaque SET OF DATE KEYS that hold lessons. No
 *    lesson id, participant, child, horse, contact, time, format or note is an
 *    input, so no such value can be validated against, stored or leaked here;
 *  - it accepts NO id of any kind. Not a lesson id, not a participant id, not a
 *    plan id and not a course id: a client that could name a Teaching-Practice
 *    row could select rows the date rule was written to keep out of reach.
 *
 * ===========================================================================
 * REPLACEMENT, NOT MERGE — AND THE EMPTY SET IS A REAL ANSWER
 * ===========================================================================
 * The decision describes the COMPLETE set the plan should hold afterwards. A
 * submission naming three dates means the plan holds exactly those three, and a
 * submission naming none means the plan holds none. There is no "add" arm and no
 * "remove" arm, because a partial vocabulary is what lets two surfaces disagree
 * about what is selected.
 *
 * An EMPTY selection is a legitimate outcome and never a refusal: deselecting
 * every beginner date is how a manager says this plan has no beginner exams, and
 * refusing it would leave a mistaken selection permanently stuck.
 */
import { isValidDateKey } from "../trainee-history/interval-resolver";
import { isBeginnerSourceCourseLevel } from "./exam-beginner-course-scope-core";

// ===========================================================================
// 1. Issues
// ===========================================================================

/**
 * Every diagnostic this core can produce. The code STRINGS are the contract and
 * must not be renamed once consumed downstream.
 *
 * There is deliberately no code describing a database outcome, an authorization
 * failure or a publication state: none of those is visible from here.
 */
export type AdminExamSourceDateIssueCode =
  | "EX-SRC-INPUT-NOT-A-LIST"
  | "EX-SRC-DATE-INVALID"
  | "EX-SRC-LEVEL-NOT-SUPPORTED"
  | "EX-SRC-DATE-OUT-OF-COURSE-RANGE"
  | "EX-SRC-DATE-HAS-NO-PRACTICE";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<AdminExamSourceDateIssueCode, string>` annotation forces every code —
 * present or future — to carry a message or this file will not compile.
 *
 * The messages are deliberately NON-ECHOING: none contains a placeholder, a
 * submitted token, a date or a count, so a diagnostic can never turn into a data
 * channel.
 */
export const ADMIN_EXAM_SOURCE_DATE_MESSAGES: Readonly<
  Record<AdminExamSourceDateIssueCode, string>
> = Object.freeze({
  "EX-SRC-INPUT-NOT-A-LIST": "רשימת התאריכים שנשלחה אינה תקינה",
  "EX-SRC-DATE-INVALID": "אחד התאריכים שנשלחו אינו תאריך תקין",
  "EX-SRC-LEVEL-NOT-SUPPORTED": "מבחני מתחילים אינם קיימים ברמת הקורס הזו",
  "EX-SRC-DATE-OUT-OF-COURSE-RANGE": "אחד התאריכים שנשלחו נמצא מחוץ לתקופת הקורס",
  "EX-SRC-DATE-HAS-NO-PRACTICE": "אין תרגול מעשי באחד התאריכים שנשלחו",
});

/**
 * One diagnostic.
 *
 * It carries a CODE and its own message and NOTHING ELSE — in particular not the
 * offending date. A refusal list that echoed submitted tokens back would be a way
 * to put arbitrary text on an admin screen, and the manager can see the dates
 * they submitted.
 */
export interface AdminExamSourceDateIssue {
  readonly code: AdminExamSourceDateIssueCode;
  readonly message: string;
}

function makeIssue(code: AdminExamSourceDateIssueCode): AdminExamSourceDateIssue {
  return Object.freeze({ code, message: ADMIN_EXAM_SOURCE_DATE_MESSAGES[code] });
}

// ===========================================================================
// 2. Input and output
// ===========================================================================

/**
 * Everything the decision needs, and nothing more.
 *
 * `courseLevel` is `unknown` on purpose: this is the boundary a malformed,
 * absent or wrongly-typed level meets, and the committed level predicate is
 * itself written to take `unknown` for exactly that reason.
 *
 * `courseStartDate` / `courseEndDate` are `YYYY-MM-DD` tokens or `null`. `null`
 * means the offering states no bound on that side, so no bound is enforced on
 * that side — an absent bound is not a closed one, and refusing every date
 * because a course never recorded an end would make the feature unusable on
 * exactly the offerings that need it.
 *
 * `practiceDates` is an opaque SET OF DATE KEYS that hold Teaching-Practice
 * lessons. It is a set of dates and never a set of lessons: this module is not
 * allowed to see a lesson.
 */
export interface AdminExamSourceDateDecisionInput {
  readonly submitted: readonly unknown[];
  readonly courseLevel: unknown;
  readonly courseStartDate: string | null;
  readonly courseEndDate: string | null;
  readonly practiceDates: ReadonlySet<string>;
  readonly storedDates: readonly string[];
}

/**
 * The decision.
 *
 * The success arm carries NO `issues` key and the failure arm carries NO
 * `dates` key, so no property is ever present-but-`undefined` and the whole
 * value is JSON-safe. Nothing in either arm is a `Date`, `Map`, `Set`,
 * `BigInt`, `Error` or class instance.
 *
 * `changed` is the ONE thing the binding needs beyond the set itself: a
 * submission that matches what is already stored must be reported as a no-op
 * rather than written, so a manager is never told something was saved when the
 * database was not touched.
 */
export type AdminExamSourceDateDecision =
  | {
      readonly ok: true;
      /** The COMPLETE set the plan should hold, ascending and duplicate-free. */
      readonly dates: readonly string[];
      readonly changed: boolean;
    }
  | { readonly ok: false; readonly issues: readonly AdminExamSourceDateIssue[] };

// ===========================================================================
// 3. Helpers
// ===========================================================================

/**
 * Plain code-point string comparison. Deliberately NOT `localeCompare` and not
 * `Intl.Collator`: a locale-aware order can differ between a developer machine,
 * CI and the server. For zero-padded `YYYY-MM-DD`, code-point order IS
 * chronological order, so no `Date` is ever constructed to sort these.
 */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Are two ascending, duplicate-free date lists the same set?
 *
 * Both sides are normalized before this is reached, so a positional walk is a
 * set comparison and no second `Set` has to be allocated to prove it.
 */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

/** The stored set, normalized on exactly the terms a submission is. */
function normalizeStored(stored: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const list = Array.isArray(stored) ? stored : [];
  for (const value of list) {
    if (isValidDateKey(value)) seen.add(value);
  }
  return Object.freeze([...seen].sort(cmp));
}

// ===========================================================================
// 4. The decision
// ===========================================================================

/**
 * Decide the COMPLETE source-date set one submission should leave behind.
 *
 * The order of the checks is deliberate and load-bearing:
 *
 *  1. the LEVEL first. An offering with no beginner projection has no legitimate
 *     source date at all, so nothing about the submitted tokens is examined and
 *     no other diagnostic can be produced — a per-date complaint would invite a
 *     manager to "fix" dates on a course that can never show one;
 *  2. then SHAPE. A submission that is not a list at all is a defect rather than
 *     a selection;
 *  3. then EACH TOKEN, in ONE pass: a real calendar date, inside whichever
 *     course bounds exist, and holding at least one Teaching-Practice lesson.
 *
 * EVERY applicable issue is reported rather than only the first, so one round
 * trip shows the manager the complete picture. Issues are DEDUPLICATED by code:
 * three dates outside the course period are one rule stated once, not the same
 * sentence three times.
 *
 * VALIDATION IS ALL-OR-NOTHING. One unusable token refuses the WHOLE
 * replacement and writes nothing. Silently dropping the bad ones and storing the
 * rest would leave the manager looking at a selection they did not make, on a
 * screen whose entire purpose is to state which dates were chosen.
 *
 * DUPLICATES ARE NOT AN ERROR. The same date submitted twice is one selection —
 * a checkbox list and a free date field can legitimately name the same day — so
 * duplicates collapse silently and the stored set is unique by construction,
 * which is also what the `(planId, date)` unique index requires.
 *
 * THE EMPTY SELECTION IS ALWAYS ALLOWED on a supported level, and means the plan
 * holds no beginner dates.
 *
 * Never mutates its inputs, reads no clock, constructs no `Date`, and never
 * throws — including for input that is not an array at all.
 */
export function decideExamSourceDateReplacement(
  input: AdminExamSourceDateDecisionInput,
): AdminExamSourceDateDecision {
  // 1. The committed containment predicate, asked rather than restated.
  if (!isBeginnerSourceCourseLevel(input.courseLevel)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([makeIssue("EX-SRC-LEVEL-NOT-SUPPORTED")]),
    });
  }

  if (!Array.isArray(input.submitted)) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([makeIssue("EX-SRC-INPUT-NOT-A-LIST")]),
    });
  }

  const codes = new Set<AdminExamSourceDateIssueCode>();
  const accepted = new Set<string>();
  const practice =
    input.practiceDates instanceof Set ? input.practiceDates : new Set<string>();
  const lowerBound = isValidDateKey(input.courseStartDate) ? input.courseStartDate : null;
  const upperBound = isValidDateKey(input.courseEndDate) ? input.courseEndDate : null;

  for (const raw of input.submitted) {
    if (!isValidDateKey(raw)) {
      codes.add("EX-SRC-DATE-INVALID");
      continue;
    }
    // Zero-padded `YYYY-MM-DD` compares chronologically as a plain string, so
    // the range test needs no calendar arithmetic and constructs no `Date`.
    if (lowerBound !== null && raw < lowerBound) {
      codes.add("EX-SRC-DATE-OUT-OF-COURSE-RANGE");
      continue;
    }
    if (upperBound !== null && raw > upperBound) {
      codes.add("EX-SRC-DATE-OUT-OF-COURSE-RANGE");
      continue;
    }
    if (!practice.has(raw)) {
      codes.add("EX-SRC-DATE-HAS-NO-PRACTICE");
      continue;
    }
    accepted.add(raw);
  }

  if (codes.size > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([...codes].sort(cmp).map(makeIssue)),
    });
  }

  const dates = Object.freeze([...accepted].sort(cmp));
  return Object.freeze({
    ok: true as const,
    dates,
    changed: !sameSet(dates, normalizeStored(input.storedDates)),
  });
}

// ===========================================================================
// 5. The ORCHESTRATION — pure, and injected with every effect it needs
// ===========================================================================

/**
 * The COURSE FACTS this operation is allowed to know.
 *
 * Exactly five: the verified offering id, its lifecycle status, its level and
 * its two calendar bounds. There is no name, no ActivityYear, no enrolment and
 * no roster — the narrowing happens at the boundary, which is what keeps them
 * out of this core.
 */
export interface ExamSourceDateCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
  readonly courseLevel: number;
  readonly courseStartDate: string | null;
  readonly courseEndDate: string | null;
}

/**
 * Every effect the replacement needs, injected.
 *
 * `replaceSourceDates` is ONE dependency and never a remove plus an add: the
 * replacement is atomic by contract, and a two-call interface would let a
 * future binding satisfy the types while leaving the plan in a half-written
 * state that no reader could distinguish from a deliberate selection.
 *
 * `findPracticeDates` answers "which of THESE dates hold a Teaching-Practice
 * lesson" and returns DATES. It is never asked for a lesson, and it is never
 * asked an open question — it receives the exact list to test, so no query can
 * be made to enumerate Teaching Practice.
 */
export interface ReplaceExamSourceDatesDeps {
  readonly requireCourseContext: (
    requestedCourseOfferingId: string,
  ) => Promise<ExamSourceDateCourseContext>;
  readonly assertConfigurationAllowed: (status: string) => void;
  readonly findPlanIdByCourseOfferingId: (courseOfferingId: string) => Promise<string | null>;
  readonly findStoredSourceDates: (planId: string) => Promise<readonly string[]>;
  readonly findPracticeDates: (dates: readonly string[]) => Promise<readonly string[]>;
  readonly replaceSourceDates: (planId: string, dates: readonly string[]) => Promise<void>;
  readonly isCourseNotFoundError: (error: unknown) => boolean;
  readonly isOperationNotAllowedError: (error: unknown) => boolean;
}

/** The CLOSED refusal vocabulary of a replacement. */
export type ReplaceExamSourceDatesReason =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "invalid_input";

/**
 * The outcome.
 *
 * `NO_CHANGE` is a SUCCESS and is reported separately from `REPLACED`, because a
 * manager whose submission matched what was already stored must not be told that
 * something was written — and because a write that did not happen must not be
 * reported as one.
 */
export type ReplaceExamSourceDatesResult =
  | {
      readonly ok: true;
      readonly outcome: "REPLACED" | "NO_CHANGE";
      readonly dates: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: ReplaceExamSourceDatesReason;
      readonly issues: readonly AdminExamSourceDateIssue[];
    };

const NO_ISSUES: readonly AdminExamSourceDateIssue[] = Object.freeze([]);

function refuse(
  reason: ReplaceExamSourceDatesReason,
  issues: readonly AdminExamSourceDateIssue[] = NO_ISSUES,
): ReplaceExamSourceDatesResult {
  return Object.freeze({ ok: false as const, reason, issues: Object.freeze([...issues]) });
}

/**
 * Replace the COMPLETE source-date selection of ONE course offering's exam plan.
 *
 * THE ORDER, and it is fixed:
 *
 *   1. `requireCourseContext` — the admin boundary AND the exact offering, first
 *      and always. A typed not-found becomes the closed `offering_not_found`
 *      refusal; every other throw, including the authorization redirect,
 *      propagates untouched;
 *   2. `assertConfigurationAllowed` — the course-lifecycle WRITE gate on the
 *      VERIFIED status. Its typed denial becomes `operation_not_allowed`;
 *   3. the LEVEL, asked of the committed containment predicate. An offering with
 *      no beginner projection is refused here so that no Teaching-Practice query
 *      is issued for it AT ALL — the containment rule is worth more than the
 *      diagnostic quality of a course that can never show a beginner row;
 *   4. the plan. No plan is `plan_not_found`, never an implicit create: creating
 *      a plan is a different, separately gated operation;
 *   5. the SHAPE filter, and only then the Teaching-Practice date probe. Only
 *      well-formed date keys are ever sent to it, and an EMPTY selection skips
 *      it entirely — a plan selecting nothing must read nothing rather than
 *      everything;
 *   6. the stored set, for the no-op comparison;
 *   7. the pure decision, which owns every rule;
 *   8. the write — ONCE, atomically, and ONLY when the set actually changed.
 *
 * The caller supplies date TOKENS and nothing else. There is no parameter and no
 * object field for a plan id, a lesson id, a participant id, a child, a horse or
 * a contact: a client that could name a Teaching-Practice row could reach rows
 * the date rule exists to keep out of reach.
 *
 * Never mutates its inputs and reads no clock.
 */
export async function replaceExamSourceDatesWithDeps(
  requestedCourseOfferingId: string,
  submitted: readonly unknown[],
  deps: ReplaceExamSourceDatesDeps,
): Promise<ReplaceExamSourceDatesResult> {
  let context: ExamSourceDateCourseContext;
  try {
    context = await deps.requireCourseContext(requestedCourseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) return refuse("offering_not_found");
    throw error;
  }

  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) return refuse("operation_not_allowed");
    throw error;
  }

  // The committed containment predicate, asked BEFORE anything is read.
  if (!isBeginnerSourceCourseLevel(context.courseLevel)) {
    return refuse("invalid_input", [makeIssue("EX-SRC-LEVEL-NOT-SUPPORTED")]);
  }

  const planId = await deps.findPlanIdByCourseOfferingId(context.courseOfferingId);
  if (planId === null) return refuse("plan_not_found");

  if (!Array.isArray(submitted)) {
    return refuse("invalid_input", [makeIssue("EX-SRC-INPUT-NOT-A-LIST")]);
  }

  // A SHAPE filter and not a decision: only well-formed tokens may be put into a
  // query. Malformed ones are still carried into the decision below, which is
  // what turns them into the closed refusal the manager is shown.
  const probe = [...new Set(submitted.filter((value) => isValidDateKey(value)))].sort(cmp);
  const practiceDates = new Set<string>(
    probe.length === 0 ? [] : await deps.findPracticeDates(probe),
  );

  const decision = decideExamSourceDateReplacement({
    submitted,
    courseLevel: context.courseLevel,
    courseStartDate: context.courseStartDate,
    courseEndDate: context.courseEndDate,
    practiceDates,
    storedDates: await deps.findStoredSourceDates(planId),
  });

  if (!decision.ok) return refuse("invalid_input", decision.issues);

  if (!decision.changed) {
    return Object.freeze({
      ok: true as const,
      outcome: "NO_CHANGE" as const,
      dates: decision.dates,
    });
  }

  await deps.replaceSourceDates(planId, decision.dates);
  return Object.freeze({
    ok: true as const,
    outcome: "REPLACED" as const,
    dates: decision.dates,
  });
}
