"use server";

/**
 * EXAM PLAN P3 + EXAM EX-S5B-5C — the Server Action module of the course-scoped
 * exams route, holding EXACTLY TWO approved mutations:
 *
 *   1. `createExamPlanAction`       — bring ONE empty, unpublished ExamPlan into
 *                                     existence for ONE course offering;
 *   2. `createExamDefinitionAction` — append ONE ExamDefinition to the ALREADY
 *                                     EXISTING plan of ONE course offering.
 *
 * ===========================================================================
 * WHY TWO EXPORTS, AND WHY EXACTLY TWO
 * ===========================================================================
 * Everything exported from a `"use server"` module has a stable, PUBLICLY
 * CALLABLE network id, so the export list IS the attack surface. These two
 * actions were each approved and reviewed on their own, and they are kept as two
 * SEPARATE endpoints rather than folded into one generic "exams" action: a single
 * action taking a discriminator would have to decide FROM THE REQUEST which
 * operation to run, which is precisely the decision that must not be
 * client-influenced. Two narrow endpoints, each with a fixed operation, cannot be
 * talked into performing the other one.
 *
 * Nothing else leaves this file. No helper, no parser, no constant and no type is
 * exported alongside them: an exported helper here would be a third public
 * endpoint, and a future reader would have no way to tell which of the three was
 * meant to be called. The committed writer modules behind these two also expose
 * definition EDIT, safe REMOVAL and atomic REORDER, plus plan publication and
 * deletion; none of those is re-exported, wrapped or imported here, so this route
 * adds exactly two callable mutations to the app and every other one remains
 * unreachable from any client.
 *
 * Neither action contains policy, validation, idempotence rules or Prisma access.
 * The committed pure cores decide every outcome and the committed server-only
 * bindings perform the statements; this module only binds the ROUTE to those
 * operations and turns their frozen results into navigation.
 *
 * ===========================================================================
 * THE OFFERING ID IS SERVER-BOUND, NEVER SUBMITTED — IN BOTH ACTIONS
 * ===========================================================================
 * `courseOfferingId` is the FIRST parameter of both actions because the page
 * supplies it with `.bind(null, context.id)` — the offering id that the page's own
 * admin boundary already verified. It therefore travels inside the encrypted
 * Server Action payload, not in the request body, and is not forgeable from the
 * client. It is NEVER read from a form field, a hidden input, a query string, a
 * cookie or a current-offering resolver.
 *
 * That matters because the id decides WHICH course is written. A client-supplied
 * id would let one course's manager write on another course's offering, and no
 * unique index would catch it — the write would be perfectly valid, just on the
 * wrong course.
 *
 * The bound id is still only a REQUEST. Both committed writers re-run the admin
 * boundary and re-resolve exactly that offering server-side before any exam
 * statement runs — and the definition writer additionally resolves the PLAN id
 * from that verified offering — so this module's binding is a scoping convenience
 * and NOT the trust boundary.
 *
 * ===========================================================================
 * THE ORDER, IN BOTH ACTIONS
 * ===========================================================================
 *   1. `requireAdmin()` — the FIRST awaited operation in each body. No FormData is
 *      read, no value is coerced and no writer is entered before it resolves. It
 *      fails closed by REDIRECTING (a `NEXT_REDIRECT` throw), so a denial provably
 *      prevents every later step rather than merely being checked. It is defence in
 *      depth, not the enforcement: each binding authorizes independently. What it
 *      buys is that an unauthenticated caller who discovers either action's network
 *      id is redirected to the login page without a single exam-related call having
 *      been made on their behalf.
 *   2. the committed binding, given the bound route id (and, for the definition
 *      action, the narrow FormData mapping documented on that action).
 *   3. `revalidatePath` on THIS course's exams path only, on success. Each action
 *      revalidates exactly once, and only that one path.
 *   4. `redirect(...)` — always the last statement on every branch.
 *
 * ===========================================================================
 * REDIRECTS SIT OUTSIDE ANY try/catch — THERE IS NO try/catch
 * ===========================================================================
 * `redirect()` signals by THROWING a `NEXT_REDIRECT` error that the framework must
 * receive. This module has no `try`, no `catch` and no `finally` anywhere, so there
 * is nothing that could intercept it — neither the redirects issued here nor the
 * login redirect thrown by `requireAdmin()` or by a binding's own admin boundary.
 * That is the strongest form of the rule: not "the redirect is outside the block",
 * but "there is no block".
 *
 * An unexpected failure from a binding therefore PROPAGATES rather than being
 * flattened into a query code. That is intentional: a generic "something went
 * wrong" code would let a real defect render as an ordinary form message that
 * nobody ever investigates.
 *
 * ===========================================================================
 * WHAT THE QUERY STRING MAY CARRY
 * ===========================================================================
 * Only CLOSED, stable tokens that this file writes literally:
 *   - `created=1`            — the plan create performed the write;
 *   - `existing=1`           — a plan was already there and NOTHING was touched;
 *   - `error=<code>`         — the plan binding's stable refusal codes, a fixed
 *                              enum in its committed pure core;
 *   - `createdDefinition=1`  — the definition create performed the write;
 *   - `createError=<code>`   — the definition writer's stable refusal codes;
 *   - `createIssues=<codes>` — the definition writer's own issue codes, joined.
 *
 * A refusal that the offering does not exist routes to the safe courses list
 * instead, from BOTH actions: the bound id did not resolve, so no course-scoped
 * URL may be built from it, and returning to this route would only render a second
 * not-found. The requested id is not reflected back in that destination.
 *
 * Nothing else is ever put in the URL. No submitted value, no id, no plan id, no
 * definition id, no Prisma message, no exception text, no stack and no interpolated
 * status. The only dynamic values that reach a redirect target are `result.code` —
 * a compile-time-known literal from a closed set — and the joined issue codes.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES NOT DO
 * ===========================================================================
 * It creates ONE empty plan, and it appends ONE definition. It does not publish,
 * unpublish, delete or edit a plan; it does not edit, reorder or delete an
 * ExamDefinition; it does not add a source date or a session; it sends no
 * notification, reads no capability and touches no schema. None of those modules is
 * imported, so none of them can be reached from here.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createExamPlan } from "@/lib/actions/exam-plan-write-io";
import { createExamDefinition } from "@/lib/actions/exam-definition-write-io";

/**
 * Create ONE empty ExamPlan for the bound course offering.
 *
 * `formData` is accepted because React passes it to every form action, and it is
 * then DELIBERATELY NEVER READ. There is no `formData.get` in this function, so no
 * `courseOfferingId`, no `planId` and no id of any kind can be taken from the
 * submission — not "ignored if present", but structurally unreachable. The form
 * this action is wired to submits no fields at all, so the FormData is empty by
 * construction rather than merely disregarded.
 */
