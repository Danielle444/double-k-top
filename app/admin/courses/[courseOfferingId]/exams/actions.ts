"use server";

/**
 * EXAM PLAN P3 + EXAM EX-S5B-5C + EXAM EX-SES-S4 + EXAM EX-SES-UI-2 + EXAM
 * EX-ASG-UI1 + EXAM EX-ASG-IT2 + EXAM EX-PUB-UI-MVP — the Server Action module of
 * the course-scoped exams route, holding EXACTLY NINE approved mutations:
 *
 *   1. `createExamPlanAction`       — bring ONE empty, unpublished ExamPlan into
 *                                     existence for ONE course offering;
 *   2. `createExamDefinitionAction` — append ONE ExamDefinition to the ALREADY
 *                                     EXISTING plan of ONE course offering;
 *   3. `createExamSessionAction`    — append ONE stored session to that same
 *                                     already-existing plan, under a definition
 *                                     the plan already holds;
 *   4. `updateExamSessionAction`    — edit ONE stored session of that same plan,
 *                                     against the version the manager was shown;
 *   5. `deleteExamSessionAction`    — remove ONE stored session of that same
 *                                     plan, and only one nobody is assigned to;
 *   6. `createExamAssignmentAction` — assign ONE examinee to ONE stored session
 *                                     of that same plan, carrying the lesson topic
 *                                     and/or discipline that session's exam
 *                                     demands;
 *   7. `deleteExamAssignmentAction` — remove ONE stored assignment of that same
 *                                     plan;
 *   8. `createExamInstructedTraineeAssignmentAction`
 *                                   — assign ONE INSTRUCTED TRAINEE to ONE stored
 *                                     session of that same plan, when that
 *                                     session's exam actually asks for one;
 *   9. `setExamPlanPublicationAction`
 *                                   — PUBLISH or UNPUBLISH that same plan, which
 *                                     is what decides whether trainees can see it
 *                                     at all.
 *
 * ===========================================================================
 * WHY NINE EXPORTS, AND WHY EXACTLY NINE
 * ===========================================================================
 * Everything exported from a `"use server"` module has a stable, PUBLICLY
 * CALLABLE network id, so the export list IS the attack surface. These nine
 * actions were each approved and reviewed on their own, and they are kept as
 * SEPARATE endpoints rather than folded into one generic "exams" action: a single
 * action taking a discriminator would have to decide FROM THE REQUEST which
 * operation to run, which is precisely the decision that must not be
 * client-influenced. Eight narrow endpoints, each with a fixed operation, cannot
 * be talked into performing another one.
 *
 * The eighth is the sharpest illustration of that rule. It writes a DIFFERENT
 * role from the sixth, and the two are deliberately NOT one create endpoint
 * carrying a role field: an endpoint that chose its role from the request would
 * make the instructed-trainee path reachable from a submission that looks like an
 * examinee save, and vice versa. Each reads its own fields, calls its own
 * committed writer, and maps its own closed result codes onto its own query
 * tokens.
 *
 * That applies most sharply to the two added by EX-SES-UI-2 and the two added by
 * EX-ASG-UI1. In each pair the CREATE and the REMOVAL are DELIBERATELY not one
 * "save" endpoint carrying an intent field: an endpoint that chose between
 * writing and deleting from a submitted flag would make deletion reachable from a
 * request that looks like a save. They read different fields, map different
 * result codes and are wired to different forms.
 *
 * Nothing else leaves this file. No helper, no parser, no constant and no type is
 * exported alongside them: an exported helper here would be a tenth public
 * endpoint, and a future reader would have no way to tell which of the nine was
 * meant to be called. The committed writer modules behind these nine also expose
 * definition EDIT, safe REMOVAL and atomic REORDER, session REORDERING and plan
 * DELETION; none of those is re-exported, wrapped or imported here, so this route
 * adds exactly nine callable mutations to the app and every other one remains
 * unreachable from any client.
 *
 * The NINTH is the one exception to the "no discriminator" rule stated below, and
 * the reason it is not really an exception at all is spelled out on the function
 * itself: publish and unpublish are two VALUES of one symmetric transition
 * reaching ONE committed writer, ONE authorization boundary and ONE lifecycle
 * gate, which is not the same thing as letting a request choose between a write
 * and a delete.
 *
 * The assignment pair is narrower still than its neighbours: it writes only the
 * EXAMINEE role — the single literal the committed create core fixes, which no
 * parameter and no submitted field can express — and it has no edit and no
 * reorder counterpart at all.
 *
 * Neither action contains policy, validation, idempotence rules or Prisma access.
 * The committed pure cores decide every outcome and the committed server-only
 * bindings perform the statements; this module only binds the ROUTE to those
 * operations and turns their frozen results into navigation.
 *
 * ===========================================================================
 * THE OFFERING ID IS SERVER-BOUND, NEVER SUBMITTED — IN BOTH ACTIONS
 * ===========================================================================
 * `courseOfferingId` is the FIRST parameter of every action because the caller
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
 * The bound id is still only a REQUEST. All the committed writers re-run the
 * admin boundary and re-resolve exactly that offering server-side before any exam
 * statement runs — and the definition, session and assignment writers additionally
 * resolve the PLAN id from that verified offering, the session writer additionally
 * verifies the submitted definition WITHIN that server-resolved plan, and the
 * assignment writers additionally verify the submitted session, trainee or
 * assignment WITHIN it — so this module's binding is a scoping convenience and NOT
 * the trust boundary.
 *
 * ===========================================================================
 * THE ORDER, IN EVERY ACTION
 * ===========================================================================
 *   1. `requireAdmin()` — the FIRST awaited operation in each body. No FormData is
 *      read, no value is coerced and no writer is entered before it resolves. It
 *      fails closed by REDIRECTING (a `NEXT_REDIRECT` throw), so a denial provably
 *      prevents every later step rather than merely being checked. It is defence in
 *      depth, not the enforcement: each binding authorizes independently. What it
 *      buys is that an unauthenticated caller who discovers any action's network
 *      id is redirected to the login page without a single exam-related call having
 *      been made on their behalf.
 *   2. the committed binding, given the bound route id (and, for the definition
 *      and session actions, the narrow FormData mapping documented on each).
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
 *   - `createIssues=<codes>` — the definition writer's own issue codes, joined;
 *   - `createdSession=1`     — the session create performed the write;
 *   - `sessionError=<code>`  — the session writer's stable refusal codes;
 *   - `sessionIssues=<codes>`— the session writer's own issue codes, joined;
 *   - `updatedSession=1`     — the session edit CHANGED something;
 *   - `unchangedSession=1`   — the session edit was a no-op and wrote nothing;
 *   - `sessionEditError=<code>`  — the edit writer's stable refusal codes;
 *   - `sessionEditIssues=<codes>`— the edit writer's own issue codes, joined;
 *   - `deletedSession=1`     — the session removal performed the delete;
 *   - `sessionDeleteError=<code>`— the removal writer's stable refusal codes;
 *   - `createdAssignment=1`  — the assignment create performed the write;
 *   - `assignmentError=<code>`   — the assignment create writer's stable refusal
 *                                  codes;
 *   - `assignmentIssues=<codes>` — that writer's own issue codes, joined;
 *   - `deletedAssignment=1`  — the assignment removal performed the delete;
 *   - `assignmentDeleteError=<code>` — the assignment removal writer's stable
 *                                  refusal codes;
 *   - `createdInstructedTrainee=1` — the instructed-trainee create performed the
 *                                  write;
 *   - `instructedTraineeError=<code>`  — that writer's stable refusal codes;
 *   - `instructedTraineeIssues=<codes>`— that writer's own issue codes, joined;
 *   - `publication=<token>`  — the publication outcome: the writer's own
 *                              `PUBLISHED`, `UNPUBLISHED` and `NO_CHANGE`
 *                              successes, its stable refusal codes, and this
 *                              module's own fail-closed `unknown_operation`.
 *
 * The publication family is ONE key rather than a success/error pair, because a
 * publication has exactly ONE outcome per submission and only one publication
 * control can be on screen at a time — so there is no second form whose
 * diagnostic could be rendered above it. The token is still CLOSED: every value
 * it can carry is a compile-time-known literal from the committed writer's own
 * union, or the one literal this module writes itself.
 *
 * The instructed-trainee tokens are a FOURTH distinct family, for the same reason
 * the assignment ones are a third: an instructed-trainee create form and an
 * examinee create form can be on screen under the SAME session at once, and a
 * shared token would render one form's diagnostic above the other with no way for
 * the page to tell which submission failed.
 *
 * The session tokens are DISTINCT from the definition ones rather than shared,
 * and the EDIT and REMOVAL tokens are distinct from the CREATE's for the same
 * reason a step further: many forms can live on one screen, and a shared
 * `sessionError` would render an edit diagnostic above the create form (or a
 * delete diagnostic above an edit form) with no way for the page to tell which
 * submission failed. The assignment tokens are a third distinct family for the
 * same reason: one create form per session may be on screen at once, and an
 * assignment diagnostic must never be mistaken for a session one.
 *
 * A refusal that the offering does not exist routes to the safe courses list
 * instead, from EVERY action: the bound id did not resolve, so no course-scoped
 * URL may be built from it, and returning to this route would only render a second
 * not-found. The requested id is not reflected back in that destination.
 *
 * Nothing else is ever put in the URL. No submitted value, no id, no plan id, no
 * definition id, no session id, no student id, no assignment id, no horse name, no
 * version stamp, no date, no start time, no arena, no title, no note, no Prisma
 * message, no exception text, no stack and no interpolated status. The only
 * dynamic values that reach a redirect target are `result.code` — a
 * compile-time-known literal from a closed set — and the joined issue codes. The
 * session create's own success carries NO id either: the writer returns the new
 * session id and its assigned position, and this module reads neither. The session
 * EDIT and REMOVAL are the same. So is the assignment CREATE: its writer returns
 * the new assignment id and its assigned position, and neither is read here.
 *
 * ===========================================================================
 * WHAT THIS MODULE DOES NOT DO
 * ===========================================================================
 * It creates ONE empty plan, it appends ONE definition, it appends, edits or
 * removes ONE session, it assigns or unassigns ONE examinee, it assigns ONE
 * instructed trainee, and it flips the plan's ONE general publication column. It
 * does not DELETE or edit a plan; it does not edit, reorder or delete an
 * ExamDefinition; it does not reorder sessions, edit or reorder an assignment,
 * REMOVE an instructed trainee through any second path, add a break, a supervisor
 * or a source date; it publishes no INDIVIDUAL session and writes no
 * `individualPublishedAt`; it writes no pairing, no wave and no personal time; it
 * sends no notification, records no publication history, reads no capability and
 * touches no schema. None of those modules is imported, so none of them can be
 * reached from here.
 *
 * The instructed-trainee row is REMOVED by the SAME assignment removal above:
 * that writer locates a row by id within the plan and is role-blind, so a
 * role-specific delete endpoint would be a second way to do one thing and a
 * second place for its authorization to drift.
 *
 * ===========================================================================
 * THE ASSIGNMENT COUNT IS NEVER AN INPUT
 * ===========================================================================
 * The page shows each session's assignment count, and the session delete form uses
 * it to decide whether to offer a delete button at all. That is EXPLANATORY UI and
 * nothing more. No action below reads an `assignmentCount` field, no writer below
 * is given one, and no writer's signature has a parameter for it. Whether a
 * session may be removed is decided ONLY by the committed removal writer's own
 * count and by the atomic `assignments: { none: {} }` condition it carries on the
 * delete statement itself — so a session that gains an assignment between the
 * page read and the click is refused by the DATABASE, not by the button.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createExamPlan } from "@/lib/actions/exam-plan-write-io";
import { createExamDefinition } from "@/lib/actions/exam-definition-write-io";
import {
  createExamSession,
  updateExamSession,
  deleteExamSession,
} from "@/lib/actions/exam-session-write-io";
import { deleteExamAssignment } from "@/lib/actions/exam-assignment-write-io";
import { createDetailedExamAssignment } from "@/lib/actions/detailed-exam-assignment-write-io";
import { createExamInstructedTraineeAssignment } from "@/lib/actions/exam-instructed-trainee-assignment-write-io";
import { setExamPlanPublication } from "@/lib/actions/exam-publication-write-io";

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

/**
 * Create ONE stored ExamSession under the bound offering's ALREADY EXISTING plan,
 * against a definition that plan ALREADY holds.
 *
 * Returns `Promise<void>`: every outcome is expressed as a navigation, so the
 * action holds no client-visible state and its signature cannot grow a `prevState`
 * parameter (which is what an in-page error renderer would demand). The page
 * renders the outcome from the stable tokens documented above.
 *
 * ===========================================================================
 * WHAT THE FORM CANNOT SAY
 * ===========================================================================
 * The mapping below reads SIX named fields and nothing else. `courseOfferingId`
 * and `planId` are not among them — not filtered out, but never looked for — so a
 * hand-crafted submission carrying either is inert. The same is true of every
 * value this operation must decide for itself or must not accept at all:
 * `orderIndex` (the committed writer computes it as the next position within the
 * session's own DAY), `endTime` (derived from the definition, never submitted),
 * `capacity` and `kind` (properties of the definition, not of a session),
 * `phase`, `interfaceSessionId`, `sourceTeachingPracticeLessonId` and every other
 * copy-provenance column, and `individualPublishedAt`. None is read here, and
 * none is reachable: the committed writer's signature has no parameter for any of
 * them, and its normalized payload has no field for any of them either.
 *
 * ===========================================================================
 * NO COERCION AT ALL — AND WHY THAT IS THE SAFE CHOICE HERE
 * ===========================================================================
 * Every one of the six values is forwarded EXACTLY as `FormData.get` returned it:
 * a `string`, or `null` for an absent field. There is no `String(...)`, no `??`,
 * no `.trim()`, no default and no empty-string collapse anywhere in this
 * function — deliberately, because the committed input core already defines all
 * of it and a second copy here would be free to drift from the rule the database
 * actually sees.
 *
 * That core accepts `unknown` for every field and FAILS CLOSED on every shape it
 * does not want, so forwarding raw values is strictly safer than pre-processing
 * them:
 *   - the definition id must be a NON-EMPTY string after trimming; absent, `null`
 *     and a non-string all read as "no definition was chosen";
 *   - the date must be an EXACT `YYYY-MM-DD` real calendar date — leap years
 *     honoured, `2026-02-31` refused, surrounding whitespace refused, and today
 *     never inferred from an absent field;
 *   - the start time must be an EXACT zero-padded `HH:mm` in `00:00`–`23:59`, so
 *     `"9:00"` and `"24:00"` are both refused;
 *   - arena, title and notes are optional text: absent or `null` means "store
 *     nothing", a blank or whitespace-only string collapses to nothing, and any
 *     NON-STRING is REFUSED rather than stringified — which is exactly why a
 *     `File` entry from a multipart submission cannot become the text of an
 *     arena.
 *
 * Coercing here would break that last property: `String(formData.get("arena"))`
 * on a file upload would persist `"[object File]"` as an arena name.
 */
