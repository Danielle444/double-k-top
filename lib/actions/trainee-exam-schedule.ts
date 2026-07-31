"use server";

/**
 * EX-TRAINEE-VIEW-MVP — the ONE public entry point through which the TRAINEE UI
 * reads a published exam day.
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING
 * ===========================================================================
 * It is a TRANSPORT WRAPPER and nothing else: it declares "use server", takes
 * the selected calendar day, and hands it to the committed `readTraineeExamDay`
 * reader. There is no Prisma client here, no session lookup, no student id, no
 * course resolution, no capability check, no publication option and no DTO
 * narrowing — every one of those already lives inside the committed reader, and
 * duplicating any of them here would create a second, unreviewed copy of a rule
 * that must have exactly one home.
 *
 * THE READER IS THE AUTHORIZATION BOUNDARY. It proves the trainee's identity
 * from the SIGNED SESSION first, resolves their ONE authorized course through
 * the committed NON-SELECTABLE resolver second, and only then loads — under the
 * locked trainee options, which require a PUBLISHED plan and PUBLISHED lessons.
 * Every denial (anonymous, expired, wrong-audience, inactive, unenrolled,
 * ambiguously enrolled) and every unusable date come back as the same EMPTY day
 * contract, so nothing a caller can observe distinguishes "not published" from
 * "not permitted". That property is preserved here by doing nothing: this
 * wrapper neither inspects nor rewrites the result.
 *
 * WHY THE READER ITSELF IS NOT A "use server" MODULE. Everything exported from a
 * Server Action module becomes publicly callable over the network with a stable
 * id. `exam-role-readers` exports the ADMIN and INSTRUCTOR readers alongside the
 * trainee one, so marking that file would publish all three at once. This module
 * therefore exists to publish EXACTLY ONE of them, and that module stays a plain
 * server-only module — unchanged by this slice, exactly as the instructor
 * wrapper left it.
 *
 * ===========================================================================
 * WHAT IS DELIBERATELY ABSENT FROM THE SIGNATURE
 * ===========================================================================
 * `selectedDate` is the ONLY parameter. There is no `studentId`, no `traineeId`,
 * no `actorId`, no `courseOfferingId`, no `planId`, no `sessionId`, no
 * `requirePlanPublication` / `requireLessonPublication`, no `options` and no
 * `deps` — none is accepted, and none is even representable in this signature,
 * so no client can name another trainee, another course, another plan or a
 * different publication rule. The date is a plain calendar token; the reader
 * normalizes it and treats anything unusable as an empty day.
 *
 * PUBLICATION IS THE COMMITTED POLICY, NOT A CHOICE MADE HERE. A trainee sees
 * PUBLISHED plans and PUBLISHED lessons only; that decision is taken inside the
 * reader's scope core and is neither re-stated nor made configurable by this
 * wrapper. The admin and instructor draft rules are untouched.
 *
 * READ-ONLY: no create/update/upsert/delete, no transaction, no raw SQL, no
 * revalidation and no redirect. Nothing about login, sessions, cookies or
 * capabilities is touched.
 */
import { readTraineeExamDay } from "./exam-role-readers";

/**
 * The trainee exam day contract, taken STRUCTURALLY from the committed reader
 * rather than re-imported from the narrowing module.
 *
 * Deriving it this way is deliberate: it is by construction the same contract
 * the reader already returns (it cannot drift, widen or narrow), and it keeps
 * the DTO module's single approved production consumer single. The trainee UI
 * imports this alias, so no client component names the narrowing module either.
 */
export type TraineeExamScheduleView = Awaited<ReturnType<typeof readTraineeExamDay>>;

/**
 * Read ONE selected day's exam schedule as the signed-in trainee.
 *
 * The single statement below is the whole implementation on purpose. Adding a
 * try/catch that swallowed a failure would turn an infrastructure fault into an
 * empty day indistinguishable from "nothing is published for this date", which
 * the reader's own error classification exists to prevent — so real faults are
 * allowed to propagate and are surfaced by the UI as a neutral failure message.
 */
export async function getTraineeExamDaySchedule(
  selectedDate: string,
): Promise<TraineeExamScheduleView> {
  return readTraineeExamDay(selectedDate);
}
