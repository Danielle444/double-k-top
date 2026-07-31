/**
 * EXAM EX-S5A-4A — PURE, role-specific exam READ DTO narrowing.
 *
 * PURE by construction: no database client, no generated database type, no DB,
 * no Next, no React, no clock (`Date.now` / `new Date`), no randomness, no env,
 * no auth/session/cookie, no capability, no course resolution, no filesystem, no
 * network, no `"use server"`. Deterministic; never mutates its inputs; never
 * throws for malformed runtime input.
 *
 * WHAT THIS ANSWERS (and only this): given the INTERNAL, role-neutral
 * {@link ExamPlanPayload} — or the committed trainee day projection built from
 * it — what is the plain, client-safe data contract for ONE resolved role?
 *
 * ===========================================================================
 * THIS IS NARROWING. IT IS NOT AUTHORIZATION.
 * ===========================================================================
 * Nothing in this file decides WHO may call it. There is no role check, no
 * capability check, no enrollment check, no publication check and no actor
 * lookup here, and none may be added: a check in a pure builder is a check the
 * caller can skip by calling a different builder.
 *
 * The EX-S5A-4B wrapper is the thing that authorizes. Its order is fixed:
 *
 *   1. resolve the actor from the signed server session;
 *   2. prove the actor may read THIS course offering in THIS role;
 *   3. choose the loader's publication options FROM that proven role;
 *   4. call `loadExamPlan`;
 *   5. pass the internal payload through the builder for that role;
 *   6. return ONLY the builder's result.
 *
 * Calling a builder proves nothing about the caller. Passing an admin payload
 * to `buildTraineeExamDayDto` narrows the FIELDS but does not make the reader a
 * trainee, and passing a trainee's payload to `buildAdminExamReadDto` returns
 * admin-shaped data to whoever asked. Step 2 is the boundary; this file is the
 * blast radius reduction behind it.
 *
 * ===========================================================================
 * WHY IT EXISTS: ExamPlanPayload IS A SENSITIVE SUPERSET
 * ===========================================================================
 * The internal payload deliberately carries more than ANY single viewer may
 * see — every assigned `Student.id` (including other people's), the stored
 * per-assignment slot detail, the conflict input, the live beginner
 * participants, and the children's names, ages, genders, notes and PARENT
 * CONTACT NUMBERS. It must never be returned from a Server Action, a Server
 * Component, a route handler or an API response, and must never be embedded in
 * props that reach the browser.
 *
 * PRIVACY HERE COMES FROM FIELD OMISSION AND NOTHING ELSE. Every builder
 * constructs BRAND-NEW plain objects and arrays field by field; no builder
 * spreads, copies wholesale, casts or re-exports an internal object, so a field
 * that is not written out below cannot reach a client through this layer. A
 * field is present because it was listed as visible for that role — never
 * because it happened to be on the source object.
 *
 * `Object.freeze` on the results is MUTATION PROTECTION ONLY. It performs no
 * authorization, filters no field, is shallow-by-design at runtime, and neither
 * prevents nor detects a value being handed to a serializer. Reading it as a
 * privacy or serialization barrier would be the exact mistake this note exists
 * to prevent.
 *
 * ===========================================================================
 * NAMES ARE INJECTED, NEVER RESOLVED HERE
 * ===========================================================================
 * `Student.id` and `Instructor.id` are LOOKUP KEYS INSIDE THE SERVER PROCESS
 * and nothing else. This module turns them into display names through the
 * caller-supplied {@link ExamDisplayNameLookup} and then DROPS them: no builder
 * emits a foreign student id, and the trainee contract emits no student id at
 * all.
 *
 * A name is resolved by EXACT id key. Never by national id, user id, email,
 * array position, fuzzy match or display-name comparison. An id with no entry
 * resolves to NOTHING — no placeholder person is invented and the id is never
 * substituted as a name (that would leak the very value the lookup exists to
 * remove). See PARTICIPANT COUNTS below for what happens instead.
 *
 * ===========================================================================
 * PARTICIPANT COUNTS ARE AUTHORITATIVE; NAMES ARE BEST-EFFORT
 * ===========================================================================
 * `examineeCount` counts the authoritative participant-ID array. `examineeNames`
 * holds only the ids that RESOLVED. So three examinees with two known names is
 * reported as `count: 3` with two names — the truth, without leaking the third
 * id and without pretending the third person does not exist.
 *
 * Display names are NEVER identity: duplicates are preserved verbatim, rows are
 * never merged or deduplicated by name, and the source participant ORDER is
 * preserved exactly. Two trainees really can share a full name.
 *
 * ===========================================================================
 * FAIL CLOSED ON THE SENSITIVE SIBLING
 * ===========================================================================
 * A live beginner row's child and parent-contact detail attaches by EXACT
 * session id and by nothing else — never by lesson title, date, format or array
 * position. If the detail is missing, or if the entry found under the row's id
 * declares a DIFFERENT session id, the child/contact detail is OMITTED and the
 * compact row survives without it. An unrelated child, and an unrelated parent
 * phone number, is strictly worse than no detail at all.
 *
 * A stored block's ARENA attaches under exactly the same rule, through its own
 * narrow sibling — see {@link TraineeExamSessionDisplayDetail}.
 *
 * ===========================================================================
 * ONLY PROJECTED BEGINNER PARTICIPANTS ARE VISIBLE
 * ===========================================================================
 * The Teaching-Practice source adapter RETAINS a participant whose role token it
 * did not recognise, marked `isProjected: false`, so the defect stays visible as
 * an `EX-TP-ADP-*` diagnostic rather than vanishing. Such a row is NOT part of
 * the live lesson: it contributes no examinee identity upstream, and it appears
 * in neither the visible participant names nor the participant COUNT of any DTO
 * here — trainee, admin and instructor alike. A diagnostic may report the
 * rejected row; the visible list describes the lesson.
 *
 * The committed FLAG is the only test — projection eligibility is never
 * re-derived from the role string here. See {@link isProjectedParticipant}.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ===========================================================================
 *  - NO feedback, rating, grade, score or result — not nulled, not optional:
 *    ABSENT, exactly as in every committed exam core.
 *  - NO `Map`, `Set`, `Date`, `BigInt`, function or class instance in any
 *    returned value. Every DTO is plain JSON data (object / array / string /
 *    number / boolean / null) and survives a `JSON.stringify` → `JSON.parse`
 *    round trip unchanged. Optional data is OMITTED or `null`, never
 *    `undefined`, so serializers cannot differ about it.
 *  - NO recomputation of anything a committed core owns. `isSelf`, the personal
 *    times, the row order and the projection itself arrive already computed;
 *    this module re-derives none of them.
 *  - NO conflict DETECTION and no conflict payload. The stored conflict INPUT is
 *    read for exactly TWO display scalars — `arenaId` and `supervisorIds` — in
 *    the operational builders only. Nothing else of it is read, and the trainee
 *    builder is not even given it (see its signature): a trainee's arena arrives
 *    through a sibling contract that can express an arena and nothing else.
 *  - NO write, no id intended for editing. Where a display name suffices, the
 *    underlying id is omitted; an operational UI that later needs an
 *    authoritative id for an EDIT must add it in that write slice, with its own
 *    review, rather than pre-exposing it now.
 */
import type {
  ExamAssignmentRole,
  ExamBeginnerFormat,
  ExamKind,
} from "./exam-domain-core";
import type {
  ProjectionSession,
  ProjectionTimetableStatus,
} from "./exam-schedule-projection-core";
import type {
  BeginnerDetail,
  LiveBeginnerRejectionReason,
} from "./exam-live-beginner-adapter-core";
import type {
  TraineeExamDayProjection,
  TraineeExamRole,
} from "./exam-trainee-view-core";
import type {
  ExamPlanPayload,
  ExamPlanLoaderIssueCode,
} from "./exam-plan-loader-core";
import type {
  StoredExamAssignmentOperationalRow,
  StoredExamBlockOperationalDetail,
  StoredExamAdapterIssueCode,
} from "./exam-stored-adapter-core";
import type { TeachingPracticeSourceAdapterIssueCode } from "./exam-tp-source-adapter-core";
import type {
  ExamTimetableIssueCode,
  ExamTimetableWarningCode,
} from "./exam-block-timetable-core";
import type { ExamDefinitionIssueCode } from "./exam-definition-validation-core";

