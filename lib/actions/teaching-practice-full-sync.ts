"use server";

// Safety fix (post Stage E2): this file now only holds the ONE thing a
// "use server" module is actually for here - the admin-gated public action.
// All reusable sync logic (including the track-scoped helper other server
// actions import) has moved to lib/teaching-practice-full-sync-core.ts,
// which deliberately carries NO "use server" directive - see that file's
// header for exactly why an exported, ungated write helper must never live
// in a Server Action module, regardless of how trusted its current callers
// are. This file does not duplicate any of that logic.
//
// Deliberately NOT re-exporting TeachingPracticeFullSyncApplyResult/
// TeachingPracticeFullSyncApplyError from here via `export type { ... }
// from` - lib/actions/teaching-practice.ts already hit this exact bug
// (see its own header comment): Next.js's server-actions transform in a
// "use server" file scans every export, including type-only re-exports,
// and tries to wrap them as if they were runtime values, producing a
// "X is not defined" crash. Consumers must import these two types directly
// from lib/teaching-practice-full-sync-core instead.
import { requireAdmin } from "@/lib/auth/require-admin";
import {
  syncTeachingPracticeFixedStructureToGeneratedLessonsInternal,
  type TeachingPracticeFullSyncApplyResult,
} from "@/lib/teaching-practice-full-sync-core";

// Group-scoped only (groupName required, "א"/"ב" only) - this action never
// runs system-wide. See lib/teaching-practice-full-sync-core.ts for the
// full eligibility rules (future lessons only, meaningful-feedback lessons
// skipped, no lesson create/delete, no practiceType changes).
export async function syncTeachingPracticeFixedStructureToGeneratedLessonsAsAdmin(
  groupName: string
): Promise<TeachingPracticeFullSyncApplyResult> {
  await requireAdmin();
  return syncTeachingPracticeFixedStructureToGeneratedLessonsInternal(groupName);
}
