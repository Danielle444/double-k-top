/**
 * EXAM EX-ASG-LTD1-A — the PURE orchestration of ONE stored EXAMINEE assignment
 * CREATE that may ALSO carry a lesson topic and/or a discipline.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no capability, no filesystem, no
 * network, no Next, no `server-only`, no `"use server"`. Every effect this
 * operation needs arrives through the injected deps, so the ORDER in which
 * authorization, lifecycle gating, plan resolution, input validation, session
 * verification, definition verification, eligibility verification and the write
 * happen is stated once, here, and is testable without a database.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - given a definition that DEMANDS a lesson topic and/or a discipline, in which
 *    exact order must an examinee-assignment create authorize, gate, resolve,
 *    validate, verify and write — and what does it store?
 *  - and which stable, non-echoing outcome describes each way it can fail?
 *
 * ===========================================================================
 * WHY THIS IS A SECOND CREATE PATH AND NOT AN EDIT OF THE FIRST
 * ===========================================================================
 * The committed examinee create path models exactly three submitted fields and
 * REFUSES OUTRIGHT when the session's definition demands a lesson topic or a
 * discipline, because it has no field for either and a row missing a value its
 * own definition requires is worse than an honest refusal.
 *
 * This module is the operation that MAKES those definitions usable. It reads two
 * further optional fields and stores them, so the refusal the committed path
 * exists to produce is no longer the only possible answer for such a definition.
 *
 * Nothing here edits, replaces, imports or weakens that committed path: it keeps
 * its own three-field model, its own issue namespace and its own outcome set, and
 * both continue to exist side by side until a later, separately reviewed slice
 * decides which surface calls which. Reusing the committed input normalizer was
 * considered and rejected — it models three fields and no optional ones, so
 * widening it would change the contract of an already-wired create.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *  - it OWNS NO HORSE RULE. WHICH assignments must carry a horse is the committed
 *    `isHorseRequiredFor`'s decision, and this module consults it with the
 *    definition's authoritative kind. No kind table and no role table is
 *    reproduced here;
 *  - it OWNS NO POLICY TABLE. Which offering statuses may be configured is the
 *    committed course operation policy's decision, reached through
 *    `assertConfigurationAllowed`;
 *  - it CREATES NO PLAN and NO SESSION. An assignment may be created only under a
 *    session that ALREADY EXISTS, under a plan that ALREADY EXISTS. There is no
 *    dependency capable of creating either, so lazy creation is not merely
 *    unimplemented — it is unrepresentable;
 *  - it PERFORMS NO IO and knows nothing of a transaction client, a row or a
 *    query. `createAssignmentAtNextOrder` is an opaque promise;
 *  - it DEFINES NO VOCABULARY. A lesson topic and a discipline are FREE TEXT
 *    here: there is no catalog, no enum, no autocomplete source, no suggestion
 *    list and no membership table, so no value can be refused for not appearing
 *    in a list this module does not have;
 *  - it DERIVES NOTHING and ENFORCES NO CAPACITY. No wave layout, no personal
 *    slot, no end time, no break, no conflict and no timetable is computed, and
 *    none is an input;
 *  - it writes NO `pairingIndex`, no `notes` and no `sourcePracticeRole`, and it
 *    does not edit, delete, reorder or publish anything. Those are other slices,
 *    and no dependency here could reach one.
 *
 * ===========================================================================
 * THE CALLER SUPPLIES A REQUEST, NEVER A GRANT
 * ===========================================================================
 * The only two arguments are a REQUESTED `courseOfferingId` and a RAW, untrusted
 * input object. There is no parameter — and no readable field of the raw object —
 * through which a caller could supply a `role`, an `orderIndex`, a `pairingIndex`,
 * a `planId`, a `definitionId`, an actor id or a transaction handle.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id that
 * `requireCourseContext` returned, never from the request. The requested id is
 * used for exactly one thing — asking the course boundary to verify it — and is
 * never read again afterwards, so a caller cannot steer the plan lookup at one
 * offering while being authorized for another.
 *
 * `role` is HARDCODED to `EXAMINEE` inside this module and is typed as that
 * single literal all the way into the write dependency. It is not a parameter,
 * not a field of any input type, and not a value any caller can influence.
 *
 * `orderIndex` is assigned entirely inside `createAssignmentAtNextOrder`. This
 * module never computes, reads, defaults or forwards one.
 *
 * ===========================================================================
 * THE LOCKED ORDER, AND WHY EACH STEP PRECEDES THE NEXT
 * ===========================================================================
 *   1. requireCourseContext(requested id)     — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)      — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)      — VERIFIED id only
 *   4. no plan                                 -> plan_not_found
 *   5. normalizeDetailedExamAssignmentCreateInput — this module's input rules
 *   6. invalid base input                      -> invalid_input + stable issues
 *   7. findSessionForPlan(plan.id, sessionId)  — PLAN-SCOPED verification
 *   8. no session                              -> session_not_found
 *   9. the horse requirement, against the definition's authoritative kind
 *  10. the definition's DEMANDS for topic / discipline -> invalid_input
 *  11. findEligibleTrainee(verified offering)  — OFFERING-SCOPED verification
 *  12. not eligible                            -> trainee_not_eligible
 *  13. createAssignmentAtNextOrder(session.id) — the single write
 *  14. narrow success DTO
 *
 * The consequences are the point:
 *  - NOTHING is validated for a course the actor may not access, so validation
 *    diagnostics can never be used as an oracle over another course;
 *  - NO plan lookup happens before authorization, so the existence of a plan
 *    cannot be probed by an unauthorized caller;
 *  - NO session lookup happens for an invalid submission, so a malformed request
 *    cannot be used to probe which session ids exist;
 *  - NO trainee lookup happens for an unknown session or an unmet definition
 *    demand, so the roster cannot be probed through a failed create;
 *  - NO write dependency runs when any verification fails, so a rejected
 *    submission leaves no partial row and consumes no order position;
 *  - the lifecycle gate runs BEFORE the plan lookup, so an ARCHIVED offering is
 *    refused without any exam query at all.
 *
 * ===========================================================================
 * THE DEFINITION DECIDES WHAT IS STORED — IN BOTH DIRECTIONS
 * ===========================================================================
 * The two extra fields are OPTIONAL ON THE SUBMISSION and CONDITIONAL ON THE
 * DEFINITION. The verified session carries the definition's own demands, and
 * those demands — never the submission — decide the stored value:
 *
 *  - DEMANDED and absent    -> refuse, and write NOTHING. An incomplete row that
 *                              a manager must later discover and repair is worse
 *                              than an honest refusal at the point of submission;
 *  - DEMANDED and supplied  -> store the trimmed value;
 *  - NOT demanded           -> store `null`, EVEN IF a value was submitted.
 *
 * The last rule is the one worth stating twice. Silently keeping a topic that the
 * definition does not support would put a value on a row where every reader,
 * every projection and the committed conformance validator agree none belongs,
 * and would let a client widen the stored shape of a definition kind simply by
 * posting an extra field. Dropping it keeps the create contract exactly as narrow
 * as the definition it is creating under.
 *
 * ===========================================================================
 * ONE REQUIREMENT PREDICATE, FAIL-CLOSED, USED FOR BOTH DECISIONS
 * ===========================================================================
 * A requirement flag is DECLARED as a boolean and its backing column is a
 * non-null boolean with a default, so nothing but `true` or `false` should ever
 * arrive. If something else does — a widened binding, a hand-built fake, a future
 * nullable column — the safe reading is the committed one that the sibling create
 * path already uses: ONLY A LITERAL `false` MEANS "NOT REQUIRED".
 *
 * Crucially, that single predicate decides BOTH the refusal AND the stored value.
 * Deciding the refusal fail-closed while deciding the stored value on `=== true`
 * would be the worst of both: a malformed flag would demand a topic from the
 * manager and then write `null` anyway — precisely the incomplete row the
 * fail-closed reading exists to prevent. For a well-formed boolean the two
 * readings are identical, so this costs nothing and closes that gap by
 * construction.
 *
 * ===========================================================================
 * A SECOND PERSON IS STILL A DIFFERENT ROW
 * ===========================================================================
 * `requiresInstructedTrainee` is CARRIED on the verified session — the committed
 * session query already selects the definition shape as a unit — but it is NOT
 * consulted here and CANNOT change any decision this module makes. That flag says
 * the block must ALSO carry an assignment in the other role, which is a different
 * row written by a different operation. Refusing the examinee here would make
 * such a block unbuildable: neither row could ever be created first.
 *
 * ===========================================================================
 * A FOREIGN SESSION AND A MISSING ONE ARE THE SAME ANSWER
 * ===========================================================================
 * `findSessionForPlan` is asked for a session under the SERVER-RESOLVED plan. A
 * session that does not exist, and one that exists under ANOTHER plan, both come
 * back as `null` and both produce `session_not_found`. The two are therefore
 * indistinguishable to the caller, which is deliberate: a distinguishable answer
 * would turn this write path into an existence oracle over every other course's
 * exam schedule.
 *
 * The scoping is what makes that true, not a comparison this module performs.
 * There is no dependency that can read a session WITHOUT a plan id, so a
 * cross-plan create is unreachable rather than merely rejected.
 *
 * The same holds for the trainee: `findEligibleTrainee` is asked under the
 * VERIFIED offering id, so a `Student.id` from another course resolves to `null`
 * and is refused as `trainee_not_eligible`. The eligible id the dependency
 * returns — not the submitted one — is what reaches the write.
 *
 * ===========================================================================
 * ONLY THREE KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Exactly three injected predicates may convert a thrown error into a refusal:
 * the course not-found, the lifecycle denial and the uniqueness violation. Every
 * other throw — an infrastructure fault, a programming error, a plan-query
 * failure, a session-query failure, an eligibility-query failure — LEAVES THIS
 * MODULE UNCHANGED.
 *
 * The uniqueness classifier is not dead code: the assignment table carries a real
 * unique key over `(sessionId, studentId)`, so assigning the same trainee to the
 * same session twice — whether by a double submit or by two managers at once — is
 * a reachable, ordinary outcome, and `assignment_conflict` is its stable name. It
 * is classified at the WRITE, not pre-checked by a read, because a read-then-write
 * would reintroduce exactly the race the unique key exists to close.
 *
 * There is no `unexpected` code and no catch-all `catch`. That is deliberate: a
 * generic failure code would let a real defect render as an ordinary,
 * unremarkable form error that nobody investigates.
 *
 * CRITICALLY, the real admin boundary denies by REDIRECTING (a framework
 * `NEXT_REDIRECT` throw). Because each classifier is asked about one specific
 * error shape and anything unrecognized is re-thrown, a redirect passes straight
 * through and the framework still performs it. A redirect must never be
 * translated into a refusal — an admin who is simply not logged in would then see
 * "not found" instead of the login page.
 */