// ===========================================================================
// Shared inputs
// ===========================================================================

/**
 * The caller-supplied display-name lookups.
 *
 * SUPPLIED AS PLAIN SIBLING INPUT — this module performs no IO and resolves no
 * name itself. Keys are authoritative `Student.id` / `Instructor.id` values, and
 * they are used ONLY as keys: no builder emits a key back out.
 *
 * A missing lookup, a non-`Map` value, a non-string name and a blank name all
 * read the same way: NOT RESOLVED. Nothing is fabricated.
 */
export interface ExamDisplayNameLookup {
  /** `Student.id` → display name. */
  readonly studentNames: ReadonlyMap<string, string>;
  /** `Instructor.id` → display name. */
  readonly instructorNames: ReadonlyMap<string, string>;
}

/** Where a projected row came from. Derived from `kind`, never from an id shape. */
export type ExamRowSource = "STORED" | "BEGINNER";

/**
 * The NARROW, server-internal sibling that carries a stored block's visible
 * operational place to a trainee.
 *
 * WHY IT EXISTS AS ITS OWN CONTRACT. `ProjectionSession` does not carry an
 * arena, and the only arena value in the internal payload sits on the conflict
 * INPUT — a structure that also holds supervisor ids, per-assignment intervals,
 * slots, horses, examiner sets and staffing state. Handing the trainee builder
 * that structure to reach ONE display string would put all of it one field
 * access away from a client payload. So the caller extracts the single scalar
 * server-side and passes THIS, which is unable to express anything else.
 *
 * It is an INPUT ONLY. No `Map` and no field of this type appears in a returned
 * DTO — the arena is copied onto the row as a plain `string | null`.
 *
 * EX-S5A-4B builds this lookup from the internal payload AFTER authorizing, and
 * before calling the builder. It is never assembled in the browser.
 */
export interface TraineeExamSessionDisplayDetail {
  readonly sessionId: string;
  /** The stored block's arena. Trimmed; blank reads as `null`. */
  readonly arena: string | null;
}

/** The sibling lookup: stored `sessionId` → its visible display detail. */
export type TraineeExamSessionDisplayDetailLookup = ReadonlyMap<
  string,
  TraineeExamSessionDisplayDetail
>;

/** The row label for the viewing trainee's OWN row. */
export const TRAINEE_SELF_ROW_LABEL = "השיבוץ שלי";

/** The sibling lookup: stored `sessionId` → its assignment-level detail. */
export type ExamAssignmentOperationalDetailLookup = ReadonlyMap<
  string,
  StoredExamBlockOperationalDetail
>;

// ===========================================================================
// The assignment-level operational row — SHARED by every authorized role
// ===========================================================================

/**
 * ONE participant of ONE stored exam block, as the COMPLETE OPERATIONAL
 * SCHEDULE displays them.
 *
 * IT IS THE SAME CONTRACT FOR AN INSTRUCTOR AND FOR A TRAINEE, deliberately.
 * The trainee's "לו״ז כולל" is a complete operational schedule rather than a
 * privacy-narrowed list of names: a trainee needs to see who rides which horse,
 * on which topic, at which exact minute, paired with whom — otherwise the
 * screen cannot be acted on. What separates the roles is WHICH ROWS each is
 * handed (publication, the selected day, the resolved course), which is decided
 * before this file is reached, and never which of these fields exists.
 *
 * WHAT IS ABSENT, AND WHY IT STAYS ABSENT:
 *  - `assignmentId`, `studentId`, `sessionId`, `courseOfferingId`, enrollment id
 *    — a display row needs no identity, and the two are not interchangeable;
 *  - `pairingIndex` — the numeric scheduling input. The pairing it expresses is
 *    already RESOLVED into names below, and exposing the raw index would let a
 *    UI invent a second, disagreeing pairing rule;
 *  - the assignment's `notes`, the session's `title` and `notes` — none is an
 *    approved visible value;
 *  - national id, email, phone, parent detail and every raw row.
 *
 * `participantName` is `string | null`, not `string`: an id that resolves to no
 * name yields NOTHING. Substituting the id would leak the very value the lookup
 * exists to remove, and substituting `""` would render a person with a blank
 * name — so the row survives with its horse, topic and time, and says plainly
 * that the name could not be resolved. This is the same rule
 * {@link resolveName} already applies everywhere else in this file.
 */
export interface ExamAssignmentOperationalRowDto {
  /** The resolved display name, or `null` when it could not be resolved. */
  readonly participantName: string | null;
  readonly role: ExamAssignmentRole;
  /** The EXAMINEE's horse. Always `null` on an instructed-trainee row. */
  readonly horseName: string | null;
  /** Inherited from the paired examinee on an instructed-trainee row. */
  readonly instructionTopic: string | null;
  /** Inherited from the paired examinee on an instructed-trainee row. */
  readonly discipline: string | null;
  /** The participant's EXACT personal start. Never the block start. */
  readonly personalStartTime: string | null;
  /** The participant's EXACT personal end. Never the block end. */
  readonly personalEndTime: string | null;
  /**
   * The ONE paired participant's name, when the pairing resolves to exactly one
   * NAMED partner. `null` for none, for an ambiguous pairing, for a partner
   * whose name could not be resolved, and for an examinee with several paired
   * instructed trainees — see {@link pairedParticipantNames}.
   */
  readonly pairedParticipantName: string | null;
  /**
   * EVERY paired participant's resolved name, in the resolved pairing order.
   *
   * An examinee legitimately instructs several trainees, and joining their names
   * into one string would produce a value no consumer could split back apart, so
   * the list is the contract and `pairedParticipantName` is the convenience for
   * the single-partner case. EMPTY for an unresolved or ambiguous pairing —
   * never a guessed partner.
   */
  readonly pairedParticipantNames: readonly string[];
}

// ===========================================================================
// Narrowing issues — SERVER-SIDE ONLY, and PII-free
// ===========================================================================

/**
 * Stable, non-PII codes for contradictions THIS NARROWING detects. They are
 * deliberately few: the domain diagnostics belong to the committed cores, and a
 * DTO layer that invents domain issues has started deciding domain questions.
 *
 * These NEVER reach a trainee — {@link TraineeExamDayDto} has no issue channel
 * at all, by design.
 */
export type ExamReadDtoIssueCode =
  /** A live beginner row arrived with no usable sibling detail. */
  | "EX-DTO-BEGINNER-DETAIL-REQUIRED"
  /** The detail found under a row's session id declares a different session. */
  | "EX-DTO-BEGINNER-DETAIL-CONFLICT"
  /** The supplied name lookup is unusable; no name could be resolved from it. */
  | "EX-DTO-NAME-LOOKUP-UNUSABLE";

/**
 * The authoritative code → Hebrew message table. The exhaustive
 * `Record<ExamReadDtoIssueCode, string>` annotation forces every code — present
 * or future — to carry a message or this file will not compile.
 */
export const EXAM_READ_DTO_MESSAGES: Readonly<
  Record<ExamReadDtoIssueCode, string>
> = Object.freeze({
  "EX-DTO-BEGINNER-DETAIL-REQUIRED":
    "לא נמצאו פרטי שיעור מתחילים לשורת הבחינה — פרטי הילדים ואנשי הקשר אינם מוצגים",
  "EX-DTO-BEGINNER-DETAIL-CONFLICT":
    "פרטי שיעור המתחילים אינם תואמים למזהה שורת הבחינה — הפרטים אינם מוצגים",
  "EX-DTO-NAME-LOOKUP-UNUSABLE":
    "לא התקבלה טבלת שמות תקינה — שמות משתתפים אינם מוצגים",
});

/**
 * One narrowing issue. Carries the observable `sessionId` and NOTHING else — no
 * student id, no name, no phone number, no horse name, no note and no title. An
 * issue list is a diagnostic channel, never a PII channel.
 */
