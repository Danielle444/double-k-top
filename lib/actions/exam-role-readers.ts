/**
 * EXAM EX-S5A-4B — the ROLE-SCOPED exam readers: real bindings.
 *
 * Deliberately NOT a `"use server"` module, for the same reason as
 * ./exam-read-io and ./horse-feeding-progress-io: everything exported from a
 * `"use server"` file becomes a PUBLICLY CALLABLE Server Action with a stable
 * network id, and a reader that returns another course's exam schedule to
 * whoever guesses the argument is exactly what this slice exists to prevent.
 * These are ORDINARY server functions. A Server Action or a page that consumes
 * them is a LATER, separately reviewed slice (EX-S5A-5) — nothing in `app/`
 * calls them today.
 *
 * SERVER-ONLY BY DECLARATION. `import "server-only"` (the repository's existing
 * convention, used by lib/course/capabilities/attendance-capability-resolver.ts
 * and current-attendance-capability.ts) turns an accidental import from a
 * `"use client"` module into a BUILD ERROR. That guarantee is needed here and
 * not merely inherited: this module binds session/actor resolution, course
 * authorization, Prisma-backed IO and the internal `ExamPlanPayload`, and the
 * ABSENCE of a `"use server"` directive says nothing about who may import it.
 * The two properties are independent — one keeps the functions off the network,
 * the other keeps the module out of the browser bundle.
 *
 * READ-ONLY: there is no `create`, `update`, `upsert`, `delete`, `deleteMany`,
 * `updateMany`, `createMany`, `$executeRaw` or transaction anywhere in this
 * file, and none may be added. The exam WRITE surface is its own authorized
 * slice.
 *
 * DIVISION OF LABOUR:
 *   lib/exam/exam-read-scope-core.ts — the AUTHORIZATION ORDER and the
 *                                      fail-closed contract (pure, DB-free)
 *   lib/exam/exam-read-dto.ts        — WHAT each role may see (pure narrowing)
 *   lib/exam/exam-plan-loader-core.ts — the LOAD ORDER (pure, DB-free)
 *   lib/actions/exam-read-io.ts      — the QUERIES
 *   this module                      — binding the REAL actor, course and IO
 *                                      dependencies to the pure order above
 *
 * Every exported reader returns a ROLE-NARROWED, client-safe contract. NONE of
 * them returns `ExamPlanPayload` — the role-neutral superset that carries other
 * people's student ids and the beginner rows' child and PARENT CONTACT detail —
 * and none of them accepts an actor id, a plan id or a publication option. The
 * trainee reader accepts a DATE and nothing else.
 *
 * ===========================================================================
 * THE ACTOR IS ALWAYS SERVER-DERIVED
 * ===========================================================================
 * Identity comes from the SIGNED SESSION through the canonical Actor DAL, and
 * the course scope comes from the committed course resolvers. No client-supplied
 * `studentId`, `instructorId` or trainee `courseOfferingId` is trusted, accepted
 * or even representable in a signature here. Nothing about login, the session,
 * the cookie format or identity persistence is touched by this slice.
 *
 * The admin and instructor readers take an EXPLICIT `courseOfferingId`, which is
 * a REQUEST: each is re-authorized server-side by the existing helper, and only
 * the DB-VERIFIED id that helper returns ever reaches a query.
 *
 * ===========================================================================
 * THE TEMPORARY INSTRUCTOR BOUNDARY — REVISIT WHEN `EXAMS` EXISTS
 * ===========================================================================
 * There is NO `EXAMS` capability: no catalog key, no database row, no reader.
 * The CURRENT instructor boundary is therefore exactly:
 *
 *     an ACTIVE instructor session  +  an authorized course offering
 *
 * and nothing else. `SCHEDULE` and `TEACHING_PRACTICE` are NOT reused — an exam
 * read must not silently inherit another module's product decisions — and no
 * placeholder capability check is added, because a check that always passes
 * reads as enforcement to the next person who edits this file.
 *
 * INSERTING THE REAL `EXAMS` CAPABILITY IS A SEPARATE, REVIEWED SLICE, and THIS
 * MODULE MUST BE REVISITED THEN: the capability gate belongs immediately after
 * course resolution and before the loader, for the instructor and trainee
 * readers alike.
 *
 * ===========================================================================
 * CROSS-COURSE TEACHING PRACTICE — A DEPLOYMENT PRECONDITION, NOT A FIX
 * ===========================================================================
 * `TeachingPracticeLesson` has NO `courseOfferingId`; the only thing binding a
 * lesson to a plan is that plan's explicit source-date selection, and no date is
 * inferred anywhere in this slice. These readers MUST NOT BE DEPLOYED for two or
 * more offerings whose plans can select the SAME source date without a SEPARATE,
 * REVIEWED CONTAINMENT DECISION first — on that date both plans would read the
 * same lessons, so one course's trainees, children and parent contacts would
 * appear under the other course's exam plan. The answer is DATA (a schema-level
 * course binding, a per-plan lesson allow-list, or a product rule that source
 * dates may not be shared); it is not attempted here.
 */
