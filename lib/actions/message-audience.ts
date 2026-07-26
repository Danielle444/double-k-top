"use server";

/**
 * MSG1A - READ-ONLY server actions for course-scoped message/task audience
 * selection and recipient preview.
 *
 * STRICTLY READ-ONLY: every export here only READS (offerings, capabilities,
 * group trees, enrollment rosters) and computes a pure preview. Nothing writes a
 * MessageTaskAudience or MessageTaskRecipient row, and nothing sends a push or a
 * notification. The legacy send path (lib/actions/messages.ts) is untouched by
 * this slice.
 *
 * OFFERING ELIGIBILITY (data-driven, never hardcoded): an offering is offered to
 * the composer ONLY when it is status ACTIVE AND its effective MESSAGES capability
 * is ENABLED. Level 2 has MESSAGES disabled today, so it is absent automatically;
 * it will appear the moment its capability is enabled, with no code change.
 *
 * GATING: admin entrypoints require an authenticated admin (requireAdmin);
 * instructor entrypoints require a server-derived instructor actor holding
 * canSendMessages (identity never comes from the client-supplied instructorId,
 * which is accepted for compatibility and discarded). Instructors remain a GLOBAL
 * pool in phase 1 - every eligible offering is offered to every sending
 * instructor; per-instructor course scoping is deferred (MSG5).
 */
import { requireAdmin } from "@/lib/auth/require-admin";
import { getCurrentInstructor } from "@/lib/auth/actor";
import { getCourseOfferingById } from "@/lib/course/offering-by-id";
import { getEffectiveCapabilities } from "@/lib/course/capabilities/offering-capabilities";
import { getCourseGroupTreeByOfferingId } from "@/lib/course/course-group-tree";
import { getOfferingAudienceFacts } from "@/lib/course/offering-audience-facts";
import { listSelectableCourseOfferingsForAdmin } from "@/lib/course/offering-by-id";
import {
  previewMessageAudienceWithDeps,
  type CoreOfferingFacts,
  type MessageAudienceFacts,
  type MessageAudienceGroupOption,
  type MessageAudienceOfferingOption,
  type MessageAudienceOptions,
  type MessageAudiencePreviewResult,
  type MessageAudienceSegmentInput,
  type MessageAudienceTraineeOption,
} from "@/lib/course/message-audience-input-core";

// ---------------------------------------------------------------------------
// Shared per-offering loading (non-exported helpers - NOT server actions).
// ---------------------------------------------------------------------------

/** Everything one eligible offering contributes to both options and preview. */
interface OfferingBundle {
  core: CoreOfferingFacts;
  level: number;
  groupOptions: MessageAudienceGroupOption[];
  traineeOptions: MessageAudienceTraineeOption[];
  hasAnomalies: boolean;
}

/**
 * Load one offering's audience bundle, or null when the offering is NOT eligible
 * (missing, not ACTIVE, or MESSAGES not ENABLED). All reads are authoritative:
 * roster from ACTIVE CourseEnrollment, groups from CourseGroup stable ids - never
 * Student.groupName. A reader failure propagates (never swallowed).
 */
