/**
 * EXAM EX-SUP-IO1 — the ADMIN-SCOPED stored ExamSessionSupervisor WRITES: the
 * real bindings for CREATE and REMOVAL, and nothing else.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` — the repository
 * convention, already used by the exam read and the sibling exam write bindings
 * in this directory — turns an accidental import from a `"use client"` module
 * into a BUILD ERROR. That matters independently of everything else here: this
 * module binds admin authorization, the course-lifecycle policy and Prisma
 * writes.
 *
 * DELIBERATELY NOT A `"use server"` MODULE. Everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id — and these WRITE. `createExamSupervisor` and
 * `deleteExamSupervisor` are ORDINARY server functions. The Server Actions, the
 * route, the page and the admin UI that will eventually call them are a LATER,
 * separately reviewed slice; NOTHING in `app/` or `components/` calls this
 * today, and this slice adds no page, route, form or capability.
 *
 * ===========================================================================
 * DIVISION OF LABOUR
 * ===========================================================================
 * Inside the exam slice (all pure, all DB-free, all already committed):
 *   the supervisor input core  — the two submitted fields, the non-blank rule,
 *                                the trim rule and the fail-closed no-coercion
 *                                rule
 *   the create orchestration   — the CREATE order and the outcomes
 *   the delete orchestration   — the REMOVAL order and the outcomes
 * And here:
 *   this module — the REAL admin, policy, Prisma and error-classification
 *   bindings, and nothing else.
 *
 * The orchestration is NOT reimplemented here. This file contains no ordering
 * decision, no validation, no policy table, no lifecycle decision and no outcome
 * code of its own: it hands each committed pure core its effects and its error
 * classifiers, and returns the core's result unchanged.
 *
 * The admin boundary, the lifecycle gate, the two typed error classifiers and
 * the ExamPlan lookup are each declared ONCE and shared by both operations — so
 * the two can never drift into different trust boundaries.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY
 * ===========================================================================
 * Create: a REQUESTED `courseOfferingId` and a RAW, untrusted input object.
 * Remove: a REQUESTED `courseOfferingId` and a RAW, untrusted supervisor id.
 *
 * There is no parameter — and no readable field of either raw value — for a
 * `planId`, a session chosen outside the plan, an admin id or a transaction
 * handle. Not "ignored": absent from every signature and from every type the
 * committed cores accept, so no future caller can pass one.
 *
 * The requested offering id is a REQUEST, not a grant: `requireAdminCourseOffering`
 * runs `requireAdmin()` FIRST (redirecting an unauthenticated or non-admin
 * caller) and only then looks up exactly that offering, and ONLY the DB-verified
 * id it returns reaches the ExamPlan query and the eligibility query. The plan id
 * is therefore always server-derived, and every session verification, scoped
 * supervisor read and write is scoped by it.
 *
 * ===========================================================================
 * THE COURSE-LIFECYCLE GATE — A TEMPORARY, DELIBERATE REUSE
 * ===========================================================================
 * The gate is the existing `SCHEDULE_DRAFT_CONFIGURATION` operation, which the
 * committed policy allows for PLANNED and ACTIVE offerings and denies for
 * ARCHIVED ones — exactly the required behaviour for configuring who staffs an
 * exam plan's sessions, and exactly what the committed exam definition-write,
 * session-write and assignment-write bindings already use, so they cannot drift
 * into different trust boundaries.
 *
 * This is a reuse of a course-LIFECYCLE classification, NOT of a capability. No
 * new `CourseOfferingOperation` is introduced, the committed policy core is not
 * edited, and NO capability is consulted: there is no `EXAMS` capability (no
 * catalog key, no row, no reader), and no other module's capability is borrowed —
 * an exam write must not silently inherit another module's product decisions, and
 * a placeholder check that always passes reads as enforcement to the next person
 * who edits this file.
 *
 * ===========================================================================
 * THE ELIGIBILITY RULE, AND ITS HONEST LIMITATION
 * ===========================================================================
 * TODAY'S RULE, IN FULL: an instructor may be recorded on an exam session if and
 * only if an `Instructor` row with that id exists AND `isActive` is `true`. That
 * is the whole rule. It is ONE fail-closed `where` clause, so there is no window
 * between "does this person exist?" and "are they active?", and no
 * application-side comparison a later edit could quietly remove.
 *
 * THE LIMITATION, STATED PLAINLY RATHER THAN HIDDEN: this database has NO
 * relation between an `Instructor` and a `CourseOffering`. There is therefore no
 * fact the server can read to decide whether a given instructor belongs to a
 * given course, and this binding does NOT invent one. It does not consult
 * `CourseEnrollment` (which models trainees, not instructors), a course
 * capability row, a course group, Teaching Practice, presence on a riding
 * schedule, a borrowed capability from another module, or a new permission
 * column — every one of those would be a product decision made silently by an
 * implementation detail.
 *
 * The consequence is real and must not be glossed: ANY active instructor may be
 * recorded on ANY course's exam session by an admin who is already authorized
 * for that offering. The narrowing that DOES apply is the admin boundary and the
 * lifecycle gate, not a course-membership test.
 *
 * `findEligibleInstructor` still receives the VERIFIED offering id, because that
 * is the committed core's contract and because it is the SEAM where a
 * course-scoped rule will go the moment the schema can express one. The
 * parameter is deliberately unused today rather than quietly dropped: removing
 * it would erase the seam and make the limitation invisible.
 *
 * WHY THIS MUST BE REVISITED. An earlier design for the Exams area proposed
 * gating a child's parent-contact visibility on being a supervisor of that exact
 * session. The schema records that rule as ABANDONED — parent contacts are
 * visible to every role that can reach the Exams area, exactly as in Teaching
 * Practice, and no new Instructor permission column exists or may be added for
 * it. NO reader anywhere derives any visibility from supervisorship today, and
 * this slice creates none.
 *
 * But the coupling is latent: the day any read surface DOES treat "is a
 * supervisor of this session" as a reason to show something, this write becomes
 * an access-granting operation and an "any active instructor" rule stops being
 * adequate. That review must happen with that reader, not after it ships.
 *
 * Today the write is admin-only, lifecycle-gated and deliberate.
 *
 * ===========================================================================
 * ONE SESSION, ONE INSTRUCTOR, ONE ROW — AND NOTHING ELSE
 * ===========================================================================
 * The created row is the PAIR and its own key. There is no position column on
 * this table, so nothing is numbered, sequenced, renumbered or compacted; there
 * is no kind, tier or responsibility column, so no such value is written,
 * defaulted or derived; and the supervisors of a session are an unordered SET.
 *
 * The "responsible instructor" of a live Teaching Practice lesson is a DIFFERENT
 * concept in a different subsystem. Nothing here imports, reads, copies or
 * mirrors it, and no dependency exposed to the committed cores could reach one —
 * the exclusion is structural, not a rule someone has to remember.
 *
 * ===========================================================================
 * THE SAME PAIR TWICE IS AN ORDINARY OUTCOME
 * ===========================================================================
 * The table carries a real unique key over `(sessionId, instructorId)`, so
 * naming the same instructor on the same session twice — a double submit, or two
 * managers at once — is reachable and ordinary. It is classified AT THE WRITE
 * rather than pre-checked by a read, because a read-then-write would reintroduce
 * exactly the race the unique key exists to close.
 *
 * ===========================================================================
 * THE REMOVAL DELETES EXACTLY THE ROW THE SCOPED READ APPROVED
 * ===========================================================================
 * The target is located with a PLAN-SCOPED `findFirst`, and the `delete` is then
 * issued against the id THAT READ RETURNED — never the raw submitted value. A
 * `deleteMany` is deliberately not used: the target is a primary key, `delete`
 * is the exact-one-row statement for it, and `deleteMany` would silently report
 * "0 removed" where a genuine disappearance should surface.
 *
 * So a `P2025` — the row vanished between the verification and the write —
 * PROPAGATES rather than being laundered into "not found". The caller was not
 * wrong about the row; the world changed underneath them, and a "not found"
 * would misdescribe it. The conflict classifier is bound to the CREATE only and
 * is never asked about a removal.
 *
 * ===========================================================================
 * ADMIN ONLY
 * ===========================================================================
 * There is no instructor-authored and no trainee-authored write path in this
 * module: no actor helper for either is imported, and the only authorization
 * binding is the admin course-context resolver. An instructor staffing their own
 * session would be a different product decision requiring its own review.
 *
 * ===========================================================================
 * NO DATE, NO PUBLICATION, NO NOTIFICATION
 * ===========================================================================
 * Not one statement here reads or writes a calendar value, so this module needs
 * no date helper and carries no timezone decision. The single ExamPlan query
 * selects the plan's id and nothing else, so these operations cannot see,
 * require or change a publication state, and no notification, message or push
 * surface is imported. The Exams area models no evaluation of any kind, so there
 * is none to write.
 */