export async function createExamSessionAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything else is read or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The explicit, narrow mapping. Exactly six named fields, forwarded raw; no
  //    course, no plan, no order, no end time, no capacity, no id, and no default
  //    value for any of them.
  const rawInput = {
    definitionId: formData.get("definitionId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    arena: formData.get("arena"),
    title: formData.get("title"),
    notes: formData.get("notes"),
  };

  // 4. The committed writer. The bound offering id is a REQUEST: the writer runs
  //    the admin boundary and the exact-offering lookup itself, resolves the plan
  //    from the DB-verified id, and verifies the submitted definition WITHIN that
  //    plan — so a definition belonging to another course's plan is unreachable.
  const result = await createExamSession(courseOfferingId, rawInput);

  // 5. Success: revalidate EXACTLY this exams path — no course dashboard, no
  //    schedule path, no trainee or instructor surface — then return to it. The
  //    new session is read back from the database by the page; it is never
  //    inserted optimistically, and neither its id nor its assigned position is
  //    reflected in the URL.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?createdSession=1`);
  }

  // 6. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected
  //    back in the destination.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 7. Field diagnostics: the writer's own stable codes, in the writer's own
  //    order. Only codes travel — never a submitted definition id, date, time,
  //    arena, title or note, and never a message built from one.
  if (result.code === "invalid_input") {
    const codes = result.issues.map((issue) => issue.code).join(",");
    redirect(
      `${examsPath}?sessionError=invalid_input&sessionIssues=${encodeURIComponent(codes)}`,
    );
  }

  // 8. Every other refusal — the lifecycle denial, the missing plan and the
  //    missing-or-foreign definition — is fully described by its code alone.
  redirect(`${examsPath}?sessionError=${encodeURIComponent(result.code)}`);
}