import { isHorseRequiredFor } from "./exam-definition-validation-core";
import type { ExamAssignmentRole, ExamKind } from "./exam-domain-core";

/**
 * The ONLY role this slice writes, fixed here and never derived from input.
 *
 * Typed as the committed union member so a future rename of the role vocabulary
 * cannot leave a stale string literal behind in this file.
 */
const ROLE_EXAMINEE = "EXAMINEE" satisfies ExamAssignmentRole;

// ===========================================================================
// Codes + messages
// ===========================================================================

/**
 * Every diagnostic this module can produce — a NEW, CLOSED namespace of its own.
 *
 * Deliberately NOT the committed three-field namespace. That set is the contract
 * of an already-wired create with a different field list, and adding two codes to
 * it would change what an existing surface can render. Five fields, five codes,
 * one owner.
 *
 * There is deliberately no code for a forbidden or unknown key (those are
 * excluded by construction — only five fields are ever read), no code describing
 * a database outcome, and no code describing a role, an ordering or a definition
 * decision the definition itself owns.
 */
export type DetailedExamAssignmentInputIssueCode =
  | "EX-ASG-LTD-SESSION-REQUIRED"
  | "EX-ASG-LTD-STUDENT-REQUIRED"
  | "EX-ASG-LTD-HORSE-REQUIRED"
  | "EX-ASG-LTD-TOPIC-REQUIRED"
  | "EX-ASG-LTD-DISCIPLINE-REQUIRED";