import "server-only";

import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireAdminCourseOffering,
  CourseOfferingNotFoundError,
} from "@/lib/course/admin-course-context";
import {
  assertCourseOperationAllowed,
  CourseOperationNotPermittedError,
} from "@/lib/course/operation-policy-core";
import {
  createExamSupervisorWithDeps,
  type CreateExamSupervisorResult,
  type CreatedExamSupervisorRecord,
  type EligibleExamSupervisorInstructor,
  type VerifiedExamSessionForSupervisorCreate,
} from "@/lib/exam/create-exam-supervisor-core";
import {
  deleteExamSupervisorWithDeps,
  type DeleteExamSupervisorResult,
  type ExistingExamSupervisorForDelete,
} from "@/lib/exam/delete-exam-supervisor-core";

export type { CreateExamSupervisorResult } from "@/lib/exam/create-exam-supervisor-core";
export type { DeleteExamSupervisorResult } from "@/lib/exam/delete-exam-supervisor-core";

// ===========================================================================
// The trust boundary
// ===========================================================================

/**
 * Admin + exact offering.
 *
 * `requireAdmin()` runs inside `requireAdminCourseOffering` BEFORE the offering
 * is looked up, so an unauthenticated caller is redirected rather than told
 * whether an offering id exists. Only `id` and `status` are carried forward: the
 * name, level, ActivityYear and dates of the offering are none of these
 * operations' business, and the RAW requested id is used at this boundary and
 * nowhere else.
 */