/**
 * Edit ONE stored ExamSession of the bound offering's plan.
 *
 * Returns `Promise<void>`: every outcome is expressed as a navigation, exactly
 * like its three neighbours, so this action holds no client-visible state either.
 *
 * ===========================================================================
 * WHAT THE FORM MAY SAY — EIGHT FIELDS, AND WHY EACH IS THERE
 * ===========================================================================
 * SIX of them are the session's mutable values, forwarded RAW to the committed
 * edit normalizer for the reason spelled out on the create action above: that core
 * accepts `unknown` for every field, fails closed on every shape it does not want,
 * and REFUSES a non-string rather than stringifying it — so a `File` entry from a
 * multipart submission can never become the text of a field. There is no
 * `String(...)`, no `??`, no `.trim()`, no default and no empty-string collapse
 * applied to any of them here.
 *
 * The other two identify WHICH session, and at WHICH version:
 *   - `sessionId` names the row. It is a REQUEST and not a grant: the committed
 *     writer resolves the plan from the SERVER-VERIFIED offering and then looks
 *     this id up WITHIN that plan, so an id belonging to another course's plan is
 *     reported as `session_not_found` and nothing is written. It is read through a
 *     `typeof` narrowing rather than `String(...)` — the writer's parameter is a
 *     `string`, and a narrowing that yields `""` for an absent, `null` or
 *     non-string entry FAILS CLOSED (no session has an empty id), whereas
 *     `String(...)` would turn a `File` into the text `"[object File]"` and send
 *     that to the database as an id.
 *   - `expectedUpdatedAt` is the OPTIMISTIC CONCURRENCY token — the `updatedAt`
 *     epoch-millisecond stamp the manager's page was rendered from. It is the one
 *     value coerced here, with `Number(...)`, because the writer's parameter is a
 *     `number`. Every malformed form fails closed, by two different routes:
 *     a non-numeric string becomes `NaN` and the committed version predicate
 *     refuses it outright; an ABSENT or empty field becomes `0`, which IS a
 *     structurally valid token but cannot equal any stored `updatedAt`, so the
 *     conditional update matches no row and is classified as `stale_write`.
 *     Neither route can silently overwrite a row the manager never saw.
 *
 * `courseOfferingId`, `planId`, `orderIndex`, `endTime` and an actor id are not
 * among them — not filtered out, but never looked for. Nor is `assignmentCount`:
 * whether assignments block this edit is the committed writer's decision, taken
 * against the DATABASE at write time, and a submitted count could only ever lie.
 */
