"use server";

/**
 * EXAM EX-S5B-5C — the SINGLE Server Action of the course-scoped exams route.
 *
 * It does exactly ONE thing: create ONE ExamDefinition under the ALREADY-EXISTING
 * ExamPlan of ONE EXPLICIT CourseOffering, by delegating to the committed
 * EX-S5B-2 writer. It performs no other write of any kind.
 *
 * ONE EXPORT, DELIBERATELY. Everything exported from a `"use server"` file
 * becomes a PUBLICLY CALLABLE Server Action with a stable network id, so the
 * export list IS the attack surface. The committed writer module also exposes
 * edit, safe removal and atomic reorder; none of them is re-exported, wrapped or
 * imported here, so this slice adds exactly one callable mutation to the app and
 * the other three remain unreachable from any client.
 *
 * ===========================================================================
 * THE ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. `requireAdmin()` — the FIRST awaited operation in the body. No FormData
 *      is read, no value is coerced and no writer is entered before it resolves.
 *      It fails closed by REDIRECTING (a `NEXT_REDIRECT` throw), so a denial
 *      provably prevents every later step rather than merely being checked;
 *   2. the FormData mapping — pure, local, and incapable of naming a course or a
 *      plan (see below);
 *   3. `createExamDefinition(courseOfferingId, rawInput)` — the committed
 *      writer, which independently re-runs the admin boundary, re-verifies the
 *      exact offering, gates it on the course lifecycle and resolves the plan id
 *      SERVER-SIDE from the verified offering;
 *   4. on success, revalidate EXACTLY this exams path and redirect back to it;
 *      on refusal, redirect back with a stable code and nothing else.
 *
 * `courseOfferingId` is the SERVER-BOUND leading argument. The page binds the
 * VERIFIED `context.id` via `.bind`, so the value travels inside the encrypted
 * Server Action payload and is not forgeable from the client. It is NEVER read
 * from a form field, a hidden input, a query string, a cookie or a
 * current-offering resolver.
 *
 * ===========================================================================
 * WHAT THE FORM CANNOT SAY
 * ===========================================================================
 * The mapping below reads SEVEN named fields and nothing else. `courseOfferingId`
 * and `planId` are not among them — not filtered out, but never looked for — so
 * a hand-crafted submission carrying either is inert. `orderIndex`, a definition
 * id and an actor id are equally unreachable: the committed writer's signature
 * has no parameter for any of them, and the plan is derived from the offering.
 *
 * COERCION IS EXPLICIT AND NARROW. `Number(value)` is applied to the two numeric
 * fields and NOTHING else; `value === "on"` — the exact value an HTML checkbox
 * submits — is the only way a flag becomes `true`. The name is passed through
 * UNTRIMMED, because trimming is the committed input core's rule and a second
 * copy here would be free to drift from it.
 *
 * NOTHING IS DEFAULTED, and every malformed number fails CLOSED — but by two
 * different routes, so both are stated exactly rather than glossed:
 *   - a non-numeric string (`"abc"`) becomes `NaN`;
 *   - an ABSENT field and an empty one both become `0`, because `Number(null)`
 *     and `Number("")` are `0` — NOT `NaN`.
 * Neither is a positive integer, so the committed domain rule refuses both with
 * its invalid-duration / invalid-capacity diagnostic. The safety here comes from
 * that rule requiring a POSITIVE INTEGER, not from the coercion producing `NaN`;
 * a rule that merely rejected `NaN` would silently accept an omitted field as
 * zero.
 *
 * ===========================================================================
 * NO DIAGNOSTIC EVER ECHOES A SUBMITTED VALUE
 * ===========================================================================
 * Every redirect carries STABLE TOKENS ONLY — a refusal code from the writer's
 * closed set, or the writer's own `EX-DEF-*` issue codes. The submitted name,
 * duration, capacity and flags are never placed in a URL, a message or a log,
 * and no raw Prisma error, stack, plan id, definition id or course id is ever
 * returned to the client.
 *
 * ===========================================================================
 * EVERY REDIRECT SITS OUTSIDE ANY try/catch
 * ===========================================================================
 * `redirect()` signals by THROWING `NEXT_REDIRECT`. This module contains NO
 * `try`/`catch` at all, which is the strongest form of that requirement: there
 * is no block for a redirect to be swallowed by, and the authorization redirect
 * from `requireAdmin()` likewise propagates to the framework untouched.
 *
 * This action imports no Prisma client, no capability reader, no notification or
 * push surface, and no edit, delete, reorder, plan-creation, session,
 * source-date or publication function. None of them is reachable from here.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createExamDefinition } from "@/lib/actions/exam-definition-write-io";

/**
 * Create ONE ExamDefinition for the bound course offering.
 *
 * Returns `Promise<void>`: every outcome is expressed as a navigation, so the
 * action holds no client-visible state and its signature cannot grow a
 * `prevState` parameter (which is what an in-page error renderer would demand).
 * The page renders the outcome from the stable tokens below.
 */
export async function createExamDefinitionAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything else is read, coerced or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The explicit, narrow mapping. Exactly seven named fields; no course, no
  //    plan, no order, no id, and no default value for any of them.
  const rawInput = {
    // Untrimmed on purpose: trimming belongs to the committed input core.
    name: formData.get("name"),
    kind: formData.get("kind"),
    durationMinutes: Number(formData.get("durationMinutes")),
    parallelCapacity: Number(formData.get("parallelCapacity")),
    requiresInstructedTrainee: formData.get("requiresInstructedTrainee") === "on",
    requiresLessonTopic: formData.get("requiresLessonTopic") === "on",
    requiresDiscipline: formData.get("requiresDiscipline") === "on",
  };

  // 4. The committed writer. The bound offering id is a REQUEST: the writer runs
  //    the admin boundary and the exact-offering lookup itself, and only the
  //    DB-verified id it resolves reaches the plan query.
  const result = await createExamDefinition(courseOfferingId, rawInput);

  // 5. Success: revalidate EXACTLY this exams path — no course dashboard, no
  //    Level 1 schedule path, no trainee or instructor surface — then return to
  //    it. The new definition is read back from the database by the page; it is
  //    never inserted optimistically.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?createdDefinition=1`);
  }

  // 6. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected
  //    back in the destination.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 7. Field diagnostics: the writer's own stable codes, in the writer's own
  //    order. Only codes travel — never a submitted value, and never a message
  //    built from one.
  if (result.code === "invalid_input") {
    const codes = result.issues.map((issue) => issue.code).join(",");
    redirect(
      `${examsPath}?createError=invalid_input&createIssues=${encodeURIComponent(codes)}`,
    );
  }

  // 8. Every other refusal is fully described by its code alone.
  redirect(`${examsPath}?createError=${encodeURIComponent(result.code)}`);
}
