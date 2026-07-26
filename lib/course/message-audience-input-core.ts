/**
 * MSG1A - the input / normalization / validation / preview core for
 * course-scoped message & task audiences.
 *
 * DEPENDENCY-INJECTED, NO DIRECT IO: the pure functions
 * (normalizeMessageAudienceSegments, resolveMessageAudiencePreview) take
 * already-loaded authoritative facts and return plain data - no Prisma, no clock,
 * no randomness, no env, no logging, no "use server". The async orchestrators
 * (*WithDeps) receive their loaders via injection and NEVER swallow an
 * infrastructure error. Same split-of-concerns as instructor-messages-auth.ts, so
 * the whole contract is unit-testable without a database.
 *
 * TWO LAYERS, DELIBERATELY DISTINCT
 * ---------------------------------
 *  (a) AUDIENCE-SEGMENT NORMALIZATION - normalizeMessageAudienceSegments. The
 *      canonical, OFFERING-SCOPED audience segments the manager selected. Dedup
 *      key is offering-scoped for every kind:
 *        COURSE  -> `COURSE|offeringId`
 *        GROUP   -> `GROUP|offeringId|groupId`
 *        TRAINEE -> `TRAINEE|offeringId|studentId`
 *      So a DUAL trainee explicitly selected under two offerings yields TWO
 *      distinct TRAINEE segments (offering context preserved). Only an EXACT
 *      duplicate (same key) is rejected. Every label is SERVER-DERIVED from the
 *      authoritative facts - never taken from client input.
 *
 *  (b) RECIPIENT-ID DEDUPLICATION - resolveMessageAudiencePreview. Each
 *      normalized segment is expanded to student ids through the committed pure
 *      resolver (resolveScopedMessageRecipients) and UNIONED into a Set keyed on
 *      studentId. So the same dual trainee, reached through two TRAINEE segments
 *      (or COURSE+TRAINEE, etc.), collapses to EXACTLY ONE recipient. Recipient
 *      uniqueness lives here, not in the segment layer - mirroring the database,
 *      where MessageTaskRecipient is unique by (messageTaskId, studentId) while
 *      the audience segments are offering-scoped.
 *
 * UNWIRED FOR WRITES: this core only reads facts and computes a preview. It never
 * writes a MessageTaskAudience or MessageTaskRecipient row and never sends a push.
 */
import type { EnrollmentRosterResult } from "./enrollment-view";
import {
  resolveScopedMessageRecipients,
  type EffectiveGroupMembershipEntry,
} from "./message-recipient-scope-core";

// ---------------------------------------------------------------------------
// Segment input (client -> server). NOTE: no labelSnapshot field - labels are
// always server-derived from the authoritative facts, never client-supplied.
// ---------------------------------------------------------------------------

export type MessageAudienceSegmentInput =
  | { readonly kind: "COURSE"; readonly courseOfferingId: string }
  | { readonly kind: "GROUP"; readonly courseOfferingId: string; readonly courseGroupId: string }
  | { readonly kind: "TRAINEE"; readonly courseOfferingId: string; readonly studentId: string };

/** A normalized segment with its SERVER-DERIVED, trimmed-non-empty label. */
export interface ResolvedAudienceSegment {
  readonly kind: "COURSE" | "GROUP" | "TRAINEE";
  readonly courseOfferingId: string;
  readonly courseGroupId?: string;
  readonly studentId?: string;
  readonly labelSnapshot: string;
}

// ---------------------------------------------------------------------------
// Authoritative facts (server-loaded). Only ACTIVE + MESSAGES-ENABLED offerings
// appear in `offeringsById`; ABSENCE means the offering is not eligible.
// ---------------------------------------------------------------------------

export interface CoreOfferingFacts {
  readonly courseOfferingId: string;
  /** Source of the COURSE segment's labelSnapshot. */
  readonly offeringName: string;
  /** ACTIVE enrollment roster (rows carry the studentId + fullName). */
  readonly roster: EnrollmentRosterResult;
  /** One entry per current-membership roster trainee, in STABLE group ids. */
  readonly effectiveGroupMemberships: readonly EffectiveGroupMembershipEntry[];
  /** Stable group id -> display label. KEY SET = the groups that belong here. */
  readonly groupLabelsById: ReadonlyMap<string, string>;
  /** True if the offering's group hierarchy has structural anomalies. */
  readonly groupTreeHasAnomalies: boolean;
}