export async function updateExamSessionAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read, coerced or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. WHICH row, and at WHICH version. Both fail closed; see the header.
  const submittedSessionId = formData.get("sessionId");
  const sessionId = typeof submittedSessionId === "string" ? submittedSessionId : "";
  const expectedUpdatedAt = Number(formData.get("expectedUpdatedAt"));

  // 4. The six mutable values, forwarded EXACTLY as `FormData.get` returned them.
  const rawInput = {
    definitionId: formData.get("definitionId"),
    date: formData.get("date"),
    startTime: formData.get("startTime"),
    arena: formData.get("arena"),
    title: formData.get("title"),
    notes: formData.get("notes"),
  };

  // 5. The committed writer. The bound offering id is a REQUEST: the writer runs
  //    the admin boundary and the exact-offering lookup itself, resolves the plan
  //    from the DB-verified id, reads the session WITHIN that plan, and — when and
  //    only when the definition changes — re-checks assignments atomically.
  const result = await updateExamSession(
    courseOfferingId,
    sessionId,
    expectedUpdatedAt,
    rawInput,
  );

  // 6. Success, in its TWO distinguishable forms. A real change revalidates this
  //    one exams path and says so; a no-op revalidates NOTHING, because nothing
  //    was written and a cache invalidation would be a lie about what happened.
  //    Neither carries the session id, the new version or any submitted value.
  if (result.ok) {
    if (result.changed) {
      revalidatePath(examsPath);
      redirect(`${examsPath}?updatedSession=1`);
    }
    redirect(`${examsPath}?unchangedSession=1`);
  }

  // 7. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected back.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 8. Field diagnostics: the writer's own stable codes, in the writer's own
  //    order. Only codes travel — never a submitted definition id, date, time,
  //    arena, title, note or version stamp, and never a message built from one.
  if (result.code === "invalid_input") {
    const codes = result.issues.map((issue) => issue.code).join(",");
    redirect(
      `${examsPath}?sessionEditError=invalid_input&sessionEditIssues=${encodeURIComponent(codes)}`,
    );
  }

  // 9. Every other refusal is fully described by its code alone: the missing or
  //    foreign session, the definition change blocked by existing assignments, the
  //    stale version token, the lifecycle denial, the missing plan and the
  //    missing-or-foreign definition.
  redirect(`${examsPath}?sessionEditError=${encodeURIComponent(result.code)}`);
}