async function requireCourseContext(
  requestedCourseOfferingId: string,
): Promise<{ courseOfferingId: string; status: string }> {
  const context = await requireAdminCourseOffering(requestedCourseOfferingId);
  return { courseOfferingId: context.id, status: context.status };
}

/**
 * The lifecycle gate. The cast restores the generated enum that the pure cores
 * deliberately widened to `string`; it is safe because the committed policy is
 * DEFAULT-DENY — an unrecognized status is refused, never allowed.
 */
function assertConfigurationAllowed(status: string): void {
  assertCourseOperationAllowed(
    status as CourseOfferingStatus,
    "SCHEDULE_DRAFT_CONFIGURATION",
  );
}

/** Is this throw the project's typed "that offering does not exist"? */
function isCourseNotFoundError(error: unknown): boolean {
  return error instanceof CourseOfferingNotFoundError;
}

/** Is this throw the committed policy's typed lifecycle denial? */
function isOperationNotAllowedError(error: unknown): boolean {
  return error instanceof CourseOperationNotPermittedError;
}

// ===========================================================================
// The duplicate-pair classifier
// ===========================================================================

/**
 * The database index behind `@@unique([sessionId, instructorId])` on
 * `exam_session_supervisors`. Named here as a STRING so the classifier can
 * recognize the conflict structurally, without importing a Prisma error class.
 */
const EXAM_SUPERVISOR_CONFLICT_INDEX =
  "exam_session_supervisors_sessionId_instructorId_key";

