/**
 * EXAM EX-C2-0 — PURE live beginner-exam adapter.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Deterministic; never mutates its inputs. Its only runtime import is
 * the sibling PURE format core; the two type-only imports are erased at build.
 *
 * WHAT THIS ANSWERS (and only this): given the plain, already-read
 * Teaching-Practice data for the exam plan's selected source dates, what
 * beginner rows do the exam views show?
 *
 * ===========================================================================
 * LIVE PROJECTION — NOT A COPY
 * ===========================================================================
 * BEGINNER_INSTRUCTION is never stored as exam data. Teaching Practice is the
 * live, authoritative source, and this module is the read-time transform that
 * makes a TP lesson presentable beside a stored `ExamSession`. Consequently:
 *
 *  - it performs no IO, so it CANNOT write back to Teaching Practice even in
 *    principle;
 *  - it produces NOTHING to persist — its output is a per-request view, and any
 *    caller that saves it has reintroduced the snapshot this design removed;
 *  - a Teaching-Practice edit is reflected simply by calling it again with
 *    freshly read input. There is no synchronisation, no fingerprint, no
 *    staleness comparison and no cache anywhere in this design.
 *
 * ===========================================================================
 * FEEDBACK, RATINGS AND GRADES ARE OUT OF SCOPE
 * ===========================================================================
 * The Exams area shows SCHEDULING AND OPERATIONAL information only. No type in
 * this module has a feedback, rating, grade or score field — not nulled, not
 * optional, not a placeholder: ABSENT. The reader that feeds this adapter must
 * likewise never SELECT the Teaching-Practice feedback relation, so nothing to
 * strip ever leaves the database — which is why it must use its own narrow
 * select rather than the general-purpose lesson-detail include. Exam results
 * are a separate future feature.
 *
 * `exam-no-feedback-guard.test.ts` enforces this across the whole exam slice.
 *
 * ===========================================================================
 * SELF-ASSIGNMENT
 * ===========================================================================
 * `isSelf` is matched on AUTHORITATIVE STUDENT IDS ONLY — `traineeId` against a
 * `viewerTraineeId` the caller must resolve from the signed server session,
 * never from a client-supplied value and never by display name. A `null` viewer
 * (admin/instructor context, or an unauthenticated read) marks nobody.
 *
 * ORDERING (locked). `TeachingPracticeLesson` has no `orderIndex` of its own,
 * yet the exam views need one: on a real beginner source date several lessons
 * routinely share a start time (three at one time and four at the next is
 * typical), so `startTime` alone cannot order a day. `orderIndex` is therefore
 * DERIVED per date from `(startTime, createdAt, lessonId)` — a total order
 * whose final key is unique, making the result independent of input order. It
 * is derived on every request and never stored.
 *
 * NO DATE IS EVER HARDCODED HERE. Which dates are beginner source dates is
 * data (`ExamTeachingPracticeSourceDate`), supplied by the caller; this module
 * projects whatever lessons it is handed and never infers, ranks or filters a
 * calendar.
 *
 * FAIL CLOSED: a lesson whose practice type does not map, or which carries no
 * usable id, is REJECTED and reported — never silently defaulted, never
 * partially projected.
 */
import type { ExamBeginnerFormat } from "./exam-domain-core";
import type { ProjectionSession } from "./exam-schedule-projection-core";
import { mapPracticeTypeToBeginnerFormat } from "./exam-beginner-format-core";

// ===========================================================================
// Input — plain, already-read Teaching-Practice data
// ===========================================================================

/** One live `TeachingPracticeParticipant` (plus its trainee's name). */
export interface LiveBeginnerParticipantSource {
  readonly participantId: string;
  readonly traineeId: string;
  readonly traineeName: string;
  /**
   * The RAW Teaching-Practice role token, preserved verbatim. Deliberately a
   * plain string, not the live TP role enum: the exam side must not acquire a
   * compile-time dependency on Teaching-Practice role evolution.
   */
  readonly role: string;
  readonly isManualOverride: boolean;
  /** Opaque sortable creation token (e.g. ISO-8601). Never parsed as a date. */
  readonly createdAt: string;
}

