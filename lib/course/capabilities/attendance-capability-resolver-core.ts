/**
 * ATT-2 — PURE, dependency-injected attendance capability RESOLUTION core.
 *
 * PURE by construction: no Prisma client, no DB, no clock, no randomness, no
 * env, no auth/session/cookie, no next/headers, no logging, no runtime side
 * effects at import time. Every impure capability (the effective-capability
 * loader, which is the only IO this stage needs) is passed in via the *Deps
 * interface, so the whole orchestration is unit-testable with plain fakes and
 * no live database (see attendance-capability-resolver-core.test.ts). The
 * server adapter attendance-capability-resolver.ts injects the real loader.
 *
 * WHAT THIS ANSWERS (and only this): given an ALREADY-RESOLVED, TRUSTED
 * CourseOffering context, does that offering's ATTENDANCE capability permit
 * attendance VISIBILITY / READS / WRITES? It performs the smallest possible
 * composition:
 *   trusted offering context
 *     -> (fail closed if missing/malformed, WITHOUT touching the loader)
 *     -> deps.loadEffectiveCapabilities(offeringId)   [generic resolver's output]
 *     -> attendanceCapabilityAccessFromEffective(...)  [ATT-1 policy]
 *     -> AttendanceCapabilityAccess
 *
 * BOUNDARIES this stage deliberately does NOT cross (COURSE-ARCHITECTURE):
 *   - It does NOT SELECT which offering is current for an actor. That is a
 *     separate current-offering selection layer (item 1). This module only
 *     LOADS the capabilities of an already-trusted offering (item 2). There is
 *     therefore no singleton/first-row/env/global fallback here: a missing
 *     trusted context fails closed, it never resolves an offering itself.
 *   - It does NOT derive or trust an actor/session, a client-supplied offering
 *     id treated as authorization, a student id, a date, or any StudentAttendance
 *     fact. The only input beyond the injected loader is the trusted context's
 *     opaque offering id. StudentAttendance stays one shared Student + calendar-
 *     date fact with NO courseOfferingId — this governs ACCESS THROUGH an
 *     offering surface, never ownership of the fact (ATT-1 / Design 1).
 *   - It does NOT duplicate the ENABLED / READ_ONLY / DISABLED mapping. The
 *     final decision is produced ONLY by the ATT-1 policy helper
 *     (attendanceCapabilityAccessFromEffective); the generic effective-status
 *     resolution is produced ONLY by the injected loader (which wraps
 *     resolveEffectiveCapabilitiesFromRows in the adapter).
 *
 * FAIL CLOSED. A null/undefined trusted context or a malformed/empty offering
 * identity yields the fully-denied ATT-1 result WITHOUT querying the loader. A
 * loader that resolves to null (its explicit "could not resolve safely" signal)
 * likewise yields full denial. A loader that REJECTS (an infrastructure failure
 * — DB/catalog read error) propagates unchanged: the caller receives an
 * exception, never a permissive access object. This matches the existing
 * capability-reader convention (offering-capabilities.ts: "A database failure
 * propagates unchanged"). The externally usable access result can never become
 * permissive because resolution failed. No raw error, id, or PII is ever
 * reflected into the result.
 */
import type { CapabilityKey } from "./capability-keys";
import type { EffectiveCapabilityStatus } from "./effective-capability-core";
import {
  attendanceCapabilityAccessFromEffective,
  type AttendanceCapabilityAccess,
} from "./attendance-capability-policy-core";
import { normalizeOfferingId } from "../offering-by-id-core";

