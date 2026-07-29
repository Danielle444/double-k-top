/**
 * EXAM EX-S5A-3 — the exam plan's READ-ONLY IO bindings.
 *
 * Deliberately NOT a `"use server"` module, for the same reason as
 * ./horse-feeding-progress-io: everything exported from a `"use server"` file
 * becomes a PUBLICLY CALLABLE Server Action, and nothing in this file performs
 * any authorization of its own. Keeping it here means the only way to reach
 * these queries is through a server module that has already resolved the actor
 * and proven the course scope — the role wrappers of EX-S5A-4. No export here is
 * a callable action surface.
 *
 * THE ROWS THESE QUERIES RETURN ARE SENSITIVE. They are the ROLE-NEUTRAL
 * SUPERSET — other people's student ids, and the beginner lessons' child and
 * parent-contact detail — and they must never be returned to a browser as they
 * stand. The privacy boundary is the EX-S5A-4 server-side, role-specific DTO
 * narrowing; being unexported to the client, being `readonly` and being frozen
 * are mutation and reachability properties, not authorization ones.
 *
 * DIVISION OF LABOUR:
 *   lib/exam/exam-plan-loader-core.ts — the LOAD ORDER and the composition
 *                                       (pure, dependency-injected, DB-free)
 *   this module                       — the QUERIES and the row mapping
 *   EX-S5A-4                          — WHO may ask, and what they may see
 *
 * ===========================================================================
 * READ-ONLY, BY CONSTRUCTION
 * ===========================================================================
 * Every function here is a single `findUnique` / `findMany`. There is no
 * `create`, `update`, `upsert`, `delete`, `deleteMany`, `updateMany`,
 * `createMany`, `$executeRaw` or transaction anywhere in this file, and none may
 * be added: the Exams area never writes to Teaching Practice, and the exam
 * WRITE surface is a separate, authorized slice.
 *
 * ===========================================================================
 * NARROW SELECTS — NOTHING TO STRIP EVER LEAVES THE DATABASE
 * ===========================================================================
 * Each select lists EXACTLY the columns its committed row contract declares.
 *
 *  - The Teaching-Practice lesson query is its OWN narrow select rather than the
 *    general-purpose lesson-detail reader: that reader selects the practice
 *    evaluation relation unconditionally and nulls it afterwards in its mapper.
 *    Fetch-then-strip is acceptable there; it is NOT acceptable here, because
 *    the locked rule for the Exams area is "do not select, map, return or
 *    render" any evaluation, rating, grade, score or result. The exam slice
 *    therefore never mentions that relation at all.
 *  - The exam session select omits every DEPRECATED, UNWRITTEN column —
 *    `kind`, `phase`, `beginnerFormat`, `capacity`, `interfaceSessionId`,
 *    `sourceTeachingPracticeLessonId`, `copiedAt`, `roleLabelOverrides` — and
 *    `ExamAssignment.sourcePracticeRole`. `ExamBeginnerChild` is retained empty
 *    and unwritten and is not read at all. A column that is never selected
 *    cannot be misread downstream, which is stronger than a rule someone must
 *    remember.
 *
 * ===========================================================================
 * NO PLAN ID FROM A CALLER
 * ===========================================================================
 * `fetchPlanByCourseOfferingId` is the ONLY entry point that takes an id from
 * outside, and it takes a `courseOfferingId`. Every other query takes the
 * `planId` the loader read from THAT row. No exported function here lets a
 * caller choose which plan it reads.
 *
 * ===========================================================================
 * DATES ARE OPAQUE TOKENS ABOVE THIS LINE
 * ===========================================================================
 * `@db.Date` columns are converted ONCE here with the shared `dateKey`, and
 * `DateTime` stamps become epoch milliseconds / sortable ISO tokens, so every
 * pure core above compares opaque strings and numbers and constructs no `Date`.
 * The Teaching-Practice date filter converts the other way with the shared
 * `parseDateKey`, so the query's day boundaries use the same UTC convention the
 * rest of the repository does.
 */
import { prisma } from "@/lib/prisma";
import { dateKey, parseDateKey } from "@/lib/dates";
import type {
  ExamPlanIdentityRow,
  ExamPlanLoadDeps,
  ExamPlanSourceDateRow,
} from "@/lib/exam/exam-plan-loader-core";
import type {
  StoredExamDefinitionRow,
  StoredExamSessionRow,
} from "@/lib/exam/exam-stored-adapter-core";
import type { TeachingPracticeExamLessonRow } from "@/lib/exam/exam-tp-source-adapter-core";

// ===========================================================================
// 1. The plan identity/publication row — fetched FIRST and ALONE
// ===========================================================================