import "server-only";

import { requireAdminCourseOffering } from "@/lib/course/admin-course-context";
import { requireCurrentInstructor, requireCurrentTrainee } from "@/lib/auth/actor";
import {
  resolveInstructorCourseOffering,
  resolveTraineeCourseOffering,
} from "@/lib/course/actor-course-offering";
import { UnauthenticatedActorError } from "@/lib/auth/actor-types";
import {
  AmbiguousTraineeCourseOfferingError,
  InstructorCourseOfferingNotAllowedError,
  InstructorCourseOfferingUnavailableError,
  MissingInstructorCourseOfferingIdError,
  NoTraineeCourseOfferingError,
} from "@/lib/course/actor-course-offering-core";
import { loadExamPlan } from "@/lib/exam/exam-plan-loader-core";
import {
  adminExamPlanLoadOptions,
  readAdminExamPlanWithDeps,
  readInstructorExamPlanWithDeps,
  readTraineeExamDayWithDeps,
  readTraineeExamScheduleWithDeps,
  type AdminExamReadDto,
  type ExamPlanLoadFn,
  type InstructorExamReadDto,
  type TraineeExamDayDto,
} from "@/lib/exam/exam-read-scope-core";
import {
  examPlanReadDeps,
  fetchInstructorDisplayNamesByIds,
  fetchStudentDisplayNamesByIds,
} from "./exam-read-io";
import {
  readAdminExamWaveViewWithDeps,
  type AdminExamWaveView,
} from "@/lib/exam/admin-exam-wave-view-core";

/**
 * The ONE real loader binding: the committed pure load order, wired to the
 * committed read-only IO bundle.
 *
 * It is bound HERE rather than inside the pure core so that core stays DB-free,
 * and so this module is the single place in the repository where the internal
 * `ExamPlanPayload` is produced. That payload never escapes: every exported
 * function below hands it straight to the pure scope core, which returns only a
 * narrowed DTO.
 */
const loadPlan: ExamPlanLoadFn = (input) => loadExamPlan(input, examPlanReadDeps);

/**
 * Is this failure "this INSTRUCTOR has no authorized course context" rather than
 * an infrastructure fault?
 *
 *  - UnauthenticatedActorError               — anonymous / expired /
 *                                              wrong-audience / INACTIVE
 *                                              instructor session;
 *  - MissingInstructorCourseOfferingIdError  — no explicit offering was stated;
 *  - InstructorCourseOfferingNotAllowedError — the request is outside the
 *                                              temporary instructor policy;
 *  - InstructorCourseOfferingUnavailableError — the requested offering does not
 *                                              exist, or the fetch returned a
 *                                              different row.
 *
 * The LAST entry is deliberately classified as a denial here, unlike in the
 * student contact directory, which lets it propagate. The locked rule for this
 * reader is that a denied result must not reveal whether the requested offering
 * EXISTS: if a non-existent id produced an error page while a disallowed one
 * produced an empty view, the pair of responses would be an existence oracle
 * over every offering id. Both therefore return the identical empty DTO.
 *
 * Everything else — a Prisma failure, a session fault, a loader defect, a
 * programming error — is NOT a denial and propagates unchanged.
 */
function isInstructorExamCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof MissingInstructorCourseOfferingIdError ||
    error instanceof InstructorCourseOfferingNotAllowedError ||
    error instanceof InstructorCourseOfferingUnavailableError
  );
}

/**
 * Is this failure "this TRAINEE has no single, trustworthy course context"?
 *
 *  - UnauthenticatedActorError           — anonymous / expired / wrong-audience
 *                                          / inactive trainee session;
 *  - NoTraineeCourseOfferingError        — zero ACTIVE enrollments into an
 *                                          ACTIVE offering (so an unenrolled
 *                                          trainee simply sees nothing);
 *  - AmbiguousTraineeCourseOfferingError — more than one eligible enrollment,
 *                                          which the resolver refuses to guess.
 *
 * Everything else propagates — including `IncompleteCourseOfferingError`, which
 * means an ACTIVE offering is missing its dates. That is a real data defect, and
 * laundering it into "you have no exams today" would hide it from the only
 * people who could fix it.
 */
function isTraineeExamCourseContextDenial(error: unknown): boolean {
  return (
    error instanceof UnauthenticatedActorError ||
    error instanceof NoTraineeCourseOfferingError ||
    error instanceof AmbiguousTraineeCourseOfferingError
  );
}

/**
 * The ADMIN reading of one course offering's exam plan — DRAFT AND PUBLISHED.
 *
 * `courseOfferingId` is the ONLY parameter. It is re-authorized by the existing
 * admin course-context helper, which runs `requireAdmin()` FIRST (redirecting an
 * unauthenticated or non-admin caller) and only then looks up exactly that
 * offering, throwing the project's typed not-found for an unknown id. Neither is
 * converted into an empty result here: those are the existing admin conventions
 * on every other admin surface, and this slice does not change them.
 */
export async function readAdminExamPlan(
  courseOfferingId: string,
): Promise<AdminExamReadDto> {
  return readAdminExamPlanWithDeps(courseOfferingId, {
    requireAdminCourseOffering,
    loadPlan,
    fetchStudentDisplayNames: fetchStudentDisplayNamesByIds,
    fetchInstructorDisplayNames: fetchInstructorDisplayNamesByIds,
  });
}

/**
 * EX-ADMIN-WORKSPACE-UX (BLOCKER-1) — the ADMIN-ONLY WAVE VIEW of one course
 * offering: which assignment is examined at which DERIVED moment, and who shares
 * that moment.
 *
 * IT DERIVES NOTHING. It runs the SAME `loadPlan` binding, under the SAME
 * `adminExamPlanLoadOptions`, that `readAdminExamPlan` above runs — so every
 * clock value it publishes is the committed block timetable core's own output,
 * reached through the committed adapter, and is identical to the time the
 * instructor DTO and the trainee day show for the same block. The pure narrowing
 * it hands the payload to only GROUPS those values; it computes none.
 *
 * WHY IT IS A SECOND FUNCTION rather than a wider `AdminExamReadDto`: that DTO
 * is SHARED with the instructor reading, and widening it to carry a write target
 * would change the instructor's contract for a need only the admin write surface
 * has. This function is admin-only, and the shared DTO is untouched.
 *
 * The payload still never escapes this module: it is produced here, in the ONE
 * place allowed to produce it, and handed straight to a pure narrowing that
 * returns assignment ids and derived times and nothing else — no `studentId`, no
 * `pairingIndex`, no name, no horse, no topic and no discipline.
 */