/**
 * Recognize the Prisma unique-constraint violation (`P2002`) that means "that
 * instructor ALREADY supervises that session", and nothing else.
 *
 * DELIBERATELY NARROW IN BOTH DIRECTIONS:
 *  - a non-object and a `null` are rejected;
 *  - any Prisma code other than `P2002` is rejected — a `P2025` from the removal
 *    can never match, and neither can any other failure;
 *  - the field-array form must name BOTH `sessionId` AND `instructorId`.
 *    Requiring both is what makes an unrelated composite key — one that happens
 *    to share a single column name — fail to match, so a future statement
 *    violating some other unique index is never reported to a manager as
 *    "already supervising";
 *  - the index-name form must EQUAL the exact index above, not merely contain a
 *    fragment of it;
 *  - a framework redirect carries a `digest` and no `code`, so an unauthenticated
 *    admin's redirect can never be laundered into a form error.
 *
 * WHY THE UNREADABLE-METADATA FALLBACK IS SAFE, and it is the established
 * convention in the committed course and exam create bindings: the bound
 * statement writes exactly ONE model, `ExamSessionSupervisor`, whose only unique
 * keys are the primary key — a freshly generated cuid that cannot realistically
 * collide — and this very `(sessionId, instructorId)` pair. A `P2002` from that
 * statement whose target cannot be read is therefore this conflict.
 *
 * The offending error is never inspected beyond these two shapes, never
 * unwrapped, never logged and never echoed, so no database detail and no
 * submitted value can leak into a result through it.
 */
function isExamSupervisorConflictError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ((error as { code?: unknown }).code !== "P2002") {
    return false;
  }

  const target = (error as { meta?: { target?: unknown } }).meta?.target;

  // Prisma's field-array form, e.g. ["sessionId", "instructorId"]. BOTH are
  // required — a target naming only one of them is a different key.
  if (Array.isArray(target)) {
    const tokens = target.filter((entry): entry is string => typeof entry === "string");
    return tokens.includes("sessionId") && tokens.includes("instructorId");
  }

  // Prisma's index-name form, matched EXACTLY.
  if (typeof target === "string") {
    return target === EXAM_SUPERVISOR_CONFLICT_INDEX;
  }

  // Unreadable/absent metadata: attributed to this conflict for the reason
  // documented above.
  return true;
}

// ===========================================================================
// The Prisma bindings
// ===========================================================================

/**
 * The ONLY ExamPlan query in this module: one narrow lookup by the VERIFIED
 * offering id, selecting the id alone. No publication state, no source dates, no
 * sessions, no definitions, no offering relation, no timestamps — and no upsert,
 * because a plan is never created by a write to its contents.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so `findUnique` here is a single
 * indexed lookup on a key that is already the whole scope; there is nothing a
 * `findFirst` could additionally constrain.
 *
 * Shared by both operations rather than repeated per operation, so no future
 * edit can widen it for one of them alone.
 */
function findExamPlanByCourseOfferingId(
  verifiedCourseOfferingId: string,
): Promise<{ id: string } | null> {
  return prisma.examPlan.findUnique({
    where: {
      courseOfferingId: verifiedCourseOfferingId,
    },
    select: {
      id: true,
    },
  });
}

/**
 * Verify the submitted session EXISTS UNDER THE SERVER-RESOLVED PLAN.
 *
 * `findFirst` with BOTH keys — never `findUnique({ where: { id } })` — so a
 * session of ANOTHER plan reads as `null` rather than being found and then
 * rejected by a comparison someone could later remove. It is the plan scope, not
 * a check, that makes a cross-plan create unreachable, and it is why the pure
 * core can report a foreign session and a missing one identically.
 *
 * The select is EXACTLY the session's id. Recording who staffs a session needs
 * nothing else, and NOT selecting the rest is what makes it unleakable: the
 * definition and every one of its columns, the date, start time, end time,
 * arena, title, notes, position, publication stamp, capacity, duration, every
 * deprecated column the table still carries, and every Teaching-Practice
 * relation all stay in the database.
 */
function findSessionForPlan(
  planId: string,
  sessionId: string,
): Promise<VerifiedExamSessionForSupervisorCreate | null> {
  return prisma.examSession.findFirst({
    where: {
      id: sessionId,
      planId,
    },
    select: {
      id: true,
    },
  });
}

