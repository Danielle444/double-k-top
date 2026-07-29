/**
 * EXAM EX-S5B-4 — the PURE orchestration of an ATOMIC ExamDefinition REORDER.
 *
 * PURE by construction: no Prisma, no DB, no transaction, no clock, no
 * randomness, no env, no auth/session/cookie, no filesystem, no network, no
 * Next, no `server-only`, no `"use server"`. Every effect this operation needs
 * arrives through the injected `ReorderExamDefinitionsDeps`.
 *
 * WHAT THIS ANSWERS (and only this):
 *  - in which EXACT order must a reorder authorize, gate, resolve the plan,
 *    normalize its two untrusted lists and hand them to ONE atomic effect?
 *  - which stable, non-echoing outcome describes each way it can fail?
 *  - and what does "these ids are the plan's definitions, in this order" mean,
 *    precisely enough that the binding cannot get it subtly wrong?
 *
 * ===========================================================================
 * A REORDER IS A WHOLE-SET OPERATION, NOT A MOVE
 * ===========================================================================
 * The caller submits the COMPLETE new order of the plan's definitions. There is
 * no "move this one up", no "insert at position", no partial list and no
 * per-row index: those shapes all require the server to invent the positions of
 * the rows the caller did NOT mention, and inventing them is exactly how a
 * concurrent edit gets silently overwritten.
 *
 * So the submitted list must be an EXACT PERMUTATION of the plan's current
 * definition ids — no missing id, no duplicate, no extra, no unknown, and none
 * belonging to another plan. Anything else is refused as `reorder_conflict`,
 * with ZERO writes.
 *
 * That single code is deliberate. A caller learning "id X is unknown HERE but
 * exists elsewhere" would learn something about another course's exam plan, and
 * this module never lets that distinction escape: a foreign id, an invented id
 * and a stale id are one indistinguishable outcome. The honest advice behind all
 * of them is the same — reload and try again.
 *
 * ===========================================================================
 * THE STALE-WRITE TOKEN IS THE ORDER ITSELF
 * ===========================================================================
 * The sibling edit and removal use a row's `updatedAt` as their optimistic
 * concurrency token. A reorder cannot: it touches many rows, and reordering does
 * not change what any of them SAYS — only where each one sits.
 *
 * Its token is therefore `expectedOrderedDefinitionIds`: the sequence the caller
 * was looking at when they decided on the new one. The atomic effect compares it
 * against the AUTHORITATIVE current sequence read inside the same transaction,
 * and refuses the whole operation if they differ. A definition added, removed or
 * moved by another manager in the meantime is caught by that comparison, because
 * every one of those changes the sequence.
 *
 * ===========================================================================
 * THE LOCKED ORDER
 * ===========================================================================
 *   1. requireCourseContext(requested id)   — admin + exact-offering boundary
 *   2. assertConfigurationAllowed(status)   — course-lifecycle gate
 *   3. findExamPlanByCourseOfferingId(id)   — VERIFIED id only
 *   4. no plan                              -> plan_not_found
 *   5. normalize BOTH untrusted lists
 *   6. either list malformed                -> invalid_input
 *   7. reorderDefinitionsAtomically(plan.id, submitted, expected)
 *   8. conflict / unchanged / updated       -> the three outcomes
 *
 * Normalization runs LAST, after the boundary and after the plan exists, so a
 * caller who is not an admin of that offering cannot use the shape of a
 * validation error to probe anything at all.
 *
 * ===========================================================================
 * WHAT THE CALLER MAY SUPPLY — AND WHAT IS UNREPRESENTABLE
 * ===========================================================================
 * Three arguments: a REQUESTED `courseOfferingId`, and the two id lists. There
 * is no parameter for a `planId`, an `orderIndex`, an actor id, a publication
 * option, a definition object, a `kind`, a name, a duration, a capacity or a
 * transaction handle — not "ignored", but absent from the signature.
 *
 * `planId` is derived SERVER-SIDE from the DB-verified offering id, and every
 * read and every write the atomic effect performs is scoped by it.
 *
 * ===========================================================================
 * ONLY TWO KNOWN FAILURES ARE CLASSIFIED — EVERYTHING ELSE PROPAGATES
 * ===========================================================================
 * Two injected predicates may convert a THROW into a refusal (the course
 * not-found and the lifecycle denial). Every other throw leaves this module
 * unchanged, and a `NEXT_REDIRECT` from the authorization boundary reaches the
 * framework untouched.
 */

// ===========================================================================
// The injected boundary
// ===========================================================================

/**
 * The course context a reorder may act on, AFTER the boundary verified it.
 * Two fields, for the reasons the sibling write cores document: a verified id
 * that may reach the plan lookup, and the status the gate is asked about.
 */