/**
 * The MINIMAL trusted CourseOffering context this resolver accepts: only the
 * opaque offering id. Deliberately a structural subset of both
 * `CurrentCourseOffering` (the singleton resolver's view) and
 * `CourseOfferingView` (the by-id view), so a future caller passes either
 * already-resolved, server-owned offering directly.
 *
 * It is intentionally id-only: this stage does NOT re-decide the offering's
 * activeness/availability (status is not read here). Whether an offering is a
 * valid CURRENT context — ACTIVE vs ARCHIVED, exists, is the actor's — is the
 * trusted-context provider's concern (item 1), which the existing repository
 * loaders (getEffectiveCapabilities, getCourseOfferingById) do NOT gate on
 * offering status either. Adding an activeness gate here would invent a
 * convention the repository does not currently define.
 */
export interface TrustedOfferingContext {
  readonly id: string;
}

/**
 * The effective-capability map shape the loader yields — the generic resolver's
 * output (as produced by resolveEffectiveCapabilitiesFromRows for a single
 * offering). Modelled as a Readonly Partial so both a full
 * `Record<CapabilityKey, EffectiveCapabilityStatus>` (the resolver's real
 * output) and an incomplete/absent map are representable and both fail closed
 * through the ATT-1 helper.
 */
export type EffectiveCapabilityMap = Readonly<
  Partial<Record<CapabilityKey, EffectiveCapabilityStatus>>
>;

/**
 * Injectable dependencies for {@link resolveAttendanceCapabilityAccessWithDeps}.
 *
 * `loadEffectiveCapabilities` loads ONE trusted offering's effective-capability
 * map (the sparse-row model + catalog resolved through the generic
 * resolveEffectiveCapabilitiesFromRows). It receives ONLY a server-owned
 * offering id — never a client value, actor id, student id, or date. It returns
 * the effective map, or `null` to signal "could not resolve safely" (a
 * fail-closed deny), and MAY reject to signal an infrastructure failure (which
 * propagates — never a permissive result).
 */
export interface AttendanceCapabilityResolutionDeps {
  loadEffectiveCapabilities: (
    courseOfferingId: string,
  ) => Promise<EffectiveCapabilityMap | null>;
}

/**
 * Resolve the attendance capability access for ONE already-trusted CourseOffering
 * context.
 *
 * Deterministic for deterministic inputs. Fail-closed order:
 *   1. null/undefined trusted context -> fully denied (loader NOT called): there
 *      is no offering to load and NO fallback selection is attempted.
 *   2. malformed/empty offering identity -> fully denied (loader NOT called):
 *      an empty/whitespace-only id can never address an offering.
 *   3. otherwise load the effective map for that exact offering id and derive
 *      the final decision via the ATT-1 policy helper. A null map fails closed;
 *      an absent/out-of-domain ATTENDANCE entry fails closed; a loader rejection
 *      propagates (never permissive).
 *
 * The returned value is EXACTLY the ATT-1 `AttendanceCapabilityAccess` — this
 * module adds no status mapping of its own.
 */
export async function resolveAttendanceCapabilityAccessWithDeps(
  deps: AttendanceCapabilityResolutionDeps,
  offeringContext: TrustedOfferingContext | null | undefined,
): Promise<AttendanceCapabilityAccess> {
  // (1) No trusted offering context at all — fail closed WITHOUT any loader
  // query and WITHOUT selecting an offering (no singleton/first-row fallback).
  if (offeringContext === null || offeringContext === undefined) {
    return attendanceCapabilityAccessFromEffective(null);
  }
  // (2) Malformed/empty offering identity — never query the loader with it.
  // normalizeOfferingId returns null for empty/whitespace-only/non-string input
  // and passes a valid id through UNCHANGED for an exact primary-key lookup.
  const offeringId = normalizeOfferingId(offeringContext.id);
  if (offeringId === null) {
    return attendanceCapabilityAccessFromEffective(null);
  }
  // (3) Load the trusted offering's effective-capability map (sparse-row model
  // preserved by the loader; row absence => effective DISABLED) and delegate the
  // ENABLED / READ_ONLY / DISABLED decision entirely to the ATT-1 policy helper.
  const effective = await deps.loadEffectiveCapabilities(offeringId);
  return attendanceCapabilityAccessFromEffective(effective);
}