/**
 * The plan of ONE course offering, or `null`.
 *
 * `ExamPlan.courseOfferingId` is `@unique`, so this is a single indexed lookup.
 * It selects the identity and publication columns and NOTHING else: when the
 * loader's publication gate closes on the result, no content column has been
 * read at all.
 */
export async function fetchExamPlanByCourseOfferingId(
  courseOfferingId: string,
): Promise<ExamPlanIdentityRow | null> {
  const plan = await prisma.examPlan.findUnique({
    where: { courseOfferingId },
    select: {
      id: true,
      publishedAt: true,
      updatedAt: true,
    },
  });
  if (plan === null) return null;
  return {
    id: plan.id,
    // Epoch ms, matching the committed publication convention. Never a `Date`.
    publishedAt: plan.publishedAt === null ? null : plan.publishedAt.getTime(),
    updatedAt: plan.updatedAt.getTime(),
  };
}

// ===========================================================================
// 2. Definitions
// ===========================================================================

/**
 * Every `ExamDefinition` of one plan, in a deterministic order.
 *
 * The select is exactly `StoredExamDefinitionRow`: the behavioural `kind`,
 * the two timetable inputs and the three conformance flags. `ExamDefinition` is
 * always plan-scoped, so `planId` is the whole scope.
 */
export async function fetchExamDefinitionsByPlanId(
  planId: string,
): Promise<readonly StoredExamDefinitionRow[]> {
  const rows = await prisma.examDefinition.findMany({
    where: { planId },
    select: {
      id: true,
      name: true,
      kind: true,
      durationMinutes: true,
      parallelCapacity: true,
      requiresInstructedTrainee: true,
      requiresLessonTopic: true,
      requiresDiscipline: true,
      orderIndex: true,
    },
    orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
  });
  return rows;
}

// ===========================================================================
// 3. Sessions (+ their bounded children)
// ===========================================================================

/**
 * Every stored `ExamSession` of one plan with its assignments, breaks and
 * supervisors, in ONE query.
 *
 * The nested relations are BOUNDED per session (a handful of rows each) and are
 * fetched as part of this single call, so no per-session query exists anywhere
 * in this slice. The ordering is deterministic for reproducibility only — every
 * pure core sorts its own output regardless.
 */
