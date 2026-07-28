/**
 * ===========================================================================
 * DEPRECATED (EX-C2-0) — NOT USED BY THE LIVE BEGINNER DESIGN.
 * ===========================================================================
 * This planner describes the SNAPSHOT/COPY design that has been SUPERSEDED.
 * Beginner exams are no longer copied into exam rows: Teaching Practice is the
 * live, authoritative source, an `ExamPlan` stores only which TP dates it
 * covers (`ExamTeachingPracticeSourceDate`), and every beginner row is derived
 * at read time by `exam-live-beginner-adapter-core`. A stored
 * `BEGINNER_INSTRUCTION` `ExamSession` is now FORBIDDEN
 * (`validateStoredExamSession` / `EX-DOM-BEGINNER-SESSION-FORBIDDEN`), so the
 * plan this module produces can no longer be applied to anything.
 *
 * It was never wired to a service, action or UI, and it must not be. It is
 * retained (rather than deleted) purely as the record of the copy semantics,
 * and its tests are kept green so the retirement is provably behaviour-neutral.
 *
 * Its one surviving piece of live value — the practice-type → beginner-format
 * mapping — now LIVES IN `exam-beginner-format-core` and is merely re-exported
 * here for the existing tests and callers. Do not add a second copy of it.
 *
 * DO NOT extend this module, revive the copy path, or import it from any new
 * code. New beginner work belongs in `exam-live-beginner-adapter-core`.
 *
 * ---------------------------------------------------------------------------
 * Original EX-C1 header follows, unchanged, for the record.
 * ---------------------------------------------------------------------------
 *
 * EXAM EX-C1 — PURE beginner-exam COPY PLANNER.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Every export is a deterministic function of its arguments and never
 * mutates its inputs. This module pulls in NO runtime code beyond the sibling
 * PURE exam cores.
 *
 * WHAT THIS ANSWERS (and only this): given the plain, already-read data of the
 * Teaching-Practice lessons on ONE explicitly selected date, what exam-side rows
 * would a copy create?
 *
 * SNAPSHOT / COPY SEMANTICS — this planner describes an INDEPENDENT COPY, never
 * a live reference. Teaching Practice is READ-ONLY INPUT:
 *  - it returns plain data only and performs no IO whatsoever, so it CANNOT
 *    write back to Teaching Practice even in principle;
 *  - every operational value needed to run the exam is COPIED into the plan
 *    (times, format, participants, original TP roles, children, horses,
 *    equipment, absence, parent/contact details, notes, role-label overrides,
 *    responsible instructor);
 *  - after the copy the exam rows are independent — later Teaching-Practice
 *    edits must never mutate them, which is why nothing here models a link
 *    back beyond the provenance ids used for idempotency.
 *
 * LOCKED ROLE RULE: EVERY copied trainee participant becomes an `EXAMINEE`,
 * INCLUDING the participant currently carrying the Teaching-Practice
 * `EVALUATOR` role. The exact original role is preserved separately in
 * `sourcePracticeRole` as a plain STRING — deliberately not a live
 * Teaching-Practice enum, so later TP role/label changes can never invalidate
 * or rewrite an already-copied exam row.
 *
 * THE DATE IS ALWAYS AN EXPLICIT INPUT. This module never infers, guesses, or
 * ranks candidate dates, and never looks at a course name, level, group, or
 * title: a lesson whose date does not equal the requested date is REJECTED,
 * never silently copied.
 *
 * IDEMPOTENCY: `alreadyCopiedSourceLessonIds` are skipped and reported, never
 * duplicated and never silently mutated. The DB-level
 * `@@unique([planId, sourceTeachingPracticeLessonId])` is the second guard.
 *
 * It does NOT create sessions, does NOT persist anything, does NOT resolve
 * which dates are eligible, and touches no schema/DB/UI. The DB copy service
 * and the manager wizard are EX-C2, not this slice.
 */
