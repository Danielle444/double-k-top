"use server";

/**
 * EX-INST-VIEW-MVP — the ONE public entry point through which the instructor UI
 * reads an exam plan.
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING
 * ===========================================================================
 * It is a TRANSPORT WRAPPER and nothing else: it declares `"use server"`, takes
 * the requested course offering id, and hands it to the committed
 * `readInstructorExamPlan` reader. There is no Prisma client here, no session
 * lookup, no actor id, no course resolution, no capability check, no publication
 * option and no DTO narrowing — every one of those already lives inside the
 * committed reader, and duplicating any of them here would create a second,
 * unreviewed copy of a rule that must have exactly one home.
 *
 * THE READER IS THE AUTHORIZATION BOUNDARY. `readInstructorExamPlan` proves
 * identity from the SIGNED SESSION first (an ACTIVE instructor), re-authorizes
 * the REQUESTED offering second, and only then loads. A denial — anonymous,
 * expired, wrong-audience, inactive, unknown offering, disallowed offering —
 * returns the uniform EMPTY instructor DTO, so a caller can never tell a
 * non-existent offering from a forbidden one. That property is preserved here by
 * doing nothing: this wrapper neither inspects nor rewrites the result.
 *
 * WHY THE READER ITSELF IS NOT A `"use server"` MODULE. Everything exported from
 * a Server Action module becomes publicly callable over the network with a
 * stable id. `lib/actions/exam-role-readers.ts` exports the ADMIN and TRAINEE
 * readers alongside the instructor one, so marking that file would publish all
 * three at once. This module therefore exists to publish EXACTLY ONE of them,
 * and `exam-role-readers.ts` stays a plain server-only module — unchanged by
 * this slice.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT FROM THE SIGNATURE
 * ===========================================================================
 * `courseOfferingId` is the ONLY parameter, and it is a REQUEST rather than a
 * grant. There is no `instructorId`, no `studentId`, no `planId`, no
 * `requirePlanPublication` / `requireLessonPublication`, no `options` and no
 * `deps` — none of them is accepted, and none is even representable in this
 * signature, so no client can name another person, another plan or a different
 * publication rule.
 *
 * DRAFT VISIBILITY IS THE COMMITTED POLICY, NOT A CHOICE MADE HERE. An
 * authorized instructor sees DRAFT and PUBLISHED plans alike; that decision is
 * taken inside the reader's scope core and is neither re-stated nor made
 * configurable by this wrapper. The trainee publication rule is untouched.
 *
 * READ-ONLY: no create/update/upsert/delete, no transaction, no raw SQL, no
 * revalidation and no redirect. Nothing about login, sessions, cookies or
 * capabilities is touched.
 */
import { readInstructorExamPlan } from "./exam-role-readers";

/**
 * The instructor exam read contract, taken STRUCTURALLY from the committed
 * reader rather than re-imported from the narrowing module.
 *
 * Deriving it this way is deliberate: it is by construction the same contract
 * the reader already returns (it cannot drift, widen or narrow), and it keeps
 * the DTO module's single approved production consumer single. The instructor UI
 * imports this alias, so no client component names the narrowing module either.
 */
export type InstructorExamScheduleView = Awaited<
  ReturnType<typeof readInstructorExamPlan>
>;

/**
 * Read ONE requested course offering's exam plan as the signed-in instructor.
 *
 * The single statement below is the whole implementation on purpose. Adding a
 * try/catch that swallowed a failure would turn an infrastructure fault into an
 * empty schedule indistinguishable from "this course has no exams", which the
 * reader's own error classification exists to prevent — so real faults are
 * allowed to propagate and are surfaced by the UI as a neutral failure message.
 */
export async function getInstructorExamSchedule(
  courseOfferingId: string,
): Promise<InstructorExamScheduleView> {
  return readInstructorExamPlan(courseOfferingId);
}