export interface MessageAudienceFacts {
  readonly offeringsById: ReadonlyMap<string, CoreOfferingFacts>;
}

// ---------------------------------------------------------------------------
// Option view-model (server -> future composer). MSG1A only shapes it; no UI.
// ---------------------------------------------------------------------------

export interface MessageAudienceGroupOption {
  readonly courseGroupId: string;
  readonly label: string;
  readonly parentGroupId: string | null;
  readonly isSubgroup: boolean;
}
export interface MessageAudienceTraineeOption {
  readonly studentId: string;
  readonly fullName: string;
}
export interface MessageAudienceOfferingOption {
  readonly courseOfferingId: string;
  readonly offeringName: string;
  readonly level: number;
  readonly groups: readonly MessageAudienceGroupOption[];
  readonly trainees: readonly MessageAudienceTraineeOption[];
  /** Roster or group anomalies -> the composer must block this offering. */
  readonly hasAnomalies: boolean;
}
export interface MessageAudienceOptions {
  readonly offerings: readonly MessageAudienceOfferingOption[];
}

// ---------------------------------------------------------------------------
// Refusals - safe, PII-free codes + counts only.
// ---------------------------------------------------------------------------

export const MESSAGE_AUDIENCE_REFUSAL_CODES = Object.freeze([
  "NOT_AUTHORIZED",
  "NO_SEGMENTS",
  "MALFORMED_SEGMENT",
  "OFFERING_NOT_ELIGIBLE",
  "GROUP_NOT_IN_OFFERING",
  "TRAINEE_NOT_IN_OFFERING",
  "DUPLICATE_SEGMENT",
  "EMPTY_LABEL",
  "ROSTER_HAS_ANOMALIES",
  "GROUP_HAS_ANOMALIES",
  "RECIPIENT_RESOLUTION_FAILED",
  "NO_ELIGIBLE_RECIPIENTS",
] as const);

export type MessageAudienceRefusalCode = (typeof MESSAGE_AUDIENCE_REFUSAL_CODES)[number];

export interface MessageAudienceRefusal {
  readonly ok: false;
  readonly code: MessageAudienceRefusalCode;
  readonly segmentCount?: number;
}

export type NormalizeAudienceResult =
  | { readonly ok: true; readonly segments: ResolvedAudienceSegment[] }
  | MessageAudienceRefusal;

export interface MessageAudiencePreviewSuccess {
  readonly ok: true;
  readonly recipientIds: string[];
  readonly recipientCount: number;
  readonly segments: ResolvedAudienceSegment[];
}

export type MessageAudiencePreviewResult = MessageAudiencePreviewSuccess | MessageAudienceRefusal;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function refuse(code: MessageAudienceRefusalCode, segmentCount?: number): MessageAudienceRefusal {
  return segmentCount === undefined ? { ok: false, code } : { ok: false, code, segmentCount };
}

/** Per-offering roster lookup (student id set + id->fullName), built once. */
interface OfferingRosterLookup {
  readonly ids: ReadonlySet<string>;
  readonly names: ReadonlyMap<string, string>;
}

function buildRosterLookup(facts: CoreOfferingFacts): OfferingRosterLookup {
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const row of facts.roster.rows) {
    if (!isNonBlankString(row.id)) continue;
    ids.add(row.id);
    if (!names.has(row.id)) names.set(row.id, row.fullName);
  }
  return { ids, names };
}

// ---------------------------------------------------------------------------
// LAYER (a): audience-segment normalization
// ---------------------------------------------------------------------------

/**
 * Normalize + validate the requested segments against the authoritative facts.
 * Offering context is preserved on every kind; only EXACT duplicates are
 * rejected; roster/group anomalies fail closed; labels are server-derived.
 */
