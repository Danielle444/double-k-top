/**
 * SECURITY / LEVEL 2 SLICE L2-FANOUT-1A - the PURE core that decides WHO a
 * message or task is sent to.
 *
 * PURE by construction: no database client, no request headers, no session, no
 * capability read, no clock, no randomness, no environment access, no logging,
 * no React, and no server-action directive. Every decision is made from the
 * arguments handed to it, so the whole fan-out contract is unit-testable without
 * a database (see message-recipient-scope-core.test.ts).
 *
 * WHY THIS EXISTS
 * ---------------
 * The committed fan-out resolves recipients from a GLOBAL active-trainee query
 * and, for the GROUP audience, from the course-agnostic compatibility mirror on
 * the trainee row. Both are course-blind: a Level 1 send materializes recipient
 * rows - and a push - for Level 2 trainees. This core replaces that decision with
 * one whose ONLY source of trainee eligibility is an already-loaded,
 * offering-scoped enrollment roster.
 *
 * HARD RULES BAKED IN HERE
 * ------------------------
 *  - THE SUPPLIED ROSTER IS THE SOLE AUTHORITY on who may receive anything. A
 *    trainee absent from it can never be selected, by any audience, by any route.
 *  - There is deliberately NO parameter through which a caller could supply a
 *    course offering id, an offering name, a level number, a date, an activity
 *    year, a capability map, or a free-text group label. Course scope is a
 *    property of the roster the caller already resolved server-side, never an
 *    argument this core interprets.
 *  - GROUP is matched by STABLE GROUP ID ONLY (the exact group, or its immediate
 *    parent for a subgroup membership). Display labels are never compared, so two
 *    offerings that both name a group "א" can never bleed into one another.
 *  - ANY roster anomaly refuses the ENTIRE send. A trainee is never silently
 *    dropped because their membership could not be resolved, and there is never a
 *    fallback to the global trainee table.
 *  - SPECIFIC never silently intersects: one requested id outside the roster
 *    refuses the whole request, so a partial send can never be mistaken for a
 *    complete one.
 *  - Every refusal carries a typed code plus safe counts only - never a name, a
 *    phone number, an identity number, or any other personal detail.
 *  - Output is deterministic for identical input: recipients are always emitted
 *    in roster order, never in the order a client happened to list them.
 *
 * NOT THIS MODULE'S JOB (deliberately): authenticating the sender, authorizing an
 * offering, reading capabilities, loading the roster, writing rows, and sending
 * push. Those belong to the later wiring slices.
 *
 * UNWIRED IN THIS SLICE: nothing in the repository imports this module.
 */
import type {
  EnrollmentRosterResult,
  EnrollmentMembershipAnomalyKind,
} from "./enrollment-view";

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/**
 * The three send audiences, mirroring the persisted MessageAudience values. The
 * type is DERIVED from this frozen tuple so there is no second union to drift.
 */
export const MESSAGE_RECIPIENT_AUDIENCES = Object.freeze(["ALL", "GROUP", "SPECIFIC"] as const);

/** Derived audience type - the only audience union this core accepts. */
export type MessageRecipientAudience = (typeof MESSAGE_RECIPIENT_AUDIENCES)[number];