/**
 * The message table. Stable Hebrew, one message per code, and deliberately
 * NON-ECHOING: no message contains a placeholder, a submitted value, a field
 * path, an id or a count, so a diagnostic can never reflect what the client sent
 * back to the client.
 *
 * The messages are also deliberately VAGUE ABOUT WHY. A message that
 * distinguished "not a string" from "blank" from "the definition demands it"
 * would be an oracle over the exact validator and buys a manager nothing: the
 * correction is the same either way.
 */
export const DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES: Readonly<
  Record<DetailedExamAssignmentInputIssueCode, string>
> = Object.freeze({
  "EX-ASG-LTD-SESSION-REQUIRED": "חובה לבחור מפגש מבחן",
  "EX-ASG-LTD-STUDENT-REQUIRED": "חובה לבחור חניך",
  "EX-ASG-LTD-HORSE-REQUIRED": "חובה לציין סוס עבור הנבחן",
  "EX-ASG-LTD-TOPIC-REQUIRED": "חובה לציין נושא שיעור עבור מפגש זה",
  "EX-ASG-LTD-DISCIPLINE-REQUIRED": "חובה לציין דיסציפלינה עבור מפגש זה",
});

/**
 * One diagnostic. Carries ONLY a stable code and its message: no submitted
 * value, no field path, no raw object, no id and no index.
 */