/**
 * Answer the committed core's eligibility question for the submitted instructor.
 *
 * THE WHOLE RULE IS `isActive: true` on an existing `Instructor` row — ONE
 * fail-closed statement, for the reason the header explains at length. The
 * VERIFIED offering id is accepted and deliberately NOT used, because this
 * database holds no Instructor-to-CourseOffering relation to use it with; the
 * parameter is the committed contract and the seam for the course-scoped rule
 * that will replace this one.
 *
 * `findFirst` and not `findUnique`: the scope is the id PLUS the activity
 * condition, which is not a unique key, and a `findUnique` by id would find a
 * deactivated instructor and then rely on a comparison someone could later
 * remove.
 *
 * ONE column is selected, and the id the SERVER matched — never the submitted
 * one — is what the committed core forwards to the write. No name, phone,
 * identity number, email or permission column is read, because none of them can
 * change the answer and a value this module never reads is a value it cannot
 * leak.
 */
async function findEligibleInstructor(
  verifiedCourseOfferingId: string,
  instructorId: string,
): Promise<EligibleExamSupervisorInstructor | null> {
  const row = await prisma.instructor.findFirst({
    where: {
      id: instructorId,
      isActive: true,
    },
    select: {
      id: true,
    },
  });

  if (row === null) {
    return null;
  }
  return {
    instructorId: row.id,
  };
}

/**
 * Record ONE instructor against ONE already-existing session.
 *
 * TWO columns, and there is nothing else to write: the stored row IS the pair
 * plus its own key. `id` and `createdAt` are left to the database. No position,
 * kind, tier or responsibility value is written, defaulted or derived — this
 * table declares no such column, so none is even expressible here.
 *
 * Both ids are the SERVER-VERIFIED ones the committed core forwards: the session
 * id came from the plan-scoped read, the instructor id from the eligibility
 * statement. Neither submitted value reaches this statement.
 *
 * No transaction wraps it, and that is correct rather than an omission: this is
 * ONE statement against ONE model with no read-then-write pair to serialize. The
 * only conflict it can raise — the duplicate pair — is closed by the database's
 * own unique key and classified above.
 *
 * The select keeps the returned payload to the new id; no stored row, instructor
 * or timestamp ever leaves this function.
 */
function createSupervisor(
  storedSessionId: string,
  eligibleInstructorId: string,
): Promise<CreatedExamSupervisorRecord> {
  return prisma.examSessionSupervisor.create({
    data: {
      sessionId: storedSessionId,
      instructorId: eligibleInstructorId,
    },
    select: {
      id: true,
    },
  });
}

/**
 * Read ONE stored supervisor, scoped by the SERVER-RESOLVED plan through the
 * session relation.
 *
 * `findFirst` with the relation filter — never `findUnique({ where: { id } })` —
 * so a supervisor under ANOTHER course's plan reads as `null` rather than being
 * found and then rejected by a comparison someone could later remove. The
 * relation filter is a WHERE condition and not an `include`, so no `ExamSession`
 * row is materialized by it.
 *
 * ONE column is selected. A removal does not need the instructor, the session or
 * the creation time, and reading them would put personal data in a place that
 * has no use for it. The id this returns is the ONLY value the delete below may
 * target.
 */
function findSupervisorForPlan(
  planId: string,
  supervisorId: string,
): Promise<ExistingExamSupervisorForDelete | null> {
  return prisma.examSessionSupervisor.findFirst({
    where: {
      id: supervisorId,
      session: {
        planId,
      },
    },
    select: {
      id: true,
    },
  });
}

/**
 * The SINGLE removal: delete exactly the row whose id the PLAN-SCOPED read
 * returned.
 *
 * The parameter is named for what it is — the STORED id — because the raw
 * submitted value never reaches here: the committed core passes `existing.id`,
 * and this binding has no access to anything else.
 *
 * `delete` and NOT `deleteMany`: the filter is the primary key, so the statement
 * removes exactly one row or raises `P2025`. That throw PROPAGATES — the
 * committed core classifies nothing at this step — because "the row vanished
 * between the verification and the write" is a genuinely different sentence from
 * "there is no such row", and reporting the second would tell a manager they
 * were wrong when they were not.
 *
 * `select` keeps the statement's payload narrow; the value is deliberately
 * discarded, because the core's success arm reports no id and echoing a
 * server-verified id back would confirm which ids exist.
 *
 * Nothing else is removed, no surviving row is touched, no count is updated and
 * no application-side cascade is performed.
 */