export interface ExamReadDtoIssue {
  readonly code: ExamReadDtoIssueCode;
  readonly message: string;
  readonly sessionId: string | null;
}

// ===========================================================================
// Client-safe beginner detail
// ===========================================================================

/**
 * ONE child of a live beginner exam row, as it may be displayed.
 *
 * `childAssignmentId` is the STABLE DISPLAY-ROW KEY and the only id here.
 * `childId` is deliberately absent — a list key does not need the child's own
 * identity, and the two are not interchangeable.
 *
 * `parentPhone` is carried RAW AND UNCHANGED: it is not normalized, reformatted,
 * masked or turned into a `tel:` / WhatsApp target. Deriving an action from it
 * is a UI concern at render time, and a link built here would be a link nobody
 * reviewed.
 *
 * Child and parent contact detail is available to EVERY authorized exam-access
 * role, trainees included — that is the locked product decision, not an
 * oversight. The gate is WHICH ROWS a role is handed, not which fields.
 */
export interface ExamBeginnerChildDto {
  readonly childAssignmentId: string;
  readonly fullName: string;
  readonly age: number | null;
  readonly gender: string | null;
  readonly childNotes: string | null;
  readonly parentName: string | null;
  /** Verbatim. Never normalized, never linkified. */
  readonly parentPhone: string | null;
  readonly horseName: string | null;
  readonly equipmentNotes: string | null;
  readonly isAbsent: boolean;
}

/**
 * The client-safe beginner detail a TRAINEE may see.
 *
 * `traineeId`, `childId`, `responsibleInstructorId`, `roleLabelOverrides`, the
 * lesson's own `notes` and `isPublished` are all ABSENT: the first three are
 * identities a trainee never needs, the fourth produces no visible label yet,
 * and the last two are operational state.
 */
export interface TraineeExamBeginnerDetailDto {
  readonly sessionId: string;
  readonly lessonId: string;
  readonly beginnerFormat: ExamBeginnerFormat;
  readonly groupName: string | null;
  readonly location: string | null;
  readonly responsibleInstructorName: string | null;
  /**
   * Resolved display names of the PROJECTED participants, in source order.
   * Duplicates preserved. See {@link isProjectedParticipant}: a participant the
   * Teaching-Practice source adapter held back (`isProjected: false`) is not
   * part of the live lesson and appears neither here nor in the count.
   */
  readonly participantNames: readonly string[];
  /**
   * The AUTHORITATIVE count of PROJECTED participants — may exceed
   * `participantNames.length` when a name could not be resolved.
   */
  readonly participantCount: number;
  readonly children: readonly ExamBeginnerChildDto[];
}

/**
 * The beginner detail an ADMIN or INSTRUCTOR may see: the trainee contract plus
 * the operational state they act on — the raw practice type, the LESSON's own
 * notes and the lesson publication flag.
 */
export interface OperationalExamBeginnerDetailDto {
  readonly sessionId: string;
  readonly lessonId: string;
  readonly beginnerFormat: ExamBeginnerFormat;
  /** The raw Teaching-Practice source token, verbatim. */
  readonly practiceType: string;
  readonly groupName: string | null;
  readonly location: string | null;
  /** The LESSON's own notes. Operational roles only. */
  readonly notes: string | null;
  /** `TeachingPracticeLesson.isPublished`. Operational roles only. */
  readonly isPublished: boolean;
  readonly responsibleInstructorName: string | null;
  /**
   * The PROJECTED participants only — the same rule the trainee contract uses.
   * A rejected source row stays observable as an `EX-TP-ADP-*` diagnostic; the
   * visible participant list describes the lesson, not the defect.
   */
  readonly participantNames: readonly string[];
  readonly participantCount: number;
  readonly children: readonly ExamBeginnerChildDto[];
}

// ===========================================================================
// Trainee DTO
// ===========================================================================

/**
 * ONE exam row as a trainee sees it, in "לו״ז כולל" and — when `isSelf` — in
 * "לו״ז שלי".
 *
 * WHAT IS ABSENT, AND WHY IT STAYS ABSENT: `examineeStudentIds`,
 * `instructedTraineeStudentIds`, `viewerStudentId`, any foreign `Student.id`,
 * the stored assignment slots, `StoredExamBlockDetail`, the conflict input,
 * every diagnostic and `EX-*` code, `individualPublishedAt`, the plan's
 * `updatedAt` and any unapproved notes. Self-state arrives here as the BOOLEAN
 * `isSelf`, computed upstream by the committed trainee core — no id crosses the
 * boundary for a client to compare.
 *
 * `arena` IS visible operational information a trainee needs, and it arrives
 * through the narrow {@link TraineeExamSessionDisplayDetail} sibling — never
 * from the conflict input, which this builder is not given.
 */
export interface TraineeExamDayRowDto {
  readonly sessionId: string;
  readonly source: ExamRowSource;
  readonly kind: ExamKind;
  readonly beginnerFormat: ExamBeginnerFormat | null;
  /** Opaque calendar day, `YYYY-MM-DD`. */
  readonly date: string;
  /** The row's block start, `HH:MM`. Not the viewer's personal start. */
  readonly startTime: string;
  /**
   * The row's block end for DISPLAY, or `null` when it has none. Follows the
   * committed end-time rule: the derived block end for a resolved stored block,
   * the real lesson end for a live beginner row.
   */
  readonly displayEndTime: string | null;
  readonly definitionId: string | null;
  readonly definitionName: string | null;
  /** The stored block's arena, from the narrow display sibling. `null` for a
   * live beginner row, which carries its own `location` instead. */
  readonly arena: string | null;
  /** A live beginner lesson's place. `null` for a stored block. */
  readonly location: string | null;
  readonly isSelf: boolean;
  /** "השיבוץ שלי" when this is the viewer's own row; otherwise `null`. */
  readonly selfLabel: string | null;
  readonly selfRole: TraineeExamRole | null;
  /** The viewer's EXACT personal start. Never the block start. */
  readonly selfStartTime: string | null;
  /** The viewer's EXACT personal end. Never the block end. */
  readonly selfEndTime: string | null;
  readonly examineeNames: readonly string[];
  readonly examineeCount: number;
  readonly instructedTraineeNames: readonly string[];
  readonly instructedTraineeCount: number;
  readonly beginnerChildCount: number;
  /**
   * The COMPLETE assignment-level operational rows of a stored block, in the
   * committed adapter order.
   *
   * "לו״ז כולל" is intentionally the full operational schedule, so this is
   * populated for EVERY visible row and not only for the viewer's own — the
   * viewer's own row remains identifiable through `isSelf` / `selfLabel`.
   *
   * ALWAYS EMPTY for a live beginner row: a beginner lesson has no stored exam
   * assignment, and its participants and children already travel on
   * {@link TraineeExamBeginnerDetailDto}. An empty list is never a claim that a
   * block holds nobody — a stored block that holds nobody is simply empty too.
   */
  readonly assignments: readonly ExamAssignmentOperationalRowDto[];
  readonly beginner: TraineeExamBeginnerDetailDto | null;
}

/**
 * The trainee day contract behind BOTH trainee views.
 *
 * `myRows` holds the SAME row objects as `allRows`, filtered by `isSelf` — never
 * a second mapping of the projection, never a second model. Comparing by
 * reference is a valid and intentional test of this contract.
 */
export interface TraineeExamDayDto {
  /** "לו״ז כולל" — every visible row of the selected date, in the locked order. */
  readonly allRows: readonly TraineeExamDayRowDto[];
  /** "לו״ז שלי" — exactly `allRows.filter(row => row.isSelf)`. */
  readonly myRows: readonly TraineeExamDayRowDto[];
}

// ===========================================================================
// Admin / instructor operational DTO
// ===========================================================================

/** One stored-adapter diagnostic, as plain data. */
export interface ExamStoredAdapterIssueDto {
  readonly code: StoredExamAdapterIssueCode;
  readonly message: string;
  readonly sessionId: string | null;
  readonly definitionId: string | null;
  readonly assignmentId: string | null;
}