/**
 * Remove ONE stored ExamSession of the bound offering's plan — and only one
 * nobody is assigned to.
 *
 * Returns `Promise<void>`, like its four neighbours.
 *
 * ===========================================================================
 * TWO FIELDS, AND DELIBERATELY NOT A THIRD
 * ===========================================================================
 * This action reads `sessionId` and `expectedUpdatedAt` and NOTHING else. It does
 * not read the six editable values — a removal has no payload to normalize — and
 * it does not read `assignmentCount`. The page hides the delete button when the
 * count it read is non-zero, which is a courtesy to the manager and NOT the
 * authority: assignments can be created between that read and this click, so the
 * committed writer counts them again itself AND carries an atomic
 * `assignments: { none: {} }` condition on the delete statement. A submitted count
 * would be a client claim about server state, which is exactly the kind of input
 * that must never authorize a destructive write.
 *
 * The version token is coerced with `Number(...)` and fails closed by the same two
 * routes documented on the edit above — with one difference the committed removal
 * core makes explicit: an unusable token (a `NaN` from a non-numeric string) is
 * refused as `invalid_input` before any delete is attempted.
 */
export async function deleteExamSessionAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read or removed.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. WHICH row, and at WHICH version. Exactly two reads; see the header.
  const submittedSessionId = formData.get("sessionId");
  const sessionId = typeof submittedSessionId === "string" ? submittedSessionId : "";
  const expectedUpdatedAt = Number(formData.get("expectedUpdatedAt"));

  // 4. The committed writer, which re-runs the admin boundary, the lifecycle gate
  //    and the plan resolution, reads the session WITHIN that plan, counts
  //    assignments, and then issues ONE conditional delete carrying BOTH the
  //    version and the atomic no-assignments condition.
  const result = await deleteExamSession(courseOfferingId, sessionId, expectedUpdatedAt);

  // 5. Success: revalidate EXACTLY this exams path, then return to it. The removed
  //    session's id is NOT reflected in the URL.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?deletedSession=1`);
  }

  // 6. The one refusal that is NOT about this page.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 7. Every other refusal is fully described by its code alone: the missing or
  //    foreign session, the removal blocked by existing assignments, the stale
  //    version token, the unusable token, the lifecycle denial and the missing
  //    plan. No diagnostics list exists for a removal, so there is no issues token.
  redirect(`${examsPath}?sessionDeleteError=${encodeURIComponent(result.code)}`);
}

