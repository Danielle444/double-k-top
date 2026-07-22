/**
 * ATT-2 — server-side attendance capability resolution adapter.
 *
 * Server-side only. `import "server-only"` (the repository's existing
 * server-only convention, used by lib/auth/session-*) makes an accidental
 * client import a build error; it also reuses the existing Prisma-backed reader
 * getEffectiveCapabilities, so this stays a thin, un-tested-by-design IO shell
 * (same convention as offering-capabilities.ts / current-offering.ts). The
 * ENTIRE decision is delegated to the PURE core
 * (attendance-capability-resolver-core.ts) and, within it, to the ATT-1 policy
 * helper — nothing is re-implemented here.
 *
 * DORMANT: this module has ZERO runtime consumers in this stage. Nothing under
 * app/, lib/actions, navigation, or any attendance action/page/component imports
 * it. It is NOT a Server Action: there is no "use server" directive, so it is
 * never registered as a public, unauthenticated entry point, and it accepts a
 * TRUSTED offering CONTEXT (already resolved server-side), never a raw
 * client-supplied courseOfferingId string as authorization. Wiring an attendance
 * consumer to it — combining actor, current-offering selection, and this access
 * — is a SEPARATE, later, separately-approved stage.
 *
 * IO / fail-closed contract: getEffectiveCapabilities issues the two capability
 * reads (offering rows + catalog) and resolves them through the generic
 * resolveEffectiveCapabilitiesFromRows. A database failure propagates unchanged
 * through this adapter and the pure core (no default map, no cached fallback, no
 * permissive result) — exactly matching getEffectiveCapabilities's documented
 * "propagates unchanged" convention.
 */
import "server-only";

import { getEffectiveCapabilities } from "./offering-capabilities";
import {
  resolveAttendanceCapabilityAccessWithDeps,
  type TrustedOfferingContext,
} from "./attendance-capability-resolver-core";
import type { AttendanceCapabilityAccess } from "./attendance-capability-policy-core";

export type { TrustedOfferingContext } from "./attendance-capability-resolver-core";

/**
 * Resolve the attendance capability access for one ALREADY-TRUSTED CourseOffering
 * context, using the real Prisma-backed effective-capability reader.
 *
 * The `offeringContext` MUST originate from a server-owned resolver (e.g.
 * resolveCurrentCourseOffering / getCourseOfferingById) — never from a
 * client-supplied value treated as authorization. A missing/malformed context
 * fails closed WITHOUT any database read; a database failure propagates
 * unchanged and never yields a permissive result.
 */
export async function resolveAttendanceCapabilityAccess(
  offeringContext: TrustedOfferingContext | null | undefined,
): Promise<AttendanceCapabilityAccess> {
  return resolveAttendanceCapabilityAccessWithDeps(
    { loadEffectiveCapabilities: (courseOfferingId) => getEffectiveCapabilities(courseOfferingId) },
    offeringContext,
  );
}