import type { ExamBeginnerFormat } from "./exam-domain-core";
import { isValidExamTimeInterval } from "./exam-overlap-core";
// EX-C2-0: the practice-type mapping moved to its own core (see the note at its
// re-export below). Imported as a value so the planner body below keeps working
// unchanged, and re-exported so existing callers/tests are unaffected.
import { mapPracticeTypeToBeginnerFormat } from "./exam-beginner-format-core";

// ===========================================================================
// Source shapes — plain, already-read Teaching-Practice data
// ===========================================================================

/** One Teaching-Practice participant as read for the copy. */
export interface TeachingPracticeParticipantSource {
  readonly participantId: string;
  readonly traineeId: string;
  /** The RAW Teaching-Practice role token, preserved verbatim. */
  readonly role: string;
}

/** One Teaching-Practice child assignment (plus its child) as read. */
export interface TeachingPracticeChildAssignmentSource {
  readonly childAssignmentId: string;
  readonly childId: string;
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly childNotes: string | null;
  readonly parentName: string | null;
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/** One Teaching-Practice lesson as read for the copy. */
export interface TeachingPracticeLessonSource {
  readonly lessonId: string;
  /** Raw `TeachingPracticeType` token; mapped to an `ExamBeginnerFormat`. */
  readonly practiceType: string;
  /** `YYYY-MM-DD`. Must equal the requested date or the lesson is rejected. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly location: string | null;
  readonly notes: string | null;
  readonly responsibleInstructorId: string | null;
  /** Opaque JSON passthrough, copied verbatim. */
  readonly roleLabelOverrides: unknown;
  readonly participants: readonly TeachingPracticeParticipantSource[];
  readonly childAssignments: readonly TeachingPracticeChildAssignmentSource[];
}

/** The planner input. Scoped to ONE plan and ONE explicitly selected date. */
export interface BeginnerCopyPlanInput {
  readonly planId: string;
  /** The explicitly chosen exam date, `YYYY-MM-DD`. NEVER inferred. */
  readonly date: string;
  readonly lessons: readonly TeachingPracticeLessonSource[];
  /** Source lesson ids already copied into this plan (idempotency). */
  readonly alreadyCopiedSourceLessonIds?: readonly string[];
}

// ===========================================================================
// Planned output shapes
// ===========================================================================

/** A planned `ExamAssignment` row. Always role EXAMINEE (locked rule). */
export interface PlannedExamAssignment {
  readonly studentId: string;
  readonly role: "EXAMINEE";
  /** The exact original Teaching-Practice role token, as a plain string. */
  readonly sourcePracticeRole: string;
  readonly sourceParticipantId: string;
}

/** A planned `ExamBeginnerChild` snapshot row. */
export interface PlannedExamBeginnerChild {
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly notes: string | null;
  readonly parentName: string | null;
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
  readonly sourceChildId: string;
  readonly sourceChildAssignmentId: string;
  readonly orderIndex: number;
}

/** A planned `ExamSession` row plus its children rows. */
export interface PlannedExamSession {
  readonly kind: "BEGINNER_INSTRUCTION";
  readonly beginnerFormat: ExamBeginnerFormat;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly orderIndex: number;
  /** Copied from the source lesson's `location` (the single place field). */
  readonly arena: string | null;
  readonly notes: string | null;
  readonly roleLabelOverrides: unknown;
  readonly sourceTeachingPracticeLessonId: string;
  readonly assignments: readonly PlannedExamAssignment[];
  readonly beginnerChildren: readonly PlannedExamBeginnerChild[];
  readonly supervisorInstructorIds: readonly string[];
}

/** Why a source lesson could not be planned. Stable, non-PII tokens. */
export type BeginnerCopyRejectionReason =
  | "MISSING_LESSON_ID"
  | "DATE_MISMATCH"
  | "UNKNOWN_PRACTICE_TYPE"
  | "INVALID_TIME_INTERVAL";

export interface BeginnerCopyRejection {
  readonly sourceTeachingPracticeLessonId: string;
  readonly reason: BeginnerCopyRejectionReason;
}

export interface BeginnerCopyTotals {
  readonly sessions: number;
  readonly assignments: number;
  readonly beginnerChildren: number;
  readonly supervisors: number;
  readonly distinctTrainees: number;
}

/** The full, deterministic copy plan. Nothing here has been written. */
export interface BeginnerCopyPlan {
  readonly planId: string;
  readonly date: string;
  readonly create: readonly PlannedExamSession[];
  /** Source lessons already copied — skipped, never duplicated. */
  readonly skippedAlreadyCopied: readonly string[];
  readonly rejected: readonly BeginnerCopyRejection[];
  readonly totals: BeginnerCopyTotals;
}

// ===========================================================================
// Practice type → beginner format
// ===========================================================================

/**
 * The authoritative `TeachingPracticeType` → `ExamBeginnerFormat` mapping.
 * Exhaustive by construction: an unrecognized token yields `null` and the
 * lesson is REJECTED rather than guessed (fail closed). Own-property lookup, so
 * `__proto__`/`toString` never map to a real format.
 */
// EX-C2-0: OWNERSHIP MOVED. The mapping now lives in
// `exam-beginner-format-core` (semantics unchanged — it was moved, not
// rewritten) because the LIVE beginner adapter needs it and must not import a
// deprecated module. Re-exported here so existing callers and tests are
// unaffected. Do not reintroduce a local copy.
export { mapPracticeTypeToBeginnerFormat };

// ===========================================================================
// Helpers
// ===========================================================================

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Trim to a value, or `null` when absent/blank. Never returns "". */
function trimmedOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** A total string comparison giving a stable, locale-independent order. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ===========================================================================
// The planner
// ===========================================================================

/**
 * Build the deterministic copy plan for ONE date. Pure; never mutates inputs.
 *
 * Ordering is fully deterministic and independent of input order:
 *  - sessions by (startTime, endTime, sourceLessonId) → `orderIndex` 0..n-1,
 *    which is what makes the by-date and by-exam-type views stable when several
 *    lessons share a start time (the real source data always does);
 *  - assignments by (traineeId, sourceParticipantId);
 *  - children by (fullName, sourceChildAssignmentId) → `orderIndex` 0..n-1.
 */
export function planBeginnerExamCopy(input: BeginnerCopyPlanInput): BeginnerCopyPlan {
  const alreadyCopied = new Set<string>(
    (input.alreadyCopiedSourceLessonIds ?? []).filter(isPresent),
  );

  const skipped: string[] = [];
  const rejected: BeginnerCopyRejection[] = [];
  const planned: Omit<PlannedExamSession, "orderIndex">[] = [];

  for (const lesson of input.lessons) {
    if (!isPresent(lesson.lessonId)) {
      rejected.push({ sourceTeachingPracticeLessonId: "", reason: "MISSING_LESSON_ID" });
      continue;
    }
    if (alreadyCopied.has(lesson.lessonId)) {
      skipped.push(lesson.lessonId);
      continue;
    }
    // The requested date is authoritative; a mismatch is never silently copied.
    if (lesson.date !== input.date) {
      rejected.push({
        sourceTeachingPracticeLessonId: lesson.lessonId,
        reason: "DATE_MISMATCH",
      });
      continue;
    }
    const beginnerFormat = mapPracticeTypeToBeginnerFormat(lesson.practiceType);
    if (beginnerFormat === null) {
      rejected.push({
        sourceTeachingPracticeLessonId: lesson.lessonId,
        reason: "UNKNOWN_PRACTICE_TYPE",
      });
      continue;
    }
    if (
      !isValidExamTimeInterval({
        date: lesson.date,
        start: lesson.startTime,
        end: lesson.endTime,
      })
    ) {
      rejected.push({
        sourceTeachingPracticeLessonId: lesson.lessonId,
        reason: "INVALID_TIME_INTERVAL",
      });
      continue;
    }

    // --- participants: EVERY copied trainee becomes an EXAMINEE ------------
    const assignments: PlannedExamAssignment[] = [];
    const seenTrainees = new Set<string>();
    for (const p of lesson.participants) {
      if (!isPresent(p.traineeId) || !isPresent(p.participantId)) continue;
      // One assignment per trainee per session (the DB unique says the same).
      if (seenTrainees.has(p.traineeId)) continue;
      seenTrainees.add(p.traineeId);
      assignments.push({
        studentId: p.traineeId,
        role: "EXAMINEE",
        sourcePracticeRole: typeof p.role === "string" ? p.role : "",
        sourceParticipantId: p.participantId,
      });
    }
    assignments.sort(
      (a, b) =>
        cmp(a.studentId, b.studentId) || cmp(a.sourceParticipantId, b.sourceParticipantId),
    );

    // --- children: full independent snapshot incl. parent contact ----------
    const children = lesson.childAssignments
      .filter((c) => isPresent(c.childAssignmentId) && isPresent(c.childId))
      .map((c) => ({
        fullName: typeof c.fullName === "string" ? c.fullName : "",
        age: typeof c.age === "number" && Number.isFinite(c.age) ? c.age : null,
        gender: trimmedOrNull(c.gender),
        notes: trimmedOrNull(c.childNotes),
        parentName: trimmedOrNull(c.parentName),
        parentPhone: trimmedOrNull(c.parentPhone),
        horseName: trimmedOrNull(c.horseName),
        equipmentNotes: trimmedOrNull(c.equipmentNotes),
        isAbsent: c.isAbsent === true,
        sourceChildId: c.childId,
        sourceChildAssignmentId: c.childAssignmentId,
      }))
      .sort(
        (a, b) =>
          cmp(a.fullName, b.fullName) ||
          cmp(a.sourceChildAssignmentId, b.sourceChildAssignmentId),
      )
      .map((c, index) => Object.freeze({ ...c, orderIndex: index }));

    const supervisorInstructorIds = isPresent(lesson.responsibleInstructorId)
      ? Object.freeze([lesson.responsibleInstructorId.trim()])
      : Object.freeze([] as string[]);

    planned.push({
      kind: "BEGINNER_INSTRUCTION",
      beginnerFormat,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      arena: trimmedOrNull(lesson.location),
      notes: trimmedOrNull(lesson.notes),
      // Copied verbatim so later display-label changes are a rendering concern.
      roleLabelOverrides: lesson.roleLabelOverrides ?? null,
      sourceTeachingPracticeLessonId: lesson.lessonId,
      assignments: Object.freeze(assignments),
      beginnerChildren: Object.freeze(children),
      supervisorInstructorIds,
    });
  }

  // Deterministic session order, then a dense orderIndex.
  planned.sort(
    (a, b) =>
      cmp(a.startTime, b.startTime) ||
      cmp(a.endTime, b.endTime) ||
      cmp(a.sourceTeachingPracticeLessonId, b.sourceTeachingPracticeLessonId),
  );
  const create = planned.map((session, index) =>
    Object.freeze({ ...session, orderIndex: index }),
  );

  const distinctTrainees = new Set<string>();
  const distinctSupervisors = new Set<string>();
  let assignmentCount = 0;
  let childCount = 0;
  for (const session of create) {
    assignmentCount += session.assignments.length;
    childCount += session.beginnerChildren.length;
    for (const a of session.assignments) distinctTrainees.add(a.studentId);
    for (const s of session.supervisorInstructorIds) distinctSupervisors.add(s);
  }

  skipped.sort(cmp);
  rejected.sort(
    (a, b) =>
      cmp(a.sourceTeachingPracticeLessonId, b.sourceTeachingPracticeLessonId) ||
      cmp(a.reason, b.reason),
  );

  return Object.freeze({
    planId: input.planId,
    date: input.date,
    create: Object.freeze(create),
    skippedAlreadyCopied: Object.freeze(skipped),
    rejected: Object.freeze(rejected),
    totals: Object.freeze({
      sessions: create.length,
      assignments: assignmentCount,
      beginnerChildren: childCount,
      supervisors: distinctSupervisors.size,
      distinctTrainees: distinctTrainees.size,
    }),
  });
}