/**
 * Assign ONE examinee to ONE stored ExamSession of the bound offering's plan.
 *
 * Returns `Promise<void>`, like its six neighbours: every outcome is expressed as
 * a navigation, so the action holds no client-visible state and its signature
 * cannot grow a `prevState` parameter.
 *
 * ===========================================================================
 * EX-ASG-LTD2-B2 — THE SAME ENDPOINT, NOW ON THE DETAILED WRITER
 * ===========================================================================
 * This action used to call the committed THREE-FIELD examinee create binding,
 * which has no field for a lesson topic or a discipline and therefore REFUSES
 * OUTRIGHT whenever the session's definition demands either — which is exactly
 * why the page hid this form for such a definition.
 *
 * It now calls the committed FIVE-FIELD DETAILED binding instead, which stores
 * both values when the definition asks for them and stores `null` when it does
 * not. That is the whole of this change: the SAME single endpoint, the SAME name,
 * the SAME signature, the SAME form and the SAME route. No second create action
 * was added, and none is reachable — an endpoint that chose its writer from the
 * request would be precisely the client-influenced decision the eight narrow
 * endpoints above exist to prevent, so THERE IS NO DISCRIMINATOR: the writer is
 * fixed in the source of this one function.
 *
 * The three-field binding keeps its own committed contract and its own suite and
 * is simply no longer reached by any production caller. Its removal is a separate,
 * separately reviewed decision.
 *
 * ===========================================================================
 * FIVE FIELDS, AND DELIBERATELY NOT A SIXTH
 * ===========================================================================
 * The mapping below reads `sessionId`, `studentId`, `horseName`,
 * `instructionTopic` and `discipline` — in that FIXED order, which is the order
 * the committed detailed input core reports its diagnostics in — and NOTHING
 * else. Absent — not filtered out, but never looked for — are `courseOfferingId`
 * and `planId` (the first is bound by the route, the second is derived from it),
 * `role` (the committed create core fixes the single EXAMINEE literal, and its
 * payload type cannot express another), `orderIndex` (the committed writer
 * computes it as the next position within the SESSION, inside its own
 * transaction), `definitionId` and the definition's requirement flags (properties
 * of the session's exam, re-read server-side), `assignmentCount` (a client claim
 * about server state), a date, a time, a pairing index and a trainee's display
 * NAME. The committed writer's signature has no parameter for any of them, and its
 * normalized payload has no field for any of them either.
 *
 * THE TWO NEW FIELDS ARE A SUBMISSION, NEVER A GRANT. Whether either is REQUIRED,
 * and whether either is STORED AT ALL, is decided server-side from the session's
 * own definition: a value the definition does not support is written as `null`
 * however insistently it was posted, and a value the definition demands and did
 * not receive refuses the whole create rather than storing a half-filled row.
 * Nothing in this function restates either rule.
 *
 * ===========================================================================
 * NO COERCION AT ALL
 * ===========================================================================
 * All five values are forwarded EXACTLY as `FormData.get` returned them: a
 * `string`, or `null` for an absent field. There is no `String(...)`, no `??`, no
 * `.trim()`, no default and no empty-string collapse anywhere in this function —
 * deliberately, because the committed input core already defines all of it and a
 * second copy here would be free to drift from the rule the database actually
 * sees.
 *
 * That core accepts `unknown` for every field and FAILS CLOSED on every shape it
 * does not want: the three required values must each be a NON-BLANK string after
 * trimming, the two optional ones read as "nothing was supplied" when absent,
 * `null` or blank, and a NON-STRING is REFUSED rather than stringified — which is
 * exactly why a `File` entry from a multipart submission cannot become the name of
 * a horse, a lesson topic or a branch.
 */
export async function createExamAssignmentAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The committed DETAILED writer, given the bound route id and the five raw
  //    values. The bound offering id is a REQUEST: the writer runs the admin
  //    boundary and the exact-offering lookup itself, resolves the plan from the
  //    DB-verified id, verifies the submitted session WITHIN that plan, reads that
  //    session's definition for the topic and discipline demands, and matches the
  //    trainee through ONE fail-closed statement requiring an ACTIVE enrolment in
  //    that same offering — so a session or a trainee belonging to another course
  //    is unreachable.
  const result = await createDetailedExamAssignment(courseOfferingId, {
    sessionId: formData.get("sessionId"),
    studentId: formData.get("studentId"),
    horseName: formData.get("horseName"),
    instructionTopic: formData.get("instructionTopic"),
    discipline: formData.get("discipline"),
  });

  // 4. Success: revalidate EXACTLY this exams path — no course dashboard, no
  //    schedule path, no trainee or instructor surface — then return to it. The
  //    new assignment is read back from the database by the page; it is never
  //    inserted optimistically, and neither its id nor its assigned position is
  //    reflected in the URL.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?createdAssignment=1`);
  }

  // 5. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected
  //    back in the destination.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 6. Field diagnostics: the writer's own stable codes, in the writer's own
  //    order. Only codes travel — never a submitted session id, student id or
  //    horse name, and never a message built from one.
  if (result.code === "invalid_input") {
    const codes = result.issues.map((issue) => issue.code).join(",");
    redirect(
      `${examsPath}?assignmentError=invalid_input&assignmentIssues=${encodeURIComponent(codes)}`,
    );
  }

  // 7. Every other refusal is fully described by its code alone: the lifecycle
  //    denial, the missing plan, the missing-or-foreign session, the ineligible
  //    trainee and the already-assigned conflict. The detailed writer has no
  //    "this surface cannot collect those fields" refusal at all — collecting them
  //    is what this endpoint now does — and the route-local table keeps that
  //    retired code anyway, so an older build's redirect still renders a sentence.
  redirect(`${examsPath}?assignmentError=${encodeURIComponent(result.code)}`);
}

/**
 * Remove ONE stored exam assignment of the bound offering's plan.
 *
 * Returns `Promise<void>`, like its six neighbours.
 *
 * ===========================================================================
 * ONE FIELD, FORWARDED RAW
 * ===========================================================================
 * This action reads `assignmentId` and NOTHING else — no session id, no plan id,
 * no student id, no role, no order index and no offering id. A removal has no
 * payload to normalize and no scope to be told: the offering is bound by the
 * route, the plan is derived from it, and the committed writer locates the row
 * WITHIN that plan before deleting exactly the row THAT read returned.
 *
 * The value is passed EXACTLY as `FormData.get` returned it — a `string`, or
 * `null` for an absent field. It is deliberately NOT wrapped in `String(...)` and
 * NOT collapsed to `""`: the committed delete core accepts `unknown`, refuses
 * every non-string without probing its members, and refuses a blank or
 * whitespace-only string, so forwarding the raw value is strictly safer than
 * pre-processing it. `String(...)` on a `File` entry from a multipart submission
 * would send the text `"[object File]"` to the database as an id.
 *
 * There is no version token, and that is the committed core's decision rather
 * than an omission here: assignments are immutable in this slice, so a surviving
 * id still identifies the same row, and a row somebody else already removed is
 * reported honestly as not found by the plan-scoped read.
 */