export async function readAdminExamWaveView(
  courseOfferingId: string,
): Promise<AdminExamWaveView> {
  return readAdminExamWaveViewWithDeps(courseOfferingId, {
    requireAdminCourseOffering,
    loadPlan: (verifiedCourseOfferingId, verifiedCourseLevel) =>
      loadPlan({
        courseOfferingId: verifiedCourseOfferingId,
        // The SAME committed options producer `readAdminExamPlan` above uses,
        // derived from the SAME DB-verified level — so the beginner containment
        // gate and every other load decision are identical for both readings.
        options: adminExamPlanLoadOptions(verifiedCourseLevel),
      }),
  });
}

/**
 * The INSTRUCTOR reading of one REQUESTED course offering's exam plan — DRAFT
 * AND PUBLISHED, for an ACTIVE instructor with an authorized course.
 *
 * The requested id is a request, not a grant: identity is proven first, the id
 * is re-authorized second, and only the DB-verified offering the resolver
 * returned reaches the loader. Every denial returns the uniform empty DTO.
 */
export async function readInstructorExamPlan(
  requestedCourseOfferingId: string,
): Promise<InstructorExamReadDto> {
  return readInstructorExamPlanWithDeps(requestedCourseOfferingId, {
    requireInstructorId: async () => (await requireCurrentInstructor()).id,
    resolveInstructorCourseOffering,
    isCourseContextDenial: isInstructorExamCourseContextDenial,
    loadPlan,
    fetchStudentDisplayNames: fetchStudentDisplayNamesByIds,
    fetchInstructorDisplayNames: fetchInstructorDisplayNamesByIds,
  });
}

/**
 * The TRAINEE reading of ONE selected day — PUBLISHED PLANS AND PUBLISHED
 * LESSONS ONLY.
 *
 * `selectedDate` (an exact `YYYY-MM-DD` token) is the ONLY parameter: the
 * student id comes from the signed session and the course comes from the
 * committed NON-SELECTABLE trainee resolver, which takes no arguments at all.
 * There is no parameter through which a caller could name another trainee,
 * another course, another plan or a draft reading.
 *
 * No instructor-name lookup is wired into this reader — not skipped at runtime,
 * but absent from the dependency contract — because the one instructor-shaped
 * value a trainee sees already arrives as a display name on the live beginner
 * detail.
 */
export async function readTraineeExamDay(
  selectedDate: string,
): Promise<TraineeExamDayDto> {
  return readTraineeExamDayWithDeps(selectedDate, {
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    resolveTraineeCourseOffering,
    isCourseContextDenial: isTraineeExamCourseContextDenial,
    loadPlan,
    fetchStudentDisplayNames: fetchStudentDisplayNamesByIds,
  });
}

/**
 * The TRAINEE reading of their WHOLE schedule — PUBLISHED PLANS AND PUBLISHED
 * LESSONS ONLY, every date, in ONE load.
 *
 * IT TAKES NO PARAMETER AT ALL. The student id comes from the signed session and
 * the course from the committed NON-SELECTABLE trainee resolver, exactly as
 * above; removing the date removes the last argument, so there is nothing a
 * caller can name — not another trainee, another course, another plan, a date, a
 * range or a draft reading.
 *
 * THE DEPENDENCY BUNDLE IS BYTE-IDENTICAL to the day reader's, deliberately: the
 * same identity source, the same resolver, the same denial classification, the
 * same loader and the same single student-name fetch. A multi-date reading is
 * therefore the same authorization with the same publication gates and the same
 * Level-1 beginner containment — the pure scope core, not this binding, is where
 * that is proven, and it reuses the committed day projection once per date over
 * ONE loaded payload rather than reading once per date.
 *
 * The day reader above is KEPT: it is a committed public reader, and narrowing
 * to a single day remains a legitimate reading that this one does not replace.
 */
export async function readTraineeExamSchedule(): Promise<TraineeExamDayDto> {
  return readTraineeExamScheduleWithDeps({
    requireTraineeId: async () => (await requireCurrentTrainee()).id,
    resolveTraineeCourseOffering,
    isCourseContextDenial: isTraineeExamCourseContextDenial,
    loadPlan,
    fetchStudentDisplayNames: fetchStudentDisplayNamesByIds,
  });
}
