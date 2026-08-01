"use server";

/**
 * EX-TRAINEE-VIEW-MVP — the ONE public entry point through which the TRAINEE UI
 * reads a published exam day.
 *
 * ===========================================================================
 * THIS MODULE DECIDES NOTHING
 * ===========================================================================
 * It is a TRANSPORT WRAPPER and nothing else: it declares "use server" and calls
 * the committed trainee reader. There is no Prisma client here, no session
 * lookup, no student id, no course resolution, no capability check, no
 * publication option and no DTO narrowing — every one of those already lives
 * inside the committed reader, and duplicating any of them here would create a
 * second, unreviewed copy of a rule that must have exactly one home.
 *
 * THE READER IS THE AUTHORIZATION BOUNDARY. It proves the trainee's identity
 * from the SIGNED SESSION first, resolves their ONE authorized course through
 * the committed NON-SELECTABLE resolver second, and only then loads — under the
 * locked trainee options, which require a PUBLISHED plan and PUBLISHED lessons.
 * Every denial (anonymous, expired, wrong-audience, inactive, unenrolled,
 * ambiguously enrolled) comes back as the same EMPTY contract, so nothing a
 * caller can observe distinguishes "not published" from "not permitted". That
 * property is preserved here by doing nothing: this wrapper neither inspects nor
 * rewrites the result.
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
 * THERE IS NO PARAMETER AT ALL. There is no `selectedDate`, no `studentId`, no
 * `traineeId`, no `actorId`, no `courseOfferingId`, no `planId`, no `sessionId`,
 * no `requirePlanPublication` / `requireLessonPublication`, no `options` and no
 * `deps` — none is accepted, and none is even representable in this signature,
 * so no client can name another trainee, another course, another plan, a
 * different window or a different publication rule. This is strictly stronger
 * than the single-date signature it replaces, which still had one caller-supplied
 * value to normalize.
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
import { readTraineeExamSchedule } from "./exam-role-readers";

/**
 * The trainee exam schedule contract, taken STRUCTURALLY from the committed
 * reader rather than re-imported from the narrowing module.
 *
 * Deriving it this way is deliberate: it is by construction the same contract
 * the reader already returns (it cannot drift, widen or narrow), and it keeps
 * the DTO module's single approved production consumer single. The trainee UI
 * imports this alias, so no client component names the narrowing module either.
 */
export type TraineeExamScheduleView = Awaited<ReturnType<typeof readTraineeExamSchedule>>;

/**
 * Read the signed-in trainee's WHOLE published exam schedule — every date.
 *
 * ===========================================================================
 * IT TAKES NO ARGUMENT, WHICH IS THE STRONGEST FORM OF THE OLD GUARANTEE
 * ===========================================================================
 * The day wrapper this replaces accepted exactly one value, a date, and its
 * whole safety argument was about everything it did NOT accept. This one accepts
 * nothing at all: there is no `selectedDate`, no `studentId`, no
 * `courseOfferingId`, no `planId`, no range and no publication option, so a
 * client cannot name another trainee, another course, another plan, a different
 * window or a different publication rule — none is representable.
 *
 * EXACTLY ONE FUNCTION IS EXPORTED, and that is deliberate. Everything exported
 * from a "use server" module becomes publicly callable over the network with a
 * stable id, so this module publishes the ONE reading the trainee UI needs and
 * nothing beside it. The committed `readTraineeExamDay` reader is untouched and
 * still available to server-side callers; it is simply not published here, since
 * a second endpoint returning a subset of this one's data would be network
 * surface nobody needs.
 *
 * PUBLICATION IS STILL THE COMMITTED POLICY, NOT A CHOICE MADE HERE. A trainee
 * sees PUBLISHED plans and PUBLISHED lessons only, and Level-1-only beginner
 * containment still applies; both decisions are taken inside the reader's scope
 * core and are neither re-stated nor made configurable by this wrapper.
 *
 * The single statement below is the whole implementation on purpose. Adding a
 * try/catch that swallowed a failure would turn an infrastructure fault into an
 * empty schedule indistinguishable from "nothing is published", which the
 * reader's own error classification exists to prevent — so real faults are
 * allowed to propagate and are surfaced by the UI as a neutral failure message.
 */
export async function getTraineeExamSchedule(): Promise<TraineeExamScheduleView> {
  return readTraineeExamSchedule();
}