export async function deleteExamAssignmentAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read or removed.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The committed writer, which re-runs the admin boundary and the lifecycle
  //    gate, resolves the plan from the DB-verified offering, normalizes the raw
  //    target id itself, reads the assignment WITHIN that plan, and deletes the
  //    row that read returned.
  const result = await deleteExamAssignment(
    courseOfferingId,
    formData.get("assignmentId"),
  );

  // 4. Success: revalidate EXACTLY this exams path, then return to it. The
  //    removed assignment's id is NOT reflected in the URL.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?deletedAssignment=1`);
  }

  // 5. The one refusal that is NOT about this page.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 6. Every other refusal is fully described by its code alone: the unusable
  //    target id, the lifecycle denial, the missing plan and the missing-or-
  //    foreign assignment. No diagnostics list exists for a removal, so there is
  //    no issues token.
  redirect(`${examsPath}?assignmentDeleteError=${encodeURIComponent(result.code)}`);
}

/**
 * Assign ONE INSTRUCTED TRAINEE to ONE stored ExamSession of the bound offering's
 * plan.
 *
 * Returns `Promise<void>`, like its seven neighbours: every outcome is expressed
 * as a navigation, so the action holds no client-visible state and its signature
 * cannot grow a `prevState` parameter.
 *
 * ===========================================================================
 * TWO FIELDS, AND DELIBERATELY NOT A THIRD
 * ===========================================================================
 * The mapping below reads `sessionId` and `studentId` and NOTHING else. Absent —
 * not filtered out, but never looked for — are `courseOfferingId` and `planId`
 * (the first is bound by the route, the second is derived from it), `role` (the
 * committed create core fixes the single INSTRUCTED_TRAINEE literal, and its
 * payload type cannot express another), `horseName` (this role carries none, at
 * any layer of the committed create path), `orderIndex` (the committed writer
 * computes it as the next position within the SESSION, inside its own
 * transaction), `pairingIndex` (this slice writes none), `definitionId` and the
 * definition's requirement flags (properties of the session's exam, re-read
 * server-side), `assignmentCount` (a client claim about server state), a date, a
 * time, an instruction topic, a discipline, a note and a trainee's display NAME.
 * The committed writer's signature has no parameter for any of them, and its
 * normalized payload has no field for any of them either.
 *
 * ===========================================================================
 * NO COERCION AT ALL
 * ===========================================================================
 * Both values are forwarded EXACTLY as `FormData.get` returned them: a `string`,
 * or `null` for an absent field. There is no `String(...)`, no `??`, no
 * `.trim()`, no default and no empty-string collapse anywhere in this function —
 * deliberately, because the committed input core already defines all of it and a
 * second copy here would be free to drift from the rule the database actually
 * sees.
 *
 * That core accepts `unknown` for every field and FAILS CLOSED on every shape it
 * does not want: each of the two must be a NON-BLANK string after trimming, and
 * a NON-STRING is REFUSED rather than stringified — which is exactly why a `File`
 * entry from a multipart submission cannot become a session or trainee id.
 */
export async function createExamInstructedTraineeAssignmentAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The committed writer, given the bound route id and the two raw values.
  //    The bound offering id is a REQUEST: the writer runs the admin boundary and
  //    the exact-offering lookup itself, resolves the plan from the DB-verified
  //    id, verifies the submitted session WITHIN that plan, refuses unless that
  //    session's definition actually requires this role, and matches the trainee
  //    through ONE fail-closed statement requiring an ACTIVE enrolment in that
  //    same offering — so a session or a trainee belonging to another course is
  //    unreachable.
  const result = await createExamInstructedTraineeAssignment(courseOfferingId, {
    sessionId: formData.get("sessionId"),
    studentId: formData.get("studentId"),
  });

  // 4. Success: revalidate EXACTLY this exams path — no course dashboard, no
  //    schedule path, no trainee or instructor surface — then return to it. The
  //    new assignment is read back from the database by the page; it is never
  //    inserted optimistically, and neither its id nor its assigned position is
  //    reflected in the URL.
  if (result.ok) {
    revalidatePath(examsPath);
    redirect(`${examsPath}?createdInstructedTrainee=1`);
  }

  // 5. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected
  //    back in the destination.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 6. Field diagnostics: the writer's own stable codes, in the writer's own
  //    order. Only codes travel — never a submitted session id or student id, and
  //    never a message built from one.
  if (result.code === "invalid_input") {
    const codes = result.issues.map((issue) => issue.code).join(",");
    redirect(
      `${examsPath}?instructedTraineeError=invalid_input&instructedTraineeIssues=${encodeURIComponent(codes)}`,
    );
  }

  // 7. Every other refusal is fully described by its code alone: the lifecycle
  //    denial, the missing plan, the missing-or-foreign session, the definition
  //    that does not ask for this role at all, the ineligible trainee and the
  //    role-blind already-assigned conflict.
  redirect(`${examsPath}?instructedTraineeError=${encodeURIComponent(result.code)}`);
}