async function loadOfferingBundle(courseOfferingId: string): Promise<OfferingBundle | null> {
  const offering = await getCourseOfferingById(courseOfferingId);
  if (offering === null || offering.status !== "ACTIVE") {
    return null;
  }

  const capabilities = await getEffectiveCapabilities(offering.id);
  if (capabilities["MESSAGES"] !== "ENABLED") {
    return null;
  }

  const [tree, facts] = await Promise.all([
    getCourseGroupTreeByOfferingId(offering.id),
    getOfferingAudienceFacts(offering.id),
  ]);
  if (tree === null || facts === null) {
    return null;
  }

  const groupLabelsById = new Map<string, string>();
  const groupOptions: MessageAudienceGroupOption[] = [];
  for (const top of tree.topLevel) {
    groupLabelsById.set(top.id, top.name);
    groupOptions.push({
      courseGroupId: top.id,
      label: top.name,
      parentGroupId: null,
      isSubgroup: false,
    });
    for (const sub of top.subgroups) {
      const label = `${top.name} · ${sub.name}`;
      groupLabelsById.set(sub.id, label);
      groupOptions.push({
        courseGroupId: sub.id,
        label,
        parentGroupId: top.id,
        isSubgroup: true,
      });
    }
  }

  const groupTreeHasAnomalies = tree.anomalies.length > 0;
  const traineeOptions: MessageAudienceTraineeOption[] = facts.roster.rows.map((row) => ({
    studentId: row.id,
    fullName: row.fullName,
  }));

  const core: CoreOfferingFacts = {
    courseOfferingId: offering.id,
    offeringName: offering.name,
    roster: facts.roster,
    effectiveGroupMemberships: facts.effectiveGroupMemberships,
    groupLabelsById,
    groupTreeHasAnomalies,
  };

  return {
    core,
    level: offering.level,
    groupOptions,
    traineeOptions,
    hasAnomalies: facts.roster.anomalies.length > 0 || groupTreeHasAnomalies,
  };
}

/** Build the composer option view-model for ALL eligible offerings. */
async function loadMessageAudienceOptions(): Promise<MessageAudienceOptions> {
  const selectable = await listSelectableCourseOfferingsForAdmin();
  const activeOfferings = selectable.filter((offering) => offering.status === "ACTIVE");

  const offerings: MessageAudienceOfferingOption[] = [];
  for (const offering of activeOfferings) {
    const bundle = await loadOfferingBundle(offering.id);
    if (bundle === null) continue; // MESSAGES not enabled / not loadable
    offerings.push({
      courseOfferingId: bundle.core.courseOfferingId,
      offeringName: bundle.core.offeringName,
      level: bundle.level,
      groups: bundle.groupOptions,
      trainees: bundle.traineeOptions,
      hasAnomalies: bundle.hasAnomalies,
    });
  }

  return { offerings };
}

/** Load pure-core facts for ONLY the referenced, eligible offerings. */
async function loadMessageAudienceFacts(
  offeringIds: readonly string[],
): Promise<MessageAudienceFacts> {
  const offeringsById = new Map<string, CoreOfferingFacts>();
  for (const offeringId of offeringIds) {
    const bundle = await loadOfferingBundle(offeringId);
    if (bundle === null) continue; // ineligible -> absent -> OFFERING_NOT_ELIGIBLE
    offeringsById.set(bundle.core.courseOfferingId, bundle.core);
  }
  return { offeringsById };
}

// ---------------------------------------------------------------------------
// Admin entrypoints (requireAdmin).
// ---------------------------------------------------------------------------

export async function getMessageAudienceOptions(): Promise<MessageAudienceOptions> {
  await requireAdmin();
  return loadMessageAudienceOptions();
}

export async function previewMessageAudience(
  segments: readonly MessageAudienceSegmentInput[],
): Promise<MessageAudiencePreviewResult> {
  await requireAdmin();
  return previewMessageAudienceWithDeps({ loadFacts: loadMessageAudienceFacts }, segments);
}

// ---------------------------------------------------------------------------
// Instructor entrypoints (server-derived actor + canSendMessages). The
// client-supplied instructorId is accepted for compatibility and DISCARDED.
// ---------------------------------------------------------------------------

export async function getMessageAudienceOptionsAsInstructor(
  instructorId: string,
): Promise<MessageAudienceOptions> {
  void instructorId;
  const instructor = await getCurrentInstructor();
  if (!instructor || instructor.canSendMessages !== true) {
    return { offerings: [] };
  }
  return loadMessageAudienceOptions();
}

export async function previewMessageAudienceAsInstructor(
  instructorId: string,
  segments: readonly MessageAudienceSegmentInput[],
): Promise<MessageAudiencePreviewResult> {
  void instructorId;
  const instructor = await getCurrentInstructor();
  if (!instructor || instructor.canSendMessages !== true) {
    return { ok: false, code: "NOT_AUTHORIZED" };
  }
  return previewMessageAudienceWithDeps({ loadFacts: loadMessageAudienceFacts }, segments);
}