/** One live `TeachingPracticeChildAssignment` joined to its child. */
export interface LiveBeginnerChildSource {
  readonly childAssignmentId: string;
  readonly childId: string;
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  /** `TeachingPracticeChild.notes` — the child's own notes, not the lesson's. */
  readonly childNotes: string | null;
  readonly parentName: string | null;
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/** One live `TeachingPracticeLesson` as read for the exam projection. */
export interface LiveBeginnerLessonSource {
  readonly lessonId: string;
  /** Raw `TeachingPracticeType` token; mapped to an `ExamBeginnerFormat`. */
  readonly practiceType: string;
  /** Opaque calendar day, `YYYY-MM-DD`. Compared by exact string equality. */
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  /** Opaque sortable creation token. Ordering tiebreak only; never parsed. */
  readonly createdAt: string;
  readonly groupName: string | null;
  /** `TeachingPracticeLesson.location` — the beginner row's place field. */
  readonly location: string | null;
  /** The LESSON's own notes (child notes live on each child). */
  readonly notes: string | null;
  readonly isPublished: boolean;
  readonly roleLabelOverrides: Readonly<Record<string, string>> | null;
  readonly responsibleInstructorId: string | null;
  readonly responsibleInstructorName: string | null;
  readonly participants: readonly LiveBeginnerParticipantSource[];
  readonly children: readonly LiveBeginnerChildSource[];
}

export interface LiveBeginnerProjectionInput {
  readonly lessons: readonly LiveBeginnerLessonSource[];
  /**
   * The viewing trainee's authoritative `Student.id`, resolved server-side from
   * the signed session. `null` in admin/instructor contexts — nobody is marked.
   */
  readonly viewerTraineeId: string | null;
}

// ===========================================================================
// Output
// ===========================================================================

/** One trainee participating in a live beginner exam row. */
export interface BeginnerDetailParticipant {
  readonly participantId: string;
  readonly traineeId: string;
  readonly traineeName: string;
  /** The raw Teaching-Practice role token, verbatim. */
  readonly sourcePracticeRole: string;
  readonly isManualOverride: boolean;
  /** True iff this participant IS the viewer (authoritative id match). */
  readonly isSelf: boolean;
}

/** One child in a live beginner exam row. */
export interface BeginnerDetailChild {
  readonly childAssignmentId: string;
  readonly childId: string;
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly childNotes: string | null;
  /** Projected VERBATIM. Visible to admins, instructors and trainees alike. */
  readonly parentName: string | null;
  /** Projected VERBATIM. The UI derives tel:/WhatsApp actions at render time. */
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/** The full operational payload of one live beginner exam row. */
export interface BeginnerDetail {
  /** The synthetic session id, `tp:<lessonId>`. */
  readonly sessionId: string;
  readonly lessonId: string;
  readonly beginnerFormat: ExamBeginnerFormat;
  /** The raw source practice-type token, verbatim. */
  readonly practiceType: string;
  readonly date: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly orderIndex: number;
  readonly groupName: string | null;
  readonly location: string | null;
  readonly notes: string | null;
  /** `TeachingPracticeLesson.isPublished` — the caller applies the gate. */
  readonly isPublished: boolean;
  readonly roleLabelOverrides: Readonly<Record<string, string>> | null;
  readonly responsibleInstructorId: string | null;
  readonly responsibleInstructorName: string | null;
  readonly participants: readonly BeginnerDetailParticipant[];
  readonly children: readonly BeginnerDetailChild[];
  /** True iff the viewer participates in this row — drives "לו״ז שלי". */
  readonly isSelf: boolean;
}

/** One projected beginner row: the view-shaped session plus its full detail. */
export interface LiveBeginnerRow {
  /**
   * Shaped exactly like a stored `ExamSession` projection so the three view
   * cores can consume stored and live rows from ONE flat array without knowing
   * which is which.
   */
  readonly session: ProjectionSession;
  readonly detail: BeginnerDetail;
}

export type LiveBeginnerRejectionReason =
  /** `practiceType` maps to no `ExamBeginnerFormat`. */
  | "UNMAPPED_PRACTICE_TYPE"
  /** No usable `lessonId`, so no synthetic session id can be formed. */
  | "INVALID_LESSON_ID";

export interface LiveBeginnerRejection {
  readonly lessonId: string;
  readonly reason: LiveBeginnerRejectionReason;
}

export interface LiveBeginnerProjection {
  readonly rows: readonly LiveBeginnerRow[];
  readonly rejected: readonly LiveBeginnerRejection[];
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * The synthetic-session-id namespace. A stored `ExamSession.id` is a cuid,
 * which contains only lowercase alphanumerics — so a colon-prefixed token can
 * never collide with one, in either direction.
 */
export const LIVE_BEGINNER_SESSION_ID_PREFIX = "tp:";

/** Build the synthetic session id for a live beginner row. */
export function buildLiveBeginnerSessionId(lessonId: string): string {
  return `${LIVE_BEGINNER_SESSION_ID_PREFIX}${lessonId}`;
}

/** True for a synthetic live-beginner session id (never a stored ExamSession). */
export function isLiveBeginnerSessionId(sessionId: unknown): boolean {
  return (
    typeof sessionId === "string" && sessionId.startsWith(LIVE_BEGINNER_SESSION_ID_PREFIX)
  );
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A non-empty, trimmed identifier; otherwise absent. */
function isPresentId(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * A frozen shallow copy of the role-label overrides. Copied rather than frozen
 * in place: freezing the caller's own object would mutate its extensibility,
 * and this module never touches its inputs.
 */
function copyRoleLabelOverrides(
  value: Readonly<Record<string, string>> | null,
): Readonly<Record<string, string>> | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  const out: Record<string, string> = {};
  for (const key of Object.keys(value)) {
    // Own keys only, so an inherited/prototype key can never be projected.
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const label = value[key];
    if (typeof label === "string") out[key] = label;
  }
  return Object.freeze(out);
}

// ===========================================================================
// The adapter
// ===========================================================================

/**
 * Project live Teaching-Practice lessons into beginner exam rows. Pure; never
 * mutates its inputs; deterministic regardless of input order.
 *
 * ROLE RULE (locked): EVERY trainee participant becomes an EXAMINEE, INCLUDING
 * the participant currently carrying the Teaching-Practice `EVALUATOR` role.
 * The exact original role is preserved separately in `sourcePracticeRole` as a
 * plain string. `instructedTraineeStudentIds` is ALWAYS empty — instructed
 * trainees are an ADVANCED_INSTRUCTION concept and never a beginner one.
 */
export function projectLiveBeginnerRows(
  input: LiveBeginnerProjectionInput,
): LiveBeginnerProjection {
  const viewerTraineeId = isPresentId(input.viewerTraineeId)
    ? input.viewerTraineeId.trim()
    : null;

  const accepted: {
    lesson: LiveBeginnerLessonSource;
    beginnerFormat: ExamBeginnerFormat;
  }[] = [];
  const rejected: LiveBeginnerRejection[] = [];

  const lessons = Array.isArray(input.lessons) ? input.lessons : [];
  for (const lesson of lessons) {
    if (!isPresentId(lesson.lessonId)) {
      rejected.push(Object.freeze({ lessonId: "", reason: "INVALID_LESSON_ID" as const }));
      continue;
    }
    const beginnerFormat = mapPracticeTypeToBeginnerFormat(lesson.practiceType);
    if (beginnerFormat === null) {
      rejected.push(
        Object.freeze({
          lessonId: lesson.lessonId,
          reason: "UNMAPPED_PRACTICE_TYPE" as const,
        }),
      );
      continue;
    }
    accepted.push({ lesson, beginnerFormat });
  }

  // Sort a COPY. The total order (date, startTime, createdAt, lessonId) ends in
  // a unique key, so the result cannot depend on the caller's array order.
  accepted.sort(
    (a, b) =>
      cmp(a.lesson.date, b.lesson.date) ||
      cmp(a.lesson.startTime, b.lesson.startTime) ||
      cmp(a.lesson.createdAt, b.lesson.createdAt) ||
      cmp(a.lesson.lessonId, b.lesson.lessonId),
  );

  // orderIndex restarts at 0 on each date: it positions a lesson WITHIN its
  // day, exactly as a stored ExamSession.orderIndex does.
  const rows: LiveBeginnerRow[] = [];
  let currentDate: string | null = null;
  let orderIndex = 0;

  for (const { lesson, beginnerFormat } of accepted) {
    if (currentDate === null || lesson.date !== currentDate) {
      currentDate = lesson.date;
      orderIndex = 0;
    } else {
      orderIndex += 1;
    }

    const sessionId = buildLiveBeginnerSessionId(lesson.lessonId);

    const sourceParticipants = Array.isArray(lesson.participants) ? lesson.participants : [];
    const participants = [...sourceParticipants]
      .sort(
        (a, b) => cmp(a.createdAt, b.createdAt) || cmp(a.participantId, b.participantId),
      )
      .map((p) =>
        Object.freeze({
          participantId: p.participantId,
          traineeId: p.traineeId,
          traineeName: p.traineeName,
          sourcePracticeRole: p.role,
          isManualOverride: p.isManualOverride === true,
          isSelf: viewerTraineeId !== null && p.traineeId === viewerTraineeId,
        }),
      );

    const sourceChildren = Array.isArray(lesson.children) ? lesson.children : [];
    const children = [...sourceChildren]
      .sort(
        (a, b) => cmp(a.fullName, b.fullName) || cmp(a.childAssignmentId, b.childAssignmentId),
      )
      .map((c) =>
        Object.freeze({
          childAssignmentId: c.childAssignmentId,
          childId: c.childId,
          fullName: c.fullName,
          age: c.age,
          gender: c.gender,
          childNotes: c.childNotes,
          parentName: c.parentName,
          parentPhone: c.parentPhone,
          horseName: c.horseName,
          equipmentNotes: c.equipmentNotes,
          isAbsent: c.isAbsent === true,
        }),
      );

    // EVERY participant is an examinee — the EVALUATOR included. Blank ids are
    // dropped so a malformed row cannot poison the distinct-count aggregates.
    const examineeStudentIds = Object.freeze(
      participants.map((p) => p.traineeId).filter((id) => isPresentId(id)),
    );

    const isSelf = participants.some((p) => p.isSelf);

    const session: ProjectionSession = Object.freeze({
      sessionId,
      kind: "BEGINNER_INSTRUCTION" as const,
      beginnerFormat,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      orderIndex,
      examineeStudentIds,
      // Always empty: instructed trainees are ADVANCED_INSTRUCTION-only.
      instructedTraineeStudentIds: Object.freeze([]),
      beginnerChildCount: children.length,
    });

    const detail: BeginnerDetail = Object.freeze({
      sessionId,
      lessonId: lesson.lessonId,
      beginnerFormat,
      practiceType: lesson.practiceType,
      date: lesson.date,
      startTime: lesson.startTime,
      endTime: lesson.endTime,
      orderIndex,
      groupName: lesson.groupName,
      location: lesson.location,
      notes: lesson.notes,
      isPublished: lesson.isPublished === true,
      roleLabelOverrides: copyRoleLabelOverrides(lesson.roleLabelOverrides),
      responsibleInstructorId: lesson.responsibleInstructorId,
      responsibleInstructorName: lesson.responsibleInstructorName,
      participants: Object.freeze(participants),
      children: Object.freeze(children),
      isSelf,
    });

    rows.push(Object.freeze({ session, detail }));
  }

  return Object.freeze({
    rows: Object.freeze(rows),
    rejected: Object.freeze(rejected),
  });
}