export interface DetailedExamAssignmentInputIssue {
  readonly code: DetailedExamAssignmentInputIssueCode;
  readonly message: string;
}

/** Build one frozen diagnostic from its code. */
export function makeDetailedExamAssignmentInputIssue(
  code: DetailedExamAssignmentInputIssueCode,
): DetailedExamAssignmentInputIssue {
  return Object.freeze({ code, message: DETAILED_EXAM_ASSIGNMENT_INPUT_MESSAGES[code] });
}

// ===========================================================================
// The normalized input
// ===========================================================================

/**
 * The normalized CREATE payload — exactly the five submitted fields.
 *
 * The three required ones are plain non-blank strings and never `null`. The two
 * optional ones are a non-blank string OR `null`, never `undefined` and never an
 * empty string, so the shape is stable, JSON-round-trippable and unambiguous to a
 * writer: `null` means "nothing was supplied", full stop.
 *
 * Note what is absent: no `role`, no `orderIndex`, no `pairingIndex`, no
 * `planId`, no `courseOfferingId`, no `definitionId`, no `notes` and no
 * `sourcePracticeRole`. None of them is filtered out — they are UNREPRESENTABLE,
 * because no field is ever read for them.
 */
export interface NormalizedDetailedExamAssignmentCreate {
  readonly sessionId: string;
  readonly studentId: string;
  readonly horseName: string;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
}

/**
 * A discriminated, JSON-safe normalization result.
 *
 * The success arm carries NO `issues` key and the failure arm carries NO `value`
 * key, so no property is ever present-but-`undefined`.
 */
export type DetailedExamAssignmentInputResult =
  | { readonly ok: true; readonly value: NormalizedDetailedExamAssignmentCreate }
  | {
      readonly ok: false;
      readonly issues: readonly DetailedExamAssignmentInputIssue[];
    };

// ===========================================================================
// Field helpers
// ===========================================================================

/**
 * Read one OWN property of a raw value, or `undefined`.
 *
 * Own-property only: a raw object inherits `toString`, `constructor` and friends
 * from its prototype, and reading those as if the client had sent them would turn
 * prototype members into submitted data.
 *
 * A non-object `source` — `null`, `undefined`, a string, a number, an array — is
 * not a special case: every field simply reads as absent, and the ordinary
 * diagnostics then explain what is missing.
 */
function readField(source: unknown, key: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return (source as Record<string, unknown>)[key];
}

/**
 * Normalize a REQUIRED text value: trim a string, or fail.
 *
 * Returns `null` to mean "unusable" for every one of: absent, `null`,
 * `undefined`, a non-string of ANY type — a number, a boolean, an array, a plain
 * object, a function, a file-like upload value — and a string that is empty or
 * whitespace-only.
 *
 * NO COERCION AND NO PROBING. The value's own `toString`, `name`, `valueOf` or
 * any other member is never read, so a file-like object cannot contribute a
 * filename to the database through this path. There is no `normalize()`, no
 * `toLowerCase()` and no length ceiling, so Hebrew and every other script survive
 * unchanged and no legitimate value is silently rejected by an unapproved bound.
 */
function normalizeRequiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The three outcomes of an OPTIONAL text value.
 *
 * `"absent"` and `"refused"` are deliberately DIFFERENT. "Nothing was supplied"
 * is an ordinary, valid submission that the definition may or may not accept,
 * whereas "a number was supplied" is a malformed request that must never be
 * coerced into a stored string.
 */
type OptionalText =
  | { readonly kind: "absent" }
  | { readonly kind: "value"; readonly text: string }
  | { readonly kind: "refused" };

/**
 * Normalize an OPTIONAL text value, with the same no-coercion posture as the
 * required one.
 *
 * ABSENT — and therefore `null` — for: a missing own property, `null`,
 * `undefined`, an empty string and a whitespace-only string. A manager who clears
 * a field and a manager who never filled it in mean the same thing, and a stored
 * `""` would be a third state every reader would then have to handle.
 *
 * REFUSED for any non-string of any other type. Nothing is stringified: `String(...)`
 * would happily store `"[object Object]"` as a lesson topic.
 */