/** One timetable issue or warning, as plain data. */
export interface ExamTimetableDiagnosticDto {
  readonly code: ExamTimetableIssueCode | ExamTimetableWarningCode;
  readonly message: string;
  /** Structured, non-PII tokens. */
  readonly details: readonly string[];
}

/** One definition-conformance diagnostic, as plain data. */
export interface ExamDefinitionIssueDto {
  readonly code: ExamDefinitionIssueCode;
  readonly message: string;
  readonly assignmentId: string | null;
}

/** The per-projected-block diagnostics, as plain data. */
export interface ExamStoredBlockDiagnosticDto {
  readonly sessionId: string;
  readonly definitionId: string | null;
  readonly timetableIssues: readonly ExamTimetableDiagnosticDto[];
  readonly timetableWarnings: readonly ExamTimetableDiagnosticDto[];
  readonly definitionIssues: readonly ExamDefinitionIssueDto[];
  readonly adapterIssues: readonly ExamStoredAdapterIssueDto[];
}

/** One Teaching-Practice source diagnostic, as plain data. */
export interface ExamTeachingPracticeSourceIssueDto {
  readonly code: TeachingPracticeSourceAdapterIssueCode;
  readonly message: string;
  readonly lessonId: string | null;
  readonly participantId: string | null;
  readonly childAssignmentId: string | null;
}

/** One rejected live beginner lesson, as plain data. */
export interface ExamBeginnerRejectionDto {
  readonly lessonId: string;
  readonly reason: LiveBeginnerRejectionReason;
}

/** One loader diagnostic, as plain data. */
export interface ExamPlanLoaderIssueDto {
  readonly code: ExamPlanLoaderIssueCode;
  readonly message: string;
  readonly sessionId: string | null;
  readonly lessonId: string | null;
}

/**
 * The operational diagnostics an admin or instructor receives.
 *
 * Every entry is a stable code, its canonical message and non-PII
 * session/definition/assignment/lesson identifiers — exactly what the committed
 * contracts already carry. NO name, phone number, horse name, note or title is
 * ever added to a diagnostic here.
 */
export interface OperationalExamDiagnosticsDto {
  readonly storedAdapterIssues: readonly ExamStoredAdapterIssueDto[];
  readonly storedBlockDiagnostics: readonly ExamStoredBlockDiagnosticDto[];
  readonly teachingPracticeSourceIssues: readonly ExamTeachingPracticeSourceIssueDto[];
  readonly beginnerRejections: readonly ExamBeginnerRejectionDto[];
  readonly loaderIssues: readonly ExamPlanLoaderIssueDto[];
  /** `EX-DTO-*` — contradictions this narrowing itself detected. */
  readonly narrowingIssues: readonly ExamReadDtoIssue[];
}

/**
 * ONE exam row as an admin or instructor sees it.
 *
 * `supervisorNames` and `arena` are the ONLY two values read from the payload's
 * conflict INPUT, and they are read as DISPLAY data: the supervisor ids are
 * resolved through the instructor lookup and then dropped, and no assignment,
 * participant, interval, slot, examiner-set, horse or staffing field of that
 * input is read at all.
 *
 * There is no `title` and no stored-session `notes` field: neither is carried on
 * the internal payload, and this module invents nothing that is not in it. The
 * stored per-assignment SLOTS are likewise absent — they carry assignment and
 * student ids, and no approved operational read needs them yet.
 */
export interface OperationalExamRowDto {
  readonly sessionId: string;
  readonly source: ExamRowSource;
  readonly kind: ExamKind;
  readonly beginnerFormat: ExamBeginnerFormat | null;
  readonly date: string;
  readonly startTime: string;
  /** The row's own stored/lesson end, verbatim. */
  readonly endTime: string;
  /** The end this row is DISPLAYED and measured by, or `null`. */
  readonly displayEndTime: string | null;
  /** The timetable's own derived block end, when it produced one. */
  readonly derivedBlockEndTime: string | null;
  readonly timetableStatus: ProjectionTimetableStatus | null;
  readonly definitionId: string | null;
  readonly definitionName: string | null;
  /** The stored block's arena. `null` for a live beginner row. */
  readonly arena: string | null;
  /** A live beginner lesson's place. `null` for a stored block. */
  readonly location: string | null;
  readonly examineeNames: readonly string[];
  readonly examineeCount: number;
  readonly instructedTraineeNames: readonly string[];
  readonly instructedTraineeCount: number;
  readonly beginnerChildCount: number;
  /**
   * Resolved supervisor display names. `ExamSessionSupervisor` is DISPLAY DATA:
   * it is not, and must never become, an authorization gate — an instructor's
   * access is decided by the EX-S5A-4B wrapper, not by appearing on a row.
   */
  readonly supervisorNames: readonly string[];
  /** The AUTHORITATIVE supervisor count — may exceed `supervisorNames.length`. */
  readonly supervisorCount: number;
  /**
   * The COMPLETE assignment-level operational rows of a stored block, in the
   * committed adapter order — the same contract the trainee day receives.
   *
   * PRESENT FOR AN UNRESOLVED BLOCK TOO, with `null` personal times throughout:
   * an operational role keeps such a block together with its diagnostics, and
   * knowing WHO is in a block whose timetable failed is exactly what makes it
   * fixable. ALWAYS EMPTY for a live beginner row.
   */
  readonly assignments: readonly ExamAssignmentOperationalRowDto[];
  readonly beginner: OperationalExamBeginnerDetailDto | null;
}

/**
 * The operational read contract shared by the admin and instructor builders.
 *
 * They are IDENTICAL today: both roles are handed draft AND published
 * operational data once their own EX-S5A-4B wrapper has authorized them, and no
 * approved field distinguishes them yet. The EXAMS capability does not exist, so
 * nothing here consults one — and no placeholder for one may be added, because a
 * placeholder check reads as enforcement to the next reader.
 *
 * They remain SEPARATE PUBLIC BUILDERS so a future policy split (a narrower
 * instructor row, for instance) changes this file and not every call site.
 */
export interface OperationalExamReadDto {
  readonly viewerRole: "ADMIN" | "INSTRUCTOR";
  readonly planId: string | null;
  readonly isPublished: boolean;
  /** Epoch ms, or `null`. Plan-level publication state — never a `Date`. */
  readonly publishedAt: number | null;
  /** The plan's explicit Teaching-Practice source dates. */
  readonly sourceDates: readonly string[];
  readonly rows: readonly OperationalExamRowDto[];
  readonly diagnostics: OperationalExamDiagnosticsDto;
}

/** The admin reading. Identical in shape to the instructor's today. */
export type AdminExamReadDto = OperationalExamReadDto & { readonly viewerRole: "ADMIN" };

/** The instructor reading. Identical in shape to the admin's today. */
export type InstructorExamReadDto = OperationalExamReadDto & {
  readonly viewerRole: "INSTRUCTOR";
};

// ===========================================================================
// Helpers
// ===========================================================================

/** The live Teaching-Practice beginner kind. Compared, never constructed. */
const BEGINNER_KIND = "BEGINNER_INSTRUCTION";

