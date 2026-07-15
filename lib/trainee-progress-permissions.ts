// Pure, dependency-free predicate for instructor access to the
// trainee-progress detail view (app/instructor's "מעקב חניכים" tab and the
// underlying instructor-scoped read/write actions it calls). Deliberately OR,
// not AND - an instructor only needs one of the two permissions below to open
// the page at all; which specific edit controls they then see inside the
// shared detail component is a separate, per-section check (canEditRidingNotes
// for riding/lunge/presentation progress, canEditTeachingPracticeFeedback for
// Teaching Practice feedback).
//
// Kept in its own tiny, framework-agnostic module (no "use client"/"use
// server", no prisma import) so it can be imported unchanged from both
// InstructorClient.tsx (client-side nav/render gating - a UX convenience
// only) and lib/actions/trainee-progress-instructor-access.ts (the real
// server-side gate, which re-fetches the instructor from the DB before
// calling this). Never the sole authorization check on its own on the server
// side - always combined with a fresh isActive/DB re-fetch.
export interface TraineeProgressPermissionFlags {
  canEditRidingNotes: boolean;
  canEditTeachingPracticeFeedback: boolean;
}

export function canAccessTraineeProgress(flags: TraineeProgressPermissionFlags): boolean {
  return flags.canEditRidingNotes || flags.canEditTeachingPracticeFeedback;
}