export function normalizeMessageAudienceSegments(
  rawSegments: readonly unknown[] | null | undefined,
  facts: MessageAudienceFacts,
): NormalizeAudienceResult {
  if (!Array.isArray(rawSegments) || rawSegments.length === 0) {
    return refuse("NO_SEGMENTS");
  }

  const resolved: ResolvedAudienceSegment[] = [];
  const seenKeys = new Set<string>();
  const rosterLookupByOffering = new Map<string, OfferingRosterLookup>();
  const anomalyCheckedOfferings = new Set<string>();

  for (const raw of rawSegments) {
    if (raw === null || typeof raw !== "object") return refuse("MALFORMED_SEGMENT");
    const seg = raw as { kind?: unknown; courseOfferingId?: unknown; courseGroupId?: unknown; studentId?: unknown };

    const offeringId = seg.courseOfferingId;
    if (!isNonBlankString(offeringId)) return refuse("MALFORMED_SEGMENT");

    const offering = facts.offeringsById.get(offeringId);
    if (offering === undefined) return refuse("OFFERING_NOT_ELIGIBLE");

    // Roster anomalies fail closed for ANY kind referencing this offering.
    if (!anomalyCheckedOfferings.has(offeringId)) {
      anomalyCheckedOfferings.add(offeringId);
      if (offering.roster.anomalies.length > 0) return refuse("ROSTER_HAS_ANOMALIES");
    }

    if (seg.kind === "COURSE") {
      const label = offering.offeringName.trim();
      if (label.length === 0) return refuse("EMPTY_LABEL");
      const key = `COURSE|${offeringId}`;
      if (seenKeys.has(key)) return refuse("DUPLICATE_SEGMENT");
      seenKeys.add(key);
      resolved.push({ kind: "COURSE", courseOfferingId: offeringId, labelSnapshot: label });
    } else if (seg.kind === "GROUP") {
      const groupId = seg.courseGroupId;
      if (!isNonBlankString(groupId)) return refuse("MALFORMED_SEGMENT");
      if (offering.groupTreeHasAnomalies) return refuse("GROUP_HAS_ANOMALIES");
      const rawLabel = offering.groupLabelsById.get(groupId);
      if (rawLabel === undefined) return refuse("GROUP_NOT_IN_OFFERING");
      const label = rawLabel.trim();
      if (label.length === 0) return refuse("EMPTY_LABEL");
      const key = `GROUP|${offeringId}|${groupId}`;
      if (seenKeys.has(key)) return refuse("DUPLICATE_SEGMENT");
      seenKeys.add(key);
      resolved.push({ kind: "GROUP", courseOfferingId: offeringId, courseGroupId: groupId, labelSnapshot: label });
    } else if (seg.kind === "TRAINEE") {
      const studentId = seg.studentId;
      if (!isNonBlankString(studentId)) return refuse("MALFORMED_SEGMENT");
      let lookup = rosterLookupByOffering.get(offeringId);
      if (lookup === undefined) {
        lookup = buildRosterLookup(offering);
        rosterLookupByOffering.set(offeringId, lookup);
      }
      if (!lookup.ids.has(studentId)) return refuse("TRAINEE_NOT_IN_OFFERING");
      const label = (lookup.names.get(studentId) ?? "").trim();
      if (label.length === 0) return refuse("EMPTY_LABEL");
      // Offering-scoped key: the SAME student under a DIFFERENT offering is a
      // DIFFERENT segment (offering context preserved), not a duplicate.
      const key = `TRAINEE|${offeringId}|${studentId}`;
      if (seenKeys.has(key)) return refuse("DUPLICATE_SEGMENT");
      seenKeys.add(key);
      resolved.push({ kind: "TRAINEE", courseOfferingId: offeringId, studentId, labelSnapshot: label });
    } else {
      return refuse("MALFORMED_SEGMENT");
    }
  }

  return { ok: true, segments: resolved };
}

// ---------------------------------------------------------------------------
// LAYER (b): recipient-id deduplication -> preview
// ---------------------------------------------------------------------------

/**
 * Expand ONE normalized segment to recipient student ids through the committed
 * pure resolver. An empty group / empty roster contributes nothing (not fatal);
 * any OTHER resolver refusal is fail-closed as RECIPIENT_RESOLUTION_FAILED (it
 * would indicate a facts/validation mismatch, never a normal empty selection).
 */