function normalizeOptionalText(value: unknown): OptionalText {
  if (value === undefined || value === null) return { kind: "absent" };
  if (typeof value !== "string") return { kind: "refused" };
  const trimmed = value.trim();
  return trimmed.length > 0 ? { kind: "value", text: trimmed } : { kind: "absent" };
}

// ===========================================================================
// The normalization
// ===========================================================================

/**
 * Normalize and validate a RAW detailed examinee-assignment CREATE submission.
 *
 * EXACTLY FIVE own properties are read — `sessionId`, `studentId`, `horseName`,
 * `instructionTopic`, `discipline` — and nothing else is sought, so `id`, `role`,
 * `orderIndex`, `pairingIndex`, `planId`, `courseOfferingId`, `definitionId`,
 * `notes`, `sourcePracticeRole`, `createdAt` and `updatedAt` cannot enter a
 * result, not because they are stripped but because they are never looked for.
 *
 * EVERY applicable issue is reported, not only the first: a submission with no
 * trainee AND no horse has two problems, and hiding one behind the other would
 * cost the manager a second round-trip to discover it.
 *
 * The issue ORDER is FIXED — session, student, horse, topic, discipline — so a
 * form can render diagnostics in a stable sequence and a test can assert on it.
 * The order does not depend on the raw object's key order, on which fields are
 * present, or on anything else.
 *
 * This function knows NOTHING about the definition, so the only topic and
 * discipline issues it can raise are for a value of the wrong TYPE. "The
 * definition demands one and none was supplied" is a question only the
 * orchestration below can ask, and it reuses these same two codes so a form
 * renders one diagnostic per field either way.
 *
 * A successful result grants NOTHING: it means only "these five values are
 * well-formed". Whether the session exists under the acting course's plan,
 * whether the trainee is enrolled there, and whether the definition accepts or
 * demands the optional values are ALL questions for the orchestration layer.
 *
 * Never throws. Never mutates `rawInput`; a frozen raw object is fine, because
 * nothing is ever written back to it.
 */
export function normalizeDetailedExamAssignmentCreateInput(
  rawInput: unknown,
): DetailedExamAssignmentInputResult {
  const issues: DetailedExamAssignmentInputIssue[] = [];

  const sessionId = normalizeRequiredText(readField(rawInput, "sessionId"));
  if (sessionId === null) {
    issues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-SESSION-REQUIRED"));
  }

  const studentId = normalizeRequiredText(readField(rawInput, "studentId"));
  if (studentId === null) {
    issues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-STUDENT-REQUIRED"));
  }

  const horseName = normalizeRequiredText(readField(rawInput, "horseName"));
  if (horseName === null) {
    issues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-HORSE-REQUIRED"));
  }

  const topic = normalizeOptionalText(readField(rawInput, "instructionTopic"));
  if (topic.kind === "refused") {
    issues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-TOPIC-REQUIRED"));
  }

  const discipline = normalizeOptionalText(readField(rawInput, "discipline"));
  if (discipline.kind === "refused") {
    issues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-DISCIPLINE-REQUIRED"));
  }

  if (issues.length > 0) {
    return Object.freeze({
      ok: false as const,
      issues: Object.freeze([...issues]),
    });
  }

  // Reached ONLY when all five fields validated, which is what proves the three
  // narrowing assertions below. They restate that proof for the type system and
  // widen nothing at runtime.
  return Object.freeze({
    ok: true as const,
    value: Object.freeze({
      sessionId: sessionId as string,
      studentId: studentId as string,
      horseName: horseName as string,
      instructionTopic: topic.kind === "value" ? topic.text : null,
      discipline: discipline.kind === "value" ? discipline.text : null,
    }),
  });
}

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a create may act on, AFTER the boundary verified it.
 *
 * Deliberately TWO fields. It is not the project's admin course context and not a
 * CourseOffering row: a name, a level, an activity year or a calendar value would
 * be data this operation has no business reading, and a generated database type
 * here would end this module's purity.
 *
 * `courseOfferingId` is the DB-VERIFIED id and is the ONLY id that reaches the
 * plan lookup and the eligibility lookup. `status` is a plain `string` rather
 * than the generated enum for the same purity reason; the committed policy the
 * gate consults is default-deny, so an unrecognized status is refused rather than
 * waved through.
 */
export interface VerifiedDetailedExamAssignmentCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/**
 * The plan the target session must live under: its id and nothing else.
 *
 * No publication state, no sessions, no definitions, no offering relation, no
 * timestamps. A create does not need to know whether the plan is published, and
 * must not be able to make a decision from data it should not have read.
 */
export interface ResolvedExamPlanForDetailedAssignmentCreate {
  readonly id: string;
}

/**
 * The verification result for the submitted session: its id, and the four
 * DEFINITION-DERIVED facts this operation is entitled to see.
 *
 * Deliberately NOT the session row and NOT the definition row. There is no date,
 * no start time, no title, no field name, no order position, no capacity, no
 * duration, no wave layout and no assignment list — a field this module cannot
 * read is a decision it cannot quietly start making, and a name echoed into a
 * diagnostic would leak another course's configuration if the scoping ever
 * regressed.
 *
 * `definitionKind` is the AUTHORITATIVE kind carried by the definition the
 * session hangs off, never a value a client supplied, and exists for exactly one
 * purpose: to let the committed horse rule be consulted with real data.
 *
 * `requiresInstructedTrainee` is carried because the committed session query
 * already selects the definition's requirement shape as a unit, and narrowing it
 * for this path alone would leave two queries that could drift. It is NOT read by
 * the orchestration below, and no branch here depends on it.
 */
export interface VerifiedExamSessionForDetailedAssignmentCreate {
  readonly id: string;
  readonly definitionKind: ExamKind;
  readonly requiresLessonTopic: boolean;
  readonly requiresDiscipline: boolean;
  readonly requiresInstructedTrainee: boolean;
}

/**
 * The eligibility verdict for the submitted trainee: the id of the trainee the
 * VERIFIED offering actually contains, and nothing else.
 *
 * No name, no group, no phone number, no parent contact and no enrolment record.
 * A create needs to know only that this person may be assigned in this course;
 * every other fact about them would be personal data this operation has no reason
 * to hold.
 */
export interface EligibleDetailedExamTrainee {
  readonly studentId: string;
}

/**
 * The payload of the single write.
 *
 * `role` is typed as the single literal `"EXAMINEE"`, so no other value is even
 * expressible at this boundary, and no widening of the input model could smuggle
 * one through. There is no `orderIndex`, no `pairingIndex`, no `notes` and no
 * `sourcePracticeRole`: the first is the write's own decision and the rest are
 * not written by this slice at all.
 *
 * The two optional columns are `string | null` and are ALREADY reconciled with
 * the definition by the time this value is built — a value the definition does
 * not support has been replaced by `null`, so the write layer needs no rule of
 * its own and cannot reintroduce one.
 */
export interface NewDetailedExamineeAssignment {
  readonly studentId: string;
  readonly role: "EXAMINEE";
  readonly horseName: string;
  readonly instructionTopic: string | null;
  readonly discipline: string | null;
}

/**
 * What the write reports back: the new assignment id and the order position the
 * SERVER assigned. Never the row, never a timestamp.
 */
export interface CreatedDetailedExamAssignmentRecord {
  readonly id: string;
  readonly orderIndex: number;
}

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan or a session, edit or delete anything, reorder
 * anything, write a break, a supervisor or a second role, publish anything, send
 * a notification, resolve a capability, count anything, read a capacity or a
 * timetable, offer a topic vocabulary, or read another course. The operation is
 * structurally incapable of doing anything but appending one examinee to one
 * already-existing session.
 *
 * The three predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error, so no database detail and no
 * submitted value can leak into a result through them.
 */
export interface CreateDetailedExamAssignmentDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller — the redirect must reach the framework untouched.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedDetailedExamAssignmentCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForDetailedAssignmentCreate | null>;

  /**
   * Verify the submitted session EXISTS UNDER THE GIVEN PLAN, and report the
   * definition-derived facts above.
   *
   * The plan id is the SERVER-RESOLVED one, and there is no variant of this
   * dependency that omits it. `null` means "no such session under this plan" and
   * covers both a session that does not exist and one belonging to another plan —
   * the caller may not learn which.
   */
  findSessionForPlan(
    planId: string,
    sessionId: string,
  ): Promise<VerifiedExamSessionForDetailedAssignmentCreate | null>;

  /**
   * Verify the submitted trainee is assignable IN THE VERIFIED OFFERING.
   *
   * The offering id is the boundary's, never the request's, and there is no
   * variant of this dependency that omits it. `null` means "not assignable here"
   * and covers both an unknown trainee and one enrolled in another course.
   */
  findEligibleTrainee(
    verifiedCourseOfferingId: string,
    studentId: string,
  ): Promise<EligibleDetailedExamTrainee | null>;

  /**
   * The SINGLE write: append one examinee to the given session, assigning the
   * next order position itself. The session id is the SERVER-VERIFIED one.
   */
  createAssignmentAtNextOrder(
    sessionId: string,
    value: NewDetailedExamineeAssignment,
  ): Promise<CreatedDetailedExamAssignmentRecord>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;

  /** Is this throw "that trainee is already assigned to that session"? */
  isUniqueConstraintError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/**
 * The failure codes that need no diagnostics: each is fully described by the code
 * itself.
 *
 * There is deliberately no `unexpected`, `stale_write`, `session_full`,
 * `capacity_exceeded`, `definition_not_found`, `archived` or
 * `definition_requires_unsupported_fields` code. The first would hide defects;
 * the middle ones describe a limit this operation does not enforce or a lookup it
 * does not perform; and the last belongs to the committed three-field path, which
 * refuses such a definition precisely because it cannot store these two values —
 * whereas this path CAN, so the same situation is an ordinary, per-field
 * `invalid_input` a manager can act on rather than a dead end.
 */
export type CreateDetailedExamAssignmentRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "session_not_found"
  | "trainee_not_eligible"
  | "assignment_conflict";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * THREE arms rather than two, so `issues` EXISTS ONLY on `invalid_input`. A
 * single failure arm with an optional `issues` would be present-but-`undefined`
 * on every other refusal, which breaks the JSON round trip the exam module's
 * results are held to and invites callers to render an empty issue list.
 *
 * The success arm carries the new assignment id and its assigned position, and
 * NOTHING ELSE. Nothing in any arm is a calendar value, Map, Set, BigInt, Error
 * or class instance, and nothing carries a plan id, a course offering id, a
 * session id, a student id, a horse name, a lesson topic, a discipline, an actor
 * id, a timestamp, a raw error, a database detail or any submitted value — a
 * diagnostic must never echo what the client sent back to the client.
 */
export type CreateDetailedExamAssignmentResult =
  | {
      readonly ok: true;
      readonly assignmentId: string;
      readonly orderIndex: number;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly DetailedExamAssignmentInputIssue[];
    }
  | {
      readonly ok: false;
      readonly code: CreateDetailedExamAssignmentRefusalCode;
    };

function refuse(
  code: CreateDetailedExamAssignmentRefusalCode,
): CreateDetailedExamAssignmentResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly DetailedExamAssignmentInputIssue[],
): CreateDetailedExamAssignmentResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    // A fresh frozen copy: the result must not alias an array a caller could
    // later mutate, and the issue ORDER is preserved exactly so a form can render
    // diagnostics in a stable sequence.
    issues: Object.freeze([...issues]),
  });
}

function succeed(
  created: CreatedDetailedExamAssignmentRecord,
): CreateDetailedExamAssignmentResult {
  return Object.freeze({
    ok: true as const,
    assignmentId: created.id,
    orderIndex: created.orderIndex,
  });
}

/**
 * Does the definition REQUIRE this field?
 *
 * FAIL-CLOSED, and the single source of truth for BOTH the refusal and the stored
 * value, for the reason the header states at length: only a literal `false` means
 * "not required", so a malformed flag demands the value AND stores it, and can
 * never produce a row that is missing a value its own definition requires.
 *
 * The parameter is DECLARED `boolean` — the defensive branch exists for a value
 * the type system says cannot arrive, which is exactly when a fail-closed reading
 * matters.
 */