export interface VerifiedExamDefinitionCourseContext {
  readonly courseOfferingId: string;
  readonly status: string;
}

/** The plan whose definitions are reordered: its id and nothing else. */
export interface ResolvedExamPlanForReorder {
  readonly id: string;
}

/**
 * What ONE atomic reorder attempt reports back.
 *
 * Deliberately NOT a Prisma result, a row list, a batch payload or an error: the
 * three arms below are the only three things this module is prepared to hear,
 * so a binding cannot leak a database detail through this seam.
 *
 * `conflict` covers EVERY refusal the atomic effect can decide — a stale
 * expected sequence, a list that is not an exact permutation, and a row that
 * moved mid-write. They are one arm because they are one outcome: nothing was
 * written, and the caller must reload.
 */
export type ReorderExamDefinitionsAtomicOutcome =
  | {
      readonly status: "updated";
      /** The order now stored, which is the submitted order. */
      readonly orderedDefinitionIds: readonly string[];
      /** How many rows actually had their position rewritten. */
      readonly updatedCount: number;
    }
  | {
      readonly status: "unchanged";
      /** The authoritative order, which the submission already matched. */
      readonly orderedDefinitionIds: readonly string[];
    }
  | {
      readonly status: "conflict";
    };

/**
 * The complete injected boundary.
 *
 * Note what is ABSENT and therefore unrepresentable: there is no dependency that
 * can create or upsert a plan, create, edit or remove a definition, write or
 * delete a session or an assignment, publish anything, send a notification,
 * resolve a capability, or read another course. In particular there is no
 * per-row reader and no per-row writer: the ENTIRE reorder is one call, because
 * anything less could not be atomic.
 *
 * The two predicates take `unknown` and return a boolean: this module never
 * inspects, unwraps, logs or echoes a raw error.
 */
export interface ReorderExamDefinitionsDeps {
  /**
   * Authorize the actor and verify the REQUESTED offering exists. May throw the
   * project's typed not-found, and may REDIRECT for an unauthenticated or
   * non-admin caller.
   */
  requireCourseContext(
    requestedCourseOfferingId: string,
  ): Promise<VerifiedExamDefinitionCourseContext>;

  /** Gate the mutation on the VERIFIED offering status. Throws to deny. */
  assertConfigurationAllowed(status: string): void;

  /** Find the plan of the VERIFIED offering. `null` means "no plan exists". */
  findExamPlanByCourseOfferingId(
    verifiedCourseOfferingId: string,
  ): Promise<ResolvedExamPlanForReorder | null>;

  /**
   * The SINGLE effect: read the plan's authoritative order, verify the expected
   * sequence and the exact set against it, and rewrite the positions — all of it
   * atomically, or none of it.
   *
   * Both lists arrive NORMALIZED and FROZEN. The plan id is the server-resolved
   * one; there is no parameter through which a caller value could reach it.
   */
  reorderDefinitionsAtomically(
    planId: string,
    orderedDefinitionIds: readonly string[],
    expectedOrderedDefinitionIds: readonly string[],
  ): Promise<ReorderExamDefinitionsAtomicOutcome>;

  /** Is this throw "the requested offering does not exist"? */
  isCourseNotFoundError(error: unknown): boolean;

  /** Is this throw "the offering's lifecycle forbids this operation"? */
  isOperationNotAllowedError(error: unknown): boolean;
}

// ===========================================================================
// The result model
// ===========================================================================

/** Which of the two submitted lists an input issue is about. */
export type ReorderExamDefinitionsIssueField =
  | "orderedDefinitionIds"
  | "expectedOrderedDefinitionIds";

/**
 * The ONE shape an input issue can take.
 *
 * A reorder submits no fields, only two lists, and there is exactly one way a
 * list can be malformed: it is not an array of non-blank strings. So there is
 * one code, and the issue names the LIST — never the offending value, never its
 * position, never its type. Echoing a rejected id back would put untrusted text
 * into a result that a UI will render.
 */
export type ReorderExamDefinitionsIssueCode = "not_an_id_list";

export interface ReorderExamDefinitionsIssue {
  readonly field: ReorderExamDefinitionsIssueField;
  readonly code: ReorderExamDefinitionsIssueCode;
}

/**
 * Every way a reorder can be refused WITHOUT a diagnostic. Each is fully
 * described by the code itself.
 *
 * There is deliberately no `unexpected`, `stale_write`, `duplicate_name`,
 * `definition_not_found`, `definition_in_use`, `archived` or
 * `published_plan_restriction` code: a reorder cannot produce any of them, and a
 * code nobody can reach is a code the next reader will misuse.
 */