function expandSegment(
  segment: ResolvedAudienceSegment,
  offering: CoreOfferingFacts,
): { ok: true; ids: readonly string[] } | { ok: false } {
  let result;
  if (segment.kind === "COURSE") {
    result = resolveScopedMessageRecipients({ roster: offering.roster, audience: "ALL" });
  } else if (segment.kind === "GROUP") {
    result = resolveScopedMessageRecipients({
      roster: offering.roster,
      audience: "GROUP",
      requestedGroupId: segment.courseGroupId,
      effectiveGroupMemberships: offering.effectiveGroupMemberships,
    });
  } else {
    result = resolveScopedMessageRecipients({
      roster: offering.roster,
      audience: "SPECIFIC",
      requestedStudentIds: segment.studentId ? [segment.studentId] : [],
    });
  }

  if (result.ok) return { ok: true, ids: result.recipientIds };
  // Normal "this selection is currently empty" outcomes contribute zero.
  if (
    result.reason === "ROSTER_EMPTY" ||
    result.reason === "GROUP_HAS_NO_ELIGIBLE_TRAINEES" ||
    result.reason === "NO_ELIGIBLE_RECIPIENTS"
  ) {
    return { ok: true, ids: [] };
  }
  // Anything else (anomalies, membership-data problems, outside-roster) is a
  // fail-closed integrity error, never silently treated as empty.
  return { ok: false };
}

/**
 * The recipient PREVIEW: normalize, then union every segment's expansion into a
 * Set keyed on studentId. A dual trainee reached through several segments is
 * counted exactly ONCE. Returns the distinct recipient ids (first-seen order),
 * the count, and the normalized segments (with server-derived labels).
 */
export function resolveMessageAudiencePreview(
  rawSegments: readonly unknown[] | null | undefined,
  facts: MessageAudienceFacts,
): MessageAudiencePreviewResult {
  const normalized = normalizeMessageAudienceSegments(rawSegments, facts);
  if (!normalized.ok) return normalized;

  const recipientIdSet = new Set<string>();
  for (const segment of normalized.segments) {
    // Present by construction: normalization already proved the offering exists.
    const offering = facts.offeringsById.get(segment.courseOfferingId)!;
    const expansion = expandSegment(segment, offering);
    if (!expansion.ok) {
      return refuse("RECIPIENT_RESOLUTION_FAILED", normalized.segments.length);
    }
    for (const id of expansion.ids) recipientIdSet.add(id);
  }

  if (recipientIdSet.size === 0) {
    return refuse("NO_ELIGIBLE_RECIPIENTS", normalized.segments.length);
  }

  const recipientIds = [...recipientIdSet];
  return {
    ok: true,
    recipientIds,
    recipientCount: recipientIds.length,
    segments: normalized.segments,
  };
}

// ---------------------------------------------------------------------------
// Async DI orchestration - loaders are INJECTED, infra errors PROPAGATE.
// ---------------------------------------------------------------------------

/** Collect the distinct offering ids referenced by the requested segments. */
export function extractReferencedOfferingIds(rawSegments: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(rawSegments)) return [];
  const ids = new Set<string>();
  for (const raw of rawSegments) {
    if (raw === null || typeof raw !== "object") continue;
    const offeringId = (raw as { courseOfferingId?: unknown }).courseOfferingId;
    if (isNonBlankString(offeringId)) ids.add(offeringId);
  }
  return [...ids];
}

export interface PreviewMessageAudienceDeps {
  /** Loads facts for ONLY the eligible (ACTIVE + MESSAGES-ENABLED) offerings. */
  loadFacts: (offeringIds: readonly string[]) => Promise<MessageAudienceFacts>;
}

/**
 * Orchestrate a preview: load facts for the referenced offerings, then run the
 * pure preview. A loader failure PROPAGATES unchanged - it is never converted
 * into a refusal (an infrastructure error must never look like an empty audience).
 */
export async function previewMessageAudienceWithDeps(
  deps: PreviewMessageAudienceDeps,
  rawSegments: readonly unknown[] | null | undefined,
): Promise<MessageAudiencePreviewResult> {
  const offeringIds = extractReferencedOfferingIds(rawSegments);
  const facts = await deps.loadFacts(offeringIds);
  return resolveMessageAudiencePreview(rawSegments, facts);
}