function isPresent(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** The trimmed id, or `null` when absent/blank. Whitespace is never identity. */
function idOrNull(v: unknown): string | null {
  return isPresent(v) ? v.trim() : null;
}

/** A required display string; anything illegible becomes `""` rather than `undefined`. */
function text(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** An optional display string, VERBATIM. Blank stays blank; never `undefined`. */
function textOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** A finite number, or `null`. Never `NaN`, never `Infinity`, never `undefined`. */
function numberOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A finite count, or `0`. */
function countOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Safe read from a possibly-absent, possibly-not-a-`Map` lookup. */
function mapGet<T>(lookup: ReadonlyMap<string, T> | null | undefined, key: string): T | null {
  if (lookup === null || lookup === undefined) return null;
  if (typeof (lookup as { get?: unknown }).get !== "function") return null;
  const value = lookup.get(key);
  return value === undefined || value === null ? null : value;
}

/** True iff the value can serve as a display-name lookup at all. */
function isUsableLookup(v: unknown): boolean {
  return v !== null && v !== undefined && typeof (v as { get?: unknown }).get === "function";
}

/**
 * ONE id → ONE display name, or `null`.
 *
 * The id is used as a KEY and is never returned: an unresolved id yields `null`,
 * never the id itself and never a fabricated placeholder.
 */
function resolveName(
  lookup: ReadonlyMap<string, string> | null | undefined,
  id: unknown,
): string | null {
  const key = idOrNull(id);
  if (key === null) return null;
  const raw = mapGet(lookup, key);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Resolve a participant-id array into display names PLUS the authoritative count.
 *
 * ORDER IS PRESERVED and DUPLICATES ARE KEPT — a display name is not identity,
 * and two trainees may legitimately share one. `count` counts the legible ids,
 * so it stays truthful when a name cannot be resolved; the unresolved id itself
 * is never emitted.
 */
function resolveParticipants(
  ids: unknown,
  lookup: ReadonlyMap<string, string> | null | undefined,
): { readonly names: readonly string[]; readonly count: number } {
  const list = Array.isArray(ids) ? ids : [];
  const names: string[] = [];
  let count = 0;
  for (const raw of list) {
    const id = idOrNull(raw);
    // A blank entry identifies nobody, so it is neither named nor counted.
    if (id === null) continue;
    count += 1;
    const name = resolveName(lookup, id);
    if (name !== null) names.push(name);
  }
  return { names: Object.freeze(names), count };
}

/**
 * A structural view of ONE beginner participant, spanning BOTH committed
 * contracts — the live adapter's `BeginnerDetailParticipant` and the
 * Teaching-Practice source adapter's `TeachingPracticeExamParticipantDetail`.
 * Declared locally and read defensively so neither committed file is edited.
 */
interface BeginnerParticipantLike {
  readonly traineeId?: unknown;
  readonly isProjected?: unknown;
}

/**
 * Whether a participant belongs to the VALID LIVE PROJECTION of its lesson.
 *
 * THE FLAG IS THE ONLY TEST. The Teaching-Practice source adapter decides
 * projection eligibility from the role token and records the verdict as
 * `isProjected`, RETAINING a rejected row in its operational detail as evidence.
 * Re-deriving that verdict here — by re-mapping the role string, or by any other
 * rule — would create the second source of truth the exam cores forbid, and the
 * two would drift the first time a Teaching-Practice role is added.
 *
 * A participant whose object CARRIES the flag must prove `true`. A participant
 * whose object OMITS it passes, because the only omitting contract is the live
 * adapter's, whose participant list is projection-only BY CONSTRUCTION: the
 * source adapter's `continue` on `!isProjected` happens BEFORE the compact
 * source row is pushed, so a rejected participant can never reach it. That
 * structural fact is asserted by test rather than assumed here.
 */
function isProjectedParticipant(participant: unknown): boolean {
  if (participant === null || typeof participant !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(participant, "isProjected")) return true;
  return (participant as BeginnerParticipantLike).isProjected === true;
}

/**
 * The PROJECTED participants of one beginner lesson: their resolved display
 * names, plus the authoritative projected count.
 *
 * Source ORDER is preserved and duplicate display names are kept. `count` counts
 * every projected participant — including one whose name could not be resolved —
 * so it stays truthful; the unresolved `traineeId` itself is never emitted.
 */
function resolveProjectedParticipants(
  detail: BeginnerDetail,
  lookup: ReadonlyMap<string, string> | null | undefined,
): { readonly names: readonly string[]; readonly count: number } {
  const list = Array.isArray(detail.participants) ? detail.participants : [];
  const names: string[] = [];
  let count = 0;
  for (const participant of list) {
    if (!isProjectedParticipant(participant)) continue;
    count += 1;
    const name = resolveName(lookup, (participant as BeginnerParticipantLike).traineeId);
    if (name !== null) names.push(name);
  }
  return { names: Object.freeze(names), count };
}

/**
 * The stored block's arena for ONE row — FAIL CLOSED, exactly as the beginner
 * detail attaches.
 *
 * Attaches by EXACT session id; an entry declaring a different `sessionId`, a
 * non-object entry and a missing entry all yield `null`. Never inferred from a
 * date, title, definition or array position. The value is TRIMMED, and a blank
 * arena is `null` rather than an empty string masquerading as a place.
 */
function resolveArena(
  lookup: TraineeExamSessionDisplayDetailLookup | null | undefined,
  sessionId: string,
): string | null {
  const entry = mapGet(lookup, sessionId);
  if (entry === null || typeof entry !== "object") return null;
  if (entry.sessionId !== sessionId) return null;
  return isPresent(entry.arena) ? entry.arena.trim() : null;
}

/**
 * The assignment-level operational detail for ONE row, or `null` — FAIL CLOSED,
 * exactly as the beginner detail and the arena attach.
 *
 * Attaches by EXACT session id. A missing entry, a non-object entry, an entry
 * declaring a DIFFERENT session, an entry that does not declare itself stored
 * and an entry with no assignment array all yield `null`. Another block's
 * participants, horses and personal times shown against this row would be
 * strictly worse than showing none.
 */
function readAssignmentDetail(
  lookup: ExamAssignmentOperationalDetailLookup | null | undefined,
  sessionId: string,
): StoredExamBlockOperationalDetail | null {
  const entry = mapGet(lookup, sessionId);
  if (entry === null || typeof entry !== "object") return null;
  if (entry.sessionId !== sessionId) return null;
  if (entry.source !== "STORED") return null;
  if (!Array.isArray(entry.assignments)) return null;
  return entry;
}

/** The two legal assignment roles. Compared, never coerced. */
const ASSIGNMENT_ROLES: readonly ExamAssignmentRole[] = Object.freeze([
  "EXAMINEE",
  "INSTRUCTED_TRAINEE",
]);

function isAssignmentRole(v: unknown): v is ExamAssignmentRole {
  return typeof v === "string" && ASSIGNMENT_ROLES.includes(v as ExamAssignmentRole);
}

/**
 * Narrow ONE internal operational assignment row into the client contract.
 *
 * Every id is used as a LOOKUP KEY and then dropped: `studentId` becomes
 * `participantName`, `pairedStudentIds` become `pairedParticipantNames`, and
 * neither `assignmentId` nor `pairingIndex` is read at all. Nothing is
 * recomputed — the role, the horse, the inherited topic and discipline, the
 * exact personal times and the resolved pairing all arrive already decided by
 * the committed adapter, in the one pass that also produced the personal slots.
 */
function buildAssignmentRowDto(
  row: StoredExamAssignmentOperationalRow,
  studentNames: ReadonlyMap<string, string> | null | undefined,
): ExamAssignmentOperationalRowDto {
  const pairedIds = Array.isArray(row?.pairedStudentIds) ? row.pairedStudentIds : [];
  const pairedNames: string[] = [];
  for (const id of pairedIds) {
    const name = resolveName(studentNames, id);
    // An unresolved partner contributes no name — never the id, never a
    // placeholder person, and never a partner invented to fill the gap.
    if (name !== null) pairedNames.push(name);
  }
  const frozenPairedNames = Object.freeze(pairedNames);

  return Object.freeze({
    participantName: resolveName(studentNames, row?.studentId),
    // A role token that is not a legal role cannot be coerced into one; the
    // committed adapter has already excluded such a row, so this is the
    // fail-closed reading of an impossible state rather than a second rule.
    role: isAssignmentRole(row?.role) ? row.role : "EXAMINEE",
    horseName: textOrNull(row?.horseName),
    instructionTopic: textOrNull(row?.instructionTopic),
    discipline: textOrNull(row?.discipline),
    personalStartTime: textOrNull(row?.personalStartTime),
    personalEndTime: textOrNull(row?.personalEndTime),
    // Exactly ONE named partner, or nothing. Two names are never joined.
    pairedParticipantName: frozenPairedNames.length === 1 ? frozenPairedNames[0] : null,
    pairedParticipantNames: frozenPairedNames,
  });
}

/**
 * The assignment rows of ONE row, as a freshly allocated frozen array.
 *
 * A live beginner row and a row with no usable sibling detail alike receive an
 * EMPTY array — never a shared one, so no two rows can observe each other.
 */
function buildAssignmentRowDtos(
  lookup: ExamAssignmentOperationalDetailLookup | null | undefined,
  source: ExamRowSource,
  sessionId: string,
  studentNames: ReadonlyMap<string, string> | null | undefined,
): readonly ExamAssignmentOperationalRowDto[] {
  if (source !== "STORED") return Object.freeze([] as ExamAssignmentOperationalRowDto[]);
  const detail = readAssignmentDetail(lookup, sessionId);
  if (detail === null) return Object.freeze([] as ExamAssignmentOperationalRowDto[]);
  return Object.freeze(
    detail.assignments
      .filter((row) => row !== null && typeof row === "object")
      .map((row) => buildAssignmentRowDto(row, studentNames)),
  );
}

/** Whether a projected row is a live beginner row. Decided by `kind`, as the
 * committed trainee core decides it — never by inspecting the id's shape. */
function rowSource(session: ProjectionSession): ExamRowSource {
  return session.kind === BEGINNER_KIND ? "BEGINNER" : "STORED";
}

/**
 * The end a row is DISPLAYED by, or `null`.
 *
 * This RESTATES the committed end-time rule of `exam-schedule-projection-core`
 * (`OK` → the derived block end and only that; `UNRESOLVED` → nothing; otherwise
 * the row's own end), which is module-private there. It is restated rather than
 * imported because importing it would mean editing a committed file, exactly as
 * `exam-trainee-view-core` restates that core's private comparator — and, as
 * there, the parity is asserted by test.
 *
 * `null` means "this row has no usable end". Never a substituted start, never
 * `00:00`, never an empty string dressed up as a time.
 */
function displayEndTime(session: ProjectionSession): string | null {
  const status = session.timetableStatus;
  if (status === "OK") {
    return isPresent(session.derivedBlockEndTime) ? session.derivedBlockEndTime : null;
  }
  if (status === "UNRESOLVED") return null;
  return isPresent(session.endTime) ? session.endTime : null;
}

/** Build a frozen narrowing issue, binding its canonical Hebrew message. */
function dtoIssue(
  code: ExamReadDtoIssueCode,
  sessionId: string | null = null,
): ExamReadDtoIssue {
  return Object.freeze({ code, message: EXAM_READ_DTO_MESSAGES[code], sessionId });
}

/**
 * The sibling beginner detail for ONE row, or `null` — FAIL CLOSED.
 *
 * Attaches by EXACT session id. A missing entry, a non-object entry and an entry
 * that declares a different `sessionId` all yield `null`, so unrelated child and
 * parent-contact data can never be shown against a row. Issues are collected
 * only when the caller supplies a sink; the trainee builder supplies none,
 * because a trainee has no diagnostic channel.
 */
function readBeginnerDetail(
  lookup: ReadonlyMap<string, BeginnerDetail> | null | undefined,
  sessionId: string,
  issues: ExamReadDtoIssue[] | null,
): BeginnerDetail | null {
  const detail = mapGet(lookup, sessionId);
  if (detail === null || typeof detail !== "object") {
    if (issues !== null) issues.push(dtoIssue("EX-DTO-BEGINNER-DETAIL-REQUIRED", sessionId));
    return null;
  }
  if (detail.sessionId !== sessionId) {
    if (issues !== null) issues.push(dtoIssue("EX-DTO-BEGINNER-DETAIL-CONFLICT", sessionId));
    return null;
  }
  return detail;
}

/** Narrow one child into the shared client-safe shape. */
function buildChildDto(child: BeginnerDetail["children"][number]): ExamBeginnerChildDto {
  return Object.freeze({
    childAssignmentId: text(child?.childAssignmentId),
    fullName: text(child?.fullName),
    age: numberOrNull(child?.age),
    gender: textOrNull(child?.gender),
    childNotes: textOrNull(child?.childNotes),
    parentName: textOrNull(child?.parentName),
    // VERBATIM. No normalization, no formatting, no link.
    parentPhone: textOrNull(child?.parentPhone),
    horseName: textOrNull(child?.horseName),
    equipmentNotes: textOrNull(child?.equipmentNotes),
    isAbsent: child?.isAbsent === true,
  });
}

/** Narrow the child list. Source order is preserved exactly. */
function buildChildDtos(detail: BeginnerDetail): readonly ExamBeginnerChildDto[] {
  const list = Array.isArray(detail.children) ? detail.children : [];
  return Object.freeze(list.map((child) => buildChildDto(child)));
}

/**
 * The responsible instructor's display name.
 *
 * The injected lookup wins; the payload's own verbatim name is the fallback for
 * a caller that supplied no instructor lookup. `responsibleInstructorId` itself
 * is never emitted.
 */
function responsibleInstructorName(
  detail: BeginnerDetail,
  names: ExamDisplayNameLookup | null | undefined,
): string | null {
  const resolved = resolveName(names?.instructorNames, detail.responsibleInstructorId);
  if (resolved !== null) return resolved;
  return isPresent(detail.responsibleInstructorName)
    ? detail.responsibleInstructorName.trim()
    : null;
}

// ===========================================================================
// Trainee builder
// ===========================================================================

/**
 * Narrow ONE already-computed trainee day projection into the client contract.
 *
 * It receives the OUTPUT of `projectTraineeExamDay` and re-derives nothing:
 * `isSelf`, the personal role, the exact personal times, the row order and the
 * exclusion of unresolved/contradictory rows are all the committed core's, and
 * are carried through as they arrived.
 *
 * PUBLICATION IS NOT APPLIED HERE. The caller has already loaded the plan under
 * the correct publication options (a trainee read requires
 * `ExamPlan.publishedAt`), so an unpublished plan produced no rows to narrow.
 * `ExamSession.individualPublishedAt` is not an active trainee gate and appears
 * nowhere in this contract.
 *
 * THE CONFLICT INPUT IS NOT A PARAMETER. A stored block's visible place arrives
 * through the narrow {@link TraineeExamSessionDisplayDetail} sibling, which can
 * express an arena and nothing else — so supervisor ids, slots, intervals,
 * horses, examiner sets and staffing state are unreachable from here rather than
 * merely unread.
 *
 * THE ASSIGNMENT DETAIL IS A SEPARATE SIBLING, not a widening of the arena one.
 * {@link TraineeExamSessionDisplayDetail} exists precisely because it can
 * express an arena and nothing else; folding the operational rows into it would
 * destroy that property. They therefore arrive as their own narrow lookup, which
 * can express assignment rows and nothing else — no conflict input, no
 * supervisor id, no examiner set, no staffing state.
 *
 * @param projection            the committed trainee day projection.
 * @param beginnerDetails       the sibling live detail lookup, keyed by session id.
 * @param sessionDisplayDetails the narrow stored display sibling (arena only).
 * @param names                 the caller-supplied display-name lookups.
 * @param assignmentDetails     the sibling assignment-level operational lookup.
 */
export function buildTraineeExamDayDto(
  projection: TraineeExamDayProjection,
  beginnerDetails: ReadonlyMap<string, BeginnerDetail> | null | undefined,
  sessionDisplayDetails: TraineeExamSessionDisplayDetailLookup | null | undefined,
  names: ExamDisplayNameLookup | null | undefined,
  assignmentDetails: ExamAssignmentOperationalDetailLookup | null | undefined,
): TraineeExamDayDto {
  const projectedRows = Array.isArray(projection?.allRows) ? projection.allRows : [];
  const studentNames = names?.studentNames;

  const allRows: TraineeExamDayRowDto[] = [];
  for (const row of projectedRows) {
    if (row === null || typeof row !== "object") continue;
    const session = row.session;
    if (session === null || typeof session !== "object") continue;

    const sessionId = text(session.sessionId);
    const source = rowSource(session);
    const examinees = resolveParticipants(session.examineeStudentIds, studentNames);
    const instructed = resolveParticipants(session.instructedTraineeStudentIds, studentNames);

    // The sensitive sibling: consulted ONLY for a beginner row, ONLY by exact
    // session id, and never for a stored one. Narrowing issues are DISCARDED —
    // a trainee has no diagnostic channel.
    const detail =
      source === "BEGINNER" ? readBeginnerDetail(beginnerDetails, sessionId, null) : null;
    const participants =
      detail === null ? null : resolveProjectedParticipants(detail, studentNames);

    const isSelf = row.isSelf === true;
    // A live beginner row keeps its own Teaching-Practice `location` and never
    // consumes the STORED display sibling, which describes stored blocks only.
    const arena = source === "STORED" ? resolveArena(sessionDisplayDetails, sessionId) : null;

    allRows.push(
      Object.freeze({
        sessionId,
        source,
        kind: session.kind,
        beginnerFormat: session.beginnerFormat ?? null,
        date: text(session.date),
        startTime: text(session.startTime),
        displayEndTime: displayEndTime(session),
        definitionId: idOrNull(session.definitionId),
        definitionName: textOrNull(session.definitionName ?? null),
        arena,
        location: detail === null ? null : textOrNull(detail.location),
        isSelf,
        selfLabel: isSelf ? TRAINEE_SELF_ROW_LABEL : null,
        selfRole: row.selfRole ?? null,
        selfStartTime: row.selfStartTime ?? null,
        selfEndTime: row.selfEndTime ?? null,
        examineeNames: examinees.names,
        examineeCount: examinees.count,
        instructedTraineeNames: instructed.names,
        instructedTraineeCount: instructed.count,
        beginnerChildCount: countOrZero(session.beginnerChildCount),
        assignments: buildAssignmentRowDtos(
          assignmentDetails,
          source,
          sessionId,
          studentNames,
        ),
        beginner:
          detail === null || participants === null
            ? null
            : Object.freeze({
                sessionId: text(detail.sessionId),
                lessonId: text(detail.lessonId),
                beginnerFormat: detail.beginnerFormat,
                groupName: textOrNull(detail.groupName),
                location: textOrNull(detail.location),
                responsibleInstructorName: responsibleInstructorName(detail, names),
                participantNames: participants.names,
                participantCount: participants.count,
                children: buildChildDtos(detail),
              }),
      }),
    );
  }

  const frozenAllRows = Object.freeze(allRows);
  // THE invariant: the personal view is a FILTER of the full view, sharing row
  // object identity. Never a second mapping of the projection.
  return Object.freeze({
    allRows: frozenAllRows,
    myRows: Object.freeze(frozenAllRows.filter((row) => row.isSelf)),
  });
}

// ===========================================================================
// Admin / instructor builders
// ===========================================================================

/** The two conflict-input scalars the operational rows display. */
interface OperationalConflictDisplay {
  readonly arena: string | null;
  readonly supervisorIds: readonly string[];
}

/**
 * Index the payload's conflict INPUT by session id — for `arenaId` and
 * `supervisorIds` ONLY.
 *
 * Nothing else of a `ConflictSession` is read: not its assignments (which carry
 * participant identities), not its interval, slots, examiner set, horses,
 * capacity or staffing flag. This is a narrow DISPLAY read of two scalars that
 * exist nowhere else in the payload, not a conflict projection.
 */
function indexConflictDisplay(
  payload: ExamPlanPayload,
): ReadonlyMap<string, OperationalConflictDisplay> {
  const index = new Map<string, OperationalConflictDisplay>();
  const list = Array.isArray(payload?.conflictSessions) ? payload.conflictSessions : [];
  for (const entry of list) {
    if (entry === null || typeof entry !== "object") continue;
    const sessionId = idOrNull(entry.sessionId);
    if (sessionId === null) continue;
    index.set(sessionId, {
      arena: textOrNull(entry.arenaId),
      supervisorIds: Array.isArray(entry.supervisorIds) ? entry.supervisorIds : [],
    });
  }
  return index;
}

/** Narrow the operational diagnostics into plain data, field by field. */
function buildDiagnosticsDto(
  payload: ExamPlanPayload,
  narrowingIssues: readonly ExamReadDtoIssue[],
): OperationalExamDiagnosticsDto {
  const source = payload?.diagnostics;
  const storedAdapterIssues = Array.isArray(source?.storedAdapterIssues)
    ? source.storedAdapterIssues
    : [];
  const storedBlockDiagnostics = Array.isArray(source?.storedBlockDiagnostics)
    ? source.storedBlockDiagnostics
    : [];
  const teachingPracticeSourceIssues = Array.isArray(source?.teachingPracticeSourceIssues)
    ? source.teachingPracticeSourceIssues
    : [];
  const beginnerRejections = Array.isArray(source?.beginnerRejections)
    ? source.beginnerRejections
    : [];
  const loaderIssues = Array.isArray(source?.loaderIssues) ? source.loaderIssues : [];

  const adapterIssueDto = (issue: {
    readonly code: StoredExamAdapterIssueCode;
    readonly message: string;
    readonly sessionId: string | null;
    readonly definitionId: string | null;
    readonly assignmentId: string | null;
  }): ExamStoredAdapterIssueDto =>
    Object.freeze({
      code: issue.code,
      message: text(issue.message),
      sessionId: textOrNull(issue.sessionId),
      definitionId: textOrNull(issue.definitionId),
      assignmentId: textOrNull(issue.assignmentId),
    });

  const timetableDto = (issue: {
    readonly code: ExamTimetableIssueCode | ExamTimetableWarningCode;
    readonly message: string;
    readonly details: readonly string[];
  }): ExamTimetableDiagnosticDto =>
    Object.freeze({
      code: issue.code,
      message: text(issue.message),
      details: Object.freeze(
        (Array.isArray(issue.details) ? issue.details : []).map((d) => text(d)),
      ),
    });

  const definitionIssueDto = (issue: {
    readonly code: ExamDefinitionIssueCode;
    readonly message: string;
    readonly assignmentId: string | null;
  }): ExamDefinitionIssueDto =>
    Object.freeze({
      code: issue.code,
      message: text(issue.message),
      assignmentId: textOrNull(issue.assignmentId),
    });

  return Object.freeze({
    storedAdapterIssues: Object.freeze(storedAdapterIssues.map(adapterIssueDto)),
    storedBlockDiagnostics: Object.freeze(
      storedBlockDiagnostics.map((block) =>
        Object.freeze({
          sessionId: text(block.sessionId),
          definitionId: textOrNull(block.definitionId),
          timetableIssues: Object.freeze(
            (Array.isArray(block.timetableIssues) ? block.timetableIssues : []).map(
              timetableDto,
            ),
          ),
          timetableWarnings: Object.freeze(
            (Array.isArray(block.timetableWarnings) ? block.timetableWarnings : []).map(
              timetableDto,
            ),
          ),
          definitionIssues: Object.freeze(
            (Array.isArray(block.definitionIssues) ? block.definitionIssues : []).map(
              definitionIssueDto,
            ),
          ),
          adapterIssues: Object.freeze(
            (Array.isArray(block.adapterIssues) ? block.adapterIssues : []).map(
              adapterIssueDto,
            ),
          ),
        }),
      ),
    ),
    teachingPracticeSourceIssues: Object.freeze(
      teachingPracticeSourceIssues.map((issue) =>
        Object.freeze({
          code: issue.code,
          message: text(issue.message),
          lessonId: textOrNull(issue.lessonId),
          participantId: textOrNull(issue.participantId),
          childAssignmentId: textOrNull(issue.childAssignmentId),
        }),
      ),
    ),
    beginnerRejections: Object.freeze(
      beginnerRejections.map((rejection) =>
        Object.freeze({ lessonId: text(rejection.lessonId), reason: rejection.reason }),
      ),
    ),
    loaderIssues: Object.freeze(
      loaderIssues.map((issue) =>
        Object.freeze({
          code: issue.code,
          message: text(issue.message),
          sessionId: textOrNull(issue.sessionId),
          lessonId: textOrNull(issue.lessonId),
        }),
      ),
    ),
    narrowingIssues: Object.freeze([...narrowingIssues]),
  });
}

/**
 * The shared operational narrowing.
 *
 * PRIVATE ON PURPOSE. Admin and instructor are identical TODAY; the two public
 * builders exist so that stops being true without touching a single caller.
 */
function buildOperationalDto(
  payload: ExamPlanPayload,
  names: ExamDisplayNameLookup | null | undefined,
  viewerRole: "ADMIN" | "INSTRUCTOR",
): OperationalExamReadDto {
  const sessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  const studentNames = names?.studentNames;
  const instructorNames = names?.instructorNames;
  const conflictDisplay = indexConflictDisplay(payload);

  const issues: ExamReadDtoIssue[] = [];
  if (!isUsableLookup(studentNames) || !isUsableLookup(instructorNames)) {
    issues.push(dtoIssue("EX-DTO-NAME-LOOKUP-UNUSABLE"));
  }

  const rows: OperationalExamRowDto[] = [];
  for (const session of sessions) {
    if (session === null || typeof session !== "object") continue;

    const sessionId = text(session.sessionId);
    const source = rowSource(session);
    const examinees = resolveParticipants(session.examineeStudentIds, studentNames);
    const instructed = resolveParticipants(session.instructedTraineeStudentIds, studentNames);
    const detail =
      source === "BEGINNER"
        ? readBeginnerDetail(payload.beginnerDetails, sessionId, issues)
        : null;
    // The SAME projected-participant rule the trainee contract uses: the visible
    // list describes the lesson, while a rejected source row stays observable as
    // an `EX-TP-ADP-*` diagnostic instead.
    const participants =
      detail === null ? null : resolveProjectedParticipants(detail, studentNames);

    // Stored rows only: a live beginner row has no conflict entry and no arena.
    const display = source === "STORED" ? mapGet(conflictDisplay, sessionId) : null;
    const supervisors = resolveParticipants(display?.supervisorIds, instructorNames);

    rows.push(
      Object.freeze({
        sessionId,
        source,
        kind: session.kind,
        beginnerFormat: session.beginnerFormat ?? null,
        date: text(session.date),
        startTime: text(session.startTime),
        endTime: text(session.endTime),
        displayEndTime: displayEndTime(session),
        derivedBlockEndTime: textOrNull(session.derivedBlockEndTime ?? null),
        timetableStatus: session.timetableStatus ?? null,
        definitionId: idOrNull(session.definitionId),
        definitionName: textOrNull(session.definitionName ?? null),
        arena: display === null ? null : display.arena,
        location: detail === null ? null : textOrNull(detail.location),
        examineeNames: examinees.names,
        examineeCount: examinees.count,
        instructedTraineeNames: instructed.names,
        instructedTraineeCount: instructed.count,
        beginnerChildCount: countOrZero(session.beginnerChildCount),
        supervisorNames: supervisors.names,
        supervisorCount: supervisors.count,
        // The internal payload's OWN sibling — the operational builders need no
        // extra parameter for it, because they already receive the payload.
        assignments: buildAssignmentRowDtos(
          payload?.storedAssignmentDetails,
          source,
          sessionId,
          studentNames,
        ),
        beginner:
          detail === null || participants === null
            ? null
            : Object.freeze({
                sessionId: text(detail.sessionId),
                lessonId: text(detail.lessonId),
                beginnerFormat: detail.beginnerFormat,
                practiceType: text(detail.practiceType),
                groupName: textOrNull(detail.groupName),
                location: textOrNull(detail.location),
                notes: textOrNull(detail.notes),
                isPublished: detail.isPublished === true,
                responsibleInstructorName: responsibleInstructorName(detail, names),
                participantNames: participants.names,
                participantCount: participants.count,
                children: buildChildDtos(detail),
              }),
      }),
    );
  }

  return Object.freeze({
    viewerRole,
    planId: idOrNull(payload?.planId),
    isPublished: numberOrNull(payload?.publishedAt) !== null,
    publishedAt: numberOrNull(payload?.publishedAt),
    sourceDates: Object.freeze(
      (Array.isArray(payload?.sourceDates) ? payload.sourceDates : []).map((d) => text(d)),
    ),
    rows: Object.freeze(rows),
    diagnostics: buildDiagnosticsDto(payload, issues),
  });
}

/**
 * Narrow the internal payload into the ADMIN read contract.
 *
 * AUTHORIZATION HAPPENED BEFORE THIS CALL, or it did not happen at all — see the
 * file header. This builder proves nothing about its caller.
 */
export function buildAdminExamReadDto(
  payload: ExamPlanPayload,
  names: ExamDisplayNameLookup | null | undefined,
): AdminExamReadDto {
  return buildOperationalDto(payload, names, "ADMIN") as AdminExamReadDto;
}

/**
 * Narrow the internal payload into the INSTRUCTOR read contract.
 *
 * Identical to the admin reading today. An active instructor with
 * server-approved access to the requested course may see DRAFT and PUBLISHED
 * plans — a decision the EX-S5A-4B wrapper takes and encodes in the loader's
 * publication options, never here.
 */
export function buildInstructorExamReadDto(
  payload: ExamPlanPayload,
  names: ExamDisplayNameLookup | null | undefined,
): InstructorExamReadDto {
  return buildOperationalDto(payload, names, "INSTRUCTOR") as InstructorExamReadDto;
}

// ===========================================================================
// The plain-JSON guarantee
// ===========================================================================

/**
 * Every path in `value` that is NOT plain JSON data.
 *
 * A DTO must contain only objects, arrays, strings, finite numbers, booleans and
 * `null`. A `Map`, `Set`, `Date`, `BigInt`, symbol, function, class instance,
 * `NaN`/`Infinity` or an `undefined` property VALUE is reported with its path.
 *
 * This is a CORRECTNESS check, not a privacy check: a payload can be perfectly
 * plain JSON and still contain data a viewer may not see. Privacy comes from the
 * field-by-field omission in the builders above.
 *
 * A true CYCLE is reported rather than followed, so this always terminates.
 * Only ANCESTORS on the current path count: a DTO legitimately SHARES a frozen
 * child array between two fields (`examineeNames` and the beginner detail's
 * `participantNames` are the same array), and a shared value is plain JSON —
 * it round-trips as two equal copies. Treating sharing as a cycle would report
 * correct data as broken.
 */
export function findNonPlainJsonPaths(value: unknown, path = "$"): readonly string[] {
  return Object.freeze(collectNonPlainJsonPaths(value, path, new Set<object>()));
}

function collectNonPlainJsonPaths(
  value: unknown,
  path: string,
  ancestors: Set<object>,
): string[] {
  if (value === null) return [];

  const type = typeof value;
  if (type === "string" || type === "boolean") return [];
  if (type === "number") {
    return Number.isFinite(value as number) ? [] : [`${path} (non-finite number)`];
  }
  if (type === "undefined") return [`${path} (undefined)`];
  if (type === "bigint") return [`${path} (bigint)`];
  if (type === "symbol") return [`${path} (symbol)`];
  if (type === "function") return [`${path} (function)`];

  const object = value as object;
  if (ancestors.has(object)) return [`${path} (circular)`];

  if (!Array.isArray(object)) {
    const prototype = Object.getPrototypeOf(object) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      // A `Map`, `Set`, `Date` or any class instance lands here.
      const name = (object as { constructor?: { name?: string } }).constructor?.name ?? "object";
      return [`${path} (${name})`];
    }
  }

  ancestors.add(object);
  const out: string[] = [];
  if (Array.isArray(object)) {
    object.forEach((entry, index) => {
      out.push(...collectNonPlainJsonPaths(entry, `${path}[${index}]`, ancestors));
    });
  } else {
    for (const key of Object.keys(object)) {
      const entry = (object as Record<string, unknown>)[key];
      // An OMITTED optional property is correct; one explicitly set to
      // `undefined` is not, because serializers disagree about it.
      if (entry === undefined) {
        out.push(`${path}.${key} (undefined)`);
        continue;
      }
      out.push(...collectNonPlainJsonPaths(entry, `${path}.${key}`, ancestors));
    }
  }
  ancestors.delete(object);
  return out;
}

/** True iff `value` is plain JSON data throughout. See {@link findNonPlainJsonPaths}. */
export function isPlainJsonDto(value: unknown): boolean {
  return findNonPlainJsonPaths(value).length === 0;
}