export type ReorderExamDefinitionsRefusalCode =
  | "offering_not_found"
  | "operation_not_allowed"
  | "plan_not_found"
  | "reorder_conflict";

/**
 * A discriminated, JSON-safe, frozen result.
 *
 * Nothing in any arm is a Date, Map, Set, BigInt, Error or class instance, and
 * nothing carries a plan id, a course offering id, an actor id, a raw error, a
 * database detail, an `orderIndex` map or a submitted value that was rejected.
 *
 * `issues` lives ONLY on the `invalid_input` arm, as its own member of the
 * union, so no other arm carries the key at all — an absent key rather than an
 * `undefined` one, which keeps every result exactly JSON-round-trippable.
 */
export type ReorderExamDefinitionsResult =
  | {
      readonly ok: true;
      readonly changed: true;
      readonly orderedDefinitionIds: readonly string[];
      readonly updatedCount: number;
    }
  | {
      readonly ok: true;
      readonly changed: false;
      readonly orderedDefinitionIds: readonly string[];
      readonly updatedCount: 0;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
      readonly issues: readonly ReorderExamDefinitionsIssue[];
    }
  | {
      readonly ok: false;
      readonly code: ReorderExamDefinitionsRefusalCode;
    };

function refuse(code: ReorderExamDefinitionsRefusalCode): ReorderExamDefinitionsResult {
  return Object.freeze({ ok: false as const, code });
}

function refuseInput(
  issues: readonly ReorderExamDefinitionsIssue[],
): ReorderExamDefinitionsResult {
  return Object.freeze({
    ok: false as const,
    code: "invalid_input" as const,
    issues: Object.freeze(issues.map((issue) => Object.freeze({ ...issue }))),
  });
}

function succeedChanged(
  orderedDefinitionIds: readonly string[],
  updatedCount: number,
): ReorderExamDefinitionsResult {
  return Object.freeze({
    ok: true as const,
    changed: true as const,
    orderedDefinitionIds: freezeIds(orderedDefinitionIds),
    updatedCount,
  });
}

function succeedUnchanged(
  orderedDefinitionIds: readonly string[],
): ReorderExamDefinitionsResult {
  return Object.freeze({
    ok: true as const,
    changed: false as const,
    orderedDefinitionIds: freezeIds(orderedDefinitionIds),
    // A literal, not a count: "nothing changed" and "some rows changed but the
    // total happened to be zero" must never be the same value by accident.
    updatedCount: 0 as const,
  });
}

/** A frozen COPY, so a result can never alias an array the boundary still holds. */
function freezeIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...ids]);
}

// ===========================================================================
// What "the same order" and "the same set" mean — pure, and shared
// ===========================================================================

/**
 * Position-by-position sequence equality.
 *
 * Exported because the ATOMIC BINDING must ask exactly this question about the
 * rows it read, and a second implementation living next to Prisma would be a
 * second definition of the operation's central rule — one that no DB-free test
 * could reach. Proven here, bound there.
 */