async function deleteSupervisor(storedSupervisorId: string): Promise<void> {
  await prisma.examSessionSupervisor.delete({
    where: {
      id: storedSupervisorId,
    },
    select: {
      id: true,
    },
  });
}

// ===========================================================================
// 1. Create
// ===========================================================================

/**
 * Record exactly ONE stored ExamSessionSupervisor against an ALREADY-EXISTING
 * session, in the ALREADY-EXISTING plan of one authorized, lifecycle-permitted
 * course offering.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. `requireAdminCourseOffering(courseOfferingId)` — admin first, then the
 *      exact offering; a redirect for a non-admin caller propagates untouched;
 *   2. `assertCourseOperationAllowed(status, "SCHEDULE_DRAFT_CONFIGURATION")`;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal (never an upsert);
 *   5. the committed input normalizer;
 *   6. invalid -> the core's input refusal, with NO session query, NO instructor
 *      query and NO write;
 *   7. ONE plan-scoped session read; missing or foreign -> the same refusal, and
 *      NO write;
 *   8. ONE eligibility read; not eligible -> refusal, NO write;
 *   9. ONE create.
 *
 * Only three failures are classified — the offering not-found, the lifecycle
 * denial and the duplicate pair. Every other error propagates unchanged, so a
 * real defect is never laundered into a form error, and the authorization
 * redirect is never swallowed: neither `instanceof` check matches a
 * `NEXT_REDIRECT` throw, and the conflict classifier requires a `P2002` code that
 * a redirect does not carry.
 */
export async function createExamSupervisor(
  courseOfferingId: string,
  rawInput: unknown,
): Promise<CreateExamSupervisorResult> {
  return createExamSupervisorWithDeps(courseOfferingId, rawInput, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findSessionForPlan,
    findEligibleInstructor,
    createSupervisor,
    isCourseNotFoundError,
    isOperationNotAllowedError,
    isUniqueConstraintError: isExamSupervisorConflictError,
  });
}

// ===========================================================================
// 2. Removal
// ===========================================================================

/**
 * Remove exactly ONE stored ExamSessionSupervisor from the plan of one
 * authorized, lifecycle-permitted course offering.
 *
 * Order (the committed pure core's contract, bound here to real effects):
 *   1. admin + exact offering;
 *   2. the lifecycle gate on the VERIFIED status;
 *   3. ONE `prisma.examPlan.findUnique` on the VERIFIED offering id;
 *   4. no plan -> the core's plan refusal;
 *   5. the target id is normalized; a malformed one refuses with NO query;
 *   6. ONE plan-scoped `findFirst`; missing or foreign -> the same refusal;
 *   7. ONE `delete` against the id THAT READ RETURNED.
 *
 * This is a HARD delete of ONE row. There is no archive column, this slice adds
 * none, and no schema is changed. No version token is required, and that is a
 * decision rather than an omission: a stored supervisor row is immutable — it
 * has no editable column at all — so a surviving id still identifies the same
 * relationship, and a row somebody else already removed is reported honestly as
 * not found by the scoped read.
 *
 * Only two failures are classified — the offering not-found and the lifecycle
 * denial. NO uniqueness classifier is bound here: this operation creates
 * nothing. Every other error propagates unchanged, including the `P2025` of a row
 * that disappeared mid-operation and the authorization redirect.
 */
export async function deleteExamSupervisor(
  courseOfferingId: string,
  supervisorId: unknown,
): Promise<DeleteExamSupervisorResult> {
  return deleteExamSupervisorWithDeps(courseOfferingId, supervisorId, {
    requireCourseContext,
    assertConfigurationAllowed,
    findExamPlanByCourseOfferingId,
    findSupervisorForPlan,
    deleteSupervisor,
    isCourseNotFoundError,
    isOperationNotAllowedError,
  });
}