/** Pure membership test; narrows an arbitrary string to `MessageRecipientAudience`. */
export function isMessageRecipientAudience(value: string): value is MessageRecipientAudience {
  return (MESSAGE_RECIPIENT_AUDIENCES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/**
 * One trainee's EFFECTIVE group membership, expressed in STABLE IDS.
 *
 * This is supplied ALONGSIDE the roster because the committed roster projection
 * (EnrolledTraineeView) carries only the resolved display label and subgroup
 * number - it has no group id, and widening it is a production change that
 * belongs to the wiring slice, not to this pure core.
 *
 * It is REQUIRED ONLY FOR THE GROUP AUDIENCE, which is the only audience that
 * asks a question about groups. ALL and SPECIFIC are answered from the roster
 * alone and must never be blocked - nor have their wiring widened - by group
 * metadata they do not consult. When GROUP does use it, the two inputs are
 * CROSS-CHECKED against each other in both directions (see the integrity
 * refusals below), so they can never disagree silently: the caller must supply
 * exactly one entry per roster trainee and nothing else.
 *
 *  - `courseGroupId` is the group the membership actually targets: a top-level
 *    group, or a subgroup.
 *  - `parentGroupId` is that group's immediate parent (null for a top-level
 *    group). It exists so that selecting a top-level group also reaches the
 *    trainees whose effective membership is one of its subgroups - which is what
 *    the pre-existing label-based behaviour did, and what the Level 1 regression
 *    fixture pins.
 */
export interface EffectiveGroupMembershipEntry {
  readonly studentId: string;
  readonly courseGroupId: string;
  readonly parentGroupId: string | null;
}

/**
 * Everything the decision needs.
 *
 * `roster` is an ALREADY-LOADED, offering-scoped enrollment roster - the caller
 * resolved the offering server-side and read the roster from the enrollment
 * spine. This core does not know, and cannot ask, which offering it belongs to.
 *
 * `requestedGroupId` and `requestedStudentIds` are REQUESTS, never grants: they
 * are only ever tested against the roster, never used to widen it.
 *
 * `effectiveGroupMemberships` is OPTIONAL at the type level and required only at
 * runtime, and only for the GROUP audience.
 */
export interface MessageRecipientScopeInput {
  readonly roster: EnrollmentRosterResult;
  readonly audience: MessageRecipientAudience;
  readonly effectiveGroupMemberships?: readonly EffectiveGroupMembershipEntry[] | null;
  readonly requestedGroupId?: string | null;
  readonly requestedStudentIds?: readonly string[] | null;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * The complete set of refusal codes. Every one of them means "send NOTHING" -
 * there is no partial-success outcome in this core.
 *
 *  - ROSTER_HAS_ANOMALIES          the roster surfaced at least one membership
 *                                  anomaly; a trainee whose membership could not
 *                                  be resolved must never be silently dropped.
 *  - ROSTER_ROW_MISSING_TRAINEE_ID a roster row carried a blank trainee id.
 *  - ROSTER_EMPTY                  the roster contains no trainee at all.
 *  - GROUP_MEMBERSHIP_DATA_MISSING GROUP was requested without any membership
 *                                  data at all.
 *  - GROUP_MEMBERSHIP_MISSING      a roster trainee has no supplied membership.
 *  - GROUP_MEMBERSHIP_OUTSIDE_ROSTER a supplied membership names a trainee who is
 *                                  not in the roster.
 *  - GROUP_MEMBERSHIP_CONFLICT     one trainee was supplied two different
 *                                  effective memberships.
 *  - GROUP_MEMBERSHIP_MALFORMED    a supplied membership carried a blank id.
 *  - GROUP_ID_MISSING              GROUP was requested without a group id.
 *  - GROUP_HAS_NO_ELIGIBLE_TRAINEES the requested group matches no roster trainee.
 *  - SPECIFIC_IDS_MISSING          SPECIFIC was requested with no ids.
 *  - SPECIFIC_ID_MALFORMED         a requested id was blank or not a string.
 *  - SPECIFIC_IDS_OUTSIDE_ROSTER   at least one requested id is not in the roster.
 *  - NO_ELIGIBLE_RECIPIENTS        the resolved set came out empty.
 *  - UNKNOWN_AUDIENCE              the audience was not one of the three.
 */
export const MESSAGE_RECIPIENT_REFUSAL_CODES = Object.freeze([
  "ROSTER_HAS_ANOMALIES",
  "ROSTER_ROW_MISSING_TRAINEE_ID",
  "ROSTER_EMPTY",
  "GROUP_MEMBERSHIP_DATA_MISSING",
  "GROUP_MEMBERSHIP_MISSING",
  "GROUP_MEMBERSHIP_OUTSIDE_ROSTER",
  "GROUP_MEMBERSHIP_CONFLICT",
  "GROUP_MEMBERSHIP_MALFORMED",
  "GROUP_ID_MISSING",
  "GROUP_HAS_NO_ELIGIBLE_TRAINEES",
  "SPECIFIC_IDS_MISSING",
  "SPECIFIC_ID_MALFORMED",
  "SPECIFIC_IDS_OUTSIDE_ROSTER",
  "NO_ELIGIBLE_RECIPIENTS",
  "UNKNOWN_AUDIENCE",
] as const);

/** Derived refusal-code type - the only refusal union this core produces. */
export type MessageRecipientRefusalCode = (typeof MESSAGE_RECIPIENT_REFUSAL_CODES)[number];

/**
 * A refusal. Carries the code plus SAFE COUNTS ONLY.
 *
 * `anomalyKinds` is the deduplicated, sorted set of anomaly classifications - a
 * closed set of code-owned constants, never free text and never derived from a
 * person. No trainee id, enrollment id, name, phone or identity number is ever
 * placed on a refusal, so a refusal can be logged or surfaced without leaking who
 * is (or is not) in a course.
 */
export interface MessageRecipientRefusal {
  readonly ok: false;
  readonly reason: MessageRecipientRefusalCode;
  readonly rosterCount: number;
  readonly anomalyCount: number;
  readonly anomalyKinds?: readonly EnrollmentMembershipAnomalyKind[];
  readonly requestedCount?: number;
  readonly outsideRosterCount?: number;
}

/** A successful resolution: the exact ids to materialize recipients for. */
export interface MessageRecipientSelection {
  readonly ok: true;
  readonly recipientIds: string[];
}

/** The discriminated outcome of a recipient resolution. */
export type MessageRecipientScopeResult = MessageRecipientSelection | MessageRecipientRefusal;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** A non-blank string, checked defensively rather than assumed from the type. */
function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Deduplicated, sorted anomaly kinds - a closed, code-owned, PII-free set. */
function summarizeAnomalyKinds(
  roster: EnrollmentRosterResult,
): readonly EnrollmentMembershipAnomalyKind[] {
  return [...new Set(roster.anomalies.map((anomaly) => anomaly.kind))].sort();
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/**
 * Resolve the recipient ids for one send, from the supplied roster alone.
 *
 * The order of the checks is a HARD CONTRACT, fail-closed at every step:
 *   1. anomalies      - an unresolved membership refuses the whole send, for
 *                       EVERY audience, before any audience is even considered;
 *   2. roster ids     - collected in roster order and deduplicated, so a trainee
 *                       represented more than once is still one recipient;
 *   3. emptiness      - an empty roster refuses;
 *   4. audience       - ALL / GROUP / SPECIFIC, each fail-closed. ALL and
 *                       SPECIFIC are answered from the roster ALONE. Only GROUP
 *                       consults the supplied memberships, and only there are
 *                       they required and cross-checked against the roster
 *                       (none missing, none extra, none conflicting, none
 *                       blank) - so group metadata can never block, or widen the
 *                       wiring of, a send that asks no group question;
 *   5. final guard    - an empty resolved set refuses.
 *
 * Recipients are always returned in ROSTER ORDER, never in the order the caller
 * listed them, so identical input always produces byte-identical output.
 */
export function resolveScopedMessageRecipients(
  input: MessageRecipientScopeInput,
): MessageRecipientScopeResult {
  const roster = input.roster;
  const anomalyCount = roster.anomalies.length;

  // 1. Any anomaly refuses everything. Never drop the affected trainee and
  //    continue - an unresolved membership means the roster is not trustworthy.
  if (anomalyCount > 0) {
    return {
      ok: false,
      reason: "ROSTER_HAS_ANOMALIES",
      rosterCount: roster.rows.length,
      anomalyCount,
      anomalyKinds: summarizeAnomalyKinds(roster),
    };
  }

  // 2. Roster ids, in roster order, deduplicated. A trainee appearing more than
  //    once (a duplicated row, or a person surfaced twice) is ONE recipient.
  const rosterIds: string[] = [];
  const rosterIdSet = new Set<string>();
  for (const row of roster.rows) {
    if (!isNonBlankString(row.id)) {
      return {
        ok: false,
        reason: "ROSTER_ROW_MISSING_TRAINEE_ID",
        rosterCount: roster.rows.length,
        anomalyCount,
      };
    }
    if (rosterIdSet.has(row.id)) continue;
    rosterIdSet.add(row.id);
    rosterIds.push(row.id);
  }

  const rosterCount = rosterIds.length;

  // 3. An empty roster is never "send to nobody" - it refuses.
  if (rosterCount === 0) {
    return { ok: false, reason: "ROSTER_EMPTY", rosterCount, anomalyCount };
  }

  // 4. Audience resolution.
  let recipientIds: string[];

  if (input.audience === "ALL") {
    // Answered from the roster ALONE - nothing wider exists to reach for, and no
    // group metadata is consulted or required.
    recipientIds = [...rosterIds];
  } else if (input.audience === "GROUP") {
    const requestedGroupId = input.requestedGroupId;
    if (!isNonBlankString(requestedGroupId)) {
      return { ok: false, reason: "GROUP_ID_MISSING", rosterCount, anomalyCount };
    }

    // GROUP is the ONLY audience that asks a group question, so this is the only
    // place membership data is required.
    const suppliedMemberships = input.effectiveGroupMemberships;
    if (!Array.isArray(suppliedMemberships)) {
      return { ok: false, reason: "GROUP_MEMBERSHIP_DATA_MISSING", rosterCount, anomalyCount };
    }

    // Cross-check the supplied memberships against the roster in BOTH
    // directions, so the two inputs can never disagree silently.
    const membershipByStudentId = new Map<string, EffectiveGroupMembershipEntry>();
    for (const entry of suppliedMemberships) {
      if (!isNonBlankString(entry.studentId) || !isNonBlankString(entry.courseGroupId)) {
        return { ok: false, reason: "GROUP_MEMBERSHIP_MALFORMED", rosterCount, anomalyCount };
      }
      if (!rosterIdSet.has(entry.studentId)) {
        return {
          ok: false,
          reason: "GROUP_MEMBERSHIP_OUTSIDE_ROSTER",
          rosterCount,
          anomalyCount,
        };
      }
      const existing = membershipByStudentId.get(entry.studentId);
      if (existing) {
        // An identical repeat is harmless (a duplicated roster row carries a
        // duplicated membership); two DIFFERENT effective groups for one trainee
        // is an unresolvable contradiction and refuses.
        if (
          existing.courseGroupId !== entry.courseGroupId ||
          (existing.parentGroupId ?? null) !== (entry.parentGroupId ?? null)
        ) {
          return { ok: false, reason: "GROUP_MEMBERSHIP_CONFLICT", rosterCount, anomalyCount };
        }
        continue;
      }
      membershipByStudentId.set(entry.studentId, entry);
    }
    for (const id of rosterIds) {
      if (!membershipByStudentId.has(id)) {
        return { ok: false, reason: "GROUP_MEMBERSHIP_MISSING", rosterCount, anomalyCount };
      }
    }

    // STABLE ID matching only: the exact group, or the immediate parent of a
    // subgroup membership. No label, no name, no subgroup number is compared.
    recipientIds = rosterIds.filter((id) => {
      const membership = membershipByStudentId.get(id);
      if (!membership) return false;
      return (
        membership.courseGroupId === requestedGroupId ||
        membership.parentGroupId === requestedGroupId
      );
    });
    if (recipientIds.length === 0) {
      return {
        ok: false,
        reason: "GROUP_HAS_NO_ELIGIBLE_TRAINEES",
        rosterCount,
        anomalyCount,
      };
    }
  } else if (input.audience === "SPECIFIC") {
    // Answered from the roster ALONE - the requested ids are tested against it
    // and nothing else. No group metadata is consulted or required.
    const requested = input.requestedStudentIds;
    if (!Array.isArray(requested) || requested.length === 0) {
      return { ok: false, reason: "SPECIFIC_IDS_MISSING", rosterCount, anomalyCount };
    }
    const requestedSet = new Set<string>();
    for (const id of requested) {
      if (!isNonBlankString(id)) {
        return { ok: false, reason: "SPECIFIC_ID_MALFORMED", rosterCount, anomalyCount };
      }
      requestedSet.add(id);
    }
    // ALL-OR-NOTHING: one id outside the roster refuses the whole request. The
    // request is never quietly narrowed to the part that happens to be allowed.
    let outsideRosterCount = 0;
    for (const id of requestedSet) {
      if (!rosterIdSet.has(id)) outsideRosterCount += 1;
    }
    if (outsideRosterCount > 0) {
      return {
        ok: false,
        reason: "SPECIFIC_IDS_OUTSIDE_ROSTER",
        rosterCount,
        anomalyCount,
        requestedCount: requestedSet.size,
        outsideRosterCount,
      };
    }
    // Emitted in ROSTER order, not in the caller's order.
    recipientIds = rosterIds.filter((id) => requestedSet.has(id));
  } else {
    return { ok: false, reason: "UNKNOWN_AUDIENCE", rosterCount, anomalyCount };
  }

  // 5. Defensive final guard - no audience may resolve to an empty send.
  if (recipientIds.length === 0) {
    return { ok: false, reason: "NO_ELIGIBLE_RECIPIENTS", rosterCount, anomalyCount };
  }

  return { ok: true, recipientIds };
}