export function isSameExamDefinitionIdSequence(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Is `submitted` an EXACT permutation of `current`?
 *
 * All four conditions, none of them implied by the others in the presence of
 * duplicates:
 *   - the same length;
 *   - no duplicate in the submitted list;
 *   - every submitted id is a current id (no unknown, no foreign, no extra);
 *   - every current id is a submitted id (nothing silently dropped).
 *
 * A foreign-plan id fails the third condition exactly as an invented one does,
 * and this function is given ONLY the current plan's ids — it cannot look
 * anywhere else, so it cannot distinguish the two even in principle.
 */
export function isExactExamDefinitionIdPermutation(
  submitted: readonly string[],
  current: readonly string[],
): boolean {
  if (submitted.length !== current.length) {
    return false;
  }

  const submittedIds = new Set(submitted);
  if (submittedIds.size !== submitted.length) {
    return false;
  }

  const currentIds = new Set(current);
  for (const id of submitted) {
    if (!currentIds.has(id)) {
      return false;
    }
  }
  for (const id of current) {
    if (!submittedIds.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * Is `candidate` the plan's current order, exactly?
 *
 * The stale-write comparison AND the no-op comparison are the same question, so
 * they are the same function: an exact permutation that is also in the same
 * positions. Written as the conjunction rather than as a bare sequence check so
 * "the expected list has no duplicates" is PROVEN rather than inferred from the
 * database happening to hold unique ids.
 */
export function isCurrentExamDefinitionIdOrder(
  candidate: readonly string[],
  current: readonly string[],
): boolean {
  return (
    isExactExamDefinitionIdPermutation(candidate, current) &&
    isSameExamDefinitionIdSequence(candidate, current)
  );
}

// ===========================================================================
// Input normalization
// ===========================================================================

/**
 * Turn one untrusted value into a list of ids, or report that it is not one.
 *
 * ACCEPTED: an array whose every entry is a string that is non-blank after
 * trimming. Surrounding whitespace is removed — a form and a JSON body both
 * produce it — and nothing else is touched: case is preserved exactly, because
 * these are opaque database identifiers, and no entry is coerced, because a
 * number, `null` or an object in an id list means the caller sent the wrong
 * thing, not a value to guess at.
 *
 * REJECTED: `null`, `undefined`, a string (which is iterable, and would
 * otherwise silently become a list of characters), a number, a plain object, a
 * Set, an array with any non-string entry, and an array with any blank entry.
 *
 * An EMPTY array is accepted: a plan with no definitions has exactly one valid
 * order, and submitting it is a legitimate no-op.
 *
 * Duplicates are NOT rejected here. The shape is valid; it is the ORDER that is
 * wrong, and only the authoritative current set can say so — which is why a
 * duplicate reaches the atomic check and comes back as `reorder_conflict`.
 *
 * The returned array is always a fresh one, so the caller's array is never read
 * again and never mutated — a frozen input is as acceptable as any other.
 */
function normalizeIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return null;
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      return null;
    }
    normalized.push(trimmed);
  }
  return normalized;
}

// ===========================================================================
// The orchestration
// ===========================================================================

/**
 * Reorder ALL of the ExamDefinitions of the plan of ONE authorized,
 * lifecycle-permitted course offering.
 *
 * The order is the safety contract, and it is enforced by construction. Each
 * `try` wraps EXACTLY ONE dependency call and asks EXACTLY ONE classifier;
 * nothing is caught broadly, and an unrecognized error is re-thrown with its
 * identity intact — including a `NEXT_REDIRECT`.
 *
 * Every dependency is called AT MOST ONCE, and each failure returns immediately,
 * so a refused reorder never reaches a later dependency.
 */
export async function reorderExamDefinitionsWithDeps(
  courseOfferingId: string,
  orderedDefinitionIds: unknown,
  expectedOrderedDefinitionIds: unknown,
  deps: ReorderExamDefinitionsDeps,
): Promise<ReorderExamDefinitionsResult> {
  // 1. Authorization + exact-offering verification FIRST — before either list is
  //    so much as looked at.
  let context: VerifiedExamDefinitionCourseContext;
  try {
    context = await deps.requireCourseContext(courseOfferingId);
  } catch (error) {
    if (deps.isCourseNotFoundError(error)) {
      return refuse("offering_not_found");
    }
    throw error;
  }

  // 2. The course-lifecycle gate, on the VERIFIED status. An ARCHIVED offering is
  //    refused without a single exam query.
  try {
    deps.assertConfigurationAllowed(context.status);
  } catch (error) {
    if (deps.isOperationNotAllowedError(error)) {
      return refuse("operation_not_allowed");
    }
    throw error;
  }

  // 3. The plan of the VERIFIED offering. The requested, unverified offering id
  //    is never read again from here on.
  const plan = await deps.findExamPlanByCourseOfferingId(context.courseOfferingId);

  // 4. No plan means there is nothing to reorder — and no plan is created here.
  if (!plan) {
    return refuse("plan_not_found");
  }

  // 5. Only now are the two untrusted lists normalized.
  const submitted = normalizeIdList(orderedDefinitionIds);
  const expected = normalizeIdList(expectedOrderedDefinitionIds);

  // 6. A malformed LIST is a shape problem, and is reported per list. Neither the
  //    rejected value nor its position is carried out.
  if (submitted === null || expected === null) {
    const issues: ReorderExamDefinitionsIssue[] = [];
    if (submitted === null) {
      issues.push({ field: "orderedDefinitionIds", code: "not_an_id_list" });
    }
    if (expected === null) {
      issues.push({ field: "expectedOrderedDefinitionIds", code: "not_an_id_list" });
    }
    return refuseInput(issues);
  }

  // 7. The single effect. The SERVER-resolved plan id, and two frozen lists, so
  //    the binding receives values it cannot mutate.
  const outcome = await deps.reorderDefinitionsAtomically(
    plan.id,
    Object.freeze(submitted),
    Object.freeze(expected),
  );

  // 8. The three outcomes. A conflict is a refusal with nothing written; the
  //    other two are successes that differ only in whether anything moved.
  if (outcome.status === "conflict") {
    return refuse("reorder_conflict");
  }
  if (outcome.status === "unchanged") {
    return succeedUnchanged(outcome.orderedDefinitionIds);
  }
  return succeedChanged(outcome.orderedDefinitionIds, outcome.updatedCount);
}