function requiresField(flag: boolean): boolean {
  return flag !== false;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Create exactly ONE stored EXAMINEE assignment — with its definition-required
 * lesson topic and/or discipline — under an ALREADY-EXISTING session, in the
 * ALREADY-EXISTING plan of one authorized, lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction: each
 * step's output is the next step's only input, so no step can be reordered
 * without the code failing to compile or the plan id becoming unavailable.
 *
 * Each `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier.
 * Nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT` from the authorization boundary.
 *
 * Never mutates `rawInput`; a frozen raw object is fine.
 */
export async function createDetailedExamAssignmentWithDeps(
  courseOfferingId: string,
  rawInput: unknown,
  deps: CreateDetailedExamAssignmentDeps,
): Promise<CreateDetailedExamAssignmentResult> {
  // 1. Authorization + exact-offering verification FIRST. Nothing about exams,
  //    plans, sessions, trainees or the submitted input is touched before this
  //    resolves.
  let context: VerifiedDetailedExamAssignmentCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. Runs before any exam
  //    query, so an ARCHIVED offering costs zero exam reads.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The plan of the VERIFIED offering. `courseOfferingId` — the requested,
  //    unverified value — is never read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan means no session to assign anybody to. This slice never creates or
  //    upserts one, and no injected dependency could.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only NOW is the submitted input examined, by this module's own five-field
  //    normalizer.
  const normalized = normalizeDetailedExamAssignmentCreateInput(rawInput);

  // 6. Invalid BASE input ends the operation with the normalizer's diagnostics
  //    verbatim. Neither the session lookup, the trainee lookup nor the write is
  //    reached, so a malformed submission cannot probe which sessions exist.
  if (!normalized.ok) {
    return refuseInput(normalized.issues);
  }

  // 7. The session must exist UNDER THE RESOLVED PLAN. The plan id is the
  //    server's, and it is the scope — not a comparison — that makes a cross-plan
  //    create unreachable.
  const session = await deps.findSessionForPlan(plan.id, normalized.value.sessionId);

  // 8. A missing session and a foreign one produce the SAME refusal, so this
  //    write path is not an existence oracle over another course's schedule.
  if (!session) {
    return refuse("session_not_found");
  }

  // 9. The committed horse rule, consulted with the definition's AUTHORITATIVE
  //    kind and this operation's fixed role. The normalizer above already demands
  //    a horse unconditionally, which is strictly stronger for this role, so this
  //    branch is unreachable today. It is kept as the binding to the one owner of
  //    the rule: if either side ever changes, the two cannot silently disagree.
  if (
    isHorseRequiredFor(session.definitionKind, ROLE_EXAMINEE) &&
    normalized.value.horseName.length === 0
  ) {
    return refuseInput([
      makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-HORSE-REQUIRED"),
    ]);
  }

  // 10. The DEFINITION's demands, derived only from the VERIFIED session and
  //     never from the submission. Both are reported together, in the fixed field
  //     order, so a manager missing both learns both at once.
  //
  //     `requiresInstructedTrainee` is deliberately NOT consulted: the second role
  //     is a different row written by a later operation, and refusing the examinee
  //     here would make such a block unbuildable.
  const topicRequired = requiresField(session.requiresLessonTopic);
  const disciplineRequired = requiresField(session.requiresDiscipline);

  const demandIssues: DetailedExamAssignmentInputIssue[] = [];
  if (topicRequired && normalized.value.instructionTopic === null) {
    demandIssues.push(makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-TOPIC-REQUIRED"));
  }
  if (disciplineRequired && normalized.value.discipline === null) {
    demandIssues.push(
      makeDetailedExamAssignmentInputIssue("EX-ASG-LTD-DISCIPLINE-REQUIRED"),
    );
  }
  if (demandIssues.length > 0) {
    return refuseInput(demandIssues);
  }

  // 11. Eligibility, scoped to the VERIFIED offering. A trainee id from another
  //     course resolves to nothing here.
  const trainee = await deps.findEligibleTrainee(
    context.courseOfferingId,
    normalized.value.studentId,
  );

  // 12. Unknown and foreign are again the same answer, for the same reason.
  if (!trainee) {
    return refuse("trainee_not_eligible");
  }

  // 13. The single write, against the SERVER-VERIFIED session id and the
  //     SERVER-VERIFIED trainee id — not the submitted ones. The role is this
  //     module's constant; the order position is assigned inside the dependency.
  //
  //     The two optional columns are reconciled with the definition HERE and only
  //     here: a value the definition does not support becomes `null`, so no
  //     unsupported topic or discipline can reach the row and the write layer is
  //     handed a payload it may store verbatim. A uniqueness violation means that
  //     trainee already occupies that session, which is an ordinary outcome and
  //     never a defect.
  let created: CreatedDetailedExamAssignmentRecord;
  try {
    created = await deps.createAssignmentAtNextOrder(session.id, {
      studentId: trainee.studentId,
      role: ROLE_EXAMINEE,
      horseName: normalized.value.horseName,
      instructionTopic: topicRequired ? normalized.value.instructionTopic : null,
      discipline: disciplineRequired ? normalized.value.discipline : null,
    });
  } catch (error) {
    if (deps.isUniqueConstraintError(error)) {
      return refuse("assignment_conflict");
    }
    throw error;
  }

  // 14. The narrow success DTO: the new assignment id and its assigned position,
  //     nothing else.
  return succeed(created);
}