export async function fetchExamSessionsByPlanId(
  planId: string,
): Promise<readonly StoredExamSessionRow[]> {
  const rows = await prisma.examSession.findMany({
    where: { planId },
    select: {
      id: true,
      definitionId: true,
      date: true,
      startTime: true,
      endTime: true,
      orderIndex: true,
      arena: true,
      title: true,
      notes: true,
      individualPublishedAt: true,
      updatedAt: true,
      assignments: {
        select: {
          id: true,
          studentId: true,
          role: true,
          orderIndex: true,
          horseName: true,
          instructionTopic: true,
          discipline: true,
          pairingIndex: true,
          notes: true,
        },
        orderBy: [{ orderIndex: "asc" }, { id: "asc" }],
      },
      breaks: {
        select: {
          id: true,
          afterWaveIndex: true,
          durationMinutes: true,
          label: true,
        },
        orderBy: [{ afterWaveIndex: "asc" }, { id: "asc" }],
      },
      supervisors: {
        select: { instructorId: true },
        orderBy: { instructorId: "asc" },
      },
    },
    orderBy: [{ date: "asc" }, { orderIndex: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    definitionId: row.definitionId,
    // The single `@db.Date` → `YYYY-MM-DD` conversion. Nothing above this line
    // sees a `Date`.
    date: dateKey(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    orderIndex: row.orderIndex,
    arena: row.arena,
    title: row.title,
    notes: row.notes,
    individualPublishedAt:
      row.individualPublishedAt === null ? null : row.individualPublishedAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    assignments: row.assignments,
    breaks: row.breaks,
    supervisorInstructorIds: row.supervisors.map((s) => s.instructorId),
  }));
}

// ===========================================================================
// 4. The plan's EXPLICIT Teaching-Practice source dates
// ===========================================================================

/**
 * The plan's selected Teaching-Practice dates — the ONLY stored beginner fact.
 *
 * `date` is the only column selected, because it is the only one that exists
 * worth reading: the table stores a pointer and nothing else. `(planId, date)`
 * is unique, so the ascending order is total.
 */
export async function fetchExamSourceDatesByPlanId(
  planId: string,
): Promise<readonly ExamPlanSourceDateRow[]> {
  const rows = await prisma.examTeachingPracticeSourceDate.findMany({
    where: { planId },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return rows.map((row) => ({ date: dateKey(row.date) }));
}

// ===========================================================================
// 5. The LIVE Teaching-Practice lessons of those explicit dates
// ===========================================================================

/**
 * The Teaching-Practice lessons falling on the plan's explicit source dates, in
 * ONE batched `date IN (...)` query.
 *
 * The caller passes the ALREADY-NORMALIZED explicit date list and never calls
 * this with an empty one — a plan that selected no beginner dates must read no
 * lessons at all, rather than reading everything.
 *
 * `TeachingPracticeLesson` has NO course-offering column: a lesson is not
 * course-scoped in the database, so the plan's own explicit date selection is
 * the only thing binding these rows to this plan. That is precisely why no date
 * may ever be inferred upstream.
 *
 * The select carries operational and scheduling columns ONLY — no evaluation
 * relation is named anywhere in it.
 */
export async function fetchExamTeachingPracticeLessonsByDates(
  dates: readonly string[],
): Promise<readonly TeachingPracticeExamLessonRow[]> {
  if (dates.length === 0) return [];

  const rows = await prisma.teachingPracticeLesson.findMany({
    where: { date: { in: dates.map((d) => parseDateKey(d)) } },
    select: {
      id: true,
      practiceType: true,
      date: true,
      startTime: true,
      endTime: true,
      createdAt: true,
      groupName: true,
      location: true,
      notes: true,
      isPublished: true,
      roleLabelOverrides: true,
      responsibleInstructorId: true,
      responsibleInstructor: { select: { fullName: true } },
      participants: {
        select: {
          id: true,
          traineeId: true,
          role: true,
          isManualOverride: true,
          createdAt: true,
          trainee: { select: { fullName: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
      childAssignments: {
        select: {
          id: true,
          childId: true,
          horseName: true,
          equipmentNotes: true,
          isAbsent: true,
          child: {
            select: {
              fullName: true,
              age: true,
              gender: true,
              parentName: true,
              parentPhone: true,
              notes: true,
            },
          },
        },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ date: "asc" }, { startTime: "asc" }, { id: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    practiceType: row.practiceType,
    date: dateKey(row.date),
    startTime: row.startTime,
    endTime: row.endTime,
    // An opaque SORTABLE token, never parsed as a date above this line.
    createdAt: row.createdAt.toISOString(),
    groupName: row.groupName,
    location: row.location,
    notes: row.notes,
    isPublished: row.isPublished,
    // Unvalidated JSON, handed over verbatim: the source adapter is the boundary
    // that normalizes it fail-closed.
    roleLabelOverrides: row.roleLabelOverrides ?? null,
    responsibleInstructorId: row.responsibleInstructorId,
    // DISPLAY-ONLY. Identity is the id above and is never derived from a name.
    responsibleInstructorName: row.responsibleInstructor?.fullName ?? null,
    participants: row.participants.map((p) => ({
      id: p.id,
      traineeId: p.traineeId,
      traineeName: p.trainee?.fullName ?? null,
      role: p.role,
      isManualOverride: p.isManualOverride,
      createdAt: p.createdAt.toISOString(),
    })),
    childAssignments: row.childAssignments.map((c) => ({
      id: c.id,
      childId: c.childId,
      childName: c.child?.fullName ?? null,
      childAge: c.child?.age ?? null,
      childGender: c.child?.gender ?? null,
      // The CHILD's own notes (the lesson's notes are the column above).
      childNotes: c.child?.notes ?? null,
      parentName: c.child?.parentName ?? null,
      parentPhone: c.child?.parentPhone ?? null,
      horseName: c.horseName,
      equipmentNotes: c.equipmentNotes,
      isAbsent: c.isAbsent,
    })),
  }));
}

// ===========================================================================
// The assembled dependency object
// ===========================================================================

/**
 * The real bindings, in the exact shape the pure loader injects.
 *
 * This is a DEPENDENCY BUNDLE, not an entry point: it performs no authorization,
 * resolves no actor and is not a Server Action. The EX-S5A-4 role wrappers pass
 * it to `loadExamPlan` after they have resolved the actor and the course scope,
 * and then NARROW the resulting payload before anything is returned to a client
 * — the loader's output is the sensitive superset, never a client shape.
 */
export const examPlanReadDeps: ExamPlanLoadDeps = {
  fetchPlanByCourseOfferingId: fetchExamPlanByCourseOfferingId,
  fetchDefinitionsByPlanId: fetchExamDefinitionsByPlanId,
  fetchSessionsByPlanId: fetchExamSessionsByPlanId,
  fetchSourceDatesByPlanId: fetchExamSourceDatesByPlanId,
  fetchTeachingPracticeLessonsByDates: fetchExamTeachingPracticeLessonsByDates,
};
