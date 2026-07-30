"use server";

/**
 * EXAM PLAN P3 — the ONE Server Action that brings an empty ExamPlan into
 * existence for a course offering, and the ONLY app-side caller of the committed
 * server-only ExamPlan write binding.
 *
 * ===========================================================================
 * WHAT THIS MODULE IS, AND WHAT IT DELIBERATELY IS NOT
 * ===========================================================================
 * This is a `"use server"` module, so EVERYTHING exported from it has a stable,
 * publicly callable network id. Exactly ONE function is exported, and it performs
 * exactly ONE operation. No helper, no parser, no constant and no type is exported
 * alongside it: an exported helper here would be a second public endpoint, and a
 * future reader would have no way to tell which of the two was meant to be called.
 *
 * It contains NO policy, NO validation, NO idempotence rule and NO Prisma access.
 * The committed pure core decides every outcome and the committed server-only
 * binding performs the two statements; this module only binds the ROUTE to that
 * operation and turns its frozen result into navigation.
 *
 * ===========================================================================
 * THE OFFERING ID IS SERVER-BOUND, NEVER SUBMITTED
 * ===========================================================================
 * `courseOfferingId` is the FIRST parameter because the page supplies it with
 * `.bind(null, context.id)` — the offering id that the page's own admin boundary
 * already verified. It therefore travels in the action's bound closure, not in the
 * request body.
 *
 * `formData` is accepted because React passes it to every form action, and it is
 * then DELIBERATELY NEVER READ. There is no `formData.get` anywhere in this file,
 * so no `courseOfferingId`, no `planId` and no id of any kind can be taken from the
 * submission — not "ignored if present", but structurally unreachable. The form
 * this action is wired to submits no fields at all.
 *
 * That matters because the id decides WHICH course is written. A client-supplied
 * id would let one course's manager create a plan on another course's offering,
 * and the unique index would not catch it — the write would be perfectly valid,
 * just on the wrong course.
 *
 * The bound id is still only a REQUEST. `createExamPlan` re-runs the admin boundary
 * and re-resolves exactly that offering server-side before any exam statement runs,
 * so this module's binding is a scoping convenience and NOT the trust boundary.
 *
 * ===========================================================================
 * ORDER
 * ===========================================================================
 *   1. `requireAdmin()` — the FIRST awaited operation in the function, before the
 *      write binding is even entered. It is defence in depth, not the enforcement:
 *      the binding authorizes independently. What it buys is that an unauthenticated
 *      caller who discovers this action's network id is redirected to the login page
 *      without a single exam-related call having been made on their behalf.
 *   2. `createExamPlan(courseOfferingId)` — the committed binding, given the bound
 *      route id and nothing else.
 *   3. `revalidatePath` on THIS course's exams path only, on success.
 *   4. `redirect(...)` — always the last statement on every branch.
 *
 * ===========================================================================
 * REDIRECTS SIT OUTSIDE ANY try/catch — THERE IS NO try/catch
 * ===========================================================================
 * `redirect()` signals by THROWING a `NEXT_REDIRECT` error that the framework must
 * receive. This module has no `try`, no `catch` and no `finally` anywhere, so there
 * is nothing that could intercept it — neither the redirects issued here nor the
 * login redirect thrown by `requireAdmin()` or by the binding's own admin boundary.
 *
 * An unexpected failure from the binding therefore PROPAGATES rather than being
 * flattened into a query code. That is intentional: a generic "something went
 * wrong" code would let a real defect render as an ordinary form message that
 * nobody ever investigates.
 *
 * ===========================================================================
 * WHAT THE QUERY STRING MAY CARRY
 * ===========================================================================
 * Only CLOSED, stable tokens that this file writes literally:
 *   - `created=1`  — this call performed the write;
 *   - `existing=1` — a plan was already there and NOTHING was touched;
 *   - `error=operation_not_allowed` / `error=plan_conflict` — the binding's own
 *     stable refusal codes, which are a fixed enum in the committed pure core.
 *
 * A refusal that the offering does not exist routes to the safe courses list
 * instead, exactly as the committed rename action does: the bound id did not
 * resolve, so no course-scoped URL may be built from it.
 *
 * Nothing else is ever put in the URL. No submitted value, no id, no plan id, no
 * Prisma message, no exception text and no interpolated status. `result.code` is
 * one of three compile-time-known literals, and it is the ONLY dynamic value that
 * reaches a redirect target.
 *
 * ===========================================================================
 * WHAT THIS ACTION DOES NOT DO
 * ===========================================================================
 * It creates ONE empty plan. It does not publish, unpublish, delete, or edit a
 * plan; it does not create, edit, reorder or delete an ExamDefinition; it does not
 * add a source date or a session; it sends no notification and reads no capability.
 * None of those modules is imported, so none of them can be reached from here.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createExamPlan } from "@/lib/actions/exam-plan-write-io";

export async function createExamPlanAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorization FIRST — before the write binding, and before anything is
  //    derived from the bound id.
  await requireAdmin();

  // The submission is never inspected. Referenced here ONLY so the required
  // React form-action signature does not read as an accidentally unused
  // parameter; `formData.get` appears nowhere in this file.
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
