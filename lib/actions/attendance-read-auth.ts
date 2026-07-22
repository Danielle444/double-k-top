/**
 * ATT-SEC-1 - PURE, dependency-injected orchestration that binds the two
 * attendance READ paths to the server-derived actor identity.
 *
 * This module is deliberately NOT a "use server" module: it is a plain
 * server-side library, so nothing here is registered as a Server Action. It
 * carries the testable orchestration (session-actor gate + delegation to the
 * already-fetched reader) that the public server actions in ./attendance import
 * and wire to real dependencies (the canonical actor DAL + the existing Prisma
 * reads). Following the same split-of-concerns convention as
 * ./contacts-student-directory.ts.
 *
 * NO runtime side effects at import time, and NO Prisma / next-cookies import:
 * every impure capability (the session actor resolver, the row/range reader) is
 * passed in via the *Deps interfaces. The only edges back to ./attendance are
 * erased `import type`s (their single source of truth is ./attendance), so the
 * type-only edge creates no runtime circular import and pulls in neither
 * next/headers nor Prisma.
 *
 * SECURITY CONTRACT (why this exists):
 *  - The instructor tracking read previously had NO authentication at all.
 *  - The trainee notice read previously trusted a client-supplied studentId.
 * Both now derive identity ONLY from the injected server-side actor resolver
 * (getCurrentInstructor / getCurrentTrainee), never from a client-supplied id.
 * A missing/invalid/inactive/wrong-audience actor (the resolver returns null in
 * every such case) fails closed to an empty result, revealing nothing. This is
 * the same fail-closed read convention as getStudentContacts /
 * getNotificationsForStudent.
 */
import type {
  AttendanceTrackingRow,
  AttendanceStatusValue,
  StudentAttendanceNotice,
} from "./attendance";
import type { AttendanceCapabilityAccess } from "@/lib/course/capabilities/attendance-capability-policy-core";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// --- instructor attendance tracking read ------------------------------------

/**
 * Injectable dependencies for {@link loadInstructorAttendanceTrackingWithDeps}.
 * `getCurrentInstructor` is the canonical server-side actor resolver (null for
 * any unauthenticated / invalid / inactive / wrong-audience session);
 * `buildRows` is the existing range reader that produces the tracking DTO.
 */
export interface InstructorAttendanceTrackingDeps {
  getCurrentInstructor: () => Promise<{ id: string } | null>;
  /**
   * ATT-3R: parameterless, server-owned current-offering ATTENDANCE capability
   * resolver (real wiring: resolveCurrentAttendanceCapabilityAccess). Called
   * ONLY after the actor gate passes; a rejection (missing/ambiguous offering
   * or infrastructure failure) propagates and is never converted into allowed
   * access. Accepts no courseOfferingId / actor / date / client value.
   */
  resolveAttendanceAccess: () => Promise<AttendanceCapabilityAccess>;
  buildRows: (
    startDateKey: string,
    endDateKey: string,
  ) => Promise<AttendanceTrackingRow[]>;
}

/**
 * Gate the instructor tracking read on a trustworthy server-derived instructor
 * actor, THEN require the current CourseOffering's ATTENDANCE read capability,
 * THEN delegate to the unchanged range reader.
 *
 * Identity comes solely from deps.getCurrentInstructor(); there is no instructor
 * id parameter, so no client value can select or impersonate an instructor. A
 * null actor (unauthenticated / invalid / inactive) fails closed to [] and
 * neither the capability resolver NOR the reader is invoked. The instructor
 * read boundary is intentionally identity-only: viewing does NOT require
 * canEditAttendance (that flag gates editing only - see StudentAttendance/
 * canEditAttendance schema note), so this reader still checks no actor-level
 * permission flag.
 *
 * ATT-3R: only AFTER the actor check passes is deps.resolveAttendanceAccess()
 * called; the current CourseOffering's ATTENDANCE capability must yield
 * canRead === true. READ_ONLY and ENABLED both permit the read (canRead=true);
 * DISABLED and any fail-closed denial (DENIED_MISSING_CONTEXT /
 * DENIED_UNKNOWN_STATUS, canRead=false) fail closed to the same [] the actor
 * denial uses, and the reader is NEVER invoked. A resolver rejection (missing/
 * ambiguous offering, or infrastructure failure) propagates unchanged and is
 * never converted into an allowed or empty result. `canRead` (data read), not
 * `canView` (navigation visibility), is used so this consumer expresses the
 * operation it actually performs. The capability is a STRICT ADDITION checked
 * only after the actor gate, so it can never open an actor-level denial and no
 * client-supplied offering identity becomes authorization. For a valid active
 * instructor whose offering permits reads the returned DTO and the date-range
 * behaviour are exactly as before.
 */
export async function loadInstructorAttendanceTrackingWithDeps(
  deps: InstructorAttendanceTrackingDeps,
  startDateKey: string,
  endDateKey: string,
): Promise<AttendanceTrackingRow[]> {
  const instructor = await deps.getCurrentInstructor();
  if (!instructor) {
    return [];
  }
  const access = await deps.resolveAttendanceAccess();
  if (!access.canRead) {
    return [];
  }
  return deps.buildRows(startDateKey, endDateKey);
}

// --- trainee attendance notice read -----------------------------------------

/**
 * The minimal attendance row shape the notice orchestration needs from the
 * injected reader - deliberately narrower than the full StudentAttendance row.
 */
export interface StudentAttendanceNoticeRow {
  status: AttendanceStatusValue;
  arrivalTime: string | null;
  departureTime: string | null;
  notes: string | null;
}

/**
 * Injectable dependencies for {@link loadStudentAttendanceNoticeWithDeps}.
 * `getCurrentTrainee` is the canonical server-side actor resolver (null for any
 * unauthenticated / invalid / inactive / wrong-audience session);
 * `readAttendanceRow` fetches exactly one trainee/date attendance row.
 */
export interface StudentAttendanceNoticeDeps {
  getCurrentTrainee: () => Promise<{ id: string } | null>;
  readAttendanceRow: (
    studentId: string,
    dateKeyStr: string,
  ) => Promise<StudentAttendanceNoticeRow | null>;
}

/**
 * Resolve the current trainee's own attendance notice for one date.
 *
 * The trainee id is taken solely from deps.getCurrentTrainee(); the public
 * signature carries NO studentId, so a caller can never request another
 * trainee's notice. Order and behaviour preserve the original exactly:
 *  - a malformed dateKey returns null (no actor read, no DB read);
 *  - a null actor (unauthenticated / invalid / inactive) returns null;
 *  - a missing row returns null;
 *  - a PRESENT row returns null (only ABSENT/PARTIAL are ever surfaced);
 *  - ABSENT/PARTIAL return the notice with unchanged notes/time fields.
 */
export async function loadStudentAttendanceNoticeWithDeps(
  deps: StudentAttendanceNoticeDeps,
  dateKeyStr: string,
): Promise<StudentAttendanceNotice | null> {
  if (!DATE_KEY_RE.test(dateKeyStr)) {
    return null;
  }
  const trainee = await deps.getCurrentTrainee();
  if (!trainee) {
    return null;
  }
  const row = await deps.readAttendanceRow(trainee.id, dateKeyStr);
  if (!row) {
    return null;
  }
  if (row.status === "PRESENT") {
    return null;
  }
  return {
    dateKey: dateKeyStr,
    status: row.status,
    arrivalTime: row.arrivalTime,
    departureTime: row.departureTime,
    notes: row.notes,
  };
}