/**
 * EX-PUB-UI-MVP — PUBLISH or UNPUBLISH the bound offering's ExamPlan.
 *
 * Returns `Promise<void>`, like its eight neighbours: every outcome is expressed
 * as a navigation, so the action holds no client-visible state and its signature
 * cannot grow a `prevState` parameter.
 *
 * ===========================================================================
 * ONE ENDPOINT, ONE FIELD, TWO LITERALS
 * ===========================================================================
 * This is deliberately ONE action carrying an `operation` field rather than a
 * separate publish endpoint and unpublish endpoint — and that is NOT a violation
 * of the "no discriminator" rule the eight neighbours above are built on. That
 * rule forbids a request from choosing which OPERATION KIND runs (a create versus
 * a delete, an examinee versus an instructed trainee), because each of those
 * reaches a different writer with a different authorization story. Here there is
 * exactly ONE writer, ONE authorization boundary and ONE lifecycle gate; publish
 * and unpublish are the two VALUES of a single, symmetric state transition that
 * the committed backend's own signature already models as one parameter. Splitting
 * them would add a second public network id that reaches the same function.
 *
 * The field is CLOSED to the two exact literals, HERE, before the writer is
 * entered. That narrowing is not a re-implementation of the backend's rule but a
 * fail-closed restatement of THIS endpoint's own contract, and it is what makes
 * the writer's `ExamPublicationOperation` parameter type honest at the network
 * boundary — a `"use server"` module receives whatever was posted, and a
 * TypeScript annotation is erased. The committed core re-checks the same thing
 * independently and would refuse anything else on its own.
 *
 * ===========================================================================
 * WHAT THE FORM CANNOT SAY
 * ===========================================================================
 * The mapping below reads `operation` and NOTHING else. Absent — not filtered
 * out, but never looked for — are `courseOfferingId` (bound by the route),
 * `planId` (server-derived from the verified offering, and the committed writer's
 * signature has no parameter for one), `publishedAt` and every other timestamp
 * (the committed binding reads the SERVER clock in exactly one place, so no field
 * exists through which a client could decide when a plan was published), an actor
 * id, an `individualPublishedAt`, a session id and a definition id.
 *
 * NO COERCION AT ALL. The submitted value is compared to the two literals
 * directly: there is no `String(...)`, no `??`, no `.trim()`, no case folding and
 * no default. A `File` entry from a multipart submission equals neither literal
 * and is refused, exactly as an absent field is.
 *
 * ===========================================================================
 * WHAT THIS ACTION DOES NOT DO
 * ===========================================================================
 * It flips ONE plan-level column through ONE committed writer. It sends no
 * notification, records no publication history, publishes no INDIVIDUAL session,
 * validates no pairing, no supervisor, no duplicate and no timetable
 * completeness, and reads no capability. None of those modules is imported, so
 * none is reachable from here. A plan that is incomplete when a manager publishes
 * it is published incomplete; adding a readiness gate is a separate, reviewed
 * slice.
 */
export async function setExamPlanPublicationAction(
  courseOfferingId: string,
  formData: FormData,
): Promise<void> {
  // 1. Authorize the manager BEFORE anything is read or written.
  await requireAdmin();

  // 2. The exams path of THIS offering — the only path this action revalidates
  //    and the only one it redirects back to.
  const examsPath = `/admin/courses/${encodeURIComponent(courseOfferingId)}/exams`;

  // 3. The ONE field, closed to the two exact literals. `redirect` throws, so the
  //    submitted value is narrowed to the writer's own union on every path that
  //    survives — no cast, and no widening of the committed signature.
  const submitted = formData.get("operation");
  if (submitted !== "PUBLISH" && submitted !== "UNPUBLISH") {
    redirect(`${examsPath}?publication=unknown_operation`);
  }

  // 4. The committed writer. The bound offering id is a REQUEST: the writer runs
  //    the admin boundary and the exact-offering lookup itself, applies the course
  //    lifecycle gate on the VERIFIED status, resolves the plan from that verified
  //    id, reads the SERVER clock and issues ONE conditional write. Every
  //    concurrency, no-op and stale-write decision is its own.
  const result = await setExamPlanPublication(courseOfferingId, submitted);

  // 5. Success, in its THREE distinguishable forms. A real transition revalidates
  //    this one exams path and says which way it went; a NO_CHANGE revalidates
  //    NOTHING, because the writer issued no statement at all and a cache
  //    invalidation would be a lie about what happened. Neither carries the plan
  //    id or the stored publication instant.
  if (result.ok) {
    if (result.status !== "NO_CHANGE") {
      revalidatePath(examsPath);
    }
    redirect(`${examsPath}?publication=${result.status}`);
  }

  // 6. The one refusal that is NOT about this page: the offering does not exist,
  //    so returning to its exams route would render a second not-found. The
  //    manager goes to the course list, and the requested id is not reflected
  //    back in the destination.
  if (result.code === "offering_not_found") {
    redirect("/admin/courses?error=invalid");
  }

  // 7. Every other refusal is fully described by its code alone: the lifecycle
  //    denial, the missing plan and the stale write. No diagnostics list exists
  //    for a publication, so there is no issues token.
  redirect(`${examsPath}?publication=${encodeURIComponent(result.code)}`);
}