export async function createExamPlanAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorization FIRST — before the write binding, and before anything is
  //    derived from the bound id.
  await requireAdmin();

  // The submission is never inspected. Referenced here ONLY so the required
  // React form-action signature does not read as an accidentally unused
  // parameter; `formData.get` appears nowhere in this function.
  void formData;

  // 2. The committed binding, on the SERVER-BOUND route id.
  const result = await createExamPlan(courseOfferingId);

  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  if (!result.ok) {
    if (result.code === "offering_not_found") {
      // The bound id did not resolve to a real offering, so no course-scoped URL
      // may be built from it — fall back to the safe courses list.
      redirect("/admin/courses?error=invalid");
    }
    // A verified offering that refused: return to THIS course's exams screen
    // carrying only the stable refusal code.
    redirect(`${examsPath}?error=${encodeURIComponent(result.code)}`);
  }

  // 3. Success — created or already-present. Revalidate ONLY this course's exams
  //    path: no course list, no dashboard, no layout, no other route.
  revalidatePath(examsPath);

  // 4. Distinguish the two successes, so the manager is told whether this click
  //    changed anything.
  redirect(result.created ? `${examsPath}?created=1` : `${examsPath}?existing=1`);
}

/**
 * Create ONE ExamDefinition under the bound offering's ALREADY EXISTING plan.
 *
 * Returns `Promise<void>`: every outcome is expressed as a navigation, so the
 * action holds no client-visible state and its signature cannot grow a `prevState`
 * parameter (which is what an in-page error renderer would demand). The page
 * renders the outcome from the stable tokens documented above.
 *
 * ===========================================================================
 * WHAT THE FORM CANNOT SAY
 * ===========================================================================
 * The mapping below reads SEVEN named fields and nothing else. `courseOfferingId`
 * and `planId` are not among them — not filtered out, but never looked for — so a
 * hand-crafted submission carrying either is inert. The order index, a definition
 * id and an actor id are equally unreachable: the committed writer's signature has
 * no parameter for any of them, and the plan is derived from the offering.
 *
 * COERCION IS EXPLICIT AND NARROW. `Number(value)` is applied to the two numeric
 * fields and NOTHING else; `value === "on"` — the exact value an HTML checkbox
 * submits — is the only way a flag becomes `true`. The name is passed through
 * UNTRIMMED, because trimming is the committed input core's rule and a second copy
 * here would be free to drift from it.
 *
 * NOTHING IS DEFAULTED, and every malformed number fails CLOSED — but by two
 * different routes, so both are stated exactly rather than glossed:
 *   - a non-numeric string (`"abc"`) becomes `NaN`;
 *   - an ABSENT field and an empty one both become `0`, because `Number(null)` and
 *     `Number("")` are `0` — NOT `NaN`.
 * Neither is a positive integer, so the committed domain rule refuses both with its
 * invalid-duration / invalid-capacity diagnostic. The safety here comes from that
 * rule requiring a POSITIVE INTEGER, not from the coercion producing `NaN`; a rule
 * that merely rejected `NaN` would silently accept an omitted field as zero.
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
